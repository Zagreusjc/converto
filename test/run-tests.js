'use strict';
// `npm test` -> launches the tests inside Electron (they need its Chromium for PDF work).
const { spawnSync } = require('child_process');
const electron = require('electron');
// VS Code (and some terminals) set this, which would make Electron behave like plain Node.
function cleanEnv() { const e = { ...process.env }; delete e.ELECTRON_RUN_AS_NODE; return e; }
const r = spawnSync(electron, [require('path').join(__dirname, 'electron-tests.js')], { stdio: 'inherit', env: cleanEnv() });
process.exit(r.status === null ? 1 : r.status);
