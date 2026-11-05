/* Folio — pont vers les fonctions Android (avec une version de secours pour tester dans un navigateur). */
(function () {
  const C = window.Capacitor;
  const isNative = !!(C && C.isNativePlatform && C.isNativePlatform());
  const F = isNative && C.Plugins ? C.Plugins.Folio : null;
  const App = isNative && C.Plugins ? C.Plugins.App : null;

  async function sha(buf) {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(d)).slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function filePicker(accept, multiple) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = !!multiple;
      input.style.display = 'none';
      input.onchange = () => {
        resolve(Array.from(input.files || []));
        input.remove();
      };
      document.body.appendChild(input);
      input.click();
    });
  }

  const Native = {
    isNative,

    async pickBooks() {
      if (F) {
        const r = await F.pickBooks();
        return r.books || [];
      }
      const files = await filePicker('.epub,application/epub+zip', true);
      const out = [];
      for (const f of files) {
        const buf = await f.arrayBuffer();
        const head = new Uint8Array(buf.slice(0, 2));
        if (head[0] !== 0x50 || head[1] !== 0x4b) {
          out.push({ error: 'Ce fichier n\'est pas un EPUB', name: f.name });
          continue;
        }
        const id = await sha(buf);
        await Store.idbSet('files', id, buf);
        out.push({ id, path: 'idb:' + id, name: f.name, size: buf.byteLength });
      }
      return out;
    },

    async readBook(path) {
      if (path.startsWith('idb:')) {
        const buf = await Store.idbGet('files', path.slice(4));
        if (!buf) throw new Error('Fichier introuvable');
        return buf;
      }
      const url = C.convertFileSrc('file://' + path);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Fichier introuvable');
      return res.arrayBuffer();
    },

    async deleteBook(path) {
      if (!path) return;
      if (path.startsWith('idb:')) return Store.idbDel('files', path.slice(4));
      if (F) return F.deleteBook({ path });
    },

    onIncomingBook(cb) {
      if (F) F.addListener('incomingBook', cb);
    },

    onOpenBook(cb) {
      if (F) F.addListener('openBook', cb);
    },

    updateWidget(data) {
      if (F) F.updateWidget(data).catch(() => {});
    },

    onVolumeKey(cb) {
      if (F) F.addListener('volumeKey', cb);
    },

    onBack(cb) {
      if (App) App.addListener('backButton', cb);
      else window.addEventListener('keydown', (e) => { if (e.key === 'Escape') cb(); });
    },

    onPause(cb) {
      if (App) App.addListener('pause', cb);
      document.addEventListener('visibilitychange', () => { if (document.hidden) cb(); });
    },

    onResume(cb) {
      if (App) App.addListener('resume', cb);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) cb(); });
    },

    exitApp() {
      if (App) App.exitApp();
    },

    async setPassword(value) {
      if (F) return F.setPassword({ value });
      throw new Error('Disponible seulement sur le téléphone.');
    },

    async hasPassword() {
      if (F) return (await F.hasPassword()).value;
      return false;
    },

    async testMail(opts) {
      if (F) return F.testMail(opts);
      throw new Error('Disponible seulement sur le téléphone.');
    },

    async sendToKindle(opts) {
      if (F) return F.sendToKindle(opts);
      throw new Error('L\'envoi vers la Kindle fonctionne seulement sur le téléphone.');
    },

    keepAwake(on) {
      if (F) F.keepAwake({ on: !!on }).catch(() => {});
    },

    // Luminosité réelle du téléphone. Renvoie false si Folio n'a pas la permission.
    async setBrightness(value) {
      if (!F) return false;
      try { return (await F.setBrightness({ value })).ok; } catch (e) { return false; }
    },

    async setAutoBrightness(on) {
      if (!F) return false;
      try { return (await F.setAutoBrightness({ on: !!on })).ok; } catch (e) { return false; }
    },

    async getBrightness() {
      if (!F) return { value: 0.6, auto: false, allowed: false };
      try { return await F.getBrightness(); } catch (e) { return { value: 0.6, auto: false, allowed: false }; }
    },

    openBrightnessPermission() {
      if (F) F.openBrightnessPermission().catch(() => {});
    },

    setVolumeKeys(on) {
      if (F) F.setVolumeKeys({ on: !!on }).catch(() => {});
    },

    async saveTextFile(filename, content, mime) {
      if (F) return (await F.saveTextFile({ filename, content, mime: mime || 'text/plain' })).saved;
      const blob = new Blob([content], { type: mime || 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return true;
    },

    async openTextFile() {
      if (F) return (await F.openTextFile()).content;
      const files = await filePicker('.json,application/json', false);
      return files[0] ? files[0].text() : null;
    },

    async shareText(text) {
      if (F) return F.shareText({ text });
      try { await navigator.clipboard.writeText(text); } catch (e) { /* rien */ }
    }
  };

  window.Native = Native;
})();
