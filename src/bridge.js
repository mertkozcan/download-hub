// Local-only endpoint used by the browser extension to hand downloads to ModFetch.
//   GET  /ping            -> "modfetch"            (no auth; lets the extension detect the app)
//   POST /add  (JSON)     -> { url, referer?, cookie?, filename? }   requires header X-ModFetch-Token
// Bound to 127.0.0.1 only. The token is random per install and shown in Settings.
const http = require('http');

const PORT = 17653;

function start({ getToken, onAdd }) {
  const srv = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.url === '/ping') { res.writeHead(200); return res.end('modfetch'); }
    if (req.method === 'POST' && req.url === '/add') {
      if (req.headers['x-modfetch-token'] !== getToken()) { res.writeHead(401); return res.end('bad token'); }
      let body = '';
      req.on('data', d => { body += d; if (body.length > 64 * 1024) req.destroy(); });
      req.on('end', () => {
        try {
          const o = JSON.parse(body);
          if (!/^https?:\/\//i.test(o.url || '')) throw new Error('bad url');
          onAdd(o); res.writeHead(200); res.end('ok');
        } catch (e) { res.writeHead(400); res.end(String(e.message)); }
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  srv.on('error', e => console.error('bridge:', e.message));
  srv.listen(PORT, '127.0.0.1');
  return srv;
}

module.exports = { start, PORT };
