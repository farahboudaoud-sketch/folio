/* Folio — lecteur EPUB (epub.js) : pages, menu, sommaire, recherche, affichage, surlignage, temps de lecture. */
(function () {
  const S = Store.state;
  const esc = (s) => UI.esc(s);
  const icon = (n, s) => UI.icon(n, s);

  const THEMES = {
    papier: { bg: '#F6F1E7', fg: '#2A2622', accent: '#2F5D50', sel: 'rgba(47,93,80,0.22)', dark: false, label: 'Papier' },
    sepia: { bg: '#F1E4C8', fg: '#3B2F1E', accent: '#2F5D50', sel: 'rgba(47,93,80,0.22)', dark: false, label: 'Sépia' },
    ardoise: { bg: '#2E3034', fg: '#E4E2DD', accent: '#8FC1AE', sel: 'rgba(143,193,174,0.3)', dark: true, label: 'Ardoise' },
    nuit: { bg: '#000000', fg: '#D9D3C7', accent: '#8FC1AE', sel: 'rgba(143,193,174,0.3)', dark: true, label: 'Nuit' }
  };
  const FONTS = [
    ['Literata', 'Literata', 'Georgia, serif'],
    ['Source Serif', 'Source Serif', 'Georgia, serif'],
    ['Atkinson Hyperlegible', 'Atkinson', 'system-ui, sans-serif'],
    ['origine', 'Du livre', '']
  ];
  const MARGINS = { s: 14, m: 26, l: 46 };

  let R = null; // session de lecture en cours

  // ---------- Styles injectés dans le livre ----------
  function bookCSS(s) {
    const th = THEMES[s.theme] || THEMES.papier;
    const f = FONTS.find((x) => x[0] === s.font);
    const family = f && f[0] !== 'origine' ? `'${f[0]}', ${f[2]}` : null;
    const align = s.justify ? 'justify' : 'left';
    const hy = s.hyphens ? 'auto' : 'manual';
    const pad = s.flow === 'scrolled' ? `body { padding: 24px ${MARGINS[s.margin] || 26}px 80px !important; }` : '';
    return `
      html { background: ${th.bg} !important; -webkit-text-size-adjust: 100%; }
      body { color: ${th.fg} !important; background: transparent !important; font-size: ${s.size}px !important; line-height: ${s.lineHeight} !important;
        text-align: ${align}; -webkit-hyphens: ${hy} !important; hyphens: ${hy} !important; -webkit-user-select: text; user-select: text;
        ${family ? `font-family: ${family} !important;` : ''} }
      body * { color: inherit !important; background-color: transparent !important; line-height: inherit !important; ${family ? 'font-family: inherit !important;' : ''} }
      p:not([class*="center"]):not([class*="centre"]):not([class*="right"]):not([align]), li, blockquote { text-align: ${align} !important; }
      a, a * { color: ${th.accent} !important; }
      img, svg { max-width: 100% !important; height: auto; }
      ::selection { background: ${th.sel}; }
      ${pad}`;
  }

  function injectStyle(contents) {
    const doc = contents.document;
    if (!doc || !doc.head) return;
    if (!doc.getElementById('folio-fonts')) {
      const link = doc.createElement('link');
      link.id = 'folio-fonts';
      link.rel = 'stylesheet';
      link.href = new URL('fonts/fonts.css', location.href).href;
      doc.head.appendChild(link);
    }
    let st = doc.getElementById('folio-style');
    if (!st) { st = doc.createElement('style'); st.id = 'folio-style'; doc.head.appendChild(st); }
    st.textContent = bookCSS(R.settings);
  }

  // ---------- Ouverture ----------
  async function open(id, targetCfi) {
    if (R) close();
    const b = S.books[id];
    if (!b) return;
    if (b.missing) { UI.openDetail(id); return; }
    UI.closeOverlays();

    const root = document.createElement('div');
    root.id = 'reader';
    root.innerHTML = `<div class="reader-head" id="rh"></div><div id="viewer"></div>
      <button class="reader-foot" id="rfoot" aria-label="Changer l\'affichage : pages ou temps restant"><span id="rf-l"></span><span id="rf-r"></span></button>
      <div id="edge" aria-hidden="true"></div><div id="warm" hidden></div><div id="dim" hidden></div>
      <div class="loading" id="rload">Ouverture…</div>`;
    document.body.appendChild(root);

    R = {
      id, book: b, root, settings: Store.settingsFor(id), epub: null, rendition: null,
      location: null, chapters: [], flat: [], spineStart: {}, total: 0, menu: null, pop: null,
      lastActivity: Date.now(), prevLoc: null, prevT: 0, lastTouch: 0, closers: [], timer: null
    };
    R.removeBack = UI.pushBack(() => close());
    applyTheme();
    applyLight();
    refreshBrightness();
    Native.keepAwake(S.prefs.keepAwake);
    Native.setVolumeKeys(S.prefs.volumeKeys);

    let buf;
    try {
      buf = await Native.readBook(b.path);
      R.epub = ePub(buf);
      await R.epub.ready;
    } catch (e) {
      close();
      UI.alertDialog('Impossible d\'ouvrir ce livre', 'Le fichier est introuvable ou abîmé. Tu peux le retirer et l\'ajouter à nouveau.');
      return;
    }
    if (!R || R.id !== id) return;

    const now = Date.now();
    if (!b.startedAt) b.startedAt = now;
    b.openedAt = now;
    Store.save();

    await buildToc();
    await build(targetCfi || b.cfi || undefined);
    loadLocations();
    bindEdge();
    R.root.querySelector('#rfoot').onclick = () => {
      S.prefs.footer = S.prefs.footer === 'time' ? 'pages' : 'time';
      Store.save();
      updateFooter();
    };
    R.timer = setInterval(tick, 10000);
  }

  async function build(cfi) {
    const s = R.settings;
    const viewer = R.root.querySelector('#viewer');
    if (R.rendition) { try { R.rendition.destroy(); } catch (e) { /* rien */ } }
    viewer.innerHTML = '';
    const scrolled = s.flow === 'scrolled';
    viewer.className = scrolled ? 'scrolled' : '';
    R.root.querySelector('.reader-foot').hidden = scrolled;
    R.root.querySelector('#rh').hidden = scrolled;
    const opts = {
      width: '100%', height: '100%', spread: 'none', allowScriptedContent: false,
      flow: scrolled ? 'scrolled' : 'paginated', manager: scrolled ? 'continuous' : 'default'
    };
    if (!scrolled) opts.gap = (MARGINS[s.margin] || 26) * 2;
    const rendition = R.epub.renderTo(viewer, opts);
    R.rendition = rendition;
    rendition.hooks.content.register((contents) => { injectStyle(contents); attachTouch(contents); });
    rendition.on('relocated', onRelocated);
    rendition.on('selected', onSelected);
    rendition.on('markClicked', () => {});
    try {
      await rendition.display(cfi);
    } catch (e) {
      await rendition.display();
    }
    const l = R.root.querySelector('#rload');
    if (l) l.remove();
    drawMarks();
  }

  function close() {
    if (!R) return;
    const r = R;
    R = null;
    clearInterval(r.timer);
    r.closers.slice().forEach((fn) => fn());
    try { if (r.rendition) r.rendition.destroy(); } catch (e) { /* rien */ }
    try { if (r.epub) r.epub.destroy(); } catch (e) { /* rien */ }
    r.root.remove();
    r.removeBack();
    Native.keepAwake(false);
    Native.setBrightness(-1);
    Native.setVolumeKeys(false);
    Store.saveNow();
    UI.render();
  }

  // ---------- Sommaire et pages ----------
  function sectionFor(href) {
    if (!href) return null;
    const clean = href.split('#')[0];
    let sec = R.epub.spine.get(clean);
    if (!sec) {
      const name = decodeURIComponent(clean).split('/').pop();
      sec = R.epub.spine.spineItems.find((it) => decodeURIComponent(it.href).split('/').pop() === name) || null;
    }
    return sec;
  }

  async function buildToc() {
    let toc = [];
    try { const nav = await R.epub.loaded.navigation; toc = nav.toc || []; } catch (e) { /* pas de sommaire */ }
    const flat = [];
    const walk = (items, depth) => items.forEach((it) => {
      const sec = sectionFor(it.href);
      flat.push({ label: (it.label || '').trim() || 'Sans titre', href: it.href, depth, spine: sec ? sec.index : -1 });
      if (it.subitems && it.subitems.length) walk(it.subitems, depth + 1);
    });
    walk(toc, 0);
    R.flat = flat;
    R.chapters = flat.filter((c) => c.spine >= 0).slice().sort((a, b) => a.spine - b.spine);
  }

  function chapterAt(spineIndex) {
    let cur = null;
    for (const c of R.chapters) { if (c.spine <= spineIndex) cur = c; else break; }
    return cur;
  }

  async function loadLocations() {
    const r = R;
    const ep = r.epub;
    try {
      const cached = await Store.idbGet('locations', r.id);
      if (cached) ep.locations.load(cached);
      else {
        await ep.locations.generate(1024);
        if (R !== r) return;
        Store.idbSet('locations', r.id, ep.locations.save());
      }
    } catch (e) {
      return;
    }
    if (R !== r) return;
    r.total = ep.locations.length();
    r.book.pages = r.total;
    const starts = {};
    (ep.locations._locations || []).forEach((cfi, i) => {
      try {
        const sp = new ePub.CFI(cfi).spinePos;
        if (starts[sp] === undefined) starts[sp] = i;
      } catch (e) { /* rien */ }
    });
    r.spineStart = starts;
    const loc = r.rendition.currentLocation();
    if (loc && loc.start) onRelocated(loc);
    if (r.menu) refreshMenu();
  }

  function locIndex(location) {
    if (!R.total || !location || !location.start) return null;
    const i = R.epub.locations.locationFromCfi(location.start.cfi);
    return typeof i === 'number' && i >= 0 ? i : null;
  }

  function startOfSpine(sp) {
    if (R.spineStart[sp] !== undefined) return R.spineStart[sp];
    const keys = Object.keys(R.spineStart).map(Number).filter((k) => k >= sp).sort((a, b) => a - b);
    return keys.length ? R.spineStart[keys[0]] : R.total;
  }

  function chapterInfo(location) {
    const sp = location && location.start ? location.start.index : 0;
    const ch = chapterAt(sp);
    const idx = locIndex(location);
    let left = null;
    if (idx !== null) {
      const next = R.chapters.find((c) => c.spine > (ch ? ch.spine : sp));
      const end = next ? startOfSpine(next.spine) : R.total;
      const pages = Math.max(0, end - idx - 1);
      left = Math.max(1, Math.round(pages / (S.stats.speed || 1.3)));
    }
    return { ch, idx, left };
  }

  function fmtLeft(min) {
    if (min === null) return '';
    if (min < 60) return min + ' min dans le chapitre';
    return UI.fmtDur(min * 60) + ' dans le chapitre';
  }

  function onRelocated(location) {
    if (!R || !location || !location.start) return;
    R.location = location;
    const b = R.book;
    const now = Date.now();
    R.lastActivity = now;
    const { ch, idx, left } = chapterInfo(location);
    b.cfi = location.start.cfi;
    if (R.total && idx !== null) b.pct = Math.min(1, (idx + 1) / R.total);
    else if (typeof location.start.percentage === 'number' && location.start.percentage > 0) b.pct = location.start.percentage;
    b.chapter = ch ? ch.label : '';
    b.chapterLeft = fmtLeft(left);
    b.openedAt = now;

    // Vitesse de lecture (pages / minute), pour estimer le temps restant
    if (idx !== null) {
      if (R.prevLoc !== null) {
        const d = idx - R.prevLoc;
        const dt = (now - R.prevT) / 60000;
        if (d >= 1 && d <= 3 && dt > 0.12 && dt < 10) {
          const sample = Math.min(6, Math.max(0.2, d / dt));
          S.stats.speed = (S.stats.speed || 1.3) * 0.9 + sample * 0.1;
        }
      }
      R.prevLoc = idx; R.prevT = now;
    }

    if (location.atEnd && !b.finishedAt) {
      b.finishedAt = now;
      b.pct = 1;
      UI.toast('Livre terminé. Bravo !', 3500);
    }
    Store.save();

    const head = R.root.querySelector('#rh');
    if (head) head.textContent = b.chapter || b.title;
    updateFooter();
    if (R.back && R.back.shownAt && now - R.back.shownAt > 1500 && idx !== null && R.back.page && Math.abs(idx + 1 - R.back.page) <= 1) clearBack();
    if (R.menu) refreshMenu();
  }


  // Bas de page : « p. 12 / 380 · 37 % » ou « 12 min dans le chapitre · 2 h 10 dans le livre » (un tap pour changer)
  function fmtMin(min) { return min < 60 ? min + ' min' : UI.fmtDur(min * 60); }
  function updateFooter() {
    if (!R) return;
    const fl = R.root.querySelector('#rf-l');
    const fr = R.root.querySelector('#rf-r');
    if (!fl || !fr) return;
    const { idx, left } = chapterInfo(R.location);
    if (idx === null) { fl.textContent = R.total ? '' : 'Calcul des pages…'; fr.textContent = ''; return; }
    if (S.prefs.footer === 'time') {
      const speed = S.stats.speed || 1.3;
      const bookLeft = Math.max(1, Math.round((R.total - idx - 1) / speed));
      fl.textContent = fmtMin(left) + ' dans le chapitre';
      fr.textContent = fmtMin(bookLeft) + ' dans le livre';
    } else {
      fl.textContent = `p. ${idx + 1} / ${R.total}`;
      fr.textContent = Math.round((R.book.pct || 0) * 100) + ' %';
    }
  }

  // ---------- Retour à la position d'avant un saut (barre de progression, sommaire, recherche…) ----------
  function jumpTo(target) {
    if (!R) return Promise.resolve();
    const from = R.location ? { cfi: R.location.start.cfi, page: (locIndex(R.location) ?? -1) + 1 } : null;
    return R.rendition.display(target).then(() => { if (from) showBack(from); });
  }

  function showBack(from) {
    if (!R) return;
    R.back = { cfi: from.cfi, page: from.page > 0 ? from.page : null, shownAt: Date.now() };
    clearTimeout(R.backTimer);
    R.backTimer = setTimeout(clearBack, 20000);
    renderBack();
  }

  function clearBack() {
    if (!R) return;
    R.back = null;
    clearTimeout(R.backTimer);
    renderBack();
  }

  function goBack() {
    if (!R || !R.back) return;
    const cfi = R.back.cfi;
    R.back = null;
    renderBack();
    R.rendition.display(cfi);
  }

  function renderBack() {
    if (!R) return;
    const old = R.root.querySelector('.back-pill');
    if (old) old.remove();
    if (!R.back) { if (R.menu) refreshMenu(); return; }
    const label = R.back.page ? 'Revenir à la page ' + R.back.page : 'Revenir où j\'en étais';
    const btn = document.createElement('button');
    btn.className = 'back-pill' + (R.menu ? ' in-menu' : '');
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/></svg>${esc(label)}`;
    btn.onclick = (e) => { e.stopPropagation(); goBack(); };
    R.root.appendChild(btn);
  }

  // ---------- Luminosité : celle du téléphone (le curseur du volet de notifications reste utilisable) ----------
  const Light = { value: 0.6, auto: false, allowed: false };
  let bPending = null; let bTimer = null; let askedAt = 0;
  async function refreshBrightness() {
    const b = await Native.getBrightness();
    Object.assign(Light, b);
    if (R && R.menu) syncBrightSlider();
    return Light;
  }

  function askBrightnessPermission() {
    if (Date.now() - askedAt < 4000 || document.querySelector('.scrim.center')) return;
    askedAt = Date.now();
    UI.confirmDialog('Autoriser Folio à régler la luminosité ?',
      'Android demande une autorisation (« Modifier les paramètres système ») pour que Folio change la luminosité du téléphone. Le curseur de ton volet de notifications continuera de fonctionner normalement.',
      'Autoriser').then((ok) => { if (ok) Native.openBrightnessPermission(); });
  }

  // On demande toujours à Android (et non à une valeur gardée en mémoire) si Folio a l'autorisation :
  // elle peut avoir été donnée entre-temps dans les réglages.
  function setBrightness(v) {
    v = Math.min(1, Math.max(0.02, v));
    Light.value = v; Light.auto = false;
    if (!Native.isNative) { applyLight(); return; }
    bPending = v;
    if (bTimer) return;
    bTimer = setTimeout(async () => {
      bTimer = null;
      const ok = await Native.setBrightness(bPending);
      Light.allowed = ok;
      if (!ok) askBrightnessPermission();
    }, 50);
  }

  async function setAuto(on) {
    if (!Native.isNative) { Light.auto = on; return true; }
    const ok = await Native.setAutoBrightness(on);
    Light.allowed = ok;
    if (ok) Light.auto = on; else askBrightnessPermission();
    return ok;
  }

  function syncBrightSlider() {
    if (!R || !R.menu) return;
    const r = R.menu.top.querySelector('[data-r="bright"]');
    const a = R.menu.top.querySelector('[data-a="auto"]');
    if (r && document.activeElement !== r) r.value = String(Math.round(Light.value * 100));
    if (a) a.setAttribute('aria-pressed', String(!!Light.auto));
  }

  // ---------- Temps de lecture ----------
  function tick() {
    if (!R || document.hidden) return;
    if (Date.now() - R.lastActivity > 120000) return;
    const key = Store.dayKey();
    S.stats.days[key] = (S.stats.days[key] || 0) + 10;
    R.book.timeSec = (R.book.timeSec || 0) + 10;
    Store.save();
    UI.syncWidget();
  }

  // ---------- Gestes ----------
  function hasSelection(win) {
    const sel = win.getSelection();
    return !!(sel && !sel.isCollapsed && sel.toString().trim());
  }

  function attachTouch(contents) {
    const doc = contents.document;
    const win = contents.window;
    let t0 = null;
    const frameLeft = () => { const f = win.frameElement; return f ? f.getBoundingClientRect().left : 0; };
    doc.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      t0 = { x: t.clientX, y: t.clientY, time: Date.now(), n: e.touches.length };
    }, { passive: true });
    doc.addEventListener('touchend', (e) => {
      if (!R || !t0) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - t0.x; const dy = t.clientY - t0.y; const dt = Date.now() - t0.time;
      const multi = t0.n > 1;
      t0 = null;
      R.lastTouch = Date.now();
      R.lastActivity = Date.now();
      if (multi || hasSelection(win)) return;
      if (R.settings.flow !== 'scrolled' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 900) {
        if (R.menu || R.pop) { closeMenu(); closePop(); return; }
        if (dx < 0) next(); else prev();
        return;
      }
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 450) {
        if (e.target && e.target.closest && e.target.closest('a[href]')) return;
        tap(frameLeft() + t.clientX);
      }
    });
    doc.addEventListener('click', (e) => {
      if (!R || Date.now() - R.lastTouch < 800) return;
      if (e.target && e.target.closest && e.target.closest('a[href]')) return;
      if (hasSelection(win)) return;
      tap(frameLeft() + e.clientX);
    });
  }

  function tap(x) {
    if (!R) return;
    R.lastActivity = Date.now();
    if (R.pop) { closePop(); return; }
    if (R.menu) { closeMenu(); return; }
    const w = window.innerWidth;
    const zone = x < w * 0.3 ? 'L' : x > w * 0.7 ? 'R' : 'C';
    if (zone === 'C' || R.settings.flow === 'scrolled') { openMenu(); return; }
    if (S.prefs.tapLock) return;
    const mode = S.prefs.tapMode;
    if (mode === 'next') next();
    else if ((zone === 'R') === (mode !== 'inverse')) next();
    else prev();
  }

  function next() { if (R && R.rendition) R.rendition.next(); }
  function prev() { if (R && R.rendition) R.rendition.prev(); }

  // Glisser sur le bord gauche : luminosité
  function bindEdge() {
    const edge = R.root.querySelector('#edge');
    let y0 = null; let b0 = 0.5; let moved = false; let bubble = null;
    edge.addEventListener('touchstart', (e) => {
      y0 = e.touches[0].clientY; moved = false;
      b0 = Light.value;
      refreshBrightness().then(() => { if (!moved) b0 = Light.value; });
    }, { passive: true });
    edge.addEventListener('touchmove', (e) => {
      if (y0 === null) return;
      const dy = e.touches[0].clientY - y0;
      if (Math.abs(dy) < 8 && !moved) return;
      moved = true;
      const v = Math.min(1, Math.max(0.02, b0 - dy / 320));
      setBrightness(v);
      if (!bubble) { bubble = document.createElement('div'); bubble.className = 'bubble'; R.root.appendChild(bubble); }
      bubble.textContent = 'Luminosité ' + Math.round(v * 100) + ' %';
    }, { passive: true });
    edge.addEventListener('touchend', (e) => {
      if (bubble) { bubble.remove(); bubble = null; }
      if (!moved && R) tap(e.changedTouches[0].clientX);
      y0 = null;
    });
    edge.addEventListener('click', (e) => { if (R && Date.now() - R.lastTouch > 800 && e.pointerType !== 'touch') tap(e.clientX); });
  }

  Native.onVolumeKey((d) => {
    if (!R || R.menu || R.pop) return;
    R.lastActivity = Date.now();
    if (d.direction === 'next') next(); else prev();
  });
  Native.onPause(() => { if (R) { Store.saveNow(); UI.syncWidget(); } });
  // Retour dans Folio (par exemple après avoir donné l'autorisation) : on relit l'état de la luminosité
  Native.onResume(() => { if (R) refreshBrightness().then(() => { const h = R && R.root.querySelector('.sheet [data-a="allow"]'); if (h && Light.allowed) h.closest('.help').remove(); }); });

  // ---------- Thème, lumière ----------
  function applyTheme() {
    R.root.dataset.theme = R.settings.theme;
    if (S.prefs.uiTheme === 'follow') UI.applyUiTheme();
  }

  function applyLight() {
    if (!R) return;
    const warm = R.root.querySelector('#warm');
    const w = S.prefs.warmth || 0;
    warm.hidden = w <= 0;
    warm.style.opacity = String(w * 0.32);
    const dim = R.root.querySelector('#dim');
    if (Native.isNative) dim.hidden = true;
    else { dim.hidden = false; dim.style.opacity = String((1 - Light.value) * 0.7); }
  }

  function restyle(rebuild) {
    R.settings = Store.settingsFor(R.id);
    applyTheme();
    const cfi = R.location ? R.location.start.cfi : R.book.cfi;
    if (rebuild) { build(cfi); return; }
    R.rendition.getContents().forEach((c) => injectStyle(c));
    drawMarks();
    clearTimeout(R.restyleTimer);
    R.restyleTimer = setTimeout(() => { if (R && cfi) R.rendition.display(cfi); }, 180);
  }

  function setSetting(key, value) {
    const id = R.id;
    if (S.bookSettings[id]) S.bookSettings[id][key] = value;
    else S.settings[key] = value;
    Store.save();
    restyle(key === 'flow' || key === 'margin');
  }

  // ---------- Menu de lecture ----------
  function openMenu() {
    if (!R || R.menu) return;
    closePop();
    const top = document.createElement('div');
    top.className = 'r-top';
    top.innerHTML = `<div class="r-top-inner">
      <button class="icon-btn" data-a="back" aria-label="Retour à la bibliothèque">${icon('back')}</button>
      <div class="r-title"><div>${esc(R.book.title)}</div><div data-r="chap"></div></div>
      <button class="icon-btn" data-a="search" aria-label="Rechercher dans le livre">${icon('search', 20)}</button>
      <button class="icon-btn" data-a="mark" aria-label="Marque-page">${icon('bookmark', 20)}</button></div>
      <div class="r-bright"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 4v1M12 19v1M4 12h1M19 12h1"/></svg>
        <input type="range" min="2" max="100" step="1" data-r="bright" aria-label="Luminosité">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></svg>
        <button class="auto-chip" data-a="auto" aria-pressed="false" aria-label="Luminosité automatique">Auto</button></div>`;
    const panel = document.createElement('div');
    panel.className = 'r-panel';
    panel.innerHTML = `<div class="r-info"><span data-r="page"></span><span data-r="pct"></span><span data-r="left"></span></div>
      <div class="slider-wrap"><div class="track"><div class="done" data-r="done"></div><div data-r="ticks"></div></div>
        <input type="range" min="0" max="1000" step="1" aria-label="Position dans le livre" data-r="range"></div>
      <div class="slider-preview" data-r="preview" aria-live="polite"></div>
      <div class="r-actions">
        <button class="tile-btn" data-a="toc">${icon('toc', 22)}Sommaire</button>
        <button class="tile-btn" data-a="text"><span class="aa" aria-hidden="true">Aa</span>Texte</button>
        <button class="tile-btn" data-a="notes">${icon('note', 22)}Notes</button>
        <button class="tile-btn" data-a="light">${icon('sun', 22)}Lumière</button>
      </div>`;
    R.root.appendChild(top);
    R.root.appendChild(panel);
    const removeBack = UI.pushBack(closeMenu);
    R.menu = { top, panel, removeBack };
    const on = (el, a, fn) => { el.querySelector(`[data-a="${a}"]`).onclick = fn; };
    on(top, 'back', () => close());
    on(top, 'search', () => { closeMenu(); openSearch(); });
    on(top, 'mark', toggleBookmark);
    const bright = top.querySelector('[data-r="bright"]');
    bright.value = String(Math.round(Light.value * 100));
    bright.oninput = () => { setBrightness(Number(bright.value) / 100); top.querySelector('[data-a="auto"]').setAttribute('aria-pressed', 'false'); };
    on(top, 'auto', async () => { await setAuto(!Light.auto); syncBrightSlider(); if (Light.auto) setTimeout(refreshBrightness, 600); });
    refreshBrightness();
    on(panel, 'toc', () => { closeMenu(); openToc('toc'); });
    on(panel, 'notes', () => { closeMenu(); openToc('notes'); });
    on(panel, 'text', () => { closeMenu(); openText(); });
    on(panel, 'light', () => { closeMenu(); openLight(); });
    const range = panel.querySelector('[data-r="range"]');
    range.oninput = () => {
      if (!R.dragFrom && R.location) R.dragFrom = { cfi: R.location.start.cfi, page: (locIndex(R.location) ?? -1) + 1 };
      const v = Number(range.value) / 1000;
      panel.querySelector('[data-r="done"]').style.width = (v * 100) + '%';
      if (!R.total) return;
      const i = Math.min(R.total - 1, Math.floor(v * R.total));
      const cfi = R.epub.locations.cfiFromLocation(i);
      let label = '';
      try { const ch = chapterAt(new ePub.CFI(cfi).spinePos); label = ch ? ch.label : ''; } catch (e) { /* rien */ }
      panel.querySelector('[data-r="preview"]').textContent = `p. ${i + 1}${label ? ' · ' + label : ''}`;
    };
    range.onchange = () => {
      if (!R.total) return;
      const i = Math.min(R.total - 1, Math.floor(Number(range.value) / 1000 * R.total));
      const from = R.dragFrom;
      R.dragFrom = null;
      R.rendition.display(R.epub.locations.cfiFromLocation(i)).then(() => {
        if (from && from.page && Math.abs(from.page - (i + 1)) > 1) showBack(from);
      });
    };
    refreshMenu();
    renderBack();
  }

  function refreshMenu() {
    if (!R || !R.menu) return;
    const { top, panel } = R.menu;
    const b = R.book;
    const { ch, idx, left } = chapterInfo(R.location);
    top.querySelector('[data-r="chap"]').textContent = ch ? ch.label : (b.author || '');
    const marked = isBookmarked();
    const mb = top.querySelector('[data-a="mark"]');
    mb.classList.toggle('on', marked);
    mb.querySelector('path').setAttribute('fill', marked ? 'currentColor' : 'none');
    mb.setAttribute('aria-label', marked ? 'Retirer le marque-page' : 'Ajouter un marque-page');
    const range = panel.querySelector('[data-r="range"]');
    if (R.total && idx !== null) {
      panel.querySelector('[data-r="page"]').textContent = `p. ${idx + 1} / ${R.total}`;
      panel.querySelector('[data-r="pct"]').textContent = Math.round(b.pct * 100) + ' %';
      panel.querySelector('[data-r="left"]').textContent = fmtLeft(left);
      range.disabled = false;
      range.value = String(Math.round((idx / Math.max(1, R.total - 1)) * 1000));
      panel.querySelector('[data-r="done"]').style.width = (idx / Math.max(1, R.total - 1) * 100) + '%';
      const ticks = panel.querySelector('[data-r="ticks"]');
      if (!ticks.childElementCount) {
        const seen = new Set();
        R.flat.filter((c) => c.depth === 0 && c.spine >= 0).forEach((c) => {
          const p = startOfSpine(c.spine) / R.total;
          const key = Math.round(p * 200);
          if (p <= 0.005 || p >= 0.995 || seen.has(key) || seen.size > 60) return;
          seen.add(key);
          const t = document.createElement('div');
          t.className = 'tick';
          t.style.left = (p * 100) + '%';
          ticks.appendChild(t);
        });
      }
      panel.querySelector('[data-r="preview"]').textContent = '';
    } else {
      panel.querySelector('[data-r="page"]').textContent = 'Calcul des pages…';
      panel.querySelector('[data-r="pct"]').textContent = '';
      panel.querySelector('[data-r="left"]').textContent = '';
      range.disabled = true;
      range.value = String(Math.round((b.pct || 0) * 1000));
    }
  }

  function closeMenu() {
    if (!R || !R.menu) return;
    R.menu.top.remove();
    R.menu.panel.remove();
    R.menu.removeBack();
    R.menu = null;
    renderBack();
  }

  // ---------- Marque-pages ----------
  function cmp(a, b) { try { return new ePub.CFI().compare(a, b); } catch (e) { return 0; } }

  function pageBookmarks() {
    if (!R.location) return [];
    const { start, end } = R.location;
    return S.bookmarks.filter((m) => m.bookId === R.id && cmp(m.cfi, start.cfi) >= 0 && cmp(m.cfi, end.cfi) <= 0);
  }

  function isBookmarked() { return pageBookmarks().length > 0; }

  function toggleBookmark() {
    const here = pageBookmarks();
    if (here.length) {
      S.bookmarks = S.bookmarks.filter((m) => !here.includes(m));
      UI.toast('Marque-page retiré');
    } else if (R.location) {
      S.bookmarks.push({ id: Store.uid(), bookId: R.id, cfi: R.location.start.cfi, chapter: R.book.chapter || '', pct: R.book.pct || 0, createdAt: Date.now() });
      UI.toast('Marque-page ajouté');
    }
    Store.save();
    refreshMenu();
  }

  // ---------- Sommaire / marque-pages / notes ----------
  function openToc(tab) {
    const s = UI.sheet('', { tall: true, parent: R.root });
    R.closers.push(s.close);
    let current = tab === 'notes' ? 'notes' : 'toc';
    const draw = () => {
      const curCh = R.location ? chapterAt(R.location.start.index) : null;
      let body = '';
      if (current === 'toc') {
        body = R.flat.length ? R.flat.map((c, i) => `<button class="list-item${curCh && c.href === curCh.href ? ' current' : ''}" data-toc="${i}" style="padding-left:${4 + c.depth * 18}px">${esc(c.label)}${R.total && c.spine >= 0 ? `<span class="right">${startOfSpine(c.spine) + 1}</span>` : ''}</button>`).join('')
          : '<div class="list-empty">Ce livre n\'a pas de sommaire.</div>';
      } else if (current === 'marks') {
        const marks = S.bookmarks.filter((m) => m.bookId === R.id).sort((a, b) => a.pct - b.pct);
        body = marks.length ? marks.map((m) => `<div class="list-item"><button style="flex:1;background:none;border:none;text-align:left;color:inherit;font-size:15px;padding:0;min-height:44px" data-mark="${m.id}">${esc(m.chapter || 'Marque-page')}<div class="muted" style="font-size:12px">${Math.round(m.pct * 100)} % · ${new Date(m.createdAt).toLocaleDateString('fr-FR')}</div></button><button class="icon-btn" data-delmark="${m.id}" aria-label="Supprimer le marque-page">${icon('trash', 18)}</button></div>`).join('')
          : '<div class="list-empty">Aucun marque-page. Ouvre le menu et touche l\'icône en haut à droite pour marquer une page.</div>';
      } else {
        const anns = S.annotations.filter((a) => a.bookId === R.id).sort((a, b) => cmp(a.cfi, b.cfi));
        body = anns.length ? anns.map((a) => `<button class="list-item" data-ann="${a.id}" style="align-items:flex-start"><span class="chip-dot" style="background:${UI.HL_COLORS[a.color]};margin-top:4px;flex-shrink:0"></span><span style="flex:1;min-width:0"><span class="excerpt" style="font-family:var(--serif)">${esc(a.text.length > 220 ? a.text.slice(0, 220) + '…' : a.text)}</span>${a.note ? `<span class="muted" style="display:block;font-size:13px;margin-top:4px">${esc(a.note)}</span>` : ''}</span></button>`).join('')
          : '<div class="list-empty">Aucun passage surligné. Sélectionne du texte pendant la lecture pour le surligner.</div>';
      }
      s.el.innerHTML = `<div class="grabber"></div><div class="tabs" role="tablist">
        <button role="tab" data-tab="toc" aria-selected="${current === 'toc'}">Sommaire</button>
        <button role="tab" data-tab="marks" aria-selected="${current === 'marks'}">Marque-pages</button>
        <button role="tab" data-tab="notes" aria-selected="${current === 'notes'}">Notes</button></div><div class="list">${body}</div>`;
      s.el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { current = b.dataset.tab; draw(); }; });
      s.el.querySelectorAll('[data-toc]').forEach((b) => { b.onclick = () => { s.close(); jumpTo(R.flat[Number(b.dataset.toc)].href); }; });
      s.el.querySelectorAll('[data-mark]').forEach((b) => { b.onclick = () => { const m = S.bookmarks.find((x) => x.id === b.dataset.mark); s.close(); jumpTo(m.cfi); }; });
      s.el.querySelectorAll('[data-delmark]').forEach((b) => { b.onclick = () => { S.bookmarks = S.bookmarks.filter((x) => x.id !== b.dataset.delmark); Store.save(); draw(); }; });
      s.el.querySelectorAll('[data-ann]').forEach((b) => { b.onclick = () => { const a = S.annotations.find((x) => x.id === b.dataset.ann); s.close(); jumpTo(a.cfi); }; });
      const cur = s.el.querySelector('.list-item.current');
      if (cur) cur.scrollIntoView({ block: 'center' });
    };
    draw();
  }

  // ---------- Recherche ----------
  function openSearch() {
    const s = UI.sheet(`<div class="sheet-head"><h2>Rechercher</h2></div>
      <label class="search"><span class="sr">Mot ou expression</span>${icon('search', 18)}<input type="search" placeholder="Mot ou expression" data-r="q" enterkeyhint="search" autocomplete="off"></label>
      <div class="muted" data-r="status" style="font-size:13px"></div><div class="list" data-r="results"></div>`, { tall: true, parent: R.root });
    R.closers.push(s.close);
    const input = s.el.querySelector('[data-r="q"]');
    const status = s.el.querySelector('[data-r="status"]');
    const out = s.el.querySelector('[data-r="results"]');
    let token = 0;
    setTimeout(() => input.focus(), 80);
    const run = async () => {
      const q = input.value.trim();
      const my = ++token;
      out.innerHTML = '';
      if (q.length < 2) { status.textContent = ''; return; }
      status.textContent = 'Recherche…';
      const results = [];
      const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      for (const item of R.epub.spine.spineItems) {
        if (my !== token || !R) return;
        try {
          await item.load(R.epub.load.bind(R.epub));
          const found = item.find(q) || [];
          item.unload();
          const ch = chapterAt(item.index);
          found.forEach((f) => results.push({ cfi: f.cfi, excerpt: f.excerpt, chapter: ch ? ch.label : '' }));
        } catch (e) { /* section illisible */ }
        if (results.length >= 300) break;
      }
      if (my !== token) return;
      status.textContent = results.length ? results.length + (results.length >= 300 ? '+' : '') + ' résultat' + (results.length > 1 ? 's' : '') : 'Aucun résultat.';
      out.innerHTML = results.map((r, i) => `<button class="list-item" data-res="${i}" style="flex-direction:column;align-items:flex-start;gap:2px"><span class="excerpt">${esc(r.excerpt).replace(re, '<mark>$1</mark>')}</span><span class="muted" style="font-size:12px">${esc(r.chapter)}</span></button>`).join('');
      out.querySelectorAll('[data-res]').forEach((b) => {
        b.onclick = () => {
          const r = results[Number(b.dataset.res)];
          s.close();
          jumpTo(r.cfi).then(() => {
            try {
              R.rendition.annotations.highlight(r.cfi, {}, null, 'folio-search', { fill: THEMES[R.settings.theme].accent, 'fill-opacity': '0.3' });
              setTimeout(() => { try { R.rendition.annotations.remove(r.cfi, 'highlight'); drawMarks(); } catch (e) { /* rien */ } }, 2500);
            } catch (e) { /* rien */ }
          });
        };
      });
    };
    let deb = null;
    input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(run, 450); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(deb); run(); input.blur(); } });
  }

  // ---------- Panneau « Texte » ----------
  function openText() {
    const s = UI.sheet('', { parent: R.root, half: true });
    R.closers.push(s.close);
    const draw = () => {
      const st = R.settings;
      const perBook = !!S.bookSettings[R.id];
      const opt = (key, val, label, extra) => `<button class="opt${extra ? ' ' + extra : ''}" data-k="${key}" data-v="${val}" aria-pressed="${String(st[key]) === String(val)}"`;
      s.el.innerHTML = `<div class="grabber"></div><div class="sheet-head"><h2>Affichage</h2><button class="link-btn" data-a="reset">Réinitialiser</button></div>
        <div><div class="field-label">Thème</div><div class="seg seg-4">${Object.keys(THEMES).map((k) => `${opt('theme', k, '', 'theme-opt')} style="background:${THEMES[k].bg};color:${THEMES[k].fg}">${THEMES[k].label}</button>`).join('')}</div></div>
        <div><div class="field-label">Police</div><div class="seg seg-4">${FONTS.map(([k, l, fb]) => `${opt('font', k)} style="${fb ? `font-family:'${k}',${fb}` : ''}">${l}</button>`).join('')}</div></div>
        <div class="seg seg-2">
          <div><div class="field-label">Taille</div><div class="stepper"><button data-step="size:-1" aria-label="Texte plus petit">A−</button><span>${st.size}</span><button data-step="size:1" aria-label="Texte plus grand" style="font-size:20px">A+</button></div></div>
          <div><div class="field-label">Interligne</div><div class="stepper"><button data-step="lineHeight:-0.1" aria-label="Resserrer les lignes">−</button><span>${String(st.lineHeight.toFixed(1)).replace('.', ',')}</span><button data-step="lineHeight:0.1" aria-label="Espacer les lignes">+</button></div></div>
        </div>
        <div><div class="field-label">Marges</div><div class="seg seg-3">${opt('margin', 's')}>Étroites</button>${opt('margin', 'm')}>Moyennes</button>${opt('margin', 'l')}>Larges</button></div></div>
        <div class="group" style="padding:0 14px;background:var(--bg)">
          <div class="set-row"><label for="o-justify">Texte justifié</label><span class="switch"><input type="checkbox" id="o-justify"${st.justify ? ' checked' : ''}><span></span></span></div>
          <div class="set-row"><label for="o-hyph">Césure des mots</label><span class="switch"><input type="checkbox" id="o-hyph"${st.hyphens ? ' checked' : ''}><span></span></span></div>
          <div class="set-row"><label for="o-scroll">Défilement continu<span class="sub">Faire défiler au lieu de tourner les pages</span></label><span class="switch"><input type="checkbox" id="o-scroll"${st.flow === 'scrolled' ? ' checked' : ''}><span></span></span></div>
          <div class="set-row"><label for="o-all">Appliquer à tous mes livres<span class="sub">${perBook ? 'Réglages propres à ce livre' : 'Mêmes réglages pour tous les livres'}</span></label><span class="switch"><input type="checkbox" id="o-all"${perBook ? '' : ' checked'}><span></span></span></div>
        </div>`;
      s.el.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => { setSetting(b.dataset.k, b.dataset.v); draw(); }; });
      s.el.querySelectorAll('[data-step]').forEach((b) => {
        b.onclick = () => {
          const [k, d] = b.dataset.step.split(':');
          const cur = Number(R.settings[k]);
          let v = Math.round((cur + Number(d)) * 10) / 10;
          v = k === 'size' ? Math.min(34, Math.max(13, v)) : Math.min(2.4, Math.max(1.1, v));
          setSetting(k, v); draw();
        };
      });
      s.el.querySelector('#o-justify').onchange = (e) => { setSetting('justify', e.target.checked); };
      s.el.querySelector('#o-hyph').onchange = (e) => { setSetting('hyphens', e.target.checked); };
      s.el.querySelector('#o-scroll').onchange = (e) => { setSetting('flow', e.target.checked ? 'scrolled' : 'paginated'); };
      s.el.querySelector('#o-all').onchange = (e) => {
        if (e.target.checked) { Object.assign(S.settings, R.settings); delete S.bookSettings[R.id]; }
        else S.bookSettings[R.id] = Object.assign({}, R.settings);
        Store.save();
        R.settings = Store.settingsFor(R.id);
        applyTheme();
        draw();
      };
      s.el.querySelector('[data-a="reset"]').onclick = () => {
        const prevFlow = R.settings.flow; const prevMargin = R.settings.margin;
        if (S.bookSettings[R.id]) S.bookSettings[R.id] = Object.assign({}, Store.DEFAULT_SETTINGS);
        else Object.assign(S.settings, Store.DEFAULT_SETTINGS);
        Store.save();
        restyle(prevFlow !== Store.DEFAULT_SETTINGS.flow || prevMargin !== Store.DEFAULT_SETTINGS.margin);
        draw();
      };
    };
    draw();
  }

  // ---------- Panneau « Lumière » ----------
  async function openLight() {
    const s = UI.sheet('', { parent: R.root, half: true });
    R.closers.push(s.close);
    await refreshBrightness();
    const draw = () => {
      const v = Math.round(Light.value * 100);
      s.el.innerHTML = `<div class="grabber"></div><div class="sheet-head"><h2>Lumière</h2></div>
        ${Native.isNative && !Light.allowed ? `<div class="help" style="padding:0">Pour régler la luminosité depuis Folio, Android demande l'autorisation « Modifier les paramètres système ». Le curseur du volet de notifications continue de fonctionner.<div style="margin-top:8px"><button class="btn btn-primary" data-a="allow" style="min-height:40px">Autoriser</button></div></div>` : ''}
        <div class="group" style="padding:0 14px;background:var(--bg)">
          <div class="set-row"><label for="l-auto">Luminosité automatique</label><span class="switch"><input type="checkbox" id="l-auto"${Light.auto ? ' checked' : ''}><span></span></span></div>
        </div>
        <div><label class="field-label" for="l-b">Luminosité · ${v} %</label><input class="range" type="range" id="l-b" min="2" max="100" value="${v}"></div>
        <div><label class="field-label" for="l-w">Chaleur de l'écran · ${Math.round((S.prefs.warmth || 0) * 100)} %</label><input class="range" type="range" id="l-w" min="0" max="100" value="${Math.round((S.prefs.warmth || 0) * 100)}"></div>
        <p class="muted" style="margin:0;font-size:13px;line-height:1.5">Astuce : glisse le doigt de haut en bas sur le bord gauche de l'écran, ou utilise le curseur sous le titre quand tu touches le centre de la page.</p>`;
      const allow = s.el.querySelector('[data-a="allow"]');
      if (allow) allow.onclick = () => Native.openBrightnessPermission();
      s.el.querySelector('#l-auto').onchange = async (e) => { await setAuto(e.target.checked); await refreshBrightness(); draw(); };
      const lb = s.el.querySelector('#l-b');
      lb.oninput = () => { setBrightness(Number(lb.value) / 100); s.el.querySelector('#l-auto').checked = false; lb.previousElementSibling.textContent = 'Luminosité · ' + lb.value + ' %'; };
      const lw = s.el.querySelector('#l-w');
      lw.oninput = () => { S.prefs.warmth = Number(lw.value) / 100; applyLight(); lw.previousElementSibling.textContent = 'Chaleur de l\'écran · ' + lw.value + ' %'; };
      lw.onchange = () => Store.save();
    };
    draw();
  }

  // ---------- Surlignage ----------
  function markStyle(a) {
    const color = UI.HL_COLORS[a.color] || UI.HL_COLORS.yellow;
    const dark = (THEMES[R.settings.theme] || {}).dark;
    if (a.style === 'ul') return ['underline', { stroke: color, 'stroke-opacity': '0.95', 'stroke-width': '3' }];
    return ['highlight', dark ? { fill: color, 'fill-opacity': '0.38' } : { fill: color, 'fill-opacity': '0.5', 'mix-blend-mode': 'multiply' }];
  }

  function addMark(a) {
    const [type, styles] = markStyle(a);
    const cb = (e) => { if (R) openPop({ ann: a, event: e }); };
    try { R.rendition.annotations[type](a.cfi, { id: a.id }, cb, 'folio-' + type, styles); } catch (e) { /* rien */ }
  }

  function removeMark(a) {
    try { R.rendition.annotations.remove(a.cfi, a.style === 'ul' ? 'underline' : 'highlight'); } catch (e) { /* rien */ }
  }

  function drawMarks() {
    if (!R || !R.rendition) return;
    S.annotations.filter((a) => a.bookId === R.id).forEach((a) => { removeMark(a); addMark(a); });
  }

  function onSelected(cfiRange, contents) {
    if (!R) return;
    const win = contents.window;
    const sel = win.getSelection();
    const text = sel ? sel.toString().replace(/\s+\n/g, '\n').trim() : '';
    if (!text) return;
    let rect = null;
    try {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const fr = win.frameElement.getBoundingClientRect();
      rect = { top: fr.top + r.top, bottom: fr.top + r.bottom };
    } catch (e) { /* rien */ }
    closeMenu();
    openPop({ cfi: cfiRange, text, rect, contents });
  }

  function clearSelection(p) {
    try { if (p && p.contents) p.contents.window.getSelection().removeAllRanges(); } catch (e) { /* rien */ }
    try { R.rendition.getContents().forEach((c) => c.window.getSelection().removeAllRanges()); } catch (e) { /* rien */ }
  }

  function openPop(p) {
    closePop();
    const ann = p.ann || null;
    if (ann && p.event && p.event.target && p.event.target.getBoundingClientRect) {
      const r = p.event.target.getBoundingClientRect();
      p.rect = { top: r.top, bottom: r.bottom };
    }
    const curColor = ann ? ann.color : null;
    const curStyle = ann ? ann.style : null;
    const pop = document.createElement('div');
    pop.className = 'hl-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Passage sélectionné');
    pop.innerHTML = `<div class="hl-colors">${Object.keys(UI.HL_COLORS).map((c) => `<button class="swatch" data-c="${c}" style="background:${UI.HL_COLORS[c]}" aria-label="Surligner en ${UI.HL_NAMES[c]}" aria-pressed="${curColor === c && curStyle !== 'ul'}"></button>`).join('')}
        <button class="swatch ul" data-ul aria-label="Souligner" aria-pressed="${curStyle === 'ul'}">U</button>
        ${ann ? `<button class="icon-btn" data-a="del" aria-label="Supprimer le surlignage">${icon('trash', 18)}</button>` : ''}</div>
      <div class="hl-actions"><button data-a="note">${ann && ann.note ? 'Modifier la note' : 'Note'}</button><button data-a="copy">Copier</button><button data-a="share">Partager</button></div>`;
    R.root.appendChild(pop);
    const h = pop.offsetHeight || 120;
    const H = window.innerHeight;
    let top = H / 2 - h / 2;
    if (p.rect) {
      if (p.rect.bottom + 14 + h < H - 20) top = p.rect.bottom + 14;
      else if (p.rect.top - 14 - h > 20) top = p.rect.top - 14 - h;
    }
    pop.style.top = Math.max(12, top) + 'px';
    const removeBack = UI.pushBack(closePop);
    R.pop = { el: pop, removeBack, p };

    const text = ann ? ann.text : p.text;
    const upsert = (color, style) => {
      let a = ann;
      if (a) {
        removeMark(a);
        a.color = color; a.style = style;
      } else {
        a = { id: Store.uid(), bookId: R.id, cfi: p.cfi, text, color, style, note: '', chapter: R.book.chapter || '', pct: R.book.pct || 0, createdAt: Date.now() };
        S.annotations.push(a);
      }
      addMark(a);
      Store.save();
      return a;
    };
    pop.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => { upsert(b.dataset.c, 'hl'); clearSelection(p); closePop(); }; });
    pop.querySelector('[data-ul]').onclick = () => { upsert(ann ? ann.color : 'yellow', 'ul'); clearSelection(p); closePop(); };
    const del = pop.querySelector('[data-a="del"]');
    if (del) del.onclick = () => {
      removeMark(ann);
      S.annotations = S.annotations.filter((x) => x.id !== ann.id);
      Store.save(); closePop();
    };
    pop.querySelector('[data-a="note"]').onclick = async () => {
      const a = ann || upsert('yellow', 'hl');
      clearSelection(p); closePop();
      const v = await UI.promptDialog('Note', a.note || '', 'Enregistrer', true, R.root);
      if (v !== null) { a.note = v.trim(); Store.save(); }
    };
    pop.querySelector('[data-a="copy"]').onclick = async () => {
      try { await navigator.clipboard.writeText(text); UI.toast('Copié'); } catch (e) { UI.toast('Copie impossible'); }
      clearSelection(p); closePop();
    };
    pop.querySelector('[data-a="share"]').onclick = () => {
      const b = R.book;
      Native.shareText('« ' + text + ' »\n— ' + b.title + (b.author ? ', ' + b.author : ''));
      clearSelection(p); closePop();
    };
  }

  function closePop() {
    if (!R || !R.pop) return;
    R.pop.el.remove();
    R.pop.removeBack();
    R.pop = null;
  }

  window.Reader = { open, close, get isOpen() { return !!R; }, get currentId() { return R ? R.id : null; } };
})();
