/**
 * Theme persistence utilities
 * Uses localStorage with validation to prevent injection attacks
 */

import { ThemeState, isValidTheme } from './types';
import { perfLogger } from '@/renderer/utils/performance-logger';

const STORAGE_KEY = 'urtext-piano-theme';

export const loadTheme = (): ThemeState | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    
    const parsed = JSON.parse(stored);
    
    // Validate theme name to prevent injection
    if (parsed && isValidTheme(parsed.name)) {
      return { name: parsed.name };
    }
    
    return null;
  } catch (error) {
    // Corrupted data, return null to use default
    perfLogger.warn('Failed to load theme from localStorage:', error);
    return null;
  }
};

export const saveTheme = (state: ThemeState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    perfLogger.error('Failed to save theme to localStorage:', error);
  }
};