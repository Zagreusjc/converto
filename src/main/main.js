'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session } = require('electron');
const { registerScheme, handleScheme } = require('./appProtocol');
const settings = require('./settings');
const registry = require('./registry');
const { resolveOutputDir, friendlyMessage } = require('./util');

registerScheme();

let mainWindow = null;
const pendingOpen = [];

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/* ---------- windows ---------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 560,
    minHeight: 520,
    title: 'Converto',
    backgroundColor: '#f5f6f8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Dropping a file on the window must never navigate away from the app.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOpen.length) mainWindow.webContents.send('open-files', pendingOpen.splice(0));
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
}

function sendOpenFiles(paths) {
  if (!paths.length) return;
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('open-files', paths);
  } else {
    pendingOpen.push(...paths);
  }
}

/* ---------- no network, ever ---------- */

function blockNetwork(ses) {
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const allowed = /^(file|data|blob|devtools|converto-app|chrome-extension):/i.test(u);
    cb({ cancel: !allowed });
  });
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
}

/* ---------- file helpers ---------- */

const MAX_FOLDER_FILES = 500;

async function expandPaths(paths) {
  const files = [];
  async function walk(p, depth) {
    if (files.length >= MAX_FOLDER_FILES) return;
    let st;
    try { st = await fs.promises.stat(p); } catch { files.push(p); return; }
    if (st.isDirectory()) {
      if (depth > 4) return;
      let names = [];
      try { names = await fs.promises.readdir(p); } catch { return; }
      for (const n of names.sort()) {
        if (n.startsWith('.')) continue;
        await walk(path.join(p, n), depth + 1);
      }
    } else {
      files.push(p);
    }
  }
  for (const p of paths) await walk(p, 0);
  return files;
}

/* ---------- IPC ---------- */

function registerIpc() {
  ipcMain.handle('get-settings', () => settings.load());
  ipcMain.handle('set-setting', (_e, key, value) => settings.set(key, value));

  ipcMain.handle('pick-files', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose files to convert',
      properties: ['openFile', 'multiSelections'],
    });
    return res.canceled ? [] : res.filePaths;
  });

  ipcMain.handle('inspect', async (_e, paths) => {
    const all = await expandPaths(paths);
    const files = [];
    const unsupported = [];
    for (const p of all) {
      const info = registry.describe(p);
      if (info) files.push({ path: p, name: path.basename(p), ext: info.ext, targets: info.targets });
      else unsupported.push(path.basename(p));
    }
    return { files, unsupported, order: registry.TARGET_ORDER };
  });

  ipcMain.handle('show-in-folder', (_e, p) => {
    if (p && fs.existsSync(p)) shell.showItemInFolder(p);
  });

  ipcMain.handle('convert', async (event, paths, target) => {
    const strip = !!settings.load().strip;
    const results = [];
    for (let i = 0; i < paths.length; i++) {
      const inputPath = paths[i];
      const name = path.basename(inputPath);
      event.sender.send('progress', { index: i, status: 'working' });
      try {
        const { dir, fellBack } = await resolveOutputDir(inputPath);
        const res = await registry.runConversion(inputPath, target, { strip, outDir: dir, inputPath });
        const note = fellBack ? 'The original folder could not be written to, so the result was saved in your Documents/Converto folder.' : undefined;
        const r = { index: i, name, ok: true, outputs: res.outputs, revealPath: res.revealPath || res.outputs[0], note };
        results.push(r);
        event.sender.send('progress', { index: i, status: 'done', ...r });
      } catch (err) {
        console.error(`[convert] ${name}:`, err);
        const r = { index: i, name, ok: false, message: friendlyMessage(err, name) };
        results.push(r);
        event.sender.send('progress', { index: i, status: 'failed', ...r });
      }
    }
    return results;
  });
}

/* ---------- app lifecycle ---------- */

app.on('open-file', (e, p) => {
  e.preventDefault();
  sendOpenFiles([p]);
});

app.on('second-instance', (_e, argv) => {
  sendOpenFiles(argv.slice(app.isPackaged ? 1 : 2).filter((a) => fs.existsSync(a)));
});

app.whenReady().then(() => {
  handleScheme(session.defaultSession);
  blockNetwork(session.defaultSession);
  registerIpc();
  if (process.env.CONVERTO_SELFTEST_DIR) {
    require('./selftest').run(process.env.CONVERTO_SELFTEST_DIR).then((code) => app.exit(code));
    return;
  }
  buildMenu();
  createWindow();
  const argvFiles = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') && fs.existsSync(a));
  if (argvFiles.length) pendingOpen.push(...argvFiles);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (!process.env.CONVERTO_SELFTEST_DIR) app.quit(); });
