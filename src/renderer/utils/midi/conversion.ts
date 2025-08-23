/**
 * MIDI Conversion Utilities
 * 
 * Pure functions for MIDI-related conversions and calculations.
 * All functions are deterministic and have no side effects.
 */

/**
 * Convert OSMD halfTone to standard MIDI note number
 * 
 * @param halfTone - OSMD halfTone value
 * @returns MIDI note number (0-127), clamped to valid range
 */
export function halfToneToMidi(halfTone: number): number {
  // OSMD uses C4 = 0, MIDI uses C4 = 60
  const MIDI_C4_OFFSET = 60;
  const midiNote = halfTone + MIDI_C4_OFFSET;
  
  // Clamp to valid MIDI range
  return Math.max(0, Math.min(127, midiNote));
}

/**
 * Type guard for valid MIDI note number
 */
export function isValidMidiNote(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 127 && Number.isInteger(value);
}

