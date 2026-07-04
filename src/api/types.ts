/** Gitee API 返回的文件/目录项 */
export interface GiteeFileItem {
  type: 'file' | 'dir';
  name: string;
  path: string;
  sha: string;
  size?: number;
  download_url?: string | null;
}

/** Gitee API 目录内容响应 */
export interface GiteeContentsResponse extends Array<GiteeFileItem> {}

/** Gitee API 文件内容响应（单文件） */
export interface GiteeFileContentResponse {
  type: 'file';
  encoding: 'base64' | 'none';
  size: number;
  name: string;
  path: string;
  content: string; // Base64 encoded
  sha: string;
}

/** 仓库配置 */
export interface RepoConfig {
  owner: string;
  repo: string;
  token: string;
}

/** 歌曲信息 */
export interface SongInfo {
  key: string;       // 缓存的唯一键
  name: string;      // 显示名称（不含扩展名）
  fileName: string;  // 原始文件名
  path: string;      // 在 Gitee 仓库中的路径
  size: number;      // 文件大小（字节）
  ext: string;       // 文件扩展名
  format: AudioFormat;
}

/** 歌单（目录）信息 */
export interface PlaylistInfo {
  name: string;
  path: string;
}

/** 音频格式类别 */
export type AudioFormat = 'mp3' | 'wav' | 'ogg' | 'flac' | 'aac' | 'm4a' | 'other';

/** 缓存条目（存储到 IndexedDB） */
export interface CacheEntry {
  blob: Blob;
  size: number;        // 文件大小（字节）
  lastPlayed: number;  // 最后播放时间戳
  createdAt: number;   // 缓存创建时间戳
  expiresAt: number;   // 过期时间戳
}

/** 缓存元数据 */
export interface CacheMeta {
  totalSize: number;
  lastCleanup: number;
}

/** 播放状态 */
export interface PlayerState {
  currentSong: SongInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
}
