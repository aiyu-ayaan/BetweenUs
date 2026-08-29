import React, { useEffect, useRef, useState, useCallback } from 'react';
import ErrorBoundary from '@docusaurus/ErrorBoundary';
import { ErrorBoundaryErrorMessageFallback } from '@docusaurus/theme-common';
import {
  MermaidContainerClassName,
  useMermaidRenderResult,
} from '@docusaurus/theme-mermaid/client';
import styles from './styles.module.css';

interface PanZoomState {
  scale: number;
  x: number;
  y: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 30.0; // 3000% zoom capability

function MermaidRenderResult({ renderResult }: { renderResult: { svg: string; bindFunctions?: (div: HTMLElement) => void } }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<PanZoomState>({ scale: 1, x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const div = containerRef.current;
    if (div && renderResult.bindFunctions) {
      renderResult.bindFunctions(div);
    }
  }, [renderResult]);

  // Handle Zoom In with adaptive stepping
  const handleZoomIn = useCallback(() => {
    setTransform((prev) => {
      const step = prev.scale < 2 ? 0.25 : prev.scale < 5 ? 0.5 : prev.scale < 10 ? 1.0 : 2.5;
      const nextScale = Math.min(MAX_SCALE, Math.round((prev.scale + step) * 100) / 100);
      return { ...prev, scale: nextScale };
    });
  }, []);

  // Handle Zoom Out with adaptive stepping
  const handleZoomOut = useCallback(() => {
    setTransform((prev) => {
      const step = prev.scale <= 2 ? 0.25 : prev.scale <= 5 ? 0.5 : prev.scale <= 10 ? 1.0 : 2.5;
      const nextScale = Math.max(MIN_SCALE, Math.round((prev.scale - step) * 100) / 100);
      return { ...prev, scale: nextScale };
    });
  }, []);

  // Handle Reset
  const handleReset = useCallback(() => {
    setTransform({ scale: 1, x: 0, y: 0 });
  }, []);

  // Handle Mouse Wheel Zoom
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    setTransform((prev) => {
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * zoomFactor));
      return {
        ...prev,
        scale: Math.round(newScale * 100) / 100,
      };
    });
  }, []);

  // Handle Mouse Down (Pan start)
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Left click only
    setIsDragging(true);
    setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
  }, [transform]);

  // Handle Mouse Move (Pan drag)
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setTransform((prev) => ({
      ...prev,
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    }));
  }, [isDragging, dragStart]);

  // Handle Mouse Up
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Handle Fullscreen Toggle
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
    setTransform({ scale: 1, x: 0, y: 0 });
  }, []);

  // Keyboard shortcut for escape in fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
        setTransform({ scale: 1, x: 0, y: 0 });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  const toolbar = (
    <div className={styles.toolbar} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={styles.toolButton}
        onClick={handleZoomIn}
        title="Zoom In"
        aria-label="Zoom In"
      >
        +
      </button>
      <span className={styles.zoomLabel}>{Math.round(transform.scale * 100)}%</span>
      <button
        type="button"
        className={styles.toolButton}
        onClick={handleZoomOut}
        title="Zoom Out"
        aria-label="Zoom Out"
      >
        −
      </button>
      <button
        type="button"
        className={styles.toolButton}
        onClick={handleReset}
        title="Reset Zoom & Pan"
        aria-label="Reset Zoom & Pan"
      >
        ↺
      </button>
      <button
        type="button"
        className={styles.toolButton}
        onClick={toggleFullscreen}
        title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen View'}
        aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen View'}
      >
        {isFullscreen ? '✕' : '⛶'}
      </button>
    </div>
  );

  const canvasContent = (
    <div
      ref={containerRef}
      className={`${MermaidContainerClassName} ${styles.canvas}`}
      style={{
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
      }}
      dangerouslySetInnerHTML={{ __html: renderResult.svg }}
    />
  );

  return (
    <>
      <div className={styles.wrapper}>
        {toolbar}
        <div
          ref={viewportRef}
          className={`${styles.viewport} ${isDragging ? styles.isGrabbing : styles.isGrab}`}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleReset}
        >
          {canvasContent}
          <div className={styles.hint}>
            <span>🔍 Scroll to zoom · Drag to pan · Double-click to reset</span>
          </div>
        </div>
      </div>

      {isFullscreen && (
        <div className={styles.fullscreenOverlay}>
          <div className={styles.fullscreenHeader}>
            <div className={styles.fullscreenTitle}>
              <span>📐 Architecture Diagram Viewer</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {toolbar}
              <button
                type="button"
                className={styles.closeButton}
                onClick={toggleFullscreen}
                title="Close Fullscreen (Esc)"
              >
                ✕
              </button>
            </div>
          </div>
          <div
            className={`${styles.fullscreenBody} ${isDragging ? styles.isGrabbing : styles.isGrab}`}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={handleReset}
          >
            {canvasContent}
          </div>
        </div>
      )}
    </>
  );
}

function MermaidRenderer({ value }: { value: string }) {
  const renderResult = useMermaidRenderResult({ text: value });
  if (renderResult === null) {
    return null;
  }
  return <MermaidRenderResult renderResult={renderResult} />;
}

export default function Mermaid(props: { value: string }) {
  return (
    <ErrorBoundary fallback={(params) => <ErrorBoundaryErrorMessageFallback {...params} />}>
      <MermaidRenderer {...props} />
    </ErrorBoundary>
  );
}
