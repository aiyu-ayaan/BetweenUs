import React, { useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

interface FeatureTab {
  id: string;
  label: string;
  icon: string;
  desktopImage: string;
  desktopAlt: string;
  desktopBadge: string;
  androidImage: string;
  androidAlt: string;
  androidBadge: string;
  docPath: string;
  description: string;
}

const TABS: FeatureTab[] = [
  {
    id: 'chat',
    label: 'E2EE Chat',
    icon: '💬',
    desktopImage: 'img/feature-chat.png',
    desktopAlt: 'BetweenUs Desktop E2EE Chat with Rich Markdown',
    desktopBadge: 'Desktop: Markdown · Code Highlight · Emoji Reactions',
    androidImage: 'img/android-chat.png',
    androidAlt: 'BetweenUs Native Android E2EE Chat Screen',
    androidBadge: 'Android: Compose · Voice Notes · KeyStore',
    docPath: '/features#1-end-to-end-encrypted-messaging',
    description: 'Zero-knowledge AES-256-GCM encrypted chat synchronized live between Electron and native Jetpack Compose.',
  },
  {
    id: 'voice',
    label: 'Voice & Video',
    icon: '🔊',
    desktopImage: 'img/feature-voice.png',
    desktopAlt: 'BetweenUs Desktop WebRTC Voice & Video',
    desktopBadge: 'Desktop: 4K/60FPS Screen Share · Noise Gate',
    androidImage: 'img/android-voice.png',
    androidAlt: 'BetweenUs Android Voice Lounge Call Stage',
    androidBadge: 'Android: P2P Mesh · Background Audio · PiP',
    docPath: '/features#2-peer-to-peer-voice-and-video-calls',
    description: 'Decentralized peer-to-peer WebRTC mesh calls with zero media servers and software noise cancellation.',
  },
  {
    id: 'themes',
    label: '16 Themes',
    icon: '🎨',
    desktopImage: 'img/feature-themes.png',
    desktopAlt: 'BetweenUs Desktop 16 Themes & Accents',
    desktopBadge: 'Desktop: 16 Curated Themes · 8 Dynamic Accents',
    androidImage: 'img/android-themes.png',
    androidAlt: 'BetweenUs Android Material You Themer',
    androidBadge: 'Android: Dynamic Theming (Material You)',
    docPath: '/features#5-multi-theme-customization-engine',
    description: 'Cross-platform design tokens supporting 16 themes, custom accent colors, and Android Material You wallpaper sync.',
  },
  {
    id: 'moments',
    label: 'Moments',
    icon: '✨',
    desktopImage: 'img/feature-moments.png',
    desktopAlt: 'BetweenUs Desktop Moments Feed',
    desktopBadge: 'Desktop: Ephemeral 24h Story Rail',
    androidImage: 'img/android-moments.png',
    androidAlt: 'BetweenUs Android Ephemeral Moments Screen',
    androidBadge: 'Android: 24h Stories · Native Camera & Media',
    docPath: '/features#7-24-hour-ephemeral-moments',
    description: 'End-to-end sealed ephemeral stories and status updates that automatically purge after 24 hours.',
  },
];

export default function HeroAppShowcase(): React.ReactElement {
  const [activeTabId, setActiveTabId] = useState<string>('chat');
  const [hoveredTarget, setHoveredTarget] = useState<'desktop' | 'android' | null>(null);
  const [deviceView, setDeviceView] = useState<'all' | 'android' | 'desktop'>('all');

  const activeTab = TABS.find((t) => t.id === activeTabId) || TABS[0];
  const desktopSrc = useBaseUrl(activeTab.desktopImage);
  const androidSrc = useBaseUrl(activeTab.androidImage);

  return (
    <div className={styles.showcaseRoot}>
      {/* Dynamic Ambient Background Glow */}
      <div className={styles.ambientGlow} />

      {/* Feature Selector Tabs */}
      <div className={styles.tabsHeader}>
        <div className={styles.tabList} role="tablist" aria-label="Feature showcase switcher">
          {TABS.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTabId(tab.id)}
                className={`${styles.tabButton} ${isActive ? styles.tabButtonActive : ''}`}
              >
                <span className={styles.tabIcon}>{tab.icon}</span>
                <span className={styles.tabLabel}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Caption & Quick Link */}
      <p className={styles.tabDescription}>
        {activeTab.description}{' '}
        <Link to={activeTab.docPath} className={styles.tabLearnMore}>
          Learn more →
        </Link>
      </p>

      {/* Mobile-Only Device Selector (Android / Desktop / Duo) */}
      <div className={styles.mobileDeviceSwitcher} role="group" aria-label="Device view switcher">
        <button
          type="button"
          onClick={() => setDeviceView('android')}
          className={`${styles.mobileSwitchBtn} ${deviceView === 'android' ? styles.mobileSwitchBtnActive : ''}`}
        >
          📱 Android
        </button>
        <button
          type="button"
          onClick={() => setDeviceView('desktop')}
          className={`${styles.mobileSwitchBtn} ${deviceView === 'desktop' ? styles.mobileSwitchBtnActive : ''}`}
        >
          🖥️ Desktop
        </button>
        <button
          type="button"
          onClick={() => setDeviceView('all')}
          className={`${styles.mobileSwitchBtn} ${deviceView === 'all' ? styles.mobileSwitchBtnActive : ''}`}
        >
          📱+🖥️ Both
        </button>
      </div>

      {/* Device Stage: Desktop Window + Overlapping Android Phone */}
      <div className={styles.stageContainer}>
        {/* 1. DESKTOP WINDOW MOCKUP */}
        <div
          className={`${styles.desktopWindow} ${
            deviceView === 'android' ? styles.hideOnMobile : ''
          } ${hoveredTarget === 'desktop' ? styles.desktopWindowFocused : ''}`}
          onMouseEnter={() => setHoveredTarget('desktop')}
          onMouseLeave={() => setHoveredTarget(null)}
        >
          {/* Window Titlebar */}
          <div className={styles.windowTitlebar}>
            <div className={styles.trafficLights}>
              <span className={styles.dotClose} />
              <span className={styles.dotMinimize} />
              <span className={styles.dotMaximize} />
            </div>
            <div className={styles.windowTitle}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className={styles.lockIcon}
              >
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span className={styles.windowTitleText}>BetweenUs — #general</span>
              <span className={styles.windowTitleTag}>E2EE</span>
            </div>
            <div className={styles.desktopPlatformTag}>
              <span className={styles.platformBadge}>
                <span className={styles.platformBadgeFull}>🖥️ Desktop (Windows / macOS / Linux)</span>
                <span className={styles.platformBadgeShort}>🖥️ Desktop</span>
              </span>
            </div>
          </div>

          {/* Desktop Image Viewport */}
          <div className={styles.desktopScreen}>
            <img
              src={desktopSrc}
              alt={activeTab.desktopAlt}
              className={styles.desktopImage}
              loading="eager"
            />
            <div className={styles.desktopFloatingTag}>{activeTab.desktopBadge}</div>
          </div>
        </div>

        {/* 2. NATIVE ANDROID PHONE MOCKUP */}
        <div
          className={`${styles.phoneMockup} ${
            deviceView === 'desktop' ? styles.hideOnMobile : ''
          } ${hoveredTarget === 'android' ? styles.phoneMockupFocused : ''}`}
          onMouseEnter={() => setHoveredTarget('android')}
          onMouseLeave={() => setHoveredTarget(null)}
        >
          {/* Floating Mobile Badge (Always anchors cleanly to phone mockup) */}
          <div className={styles.phoneFloatingBadge}>
            <span className={styles.phoneBadgeText}>📱 Native Android (Compose)</span>
          </div>

          {/* Phone Speaker Slit & Dynamic Punch Hole */}
          <div className={styles.phoneHardwareTop}>
            <div className={styles.phoneSpeaker} />
            <div className={styles.phoneCamera} />
          </div>

          {/* Phone Screen Display */}
          <div className={styles.phoneScreen}>
            <img
              src={androidSrc}
              alt={activeTab.androidAlt}
              className={styles.phoneImage}
              loading="eager"
            />
          </div>

          {/* Phone Bottom Home Indicator */}
          <div className={styles.phoneHardwareBottom}>
            <div className={styles.homeIndicator} />
          </div>
        </div>
      </div>
    </div>
  );
}
