import React, { useEffect, useState, useCallback } from 'react';
import { Card, Row, Col, Spin, Empty, Typography, Alert, Button } from 'antd';
import { FolderFilled, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { createApi, fetchContents, extractPlaylists } from '@/api/gitee';
import { useAppStore } from '@/store';
import type { SongInfo } from '@/api/types';
import './style.css';

const { Title, Text } = Typography;

interface PlaylistListProps {
  onPlay: (song: SongInfo) => void;
  onPlayAll: () => void;
}

const MIN_LOADING_MS = 600; // 加载动画最短显示时间

const PlaylistList: React.FC<PlaylistListProps> = () => {
  const navigate = useNavigate();
  const repoConfig = useAppStore((s) => s.repoConfig);
  const playlists = useAppStore((s) => s.playlists);
  const loading = useAppStore((s) => s.loading);
  const setPlaylists = useAppStore((s) => s.setPlaylists);
  const setLoading = useAppStore((s) => s.setLoading);
  const [error, setError] = useState<string | null>(null);

  const loadPlaylists = useCallback(async (signal?: AbortSignal) => {
    if (!repoConfig) return;
    setLoading(true);
    setError(null);
    const startTime = Date.now();
    try {
      const api = createApi(repoConfig.token);
      const items = await fetchContents(api, repoConfig.owner, repoConfig.repo, '歌单', signal);
      const dirs = extractPlaylists(items);
      setPlaylists(dirs);
    } catch (err: any) {
      if (err?.name === 'CanceledError' || err?.name === 'AbortError') return;
      console.error('加载歌单失败:', err);
      const msg = err?.response?.data?.message || err?.message || '网络请求失败';
      setError(`加载歌单失败: ${msg}`);
    } finally {
      // 保证加载动画至少显示 MIN_LOADING_MS 毫秒
      const elapsed = Date.now() - startTime;
      if (elapsed < MIN_LOADING_MS) {
        await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed));
      }
      setLoading(false);
    }
  }, [repoConfig, setPlaylists, setLoading]);

  useEffect(() => {
    if (!repoConfig) return;
    const controller = new AbortController();
    loadPlaylists(controller.signal);
    return () => controller.abort();
  }, [loadPlaylists]);

  const enterPlaylist = (playlist: { name: string; path: string }) => {
    navigate(`/playlist/${encodeURIComponent(playlist.name)}`);
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
        <Title level={4} style={{ marginBottom: 24 }}>我的歌单</Title>
        <Alert
          message={error}
          type="error"
          showIcon
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => loadPlaylists()}>
              重试
            </Button>
          }
        />
      </div>
    );
  }

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
