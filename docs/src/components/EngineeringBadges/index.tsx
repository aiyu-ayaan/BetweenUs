import React from 'react';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

export interface BadgeItem {
  id: string;
  label: string;
  value: string;
  icon: string;
  variant?: 'iris' | 'emerald' | 'cyan' | 'amber' | 'purple' | 'blue';
  link?: string;
  tooltip?: string;
}

const DEFAULT_BADGES: BadgeItem[] = [
  {
    id: 'loc',
    label: 'Lines of Code',
    value: '159,348 LOC',
    icon: '📊',
    variant: 'iris',
    link: '/reference',
    tooltip: 'Total source code lines across 745 indexed repository files',
  },
  {
    id: 'health',
    label: 'Code Health',
    value: '99.8% (A+)',
    icon: '🛡️',
    variant: 'emerald',
    link: '/reference',
    tooltip: 'Strict TypeScript + Kotlin compiler checks, zero any escape-hatches',
  },
  {
    id: 'e2ee',
    label: 'Encryption',
    value: 'AES-256-GCM',
    icon: '🔒',
    variant: 'cyan',
    link: '/security/e2ee',
    tooltip: 'Zero-knowledge end-to-end sealed messaging and KeyStore wrapping',
  },
  {
    id: 'services',
    label: 'Architecture',
    value: '7 Microservices',
    icon: '⚡',
    variant: 'purple',
    link: '/services/overview',
    tooltip: 'NestJS domain services orchestrated with Turborepo',
  },
  {
    id: 'android',
    label: 'Android',
    value: 'Jetpack Compose',
    icon: '📱',
    variant: 'emerald',
    link: '/architecture/android-client',
    tooltip: 'Native Android 15 (API 35) with StrongBox KeyStore',
  },
  {
    id: 'webrtc',
    label: 'Voice & Video',
    value: 'P2P WebRTC',
    icon: '🔊',
    variant: 'blue',
    link: '/architecture/media',
    tooltip: 'Decentralized media mesh with zero server transcoding relays',
  },
  {
    id: 'themes',
    label: 'Appearance',
    value: '16 Themes',
    icon: '🎨',
    variant: 'amber',
    link: '/architecture/themes',
    tooltip: '16 curated design token themes and 8 dynamic accents',
  },
];

interface Props {
  badges?: BadgeItem[];
  className?: string;
}

export default function EngineeringBadges({
  badges = DEFAULT_BADGES,
  className = '',
}: Props): React.ReactElement {
  return (
    <div className={`${styles.badgeStrip} ${className}`} role="list" aria-label="Repository metrics & engineering badges">
      {badges.map((b) => {
        const content = (
          <div className={`${styles.badgeCard} ${styles[`variant_${b.variant || 'iris'}`]}`}>
            <span className={styles.badgeIcon}>{b.icon}</span>
            <div className={styles.badgeText}>
              <span className={styles.badgeLabel}>{b.label}</span>
              <span className={styles.badgeValue}>{b.value}</span>
            </div>
          </div>
        );

        if (b.link) {
          return (
            <Link
              key={b.id}
              to={b.link}
              className={styles.badgeLink}
              title={b.tooltip || `${b.label}: ${b.value}`}
              role="listitem"
            >
              {content}
            </Link>
          );
        }

        return (
          <div
            key={b.id}
            className={styles.badgeLink}
            title={b.tooltip || `${b.label}: ${b.value}`}
            role="listitem"
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
