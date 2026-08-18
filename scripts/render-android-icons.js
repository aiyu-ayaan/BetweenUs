/**
 * The Android launcher icons, rendered from the same mark as everything else.
 *
 * API 26 and up draw the adaptive icon in
 * `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`, which is a vector and
 * needs nothing from this script. Everything older draws a raster from the
 * density buckets, and `minSdk` is 24 - so those two Android versions are the
 * reason this file exists.
 *
 * Written rather than hand-exported so the icon cannot drift from the mark:
 * the SVG here is composed from the same path data the app draws, on the same
 * accent gradient the adaptive background uses.
 *
 *   node scripts/render-android-icons.js
 *
 * `resvg` is already a devDependency of the desktop client, which renders its
 * own icon the same way - see scripts/render-icon-png.js.
 */
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

/** The mark, lifted out of the shared Android vector so there is one copy. */
function markPaths() {
  const vector = fs.readFileSync(
    path.join(__dirname, '../apps/android/ui-common/src/main/res/drawable/ic_betweenus_logo.xml'),
    'utf8',
  );
  const found = [...vector.matchAll(/android:pathData="([^"]+)"/g)].map((match) => match[1]);
  if (found.length !== 2) throw new Error(`expected two paths in the mark, found ${found.length}`);
  return found;
}

/**
 * One icon as an SVG string.
 *
 * `rounded` is the second icon Android asks for: the same art pre-masked into a
 * circle, for launchers that do not mask it themselves. Both are drawn here
 * rather than only the square one, because a launcher that wants the round one
 * and finds the square one shows a square inside a circle.
 */
function icon(paths, { rounded }) {
  const clip = rounded
    ? '<clipPath id="mask"><circle cx="512" cy="512" r="512"/></clipPath>'
    : '<clipPath id="mask"><rect x="0" y="0" width="1024" height="1024" rx="220"/></clipPath>';

  // The same two thirds the adaptive foreground uses, so the two versions of
  // the icon are the same picture at the same size.
  const scale = 0.66;
  const offset = 512 - 512 * scale;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    ${clip}
    <linearGradient id="accent" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#8C6FFF"/>
      <stop offset="0.5" stop-color="#7C5CFF"/>
      <stop offset="1" stop-color="#5B3FE0"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#mask)">
    <rect width="1024" height="1024" fill="url(#accent)"/>
    <g transform="translate(${offset} ${offset}) scale(${scale})">
      <path d="${paths[0]}" fill="#FFFFFF"/>
      <path d="${paths[1]}" fill="#FFFFFF" fill-opacity="0.92"/>
    </g>
  </g>
</svg>`;
}

/** The density buckets Android asks for, and the pixel size of each. */
const DENSITIES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

function main() {
  const paths = markPaths();
  const res = path.join(__dirname, '../apps/android/app/src/main/res');

  for (const [bucket, size] of Object.entries(DENSITIES)) {
    const directory = path.join(res, bucket);
    fs.mkdirSync(directory, { recursive: true });

    for (const rounded of [false, true]) {
      const svg = icon(paths, { rounded });
      const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
      const name = rounded ? 'ic_launcher_round.png' : 'ic_launcher.png';
      fs.writeFileSync(path.join(directory, name), png);

      // The template's WebP files sit under the same names. Two files that
      // resolve to one resource is a build error, so the one being replaced
      // goes with it.
      const stale = path.join(directory, name.replace(/\.png$/, '.webp'));
      if (fs.existsSync(stale)) fs.unlinkSync(stale);
    }
    console.log(`${bucket}: ${size}px`);
  }
}

main();
