/**
 * Error Display Component
 * 
 * Shows application errors with stack trace details.
 * Extracted from App.tsx for reusability.
 */

import React from 'react';
import { AppLayout } from './Layout/AppLayout';

interface ErrorDisplayProps {
  error: Error;
  onClearError: () => void;
}

export function ErrorDisplay({ error, onClearError }: ErrorDisplayProps) {
  return (
    <AppLayout>
      <div style={{ padding: '20px', backgroundColor: '#fee', color: '#c00' }}>
        <h2>Application Error</h2>
        <p>{error.message}</p>
        <details>
          <summary>Stack trace</summary>
          <pre>{error.stack}</pre>
        </details>
        <button onClick={onClearError}>Try to Continue</button>
      </div>
    </AppLayout>
  );
}