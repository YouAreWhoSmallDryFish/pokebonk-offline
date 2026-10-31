// Service Worker 只在安全上下文可用：https 或 localhost/127.0.0.1
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
      const box = document.createElement('div');
      box.id = 'pb-precache';
      box.style.cssText = 'position:fixed;inset:auto 0 0 0;z-index:2147483646;padding:10px 16px;background:#1a1630;color:#fff;font:14px system-ui;text-align:center';
      box.textContent = '正在下载离线资源…';
      document.body.append(box);
      let done = false;
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'precache-progress') {
          const pct = Math.round((e.data.done / e.data.total) * 100);
          box.textContent = `正在下载离线资源 ${pct}%`;
          if (e.data.done >= e.data.total) {
            done = true;
            box.textContent = '离线资源已就绪，可添加到主屏幕';
            setTimeout(() => box.remove(), 5000);
          }
        }
      });
      const reg = await navigator.serviceWorker.ready;
      // 页面加载时 SW 已经激活并缓存完毕（二次进入），直接收尾
      if (!done && reg.active) {
        const keys = await caches.keys();
        if (keys.length) {
          box.textContent = '离线资源已就绪，可添加到主屏幕';
          setTimeout(() => box.remove(), 5000);
        }
      }
    } catch (err) {
      console.error('[pokebonk] SW 注册失败', err);
    }
  });
}
