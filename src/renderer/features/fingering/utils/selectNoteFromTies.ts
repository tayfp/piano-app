/**
 * Pure function for selecting the appropriate note from chord ties
 * Fixes React hook stale closure issue in coordinate detection
 */

interface TiedNote {
  noteId: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  distance: number;
  midiValue?: number;
}

/**
 * Selects the most appropriate note from a list of tied notes (chord)
 * based on the relative Y position of the click within the note bounds.
 * 
 * @param tiedNotes - Array of notes with identical bounds (chord notes)
 * @param relativeY - Y position relative to the average note position (0-1)
 * @returns Selected note or undefined if invalid input
 */
export function selectNoteFromTies(
  tiedNotes: TiedNote[], 
  relativeY: number
): TiedNote | undefined {
  
  // Defensive checks
  if (!tiedNotes || tiedNotes.length === 0) {
    return undefined;
  }
  
  // Single note - no selection needed
  if (tiedNotes.length === 1) {
    return tiedNotes[0];
  }

  // Clamp relativeY to valid range
  const clampedY = Math.max(0, Math.min(1, relativeY));
  const lowerZoneThreshold = 0.4; // Click below 40% = lower note
  const upperZoneThreshold = 0.6; // Click above 60% = upper note

  // Single pass: extract MIDI and track both min and max simultaneously
  let lowest: TiedNote | undefined;
  let highest: TiedNote | undefined;
  let lowestMidi = Number.POSITIVE_INFINITY;
  let highestMidi = Number.NEGATIVE_INFINITY;

  for (const note of tiedNotes) {
    // Extract MIDI from id: "...midi<digits>" at the end; fallback to 0 if missing
    const midiMatch = note.noteId.match(/midi(\d+)$/);
    const midi = midiMatch ? parseInt(midiMatch[1], 10) : 0;
    if (midi <= 0) continue;

    if (midi < lowestMidi) {
      lowestMidi = midi;
      lowest = note;
    }
    if (midi > highestMidi) {
      highestMidi = midi;
      highest = note;
    }
  }

  // Fallback if no valid MIDI values were found
  if (!lowest && !highest) {
    return tiedNotes[0];
  }

  // Selection by click zone (default to lowest for middle zone)
  if (clampedY < lowerZoneThreshold) {
    return lowest ?? highest!;
  }
  if (clampedY > upperZoneThreshold) {
    return highest ?? lowest!;
  }
  return lowest ?? highest!;
}