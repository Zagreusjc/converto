'use strict';
const api = window.converto;
const $ = (id) => document.getElementById(id);

const screens = ['empty', 'choose', 'working', 'done'];
function show(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name);
  state.screen = name;
}

let progressHandler = null;
let targetOrder = [];
const state = { screen: 'empty', files: [], skipped: [], busy: false, lastReveal: null };

/* ---------- adding files ---------- */

async function addPaths(paths) {
  if (!paths || !paths.length || state.busy) return;
  if (state.screen === 'done' || state.screen === 'working') { state.files = []; state.skipped = []; }
  const { files, unsupported, order } = await api.inspect(paths);
  if (order) targetOrder = order;
  const have = new Set(state.files.map((f) => f.path));
  for (const f of files) if (!have.has(f.path)) state.files.push(f);
  state.skipped = state.skipped.concat(unsupported);
  renderChoose();
}

function renderChoose() {
  if (!state.files.length) {
    if (state.skipped.length) {
      show('empty');
      flashDropzone(`Converto can't convert ${describeList(state.skipped)} yet.`);
    } else show('empty');
    state.skipped = [];
    return;
  }
  show('choose');
  const n = state.files.length;
  $('files-count').textContent = n === 1 ? '1 file ready' : `${n} files ready`;

  const list = $('file-list');
  list.replaceChildren();
  state.files.forEach((f, i) => {
    const li = document.createElement('li');
    li.append(extBadge(f.ext), nameEl(f.name));
    const rm = document.createElement('button');
    rm.className = 'remove'; rm.type = 'button'; rm.title = 'Remove'; rm.setAttribute('aria-label', `Remove ${f.name}`);
    rm.textContent = '×';
    rm.addEventListener('click', () => { state.files.splice(i, 1); renderChoose(); });
    li.append(rm);
    list.append(li);
  });

  const note = $('skipped-note');
  if (state.skipped.length) {
    note.textContent = `Skipped ${describeList(state.skipped)}: Converto can't convert ${state.skipped.length === 1 ? 'that type' : 'those types'} yet.`;
    note.classList.remove('hidden');
  } else note.classList.add('hidden');

  // Buttons: every format at least one file can become. If not all files can, say how many.
  const counts = new Map();
  const labels = new Map();
  const order = [];
  for (const f of state.files) for (const t of f.targets) {
    if (!counts.has(t.id)) { counts.set(t.id, 0); labels.set(t.id, t.label); order.push(t.id); }
    counts.set(t.id, counts.get(t.id) + 1);
  }
  const box = $('format-buttons');
  box.replaceChildren();
  order.sort((a, b) => targetOrder.indexOf(a) - targetOrder.indexOf(b));
  for (const id of order) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'fmt'; b.textContent = labels.get(id);
    if (counts.get(id) < n) {
      const s = document.createElement('small');
      s.textContent = `${counts.get(id)} of ${n} files`;
      b.append(s);
    }
    b.addEventListener('click', () => startConvert(id, labels.get(id)));
    box.append(b);
  }
  $('no-formats').classList.toggle('hidden', order.length > 0);
  $('choose-title').classList.toggle('hidden', order.length === 0);
}

function describeList(names) {
  if (names.length === 1) return `“${names[0]}”`;
  if (names.length <= 3) return names.map((n) => `“${n}”`).join(', ');
  return `${names.length} files`;
}
function extBadge(ext) { const s = document.createElement('span'); s.className = 'ext'; s.textContent = ext; return s; }
function nameEl(name) { const s = document.createElement('span'); s.className = 'fname'; s.textContent = name; s.title = name; return s; }

function flashDropzone(msg) {
  const sub = document.querySelector('#dropzone .drop-sub');
  sub.textContent = msg;
  setTimeout(() => { sub.textContent = 'or'; }, 6000);
}

/* ---------- converting ---------- */

async function startConvert(targetId, targetLabel) {
  if (state.busy) return;
  state.busy = true;
  const files = state.files.slice();
  $('working-title').textContent = `Converting to ${targetLabel}…`;
  const list = $('progress-list');
  list.replaceChildren();
  const rows = files.map((f) => {
    const li = document.createElement('li');
    const body = document.createElement('div'); body.className = 'li-body';
    body.append(nameEl(f.name));
    const status = document.createElement('span'); status.className = 'status wait'; status.textContent = 'Waiting';
    li.append(extBadge(f.ext), body, status);
    list.append(li);
    return { li, body, status };
  });
  show('working');

  const eligible = [];
  files.forEach((f, i) => { if (f.targets.some((t) => t.id === targetId)) eligible.push(i); });
  const skippedIdx = files.map((_, i) => i).filter((i) => !eligible.includes(i));
  skippedIdx.forEach((i) => { rows[i].status.textContent = 'Skipped'; rows[i].status.className = 'status wait'; });

  progressHandler = (msg) => {
    const row = rows[eligible[msg.index]];
    if (!row) return;
    if (msg.status === 'working') {
      row.status.className = 'status'; row.status.replaceChildren(spinner());
    } else if (msg.status === 'done') {
      row.status.className = 'status ok'; row.status.textContent = 'Done ✓';
    } else if (msg.status === 'failed') {
      row.status.className = 'status bad'; row.status.textContent = 'Failed';
    }
  };

  let results = [];
  try {
    results = await api.convert(eligible.map((i) => files[i].path), targetId);
  } catch (e) {
    results = eligible.map((i) => ({ name: files[i].name, ok: false, message: 'Something went wrong while converting. Please try again.' }));
  }
  progressHandler = null;
  state.busy = false;
  showDone(files, eligible, skippedIdx, results, targetLabel);
}

function spinner() { const d = document.createElement('div'); d.className = 'spinner'; return d; }

function showDone(files, eligible, skippedIdx, results, targetLabel) {
  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const banner = $('done-banner');
  banner.className = 'banner';
  if (ok.length && !bad.length) {
    banner.classList.add('ok');
    banner.textContent = ok.length === 1 ? `Done! Your ${targetLabel} file is saved next to the original.` : `Done! All ${ok.length} files were converted and saved next to the originals.`;
  } else if (ok.length) {
    banner.classList.add('mixed');
    banner.textContent = `${ok.length} converted, ${bad.length} could not be converted. Details below.`;
  } else {
    banner.classList.add('bad');
    banner.textContent = bad.length === 1 ? 'That file could not be converted.' : 'None of the files could be converted.';
  }

  const list = $('result-list');
  list.replaceChildren();
  results.forEach((r, k) => {
    const f = files[eligible[k]];
    const li = document.createElement('li');
    const body = document.createElement('div'); body.className = 'li-body';
    body.append(nameEl(r.name));
    const msg = document.createElement('span'); msg.className = 'fmsg';
    if (r.ok) {
      const outNames = (r.outputs || []).map((p) => p.split(/[\\/]/).pop());
      msg.textContent = `Saved as ${outNames[0]}${outNames.length > 1 ? ` (+${outNames.length - 1} more)` : ''}${r.note ? '. ' + r.note : ''}`;
    } else msg.textContent = r.message;
    body.append(msg);
    const st = document.createElement('span'); st.className = 'status ' + (r.ok ? 'ok' : 'bad'); st.textContent = r.ok ? 'Done ✓' : 'Failed';
    li.append(extBadge(f ? f.ext : ''), body, st);
    list.append(li);
  });
  skippedIdx.forEach((i) => {
    const f = files[i];
    const li = document.createElement('li');
    const body = document.createElement('div'); body.className = 'li-body';
    body.append(nameEl(f.name));
    const msg = document.createElement('span'); msg.className = 'fmsg';
    msg.textContent = f.ext === targetLabel.toLowerCase() || (f.ext === 'jpeg' && targetLabel === 'JPG')
      ? `Skipped: this is already a ${targetLabel} file.`
      : `Skipped: a .${f.ext} file can't become ${targetLabel}.`;
    body.append(msg);
    li.append(extBadge(f.ext), body);
    list.append(li);
  });

  state.lastReveal = ok.length ? ok[0].revealPath : null;
  $('btn-show').classList.toggle('hidden', !state.lastReveal);
  show('done');
}

/* ---------- wiring ---------- */

api.onProgress((msg) => { if (progressHandler) progressHandler(msg); });
api.onOpenFiles((paths) => addPaths(paths));

async function browse() { addPaths(await api.pickFiles()); }
$('btn-browse').addEventListener('click', (e) => { e.stopPropagation(); browse(); });
$('btn-add').addEventListener('click', browse);
$('dropzone').addEventListener('click', browse);
$('dropzone').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); browse(); } });
$('btn-clear').addEventListener('click', () => { state.files = []; state.skipped = []; renderChoose(); });
$('btn-again').addEventListener('click', () => { state.files = []; state.skipped = []; renderChoose(); });
$('btn-show').addEventListener('click', () => { if (state.lastReveal) api.showInFolder(state.lastReveal); });

// Drag & drop anywhere on the window
let dragDepth = 0;
const overlay = $('drag-overlay');
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; overlay.classList.remove('hidden'); $('dropzone').classList.add('over'); });
window.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) { overlay.classList.add('hidden'); $('dropzone').classList.remove('over'); } });
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; overlay.classList.add('hidden'); $('dropzone').classList.remove('over');
  if (e.dataTransfer && e.dataTransfer.files.length) addPaths(api.pathsFromFiles(e.dataTransfer.files));
});

// Setting: remove metadata
(async () => {
  const s = await api.getSettings();
  $('chk-strip').checked = !!s.strip;
})();
$('chk-strip').addEventListener('change', (e) => api.setSetting('strip', e.target.checked));
