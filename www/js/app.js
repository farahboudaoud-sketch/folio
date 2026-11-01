/* Folio — interface : bibliothèque, fiche du livre, notes, statistiques, réglages. */
(function () {
  const S = Store.state;

  // ---------- Outils ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const HL_COLORS = { yellow: '#F5D76E', blue: '#9CC3F0', green: '#A8D8B0', pink: '#F2B4C6' };
  const HL_NAMES = { yellow: 'jaune', blue: 'bleu', green: 'vert', pink: 'rose' };
  const COVER_COLORS = ['#3E5C76', '#6B3A2E', '#2F3A33', '#7A5C2E', '#4A4560', '#3A4A5C', '#5C3A4A', '#2F5D50', '#5A4A3A'];

  const P = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    books: '<path d="M4 5h5v14H4zM10 5h5v14h-5zM16 6l4 1-3 13-4-1"/>',
    note: '<path d="M5 4h14v16l-7-4-7 4z"/>',
    stats: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    toc: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
    kindle: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    share: '<path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>'
  };
  const icon = (name, size) => `<svg width="${size || 22}" height="${size || 22}" viewBox="0 0 24 24" ${P}>${ICONS[name] || ''}</svg>`;

  function hashColor(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return COVER_COLORS[h % COVER_COLORS.length];
  }

  function fmtDur(sec) {
    sec = Math.round(sec || 0);
    const m = Math.round(sec / 60);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    return h + ' h ' + String(m % 60).padStart(2, '0');
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function relDate(ts) {
    if (!ts) return 'Jamais ouvert';
    const d = new Date(ts); d.setHours(0, 0, 0, 0);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const days = Math.round((t - d) / 86400000);
    if (days <= 0) return 'Ouvert aujourd\'hui';
    if (days === 1) return 'Ouvert hier';
    if (days < 7) return 'Ouvert il y a ' + days + ' jours';
    return 'Ouvert le ' + new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  function fmtSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' Ko';
    return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' Mo';
  }

  function statusOf(b) {
    if (b.finishedAt) return 'done';
    if (b.openedAt) return 'reading';
    return 'new';
  }

  function labelOf(b) {
    const st = statusOf(b);
    if (st === 'done') return 'Terminé';
    if (st === 'new') return 'Nouveau';
    return Math.round((b.pct || 0) * 100) + ' %';
  }

  // ---------- Couvertures ----------
  const covers = {};
  function coverHTML(b) {
    const src = covers[b.id];
    if (src) return `<div class="cover"><img src="${src}" alt=""></div>`;
    return `<div class="cover" style="background:${hashColor(b.id)}"><div class="gen"><span>${esc(b.title)}</span>${b.author ? `<small>${esc(b.author)}</small>` : ''}</div></div>`;
  }

  // ---------- Pile du bouton retour ----------
  const backStack = [];
  function pushBack(fn) {
    backStack.push(fn);
    return () => { const i = backStack.lastIndexOf(fn); if (i >= 0) backStack.splice(i, 1); };
  }

  // ---------- Toasts, feuilles, dialogues ----------
  let toastTimer = null;
  function toast(msg, ms) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2800);
  }

  function sheet(html, opts) {
    opts = opts || {};
    const scrim = document.createElement('div');
    scrim.className = 'scrim' + (opts.center ? ' center' : '') + (opts.half ? ' clear' : '');
    scrim.innerHTML = opts.center ? `<div class="dialog" role="dialog" aria-modal="true">${html}</div>`
      : `<div class="sheet${opts.tall ? ' tall' : ''}${opts.half ? ' half' : ''}" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div>`;
    (opts.parent || document.body).appendChild(scrim);
    let removeBack;
    const close = () => {
      if (!scrim.isConnected) return;
      scrim.remove();
      removeBack();
      if (opts.onClose) opts.onClose();
    };
    removeBack = pushBack(close);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
    const box = scrim.firstElementChild;
    return { el: box, close };
  }

  function confirmDialog(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      let done = false;
      const s = sheet(`<h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}
        <div class="dialog-actions"><button class="btn btn-soft" data-a="no">Annuler</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-a="ok">${esc(okLabel || 'OK')}</button></div>`,
      { center: true, onClose: () => { if (!done) resolve(false); } });
      s.el.querySelector('[data-a="no"]').onclick = () => s.close();
      s.el.querySelector('[data-a="ok"]').onclick = () => { done = true; resolve(true); s.close(); };
    });
  }

  function alertDialog(title, text) {
    const s = sheet(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="dialog-actions"><button class="btn btn-primary">OK</button></div>`, { center: true });
    s.el.querySelector('button').onclick = () => s.close();
  }

  function promptDialog(title, value, okLabel, multiline, parent) {
    return new Promise((resolve) => {
      let done = false;
      const field = multiline ? `<textarea class="text-input" aria-label="${esc(title)}">${esc(value || '')}</textarea>`
        : `<input class="text-input" aria-label="${esc(title)}" value="${esc(value || '')}">`;
      const s = sheet(`<h2>${esc(title)}</h2>${field}<div class="dialog-actions"><button class="btn btn-soft" data-a="no">Annuler</button><button class="btn btn-primary" data-a="ok">${esc(okLabel || 'Enregistrer')}</button></div>`,
        { center: true, parent, onClose: () => { if (!done) resolve(null); } });
      const input = s.el.querySelector('.text-input');
      setTimeout(() => input.focus(), 50);
      s.el.querySelector('[data-a="no"]').onclick = () => s.close();
      s.el.querySelector('[data-a="ok"]').onclick = () => { done = true; resolve(input.value); s.close(); };
    });
  }

  // ---------- Thème de l'interface ----------
  function applyUiTheme() {
    const t = S.prefs.uiTheme === 'follow' ? S.settings.theme : 'papier';
    document.documentElement.dataset.theme = t;
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#F6F1E7';
  }

  // ---------- Import des livres ----------
  // Résumé : certains EPUB encodent le HTML plusieurs fois (&amp;amp;lt;p&amp;amp;gt;…). On décode jusqu'au bout, puis on garde le texte.
  function stripHtml(html) {
    if (!html) return '';
    let s = String(html);
    const ta = document.createElement('textarea');
    for (let i = 0; i < 8; i++) {
      ta.innerHTML = s;
      const d = ta.value;
      if (d === s) break;
      s = d;
    }
    s = s.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n\n');
    const doc = new DOMParser().parseFromString(s, 'text/html');
    return (doc.body.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function makeCover(epub) {
    try {
      const url = await epub.coverUrl();
      if (!url) return null;
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const w = 360;
      const h = Math.round(img.naturalHeight * (w / img.naturalWidth)) || 540;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.82);
    } catch (e) {
      return null;
    }
  }

  async function addBook(info) {
    const existing = S.books[info.id];
    if (existing && !existing.missing) return existing;
    if (existing && existing.missing) {
      existing.path = info.path; existing.missing = false; existing.size = info.size;
      Store.save();
      return existing;
    }
    const buf = await Native.readBook(info.path);
    let epub;
    try {
      epub = ePub(buf);
      await epub.ready;
    } catch (e) {
      await Native.deleteBook(info.path);
      throw new Error((info.name || 'Ce fichier') + ' n\'est pas un EPUB lisible.');
    }
    const md = (epub.packaging && epub.packaging.metadata) || {};
    const fileTitle = (info.name || 'Livre').replace(/\.epub$/i, '').replace(/[_]+/g, ' ');
    const year = String(md.pubdate || md.modified_date || '').match(/\d{4}/);
    const book = {
      id: info.id,
      path: info.path,
      size: info.size || buf.byteLength,
      title: (md.title || '').trim() || fileTitle,
      author: (md.creator || '').trim(),
      description: stripHtml(md.description),
      year: year ? year[0] : '',
      lang: md.language || '',
      addedAt: Date.now(),
      openedAt: 0,
      startedAt: 0,
      finishedAt: 0,
      pct: 0,
      cfi: '',
      chapter: '',
      collections: [],
      timeSec: 0
    };
    const cover = await makeCover(epub);
    try { epub.destroy(); } catch (e) { /* rien */ }
    if (cover) { covers[book.id] = cover; await Store.idbSet('covers', book.id, cover); }
    S.books[book.id] = book;
    Store.save();
    return book;
  }

  async function importResults(results) {
    let added = 0;
    const errors = [];
    let last = null;
    for (const r of results) {
      if (r.error) { errors.push((r.name ? r.name + ' : ' : '') + r.error); continue; }
      const already = S.books[r.id] && !S.books[r.id].missing;
      try {
        last = await addBook(r);
        if (!already) added++;
      } catch (e) {
        errors.push(e.message);
      }
    }
    render();
    if (errors.length) alertDialog('Certains fichiers n\'ont pas été ajoutés', errors.join('\n'));
    else if (added) toast(added === 1 ? '« ' + last.title + ' » ajouté' : added + ' livres ajoutés');
    else if (results.length) toast('Déjà dans ta bibliothèque');
    return last;
  }

  async function pickAndImport() {
    try {
      const results = await Native.pickBooks();
      if (!results.length) return;
      toast('Import en cours…', 10000);
      await importResults(results);
    } catch (e) {
      alertDialog('Import impossible', e.message || String(e));
    }
  }

  async function handleIncoming(data) {
    if (!data) return;
    if (data.error) { alertDialog('Impossible d\'ouvrir ce fichier', data.error); return; }
    try {
      toast('Ouverture…', 8000);
      const book = await addBook(data);
      render();
      $('#toast').hidden = true;
      closeOverlays();
      Reader.open(book.id);
    } catch (e) {
      alertDialog('Impossible d\'ouvrir ce fichier', e.message || String(e));
    }
  }

  function closeOverlays() {
    while (backStack.length) {
      const fn = backStack[backStack.length - 1];
      fn();
      if (backStack[backStack.length - 1] === fn) backStack.pop();
    }
  }

  // ---------- Navigation ----------
  const view = { tab: 'books', filter: 'all', query: '', notesBook: '', notesColor: '', selecting: false, sel: new Set(), shown: [] };

  function render() {
    applyUiTheme();
    const main = $('#main');
    const scroll = main.scrollTop;
    if (view.tab === 'books') main.innerHTML = libraryHTML();
    else if (view.tab === 'notes') main.innerHTML = notesHTML();
    else if (view.tab === 'stats') main.innerHTML = statsHTML();
    else main.innerHTML = settingsHTML();
    $$('.tabbar button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === view.tab ? 'page' : 'false'));
    bindView();
    syncWidget();
    main.scrollTop = scroll;
  }

  function setTab(tab) {
    if (view.selecting && tab !== 'books') { view.selecting = false; view.sel = new Set(); if (removeSelBack) { removeSelBack(); removeSelBack = null; } }
    view.tab = tab;
    $('#main').scrollTop = 0;
    render();
  }

  // ---------- Bibliothèque ----------
  function sortedBooks() {
    const list = Object.values(S.books);
    const sort = S.prefs.sort;
    list.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'fr');
      if (sort === 'author') return (a.author || '~').localeCompare(b.author || '~', 'fr') || a.title.localeCompare(b.title, 'fr');
      if (sort === 'progress') return (b.pct || 0) - (a.pct || 0);
      if (sort === 'added') return (b.addedAt || 0) - (a.addedAt || 0);
      return Math.max(b.openedAt || 0, b.addedAt || 0) - Math.max(a.openedAt || 0, a.addedAt || 0);
    });
    return list;
  }

  function libraryHTML() {
    const all = sortedBooks();
    const q = view.query.trim().toLowerCase();
    const head = view.selecting
      ? `<div class="page-head"><button class="icon-btn" data-sel="cancel" aria-label="Quitter la sélection">${icon('close')}</button><h1 style="font-size:22px;flex:1">${view.sel.size} sélectionné${view.sel.size > 1 ? 's' : ''}</h1><button class="link-btn" data-sel="all">Tout sélectionner</button></div>`
      : `<div class="page-head"><h1>Bibliothèque</h1><button class="icon-btn filled" id="add-btn" aria-label="Ajouter un livre">${icon('plus')}</button></div>`;
    if (!all.length) {
      return `<div class="page">${head}<div class="empty">${icon('books', 40)}<h2>Ta bibliothèque est vide</h2>
        <p>Touche + pour choisir un fichier EPUB dans ton téléphone, ou ouvre un fichier .epub avec Folio depuis tes fichiers.</p>
        <button class="btn btn-primary" id="add-btn-2">${icon('plus', 20)} Ajouter un livre</button></div></div>`;
    }
    let resume = '';
    const current = all.filter((b) => statusOf(b) === 'reading').sort((a, b) => b.openedAt - a.openedAt)[0];
    if (current && !q && view.filter === 'all' && !view.selecting) {
      resume = `<button class="resume" data-open="${current.id}" data-book="${current.id}">${coverHTML(current)}
        <div class="resume-body"><div class="kicker">Reprendre</div><div class="resume-title">${esc(current.title)}</div>
        <div class="muted" style="font-size:14px">${esc([current.author, current.chapter].filter(Boolean).join(' · '))}</div>
        <div class="bar" style="margin-top:6px"><div style="width:${Math.round((current.pct || 0) * 100)}%"></div></div>
        <div class="muted" style="font-size:13px">${Math.round((current.pct || 0) * 100)} %${current.chapterLeft ? ' · ' + esc(current.chapterLeft) : ''}</div></div></button>`;
    }
    const chips = [['all', 'Tous'], ['reading', 'En cours'], ['new', 'À lire'], ['done', 'Terminés'], ['collections', 'Collections']];
    const activeColl = view.filter.startsWith('coll:') ? S.collections.find((c) => 'coll:' + c.id === view.filter) : null;
    const chipsHTML = `<div class="chips" role="group" aria-label="Filtrer">${chips.map(([k, l]) => `<button class="chip" data-filter="${k}" aria-pressed="${view.filter === k || (k === 'collections' && !!activeColl)}">${l}</button>`).join('')}</div>`;
    let body;
    if (view.filter === 'collections' && !q) {
      body = `<div class="section-head"><h2>Collections</h2><button class="link-btn" id="new-coll">Nouvelle collection</button></div>`;
      body += S.collections.length ? `<div class="coll-list">${S.collections.map((c) => {
        const n = all.filter((b) => (b.collections || []).includes(c.id)).length;
        return `<button class="coll-row" data-coll="${c.id}">${icon('list', 20)}<span>${esc(c.name)}</span><span class="count">${n} livre${n > 1 ? 's' : ''}</span></button>`;
      }).join('')}</div>` : `<div class="list-empty">Aucune collection pour l'instant. Crée-en une, puis ajoute des livres depuis leur fiche (appui long sur un livre).</div>`;
    } else {
      let list = all;
      if (activeColl) list = list.filter((b) => (b.collections || []).includes(activeColl.id));
      else if (view.filter !== 'all' && view.filter !== 'collections') list = list.filter((b) => statusOf(b) === view.filter);
      if (q) list = all.filter((b) => (b.title + ' ' + (b.author || '') + ' ' + (b.collections || []).map((id) => (S.collections.find((c) => c.id === id) || {}).name || '').join(' ')).toLowerCase().includes(q));
      const title = q ? 'Résultats' : activeColl ? esc(activeColl.name) : view.filter === 'all' ? 'Tous les livres' : chips.find((c) => c[0] === view.filter)[1];
      const sortSel = `<label class="sr" for="sort">Trier</label><select id="sort" class="sort-select">${[['recent', 'Récents'], ['added', 'Ajout'], ['title', 'Titre'], ['author', 'Auteur'], ['progress', 'Progression']].map(([k, l]) => `<option value="${k}"${S.prefs.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
      view.shown = list.map((b) => b.id);
      if (view.selecting) {
        }
      const selBtn = list.length && !view.selecting ? `<button class="link-btn" id="sel-start">Sélectionner</button>` : '';
      body = `<div class="section-head"><h2>${title} <span class="muted" style="font-weight:400">· ${list.length}</span></h2><div style="display:flex;align-items:center;gap:12px">${selBtn}${activeColl ? `<button class="link-btn" id="coll-menu" data-coll-id="${activeColl.id}">Modifier</button>` : sortSel}</div></div>`;
      body += list.length ? `<div class="grid">${list.map((b) => `<button class="book${view.selecting && view.sel.has(b.id) ? ' picked' : ''}" data-open="${b.id}" data-book="${b.id}" ${view.selecting ? `aria-pressed="${view.sel.has(b.id)}" aria-label="${esc(b.title)}"` : `aria-label="${esc(b.title)}, ${esc(labelOf(b))}. Appui long pour la fiche."`}>
          <div style="position:relative">${coverHTML(b)}${view.selecting ? `<span class="pick" aria-hidden="true">${icon('check', 16)}</span>` : ''}</div>${b.missing ? '<span class="badge">À réimporter</span>' : ''}
          <div class="bar thin"><div style="width:${statusOf(b) === 'done' ? 100 : Math.round((b.pct || 0) * 100)}%"></div></div>
          <div class="label">${esc(labelOf(b))}</div></button>`).join('')}</div>`
        : `<div class="list-empty">${q ? 'Aucun livre ne correspond.' : 'Aucun livre ici pour l\'instant.'}</div>`;
      if (view.selecting) {
        const dis = view.sel.size ? '' : ' disabled';
        body += `<div class="sel-bar"><button class="tile-btn" data-sel="done"${dis}>${icon('check', 20)}Marquer lu</button><button class="tile-btn" data-sel="undone"${dis}>${icon('books', 20)}Non lu</button><button class="tile-btn" data-sel="coll"${dis}>${icon('list', 20)}Collection</button><button class="tile-btn danger" data-sel="remove"${dis}>${icon('trash', 20)}Retirer</button></div>`;
      }
    }
    return `<div class="page">${head}
      <label class="search">${icon('search', 18)}<span class="sr">Rechercher</span><input id="q" type="search" placeholder="Titre, auteur, collection…" value="${esc(view.query)}" autocomplete="off"></label>
      ${chipsHTML}${resume}${body}</div>`;
  }

  function bindLongPress(el, onLong) {
    let timer = null; let sx = 0; let sy = 0; let fired = false;
    el.addEventListener('pointerdown', (e) => {
      fired = false; sx = e.clientX; sy = e.clientY;
      clearTimeout(timer);
      timer = setTimeout(() => { fired = true; if (navigator.vibrate) navigator.vibrate(12); onLong(); }, 480);
    });
    const cancel = () => clearTimeout(timer);
    el.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) cancel(); });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!fired) { cancel(); fired = true; onLong(); } });
    el.addEventListener('click', (e) => { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);
  }

  function bindView() {
    const main = $('#main');
    $$('#add-btn, #add-btn-2', main).forEach((b) => { b.onclick = pickAndImport; });
    const q = $('#q', main);
    if (q) q.oninput = () => {
      view.query = q.value;
      const pos = q.selectionStart;
      render();
      const nq = $('#q'); nq.focus(); nq.setSelectionRange(pos, pos);
    };
    $$('[data-filter]', main).forEach((b) => { b.onclick = () => { view.filter = b.dataset.filter; render(); }; });
    $$('[data-coll]', main).forEach((b) => { b.onclick = () => { view.filter = 'coll:' + b.dataset.coll; render(); }; });
    const sort = $('#sort', main);
    if (sort) sort.onchange = () => { S.prefs.sort = sort.value; Store.save(); render(); };
    const nc = $('#new-coll', main);
    if (nc) nc.onclick = async () => {
      const name = await promptDialog('Nouvelle collection', '', 'Créer');
      if (name && name.trim()) { S.collections.push({ id: Store.uid(), name: name.trim() }); Store.save(); render(); }
    };
    const cm = $('#coll-menu', main);
    if (cm) cm.onclick = () => collectionMenu(cm.dataset.collId);
    $$('[data-book]', main).forEach((el) => {
      const ids = view.shown.includes(el.dataset.book) ? view.shown : [el.dataset.book];
      bindLongPress(el, () => { if (view.selecting) toggleSel(el.dataset.book); else openDetail(el.dataset.book, ids); });
      el.addEventListener('click', () => {
        if (view.selecting) { toggleSel(el.dataset.book); return; }
        const b = S.books[el.dataset.open];
        if (b && b.missing) { openDetail(b.id, ids); return; }
        Reader.open(el.dataset.open);
      });
    });
    const ss = $('#sel-start', main);
    if (ss) ss.onclick = () => startSelecting();
    bindSelection(main);
    if (view.tab === 'notes') bindNotes(main);
    if (view.tab === 'stats') bindStats(main);
    if (view.tab === 'settings') bindSettings(main);
  }

  function collectionMenu(id) {
    const c = S.collections.find((x) => x.id === id);
    if (!c) return;
    const s = sheet(`<div class="sheet-head"><h2>${esc(c.name)}</h2></div>
      <button class="btn btn-soft btn-block" data-a="rename">${icon('edit', 20)} Renommer</button>
      <button class="btn btn-danger btn-block" data-a="del">${icon('trash', 20)} Supprimer la collection</button>
      <p class="muted" style="margin:0;font-size:13px;text-align:center">Les livres restent dans ta bibliothèque.</p>`);
    s.el.querySelector('[data-a="rename"]').onclick = async () => {
      s.close();
      const name = await promptDialog('Renommer la collection', c.name);
      if (name && name.trim()) { c.name = name.trim(); Store.save(); render(); }
    };
    s.el.querySelector('[data-a="del"]').onclick = async () => {
      s.close();
      if (!(await confirmDialog('Supprimer « ' + c.name + ' » ?', null, 'Supprimer', true))) return;
      S.collections = S.collections.filter((x) => x.id !== id);
      Object.values(S.books).forEach((b) => { b.collections = (b.collections || []).filter((x) => x !== id); });
      view.filter = 'collections';
      Store.save(); render();
    };
  }


  // ---------- Sélection multiple ----------
  let removeSelBack = null;
  function startSelecting(firstId) {
    view.selecting = true;
    view.sel = new Set(firstId ? [firstId] : []);
    if (!removeSelBack) removeSelBack = pushBack(stopSelecting);
    render();
  }

  function stopSelecting() {
    view.selecting = false;
    view.sel = new Set();
    if (removeSelBack) { removeSelBack(); removeSelBack = null; }
    render();
  }

  function toggleSel(id) {
    if (view.sel.has(id)) view.sel.delete(id); else view.sel.add(id);
    render();
  }

  function bindSelection(main) {
    if (!view.selecting) return;
    const all = $('[data-sel="all"]', main);
    const allOn = view.shown.length && view.shown.every((id) => view.sel.has(id));
    if (all) {
      all.textContent = allOn ? 'Tout désélectionner' : 'Tout sélectionner';
      all.onclick = () => { view.sel = allOn ? new Set() : new Set(view.shown); render(); };
    }
    const on = (k, fn) => { const el = $(`[data-sel="${k}"]`, main); if (el) el.onclick = fn; };
    const chosen = () => [...view.sel].map((id) => S.books[id]).filter(Boolean);
    on('cancel', stopSelecting);
    on('done', () => {
      const bs = chosen(); bs.forEach((b) => markDone(b, true)); Store.save();
      toast(bs.length > 1 ? bs.length + ' livres marqués comme lus' : 'Livre marqué comme lu');
      stopSelecting();
    });
    on('undone', () => {
      const bs = chosen(); bs.forEach((b) => markDone(b, false)); Store.save();
      toast(bs.length > 1 ? bs.length + ' livres marqués comme non lus' : 'Livre marqué comme non lu');
      stopSelecting();
    });
    on('coll', () => {
      const bs = chosen();
      const draw = (sh) => {
        sh.el.innerHTML = `<div class="grabber"></div><div class="sheet-head"><h2>Ajouter ${bs.length} livre${bs.length > 1 ? 's' : ''} à…</h2><button class="link-btn" data-a="new">Nouvelle</button></div>
          ${S.collections.length ? S.collections.map((c) => `<button class="coll-row" data-c="${c.id}">${icon('list', 20)}<span>${esc(c.name)}</span></button>`).join('') : '<div class="list-empty">Aucune collection. Crée la première.</div>'}`;
        const add = (cid, name) => {
          bs.forEach((b) => { b.collections = b.collections || []; if (!b.collections.includes(cid)) b.collections.push(cid); });
          Store.save(); sh.close(); toast('Ajouté à « ' + name + ' »'); stopSelecting();
        };
        $$('[data-c]', sh.el).forEach((btn) => { btn.onclick = () => add(btn.dataset.c, S.collections.find((c) => c.id === btn.dataset.c).name); });
        sh.el.querySelector('[data-a="new"]').onclick = async () => {
          const name = await promptDialog('Nouvelle collection', '', 'Créer');
          if (name && name.trim()) { const c = { id: Store.uid(), name: name.trim() }; S.collections.push(c); add(c.id, c.name); }
        };
      };
      const sh = sheet('');
      draw(sh);
    });
    on('remove', async () => {
      const bs = chosen();
      if (!(await confirmDialog('Retirer ' + bs.length + ' livre' + (bs.length > 1 ? 's' : '') + ' ?', 'Leur progression, leurs passages surlignés et leurs marque-pages seront supprimés de Folio. Tes fichiers d\'origine ne sont pas touchés.', 'Retirer', true))) return;
      for (const b of bs) await removeBook(b.id);
      toast(bs.length > 1 ? bs.length + ' livres retirés' : 'Livre retiré');
      stopSelecting();
    });
  }

  // ---------- Fiche du livre ----------
  // Fiche du livre. `ids` = les livres affichés dans la bibliothèque, pour passer de l'un à l'autre en balayant.
  function markDone(b, done) {
    if (!done) { b.finishedAt = 0; return; }
    if (!b.finishedAt) b.finishedAt = Date.now();
    if (!b.openedAt) b.openedAt = Date.now();
    if (!b.startedAt) b.startedAt = Date.now();
  }

  function openDetail(startId, ids) {
    if (!S.books[startId]) return;
    let list = (ids && ids.includes(startId)) ? ids.slice() : [startId];
    let id = startId;
    let b = S.books[id];
    const screen = document.createElement('div');
    screen.className = 'screen';
    screen.setAttribute('role', 'dialog');
    document.body.appendChild(screen);
    let removeBack;
    const close = () => { screen.remove(); removeBack(); };
    removeBack = pushBack(close);

    const go = (dir) => {
      const i = list.indexOf(id) + dir;
      if (i < 0 || i >= list.length) {
        const body = screen.querySelector('.screen-body');
        body.classList.remove('bump-l', 'bump-r'); void body.offsetWidth; body.classList.add(dir > 0 ? 'bump-l' : 'bump-r');
        return;
      }
      id = list[i]; b = S.books[id];
      draw(dir > 0 ? 'from-r' : 'from-l');
    };
    // Balayage horizontal pour passer au livre suivant / précédent
    let t0 = null;
    screen.addEventListener('touchstart', (e) => { const t = e.touches[0]; t0 = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, time: Date.now() } : null; }, { passive: true });
    screen.addEventListener('touchend', (e) => {
      if (!t0 || document.querySelector('.scrim')) { t0 = null; return; }
      const t = e.changedTouches[0];
      const dx = t.clientX - t0.x; const dy = t.clientY - t0.y;
      const quick = Date.now() - t0.time < 700;
      t0 = null;
      if (quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    });

    const draw = (anim) => {
      if (!S.books[id]) { close(); return; }
      screen.setAttribute('aria-label', 'Fiche de ' + b.title);
      const pos = list.indexOf(id);
      const st = statusOf(b);
      const pct = st === 'done' ? 100 : Math.round((b.pct || 0) * 100);
      const nHl = S.annotations.filter((a) => a.bookId === id).length;
      const meta = [b.year, b.pages ? b.pages + ' pages' : '', 'EPUB ' + fmtSize(b.size)].filter(Boolean).join(' · ');
      const desc = b.description || '';
      const longDesc = desc.length > 420;
      const colls = (b.collections || []).map((cid) => (S.collections.find((c) => c.id === cid) || {}).name).filter(Boolean);
      const nav = list.length > 1 ? `<div class="detail-nav"><button class="icon-btn" data-a="prev" aria-label="Livre précédent"${pos <= 0 ? ' disabled' : ''}>${icon('back', 20)}</button><span>${pos + 1} / ${list.length}</span><button class="icon-btn" data-a="next" aria-label="Livre suivant"${pos >= list.length - 1 ? ' disabled' : ''}><svg width="20" height="20" viewBox="0 0 24 24" ${P}><path d="M9 5l7 7-7 7"/></svg></button></div>` : '';
      screen.innerHTML = `<div class="screen-top"><button class="icon-btn" data-a="close" aria-label="Fermer la fiche">${icon('close')}</button>${nav}<span style="width:44px"></span></div>
        <div class="screen-body${anim ? ' ' + anim : ''}">
          <div class="detail-head">${coverHTML(b)}<div style="display:flex;flex-direction:column;gap:6px;min-width:0">
            <h1>${esc(b.title)}</h1>${b.author ? `<div class="muted" style="font-size:15px">${esc(b.author)}</div>` : ''}<div class="meta">${esc(meta)}</div></div></div>
          ${b.missing ? `<p class="muted" style="margin:0">Ce livre vient d'une sauvegarde : le fichier n'est pas encore sur ce téléphone. Ajoute-le avec le bouton + pour le relire.</p>` : `
          <div style="display:flex;flex-direction:column;gap:6px"><div class="bar"><div style="width:${pct}%"></div></div>
            <div class="row-between"><span>${pct} %${b.chapter && st !== 'done' ? ' · ' + esc(b.chapter) : ''}</span><span>${esc(relDate(b.openedAt))}</span></div></div>
          <button class="btn btn-primary btn-block" data-a="read">${st === 'new' ? 'Commencer la lecture' : st === 'done' ? 'Relire' : 'Reprendre la lecture'}</button>
          <button class="btn btn-outline btn-block" data-a="kindle">${icon('kindle', 20)} <span>Envoyer à ma Kindle</span></button>
          ${b.kindleSentAt ? `<div class="sent-note">Envoyé à la Kindle le ${fmtDate(b.kindleSentAt)}</div>` : ''}`}
          ${desc ? `<div class="summary"><h2>Résumé</h2><p data-desc>${esc(longDesc ? desc.slice(0, 400).replace(/\s\S*$/, '') + '…' : desc)}</p>${longDesc ? '<button class="more" data-a="more">Lire la suite</button>' : ''}</div>` : ''}
          ${colls.length ? `<div class="meta">Collections : ${esc(colls.join(', '))}</div>` : ''}
          <div class="actions3">
            <button class="tile-btn" data-a="coll">${icon('list', 20)}Collection</button>
            <button class="tile-btn" data-a="done">${icon('check', 20)}${st === 'done' ? 'Marquer non lu' : 'Marquer lu'}</button>
            <button class="tile-btn danger" data-a="remove">${icon('trash', 20)}Retirer</button>
          </div>
          <div class="facts">
            <div class="fact"><span>Temps de lecture</span><b>${fmtDur(b.timeSec)}</b></div>
            <div class="fact"><span>Passages surlignés</span><b>${nHl}</b></div>
            <div class="fact"><span>Commencé le</span><b style="font-size:15px">${fmtDate(b.startedAt)}</b></div>
            <div class="fact"><span>Terminé le</span><b style="font-size:15px">${fmtDate(b.finishedAt)}</b></div>
          </div>
        </div>`;
      const on = (a, fn) => { const el = screen.querySelector(`[data-a="${a}"]`); if (el) el.onclick = fn; };
      on('close', close);
      on('prev', () => go(-1));
      on('next', () => go(1));
      on('read', () => { close(); Reader.open(id); });
      on('more', (e) => { screen.querySelector('[data-desc]').textContent = desc; e.target.remove(); });
      on('kindle', () => sendToKindle(b, screen.querySelector('[data-a="kindle"]'), draw));
      on('coll', () => pickCollections(b, () => { draw(); render(); }));
      on('done', () => {
        markDone(b, statusOf(b) !== 'done');
        Store.save(); draw(); render();
      });
      on('remove', async () => {
        if (!(await confirmDialog('Retirer « ' + b.title + ' » ?', 'Le livre, sa progression, ses passages surlignés et ses marque-pages seront supprimés de Folio. Ton fichier d\'origine n\'est pas touché.', 'Retirer', true))) return;
        const gone = id;
        const i = list.indexOf(gone);
        await removeBook(gone);
        list = list.filter((x) => x !== gone);
        render();
        toast('Livre retiré');
        if (!list.length) { close(); return; }
        id = list[Math.min(i, list.length - 1)]; b = S.books[id];
        draw();
      });
    };
    draw();
  }

  async function removeBook(id) {
    const b = S.books[id];
    if (!b) return;
    await Native.deleteBook(b.path);
    delete S.books[id];
    delete S.bookSettings[id];
    S.annotations = S.annotations.filter((a) => a.bookId !== id);
    S.bookmarks = S.bookmarks.filter((a) => a.bookId !== id);
    delete covers[id];
    Store.idbDel('covers', id);
    Store.idbDel('locations', id);
    Store.save();
  }

  function pickCollections(b, done) {
    const draw = (s) => {
      s.el.innerHTML = `<div class="grabber"></div><div class="sheet-head"><h2>Collections</h2><button class="link-btn" data-a="new">Nouvelle</button></div>
        ${S.collections.length ? S.collections.map((c) => `<label class="check-row"><input type="checkbox" value="${c.id}"${(b.collections || []).includes(c.id) ? ' checked' : ''}>${esc(c.name)}</label>`).join('') : '<div class="list-empty">Aucune collection. Crée la première.</div>'}
        <button class="btn btn-primary btn-block" data-a="ok">Terminé</button>`;
      $$('input[type=checkbox]', s.el).forEach((cb) => {
        cb.onchange = () => {
          b.collections = (b.collections || []).filter((x) => x !== cb.value);
          if (cb.checked) b.collections.push(cb.value);
          Store.save();
        };
      });
      s.el.querySelector('[data-a="new"]').onclick = async () => {
        const name = await promptDialog('Nouvelle collection', '', 'Créer');
        if (name && name.trim()) {
          const c = { id: Store.uid(), name: name.trim() };
          S.collections.push(c);
          b.collections = (b.collections || []).concat(c.id);
          Store.save();
          draw(s);
        }
      };
      s.el.querySelector('[data-a="ok"]').onclick = () => s.close();
    };
    const s = sheet('', { onClose: done });
    draw(s);
  }

  // ---------- Kindle ----------
  function kindleReady() {
    const k = S.prefs.kindle;
    return !!(k.to && k.from && k.hasPassword);
  }

  function safeFilename(t) {
    return (t || 'livre').normalize('NFC').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'livre';
  }

  async function sendToKindle(b, btn, after) {
    if (!kindleReady()) {
      toast('Configure d\'abord l\'envoi vers ta Kindle');
      openKindleSheet();
      return;
    }
    if (b.size > 24 * 1024 * 1024) {
      if (!(await confirmDialog('Fichier volumineux', 'Ce livre fait ' + fmtSize(b.size) + '. Gmail refuse les pièces jointes de plus de 25 Mo : l\'envoi risque d\'échouer.', 'Essayer quand même'))) return;
    }
    const k = S.prefs.kindle;
    const label = btn.querySelector('span');
    btn.disabled = true;
    label.textContent = 'Envoi en cours…';
    try {
      await Native.sendToKindle({ path: b.path, to: k.to, from: k.from, host: k.host, port: Number(k.port) || 587, title: b.title, filename: safeFilename(b.title) + '.epub' });
      b.kindleSentAt = Date.now();
      Store.save();
      toast('Envoyé à ta Kindle : il arrivera dans quelques minutes.', 4000);
      after();
    } catch (e) {
      btn.disabled = false;
      label.textContent = 'Envoyer à ma Kindle';
      alertDialog('Envoi impossible', e.message || String(e));
    }
  }

  function kindleFormHTML() {
    const k = S.prefs.kindle;
    return `<div class="set-stack"><label class="field-label" for="k-to">Adresse de ta Kindle</label><input id="k-to" class="text-input" type="email" inputmode="email" placeholder="prenom_xxxx@kindle.com" value="${esc(k.to)}" autocomplete="off"></div>
      <div class="set-stack"><label class="field-label" for="k-from">Adresse d'envoi (Gmail)</label><input id="k-from" class="text-input" type="email" inputmode="email" placeholder="ton.adresse@gmail.com" value="${esc(k.from)}" autocomplete="off"></div>
      <div class="set-stack"><label class="field-label" for="k-pw">Mot de passe d'application</label><input id="k-pw" class="text-input" type="password" placeholder="${k.hasPassword ? 'Enregistré · laisser vide pour le garder' : '16 lettres'}" autocomplete="off"></div>
      <div class="set-stack" style="flex-direction:row;gap:10px">
        <div style="flex:2"><label class="field-label" for="k-host">Serveur SMTP</label><input id="k-host" class="text-input" value="${esc(k.host)}" autocomplete="off"></div>
        <div style="flex:1"><label class="field-label" for="k-port">Port</label><input id="k-port" class="text-input" inputmode="numeric" value="${esc(k.port)}"></div>
      </div>
      <div style="display:flex;gap:8px;padding:14px 0 6px"><button class="btn btn-primary" id="k-save" style="flex:1">Enregistrer</button><button class="btn btn-soft" id="k-test" style="flex:1">Tester la connexion</button></div>
      <div class="help"><b>Comment faire</b><ol>
        <li>Sur ton compte Gmail, active la <b>validation en deux étapes</b>, puis crée un <b>mot de passe d'application</b> (Compte Google › Sécurité › Mots de passe des applications).</li>
        <li>Sur Amazon : Gérer votre contenu et vos appareils › Préférences › Paramètres des documents personnels. Ajoute ton adresse Gmail aux <b>adresses e-mail approuvées</b>.</li>
        <li>Au même endroit, recopie l'adresse <b>@kindle.com</b> de ta liseuse ci-dessus.</li>
      </ol>Les adresses Outlook / Hotmail ne peuvent plus envoyer depuis une appli comme celle-ci : utilise un compte Gmail. Le mot de passe est chiffré sur le téléphone et n'est jamais réaffiché.</div>`;
  }

  function bindKindleForm(root, onSaved) {
    const read = () => ({
      to: $('#k-to', root).value.trim(),
      from: $('#k-from', root).value.trim(),
      host: $('#k-host', root).value.trim() || 'smtp.gmail.com',
      port: parseInt($('#k-port', root).value, 10) || 587
    });
    const persist = async () => {
      const v = read();
      if (v.to && !/@kindle\.(com|cn)$/i.test(v.to)) { alertDialog('Adresse Kindle', 'L\'adresse de la Kindle se termine par @kindle.com.'); return false; }
      if (v.from && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.from)) { alertDialog('Adresse d\'envoi', 'Cette adresse e-mail ne semble pas valide.'); return false; }
      const pw = $('#k-pw', root).value;
      Object.assign(S.prefs.kindle, v);
      if (pw) {
        try {
          await Native.setPassword(pw);
          S.prefs.kindle.hasPassword = true;
          $('#k-pw', root).value = '';
          $('#k-pw', root).placeholder = 'Enregistré · laisser vide pour le garder';
        } catch (e) {
          alertDialog('Mot de passe', e.message || String(e));
          return false;
        }
      }
      Store.save();
      return true;
    };
    $('#k-save', root).onclick = async () => {
      if (await persist()) { toast(kindleReady() ? 'Kindle prête' : 'Enregistré'); if (onSaved) onSaved(); }
    };
    $('#k-test', root).onclick = async (e) => {
      if (!(await persist())) return;
      const k = S.prefs.kindle;
      if (!k.from || !k.hasPassword) { alertDialog('Test', 'Indique l\'adresse d\'envoi et le mot de passe d\'application.'); return; }
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Test…';
      try {
        await Native.testMail({ from: k.from, host: k.host, port: Number(k.port) || 587 });
        alertDialog('Connexion réussie', 'Folio peut envoyer depuis ' + k.from + '. Pense à ajouter cette adresse aux expéditeurs approuvés sur Amazon.');
      } catch (err) {
        alertDialog('Connexion impossible', err.message || String(err));
      }
      btn.disabled = false; btn.textContent = 'Tester la connexion';
    };
  }

  function openKindleSheet() {
    const s = sheet(`<div class="sheet-head"><h2>Envoyer à ma Kindle</h2></div><div>${kindleFormHTML()}</div>`, { tall: true });
    bindKindleForm(s.el, () => { if (kindleReady()) s.close(); });
  }

  // ---------- Notes ----------
  function notesHTML() {
    const anns = S.annotations.filter((a) => S.books[a.bookId]);
    const booksWith = [...new Set(anns.map((a) => a.bookId))].map((id) => S.books[id]);
    let list = anns.slice().sort((a, b) => b.createdAt - a.createdAt);
    if (view.notesBook) list = list.filter((a) => a.bookId === view.notesBook);
    if (view.notesColor) list = list.filter((a) => a.color === view.notesColor);
    const head = `<div class="page-head"><h1>Notes</h1>${anns.length ? `<button class="btn btn-soft" id="export-md" style="min-height:40px;font-size:14px">${icon('download', 18)} Exporter .md</button>` : ''}</div>`;
    if (!anns.length) {
      return `<div class="page">${head}<div class="empty">${icon('note', 40)}<h2>Aucun passage pour l'instant</h2><p>Pendant la lecture, sélectionne un passage pour le surligner ou y ajouter une note. Tout se retrouve ici.</p></div></div>`;
    }
    const bookSel = `<label class="sr" for="nb">Livre</label><select id="nb" class="sort-select" style="max-width:100%"><option value="">Tous les livres (${anns.length})</option>${booksWith.map((b) => `<option value="${b.id}"${view.notesBook === b.id ? ' selected' : ''}>${esc(b.title)}</option>`).join('')}</select>`;
    const colorChips = `<div class="chips"><button class="chip" data-nc="" aria-pressed="${!view.notesColor}">Toutes</button>${Object.keys(HL_COLORS).map((c) => `<button class="chip" data-nc="${c}" aria-pressed="${view.notesColor === c}"><span class="chip-dot" style="background:${HL_COLORS[c]}"></span> ${HL_NAMES[c]}</button>`).join('')}</div>`;
    return `<div class="page">${head}${bookSel}${colorChips}
      <div style="display:flex;flex-direction:column;gap:10px">${list.length ? list.map((a) => {
        const b = S.books[a.bookId];
        const markStyle = a.style === 'ul' ? `background:none;text-decoration:underline;text-decoration-color:${HL_COLORS[a.color]};text-decoration-thickness:3px` : `background:${HL_COLORS[a.color]};color:#1E2A44`;
        return `<div class="note-card"><button class="quote" data-go="${a.id}"><mark style="${markStyle}">${esc(a.text)}</mark></button>
          ${a.note ? `<div class="note">${esc(a.note)}</div>` : ''}
          <div class="note-foot"><span>${esc(b.title)}${a.chapter ? ' · ' + esc(a.chapter) : ''} · ${new Date(a.createdAt).toLocaleDateString('fr-FR')}</span>
          <span style="display:flex"><button class="icon-btn" data-edit="${a.id}" aria-label="Modifier la note">${icon('edit', 18)}</button><button class="icon-btn" data-del="${a.id}" aria-label="Supprimer">${icon('trash', 18)}</button></span></div></div>`;
      }).join('') : '<div class="list-empty">Aucun passage avec ces filtres.</div>'}</div></div>`;
  }

  function markdownFor(bookIds) {
    let md = '# Mes notes Folio\n\n';
    bookIds.forEach((id) => {
      const b = S.books[id];
      const anns = S.annotations.filter((a) => a.bookId === id).sort((x, y) => (x.pct || 0) - (y.pct || 0));
      if (!b || !anns.length) return;
      md += `## ${b.title}${b.author ? ' — ' + b.author : ''}\n\n`;
      anns.forEach((a) => {
        md += a.text.split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
        if (a.note) md += a.note + '\n\n';
        md += `*${[a.chapter, new Date(a.createdAt).toLocaleDateString('fr-FR')].filter(Boolean).join(' · ')}*\n\n`;
      });
    });
    return md;
  }

  function bindNotes(main) {
    const nb = $('#nb', main);
    if (nb) nb.onchange = () => { view.notesBook = nb.value; render(); };
    $$('[data-nc]', main).forEach((b) => { b.onclick = () => { view.notesColor = b.dataset.nc; render(); }; });
    $$('[data-go]', main).forEach((b) => {
      b.onclick = () => { const a = S.annotations.find((x) => x.id === b.dataset.go); if (a) Reader.open(a.bookId, a.cfi); };
    });
    $$('[data-edit]', main).forEach((b) => {
      b.onclick = async () => {
        const a = S.annotations.find((x) => x.id === b.dataset.edit);
        const v = await promptDialog('Note', a.note || '', 'Enregistrer', true);
        if (v !== null) { a.note = v.trim(); Store.save(); render(); }
      };
    });
    $$('[data-del]', main).forEach((b) => {
      b.onclick = async () => {
        if (!(await confirmDialog('Supprimer ce passage ?', null, 'Supprimer', true))) return;
        S.annotations = S.annotations.filter((x) => x.id !== b.dataset.del);
        Store.save(); render();
      };
    });
    const ex = $('#export-md', main);
    if (ex) ex.onclick = async () => {
      const ids = view.notesBook ? [view.notesBook] : [...new Set(S.annotations.map((a) => a.bookId))];
      const name = view.notesBook ? safeFilename(S.books[view.notesBook].title) + ' - notes.md' : 'notes-folio.md';
      try {
        if (await Native.saveTextFile(name, markdownFor(ids), 'text/markdown')) toast('Notes exportées');
      } catch (e) { alertDialog('Export impossible', e.message || String(e)); }
    };
  }

  // ---------- Statistiques ----------
  function secOn(d) { return S.stats.days[Store.dayKey(d)] || 0; }

  function streaks() {
    const d = new Date();
    if (secOn(d) < 60) d.setDate(d.getDate() - 1);
    let cur = 0;
    while (secOn(d) >= 60) { cur++; d.setDate(d.getDate() - 1); }
    const keys = Object.keys(S.stats.days).filter((k) => S.stats.days[k] >= 60).sort();
    let best = 0; let run = 0; let prev = null;
    keys.forEach((k) => {
      const t = new Date(k + 'T12:00:00');
      run = prev && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = t;
    });
    return { cur, best: Math.max(best, cur) };
  }

  function statsHTML() {
    const now = new Date();
    const monday = new Date(now); monday.setHours(12, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const week = [];
    for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(monday.getDate() + i); week.push({ d, sec: secOn(d) }); }
    const weekTotal = week.reduce((s, x) => s + x.sec, 0);
    const maxDay = Math.max(1800, ...week.map((x) => x.sec));
    const todayKey = Store.dayKey(now);
    const lbl = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    const { cur, best } = streaks();
    const year = now.getFullYear();
    const books = Object.values(S.books);
    const finishedYear = books.filter((b) => b.finishedAt && new Date(b.finishedAt).getFullYear() === year);
    const months = Array.from({ length: 12 }, (_, m) => finishedYear.filter((b) => new Date(b.finishedAt).getMonth() === m).length);
    const maxM = Math.max(1, ...months);
    const totalSec = Object.values(S.stats.days).reduce((s, x) => s + x, 0);
    let last30 = 0;
    for (let i = 0; i < 30; i++) { const d = new Date(); d.setDate(d.getDate() - i); last30 += secOn(d); }
    const speed = Math.round((S.stats.speed || 1.3) * 60);
    const goal = S.prefs.goal || 0;
    const today = secOn(now);
    const top = books.filter((b) => b.timeSec > 0).sort((a, b) => b.timeSec - a.timeSec).slice(0, 5);
    const ml = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    return `<div class="page"><div class="page-head"><h1>Statistiques</h1></div>
      <div class="stat-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px">
          <div><div class="stat-label">Cette semaine</div><div class="stat-big">${fmtDur(weekTotal)}</div></div>
          <div style="text-align:right"><div class="stat-label">Série</div><div style="font-size:18px;font-weight:600;color:var(--accent)">${cur} jour${cur > 1 ? 's' : ''}</div></div>
        </div>
        <div class="bars" role="img" aria-label="Minutes de lecture par jour cette semaine">${week.map((x, i) => `<div class="col">${x.sec >= 60 ? `<span class="val">${Math.round(x.sec / 60)}</span>` : ''}<div class="fill${x.sec < 60 ? ' zero' : ''}${Store.dayKey(x.d) === todayKey ? ' today' : ''}" style="height:${Math.max(4, Math.round(x.sec / maxDay * 80))}px"></div><span class="lbl">${lbl[i]}</span></div>`).join('')}</div>
        <div class="goal-row">${goal ? `<div style="flex:1"><div class="row-between" style="margin-bottom:6px"><span>Objectif du jour</span><span>${Math.min(goal, Math.round(today / 60))} / ${goal} min</span></div><div class="bar"><div style="width:${Math.min(100, Math.round(today / 60 / goal * 100))}%"></div></div></div>` : '<span class="muted" style="font-size:14px">Pas d\'objectif quotidien</span>'}<button class="link-btn" id="goal-btn">${goal ? 'Modifier' : 'Fixer un objectif'}</button></div>
      </div>
      <div class="stat-grid">
        <div class="stat-tile"><span class="stat-label">Meilleure série</span><b>${best} jour${best > 1 ? 's' : ''}</b></div>
        <div class="stat-tile"><span class="stat-label">Livres terminés en ${year}</span><b>${finishedYear.length}</b></div>
        <div class="stat-tile"><span class="stat-label">Temps total</span><b>${fmtDur(totalSec)}</b></div>
        <div class="stat-tile"><span class="stat-label">Moyenne (30 jours)</span><b>${fmtDur(last30 / 30)} / j</b></div>
        <div class="stat-tile"><span class="stat-label">Vitesse de lecture</span><b>${speed} pages / h</b></div>
        <div class="stat-tile"><span class="stat-label">Livres en cours</span><b>${books.filter((b) => statusOf(b) === 'reading').length}</b></div>
      </div>
      <div class="stat-card"><div class="stat-label">Livres terminés par mois en ${year}</div>
        <div class="bars months" role="img" aria-label="Livres terminés par mois">${months.map((n, i) => `<div class="col">${n ? `<span class="val">${n}</span>` : ''}<div class="fill${n ? '' : ' zero'}" style="height:${Math.max(4, Math.round(n / maxM * 60))}px"></div><span class="lbl">${ml[i]}</span></div>`).join('')}</div></div>
      ${top.length ? `<div class="stat-card"><div class="stat-label">Où passe ton temps</div><div>${top.map((b) => `<div class="top-book">${coverHTML(b)}<div class="t"><div>${esc(b.title)}</div><div class="muted" style="font-size:12px">${esc(labelOf(b))}</div></div><span class="muted" style="font-size:13px">${fmtDur(b.timeSec)}</span></div>`).join('')}</div></div>` : ''}
      <p class="muted" style="font-size:12px;text-align:center;margin:0">Une « page » correspond à environ 1 000 caractères. Le temps s'arrête après 2 minutes sans tourner de page.</p>
    </div>`;
  }

  function bindStats(main) {
    const g = $('#goal-btn', main);
    if (g) g.onclick = () => {
      const opts = [0, 10, 15, 20, 30, 45, 60, 90];
      const s = sheet(`<div class="sheet-head"><h2>Objectif quotidien</h2></div><div class="seg seg-4">${opts.map((m) => `<button class="opt" data-m="${m}" aria-pressed="${(S.prefs.goal || 0) === m}">${m ? m + ' min' : 'Aucun'}</button>`).join('')}</div>`);
      $$('[data-m]', s.el).forEach((b) => { b.onclick = () => { S.prefs.goal = Number(b.dataset.m); Store.save(); s.close(); render(); }; });
    };
  }

  // ---------- Réglages ----------
  function sw(id, checked, label) {
    return `<span class="switch"><input type="checkbox" id="${id}"${checked ? ' checked' : ''} aria-label="${esc(label)}"><span></span></span>`;
  }

  function settingsHTML() {
    const p = S.prefs;
    const sel = (id, opts, val) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}"${String(val) === String(k) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    return `<div class="page"><div class="page-head"><h1>Réglages</h1></div>
      <div class="group-title">Lecture</div>
      <div class="group">
        <div class="set-row"><label for="tapMode">Zones de tap<span class="sub">Gauche et droite de l'écran ; le centre ouvre le menu</span></label>${sel('tapMode', [['normal', 'Gauche ← · Droite →'], ['inverse', 'Gauche → · Droite ←'], ['next', 'Partout : suivante']], p.tapMode)}</div>
        <div class="set-row"><label for="tapLock">Verrouiller les taps<span class="sub">Les pages ne tournent qu'en glissant (évite les erreurs)</span></label>${sw('tapLock', p.tapLock, 'Verrouiller les taps')}</div>
        <div class="set-row"><label for="volumeKeys">Boutons de volume<span class="sub">Volume bas : page suivante</span></label>${sw('volumeKeys', p.volumeKeys, 'Boutons de volume')}</div>
        <div class="set-row"><label for="keepAwake">Écran toujours allumé<span class="sub">Pendant la lecture</span></label>${sw('keepAwake', p.keepAwake, 'Écran toujours allumé')}</div>
        <div class="set-row"><label for="uiTheme">Thème de l'appli</label>${sel('uiTheme', [['follow', 'Comme la lecture'], ['papier', 'Toujours Papier']], p.uiTheme)}</div>
        <div class="set-row"><label for="goalSel">Objectif quotidien</label>${sel('goalSel', [[0, 'Aucun'], [10, '10 min'], [15, '15 min'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '1 h'], [90, '1 h 30']], p.goal)}</div>
      </div>
      <div class="group-title" id="kindle-section">Envoyer à ma Kindle</div>
      <div class="group">${kindleFormHTML()}</div>
      <div class="group-title">Sauvegarde</div>
      <div class="group">
        <div class="help" style="padding-bottom:4px">Exporte ta bibliothèque, ta progression, tes notes et tes statistiques dans un fichier. Les fichiers EPUB eux-mêmes ne sont pas inclus.</div>
        <div style="display:flex;gap:8px;padding:10px 0 14px"><button class="btn btn-soft" id="bk-export" style="flex:1">${icon('download', 18)} Exporter</button><button class="btn btn-soft" id="bk-import" style="flex:1">${icon('upload', 18)} Importer</button></div>
      </div>
      <p class="muted" style="font-size:12px;text-align:center;margin:8px 0 0">Folio · liseuse EPUB · tes données restent sur ce téléphone</p>
    </div>`;
  }

  function bindSettings(main) {
    const p = S.prefs;
    const bindSw = (id, fn) => { const el = $('#' + id, main); el.onchange = () => { p[id] = el.checked; Store.save(); if (fn) fn(); }; };
    bindSw('tapLock'); bindSw('volumeKeys'); bindSw('keepAwake');
    $('#tapMode', main).onchange = (e) => { p.tapMode = e.target.value; Store.save(); };
    $('#uiTheme', main).onchange = (e) => { p.uiTheme = e.target.value; Store.save(); render(); };
    $('#goalSel', main).onchange = (e) => { p.goal = Number(e.target.value); Store.save(); };
    bindKindleForm(main);
    $('#bk-export', main).onclick = async () => {
      try {
        if (await Native.saveTextFile('folio-sauvegarde-' + Store.dayKey() + '.json', Store.exportData(), 'application/json')) toast('Sauvegarde exportée');
      } catch (e) { alertDialog('Export impossible', e.message || String(e)); }
    };
    $('#bk-import', main).onclick = async () => {
      try {
        const text = await Native.openTextFile();
        if (!text) return;
        if (!(await confirmDialog('Importer cette sauvegarde ?', 'Ta progression, tes notes et tes réglages seront remplacés par ceux du fichier. Les livres déjà présents sur ce téléphone sont conservés.', 'Importer'))) return;
        Store.importData(text);
        await loadCovers();
        render();
        toast('Sauvegarde importée');
      } catch (e) { alertDialog('Import impossible', e.message || String(e)); }
    };
  }


  // ---------- Widget de l'écran d'accueil ----------
  let widgetCoverId = null;
  let widgetLast = '';
  function syncWidget() {
    if (!Native.isNative) return;
    const cur = Object.values(S.books).filter((b) => statusOf(b) === 'reading' && !b.missing).sort((a, b) => b.openedAt - a.openedAt)[0];
    const todayMin = Math.round((S.stats.days[Store.dayKey()] || 0) / 60);
    const goal = S.prefs.goal || 0;
    const today = goal ? `${Math.min(todayMin, goal)} / ${goal} min aujourd'hui` : (todayMin ? `${todayMin} min aujourd'hui` : '');
    const data = cur ? { id: cur.id, title: cur.title, pct: Math.round((cur.pct || 0) * 100), today } : { id: '', title: '', pct: 0, today };
    const key = JSON.stringify(data);
    const coverChanged = cur ? widgetCoverId !== cur.id : widgetCoverId !== '';
    if (key === widgetLast && !coverChanged) return;
    widgetLast = key;
    if (coverChanged) {
      widgetCoverId = cur ? cur.id : '';
      if (cur && covers[cur.id]) data.cover = covers[cur.id];
      else data.noCover = true;
    }
    Native.updateWidget(data);
  }

  // ---------- Démarrage ----------
  async function loadCovers() {
    await Promise.all(Object.keys(S.books).map(async (id) => {
      try { const c = await Store.idbGet('covers', id); if (c) covers[id] = c; } catch (e) { /* rien */ }
    }));
  }

  function onBack() {
    if (backStack.length) { backStack[backStack.length - 1](); return; }
    if (view.tab !== 'books') { setTab('books'); return; }
    if (view.filter !== 'all' || view.query) { view.filter = 'all'; view.query = ''; render(); return; }
    Native.exitApp();
  }

  async function start() {
    document.getElementById('app').innerHTML = `<main id="main"></main>
      <nav class="tabbar" aria-label="Navigation">
        <button data-tab="books">${icon('books')}Livres</button>
        <button data-tab="notes">${icon('note')}Notes</button>
        <button data-tab="stats">${icon('stats')}Stats</button>
        <button data-tab="settings">${icon('gear')}Réglages</button>
      </nav>`;
    $$('.tabbar button').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
    applyUiTheme();
    let fixed = false;
    Object.values(S.books).forEach((b) => {
      if (b.description && /[<>]|&[#a-z0-9]+;/i.test(b.description)) { b.description = stripHtml(b.description); fixed = true; }
    });
    if (fixed) Store.save();
    await loadCovers();
    render();
    Native.onBack(onBack);
    Native.onIncomingBook(handleIncoming);
    Native.onOpenBook((d) => {
      if (!d || !S.books[d.id]) return;
      if (Reader.isOpen && Reader.currentId === d.id) return;
      closeOverlays();
      Reader.open(d.id);
    });
    if (Native.isNative) {
      Native.hasPassword().then((has) => {
        if (has !== S.prefs.kindle.hasPassword) { S.prefs.kindle.hasPassword = has; Store.save(); }
      });
    }
  }

  window.UI = {
    esc, icon, toast, sheet, confirmDialog, alertDialog, promptDialog, pushBack, render, applyUiTheme,
    fmtDur, statusOf, coverHTML, HL_COLORS, HL_NAMES, openDetail, closeOverlays, syncWidget
  };

  document.addEventListener('DOMContentLoaded', start);
})();
