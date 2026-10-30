// Auto-update via electron-updater against a plain HTTP folder (generic provider).
// The folder holds latest.yml + "Download Hub Setup x.y.z.exe" (+ .blockmap): see scripts/release.js.
const { autoUpdater } = require('electron-updater');

function init({ app, store, send, beforeInstall }) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null;
  const state = { status: 'idle', version: app.getVersion() };
  let manual = false, applying = false;
  const emit = p => { Object.assign(state, p); send({ ...state }); };

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking' }));
  autoUpdater.on('update-available', i => { emit({ status: 'available', latest: i.version }); });
  autoUpdater.on('update-not-available', () => emit({ status: 'latest' }));
  autoUpdater.on('download-progress', p => emit({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', () => {
    emit({ status: 'ready' });
    if (applying) { beforeInstall(); autoUpdater.quitAndInstall(false, true); }
  });
  autoUpdater.on('error', e => { applying = false; emit(manual || state.status === 'downloading' ? { status: 'error', error: e.message } : { status: 'idle' }); });

  async function check(isManual) {
    manual = !!isManual;
    if (!app.isPackaged) return emit({ status: 'dev' });
    const url = (store.settings.updateUrl || '').trim();
    if (!url) return emit({ status: 'nourl' });
    try { autoUpdater.setFeedURL({ provider: 'generic', url }); await autoUpdater.checkForUpdates(); }
    catch (e) { emit(manual ? { status: 'error', error: e.message } : { status: 'idle' }); }
  }
  async function apply() {
    if (state.status !== 'available' && state.status !== 'ready') return;
    applying = true;
    if (state.status === 'ready') { beforeInstall(); return autoUpdater.quitAndInstall(false, true); }
    emit({ status: 'downloading', percent: 0 });
    try { await autoUpdater.downloadUpdate(); } catch (e) { applying = false; emit({ status: 'error', error: e.message }); }
  }
  setTimeout(() => check(false), 15000);
  setInterval(() => check(false), 6 * 3600 * 1000);
  return { check, apply, state: () => ({ ...state }) };
}

module.exports = { init };
