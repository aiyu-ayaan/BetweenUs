/**
 * The web client.
 *
 * There is no second copy of the UI: this bundle mounts the same React app the
 * Electron renderer does, straight out of `apps/desktop/src`. What differs is
 * the runtime, and the app asks about that itself - see
 * `apps/desktop/src/services/platform.ts` for what a browser tab does not get,
 * which is the remote-desktop section and nothing else.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../../desktop/src/App';
import '../../desktop/src/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
