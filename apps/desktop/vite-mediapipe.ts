import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
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
 * Copied into `public/` rather than committed there. Twelve megabytes of
 * generated binary in git is twelve megabytes in every clone and every diff, of
 * a file nobody will ever read, that has to be re-downloaded to update the
 * dependency anyway. `public/mediapipe/` is in `.gitignore` and this rebuilds
 * it from `node_modules` whenever it is missing or stale.
 *
 * Copied rather than emitted through Rollup for the same reason it is not a
 * dependency of any module: it is fetched by URL at runtime by MediaPipe's own
 * loader, not imported. Landing it in `public/` means Vite serves it in
 * development and copies it into `dist/` on a build, with no second code path
 * for either.
 *
 * **SIMD only.** The package also carries a `nosimd` build, twice as much again,
 * for browsers without WebAssembly SIMD - which means before Chrome 91 and
 * Firefox 89, neither of which can run the rest of this application. Where the
 * loader asks for the nosimd files it gets a 404, the segmenter fails to start,
 * and the portrait blur reports itself unavailable, which is the same answer
 * that browser gets for every other reason.
 */
const FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];

export function mediapipeAssets(): Plugin {
  return {
    name: 'betweenus:mediapipe-assets',
    // Before anything is served or built, and in both modes: the dev server
    // reads `public/` off disk on request, so staging at config time would be
    // one restart away from being wrong.
    buildStart() {
      const require = createRequire(import.meta.url);
      const here = dirname(fileURLToPath(import.meta.url));
      const target = join(here, 'public', 'mediapipe');

      let source: string;
      try {
        // Resolved through the main entry rather than `package.json`: the
        // package declares an `exports` map that does not list its own manifest,
        // so asking for it directly is `ERR_PACKAGE_PATH_NOT_EXPORTED`. The
        // bundle sits at the package root, so its directory is the root.
        source = dirname(require.resolve('@mediapipe/tasks-vision'));
      } catch {
        // The dependency is not installed. Say so once rather than failing the
        // build: everything except the portrait blur still works without it.
        this.warn('@mediapipe/tasks-vision is not installed; the portrait blur will be unavailable');
        return;
      }

      mkdirSync(target, { recursive: true });
      for (const file of FILES) {
        const from = join(source, 'wasm', file);
        const to = join(target, file);
        if (!existsSync(from)) continue;
        // Size rather than a hash: these are release artefacts of a pinned
        // version, so they change when the version does and not otherwise, and
        // hashing 12 MB on every start to learn that costs more than it saves.
        if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
        copyFileSync(from, to);
      }
    },
  };
}
