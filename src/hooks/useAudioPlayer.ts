import { useRef, useCallback, useEffect } from 'react';
import { message } from 'antd';
import { createApi, fetchFileBase64 } from '@/api/gitee';
import type { SongInfo } from '@/api/types';
import { getCacheKey, getCacheItem, setCacheItem } from '@/cache/audioCache';
import { useAppStore } from '@/store';

let workerInstance: Worker | null = null;
let audioContext: AudioContext | null = null;

/** 获取 AudioContext 单例（用于后台播放保活） */
function getAudioContext(): AudioContext | null {
  try {
    if (!audioContext) {
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext);
      if (Ctor) audioContext = new Ctor();
    }
    return audioContext;
  } catch {
    return null;
  }
}

/** 确保 AudioContext 处于运行状态 */
function resumeAudioContext() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

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
  // 预加载状态：存储下一首的歌曲信息和已准备好的 Blob URL
  const preloadedRef = useRef<{ song: SongInfo; blobUrl: string } | null>(null);

  /** 滚动式预加载：在当前歌曲播放时，提前准备下一首的音频数据 */
  const preloadNextSong = useCallback(async (currentSong: SongInfo) => {
    const state = useAppStore.getState();
    let nextSong: SongInfo | null = null;

    if (state.isPlayAllActive && state.songs.length > 0) {
      const currentIdx = state.songs.findIndex((s) => s.key === currentSong.key);
      if (currentIdx >= 0) {
        const nextIdx = currentIdx + 1;
        if (nextIdx < state.songs.length) {
          nextSong = state.songs[nextIdx];
        } else if (state.isLoopMode) {
          nextSong = state.songs[0];
        }
      }
    }

    if (!nextSong) return;

    try {
      const cacheKey = getCacheKey(nextSong.key);
      const cached = await getCacheItem(cacheKey);
      if (cached) {
        const blobUrl = URL.createObjectURL(cached.blob);
        preloadedRef.current = { song: nextSong, blobUrl };
      }
    } catch {
      // 预加载失败不影响正常播放
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
        resumeAudioContext();
        const url = URL.createObjectURL(cached.blob);
        audio.src = url;
        // 确保在播放前重置 currentTime
        audio.currentTime = 0;
        await audio.play();
        store.setIsPlaying(true);
        store.setAudioLoading(false);
        updateMediaSession(song, true);
        // 触发滚动式预加载
        preloadNextSong(song);
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
      resumeAudioContext();
      const url = URL.createObjectURL(blob);
      audio.src = url;
      // 确保在播放前重置 currentTime
      audio.currentTime = 0;
      await audio.play();
      store.setIsPlaying(true);
      store.setAudioLoading(false);
      updateMediaSession(song, true);
      // 触发滚动式预加载
      preloadNextSong(song);
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

      // 优先使用预加载数据切歌（避免后台异步 I/O 被系统节流）
      const preloaded = preloadedRef.current;
      preloadedRef.current = null;

      if (preloaded && state.isPlayAllActive) {
        // 清理上一首的 blob URL
        if (audio.src.startsWith('blob:')) {
          URL.revokeObjectURL(audio.src);
        }
        store.setCurrentSong(preloaded.song);
        audio.src = preloaded.blobUrl;
        audio.currentTime = 0;
        resumeAudioContext();
        audio.play().then(() => {
          store.setIsPlaying(true);
          updateMediaSession(preloaded.song, true);
          // 继续滚动预加载下一首
          preloadNextSong(preloaded.song);
        }).catch(() => {
          // 播放失败时回退到正常加载
          playRef.current?.(preloaded.song);
        });
        return;
      }

      // 单曲循环：播放全部未开启时，循环播放当前歌曲
      if (state.isLoopMode && !state.isPlayAllActive) {
        if (state.currentSong) {
          const audio = audioRef.current;
          if (audio) {
            resumeAudioContext();
            audio.currentTime = 0;
            audio.play().then(() => {
              state.setIsPlaying(true);
              updateMediaSession(state.currentSong, true);
            }).catch(() => {});
          }
        }
        return;
      }

      // 播放全部模式（预加载未命中时的回退路径）
      if (state.isPlayAllActive && state.songs.length > 0) {
        const currentIdx = state.songs.findIndex(
          (s) => s.key === state.currentSong?.key
        );
        if (currentIdx >= 0) {
          const nextIdx = currentIdx + 1;
          if (nextIdx < state.songs.length) {
            playRef.current?.(state.songs[nextIdx]);
            return;
          } else if (state.isLoopMode) {
            playRef.current?.(state.songs[0]);
            return;
          }
        }
        state.setPlayAllActive(false);
      }

      store.setIsPlaying(false);
    };

    const onTimeUpdate = () => {
      // 定期更新 Media Session 进度位置
      if (audio.currentTime > 0 && !isNaN(audio.currentTime)) {
        updateMediaSessionPosition(audio);
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

    // 初始化 AudioContext 并连接音频元素（后台播放保活）
    const ctx = getAudioContext();
    if (ctx) {
      try {
        const source = ctx.createMediaElementSource(audio);
        source.connect(ctx.destination);
      } catch {
        // 部分浏览器可能不支持或已连接
      }
    }

    // 页面重新可见时恢复 AudioContext（移动端浏览器会在后台挂起它）
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const state = useAppStore.getState();
        if (state.isPlaying) {
          resumeAudioContext();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

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
        const { songs, currentSong } = state;
        if (songs.length === 0 || !currentSong) return;
        const currentIdx = songs.findIndex((s) => s.key === currentSong.key);
        if (currentIdx >= 0 && currentIdx < songs.length - 1) {
          playRef.current?.(songs[currentIdx + 1]);
        }
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
      document.removeEventListener('visibilitychange', onVisibilityChange);

      // 清理预加载资源
      if (preloadedRef.current) {
        URL.revokeObjectURL(preloadedRef.current.blobUrl);
        preloadedRef.current = null;
      }

      // 关闭 AudioContext
      if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
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
  }, [store]);

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
