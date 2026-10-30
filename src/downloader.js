// Download queue: resolve via site profile -> stream to .part file -> rename -> post-process.
// Pause = abort + keep .part; resume uses HTTP Range.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const post = require('./postprocess');

const PUBLIC = ['id', 'url', 'pluginId', 'pluginName', 'dir', 'filename', 'received', 'total', 'status', 'error',
  'speed', 'presetId', 'notes', 'resolved', 'addedAt'];

function sanitize(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 200) || 'download';
}

function nameFromDisposition(h) {
  if (!h) return null;
  let m = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(h);
  if (m) { try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')); } catch { /* fallthrough */ } }
  m = /filename="?([^";]+)"?/i.exec(h);
  return m ? m[1] : null;
}

class DownloadManager extends EventEmitter {
  constructor({ store, plugins }) {
    super();
    this.store = store;
    this.plugins = plugins;
    this.jobs = new Map();
    for (const j of store.data.jobs) {
      if (['resolving', 'downloading', 'queued'].includes(j.status)) j.status = 'paused';
      this.jobs.set(j.id, { ...j, speed: 0 });
    }
    this._emitT = new Map();
  }

  view(j) { const o = {}; for (const k of PUBLIC) o[k] = j[k]; return o; }
  list() { return [...this.jobs.values()].sort((a, b) => a.addedAt - b.addedAt).map(j => this.view(j)); }

  _changed(j, immediate) {
    this.store.saveJobs([...this.jobs.values()].map(x => this.view(x)));
    if (immediate) return this.emit('update', this.view(j));
    if (this._emitT.has(j.id)) return;
    this._emitT.set(j.id, setTimeout(() => { this._emitT.delete(j.id); this.emit('update', this.view(j)); }, 250));
  }

  add({ url, dir, presetId, hint, extra }) {
    url = String(url || '').trim();
    if (!url) throw new Error('Empty URL');
    const hit = this.plugins.find(url);
    if (!hit) throw new Error('Unsupported URL');
    const j = {
      id: crypto.randomBytes(5).toString('hex'), url, pluginId: hit.plugin.id, pluginName: hit.plugin.name,
      dir: dir || this.store.settings.downloadDir, filename: hint || '', received: 0, total: 0,
      status: 'queued', error: '', speed: 0, presetId: presetId || '', notes: [], addedAt: Date.now(), resolved: null,
    };
    j.extra = extra || null;   // in-memory only (may hold browser cookies); not persisted
    this.jobs.set(j.id, j);
    this._changed(j, true);
    this.pump();
    return this.view(j);
  }

  pump() {
    const max = Math.max(1, this.store.settings.concurrency | 0);
    let active = [...this.jobs.values()].filter(j => ['resolving', 'downloading'].includes(j.status)).length;
    for (const j of this.jobs.values()) {
      if (active >= max) break;
      if (j.status === 'queued') { active++; this._run(j); }
    }
  }

  pause(id) { const j = this.jobs.get(id); if (!j) return; if (j._ac) { j._intent = 'pause'; j._ac.abort(); } else if (j.status === 'queued') { j.status = 'paused'; this._changed(j, true); } }
  resume(id) { const j = this.jobs.get(id); if (j && ['paused', 'error', 'cancelled'].includes(j.status)) { j.status = 'queued'; j.error = ''; this._changed(j, true); this.pump(); } }
  cancel(id) {
    const j = this.jobs.get(id); if (!j) return;
    if (j._ac) { j._intent = 'cancel'; j._ac.abort(); } else { this._rmPart(j); j.status = 'cancelled'; this._changed(j, true); }
  }
  remove(id) { const j = this.jobs.get(id); if (!j) return; if (j._ac) { j._intent = 'cancel'; j._ac.abort(); } this._rmPart(j); this.jobs.delete(id); this.store.saveJobs([...this.jobs.values()].map(x => this.view(x))); this.emit('removed', id); }
  clearFinished() { for (const j of [...this.jobs.values()]) if (['done', 'cancelled', 'error'].includes(j.status)) this.remove(j.id); }

  _part(j) { return path.join(j.dir, `${j.id}.modfetch.part`); }
  _rmPart(j) { try { fs.unlinkSync(this._part(j)); } catch { /* none */ } }
  _note(j, m) { j.notes = [...(j.notes || []), m].slice(-20); }

  async _run(j) {
    const ac = new AbortController();
    j._ac = ac; j._intent = null;
    let ws;
    try {
      j.status = 'resolving'; j.startedAt = j.startedAt || Date.now(); this._changed(j, true);
      let plugin, res;
      const attempt = async (forceResolve) => {
        if (forceResolve || !j.resolved) {
          const r = await this.plugins.resolve(j.url);
          plugin = r.plugin; j.resolved = r.result;
          j.pluginId = plugin.id; j.pluginName = plugin.name;
          if (r.result.filename && !j.filename) j.filename = sanitize(r.result.filename);
        } else plugin = this.plugins.byId(j.pluginId) || this.plugins.find(j.url).plugin;
        fs.mkdirSync(j.dir, { recursive: true });
        const part = this._part(j);
        let start = 0;
        try { start = fs.statSync(part).size; } catch { /* new */ }
        const headers = { ...(j.extra || {}), ...(j.resolved.headers || {}) };
        if (headers.Cookie) {   // cookies forwarded by the browser extension: put in the session jar (session-only, not persisted)
          const jar = this.plugins.session(plugin).cookies;
          for (const kv of String(headers.Cookie).split(/;\s*/)) {
            const i = kv.indexOf('='); if (i < 1) continue;
            await jar.set({ url: j.resolved.url, name: kv.slice(0, i), value: kv.slice(i + 1) }).catch(() => {});
          }
          delete headers.Cookie;
        }
        if (start > 0) headers.Range = `bytes=${start}-`;
        const r = await this.plugins.session(plugin).fetch(j.resolved.url, { headers, signal: ac.signal, redirect: 'follow' });
        return { r, start };
      };
      let { r, start } = await attempt(false);
      if ([401, 403, 404, 410].includes(r.status) && j.resolved) {
        this._note(j, `HTTP ${r.status} on stored link, re-resolving`);
        ({ r, start } = await attempt(true));
      }
      res = r;
      if (res.status === 416 && start > 0) { start = -1; }
      else if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());

      if (start !== -1) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html')) {
          throw new Error('Server returned a web page instead of a file. Login/verification may be required: open the site in the Sites tab, sign in / pass the check yourself, then retry.');
        }
        if (start > 0 && res.status !== 206) { start = 0; this._rmPart(j); }
        const len = parseInt(res.headers.get('content-length') || '0', 10);
        const cr = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
        j.total = cr ? parseInt(cr[1], 10) : (len ? start + len : 0);
        if (!j.filename) {
          j.filename = sanitize(nameFromDisposition(res.headers.get('content-disposition'))
            || decodeURIComponent(path.basename(new URL(res.url || j.resolved.url).pathname)) || 'download');
        }
        j.received = start;
        j.status = 'downloading'; this._changed(j, true);

        ws = fs.createWriteStream(this._part(j), { flags: start > 0 ? 'a' : 'w' });
        let winBytes = 0, winT = Date.now();
        for await (const chunk of Readable.fromWeb(res.body)) {
          if (!ws.write(chunk)) await new Promise(r2 => ws.once('drain', r2));
          j.received += chunk.length; winBytes += chunk.length;
          const now = Date.now();
          if (now - winT >= 1000) { j.speed = winBytes * 1000 / (now - winT); winBytes = 0; winT = now; }
          this._changed(j);
        }
        await new Promise((ok, bad) => { ws.end(); ws.on('finish', ok); ws.on('error', bad); });
        ws = null;
        if (j.total && j.received < j.total) throw new Error('Connection closed early; press Resume');
      }

      const finalPath = post.uniquePath(path.join(j.dir, j.filename));
      fs.renameSync(this._part(j), finalPath);
      j.filename = path.basename(finalPath);
      j.speed = 0;
      const preset = this.store.settings.presets.find(p => p.id === j.presetId);
      if (preset) {
        try { await post.run(finalPath, preset, m => this._note(j, m)); }
        catch (e) { this._note(j, `Post-process failed: ${e.message}`); j.error = `Downloaded, but post-process failed: ${e.message}`; }
      }
      j.status = 'done';
      this.emit('done', this.view(j), Date.now() - (j.startedAt || Date.now()));
    } catch (e) {
      try { if (ws) ws.destroy(); } catch { /* ignore */ }
      j.speed = 0;
      if (j._intent === 'pause') j.status = 'paused';
      else if (j._intent === 'cancel') { this._rmPart(j); j.status = this.jobs.has(j.id) ? 'cancelled' : j.status; }
      else { j.status = 'error'; j.error = e.cause && e.cause.message ? `${e.message} (${e.cause.message})` : e.message; }
    } finally {
      j._ac = null; j._intent = null;
      if (this.jobs.has(j.id)) this._changed(j, true);
      this.pump();
    }
  }
}

module.exports = { DownloadManager };
