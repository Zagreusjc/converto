// Runs inside a hidden window. Renders PDF pages to PNG using the bundled pdf.js.
import * as pdfjs from 'converto-app://app/pdfjs/build/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = 'converto-app://app/pdfjs/build/pdf.worker.mjs';

const MAX_SIDE = 12000; // pixels; keeps huge posters from running out of memory

window.renderPdf = async function renderPdf(jobId) {
  try {
    const bytes = await window.pdfBridge.getBytes(jobId);
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      cMapUrl: 'converto-app://app/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'converto-app://app/pdfjs/standard_fonts/',
      wasmUrl: 'converto-app://app/pdfjs/wasm/',
      iccUrl: 'converto-app://app/pdfjs/iccs/',
      isEvalSupported: false,
    });
    const doc = await loadingTask.promise;
    const total = doc.numPages;
    for (let n = 1; n <= total; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, MAX_SIDE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({ canvas, viewport, background: 'rgb(255,255,255)' }).promise;
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      const png = new Uint8Array(await blob.arrayBuffer());
      await window.pdfBridge.sendPage(jobId, n - 1, total, png);
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
    await loadingTask.destroy();
    return { ok: true, pages: total };
  } catch (e) {
    const name = (e && e.name) || '';
    return { ok: false, name, message: String((e && e.message) || e) };
  }
};
window.pdfReady = true;
