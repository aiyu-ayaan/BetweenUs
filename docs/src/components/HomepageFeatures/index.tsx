import type {ReactNode} from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: ReactNode;
  icon: ReactNode;
};

const ChatIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M21 12a8 8 0 1 1-3.35-6.5" strokeLinecap="round" />
    <path d="M21 5v5h-5" strokeLinecap="round" strokeLinejoin="round" />
    <path
      d="M8 11h6M8 14h4"
      strokeLinecap="round"
    />
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

const FeatureList: FeatureItem[] = [
  {
    title: 'Chat, calls, screen share',
    icon: ChatIcon,
    description: (
      <>
        Servers, text channels, direct messages, voice and video calls, and
        screen sharing — all peer-to-peer over WebRTC, with no media server.
      </>
    ),
  },
  {
    title: 'Remote desktop, done safely',
    icon: ShieldIcon,
    description: (
      <>
        Screen viewing, remote control, clipboard and file transfer, gated
        by explicit per-machine, per-user permissions with a full audit
        trail.
      </>
    ),
  },
  {
    title: 'Independently deployable services',
    icon: LayersIcon,
    description: (
      <>
        A NestJS microservice per concern, behind Nginx and a Cloudflare
        Tunnel, backed by PostgreSQL and Redis. Desktop, web and Android
        clients share one API.
      </>
    ),
  },
];

function Feature({title, description, icon}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
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
