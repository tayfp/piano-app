/**
 * Speed Challenge Mode - TypeScript Type Definitions
 * Phase 1 Task 1.1 - Core Types Implementation
 * 
 * Follows urtext-piano architectural patterns with strict TypeScript compliance.
 * Performance-optimized interfaces for <20ms MIDI latency requirement.
 */

// ============================================================================
// ENUMS - Runtime Values for Speed Challenge System
// ============================================================================

/**
 * Difficulty levels for Speed Challenge Mode
 * Maps to pattern complexity and user skill progression
 */
export enum DifficultyLevel {
  SINGLE_NOTES = 'single_notes',     // MVP Phase 1: Individual notes only
  INTERVALS = 'intervals',           // Phase 2: Two-note harmonic intervals  
  BASIC_TRIADS = 'basic_triads'      // Phase 3: Three-note basic triads
}

/**
 * Simplified difficulty type for UI components
 */
export type Difficulty = 'singleNotes' | 'intervals' | 'triads';

/**
 * Pattern type classification for generation and validation
 * Aligns with difficulty levels for consistent UX
 */
export enum PatternType {
  SINGLE_NOTES = 'single_notes',        // Single note patterns
  HARMONIC_INTERVAL = 'harmonic_interval', // Two simultaneous notes
  BASIC_TRIAD = 'basic_triad'           // Three-note chords (major/minor)
}

/**
 * Visual feedback types for user response indication
 * Designed for immediate (<2ms) visual response
 */
export enum VisualFeedbackType {
  SUCCESS = 'success',       // Green/positive feedback (correct note)
  ERROR = 'error',           // Red/negative feedback (incorrect note)
  WARNING = 'warning',       // Yellow/warning feedback (timeout/slow)
  HINT = 'hint',            // Blue hint for next expected note
  NONE = 'none'             // Clear/no feedback
}

// ============================================================================
// CORE DATA INTERFACES - Performance-Critical Types
// ============================================================================

/**
 * Individual note within a pattern
 * Optimized for minimal memory footprint in pattern queues
 */
export interface PatternNote {
  /** MIDI note number (0-127) */
  midi: number;
  
  /** Note duration in quarter notes (1.0 = quarter note) */
  duration: number;
  
  /** Start time offset within pattern (in quarter notes) */
  startTime: number;
  
  /** Voice/staff assignment (optional, defaults to 1) */
  voice?: number;
}

/**
 * Complete musical pattern for Speed Challenge
 * Contains all data needed for generation, display, and validation
 */
export interface Pattern {
  /** Unique identifier for pattern tracking */
  id: string;
  
  /** Pattern type for classification */
  type: PatternType;
  
  /** Difficulty level for user progression */
  difficulty: DifficultyLevel;
  
  /** Array of notes comprising this pattern */
  notes: PatternNote[];
  
  /** Generated MusicXML for OSMD rendering */
  musicXML: string;
  
  /** Expected total pattern duration in milliseconds */
  expectedDuration: number;
  
  /** Additional pattern metadata */
  metadata: {
    /** Key signature (e.g., 'C', 'G', 'Bb') */
    key?: string;
    
    /** Time signature (e.g., '4/4', '3/4') */
    timeSignature?: string;
    
    /** Tempo in BPM */
    tempo?: number;
    
    /** Human-readable pattern description */
    description?: string;
  };
}

/**
 * Result of MIDI note validation against expected pattern
 * Critical for <20ms response time requirement
 */
export interface ValidationResult {
  /** Whether the played note was correct */
  correct: boolean;
  
  /** Timestamp of validation (performance.now()) */
  timestamp: number;
  
  /** Expected MIDI note number (if applicable) */
  expectedNote?: number;
  
  /** Actually played MIDI note number */
  actualNote: number;
  
  /** Whether this completes the current pattern */
  patternComplete: boolean;
  
  /** Response time from pattern display to note press (ms) */
  responseTime?: number;
}

/**
 * Performance metrics for user progress tracking
 * Calculated incrementally to avoid computation spikes
 */
export interface PerformanceMetrics {
  /** Overall accuracy as decimal (0.0 - 1.0) */
  accuracy: number;
  
  /** Average response time in milliseconds */
  averageResponseTime: number;
  
  /** Current streak of correct notes */
  streak: number;
  
  /** Total notes attempted in session */
  totalNotes: number;
  
  /** Total correct notes in session */
  correctNotes: number;
  
  /** Session duration in milliseconds */
  sessionDuration: number;
}

// ============================================================================
// SETTINGS AND CONFIGURATION
// ============================================================================

/**
 * User-configurable settings for Speed Challenge Mode
 * Persisted to localStorage via Zustand middleware
 */
export interface SpeedChallengeSettings {
  /** Initial difficulty level when starting challenge */
  startingDifficulty: DifficultyLevel;
  
  /** Enable automatic difficulty progression based on performance */
  adaptiveDifficulty: boolean;
  
  /** Show note names on staff notation */
  showNoteNames: boolean;
  
  /** Enable metronome click during challenge */
  metronomeEnabled: boolean;
  
  /** Target tempo in BPM for pattern generation */
  targetBPM: number;
  
  /** Duration to show visual feedback (milliseconds) */
  visualFeedbackDuration: number;
  
  /** Time to display pattern before enabling input (0 = immediate) */
  patternDisplayTime: number;
}

// ============================================================================
// STATE MANAGEMENT INTERFACES
// ============================================================================

/**
 * Complete state for Speed Challenge Mode
 * Designed for Zustand store with performance optimizations
 */
export interface SpeedChallengeState {
  // ========== Core State ==========
  /** Whether speed challenge is currently active */
  isActive: boolean;
  
  /** Current difficulty level */
  currentLevel: DifficultyLevel;
  
  /** Currently displayed pattern (null if none) */
  currentPattern: Pattern | null;
  
  /** Generated MusicXML for current display */
  generatedMusicXML: string | null;
  
  // ========== Progress Tracking ==========
  /** Current session score */
  score: number;
  
  /** Current streak of correct notes */
  streak: number;
  
  /** Current session accuracy (0.0 - 1.0) */
  accuracy: number;
  
  /** Average response time for current session */
  averageResponseTime: number;
  
  /** Total notes attempted in current session */
  totalNotes: number;
  
  /** Total correct notes in current session */
  correctNotes: number;
  
  /** Session start timestamp */
  sessionStartTime: number;
  
  // ========== Pattern Management ==========
  /** Pre-generated pattern queue for smooth performance */
  patternQueue: Pattern[];
  
  /** Target queue size (patterns to keep ahead) */
  queueSize: number;
  
  /** Current position in pattern queue */
  currentPatternIndex: number;
  
  // ========== Timing State ==========
  /** Timestamp when current pattern was displayed */
  patternStartTime: number;
  
  /** Expected timestamp for next note input */
  noteExpectedTime: number;
  
  /** Timestamp of last note input */
  lastNoteTime: number;
  
  // ========== UI State ==========
  /** Whether settings panel is visible */
  showSettings: boolean;
  
  /** Whether statistics panel is visible */
  showStats: boolean;
  
  /** Current visual feedback state */
  visualFeedback: VisualFeedbackType | null;
  
  // ========== User Settings ==========
  /** Persisted user preferences */
  settings: SpeedChallengeSettings;
  
  // ========== Actions ==========
  /** Start a new speed challenge session */
  startChallenge: () => void;
  
  /** Stop the current speed challenge session */
  stopChallenge: () => void;
  
  /** Pause the current session (preserves progress) */
  pauseChallenge: () => void;
  
  /** Resume a paused session */
  resumeChallenge: () => void;
  
  /** Generate and advance to next pattern */
  generateNextPattern: () => void;
  
  /** Validate a MIDI note input against current pattern */
  validateNote: (midiNote: number) => ValidationResult;
  
  /** Update difficulty level and regenerate patterns */
  updateDifficulty: (level: DifficultyLevel) => void;
  
  /** Pre-generate patterns to fill queue */
  preGeneratePatterns: (count: number) => void;
  
  /** Update user settings */
  updateSettings: (settings: Partial<SpeedChallengeSettings>) => void;
  
  /** Show visual feedback for specified duration */
  showVisualFeedback: (type: VisualFeedbackType, duration?: number) => void;
  
  /** Clear current visual feedback */
  clearVisualFeedback: () => void;
  
  /** Toggle settings panel visibility */
  toggleSettings: () => void;
  
  /** Toggle statistics panel visibility */
  toggleStats: () => void;
  
  /** Reset all progress metrics */
  resetProgress: () => void;
}

// ============================================================================
// TYPE GUARDS AND UTILITIES
// ============================================================================

/**
 * Type guard to check if a value is a valid DifficultyLevel
 */
export function isDifficultyLevel(value: any): value is DifficultyLevel {
  return Object.values(DifficultyLevel).includes(value);
}

/**
 * Type guard to check if a value is a valid PatternType
 */
export function isPatternType(value: any): value is PatternType {
  return Object.values(PatternType).includes(value);
}

/**
 * Type guard to check if a value is a valid VisualFeedbackType
 */
export function isVisualFeedbackType(value: any): value is VisualFeedbackType {
  return Object.values(VisualFeedbackType).includes(value);
}

// ============================================================================
// PERFORMANCE-CRITICAL TYPE ALIASES
// ============================================================================

/**
 * MIDI note number type for clarity in hot paths
 */
export type MidiNote = number;

/**
 * Timestamp type (performance.now() result)
 */
export type Timestamp = number;

/**
 * Duration in milliseconds
 */
export type Duration = number;

/**
 * BPM (beats per minute) type
 */
export type BPM = number;

// ============================================================================
// DEFAULT VALUES
// ============================================================================

/**
 * Default settings for Speed Challenge Mode
 * Used for initial state and settings reset
 */
export const DEFAULT_SPEED_CHALLENGE_SETTINGS: SpeedChallengeSettings = {
  startingDifficulty: DifficultyLevel.SINGLE_NOTES,
  adaptiveDifficulty: true,
  showNoteNames: false,
  metronomeEnabled: false,
  targetBPM: 120,
  visualFeedbackDuration: 500,
  patternDisplayTime: 0
};

/**
 * Default queue size for pattern pre-generation
 * Balances memory usage with smooth performance
 */
export const DEFAULT_PATTERN_QUEUE_SIZE = 5;

/**
 * Maximum response time before timeout (milliseconds)
 * Supports both learning and speed goals
 */
export const MAX_RESPONSE_TIME_MS = 5000;