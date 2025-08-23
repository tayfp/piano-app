/**
 * Theme system types for Urtext Piano
 * Supports light, sepia, and hybrid dark themes
 */

export type ThemeName = 'light' | 'sepia' | 'hybrid-dark';

export interface Theme {
  id: ThemeName;
  name: string;
  description: string;
}

export interface ThemeState {
  name: ThemeName;
  // Future: support for custom overrides
  // overrides?: Record<string, string>;
}

export const THEMES: Theme[] = [
  {
    id: 'light',
    name: 'Light',
    description: 'Clean, bright theme for well-lit environments'
  },
  {
    id: 'sepia',
    name: 'Sepia',
    description: 'Warm, paper-like tones that reduce eye strain'
  },
  {
    id: 'hybrid-dark',
    name: 'Hybrid Dark',
    description: 'Dark UI with light sheet music for night practice'
  }
];

// Validate theme name to prevent localStorage injection
export const isValidTheme = (name: unknown): name is ThemeName => {
  return typeof name === 'string' && THEMES.some(t => t.id === name);
};