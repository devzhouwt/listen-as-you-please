import { useRef, useCallback, useEffect } from 'react';
import { message } from 'antd';
import { createApi, fetchFileBase64 } from '@/api/gitee';
import type { SongInfo } from '@/api/types';
import { getCacheKey, getCacheItem, setCacheItem } from '@/cache/audioCache';
import { useAppStore } from '@/store';

let workerInstance: Worker | null = null;

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
        await audio.play();
        store.setIsPlaying(true);
        store.setAudioLoading(false);
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
      await audio.play();
      store.setIsPlaying(true);
      store.setAudioLoading(false);
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

      if (state.isPlayAllActive && state.songs.length > 0) {
        const currentIdx = state.songs.findIndex(
          (s) => s.key === state.currentSong?.key
        );
        if (currentIdx >= 0) {
          const nextIdx = currentIdx + 1;
          if (nextIdx < state.songs.length) {
            // 播放下一首
            playRef.current?.(state.songs[nextIdx]);
            return;
          } else if (state.isLoopMode) {
            // 循环模式：回到第一首
            playRef.current?.(state.songs[0]);
            return;
          }
        }
        // 全部播放完毕，退出播放全部模式
        state.setPlayAllActive(false);
      }

      store.setIsPlaying(false);
    };

    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('ended', onEnded);
    };
  }, [store]);

  /** 暂停 */
  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      store.setIsPlaying(false);
    }
  }, [store]);

  /** 恢复播放 */
  const resume = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.src) {
      audio.play().then(() => {
        store.setIsPlaying(true);
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

  /** 播放全部 */
  const playAll = useCallback(() => {
    const state = useAppStore.getState();
    const songs = state.songs;
    if (songs.length === 0) return;
    state.setPlayAllActive(true);
    play(songs[0]);
  }, [play]);

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

  /** 播放下一首 */
  const playNext = useCallback(() => {
    const state = useAppStore.getState();
    const { songs, currentSong } = state;
    if (songs.length === 0 || !currentSong) return;
    const currentIdx = songs.findIndex((s) => s.key === currentSong.key);
    if (currentIdx < 0 || currentIdx >= songs.length - 1) return;
    const nextSong = songs[currentIdx + 1];
    play(nextSong);
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
