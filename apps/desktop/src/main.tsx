import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// The browser context menu has nothing on it we want: reload, view source,
// inspect. Editable fields keep theirs, because cut/copy/paste live there.
window.addEventListener('contextmenu', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea, [contenteditable="true"]')) return;
  event.preventDefault();
});

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
