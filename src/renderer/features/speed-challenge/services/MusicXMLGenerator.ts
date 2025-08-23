/**
 * MusicXML Generator Service for Speed Challenge Mode
 * 
 * Provides advanced MusicXML generation capabilities including
 * multi-measure patterns, dynamic time signatures, and complex rhythms.
 * This service complements PatternGenerator for more sophisticated patterns.
 * 
 * Performance Target: <5ms per generation
 */

import { NoteData } from '../templates';
import { perfLogger } from '@/renderer/utils/performance-logger';

export interface MusicXMLOptions {
  title?: string;
  tempo?: number;
  timeSignature?: { beats: number; beatType: number };
  keySignature?: number; // Number of sharps (positive) or flats (negative)
  measures?: number;
  clef?: 'treble' | 'bass' | 'grand';
}

/**
 * Advanced MusicXML generator for complex patterns
 */
export class MusicXMLGenerator {
  /**
   * Generate a complete MusicXML document from note data
   */
  static generateMusicXML(
    notes: NoteData[],
    options: MusicXMLOptions = {}
  ): string {
    const perfStart = performance.now();

    const {
      title = 'Speed Challenge Pattern',
      tempo = 120,
      timeSignature = { beats: 4, beatType: 4 },
      keySignature = 0,
      measures = 1,
      clef = 'treble'
    } = options;

    const xml = this.buildMusicXML(notes, {
      title,
      tempo,
      timeSignature,
      keySignature,
      measures,
      clef
    });

    perfLogger.debug('MusicXML generated', {
      generationTime: performance.now() - perfStart,
      noteCount: notes.length,
      measures
    });

    return xml;
  }

  /**
   * Build the MusicXML structure
   */
  private static buildMusicXML(
    notes: NoteData[],
    options: Required<MusicXMLOptions>
  ): string {
    const { title, tempo, timeSignature, keySignature, measures, clef } = options;

    // Header
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>${title}</work-title>
  </work>
  <identification>
    <creator type="composer">Speed Challenge Generator</creator>
    <encoding>
      <software>Urtext Piano</software>
      <encoding-date>${new Date().toISOString().split('T')[0]}</encoding-date>
    </encoding>
  </identification>`;

    // Part list
    xml += `
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
      <score-instrument id="P1-I1">
        <instrument-name>Piano</instrument-name>
      </score-instrument>
      <midi-device id="P1-I1" port="1"></midi-device>
      <midi-instrument id="P1-I1">
        <midi-channel>1</midi-channel>
        <midi-program>1</midi-program>
        <volume>78.7402</volume>
        <pan>0</pan>
      </midi-instrument>
    </score-part>
  </part-list>`;

    // Part with measures
    xml += `
  <part id="P1">`;

    // Calculate notes per measure
    const notesPerMeasure = Math.ceil(notes.length / measures);

    for (let m = 0; m < measures; m++) {
      xml += `
    <measure number="${m + 1}">`;

      // Add attributes to first measure
      if (m === 0) {
        xml += `
      <attributes>
        <divisions>4</divisions>
        <key>
          <fifths>${keySignature}</fifths>
        </key>
        <time>
          <beats>${timeSignature.beats}</beats>
          <beat-type>${timeSignature.beatType}</beat-type>
        </time>`;

        // Add clef(s)
        if (clef === 'treble') {
          xml += `
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>`;
        } else if (clef === 'bass') {
          xml += `
        <clef>
          <sign>F</sign>
          <line>4</line>
        </clef>`;
        } else if (clef === 'grand') {
          xml += `
        <staves>2</staves>
        <clef number="1">
          <sign>G</sign>
          <line>2</line>
        </clef>
        <clef number="2">
          <sign>F</sign>
          <line>4</line>
        </clef>`;
        }

        xml += `
      </attributes>`;

        // Add tempo marking
        xml += `
      <direction placement="above">
        <direction-type>
          <metronome>
            <beat-unit>quarter</beat-unit>
            <per-minute>${tempo}</per-minute>
          </metronome>
        </direction-type>
        <sound tempo="${tempo}"/>
      </direction>`;
      }

      // Add notes for this measure
      const startIdx = m * notesPerMeasure;
      const endIdx = Math.min(startIdx + notesPerMeasure, notes.length);
      const measureNotes = notes.slice(startIdx, endIdx);

      for (let i = 0; i < measureNotes.length; i++) {
        const note = measureNotes[i];
        const isChord = i > 0 && this.shouldBeChord(measureNotes, i);

        xml += `
      <note>`;

        if (isChord) {
          xml += `
        <chord/>`;
        }

        xml += `
        <pitch>
          <step>${note.step}</step>`;

        if (note.alter !== undefined && note.alter !== 0) {
          xml += `
          <alter>${note.alter}</alter>`;
        }

        xml += `
          <octave>${note.octave}</octave>
        </pitch>
        <duration>${note.duration}</duration>
        <voice>1</voice>
        <type>${note.type}</type>`;

        // Determine stem direction
        const stemDirection = note.octave >= 5 ? 'down' : 'up';
        xml += `
        <stem>${stemDirection}</stem>`;

        xml += `
      </note>`;
      }

      xml += `
    </measure>`;
    }

    xml += `
  </part>
</score-partwise>`;

    return xml;
  }

  /**
   * Determine if a note should be part of a chord
   */
  private static shouldBeChord(notes: NoteData[], index: number): boolean {
    if (index === 0) return false;
    
    // Check if this note has the same duration and type as previous
    const currentNote = notes[index];
    const previousNote = notes[index - 1];
    
    return currentNote.duration === previousNote.duration &&
           currentNote.type === previousNote.type;
  }

  /**
   * Generate a scale pattern
   */
  static generateScalePattern(
    startNote: string,
    startOctave: number,
    scaleType: 'major' | 'minor' | 'chromatic',
    ascending: boolean = true,
    noteCount: number = 8
  ): string {
    const notes = this.generateScaleNotes(
      startNote,
      startOctave,
      scaleType,
      ascending,
      noteCount
    );

    return this.generateMusicXML(notes, {
      title: `${scaleType.charAt(0).toUpperCase() + scaleType.slice(1)} Scale`,
      measures: Math.ceil(noteCount / 4)
    });
  }

  /**
   * Generate notes for a scale
   */
  private static generateScaleNotes(
    startNote: string,
    startOctave: number,
    scaleType: 'major' | 'minor' | 'chromatic',
    ascending: boolean,
    noteCount: number
  ): NoteData[] {
    const noteSequence = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const startIndex = noteSequence.indexOf(startNote);
    
    if (startIndex === -1) {
      throw new Error(`Invalid start note: ${startNote}`);
    }

    const notes: NoteData[] = [];
    let currentIndex = startIndex;
    let currentOctave = startOctave;

    // Scale intervals (in semitones from root)
    const scaleIntervals = {
      major: [0, 2, 4, 5, 7, 9, 11, 12],
      minor: [0, 2, 3, 5, 7, 8, 10, 12],
      chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    };

    const intervals = scaleIntervals[scaleType];

    for (let i = 0; i < noteCount; i++) {
      const intervalIndex = i % intervals.length;
      const semitones = intervals[intervalIndex];
      
      // Calculate note
      const noteIndex = (startIndex + Math.floor(semitones / 2)) % 7;
      const octaveOffset = Math.floor((startIndex + Math.floor(semitones / 2)) / 7);
      
      notes.push({
        step: noteSequence[noteIndex],
        octave: currentOctave + octaveOffset,
        duration: 4,
        type: 'quarter'
      });

      // Handle octave changes
      if (ascending && noteIndex === 0 && i > 0) {
        currentOctave++;
      } else if (!ascending && noteIndex === 6 && i > 0) {
        currentOctave--;
      }
    }

    if (!ascending) {
      notes.reverse();
    }

    return notes;
  }

  /**
   * Generate an arpeggio pattern
   */
  static generateArpeggioPattern(
    rootNote: string,
    rootOctave: number,
    chordType: 'major' | 'minor' | 'diminished' | 'augmented',
    pattern: number[] = [0, 1, 2, 1] // Index pattern for arpeggio
  ): string {
    const notes = this.generateArpeggioNotes(
      rootNote,
      rootOctave,
      chordType,
      pattern
    );

    return this.generateMusicXML(notes, {
      title: `${chordType.charAt(0).toUpperCase() + chordType.slice(1)} Arpeggio`,
      measures: Math.ceil(pattern.length / 4)
    });
  }

  /**
   * Generate notes for an arpeggio
   */
  private static generateArpeggioNotes(
    rootNote: string,
    rootOctave: number,
    chordType: 'major' | 'minor' | 'diminished' | 'augmented',
    pattern: number[]
  ): NoteData[] {
    // Chord intervals in semitones
    const chordIntervals = {
      major: [0, 4, 7],
      minor: [0, 3, 7],
      diminished: [0, 3, 6],
      augmented: [0, 4, 8]
    };

    const intervals = chordIntervals[chordType];
    const chordNotes = this.getChordNotes(rootNote, rootOctave, intervals);

    // Apply pattern
    const notes: NoteData[] = [];
    for (const index of pattern) {
      if (index < chordNotes.length) {
        notes.push({
          ...chordNotes[index],
          duration: 4,
          type: 'quarter'
        });
      }
    }

    return notes;
  }

  /**
   * Get chord notes from intervals
   */
  private static getChordNotes(
    rootNote: string,
    rootOctave: number,
    intervals: number[]
  ): NoteData[] {
    const noteSequence = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const rootIndex = noteSequence.indexOf(rootNote);
    
    return intervals.map(interval => {
      const totalSemitones = interval;
      const noteOffset = Math.floor(totalSemitones * 7 / 12); // Approximate
      const noteIndex = (rootIndex + noteOffset) % 7;
      const octaveOffset = Math.floor((rootIndex + noteOffset) / 7);
      
      return {
        step: noteSequence[noteIndex],
        octave: rootOctave + octaveOffset,
        duration: 4,
        type: 'quarter'
      };
    });
  }
}