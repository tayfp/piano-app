/**
 * Validation utilities for custom measure range feature
 * 
 * These functions provide centralized validation logic used by both
 * the store and UI components to ensure consistency
 */

/**
 * Validates if a measure number is valid
 * @param measure - The measure number to validate
 * @param totalMeasures - Total number of measures in the score
 * @returns true if valid, false otherwise
 */
export function isValidMeasureNumber(measure: number, totalMeasures: number): boolean {
  // Handle NaN and non-integer cases
  if (!Number.isInteger(measure)) {
    return false;
  }
  
  // MAX_SAFE_INTEGER check (defense in depth per Code review:)
  if (measure > Number.MAX_SAFE_INTEGER) {
    return false;
  }
  
  // Basic bounds check
  return measure >= 1 && measure <= totalMeasures;
}

/**
 * Validates if a measure range is valid
 * @param start - Start measure number
 * @param end - End measure number  
 * @param totalMeasures - Total number of measures in the score
 * @returns true if valid range, false otherwise
 */
export function isValidMeasureRange(
  start: number, 
  end: number, 
  totalMeasures: number
): boolean {
  // Individual measure validation
  if (!isValidMeasureNumber(start, totalMeasures)) {
    return false;
  }
  
  if (!isValidMeasureNumber(end, totalMeasures)) {
    return false;
  }
  
  // Range validation - start must be less than or equal to end (allow single measure)
  return start <= end;
}

/**
 * Gets validation errors for a range
 * @param start - Start measure number
 * @param end - End measure number
 * @param totalMeasures - Total number of measures in the score
 * @returns Object with start/end error messages
 */
export function getMeasureRangeErrors(
  start: number,
  end: number,
  totalMeasures: number
): { start?: string; end?: string } {
  const errors: { start?: string; end?: string } = {};
  
  // Check start measure
  if (!Number.isInteger(start) || isNaN(start)) {
    errors.start = 'Start measure must be a valid number';
  } else if (start < 1) {
    errors.start = 'Start measure must be at least 1';
  } else if (start > totalMeasures) {
    errors.start = `Start measure cannot exceed ${totalMeasures}`;
  }
  
  // Check end measure
  if (!Number.isInteger(end) || isNaN(end)) {
    errors.end = 'End measure must be a valid number';
  } else if (end < 1) {
    errors.end = 'End measure must be at least 1';
  } else if (end > totalMeasures) {
    errors.end = `End measure cannot exceed ${totalMeasures}`;
  } else if (start > end && !errors.start) {
    errors.end = 'End measure must be greater than or equal to start measure';
  }
  
  return errors;
}

/**
 * Gets a descriptive error message for invalid ranges
 * @param start - Start measure number
 * @param end - End measure number
 * @param totalMeasures - Total number of measures in the score
 * @returns Error message or null if valid
 */
export function getMeasureRangeError(
  start: number,
  end: number,
  totalMeasures: number
): string | null {
  // Check start measure
  if (!Number.isInteger(start) || isNaN(start)) {
    return 'Start measure must be a valid number';
  }
  
  if (start < 1) {
    return 'Start measure must be at least 1';
  }
  
  if (start > totalMeasures) {
    return `Start measure cannot exceed ${totalMeasures}`;
  }
  
  // Check end measure
  if (!Number.isInteger(end) || isNaN(end)) {
    return 'End measure must be a valid number';
  }
  
  if (end < 1) {
    return 'End measure must be at least 1';
  }
  
  if (end > totalMeasures) {
    return `End measure cannot exceed ${totalMeasures}`;
  }
  
  // Check range relationship
  if (start > end) {
    return 'End measure must be greater than or equal to start measure';
  }
  
  return null; // Valid range
}

/**
 * Determines if custom range can be enabled
 * @param start - Start measure number
 * @param end - End measure number
 * @param totalMeasures - Total number of measures in the score
 * @returns true if range can be enabled
 */
export function canEnableCustomRange(
  start: number,
  end: number,
  totalMeasures: number
): boolean {
  return isValidMeasureRange(start, end, totalMeasures);
}

/**
 * Validates a measure range (wrapper for consistency with tests)
 * @param start - Start measure number
 * @param end - End measure number
 * @param totalMeasures - Total number of measures in the score
 * @returns true if valid
 */
export function validateMeasureRange(
  start: number,
  end: number,
  totalMeasures: number
): boolean {
  return isValidMeasureRange(start, end, totalMeasures);
}