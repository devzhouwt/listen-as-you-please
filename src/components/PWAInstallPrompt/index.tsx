import React, { useState, useEffect } from 'react';
import { Button, message } from 'antd';
import { DownloadOutlined, CloseOutlined } from '@ant-design/icons';
import './style.css';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const PWAInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // 检查应用是否已经安装
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // 监听 beforeinstallprompt 事件
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // 延迟显示安装提示,避免打扰用户
      setTimeout(() => {
        setShowInstallPrompt(true);
      }, 3000);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // 监听应用安装成功事件
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setShowInstallPrompt(false);
      message.success('应用安装成功!');
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      message.info('您的浏览器不支持安装应用');
      return;
    }

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        message.success('感谢安装!');
      } else {
        message.info('已取消安装');
      }
      
      setDeferredPrompt(null);
      setShowInstallPrompt(false);
    } catch (error) {
      console.error('安装失败:', error);
      message.error('安装失败,请稍后重试');
    }
  };

  const handleDismiss = () => {
    setShowInstallPrompt(false);
  };

  if (!showInstallPrompt || isInstalled) {
    return null;
  }

  return (
    <div className="pwa-install-prompt">
      <div className="pwa-install-content">
        <div className="pwa-install-header">
          <span className="pwa-icon">🎵</span>
          <h3>安装随心听</h3>
          <Button
            type="text"
            icon={<CloseOutlined />}
            onClick={handleDismiss}
            className="pwa-close-btn"
          />
        </div>
        <p className="pwa-install-desc">
          将随心听安装到桌面,享受更好的音乐体验
        </p>
        <div className="pwa-install-actions">
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleInstall}
            className="pwa-install-btn"
          >
            立即安装
          </Button>
          <Button onClick={handleDismiss} className="pwa-dismiss-btn">
            稍后再说
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PWAInstallPrompt;
