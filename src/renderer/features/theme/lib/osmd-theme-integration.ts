/**
 * OSMD Theme Integration
 * Applies theme colors to OpenSheetMusicDisplay
 */

import React from 'react';
import type { OpenSheetMusicDisplay, IOSMDOptions } from 'opensheetmusicdisplay';
import type { ThemeName } from '../model/types';
import { perfLogger } from '@/renderer/utils/performance-logger';

/**
 * Get OSMD options for a specific theme
 * Extracted from CSS custom properties at runtime
 */
export const getOSMDThemeOptions = (): Partial<IOSMDOptions> => {
  const rootStyle = getComputedStyle(document.documentElement);
  
  // Read theme-specific colors from CSS variables
  const sheetBg = rootStyle.getPropertyValue('--abc-sheet-bg').trim();
  const sheetInk = rootStyle.getPropertyValue('--abc-sheet-ink').trim();
  
  return {
    // Background color for sheet music area
    pageBackgroundColor: sheetBg || '#ffffff',
    
    // Default color for musical notation
    defaultColorMusic: sheetInk || '#000000'
    
    // No cursor configuration - handled separately for simplicity
  };
};

/**
 * Apply theme to an existing OSMD instance
 * Triggers re-render with new colors
 */
export const applyThemeToOSMD = async (osmd: OpenSheetMusicDisplay): Promise<void> => {
  if (!osmd) {
    perfLogger.warn('Cannot apply theme: OSMD instance not provided');
    return;
  }

  try {
    // Save cursor state before re-render
    const cursor = osmd.cursor;
    const cursorIterator = cursor?.iterator;
    const cursorVisible = cursor?.cursorElement && cursor.cursorElement.style.display !== 'none';
    const measureIndex = cursorIterator?.CurrentMeasureIndex;
    
    // Get theme-specific options
    const themeOptions = getOSMDThemeOptions();
    
    // Combine theme and cursor options in single call
    if (cursor) {
      osmd.setOptions({
        ...themeOptions,
        cursorsOptions: [{
          color: '#33e02f',
          alpha: 0.5
        }]
      });
    } else {
      osmd.setOptions(themeOptions);
    }
    
    // Only show cursor if it was visible before
    if (cursor && cursorVisible) {
      cursor.show();
    }
    
    // Re-render to apply new colors
    osmd.render();
    
    // Restore cursor position after re-render
    if (cursor && cursorVisible && measureIndex !== undefined && measureIndex >= 0) {
      cursor.reset();
      for (let i = 0; i < measureIndex; i++) {
        cursor.next();
      }
    }
    
    perfLogger.debug('Theme applied to OSMD:', themeOptions);
  } catch (error) {
    perfLogger.error('Failed to apply theme to OSMD:', error);
  }
};

/**
 * Hook to automatically apply theme changes to OSMD
 * Should be used in components that manage OSMD instances
 */
export const useOSMDTheme = (osmd: OpenSheetMusicDisplay | null, theme: ThemeName) => {
  // Apply theme whenever it changes or OSMD instance is ready
  React.useEffect(() => {
    if (osmd && osmd.GraphicSheet) {
      applyThemeToOSMD(osmd);
    }
  }, [osmd, theme]);
};