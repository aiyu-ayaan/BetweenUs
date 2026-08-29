import React, { useState, useRef, useCallback, useEffect } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './styles.module.css';

interface SatelliteChip {
  id: string;
  label: string;
  sublabel: string;
  icon: string;
  positionClass: string;
  depth: number;
}

const SATELLITES: SatelliteChip[] = [
  {
    id: 'e2ee',
    label: 'E2EE Cryptography',
    sublabel: 'AES-256-GCM · ECDH P-256',
    icon: '🛡️',
    positionClass: styles.chipTopLeft,
    depth: 45,
  },
  {
    id: 'webrtc',
    label: 'P2P Mesh Media',
    sublabel: 'Zero Server Media · DTLS-SRTP',
    icon: '⚡',
    positionClass: styles.chipTopRight,
    depth: 55,
  },
  {
    id: 'remote',
    label: 'Remote Desktop',
    sublabel: 'Low Latency · Encrypted Stream',
    icon: '🖥️',
    positionClass: styles.chipBottomLeft,
    depth: 50,
  },
  {
    id: 'listen',
    label: 'Listen Together',
    sublabel: 'Shared Queue · Sync Playback',
    icon: '🎵',
    positionClass: styles.chipBottomRight,
    depth: 40,
  },
];

export default function Hero3DLogo(): React.ReactElement {
  const cardRef = useRef<HTMLDivElement>(null);
  const [rotate, setRotate] = useState({ x: 0, y: 0 });
  const [glare, setGlare] = useState({ x: 50, y: 50, opacity: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const logoSrc = useBaseUrl('img/logo.svg');

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -14;
    const rotateY = ((x - centerX) / centerX) * 16;

    const glareX = (x / rect.width) * 100;
    const glareY = (y / rect.height) * 100;

    setRotate({ x: rotateX, y: rotateY });
    setGlare({ x: glareX, y: glareY, opacity: 0.25 });
  }, []);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    setRotate({ x: 0, y: 0 });
    setGlare((prev) => ({ ...prev, opacity: 0 }));
  }, []);

  return (
    <div className={styles.sceneContainer}>
      {/* 3D Ambient Volumetric Glow */}
      <div className={styles.ambientGlow} />

      {/* Main 3D Perspective Card */}
      <div
        ref={cardRef}
        className={styles.card3d}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          transform: `perspective(1000px) rotateX(${rotate.x}deg) rotateY(${rotate.y}deg) ${
            isHovered ? 'scale3d(1.03, 1.03, 1.03)' : 'scale3d(1, 1, 1)'
          }`,
        }}
      >
        {/* Specular Dynamic Glare Layer */}
        <div
          className={styles.glareLayer}
          style={{
            background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255, 255, 255, 0.25) 0%, rgba(124, 92, 255, 0.15) 35%, transparent 70%)`,
            opacity: glare.opacity,
          }}
        />

        {/* Floating Background Grid / Glass Backplane */}
        <div className={styles.backplane}>
          <div className={styles.cardGrid} />
        </div>

        {/* Central 3D Floating Logo Badge */}
        <div className={styles.logoStage}>
          <div className={styles.logoRingOuter} />
          <div className={styles.logoRingInner} />
          <div className={styles.logoEmboss}>
            <img
              src={logoSrc}
              alt="BetweenUs 3D Emblem"
              className={styles.logoImage}
            />
          </div>
          <div className={styles.logoGlow} />
        </div>

        {/* 3D Floating Spatial Satellite Chips */}
        {SATELLITES.map((chip) => (
          <div
            key={chip.id}
            className={`${styles.satelliteChip} ${chip.positionClass}`}
            style={{
              transform: `translateZ(${chip.depth}px) ${
                isHovered ? 'scale(1.05)' : 'scale(1)'
              }`,
            }}
          >
            <span className={styles.chipIcon}>{chip.icon}</span>
            <div className={styles.chipText}>
              <span className={styles.chipLabel}>{chip.label}</span>
              <span className={styles.chipSublabel}>{chip.sublabel}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
