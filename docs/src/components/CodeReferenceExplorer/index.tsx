import React, { useState, useMemo } from 'react';
import CodeBlock from '@theme/CodeBlock';
import rawData from '@site/src/data/codeReferenceData.json';
import styles from './styles.module.css';

interface CodeSymbol {
  kind: string;
  name: string;
  lineNumber: number;
}

interface CodeReferenceFile {
  id: string;
  path: string;
  pkg: string;
  language: string;
  description: string;
  lineCount: number;
  byteSize: number;
  code: string;
  symbols: CodeSymbol[];
  docCommentCount: number;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: TreeNode[];
  fileId?: string;
  language?: string;
  lineCount?: number;
  byteSize?: number;
}

interface CodeReferencePayload {
  generatedAt: string;
  totalFiles: number;
  totalLines: number;
  fileTree: TreeNode;
  files: CodeReferenceFile[];
}

const data = rawData as CodeReferencePayload;
const FILES = data.files;

export default function CodeReferenceExplorer(): React.ReactElement {
  const [selectedFileId, setSelectedFileId] = useState<string>(
    FILES[0]?.id || 'packages-shared-types-src-index-ts'
  );
  const [treeSearch, setTreeSearch] = useState<string>('');
  const [symbolSearch, setSymbolSearch] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'all' | 'comments' | 'symbols'>('all');
  const [copied, setCopied] = useState<boolean>(false);
  const [mobileTab, setMobileTab] = useState<'tree' | 'code'>('code');

  // Set of collapsed folder paths
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(
    new Set(['Betweenus/apps/desktop/electron', 'Betweenus/packages/shared-types/src/games'])
  );

  const toggleFolder = (folderPath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  const expandAll = () => setCollapsedDirs(new Set());
  const collapseAll = () => {
    const allDirs = new Set<string>();
    function collect(node: TreeNode) {
      if (node.type === 'directory' && node.path) {
        allDirs.add(node.path);
      }
      node.children?.forEach(collect);
    }
    collect(data.fileTree);
    setCollapsedDirs(allDirs);
  };

  const activeFile = useMemo(() => {
    return FILES.find((f) => f.id === selectedFileId) || FILES[0];
  }, [selectedFileId]);

  // Filter symbols
  const filteredSymbols = useMemo(() => {
    if (!activeFile?.symbols) return [];
    if (!symbolSearch.trim()) return activeFile.symbols;
    const q = symbolSearch.toLowerCase();
    return activeFile.symbols.filter(
      (s) => s.name.toLowerCase().includes(q) || s.kind.toLowerCase().includes(q)
    );
  }, [activeFile, symbolSearch]);

  // Filtered code display
  const displayedCode = useMemo(() => {
    if (!activeFile) return '';
    if (filterMode === 'all') return activeFile.code;

    const lines = activeFile.code.split('\n');

    if (filterMode === 'comments') {
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
      return result.join('\n') || '// No doc comments found in this file';
    }

    if (filterMode === 'symbols') {
      const result: string[] = [];
      for (const line of lines) {
        for (const s of filteredSymbols) {
          if (line.includes(s.name) && (line.includes('export ') || line.includes('model ') || line.includes('class ') || line.includes('interface '))) {
            result.push(`// Line ${s.lineNumber}: ${s.kind} ${s.name}`);
            result.push(line);
            result.push('');
            break;
          }
        }
      }
      return result.join('\n') || '// No symbols matching search';
    }

    return activeFile.code;
  }, [activeFile, filterMode, filteredSymbols]);

  const handleCopy = () => {
    if (!activeFile) return;
    navigator.clipboard.writeText(displayedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Get file icon based on file extension / language
  const getFileIcon = (fileName: string, lang?: string) => {
    if (fileName.endsWith('.ts') || fileName.endsWith('.tsx')) {
      return <span className={`${styles.iconBadge} ${styles.iconTs}`}>TS</span>;
    }
    if (fileName.endsWith('.prisma')) {
      return <span className={`${styles.iconBadge} ${styles.iconPrisma}`}>◈</span>;
    }
    if (fileName.endsWith('.kt')) {
      return <span className={`${styles.iconBadge} ${styles.iconKotlin}`}>K</span>;
    }
    if (fileName.endsWith('.js') || fileName.endsWith('.mjs')) {
      return <span className={`${styles.iconBadge} ${styles.iconJs}`}>JS</span>;
    }
    if (fileName.endsWith('.json')) {
      return <span className={`${styles.iconBadge} ${styles.iconJson}`}>{`{}`}</span>;
    }
    return <span className={`${styles.iconBadge} ${styles.iconDefault}`}>📄</span>;
  };

  // Recursive Tree Node Renderer
  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isDir = node.type === 'directory';
    const isCollapsed = collapsedDirs.has(node.path);

    // Apply tree search filter if active
    if (treeSearch.trim()) {
      const q = treeSearch.toLowerCase();
      const matchesSelf = node.name.toLowerCase().includes(q);
      const matchesChild = node.children?.some((c) => {
        function check(n: TreeNode): boolean {
          return n.name.toLowerCase().includes(q) || (n.children?.some(check) ?? false);
        }
        return check(c);
      });
      if (!matchesSelf && !matchesChild) return null;
    }

    if (isDir) {
      return (
        <div key={node.path || node.name} className={styles.treeGroup}>
          <div
            className={styles.folderRow}
            style={{ paddingLeft: `${Math.max(depth * 14, 8)}px` }}
            onClick={() => toggleFolder(node.path)}
          >
            <span className={`${styles.chevron} ${isCollapsed ? styles.chevronCollapsed : ''}`}>
              ▾
            </span>
            <span className={styles.folderIcon}>{isCollapsed ? '📁' : '📂'}</span>
            <span className={styles.folderName}>{node.name}</span>
          </div>

          {!isCollapsed && node.children && (
            <div className={styles.treeChildren}>
              {node.children.map((child) => renderTreeNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    // File Node
    const isSelected = node.fileId === selectedFileId;
    return (
      <div
        key={node.path}
        className={`${styles.fileRow} ${isSelected ? styles.fileRowSelected : ''}`}
        style={{ paddingLeft: `${Math.max(depth * 14 + 18, 24)}px` }}
        onClick={() => {
          if (node.fileId) {
            setSelectedFileId(node.fileId);
            setSymbolSearch('');
            setMobileTab('code');
          }
        }}
      >
        {getFileIcon(node.name, node.language)}
        <span className={styles.fileName}>{node.name}</span>
        {node.lineCount && (
          <span className={styles.fileLineCount}>{node.lineCount}L</span>
        )}
      </div>
    );
  };

  return (
    <div className={styles.codeExplorerContainer}>
      {/* Mobile Tab Switcher */}
      <div className={styles.mobileNavSwitch}>
        <button
          type="button"
          onClick={() => setMobileTab('tree')}
          className={`${styles.mobileTabBtn} ${mobileTab === 'tree' ? styles.mobileTabActive : ''}`}
        >
          📁 File Tree ({FILES.length})
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('code')}
          className={`${styles.mobileTabBtn} ${mobileTab === 'code' ? styles.mobileTabActive : ''}`}
        >
          📄 Code Viewer ({activeFile?.path.split('/').pop()})
        </button>
      </div>

      {/* Main Two-Column Layout */}
      <div className={styles.ideLayout}>
        {/* LEFT COLUMN: VS Code-Style Interactive File Tree */}
        <aside
          className={`${styles.treeSidebar} ${mobileTab === 'code' ? styles.hideOnMobile : ''}`}
        >
          <div className={styles.treeHeader}>
            <div className={styles.treeHeaderTitle}>
              <span className={styles.workspaceIcon}>⚡</span>
              <span className={styles.workspaceTitle}>EXPLORER: BETWEENUS</span>
            </div>
            <div className={styles.treeHeaderActions}>
              <button
                type="button"
                onClick={collapseAll}
                className={styles.headerActionBtn}
                title="Collapse All Folders"
              >
                ⊟
              </button>
              <button
                type="button"
                onClick={expandAll}
                className={styles.headerActionBtn}
                title="Expand All Folders"
              >
                ⊞
              </button>
            </div>
          </div>

          {/* Quick File Filter */}
          <div className={styles.treeSearchBox}>
            <input
              type="text"
              placeholder="Filter files..."
              value={treeSearch}
              onChange={(e) => setTreeSearch(e.target.value)}
              className={styles.treeSearchInput}
            />
            {treeSearch && (
              <button
                type="button"
                onClick={() => setTreeSearch('')}
                className={styles.treeSearchClear}
              >
                ✕
              </button>
            )}
          </div>

          {/* Hierarchical Tree Body */}
          <div className={styles.treeBody}>
            {renderTreeNode(data.fileTree, 0)}
          </div>

          {/* Tree Footer Stats */}
          <div className={styles.treeFooter}>
            <span>{data.totalFiles} indexed files</span>
            <span>{data.totalLines.toLocaleString()} lines of code</span>
          </div>
        </aside>

        {/* RIGHT COLUMN: Code Viewport & Metadata */}
        <main
          className={`${styles.codeMainArea} ${mobileTab === 'tree' ? styles.hideOnMobile : ''}`}
        >
          {/* File Header & Breadcrumb Bar */}
          <div className={styles.codeHeaderBar}>
            <div className={styles.breadcrumbStrip}>
              <span className={styles.breadcrumbRoot}>BetweenUs</span>
              {activeFile.path.split('/').map((seg, idx, arr) => (
                <React.Fragment key={`${seg}-${idx}`}>
                  <span className={styles.breadcrumbSep}>›</span>
                  <span
                    className={`${styles.breadcrumbPart} ${
                      idx === arr.length - 1 ? styles.breadcrumbActive : ''
                    }`}
                  >
                    {seg}
                  </span>
                </React.Fragment>
              ))}
            </div>

            <div className={styles.headerStatsRow}>
              <span className={styles.metaBadge}>
                <strong>{activeFile.lineCount.toLocaleString()}</strong> lines
              </span>
              <span className={styles.metaBadge}>
                <strong>{Math.round(activeFile.byteSize / 1024)}</strong> KB
              </span>
              <span className={styles.metaBadge}>
                <strong>{activeFile.symbols.length}</strong> symbols
              </span>
              <span className={styles.metaBadge}>
                <strong>{activeFile.docCommentCount}</strong> doc comments
              </span>
              <button type="button" onClick={handleCopy} className={styles.copyBtn}>
                {copied ? '✓ Copied' : '📋 Copy Code'}
              </button>
            </div>
          </div>

          {/* File Description */}
          <div className={styles.fileDescBanner}>
            <span className={styles.pkgTag}>{activeFile.pkg}</span>
            <span className={styles.descText}>{activeFile.description}</span>
          </div>

          {/* Toolbar: Symbol Search + Display Mode Switcher */}
          <div className={styles.codeToolbar}>
            <div className={styles.symbolSearchBox}>
              <span className={styles.searchIcon}>🔍</span>
              <input
                type="text"
                placeholder={`Search ${activeFile.symbols.length} symbols in ${activeFile.path.split('/').pop()}...`}
                value={symbolSearch}
                onChange={(e) => setSymbolSearch(e.target.value)}
                className={styles.symbolSearchInput}
              />
              {symbolSearch && (
                <button
                  type="button"
                  onClick={() => setSymbolSearch('')}
                  className={styles.clearSearchBtn}
                >
                  ✕
                </button>
              )}
            </div>

            <div className={styles.modeSwitcher}>
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`${styles.modeTab} ${filterMode === 'all' ? styles.modeTabActive : ''}`}
              >
                Full Source
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('comments')}
                className={`${styles.modeTab} ${filterMode === 'comments' ? styles.modeTabActive : ''}`}
              >
                Doc Comments Only
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('symbols')}
                className={`${styles.modeTab} ${filterMode === 'symbols' ? styles.modeTabActive : ''}`}
              >
                Symbol Definitions
              </button>
            </div>
          </div>

          {/* Clickable Symbol Jump Chips */}
          {filteredSymbols.length > 0 && (
            <div className={styles.symbolsStrip}>
              <span className={styles.symbolsLabel}>Symbols ({filteredSymbols.length}):</span>
              <div className={styles.symbolsList}>
                {filteredSymbols.slice(0, 24).map((s) => (
                  <span
                    key={`${s.kind}-${s.name}`}
                    className={styles.symbolChip}
                    title={`Line ${s.lineNumber}: ${s.kind} ${s.name}`}
                    onClick={() => {
                      setSymbolSearch(s.name);
                      setFilterMode('symbols');
                    }}
                  >
                    <span className={styles.symbolKind}>{s.kind}</span>
                    <span className={styles.symbolName}>{s.name}</span>
                  </span>
                ))}
                {filteredSymbols.length > 24 && (
                  <span className={styles.symbolMore}>
                    +{filteredSymbols.length - 24} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Syntax-Highlighted Code Viewport */}
          <div className={styles.codeViewport}>
            <CodeBlock
              language={activeFile.language}
              title={activeFile.path}
              showLineNumbers
            >
              {displayedCode}
            </CodeBlock>
          </div>
        </main>
      </div>
    </div>
  );
}
