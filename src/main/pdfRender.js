'use strict';
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');
const { FriendlyError } = require('./util');

const jobs = new Map();
let nextId = 1;
let handlersReady = false;

function setupHandlers() {
  if (handlersReady) return;
  handlersReady = true;
  ipcMain.handle('pdf:bytes', (_e, id) => {
    const job = jobs.get(id);
    return job ? job.bytes : null;
  });
  ipcMain.handle('pdf:page', async (_e, id, index, total, png) => {
    const job = jobs.get(id);
    if (!job) return;
    await job.onPage(index, total, Buffer.from(png));
  });
}

/**
 * Render every page of a PDF to PNG. `onPage(index, total, pngBuffer)` is
 * awaited for each page as it is produced.
 */
async function renderPdfPages(bytes, onPage) {
  setupHandlers();
  const id = nextId++;
  jobs.set(id, { bytes: new Uint8Array(bytes), onPage });
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, '..', 'render', 'pdf-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') console.error(`[pdf-render] ${event.message}`);
  });
  try {
    await win.loadURL('converto-app://app/render/pdf-render.html');
    // The module script sets window.pdfReady once pdf.js has loaded.
    for (let i = 0; i < 200; i++) {
      if (await win.webContents.executeJavaScript('window.pdfReady === true')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const result = await win.webContents.executeJavaScript(`window.renderPdf(${id})`);
    if (!result || !result.ok) {
      if (result && /Password/i.test(result.name)) {
        throw new FriendlyError('This PDF is password-protected, so it cannot be converted.');
      }
      if (result && /InvalidPDF|MissingPDF|Format/i.test(result.name)) {
        throw new FriendlyError('This PDF looks damaged or is not a real PDF, so it could not be read.');
      }
      throw new Error((result && result.message) || 'PDF rendering failed');
    }
    return result.pages;
  } finally {
    jobs.delete(id);
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { renderPdfPages };
