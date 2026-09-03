import React, { useState } from 'react';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

interface ThemePreset {
  id: string;
  name: string;
  category: string;
  ground: string;
  surface: string;
  surfaceActive: string;
  accent: string;
  accentHover: string;
  text: string;
  muted: string;
  tag: string;
}

const THEMES: ThemePreset[] = [
  {
    id: 'midnight-iris',
    name: 'Midnight Iris',
    category: 'Signature',
    ground: '#06070a',
    surface: '#0f111a',
    surfaceActive: 'rgba(124, 92, 255, 0.2)',
    accent: '#7c5cff',
    accentHover: '#6a44f5',
    text: '#ffffff',
    muted: '#94a3b8',
    tag: 'Default Workbench',
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    category: 'Vibrant',
    ground: '#1a1b26',
    surface: '#24283b',
    surfaceActive: 'rgba(122, 162, 247, 0.2)',
    accent: '#7aa2f7',
    accentHover: '#89ddff',
    text: '#c0caf5',
    muted: '#565f89',
    tag: 'Neon Tokyo',
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin Mocha',
    category: 'Pastel',
    ground: '#1e1e2e',
    surface: '#313244',
    surfaceActive: 'rgba(203, 166, 247, 0.2)',
    accent: '#cba6f7',
    accentHover: '#f5c2e7',
    text: '#cdd6f4',
    muted: '#6c7086',
    tag: 'Community Favorite',
  },
  {
    id: 'nord',
    name: 'Nord Frost',
    category: 'Palette',
    ground: '#2e3440',
    surface: '#3b4252',
    surfaceActive: 'rgba(136, 192, 208, 0.2)',
    accent: '#88c0d0',
    accentHover: '#81a1c1',
    text: '#eceff4',
    muted: '#4c566a',
    tag: 'Arctic Clean',
  },
  {
    id: 'dracula',
    name: 'Dracula',
    category: 'Developer',
    ground: '#282a36',
    surface: '#44475a',
    surfaceActive: 'rgba(189, 147, 249, 0.2)',
    accent: '#bd93f9',
    accentHover: '#ff79c6',
    text: '#f8f8f2',
    muted: '#6272a4',
    tag: 'Classic Dark',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk 2077',
    category: 'Vibrant',
    ground: '#050510',
    surface: '#120b24',
    surfaceActive: 'rgba(0, 255, 204, 0.2)',
    accent: '#00ffcc',
    accentHover: '#ff007f',
    text: '#ffffff',
    muted: '#715a99',
    tag: 'High Contrast',
  },
  {
    id: 'emerald',
    name: 'Emerald Forest',
    category: 'Palette',
    ground: '#0b1612',
    surface: '#132820',
    surfaceActive: 'rgba(16, 185, 129, 0.2)',
    accent: '#10b981',
    accentHover: '#34d399',
    text: '#ecfdf5',
    muted: '#4b7564',
    tag: 'Calm Nature',
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    category: 'Warm',
    ground: '#191724',
    surface: '#26233a',
    surfaceActive: 'rgba(235, 188, 186, 0.2)',
    accent: '#ebbcba',
    accentHover: '#f6c177',
    text: '#e0def4',
    muted: '#6e6a86',
    tag: 'Soothing Warmth',
  },
];

export default function HomepageThemeShowcase(): React.ReactElement {
  const [activeThemeId, setActiveThemeId] = useState<string>('midnight-iris');

  const theme = THEMES.find((t) => t.id === activeThemeId) || THEMES[0];

  return (
    <section className={styles.showcaseSection}>
      <div className="container">
        <div className={styles.sectionHeadingWrapper}>
          <span className={styles.sectionBadge}>16 CURATED THEMES</span>
          <h2 className={styles.sectionTitle}>
            Adaptive Appearance & Design Token Engine
          </h2>
          <p className={styles.sectionSubtitle}>
            BetweenUs features 16 hand-crafted color palettes and 8 accent choices with
            zero reload delay. Click any theme below to preview the live UI adaptation.
          </p>
        </div>

        {/* Theme Selectors */}
        <div className={styles.themeSelectorGrid} role="tablist" aria-label="Theme selectors">
          {THEMES.map((t) => {
            const isSelected = t.id === activeThemeId;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setActiveThemeId(t.id)}
                className={`${styles.themeButton} ${isSelected ? styles.themeButtonActive : ''}`}
              >
                <span className={styles.colorPill}>
                  <span
                    className={styles.colorDot}
                    style={{ background: t.ground }}
                  />
                  <span
                    className={styles.colorDot}
                    style={{ background: t.surface }}
                  />
                  <span
                    className={styles.colorDot}
                    style={{ background: t.accent }}
                  />
                </span>
                <span className={styles.themeName}>{t.name}</span>
                {isSelected && <span className={styles.activeCheck}>✓</span>}
              </button>
            );
          })}
        </div>

        {/* Live UI Mockup Card Preview */}
        <div
          className={styles.mockupContainer}
          style={{
            backgroundColor: theme.ground,
            borderColor: `${theme.accent}33`,
            boxShadow: `0 20px 50px -10px ${theme.accent}22`,
          }}
        >
          {/* Header Bar */}
          <div
            className={styles.mockupHeader}
            style={{
              backgroundColor: theme.surface,
              borderBottomColor: `${theme.accent}22`,
            }}
          >
            <div className={styles.mockupTrafficLights}>
              <span className={styles.lightRed} />
              <span className={styles.lightYellow} />
              <span className={styles.lightGreen} />
            </div>
            <div className={styles.mockupTitle} style={{ color: theme.text }}>
              BetweenUs — {theme.name} ({theme.tag})
            </div>
            <div className={styles.mockupBadge} style={{ backgroundColor: `${theme.accent}25`, color: theme.accent, borderColor: `${theme.accent}55` }}>
              E2EE Active
            </div>
          </div>

          {/* Body Columns */}
          <div className={styles.mockupBody}>
            {/* Sidebar */}
            <div
              className={styles.mockupSidebar}
              style={{
                backgroundColor: theme.ground,
                borderRightColor: `${theme.accent}15`,
              }}
            >
              <div className={styles.sidebarLabel} style={{ color: theme.muted }}>
                TEXT CHANNELS
              </div>
              <div
                className={styles.channelItemActive}
                style={{
                  backgroundColor: theme.surfaceActive,
                  color: theme.accent,
                }}
              >
                # general
              </div>
              <div className={styles.channelItem} style={{ color: theme.muted }}>
                # announcements
              </div>
              <div className={styles.channelItem} style={{ color: theme.muted }}>
                # carrom-matches
              </div>

              <div className={styles.sidebarLabel} style={{ color: theme.muted, marginTop: '1rem' }}>
                VOICE & MESH
              </div>
              <div className={styles.channelItem} style={{ color: theme.muted }}>
                🔊 Gaming Lounge (3)
              </div>
              <div className={styles.channelItem} style={{ color: theme.muted }}>
                🖥️ Screen Share (1)
              </div>
            </div>

            {/* Main Chat Area */}
            <div className={styles.mockupChat} style={{ backgroundColor: theme.surface }}>
              {/* Message 1 */}
              <div className={styles.chatMessage}>
                <div
                  className={styles.chatAvatar}
                  style={{ backgroundColor: theme.accent, color: theme.ground }}
                >
                  A
                </div>
                <div className={styles.chatContent}>
                  <div className={styles.chatAuthorRow}>
                    <span className={styles.chatAuthor} style={{ color: theme.text }}>
                      Ayaan
                    </span>
                    <span className={styles.chatRoleBadge} style={{ backgroundColor: `${theme.accent}33`, color: theme.accent }}>
                      OWNER
                    </span>
                    <span className={styles.chatTime} style={{ color: theme.muted }}>
                      Today at 3:14 AM
                    </span>
                  </div>
                  <div className={styles.chatText} style={{ color: theme.text }}>
                    Testing the new <strong>{theme.name}</strong> theme palette across desktop and mobile. All colors adapt seamlessly using our centralized CSS token variables!
                  </div>
                  <div className={styles.reactionRow}>
                    <span
                      className={styles.reactionPill}
                      style={{
                        backgroundColor: theme.surfaceActive,
                        borderColor: `${theme.accent}44`,
                        color: theme.accent,
                      }}
                    >
                      🚀 5
                    </span>
                    <span
                      className={styles.reactionPill}
                      style={{
                        backgroundColor: `${theme.accent}15`,
                        borderColor: `${theme.accent}33`,
                        color: theme.text,
                      }}
                    >
                      🎨 8
                    </span>
                  </div>
                </div>
              </div>

              {/* Message 2 (E2EE Sealed) */}
              <div className={styles.chatMessage}>
                <div
                  className={styles.chatAvatar}
                  style={{ backgroundColor: '#10b981', color: '#000' }}
                >
                  S
                </div>
                <div className={styles.chatContent}>
                  <div className={styles.chatAuthorRow}>
                    <span className={styles.chatAuthor} style={{ color: theme.text }}>
                      Secure Guard
                    </span>
                    <span className={styles.chatRoleBadge} style={{ backgroundColor: 'rgba(16, 185, 129, 0.2)', color: '#6ee7b7' }}>
                      SYSTEM
                    </span>
                  </div>
                  <div className={styles.chatText} style={{ color: theme.muted }}>
                    🔒 End-to-end encrypted session established. Device keys authenticated via StrongBox KeyStore.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Link */}
        <div className={styles.showcaseFooter}>
          <Link to="/architecture/themes" className={styles.exploreThemesLink}>
            Read the Theme Architecture & Token Guide →
          </Link>
        </div>
      </div>
    </section>
  );
}
