// Site profile ("plugin") loader.
//
// A profile is either a CommonJS .js module or a declarative .json file, placed in
//   <app>/plugins            (bundled)
//   <userData>/plugins       (yours; survives updates)  -> menu: Sites > Open plugins folder
//
// JS profile shape (see plugins/nexusmods.js and README):
//   module.exports = {
//     id, name,
//     match: [/regex/ or 'regex string'],         // URLs this profile handles
//     login: { url },                              // optional: page opened in the embedded browser
//     secrets: [{ key, label }],                   // optional: user-provided keys shown in Settings
//     async resolve(ctx) -> { url, filename?, headers? }
//   }
// ctx: { url, match (regex exec result), fetch(url, init), getSecret(key), log(msg), settings }
// JS profiles run with full Node access: only install ones you trust.
const fs = require('fs');
const path = require('path');

function toRegex(m) { return m instanceof RegExp ? m : new RegExp(m, 'i'); }

function getPath(obj, p) {
  return p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function fill(tpl, m) {
  return tpl.replace(/\$(\d+)/g, (_, i) => (m && m[i]) || '');
}

// ---- declarative (.json) profiles -> plugin objects ----
function fromJson(def) {
  const r = def.resolve || { type: 'direct' };
  return {
    id: def.id, name: def.name, match: def.match, login: def.login, secrets: def.secrets,
    description: def.description,
    async resolve(ctx) {
      const referer = def.referer ? ctx.url : undefined;
      const headers = { ...(def.headers || {}), ...(referer ? { Referer: referer } : {}) };
      switch (r.type) {
        case 'direct': return { url: ctx.url, headers };
        case 'template': return { url: fill(r.url, ctx.match), headers };
        case 'html': {
          const page = await ctx.fetch(r.pageUrl ? fill(r.pageUrl, ctx.match) : ctx.url, { headers });
          if (!page.ok) throw new Error(`Page returned HTTP ${page.status}`);
          const html = await page.text();
          const m = new RegExp(r.pattern, 'i').exec(html);
          if (!m) throw new Error('Download link pattern not found on page (not logged in? verification page?)');
          const link = new URL(m[1].replace(/&amp;/g, '&'), page.url || ctx.url).href;
          return { url: link, headers: { ...headers, Referer: ctx.url } };
        }
        case 'json': {
          const res = await ctx.fetch(fill(r.apiUrl, ctx.match), { headers });
          if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
          const v = getPath(await res.json(), r.path);
          if (typeof v !== 'string') throw new Error(`No string at JSON path "${r.path}"`);
          return { url: v, headers };
        }
        default: throw new Error(`Unknown resolve type: ${r.type}`);
      }
    },
  };
}

const GENERIC = {
  id: 'generic', name: 'Generic (direct link)', match: ['^https?://'],
  description: 'Fallback: downloads the URL as-is. Add a site profile if the site needs login.',
  async resolve(ctx) { return { url: ctx.url }; },
};

class PluginHost {
  constructor({ dirs, store, electronSession, log }) {
    this.dirs = dirs;
    this.store = store;
    this.electronSession = electronSession; // (partitionName) => Session
    this.log = log || (() => {});
    this.plugins = [];
    this.errors = [];
    this.reload();
  }

  reload() {
    this.plugins = [];
    this.errors = [];
    for (const dir of this.dirs) {
      let files = [];
      try { files = fs.readdirSync(dir.path); } catch { continue; }
      for (const f of files) {
        const full = path.join(dir.path, f);
        try {
          let p;
          if (f.endsWith('.js')) { delete require.cache[require.resolve(full)]; p = require(full); }
          else if (f.endsWith('.json') && !f.startsWith('_')) p = fromJson(JSON.parse(fs.readFileSync(full, 'utf8')));
          else continue;
          if (!p || !p.id || !p.name || !p.match || typeof p.resolve !== 'function') throw new Error('missing id/name/match/resolve');
          p = Object.assign({}, p, { _matchers: [].concat(p.match).map(toRegex), source: dir.label, file: full });
          this.plugins = this.plugins.filter(x => x.id !== p.id); // user plugins override bundled
          this.plugins.push(p);
        } catch (e) { this.errors.push({ file: full, error: e.message }); }
      }
    }
    this.plugins.push(Object.assign({}, GENERIC, { _matchers: GENERIC.match.map(toRegex), source: 'builtin' }));
  }

  find(url) {
    for (const p of this.plugins) {
      if (p.id === 'generic') continue;
      for (const re of p._matchers) { const m = re.exec(url); if (m) return { plugin: p, match: m }; }
    }
    const g = this.plugins.find(p => p.id === 'generic');
    const m = g._matchers[0].exec(url);
    return m ? { plugin: g, match: m } : null;
  }

  byId(id) { return this.plugins.find(p => p.id === id); }

  partition(plugin) { return `persist:site-${plugin.id}`; }
  session(plugin) { return this.electronSession(this.partition(plugin)); }

  async resolve(url) {
    const hit = this.find(url);
    if (!hit) throw new Error('Unsupported URL (need http/https or a profile that matches it)');
    const { plugin, match } = hit;
    const ses = this.session(plugin);
    const ctx = {
      url, match,
      fetch: (u, init) => ses.fetch(u, init),
      getSecret: k => this.store.getSecret(`${plugin.id}.${k}`),
      log: m => this.log(`[${plugin.id}] ${m}`),
      settings: this.store.settings,
    };
    const result = await plugin.resolve(ctx);
    if (!result || !result.url) throw new Error('Profile returned no URL');
    return { plugin, result };
  }
}

module.exports = { PluginHost };
