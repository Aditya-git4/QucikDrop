import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { ErrorBoundary } from './App.jsx';
import './index.css';

// Log Vite chunk preload error if any
window.addEventListener('vite:preloadError', (event) => {
  console.warn('Vite preload error:', event);
});

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}

// Register Progressive Web App Service Worker with automatic update checks
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  // Check if there was already an active controller controlling this page before this script runs
  const hadPreviousController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only dispatch update notice if there was an existing controller before this update
    // (avoids displaying false "new version" banner on the very first installation)
    if (!hadPreviousController) {
      return;
    }
    window.dispatchEvent(new CustomEvent('quickdrop:new-version'));
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const installingWorker = reg.installing;
          if (installingWorker) {
            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New content is available once worker installs
                window.dispatchEvent(new CustomEvent('quickdrop:new-version'));
              }
            });
          }
        });

        // Check for service worker updates immediately on page load
        reg.update().catch(() => {});
      })
      .catch((err) => {
        console.warn('PWA ServiceWorker registration failed:', err);
      });
  });
}
