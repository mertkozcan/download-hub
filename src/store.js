// Tiny JSON persistence: settings + job list. Secrets (API keys) are encrypted with
// Electron safeStorage (Windows DPAPI) when available.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  downloadDir: '',
  concurrency: 2,
  // Post-process presets: { id, name, extractTo, extract, copyTo, deleteArchive }
  presets: [],
  confirmBrowser: true,
  updateUrl: 'https://github.com/mertkozcan/download-hub/releases/latest/download',   // GitHub Releases (public); editable in Settings
  secrets: {},
};

class Store {
  constructor(dir, safeStorage) {
    this.file = path.join(dir, 'modfetch.json');
    this.safe = safeStorage;
    this.data = { settings: { ...DEFAULTS }, jobs: [], history: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data.settings = { ...DEFAULTS, ...(raw.settings || {}) };
      this.data.jobs = raw.jobs || [];
      this.data.history = raw.history || [];
    } catch { /* first run */ }
    this._t = null;
  }

  get settings() { return this.data.settings; }

  setSettings(patch) {
    const { secrets, ...rest } = patch; // secrets only via setSecret
    Object.assign(this.data.settings, rest);
    this.flush();
  }

  setSecret(key, value) {
    const s = this.data.settings.secrets;
    if (!value) delete s[key];
    else if (this.safe && this.safe.isEncryptionAvailable()) s[key] = 'enc:' + this.safe.encryptString(value).toString('base64');
    else s[key] = 'raw:' + Buffer.from(value).toString('base64');
    this.flush();
  }

  hasSecret(key) { return !!this.data.settings.secrets[key]; }

  getSecret(key) {
    const v = this.data.settings.secrets[key];
    if (!v) return '';
    const buf = Buffer.from(v.slice(4), 'base64');
    return v.startsWith('enc:') ? this.safe.decryptString(buf) : buf.toString();
  }

  addHistory(h) { this.data.history.push(h); if (this.data.history.length > 2000) this.data.history.shift(); this.schedule(); }
  clearHistory() { this.data.history = []; this.flush(); }
  removeHistory(id) { this.data.history = this.data.history.filter(h => h.id !== id); this.schedule(); }

  saveJobs(jobs) { this.data.jobs = jobs; this.schedule(); }
  schedule() { clearTimeout(this._t); this._t = setTimeout(() => this.flush(), 400); }

  flush() {
    clearTimeout(this._t);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const json = JSON.stringify(this.data, null, 2);
      const tmp = this.file + '.tmp';
      try { fs.writeFileSync(tmp, json); fs.renameSync(tmp, this.file); }
      catch { fs.writeFileSync(this.file, json); try { fs.unlinkSync(tmp); } catch { /* none */ } }
    } catch (e) { console.error('store flush failed', e); }
  }
}

module.exports = { Store };
