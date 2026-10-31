import { createApi } from './api-handler.js';
import { loadPokemon } from './local-core.js';
import { createCapacitorStorage, createIdbStorage, normalizeState } from './storage.js';

const VERSION = { build: 'mvv70wso', version: '0.8.83' };

function hex(n) {
  let out = '';
  for (let i = 0; i < n; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

function parseBody(init) {
  if (!init || init.body == null) return null;
  if (typeof init.body === 'string') {
    try { return JSON.parse(init.body); } catch { return null; }
  }
  return null;
}

function headersToObject(headers) {
  if (!headers) return {};
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const out = {};
    headers.forEach((v, k) => { out[k.toLowerCase()] = v; });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([k, v]) => [String(k).toLowerCase(), v]));
  }
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

/**
 * 同步替换 win.fetch，异步完成初始化。
 * 游戏入口可能在初始化完成前就发请求，所以每个 /api 请求都先 await ready。
 * baseUrl 必须是「页面完整 URL」（含 GitHub Pages 子路径），不能用 location.origin。
 */
export function installBridge({ win, storage, baseUrl }) {
  const base = baseUrl || win.location?.href || 'https://localhost/';
  const originalFetch = win.fetch.bind(win);
  let state = null;
  let api = null;

  const ready = (async () => {
    state = normalizeState(await storage.load());
    const rows = await originalFetch(new URL('data/pokemon.json', base))
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    if (Array.isArray(rows) && rows.length) loadPokemon(rows);
    api = createApi({
      state,
      save: () => { void storage.save(state); },
      randomHex: hex,
    });
  })();

  win.fetch = async function bridgedFetch(input, init = {}) {
    const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    const url = new URL(raw, base);
    const path = url.pathname;

    if (path.endsWith('/version.json')) {
      return new Response(JSON.stringify(VERSION), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // 游戏把 API 基址写成绝对路径 /api，因此子路径部署下 pathname 仍是 /api/...
    if (!(path === '/api' || path.startsWith('/api/'))) return originalFetch(input, init);

    await ready;

    const headers = headersToObject(init.headers || (input instanceof Request ? input.headers : undefined));
    const auth = headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const device = headers['x-device'] || '';

    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const result = api.handle({
      method: (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase(),
      path,
      query: url.searchParams,
      body: parseBody(init),
      token,
      device,
    });

    return new Response(result.body == null ? null : JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  win.__POKEBONK_MOBILE__ = { version: VERSION, storage, ready };
  return ready;
}

// 浏览器/Capacitor 自动启动：仅在以 <script type="module"> 直接引入时执行
if (typeof window !== 'undefined' && !window.__POKEBONK_MOBILE__) {
  // Capacitor 插件的正确访问方式是 window.Capacitor.Plugins，不是 npm import
  const nativeFilesystem = window.Capacitor?.Plugins?.Filesystem;
  const storage = nativeFilesystem
    ? createCapacitorStorage(nativeFilesystem)
    : createIdbStorage();
  installBridge({ win: window, storage, baseUrl: window.location.href })
    .catch((err) => console.error('[pokebonk] bridge 启动失败', err));
}
