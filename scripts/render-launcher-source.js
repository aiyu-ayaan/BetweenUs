/**
 * Render a standalone 1024x1024 PNG of the BetweenUs launcher icon
 * (accent gradient background + white mark foreground) so Android Studio's
 * Image Asset wizard can consume it as a plain image file.
 *
 *   node scripts/render-launcher-source.js
 *
 * Output: apps/android/ic_launcher_source.png
 */
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const vector = fs.readFileSync(
  path.join(__dirname, '../apps/android/ui-common/src/main/res/drawable/ic_betweenus_logo.xml'),
  'utf8',
);
const paths = [...vector.matchAll(/android:pathData="([^"]+)"/g)].map((m) => m[1]);
if (paths.length !== 2) throw new Error(`expected 2 paths, got ${paths.length}`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#8C6FFF"/>
      <stop offset="0.5" stop-color="#7C5CFF"/>
      <stop offset="1" stop-color="#5B3FE0"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <path d="${paths[0]}" fill="#FFFFFF"/>
  <path d="${paths[1]}" fill="#FFFFFF" fill-opacity="0.92"/>
</svg>`;

const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
const out = path.join(__dirname, '../apps/android/ic_launcher_source.png');
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
