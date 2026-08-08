const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(() => {
  try {
    const svgPath = path.join(__dirname, '../apps/desktop/public/icon.svg');
    const pngPath = path.join(__dirname, '../apps/desktop/public/icon.png');
    const buildIconPath = path.join(__dirname, '../apps/desktop/build/icon.png');

    if (!fs.existsSync(svgPath)) {
      console.error('SVG file not found at:', svgPath);
      process.exit(1);
    }

    const image = nativeImage.createFromPath(svgPath);
    const pngBuffer = image.resize({ width: 512, height: 512 }).toPNG();

    fs.writeFileSync(pngPath, pngBuffer);
    console.log('Saved PNG icon to:', pngPath);

    const buildDir = path.dirname(buildIconPath);
    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir, { recursive: true });
    }
    fs.writeFileSync(buildIconPath, pngBuffer);
    console.log('Saved PNG icon to:', buildIconPath);

    // Generate 32x32 tray icon base64
    const trayBuffer = image.resize({ width: 32, height: 32 }).toPNG();
    const base64Tray = 'data:image/png;base64,' + trayBuffer.toString('base64');
    console.log('TRAY_ICON_BASE64_START');
    console.log(base64Tray);
    console.log('TRAY_ICON_BASE64_END');

    process.exit(0);
  } catch (err) {
    console.error('Error generating icon:', err);
    process.exit(1);
  }
});
