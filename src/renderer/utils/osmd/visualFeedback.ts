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
  const v = Math.max(0, Math.min(127, velocity)) / 127;

  // Correct intent: yellow (60°) → orange (~30°) as velocity increases.
  // Also make higher velocity slightly darker (50% → 40% lightness),
  // while keeping opacity and stroke width intuitive.
  const hue = 60 - v * 30;       // 60..30  (yellow → orange)
  const lightness = 50 - v * 10; // 50..40  (slightly darker when louder)

  return {
    velocity,
    color: `hsl(${hue}, 100%, ${lightness}%)`,
    strokeWidth: 1 + v * 3,      // 1..4 px
    opacity: 0.3 + v * 0.5,      // 0.3..0.8
    glowIntensity: v * 10,       // 0..10
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