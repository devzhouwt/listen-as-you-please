import React, { useEffect } from 'react';
import { Card, Row, Col, Spin, Empty, Typography, Button, Space, Tooltip } from 'antd';
import { FolderFilled, ArrowLeftOutlined, LoadingOutlined, SyncOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { createApi, fetchContents, extractPlaylists, extractSongs, formatFileSize } from '@/api/gitee';
import { useAppStore } from '@/store';
import type { SongInfo } from '@/api/types';
import './style.css';

const { Title, Text } = Typography;

interface PlaylistListProps {
  onPlay: (song: SongInfo) => void;
  onPlayAll: () => void;
}

const PlaylistList: React.FC<PlaylistListProps> = ({ onPlay, onPlayAll }) => {
  const repoConfig = useAppStore((s) => s.repoConfig);
  const playlists = useAppStore((s) => s.playlists);
  const currentPlaylist = useAppStore((s) => s.currentPlaylist);
  const songs = useAppStore((s) => s.songs);
  const loading = useAppStore((s) => s.loading);
  const currentSong = useAppStore((s) => s.currentSong);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const isAudioLoading = useAppStore((s) => s.isAudioLoading);
  const isPlayAllActive = useAppStore((s) => s.isPlayAllActive);
  const isLoopMode = useAppStore((s) => s.isLoopMode);
  const setPlayAllActive = useAppStore((s) => s.setPlayAllActive);
  const setLoopMode = useAppStore((s) => s.setLoopMode);
  const setPlaylists = useAppStore((s) => s.setPlaylists);
  const setSongs = useAppStore((s) => s.setSongs);
  const setCurrentPlaylist = useAppStore((s) => s.setCurrentPlaylist);
  const setLoading = useAppStore((s) => s.setLoading);

  useEffect(() => {
    if (!repoConfig) return;
    loadPlaylists();
  }, [repoConfig]);

  const loadPlaylists = async () => {
    if (!repoConfig) return;
    setLoading(true);
    try {
      const api = createApi(repoConfig.token);
      const items = await fetchContents(api, repoConfig.owner, repoConfig.repo, '歌单');
      const dirs = extractPlaylists(items);
      setPlaylists(dirs);
      setCurrentPlaylist(null);
    } catch (err: any) {
      console.error('加载歌单失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const enterPlaylist = async (playlist: { name: string; path: string }) => {
    if (!repoConfig) return;
    setLoading(true);
    setCurrentPlaylist(playlist);
    try {
      const api = createApi(repoConfig.token);
      const items = await fetchContents(api, repoConfig.owner, repoConfig.repo, playlist.path);
      const audioFiles = extractSongs(items);
      setSongs(audioFiles);
    } catch (err: any) {
      console.error('加载歌曲列表失败:', err);
      setCurrentPlaylist(null);
    } finally {
      setLoading(false);
    }
  };

  const backToPlaylists = () => {
    setCurrentPlaylist(null);
    setSongs([]);
  };

  if (loading) {
    return (
      <div className="loading-container">
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  // 歌曲列表视图
  if (currentPlaylist) {
    if (songs.length === 0) {
      return (
        <div className="playlist-view">
          <div className="playlist-header">
            <span className="back-btn" onClick={backToPlaylists}>
              <ArrowLeftOutlined /> 返回歌单
            </span>
            <Title level={4} style={{ margin: '16px 0 0' }}>{currentPlaylist.name}</Title>
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
              <Title level={4} style={{ margin: '8px 0 0' }}>{currentPlaylist.name}</Title>
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
                  setPlayAllActive(false);
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
  }

  // 歌单列表视图
  if (playlists.length === 0) {
    return (
      <div className="playlist-view">
        <Title level={4} style={{ marginBottom: 24 }}>我的歌单</Title>
        <Empty description="请在仓库根目录下创建「歌单」文件夹，歌单文件夹内再放音频文件" />
      </div>
    );
  }

  return (
    <div className="playlist-view">
      <Title level={4} style={{ marginBottom: 24 }}>我的歌单</Title>
      <Row gutter={[16, 16]}>
        {playlists.map((pl) => (
          <Col xs={12} sm={8} md={6} lg={4} key={pl.path}>
            <Card
              hoverable
              className="playlist-card"
              onClick={() => enterPlaylist(pl)}
            >
              <div className="playlist-card-content">
                <FolderFilled className="playlist-folder-icon" />
                <Text ellipsis className="playlist-name">{pl.name}</Text>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default PlaylistList;
