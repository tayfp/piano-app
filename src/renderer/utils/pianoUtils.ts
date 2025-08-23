export interface PianoKeyData {
  id: string;
  type: 'white' | 'black';
  octave: number;
  noteName: string;
  fullName: string;
  whiteKeyIndex?: number;
  referenceGridColumn?: number;
  isLandmark?: boolean;
}

export function generatePianoKeys(): PianoKeyData[] {
  const keys: PianoKeyData[] = [];
  
  // Define the pattern of notes in an octave
  const notePattern = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const whiteNotes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  
  // Piano starts at A0 and ends at C8
  // We need to generate from A0 (index 9 in first octave) to C8
  let whiteKeyCounter = 0;
  
  // Start with A0, A#0, B0
  for (let i = 9; i < 12; i++) {
    const note = notePattern[i];
    const isWhite = !note.includes('#');
    const key: PianoKeyData = {
      id: note + '0',
      type: isWhite ? 'white' : 'black',
      octave: 0,
      noteName: note,
      fullName: note + '0',
      isLandmark: note === 'C'
    };
    
    if (isWhite) {
      key.whiteKeyIndex = whiteKeyCounter;
      whiteKeyCounter++;
    } else {
      // Black keys reference the white key to their right
      key.referenceGridColumn = whiteKeyCounter + 1;
    }
    
    keys.push(key);
  }
  
  // Generate octaves 1-7 (complete octaves)
  for (let octave = 1; octave <= 7; octave++) {
    for (let i = 0; i < 12; i++) {
      const note = notePattern[i];
      const isWhite = !note.includes('#');
      const key: PianoKeyData = {
        id: note + octave,
        type: isWhite ? 'white' : 'black',
        octave: octave,
        noteName: note,
        fullName: note + octave,
        isLandmark: note === 'C'
      };
      
      if (isWhite) {
        key.whiteKeyIndex = whiteKeyCounter;
        whiteKeyCounter++;
      } else {
        // Black keys reference the white key to their right
        key.referenceGridColumn = whiteKeyCounter + 1;
      }
      
      keys.push(key);
    }
  }
  
  // End with C8 (just one note)
  const c8: PianoKeyData = {
    id: 'C8',
    type: 'white',
    octave: 8,
    noteName: 'C',
    fullName: 'C8',
    whiteKeyIndex: whiteKeyCounter,
    isLandmark: true
  };
  keys.push(c8);
  
  return keys;
}