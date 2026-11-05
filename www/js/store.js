/* Folio — état de l'appli (localStorage) et cache des couvertures / pages (IndexedDB). */
(function () {
  const KEY = 'folio.v1';

  const DEFAULT_SETTINGS = {
    theme: 'papier',          // papier | sepia | ardoise | nuit
    font: 'Literata',         // Literata | Source Serif | Atkinson Hyperlegible | origine
    size: 20,                 // px
    lineHeight: 1.6,
    margin: 'm',              // s | m | l
    justify: true,
    hyphens: true,
    flow: 'paginated'         // paginated | scrolled
  };

  const DEFAULT_PREFS = {
    tapMode: 'normal',        // normal | inverse | next
    tapLock: false,
    volumeKeys: false,
    keepAwake: true,
    uiTheme: 'follow',        // follow | papier
    brightness: -1,           // -1 = luminosité du système
    warmth: 0,                // 0..1
    goal: 0,                  // minutes par jour, 0 = pas d'objectif
    sort: 'recent',
    footer: 'pages',          // pages | time (bas de page en lecture)
    kindle: { to: '', from: '', host: 'smtp.gmail.com', port: 587, hasPassword: false }
  };

  function fresh() {
    return {
      books: {},
      collections: [],
      annotations: [],
      bookmarks: [],
      stats: { days: {}, speed: 1.3, bestStreak: 0, finished: {} },
      settings: Object.assign({}, DEFAULT_SETTINGS),
      bookSettings: {},
      prefs: JSON.parse(JSON.stringify(DEFAULT_PREFS))
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return fresh();
      return merge(JSON.parse(raw));
    } catch (e) {
      return fresh();
    }
  }

  function merge(data) {
    const base = fresh();
    const s = Object.assign(base, data || {});
    s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
    s.prefs = Object.assign(JSON.parse(JSON.stringify(DEFAULT_PREFS)), s.prefs || {});
    s.prefs.kindle = Object.assign({}, DEFAULT_PREFS.kindle, s.prefs.kindle || {});
    s.stats = Object.assign({ days: {}, speed: 1.3, bestStreak: 0, finished: {} }, s.stats || {});
    s.books = s.books || {};
    s.collections = s.collections || [];
    s.annotations = s.annotations || [];
    s.bookmarks = s.bookmarks || [];
    s.bookSettings = s.bookSettings || {};
    return s;
  }

  const state = load();
  let saveTimer = null;

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Sauvegarde impossible', e);
    }
  }

  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(saveNow, 250);
  }

  // ---------- IndexedDB (couvertures, pages calculées, fichiers en mode navigateur) ----------
  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('folio', 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          ['covers', 'locations', 'files'].forEach((n) => {
            if (!d.objectStoreNames.contains(n)) d.createObjectStore(n);
          });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function idbGet(store, key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const r = d.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function idbSet(store, key, value) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDel(store, key) {
    const d = await db();
    return new Promise((resolve) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  // ---------- Outils ----------
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function dayKey(d) {
    d = d || new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function settingsFor(bookId) {
    return state.bookSettings[bookId] ? Object.assign({}, state.settings, state.bookSettings[bookId]) : state.settings;
  }

  function exportData() {
    return JSON.stringify({ app: 'folio', version: 1, exportedAt: new Date().toISOString(), data: state }, null, 1);
  }

  function importData(text) {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.app !== 'folio' || !parsed.data) throw new Error('Ce fichier n\'est pas une sauvegarde Folio.');
    const incoming = merge(parsed.data);
    // On garde les chemins des livres déjà présents sur ce téléphone
    Object.keys(incoming.books).forEach((id) => {
      if (state.books[id]) incoming.books[id].path = state.books[id].path;
      else incoming.books[id].missing = true;
    });
    Object.keys(state.books).forEach((id) => {
      if (!incoming.books[id]) incoming.books[id] = state.books[id];
    });
    Object.keys(state).forEach((k) => delete state[k]);
    Object.assign(state, incoming);
    saveNow();
  }

  window.Store = {
    state, save, saveNow, uid, dayKey, settingsFor,
    DEFAULT_SETTINGS, DEFAULT_PREFS,
    idbGet, idbSet, idbDel,
    exportData, importData
  };
})();
