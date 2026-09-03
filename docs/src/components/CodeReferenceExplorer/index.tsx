import React, { useState, useMemo, memo, useCallback } from 'react';
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
const FILES_MAP = new Map<string, CodeReferenceFile>();
data.files.forEach((f) => FILES_MAP.set(f.id, f));

// Icon badge based on file extension
function getFileIcon(fileName: string) {
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
  if (fileName.endsWith('.yml') || fileName.endsWith('.yaml')) {
    return <span className={`${styles.iconBadge} ${styles.iconYaml}`}>Y</span>;
  }
  if (fileName.endsWith('.md')) {
    return <span className={`${styles.iconBadge} ${styles.iconMd}`}>M↓</span>;
  }
  return <span className={`${styles.iconBadge} ${styles.iconDefault}`}>📄</span>;
}

// -------------------------------------------------------------
// ISOLATED FILE TREE COMPONENT (Zero re-renders of CodeBlock!)
// -------------------------------------------------------------
interface FileTreeProps {
  selectedFileId: string;
  onSelectFile: (fileId: string) => void;
}

const FileTree = memo(function FileTree({
  selectedFileId,
  onSelectFile,
}: FileTreeProps) {
  // BY DEFAULT: Only root 'Betweenus' is open. All child folders are CLOSED!
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
    () => new Set(['Betweenus'])
  );
  const [filterText, setFilterText] = useState<string>('');

  const toggleFolder = useCallback((folderPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedDirs(new Set(['Betweenus']));
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<string>();
    function collect(n: TreeNode) {
      if (n.type === 'directory' && n.path) all.add(n.path);
      n.children?.forEach(collect);
    }
    collect(data.fileTree);
    setExpandedDirs(all);
  }, []);

  const isFiltering = filterText.trim().length > 0;
  const q = filterText.toLowerCase();

  const renderNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isDir = node.type === 'directory';

    if (isFiltering) {
      const selfMatch = node.name.toLowerCase().includes(q);
      const childMatch = node.children?.some((c) => {
        function check(child: TreeNode): boolean {
          return (
            child.name.toLowerCase().includes(q) ||
            (child.children?.some(check) ?? false)
          );
        }
        return check(c);
      });
      if (!selfMatch && !childMatch) return null;
    }

    if (isDir) {
      const isOpen = isFiltering || expandedDirs.has(node.path);
      return (
        <div key={node.path || node.name} className={styles.treeGroup}>
          <div
            className={styles.folderRow}
            style={{ paddingLeft: `${Math.max(depth * 10 + 6, 6)}px` }}
            onClick={() => toggleFolder(node.path)}
          >
            <span
              className={`${styles.chevron} ${
                isOpen ? styles.chevronOpen : styles.chevronClosed
              }`}
            >
              ▾
            </span>
            <span className={styles.folderIcon}>{isOpen ? '📂' : '📁'}</span>
            <span className={styles.folderName} title={node.path}>
              {node.name}
            </span>
            {node.children && (
              <span className={styles.folderCount}>
                ({node.children.length})
              </span>
            )}
          </div>

          {isOpen && node.children && (
            <div className={styles.treeChildren}>
              {node.children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    // File row
    const isSelected = node.fileId === selectedFileId;
    return (
      <div
        key={node.path}
        className={`${styles.fileRow} ${isSelected ? styles.fileRowSelected : ''}`}
        style={{ paddingLeft: `${Math.max(depth * 10 + 20, 20)}px` }}
        onClick={() => {
          if (node.fileId) onSelectFile(node.fileId);
        }}
      >
        {getFileIcon(node.name)}
        <span className={styles.fileName} title={node.name}>
          {node.name}
        </span>
        {node.lineCount && (
          <span className={styles.fileLineCount}>{node.lineCount}L</span>
        )}
      </div>
    );
  };

  return (
    <div className={styles.treeContainer}>
      {/* Header */}
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
            ⊟ Close
          </button>
          <button
            type="button"
            onClick={expandAll}
            className={styles.headerActionBtn}
            title="Expand All Folders"
          >
            ⊞ Open
          </button>
        </div>
      </div>

      {/* Filter Input */}
      <div className={styles.treeSearchBox}>
        <span className={styles.treeSearchIcon}>🔍</span>
        <input
          type="text"
          placeholder="Filter files in repository..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className={styles.treeSearchInput}
        />
        {filterText && (
          <button
            type="button"
            onClick={() => setFilterText('')}
            className={styles.treeSearchClear}
          >
            ✕
          </button>
        )}
      </div>

      {/* Body */}
      <div className={styles.treeBody}>{renderNode(data.fileTree, 0)}</div>

      {/* Footer */}
      <div className={styles.treeFooter}>
        <span>{data.totalFiles} files</span>
        <span>{data.totalLines.toLocaleString()} lines</span>
      </div>
    </div>
  );
});

// -------------------------------------------------------------
// CODE VIEWER COMPONENT (Memoized to prevent re-renders on expand)
// -------------------------------------------------------------
interface CodeViewerProps {
  file: CodeReferenceFile;
  onBackToTree?: () => void;
}

const CodeViewer = memo(function CodeViewer({
  file,
  onBackToTree,
}: CodeViewerProps) {
  const [symbolQuery, setSymbolQuery] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  const filteredSymbols = useMemo(() => {
    if (!file.symbols) return [];
    if (!symbolQuery.trim()) return file.symbols;
    const q = symbolQuery.toLowerCase();
    return file.symbols.filter(
      (s) => s.name.toLowerCase().includes(q) || s.kind.toLowerCase().includes(q)
    );
  }, [file, symbolQuery]);

  const handleCopy = () => {
    navigator.clipboard.writeText(file.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.codeViewerRoot}>
      {/* Mobile Back Button */}
      {onBackToTree && (
        <div className={styles.mobileBackBanner}>
          <button
            type="button"
            onClick={onBackToTree}
            className={styles.backToTreeBtn}
          >
            ← Back to File Tree
          </button>
          <span className={styles.mobileCurrentFile}>
            {file.path.split('/').pop()}
          </span>
        </div>
      )}

      {/* Header & Breadcrumb Bar */}
      <div className={styles.codeHeaderBar}>
        <div className={styles.breadcrumbStrip}>
          <span className={styles.breadcrumbRoot}>BetweenUs</span>
          {file.path.split('/').map((seg, idx, arr) => (
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
            <strong>{file.lineCount.toLocaleString()}</strong> lines
          </span>
          <span className={styles.metaBadge}>
            <strong>{Math.round(file.byteSize / 1024)}</strong> KB
          </span>
          <span className={styles.metaBadge}>
            <strong>{file.symbols.length}</strong> symbols
          </span>
          <span className={styles.metaBadge}>
            <strong>{file.docCommentCount}</strong> doc comments
          </span>
          <button type="button" onClick={handleCopy} className={styles.copyBtn}>
            {copied ? '✓ Copied' : '📋 Copy Code'}
          </button>
        </div>
      </div>

      {/* Symbol Search Bar */}
      {file.symbols.length > 0 && (
        <div className={styles.codeToolbar}>
          <div className={styles.symbolSearchBox}>
            <span className={styles.searchIcon}>🔍</span>
            <input
              type="text"
              placeholder={`Search ${file.symbols.length} symbols in ${file.path.split('/').pop()}...`}
              value={symbolQuery}
              onChange={(e) => setSymbolQuery(e.target.value)}
              className={styles.symbolSearchInput}
            />
            {symbolQuery && (
              <button
                type="button"
                onClick={() => setSymbolQuery('')}
                className={styles.clearSearchBtn}
              >
                ✕
              </button>
            )}
          </div>

          {filteredSymbols.length > 0 && (
            <div className={styles.symbolsStrip}>
              <div className={styles.symbolsList}>
                {filteredSymbols.slice(0, 16).map((s) => (
                  <span
                    key={`${s.kind}-${s.name}`}
                    className={styles.symbolChip}
                    title={`Line ${s.lineNumber}: ${s.kind} ${s.name}`}
                    onClick={() => setSymbolQuery(s.name)}
                  >
                    <span className={styles.symbolKind}>{s.kind}</span>
                    <span className={styles.symbolName}>{s.name}</span>
                  </span>
                ))}
                {filteredSymbols.length > 16 && (
                  <span className={styles.symbolMore}>
                    +{filteredSymbols.length - 16} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Full Code Viewport (Untruncated, Complete Source) */}
      <div className={styles.codeViewport}>
        <CodeBlock
          language={file.language}
          title={file.path}
          showLineNumbers
        >
          {file.code}
        </CodeBlock>
      </div>
    </div>
  );
});

// -------------------------------------------------------------
// ROOT COMPONENT
// -------------------------------------------------------------
export default function CodeReferenceExplorer(): React.ReactElement {
  const [selectedFileId, setSelectedFileId] = useState<string>(
    data.files[0]?.id || 'packages-shared-types-src-index-ts'
  );
  const [mobileTab, setMobileTab] = useState<'tree' | 'code'>('tree');

  const activeFile = useMemo(() => {
    return FILES_MAP.get(selectedFileId) || data.files[0];
  }, [selectedFileId]);

  const handleSelectFile = useCallback((fileId: string) => {
    setSelectedFileId(fileId);
    setMobileTab('code');
  }, []);

  return (
    <div className={styles.codeExplorerContainer}>
      {/* Mobile Tab Switcher */}
      <div className={styles.mobileNavSwitch} role="group" aria-label="Mobile navigation">
        <button
          type="button"
          onClick={() => setMobileTab('tree')}
          className={`${styles.mobileTabBtn} ${
            mobileTab === 'tree' ? styles.mobileTabActive : ''
          }`}
        >
          📁 Browse Repository ({data.totalFiles} files)
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('code')}
          className={`${styles.mobileTabBtn} ${
            mobileTab === 'code' ? styles.mobileTabActive : ''
          }`}
        >
          📄 View Code ({activeFile.path.split('/').pop()})
        </button>
      </div>

      {/* IDE Split View Layout */}
      <div className={styles.ideLayout}>
        {/* Left Column: File Tree */}
        <aside
          className={`${styles.treeSidebar} ${
            mobileTab === 'code' ? styles.hideOnMobile : ''
          }`}
        >
          <FileTree
            selectedFileId={selectedFileId}
            onSelectFile={handleSelectFile}
          />
        </aside>

        {/* Right Column: Code Viewer */}
        <main
          className={`${styles.codeMainArea} ${
            mobileTab === 'tree' ? styles.hideOnMobile : ''
          }`}
        >
          <CodeViewer
            file={activeFile}
            onBackToTree={() => setMobileTab('tree')}
          />
        </main>
      </div>
    </div>
  );
}
