import React, { useState, useMemo } from 'react';
import CodeBlock from '@theme/CodeBlock';
import codeReferenceData from '@site/src/data/codeReferenceData.json';
import styles from './styles.module.css';

interface CodeSymbol {
  kind: string;
  name: string;
  lineNumber: number;
}

interface CodeReferenceFile {
  id: string;
  title: string;
  pkg: string;
  filePath: string;
  language: string;
  description: string;
  lineCount: number;
  byteSize: number;
  code: string;
  symbols: CodeSymbol[];
  docCommentCount: number;
}

const FILES: CodeReferenceFile[] = codeReferenceData as CodeReferenceFile[];

export default function CodeReferenceExplorer(): React.ReactElement {
  const [activeFileId, setActiveFileId] = useState<string>(FILES[0]?.id || 'shared-types');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'all' | 'comments' | 'symbols'>('all');
  const [copied, setCopied] = useState<boolean>(false);

  const activeFile = useMemo(() => {
    return FILES.find((f) => f.id === activeFileId) || FILES[0];
  }, [activeFileId]);

  // Filter symbols based on search
  const filteredSymbols = useMemo(() => {
    if (!activeFile?.symbols) return [];
    if (!searchQuery.trim()) return activeFile.symbols;
    const q = searchQuery.toLowerCase();
    return activeFile.symbols.filter(
      (s) => s.name.toLowerCase().includes(q) || s.kind.toLowerCase().includes(q)
    );
  }, [activeFile, searchQuery]);

  // Filtered code display
  const displayedCode = useMemo(() => {
    if (!activeFile) return '';
    if (filterMode === 'all') {
      return activeFile.code;
    }

    const lines = activeFile.code.split('\n');

    if (filterMode === 'comments') {
      // Extract lines containing JSDoc/KDoc/Prisma comments and the immediate definition following them
      const result: string[] = [];
      let inComment = false;
      let buffer: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith('/**') || trimmed.startsWith('/*')) {
          inComment = true;
          buffer = [line];
        } else if (inComment) {
          buffer.push(line);
          if (trimmed.endsWith('*/')) {
            inComment = false;
            // Include next line (the symbol definition)
            if (i + 1 < lines.length && lines[i + 1].trim()) {
              buffer.push(lines[i + 1]);
              i++;
            }
            buffer.push('');
            result.push(...buffer);
            buffer = [];
          }
        } else if (trimmed.startsWith('///')) {
          result.push(line);
          if (i + 1 < lines.length && !lines[i + 1].trim().startsWith('///') && lines[i + 1].trim()) {
            result.push(lines[i + 1]);
            result.push('');
            i++;
          }
        }
      }
      return result.join('\n') || '// No doc comments found matching filter';
    }

    if (filterMode === 'symbols') {
      // Show symbol definitions with their signatures
      const symbolNames = new Set(filteredSymbols.map((s) => s.name));
      const result: string[] = [];
      for (const line of lines) {
        for (const s of filteredSymbols) {
          if (line.includes(s.name) && (line.includes('export ') || line.includes('model ') || line.includes('class '))) {
            result.push(`// Line ${s.lineNumber}: ${s.kind} ${s.name}`);
            result.push(line);
            result.push('');
            break;
          }
        }
      }
      return result.join('\n') || '// No symbols found matching search';
    }

    return activeFile.code;
  }, [activeFile, filterMode, filteredSymbols]);

  const handleCopy = () => {
    if (!activeFile) return;
    navigator.clipboard.writeText(displayedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.explorerRoot}>
      {/* File Navigation Selector Bar */}
      <div className={styles.fileSelectorBar}>
        <div className={styles.fileList} role="tablist" aria-label="Select source file">
          {FILES.map((f) => {
            const isActive = f.id === activeFileId;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setActiveFileId(f.id);
                  setSearchQuery('');
                }}
                className={`${styles.fileTab} ${isActive ? styles.fileTabActive : ''}`}
              >
                <span className={styles.fileTabTitle}>{f.title}</span>
                <span className={styles.fileTabLang}>{f.language}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active File Meta Card */}
      <div className={styles.metaCard}>
        <div className={styles.metaHeader}>
          <div className={styles.metaLeft}>
            <span className={styles.metaPkg}>{activeFile.pkg}</span>
            <code className={styles.metaPath}>{activeFile.filePath}</code>
          </div>
          <div className={styles.metaRight}>
            <span className={styles.statBadge}>
              <strong>{activeFile.lineCount.toLocaleString()}</strong> lines
            </span>
            <span className={styles.statBadge}>
              <strong>{Math.round(activeFile.byteSize / 1024)}</strong> KB
            </span>
            <span className={styles.statBadge}>
              <strong>{activeFile.symbols.length}</strong> symbols
            </span>
            <span className={styles.statBadge}>
              <strong>{activeFile.docCommentCount}</strong> doc comments
            </span>
            <button type="button" onClick={handleCopy} className={styles.copyBtn}>
              {copied ? '✓ Copied' : '📋 Copy Code'}
            </button>
          </div>
        </div>
        <p className={styles.fileDesc}>{activeFile.description}</p>

        {/* Search & Mode Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.searchBox}>
            <span className={styles.searchIcon}>🔍</span>
            <input
              type="text"
              placeholder={`Search ${activeFile.symbols.length} symbols (interfaces, types, functions)...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className={styles.clearSearch}
              >
                ✕
              </button>
            )}
          </div>

          <div className={styles.modeGroup}>
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`${styles.modeBtn} ${filterMode === 'all' ? styles.modeBtnActive : ''}`}
            >
              Full Source Code
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('comments')}
              className={`${styles.modeBtn} ${filterMode === 'comments' ? styles.modeBtnActive : ''}`}
            >
              Doc Comments Only
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('symbols')}
              className={`${styles.modeBtn} ${filterMode === 'symbols' ? styles.modeBtnActive : ''}`}
            >
              Symbol Definitions
            </button>
          </div>
        </div>

        {/* Quick Symbol Jump Chips */}
        {filteredSymbols.length > 0 && (
          <div className={styles.symbolsStrip}>
            <span className={styles.symbolsLabel}>Symbols ({filteredSymbols.length}):</span>
            <div className={styles.symbolsList}>
              {filteredSymbols.slice(0, 30).map((s) => (
                <span
                  key={`${s.kind}-${s.name}`}
                  className={styles.symbolChip}
                  title={`Line ${s.lineNumber}: ${s.kind} ${s.name}`}
                  onClick={() => {
                    setSearchQuery(s.name);
                    setFilterMode('symbols');
                  }}
                >
                  <span className={styles.symbolKind}>{s.kind}</span>
                  <span className={styles.symbolName}>{s.name}</span>
                </span>
              ))}
              {filteredSymbols.length > 30 && (
                <span className={styles.symbolMore}>
                  +{filteredSymbols.length - 30} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Code Viewer Viewport */}
      <div className={styles.codeViewport}>
        <CodeBlock
          language={activeFile.language}
          title={activeFile.filePath}
          showLineNumbers
        >
          {displayedCode}
        </CodeBlock>
      </div>
    </div>
  );
}
