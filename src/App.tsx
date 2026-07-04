import React, { useEffect, useCallback } from 'react';
import { ConfigProvider, Layout, Button, Space, theme } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
import { HashRouter } from 'react-router-dom';
import RepoConfig from '@/components/RepoConfig';
import PlaylistList from '@/components/PlaylistList';
import PlayerBar from '@/components/PlayerBar';
import { useAppStore } from '@/store';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { getTotalSize } from '@/cache/audioCache';
import './App.css';

const { Header, Content } = Layout;

const AppContent: React.FC = () => {
  const repoConfig = useAppStore((s) => s.repoConfig);
  const clearRepoConfig = useAppStore((s) => s.clearRepoConfig);
  const setCacheSize = useAppStore((s) => s.setCacheSize);
  
  const { play, togglePlay, seek } = useAudioPlayer();

  // 初始化时加载缓存大小
  useEffect(() => {
    getTotalSize().then(setCacheSize).catch(() => {});
  }, []);

  const handleTogglePlay = useCallback(() => {
    togglePlay();
  }, [togglePlay]);

  const handleSeek = useCallback((time: number) => {
    seek(time);
  }, [seek]);

  const isConfigured = !!repoConfig;

  return (
    <Layout className="app-layout">
      {isConfigured && (
        <Header className="app-header">
          <div className="header-title">随心听</div>
          <Space>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={clearRepoConfig}
              className="header-logout-btn"
            >
              切换仓库
            </Button>
          </Space>
        </Header>
      )}
      <Content className={`app-content ${isConfigured ? 'with-player' : ''}`}>
        {isConfigured ? (
          <PlaylistList onPlay={play} />
        ) : (
          <RepoConfig />
        )}
      </Content>
      {isConfigured && (
        <PlayerBar onTogglePlay={handleTogglePlay} onSeek={handleSeek} />
      )}
    </Layout>
  );
};

const App: React.FC = () => {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
        },
      }}
    >
      <HashRouter>
        <AppContent />
      </HashRouter>
    </ConfigProvider>
  );
};

export default App;
