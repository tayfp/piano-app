/**
 * Transform String Builders
 * 
 * Pure functions for building CSS transform strings for piano key animations.
 * Extracted from PianoKeyAnimator for reusability and testing.
 */

import type { PerformanceMode } from '@/renderer/types/performance';

/**
 * Build transform string for piano key based on its state
 * 
 * @param currentY - Current Y position in pixels
 * @param isBlackKey - Whether this is a black key (requires X offset)
 * @param performanceMode - Current performance mode affects 3D effects
 * @returns CSS transform string
 */
export function buildKeyTransform(
  currentY: number,
  isBlackKey: boolean,
  performanceMode: PerformanceMode = 'balanced'
): string {
  if (isBlackKey) {
    // Maintain black key offset while adding press motion
    return `translateX(-60%) translateY(${currentY}px)`;
  } else {
    // Simple downward motion for white keys
    let transform = `translateY(${currentY}px)`;
    
    // Add subtle 3D tilt in high performance mode
    if (performanceMode === 'high' && currentY > 0) {
      const tilt = currentY * 0.5; // Subtle perspective
      transform += ` perspective(1000px) rotateX(${tilt}deg)`;
    }
    
    return transform;
  }
}

/**
 * Build box shadow for depth effect
 * 
 * @param currentY - Current Y position (depth) in pixels
 * @param velocity - MIDI velocity (0-127) for glow intensity
 * @param performanceMode - Skip shadows in low performance mode
 * @returns CSS box-shadow string or empty string
 */
export function buildKeyBoxShadow(
  currentY: number,
  velocity: number,
  performanceMode: PerformanceMode = 'balanced'
): string {
  if (performanceMode === 'low') return '';
  
  const depth = currentY;
  
  if (depth > 0) {
    // Inset shadow for pressed appearance
    const insetShadow = `inset 0 ${depth}px ${depth * 2}px rgba(0,0,0,0.2)`;
    
    // Glow effect based on velocity
    const glowIntensity = (velocity / 127);
    const glowShadow = `0 ${depth}px ${8 + depth * 2}px rgba(76, 175, 80, ${glowIntensity * 0.4})`;
    
    return `${insetShadow}, ${glowShadow}`;
  }
  
  return '';
}

/**
 * Type guard for performance mode
 */
export function isPerformanceMode(value: unknown): value is PerformanceMode {
  return typeof value === 'string' && ['low', 'balanced', 'high'].includes(value);
}