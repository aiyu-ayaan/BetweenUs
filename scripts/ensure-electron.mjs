import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);

function getPlatformExecutable() {
  const platform = process.env.npm_config_platform || os.platform();
  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

function findElectronDirectories() {
  const repoRoot = fileURLToPath(new URL('../', import.meta.url));
  const candidatePaths = [
    path.join(repoRoot, 'node_modules', 'electron'),
    path.join(repoRoot, 'apps', 'desktop', 'node_modules', 'electron'),
  ];

  const dirs = new Set();
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      try {
        const real = fs.realpathSync(candidate);
        dirs.add(real);
      } catch {
        dirs.add(candidate);
      }
    }
  }

  try {
    const resolved = require.resolve('electron/package.json', {
      paths: [repoRoot, path.join(repoRoot, 'apps/desktop')],
    });
    dirs.add(path.dirname(resolved));
  } catch {}

  return Array.from(dirs);
}

function extractZip(zipPath, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  // Try tar first (available on modern Windows 10+, macOS, Linux)
  try {
    execFileSync('tar', ['-xf', zipPath, '-C', targetDir], { stdio: 'ignore' });
    return;
  } catch {}

  // On Windows, fallback to PowerShell Expand-Archive
  if (os.platform() === 'win32') {
    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`,
        ],
        { stdio: 'ignore' },
      );
      return;
    } catch {}
  }

  // On Unix, fallback to unzip
  try {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', targetDir], {
      stdio: 'ignore',
    });
    return;
  } catch {}

  throw new Error(
    `Failed to extract ${zipPath} into ${targetDir}. Please ensure tar, powershell, or unzip is available.`,
  );
}

async function ensureElectronDir(electronDir) {
  const pkgPath = path.join(electronDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const version = pkg.version;
  const platformExecutable = getPlatformExecutable();
  const pathFilePath = path.join(electronDir, 'path.txt');
  const distDir = path.join(electronDir, 'dist');
  const executablePath = path.join(distDir, platformExecutable);

  const isReady =
    fs.existsSync(pathFilePath) &&
    fs.readFileSync(pathFilePath, 'utf-8').trim() === platformExecutable &&
    fs.existsSync(executablePath);

  if (isReady) {
    return;
  }

  console.log(`[ensure-electron] Setting up Electron v${version} in ${electronDir}...`);

  const { downloadArtifact } = require('@electron/get');
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    force: false,
    platform: process.env.npm_config_platform || os.platform(),
    arch: process.env.npm_config_arch || os.arch(),
  });

  console.log(`[ensure-electron] Extracting ${zipPath} -> ${distDir}`);
  extractZip(zipPath, distDir);

  fs.writeFileSync(pathFilePath, platformExecutable, 'utf-8');

  const srcTypeDefPath = path.join(distDir, 'electron.d.ts');
  const targetTypeDefPath = path.join(electronDir, 'electron.d.ts');
  if (fs.existsSync(srcTypeDefPath) && !fs.existsSync(targetTypeDefPath)) {
    try {
      fs.copyFileSync(srcTypeDefPath, targetTypeDefPath);
    } catch {}
  }

  if (!fs.existsSync(executablePath)) {
    throw new Error(
      `[ensure-electron] Verification failed: ${executablePath} does not exist after extraction.`,
    );
  }

  console.log(`[ensure-electron] Electron v${version} configured successfully.`);
}

async function main() {
  const dirs = findElectronDirectories();
  if (dirs.length === 0) {
    console.log('[ensure-electron] No electron installation found in node_modules.');
    return;
  }

  for (const dir of dirs) {
    await ensureElectronDir(dir);
  }
}

main().catch((err) => {
  console.error('[ensure-electron] Error:', err);
  process.exit(1);
});
