'use strict';
/**
 * Used only when the environment variable CONVERTO_SELFTEST_DIR is set (by our build checks).
 * Converts whatever sample files are in that folder and writes selftest-results.json there,
 * so we can prove a *packaged* app can do its job. Ordinary users never trigger this.
 */
const fs = require('fs');
const path = require('path');
const registry = require('./registry');
const { friendlyMessage } = require('./util');

const JOBS = [
  ['plain.jpg', 'png'], ['plain.jpg', 'webp'], ['plain.jpg', 'pdf'], ['sample.heic', 'jpg'], ['sample.bmp', 'png'], ['tiny.ico', 'png'],
  ['plain.jpg', 'ico'], ['anim.gif', 'webp'],
  ['multipage.pdf', 'png'], ['analysis.ipynb', 'pdf'], ['analysis.ipynb', 'html'], ['analysis.ipynb', 'md'], ['analysis.ipynb', 'py'],
];

async function run(dir) {
  const results = [];
  for (const [file, target] of JOBS) {
    const src = path.join(dir, file);
    if (!fs.existsSync(src)) continue;
    try {
      const res = await registry.runConversion(src, target, { strip: true, outDir: dir, inputPath: src });
      const sizes = res.outputs.map((o) => (fs.statSync(o).isDirectory() ? -1 : fs.statSync(o).size));
      results.push({ file, target, ok: sizes.every((s) => s !== 0), outputs: res.outputs.map((o) => path.basename(o)) });
    } catch (e) {
      results.push({ file, target, ok: false, error: friendlyMessage(e), detail: String(e && e.stack) });
    }
  }
  fs.writeFileSync(path.join(dir, 'selftest-results.json'), JSON.stringify(results, null, 2));
  return results.every((r) => r.ok) ? 0 : 1;
}

module.exports = { run };
