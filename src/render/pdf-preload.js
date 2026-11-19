'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pdfBridge', {
  getBytes: (id) => ipcRenderer.invoke('pdf:bytes', id),
  sendPage: (id, index, total, png) => ipcRenderer.invoke('pdf:page', id, index, total, png),
});
