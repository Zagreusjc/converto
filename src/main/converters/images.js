'use strict';
const fs = require('fs');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { FriendlyError, writeUnique, createUniqueDir, baseNameWithoutExt, extOf } = require('../util');
const { stripJpeg, stripPdf } = require('../metadata');

sharp.cache(false); // do not hold on to input files (matters for batches and for file locking on Windows)

/** Read any supported image file into a sharp pipeline. */
async function openImage(inputPath, { animated = false } = {}) {
  const ext = extOf(inputPath);
  const buf = await fs.promises.readFile(inputPath);
  return openImageBuffer(buf, ext, { animated });
}

async function openImageBuffer(buf, ext, { animated = false } = {}) {
  if (ext === 'heic' || ext === 'heif') {
    const decode = require('heic-decode');
    let img;
    try {
      img = await decode({ buffer: buf });
    } catch (e) {
      throw new FriendlyError('This HEIC photo could not be read. It may use a newer variant that is not supported yet.');
    }
    return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
      raw: { width: img.width, height: img.height, channels: 4 },
    });
  }
  if (ext === 'ico') {
    const decodeIco = require('decode-ico');
    const icons = decodeIco(buf);
    if (!icons.length) throw new FriendlyError('This icon file is empty.');
    const best = icons.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    if (best.type === 'png') return sharp(Buffer.from(best.data));
    return sharp(Buffer.from(best.data.buffer, best.data.byteOffset, best.data.byteLength), {
      raw: { width: best.width, height: best.height, channels: 4 },
    });
  }
  if (ext === 'bmp') {
    const bmp = require('bmp-js');
    const d = bmp.decode(buf); // pixels come back as A,B,G,R
    const rgba = Buffer.alloc(d.width * d.height * 4);
    for (let i = 0; i < d.width * d.height; i++) {
      const o = i * 4;
      rgba[o] = d.data[o + 3];
      rgba[o + 1] = d.data[o + 2];
      rgba[o + 2] = d.data[o + 1];
      // Many BMP writers leave the 4th byte at 0 for 24/32-bit files without real alpha.
      rgba[o + 3] = d.bitPP === 32 && d.is_with_alpha ? d.data[o] : 255;
    }
    return sharp(rgba, { raw: { width: d.width, height: d.height, channels: 4 } });
  }
  return sharp(buf, { failOn: 'none', animated });
}

/** Simple 24-bit BMP writer (BMP has no real alpha support in the wild). */
function encodeBmp(rgb, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const out = Buffer.alloc(54 + rowSize * height);
  out.write('BM', 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(rowSize * height, 34);
  out.writeInt32LE(2835, 38);
  out.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 3; // BMP is stored bottom-up
    let o = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 3;
      out[o++] = rgb[s + 2];
      out[o++] = rgb[s + 1];
      out[o++] = rgb[s];
    }
  }
  return out;
}

/** ICO container with PNG-compressed images of several sizes (works on every modern OS). */
async function encodeIco(pipeline) {
  const base = await pipeline.clone().png().toBuffer();
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) {
    const png = await sharp(base)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    images.push({ size, png });
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const o = i * 16;
    dir[o] = img.size === 256 ? 0 : img.size;
    dir[o + 1] = img.size === 256 ? 0 : img.size;
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(img.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += img.png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

const WHITE = { r: 255, g: 255, b: 255 };

/**
 * Turn an opened image into the bytes of a target format.
 * `animated` pipelines (gif/webp) keep their frames when the target supports it.
 */
async function encodeImage(pipeline, target, { strip }) {
  let img = pipeline.autoOrient();
  if (!strip) img = img.keepMetadata();
  switch (target) {
    case 'jpg':
      return img.flatten({ background: WHITE }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    case 'png':
      return img.png({ compressionLevel: 6 }).toBuffer();
    case 'webp':
      return img.webp({ quality: 90 }).toBuffer();
    case 'gif':
      return img.gif().toBuffer();
    case 'tiff':
      return img.tiff({ compression: 'lzw' }).toBuffer();
    case 'bmp': {
      const { data, info } = await img
        .flatten({ background: WHITE })
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
      return encodeBmp(data, info.width, info.height);
    }
    case 'ico':
      return encodeIco(img);
    default:
      throw new FriendlyError(`Converting to ${target.toUpperCase()} is not supported for images.`);
  }
}

const EXT_FOR = { jpg: '.jpg', png: '.png', webp: '.webp', gif: '.gif', tiff: '.tiff', bmp: '.bmp', ico: '.ico', pdf: '.pdf' };

/** Convert one image file to another image format or to PDF. */
async function convertImage(inputPath, target, ctx) {
  const base = baseNameWithoutExt(inputPath);
  if (target === 'pdf') {
    const pdf = await imageFileToPdf(inputPath, ctx);
    const out = await writeUnique(ctx.outDir, base, '.pdf', pdf);
    return { outputs: [out] };
  }
  const srcExt = extOf(inputPath);
  const keepFrames = (srcExt === 'gif' || srcExt === 'webp') && (target === 'gif' || target === 'webp');
  const pipeline = await openImage(inputPath, { animated: keepFrames });
  const buf = await encodeImage(pipeline, target, ctx);
  const out = await writeUnique(ctx.outDir, base, EXT_FOR[target], buf);
  return { outputs: [out] };
}

/** Choose a page size that fits the picture (long side of an A4 sheet) so nothing is cut off or stretched. */
function pageSizeFor(w, h) {
  const LONG = 842; // points, A4 long side
  const scale = LONG / Math.max(w, h);
  return [Math.max(72, w * scale), Math.max(72, h * scale)];
}

/** pdf-lib reads `.buffer` directly, so hand it a copy that owns its whole ArrayBuffer (Node Buffers can be slices of a shared pool). */
const standalone = (buf) => new Uint8Array(buf);

async function imageBufferToPdfDoc(doc, buf, ext, strip) {
  let embedded;
  let w, h;
  const meta = await sharp(buf, { failOn: 'none' }).metadata().catch(() => ({}));
  const needsRotate = meta.orientation && meta.orientation > 1;
  if ((ext === 'jpg' || ext === 'jpeg') && !needsRotate && meta.space !== 'cmyk') {
    // Keep the original JPEG bytes (no quality loss); drop EXIF/GPS when asked to.
    embedded = await doc.embedJpg(standalone(strip ? stripJpeg(buf) : buf));
  } else {
    const pipeline = await openImageBuffer(buf, ext);
    const png = await pipeline.autoOrient().toColourspace('srgb').png().toBuffer();
    embedded = await doc.embedPng(standalone(png));
  }
  w = embedded.width;
  h = embedded.height;
  const [pw, ph] = pageSizeFor(w, h);
  const page = doc.addPage([pw, ph]);
  page.drawImage(embedded, { x: 0, y: 0, width: pw, height: ph });
}

async function imageFileToPdf(inputPath, ctx) {
  const ext = extOf(inputPath);
  let buf = await fs.promises.readFile(inputPath);
  const doc = await PDFDocument.create();
  doc.setCreator('');
  doc.setProducer(ctx.strip ? '' : 'Converto');
  if (ext === 'gif' || ext === 'tiff' || ext === 'tif') {
    // Multi-frame files: one PDF page per frame.
    const meta = await sharp(buf, { failOn: 'none', pages: -1 }).metadata();
    const pages = meta.pages || 1;
    if (pages > 1 && pages <= 500) {
      for (let p = 0; p < pages; p++) {
        const png = await sharp(buf, { failOn: 'none', page: p }).autoOrient().png().toBuffer();
        await imageBufferToPdfDoc(doc, png, 'png', ctx.strip);
      }
      return finishPdf(doc, ctx);
    }
  }
  await imageBufferToPdfDoc(doc, buf, ext, ctx.strip);
  return finishPdf(doc, ctx);
}

async function finishPdf(doc, ctx) {
  const bytes = Buffer.from(await doc.save());
  return ctx.strip ? stripPdf(bytes) : bytes;
}

/** PDF -> one image per page. Multi-page documents go into their own folder. */
async function convertPdfToImage(inputPath, target, ctx) {
  const { renderPdfPages } = require('../pdfRender');
  const base = baseNameWithoutExt(inputPath);
  const bytes = await fs.promises.readFile(inputPath);
  let folder = null;
  let pageCount = 0;
  const outputs = [];
  // Write each page as soon as it arrives so big PDFs don't pile up in memory.
  await renderPdfPages(bytes, async (index, total, png) => {
    pageCount++;
    await writePage(index, total, png);
  });

  async function writePage(index, total, png) {
    const buf = await encodeImage(sharp(png), target, { strip: true });
    if (total === 1) {
      outputs.push(await writeUnique(ctx.outDir, base, EXT_FOR[target], buf));
      return;
    }
    if (!folder) folder = await createUniqueDir(ctx.outDir, base);
    const pad = String(total).length;
    const name = `${base} - page ${String(index + 1).padStart(pad, '0')}`;
    outputs.push(await writeUnique(folder, name, EXT_FOR[target], buf));
  }
  if (!pageCount) throw new FriendlyError('This PDF has no pages to convert.');
  return { outputs, revealPath: folder || outputs[0] };
}

module.exports = {
  convertImage,
  convertPdfToImage,
  openImageBuffer,
  encodeImage,
};
