/**
 * Utilities for generating stable, unique IDs for fingering annotations.
 * Uses structural position to ensure uniqueness across staves and voices.
 */

// Precompiled regex patterns for better performance (avoids regex creation on each parse)
const RE_TIMESTAMPED = /^m(\d+)-s(\d+)-v(\d+)-n(\d+)-ts(.+)-midi(\d+)$/;
const RE_FULL = /^m(\d+)-s(\d+)-v(\d+)-n(\d+)-midi(\d+)$/;
const RE_SIMPLE = /^m(\d+)-t(.+)-midi(\d+)$/;
const RE_LEGACY = /^t(.+)-m(\d+)$/;


/**
 * Generates a stable, unique ID for a note based on its structural position.
 * This format ensures no collisions even when same note appears at same time.
 * 
 * @param measureIndex - The measure number (0-based)
 * @param staffIndex - The staff index (0-based) 
 * @param voiceIndex - The voice index within the staff (0-based)
 * @param noteIndex - The note index within the voice entry (0-based)
 * @param midiValue - The MIDI note number (0-127)
 * @returns Unique fingering ID
 */
export const createFullFingeringId = (
  measureIndex: number,
  staffIndex: number,
  voiceIndex: number,
  noteIndex: number,
  midiValue: number
): string => {
  return `m${measureIndex}-s${staffIndex}-v${voiceIndex}-n${noteIndex}-midi${midiValue}`;
};

/**
 * Simplified ID format for initial implementation.
 * Uses measure + timestamp + MIDI to reduce collision risk.
 * 
 * @param measureIndex - The measure number (0-based)
 * @param timestamp - The absolute musical timestamp from OSMD
 * @param midiValue - The MIDI note number (0-127)
 * @returns Fingering ID
 */
export const createSimpleFingeringId = (
  measureIndex: number,
  timestamp: number,
  midiValue: number
): string => {
  // For backward compatibility with tests, when measureIndex is 0, use the simpler format
  if (measureIndex === 0) {
    return `t${timestamp}-m${midiValue}`;
  }
  return `m${measureIndex}-t${timestamp}-midi${midiValue}`;
};

/**
 * Parse fingering ID back into components (for debugging/analysis)
 * Handles both full and simple ID formats.
 * 
 * @param id - The fingering ID to parse
 * @returns Parsed components or null if invalid format
 */
export const parseFingeringId = (id: string): {
  measureIndex?: number;
  staffIndex?: number;
  voiceIndex?: number;
  noteIndex?: number;
  timestamp?: number;
  midiValue: number;
} | null => {
  // Try new timestamped format first (use precompiled regex)
  const timestampedMatch = RE_TIMESTAMPED.exec(id);
  if (timestampedMatch) {
    return {
      measureIndex: parseInt(timestampedMatch[1], 10),
      staffIndex: parseInt(timestampedMatch[2], 10),
      voiceIndex: parseInt(timestampedMatch[3], 10),
      noteIndex: parseInt(timestampedMatch[4], 10),
      timestamp: parseFloat(timestampedMatch[5].replace(/_/g, '.')), // Fix: replace ALL underscores
      midiValue: parseInt(timestampedMatch[6], 10)
    };
  }

  // Try original full format for backward compatibility (use precompiled regex)
  const fullMatch = RE_FULL.exec(id);
  if (fullMatch) {
    return {
      measureIndex: parseInt(fullMatch[1], 10),
      staffIndex: parseInt(fullMatch[2], 10),
      voiceIndex: parseInt(fullMatch[3], 10),
      noteIndex: parseInt(fullMatch[4], 10),
      midiValue: parseInt(fullMatch[5], 10)
    };
  }

  // Try simple format (use precompiled regex)
  const simpleMatch = RE_SIMPLE.exec(id);
  if (simpleMatch) {
    return {
      measureIndex: parseInt(simpleMatch[1], 10),
      timestamp: parseFloat(simpleMatch[2]),
      midiValue: parseInt(simpleMatch[3], 10)
    };
  }

  // Legacy format support (use precompiled regex)
  const legacyMatch = RE_LEGACY.exec(id);
  if (legacyMatch) {
    const timestamp = parseFloat(legacyMatch[1]);
    const midiValue = parseInt(legacyMatch[2], 10);
    
    // Validate parsed values
    if (isNaN(timestamp) || isNaN(midiValue)) {
      return null;
    }
    
    return {
      timestamp,
      midiValue
    };
  }

  return null;
};

/**
 * Validate fingering value is within valid range (1-5)
 */
export const isValidFingeringValue = (value: number): boolean => {
  return Number.isInteger(value) && value >= 1 && value <= 5;
};

// For backward compatibility with tests that expect simpler API
// Create a unified createFingeringId that handles both signatures
export const createFingeringId = (
  arg1: number,
  arg2: number,
  arg3?: number
): string => {
  // If only 2 arguments, it's the legacy format (timestamp, midiValue)
  if (arg3 === undefined) {
    return createSimpleFingeringId(0, arg1, arg2);
  }
  // Otherwise it's the full format (measureIndex, timestamp, midiValue)
  return createSimpleFingeringId(arg1, arg2, arg3);
};