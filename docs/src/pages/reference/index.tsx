import React from 'react';
import Layout from '@theme/Layout';
import CodeReferenceExplorer from '@site/src/components/CodeReferenceExplorer';

export default function CodeReferencePage(): React.ReactElement {
  return (
    <Layout
      title="Code Reference & Source Browser"
      description="Live interactive code reference and source explorer for BetweenUs — shared types, database schema, real-time WebSocket gateways, and Android E2EE cryptography."
    >
      <main className="container margin-vert--lg">
        <div style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '2.2rem', fontWeight: 800, marginBottom: '0.5rem' }}>
            Code & API Reference
          </h1>
          <p style={{ fontSize: '1.05rem', color: 'var(--ifm-color-emphasis-700)', maxWidth: '800px' }}>
            Browse the actual source code, interfaces, data models, and cryptographic protocols directly from the BetweenUs repository. Inspect full files with all documentation comments, search symbols, and copy definitions.
          </p>
        </div>

        <CodeReferenceExplorer />
      </main>
    </Layout>
  );
}
