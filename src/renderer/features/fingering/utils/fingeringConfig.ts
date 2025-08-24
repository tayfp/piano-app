/**
 * Fingering Layer Configuration Constants
 * 
 * Centralized configuration for performance limits and OSMD rendering constants
 */

// Configurable performance limit
// Can be overridden via MAX_FINGERING_RENDER_LIMIT environment variable
export const MAX_FINGERING_RENDER_LIMIT = process.env.MAX_FINGERING_RENDER_LIMIT 
  ? parseInt(process.env.MAX_FINGERING_RENDER_LIMIT) 
  : 300;

// OSMD coordinate conversion constants
export const OSMD_UNIT_TO_PIXELS = 10; // 1 OSMD unit = 10 pixels at zoom 1.0
export const FINGERING_OFFSET_OSMD_UNITS = 0; // No offset - fingering at note position