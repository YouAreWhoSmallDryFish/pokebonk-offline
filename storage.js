const EMPTY = () => ({ accounts: {}, tokens: {}, runs: {} });

export function normalizeState(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return EMPTY();
  return {
    accounts: data.accounts && typeof data.accounts === 'object' && !Array.isArray(data.accounts) ? data.accounts : {},
    tokens: data.tokens && typeof data.tokens === 'object' && !Array.isArray(data.tokens) ? data.tokens : {},
    runs: data.runs && typeof data.runs === 'object' && !Array.isArray(data.runs) ? data.runs : {},
  };
}

export function createMemoryStorage(seed = null) {
  let main = seed ? JSON.stringify(seed) : null;
  let backup = null;
  return {
    async load() {
      for (const raw of [main, backup]) {
        if (!raw) continue;
        try {
          return normalizeState(JSON.parse(raw));
        } catch {
          /* 继续尝试备份 */
        }
      }
      return EMPTY();
    },
    async save(state) {
      backup = main;
      main = JSON.stringify(state);
    },
    async corruptMain() {
      main = '{broken';
    },
  };
}

export function createIdbStorage({ dbName = 'pokebonk', storeName = 'state' } = {}) {
  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function read(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  async function write(key, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    async load() {
      try {
        const main = await read('state');
        if (main) return normalizeState(JSON.parse(main));
      } catch { /* 落到备份 */ }
      try {
        const backup = await read('state.bak');
        if (backup) return normalizeState(JSON.parse(backup));
      } catch { /* 使用空档 */ }
      return EMPTY();
    },
    async save(state) {
      const prev = await read('state').catch(() => null);
      if (prev) await write('state.bak', prev);
      await write('state', JSON.stringify(state));
    },
  };
}

export function createCapacitorStorage(Filesystem, { dir = 'DATA', file = 'state.json' } = {}) {
  const bak = `${file}.bak`;

  async function read(name) {
    try {
      const res = await Filesystem.readFile({ path: name, directory: dir, encoding: 'utf8' });
      return res.data;
    } catch {
      return null;
    }
  }

  return {
    async load() {
      for (const name of [file, bak]) {
        const raw = await read(name);
        if (!raw) continue;
        try {
          return normalizeState(JSON.parse(raw));
        } catch { /* 尝试下一个 */ }
      }
      return EMPTY();
    },
    async save(state) {
      const prev = await read(file);
      if (prev) {
        await Filesystem.writeFile({ path: bak, directory: dir, data: prev, encoding: 'utf8' }).catch(() => {});
      }
      await Filesystem.writeFile({
        path: file,
        directory: dir,
        data: JSON.stringify(state),
        encoding: 'utf8',
      });
    },
  };
}
