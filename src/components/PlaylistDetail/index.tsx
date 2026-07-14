import React, { useEffect, useState, useCallback } from 'react';
import { Spin, Empty, Typography, Button, Space, Tooltip, Alert } from 'antd';
import { ArrowLeftOutlined, LoadingOutlined, SyncOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { createApi, fetchContents, extractSongs, formatFileSize } from '@/api/gitee';
import { useAppStore } from '@/store';
import type { SongInfo } from '@/api/types';
import './style.css';

const { Title, Text } = Typography;

const MIN_LOADING_MS = 600; // 加载动画最短显示时间

interface PlaylistDetailProps {
  onPlay: (song: SongInfo) => void;
  onPlayAll: () => void;
}

const PlaylistDetail: React.FC<PlaylistDetailProps> = ({ onPlay, onPlayAll }) => {
  const navigate = useNavigate();
  const { name } = useParams<{ name: string }>();
  const decodedName = name ? decodeURIComponent(name) : '';

  const repoConfig = useAppStore((s) => s.repoConfig);
  const songs = useAppStore((s) => s.songs);
  const loading = useAppStore((s) => s.loading);
  const currentSong = useAppStore((s) => s.currentSong);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const isAudioLoading = useAppStore((s) => s.isAudioLoading);
  const isPlayAllActive = useAppStore((s) => s.isPlayAllActive);
  const isLoopMode = useAppStore((s) => s.isLoopMode);
  const setLoopMode = useAppStore((s) => s.setLoopMode);
  const setSongs = useAppStore((s) => s.setSongs);
  const setCurrentPlaylist = useAppStore((s) => s.setCurrentPlaylist);
  const setLoading = useAppStore((s) => s.setLoading);
  const [error, setError] = useState<string | null>(null);

  const loadSongs = useCallback(async (signal?: AbortSignal) => {
    if (!repoConfig) return;
    setLoading(true);
    setError(null);
    setCurrentPlaylist({ name: decodedName, path: `歌单/${decodedName}` });
    const startTime = Date.now();
    try {
      const api = createApi(repoConfig.token);
      const items = await fetchContents(api, repoConfig.owner, repoConfig.repo, `歌单/${decodedName}`, signal);
      const audioFiles = extractSongs(items);
      setSongs(audioFiles);
    } catch (err: any) {
      if (err?.name === 'CanceledError' || err?.name === 'AbortError') return;
      console.error('加载歌曲列表失败:', err);
      const msg = err?.response?.data?.message || err?.message || '网络请求失败';
      setError(`加载歌曲失败: ${msg}`);
      setCurrentPlaylist(null);
    } finally {
      const elapsed = Date.now() - startTime;
      if (elapsed < MIN_LOADING_MS) {
        await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed));
      }
      setLoading(false);
    }
  }, [repoConfig, decodedName, setSongs, setCurrentPlaylist, setLoading]);

  useEffect(() => {
    if (!repoConfig || !decodedName) return;
    const controller = new AbortController();
    loadSongs(controller.signal);
    return () => controller.abort();
  }, [loadSongs]);

  const backToPlaylists = () => {
    navigate('/');
  };

  if (loading) {
    return (
      <div className="loading-container">
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="playlist-view">
        <div className="playlist-header">
          <span className="back-btn" onClick={backToPlaylists}>
            <ArrowLeftOutlined /> 返回歌单
          </span>
          <Title level={4} style={{ margin: '16px 0 0' }}>{decodedName}</Title>
        </div>
        <Alert
          message={error}
          type="error"
          showIcon
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => loadSongs()}>
              重试
            </Button>
          }
        />
      </div>
    );
  }

  if (songs.length === 0) {
    return (
      <div className="playlist-view">
        <div className="playlist-header">
          <span className="back-btn" onClick={backToPlaylists}>
            <ArrowLeftOutlined /> 返回歌单
          </span>
          <Title level={4} style={{ margin: '16px 0 0' }}>{decodedName}</Title>
          <Text type="secondary">该歌单中没有找到音频文件</Text>
        </div>
        <Empty description="暂无歌曲" />
      </div>
    );
  }

  return (
    <div className="playlist-view">
      <div className="playlist-header">
        <span className="back-btn" onClick={backToPlaylists}>
          <ArrowLeftOutlined /> 返回歌单
        </span>
        <div className="playlist-header-row">
          <div className="playlist-header-left">
            <Title level={4} style={{ margin: '8px 0 0' }}>{decodedName}</Title>
            <Text type="secondary" className="playlist-song-count">共 {songs.length} 首歌曲</Text>
          </div>
          <Space size="small">
            <Button
              type={isPlayAllActive ? 'primary' : 'default'}
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={onPlayAll}
              className="play-all-btn"
            >
              {isPlayAllActive ? '播放中…' : '播放全部'}
            </Button>
            <Tooltip title={isLoopMode ? '循环模式已开启' : '循环模式已关闭'}>
              <Button
                type={isLoopMode ? 'primary' : 'default'}
                size="small"
                icon={<SyncOutlined />}
                onClick={() => setLoopMode(!isLoopMode)}
                className="loop-toggle-btn"
              />
            </Tooltip>
          </Space>
        </div>
      </div>
      <div className="song-grid">
        {songs.map((song) => {
          const isThisPlaying = currentSong?.key === song.key;
          const showPause = isThisPlaying && isPlaying;
          const showLoading = isThisPlaying && isAudioLoading;
          return (
            <div
              key={song.key}
              className={`song-item ${isThisPlaying ? 'song-item-active' : ''}`}
              onClick={() => {
                onPlay(song);
              }}
            >
              <div className="song-item-info">
                <span className="song-item-name">
                  {showLoading && <LoadingOutlined className="song-loading-icon" />}
                  {song.name}
                </span>
                <span className="song-item-meta">
                  <span className="song-format-tag">{song.format.toUpperCase()}</span>
                  {song.size > 0 && <span className="song-size">{formatFileSize(song.size)}</span>}
                </span>
              </div>
              <div className="song-item-action">
                {showLoading ? <LoadingOutlined /> : (showPause ? '⏸' : '▶')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PlaylistDetail;
