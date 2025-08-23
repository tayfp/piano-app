/**
 * Custom Range Detection Utilities
 * 
 * Provides detection logic for custom measure range looping in practice mode.
 * Performance critical: Must add <1ms overhead to practice flow.
 */

import type { OSMDControls } from '@/renderer/types/osmd';

/**
 * Store state interface for custom range
 */
interface CustomRangeState {
  customRangeActive: boolean;
  customStartMeasure: number;
  customEndMeasure: number;
}

/**
 * Checks if practice has reached the end of the custom range
 * 
 * @param osmdControls - OSMD controls with cursor position
 * @param storeState - Current practice store state
 * @returns true if cursor is at or past the end measure
 */
export function checkCustomRangeLoop(
  osmdControls: any, // Using any to match test expectations
  storeState: CustomRangeState
): boolean {
  try {
    // Early exit if custom range not active (performance optimization)
    if (!storeState.customRangeActive) {
      return false;
    }
    
    // Safe cursor position retrieval with null checks
    const currentMeasure = osmdControls?.cursor?.iterator?.currentMeasureIndex ?? -1;
    
    // Validate we have valid measure data
    if (currentMeasure < 0) {
      return false;
    }
    
    // Check if we've reached or passed the end of the custom range
    // Note: currentMeasureIndex is 0-based, customEndMeasure is 1-based
    return currentMeasure >= storeState.customEndMeasure - 1;
  } catch (error) {
    // Log error but don't break practice flow
    console.warn('[Practice] Error in custom range detection:', error);
    return false;
  }
}