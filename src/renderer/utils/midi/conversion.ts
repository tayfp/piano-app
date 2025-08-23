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
 * Convert MIDI note number to OSMD halfTone
 * 
 * @param midiNote - Standard MIDI note number (0-127)
 * @returns OSMD halfTone value
 */
export function midiToHalfTone(midiNote: number): number {
  const MIDI_C4_OFFSET = 60;
  return midiNote - MIDI_C4_OFFSET;
}

/**
 * Get note name from MIDI number
 * 
 * @param midiNote - MIDI note number (0-127)
 * @returns Note name with octave (e.g., "C4", "F#5")
 */
export function midiToNoteName(midiNote: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midiNote / 12) - 1;
  const noteName = noteNames[midiNote % 12];
  return `${noteName}${octave}`;
}

/**
 * Type guard for valid MIDI note number
 */
export function isValidMidiNote(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 127 && Number.isInteger(value);
}

/**
 * Type guard for valid MIDI velocity
 */
export function isValidMidiVelocity(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 127 && Number.isInteger(value);
}