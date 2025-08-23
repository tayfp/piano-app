/**
 * Theme Context and Provider for Urtext Piano
 * Manages theme state and provides hooks for theme switching
 */

import React, { createContext, useContext, useState, useEffect, useLayoutEffect, PropsWithChildren } from 'react';
import { ThemeName, ThemeState, THEMES } from './types';
import { loadTheme, saveTheme } from './storage';

interface ThemeContextValue {
  theme: ThemeName;
  themes: typeof THEMES;
  setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * Apply theme to document root element
 * Uses data-theme attribute to trigger CSS custom properties
 */
const applyTheme = (theme: ThemeName): void => {
  document.documentElement.setAttribute('data-theme', theme);
};

export const ThemeProvider: React.FC<PropsWithChildren> = ({ children }) => {
  // Initialize theme from localStorage or default to light
  const [themeState, setThemeState] = useState<ThemeState>(() => {
    return loadTheme() || { name: 'light' };
  });

  // Apply theme before first paint to prevent FOUC
  useLayoutEffect(() => {
    applyTheme(themeState.name);
  }, [themeState.name]);

  // Persist theme changes with debouncing
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveTheme(themeState);
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [themeState]);

  // Set up keyboard shortcuts (Ctrl+1/2/3)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey) {
        switch (e.key) {
          case '1':
            setThemeState({ name: 'light' });
            break;
          case '2':
            setThemeState({ name: 'sepia' });
            break;
          case '3':
            setThemeState({ name: 'hybrid-dark' });
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const setTheme = (name: ThemeName) => {
    if (name !== themeState.name) {
      setThemeState({ name });
    }
  };

  const value: ThemeContextValue = {
    theme: themeState.name,
    themes: THEMES,
    setTheme
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};