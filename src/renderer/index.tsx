import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { useFingeringStore } from './features/fingering/stores/fingeringStore';
import { perfLogger } from './utils/performance-logger';
import { IS_DEVELOPMENT } from './utils/env';

// Global error handlers
window.addEventListener('error', (event) => {
  // Always log errors for production monitoring
  window.api?.logError?.({
    message: event.error?.message || 'Unknown error',
    stack: event.error?.stack,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
});

window.addEventListener('unhandledrejection', (event) => {
  // Always log promise rejections for production monitoring
  window.api?.logError?.({
    message: event.reason?.message || 'Unhandled promise rejection',
    stack: event.reason?.stack,
    reason: String(event.reason)
  });
});

// Development-only: Expose stores to window for console access
if (IS_DEVELOPMENT) {
  (window as any).useFingeringStore = useFingeringStore;
  perfLogger.debug('[DEV] Fingering store exposed to window.useFingeringStore');
}

// Global keyboard shortcuts
window.addEventListener('keydown', (event) => {
  // Developer-only: Clear all fingerings (Ctrl+Shift+F)
  if (IS_DEVELOPMENT && event.ctrlKey && event.shiftKey && (event.key === 'f' || event.key === 'F')) {
    // Don't trigger if typing in input fields
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }
    
    event.preventDefault();
    
    // Clear all fingerings from both memory and database
    useFingeringStore.getState().clearAllFingerings().then(() => {
      perfLogger.debug('[DEV] All fingerings cleared via keyboard shortcut (Ctrl+Shift+F)');
      console.log('✅ All fingerings cleared from memory and database');
    }).catch((error) => {
      perfLogger.error('[DEV] Failed to clear fingerings:', error);
      console.error('❌ Failed to clear fingerings:', error);
    });
  }
});

// Render the React app
const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <GlobalErrorBoundary>
    <App />
  </GlobalErrorBoundary>
);

