import React, { useEffect, useCallback } from 'react';
import { ConfigProvider, Layout, Button, Space, theme } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
import { HashRouter } from 'react-router-dom';
import RepoConfig from '@/components/RepoConfig';
import PlaylistList from '@/components/PlaylistList';
import PlayerBar from '@/components/PlayerBar';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import { useAppStore } from '@/store';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { getTotalSize } from '@/cache/audioCache';
import './App.css';

const { Header, Content } = Layout;

const AppContent: React.FC = () => {
  const repoConfig = useAppStore((s) => s.repoConfig);
  const showConfig = useAppStore((s) => s.showConfig);
  const openConfig = useAppStore((s) => s.openConfig);
  const setCurrentPlaylist = useAppStore((s) => s.setCurrentPlaylist);
  const setSongs = useAppStore((s) => s.setSongs);
  const setCacheSize = useAppStore((s) => s.setCacheSize);
  
  const { play, pause, resume, playAll, playPrev, playNext, togglePlay, seek } = useAudioPlayer();

  // 初始化时加载缓存大小
  useEffect(() => {
    getTotalSize().then(setCacheSize).catch(() => {});
  }, []);

  // 空格键控制播放/暂停
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        // 避免在输入框中触发
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();

        const state = useAppStore.getState();
        if (!state.currentSong) return;               // 未选择歌曲 → 忽略
        if (state.isAudioLoading) return;              // 正在加载中 → 忽略
        if (state.isPlaying) {
          pause();                                     // 播放中 → 暂停
        } else {
          resume();                                    // 暂停中 → 恢复
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pause, resume]);

  const handleTogglePlay = useCallback(() => {
    togglePlay();
  }, [togglePlay]);

  const handleSeek = useCallback((time: number) => {
    seek(time);
  }, [seek]);

  const isConfigured = !!repoConfig;
  const isPlaylistView = isConfigured && !showConfig;

  return (
    <Layout className="app-layout">
      {isPlaylistView && (
        <Header className="app-header">
          <div className="header-title" onClick={() => { setCurrentPlaylist(null); setSongs([]); }} style={{ cursor: 'pointer' }}>随心听</div>
          <Space>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={openConfig}
              className="header-logout-btn"
            >
              切换仓库
            </Button>
          </Space>
        </Header>
      )}
      <Content className={`app-content ${isPlaylistView ? 'with-player' : ''}`}>
        {showConfig ? (
          <RepoConfig />
        ) : (
          <PlaylistList onPlay={play} onPlayAll={playAll} />
        )}
      </Content>
      {isPlaylistView && (
        <PlayerBar
          onTogglePlay={handleTogglePlay}
          onSeek={handleSeek}
          onPrev={playPrev}
          onNext={playNext}
        />
      )}
      <PWAInstallPrompt />
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
