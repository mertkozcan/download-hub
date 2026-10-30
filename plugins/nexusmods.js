// Nexus Mods profile — official routes only (nxm:// links + public REST API with YOUR personal API key).
// No scraping, no CAPTCHA handling. Terms: https://help.nexusmods.com/article/18-api-acceptable-use-policy
//
//  * Free accounts: on the mod page, press "Slow download" / "Mod Manager Download". The browser emits an
//    nxm://... link containing a one-time key; ModFetch (embedded browser or registered nxm handler) catches it.
//  * Premium accounts: pasting the normal mod URL (optionally with ?tab=files&file_id=N) is enough.
const NXM = /^nxm:\/\/([^/]+)\/mods\/(\d+)\/files\/(\d+)\??(.*)$/i;
const WEB = /^https?:\/\/(?:www\.)?nexusmods\.com\/([^/]+)\/mods\/(\d+)(?:[/?#].*)?$/i;
const API = 'https://api.nexusmods.com/v1';

module.exports = {
  id: 'nexusmods',
  name: 'Nexus Mods',
  description: 'nxm:// links + official API (needs your personal API key from nexusmods.com/settings/api-keys).',
  match: [NXM, WEB],
  login: { url: 'https://www.nexusmods.com/' },
  secrets: [{ key: 'apiKey', label: 'Nexus personal API key' }],

  async resolve(ctx) {
    const apiKey = ctx.getSecret('apiKey');
    if (!apiKey) throw new Error('Set your Nexus API key in Settings first (nexusmods.com > Settings > API Keys).');
    const call = async (p) => {
      const r = await ctx.fetch(API + p, { headers: { apikey: apiKey, 'Application-Name': 'ModFetch', 'Application-Version': '0.1.0', Accept: 'application/json' } });
      if (r.status === 401) throw new Error('Nexus rejected the API key (401).');
      if (r.status === 403) throw new Error('Nexus: premium required for direct links. Free users: use the "Mod Manager Download" button on the site (Sites > Nexus Mods > Open browser).');
      if (!r.ok) throw new Error(`Nexus API HTTP ${r.status}`);
      return r.json();
    };

    let game, modId, fileId, qs = '';
    let m = NXM.exec(ctx.url);
    if (m) {
      [, game, modId, fileId] = m; qs = m[4] ? '?' + m[4].split('&').filter(x => /^(key|expires)=/.test(x)).join('&') : '';
      if (qs === '?') qs = '';
    } else {
      m = WEB.exec(ctx.url);
      [, game, modId] = m;
      fileId = new URL(ctx.url).searchParams.get('file_id');
    }

    let filename;
    if (!fileId || !filename) {
      const list = await call(`/games/${game}/mods/${modId}/files.json?category=main,update,optional`);
      const files = list.files || [];
      let f = fileId ? files.find(x => String(x.file_id) === String(fileId)) : (files.find(x => x.is_primary) || files.filter(x => x.category_name === 'MAIN').pop() || files[files.length - 1]);
      if (!f && !fileId) throw new Error('No files found for this mod.');
      if (f) { fileId = f.file_id; filename = f.file_name; }
    }
    const links = await call(`/games/${game}/mods/${modId}/files/${fileId}/download_link.json${qs}`);
    if (!Array.isArray(links) || !links[0]) throw new Error('Nexus returned no download link.');
    return { url: links[0].URI, filename };
  },
};
