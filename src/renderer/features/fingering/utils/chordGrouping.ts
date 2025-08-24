export interface ChordGrouping {
  x: number;
  y: number;
}

export type FingeringWithPosition = [string, number, { x: number; y: number }];

const VERTICAL_SPACING = 14; // pixels between fingerings in a chord

/**
 * Build chord groupings and calculate vertical offsets
 * Groups fingerings by timestamp AND staff to prevent cross-staff grouping
 */
export const buildChordGroupings = (
  fingeringsWithPositions: FingeringWithPosition[]
): Map<string, ChordGrouping> => {
  const staffTimestampMap = new Map<string, Array<{ noteId: string; x: number; y: number; finger: number }>>();
  
  // Group fingerings by TIMESTAMP AND STAFF to prevent cross-staff grouping
  fingeringsWithPositions.forEach(([noteId, finger, pos]) => {
    // Extract timestamp from noteId (e.g., "m0-s0-v0-n0-ts0_25-midi64" -> "ts0_25")
    const timestampMatch = noteId.match(/ts(\d+_\d+)/);
    const timestamp = timestampMatch ? timestampMatch[0] : 'no-ts';
    
    // Extract staff index from noteId - this should be the actual MusicXML staff
    const staffMatch = noteId.match(/s(\d+)/);
    const staffIndex = staffMatch ? staffMatch[1] : '0';
    
    // For notes without timestamps, use unique groupKeys to prevent grouping them together
    const groupKey = timestamp === 'no-ts' 
      ? `no-ts-${noteId}` // Each note without timestamp gets unique key
      : `${timestamp}|staff${staffIndex}`;
    
    if (!staffTimestampMap.has(groupKey)) staffTimestampMap.set(groupKey, []);
    staffTimestampMap.get(groupKey)!.push({ noteId, x: pos.x, y: pos.y, finger });
  });
  
  // Calculate offsets for chord notes
  const offsetMap = new Map<string, ChordGrouping>();
  
  staffTimestampMap.forEach((notes, groupKey) => {
    if (notes.length > 1) {
      // Real chord - multiple notes at same timestamp
      
      // Sort by MIDI pitch (descending - highest pitch first for top position)
      const sortedNotes = [...notes].sort((a, b) => {
        const midiA = parseInt(a.noteId.match(/midi(\d+)/)?.[1] || '0');
        const midiB = parseInt(b.noteId.match(/midi(\d+)/)?.[1] || '0');
        return midiB - midiA; // Higher MIDI number = higher pitch = should display on top
      });
      
      // Find the topmost Y position (smallest Y value) among all notes
      const topmostY = Math.min(...notes.map(n => n.y));
      
      sortedNotes.forEach((note, index) => {
        offsetMap.set(note.noteId, {
          x: note.x,
          y: topmostY + (index * VERTICAL_SPACING)  // Stack downward from topmost position
        });
      });
    } else {
      // Single note - use original position WITHOUT modification
      notes.forEach(note => {
        offsetMap.set(note.noteId, { x: note.x, y: note.y });
      });
    }
  });
  
  return offsetMap;
};