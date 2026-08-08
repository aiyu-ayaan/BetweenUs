const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

try {
  const svgPath = path.join(__dirname, '../apps/desktop/public/icon.svg');
  const svgData = fs.readFileSync(svgPath, 'utf8');

  const resvg = new Resvg(svgData, {
    fitTo: {
      mode: 'width',
      value: 512,
    },
  });

  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  const targetPng = path.join(__dirname, '../apps/desktop/public/icon.png');
  const buildPng = path.join(__dirname, '../apps/desktop/build/icon.png');

  fs.mkdirSync(path.dirname(targetPng), { recursive: true });
  fs.mkdirSync(path.dirname(buildPng), { recursive: true });

  fs.writeFileSync(targetPng, pngBuffer);
  fs.writeFileSync(buildPng, pngBuffer);

  console.log('SUCCESS: Rendered high-res 512x512 PNG icon at', targetPng, 'Size:', pngBuffer.length, 'bytes');
} catch (err) {
  console.error('Error rendering SVG:', err);
  process.exit(1);
}
