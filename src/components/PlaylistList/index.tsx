import React, { useEffect } from 'react';
import { Card, Row, Col, Spin, Empty, Typography } from 'antd';
import { FolderFilled } from '@ant-design/icons';
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

const PlaylistList: React.FC<PlaylistListProps> = () => {
  const navigate = useNavigate();
  const repoConfig = useAppStore((s) => s.repoConfig);
  const playlists = useAppStore((s) => s.playlists);
  const loading = useAppStore((s) => s.loading);
  const setPlaylists = useAppStore((s) => s.setPlaylists);
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
    } catch (err: any) {
      console.error('加载歌单失败:', err);
    } finally {
      setLoading(false);
    }
  };

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
