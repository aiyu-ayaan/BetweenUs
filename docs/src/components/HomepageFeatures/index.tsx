import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Chat, calls, screen share',
    description: (
      <>
        Servers, text channels, direct messages, voice and video calls, and
        screen sharing — all peer-to-peer over WebRTC, with no media server.
      </>
    ),
  },
  {
    title: 'Remote desktop, done safely',
    description: (
      <>
        Screen viewing, remote control, clipboard and file transfer, gated by
        explicit per-machine, per-user permissions with a full audit trail.
      </>
    ),
  },
  {
    title: 'Independently deployable services',
    description: (
      <>
        A NestJS microservice per concern, behind Nginx and a Cloudflare
        Tunnel, backed by PostgreSQL and Redis. Desktop, web and Android
        clients share one API.
      </>
    ),
  },
];

function Feature({title, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
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
