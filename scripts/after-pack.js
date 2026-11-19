'use strict';
// Keeps the Windows download smaller by dropping Chromium's non-English language packs
// (the app itself is English-only).
const fs = require('fs');
const path = require('path');
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const dir = path.join(context.appOutDir, 'locales');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) if (f !== 'en-US.pak') fs.rmSync(path.join(dir, f));
};
