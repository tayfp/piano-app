/**
 * Custom Range Safety Utilities
 * 
 * Provides safety checks and validation for custom measure range feature.
 * Ensures feature works safely with existing practice infrastructure.
 */

import { MeasureTimeline } from '../services/MeasureTimeline';
import { usePracticeStore } from '../stores/practiceStore';

/**
 * Checks if custom range feature is supported with current score
 * 
 * @returns true if MeasureTimeline is built and ready
 */
export function isCustomRangeSupported(): boolean {
  try {
    // Check if MeasureTimeline is built and ready
    const measureCount = MeasureTimeline?.getMeasureCount?.();
    return typeof measureCount === 'number' && measureCount > 0;
  } catch {
    return false;
  }
}

/**
 * Validates that custom range bounds are within current score
 * 
 * @param startMeasure - Start measure (1-based)
 * @param endMeasure - End measure (1-based)
 * @returns true if range is valid for current score
 */
export function validateRangeBounds(startMeasure: number, endMeasure: number): boolean {
  try {
    const totalMeasures = MeasureTimeline?.getMeasureCount?.() || 0;
    
    if (totalMeasures === 0) {
      return false;
    }
    
    // Reject non-integers to prevent array indexing errors
    if (!Number.isInteger(startMeasure) || !Number.isInteger(endMeasure)) {
      return false;
    }
    
    return startMeasure >= 1 && 
           endMeasure <= totalMeasures && 
           startMeasure <= endMeasure;
  } catch {
    return false;
  }
}

/**
 * Clears custom range if it becomes invalid
 * (e.g., when loading a new score with fewer measures)
 */
export function clearInvalidCustomRange(): void {
  const state = usePracticeStore.getState();
  const { customStartMeasure, customEndMeasure, customRangeActive } = state;
  
  if (customRangeActive && !validateRangeBounds(customStartMeasure, customEndMeasure)) {
    console.warn('[Practice] Custom range invalid for current score, clearing');
    state.clearCustomRange();
  }
}