/**
 * Note Utilities
 * 
 * Utilities for converting between MIDI numbers and human-readable note names.
 * Handles edge cases and provides fallbacks for malformed data.
 */

/**
 * Extract the first note ID from a comma-separated list
 * Used for chord click detection where multiple notes share the same SVG element
 * @param raw The raw data-note-id attribute value (may be comma-separated)
 * @returns The first note ID or null
 */
export const extractFirstDataNoteId = (raw: string | null): string | null =>
  raw ? raw.split(',')[0].trim() : null;

// Standard note names using sharps (preferred in digital audio)
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Convert MIDI note number to human-readable note name
 * @param midiNumber MIDI note number (0-127)
 * @returns Note name with octave (e.g., "C4", "A#3")
 */
export function midiToNoteName(midiNumber: number): string {
  // Validate MIDI range
  if (midiNumber < 0 || midiNumber > 127 || !Number.isInteger(midiNumber)) {
    return `Invalid(${midiNumber})`;
  }
  
  // Calculate note and octave
  const noteIndex = midiNumber % 12;
  const octave = Math.floor(midiNumber / 12) - 1; // MIDI 60 = C4
  
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Extract note name from OSMD pitch object with fallbacks
 * @param pitch OSMD pitch object
 * @param midiValue MIDI value as fallback
 * @returns Human-readable note name
 */
export function extractNoteNameFromPitch(pitch: any, midiValue: number): string {
  // Try various ways to extract note name from OSMD pitch object
  
  // Method 1: Check for Name property (common in OSMD)
  if (pitch && typeof pitch.Name === 'string' && pitch.Name.length > 0) {
    // Add octave if available
    if (typeof pitch.Octave === 'number') {
      return `${pitch.Name}${pitch.Octave}`;
    }
    return pitch.Name;
  }
  
  // Method 2: Check for name property (lowercase variant)
  if (pitch && typeof pitch.name === 'string' && pitch.name.length > 0) {
    if (typeof pitch.octave === 'number') {
      return `${pitch.name}${pitch.octave}`;
    }
    return pitch.name;
  }
  
  // Method 3: Check if toString() returns something meaningful
  if (pitch && typeof pitch.toString === 'function') {
    const stringValue = pitch.toString();
    if (stringValue && stringValue !== '[object Object]' && stringValue.length < 10) {
      return stringValue;
    }
  }
  
  // Method 4: Try accessing FundamentalNote and Octave separately
  if (pitch && pitch.FundamentalNote && pitch.Octave !== undefined) {
    const noteName = pitch.FundamentalNote.Name || pitch.FundamentalNote;
    if (typeof noteName === 'string') {
      return `${noteName}${pitch.Octave}`;
    }
  }
  
  // Method 5: Check for direct string value
  if (typeof pitch === 'string' && pitch.length > 0) {
    return pitch;
  }
  
  // Fallback: Convert MIDI number to note name
  return midiToNoteName(midiValue);
}

/**
 * Format a list of note names for display
 * @param noteNames Array of note names
 * @returns Formatted string (e.g., "C4", "C4 + E4 + G4", "C4, E4, G4, and B4")
 */
export function formatNoteNames(noteNames: string[]): string {
  if (noteNames.length === 0) {
    return 'No notes';
  }
  
  if (noteNames.length === 1) {
    return noteNames[0];
  }
  
  if (noteNames.length === 2) {
    return `${noteNames[0]} + ${noteNames[1]}`;
  }
  
  if (noteNames.length <= 4) {
    // For small chords, use "+" separator
    return noteNames.join(' + ');
  }
  
  // For larger chords, use comma separation with "and"
  const allButLast = noteNames.slice(0, -1);
  const last = noteNames[noteNames.length - 1];
  return `${allButLast.join(', ')}, and ${last}`;
}

/**
 * Format wrong notes for error display
 * @param wrongNotes Array of MIDI numbers that were wrong
 * @returns Formatted string of wrong note names
 */
export function formatWrongNotes(wrongNotes: number[]): string {
  if (wrongNotes.length === 0) {
    return '';
  }
  
  const noteNames = wrongNotes.map(midiToNoteName);
  return formatNoteNames(noteNames);
}

/**
 * Validate if a string looks like a valid note name
 * @param noteName String to validate
 * @returns True if it looks like a note name
 */
export function isValidNoteName(noteName: string): boolean {
  if (typeof noteName !== 'string' || noteName.length === 0) {
    return false;
  }
  
  // Check for [object Object] and similar malformed strings
  if (noteName.includes('[object') || noteName.includes('Object]')) {
    return false;
  }
  
  // Basic pattern check: starts with A-G (valid note names), optionally followed by #/b, then optional number
  const notePattern = /^[A-G][#b]?\d*$/;
  
  // Ensure the pattern matches and it's a reasonable length
  return notePattern.test(noteName) && noteName.length <= 4;
}