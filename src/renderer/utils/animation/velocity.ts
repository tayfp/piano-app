/**
 * Velocity Mapping Utilities
 * 
 * Pure functions for converting MIDI velocity to visual parameters.
 * Used for realistic piano key animations.
 */

/**
 * Calculate key press depth based on MIDI velocity
 * Maps velocity (1-127) to visual depth with minimum threshold
 * 
 * @param velocity - MIDI velocity (1-127)
 * @param maxDepth - Maximum key press depth in pixels
 * @param minDepth - Minimum visible depth (default 0.5)
 * @returns Press depth in pixels
 */
export function getDepthForVelocity(
  velocity: number, 
  maxDepth: number, 
  minDepth: number = 0.5
): number {
  // Clamp velocity to valid MIDI range
  const clampedVelocity = Math.max(1, Math.min(127, velocity));
  
  // Normalize to 0-1 range
  const normalized = clampedVelocity / 127;
  
  // Map to depth range with minimum threshold
  return minDepth + (normalized * (maxDepth - minDepth));
}

/**
 * Calculate visual opacity based on velocity
 * Higher velocity = more prominent visual feedback
 * 
 * @param velocity - MIDI velocity (1-127)
 * @param minOpacity - Minimum opacity (default 0.3)
 * @param maxOpacity - Maximum opacity (default 1.0)
 * @returns Opacity value (0-1)
 */
export function getOpacityForVelocity(
  velocity: number,
  minOpacity: number = 0.3,
  maxOpacity: number = 1.0
): number {
  const clampedVelocity = Math.max(1, Math.min(127, velocity));
  const normalized = clampedVelocity / 127;
  
  // Use square root for more natural progression
  const scaledNormalized = Math.sqrt(normalized);
  
  return minOpacity + (scaledNormalized * (maxOpacity - minOpacity));
}

/**
 * Calculate animation duration based on velocity
 * Harder hits = faster animations (more realistic)
 * 
 * @param velocity - MIDI velocity (1-127)
 * @param baseDuration - Base duration in ms
 * @param speedFactor - How much velocity affects speed (0-1)
 * @returns Animation duration in ms
 */
export function getDurationForVelocity(
  velocity: number,
  baseDuration: number,
  speedFactor: number = 0.3
): number {
  const clampedVelocity = Math.max(1, Math.min(127, velocity));
  const normalized = clampedVelocity / 127;
  
  // Higher velocity = shorter duration
  const durationMultiplier = 1 - (normalized * speedFactor);
  
  return baseDuration * durationMultiplier;
}