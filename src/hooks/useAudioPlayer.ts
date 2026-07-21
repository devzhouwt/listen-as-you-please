import { useRef, useCallback, useEffect } from 'react';
import { message } from 'antd';
import { createApi, fetchFileBase64 } from '@/api/gitee';
import type { SongInfo } from '@/api/types';
import { getCacheKey, getCacheItem, setCacheItem } from '@/cache/audioCache';
import { useAppStore } from '@/store';

let workerInstance: Worker | null = null;

// 说明：后台/息屏的持续播放完全依赖 HTMLAudioElement 本身正在发声 + Media Session
// 会话（移动端 PWA 音乐播放器的标准做法）。此前用 Web Audio（createMediaElementSource
// 路由 / 静音振荡器保活）既无法真正保活（gain=0 不发声），又会在系统挂起 AudioContext
// 后把歌曲一起冻死，故彻底移除，不再引入 AudioContext。

// ===== 批量预加载状态（模块级，跨渲染周期持久化） =====
// 预加载将即将播放的歌曲 blob URL 提前存入内存，使 onEnded 切歌走同步路径，
// 避免后台/息屏时异步 I/O（IndexedDB 读取 / 网络下载）被 Android 系统冻结。
const preloadedMap = new Map<string, { song: SongInfo; blobUrl: string }>();
let preloadInProgress = false;
let preloadAbortCtrl: AbortController | null = null;

/** 更新 Media Session 元数据（锁屏信息 + 后台播放保活） */
function updateMediaSession(song: SongInfo | null, isPlaying: boolean) {
  if (!('mediaSession' in navigator)) return;

  if (!song) {
    navigator.mediaSession.metadata = null;
    return;
  }

  // 设置歌曲元数据（锁屏/通知栏显示）
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.name || '未知歌曲',
    artist: '随心听',
    album: '我的歌单',
  });

  // 设置播放状态
  navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
}

/** 更新 Media Session 位置状态（进度） */
function updateMediaSessionPosition(audio: HTMLAudioElement) {
  if (!('mediaSession' in navigator) || !audio.duration || isNaN(audio.duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      position: audio.currentTime,
      playbackRate: audio.playbackRate,
    });
  } catch { /* 部分浏览器不支持 */ }
}

/** 获取 Web Worker 单例 */
function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(
      new URL('@/workers/base64Worker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return workerInstance;
}

/** Base64 解码（通过 Web Worker，返回 ArrayBuffer） */
function decodeBase64(base64: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = getWorker();
    const id = Date.now();

    const handler = (e: MessageEvent) => {
      if (e.data.id === id) {
        worker.removeEventListener('message', handler);
        if (e.data.success) {
          resolve(e.data.buffer);
        } else {
          reject(new Error(e.data.error));
        }
      }
    };

    worker.addEventListener('message', handler);
    worker.postMessage({ base64, id });

    // 超时处理
    setTimeout(() => {
      worker.removeEventListener('message', handler);
      reject(new Error('Base64 解码超时'));
    }, 60000);
  });
}

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const store = useAppStore();
  const playRef = useRef<((song: SongInfo) => Promise<void>) | null>(null);
  /**
   * 积极批量预加载：在当前歌曲播放期间，提前把后续最多 PRELOAD_COUNT 首歌
   * 的 blob URL 准备好存入内存（preloadedMap）。
   *
   * - 已缓存歌曲：从 IndexedDB 读取 blob，创建 URL
   * - 未缓存歌曲：从远程仓库下载 → 写入缓存 → 创建 URL
   *
   * 核心目标：确保 onEnded 切歌时能直接命中内存中的 blob URL，
   * 走纯同步路径（设 src + play），不触发任何异步 I/O。
   * 在后台/息屏状态下，Android 会深度冻结非活跃 tab 的异步任务，
   * 但音频正在播放时网络和 I/O 仍可正常运行，因此必须趁此窗口完成预加载。
   */
  const preloadUpcomingSongs = useCallback(async (currentSong: SongInfo) => {
    if (preloadInProgress) return;
    preloadInProgress = true;

    try {
      const state = useAppStore.getState();
      if (!state.isPlayAllActive || state.songs.length === 0) return;

      const config = state.repoConfig;
      if (!config) return;

      const PRELOAD_COUNT = 5;
      const currentIdx = state.songs.findIndex((s) => s.key === currentSong.key);
      if (currentIdx < 0) return;

      // 构建待预加载歌曲列表
      const songsToPreload: SongInfo[] = [];
      for (let i = 1; i <= PRELOAD_COUNT; i++) {
        let idx = currentIdx + i;
        if (idx >= state.songs.length) {
          if (state.isLoopMode) {
            idx = idx % state.songs.length;
          } else {
            break;
          }
        }
        const s = state.songs[idx];
        if (!s || preloadedMap.has(s.key)) continue;
        songsToPreload.push(s);
      }

      const api = createApi(config.token);

      for (const song of songsToPreload) {
        if (preloadedMap.has(song.key)) continue;

        try {
          const cacheKey = getCacheKey(song.key);
          const cached = await getCacheItem(cacheKey);

          if (cached) {
            // 缓存命中 → 创建 blob URL
            const blobUrl = URL.createObjectURL(cached.blob);
            preloadedMap.set(song.key, { song, blobUrl });
          } else {
            // 缓存未命中 → 趁当前歌曲播放期间从网络下载
            const base64 = await fetchFileBase64(api, config.owner, config.repo, song.path);
            const arrayBuffer = await decodeBase64(base64);

            const mimeMap: Record<string, string> = {
              mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
              flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
            };
            const mime = mimeMap[song.format] || 'audio/mpeg';
            const blob = new Blob([arrayBuffer], { type: mime });

            // 写入缓存（不阻塞后续预加载）
            setCacheItem(cacheKey, blob, song.size).catch(() => {});

            const blobUrl = URL.createObjectURL(blob);
            preloadedMap.set(song.key, { song, blobUrl });
          }
        } catch {
          // 单首预加载失败不影响后续歌曲
        }
      }
    } finally {
      preloadInProgress = false;
    }
  }, []);

  /** 播放指定歌曲 */
  const play = useCallback(async (song: SongInfo) => {
    const audio = audioRef.current;
    if (!audio) return;

    const config = useAppStore.getState().repoConfig;
    if (!config) {
      message.error('请先配置仓库信息');
      return;
    }

    const currentState = useAppStore.getState();

    // 如果点击的是同一首歌且正在播放，则暂停
    if (currentState.currentSong?.key === song.key && currentState.isPlaying) {
      audio.pause();
      store.setIsPlaying(false);
      store.setAudioLoading(false);
      updateMediaSession(song, false);
      return;
    }

    // 切歌：立即暂停当前播放
    if (currentState.isPlaying) {
      audio.pause();
      store.setIsPlaying(false);
    }

    store.setCurrentSong(song);
    store.setAudioLoading(true);

    try {
      const cacheKey = getCacheKey(song.key);
      const cached = await getCacheItem(cacheKey);

      if (cached) {
        // 缓存命中
        const url = URL.createObjectURL(cached.blob);
        audio.src = url;
        // 确保在播放前重置 currentTime
        audio.currentTime = 0;
        await audio.play();
        store.setIsPlaying(true);
        store.setAudioLoading(false);
        updateMediaSession(song, true);
        // 触发批量预加载后续歌曲
        preloadUpcomingSongs(song);
        return;
      }

      // 缓存未命中，从远程仓库下载
      const api = createApi(config.token);
      const base64 = await fetchFileBase64(api, config.owner, config.repo, song.path);
      
      // 通过 Web Worker 解码
      const arrayBuffer = await decodeBase64(base64);

      // 确定 MIME 类型
      const mimeMap: Record<string, string> = {
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        flac: 'audio/flac',
        aac: 'audio/aac',
        m4a: 'audio/mp4',
      };
      const mime = mimeMap[song.format] || 'audio/mpeg';
      const blob = new Blob([arrayBuffer], { type: mime });

      // 写入缓存（不阻塞播放）
      setCacheItem(cacheKey, blob, song.size).catch(() => {
        // 缓存写入失败不影响播放
      });

      // 播放
      const url = URL.createObjectURL(blob);
      audio.src = url;
      // 确保在播放前重置 currentTime
      audio.currentTime = 0;
      await audio.play();
      store.setIsPlaying(true);
      store.setAudioLoading(false);
      updateMediaSession(song, true);
      // 触发批量预加载后续歌曲
      preloadUpcomingSongs(song);
    } catch (err: any) {
      store.setAudioLoading(false);
      message.error(`加载失败: ${err?.message || '未知错误'}`);
      store.setCurrentSong(null);
      store.setIsPlaying(false);
    }
  }, [store]);

  // 始终保持 playRef 指向最新的 play
  playRef.current = play;

  // 初始化 Audio 元素并挂载到 DOM
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = 'auto';
      audioRef.current.id = 'global-audio';
      audioRef.current.style.display = 'none';
      document.body.appendChild(audioRef.current);
    }

    const audio = audioRef.current;

    const onEnded = () => {
      const state = useAppStore.getState();

      // === 优先从预加载 Map 取下一首的 blob URL（同步路径，不经异步 I/O） ===
      if (state.isPlayAllActive && state.songs.length > 0) {
        const currentIdx = state.songs.findIndex(
          (s) => s.key === state.currentSong?.key
        );
        if (currentIdx >= 0) {
          let nextIdx = currentIdx + 1;
          if (nextIdx >= state.songs.length) {
            nextIdx = state.isLoopMode ? 0 : -1;
          }
          if (nextIdx >= 0) {
            const nextSong = state.songs[nextIdx];
            const preloaded = preloadedMap.get(nextSong.key);
            if (preloaded) {
              preloadedMap.delete(nextSong.key);
              // 释放上一首 blob URL 内存
              if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
              store.setCurrentSong(preloaded.song);
              audio.src = preloaded.blobUrl;
              audio.currentTime = 0;
              audio.play().then(() => {
                store.setIsPlaying(true);
                updateMediaSession(preloaded.song, true);
                preloadUpcomingSongs(preloaded.song);
              }).catch(() => {
                // 预加载播放失败，回退到正常加载路径
                playRef.current?.(preloaded.song);
              });
              return;
            }
          }
        }
      }

      // === 单曲循环（播放全部未开启时） ===
      if (state.isLoopMode && !state.isPlayAllActive) {
        if (state.currentSong) {
          audio.currentTime = 0;
          audio.play().then(() => {
            store.setIsPlaying(true);
            updateMediaSession(state.currentSong, true);
          }).catch(() => {});
        }
        return;
      }

      // === 播放全部回退路径（预加载未命中） ===
      if (state.isPlayAllActive && state.songs.length > 0) {
        const currentIdx = state.songs.findIndex(
          (s) => s.key === state.currentSong?.key
        );
        if (currentIdx >= 0) {
          let nextIdx = currentIdx + 1;
          if (nextIdx >= state.songs.length) {
            nextIdx = state.isLoopMode ? 0 : -1;
          }
          if (nextIdx >= 0) {
            playRef.current?.(state.songs[nextIdx]);
            return;
          }
        }
        state.setPlayAllActive(false);
      }

      store.setIsPlaying(false);
    };

    // 安全网：检测 ended 事件未触发的情况（Android PWA 后台偶发）
    let playbackStuckSince = 0;
    const onTimeUpdate = () => {
      // 定期更新 Media Session 进度位置
      if (audio.currentTime > 0 && !isNaN(audio.currentTime)) {
        updateMediaSessionPosition(audio);
      }

      // 检测后台播放卡死：音频在歌曲末尾但未触发 ended 事件
      const nearEnd = audio.duration > 0 && (audio.duration - audio.currentTime) < 2;
      if (!audio.paused && audio.currentTime > 0) {
        if (nearEnd) {
          if (playbackStuckSince === 0) playbackStuckSince = Date.now();
          else if (Date.now() - playbackStuckSince > 5000) {
            // 卡在末尾超过 5 秒，手动触发切歌
            playbackStuckSince = 0;
            onEnded();
          }
        } else {
          playbackStuckSince = 0;
        }
      } else {
        playbackStuckSince = 0;
      }
    };

    const onLoadedMetadata = () => {
      // 元数据加载完成后，更新 Media Session 位置状态
      if (audio.duration && !isNaN(audio.duration)) {
        updateMediaSessionPosition(audio);
      }
    };

    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);

    // 注册 Media Session 动作处理器（锁屏/通知栏控制按钮）
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        const state = useAppStore.getState();
        if (state.currentSong && audio.src) {
          audio.play().then(() => {
            state.setIsPlaying(true);
            updateMediaSession(state.currentSong, true);
          }).catch(() => {});
        }
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        audio.pause();
        const state = useAppStore.getState();
        state.setIsPlaying(false);
        updateMediaSession(state.currentSong, false);
      });

      navigator.mediaSession.setActionHandler('previoustrack', () => {
        const state = useAppStore.getState();
        const { songs, currentSong } = state;
        if (songs.length === 0 || !currentSong) return;
        const currentIdx = songs.findIndex((s) => s.key === currentSong.key);
        if (currentIdx > 0) {
          playRef.current?.(songs[currentIdx - 1]);
        }
      });

      navigator.mediaSession.setActionHandler('nexttrack', () => {
        const state = useAppStore.getState();
        const { songs, currentSong, isLoopMode } = state;
        if (songs.length === 0 || !currentSong) return;
        const currentIdx = songs.findIndex((s) => s.key === currentSong.key);
        if (currentIdx < 0) return;
        let nextIdx = currentIdx + 1;
        if (nextIdx >= songs.length) {
          if (!isLoopMode) return; // 未开循环且已是最后一首 → 不动
          nextIdx = 0;             // 开循环 → 回到第一首
        }
        playRef.current?.(songs[nextIdx]);
      });

      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
          audio.currentTime = details.seekTime;
          updateMediaSessionPosition(audio);
        }
      });
    }

    return () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);

      // 清理所有预加载 blob URL
      for (const entry of preloadedMap.values()) {
        URL.revokeObjectURL(entry.blobUrl);
      }
      preloadedMap.clear();
      preloadInProgress = false;
      if (preloadAbortCtrl) {
        preloadAbortCtrl.abort();
        preloadAbortCtrl = null;
      }

      // 清除 Media Session 动作处理器
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('seekto', null);
      }
    };
    // 仅在挂载时初始化一次：避免因订阅整个 store，导致每次状态变更（切歌/播放暂停/加载）
    // 都销毁并重建事件监听 / Media Session / 预加载资源——那正是后台切到第 3 首卡在 00:00 的根因。
    // 注意：zustand 的 setter 引用是稳定的，闭包捕获一次即可长期使用；读取一律走 getState()。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 暂停 */
  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      store.setIsPlaying(false);
      const state = useAppStore.getState();
      updateMediaSession(state.currentSong, false);
    }
  }, [store]);

  /** 恢复播放 */
  const resume = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.src) {
      audio.play().then(() => {
        const state = useAppStore.getState();
        store.setIsPlaying(true);
        updateMediaSession(state.currentSong, true);
      }).catch(() => {
        // 自动播放被浏览器阻止时静默处理
      });
    }
  }, [store]);

  /** 切换播放/暂停 */
  const togglePlay = useCallback(() => {
    const state = useAppStore.getState();
    if (state.isPlaying) {
      pause();
    } else {
      resume();
    }
  }, [pause, resume]);

  /** 播放全部（切换）：仅切换模式状态，不改变当前播放状态 */
  const playAll = useCallback(() => {
    const state = useAppStore.getState();
    if (state.songs.length === 0) return;
    // 切换播放全部模式
    state.setPlayAllActive(!state.isPlayAllActive);
  }, []);

  /** 播放上一首 */
  const playPrev = useCallback(() => {
    const state = useAppStore.getState();
    const { songs, currentSong } = state;
    if (songs.length === 0 || !currentSong) return;
    const currentIdx = songs.findIndex((s) => s.key === currentSong.key);
    if (currentIdx <= 0) return;
    const prevSong = songs[currentIdx - 1];
    play(prevSong);
  }, [play]);

  /** 播放下一首（循环模式下最后一首回绕到第一首） */
  const playNext = useCallback(() => {
    const state = useAppStore.getState();
    const { songs, currentSong, isLoopMode } = state;
    if (songs.length === 0 || !currentSong) return;
    const currentIdx = songs.findIndex((s) => s.key === currentSong.key);
    if (currentIdx < 0) return;
    let nextIdx = currentIdx + 1;
    if (nextIdx >= songs.length) {
      if (!isLoopMode) return; // 未开循环且已是最后一首 → 不动
      nextIdx = 0;             // 开循环 → 回到第一首
    }
    play(songs[nextIdx]);
  }, [play]);

  /** 跳转到指定时间 */
  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = time;
    }
  }, []);

  /** 调整音量 */
  const setVolume = useCallback((vol: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = Math.max(0, Math.min(1, vol));
    }
  }, []);

  /** 清理 Audio URL */
  const revokeUrl = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.src.startsWith('blob:')) {
      URL.revokeObjectURL(audio.src);
    }
  }, []);

  return {
    audioRef,
    play,
    pause,
    resume,
    togglePlay,
    playAll,
    playPrev,
    playNext,
    seek,
    setVolume,
    revokeUrl,
  };
}
