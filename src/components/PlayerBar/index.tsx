import React, { useEffect, useState } from 'react';
import { Button, Slider, Typography, Space, Tooltip, Spin } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  ClearOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { useAppStore } from '@/store';
import { getTotalSize, clearAllCache } from '@/cache/audioCache';
import { formatFileSize } from '@/api/gitee';
import './style.css';

const { Text } = Typography;

interface PlayerBarProps {
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

const PlayerBar: React.FC<PlayerBarProps> = ({ onTogglePlay, onSeek, onPrev, onNext }) => {
  const currentSong = useAppStore((s) => s.currentSong);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const isAudioLoading = useAppStore((s) => s.isAudioLoading);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [cacheSize, setCacheSize] = useState(0);
  const [clearing, setClearing] = useState(false);

  /** 获取全局 audio 元素 */
  function getAudio(): HTMLAudioElement | null {
    return document.getElementById('global-audio') as HTMLAudioElement | null;
  }

  // 绑定音频事件
  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;

    const onTimeUpdate = () => {
      // 确保 currentTime 不会超过 duration
      const currentTime = audio.currentTime;
      const duration = audio.duration || 0;
      setCurrentTime(isNaN(currentTime) ? 0 : Math.min(currentTime, duration));
    };
    
    const onDurationChange = () => {
      const duration = audio.duration || 0;
      setDuration(isNaN(duration) ? 0 : duration);
    };
    
    const onEnded = () => {
      const duration = audio.duration || 0;
      setCurrentTime(isNaN(duration) ? 0 : duration);
    };
    
    const onLoadedMetadata = () => {
      // 确保元数据加载后更新 duration
      const duration = audio.duration || 0;
      setDuration(isNaN(duration) ? 0 : duration);
    };

    // 先移除可能存在的旧监听器，避免重复绑定
    audio.removeEventListener('timeupdate', onTimeUpdate);
    audio.removeEventListener('durationchange', onDurationChange);
    audio.removeEventListener('ended', onEnded);
    audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    
    // 添加新监听器
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);

    // 初始化时设置一次当前值
    setCurrentTime(isNaN(audio.currentTime) ? 0 : audio.currentTime);
    setDuration(isNaN(audio.duration) ? 0 : (audio.duration || 0));

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [currentSong]); // 依赖 currentSong，确保在歌曲切换时重新绑定事件

  // 加载缓存大小
  useEffect(() => {
    loadCacheSize();
  }, [currentSong]);

  const loadCacheSize = async () => {
    try {
      const size = await getTotalSize();
      setCacheSize(size);
    } catch {
      // ignore
    }
  };

  const handleClearCache = async () => {
    setClearing(true);
    try {
      await clearAllCache();
      setCacheSize(0);
    } finally {
      setClearing(false);
    }
  };

  const formatTime = (seconds?: number): string => {
    if (!seconds || isNaN(seconds)) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const cachePercent = Math.min(100, (cacheSize / (500 * 1024 * 1024)) * 100);

  return (
    <div className="player-bar">
      {/* 进度条行：贯穿全宽 */}
      <div className="player-progress-row">
        <span className="player-time">{formatTime(currentTime)}</span>
        <Slider
          className="player-progress"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={onSeek}
          tooltip={{ formatter: formatTime }}
          disabled={!currentSong}
        />
        <span className="player-time">{formatTime(duration)}</span>
      </div>
      {/* 下方控制区 */}
      <div className="player-bar-inner">
        {/* 左侧：歌曲信息 */}
        <div className="player-song-info">
          {currentSong ? (
            <>
              <Text ellipsis className="player-song-name">
                {isAudioLoading && <LoadingOutlined className="player-loading-icon" />}
                {currentSong.name}
              </Text>
              <Text type="secondary" className="player-song-format">
                {isAudioLoading ? '加载中…' : currentSong.format.toUpperCase()}
              </Text>
            </>
          ) : (
            <Text type="secondary" className="player-song-name">未播放</Text>
          )}
        </div>

        {/* 中间：播放控制按钮 */}
        <div className="player-controls">
          <Button
            type="text"
            icon={<StepBackwardOutlined />}
            onClick={onPrev}
            disabled={!currentSong || isAudioLoading}
            className="player-skip-btn"
          />
          <Button
            type="text"
            icon={isAudioLoading ? <LoadingOutlined /> : (isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />)}
            onClick={onTogglePlay}
            disabled={!currentSong || isAudioLoading}
            className="player-play-btn"
          />
          <Button
            type="text"
            icon={<StepForwardOutlined />}
            onClick={onNext}
            disabled={!currentSong || isAudioLoading}
            className="player-skip-btn"
          />
        </div>

        {/* 右侧：缓存管理 */}
        <div className="player-extra">
          <Space size="small">
            <Tooltip title={`缓存: ${formatFileSize(cacheSize)} / 500MB`}>
              <span className="cache-indicator">
                <FolderOpenOutlined /> {formatFileSize(cacheSize)}
              </span>
            </Tooltip>
            <Tooltip title="清空缓存">
              <Button
                size="small"
                icon={<ClearOutlined />}
                onClick={handleClearCache}
                loading={clearing}
                type="text"
              />
            </Tooltip>
          </Space>
        </div>
      </div>
    </div>
  );
};

export default PlayerBar;
