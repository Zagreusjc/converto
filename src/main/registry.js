'use strict';
/**
 * The single place that says what can become what.
 * Adding a format = add it here and add a converter module.
 */
const { extOf } = require('./util');

const ALIASES = {
  jpeg: 'jpg', jpe: 'jpg', tif: 'tiff', heif: 'heic', htm: 'html', markdown: 'md', mkd: 'md', yml: 'yaml',
};

const normalizeExt = (ext) => ALIASES[ext] || ext;

// Order here decides the order of the big buttons.
const TARGET_ORDER = [
  'pdf', 'docx', 'html', 'md', 'py', 'epub', 'txt',
  'jpg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'ico',
];

const LABELS = {
  pdf: 'PDF', docx: 'DOCX', html: 'HTML', md: 'MD', py: 'PY', epub: 'EPUB', txt: 'TXT',
  jpg: 'JPG', png: 'PNG', webp: 'WEBP', gif: 'GIF', bmp: 'BMP', tiff: 'TIFF', ico: 'ICO',
};

const IMAGE_EXTS = ['jpg', 'png', 'webp', 'heic', 'gif', 'bmp', 'tiff', 'ico'];
const IMAGE_TARGETS = ['pdf', 'jpg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'ico'];

/** category -> { inputs, targets(ext), run } */
const CATEGORIES = [
  {
    id: 'image',
    inputs: IMAGE_EXTS,
    targets: (ext) => IMAGE_TARGETS.filter((t) => t !== ext),
    run: (...a) => require('./converters/images').convertImage(...a),
  },
  {
    id: 'pdf-to-image',
    inputs: ['pdf'],
    targets: () => ['png', 'jpg', 'webp', 'tiff'],
    run: (...a) => require('./converters/images').convertPdfToImage(...a),
  },
  {
    id: 'notebook',
    inputs: ['ipynb'],
    targets: () => ['pdf', 'html', 'py', 'md'],
    run: (...a) => require('./converters/notebook').convertNotebook(...a),
  },
];

function categoryFor(ext) {
  return CATEGORIES.find((c) => c.inputs.includes(ext));
}

function describe(filePath) {
  const ext = normalizeExt(extOf(filePath));
  const cat = categoryFor(ext);
  if (!cat) return null;
  const ids = new Set(cat.targets(ext));
  const targets = TARGET_ORDER.filter((t) => ids.has(t)).map((id) => ({ id, label: LABELS[id] }));
  return { ext, targets };
}

async function runConversion(filePath, target, ctx) {
  const ext = normalizeExt(extOf(filePath));
  const cat = categoryFor(ext);
  if (!cat || !cat.targets(ext).includes(target)) {
    const { FriendlyError } = require('./util');
    throw new FriendlyError(`Converto cannot turn a .${ext} file into ${String(target).toUpperCase()}.`);
  }
  return cat.run(filePath, target, ctx);
}

const SUPPORTED_EXTS = () => CATEGORIES.flatMap((c) => c.inputs);

module.exports = { TARGET_ORDER, describe, runConversion, normalizeExt, LABELS, SUPPORTED_EXTS };
