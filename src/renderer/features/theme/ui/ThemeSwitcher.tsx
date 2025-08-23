/**
 * Theme Switcher Component
 * Provides UI for switching between light, sepia, and hybrid dark themes
 */

import React from 'react';
import { useTheme } from '../model';
import './ThemeSwitcher.css';

export const ThemeSwitcher: React.FC = () => {
  const { theme, themes, setTheme } = useTheme();

  return (
    <div className="theme-switcher">
      <label className="theme-switcher__label">Theme:</label>
      <select 
        className="theme-switcher__select"
        value={theme} 
        onChange={(e) => setTheme(e.target.value as any)}
        aria-label="Select theme"
      >
        {themes.map(t => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <span className="theme-switcher__hint">
        Ctrl+Shift+1/2/3
      </span>
    </div>
  );
};