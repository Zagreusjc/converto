'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

/** An error whose message is already safe and friendly to show to the user. */
class FriendlyError extends Error {
  constructor(message) {
    super(message);
    this.friendly = true;
  }
}

/**
 * Create a new file for writing without ever replacing an existing one.
 * "photo.png" -> "photo (1).png" -> "photo (2).png" ...
 * Returns { filePath, handle } with the file already created (flag 'wx').
 */
async function createUniqueFile(dir, base, ext) {
  for (let i = 0; i < 10000; i++) {
    const name = i === 0 ? `${base}${ext}` : `${base} (${i})${ext}`;
    const filePath = path.join(dir, name);
    try {
      const handle = await fs.promises.open(filePath, 'wx');
      return { filePath, handle };
    } catch (e) {
      if (e.code === 'EEXIST') continue;
      throw e;
    }
  }
  throw new FriendlyError('There are too many files with this name already.');
}

/** Write a buffer to a new, never-overwriting file. Returns the final path. */
async function writeUnique(dir, base, ext, data) {
  const { filePath, handle } = await createUniqueFile(dir, base, ext);
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
  return filePath;
}

/** Reserve a unique folder name (creates it). */
async function createUniqueDir(dir, base) {
  for (let i = 0; i < 10000; i++) {
    const name = i === 0 ? base : `${base} (${i})`;
    const p = path.join(dir, name);
    try {
      await fs.promises.mkdir(p);
      return p;
    } catch (e) {
      if (e.code === 'EEXIST') continue;
      throw e;
    }
  }
  throw new FriendlyError('There are too many folders with this name already.');
}

/**
 * Decide where results go: next to the original. If that folder can't be
 * written to (read-only disk etc.) fall back to ~/Documents/Converto.
 */
async function resolveOutputDir(inputPath) {
  const dir = path.dirname(inputPath);
  try {
    await fs.promises.access(dir, fs.constants.W_OK);
    return { dir, fellBack: false };
  } catch {
    const fallback = path.join(os.homedir(), 'Documents', 'Converto');
    await fs.promises.mkdir(fallback, { recursive: true });
    return { dir: fallback, fellBack: true };
  }
}

/** Turn any thrown error into one plain-English sentence. */
function friendlyMessage(err, fileName) {
  if (err && err.friendly) return err.message;
  const code = err && err.code;
  const msg = String((err && err.message) || err || '');
  if (code === 'ENOENT') return 'This file could not be found. It may have been moved or deleted.';
  if (code === 'EACCES' || code === 'EPERM')
    return 'Converto is not allowed to read or save this file. Check that it is not locked or read-only.';
  if (code === 'ENOSPC') return 'Your disk is full, so the result could not be saved.';
  if (code === 'EISDIR') return 'This is a folder, not a file.';
  if (/password|encrypted/i.test(msg)) return 'This file is password-protected, so it cannot be converted.';
  if (/unsupported image format|Input buffer contains unsupported|corrupt|bad seek|premature end|truncated|VipsJpeg|VipsForeign|Invalid PDF|InvalidPDF|Invalid JSON|Unexpected token|JSON/i.test(msg))
    return 'This file looks damaged or is not what its name says, so it could not be read.';
  if (/memory|too large|exceeds/i.test(msg)) return 'This file is too large to convert on this computer.';
  return 'Something went wrong while converting this file. It may be damaged or use a feature that is not supported yet.';
}

function baseNameWithoutExt(filePath) {
  const b = path.basename(filePath);
  const e = path.extname(b);
  return e ? b.slice(0, -e.length) : b;
}

function extOf(filePath) {
  return path.extname(filePath).slice(1).toLowerCase();
}

/** A scratch folder in the system temp directory, removed by the caller. */
async function makeTempDir(prefix = 'converto-') {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function rmrf(p) {
  try {
    await fs.promises.rm(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

module.exports = {
  FriendlyError,
  createUniqueFile,
  writeUnique,
  createUniqueDir,
  resolveOutputDir,
  friendlyMessage,
  baseNameWithoutExt,
  extOf,
  makeTempDir,
  rmrf,
};
