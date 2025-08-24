/**
 * Statistical utility functions for Speed Challenge Analytics
 * Extracted from SessionAnalytics.ts for reusability
 */

/**
 * Calculate coefficient of variation for a set of values
 * Used to detect performance plateaus
 * 
 * @param values Array of numeric values
 * @returns Coefficient of variation (0-1+)
 */
export function calculateVariation(values: number[]): number {
  if (values.length < 2) return 0;

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1); // Sample variance
  const stdDev = Math.sqrt(variance);

  // Coefficient of variation
  const cv = mean > 0 ? stdDev / mean : 0;
  
  // For times around 1500ms with ±50ms variation, CV should be around 0.02-0.03
  // which is less than our threshold of 0.1
  return cv;
}

/**
 * Calculate average of an array of numbers
 * 
 * @param values Array of numbers
 * @returns Average value, or 0 if array is empty
 */
export function calculateAverage(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

/**
 * Calculate accuracy percentage from attempts
 * 
 * @param correctCount Number of correct attempts
 * @param totalCount Total number of attempts
 * @returns Accuracy as decimal (0-1)
 */
export function calculateAccuracy(correctCount: number, totalCount: number): number {
  return totalCount > 0 ? correctCount / totalCount : 0;
}

/**
 * Round a number to specified decimal places
 * 
 * @param value The number to round
 * @param decimals Number of decimal places (default: 2)
 * @returns Rounded number
 */
export function roundToDecimals(value: number, decimals: number = 2): number {
  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
}

/**
 * Calculate percentage improvement between two values
 * 
 * @param oldValue Original value
 * @param newValue New value
 * @returns Percentage improvement (negative for regression)
 */
export function calculateImprovement(oldValue: number, newValue: number): number {
  if (oldValue === 0) return newValue > 0 ? 1 : 0;
  return (newValue - oldValue) / oldValue;
}