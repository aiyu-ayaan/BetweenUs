import type {ReactNode} from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: ReactNode;
  icon: ReactNode;
};

const MusicIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="6" cy="18" r="3" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="18" cy="16" r="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChatIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M21 12a8 8 0 1 1-3.35-6.5" strokeLinecap="round" />
    <path d="M21 5v5h-5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 11h6M8 14h4" strokeLinecap="round" />
  </svg>
);

const VideoIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="2" y="4" width="14" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 9l6-4v14l-6-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ShieldIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path
      d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LayersIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path
      d="M12 3l9 5-9 5-9-5 9-5z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M3 13l9 5 9-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DevicesIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="2" y="3" width="13" height="12" rx="2" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="15" y="8" width="7" height="13" rx="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6 19h5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FeatureList: FeatureItem[] = [
  {
    title: 'Listen Together',
    icon: MusicIcon,
    description: (
      <>
        Synchronised YouTube listening inside voice calls with zero media uplink.
        Browse YouTube in-app, click any thumbnail to play instantly for the call,
        enjoy automatic voice ducking when talking, and shared queue controls with no host bottleneck.
      </>
    ),
  },
  {
    title: 'E2EE Chat & Rich Markdown',
    icon: ChatIcon,
    description: (
      <>
        End-to-end encrypted messaging with AES-256-GCM. Live markdown preview
        in the composer, bulleted/numbered lists, inline code & quotes, custom emoji,
        reactions, replies, and encrypted attachments up to 100 MB.
      </>
    ),
  },
  {
    title: 'P2P Voice, Video & Screen Control',
    icon: VideoIcon,
    description: (
      <>
        Voice and video channels over direct WebRTC mesh without expensive media servers.
        Includes interactive screen sharing where participants can request and take control
        with named multi-user cursor overlays.
      </>
    ),
  },
  {
    title: 'Remote Desktop, Done Safely',
    icon: ShieldIcon,
    description: (
      <>
        Secure remote machine access with screen viewing, keyboard/mouse control,
        multi-monitor selection, and clipboard sync — gated by granular per-machine,
        per-user permission grants and a non-repudiable audit trail.
      </>
    ),
  },
  {
    title: 'Microservices & Ingress',
    icon: LayersIcon,
    description: (
      <>
        Independently deployable NestJS microservices backed by PostgreSQL and Redis.
        Public traffic enters via Cloudflare Tunnel into an Nginx API Gateway with zero
        inbound open ports required.
      </>
    ),
  },
  {
    title: 'Desktop, Web & Native Android',
    icon: DevicesIcon,
    description: (
      <>
        Modern Electron desktop client with tray integration, identical web client mounted via Vite,
        and native Kotlin/Jetpack Compose Android app with FCM push notifications and background survivability.
      </>
    ),
  },
];

function Feature({title, description, icon}: FeatureItem) {
  return (
    <div className={clsx('col col--4', 'margin-bottom--lg')}>
      <div className={styles.featureCard}>
        <div className={styles.featureIcon}>{icon}</div>
        <h3 className={styles.featureTitle}>{title}</h3>
        <p className={styles.featureDescription}>{description}</p>
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
