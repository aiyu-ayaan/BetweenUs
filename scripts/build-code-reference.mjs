#!/usr/bin/env node
/**
 * build-code-reference.mjs
 * Extracts real codebase source files, builds a clean compact hierarchical file tree,
 * and extracts symbols and doc comments into a structured JSON for the docs.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const INDEXED_FILES = [
  // Packages: shared-types
  {
    path: 'packages/shared-types/src/index.ts',
    pkg: '@betweenus/shared-types',
    language: 'typescript',
    description: 'Universal shared TypeScript interfaces, DTOs, E2EE key models, WebSocket message frames, and JSDoc contracts.',
  },
  {
    path: 'packages/shared-types/src/games/carrom-physics.ts',
    pkg: '@betweenus/shared-types',
    language: 'typescript',
    description: 'Deterministic 2D rigid-body striker, coin collision, and pocket simulation engine.',
  },
  {
    path: 'packages/shared-types/src/games/carrom.ts',
    pkg: '@betweenus/shared-types',
    language: 'typescript',
    description: 'Carrom board game rules, foul logic, queen coverage, and turn state transition handler.',
  },
  {
    path: 'packages/shared-types/src/games/ludo.ts',
    pkg: '@betweenus/shared-types',
    language: 'typescript',
    description: 'Ludo 4-player token track, yard, safety zones, dice roll validation, and capture rules.',
  },
  {
    path: 'packages/shared-types/src/games/connect-four.ts',
    pkg: '@betweenus/shared-types',
    language: 'typescript',
    description: 'Connect Four column drop physics, gravity landing calculations, and 4-in-a-row victory detection.',
  },

  // Packages: database
  {
    path: 'packages/database/prisma/schema.prisma',
    pkg: '@betweenus/database',
    language: 'prisma',
    description: 'PostgreSQL database schema with 22 models, zero-knowledge columns, cascades, and field docstrings.',
  },

  // Apps: services - auth-service
  {
    path: 'apps/services/auth-service/src/modules/auth/auth.controller.ts',
    pkg: '@betweenus/auth-service',
    language: 'typescript',
    description: 'Authentication REST API controller handling register, login, token refresh, and account profile endpoints.',
  },
  {
    path: 'apps/services/auth-service/src/modules/auth/auth.service.ts',
    pkg: '@betweenus/auth-service',
    language: 'typescript',
    description: 'Authentication service managing argon2 password hashing, JWT minting, and rate limiting.',
  },

  // Apps: services - server-service
  {
    path: 'apps/services/server-service/src/modules/servers/servers.controller.ts',
    pkg: '@betweenus/server-service',
    language: 'typescript',
    description: 'Server workspace REST controller: workspace creation, channel provisioning, and custom role hierarchy.',
  },

  // Apps: services - chat-service
  {
    path: 'apps/services/chat-service/src/gateways/chat.gateway.ts',
    pkg: '@betweenus/chat-service',
    language: 'typescript',
    description: 'Real-time WebSocket chat gateway (/ws/chat) managing channel subscriptions, typing indicators, and fanout.',
  },
  {
    path: 'apps/services/chat-service/src/modules/messages/messages.controller.ts',
    pkg: '@betweenus/chat-service',
    language: 'typescript',
    description: 'Encrypted message persistence REST API, attachment metadata, emoji reactions, and message pins.',
  },
  {
    path: 'apps/services/chat-service/src/modules/e2ee/e2ee.controller.ts',
    pkg: '@betweenus/chat-service',
    language: 'typescript',
    description: 'E2EE cryptographic device key registry and channel key exchange distribution API.',
  },

  // Apps: services - call-service
  {
    path: 'apps/services/call-service/src/call.gateway.ts',
    pkg: '@betweenus/call-service',
    language: 'typescript',
    description: 'WebRTC mesh switchboard gateway (/ws/call) handling SDP offer/answer relay, ICE candidates, and game referees.',
  },
  {
    path: 'apps/services/call-service/src/modules/calls/calls.controller.ts',
    pkg: '@betweenus/call-service',
    language: 'typescript',
    description: 'Call service REST API providing TURN relay credentials, channel voice rosters, and call histories.',
  },

  // Apps: services - presence-service
  {
    path: 'apps/services/presence-service/src/presence.gateway.ts',
    pkg: '@betweenus/presence-service',
    language: 'typescript',
    description: 'Presence WebSocket gateway managing Redis heartbeat leases, online/idle/dnd state, and mutual visibility.',
  },
  {
    path: 'apps/services/presence-service/src/presence.controller.ts',
    pkg: '@betweenus/presence-service',
    language: 'typescript',
    description: 'Presence REST API for reciprocal last seen visibility, friendship rosters, and user blocklists.',
  },

  // Apps: services - notification-service
  {
    path: 'apps/services/notification-service/src/modules/notifications/notifications.controller.ts',
    pkg: '@betweenus/notification-service',
    language: 'typescript',
    description: 'Notification REST controller managing unread counters, push suppression windows, and notification preferences.',
  },

  // Apps: services - remote-gateway
  {
    path: 'apps/services/remote-gateway/src/remote.gateway.ts',
    pkg: '@betweenus/remote-gateway',
    language: 'typescript',
    description: 'Remote Desktop WebRTC signaling gateway for low-latency screen capture and mouse/keyboard input injection.',
  },
  {
    path: 'apps/services/remote-gateway/src/modules/remote/remote.controller.ts',
    pkg: '@betweenus/remote-gateway',
    language: 'typescript',
    description: 'Remote desktop machine enrolment tokens, permission grants (VIEW, CONTROL, CLIPBOARD), and active session auditing.',
  },

  // Apps: android
  {
    path: 'apps/android/core/src/main/java/com/aatech/betweenus/core/crypto/E2ee.kt',
    pkg: '@betweenus/android-core',
    language: 'kotlin',
    description: 'Android native Kotlin E2EE cryptographic engine: device identity key generation, channel key unwrapping, and backup sealing.',
  },
  {
    path: 'apps/android/core/src/main/java/com/aatech/betweenus/core/crypto/SecureStore.kt',
    pkg: '@betweenus/android-core',
    language: 'kotlin',
    description: 'Hardware-backed Android KeyStore wrapper for StrongBox / TEE AES-256-GCM master key encryption.',
  },

  // Apps: desktop
  {
    path: 'apps/desktop/electron/main.ts',
    pkg: '@betweenus/desktop',
    language: 'typescript',
    description: 'Electron main process controller: window lifecycle, native menus, secure IPC bridge, and auto-updates.',
  },

  // Scripts
  {
    path: 'scripts/dev-gateway.mjs',
    pkg: 'scripts',
    language: 'javascript',
    description: 'Unified local reverse-proxy ingress gateway routing ports 3001-3008 through localhost:8090 with WebSockets.',
  },
  {
    path: 'package.json',
    pkg: 'root',
    language: 'json',
    description: 'Monorepo root package.json configuration, workspace scripts, and devDependencies.',
  },
  {
    path: 'turbo.json',
    pkg: 'root',
    language: 'json',
    description: 'Turbo build pipeline topology, cache dependencies, and task definitions.',
  },
];

/**
 * Compacts empty single-child directories (like VS Code does with compactFolders)
 * and simplifies deep package paths to prevent long cascades.
 */
function compactTree(node) {
  if (!node.children || node.children.length === 0) {
    return node;
  }

  node.children = node.children.map(compactTree);

  // Preserve key top-level roots: root, "apps", "packages", "scripts"
  const preserveExactRoots = new Set(['', 'apps', 'packages', 'scripts']);

  while (
    !preserveExactRoots.has(node.path) &&
    node.children &&
    node.children.length === 1 &&
    node.children[0].type === 'directory'
  ) {
    const singleChild = node.children[0];
    node.name = node.name + '/' + singleChild.name;
    node.path = singleChild.path;
    node.children = singleChild.children;
  }

  // Clean and simplify verbose package segments for readable display
  node.name = node.name
    .replace(/core\/src\/main\/java\/com\/aatech\/betweenus\/core\//g, 'core/')
    .replace(/\/src\/modules\//g, '/')
    .replace(/\/src\b/g, '');

  return node;
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
  return compactTree(root);
}

export function buildCodeReference() {
  const filesResult = [];

  for (const item of INDEXED_FILES) {
    const fullPath = resolve(rootDir, item.path);
    if (!existsSync(fullPath)) {
      console.warn(`[code-reference] File not found: ${fullPath}`);
      continue;
    }

    const code = readFileSync(fullPath, 'utf8');
    const lines = code.split('\n');

    const symbols = [];
    const docComments = [];
    let currentComment = [];
    let insideComment = false;

    lines.forEach((line, idx) => {
      const trimmed = line.trim();

      if (trimmed.startsWith('/**') || trimmed.startsWith('/*')) {
        insideComment = true;
        currentComment = [trimmed];
      } else if (insideComment) {
        currentComment.push(trimmed);
        if (trimmed.endsWith('*/')) {
          insideComment = false;
          docComments.push({
            lineNumber: idx - currentComment.length + 2,
            comment: currentComment.join('\n'),
          });
          currentComment = [];
        }
      } else if (trimmed.startsWith('///')) {
        docComments.push({
          lineNumber: idx + 1,
          comment: trimmed,
        });
      }

      // Symbols
      const tsMatch = line.match(/^export\s+(interface|type|class|enum|function|const)\s+([A-Za-z0-9_]+)/);
      if (tsMatch) {
        symbols.push({
          kind: tsMatch[1],
          name: tsMatch[2],
          lineNumber: idx + 1,
        });
      }

      const prismaMatch = line.match(/^(model|enum)\s+([A-Za-z0-9_]+)/);
      if (prismaMatch) {
        symbols.push({
          kind: prismaMatch[1],
          name: prismaMatch[2],
          lineNumber: idx + 1,
        });
      }

      const ktMatch = line.match(/^(class|sealed\s+interface|interface|data\s+class|object)\s+([A-Za-z0-9_]+)/);
      if (ktMatch) {
        symbols.push({
          kind: ktMatch[1],
          name: ktMatch[2],
          lineNumber: idx + 1,
        });
      }
    });

    const fileId = item.path.replace(/[/.]/g, '-');

    filesResult.push({
      id: fileId,
      path: item.path,
      pkg: item.pkg,
      language: item.language,
      description: item.description,
      lineCount: lines.length,
      byteSize: Buffer.byteLength(code, 'utf8'),
      code,
      symbols,
      docCommentCount: docComments.length,
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
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[code-reference] Successfully indexed ${filesResult.length} files (${payload.totalLines} lines) with compact tree -> ${outPath}`);
}

buildCodeReference();
