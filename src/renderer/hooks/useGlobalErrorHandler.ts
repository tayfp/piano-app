/**
 * Global Error Handler Hook
 * 
 * Captures and manages application-level errors.
 * Handles both synchronous errors and unhandled promise rejections.
 */

import { useState, useEffect } from 'react';
import { perfLogger } from '@/renderer/utils/performance-logger';

export function useGlobalErrorHandler() {
  const [appError, setAppError] = useState<Error | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      perfLogger.error('Global error caught:', event);
      setAppError(new Error(`${event.message} at ${event.filename}:${event.lineno}:${event.colno}`));
    };
    
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      perfLogger.error('Unhandled promise rejection:', event);
      setAppError(new Error(`Unhandled promise rejection: ${event.reason}`));
    };
    
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  const clearError = () => setAppError(null);

  return { appError, setAppError, clearError };
}