import React from 'react';
import Layout from '@theme/Layout';
import CodeReferenceExplorer from '@site/src/components/CodeReferenceExplorer';
import EngineeringBadges from '@site/src/components/EngineeringBadges';
import styles from './styles.module.css';

export default function CodeReferencePage(): React.ReactElement {
  return (
    <Layout
      title="Code Reference & Source Browser"
      description="Live interactive code reference and source explorer for BetweenUs — shared types, database schema, real-time WebSocket gateways, and Android E2EE cryptography."
    >
      <main className={styles.fullWidthWrapper}>
        <div className={styles.headerSection}>
          <h1 className={styles.pageTitle}>
            Code & API Reference
          </h1>
          <p className={styles.pageSubtitle}>
            Browse the actual source code, interfaces, data models, and cryptographic protocols directly from the BetweenUs repository. Inspect full files with all documentation comments, search symbols, and copy definitions.
          </p>

          {/* Code Health & Repository Metric Badges */}
          <EngineeringBadges />
        </div>

        <CodeReferenceExplorer />
      </main>
    </Layout>
  );
}
