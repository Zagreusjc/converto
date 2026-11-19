'use strict';
// A universal Mac app contains an Intel half and an Apple Silicon half. npm only installs the image
// library (sharp) for the computer it runs on, so this adds the other half before building.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const read = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'node_modules', p, 'package.json'), 'utf8'));
const opt = read('sharp').optionalDependencies || {};
const wanted = ['@img/sharp-darwin-x64', '@img/sharp-darwin-arm64', '@img/sharp-libvips-darwin-x64', '@img/sharp-libvips-darwin-arm64'];
const specs = wanted.filter((n) => opt[n]).map((n) => `${n}@${opt[n]}`);
if (specs.length !== 4) throw new Error('Could not find the Mac image libraries in sharp\'s dependency list: ' + JSON.stringify(opt));
console.log('Installing', specs.join(' '));
execSync(`npm install --no-save --force --no-audit --no-fund ${specs.join(' ')}`, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
