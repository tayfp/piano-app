/**
 * Environment utilities for the renderer process
 * 
 * In Vite, we use import.meta.env instead of process.env
 * This module provides a consistent interface for environment checks
 */

// Check if we're in development mode
export const isDevelopment = (): boolean => {
  // Support both Vite's import.meta.env and legacy process.env
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env.MODE === 'development' || 
           import.meta.env.DEV === true ||
           !import.meta.env.PROD; // Any non-production mode
  }
  
  // Fallback for any build tools that define process.env
  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV === 'development';
  }
  
  // Default to development if we can't determine (safer for debugging)
  return true;
};

// Check if we're in production mode
export const isProduction = (): boolean => {
  // Support both Vite's import.meta.env and legacy process.env
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env.MODE === 'production' || import.meta.env.PROD === true;
  }
  
  // Fallback for any build tools that define process.env
  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV === 'production';
  }
  
  return false; // Default to false to avoid contradiction with isDevelopment
};

// Export constants for performance (evaluated once)
export const IS_DEVELOPMENT = isDevelopment();
export const IS_PRODUCTION = isProduction();