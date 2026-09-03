#!/usr/bin/env node
/**
 * Automatically syncs root CHANGELOG.md into docs/docs/changelog.md
 * with Docusaurus frontmatter and release links.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDir = resolve(__dirname, '..');
const changelogSrc = resolve(rootDir, 'CHANGELOG.md');
const changelogDest = resolve(rootDir, 'docs', 'docs', 'changelog.md');

export function syncChangelog() {
  if (!existsSync(changelogSrc)) {
    console.warn(`[sync-changelog] Source file not found: ${changelogSrc}`);
    return;
  }

  const raw = readFileSync(changelogSrc, 'utf8');

  // Remove top-level # Changelog heading to avoid double headings
  let body = raw.replace(/^#\s+Changelog\s*\n+/i, '').trim();

  // Escape unescaped curly braces outside code fences for MDX compatibility
  body = body.replace(/(?<!`)\{([^`\n{}]+)\}(?!`)/g, '`{$1}`');

  const content = `---
title: Changelog
description: Complete release notes and historical changelog for BetweenUs.
displayed_sidebar: null
---

# Changelog

:::tip GitHub Releases
All production release binaries (Windows Desktop installer and Android APK), asset checksums, and version tag comparisons are published on [GitHub Releases](https://github.com/aiyu-ayaan/BetweenUs/releases).
:::

${body}
`;

  writeFileSync(changelogDest, content, 'utf8');
  console.log(`[sync-changelog] Synced ${changelogSrc} -> ${changelogDest}`);
}

syncChangelog();
