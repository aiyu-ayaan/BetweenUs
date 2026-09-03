import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Architecture',
      link: {
        type: 'doc',
        id: 'architecture/overview',
      },
      items: [
        'architecture/overview',
        'architecture/android-client',
        'architecture/media',
        'architecture/listen-together',
        'architecture/play-together',
        'architecture/remote-desktop',
        'architecture/themes',
        'architecture/notifications',
        'architecture/push-suppression',
        'architecture/microservices',
      ],
    },
    {
      type: 'category',
      label: 'System Design',
      items: [
        'system-design/auth-and-permissions',
        'system-design/events',
        'system-design/ingress',
      ],
    },
    {
      type: 'category',
      label: 'Services',
      link: {
        type: 'doc',
        id: 'services/overview',
      },
      items: [
        'services/overview',
        'services/auth-service',
        'services/chat-service',
        'services/call-service',
        'services/server-service',
        'services/presence-service',
        'services/notification-service',
        'services/remote-gateway',
        'services/webhooks',
      ],
    },
    {
      type: 'category',
      label: 'Database',
      items: [
        'database/schema',
      ],
    },
    {
      type: 'category',
      label: 'Security',
      link: {
        type: 'doc',
        id: 'security/overview',
      },
      items: [
        'security/overview',
        'security/e2ee',
      ],
    },
    {
      type: 'category',
      label: 'Deployment & CI/CD',
      link: {
        type: 'doc',
        id: 'deployment/docker-compose',
      },
      items: [
        'deployment/docker-compose',
        'deployment/release-pipeline',
        'deployment/client-updates',
        'deployment/turn-server',
        'deployment/turn-server-oracle',
        'deployment/ci',
        'deployment/docs-deployment',
      ],
    },
    {
      type: 'category',
      label: 'Code Reference',
      link: {
        type: 'doc',
        id: 'reference/overview',
      },
      items: [
        'reference/overview',
        'reference/shared-types',
        'reference/api-endpoints',
        'reference/websocket-protocol',
        'reference/database-schema',
        'reference/android-core',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'running-locally',
        'testing',
      ],
    },
  ],
};

export default sidebars;
