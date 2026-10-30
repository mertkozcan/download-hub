const APP = 'http://127.0.0.1:17653';

async function cfg() { return chrome.storage.local.get({ token: '', enabled: true, minMB: 0 }); }

chrome.downloads.onCreated.addListener(async (item) => {
  try {
    const { token, enabled, minMB } = await cfg();
    const url = item.finalUrl || item.url;
    if (!enabled || !token || !/^https?:/i.test(url)) return;      // blob:, data:, file: stay in the browser
    if (minMB && item.fileSize > 0 && item.fileSize < minMB * 1048576) return;
    const ping = await fetch(APP + '/ping').then(r => r.text()).catch(() => '');
    if (ping !== 'modfetch') return;                                 // app not running -> browser downloads normally
    const cookies = await chrome.cookies.getAll({ url }).catch(() => []);
    const r = await fetch(APP + '/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ModFetch-Token': token },
      body: JSON.stringify({
        url, referer: item.referrer || '', cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '),
        filename: (item.filename || '').split(/[\\/]/).pop(),
      }),
    });
    if (r.ok) { await chrome.downloads.cancel(item.id); await chrome.downloads.erase({ id: item.id }); }
  } catch { /* leave the browser download alone */ }
});
