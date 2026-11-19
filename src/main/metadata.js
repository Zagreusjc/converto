'use strict';
/**
 * Lossless metadata removal for files we embed or pass through without
 * re-encoding (JPEG, PNG, PDF).
 */
const { PDFDocument, PDFName, PDFRef } = require('pdf-lib');

/** Remove EXIF/GPS (APP1), IPTC (APP13), XMP and comments from a JPEG without recompressing. */
function stripJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    // Start of scan: the rest is entropy-coded image data.
    if (marker === 0xda) { out.push(buf.subarray(i)); i = buf.length; break; }
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i, i + 2 + len);
    // APP1 (EXIF, XMP), APP2 (ICC kept), APP12/13/14 (Ducky/IPTC/Adobe), COM
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xec || marker === 0xfe;
    if (!drop) out.push(seg);
    i += 2 + len;
  }
  if (i < buf.length) out.push(buf.subarray(i));
  return Buffer.concat(out);
}

/** Remove text, EXIF and timestamp chunks from a PNG (e.g. "Software", "Creation Time"). */
function stripPng(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(sig)) return buf;
  const drop = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);
  const out = [sig];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) { out.push(buf.subarray(i)); break; }
    if (!drop.has(type)) out.push(buf.subarray(i, end));
    i = end;
  }
  return Buffer.concat(out);
}

/** Remove document info (title, author, dates, producer) and XMP from a PDF. */
async function stripPdf(buf) {
  const doc = await PDFDocument.load(buf, { updateMetadata: false, ignoreEncryption: false });
  const ctx = doc.context;
  // Delete the objects themselves, not just the references, so nothing is left orphaned in the file.
  const infoRef = ctx.trailerInfo.Info;
  if (infoRef instanceof PDFRef) ctx.delete(infoRef);
  ctx.trailerInfo.Info = undefined;
  const metaRef = doc.catalog.get(PDFName.of('Metadata'));
  if (metaRef instanceof PDFRef) ctx.delete(metaRef);
  doc.catalog.delete(PDFName.of('Metadata'));
  return Buffer.from(await doc.save({ useObjectStreams: false, updateFieldAppearances: false }));
}

module.exports = { stripJpeg, stripPng, stripPdf };
