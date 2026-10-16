// The only bridge between the card page and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ginoApi', {
  onShow: (cb) => ipcRenderer.on('show', (_event, payload) => cb(payload)),
  onHide: (cb) => ipcRenderer.on('hide', () => cb()),
  action: (name, data) => ipcRenderer.invoke('card:action', name, data || {}),
  resize: (height) => ipcRenderer.send('card:resize', height),
  closed: () => ipcRenderer.send('card:closed'),
});
