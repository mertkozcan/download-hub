// Run: npx electron test/smoke.js   (headless-ish: no window; local HTTP server)
const { app, session, safeStorage } = require('electron');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const AdmZip = require('adm-zip');
const { Store } = require('../src/store');
const { PluginHost } = require('../src/plugins');
const { DownloadManager } = require('../src/downloader');

const zip = new AdmZip(); zip.addFile('modX/hello.txt', Buffer.from('hi')); const zipBuf = zip.toBuffer();
const srv = http.createServer((req, res) => {
  if (req.url === '/file.zip') {
    if (!/sess=ok/.test(req.headers.cookie || '')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>login</html>'); }
    const m = /bytes=(\d+)-/.exec(req.headers.range || ''); const s = m ? +m[1] : 0;
    res.writeHead(m ? 206 : 200, { 'content-type': 'application/zip', 'content-length': zipBuf.length - s, 'content-disposition': 'attachment; filename="mod.zip"', ...(m ? { 'content-range': `bytes ${s}-${zipBuf.length - 1}/${zipBuf.length}` } : {}) });
    return res.end(zipBuf.subarray(s));
  }
  if (req.url === '/hdr') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end('cookie=' + (req.headers.cookie || '') + ' ref=' + (req.headers.referer || '')); }
  res.writeHead(404); res.end();
});

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modfetch-'));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  fs.writeFileSync(path.join(tmp, 'p.json'), JSON.stringify({ id: 'loc', name: 'Local', match: [`^${base}/`], login: { url: base }, resolve: { type: 'direct' } }));
  const store = new Store(tmp, safeStorage);
  store.setSettings({ presets: [{ id: 'x', name: 'x', extract: true, extractTo: path.join(tmp, 'out'), deleteArchive: true }] });
  const plugins = new PluginHost({ dirs: [{ path: tmp, label: 'user' }], store, electronSession: n => session.fromPartition(n) });
  const m = new DownloadManager({ store, plugins });
  const wait = id => new Promise(r => { const f = j => { if (j.id === id && ['done', 'error'].includes(j.status)) { m.off('update', f); r(j); } }; m.on('update', f); });
  const fail = msg => { console.error('FAIL', msg); process.exit(1); };

  let j = await wait(m.add({ url: `${base}/file.zip`, dir: path.join(tmp, 'dl') }).id);
  if (j.status !== 'error' || !/login|web page/i.test(j.error)) fail('expected login-needed error: ' + JSON.stringify(j));
  console.log('ok: HTML/login wall detected');

  await session.fromPartition('persist:site-loc').cookies.set({ url: base, name: 'sess', value: 'ok' });
  m.resume(j.id); j = await wait(j.id);
  if (j.status !== 'done') fail('retry failed: ' + j.error);
  console.log('ok: download with session cookie ->', j.filename);

  const id2 = m.add({ url: `${base}/file.zip`, dir: path.join(tmp, 'dl'), presetId: 'x' }).id;
  j = await wait(id2);
  if (j.status !== 'done' || !fs.existsSync(path.join(tmp, 'out', 'modX', 'hello.txt'))) fail('postprocess: ' + JSON.stringify(j));
  console.log('ok: extract post-process');
  const id3 = m.add({ url: base + '/hdr', dir: path.join(tmp, 'dl'), extra: { Cookie: 'a=b', Referer: 'http://r/' } }).id;
  j = await wait(id3);
  const got = fs.readFileSync(path.join(tmp, 'dl', j.filename), 'utf8');
  if (got !== 'cookie=sess=ok; a=b ref=http://r/') fail('extra headers not sent: ' + got);
  console.log('ok: browser cookie/referer headers forwarded');
  console.log('plugins:', plugins.plugins.map(p => p.id).join(','), 'errors:', plugins.errors.length);
  srv.close(); app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
