import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Stages MediaPipe's WebAssembly beside the app, so nothing is fetched from a CDN.
 *
 * The portrait blur needs a segmentation model, and a model needs a runtime:
 * about 12 MB of `.wasm` that ships inside `@mediapipe/tasks-vision`. Google's
 * own instructions load it from `cdn.jsdelivr.net`, which is remote code
 * executing in this window - exactly what `script-src 'self'` in `index.html`
 * exists to refuse, and the same rule that stopped Listen Together loading
 * YouTube's iframe API. So it is served from this origin instead.
 *
 * Copied into `public/` rather than committed there. Generated binaries in git
 * add megabytes to every clone and diff. `public/mediapipe/` is in `.gitignore`
 * and this rebuilds it from `node_modules` whenever it is missing or stale.
 */
const FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

export function mediapipeAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const here = dirname(fileURLToPath(import.meta.url));
  const target = join(here, 'public', 'mediapipe');

  function stageFiles(warn?: (msg: string) => void): void {
    let source: string;
    try {
      source = dirname(require.resolve('@mediapipe/tasks-vision'));
    } catch {
      warn?.('@mediapipe/tasks-vision is not installed; the portrait blur will be unavailable');
      return;
    }

    mkdirSync(target, { recursive: true });
    for (const file of FILES) {
      const from = join(source, 'wasm', file);
      const to = join(target, file);
      if (!existsSync(from)) continue;

      let content = readFileSync(from);
      // For non-module loader scripts, ensure globalThis.ModuleFactory is exposed so that
      // dynamic import() in module workers succeeds without "ModuleFactory not set".
      if (file === 'vision_wasm_internal.js' || file === 'vision_wasm_nosimd_internal.js') {
        const text = content.toString('utf8');
        if (!text.includes('globalThis.ModuleFactory')) {
          content = Buffer.from(
            text +
              '\nif (typeof ModuleFactory !== "undefined") { globalThis.ModuleFactory = ModuleFactory; self.ModuleFactory = ModuleFactory; }\n',
            'utf8',
          );
        }
      }

      if (existsSync(to) && statSync(to).size === content.length) continue;
      writeFileSync(to, content);
    }
  }

  return {
    name: 'betweenus:mediapipe-assets',
    buildStart() {
      stageFiles((msg) => this.warn(msg));
    },
    configureServer(server) {
      // Ensure files are staged when the dev server starts up
      stageFiles();

      // Intercept /mediapipe/ requests in the dev server before Vite's transform middleware,
      // so Vite does not reject them with "This file is in /public and will be copied as-is...".
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url?.split('?')[0] ?? '';
        if (rawUrl.startsWith('/mediapipe/')) {
          const filename = rawUrl.slice('/mediapipe/'.length);
          const filePath = join(target, filename);
          if (existsSync(filePath)) {
            const ext = extname(filePath);
            if (ext === '.js' || ext === '.mjs') {
              res.setHeader('Content-Type', 'application/javascript');
            } else if (ext === '.wasm') {
              res.setHeader('Content-Type', 'application/wasm');
            }
            res.setHeader('Cache-Control', 'no-cache');
            res.end(readFileSync(filePath));
            return;
          }
        }
        next();
      });
    },
  };
}
