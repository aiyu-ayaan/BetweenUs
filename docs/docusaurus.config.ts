import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'BetweenUs',
  tagline: 'A Discord-like communication platform with secure remote desktop access',
  favicon: 'img/icon.svg',

  future: {
    v4: true,
  },

  markdown: {
    mermaid: true,
  },
  themes: [
    '@docusaurus/theme-mermaid',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/',
      },
    ],
  ],

  url: 'https://aiyu-ayaan.github.io',
  // GitHub Pages project pages (this repo isn't the special
  // aiyu-ayaan.github.io one, and there's no custom domain) can only serve
  // from /BetweenUs/ - that's a GitHub Pages rule, not a Docusaurus setting.
  // `docusaurus build` sets NODE_ENV=production, so production keeps the
  // real path while `docusaurus start` (NODE_ENV=development) runs at the
  // plain localhost:3000/ root for local convenience.
  baseUrl: process.env.NODE_ENV === 'production' ? '/BetweenUs/' : '/',

  organizationName: 'aiyu-ayaan',
  projectName: 'BetweenUs',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  // The desktop client's own fonts (tailwind.theme.mjs): Inter for text,
  // JetBrains Mono for code. Neither ships as a system font, so they're
  // pulled from Google Fonts rather than bundled.
  stylesheets: [
    {
      href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap',
      type: 'text/css',
    },
  ],

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: 'https://github.com/aiyu-ayaan/BetweenUs/tree/master/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/home.png',
    // The desktop client is dark-only - "nothing about a light BetweenUs
    // has been designed" (development/ANDROID_TODO.md) - so the docs match
    // it rather than offering a light mode the app itself doesn't have.
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'BetweenUs',
      logo: {
        alt: 'BetweenUs Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/architecture/overview',
          label: 'Architecture',
          position: 'left',
        },
        {
          to: '/services/overview',
          label: 'Services',
          position: 'left',
        },
        {
          to: '/security/overview',
          label: 'Security',
          position: 'left',
        },
        {
          to: '/deployment/docker-compose',
          label: 'Deploy',
          position: 'left',
        },
        {
          href: 'https://github.com/aiyu-ayaan/BetweenUs/releases',
          label: 'Download',
          position: 'left',
        },
        {
          to: '/changelog',
          label: 'Changelog',
          position: 'right',
        },
        {
          href: 'https://github.com/aiyu-ayaan/BetweenUs',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Architecture', to: '/architecture/overview'},
            {label: 'Running Locally', to: '/running-locally'},
            {label: 'Database Schema', to: '/database/schema'},
          ],
        },
        {
          title: 'Project',
          items: [
            {label: 'Download App', href: 'https://github.com/aiyu-ayaan/BetweenUs/releases'},
            {label: 'GitHub', href: 'https://github.com/aiyu-ayaan/BetweenUs'},
            {label: 'Changelog', to: '/changelog'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} BetweenUs. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.dracula,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml', 'docker', 'nginx'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
