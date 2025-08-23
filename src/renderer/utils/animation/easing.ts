/**
 * Easing Functions
 * 
 * Pure mathematical easing functions for smooth animations.
 * All functions take a normalized time value (0-1) and return a normalized output (0-1).
 */

/**
 * Cubic easing out - fast start, slow end
 * Commonly used for natural deceleration
 * @param t - Normalized time (0-1)
 * @returns Eased value (0-1)
 */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Linear interpolation - no easing
 * @param t - Normalized time (0-1)
 * @returns Linear value (0-1)
 */
export function linear(t: number): number {
  return t;
}

/**
 * Quad easing out - moderate deceleration
 * @param t - Normalized time (0-1)
 * @returns Eased value (0-1)
 */
export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}