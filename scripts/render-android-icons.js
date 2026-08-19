/**
 * Render Android launcher icon PNGs directly from the desktop SVG
 * (apps/desktop/public/icon.svg) with #3730A2 background and 75% zoom.
 *
 *   node scripts/render-android-icons.js
 */
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const desktopSvg = fs.readFileSync(
  path.join(__dirname, '../apps/desktop/public/icon.svg'),
  'utf8',
);

// Extract the two path elements (headset pads + headband) from the desktop SVG
const pathMatches = [...desktopSvg.matchAll(/<path\s+d="([^"]+)"\s+fill="([^"]+)"\s*\/>/g)];
if (pathMatches.length !== 2) throw new Error(`expected 2 paths, got ${pathMatches.length}`);

function icon({ rounded }) {
  const clip = rounded
    ? '<clipPath id="mask"><circle cx="512" cy="512" r="512"/></clipPath>'
    : '<clipPath id="mask"><rect x="0" y="0" width="1024" height="1024" rx="220"/></clipPath>';

  const scale = 0.75;
  const offset = 512 - 512 * scale; // 128

  // Use the exact same gradients from the desktop SVG
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    ${clip}
    <linearGradient id="betweenusHeadset" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a78bfa" />
      <stop offset="100%" stop-color="#6c5ce7" />
    </linearGradient>
  </defs>
  <g clip-path="url(#mask)">
    <rect width="1024" height="1024" fill="#3730A2"/>
    <g transform="translate(${offset} ${offset}) scale(${scale})">
      <path d="${pathMatches[0][1]}" fill="url(#betweenusHeadset)"/>
      <path d="${pathMatches[1][1]}" fill="#ffffff"/>
    </g>
  </g>
</svg>`;
}

const DENSITIES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

function main() {
  const res = path.join(__dirname, '../apps/android/app/src/main/res');

  for (const [bucket, size] of Object.entries(DENSITIES)) {
    const directory = path.join(res, bucket);
    fs.mkdirSync(directory, { recursive: true });

    for (const rounded of [false, true]) {
      const svg = icon({ rounded });
      const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
      const name = rounded ? 'ic_launcher_round.png' : 'ic_launcher.png';
      fs.writeFileSync(path.join(directory, name), png);

      const stale = path.join(directory, name.replace(/\.png$/, '.webp'));
      if (fs.existsSync(stale)) fs.unlinkSync(stale);
    }
    console.log(`${bucket}: ${size}px`);
  }
}

main();
