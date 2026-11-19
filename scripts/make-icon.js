'use strict';
// Draws the app icon (build/icon.png, 1024x1024). electron-builder turns it into .icns and .ico.
const sharp = require('sharp');
const path = require('path');
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5b8cff"/><stop offset="1" stop-color="#2d56d9"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#g)"/>
  <g fill="none" stroke="#fff" stroke-width="64" stroke-linecap="round" stroke-linejoin="round">
    <path d="M300 420h360"/><path d="M570 330l90 90-90 90"/>
    <path d="M724 604H364"/><path d="M454 514l-90 90 90 90"/>
  </g>
</svg>`;
sharp(Buffer.from(svg)).png().toFile(path.join(__dirname, '..', 'build', 'icon.png')).then(() => console.log('icon written'));
