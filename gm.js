/* PokéBonk 离线版 GM 工具（游戏内浮动面板）
 *
 * 依赖主包补丁暴露的：
 *   window.__pbRun          当前对局对象（含 player / tempMods / gold / rerolls…）
 *   window.__PB_GM          内部函数 { upgradeMove, makeMove, vitamins, tiers… }
 *
 * 快捷键：F8 打开/关闭；Esc 关闭。
 */
(() => {
  'use strict';

  if (window.__pbGMInstalled) return;
  window.__pbGMInstalled = true;

  const STORE_KEY = 'pb.gm.settings.v1';
  const PANEL_ID = 'pb-gm-panel';

  // ---------------------------------------------------------------- 工具

  const q = (sel, root = document) => root.querySelector(sel);

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function fmt(value, digits = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    if (digits) return n.toFixed(digits);
    if (Math.abs(n) >= 10000) return Math.round(n).toLocaleString('zh-CN');
    return String(Math.round(n * 100) / 100);
  }

  function clock(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function loadSettings() {
    const out = { stats: {}, god: false, noStandoff: false };
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        if (raw.stats && typeof raw.stats === 'object') {
          for (const [key, value] of Object.entries(raw.stats)) {
            const n = Number(value);
            if (Number.isFinite(n) && n > 0) out.stats[key] = n;
          }
        }
        out.god = !!raw.god;
        out.noStandoff = !!raw.noStandoff;
      }
    } catch { /* 忽略损坏的设置 */ }
    return out;
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    } catch { /* 忽略存储失败 */ }
  }

  const settings = loadSettings();

  const data = {
    loaded: false,
    loading: null,
    moves: [],
    movesById: new Map(),
    items: {},
    pokemonById: new Map(),
    zh: { moves: {}, items: {}, pokemon: {}, types: {} },
    validMoves: null,
  };

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.json();
  }

  function ensureData() {
    if (data.loaded) return Promise.resolve();
    if (data.loading) return data.loading;
    data.loading = (async () => {
      const [moves, items, zh, pokemon] = await Promise.all([
        fetchJson('/data/moves.json'),
        fetchJson('/data/items.json'),
        fetchJson('/data/i18n/zh.json').catch(() => null),
        fetchJson('/data/pokemon.json'),
      ]);
      data.moves = Array.isArray(moves) ? moves : [];
      for (const move of data.moves) data.movesById.set(move.id, move);
      data.items = items && typeof items === 'object' ? items : {};
      if (zh && typeof zh === 'object') {
        data.zh = {
          moves: zh.moves || {},
          items: zh.items || {},
          pokemon: zh.pokemon || {},
          types: zh.types || {},
        };
      }
      const list = Array.isArray(pokemon) ? pokemon : [];
      for (const mon of list) data.pokemonById.set(mon.id, mon);
      data.loaded = true;
      renderMoveResults();
      renderItemResults();
      renderVitaminList();
      document.dispatchEvent(new CustomEvent('pb-gm-data'));
    })().catch((err) => {
      data.loading = null;
      throw err;
    });
    return data.loading;
  }

  function moveName(id) {
    return data.zh.moves[String(id)] || data.movesById.get(id)?.name || `招式 #${id}`;
  }

  function itemName(key) {
    return data.zh.items[key]?.name || data.items[key]?.name || key;
  }

  function itemDesc(key) {
    return data.zh.items[key]?.desc || data.items[key]?.desc || '';
  }

  function pokeName(id) {
    return data.zh.pokemon[String(id)] || data.pokemonById.get(id)?.name || `#${id}`;
  }

  function typeName(type) {
    return data.zh.types[type] || type || '?';
  }

  // ---------------------------------------------------------------- 面板 DOM

  const root = document.createElement('div');
  root.id = 'pb-gm-root';
  root.innerHTML = `
    <button id="pb-gm-fab" title="GM 工具（F8）">GM</button>
    <section id="${PANEL_ID}" hidden>
      <div class="pb-gm-head">
        <b>PokéBonk GM</b>
        <span class="pb-gm-state" id="gm-run-state">等待对局…</span>
        <button class="pb-gm-x" id="gm-close" title="关闭（Esc）">×</button>
      </div>
      <nav class="pb-gm-tabs">
        <button data-tab="status" class="on">状态</button>
        <button data-tab="stats">属性</button>
        <button data-tab="moves">技能</button>
        <button data-tab="items">道具</button>
        <button data-tab="profile">档案</button>
      </nav>
      <div class="pb-gm-body">

        <div class="pb-gm-pane" data-pane="status">
          <div class="pb-gm-sec">
            <h4>当前对局</h4>
            <div class="pb-gm-grid">
              <span>宝可梦</span><b id="gm-species">—</b>
              <span>等级 / 经验</span><b id="gm-level">—</b>
              <span>生命</span><b id="gm-hp">—</b>
              <span>护盾 / 过载</span><b id="gm-shield">—</b>
              <span>金币</span><b id="gm-gold">—</b>
              <span>阶段 / 地图</span><b id="gm-stage">—</b>
              <span>击杀 / 时间</span><b id="gm-kills">—</b>
              <span>重掷 / 跳过 / 禁用</span><b id="gm-picks">—</b>
              <span>待选升级</span><b id="gm-pending">—</b>
            </div>
          </div>

          <div class="pb-gm-sec">
            <h4>生命与无敌</h4>
            <div class="pb-gm-row">
              <input type="number" id="gm-hp-input" min="1" step="1" placeholder="生命值">
              <button class="pb-gm-btn" id="gm-hp-set">设置</button>
              <button class="pb-gm-btn primary" id="gm-heal">回满血</button>
            </div>
            <label class="pb-gm-row" style="cursor:pointer">
              <input type="checkbox" id="gm-god">
              无敌（免疫一切伤害，含陷阱/碰撞）
            </label>
            <p class="pb-gm-hint">无敌通过替换当前宝可梦的受伤函数实现；换关、进化后会自动重新套用。</p>
          </div>

          <div class="pb-gm-sec">
            <h4>等级与金币</h4>
            <div class="pb-gm-row">
              <input type="number" id="gm-level-input" min="1" max="999" step="1" placeholder="等级">
              <button class="pb-gm-btn" id="gm-level-set">设为等级</button>
            </div>
            <div class="pb-gm-row">
              <input type="number" id="gm-xp-input" min="1" step="100" placeholder="经验值">
              <button class="pb-gm-btn blue" id="gm-xp-add">获得经验</button>
            </div>
            <p class="pb-gm-hint">获得经验会照常弹出升级选卡；“设为等级”直接改等级、不弹卡。达到 24 / 44 级后，下一次自然升级会触发进化。</p>
            <div class="pb-gm-row">
              <input type="number" id="gm-gold-input" min="0" step="100" placeholder="金币">
              <button class="pb-gm-btn" id="gm-gold-set">设为</button>
              <button class="pb-gm-btn primary" id="gm-gold-add">增加</button>
            </div>
          </div>

          <div class="pb-gm-sec">
            <h4>选卡资源</h4>
            <div class="pb-gm-row">
              <button class="pb-gm-btn" id="gm-picks-max">重掷/跳过/禁用 = 99</button>
              <button class="pb-gm-btn danger" id="gm-clear-bans">清除已禁用</button>
            </div>
            <div class="pb-gm-row">
              <button class="pb-gm-btn danger" id="gm-nuke">清屏（Electrode 爆炸）</button>
            </div>
          </div>

          <div class="pb-gm-sec">
            <h4>运行环境</h4>
            <div class="pb-gm-grid">
              <span>GM 补丁</span><b id="gm-patch">—</b>
              <span>显卡渲染</span><b id="gm-renderer" style="font-weight:500;font-size:11px;word-break:break-all;text-align:right">—</b>
            </div>
            <div class="pb-gm-row">
              <button class="pb-gm-btn" id="gm-hard-refresh">强制刷新页面</button>
            </div>
            <div class="pb-gm-row">
              <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer">
                <input type="checkbox" id="gm-no-standoff" />
                敌人贴身模式（远程怪不再保持距离）
              </label>
            </div>
            <p class="pb-gm-hint" id="gm-render-hint">若“GM 补丁”显示未加载，或游戏一卡一卡，点“强制刷新页面”。</p>
            <p class="pb-gm-hint">原版里特攻型（远程）敌人会刻意保持在 8–13 格距离并左右横移；勾选上面的选项可让它们像近战怪一样贴上来。</p>
          </div>
        </div>

        <div class="pb-gm-pane" data-pane="stats" hidden>
          <div class="pb-gm-sec">
            <h4>属性倍率</h4>
            <div id="gm-stat-list"></div>
            <div class="pb-gm-row" style="margin-top:10px">
              <button class="pb-gm-btn primary" id="gm-stats-apply">应用属性</button>
              <button class="pb-gm-btn" id="gm-stats-reset">全部重置为 1</button>
            </div>
            <p class="pb-gm-hint">
              倍率直接写入 <code>run.tempMods</code> 并重算属性；换关、升级、进化后仍然有效。
              暴击率最高 100%，闪避最高 60%，其它属性没有额外上限。<br>
              设置会保存在浏览器里，新开一局时自动套用。
            </p>
          </div>
        </div>

        <div class="pb-gm-pane" data-pane="moves" hidden>
          <div class="pb-gm-sec">
            <h4>技能栏</h4>
            <div id="gm-slots"></div>
            <div class="pb-gm-row">
              <button class="pb-gm-btn blue" id="gm-moves-all">四个技能各 +5 级</button>
            </div>
          </div>
          <div class="pb-gm-sec">
            <h4>学习新技能</h4>
            <div class="pb-gm-row">
              <input type="search" id="gm-move-search" placeholder="搜索招式名 / 属性 / 编号">
            </div>
            <div class="pb-gm-list" id="gm-move-results"><div class="pb-gm-empty">正在加载招式数据…</div></div>
            <p class="pb-gm-hint">学习会放进第一个空技能格；技能栏满了就先“遗忘”一个。</p>
          </div>
        </div>

        <div class="pb-gm-pane" data-pane="items" hidden>
          <div class="pb-gm-sec">
            <h4>维生素</h4>
            <div class="pb-gm-row">
              <select id="gm-rarity">
                <option value="4">传说品质</option>
                <option value="3">史诗品质</option>
                <option value="2" selected>稀有品质</option>
                <option value="1">罕见品质</option>
                <option value="0">普通品质</option>
              </select>
              <span class="pb-gm-hint" style="margin:0">每次 +1 级，可超过 10 级</span>
            </div>
            <div class="pb-gm-list" id="gm-vit-list"><div class="pb-gm-empty">正在加载…</div></div>
            <h4 style="margin-top:12px">已拥有的维生素</h4>
            <div class="pb-gm-list" id="gm-vit-owned"><div class="pb-gm-empty">—</div></div>
          </div>
          <div class="pb-gm-sec">
            <h4>道具</h4>
            <div class="pb-gm-row">
              <input type="search" id="gm-item-search" placeholder="搜索道具名 / 编号">
            </div>
            <div class="pb-gm-list" id="gm-item-results"><div class="pb-gm-empty">正在加载…</div></div>
            <h4 style="margin-top:12px">背包</h4>
            <div class="pb-gm-list" id="gm-item-owned"><div class="pb-gm-empty">—</div></div>
          </div>
        </div>

        <div class="pb-gm-pane" data-pane="profile" hidden>
          <div class="pb-gm-sec">
            <h4>账号档案（服务器存档）</h4>
            <div class="pb-gm-grid">
              <span>训练家</span><b id="gm-acct-name">—</b>
              <span>类型</span><b id="gm-acct-kind">—</b>
              <span>档案版本</span><b id="gm-acct-ver">—</b>
            </div>
            <p class="pb-gm-hint">这些数值保存在 <code>saves/state.json</code>，改完刷新页面生效。</p>
            <div class="pb-gm-row">
              <label class="pb-gm-hint" style="margin:0">星星沙子</label>
              <input type="number" id="gm-dust" min="0" step="1000">
            </div>
            <div class="pb-gm-row">
              <label class="pb-gm-hint" style="margin:0">邦币</label>
              <input type="number" id="gm-bonk" min="0" step="1000">
            </div>
            <div class="pb-gm-row">
              <label class="pb-gm-hint" style="margin:0">累计星沙</label>
              <input type="number" id="gm-total-dust" min="0" step="1000">
            </div>
            <div class="pb-gm-row">
              <label class="pb-gm-hint" style="margin:0">累计邦币</label>
              <input type="number" id="gm-total-bonk" min="0" step="1000">
            </div>
            <div class="pb-gm-row">
              <button class="pb-gm-btn primary" id="gm-profile-save">保存数值</button>
              <button class="pb-gm-btn blue" id="gm-dust-add">星沙 +10000</button>
              <button class="pb-gm-btn blue" id="gm-bonk-add">邦币 +10000</button>
            </div>
          </div>
          <div class="pb-gm-sec">
            <h4>高级：整份档案 JSON</h4>
            <p class="pb-gm-hint">可以直接改联赛、图鉴、研究所、奖牌等所有字段。保存时会先备份到 <code>saves/backups/</code>。</p>
            <textarea id="gm-profile-json" spellcheck="false" placeholder="点击“读取档案”"></textarea>
            <div class="pb-gm-row">
              <button class="pb-gm-btn danger" id="gm-profile-json-save">保存 JSON（替换整份档案）</button>
              <button class="pb-gm-btn" id="gm-profile-reload">读取档案</button>
              <button class="pb-gm-btn blue" id="gm-page-reload">刷新游戏</button>
            </div>
          </div>
        </div>

      </div>
      <div class="pb-gm-toast" id="gm-toast"></div>
    </section>
  `;
  document.documentElement.appendChild(root);

  const fab = q('#pb-gm-fab');
  const panel = q(`#${PANEL_ID}`);
  const toastEl = q('#gm-toast');
  const statList = q('#gm-stat-list');
  const slotsEl = q('#gm-slots');
  const moveResults = q('#gm-move-results');
  const moveSearch = q('#gm-move-search');
  const itemResults = q('#gm-item-results');
  const itemSearch = q('#gm-item-search');
  const vitList = q('#gm-vit-list');
  const vitOwned = q('#gm-vit-owned');
  const itemOwned = q('#gm-item-owned');
  const profileJson = q('#gm-profile-json');

  let toastTimer = 0;
  function notify(message, kind) {
    toastEl.textContent = message;
    toastEl.className = 'pb-gm-toast show' + (kind === true || kind === 'bad' ? ' bad' : kind === 'good' ? ' good' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = 'pb-gm-toast'; }, 2600);
  }

  // ---------------------------------------------------------------- 对局访问

  function getRun() {
    const run = window.__pbRun;
    return run && run.player ? run : null;
  }

  function gmApi() {
    return window.__PB_GM || null;
  }

  let rendererCache;
  function getRenderer() {
    // 优先读游戏自己创建渲染器时记录的真实显卡信息。
    if (window.__pbGpu?.name) return window.__pbGpu.name;
    if (rendererCache) return rendererCache;
    try {
      // 兜底：用独立的离屏 canvas 取显卡信息，避免抢占游戏 canvas 的 WebGL 上下文。
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        rendererCache = String(name || '未知');
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    } catch { /* 忽略 */ }
    return rendererCache;
  }

  function isSoftwareRenderer(name) {
    if (window.__pbGpu && typeof window.__pbGpu.software === 'boolean') return window.__pbGpu.software;
    return !!name && /swiftshader|llvmpipe|software|basic render/i.test(name);
  }

  async function forceRefresh() {
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch { /* 忽略 */ }
    const urls = new Set();
    document.querySelectorAll('script[src],link[rel="stylesheet"][href]')
      .forEach((node) => urls.add(node.src || node.href));
    for (const asset of ['main-D0Tf29Gi-mvv70wso.js?v=gm5', 'main-BjTkSgLV-mvv70wso.js?v=gm5']) {
      urls.add(new URL(`assets/${asset}`, location.href).href);
    }
    await Promise.allSettled([...urls].map((url) => fetch(url, { cache: 'reload' })));
    const url = new URL(location.href);
    url.searchParams.set('pb-reload', String(Date.now()));
    location.replace(url.href);
  }

  function isOver(run) {
    return !run || run.state === 'over';
  }

  function requireRun() {
    const run = getRun();
    if (!run) throw new Error('还没有进入对局');
    if (run.state === 'over') throw new Error('本局已经结束，请重新开始一局');
    return run;
  }

  function action(fn) {
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        result.catch((err) => notify(String(err?.message || err), true));
      }
    } catch (err) {
      notify(String(err?.message || err), true);
    }
  }

  // ---------------------------------------------------------------- 属性

  const STAT_ROWS = [
    ['damage', '伤害', '所有来源的最终伤害'],
    ['attackSpeed', '攻击速度', '技能冷却速度'],
    ['moveSpeed', '移动速度', '角色移动'],
    ['maxHp', '最大生命', '同时会按比例补当前生命'],
    ['xpGain', '经验获取', '升级速度'],
    ['gold', '金币获取', '掉落金币'],
    ['luck', '幸运', '影响稀有度与暴击'],
    ['critChance', '暴击率', '上限 100%'],
    ['area', '技能范围', '爆炸/光环半径'],
    ['projectiles', '弹幕数量', '多重射击'],
    ['duration', '持续时间', '技能/状态时长'],
    ['pickupRange', '拾取范围', '糖果与金币吸附'],
    ['statusChance', '状态几率', '灼烧/麻痹等'],
    ['statusDamage', '状态伤害', '持续伤害'],
    ['lifesteal', '吸血', '造成伤害回血'],
  ];

  const appliedMods = new WeakMap();

  function applyStats(run) {
    const player = run.player;
    if (!player || !player.stats || !Array.isArray(run.tempMods)) return;
    const previous = appliedMods.get(run) || [];
    for (const mod of previous) {
      const index = run.tempMods.indexOf(mod);
      if (index >= 0) run.tempMods.splice(index, 1);
    }
    const next = [];
    for (const [key, value] of Object.entries(settings.stats)) {
      const mul = Number(value);
      if (!Number.isFinite(mul) || mul <= 0 || Math.abs(mul - 1) < 1e-9) continue;
      if (!Object.prototype.hasOwnProperty.call(player.stats, key)) continue;
      if (!Number.isFinite(player.stats[key])) continue;
      const mod = { stat: key, mul, __gm: true };
      run.tempMods.push(mod);
      next.push(mod);
    }
    appliedMods.set(run, next);
    player.recompute();
  }

  function renderStatRows() {
    statList.innerHTML = STAT_ROWS.map(([key, label, hint]) => `
      <div class="pb-gm-statrow" data-stat="${key}">
        <div class="name">${esc(label)}<small>${esc(hint)}</small></div>
        <input type="number" min="0.1" max="100" step="0.1" data-stat-input="${key}"
               value="${esc(settings.stats[key] ?? 1)}" title="倍率">
        <div class="val" data-stat-val="${key}">—</div>
      </div>
    `).join('');
    for (const input of statList.querySelectorAll('input[data-stat-input]')) {
      input.addEventListener('change', () => {
        const key = input.dataset.statInput;
        const value = Number(input.value);
        if (!Number.isFinite(value) || value <= 0) {
          input.value = settings.stats[key] ?? 1;
          return;
        }
        settings.stats[key] = value;
        saveSettings();
      });
    }
  }

  function updateStatValues(player) {
    for (const [key] of STAT_ROWS) {
      const out = statList.querySelector(`[data-stat-val="${key}"]`);
      if (!out) continue;
      const value = player && player.stats ? player.stats[key] : undefined;
      out.textContent = Number.isFinite(value) ? fmt(value, Math.abs(value) < 10 ? 2 : 0) : '—';
    }
  }

  function syncStatInputs() {
    for (const input of statList.querySelectorAll('input[data-stat-input]')) {
      input.value = settings.stats[input.dataset.statInput] ?? 1;
    }
  }

  // ---------------------------------------------------------------- 无敌

  function syncGod(player) {
    if (!player) return;
    if (settings.god && !player.__gmHurt) {
      try {
        player.__gmHurt = player.hurt;
        player.hurt = () => false;
      } catch { /* 忽略 */ }
    } else if (!settings.god && player.__gmHurt) {
      try {
        player.hurt = player.__gmHurt;
      } catch { /* 忽略 */ }
      delete player.__gmHurt;
    }
  }

  // ---------------------------------------------------------------- 状态显示

  const el = {
    runState: q('#gm-run-state'),
    species: q('#gm-species'),
    level: q('#gm-level'),
    hp: q('#gm-hp'),
    shield: q('#gm-shield'),
    gold: q('#gm-gold'),
    stage: q('#gm-stage'),
    kills: q('#gm-kills'),
    picks: q('#gm-picks'),
    pending: q('#gm-pending'),
    patch: q('#gm-patch'),
    renderer: q('#gm-renderer'),
    renderHint: q('#gm-render-hint'),
  };

  function applyStandoff() {
    if (window.__PB_GM) window.__PB_GM.noStandoff = !!settings.noStandoff;
  }

  function updateEnvironment() {
    applyStandoff();
    const api = gmApi();
    const patched = !!api;
    el.patch.textContent = patched ? '已加载' : '未加载（旧缓存）';
    el.patch.style.color = patched ? '' : '#ff8b8b';
    const renderer = getRenderer();
    el.renderer.textContent = renderer || '未检测到 WebGL';
    const software = isSoftwareRenderer(renderer);
    if (!patched) {
      el.renderHint.textContent = '主包仍是旧缓存：点“强制刷新页面”，刷新后 GM 才能在局内生效。';
    } else if (software) {
      el.renderHint.textContent = `检测到软件渲染（${renderer}）。这会让游戏明显卡顿：请在浏览器设置里开启“硬件加速”后完全重启浏览器。`;
    } else if (/intel/i.test(renderer) && !/arc/i.test(renderer)) {
      el.renderHint.textContent = '检测到 Intel 核显（硬件加速正常）。若仍卡顿，可在 Windows 设置 → 系统 → 显示 → 图形中把 msedge.exe 设为“高性能”，或在游戏设置里调低画质。';
    } else {
      el.renderHint.textContent = '硬件加速正常。若仍卡顿，可关闭其他占用显卡的程序后在游戏设置里调低画质。';
    }
  }

  function updateStatus(run, player) {
    updateEnvironment();
    if (!run || !player) {
      el.runState.textContent = '等待对局开始…';
      for (const key of Object.keys(el)) {
        if (!['runState', 'patch', 'renderer', 'renderHint'].includes(key)) el[key].textContent = '—';
      }
      return;
    }
    const over = run.state === 'over';
    el.runState.textContent = over
      ? '对局已结束'
      : `进行中 · ${run.mode || '经典'} · 状态 ${run.state || '?'}`;
    const playerName = pokeName(player.speciesId);
    el.species.textContent = `${playerName}${player.dead ? '（倒下）' : ''}`;
    el.level.textContent = `Lv.${player.level} · ${fmt(player.xp)} / ${fmt(player.xpNext)}`;
    el.hp.textContent = `${fmt(player.hp)} / ${fmt(player.maxHp)}`;
    el.shield.textContent = `${fmt(player.shield)} / ${fmt(player.overheal)}`;
    el.gold.textContent = fmt(run.gold);
    const biome = run.biome?.name || run.biome?.id || '—';
    el.stage.textContent = `${run.stage ?? '—'} · ${biome}`;
    el.kills.textContent = `${fmt(run.stats?.kills)} · ${clock(run.time)}`;
    el.picks.textContent = `${run.rerolls ?? 0} / ${run.skips ?? 0} / ${run.banishes ?? 0}`;
    el.pending.textContent = fmt(run.pendingLevels);

    if (document.activeElement !== q('#gm-hp-input')) {
      q('#gm-hp-input').max = Math.max(1, Math.round(player.maxHp));
    }
    if (document.activeElement !== q('#gm-gold-input') && !q('#gm-gold-input').value) {
      q('#gm-gold-input').value = Math.round(run.gold || 0);
    }
    if (document.activeElement !== q('#gm-level-input') && !q('#gm-level-input').value) {
      q('#gm-level-input').value = player.level;
    }
    q('#gm-god').checked = settings.god;
  }

  // ---------------------------------------------------------------- 技能

  let lastMoveSig = '';

  function moveSignature(player) {
    return `${player.moveSlots}:` + player.moves.map((move) =>
      move ? `${move.def.id}/${move.level}/${move.mods.dmg.toFixed(2)}` : '0'
    ).join('|');
  }

  function renderMoveSlots(player) {
    if (!player) {
      slotsEl.innerHTML = '<div class="pb-gm-empty">等待对局开始…</div>';
      return;
    }
    const slots = 4;
    const rows = [];
    for (let i = 0; i < slots; i += 1) {
      const move = player.moves[i];
      const locked = i >= (player.moveSlots || 3);
      if (locked) {
        rows.push(`
          <div class="pb-gm-slot empty">
            <div class="no">${i + 1}</div>
            <div class="info"><b>未解锁</b><small>需要研究所/道具提升技能栏</small></div>
          </div>`);
        continue;
      }
      if (!move) {
        rows.push(`
          <div class="pb-gm-slot empty">
            <div class="no">${i + 1}</div>
            <div class="info"><b>空格子</b><small>在下方搜索并学习技能</small></div>
          </div>`);
        continue;
      }
      const def = move.def || {};
      const extra = move.mods ? `伤害 ×${move.mods.dmg.toFixed(2)} · CD ×${move.mods.cd.toFixed(2)} · 数量 +${move.mods.count}` : '';
      rows.push(`
        <div class="pb-gm-slot" data-slot="${i}">
          <div class="no">${i + 1}</div>
          <div class="info">
            <b>${esc(moveName(def.id))}</b>
            <small>Lv.${move.level} · ${esc(typeName(def.type))} · ${esc(extra)}</small>
          </div>
          <button class="pb-gm-btn primary" data-move-act="up" data-slot="${i}">升级</button>
          <button class="pb-gm-btn" data-move-act="up10" data-slot="${i}">+10</button>
          <button class="pb-gm-btn danger" data-move-act="forget" data-slot="${i}">遗忘</button>
        </div>`);
    }
    slotsEl.innerHTML = rows.join('');
    lastMoveSig = moveSignature(player);
  }

  const UPGRADE_KEYS = [
    ['dmg', () => 0.08 + Math.random() * 0.12],
    ['cd', () => 0.05 + Math.random() * 0.08],
    ['count', () => 1],
    ['pierce', () => 1],
    ['bounce', () => 1],
    ['area', () => 0.08 + Math.random() * 0.1],
    ['speed', () => 0.08 + Math.random() * 0.1],
    ['dur', () => 0.08 + Math.random() * 0.1],
    ['crit', () => 0.05 + Math.random() * 0.08],
    ['status', () => 0.08 + Math.random() * 0.1],
  ];

  function randomUpgrades(count = 2) {
    const pool = UPGRADE_KEYS.slice();
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count).map(([key, value]) => ({
      key,
      value: Math.round(value() * 100) / 100,
    }));
  }

  function upgradeMove(slot, times) {
    const api = gmApi();
    if (!api || !api.upgradeMove) throw new Error('主包补丁未加载，请刷新页面');
    const player = requireRun().player;
    const move = player.moves[slot];
    if (!move) throw new Error('这个格子没有技能');
    for (let i = 0; i < times; i += 1) {
      api.upgradeMove(move, randomUpgrades(2));
    }
    player.recompute();
    renderMoveSlots(player);
    notify(`${moveName(move.def.id)} 升到 Lv.${move.level}`, 'good');
  }

  function forgetMove(slot) {
    const player = requireRun().player;
    if (!player.moves[slot]) throw new Error('这个格子没有技能');
    if (typeof player.$1kwm2q2 === 'function') player.$1kwm2q2(slot);
    else player.moves[slot] = null;
    player.recompute();
    renderMoveSlots(player);
    notify('已遗忘该技能', 'good');
  }

  function learnMove(id) {
    const player = requireRun().player;
    if (typeof player.$1hei4qu !== 'function') throw new Error('学习函数不可用');
    if (!player.$1hei4qu(Number(id))) throw new Error('技能栏已满：先遗忘一个技能');
    player.recompute();
    renderMoveSlots(player);
    notify(`学会了 ${moveName(Number(id))}`, 'good');
  }

  function validMoves() {
    if (data.validMoves) return data.validMoves;
    const api = gmApi();
    if (!api || !api.makeMove || !data.loaded) return [];
    const out = [];
    for (const move of data.moves) {
      try {
        if (api.makeMove(move.id)) out.push(move);
      } catch { /* 不支持的招式忽略 */ }
    }
    data.validMoves = out;
    return out;
  }

  function renderMoveResults() {
    const run = getRun();
    if (!data.loaded) {
      moveResults.innerHTML = '<div class="pb-gm-empty">正在加载招式数据…</div>';
      return;
    }
    if (!run) {
      moveResults.innerHTML = '<div class="pb-gm-empty">进入对局后才能学习技能</div>';
      return;
    }
    const list = validMoves();
    if (!list.length) {
      moveResults.innerHTML = '<div class="pb-gm-empty">招式表加载失败，请刷新页面</div>';
      return;
    }
    const needle = moveSearch.value.trim().toLowerCase();
    const matched = [];
    for (const move of list) {
      const name = moveName(move.id);
      const hay = `${name} ${move.key || ''} ${move.id} ${move.type || ''} ${typeName(move.type)}`.toLowerCase();
      if (!needle || hay.includes(needle)) matched.push(move);
      if (matched.length >= 60) break;
    }
    if (!matched.length) {
      moveResults.innerHTML = '<div class="pb-gm-empty">没有匹配的招式</div>';
      return;
    }
    moveResults.innerHTML = matched.map((move) => `
      <div class="item">
        <div class="grow">
          <b>${esc(moveName(move.id))}</b>
          <small>#${move.id} · ${esc(typeName(move.type))} · 威力 ${move.power ?? '—'}</small>
        </div>
        <button class="pb-gm-btn blue" data-learn="${move.id}">学习</button>
      </div>
    `).join('');
  }

  // ---------------------------------------------------------------- 道具 / 维生素

  function renderVitaminList() {
    const api = gmApi();
    if (!data.loaded || !api || !api.vitamins) {
      vitList.innerHTML = '<div class="pb-gm-empty">等待游戏加载…</div>';
      return;
    }
    const rows = [];
    for (const vitamin of api.vitamins.values()) {
      rows.push(`
        <div class="item">
          <div class="grow">
            <b>${esc(vitamin.name)}</b>
            <small>${esc(vitamin.desc || '')}（${esc(vitamin.stat)} ×${vitamin.per}）</small>
          </div>
          <button class="pb-gm-btn blue" data-vit="${esc(vitamin.key)}">+1 级</button>
        </div>`);
    }
    vitList.innerHTML = rows.join('') || '<div class="pb-gm-empty">没有维生素数据</div>';
  }

  function renderVitaminOwned(player) {
    if (!player || !player.vitamins || !player.vitamins.size) {
      vitOwned.innerHTML = '<div class="pb-gm-empty">还没有维生素</div>';
      return;
    }
    const api = gmApi();
    const rows = [];
    for (const [key, entry] of player.vitamins) {
      const vitamin = api?.vitamins?.get(key);
      rows.push(`
        <div class="item">
          <div class="grow">
            <b>${esc(vitamin?.name || key)} · Lv.${entry.level}</b>
            <small>${esc(vitamin?.stat || '')}</small>
          </div>
          <button class="pb-gm-btn danger" data-vit-del="${esc(key)}">移除</button>
        </div>`);
    }
    vitOwned.innerHTML = rows.join('');
  }

  function renderItemResults() {
    const run = getRun();
    if (!data.loaded) {
      itemResults.innerHTML = '<div class="pb-gm-empty">正在加载道具数据…</div>';
      return;
    }
    if (!run) {
      itemResults.innerHTML = '<div class="pb-gm-empty">进入对局后才能添加道具</div>';
      return;
    }
    const needle = itemSearch.value.trim().toLowerCase();
    const rows = [];
    for (const [key, item] of Object.entries(data.items)) {
      const name = itemName(key);
      const hay = `${name} ${key} ${item.id} ${item.desc || ''}`.toLowerCase();
      if (needle && !hay.includes(needle)) continue;
      rows.push(`
        <div class="item">
          <div class="grow">
            <b>${esc(name)}</b>
            <small>${esc(itemDesc(key).slice(0, 70))}</small>
          </div>
          <button class="pb-gm-btn blue" data-item="${esc(key)}">添加</button>
        </div>`);
      if (rows.length >= 50) break;
    }
    itemResults.innerHTML = rows.join('') || '<div class="pb-gm-empty">没有匹配的道具</div>';
  }

  function renderItemOwned(player) {
    if (!player || !player.items || !player.items.size) {
      itemOwned.innerHTML = '<div class="pb-gm-empty">背包是空的</div>';
      return;
    }
    const rows = [];
    for (const [key, count] of player.items) {
      rows.push(`
        <div class="item">
          <div class="grow">
            <b>${esc(itemName(key))} ×${count}</b>
            <small>${esc(key)}</small>
          </div>
          <button class="pb-gm-btn danger" data-item-del="${esc(key)}">移除</button>
        </div>`);
    }
    itemOwned.innerHTML = rows.join('');
  }

  function addVitamin(key) {
    const player = requireRun().player;
    if (typeof player.$6uq814 !== 'function') throw new Error('维生素函数不可用');
    const api = gmApi();
    const rarity = Math.max(0, Math.min(4, Number(q('#gm-rarity').value) || 0));
    const tier = Array.isArray(api?.tiers) ? api.tiers[rarity] : 1.2;
    player.$6uq814(key, tier);
    player.recompute();
    renderVitaminOwned(player);
    notify('维生素已添加', 'good');
  }

  function addItem(key) {
    const player = requireRun().player;
    if (typeof player.$q6640m !== 'function') throw new Error('道具函数不可用');
    if (!player.$q6640m(key)) throw new Error('该道具已达到携带上限');
    renderItemOwned(player);
    notify(`已获得 ${itemName(key)}`, 'good');
  }

  // ---------------------------------------------------------------- 档案（服务器）

  let profileCache = null;

  function sessionToken() {
    try {
      const session = JSON.parse(localStorage.getItem('pb.session') || 'null');
      return session?.token || null;
    } catch {
      return null;
    }
  }

  async function gmFetch(path, options = {}) {
    const token = sessionToken();
    if (!token) throw new Error('没有登录令牌：先进入游戏（游客登录即可）');
    const headers = { Authorization: `Bearer ${token}` };
    if (options.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { ...options, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${text ? `：${text.slice(0, 160)}` : ''}`);
    }
    return res.json();
  }

  // 档案改动同步进当前对局的内存档案，避免下一次动作批次把 GM 改动覆盖回去。
  function syncLiveProfile(profile, replace) {
    const meta = getRun()?.meta;
    if (!meta || !meta.profile || !profile) return false;
    if (replace) {
      const keep = {};
      for (const key of ['settings', 'lastSpecies', 'lastBiome', 'team', 'skins']) {
        if (meta.profile[key] !== undefined) keep[key] = meta.profile[key];
      }
      for (const key of Object.keys(meta.profile)) {
        if (!(key in profile)) delete meta.profile[key];
      }
      Object.assign(meta.profile, profile, keep);
    } else {
      Object.assign(meta.profile, profile);
    }
    return true;
  }

  function paintProfile(payload) {
    profileCache = payload?.profile || null;
    const account = payload?.account || {};
    q('#gm-acct-name').textContent = account.name || '—';
    q('#gm-acct-kind').textContent = account.guest ? '游客' : '本地账号';
    q('#gm-acct-ver').textContent = profileCache?.v ?? '—';
    if (!profileCache) return;
    q('#gm-dust').value = profileCache.stardust ?? 0;
    q('#gm-bonk').value = profileCache.bonk ?? 0;
    q('#gm-total-dust').value = profileCache.totalStardust ?? 0;
    q('#gm-total-bonk').value = profileCache.totalBonk ?? 0;
    profileJson.value = JSON.stringify(profileCache, null, 2);
  }

  async function loadProfile() {
    const payload = await gmFetch('/api/gm/profile');
    paintProfile(payload);
    return payload;
  }

  async function saveProfileNumbers() {
    const read = (id) => {
      const n = Number(q(id).value);
      if (!Number.isFinite(n) || n < 0) throw new Error('数值必须是非负整数');
      return Math.floor(n);
    };
    const payload = await gmFetch('/api/gm/profile', {
      method: 'POST',
      body: JSON.stringify({
        patch: {
          stardust: read('#gm-dust'),
          bonk: read('#gm-bonk'),
          totalStardust: read('#gm-total-dust'),
          totalBonk: read('#gm-total-bonk'),
        },
      }),
    });
    paintProfile(payload);
    const live = syncLiveProfile(payload?.profile);
    notify(live ? '已保存，立即生效。' : '已保存。请刷新游戏页面后生效。', 'good');
  }

  async function saveProfileJson() {
    let parsed;
    try {
      parsed = JSON.parse(profileJson.value);
    } catch (err) {
      throw new Error(`JSON 解析失败：${err.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('档案必须是一个 JSON 对象');
    }
    if (!window.confirm('将用文本框内容替换整份服务器档案，确定吗？')) return;
    const payload = await gmFetch('/api/gm/profile', {
      method: 'POST',
      body: JSON.stringify({ replace: parsed }),
    });
    paintProfile(payload);
    const live = syncLiveProfile(payload?.profile, true);
    notify(live ? '档案已替换，立即生效。' : '档案已替换。请刷新游戏页面后生效。', 'good');
  }

  // ---------------------------------------------------------------- 事件

  let currentTab = 'status';

  function setTab(name) {
    currentTab = name;
    for (const button of panel.querySelectorAll('[data-tab]')) {
      button.classList.toggle('on', button.dataset.tab === name);
    }
    for (const pane of panel.querySelectorAll('.pb-gm-pane')) {
      pane.hidden = pane.dataset.pane !== name;
    }
    if (name === 'moves' || name === 'items') {
      ensureData().catch((err) => notify(String(err.message || err), true));
    }
    if (name === 'moves') {
      renderMoveResults();
      const player = getRun()?.player;
      if (player) renderMoveSlots(player);
    }
    if (name === 'items') {
      renderVitaminList();
      renderItemResults();
      const player = getRun()?.player;
      if (player) {
        renderVitaminOwned(player);
        renderItemOwned(player);
      }
    }
    if (name === 'profile') {
      loadProfile().catch((err) => notify(String(err.message || err), true));
    }
  }

  function openPanel() {
    panel.hidden = false;
    fab.hidden = true;
    try { document.exitPointerLock?.(); } catch { /* 忽略 */ }
    ensureData().catch((err) => notify(String(err.message || err), true));
    if (currentTab === 'profile') loadProfile().catch(() => {});
    const run = getRun();
    if (run?.player) {
      renderMoveSlots(run.player);
      renderVitaminOwned(run.player);
      renderItemOwned(run.player);
      syncStatInputs();
    }
  }

  function closePanel() {
    panel.hidden = true;
    fab.hidden = false;
  }

  function togglePanel() {
    if (panel.hidden) openPanel();
    else closePanel();
  }

  fab.addEventListener('click', () => openPanel());
  q('#gm-close').addEventListener('click', () => closePanel());
  q('#gm-hard-refresh').addEventListener('click', () => {
    notify('正在清除缓存并刷新…');
    action(() => forceRefresh());
  });
  const noStandoff = q('#gm-no-standoff');
  if (noStandoff) {
    noStandoff.checked = !!settings.noStandoff;
    noStandoff.addEventListener('change', () => {
      settings.noStandoff = noStandoff.checked;
      saveSettings();
      applyStandoff();
      notify(noStandoff.checked ? '已开启：所有敌人都会贴近你。' : '已关闭：远程怪恢复原版距离 AI。', 'good');
    });
  }

  panel.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      setTab(tab.dataset.tab);
      return;
    }

    const moveButton = event.target.closest('[data-move-act]');
    if (moveButton) {
      const slot = Number(moveButton.dataset.slot);
      const act = moveButton.dataset.moveAct;
      if (act === 'up') action(() => upgradeMove(slot, 1));
      else if (act === 'up10') action(() => upgradeMove(slot, 10));
      else if (act === 'forget') action(() => forgetMove(slot));
      return;
    }

    const learn = event.target.closest('[data-learn]');
    if (learn) {
      action(() => learnMove(Number(learn.dataset.learn)));
      return;
    }

    const vitamin = event.target.closest('[data-vit]');
    if (vitamin) {
      action(() => addVitamin(vitamin.dataset.vit));
      return;
    }

    const vitaminDel = event.target.closest('[data-vit-del]');
    if (vitaminDel) {
      action(() => {
        const player = requireRun().player;
        player.vitamins.delete(vitaminDel.dataset.vitDel);
        player.recompute();
        renderVitaminOwned(player);
        notify('已移除维生素');
      });
      return;
    }

    const item = event.target.closest('[data-item]');
    if (item) {
      action(() => addItem(item.dataset.item));
      return;
    }

    const itemDel = event.target.closest('[data-item-del]');
    if (itemDel) {
      action(() => {
        const player = requireRun().player;
        player.removeItem(itemDel.dataset.itemDel);
        renderItemOwned(player);
        notify('已移除道具');
      });
      return;
    }
  });

  // 状态页操作
  q('#gm-hp-set').addEventListener('click', () => action(() => {
    const player = requireRun().player;
    const value = Number(q('#gm-hp-input').value);
    if (!Number.isFinite(value)) throw new Error('请输入生命值');
    player.hp = Math.max(1, Math.min(player.maxHp, Math.floor(value)));
    notify(`生命已设为 ${Math.round(player.hp)}`, 'good');
  }));

  q('#gm-heal').addEventListener('click', () => action(() => {
    const player = requireRun().player;
    player.dead = false;
    player.hp = player.maxHp;
    notify('已回满血', 'good');
  }));

  q('#gm-god').addEventListener('change', (event) => {
    settings.god = !!event.target.checked;
    saveSettings();
    const player = getRun()?.player;
    syncGod(player);
    notify(settings.god ? '无敌已开启' : '无敌已关闭', settings.god ? 'good' : undefined);
  });

  q('#gm-level-set').addEventListener('click', () => action(() => {
    const player = requireRun().player;
    const target = Math.max(1, Math.min(999, Math.floor(Number(q('#gm-level-input').value))));
    if (!Number.isFinite(target)) throw new Error('请输入等级');
    player.level = target;
    player.xp = 0;
    player.xpNext = typeof player.$lafclt === 'function' ? player.$lafclt(target) : player.xpNext;
    player.recompute();
    if (typeof player.$h5fpwd === 'function') player.$h5fpwd();
    q('#gm-level-input').value = target;
    notify(`等级已设为 ${target}`, 'good');
  }));

  q('#gm-xp-add').addEventListener('click', () => action(() => {
    const player = requireRun().player;
    const value = Math.floor(Number(q('#gm-xp-input').value));
    if (!Number.isFinite(value) || value <= 0) throw new Error('请输入经验值');
    if (typeof player.addXp !== 'function') throw new Error('经验函数不可用');
    player.addXp(value);
    notify(`获得了 ${value} 经验`, 'good');
  }));

  q('#gm-gold-set').addEventListener('click', () => action(() => {
    const run = requireRun();
    const value = Math.max(0, Math.floor(Number(q('#gm-gold-input').value)));
    if (!Number.isFinite(value)) throw new Error('请输入金币数');
    run.gold = value;
    notify(`金币已设为 ${value}`, 'good');
  }));

  q('#gm-gold-add').addEventListener('click', () => action(() => {
    const run = requireRun();
    const value = Math.floor(Number(q('#gm-gold-input').value));
    if (!Number.isFinite(value) || value <= 0) throw new Error('请输入金币数');
    if (typeof run.$75wtjp === 'function') run.$75wtjp(value);
    else run.gold = (run.gold || 0) + value;
    notify(`金币 +${value}`, 'good');
  }));

  q('#gm-picks-max').addEventListener('click', () => action(() => {
    const run = requireRun();
    run.rerolls = 99;
    run.skips = 99;
    run.banishes = 99;
    notify('重掷 / 跳过 / 禁用已设为 99', 'good');
  }));

  q('#gm-clear-bans').addEventListener('click', () => action(() => {
    const run = requireRun();
    run.banished?.clear?.();
    run.itemsOff?.clear?.();
    notify('已清除本局的禁用池', 'good');
  }));

  q('#gm-nuke').addEventListener('click', () => action(() => {
    const run = requireRun();
    if (typeof run.nuke !== 'function') throw new Error('清屏函数不可用');
    run.nuke();
    notify('已清屏', 'good');
  }));

  // 属性页
  q('#gm-stats-apply').addEventListener('click', () => action(() => {
    const run = requireRun();
    applyStats(run);
    renderStatRows();
    updateStatValues(run.player);
    notify('属性已应用', 'good');
  }));

  q('#gm-stats-reset').addEventListener('click', () => action(() => {
    const run = requireRun();
    settings.stats = {};
    saveSettings();
    applyStats(run);
    syncStatInputs();
    updateStatValues(run.player);
    notify('属性倍率已全部重置', 'good');
  }));

  // 技能页
  q('#gm-moves-all').addEventListener('click', () => action(() => {
    const player = requireRun().player;
    let changed = 0;
    for (let i = 0; i < player.moves.length; i += 1) {
      const move = player.moves[i];
      if (!move) continue;
      for (let n = 0; n < 5; n += 1) gmApi().upgradeMove(move, randomUpgrades(2));
      changed += 1;
    }
    if (!changed) throw new Error('当前没有已学技能');
    player.recompute();
    renderMoveSlots(player);
    notify('所有技能 +5 级', 'good');
  }));

  moveSearch.addEventListener('input', renderMoveResults);
  itemSearch.addEventListener('input', renderItemResults);

  // 档案页
  q('#gm-profile-reload').addEventListener('click', () => action(() => loadProfile()));
  q('#gm-profile-save').addEventListener('click', () => action(() => saveProfileNumbers()));
  q('#gm-profile-json-save').addEventListener('click', () => action(() => saveProfileJson()));
  q('#gm-page-reload').addEventListener('click', () => {
    if (window.confirm('刷新页面？未保存的对局进度依赖游戏自身的“保存并退出”。')) location.reload();
  });
  q('#gm-dust-add').addEventListener('click', () => action(async () => {
    const base = profileCache || (await loadProfile()).profile || {};
    q('#gm-dust').value = Number(base.stardust || 0) + 10000;
    q('#gm-total-dust').value = Math.max(Number(base.totalStardust || 0), Number(q('#gm-dust').value));
    await saveProfileNumbers();
  }));
  q('#gm-bonk-add').addEventListener('click', () => action(async () => {
    const base = profileCache || (await loadProfile()).profile || {};
    q('#gm-bonk').value = Number(base.bonk || 0) + 10000;
    q('#gm-total-bonk').value = Math.max(Number(base.totalBonk || 0), Number(q('#gm-bonk').value));
    await saveProfileNumbers();
  }));

  // ---------------------------------------------------------------- 键盘

  // 必须尽早注册：游戏在主模块里也监听键盘，这里先截住面板内的按键。
  window.addEventListener('keydown', (event) => {
    if (event.key === 'F8') {
      event.preventDefault();
      event.stopImmediatePropagation();
      togglePanel();
      return;
    }
    const inside = event.target instanceof Element && event.target.closest('#pb-gm-root');
    if (inside) {
      if (event.key === 'Escape' && !panel.hidden) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closePanel();
        return;
      }
      // 输入框仍然能收到字符（默认行为），但游戏不会再触发暂停/技能键。
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('keyup', (event) => {
    if (event.target instanceof Element && event.target.closest('#pb-gm-root')) {
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('keypress', (event) => {
    if (event.target instanceof Element && event.target.closest('#pb-gm-root')) {
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('wheel', (event) => {
    if (event.target instanceof Element && event.target.closest('#pb-gm-root')) {
      event.stopImmediatePropagation();
    }
  }, { capture: true, passive: true });

  // ---------------------------------------------------------------- 轮询

  let lastRun = null;
  let lastPlayer = null;
  let lastPlayerSig = '';

  function tick() {
    const run = getRun();
    const player = run?.player || null;
    if (run && player) {
      if (run !== lastRun || player !== lastPlayer) {
        lastRun = run;
        lastPlayer = player;
        try {
          applyStats(run);
          syncGod(player);
        } catch (err) {
          console.warn('[GM] 应用设置失败', err);
        }
        if (!panel.hidden) {
          renderMoveSlots(player);
          renderVitaminList();
          renderVitaminOwned(player);
          renderItemOwned(player);
          syncStatInputs();
        }
      }
      syncGod(player);
      const sig = moveSignature(player);
      if (!panel.hidden && currentTab === 'moves' && sig !== lastPlayerSig) {
        lastPlayerSig = sig;
        renderMoveSlots(player);
        renderMoveResults();
      }
    }
    updateStatus(run, player);
    updateStatValues(player);
  }

  renderStatRows();
  setInterval(tick, 400);
  tick();

  // 游戏主包加载完成后补一次数据渲染（__PB_GM 此时才存在）
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (panel.hidden) return;
      if (currentTab === 'moves' || currentTab === 'items') ensureData().catch(() => {});
    }, 1500);
  });
})();
