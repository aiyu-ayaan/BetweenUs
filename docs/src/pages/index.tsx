import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import HomepageSetup from '@site/src/components/HomepageSetup';
import HeroAppShowcase from '@site/src/components/HeroAppShowcase';

import styles from './index.module.css';

const STACK = [
  'Electron',
  'React',
  'TypeScript',
  'NestJS',
  'WebRTC',
  'PostgreSQL',
  'Redis',
  'Kotlin / Compose',
];

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.heroBanner}>
      <div className={clsx('container', styles.heroInner)}>
        <span className={styles.heroBadge}>Discord-like · E2EE · self-hosted</span>
        <h1 className={styles.heroTitle}>{siteConfig.title}</h1>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
        <HeroAppShowcase />
        <div className={styles.buttons}>
          <Link
            className={clsx(
              'button button--lg',
              styles.primaryButton,
            )}
            to="/features">
            Explore Features
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="/intro">
            Read the docs
          </Link>
          <Link
            className="button button--secondary button--lg"
            href="https://github.com/aiyu-ayaan/BetweenUs/releases">
            Download App
          </Link>
        </div>
        <div className={styles.stack}>
          {STACK.map((tech) => (
            <span key={tech} className={styles.stackPill}>
              {tech}
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}

function ClosingCta() {
  return (
    <div className={styles.ctaSection}>
      <h2 className={styles.ctaTitle}>Architecture, database schema, and every service's API</h2>
      <p className={styles.ctaSubtitle}>
        Generated and maintained against the actual source — where a page and
        the code disagree, the code is right.
      </p>
      <div className={styles.buttons}>
        <Link
          className={clsx('button button--lg', styles.primaryButton)}
          to="/architecture/overview">
          Explore the architecture
        </Link>
        <Link className="button button--secondary button--lg" to="/features">
          View all features
        </Link>
      </div>
    </div>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="Architecture, system design, setups, and deployment docs for BetweenUs">
      <HomepageHeader />
      <main>
        <section className={styles.section}>
          <div className="container">
            <p className={styles.sectionHeading}>Core Capabilities</p>
            <h2 className={styles.sectionTitle}>
              Engineered for Privacy, Real-Time Media & Remote Control
            </h2>
            <HomepageFeatures />
          </div>
        </section>

        <section className={clsx(styles.section, styles.sectionAlt)}>
          <div className="container">
            <p className={styles.sectionHeading}>Installation & Setup</p>
            <h2 className={styles.sectionTitle}>
              Get started with BetweenUs
            </h2>
            <HomepageSetup />
          </div>
        </section>

        <ClosingCta />
      </main>
    </Layout>
  );
}
