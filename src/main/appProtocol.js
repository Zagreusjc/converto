'use strict';
/**
 * A tiny private scheme (converto-app://) used only by our hidden helper
 * windows to load bundled files (pdf.js, its fonts and decoders). It can only
 * ever serve files from inside the app, never from the network or user disk.
 */
const path = require('path');
const fs = require('fs');
const { protocol } = require('electron');

const SCHEME = 'converto-app';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};

function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

function roots() {
  const appPath = path.join(__dirname, '..', '..'); // project root (or app.asar when packaged)
  return {
    pdfjs: path.join(appPath, 'node_modules', 'pdfjs-dist'),
    render: path.join(appPath, 'src', 'render'),
  };
}

function handleScheme(session) {
  const table = roots();
  session.protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      // One host ("app") so every file is same-origin; the first path segment picks the folder.
      const [, first, ...rest] = decodeURIComponent(url.pathname).split('/');
      const root = url.hostname === 'app' ? table[first] : null;
      if (!root) return new Response('Not found', { status: 404 });
      const rel = rest.join('/');
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      const data = await fs.promises.readFile(file);
      return new Response(data, {
        headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

module.exports = { SCHEME, registerScheme, handleScheme };
