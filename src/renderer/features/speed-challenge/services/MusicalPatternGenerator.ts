/**
 * Musical Pattern Generator for Speed Challenge Mode
 * 
 * Generates pedagogically meaningful musical patterns including:
 * - Scale segments
 * - Arpeggios
 * - Chord progressions
 * 
 * Performance Target: <5ms per pattern generation
 */

import { NoteData } from '../templates';
import { perfLogger } from '@/renderer/utils/performance-logger';

/**
 * Musical note with full properties
 */
export interface MusicalNote {
  step: string;
  octave: number;
  alter?: number;
  midiNumber: number;
  duration?: number;
  type?: string;
}

/**
 * Pattern type distribution for different difficulties
 */
interface PatternTypeDistribution {
  random: number;
  scale: number;
  arpeggio: number;
}

/**
 * Scale definitions
 */
const SCALES = {
  major: {
    C: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
    G: ['G', 'A', 'B', 'C', 'D', 'E', 'F#'],
    F: ['F', 'G', 'A', 'Bb', 'C', 'D', 'E'],
    D: ['D', 'E', 'F#', 'G', 'A', 'B', 'C#'],
    A: ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#']
  },
  minor: {
    A: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    E: ['E', 'F#', 'G', 'A', 'B', 'C', 'D'],
    D: ['D', 'E', 'F', 'G', 'A', 'Bb', 'C']
  }
};

/**
 * Chord definitions (triads)
 */
const CHORD_INTERVALS = {
  major: [0, 4, 7],      // Root, major 3rd, perfect 5th
  minor: [0, 3, 7],      // Root, minor 3rd, perfect 5th
  diminished: [0, 3, 6], // Root, minor 3rd, diminished 5th
};

/**
 * Musical Pattern Generator class
 */
export class MusicalPatternGenerator {
  // Pattern type distributions by difficulty
  private readonly distributions: Record<string, PatternTypeDistribution> = {
    single_notes: { random: 0.5, scale: 0.35, arpeggio: 0.15 },
    intervals: { random: 0.4, scale: 0.3, arpeggio: 0.3 },
    triads: { random: 0.3, scale: 0.2, arpeggio: 0.5 }
  };

  /**
   * Generate a scale segment
   */
  public generateScaleSegment(
    key: string, 
    type: 'major' | 'minor', 
    length: number,
    direction: 'ascending' | 'descending' = 'ascending'
  ): MusicalNote[] {
    const perfStart = performance.now();
    
    try {
      const scale = SCALES[type][key];
      if (!scale) {
        throw new Error(`Scale not found: ${key} ${type}`);
      }

      const notes: MusicalNote[] = [];
      const startOctave = 4;
      let currentIndex = Math.floor(Math.random() * scale.length);
      
      for (let i = 0; i < length; i++) {
        const noteName = scale[currentIndex % scale.length];
        const octaveOffset = Math.floor(currentIndex / scale.length);
        
        notes.push(this.createNote(
          noteName,
          startOctave + octaveOffset,
          direction === 'ascending'
        ));
        
        currentIndex = direction === 'ascending' ? currentIndex + 1 : currentIndex - 1;
        if (currentIndex < 0) {
          currentIndex = scale.length - 1;
        }
      }
      
      perfLogger.debug('Scale segment generated', {
        key, type, length, time: performance.now() - perfStart
      });
      
      // For descending, reverse the notes and adjust octaves
      if (direction === 'descending') {
        notes.reverse();
        // Ensure each note is lower than the previous
        for (let i = 1; i < notes.length; i++) {
          while (notes[i].midiNumber >= notes[i - 1].midiNumber) {
            notes[i].octave--;
            notes[i].midiNumber -= 12;
          }
        }
      }
      
      return notes;
      
    } catch (error) {
      perfLogger.error('Scale generation failed', error as Error);
      return this.getFallbackNotes(length);
    }
  }

  /**
   * Generate an arpeggio pattern
   */
  public generateArpeggio(
    root: string,
    type: 'major' | 'minor',
    inversion: 'root' | 'first' | 'second' = 'root'
  ): MusicalNote[] {
    const perfStart = performance.now();
    
    try {
      const intervals = CHORD_INTERVALS[type];
      const rootNote = this.createNote(root, 4);
      const notes: MusicalNote[] = [];
      
      // Build triad
      const triad = intervals.map(interval => 
        this.createNoteFromMidi(rootNote.midiNumber + interval)
      );
      
      // Apply inversion
      let orderedNotes: MusicalNote[];
      switch (inversion) {
        case 'first':
          orderedNotes = [triad[1], triad[2], this.transposeOctave(triad[0], 1)];
          break;
        case 'second':
          orderedNotes = [triad[2], this.transposeOctave(triad[0], 1), this.transposeOctave(triad[1], 1)];
          break;
        default:
          orderedNotes = triad;
      }
      
      perfLogger.debug('Arpeggio generated', {
        root, type, inversion, time: performance.now() - perfStart
      });
      
      return orderedNotes;
      
    } catch (error) {
      perfLogger.error('Arpeggio generation failed', error as Error);
      return this.getFallbackNotes(3);
    }
  }

  /**
   * Generate a broken chord pattern
   */
  public generateBrokenChord(
    root: string,
    type: 'major' | 'minor',
    length: number
  ): MusicalNote[] {
    const arpeggio = this.generateArpeggio(root, type);
    const pattern: MusicalNote[] = [];
    
    // Common broken chord patterns
    const patterns = [
      [0, 1, 2, 1], // Up and back
      [0, 2, 1, 2], // Root, 5th, 3rd, 5th
      [0, 1, 0, 2], // Alberti bass style
    ];
    
    const selectedPattern = patterns[Math.floor(Math.random() * patterns.length)];
    
    for (let i = 0; i < length; i++) {
      const noteIndex = selectedPattern[i % selectedPattern.length];
      pattern.push(arpeggio[noteIndex]);
    }
    
    return pattern;
  }

  /**
   * Generate a chord progression
   */
  public generateChordProgression(
    key: string,
    progression: string
  ): MusicalNote[][] {
    const perfStart = performance.now();
    
    try {
      const chords: MusicalNote[][] = [];
      const romanNumerals = progression.split('-');
      
      for (const numeral of romanNumerals) {
        const chord = this.buildChord(key, numeral);
        chords.push(chord);
      }
      
      perfLogger.debug('Chord progression generated', {
        key, progression, time: performance.now() - perfStart
      });
      
      return chords;
      
    } catch (error) {
      perfLogger.error('Chord progression generation failed', error as Error);
      return [this.getFallbackNotes(3)];
    }
  }

  /**
   * Build a chord from roman numeral
   */
  private buildChord(key: string, romanNumeral: string): MusicalNote[] {
    // Simplified chord building - maps roman numerals to scale degrees
    const scaleDegrees: Record<string, number> = {
      'I': 0, 'i': 0,
      'ii': 1, 'II': 1,
      'iii': 2, 'III': 2,
      'IV': 3, 'iv': 3,
      'V': 4, 'v': 4,
      'vi': 5, 'VI': 5,
      'vii': 6, 'VII': 6
    };
    
    const degree = scaleDegrees[romanNumeral] || 0;
    const isMinor = romanNumeral.toLowerCase() === romanNumeral;
    
    // Get the root note from the scale
    const scale = SCALES.major[key] || ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const rootNote = scale[degree];
    
    return this.generateArpeggio(
      rootNote.replace('#', '').replace('b', ''),
      isMinor ? 'minor' : 'major'
    );
  }

  /**
   * Generate MusicXML for a pattern
   */
  public generateMusicXMLForPattern(notes: MusicalNote[], type: string): string {
    // Simplified MusicXML generation
    const header = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>`;
      
    const noteElements = notes.map(note => `
      <note>
        <pitch>
          <step>${note.step.replace('#', '').replace('b', '')}</step>
          ${note.alter ? `<alter>${note.alter}</alter>` : ''}
          <octave>${note.octave}</octave>
        </pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>`).join('');
      
    const footer = `
    </measure>
  </part>
</score-partwise>`;
    
    return header + noteElements + footer;
  }

  /**
   * Generate MusicXML for chord progression
   */
  public generateMusicXMLForChordProgression(chords: MusicalNote[][]): string {
    // Generate MusicXML with chord notation
    const header = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">`;
      
    const chordElements = chords.map((chord, index) => {
      const notes = chord.map((note, noteIndex) => `
      <note>
        <pitch>
          <step>${note.step.replace('#', '').replace('b', '')}</step>
          ${note.alter ? `<alter>${note.alter}</alter>` : ''}
          <octave>${note.octave}</octave>
        </pitch>
        <duration>4</duration>
        <type>whole</type>
        ${noteIndex > 0 ? '<chord/>' : ''}
      </note>`).join('');
      
      return notes;
    }).join('');
      
    const footer = `
    </measure>
  </part>
</score-partwise>`;
    
    return header + chordElements + footer;
  }

  /**
   * Select pattern type based on distribution
   */
  public selectPatternType(
    difficulty: string, 
    customDistribution?: PatternTypeDistribution
  ): 'random' | 'scale' | 'arpeggio' {
    const distribution = customDistribution || this.distributions[difficulty] || this.distributions.single_notes;
    
    const random = Math.random();
    
    if (random < distribution.random) {
      return 'random';
    } else if (random < distribution.random + distribution.scale) {
      return 'scale';
    } else {
      return 'arpeggio';
    }
  }

  /**
   * Create a note from name and octave
   */
  private createNote(
    noteName: string, 
    octave: number,
    ascending: boolean = true
  ): MusicalNote {
    const step = noteName[0];
    let alter: number | undefined;
    
    if (noteName.includes('#')) {
      alter = 1;
    } else if (noteName.includes('b')) {
      alter = -1;
    }
    
    const midiNumber = this.noteToMidi(step, octave, alter);
    
    return {
      step,
      octave,
      alter,
      midiNumber,
      duration: 4,
      type: 'quarter'
    };
  }

  /**
   * Create a note from MIDI number
   */
  private createNoteFromMidi(midiNumber: number): MusicalNote {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midiNumber / 12) - 1;
    const noteIndex = midiNumber % 12;
    const noteName = noteNames[noteIndex];
    
    const step = noteName[0];
    const alter = noteName.includes('#') ? 1 : undefined;
    
    return {
      step,
      octave,
      alter,
      midiNumber,
      duration: 4,
      type: 'quarter'
    };
  }

  /**
   * Convert note to MIDI number
   */
  private noteToMidi(step: string, octave: number, alter?: number): number {
    const noteMap: Record<string, number> = {
      'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
    };
    
    const base = noteMap[step] || 0;
    const alteration = alter || 0;
    
    return (octave + 1) * 12 + base + alteration;
  }

  /**
   * Transpose a note by octaves
   */
  private transposeOctave(note: MusicalNote, octaves: number): MusicalNote {
    return {
      ...note,
      octave: note.octave + octaves,
      midiNumber: note.midiNumber + (octaves * 12)
    };
  }

  /**
   * Get fallback notes for error cases
   */
  private getFallbackNotes(count: number): MusicalNote[] {
    const notes: MusicalNote[] = [];
    for (let i = 0; i < count; i++) {
      notes.push({
        step: 'C',
        octave: 4,
        midiNumber: 60,
        duration: 4,
        type: 'quarter'
      });
    }
    return notes;
  }
}