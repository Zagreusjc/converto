'use strict';
const { spawnSync } = require('child_process');
const electron = require('electron');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(electron, [require('path').join(__dirname, 'ui-smoke.js')], { stdio: 'inherit', env });
process.exit(r.status === null ? 1 : r.status);
