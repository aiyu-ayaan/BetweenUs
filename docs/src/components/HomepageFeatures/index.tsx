import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  badge: string;
  image: string;
  link: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'E2EE Chat & Rich Markdown',
    badge: 'AES-256-GCM',
    image: 'img/feature-chat.png',
    link: '/features#1-end-to-end-encrypted-messaging',
    description: (
      <>
        Zero-knowledge encrypted messaging and file attachments up to 100 MB.
        Live markdown preview, emoji reactions, threaded replies, and message pinning.
      </>
    ),
  },
  {
    title: 'P2P Voice, Video & Screen Sharing',
    badge: 'WebRTC Mesh',
    image: 'img/feature-voice.png',
    link: '/features#2-peer-to-peer-voice-and-video-calls',
    description: (
      <>
        Autonomous mesh calls with zero media server overhead. Includes noise suppression,
        mic calibration, and low-latency 4K / 60 FPS screen sharing.
      </>
    ),
  },
  {
    title: 'Listen & Play Together',
    badge: 'Synchronized Media & Games',
    image: 'img/feature-listen.png',
    link: '/features#3-listen-together-synchronized-youtube',
    description: (
      <>
        Synchronized YouTube player with zero host uplink and dynamic voice ducking,
        plus 6 multiplayer games including deterministic 2D Carrom physics.
      </>
    ),
  },
  {
    title: '16-Theme Customization Engine',
    badge: '16 Themes + 8 Accents',
    image: 'img/feature-themes.png',
    link: '/features#5-multi-theme-customization-engine',
    description: (
      <>
        Dark (Iris), AMOLED Midnight, Nord Frost, Tokyo Night, Catppuccin, Cyberpunk Neon,
        and Daylight with customizable accent tints and OS synchronization.
      </>
    ),
  },
  {
    title: 'Secure Remote Desktop Access',
    badge: 'Permissioned Access',
    image: 'img/feature-remote.png',
    link: '/features#6-secure-remote-desktop-access',
    description: (
      <>
        Low-latency remote machine control with multi-monitor streaming, clipboard sync,
        and granular per-device permission tiers with instant revocation.
      </>
    ),
  },
  {
    title: '24-Hour Ephemeral Moments',
    badge: 'Auto-Purging Stories',
    image: 'img/feature-moments.png',
    link: '/features#7-24-hour-ephemeral-moments',
    description: (
      <>
        Share photos and status updates that automatically disappear after 24 hours.
        Configurable friends-only privacy boundaries and dedicated moments feed.
      </>
    ),
  },
  {
    title: 'Security & Zero-Knowledge Backup',
    badge: 'Identity Registry',
    image: 'img/feature-e2ee.png',
    link: '/features#8-security-key-backup-and-identity',
    description: (
      <>
        Client-generated cryptographic identity keys, encrypted passphrase backups, and
        active machine directory with one-click device revocation.
      </>
    ),
  },
  {
    title: 'Granular Server Governance & RBAC',
    badge: 'Discord-Grade Roles',
    image: 'img/feature-roles.png',
    link: '/features#9-granular-server-governance-and-rbac',
    description: (
      <>
        Hierarchical role management with color pickers, hoisted display groups, channel-level
        permission overrides, and comprehensive audit logs.
      </>
    ),
  },
  {
    title: 'Desktop, Web & Native Android',
    badge: 'Cross-Platform Parity',
    image: 'img/android-home.png',
    link: '/features#11-native-android-mobile-experience',
    description: (
      <>
        Cross-platform suite spanning Electron desktop on Windows/macOS/Linux, Web PWA via Vite,
        and native Kotlin/Jetpack Compose Android client with FCM background push.
      </>
    ),
  },
];

function Feature({title, badge, image, link, description}: FeatureItem) {
  const imageUrl = useBaseUrl(image);
  return (
    <div className={clsx('col col--4', 'margin-bottom--lg')}>
      <div className={styles.featureCard}>
        <Link to={link} className={styles.featureImageLink} aria-label={title}>
          <div className={styles.featureImageWrapper}>
            <img src={imageUrl} alt={title} className={styles.featureImage} loading="lazy" />
            <span className={styles.featureBadge}>{badge}</span>
          </div>
        </Link>
        <div className={styles.featureContent}>
          <h3 className={styles.featureTitle}>
            <Link to={link} className={styles.featureTitleLink}>
              {title}
            </Link>
          </h3>
          <p className={styles.featureDescription}>{description}</p>
          <div className={styles.featureFooter}>
            <Link to={link} className={styles.featureActionLink}>
              Explore details →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
