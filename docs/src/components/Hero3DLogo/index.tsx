import React, { useState, useRef, useCallback } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

interface SubsystemInfo {
  id: string;
  label: string;
  sublabel: string;
  docPath: string;
  badge: string;
  description: string;
  color: string;
  positionClass: string;
  depth: number;
}

const SUBSYSTEMS: SubsystemInfo[] = [
  {
    id: 'e2ee',
    label: 'E2EE Cryptography',
    sublabel: 'AES-256-GCM · ECDH P-256',
    docPath: '/security/e2ee',
    badge: 'Zero-Knowledge Storage',
    description: 'Every message and attachment is sealed locally. Identity backups derive from bcrypt/passphrase.',
    color: '#8b5cf6',
    positionClass: styles.chipTopLeft,
    depth: 50,
  },
  {
    id: 'webrtc',
    label: 'P2P Mesh Media',
    sublabel: 'Zero Server Media · DTLS-SRTP',
    docPath: '/architecture/media',
    badge: 'Pure Peer-to-Peer Mesh',
    description: 'No media server exists. Video & audio streams flow directly between peers encrypted with DTLS-SRTP.',
    color: '#38bdf8',
    positionClass: styles.chipTopRight,
    depth: 55,
  },
  {
    id: 'remote',
    label: 'Remote Desktop',
    sublabel: 'Low Latency · Encrypted Stream',
    docPath: '/architecture/remote-desktop',
    badge: 'Granular Access Grants',
    description: 'Interactive low-latency remote machine control with audited grants, multi-monitor support, and clipboard sync.',
    color: '#a855f7',
    positionClass: styles.chipBottomLeft,
    depth: 48,
  },
  {
    id: 'listen',
    label: 'Listen & Play Together',
    sublabel: 'Zero Uplink · Carrom Physics',
    docPath: '/architecture/listen-together',
    badge: 'Real-time Synchronized Call Activity',
    description: 'Synchronized YouTube playback without stream re-encoding, plus deterministic referee-backed board games.',
    color: '#22c55e',
    positionClass: styles.chipBottomRight,
    depth: 42,
  },
];

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function WebRTCIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function RemoteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

const ICON_MAP: Record<string, React.ReactNode> = {
  e2ee: <ShieldIcon />,
  webrtc: <WebRTCIcon />,
  remote: <RemoteIcon />,
  listen: <ActivityIcon />,
};

export default function Hero3DLogo(): React.ReactElement {
  const cardRef = useRef<HTMLDivElement>(null);
  const [rotate, setRotate] = useState({ x: 0, y: 0 });
  const [glare, setGlare] = useState({ x: 50, y: 50, opacity: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [selectedSubsystem, setSelectedSubsystem] = useState<SubsystemInfo>(SUBSYSTEMS[0]);
  const [isInspectMode, setIsInspectMode] = useState(false);

  const logoSrc = useBaseUrl('img/logo.svg');

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -16;
    const rotateY = ((x - centerX) / centerX) * 18;

    const glareX = (x / rect.width) * 100;
    const glareY = (y / rect.height) * 100;

    setRotate({ x: rotateX, y: rotateY });
    setGlare({ x: glareX, y: glareY, opacity: 0.35 });
  }, []);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    setRotate({ x: 0, y: 0 });
    setGlare((prev) => ({ ...prev, opacity: 0 }));
  }, []);

  const handleChipClick = (subsystem: SubsystemInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedSubsystem(subsystem);
    setIsInspectMode(true);
  };

  const handleCardClick = () => {
    setIsInspectMode((prev) => !prev);
  };

  return (
    <div className={styles.sceneContainer}>
      {/* 3D Ambient Dynamic Particle & Mesh Glow */}
      <div
        className={styles.ambientGlow}
        style={{
          background: `radial-gradient(circle, ${selectedSubsystem.color}55 0%, rgba(99, 102, 241, 0.25) 45%, transparent 70%)`,
        }}
      />

      {/* Main 3D Perspective Card */}
      <div
        ref={cardRef}
        className={`${styles.card3d} ${isInspectMode ? styles.cardInspectActive : ''}`}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleCardClick}
        style={{
          transform: `perspective(1200px) rotateX(${rotate.x}deg) rotateY(${rotate.y}deg) ${
            isHovered ? 'scale3d(1.025, 1.025, 1.025)' : 'scale3d(1, 1, 1)'
          }`,
        }}
      >
        {/* Dynamic Specular Glare */}
        <div
          className={styles.glareLayer}
          style={{
            background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255, 255, 255, 0.28) 0%, rgba(124, 92, 255, 0.18) 35%, transparent 70%)`,
            opacity: glare.opacity,
          }}
        />

        {/* Ambient Grid & Backplane */}
        <div className={styles.backplane}>
          <div className={styles.cardGrid} />
        </div>

        {/* Interactive Top Live Telemetry Bar */}
        <div className={styles.telemetryBar}>
          <div className={styles.telemetryDot} />
          <span className={styles.telemetryText}>
            Interactive 3D Subsystem Inspector
          </span>
          <span className={styles.telemetryHint}>
            {isInspectMode ? 'Click card to reset' : 'Click any node to inspect'}
          </span>
        </div>

        {/* Center Stage: 3D Logo or Active Inspector HUD */}
        {!isInspectMode ? (
          <div className={styles.logoStage}>
            <div className={styles.logoRingOuter} />
            <div className={styles.logoRingInner} />
            <div className={styles.logoEmboss}>
              <img
                src={logoSrc}
                alt="BetweenUs 3D Logo"
                className={styles.logoImage}
              />
            </div>
            <div className={styles.logoGlow} />
          </div>
        ) : (
          <div className={styles.inspectorHud}>
            <div
              className={styles.inspectorBadge}
              style={{ borderColor: selectedSubsystem.color, color: selectedSubsystem.color }}
            >
              {selectedSubsystem.badge}
            </div>
            <h3 className={styles.inspectorTitle}>{selectedSubsystem.label}</h3>
            <p className={styles.inspectorDesc}>{selectedSubsystem.description}</p>
            <Link
              to={selectedSubsystem.docPath}
              className={styles.inspectorLink}
              onClick={(e) => e.stopPropagation()}
            >
              <span>Explore Architecture Spec</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </Link>
          </div>
        )}

        {/* 3D Spatial Satellite Chips */}
        {SUBSYSTEMS.map((chip) => {
          const isSelected = selectedSubsystem.id === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={(e) => handleChipClick(chip, e)}
              className={`${styles.satelliteChip} ${chip.positionClass} ${
                isSelected ? styles.chipSelected : ''
              }`}
              style={{
                transform: `translateZ(${isSelected ? chip.depth + 18 : chip.depth}px) ${
                  isSelected ? 'scale(1.06)' : 'scale(1)'
                }`,
                borderColor: isSelected ? chip.color : undefined,
              }}
            >
              <span
                className={styles.chipIcon}
                style={{ color: isSelected ? chip.color : '#cbd5e1' }}
              >
                {ICON_MAP[chip.id]}
              </span>
              <div className={styles.chipText}>
                <span className={styles.chipLabel}>{chip.label}</span>
                <span className={styles.chipSublabel}>{chip.sublabel}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
