'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, session } = require('electron');
const { registerScheme, handleScheme } = require('../src/main/appProtocol');
registerScheme();
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // helper windows come and go; don't quit

const FIX = path.join(__dirname, 'fixtures');
const OUT_ROOT = process.env.CONVERTO_TEST_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'converto-test-'));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
}

async function main() {
  handleScheme(session.defaultSession);
  const sharp = require('sharp');
  const { PDFDocument } = require('pdf-lib');
  const registry = require('../src/main/registry');
  const { friendlyMessage } = require('../src/main/util');

  let n = 0;
  async function run(fixture, target, { strip = false, dir } = {}) {
    const work = dir || path.join(OUT_ROOT, `t${++n}-${fixture.replace(/\W+/g, '_')}-${target}-${strip ? 'strip' : 'keep'}`);
    fs.mkdirSync(work, { recursive: true });
    const src = path.join(work, fixture);
    if (!fs.existsSync(src)) fs.copyFileSync(path.join(FIX, fixture), src);
    try {
      const res = await registry.runConversion(src, target, { strip, outDir: work, inputPath: src });
      return { ok: true, res, work, src };
    } catch (e) {
      return { ok: false, message: friendlyMessage(e), raw: e, work, src };
    }
  }
  const meta = (f) => sharp(f).metadata();

  console.log('\nImages');
  {
    // orientation + metadata
    let r = await run('photo-exif.jpg', 'png');
    let m = await meta(r.res?.outputs[0]);
    ok(r.ok && m.width === 400 && m.height === 640, 'jpg with rotate tag -> png is upright (400x640)', `${m.width}x${m.height}`);
    ok(!m.orientation || m.orientation === 1, 'orientation tag reset after rotating', `orientation=${m.orientation}`);
    ok(m.exif && m.exif.toString('latin1').includes('TestCam'), 'keep metadata: EXIF survives jpg -> png when box unchecked');
    r = await run('photo-exif.jpg', 'png', { strip: true });
    m = await meta(r.res?.outputs[0]);
    ok(!m.exif && !m.xmp, 'strip: no EXIF in png');
    r = await run('plain.jpg', 'pdf', { strip: true });
    ok(r.ok && (await PDFDocument.load(fs.readFileSync(r.res.outputs[0]))).getPageCount() === 1, 'plain jpg (no EXIF) -> pdf with strip on', r.message);
    r = await run('photo-exif.jpg', 'webp', { strip: true });
    m = await meta(r.res?.outputs[0]);
    ok(r.ok && m.format === 'webp' && !m.exif, 'jpg -> webp, EXIF stripped');
    r = await run('photo-exif.jpg', 'tiff', { strip: true });
    m = await meta(r.res?.outputs[0]);
    ok(r.ok && m.format === 'tiff' && !(m.exif && m.exif.toString('latin1').includes('Secret')), 'jpg -> tiff, no author');
    r = await run('plain.jpg', 'gif');
    ok(r.ok && (await meta(r.res?.outputs[0])).format === 'gif', 'jpg -> gif');
    r = await run('plain.jpg', 'bmp');
    const bmpBuf = fs.readFileSync(r.res?.outputs[0]);
    ok(r.ok && bmpBuf.toString('latin1', 0, 2) === 'BM' && bmpBuf.readInt32LE(18) === 640 && bmpBuf.readInt32LE(22) === 400, 'jpg -> bmp is a real 640x400 BMP');
    const back = await (await require('../src/main/converters/images').openImageBuffer(bmpBuf, 'bmp')).metadata();
    ok(back.width === 640 && back.height === 400, 'our own bmp round-trips');
    r = await run('plain.jpg', 'ico');
    const icoBuf = fs.readFileSync(r.res?.outputs[0]);
    ok(r.ok && icoBuf.readUInt16LE(2) === 1 && icoBuf.readUInt16LE(4) === 6, 'jpg -> ico has 6 sizes');
    r = await run('transparent.png', 'jpg');
    const px = await sharp(r.res?.outputs[0]).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    ok(r.ok && px[0] > 245 && px[1] > 245 && px[2] > 245, 'transparent png -> jpg background becomes white', Array.from(px).join(','));
    r = await run('transparent.png', 'webp');
    ok(r.ok && (await meta(r.res?.outputs[0])).hasAlpha, 'transparent png -> webp keeps transparency');
    r = await run('transparent.png', 'png', { strip: true }).catch(() => null);
    ok(r && !r.ok, 'png -> png is not offered');

    for (const [f, t] of [['sample.bmp', 'png'], ['sample.tiff', 'png'], ['sample.webp', 'png'], ['tiny.ico', 'png'], ['sample.heic', 'jpg'], ['sample.heic', 'png'], ['anim.gif', 'png']]) {
      r = await run(f, t);
      const mm = r.ok ? await meta(r.res?.outputs[0]) : {};
      ok(r.ok && mm.width > 0, `${f} -> ${t}`, r.ok ? '' : String(r.raw && r.raw.stack));
      if (f === 'sample.bmp' && r.ok) {
        const a = await sharp(path.join(FIX, 'plain.jpg')).resize(1, 1).raw().toBuffer();
        const b = await sharp(r.res?.outputs[0]).resize(1, 1).raw().toBuffer();
        ok(Math.abs(a[0] - b[0]) < 12 && Math.abs(a[2] - b[2]) < 12, 'bmp colours are right (not channel-swapped)', `${Array.from(a)} vs ${Array.from(b)}`);
      }
      if (f === 'sample.heic' && r.ok) ok(mm.width === 640 && mm.height === 400, 'heic decoded at the right size', `${mm.width}x${mm.height}`);
    }
    r = await run('anim.gif', 'webp');
    m = await sharp(r.res?.outputs[0], { animated: true }).metadata();
    ok(r.ok && m.pages === 3, 'animated gif -> webp keeps 3 frames', `pages=${m.pages}`);
    r = await run('anim.gif', 'pdf');
    ok(r.ok && (await PDFDocument.load(fs.readFileSync(r.res?.outputs[0]))).getPageCount() === 3, 'animated gif -> pdf has 3 pages');
    r = await run('sample.heic', 'pdf');
    ok(r.ok, 'heic -> pdf');
  }

  console.log('\nImages <-> PDF');
  {
    let r = await run('photo-exif-upright.jpg', 'pdf', { strip: false });
    let bytes = fs.readFileSync(r.res?.outputs[0]);
    let doc = await PDFDocument.load(bytes);
    ok(r.ok && doc.getPageCount() === 1, 'jpg -> pdf (1 page)');
    ok(bytes.includes(Buffer.from('TestCam')) , 'keep metadata: original JPEG bytes (with EXIF) are embedded when box unchecked');
    r = await run('photo-exif-upright.jpg', 'pdf', { strip: true });
    bytes = fs.readFileSync(r.res?.outputs[0]);
    ok(r.ok && !bytes.includes(Buffer.from('TestCam')) && !bytes.includes(Buffer.from('Secret Author')) && !bytes.includes(Buffer.from('Exif')), 'strip: no EXIF/GPS inside the pdf');
    const txt = bytes.toString('latin1');
    ok(!/\/(Producer|CreationDate|ModDate|Title|Author|Creator)\b/.test(txt), 'strip: pdf has no Info entries / dates', (txt.match(/\/(Producer|CreationDate|ModDate|Title|Author|Creator)[^\/>]*/g) || []).join(' | '));
    ok(!/<x:xmpmeta/.test(txt), 'strip: no XMP block');
    // a photo whose rotate-tag says "turn 90 degrees" must become a portrait page
    const rot = await run('photo-exif.jpg', 'pdf', { strip: true });
    doc = await PDFDocument.load(fs.readFileSync(rot.res.outputs[0]));
    const { width, height } = doc.getPage(0).getSize();
    ok(height > width, 'rotated photo becomes a portrait page', `${width}x${height}`);
    r = await run('transparent.png', 'pdf', { strip: true });
    ok(r.ok && !fs.readFileSync(r.res?.outputs[0]).includes(Buffer.from('Secret Author')), 'png -> pdf, png text chunks not leaked');

    r = await run('multipage.pdf', 'png');
    if (!r.ok) console.log('       ', r.message, r.raw && r.raw.stack);
    ok(r.ok && r.res?.outputs.length === 3 && r.res?.outputs.every((f) => fs.existsSync(f)), 'pdf (3 pages) -> 3 png files');
    ok(r.ok && path.dirname(r.res?.outputs?.[0] || '') !== r.work, 'multi-page output goes into its own folder', path.dirname(r.res?.outputs?.[0] || ''));
    ok(r.ok && r.res?.revealPath === path.dirname(r.res?.outputs?.[0] || ''), 'reveal points at the folder');
    m = r.ok ? await meta(r.res.outputs[0]) : {};
    ok(m.width >= 800, 'rendered at readable resolution', `${m.width}x${m.height}`);
    var m;
    r = await run('multipage.pdf', 'jpg');
    ok(r.ok && r.res?.outputs.length === 3 && (await meta(r.res?.outputs[0])).format === 'jpeg', 'pdf -> jpg');
    r = await run('multipage.pdf', 'webp'); ok(r.ok, 'pdf -> webp');
    r = await run('multipage.pdf', 'tiff'); ok(r.ok, 'pdf -> tiff');
    // single page pdf -> single file next to the original
    const one = await run('photo-exif.jpg', 'pdf');
    const singleDir = one.work;
    r = await run(path.basename(one.res.outputs[0]), 'png', { dir: singleDir }).catch((e) => ({ ok: false }));
  }

  console.log('\nFailures are friendly');
  {
    for (const [f, t, re, label] of [
      ['locked.pdf', 'png', /password/i, 'password-protected pdf'],
      ['broken.pdf', 'png', /damaged|not a real pdf/i, 'broken pdf'],
      ['broken.png', 'jpg', /damaged|not what its name/i, 'broken image'],
      ['broken.ipynb', 'html', /damaged|notebook/i, 'broken notebook'],
    ]) {
      const r = await run(f, t);
      ok(!r.ok && re.test(r.message) && !/\bat |Error:|undefined/.test(r.message), `${label}: "${r.message}"`);
    }
    const r = await run('plain.jpg', 'docx');
    ok(!r.ok && /cannot turn/.test(r.message), 'invalid target gives plain message: ' + r.message);
  }

  console.log('\nNever overwrite');
  {
    const dir = path.join(OUT_ROOT, 'overwrite'); fs.mkdirSync(dir, { recursive: true });
    const a = await run('plain.jpg', 'png', { dir });
    const b = await run('plain.jpg', 'png', { dir });
    const c = await run('plain.jpg', 'png', { dir });
    ok(path.basename(a.res.outputs[0]) === 'plain.png' && path.basename(b.res.outputs[0]) === 'plain (1).png' && path.basename(c.res.outputs[0]) === 'plain (2).png', 'plain.png, plain (1).png, plain (2).png', [a, b, c].map((x) => path.basename(x.res.outputs[0])).join(', '));
    ok(fs.existsSync(path.join(dir, 'plain.jpg')), 'original untouched');
  }

  console.log('\nNotebooks');
  {
    let r = await run('analysis.ipynb', 'html');
    let html = r.ok ? fs.readFileSync(r.res?.outputs[0], 'utf8') : '';
    ok(r.ok, 'ipynb -> html');
    ok(/hello from the kernel/.test(html), 'html: print output present');
    ok((html.match(/<img src="data:image\/png/g) || []).length === 1, 'html: plot embedded as image');
    ok(/class="katex"/.test(html), 'html: math rendered');
    ok(/Grace/.test(html) && /<table/.test(html), 'html: dataframe table rendered');
    ok(/ZeroDivisionError/.test(html), 'html: traceback shown');
    ok(!/<script/i.test(html), 'html: no scripts');
    ok(!/\x1b\[/.test(html), 'html: no raw ANSI escapes');
    ok(/rich markdown output/.test(html), 'html: Markdown display output');
    ok(/Content-Security-Policy/.test(html) && !/https?:\/\/(?!example\.com|www\.w3\.org)/.test(html.replace(/<a [^>]*>/g, '')), 'html: self-contained and offline-safe');
    ok(!/Secret Author/.test(html), 'html: notebook metadata not included');

    r = await run('analysis.ipynb', 'py');
    let py = r.ok ? fs.readFileSync(r.res?.outputs[0], 'utf8') : '';
    ok(r.ok && /def boom\(\):/.test(py) && /# In\[/.test(py) && /# %matplotlib inline/.test(py) && !/^%matplotlib/m.test(py), 'py: code kept, magics commented out');
    ok(/# Sales analysis/.test(py), 'py: markdown becomes comments');
    r = await run('analysis.ipynb', 'py', { strip: true });
    py = fs.readFileSync(r.res?.outputs[0], 'utf8');
    ok(!/In\[\d+\]/.test(py), 'py strip: no execution counts');

    r = await run('analysis.ipynb', 'md');
    const md = r.ok ? fs.readFileSync(r.res?.outputs[0], 'utf8') : '';
    ok(r.ok && /```python/.test(md) && /# Sales analysis/.test(md), 'md: fenced code + markdown');
    const imgs = (md.match(/!\[output\]\(([^)]+)\)/g) || []);
    ok(imgs.length === 1, 'md: plot referenced', String(imgs));
    const rel = decodeURIComponent((md.match(/!\[output\]\(([^)]+)\)/) || [])[1] || '');
    ok(rel && fs.existsSync(path.join(r.work, rel)), 'md: image file saved next to the .md', rel);
    ok(/ZeroDivisionError/.test(md) && !/\x1b/.test(md), 'md: traceback without colour codes');

    r = await run('analysis.ipynb', 'pdf', { strip: true });
    ok(r.ok, 'ipynb -> pdf', r.ok ? '' : String(r.raw && r.raw.stack));
    if (r.ok) {
      const bytes = fs.readFileSync(r.res?.outputs[0]);
      const doc = await PDFDocument.load(bytes);
      ok(doc.getPageCount() >= 2, `pdf has pages (${doc.getPageCount()})`);
      const t = bytes.toString('latin1');
      ok(!/\/(Producer|CreationDate|ModDate|Title|Author|Creator)\b/.test(t), 'pdf strip: no producer/dates/title', (t.match(/\/(Producer|CreationDate|ModDate|Title|Author|Creator)[^\/>]*/g) || []).join(' | '));
      // render the pdf pages so a human (or I) can look at them
      const pngs = await run(path.basename(r.res?.outputs[0]), 'png', { dir: r.work });
      ok(pngs.ok, 'rendered notebook pdf back to pages for inspection', pngs.ok ? pngs.res.outputs[0] : pngs.message);
      console.log('       pages in:', pngs.ok ? path.dirname(pngs.res.outputs[0]) : '');
    }
    r = await run('analysis.ipynb', 'pdf', { strip: false });
    if (r.ok) {
      const t = fs.readFileSync(r.res?.outputs[0]).toString('latin1');
      ok(/Producer/.test(t), 'pdf (no strip) keeps normal info');
    }
    r = await run('empty.ipynb', 'pdf');
    ok(r.ok, 'empty notebook -> pdf does not crash');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('Output folder:', OUT_ROOT);
  if (failures.length) console.log('Failed:\n - ' + failures.join('\n - '));
  return fail ? 1 : 0;
}

app.whenReady().then(async () => {
  let code = 1;
  try { code = await main(); } catch (e) { console.error('TEST HARNESS CRASH', e); }
  app.exit(code);
});
