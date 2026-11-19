'use strict';
// Launches the real app, drives its window like a person would, and saves screenshots.
// Run: node test/run-ui.js   (see package.json "test:ui")
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const OUT = process.env.CONVERTO_UI_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'converto-ui-'));
fs.mkdirSync(OUT, { recursive: true });
const FIX = path.join(__dirname, 'fixtures');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'converto-ui-files-'));
for (const f of ['analysis.ipynb', 'plain.jpg', 'sample.heic', 'broken.png', 'broken.ipynb']) fs.copyFileSync(path.join(FIX, f), path.join(work, f));
// isolate settings from the real user profile
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'converto-ui-profile-')));

let checks = 0, bad = 0;
const ok = (c, name, d) => { checks++; if (!c) bad++; console.log(`${c ? '  ok  ' : '  FAIL'} ${name}${!c && d ? ' -> ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

require('../src/main/main.js');

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
}
const js = (win, code) => win.webContents.executeJavaScript(code);
async function waitFor(win, cond, ms = 60000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await js(win, cond)) return true; await sleep(150); }
  return false;
}
// A real Finder/Explorer drag can't be automated (Chromium's synthetic drags carry no file paths), so we
// hand the window the same list of paths the drop handler would produce.
async function dropFiles(win, files) {
  await js(win, `addPaths(${JSON.stringify(files)})`);
}

app.whenReady().then(async () => {
  try {
    await sleep(800);
    const win = BrowserWindow.getAllWindows()[0];
    await waitFor(win, `document.readyState === 'complete'`);
    win.setSize(760, 700);
    await sleep(300);
    await shot(win, '1-empty');
    ok(await js(win, `!document.getElementById('screen-empty').classList.contains('hidden')`), 'starts on the drop screen');
    ok(await js(win, `document.getElementById('chk-strip').checked === false`), 'metadata box starts unchecked');

    // Drop a file (see note above)
    await dropFiles(win, [path.join(work, 'analysis.ipynb')]);
    const gotChoose = await waitFor(win, `!document.getElementById('screen-choose').classList.contains('hidden')`, 5000);
    ok(gotChoose, 'dropping a file shows the format buttons');
    await shot(win, '2-choose-notebook');
    const labels = await js(win, `Array.from(document.querySelectorAll('.fmt')).map(b => b.firstChild.textContent)`);
    ok(JSON.stringify(labels) === JSON.stringify(['PDF', 'HTML', 'MD', 'PY']), 'a notebook offers PDF, HTML, MD, PY', JSON.stringify(labels));

    // click PDF
    await js(win, `Array.from(document.querySelectorAll('.fmt')).find(b => b.textContent.startsWith('PDF')).click()`);
    ok(await waitFor(win, `!document.getElementById('screen-done').classList.contains('hidden')`), 'conversion finishes');
    await shot(win, '3-done');
    ok(fs.existsSync(path.join(work, 'analysis.pdf')), 'analysis.pdf saved next to the original');
    ok(await js(win, `!document.getElementById('btn-show').classList.contains('hidden')`), '"Show in folder" button is visible');
    ok(await js(win, `document.getElementById('done-banner').classList.contains('ok')`), 'success banner shown');

    // again, same notebook -> numbered name
    await js(win, `document.getElementById('btn-again').click()`);
    await dropFiles(win, [path.join(work, 'analysis.ipynb')]);
    await waitFor(win, `!document.getElementById('screen-choose').classList.contains('hidden')`, 5000);
    await js(win, `Array.from(document.querySelectorAll('.fmt')).find(b => b.textContent.startsWith('PDF')).click()`);
    await waitFor(win, `!document.getElementById('screen-done').classList.contains('hidden')`);
    ok(fs.existsSync(path.join(work, 'analysis (1).pdf')), 'second run did not overwrite: analysis (1).pdf');

    // batch with failures + checkbox persistence
    await js(win, `document.getElementById('btn-again').click()`);
    await js(win, `document.getElementById('chk-strip').click()`);
    await dropFiles(win, [path.join(work, 'plain.jpg'), path.join(work, 'sample.heic'), path.join(work, 'broken.png'), path.join(work, 'notes.xyz')]);
    await waitFor(win, `!document.getElementById('screen-choose').classList.contains('hidden')`, 5000);
    await shot(win, '4-choose-images');
    ok(await js(win, `document.querySelectorAll('#file-list li').length === 3`), 'three supported files listed (the .xyz was skipped)');
    ok(await js(win, `!document.getElementById('skipped-note').classList.contains('hidden')`), 'unsupported file is mentioned politely');
    await js(win, `Array.from(document.querySelectorAll('.fmt')).find(b => b.textContent.startsWith('JPG')).click()`);
    await waitFor(win, `!document.getElementById('screen-done').classList.contains('hidden')`);
    await shot(win, '5-batch-done');
    const rows = await js(win, `Array.from(document.querySelectorAll('#result-list li')).map(li => li.innerText.replace(/\\n+/g,' | '))`);
    console.log('       ' + rows.join('\n       '));
    ok(fs.existsSync(path.join(work, 'sample.jpg')), 'good files converted even though one failed');
    ok(rows.some((r) => /broken\.png.*damaged/i.test(r)), 'the broken file has a plain-English message');
    ok(await js(win, `document.getElementById('done-banner').classList.contains('mixed')`), 'banner says some worked, some did not');
    const settings = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
    ok(settings.strip === true, 'checkbox choice saved to disk');
    const sharp = require('sharp');
    ok(!(await sharp(path.join(work, 'sample.jpg')).metadata()).exif, 'strip was applied (checkbox on)');
  } catch (e) {
    console.error('UI SMOKE CRASH', e);
    bad++;
  }
  console.log(`\n${checks - bad} ok, ${bad} failed. Screenshots: ${OUT}`);
  app.exit(bad ? 1 : 0);
});
