import localforage from 'localforage';
import type { CacheEntry, CacheMeta } from '@/api/types';

const CACHE_PREFIX = 'music-cache';
const META_KEY = '__cache_meta__';
const MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500MB
const CACHE_TTL = 14 * 24 * 60 * 60 * 1000; // 14天

let cacheInstance: LocalForage | null = null;

/** 获取 localforage 实例（单例） */
export function getCacheInstance(): LocalForage {
  if (!cacheInstance) {
    cacheInstance = localforage.createInstance({
      name: 'ListenAsYouPlease',
      storeName: 'audioCache',
      description: 'Music audio file cache storage',
    });
  }
  return cacheInstance;
}

/** 生成缓存键 */
export function getCacheKey(repoPath: string): string {
  return `${CACHE_PREFIX}:${repoPath}`;
}

/** 读取缓存元数据 */
export async function getCacheMeta(): Promise<CacheMeta> {
  const cache = getCacheInstance();
  const meta = await cache.getItem<CacheMeta>(META_KEY);
  return meta ?? { totalSize: 0, lastCleanup: 0 };
}

/** 更新缓存元数据 */
async function setCacheMeta(meta: CacheMeta): Promise<void> {
  const cache = getCacheInstance();
  await cache.setItem(META_KEY, meta);
}

/** 读取缓存项，若已过期返回 null */
export async function getCacheItem(key: string): Promise<CacheEntry | null> {
  const cache = getCacheInstance();
  const entry = await cache.getItem<CacheEntry>(key);
  if (!entry) return null;
  
  // 检查是否过期
  if (Date.now() > entry.expiresAt) {
    await cache.removeItem(key);
    // 更新总大小
    const meta = await getCacheMeta();
    meta.totalSize = Math.max(0, meta.totalSize - entry.size);
    await setCacheMeta(meta);
    return null;
  }
  
  // 更新最后播放时间
  entry.lastPlayed = Date.now();
  await cache.setItem(key, entry);
  return entry;
}

/** 写入缓存项（含 LRU 淘汰检查） */
export async function setCacheItem(key: string, blob: Blob, size: number): Promise<void> {
  const cache = getCacheInstance();
  const meta = await getCacheMeta();
  
  // 确保空间足够
  await ensureCacheSpace(size);
  
  const now = Date.now();
  const entry: CacheEntry = {
    blob,
    size,
    lastPlayed: now,
    createdAt: now,
    expiresAt: now + CACHE_TTL,
  };
  
  await cache.setItem(key, entry);
  
  // 更新元数据
  meta.totalSize += size;
  await setCacheMeta(meta);
}

/** 删除单条缓存 */
export async function removeCacheItem(key: string): Promise<void> {
  const cache = getCacheInstance();
  const entry = await cache.getItem<CacheEntry>(key);
  if (entry) {
    await cache.removeItem(key);
    const meta = await getCacheMeta();
    meta.totalSize = Math.max(0, meta.totalSize - entry.size);
    await setCacheMeta(meta);
  }
}

/** 清空所有缓存 */
export async function clearAllCache(): Promise<void> {
  const cache = getCacheInstance();
  await cache.clear();
  await setCacheMeta({ totalSize: 0, lastCleanup: Date.now() });
}

/** 获取当前缓存总大小（字节） */
export async function getTotalSize(): Promise<number> {
  const meta = await getCacheMeta();
  return meta.totalSize;
}

/** LRU 淘汰：确保有足够的空间存放新数据 */
async function ensureCacheSpace(requiredBytes: number): Promise<void> {
  const cache = getCacheInstance();
  const meta = await getCacheMeta();
  
  const currentTotal = meta.totalSize;
  const needed = currentTotal + requiredBytes - MAX_CACHE_SIZE;
  
  if (needed <= 0) {
    // 空间充足，无需淘汰
    return;
  }
  
  // 1. 先收集所有缓存条目，找出过期和未过期的
  const allEntries: { key: string; entry: CacheEntry }[] = [];
  await cache.iterate<CacheEntry, void>((value, key) => {
    if (key === META_KEY) return; // 跳过元数据
    allEntries.push({ key, entry: value });
  });
  
  let freedSpace = 0;
  const now = Date.now();
  
  // 2. 删除过期条目
  const expired = allEntries.filter(({ entry }) => now > entry.expiresAt);
  for (const { key, entry } of expired) {
    await cache.removeItem(key);
    freedSpace += entry.size;
    meta.totalSize -= entry.size;
  }
  
  // 3. 若空间仍不足，按 LRU（lastPlayed 升序）淘汰
  if (freedSpace < needed) {
    const remaining = allEntries
      .filter(({ entry }) => now <= entry.expiresAt)
      .sort((a, b) => a.entry.lastPlayed - b.entry.lastPlayed); // 最久未播放的在前
    
    for (const { key, entry } of remaining) {
      if (freedSpace >= needed) break;
      await cache.removeItem(key);
      freedSpace += entry.size;
      meta.totalSize -= entry.size;
    }
  }
  
  // 4. 更新元数据
  meta.lastCleanup = now;
  await setCacheMeta(meta);
}
