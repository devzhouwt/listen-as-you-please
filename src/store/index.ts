import { create } from 'zustand';
import type { RepoConfig, SongInfo, PlaylistInfo } from '@/api/types';

interface AppState {
  // 仓库配置
  repoConfig: RepoConfig | null;
  setRepoConfig: (config: RepoConfig) => void;
  clearRepoConfig: () => void;

  // 配置页面显隐控制（切换仓库时不销毁原配置）
  showConfig: boolean;
  openConfig: () => void;
  closeConfig: () => void;

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
  isAudioLoading: boolean;
  isPlayAllActive: boolean;
  isLoopMode: boolean;
  setCurrentSong: (song: SongInfo | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setAudioLoading: (loading: boolean) => void;
  setPlayAllActive: (active: boolean) => void;
  setLoopMode: (loop: boolean) => void;

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
  showConfig: !loadConfig(), // 没有配置时默认显示配置页
  setRepoConfig: (config) => {
    saveConfig(config);
    set({ repoConfig: config, showConfig: false });
  },
  clearRepoConfig: () => {
    removeConfig();
    set({
      repoConfig: null,
      showConfig: true,
      playlists: [],
      currentPlaylist: null,
      songs: [],
      currentSong: null,
      isPlaying: false,
    });
  },
  openConfig: () => set({ showConfig: true }),
  closeConfig: () => set({ showConfig: false }),

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
  isAudioLoading: false,
  isPlayAllActive: false,
  isLoopMode: false,
  setCurrentSong: (song) => set({ currentSong: song }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setAudioLoading: (loading) => set({ isAudioLoading: loading }),
  setPlayAllActive: (active) => set({ isPlayAllActive: active }),
  setLoopMode: (loop) => set({ isLoopMode: loop }),

  // 缓存
  cacheSize: 0,
  setCacheSize: (size) => set({ cacheSize: size }),
}));
