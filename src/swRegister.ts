import { registerSW } from 'virtual:pwa-register';

// 注册 Service Worker（autoUpdate 模式：自动检查并更新）
registerSW({
  onOfflineReady() {
    console.log('应用已可离线使用');
  },
  onRegistered(swRegistration) {
    if (swRegistration) {
      console.log('Service Worker 已注册，作用域：', swRegistration.scope);
    }
  },
  onRegisterError(error) {
    console.error('Service Worker 注册失败:', error);
  },
});

export {};
