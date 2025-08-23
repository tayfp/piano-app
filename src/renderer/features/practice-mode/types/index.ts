/**
 * Practice Mode Type Definitions
 * 
 * Core types for the practice mode feature that enables users to:
 * - Load a score with OSMD cursor
 * - Play notes at cursor position
 * - Get feedback (correct/incorrect)
 * - Advance through score as they play correctly
 */

/**
 * Represents a single note in practice mode
 */
export interface PracticeNote {
  /** MIDI note number (0-127) */
  midiValue: number;
  /** Human-readable pitch name (e.g., "C#4") */
  pitchName: string;
  /** Octave number (e.g., 4 for middle C) */
  octave: number;
}

/**
 * Represents a step in the practice sequence (can be single note, chord, or rest)
 */
export interface PracticeStep {
  /** Array of notes to be played simultaneously */
  notes: PracticeNote[];
  /** Whether this step is a chord (multiple notes) */
  isChord: boolean;
  /** Whether this step is a rest (no notes) */
  isRest: boolean;
  /** Index of the measure this step belongs to */
  measureIndex: number;
  /** Timestamp when this step was set as current */
  timestamp: number;
  
  // Extended fields for polyphonic timing (preserved from OptimizedPracticeStep)
  /** Duration in beats for note sustain (quarter note = 1.0) */
  realDuration?: number;
  /** When to advance cursor to next step (beats) - for polyphonic independence */
  advanceAfterBeats?: number;
  /** Grace notes/ornaments attached to this step */
  ornaments?: Array<{ midiNote: number }>;
  /** Unique identifier for debugging */
  id?: string;
  /** MIDI notes as a Set (for compatibility) */
  midiNotes?: Set<number>;
  /** Per-note durations for proper sustain */
  noteDurations?: Array<{ midi: number; durationBeats: number }>;
}

/**
 * Result of comparing played notes to expected notes
 */
export type ComparisonResult = 
  /** All expected notes were played correctly */
  | { type: 'CORRECT' }
  /** Some expected notes were not played */
  | { type: 'MISSING_NOTES'; missing: number[] }
  /** Extra notes were played that weren't expected */
  | { type: 'EXTRA_NOTES'; extra: number[] }
  /** Wrong notes were played instead of expected ones */
  | { type: 'WRONG_NOTES'; wrong: number[]; expected: number[] };

/**
 * Current status of the practice mode state machine
 */
export type PracticeStatus = 
  /** Not currently practicing */
  | 'idle' 
  /** Waiting for user to play the current notes */
  | 'listening' 
  /** Processing the played notes */
  | 'evaluating' 
  /** Showing positive feedback */
  | 'feedback_correct' 
  /** Showing negative feedback */
  | 'feedback_incorrect';

/**
 * Complete practice mode state
 */
export interface PracticeState {
  /** Whether practice mode is currently active */
  isActive: boolean;
  /** Current status in the state machine */
  status: PracticeStatus;
  /** Current step the user should play */
  currentStep: PracticeStep | null;
  /** Set of currently pressed MIDI keys */
  pressedKeys: Set<number>;
  /** Result of the last comparison */
  lastResult: ComparisonResult | null;
  /** Number of attempts on current step */
  attemptCount: number;
  /** Whether the score contains repeats */
  hasRepeats: boolean;
  /** Whether the repeat warning has been dismissed */
  repeatWarningDismissed: boolean;
  /** Whether repeat navigation is enabled (user toggle) */
  repeatsEnabled: boolean;
  /** Whether repeat navigation has failed and should be disabled */
  repeatsFailed: boolean;
  
  // Phase 1 optimization: Pre-computed sequence state
  /** Pre-computed practice sequence for O(1) lookup */
  optimizedSequence: OptimizedPracticeStep[];
  /** Current index in the optimized sequence */
  currentOptimizedIndex: number;
  
  // Custom measure range state
  /** Whether custom range is currently active */
  customRangeActive: boolean;
  /** Start measure for custom range (1-based) */
  customStartMeasure: number;
  /** End measure for custom range (1-based) */
  customEndMeasure: number;
  /** Current measure index in OSMD (0-based) */
  currentMeasureIndex?: number;
  /** Last successfully reached measure index for recovery (0-based) */
  lastValidMeasureIndex?: number;
}

/**
 * Result from getting the next practice step
 */
export type PracticeStepResult = 
  /** Normal practice step with notes */
  | PracticeStep 
  /** End of score reached */
  | { type: 'END_OF_SCORE' };

/**
 * Optimized practice step for pre-computed sequences (Phase 1 optimization)
 * Replaces real-time OSMD traversal with O(1) lookup
 */
export interface OptimizedPracticeStep {
  /** Unique identifier for React keys and debugging */
  id: string;
  /** Pre-computed MIDI notes for O(1) lookup */
  midiNotes: Set<number>;
  /** Pre-calculated boolean flags */
  isChord: boolean;
  isRest: boolean;
  /** OSMD element IDs for visual highlighting */
  visualElements: string[];
  /** Position metadata */
  measureIndex: number;
  stepIndex: number;
  /** Musical timing information */
  timestamp?: number;
}

/**
 * Difficulty metrics for a musical score
 */
export interface DifficultyMetrics {
  /** Total number of notes in the score */
  noteCount: number;
  /** Average number of notes per chord */
  chordComplexity: number;
  /** Complexity based on note durations and rhythms (0-10) */
  rhythmicComplexity: number;
  /** Number of key signature changes */
  keySignatureChanges: number;
  /** Number of tempo changes */
  tempoChanges: number;
  /** Overall difficulty assessment */
  overallDifficulty: 'beginner' | 'intermediate' | 'advanced';
}

/**
 * Practice session data for persistence
 */
export interface PracticeSession {
  /** Unique session ID */
  id?: number;
  /** ID of the score being practiced */
  scoreId: string;
  /** Session start timestamp */
  startTime: number;
  /** Session end timestamp (if completed) */
  endTime?: number;
  /** Current progress through the score */
  progress: {
    measureIndex: number;
    noteIndex: number;
    completedNotes: number;
    totalNotes: number;
  };
  /** Session statistics */
  statistics: {
    correctNotes: number;
    incorrectAttempts: number;
    averageReactionTime: number;
    practiceTimeMs: number;
  };
  /** Difficulty metrics for the score */
  difficultyMetrics?: DifficultyMetrics;
}

/**
 * Difficulty settings that can be adjusted
 */
export interface DifficultySettings {
  /** Wait for correct note before advancing */
  waitForCorrectNote: boolean;
  /** Number of attempts before showing hints */
  showHintsAfterAttempts: number;
  /** Automatically advance on rest notes */
  autoAdvanceRests: boolean;
  /** Highlight expected notes on piano */
  highlightExpectedNotes: boolean;
  /** Playback speed multiplier (0.5 to 2.0) */
  playbackSpeed: number;
  /** Enable section looping for difficult parts */
  sectionLooping: boolean;
  /** Enable adaptive difficulty adjustments */
  adaptiveDifficulty?: boolean;
}

/**
 * Analytics event types
 */
export interface PracticeEvent {
  timestamp: number;
  type: 'NOTE_PLAYED' | 'NOTE_CORRECT' | 'NOTE_INCORRECT' | 'HINT_SHOWN' | 'SESSION_START' | 'SESSION_END';
  data: {
    note?: number;
    velocity?: number;
    reactionTimeMs?: number;
    attemptNumber?: number;
    measureIndex?: number;
  };
}

/**
 * Analytics report structure
 */
export interface AnalyticsReport {
  sessionId: string;
  duration: number;
  events: PracticeEvent[];
  
  // Aggregated metrics
  metrics: {
    totalNotes: number;
    correctNotes: number;
    accuracy: number;
    averageReactionTime: number;
    
    // Problem areas
    difficultMeasures: Array<{
      measureIndex: number;
      errorRate: number;
      avgAttempts: number;
    }>;
    
    // Progress over time
    accuracyProgression: Array<{
      timestamp: number;
      accuracy: number;
    }>;
    
    // Note-specific metrics
    noteMetrics: Map<number, {
      playCount: number;
      errorCount: number;
      avgReactionTime: number;
    }>;
  };
}

/**
 * Musical repeat markings
 */
export interface RepeatMarking {
  type: 'REPEAT_START' | 'REPEAT_END' | 'DC' | 'DS' | 'CODA' | 'TO_CODA' | 'FINE' | 'SEGNO';
  measureIndex: number;
  targetMeasure?: number; // For jumps
}