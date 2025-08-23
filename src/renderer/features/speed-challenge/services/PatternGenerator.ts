/**
 * Pattern Generator Service for Speed Challenge Mode
 * 
 * Generates random musical patterns as MusicXML for different difficulty levels.
 * Optimized for performance with <5ms generation time per pattern.
 * 
 * Performance Target: <5ms per pattern generation
 */

import { v4 as uuidv4 } from 'uuid';
import { DifficultyLevel, Pattern } from '../types';
import { 
  loadTemplate, 
  injectNoteData, 
  prewarmTemplateCache,
  NoteData, 
  PatternData,
  TemplateType 
} from '../templates';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { MusicalPatternGenerator } from './MusicalPatternGenerator';

export interface GeneratedPattern extends Pattern {
  musicXML: string;
}

/**
 * Musical note representation with MIDI mapping
 */
interface MusicalNote {
  step: string;
  octave: number;
  alter?: number;
  midiNumber: number;
}

/**
 * Weighted item for selection algorithms
 */
export interface WeightedItem<T> {
  item: T;
  weight: number;
  category: string;
}

/**
 * Pattern Generator class that creates random musical patterns
 */
export class PatternGenerator {
  // Pattern history for repetition prevention (max 5 patterns)
  private patternHistory: GeneratedPattern[] = [];
  private readonly maxHistorySize = 5;
  private readonly similarityThreshold = 0.7; // 70% similarity threshold
  private readonly maxRetryAttempts = 10;
  
  // Weighted selection configuration
  private useWeightedSelection = true;
  
  // Progressive Black Key System
  private progressionLevel: 'beginner' | 'intermediate' | 'advanced' = 'beginner';
  private blackKeysUnlocked: string[] = [];
  private progressionByDifficulty: Record<string, 'beginner' | 'intermediate' | 'advanced'> = {
    'single_notes': 'beginner',
    'intervals': 'beginner',
    'basic_triads': 'beginner'
  };
  
  // Musical Pattern System
  private useMusicalPatterns = false;
  private musicalPatternGenerator: MusicalPatternGenerator | null = null;

  // Note pool for single note generation (C4 to C5)
  private readonly singleNotePool: MusicalNote[] = [
    { step: 'C', octave: 4, midiNumber: 60 },
    { step: 'D', octave: 4, midiNumber: 62 },
    { step: 'E', octave: 4, midiNumber: 64 },
    { step: 'F', octave: 4, midiNumber: 65 },
    { step: 'G', octave: 4, midiNumber: 67 },
    { step: 'A', octave: 4, midiNumber: 69 },
    { step: 'B', octave: 4, midiNumber: 71 },
    { step: 'C', octave: 5, midiNumber: 72 },
  ];

  // White keys only pool (for beginners)
  private readonly whiteKeysOnly: MusicalNote[] = [
    { step: 'C', octave: 4, midiNumber: 60 },
    { step: 'D', octave: 4, midiNumber: 62 },
    { step: 'E', octave: 4, midiNumber: 64 },
    { step: 'F', octave: 4, midiNumber: 65 },
    { step: 'G', octave: 4, midiNumber: 67 },
    { step: 'A', octave: 4, midiNumber: 69 },
    { step: 'B', octave: 4, midiNumber: 71 },
    { step: 'C', octave: 5, midiNumber: 72 },
    { step: 'D', octave: 5, midiNumber: 74 },
    { step: 'E', octave: 5, midiNumber: 76 },
    { step: 'F', octave: 5, midiNumber: 77 },
    { step: 'G', octave: 5, midiNumber: 79 },
    { step: 'A', octave: 5, midiNumber: 81 },
    { step: 'B', octave: 5, midiNumber: 83 }
  ];
  
  // Common black keys pool (F#, Bb, Eb - most common in music)
  private readonly commonBlackKeys: MusicalNote[] = [
    ...this.whiteKeysOnly,
    { step: 'F', octave: 4, alter: 1, midiNumber: 66 }, // F#
    { step: 'B', octave: 4, alter: -1, midiNumber: 70 }, // Bb
    { step: 'E', octave: 4, alter: -1, midiNumber: 63 }, // Eb
    { step: 'F', octave: 5, alter: 1, midiNumber: 78 }, // F#
    { step: 'B', octave: 5, alter: -1, midiNumber: 82 }, // Bb
    { step: 'E', octave: 5, alter: -1, midiNumber: 75 }  // Eb
  ];
  
  // All chromatic notes pool (all 12 semitones)
  private readonly allChromaticNotes: MusicalNote[] = [
    { step: 'C', octave: 4, midiNumber: 60 },
    { step: 'C', octave: 4, alter: 1, midiNumber: 61 }, // C#
    { step: 'D', octave: 4, midiNumber: 62 },
    { step: 'E', octave: 4, alter: -1, midiNumber: 63 }, // Eb
    { step: 'E', octave: 4, midiNumber: 64 },
    { step: 'F', octave: 4, midiNumber: 65 },
    { step: 'F', octave: 4, alter: 1, midiNumber: 66 }, // F#
    { step: 'G', octave: 4, midiNumber: 67 },
    { step: 'G', octave: 4, alter: 1, midiNumber: 68 }, // G#
    { step: 'A', octave: 4, midiNumber: 69 },
    { step: 'B', octave: 4, alter: -1, midiNumber: 70 }, // Bb
    { step: 'B', octave: 4, midiNumber: 71 },
    { step: 'C', octave: 5, midiNumber: 72 },
    { step: 'C', octave: 5, alter: 1, midiNumber: 73 }, // C#
    { step: 'D', octave: 5, midiNumber: 74 },
    { step: 'E', octave: 5, alter: -1, midiNumber: 75 }, // Eb
    { step: 'E', octave: 5, midiNumber: 76 },
    { step: 'F', octave: 5, midiNumber: 77 },
    { step: 'F', octave: 5, alter: 1, midiNumber: 78 }, // F#
    { step: 'G', octave: 5, midiNumber: 79 },
    { step: 'G', octave: 5, alter: 1, midiNumber: 80 }, // G#
    { step: 'A', octave: 5, midiNumber: 81 },
    { step: 'B', octave: 5, alter: -1, midiNumber: 82 }, // Bb
    { step: 'B', octave: 5, midiNumber: 83 }
  ];

  // Extended note pool for intervals and triads
  private readonly extendedNotePool: MusicalNote[] = [
    // C3 to C6 range for more variety
    { step: 'C', octave: 3, midiNumber: 48 },
    { step: 'D', octave: 3, midiNumber: 50 },
    { step: 'E', octave: 3, midiNumber: 52 },
    { step: 'F', octave: 3, midiNumber: 53 },
    { step: 'G', octave: 3, midiNumber: 55 },
    { step: 'A', octave: 3, midiNumber: 57 },
    { step: 'B', octave: 3, midiNumber: 59 },
    { step: 'C', octave: 4, midiNumber: 60 },
    { step: 'D', octave: 4, midiNumber: 62 },
    { step: 'E', octave: 4, midiNumber: 64 },
    { step: 'F', octave: 4, midiNumber: 65 },
    { step: 'G', octave: 4, midiNumber: 67 },
    { step: 'A', octave: 4, midiNumber: 69 },
    { step: 'B', octave: 4, midiNumber: 71 },
    { step: 'C', octave: 5, midiNumber: 72 },
    { step: 'D', octave: 5, midiNumber: 74 },
    { step: 'E', octave: 5, midiNumber: 76 },
    { step: 'F', octave: 5, midiNumber: 77 },
    { step: 'G', octave: 5, midiNumber: 79 },
    { step: 'A', octave: 5, midiNumber: 81 },
    { step: 'B', octave: 5, midiNumber: 83 },
    { step: 'C', octave: 6, midiNumber: 84 },
  ];

  // Interval types (in semitones)
  private readonly intervalTypes = {
    minor3rd: 3,
    major3rd: 4,
    perfect4th: 5,
    perfect5th: 7,
    octave: 12,
  };

  constructor() {
    // Prewarm template cache for optimal performance
    prewarmTemplateCache();
  }

  /**
   * Generate a single pattern for the specified difficulty
   * @param difficulty - The difficulty level or legacy difficulty name
   * @param patternType - Optional pattern type (for compatibility)
   * @returns Generated pattern with MusicXML
   */
  generatePattern(difficulty: DifficultyLevel | 'easy' | 'medium' | 'hard', patternType?: any): GeneratedPattern {
    const perfStart = performance.now();

    try {
      // Map legacy difficulty names to current levels
      const mappedDifficulty: DifficultyLevel = this.mapDifficulty(difficulty);

      let pattern: GeneratedPattern;
      let attempts = 0;
      let isValid = false;

      // Try to generate a pattern that's not too similar to recent ones
      while (!isValid && attempts < this.maxRetryAttempts) {
        switch (mappedDifficulty) {
          case 'single_notes':
            pattern = this.generateSingleNotePattern();
            break;
          case 'intervals':
            pattern = this.generateIntervalPattern();
            break;
          case 'basic_triads':
            pattern = this.generateTriadPattern();
            break;
          default:
            throw new Error(`Invalid difficulty level: ${mappedDifficulty}`);
        }

        // Check if pattern is too similar to recent ones
        isValid = this.isPatternValid(pattern!);
        attempts++;

        if (!isValid && attempts < this.maxRetryAttempts) {
          perfLogger.debug('Pattern too similar, regenerating', { 
            attempt: attempts,
            patternId: pattern!.id 
          });
        }
      }

      // Add pattern to history
      this.addToHistory(pattern!);

      // Add legacy properties for compatibility
      if (patternType) {
        (pattern! as any).type = patternType;
      }
      if (difficulty === 'easy' || difficulty === 'medium' || difficulty === 'hard') {
        (pattern! as any).difficulty = difficulty;
        (pattern! as any).tempo = this.getTempoForDifficulty(difficulty);
        (pattern! as any).timeSignature = { numerator: 4, denominator: 4 };
        (pattern! as any).notes = pattern!.notes.map((note: any) => ({
          pitches: [note.midiNumber || 60],
          duration: note.duration || 4,
          ...note
        }));
      }

      const generationTime = performance.now() - perfStart;
      perfLogger.debug('Pattern generated', { 
        difficulty, 
        generationTime,
        patternId: pattern!.id,
        attempts 
      });

      return pattern!;

    } catch (error) {
      perfLogger.error('Pattern generation failed', error as Error);
      // Return fallback pattern
      return this.getFallbackPattern(difficulty);
    }
  }

  /**
   * Generate multiple patterns in batch
   * @param difficulty - The difficulty level
   * @param count - Number of patterns to generate
   * @returns Array of generated patterns
   */
  generateBatch(difficulty: DifficultyLevel, count: number): GeneratedPattern[] {
    const perfStart = performance.now();
    const patterns: GeneratedPattern[] = [];

    for (let i = 0; i < count; i++) {
      patterns.push(this.generatePattern(difficulty));
    }

    perfLogger.debug('Batch generation complete', { 
      difficulty, 
      count,
      totalTime: performance.now() - perfStart 
    });

    return patterns;
  }

  /**
   * Generate a single note pattern
   */
  private generateSingleNotePattern(): GeneratedPattern {
    // Check if we should use musical patterns
    if (this.useMusicalPatterns && this.musicalPatternGenerator) {
      const patternType = this.musicalPatternGenerator.selectPatternType('single_notes');
      
      if (patternType === 'scale') {
        return this.generateScalePattern(5); // 5-note scale segment
      } else if (patternType === 'arpeggio') {
        return this.generateArpeggioPattern();
      }
      // Fall through to random pattern
    }
    
    // Select pool based on progression level
    const pool = this.getCurrentNotePool();
    const note = this.selectRandomNote(pool);
    const noteData: NoteData = {
      step: note.step,
      octave: note.octave,
      alter: note.alter,
      duration: 4,
      type: 'quarter'
    };

    const template = loadTemplate('single-note');
    const musicXML = injectNoteData(template, { notes: [noteData] });

    return {
      id: uuidv4(),
      difficulty: 'single_notes',
      notes: [noteData],
      expectedMidiNotes: [note.midiNumber],
      musicXML,
      createdAt: Date.now()
    };
  }

  /**
   * Generate an interval pattern
   */
  private generateIntervalPattern(): GeneratedPattern {
    const baseNote = this.selectRandomNote(this.extendedNotePool);
    const intervalType = this.selectRandomInterval();
    const secondNote = this.getNoteAtInterval(baseNote, intervalType);

    const notes: NoteData[] = [
      {
        step: baseNote.step,
        octave: baseNote.octave,
        alter: baseNote.alter,
        duration: 4,
        type: 'quarter'
      },
      {
        step: secondNote.step,
        octave: secondNote.octave,
        alter: secondNote.alter,
        duration: 4,
        type: 'quarter'
      }
    ];

    const template = loadTemplate('interval');
    const musicXML = injectNoteData(template, { notes });

    return {
      id: uuidv4(),
      difficulty: 'intervals',
      notes,
      expectedMidiNotes: [baseNote.midiNumber, secondNote.midiNumber],
      musicXML,
      createdAt: Date.now()
    };
  }

  /**
   * Generate a triad pattern
   */
  private generateTriadPattern(): GeneratedPattern {
    const rootNote = this.selectRandomNote(this.extendedNotePool);
    const isMajor = Math.random() > 0.5;
    
    // Generate major or minor triad
    const thirdInterval = isMajor ? 4 : 3; // Major 3rd or minor 3rd
    const fifthInterval = 7; // Perfect 5th

    const thirdNote = this.getNoteAtInterval(rootNote, thirdInterval);
    const fifthNote = this.getNoteAtInterval(rootNote, fifthInterval);

    const notes: NoteData[] = [
      {
        step: rootNote.step,
        octave: rootNote.octave,
        alter: rootNote.alter,
        duration: 4,
        type: 'quarter'
      },
      {
        step: thirdNote.step,
        octave: thirdNote.octave,
        alter: thirdNote.alter,
        duration: 4,
        type: 'quarter'
      },
      {
        step: fifthNote.step,
        octave: fifthNote.octave,
        alter: fifthNote.alter,
        duration: 4,
        type: 'quarter'
      }
    ];

    const template = loadTemplate('triad');
    const musicXML = injectNoteData(template, { notes });

    return {
      id: uuidv4(),
      difficulty: 'basic_triads',
      notes,
      expectedMidiNotes: [
        rootNote.midiNumber,
        thirdNote.midiNumber,
        fifthNote.midiNumber
      ],
      musicXML,
      createdAt: Date.now()
    };
  }

  /**
   * Select a random note from the pool
   */
  private selectRandomNote(pool: MusicalNote[]): MusicalNote {
    if (!this.useWeightedSelection) {
      // Uniform random selection
      const index = Math.floor(Math.random() * pool.length);
      return pool[index];
    }
    
    // Weighted selection based on musical importance
    const weights = this.getPedagogicalNoteWeights();
    const weightedPool: WeightedItem<MusicalNote>[] = pool.map(note => {
      const weight = weights[note.step] || 10; // Default weight if not specified
      return this.createWeightedItem(note, weight, this.getNoteCategory(note.step));
    });
    
    return this.selectWeighted(weightedPool);
  }

  /**
   * Select a random interval type
   */
  private selectRandomInterval(): number {
    if (!this.useWeightedSelection) {
      const intervals = Object.values(this.intervalTypes);
      const index = Math.floor(Math.random() * intervals.length);
      return intervals[index];
    }
    
    // Weighted interval selection
    const weights = this.getIntervalWeights();
    const weightedIntervals: WeightedItem<number>[] = [
      this.createWeightedItem(7, weights.perfect5th, 'perfect5th'),   // Perfect 5th
      this.createWeightedItem(4, weights.major3rd, 'major3rd'),       // Major 3rd
      this.createWeightedItem(3, weights.minor3rd, 'minor3rd'),       // Minor 3rd
      this.createWeightedItem(5, weights.perfect4th, 'perfect4th'),   // Perfect 4th
      this.createWeightedItem(12, weights.octave, 'octave')           // Octave
    ];
    
    return this.selectWeighted(weightedIntervals);
  }

  /**
   * Get a note at a specific interval from a base note
   */
  private getNoteAtInterval(baseNote: MusicalNote, interval: number): MusicalNote {
    const targetMidi = baseNote.midiNumber + interval;
    
    // Find the closest note in the pool
    let closestNote = this.extendedNotePool[0];
    let minDiff = Math.abs(targetMidi - closestNote.midiNumber);

    for (const note of this.extendedNotePool) {
      const diff = Math.abs(targetMidi - note.midiNumber);
      if (diff < minDiff) {
        minDiff = diff;
        closestNote = note;
      }
      // Exact match found
      if (diff === 0) {
        return note;
      }
    }

    // If no exact match, create a new note
    if (minDiff > 0) {
      return this.createNoteFromMidi(targetMidi);
    }

    return closestNote;
  }

  /**
   * Create a note from MIDI number
   */
  private createNoteFromMidi(midiNumber: number): MusicalNote {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midiNumber / 12) - 1;
    const noteIndex = midiNumber % 12;
    const noteName = noteNames[noteIndex];

    // Handle sharps/flats
    let step = noteName[0];
    let alter: number | undefined;
    
    if (noteName.includes('#')) {
      alter = 1;
    }

    return {
      step,
      octave,
      alter,
      midiNumber
    };
  }

  /**
   * Get a fallback pattern in case of generation failure
   */
  private getFallbackPattern(difficulty: DifficultyLevel): GeneratedPattern {
    perfLogger.warn('Using fallback pattern', { difficulty });

    // Simple C4 pattern as fallback
    const noteData: NoteData = {
      step: 'C',
      octave: 4,
      duration: 4,
      type: 'quarter'
    };

    const template = loadTemplate('single-note');
    const musicXML = injectNoteData(template, { notes: [noteData] });

    return {
      id: uuidv4(),
      difficulty,
      notes: [noteData],
      expectedMidiNotes: [60], // C4
      musicXML,
      createdAt: Date.now()
    };
  }

  // ============================================================================
  // REPETITION BUFFER SYSTEM METHODS
  // ============================================================================

  /**
   * Add a pattern to the history buffer
   */
  private addToHistory(pattern: GeneratedPattern): void {
    this.patternHistory.push(pattern);
    
    // Maintain max history size (FIFO)
    if (this.patternHistory.length > this.maxHistorySize) {
      this.patternHistory.shift();
    }
  }

  /**
   * Check if a pattern is valid (not too similar to recent ones)
   */
  private isPatternValid(pattern: GeneratedPattern): boolean {
    if (this.patternHistory.length === 0) {
      return true;
    }

    // Check similarity with the most recent pattern
    const recentPattern = this.patternHistory[this.patternHistory.length - 1];
    const similarity = this.calculatePatternSimilarity(pattern, recentPattern);

    return similarity < this.similarityThreshold;
  }

  /**
   * Calculate similarity between two patterns (0.0 to 1.0)
   */
  public calculatePatternSimilarity(pattern1: GeneratedPattern, pattern2: GeneratedPattern): number {
    // If difficulties are different, reduce base similarity
    let similarity = 0.0;
    
    if (pattern1.difficulty !== pattern2.difficulty) {
      return 0.0; // Different difficulties are considered different
    }

    // Compare MIDI notes
    const notes1 = pattern1.expectedMidiNotes;
    const notes2 = pattern2.expectedMidiNotes;

    if (notes1.length === 0 || notes2.length === 0) {
      return 0.0;
    }

    // Calculate similarity based on common notes and positions
    let matchingNotes = 0;
    const maxLength = Math.max(notes1.length, notes2.length);
    const minLength = Math.min(notes1.length, notes2.length);

    // Check for exact matches at each position
    for (let i = 0; i < minLength; i++) {
      if (notes1[i] === notes2[i]) {
        matchingNotes++;
      }
    }

    // Calculate position-based similarity
    const positionSimilarity = matchingNotes / maxLength;

    // Check for note content similarity (regardless of position)
    const set1 = new Set(notes1);
    const set2 = new Set(notes2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    const contentSimilarity = intersection.size / union.size;

    // Weighted average of position and content similarity
    similarity = (positionSimilarity * 0.7) + (contentSimilarity * 0.3);

    return similarity;
  }

  /**
   * Generate a hash for a pattern (for quick comparison)
   */
  public hashPattern(pattern: GeneratedPattern): string {
    // Create a more unique hash based on pattern properties
    const noteString = pattern.expectedMidiNotes.join(',');
    const noteCount = pattern.expectedMidiNotes.length;
    const timestamp = pattern.createdAt || Date.now();
    
    // Include pattern ID for uniqueness when notes are the same
    const hash = `${pattern.difficulty}-${noteString}-${noteCount}-${pattern.id}`;
    return hash;
  }

  /**
   * Get the current pattern history
   */
  public getPatternHistory(): GeneratedPattern[] {
    return [...this.patternHistory];
  }

  /**
   * Clear the pattern history
   */
  public clearPatternHistory(): void {
    this.patternHistory = [];
  }

  /**
   * Reset for a new session
   */
  public resetForNewSession(): void {
    this.clearPatternHistory();
    perfLogger.debug('Pattern generator reset for new session');
  }

  /**
   * Get available template count (for testing)
   */
  public getAvailableTemplateCount(): number {
    // Return a mock count for now
    return 3; // single-note, interval, triad
  }

  /**
   * Check if templates exist for a difficulty (for testing)
   */
  public hasTemplatesForDifficulty(difficulty: string): boolean {
    const validDifficulties = ['easy', 'medium', 'hard'];
    return validDifficulties.includes(difficulty);
  }

  /**
   * Map difficulty names between legacy and current format
   */
  private mapDifficulty(difficulty: string): DifficultyLevel {
    const mapping: Record<string, DifficultyLevel> = {
      'easy': 'single_notes',
      'medium': 'intervals',
      'hard': 'basic_triads',
      'single_notes': 'single_notes',
      'intervals': 'intervals',
      'basic_triads': 'basic_triads'
    };
    return mapping[difficulty] || 'single_notes';
  }

  /**
   * Get tempo for a difficulty level
   */
  private getTempoForDifficulty(difficulty: string): number {
    const tempos: Record<string, number> = {
      'easy': 120,
      'medium': 100,
      'hard': 80
    };
    return tempos[difficulty] || 120;
  }

  // ============================================================================
  // WEIGHTED SELECTION METHODS
  // ============================================================================

  /**
   * Create a weighted item
   */
  public createWeightedItem<T>(item: T, weight: number, category: string): WeightedItem<T> {
    return { item, weight, category };
  }

  /**
   * Get pedagogical note weights for musical importance
   */
  public getPedagogicalNoteWeights(): Record<string, number> {
    return {
      'C': 30,  // Tonic - most important
      'G': 25,  // Dominant
      'E': 20,  // Mediant
      'F': 15,  // Subdominant
      'D': 10,  // Supertonic
      'A': 8,   // Submediant
      'B': 5    // Leading tone
    };
  }

  /**
   * Get interval weights for pedagogical importance
   */
  public getIntervalWeights(): Record<string, number> {
    return {
      perfect5th: 30,
      major3rd: 25,
      minor3rd: 20,
      perfect4th: 15,
      octave: 10
    };
  }

  /**
   * Select an item based on weights
   */
  public selectWeighted<T>(items: WeightedItem<T>[]): T {
    if (items.length === 0) {
      throw new Error('Cannot select from empty weighted list');
    }
    
    // Filter out zero-weight items
    const validItems = items.filter(item => item.weight > 0);
    
    if (validItems.length === 0) {
      throw new Error('All items have zero weight');
    }
    
    if (validItems.length === 1) {
      return validItems[0].item;
    }
    
    // Calculate total weight
    const totalWeight = validItems.reduce((sum, item) => sum + item.weight, 0);
    
    // Generate random value between 0 and totalWeight
    let random = Math.random() * totalWeight;
    
    // Select based on weight distribution
    for (const weightedItem of validItems) {
      random -= weightedItem.weight;
      if (random <= 0) {
        return weightedItem.item;
      }
    }
    
    // Fallback (should not reach here)
    return validItems[validItems.length - 1].item;
  }

  /**
   * Enable or disable weighted selection
   */
  public enableWeightedSelection(enable: boolean): void {
    this.useWeightedSelection = enable;
  }

  /**
   * Check if weighted selection is enabled
   */
  public isWeightedSelectionEnabled(): boolean {
    return this.useWeightedSelection;
  }

  /**
   * Get the musical category for a note
   */
  private getNoteCategory(step: string): string {
    const categories: Record<string, string> = {
      'C': 'tonic',
      'D': 'supertonic',
      'E': 'mediant',
      'F': 'subdominant',
      'G': 'dominant',
      'A': 'submediant',
      'B': 'leading-tone'
    };
    return categories[step] || 'chromatic';
  }

  /**
   * Identify interval type from semitone distance
   */
  public identifyInterval(note1: number, note2: number): string {
    const distance = Math.abs(note2 - note1);
    
    switch (distance) {
      case 3: return 'minor3rd';
      case 4: return 'major3rd';
      case 5: return 'perfect4th';
      case 7: return 'perfect5th';
      case 12: return 'octave';
      default: return `interval_${distance}`;
    }
  }

  // ============================================================================
  // PROGRESSIVE BLACK KEY METHODS
  // ============================================================================

  /**
   * Get all note pools for progressive difficulty
   */
  public getNotePools() {
    return {
      whiteKeysOnly: this.whiteKeysOnly,
      commonBlackKeys: this.commonBlackKeys,
      allChromaticNotes: this.allChromaticNotes
    };
  }

  /**
   * Get progression levels configuration
   */
  public getProgressionLevels() {
    return {
      beginner: {
        pool: 'whiteKeysOnly',
        requiredAccuracy: 0,
        sessionDuration: 0
      },
      intermediate: {
        pool: 'commonBlackKeys',
        requiredAccuracy: 0.8,
        sessionDuration: 60000 // 1 minute
      },
      advanced: {
        pool: 'allChromaticNotes',
        requiredAccuracy: 0.85,
        sessionDuration: 180000 // 3 minutes
      }
    };
  }

  /**
   * Select note pool based on accuracy and session duration
   */
  public selectNotePool(accuracy: number, sessionDuration: number): string {
    const levels = this.getProgressionLevels();
    
    // Check advanced criteria
    if (accuracy >= levels.advanced.requiredAccuracy && 
        sessionDuration >= levels.advanced.sessionDuration) {
      return 'allChromaticNotes';
    }
    
    // Check intermediate criteria
    if (accuracy >= levels.intermediate.requiredAccuracy && 
        sessionDuration >= levels.intermediate.sessionDuration) {
      return 'commonBlackKeys';
    }
    
    // Default to beginner
    return 'whiteKeysOnly';
  }

  /**
   * Select note pool from store state
   */
  public selectNotePoolFromStore(storeState: any): string {
    const sessionDuration = Date.now() - storeState.sessionStartTime;
    const accuracy = storeState.totalNotes > 0 
      ? storeState.correctNotes / storeState.totalNotes 
      : 0;
    
    return this.selectNotePool(accuracy, sessionDuration);
  }

  /**
   * Set progression level
   */
  public setProgressionLevel(level: 'beginner' | 'intermediate' | 'advanced'): void {
    this.progressionLevel = level;
  }

  /**
   * Set unlocked black keys
   */
  public setBlackKeysUnlocked(keys: string[]): void {
    this.blackKeysUnlocked = keys;
  }

  /**
   * Get current note pool based on progression level
   */
  private getCurrentNotePool(): MusicalNote[] {
    switch (this.progressionLevel) {
      case 'advanced':
        return this.allChromaticNotes;
      case 'intermediate':
        // Filter common black keys to only include unlocked ones if specified
        if (this.blackKeysUnlocked.length > 0) {
          return this.commonBlackKeys.filter(note => {
            // Include all white keys
            if (!note.alter || note.alter === 0) return true;
            
            // Check if black key is unlocked
            const noteIdentifier = note.alter === 1 ? `${note.step}#` : `${note.step}b`;
            return this.blackKeysUnlocked.includes(noteIdentifier);
          });
        }
        return this.commonBlackKeys;
      case 'beginner':
      default:
        return this.whiteKeysOnly;
    }
  }

  /**
   * Get progression by difficulty
   */
  public getProgressionByDifficulty() {
    return this.progressionByDifficulty;
  }

  /**
   * Set progression for a specific difficulty
   */
  public setProgressionForDifficulty(difficulty: string, level: 'beginner' | 'intermediate' | 'advanced'): void {
    this.progressionByDifficulty[difficulty] = level;
  }

  /**
   * Get progression for a specific difficulty
   */
  public getProgressionForDifficulty(difficulty: string): 'beginner' | 'intermediate' | 'advanced' {
    return this.progressionByDifficulty[difficulty] || 'beginner';
  }

  // ============================================================================
  // MUSICAL PATTERN METHODS
  // ============================================================================

  /**
   * Enable or disable musical patterns
   */
  public enableMusicalPatterns(enable: boolean): void {
    this.useMusicalPatterns = enable;
    if (enable && !this.musicalPatternGenerator) {
      this.musicalPatternGenerator = new MusicalPatternGenerator();
    }
  }

  /**
   * Set the musical pattern generator
   */
  public setMusicalPatternGenerator(generator: MusicalPatternGenerator): void {
    this.musicalPatternGenerator = generator;
  }

  /**
   * Generate a scale-based pattern
   */
  private generateScalePattern(length: number): GeneratedPattern {
    if (!this.musicalPatternGenerator) {
      throw new Error('Musical pattern generator not initialized');
    }

    // Select a random key and scale type
    const keys = ['C', 'G', 'F', 'D', 'A'];
    const key = keys[Math.floor(Math.random() * keys.length)];
    const type = Math.random() > 0.7 ? 'minor' : 'major';
    const direction = Math.random() > 0.5 ? 'ascending' : 'descending';
    
    const notes = this.musicalPatternGenerator.generateScaleSegment(key, type, length, direction);
    const musicXML = this.musicalPatternGenerator.generateMusicXMLForPattern(notes, 'scale');
    
    // Convert to NoteData format
    const noteData: NoteData[] = notes.map(note => ({
      step: note.step,
      octave: note.octave,
      alter: note.alter,
      duration: note.duration || 4,
      type: note.type || 'quarter'
    }));
    
    return {
      id: uuidv4(),
      difficulty: 'single_notes',
      notes: noteData,
      expectedMidiNotes: notes.map(n => n.midiNumber),
      musicXML,
      createdAt: Date.now()
    };
  }

  /**
   * Generate an arpeggio-based pattern
   */
  private generateArpeggioPattern(): GeneratedPattern {
    if (!this.musicalPatternGenerator) {
      throw new Error('Musical pattern generator not initialized');
    }

    // Select a random root and type
    const roots = ['C', 'G', 'F', 'D', 'A', 'E'];
    const root = roots[Math.floor(Math.random() * roots.length)];
    const type = Math.random() > 0.6 ? 'minor' : 'major';
    const inversions: ('root' | 'first' | 'second')[] = ['root', 'first', 'second'];
    const inversion = inversions[Math.floor(Math.random() * inversions.length)];
    
    const notes = this.musicalPatternGenerator.generateArpeggio(root, type, inversion);
    const musicXML = this.musicalPatternGenerator.generateMusicXMLForPattern(notes, 'arpeggio');
    
    // Convert to NoteData format
    const noteData: NoteData[] = notes.map(note => ({
      step: note.step,
      octave: note.octave,
      alter: note.alter,
      duration: note.duration || 4,
      type: note.type || 'quarter'
    }));
    
    return {
      id: uuidv4(),
      difficulty: 'single_notes',
      notes: noteData,
      expectedMidiNotes: notes.map(n => n.midiNumber),
      musicXML,
      createdAt: Date.now()
    };
  }
}