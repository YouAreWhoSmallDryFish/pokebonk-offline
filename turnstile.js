/* 本地离线版：Cloudflare Turnstile 的最小替代实现。
   游戏客户端只会调用 render / remove；本地服务器不校验验证码。 */
(function () {
  var seq = 0;
  window.turnstile = {
    render: function (el, opts) {
      var id = 'local-' + (++seq);
      setTimeout(function () {
        try { opts && typeof opts.callback === 'function' && opts.callback('offline-local-token'); } catch (e) { console.warn('[turnstile]', e); }
      }, 30);
      return id;
    },
    remove: function () {},
    reset: function () {},
    getResponse: function () { return 'offline-local-token'; }
  };
})();
