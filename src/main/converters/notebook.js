'use strict';
/**
 * Jupyter notebook (.ipynb) conversion, done entirely in JavaScript:
 * no Python, no nbconvert, no LaTeX.
 */
const fs = require('fs');
const path = require('path');
const { Marked } = require('marked');
const markedKatex = require('marked-katex-extension');
const hljs = require('highlight.js');
const katex = require('katex');
const { FriendlyError, writeUnique, createUniqueDir, baseNameWithoutExt } = require('../util');
const { stripJpeg, stripPng } = require('../metadata');
const { htmlToPdf } = require('../htmlToPdf');

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

const joinSrc = (s) => (Array.isArray(s) ? s.join('') : typeof s === 'string' ? s : '');

async function readNotebook(inputPath) {
  const text = await fs.promises.readFile(inputPath, 'utf8');
  let nb;
  try {
    nb = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new FriendlyError('This notebook file is damaged: it could not be read as a Jupyter notebook.');
  }
  if (!nb || typeof nb !== 'object') throw new FriendlyError('This does not look like a Jupyter notebook.');
  let cells = nb.cells;
  if (!Array.isArray(cells) && Array.isArray(nb.worksheets) && nb.worksheets[0]) {
    // Very old notebook format (v3): translate to the modern shape.
    cells = nb.worksheets[0].cells.map((c) => ({
      cell_type: c.cell_type === 'heading' ? 'markdown' : c.cell_type,
      source: c.cell_type === 'heading' ? '#'.repeat(c.level || 1) + ' ' + joinSrc(c.source) : joinSrc(c.source ?? c.input),
      outputs: (c.outputs || []).map((o) => ({
        output_type: o.output_type === 'pyout' ? 'execute_result' : o.output_type === 'pystream' ? 'stream' : o.output_type,
        name: o.stream,
        text: o.text,
        data: { 'text/plain': o.text, 'image/png': o.png, 'image/jpeg': o.jpeg, 'text/html': o.html },
      })),
    }));
  }
  if (!Array.isArray(cells)) throw new FriendlyError('This does not look like a Jupyter notebook (no cells were found).');
  const meta = nb.metadata || {};
  const lang = (
    (meta.language_info && meta.language_info.name) ||
    (meta.kernelspec && meta.kernelspec.language) ||
    'python'
  ).toLowerCase();
  return { cells, lang };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const stripAnsiCodes = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

/** Collapse carriage returns the way a terminal does (progress bars print "\r" to redraw one line). */
function applyCarriageReturns(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line;
      const parts = line.split('\r').filter((p, i, a) => p !== '' || i === a.length - 1);
      return parts[parts.length - 1] || '';
    })
    .join('\n');
}

const ANSI_16 = ['#000000', '#c91b00', '#00a600', '#a68a00', '#0225c7', '#c930c7', '#00a5c5', '#808080'];
const ANSI_16_BRIGHT = ['#555555', '#ff6e67', '#5ffa68', '#a68a00', '#6871ff', '#ff77ff', '#00a5c5', '#222222'];

function ansi256(n) {
  if (n < 8) return ANSI_16[n];
  if (n < 16) return ANSI_16_BRIGHT[n - 8];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  n -= 16;
  const c = [Math.floor(n / 36), Math.floor((n % 36) / 6), n % 6].map((x) => (x ? 55 + x * 40 : 0));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Convert text containing ANSI colour codes (tracebacks, tqdm, pip) into safe HTML. */
function ansiToHtml(raw) {
  const text = applyCarriageReturns(String(raw));
  let out = '';
  let open = false;
  let state = { color: null, bg: null, bold: false, underline: false };
  const flush = () => {
    if (open) out += '</span>';
    open = false;
  };
  const apply = () => {
    flush();
    const css = [];
    if (state.color) css.push(`color:${state.color}`);
    if (state.bg) css.push(`background:${state.bg}`);
    if (state.bold) css.push('font-weight:bold');
    if (state.underline) css.push('text-decoration:underline');
    if (css.length) {
      out += `<span style="${css.join(';')}">`;
      open = true;
    }
  };
  const re = /\x1b\[([0-9;?]*)([A-Za-z])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    out += escapeHtml(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[2] !== 'm') continue; // cursor movement etc. is ignored
    const codes = m[1] === '' ? [0] : m[1].split(';').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) state = { color: null, bg: null, bold: false, underline: false };
      else if (c === 1) state.bold = true;
      else if (c === 4) state.underline = true;
      else if (c === 22) state.bold = false;
      else if (c === 24) state.underline = false;
      else if (c >= 30 && c <= 37) state.color = ANSI_16[c - 30];
      else if (c >= 90 && c <= 97) state.color = ANSI_16_BRIGHT[c - 90];
      else if (c >= 40 && c <= 47) state.bg = ANSI_16[c - 40] + '33';
      else if (c >= 100 && c <= 107) state.bg = ANSI_16_BRIGHT[c - 100] + '33';
      else if (c === 39) state.color = null;
      else if (c === 49) state.bg = null;
      else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
        const col = ansi256(codes[i + 2] || 0);
        if (c === 38) state.color = col; else state.bg = col;
        i += 2;
      } else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
        const col = `rgb(${codes[i + 2] || 0},${codes[i + 3] || 0},${codes[i + 4] || 0})`;
        if (c === 38) state.color = col; else state.bg = col;
        i += 4;
      }
    }
    apply();
  }
  out += escapeHtml(text.slice(last));
  flush();
  return out;
}

/** Notebooks may contain raw HTML (pandas tables, widgets). Keep it static: no scripts, no frames, no handlers. */
function sanitizeHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<(iframe|object|embed|link|meta|base)\b[^>]*>(?:[\s\S]*?<\/\1\s*>)?/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

const cleanB64 = (s) => joinSrc(s).replace(/\s+/g, '');

/* ------------------------------------------------------------------ */
/* Markdown (shared by HTML / PDF output)                               */
/* ------------------------------------------------------------------ */

function makeMarked(lang) {
  const md = new Marked({ gfm: true, breaks: false });
  md.use(markedKatex({ throwOnError: false, output: 'html', nonStandard: true }));
  md.use({
    renderer: {
      code({ text, lang: l }) {
        return `<pre class="code"><code class="hljs">${highlight(text, (l || '').split(/\s+/)[0] || lang)}</code></pre>\n`;
      },
    },
  });
  return md;
}

function highlight(code, language) {
  try {
    const l = (language || '').toLowerCase();
    if (l && hljs.getLanguage(l)) return hljs.highlight(code, { language: l, ignoreIllegals: true }).value;
  } catch {
    /* fall through */
  }
  return escapeHtml(code);
}

/* ------------------------------------------------------------------ */
/* HTML rendering                                                       */
/* ------------------------------------------------------------------ */

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; padding: 0; color: #1f2328; background: #fff;
  font: 11pt/1.55 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
.nb { max-width: 1000px; margin: 0 auto; padding: 24px 32px; }
.cell { margin: 0 0 14px 0; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 .5em; break-after: avoid; }
h1 { font-size: 1.9em; border-bottom: 1px solid #d8dee4; padding-bottom: .25em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #eaeef2; padding-bottom: .2em; }
h3 { font-size: 1.25em; }
p { margin: .6em 0; }
a { color: #0969da; word-break: break-word; }
img, svg { max-width: 100%; height: auto; }
blockquote { margin: .8em 0; padding: 0 1em; color: #59636e; border-left: 4px solid #d1d9e0; }
ul, ol { padding-left: 2em; }
li { overflow-wrap: anywhere; }
hr { border: 0; border-top: 1px solid #d8dee4; margin: 1.2em 0; }
table { border-collapse: collapse; max-width: 100%; margin: .6em 0; font-size: 9.5pt; }
th, td { border: 1px solid #d1d9e0; padding: 3px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; word-break: break-word; }
th { background: #f6f8fa; }
tr { break-inside: avoid; }
pre, code, .mono { font: 9.5pt/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
:not(pre) > code { background: #eff1f3; padding: .1em .35em; border-radius: 4px; font-size: 90%; overflow-wrap: anywhere; }
/* Long lines wrap instead of running off the page */
pre { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; tab-size: 4; margin: 0; }
/* keep a code cell together with the plot/table right below it when it fits */
.cell.code > pre.code { break-after: avoid; break-inside: avoid; }
.nb > .cell:first-child > :first-child { margin-top: 0; }
pre.code { background: #f6f8fa; border: 1px solid #d8dee4; border-left: 3px solid #8c959f; border-radius: 4px; padding: 8px 10px; }
.output { margin: 4px 0 0 0; }
.output pre { padding: 4px 10px; }
.output pre.stderr { background: #fff1f0; }
.output pre.error { background: #fff1f0; border-left: 3px solid #cf222e; }
.output .rich { overflow-wrap: anywhere; }
.output img { display: block; margin: 6px 0; break-inside: avoid; }
.output .rich table { display: table; }
.cell.markdown { overflow-wrap: anywhere; }
.katex { font-size: 1.05em; }
.katex-display { overflow-x: visible; margin: .8em 0; }
.hljs-comment, .hljs-quote { color: #6e7781; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-built_in.hljs-keyword { color: #cf222e; }
.hljs-string, .hljs-doctag, .hljs-regexp { color: #0a3069; }
.hljs-number, .hljs-symbol, .hljs-bullet { color: #0550ae; }
.hljs-title, .hljs-section, .hljs-title.function_, .hljs-title.class_ { color: #8250df; }
.hljs-built_in, .hljs-type, .hljs-attr, .hljs-attribute { color: #0550ae; }
.hljs-variable, .hljs-template-variable { color: #953800; }
.hljs-meta, .hljs-meta .hljs-keyword { color: #57606a; }
.hljs-addition { background: #dafbe1; }
.hljs-deletion { background: #ffebe9; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }
@media print { .nb { max-width: none; padding: 0; } }
`;

let katexCssCache = null;
function katexCss() {
  if (katexCssCache) return katexCssCache;
  const dir = path.dirname(require.resolve('katex/dist/katex.min.css'));
  let css = fs.readFileSync(path.join(dir, 'katex.min.css'), 'utf8');
  // Embed only the woff2 fonts, so the page works with no extra files and no network.
  css = css.replace(/src:\s*url\(fonts\/([^)]+?\.woff2)\)\s*format\("woff2"\)[^;}]*/g, (_m, file) => {
    const b64 = fs.readFileSync(path.join(dir, 'fonts', file)).toString('base64');
    return `src:url(data:font/woff2;base64,${b64}) format("woff2")`;
  });
  katexCssCache = css;
  return css;
}

/** Pick the best representation of an output and turn it into HTML. */
function renderMimeBundle(data, md, strip) {
  if (!data) return '';
  const img = (mime, b64) => {
    let buf = Buffer.from(cleanB64(b64), 'base64');
    if (strip && mime === 'image/png') buf = stripPng(buf);
    if (strip && mime === 'image/jpeg') buf = stripJpeg(buf);
    return `<img src="data:${mime};base64,${buf.toString('base64')}" alt="">`;
  };
  if (data['image/png']) return img('image/png', data['image/png']);
  if (data['image/jpeg']) return img('image/jpeg', data['image/jpeg']);
  if (data['image/gif']) return img('image/gif', data['image/gif']);
  if (data['image/svg+xml']) {
    const svg = Buffer.from(joinSrc(data['image/svg+xml']), 'utf8').toString('base64');
    return `<img src="data:image/svg+xml;base64,${svg}" alt="">`;
  }
  if (data['text/html']) {
    const html = joinSrc(data['text/html']);
    // Interactive output (plotly, bokeh, widgets) needs scripts we deliberately don't run; use the text version instead.
    const needsScript = /<script\b/i.test(html) && !/<table\b/i.test(html);
    if (!needsScript || !data['text/plain']) return `<div class="rich">${sanitizeHtml(html)}</div>`;
  }
  if (data['text/latex']) {
    const tex = joinSrc(data['text/latex']).trim().replace(/^(\$+|\\\[|\\\()\s*/, '').replace(/\s*(\$+|\\\]|\\\))$/, '');
    return `<div class="rich">${katex.renderToString(tex, { displayMode: true, throwOnError: false, output: 'html' })}</div>`;
  }
  if (data['text/markdown']) return `<div class="rich">${sanitizeHtml(md.parse(joinSrc(data['text/markdown'])))}</div>`;
  if (data['application/vnd.jupyter.widget-view+json'] && !data['text/plain']) return '';
  if (data['text/plain']) {
    const t = joinSrc(data['text/plain']);
    if (/^<?[A-Za-z]*(Widget|HBox|VBox|IntSlider|Output)\b.*>?$/.test(t.trim()) && data['application/vnd.jupyter.widget-view+json']) return '';
    return `<pre>${ansiToHtml(t)}</pre>`;
  }
  return '';
}

function renderOutputs(outputs, md, strip) {
  let html = '';
  for (const o of outputs || []) {
    if (o.output_type === 'stream') {
      const cls = o.name === 'stderr' ? 'stderr' : 'stdout';
      html += `<div class="output"><pre class="${cls}">${ansiToHtml(joinSrc(o.text))}</pre></div>`;
    } else if (o.output_type === 'error') {
      const tb = (o.traceback && o.traceback.length ? o.traceback.join('\n') : `${o.ename}: ${o.evalue}`);
      html += `<div class="output"><pre class="error">${ansiToHtml(tb)}</pre></div>`;
    } else if (o.output_type === 'display_data' || o.output_type === 'execute_result') {
      const inner = renderMimeBundle(o.data, md, strip);
      if (inner) html += `<div class="output">${inner}</div>`;
    }
  }
  return html;
}

function attachmentResolver(cell) {
  const att = cell.attachments || {};
  return (md) =>
    md.replace(/\]\(attachment:([^)\s]+)\)/g, (m, name) => {
      const entry = att[name] || att[decodeURIComponent(name)];
      if (!entry) return m;
      const mime = Object.keys(entry)[0];
      return `](data:${mime};base64,${cleanB64(entry[mime])})`;
    });
}

function notebookToHtmlString(nb, { title, strip }) {
  const md = makeMarked(nb.lang);
  let body = '';
  for (const cell of nb.cells) {
    const src = joinSrc(cell.source);
    if (cell.cell_type === 'markdown') {
      const text = attachmentResolver(cell)(src);
      body += `<div class="cell markdown">${sanitizeHtml(md.parse(text))}</div>\n`;
    } else if (cell.cell_type === 'code') {
      const out = renderOutputs(cell.outputs, md, strip);
      if (!src.trim() && !out) continue;
      body += `<div class="cell code">`;
      if (src.trim()) body += `<pre class="code"><code class="hljs">${highlight(src.replace(/\n$/, ''), nb.lang)}</code></pre>`;
      body += `${out}</div>\n`;
    } else if (cell.cell_type === 'raw' && src.trim()) {
      body += `<div class="cell raw"><pre>${escapeHtml(src)}</pre></div>\n`;
    }
  }
  const usesMath = body.includes('class="katex');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;">
<title>${escapeHtml(title)}</title>
<style>${CSS}${usesMath ? katexCss() : ''}
@page { size: ${pageName()}; margin: 16mm 14mm; }
</style>
</head>
<body><div class="nb">
${body}</div></body>
</html>`;
}

function pageName() {
  try {
    const { app } = require('electron');
    const loc = (app.getLocale() || '').toLowerCase();
    // Letter paper is used in the US, Canada, Mexico and a few other countries.
    if (/^en-(us|ca)|^es-mx|^es-us|^fr-ca|^en-ph/.test(loc)) return 'Letter';
  } catch {
    /* not running inside Electron (tests) */
  }
  return 'A4';
}

/* ------------------------------------------------------------------ */
/* Python and Markdown output                                           */
/* ------------------------------------------------------------------ */

function notebookToPython(nb, { strip }) {
  const parts = ['#!/usr/bin/env python', '# coding: utf-8', ''];
  nb.cells.forEach((cell) => {
    const src = joinSrc(cell.source).replace(/\s+$/, '');
    if (cell.cell_type === 'markdown') {
      parts.push(...src.split('\n').map((l) => (l ? '# ' + l : '#')), '', '');
    } else if (cell.cell_type === 'code') {
      if (!src.trim()) return;
      const lines = src.split('\n').map((l) => (/^\s*[%!]/.test(l) ? '# ' + l : l));
      const n = strip || cell.execution_count == null ? ' ' : String(cell.execution_count);
      parts.push(`# In[${n}]:`, '', '', ...lines, '', '');
    }
  });
  return parts.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
}

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg' };

/** Markdown output: images are saved in a "<name>_files" folder next to the .md file. */
async function notebookToMarkdown(nb, { strip, outDir, base }) {
  let filesDir = null;
  let filesRel = null;
  let imageCount = 0;
  const saveImage = async (mime, raw, label) => {
    if (!filesDir) {
      filesDir = await createUniqueDir(outDir, `${base}_files`);
      filesRel = path.basename(filesDir);
    }
    let buf = mime === 'image/svg+xml' ? Buffer.from(joinSrc(raw), 'utf8') : Buffer.from(cleanB64(raw), 'base64');
    if (strip && mime === 'image/png') buf = stripPng(buf);
    if (strip && mime === 'image/jpeg') buf = stripJpeg(buf);
    const name = `${label}_${++imageCount}.${MIME_EXT[mime]}`;
    await fs.promises.writeFile(path.join(filesDir, name), buf, { flag: 'wx' });
    return `${encodeURIComponent(filesRel)}/${name}`;
  };

  const fence = (text, lang = '') => {
    let ticks = '```';
    while (text.includes(ticks)) ticks += '`';
    return `${ticks}${lang}\n${text.replace(/\n$/, '')}\n${ticks}`;
  };

  const out = [];
  for (let ci = 0; ci < nb.cells.length; ci++) {
    const cell = nb.cells[ci];
    const src = joinSrc(cell.source);
    if (cell.cell_type === 'markdown') {
      out.push(attachmentResolver(cell)(src).trimEnd());
    } else if (cell.cell_type === 'code') {
      if (src.trim()) out.push(fence(src, nb.lang));
      for (const o of cell.outputs || []) {
        if (o.output_type === 'stream') {
          const t = stripAnsiCodes(applyCarriageReturns(joinSrc(o.text)));
          if (t.trim()) out.push(fence(t));
        } else if (o.output_type === 'error') {
          const t = stripAnsiCodes((o.traceback && o.traceback.length ? o.traceback.join('\n') : `${o.ename}: ${o.evalue}`));
          out.push(fence(t));
        } else if (o.data) {
          const d = o.data;
          const mime = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml'].find((m) => d[m]);
          if (mime) {
            out.push(`![output](${await saveImage(mime, d[mime], `output_${ci}`)})`);
          } else if (d['text/html'] && /<table\b/i.test(joinSrc(d['text/html']))) {
            out.push(sanitizeHtml(joinSrc(d['text/html'])).trim());
          } else if (d['text/markdown']) {
            out.push(joinSrc(d['text/markdown']).trim());
          } else if (d['text/latex']) {
            out.push(joinSrc(d['text/latex']).trim());
          } else if (d['text/plain']) {
            out.push(fence(stripAnsiCodes(joinSrc(d['text/plain']))));
          }
        }
      }
    } else if (cell.cell_type === 'raw' && src.trim()) {
      out.push(fence(src));
    }
  }
  return { markdown: out.join('\n\n') + '\n', filesDir };
}

/* ------------------------------------------------------------------ */
/* Entry points                                                         */
/* ------------------------------------------------------------------ */

async function convertNotebook(inputPath, target, ctx) {
  const nb = await readNotebook(inputPath);
  const base = baseNameWithoutExt(inputPath);
  const title = base;
  switch (target) {
    case 'html': {
      const html = notebookToHtmlString(nb, { title, strip: ctx.strip });
      return { outputs: [await writeUnique(ctx.outDir, base, '.html', html)] };
    }
    case 'pdf': {
      const html = notebookToHtmlString(nb, { title, strip: ctx.strip });
      const pdf = await htmlToPdf(html, { strip: ctx.strip });
      return { outputs: [await writeUnique(ctx.outDir, base, '.pdf', pdf)] };
    }
    case 'py':
      return { outputs: [await writeUnique(ctx.outDir, base, '.py', notebookToPython(nb, ctx))] };
    case 'md': {
      const { markdown, filesDir } = await notebookToMarkdown(nb, { strip: ctx.strip, outDir: ctx.outDir, base });
      const file = await writeUnique(ctx.outDir, base, '.md', markdown);
      return { outputs: [file, ...(filesDir ? [filesDir] : [])], revealPath: file };
    }
    default:
      throw new FriendlyError(`Converting a notebook to ${target.toUpperCase()} is not supported.`);
  }
}

module.exports = {
  convertNotebook,
  // exported for other converters (docs) and tests
  readNotebook,
  notebookToMarkdown,
  notebookToHtmlString,
  notebookToPython,
  ansiToHtml,
  makeMarked,
  highlight,
  CSS,
  katexCss,
  pageName,
  escapeHtml,
  sanitizeHtml,
};
