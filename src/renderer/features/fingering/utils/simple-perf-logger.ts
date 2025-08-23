/**
 * Simple performance logger for fingering feature
 * Avoids import.meta issues in Jest tests
 */

export const perfLogger = {
  debug: (message: string, data?: any) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[FingeringPerf]', message, data);
    }
  },
  warn: (message: string, data?: any) => {
    console.warn('[FingeringPerf]', message, data);
  },
  error: (message: string, error?: any) => {
    console.error('[FingeringPerf]', message, error);
  }
};