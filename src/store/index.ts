import { create } from 'zustand';
import type { RepoConfig, SongInfo, PlaylistInfo } from '@/api/types';

interface AppState {
  // 仓库配置
  repoConfig: RepoConfig | null;
  setRepoConfig: (config: RepoConfig) => void;
  clearRepoConfig: () => void;

  // 歌单/歌曲列表
  playlists: PlaylistInfo[];
  currentPlaylist: PlaylistInfo | null;
  songs: SongInfo[];
  loading: boolean;
  setPlaylists: (list: PlaylistInfo[]) => void;
  setSongs: (songs: SongInfo[]) => void;
  setCurrentPlaylist: (playlist: PlaylistInfo | null) => void;
  setLoading: (loading: boolean) => void;

  // 播放器
  currentSong: SongInfo | null;
  isPlaying: boolean;
  setCurrentSong: (song: SongInfo | null) => void;
  setIsPlaying: (playing: boolean) => void;

  // 缓存
  cacheSize: number;
  setCacheSize: (size: number) => void;
}

/** 从 localStorage 读取配置 */
function loadConfig(): RepoConfig | null {
  try {
    const raw = localStorage.getItem('repoConfig');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

/** 保存配置到 localStorage */
function saveConfig(config: RepoConfig): void {
  localStorage.setItem('repoConfig', JSON.stringify(config));
}

/** 清除配置 */
function removeConfig(): void {
  localStorage.removeItem('repoConfig');
}

export const useAppStore = create<AppState>((set) => ({
  // 仓库配置 - 初始化时从 localStorage 加载
  repoConfig: loadConfig(),
  setRepoConfig: (config) => {
    saveConfig(config);
    set({ repoConfig: config });
  },
  clearRepoConfig: () => {
    removeConfig();
    set({
      repoConfig: null,
      playlists: [],
      currentPlaylist: null,
      songs: [],
      currentSong: null,
      isPlaying: false,
    });
  },

  // 歌单/歌曲列表
  playlists: [],
  currentPlaylist: null,
  songs: [],
  loading: false,
  setPlaylists: (playlists) => set({ playlists }),
  setSongs: (songs) => set({ songs }),
  setCurrentPlaylist: (playlist) => set({ currentPlaylist: playlist }),
  setLoading: (loading) => set({ loading }),

  // 播放器
  currentSong: null,
  isPlaying: false,
  setCurrentSong: (song) => set({ currentSong: song }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),

  // 缓存
  cacheSize: 0,
  setCacheSize: (size) => set({ cacheSize: size }),
}));
