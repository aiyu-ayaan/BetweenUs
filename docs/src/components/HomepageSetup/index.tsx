import {useState, type ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

type TabKey = 'client' | 'docker' | 'local';

interface SetupStep {
  title: string;
  detail: string;
  command?: string;
}

interface TabContent {
  title: string;
  badge: string;
  description: string;
  steps: SetupStep[];
  docsLink: string;
  docsLabel: string;
}

const TAB_DATA: Record<TabKey, TabContent> = {
  client: {
    title: 'Install Desktop & Mobile Apps',
    badge: 'End Users',
    description:
      'Download pre-built binaries for Windows, macOS, Linux, or Android APK. Connect directly to any self-hosted BetweenUs deployment.',
    steps: [
      {
        title: 'Download Desktop Release',
        detail:
          'Get the latest installer or portable executable (.exe / .AppImage / .dmg) from GitHub Releases.',
        command: '# Download from https://github.com/aiyu-ayaan/BetweenUs/releases\n# Or package locally from source:\npnpm desktop:package',
      },
      {
        title: 'Android Native Client',
        detail:
          'Install the Android APK on your phone for native E2EE chat, push notifications (FCM), voice calls, and gallery media saving.',
        command: '# Or build the debug APK with JDK 21:\ncd apps/android && ./gradlew assembleDebug',
      },
      {
        title: 'Connect & Sign In',
        detail:
          'Open the app, choose your deployment server URL (or use default), and register or sign in with Google/GitHub/password.',
      },
    ],
    docsLink: '/running-locally',
    docsLabel: 'View client build guide',
  },
  docker: {
    title: 'Self-Host with Docker Compose',
    badge: 'Operators / Production',
    description:
      'Deploy the full microservices stack behind Nginx and Cloudflare Tunnel using official published container images. No repo clone required.',
    steps: [
      {
        title: 'One-line installer script',
        detail:
          'Fetches the docker-compose manifest, nginx configuration, and generates secure secrets in a local directory:',
        command: 'curl -fsSL https://raw.githubusercontent.com/aiyu-ayaan/BetweenUs/master/scripts/install.sh | sh',
      },
      {
        title: 'Configure environment',
        detail:
          'Enter the directory and edit .env to set your public domain (PUBLIC_API_URL, CLOUDFLARE_TUNNEL_TOKEN):',
        command: 'cd betweenus\nnano .env',
      },
      {
        title: 'Pull images & start services',
        detail:
          'Launch PostgreSQL, Redis, all NestJS microservices, Nginx API gateway, and web client with one command:',
        command: 'docker compose --env-file .env -f infrastructure/docker/docker-compose.yml pull\ndocker compose --env-file .env -f infrastructure/docker/docker-compose.yml up -d',
      },
    ],
    docsLink: '/deployment/docker-compose',
    docsLabel: 'View full Docker deployment docs',
  },
  local: {
    title: 'Run Locally for Development',
    badge: 'Contributors / Developers',
    description:
      'Fast inner dev loop with hot reload, monorepo tooling (pnpm + Turbo), and multi-window test harness.',
    steps: [
      {
        title: 'Clone & configure environment',
        detail: 'Clone the monorepo and copy the environment template:',
        command: 'git clone https://github.com/aiyu-ayaan/BetweenUs.git betweenus\ncd betweenus\ncp .env.example .env',
      },
      {
        title: 'Install dependencies & prepare database',
        detail: 'Start local PostgreSQL + Redis in Docker, generate Prisma client, and run migrations:',
        command: 'pnpm install\npnpm dev:infra\npnpm db:generate\npnpm db:migrate',
      },
      {
        title: 'Start backend & launch test windows',
        detail:
          'Run all microservices in watch mode, and launch two pre-authenticated windows side-by-side to test chat, voice, and Listen Together:',
        command: '# Terminal 1: backend services\npnpm dev:backend\n\n# Terminal 2: two test clients\npnpm dev:duo',
      },
    ],
    docsLink: '/running-locally',
    docsLabel: 'View local development guide',
  },
};

export default function HomepageSetup(): ReactNode {
  const [activeTab, setActiveTab] = useState<TabKey>('client');
  const current = TAB_DATA[activeTab];

  return (
    <section className={styles.setupSection}>
      <div className={clsx('container', styles.setupContainer)}>
        <div className={styles.tabList}>
          <button
            type="button"
            className={clsx(
              styles.tabButton,
              activeTab === 'client' && styles.tabButtonActive,
            )}
            onClick={() => setActiveTab('client')}>
            <span>💻</span> Desktop & Mobile Apps
          </button>
          <button
            type="button"
            className={clsx(
              styles.tabButton,
              activeTab === 'docker' && styles.tabButtonActive,
            )}
            onClick={() => setActiveTab('docker')}>
            <span>🐳</span> Self-Host (Docker)
          </button>
          <button
            type="button"
            className={clsx(
              styles.tabButton,
              activeTab === 'local' && styles.tabButtonActive,
            )}
            onClick={() => setActiveTab('local')}>
            <span>⚡</span> Local Development
          </button>
        </div>

        <div className={styles.setupCard}>
          <div className={styles.setupHeader}>
            <div className={styles.setupTitle}>
              {current.title}
              <span className="badge badge--secondary">{current.badge}</span>
            </div>
            <p className={styles.setupDesc}>{current.description}</p>
          </div>

          <div className={styles.stepsList}>
            {current.steps.map((step, idx) => (
              <div key={idx} className={styles.stepItem}>
                <div className={styles.stepNumber}>{idx + 1}</div>
                <div className={styles.stepContent}>
                  <div className={styles.stepTitle}>{step.title}</div>
                  <div className={styles.stepDetail}>{step.detail}</div>
                  {step.command && (
                    <pre className={styles.codeSnippet}>
                      <code>{step.command}</code>
                    </pre>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.footerLinks}>
            <p className={styles.footerNote}>
              Need more options or custom configurations?
            </p>
            <Link className={styles.actionLink} to={current.docsLink}>
              {current.docsLabel} &rarr;
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
