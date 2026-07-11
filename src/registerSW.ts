import { registerSW } from 'virtual:pwa-register';

// 注册 Service Worker
const updateSW = registerSW({
  onNeedRefresh() {
    // 当有新的 Service Worker 更新时
    if (confirm('发现新版本,是否更新?')) {
      updateSW(true);
    }
  },
  onOfflineReady() {
    console.log('应用已可以离线使用');
  },
  onRegistered(swRegistration) {
    if (swRegistration) {
      console.log('Service Worker 已注册', swRegistration.scope);
    } else {
      console.log('Service Worker 未注册');
    }
  },
  onRegisterError(error) {
    console.error('Service Worker 注册失败:', error);
  },
});

export { };
