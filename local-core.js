import { LAB_TABLE, ITEM_PRICES, QUEST_TABLE, SHOP_TABLE, TASK_DUST } from './tables.js';

export function nowMs() {
  return Date.now();
}

export function dayNumber(ms = nowMs()) {
  return Math.trunc(ms / 86_400_000);
}

const POKEMON = new Map();
const FAMILY = new Map();

export function loadPokemon(rows) {
  POKEMON.clear();
  FAMILY.clear();
  for (const entry of rows) {
    POKEMON.set(Number(entry.id), entry);
    FAMILY.set(Number(entry.id), Number(entry.family || entry.id));
  }
}

export function familyOf(id) {
  return FAMILY.get(Number(id)) ?? Number(id);
}

export function researchGoal(speciesId) {
  const entry = POKEMON.get(Number(speciesId)) || {};
  if (entry.legendary || entry.mythical) return 3;
  const bst = entry.bst || 0;
  return Math.trunc(30 + Math.min(70, bst / 8) + 0.5);
}

// 对应 server.py:268：Python 的 \w 在 str 模式下含全部 Unicode 字母数字
export function validTrainerName(name) {
  return /^[\p{L}\p{N}_ .\-]{2,16}$/u.test(String(name || ''));
}

export function addUnique(target, values) {
  const seen = new Set(target);
  let added = 0;
  for (const v of values || []) {
    if (!seen.has(v)) {
      seen.add(v);
      target.push(v);
      added += 1;
    }
  }
  return added;
}

export function newProfile(name) {
  return {
    v: 1,
    name,
    created: nowMs(),
    stardust: 0,
    totalStardust: 0,
    bonk: 0,
    totalBonk: 0,
    unlocked: [],
    league: [],
    starter: 0,
    forms: [],
    research: {},
    captured: {},
    seen: [],
    played: [],
    shinies: [],
    classics: [],
    skins: [],
    team: [],
    lab: {},
    biomes: { forest: 0 },
    quests: {},
    counters: {},
    runs: [],
    best: {},
    times: {},
    kills: {},
    medals: {},
    endless: {},
    lastSpecies: 4,
    lastBiome: 'forest',
    banished: [],
    itemsOwned: [],
    itemsOff: [],
    dailyStreak: { last: 0, n: 0 },
    bag: {},
    avatar: '',
    frame: '',
    title: '',
    banner: '',
    cosmetics: [],
  };
}

function grantDust(p, amount) {
  p.stardust = Number(p.stardust || 0) + Number(amount);
  p.totalStardust = Math.max(Number(p.totalStardust || 0), p.stardust);
}

function grantBagItem(p, key, count = 1) {
  if (!p.bag || typeof p.bag !== 'object') p.bag = {};
  p.bag[key] = Math.min(9, Number(p.bag[key] || 0) + count);
}

export function sanitizeProfileSnapshot(snap) {
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return null;
  const keys = Object.keys(snap);
  if (keys.length === 0 || keys.length > 240) return null;
  let text;
  try {
    text = JSON.stringify(snap);
  } catch {
    return null;
  }
  if (text.length > 2_000_000) return null;
  try {
    const clean = JSON.parse(text);
    return clean && typeof clean === 'object' && !Array.isArray(clean) ? clean : null;
  } catch {
    return null;
  }
}

export function applyProfileSnapshot(p, snap) {
  const clean = sanitizeProfileSnapshot(snap);
  if (clean === null) return false;
  const name = p.name;
  const created = p.created;
  for (const key of Object.keys(p)) delete p[key];
  Object.assign(p, clean);
  if (typeof p.name !== 'string' || !p.name) p.name = name || 'Entrenador';
  if (!Number.isInteger(p.created)) p.created = created || nowMs();
  const defaults = [
    ['stardust', 0], ['totalStardust', 0], ['bonk', 0], ['totalBonk', 0],
    ['lab', {}], ['quests', {}], ['counters', {}], ['itemsOwned', []],
    ['itemsOff', []], ['bag', {}], ['cosmetics', []],
  ];
  for (const [key, fallback] of defaults) {
    const value = p[key];
    const ok = Array.isArray(fallback)
      ? Array.isArray(value)
      : fallback !== null && typeof fallback === 'object'
        ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : typeof value === typeof fallback;
    if (!ok) p[key] = structuredClone(fallback);
  }
  return true;
}

export function applyActions(p, actions) {
  if (!Array.isArray(actions)) return;
  for (const action of actions.slice(0, 200)) {
    if (!action || typeof action !== 'object') continue;
    const kind = action.k;
    if (kind === 'lab') {
      const lid = String(action.id || '');
      const entry = LAB_TABLE[lid];
      if (!entry) continue;
      const [maxLevel, costs] = entry;
      if (!p.lab || typeof p.lab !== 'object') p.lab = {};
      const level = Number(p.lab[lid] || 0);
      if (level >= maxLevel || level >= costs.length) continue;
      const cost = costs[level];
      if (Number(p.stardust || 0) < cost) continue;
      p.stardust = Number(p.stardust) - cost;
      p.lab[lid] = level + 1;
    } else if (kind === 'item') {
      const key = String(action.key || '');
      const price = ITEM_PRICES[key];
      if (!Array.isArray(p.itemsOwned)) p.itemsOwned = [];
      if (price === undefined || p.itemsOwned.includes(key) || Number(p.stardust || 0) < price) continue;
      p.stardust = Number(p.stardust) - price;
      p.itemsOwned.push(key);
    } else if (kind === 'archive') {
      const key = String(action.key || '');
      const off = Boolean(action.off);
      if (!Array.isArray(p.itemsOff)) p.itemsOff = [];
      if (off && !p.itemsOff.includes(key)) p.itemsOff.push(key);
      else if (!off) p.itemsOff = p.itemsOff.filter((k) => k !== key);
    } else if (kind === 'shop') {
      const sid = String(action.id || '');
      const index = action.n;
      const entry = SHOP_TABLE[sid];
      if (!entry || !Number.isInteger(index) || index < 0) continue;
      const [base, daily] = entry;
      if (index >= daily) continue;
      const price = Math.trunc(Math.floor(base * (1 + 0.5 * index) + 0.5));
      if (Number(p.stardust || 0) < price) continue;
      p.stardust = Number(p.stardust) - price;
      grantBagItem(p, sid);
      if (!p.shop || typeof p.shop !== 'object') p.shop = {};
      if (!p.shop.n || typeof p.shop.n !== 'object') p.shop.n = {};
      p.shop.n[sid] = Number(p.shop.n[sid] || 0) + 1;
    } else if (kind === 'quest') {
      const qid = String(action.id || '');
      const entry = QUEST_TABLE[qid];
      if (!entry) continue;
      if (!p.quests || typeof p.quests !== 'object') p.quests = {};
      if (p.quests[qid]) continue;
      p.quests[qid] = nowMs();
      const [reward, title] = entry;
      grantDust(p, reward);
      if (!Array.isArray(p.cosmetics)) p.cosmetics = [];
      if (title && !p.cosmetics.includes(`title:q:${qid}`)) p.cosmetics.push(`title:q:${qid}`);
    } else if (kind === 'task') {
      const period = String(action.period || '');
      const slot = action.slot;
      if (!(period in TASK_DUST) || !Number.isInteger(slot) || slot < 0 || slot > 3) continue;
      if (!p[period] || typeof p[period] !== 'object') p[period] = {};
      const bucket = p[period];
      const claimed = Array.isArray(bucket.claimed) ? bucket.claimed : [0, 0, 0, 0];
      bucket.claimed = claimed;
      while (claimed.length < 4) claimed.push(0);
      if (claimed[slot]) continue;
      if (slot < 3) {
        claimed[slot] = 1;
        grantDust(p, TASK_DUST[period][slot]);
      } else {
        if (![0, 1, 2].every((i) => claimed[i])) continue;
        claimed[3] = 1;
        if (period === 'weekly') grantDust(p, 500);
        else {
          const streak = p.dailyStreak && typeof p.dailyStreak === 'object' ? p.dailyStreak : {};
          grantDust(p, 50 * Math.min(5, Number(streak.n || 0)));
        }
      }
    }
  }
}

function toInt(value, fallback = 0) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function mergeFinish(acc, run, result) {
  const p = acc.profile;
  const progress = result.progress || {};

  for (const [key, value] of Object.entries(progress.counters || {})) {
    const add = Number(value);
    if (!Number.isFinite(add)) continue;
    if (!p.counters || typeof p.counters !== 'object') p.counters = {};
    p.counters[key] = toInt(p.counters[key]) + toInt(add);
  }

  for (const [key, value] of Object.entries(progress.research || {})) {
    const sid = Number.parseInt(key, 10);
    if (!Number.isFinite(sid)) continue;
    const goal = researchGoal(sid);
    if (!p.research || typeof p.research !== 'object') p.research = {};
    const cur = Number(p.research[String(sid)] || 0);
    p.research[String(sid)] = Math.min(goal, cur + Number(value || 0));
  }

  if (!Array.isArray(p.seen)) p.seen = [];
  if (!Array.isArray(p.shinies)) p.shinies = [];
  if (!Array.isArray(p.classics)) p.classics = [];
  if (!Array.isArray(p.forms)) p.forms = [];
  if (!Array.isArray(p.skins)) p.skins = [];
  addUnique(p.seen, progress.seen);
  const newShiny = addUnique(p.shinies, progress.shinies);
  const newClassic = addUnique(p.classics, progress.classics);
  const newForm = addUnique(p.forms, progress.forms);
  addUnique(p.skins, progress.skins);

  if (!Array.isArray(p.league)) p.league = [];
  if (!Array.isArray(p.unlocked)) p.unlocked = [];
  if (!p.captured || typeof p.captured !== 'object') p.captured = {};
  const leagueBefore = new Set(p.league);
  let newLeague = 0;
  for (const raw of progress.league || []) {
    const sid = toInt(raw);
    const family = familyOf(sid);
    if (!leagueBefore.has(sid)) {
      newLeague += 1;
      leagueBefore.add(sid);
    }
    if (!p.league.includes(sid)) p.league.push(sid);
    if (!p.unlocked.includes(family)) p.unlocked.push(family);
    if (p.captured[String(family)] === undefined) p.captured[String(family)] = nowMs();
  }

  if ((!progress.league || progress.league.length === 0) && Array.isArray(result.league)) {
    for (const raw of result.league) {
      const sid = toInt(raw);
      if (!p.league.includes(sid)) {
        p.league.push(sid);
        newLeague += 1;
      }
      const family = familyOf(sid);
      if (!p.unlocked.includes(family)) p.unlocked.push(family);
      if (p.captured[String(family)] === undefined) p.captured[String(family)] = nowMs();
    }
  }

  const species = toInt(result.species || 1);
  const finalSpecies = toInt(result.finalSpecies || species);
  if (!Array.isArray(p.played)) p.played = [];
  if (!p.played.includes(species)) p.played.push(species);

  const tier = Math.max(0, Math.min(2, toInt(result.tier)));
  const biome = String(result.biome || 'forest');
  const mode = String(result.mode || 'classic');
  const duration = Number(result.time || 0);
  const kills = Math.max(0, toInt(result.kills));
  const stage = Math.max(0, toInt(result.stage));
  const victory = Boolean(result.victory);
  const bosses = Math.max(0, toInt(result.bosses));
  const legendaries = Math.max(0, toInt(result.legendaries));
  const alphas = Math.max(0, toInt(result.alphas));
  const level = Math.max(0, toInt(result.level));
  const damage = Math.max(0, toInt(result.damage));

  let base = 30 + kills * 2 + Math.trunc(duration) * 3 + stage * 150 + bosses * 120;
  base += legendaries * 250 + alphas * 80 + level * 20;
  const bonus = newLeague * 250 + newShiny * 800 + newClassic * 400 + newForm * 100;
  if (victory) base = base * 1.25 + 2000;
  const tierMult = [1.0, 1.5, 2.5][tier];
  const dust = Math.max(10, Math.trunc(base * tierMult)) + bonus;
  const bonk = Math.trunc(kills / 12) + stage * 3 + bosses * 8 + (victory ? 25 : 0);

  p.stardust = Math.max(0, toInt(p.stardust)) + dust;
  p.totalStardust = Math.max(p.stardust, toInt(p.totalStardust) + dust);
  p.bonk = Math.max(0, toInt(p.bonk)) + bonk;
  p.totalBonk = Math.max(p.bonk, toInt(p.totalBonk) + bonk);

  const date = nowMs();
  const record = {
    id: run.id || '',
    species,
    finalSpecies,
    date,
    biome,
    tier,
    stage,
    time: round1(duration),
    kills,
    damage,
    level,
    victory,
    mode,
    score: toInt(kills * 10 + duration * 2 + stage * 200 + (victory ? 1000 : 0)),
    seed: run.seed ?? null,
    ranked: Boolean(run.ranked),
  };
  if (victory || duration >= 60) {
    if (!Array.isArray(p.runs)) p.runs = [];
    p.runs.unshift(record);
    p.runs.length = Math.min(p.runs.length, 100);
  }

  const key = `${biome}-${tier}`;
  const splits = result.splits || [];
  if (!p.times || typeof p.times !== 'object') p.times = {};
  const oldTime = p.times[key] && p.times[key].time;
  if (oldTime === undefined || oldTime === null || duration < oldTime) {
    p.times[key] = {
      time: round1(duration),
      splits,
      date,
      species,
      victory,
    };
  }
  if (!p.kills || typeof p.kills !== 'object') p.kills = {};
  p.kills[key] = Math.max(toInt(p.kills[key]), kills);

  if (duration > 0) {
    const r = 1 + tier * 0.05;
    const thresholds = [Infinity, 1260 * r, 900 * r, 630 * r];
    let medal = 0;
    thresholds.forEach((threshold, idx) => {
      if (duration <= threshold) medal = idx + 1;
    });
    if (!p.medals || typeof p.medals !== 'object') p.medals = {};
    p.medals[key] = Math.max(toInt(p.medals[key]), medal);
  }

  if (victory) {
    if (!p.biomes || typeof p.biomes !== 'object') p.biomes = {};
    p.biomes[biome] = Math.max(toInt(p.biomes[biome]), Math.max(1, splits.length || 1));
  }

  p.lastSpecies = finalSpecies;
  p.lastBiome = biome;

  const day = dayNumber(date);
  if (!p.dailyStreak || typeof p.dailyStreak !== 'object') p.dailyStreak = { last: 0, n: 0 };
  const streak = p.dailyStreak;
  if (streak.last !== day) {
    streak.n = streak.last === day - 1 ? toInt(streak.n) + 1 : 1;
    streak.last = day;
  }

  return {
    profile: p,
    stardust: dust,
    bonk,
    tasks: [],
    record,
    ranked: true,
    guest: Boolean(acc.guest),
    review: false,
    reason: null,
    kills: {
      season: 3, week: null, all: null,
      playersWeek: 0, playersAll: 0,
      live: true, cutoff: null,
      ends: nowMs() + 2 * 86_400_000, dust: 1, paid: true,
    },
    weekPb: false, killsPb: false,
    prevKills: null, prevBest: null, pb: false,
    medal: 0, medalDust: 0,
    mon: null, clan: null,
  };
}
