/**
 * Visual Feedback Utilities for OSMD
 * 
 * Pure functions for calculating velocity-based visual feedback.
 * Used for dynamic highlighting and visual effects in sheet music.
 */

export interface VisualFeedback {
  velocity: number;
  color: string;
  strokeWidth: number;
  opacity: number;
  glowIntensity: number;
}

/**
 * Calculate visual feedback parameters based on MIDI velocity
 * Creates dynamic visual effects that respond to playing dynamics
 * 
 * @param velocity - MIDI velocity (0-127), defaults to 100
 * @returns Visual feedback parameters for rendering
 */
export function calculateVisualFeedback(velocity: number = 100): VisualFeedback {
  // Clamp and normalize velocity to 0-1 range
  const normalizedVelocity = Math.max(0, Math.min(127, velocity)) / 127;
  
  return {
    velocity,
    // Color transitions from yellow (soft) to orange (loud)
    // HSL: 60° (yellow) to 120° (light orange), full saturation
    color: `hsl(${60 + normalizedVelocity * 60}, 100%, ${50 + normalizedVelocity * 20}%)`,
    
    // Stroke width increases with velocity (1-4 pixels)
    strokeWidth: 1 + normalizedVelocity * 3,
    
    // Opacity ranges from 30% to 80%
    opacity: 0.3 + normalizedVelocity * 0.5,
    
    // Glow intensity for special effects (0-10)
    glowIntensity: normalizedVelocity * 10,
  };
}

/**
 * Get a CSS filter string for glow effect
 * 
 * @param glowIntensity - Intensity value (0-10)
 * @returns CSS filter string
 */
export function getGlowFilter(glowIntensity: number): string {
  if (glowIntensity <= 0) return 'none';
  
  const blur = Math.min(glowIntensity * 2, 20);
  const brightness = 1 + (glowIntensity * 0.1);
  
  return `drop-shadow(0 0 ${blur}px rgba(255, 200, 0, 0.6)) brightness(${brightness})`;
}