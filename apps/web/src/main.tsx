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
import { initTheme } from '../../desktop/src/stores/theme';

// Apply saved theme immediately before render
initTheme();

/**
 * No browser context menu, anywhere.
 *
 * The app puts its own menu on a message, and having Chrome's - Back, Reload,
 * View source, Inspect - appear a pixel outside it is the tell that this is a
 * web page rather than the application it is trying to be. This is the whole
 * of the difference: the Electron build has no such menu to suppress.
 *
 * On the bubble phase deliberately. React's own handlers run first, on the
 * root container, so the message menu still opens - this only takes away what
 * the browser would have drawn afterwards.
 */
document.addEventListener('contextmenu', (event) => event.preventDefault());

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
