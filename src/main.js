process.on('uncaughtException', e => { require('fs').appendFileSync(require('path').join(__dirname, '..', 'crash.log'), String(e.stack) + '\n'); console.error(e); });
const { app, BrowserWindow, ipcMain, dialog, shell, session, safeStorage, Tray, Menu, Notification, clipboard } = require('electron');
const { trayIcon } = require('./icon');
const updater = require('./updater');
const { start: startBridge, PORT: BRIDGE_PORT } = require('./bridge');
const path = require('path');
const fs = require('fs');
const { Store } = require('./store');
const { PluginHost } = require('./plugins');
const { DownloadManager } = require('./downloader');

let win, store, plugins, manager;
const siteWins = new Map();
const NXM_RE = /^nxm:\/\//i;

app.setPath('userData', path.join(app.getPath('appData'), 'modfetch')); // keep existing settings/cookies after the rename
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', (_e, argv) => {
  if (argv.includes('--hidden')) return;   // duplicate autostart trigger: stay in tray
  showWin();
  argv.filter(a => NXM_RE.test(a)).forEach(enqueueSafe);
});

function enqueueSafe(url, extra) {
  try { manager.add({ url, ...extra }); }
  catch (e) { win && win.webContents.send('toast', e.message); }
}

// Opens a plugin's site in an embedded browser that shares the plugin's cookie jar.
// The user signs in / passes any human-verification THEMSELVES. Download Hub never types
// credentials and never touches verification challenges.
// Download clicks and nxm:// links in this window are captured into the queue.
function openSite(pluginId, url) {
  const plugin = plugins.byId(pluginId);
  if (!plugin) throw new Error('Unknown profile');
  const existing = siteWins.get(pluginId);
  if (existing && !existing.isDestroyed()) { existing.focus(); if (url) existing.loadURL(url); return; }
  const ses = plugins.session(plugin);
  const w = new BrowserWindow({
    width: 1100, height: 800, title: `${plugin.name} - sign in / browse`, autoHideMenuBar: true,
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  siteWins.set(pluginId, w);
  const grab = (u) => { enqueueSafe(u, {}); win && win.webContents.send('toast', 'Added to queue'); };
  const nav = (e, u) => { if (NXM_RE.test(u)) { e.preventDefault(); grab(u); } };
  w.webContents.on('will-navigate', nav);
  w.webContents.on('will-redirect', nav);
  w.webContents.setWindowOpenHandler(({ url: u }) => {
    if (NXM_RE.test(u)) { grab(u); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  if (!ses._modfetchHooked) {
    ses._modfetchHooked = true;
    ses.on('will-download', (_e, item) => {
      item.cancel();                    // we download it ourselves (queue/resume/post-process)
      grab(item.getURL());
    });
  }
  w.loadURL(url || (plugin.login && plugin.login.url) || 'about:blank');
  w.on('closed', () => siteWins.delete(pluginId));
}

async function siteInfo() {
  const out = [];
  for (const p of plugins.plugins) {
    let cookies = 0;
    try { cookies = (await plugins.session(p).cookies.get({})).length; } catch { /* ignore */ }
    out.push({
      id: p.id, name: p.name, description: p.description || '', source: p.source, file: p.file || '',
      patterns: p._matchers.map(String), canLogin: !!(p.login && p.login.url), cookies,
      secrets: (p.secrets || []).map(s => ({ key: s.key, label: s.label, set: store.hasSecret(`${p.id}.${s.key}`) })),
    });
  }
  return out;
}

function ipc() {
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => fn(...a));
  h('jobs:list', () => manager.list());
  h('jobs:add', o => { const urls = String(o.urls).split(/\s+/).filter(Boolean); return urls.map(u => manager.add({ url: u, dir: o.dir || undefined, presetId: o.presetId })); });
  h('jobs:pause', id => manager.pause(id));
  h('jobs:resume', id => manager.resume(id));
  h('jobs:cancel', id => manager.cancel(id));
  h('jobs:remove', id => manager.remove(id));
  h('jobs:clear', () => manager.clearFinished());
  h('jobs:show', id => {
    const j = manager.jobs.get(id); if (!j) return;
    const f = path.join(j.dir, j.filename);
    fs.existsSync(f) ? shell.showItemInFolder(f) : shell.openPath(j.dir);
  });
  h('settings:get', () => { const { secrets, ...s } = store.settings; return s; });
  h('settings:set', p => { store.setSettings(p); manager.pump(); });
  h('secret:set', (pid, key, val) => store.setSecret(`${pid}.${key}`, val));
  h('sites:list', siteInfo);
  h('sites:open', (id, url) => openSite(id, url));
  h('sites:logout', async id => { const s = plugins.session(plugins.byId(id)); await s.clearStorageData(); });
  h('sites:reload', () => { plugins.reload(); return plugins.errors; });
  h('sites:errors', () => plugins.errors);
  h('sites:folder', () => shell.openPath(userPluginsDir()));
  h('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  h('nxm:register', () => {
    // Opt-in: makes Download Hub the OS handler for nxm:// (replaces Vortex/MO2 as handler until they re-register).
    return app.isPackaged
      ? app.setAsDefaultProtocolClient('nxm')
      : app.setAsDefaultProtocolClient('nxm', process.execPath, [path.resolve(process.argv[1] || '.')]);
  });
  h('nxm:unregister', () => app.removeAsDefaultProtocolClient('nxm'));
}

const userPluginsDir = () => path.join(app.getPath('userData'), 'plugins');

let tray, quitting = false, lastClip = '', upd;
const pending = new Map();   // browser downloads waiting for the user's OK
function showWin() { if (!win) return; win.show(); if (win.isMinimized()) win.restore(); win.focus(); }
function makeTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Download Hub');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Aç', click: showWin },
    { label: 'Çıkış', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWin);
}
const extensionDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, '..', 'extension'));
const LOGIN_NAME = 'Download Hub';
function autostartArgs() { return app.isPackaged ? ['--hidden'] : [path.resolve(process.argv[1] || '.'), '--hidden']; }
function ipcSystem() {
  ipcMain.handle('sys:get', () => ({
    autostart: app.getLoginItemSettings({ name: LOGIN_NAME, path: process.execPath, args: autostartArgs() }).openAtLogin,
    token: store.settings.bridgeToken, version: app.getVersion(), port: BRIDGE_PORT, extensionDir: extensionDir(),
  }));
  ipcMain.handle('sys:autostart', (_e, on) => { app.setLoginItemSettings({ name: 'electron.app.Electron', openAtLogin: false }); app.setLoginItemSettings({ name: LOGIN_NAME, openAtLogin: !!on, path: process.execPath, args: autostartArgs() }); });
  ipcMain.handle('sys:extfolder', () => shell.openPath(extensionDir()));
}

app.whenReady().then(() => {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'startup.log'), new Date().toISOString() + ' start ' + process.argv.slice(1).join(' ') + '\n'); } catch { /* ignore */ }
  store = new Store(app.getPath('userData'), safeStorage);
  if (!store.settings.downloadDir) store.setSettings({ downloadDir: path.join(app.getPath('downloads'), 'Download Hub') });
  fs.mkdirSync(userPluginsDir(), { recursive: true });
  plugins = new PluginHost({
    dirs: [{ path: path.join(__dirname, '..', 'plugins'), label: 'bundled' }, { path: userPluginsDir(), label: 'user' }],
    store, electronSession: name => session.fromPartition(name), log: m => console.log(m),
  });
  manager = new DownloadManager({ store, plugins });
  manager.on('update', j => win && !win.isDestroyed() && win.webContents.send('job', j));
  manager.on('removed', id => win && !win.isDestroyed() && win.webContents.send('job-removed', id));
  manager.on('done', (j, ms) => {
    store.addHistory({ id: j.id, name: j.filename, url: j.url, site: j.pluginName, siteId: j.pluginId, bytes: j.received, dir: j.dir, ms, at: Date.now() });
    win && !win.isDestroyed() && win.webContents.send('history-changed');
    if (Notification.isSupported()) new Notification({ title: 'İndirme bitti', body: j.filename }).show();
  });
  setInterval(() => {
    const n = [...manager.jobs.values()].filter(j => j.status === 'downloading').length;
    tray && tray.setToolTip(n ? `Download Hub - ${n} indirme sürüyor` : 'Download Hub');
  }, 2000);
  ipcMain.handle('history:list', () => store.data.history.slice().reverse());
  ipcMain.handle('history:clear', () => store.clearHistory());
  ipcMain.handle('history:remove', (_e, id) => store.removeHistory(id));
  ipcMain.handle('history:show', (_e, id) => {
    const h = store.data.history.find(x => x.id === id); if (!h) return;
    const f = path.join(h.dir, h.name); fs.existsSync(f) ? shell.showItemInFolder(f) : shell.openPath(h.dir);
  });
  // ---- right-click menus ----
  const fileOf = o => path.join(o.dir, o.filename || o.name || '');
  const openFile = o => { const f = fileOf(o); fs.existsSync(f) ? shell.openPath(f) : win.webContents.send('toast', 'Dosya bulunamadı (taşınmış veya silinmiş)'); };
  const openDir = o => shell.openPath(fs.existsSync(o.dir) ? o.dir : path.dirname(o.dir));
  const copy = t => clipboard.writeText(String(t));
  ipcMain.handle('ctx:job', (_e, id) => {
    const j = manager.jobs.get(id); if (!j) return;
    const st = j.status, done = st === 'done', live = ['queued', 'resolving', 'downloading'].includes(st);
    Menu.buildFromTemplate([
      { label: 'Aç', enabled: done, click: () => openFile(j) },
      { label: 'Klasörde göster', click: () => (done && fs.existsSync(fileOf(j)) ? shell.showItemInFolder(fileOf(j)) : openDir(j)) },
      { label: 'İndirme klasörünü aç', click: () => openDir(j) },
      { type: 'separator' },
      { label: 'Duraklat', visible: live, click: () => manager.pause(id) },
      { label: st === 'error' ? 'Tekrar dene' : 'Devam et', visible: ['paused', 'error', 'cancelled'].includes(st), click: () => manager.resume(id) },
      { label: 'İptal et', visible: !done && st !== 'cancelled', click: () => manager.cancel(id) },
      { type: 'separator' },
      { label: 'Linki kopyala', click: () => copy(j.url) },
      { label: 'Dosya yolunu kopyala', enabled: done, click: () => copy(fileOf(j)) },
      { type: 'separator' },
      { label: 'Listeden kaldır', click: () => manager.remove(id) },
    ]).popup({ window: win });
  });
  ipcMain.handle('ctx:hist', (_e, id) => {
    const h = store.data.history.find(x => x.id === id); if (!h) return;
    Menu.buildFromTemplate([
      { label: 'Aç', click: () => openFile(h) },
      { label: 'Klasörde göster', click: () => (fs.existsSync(fileOf(h)) ? shell.showItemInFolder(fileOf(h)) : openDir(h)) },
      { type: 'separator' },
      { label: 'Tekrar indir', click: () => enqueueSafe(h.url, { dir: h.dir }) },
      { label: 'Linki kopyala', click: () => copy(h.url) },
      { type: 'separator' },
      { label: 'Geçmişten sil', click: () => { store.removeHistory(id); win.webContents.send('history-changed'); } },
    ]).popup({ window: win });
  });
  ipcMain.handle('jobs:open', (_e, id) => { const j = manager.jobs.get(id); if (j) openFile(j); });
  ipcMain.handle('open:dir', (_e, dir) => shell.openPath(dir || store.settings.downloadDir));
  ipcMain.handle('open:hist', (_e, id) => { const h = store.data.history.find(x => x.id === id); if (h) openFile(h); });
  ipcMain.handle('confirm:resolve', (_e, r) => {
    const p = pending.get(r.id); pending.delete(r.id);
    if (!p || !r.accept) return;
    try { manager.add({ url: p.url, hint: p.hint, extra: p.extra, dir: r.dir || undefined, presetId: r.presetId || '' }); }
    catch (e) { win.webContents.send('toast', e.message); }
  });
  ipc(); ipcSystem();
  if (!store.settings.bridgeToken) store.setSettings({ bridgeToken: require('crypto').randomBytes(18).toString('hex') });
  startBridge({
    getToken: () => store.settings.bridgeToken,
    onAdd: o => {
      const extra = {};
      if (o.cookie) extra.Cookie = String(o.cookie);
      if (o.referer) extra.Referer = String(o.referer);
      const hint = o.filename ? String(o.filename) : undefined;
      if (!store.settings.confirmBrowser) {
        try { manager.add({ url: o.url, hint, extra }); win && win.webContents.send('toast', 'Tarayıcıdan eklendi'); } catch (e) { console.error(e.message); }
        return;
      }
      const id = require('crypto').randomBytes(4).toString('hex');
      let name = hint; try { name = name || decodeURIComponent(path.basename(new URL(o.url).pathname)); } catch { /* keep */ }
      let site = ''; try { site = plugins.find(o.url).plugin.name; } catch { /* none */ }
      pending.set(id, { url: o.url, hint, extra });
      showWin();
      win.webContents.send('confirm', { id, url: o.url, name: name || o.url, site, dir: store.settings.downloadDir });
    },
  });
  makeTray();
  upd = updater.init({ app, store, send: st => win && !win.isDestroyed() && win.webContents.send('update', st), beforeInstall: () => { quitting = true; } });
  ipcMain.handle('update:check', () => upd.check(true));
  ipcMain.handle('update:apply', () => upd.apply());
  ipcMain.handle('update:state', () => upd.state());

  win = new BrowserWindow({
    show: !process.argv.includes('--hidden'),
    width: 1000, height: 700, title: 'Download Hub', autoHideMenuBar: true, backgroundColor: '#14161a',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  win.webContents.on('did-finish-load', () => process.argv.filter(a => NXM_RE.test(a)).forEach(a => enqueueSafe(a)));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('context-menu', (_e, p) => {   // standard edit menu for text fields
    if (!p.isEditable && !p.selectionText) return;
    Menu.buildFromTemplate(p.isEditable
      ? [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
      : [{ role: 'copy' }, { role: 'selectAll' }]).popup({ window: win });
  });
  win.on('focus', () => {   // offer to add a link found on the clipboard
    let t = '';
    try { t = String(clipboard.readText() || '').trim(); } catch { return; }
    if (/^(https?|nxm):\/\/\S+$/i.test(t) && t !== lastClip) { lastClip = t; win.webContents.send('clip', t); }
  });
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });  // keep running in the tray
  manager.pump();
  if (process.argv.includes('--hidden') && Notification.isSupported()) new Notification({ title: 'Download Hub', body: 'Tepside çalışıyor. Açmak için tepsi simgesine tıkla.' }).show();
});

app.on('before-quit', () => { quitting = true; for (const j of manager.jobs.values()) if (j._ac) { j._intent = 'pause'; j._ac.abort(); } store.flush(); });
app.on('window-all-closed', () => { /* stay in tray */ });
