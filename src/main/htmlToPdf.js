'use strict';
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const { makeTempDir, rmrf } = require('./util');
const { stripPdf } = require('./metadata');

/**
 * Print a complete, self-contained HTML string to PDF using the Chromium
 * that ships inside Electron. Page size and margins come from the page's own
 * CSS (@page). JavaScript and network access are off for the page.
 */
async function htmlToPdf(html, { strip = false } = {}) {
  const dir = await makeTempDir();
  const file = path.join(dir, 'page.html');
  await fs.promises.writeFile(file, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      images: true,
      backgroundThrottling: false,
    },
  });
  try {
    await win.loadFile(file);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
    return strip ? await stripPdf(Buffer.from(pdf)) : Buffer.from(pdf);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await rmrf(dir);
  }
}

module.exports = { htmlToPdf };
