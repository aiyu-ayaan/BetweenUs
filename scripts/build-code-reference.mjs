#!/usr/bin/env node
/**
 * build-code-reference.mjs
 * Extracts real codebase source files and their doc comments
 * into a structured JSON for the interactive Code Reference component.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const FILES_TO_INDEX = [
  {
    id: 'shared-types',
    title: 'Shared Types & Contracts',
    pkg: 'packages/shared-types',
    filePath: 'packages/shared-types/src/index.ts',
    language: 'typescript',
    description: 'Universal DTOs, E2EE envelopes, WebSocket frames, and JSDoc contracts shared across all services and clients.',
  },
  {
    id: 'database-schema',
    title: 'Prisma Database Schema',
    pkg: 'packages/database',
    filePath: 'packages/database/prisma/schema.prisma',
    language: 'prisma',
    description: 'PostgreSQL schema with 22 models, indexes, zero-knowledge storage columns, and field comments.',
  },
  {
    id: 'chat-gateway',
    title: 'Chat Realtime Gateway',
    pkg: 'apps/services/chat-service',
    filePath: 'apps/services/chat-service/src/gateways/chat.gateway.ts',
    language: 'typescript',
    description: 'Real-time WebSocket gateway (/ws/chat) handling message subscriptions, fanout, and typing state.',
  },
  {
    id: 'call-gateway',
    title: 'Call Switchboard Gateway',
    pkg: 'apps/services/call-service',
    filePath: 'apps/services/call-service/src/call.gateway.ts',
    language: 'typescript',
    description: 'Peer-to-peer WebRTC signaling switchboard (/ws/call) with DTLS-SRTP negotiation and game referees.',
  },
  {
    id: 'android-e2ee',
    title: 'Android E2EE Cryptographic Engine',
    pkg: 'apps/android/core',
    filePath: 'apps/android/core/src/main/java/com/aatech/betweenus/core/crypto/E2ee.kt',
    language: 'kotlin',
    description: 'Native Kotlin E2EE engine managing device identity keys, channel key unwrapping, and sealed payloads.',
  },
  {
    id: 'carrom-physics',
    title: 'Carrom 2D Physics Engine',
    pkg: 'packages/shared-types',
    filePath: 'packages/shared-types/src/games/carrom-physics.ts',
    language: 'typescript',
    description: 'Deterministic 2D rigid-body striker and coin collision simulation synchronized between server and clients.',
  },
];

export function buildCodeReference() {
  const result = [];

  for (const item of FILES_TO_INDEX) {
    const fullPath = resolve(rootDir, item.filePath);
    if (!existsSync(fullPath)) {
      console.warn(`[code-reference] File not found: ${fullPath}`);
      continue;
    }

    const code = readFileSync(fullPath, 'utf8');
    const lines = code.split('\n');

    // Extract symbols (interfaces, types, classes, functions, enums, models)
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

      // Check symbol definitions
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

    result.push({
      ...item,
      lineCount: lines.length,
      byteSize: Buffer.byteLength(code, 'utf8'),
      code,
      symbols,
      docCommentCount: docComments.length,
    });
  }

  const outDir = resolve(rootDir, 'docs', 'src', 'data');
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const outPath = resolve(outDir, 'codeReferenceData.json');
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`[code-reference] Generated code reference data for ${result.length} files -> ${outPath}`);
}

buildCodeReference();
