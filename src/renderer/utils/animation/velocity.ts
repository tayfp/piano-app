/**
 * Velocity Mapping Utilities
 * 
 * Pure functions for converting MIDI velocity to visual parameters.
 * Used for realistic piano key animations.
 */

/**
 * Calculate key press depth based on MIDI velocity
 * Maps velocity (0-127) to visual depth with MIDI semantics
 * 
 * @param velocity - MIDI velocity (0-127, where 0=note-off)
 * @param maxDepth - Maximum key press depth in pixels
 * @param minDepth - Minimum visible depth (default 0.5)
 * @returns Press depth in pixels (0 for note-off)
 */
export function getDepthForVelocity(
  velocity: number, 
  maxDepth: number, 
  minDepth: number = 0.5
): number {
  // Sanitize depth bounds
  if (maxDepth < 0) maxDepth = 0;
  if (minDepth < 0) minDepth = 0;
  if (minDepth > maxDepth) minDepth = maxDepth;

  // MIDI note-off (velocity 0) = no press depth
  if (velocity <= 0) return 0;
  
  // Clamp to valid MIDI range and map to depth
  const clampedVelocity = Math.min(127, Math.max(1, velocity | 0));
  const normalized = clampedVelocity / 127;
  
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

