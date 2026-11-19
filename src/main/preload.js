'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('converto', {
  pathsFromFiles: (files) => Array.from(files).map((f) => webUtils.getPathForFile(f)).filter(Boolean),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  inspect: (paths) => ipcRenderer.invoke('inspect', paths),
  convert: (paths, target) => ipcRenderer.invoke('convert', paths, target),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, msg) => cb(msg)),
  onOpenFiles: (cb) => ipcRenderer.on('open-files', (_e, paths) => cb(paths)),
});
