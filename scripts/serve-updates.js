// Serves ./updates over HTTP on the LAN:  npm run serve-updates   (default port 8080)
// Other PCs: Download Hub > Ayarlar > Güncelleme adresi = http://<this-pc-ip>:8080
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const dir = path.join(__dirname, '..', 'updates'), port = +process.env.PORT || 8080;
fs.mkdirSync(dir, { recursive: true });
http.createServer((req, res) => {
  const f = path.join(dir, path.basename(decodeURIComponent(req.url.split('?')[0])));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const size = fs.statSync(f).size, m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (m) { const s = +m[1], e = m[2] ? +m[2] : size - 1; res.writeHead(206, { 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes' }); return fs.createReadStream(f, { start: s, end: e }).pipe(res); }
  res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes' }); fs.createReadStream(f).pipe(res);
}).listen(port, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`Serving ${dir}\n` + ips.map(ip => `  http://${ip}:${port}`).join('\n'));
});
