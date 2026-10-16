// The only bridge between the card page and the main process.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './src/ipc';
import type { GinoApi, ShowPayload } from './src/types';

const ginoApi: GinoApi = {
  onShow: (cb) => ipcRenderer.on(IPC.show, (_event, payload: ShowPayload) => cb(payload)),
  onHide: (cb) => ipcRenderer.on(IPC.hide, () => cb()),
  action: (name, data) => ipcRenderer.invoke(IPC.action, name, data || {}),
  resize: (height) => ipcRenderer.send(IPC.resize, height),
  closed: () => ipcRenderer.send(IPC.closed),
};

contextBridge.exposeInMainWorld('ginoApi', ginoApi);
