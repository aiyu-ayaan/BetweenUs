#!/usr/bin/env node
/**
 * Programmatic screenshot generation script for BetweenUs visual assets.
 * Renders high-resolution HTML templates to pixel-perfect screenshots using headless Chrome.
 *
 * Usage:
 *   node scripts/generate-screenshots.mjs --target home
 *   node scripts/generate-screenshots.mjs --target android
 *   node scripts/generate-screenshots.mjs --target features
 *   node scripts/generate-screenshots.mjs --target all
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const PICTURES_DIR = path.join(REPO_ROOT, 'pictures');
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// Ensure output directories exist
fs.mkdirSync(PICTURES_DIR, { recursive: true });
fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

/**
 * Locate Chrome headless executable.
 */
function findChromeExecutable() {
  const candidates = [
    'C:\\Users\\ROOT\\.cache\\hyperframes\\chrome\\chrome-headless-shell\\win64-152.0.7977.30\\chrome-headless-shell-win64\\chrome-headless-shell.exe',
    path.join(process.env.USERPROFILE || '', '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell', 'win64-152.0.7977.30', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback: search hyperframes cache dir dynamically
  const cacheBase = path.join(process.env.USERPROFILE || '', '.cache', 'hyperframes', 'chrome');
  if (fs.existsSync(cacheBase)) {
    const findBinary = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = findBinary(full);
          if (found) return found;
        } else if (entry.name === 'chrome-headless-shell.exe' || entry.name === 'chrome.exe') {
          return full;
        }
      }
      return null;
    };
    const found = findBinary(cacheBase);
    if (found) return found;
  }

  throw new Error('Could not locate chrome-headless-shell or Chrome executable on system.');
}

/**
 * Render an HTML file to an image using headless Chrome.
 */
function renderScreenshot({ htmlPath, outputPath, width, height }) {
  const chromePath = findChromeExecutable();
  const fileUrl = pathToFileURL(htmlPath).href;

  console.log(`[screenshot] Rendering ${path.basename(outputPath)} (${width}x${height})...`);

  const args = [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--run-all-compositor-stages-before-draw',
    `--window-size=${width},${height}`,
    `--screenshot=${outputPath}`,
    fileUrl,
  ];

  const result = spawnSync(chromePath, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Chrome process exited with code ${result.status}`);
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Failed to generate screenshot at ${outputPath}`);
  }

  const stat = fs.statSync(outputPath);
  console.log(`[screenshot] Wrote ${stat.size} bytes to ${outputPath}`);

  // Probe resolution
  try {
    const probe = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${outputPath}"`,
      { encoding: 'utf8' }
    ).trim();
    console.log(`[screenshot] Verified dimensions: ${probe} (expected ${width},${height})`);
  } catch (err) {
    console.warn(`[screenshot] ffprobe check warning: ${err.message}`);
  }

  return { path: outputPath, size: stat.size };
}

/**
 * Targets specification
 */
const TARGETS = {
  home: () => {
    const htmlPath = path.join(TEMPLATES_DIR, 'workbench.html');
    const outputPath = path.join(PICTURES_DIR, 'home.png');
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`Template not found at ${htmlPath}`);
    }
    return renderScreenshot({
      htmlPath,
      outputPath,
      width: 2560,
      height: 1440,
    });
  },
  android: () => {
    const htmlPath = path.join(TEMPLATES_DIR, 'android.html');
    const outputPath = path.join(PICTURES_DIR, 'home-android.png');
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`Template not found at ${htmlPath}`);
    }
    return renderScreenshot({
      htmlPath,
      outputPath,
      width: 1080,
      height: 2400,
    });
  },
  voice: () => {
    const htmlPath = path.join(TEMPLATES_DIR, 'voice-listen-play.html');
    const outputPath = path.join(PICTURES_DIR, 'voice-listen-play.png');
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`Template not found at ${htmlPath}`);
    }
    return renderScreenshot({
      htmlPath,
      outputPath,
      width: 2560,
      height: 1440,
    });
  },
  moments: () => {
    const htmlPath = path.join(TEMPLATES_DIR, 'moments-viewer.html');
    const outputPath = path.join(PICTURES_DIR, 'moments-viewer.png');
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`Template not found at ${htmlPath}`);
    }
    return renderScreenshot({
      htmlPath,
      outputPath,
      width: 1080,
      height: 1920,
    });
  },
  remote: () => {
    const htmlPath = path.join(TEMPLATES_DIR, 'remote-desktop.html');
    const outputPath = path.join(PICTURES_DIR, 'remote-desktop.png');
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`Template not found at ${htmlPath}`);
    }
    return renderScreenshot({
      htmlPath,
      outputPath,
      width: 2560,
      height: 1440,
    });
  },
  features: async () => {
    console.log('[screenshot] Rendering all feature deep-dive screenshots...');
    const results = [];
    results.push(await TARGETS.voice());
    results.push(await TARGETS.moments());
    results.push(await TARGETS.remote());
    return results;
  },
};

// CLI Parser
async function main() {
  const args = process.argv.slice(2);
  let target = 'home';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      target = args[i + 1].toLowerCase();
      i++;
    } else if (args[i].startsWith('--target=')) {
      target = args[i].split('=')[1].toLowerCase();
    }
  }

  console.log(`[screenshot] Starting screenshot generation for target: "${target}"`);

  if (target === 'all') {
    await TARGETS.home();
    await TARGETS.android();
    await TARGETS.voice();
    await TARGETS.moments();
    await TARGETS.remote();
  } else if (TARGETS[target]) {
    await TARGETS[target]();
  } else {
    console.error(`Unknown target "${target}". Valid targets: ${Object.keys(TARGETS).join(', ')}, all`);
    process.exit(1);
  }

  console.log('[screenshot] Completed successfully.');
}

main().catch((err) => {
  console.error('[screenshot] Error:', err);
  process.exit(1);
});
