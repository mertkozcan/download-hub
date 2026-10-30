const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  invoke: (ch, ...a) => ipcRenderer.invoke(ch, ...a),
  on: (ch, cb) => { if (['job', 'job-removed', 'toast', 'clip', 'history-changed', 'confirm', 'update'].includes(ch)) ipcRenderer.on(ch, (_e, v) => cb(v)); },
});
