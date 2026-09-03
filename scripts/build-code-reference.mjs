#!/usr/bin/env node
/**
 * build-code-reference.mjs
 * Indexes the entire BetweenUs repository: full file tree and complete source code files
 * with their doc comments and symbols for the interactive Code Reference explorer.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

function getLanguage(filePath) {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx': return 'typescript';
    case '.kt': return 'kotlin';
    case '.prisma': return 'prisma';
    case '.js':
    case '.mjs': return 'javascript';
    case '.json': return 'json';
    case '.yml':
    case '.yaml': return 'yaml';
    case '.md': return 'markdown';
    case '.sh': return 'bash';
    default: return 'text';
  }
}

function getPackageName(filePath) {
  if (filePath.startsWith('apps/services/')) {
    const parts = filePath.split('/');
    return `@betweenus/${parts[2]}`;
  }
  if (filePath.startsWith('apps/android/')) return '@betweenus/android';
  if (filePath.startsWith('apps/desktop/')) return '@betweenus/desktop';
  if (filePath.startsWith('apps/web/')) return '@betweenus/web';
  if (filePath.startsWith('packages/')) {
    const parts = filePath.split('/');
    return `@betweenus/${parts[1]}`;
  }
  if (filePath.startsWith('infrastructure/')) return 'infrastructure';
  if (filePath.startsWith('scripts/')) return 'scripts';
  return 'root';
}

const ignoredDirs = new Set([
  'node_modules', 'dist', 'build', '.git', '.turbo', '.gradle',
  'kspCaches', 'bin', 'obj', 'coverage', '.idea', '.vscode',
  '.system_generated', 'cache', '.agent', '.agents', '.claude',
  '.codegraph', 'storage-data', 'pictures'
]);

function scan(dir, list = []) {
  const abs = resolve(rootDir, dir);
  if (!existsSync(abs)) return list;
  const entries = readdirSync(abs, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!ignoredDirs.has(e.name) && !e.name.startsWith('.')) {
        scan(join(dir, e.name), list);
      }
    } else {
      const ext = extname(e.name).toLowerCase();
      if (['.ts', '.tsx', '.kt', '.prisma', '.mjs', '.js', '.json', '.yml', '.yaml', '.md'].includes(ext)) {
        if (
          !e.name.endsWith('.d.ts') &&
          !e.name.endsWith('.map') &&
          !e.name.endsWith('lock.yaml') &&
          !e.name.endsWith('lock.json') &&
          !e.name.includes('codeReferenceData') &&
          !e.name.endsWith('.svg') &&
          !e.name.endsWith('.png') &&
          !e.name.endsWith('.jpeg')
        ) {
          const rel = join(dir, e.name).replace(/\\/g, '/');
          const full = resolve(rootDir, rel);
          const stat = statSync(full);
          // Only index text files under 350KB
          if (stat.size < 350 * 1024) {
            list.push(rel);
          }
        }
      }
    }
  }
  return list;
}

function buildFileTree(files) {
  const root = {
    name: 'Betweenus',
    path: 'Betweenus',
    type: 'directory',
    children: [],
  };

  for (const f of files) {
    const segments = f.path.split('/');
    let current = root;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isFile = i === segments.length - 1;
      const subPath = 'Betweenus/' + segments.slice(0, i + 1).join('/');

      let existing = current.children.find((c) => c.name === seg);
      if (!existing) {
        existing = {
          name: seg,
          path: subPath,
          type: isFile ? 'file' : 'directory',
          ...(isFile
            ? {
                fileId: f.id,
                language: f.language,
                lineCount: f.lineCount,
                byteSize: f.byteSize,
              }
            : {
                children: [],
              }),
        };
        current.children.push(existing);
      }
      current = existing;
    }
  }

  // Sort directories first, then alphabetical
  function sortNode(node) {
    if (node.children) {
      node.children.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(sortNode);
    }
  }

  sortNode(root);
  return root;
}

export function buildCodeReference() {
  const filePaths = [];
  ['apps', 'packages', 'infrastructure', 'scripts'].forEach((d) => scan(d, filePaths));
  ['package.json', 'turbo.json', 'pnpm-workspace.yaml', 'README.md', 'CLAUDE.md', 'LICENSE'].forEach((f) => {
    if (existsSync(resolve(rootDir, f))) filePaths.push(f);
  });

  const filesResult = [];

  for (const relPath of filePaths) {
    const fullPath = resolve(rootDir, relPath);
    const code = readFileSync(fullPath, 'utf8');
    const lines = code.split('\n');
    const lang = getLanguage(relPath);
    const pkg = getPackageName(relPath);

    const symbols = [];
    let docCommentCount = 0;

    // Fast symbol and comment counting
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('/**') || trimmed.startsWith('///')) {
        docCommentCount++;
      }

      if (lang === 'typescript' || lang === 'javascript') {
        const tsMatch = line.match(/^export\s+(interface|type|class|enum|function|const)\s+([A-Za-z0-9_]+)/);
        if (tsMatch && symbols.length < 50) {
          symbols.push({ kind: tsMatch[1], name: tsMatch[2], lineNumber: idx + 1 });
        }
      } else if (lang === 'prisma') {
        const prismaMatch = line.match(/^(model|enum)\s+([A-Za-z0-9_]+)/);
        if (prismaMatch && symbols.length < 50) {
          symbols.push({ kind: prismaMatch[1], name: prismaMatch[2], lineNumber: idx + 1 });
        }
      } else if (lang === 'kotlin') {
        const ktMatch = line.match(/^(class|sealed\s+interface|interface|data\s+class|object|fun)\s+([A-Za-z0-9_]+)/);
        if (ktMatch && symbols.length < 50) {
          symbols.push({ kind: ktMatch[1], name: ktMatch[2], lineNumber: idx + 1 });
        }
      }
    });

    const fileId = relPath.replace(/[/.]/g, '-');

    filesResult.push({
      id: fileId,
      path: relPath,
      pkg,
      language: lang,
      lineCount: lines.length,
      byteSize: Buffer.byteLength(code, 'utf8'),
      code,
      symbols,
      docCommentCount,
    });
  }

  const fileTree = buildFileTree(filesResult);

  const payload = {
    generatedAt: new Date().toISOString(),
    totalFiles: filesResult.length,
    totalLines: filesResult.reduce((sum, f) => sum + f.lineCount, 0),
    fileTree,
    files: filesResult,
  };

  const outDir = resolve(rootDir, 'docs', 'src', 'data');
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const outPath = resolve(outDir, 'codeReferenceData.json');
  writeFileSync(outPath, JSON.stringify(payload), 'utf8');
  console.log(`[code-reference] Indexed FULL repository: ${filesResult.length} files (${payload.totalLines} lines) -> ${outPath}`);
}

buildCodeReference();
