import {
  newProfile, mergeFinish, applyActions, applyProfileSnapshot,
  validTrainerName, nowMs, familyOf,
} from './local-core.js';

function seasonInfo() {
  const t = nowMs();
  return {
    n: 3, name: '', live: true, dust: 1, paid: true,
    start: t - 3 * 86_400_000, end: t + 2 * 86_400_000, next: null,
  };
}

function defaultHex(n) {
  let out = '';
  for (let i = 0; i < n; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

export function createApi({ state, save, randomHex = defaultHex }) {
  const ok = (body) => ({ status: 200, body });
  const err = (status, message) => ({ status, body: { error: message } });
  const noContent = () => ({ status: 204, body: null });

  function findAccountByName(name) {
    const low = String(name || '').trim().toLowerCase();
    for (const acc of Object.values(state.accounts)) {
      if (!acc.guest && String(acc.name || '').toLowerCase() === low) return acc;
    }
    return null;
  }

  function accountFromToken(token) {
    if (!token) return null;
    const id = state.tokens[token];
    return id ? state.accounts[id] || null : null;
  }

  function makeToken(acc) {
    const token = randomHex(24);
    state.tokens[token] = acc.id;
    return token;
  }

  function publicAccount(acc, token = null) {
    const out = {
      id: acc.id,
      name: acc.name,
      guest: Boolean(acc.guest),
      created: acc.created ?? nowMs(),
      profile: acc.profile,
    };
    if (token) out.token = token;
    return out;
  }

  function hashPassword(password, salt) {
    // 单机存档无需密码学哈希；保持字段结构一致即可
    const s = salt || randomHex(8);
    let h = 0;
    for (const ch of s + password) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return [s, h.toString(16)];
  }

  function checkPassword(acc, password) {
    if (!acc.passwordSalt || !acc.passwordHash) return false;
    return hashPassword(password, acc.passwordSalt)[1] === acc.passwordHash;
  }

  function handle({ method, path, query, body, token, device = '' }) {
    if (path === '/api/status') {
      return ok({
        maintenance: { on: false, title: '', message: '', eta: 0 },
        bypass: false,
        registration: { open: true, inviteOnly: false },
        season: seasonInfo(),
        events: [],
      });
    }
    if (path === '/api/news') return ok([]);
    if (path.startsWith('/api/auth/')) return handleAuth(method, path, body, token, device);

    const acc = accountFromToken(token);
    if (!acc) return err(401, 'Sesión no válida');
    return handleAuthed(method, path, query, body, acc);
  }

  function handleAuth(method, path, body, token, device) {
    const route = path.slice('/api'.length);
    if (route === '/auth/name' && method === 'GET') {
      return ok({ ok: true, taken: false });
    }
    if (route === '/auth/me' && method === 'GET') {
      const acc = accountFromToken(token);
      return acc ? ok(publicAccount(acc)) : err(401, 'Sesión no válida');
    }
    if (route === '/auth/guest' && method === 'POST') {
      if (device) {
        for (const acc of Object.values(state.accounts)) {
          if (acc.guest && acc.device === device) {
            const t = makeToken(acc);
            save();
            return ok(publicAccount(acc, t));
          }
        }
      }
      const id = `g${randomHex(8)}`;
      const name = `Invitado${randomHex(2)}`;
      const acc = { id, name, guest: true, created: nowMs(), device, profile: newProfile(name) };
      state.accounts[id] = acc;
      const t = makeToken(acc);
      save();
      return ok(publicAccount(acc, t));
    }
    if (route === '/auth/register' && method === 'POST') {
      const name = String(body?.name || '').trim();
      const password = String(body?.password || '');
      if (!validTrainerName(name)) return err(400, 'Nombre no válido');
      if (password.length < 6) return err(400, 'La contraseña es demasiado corta');
      if (findAccountByName(name)) return err(409, 'Ese nombre ya está en uso');
      const id = `a${randomHex(8)}`;
      const acc = { id, name, guest: false, created: nowMs(), device, profile: newProfile(name) };
      const [salt, digest] = hashPassword(password);
      acc.passwordSalt = salt;
      acc.passwordHash = digest;
      state.accounts[id] = acc;
      const t = makeToken(acc);
      save();
      return ok(publicAccount(acc, t));
    }
    if (route === '/auth/upgrade' && method === 'POST') {
      const acc = accountFromToken(token);
      if (!acc) return err(401, 'Sesión no válida');
      const name = String(body?.name || '').trim();
      const password = String(body?.password || '');
      if (password.length < 6) return err(400, 'La contraseña es demasiado corta');
      const other = findAccountByName(name);
      if (other && other !== acc) return err(409, 'Ese nombre ya está en uso');
      acc.name = name;
      acc.guest = false;
      acc.profile.name = name;
      const [salt, digest] = hashPassword(password);
      acc.passwordSalt = salt;
      acc.passwordHash = digest;
      const t = makeToken(acc);
      save();
      return ok(publicAccount(acc, t));
    }
    if (route === '/auth/login' && method === 'POST') {
      const acc = findAccountByName(String(body?.name || '').trim());
      const password = String(body?.password || '');
      if (!acc || !checkPassword(acc, password)) return err(401, 'Nombre o contraseña incorrectos');
      const t = makeToken(acc);
      save();
      return ok(publicAccount(acc, t));
    }
    if (route === '/auth/logout' && method === 'POST') {
      if (token) {
        delete state.tokens[token];
        save();
      }
      return noContent();
    }
    return err(404, 'Not found');
  }

  function handleAuthed(method, path, query, body, acc) {
    const route = path.slice('/api'.length);
    const p = acc.profile;

    if (route === '/gm/profile' && method === 'GET') {
      return ok({ account: { id: acc.id, name: acc.name, guest: Boolean(acc.guest) }, profile: p, now: nowMs() });
    }
    if (route === '/gm/profile' && method === 'POST') {
      if (body && typeof body.replace === 'object' && body.replace) {
        acc.profile = { v: 1, created: p.created || nowMs(), name: p.name || acc.name, ...body.replace };
      }
      const target = acc.profile;
      if (body && typeof body.patch === 'object' && body.patch) {
        for (const [key, value] of Object.entries(body.patch)) {
          if (key === 'v' || key === 'created' || key === 'name') continue;
          if (['stardust', 'totalStardust', 'bonk', 'totalBonk'].includes(key)) {
            const n = Number(value);
            if (!Number.isFinite(n)) return err(400, `${key} 必须是整数`);
            target[key] = Math.max(0, Math.trunc(n));
          } else {
            target[key] = value;
          }
        }
      }
      save();
      return ok({ account: { id: acc.id, name: acc.name, guest: Boolean(acc.guest) }, profile: target });
    }

    if (route === '/profile' && method === 'GET') return ok({ profile: p, now: nowMs() });

    if (route === '/profile/prefs' && method === 'PUT') {
      for (const key of ['settings', 'lastSpecies', 'lastBiome', 'avatar', 'frame', 'title', 'banner', 'skins', 'team']) {
        if (body && key in body) p[key] = body[key];
      }
      save();
      return ok({ profile: p });
    }

    if (route === '/profile/starter' && method === 'POST') {
      const starter = Number.parseInt(body?.id, 10);
      if (!Number.isFinite(starter)) return err(400, 'Starter no válido');
      const fam = familyOf(starter);
      p.starter = starter;
      p.lastSpecies = starter;
      if (!Array.isArray(p.league)) p.league = [];
      if (!Array.isArray(p.unlocked)) p.unlocked = [];
      if (!p.captured || typeof p.captured !== 'object') p.captured = {};
      if (!p.league.includes(starter)) p.league.push(starter);
      if (!p.unlocked.includes(fam)) p.unlocked.push(fam);
      if (p.captured[String(fam)] === undefined) p.captured[String(fam)] = nowMs();
      save();
      return ok({ profile: p });
    }

    if (route === '/profile/actions' && method === 'POST') {
      if (!applyProfileSnapshot(p, body?.profile)) applyActions(p, body?.actions);
      save();
      return ok({ profile: p });
    }

    if (route === '/runs' && method === 'POST') {
      const key = String(body?.key || '');
      for (const run of Object.values(state.runs)) {
        if (run.account === acc.id && key && run.key === key && !run.finished) {
          return ok({ id: run.id, seed: run.seed, ranked: run.ranked ?? true });
        }
      }
      const id = `r${randomHex(10)}`;
      const seed = Math.floor(Math.random() * (2 ** 31 - 1)) + 1;
      state.runs[id] = { id, account: acc.id, key, seed, ranked: true, started: nowMs(), finished: false, body };
      save();
      return ok({ id, seed, ranked: true });
    }

    const m = route.match(/^\/runs\/([^/]+)\/(checkpoint|suspend|resume|discard|finish|build)$/);
    if (m) {
      const [, runId, action] = m;
      const run = state.runs[runId];
      if (!run || run.account !== acc.id) return err(404, 'Partida no encontrada');
      if (action === 'checkpoint' && method === 'POST') return ok({});
      if (action === 'suspend' && method === 'POST') { run.suspended = true; save(); return ok({}); }
      if (action === 'resume' && method === 'POST') { run.suspended = false; save(); return ok({}); }
      if (action === 'discard' && method === 'POST') { run.finished = true; save(); return ok({}); }
      if (action === 'build' && method === 'GET') return err(404, 'No disponible en local');
      if (action === 'finish' && method === 'POST') {
        if (run.finished) {
          let cached = run.response;
          if (!cached || typeof cached !== 'object') cached = { profile: p, stardust: 0, bonk: 0, tasks: [] };
          if (!cached.record || typeof cached.record !== 'object') {
            cached.record = {
              id: runId, species: 1, finalSpecies: 1, biome: 'forest', tier: 0, stage: 0,
              time: 0, kills: 0, damage: 0, level: 0, victory: false, mode: 'classic', score: 0,
              seed: run.seed, ranked: Boolean(run.ranked),
            };
          }
          return ok(cached);
        }
        const result = body?.result && typeof body.result === 'object' ? body.result : {};
        const response = mergeFinish(acc, run, result);
        run.finished = true;
        run.finishedAt = nowMs();
        run.result = result;
        run.response = response;
        save();
        return ok(response);
      }
    }

    if (route === '/runs/saved' && method === 'GET') return ok({ saved: null });

    if (route === '/tasks/claim' && method === 'POST') {
      applyActions(p, [{ k: 'task', period: body?.period || 'daily', slot: body?.slot }]);
      save(); return ok({ profile: p });
    }
    if (route === '/tasks/reroll' && method === 'POST') { save(); return ok({ profile: p }); }
    if (route === '/quests/claim' && method === 'POST') {
      applyActions(p, [{ k: 'quest', id: body?.id }]); save(); return ok({ profile: p });
    }
    if (route === '/lab/buy' && method === 'POST') {
      applyActions(p, [{ k: 'lab', id: body?.id }]); save(); return ok({ profile: p });
    }
    if (route === '/items/buy' && method === 'POST') {
      applyActions(p, [{ k: 'item', key: body?.key }]); save(); return ok({ profile: p });
    }
    if (route === '/items/archive' && method === 'POST') {
      applyActions(p, [{ k: 'archive', key: body?.key, off: body?.off }]); save(); return ok({ profile: p });
    }
    if (route === '/shop/buy' && method === 'POST') {
      applyActions(p, [{ k: 'shop', id: body?.id, n: body?.n }]); save(); return ok({ profile: p });
    }
    if ((route === '/treasures/spin' || route === '/seasons/claim') && method === 'POST') {
      save(); return ok({ profile: p, spin: null });
    }
    if (route === '/seasons/awards' && method === 'GET') return ok([]);

    if ((route === '/records' || route === '/records/endless') && method === 'GET') return ok([]);
    if (route === '/leaderboard' && method === 'GET') {
      return ok({ rows: [], entries: [], players: 0, cutoff: null, info: seasonInfo(), me: null });
    }
    if (route === '/leaderboard/pokemon' && method === 'GET') return ok({ entries: [] });
    if (route === '/friends' && method === 'GET') return ok({ friends: [], incoming: [], outgoing: [], requests: [] });
    if (route === '/mail' && method === 'GET') return ok([]);
    if (route === '/clans/status' && method === 'GET') return ok({ clan: null, requests: [], invites: [] });
    if (route === '/clans/search' && method === 'GET') return ok({ clans: [], page: 0, pages: 0 });
    if (route === '/clans/board' && method === 'GET') {
      return ok({ rows: [], entries: [], players: 0, cutoff: null, info: seasonInfo() });
    }
    if (route.startsWith('/clans/') && method === 'GET') return err(404, 'No disponible en local');
    if (route.startsWith('/players/search') && method === 'GET') return ok([]);
    if (route.startsWith('/players') && method === 'GET') return ok({ players: [], rows: [] });
    if (route.startsWith('/coop/board') && method === 'GET') return ok({ rows: [], info: null });
    if (route.startsWith('/coop') && method === 'GET') return ok({});
    if (route.startsWith('/mutation') && method === 'GET') return ok({ on: false });
    if (route.startsWith('/events/') && method === 'GET') return ok({});
    if (route.startsWith('/news') && method === 'GET') return ok([]);
    if (route === '/feedback' && method === 'POST') return ok({});
    if (route.startsWith('/players/') && route.endsWith('/report') && method === 'POST') return ok({});

    if (route === '/account/rename' && method === 'GET') return ok({ ok: true, taken: false });
    if (route === '/account/rename' && method === 'POST') {
      const name = String(body?.name || '').trim();
      if (!validTrainerName(name)) return err(400, 'Nombre no válido');
      if (findAccountByName(name)) return err(409, 'Ese nombre ya está en uso');
      acc.name = name;
      p.name = name;
      save();
      return ok({ profile: p, name });
    }
    if (route === '/account/password' && method === 'POST') { save(); return ok({}); }
    if (route === '/account/delete' && method === 'POST') {
      if (body?.confirm !== true) return err(400, 'Confirmación requerida');
      const id = acc.id;
      delete state.accounts[id];
      for (const t of Object.keys(state.tokens)) {
        if (state.tokens[t] === id) delete state.tokens[t];
      }
      save();
      return ok({});
    }
    if (route === '/account/reset' && method === 'POST') {
      if (body?.confirm !== true) return err(400, 'Confirmación requerida');
      acc.profile = newProfile(acc.name);
      save();
      return ok({ profile: acc.profile });
    }

    return ok({});
  }

  return { handle };
}
