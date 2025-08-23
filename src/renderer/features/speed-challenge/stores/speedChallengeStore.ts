/**
 * Speed Challenge Mode - Zustand Store Implementation
 * Phase 1 Task 1.2 - Store Foundation
 * 
 * Follows urtext-piano architectural patterns with persistence and DevTools integration.
 * Optimized for <20ms MIDI latency requirement with minimal state update overhead.
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { 
  DifficultyLevel, 
  PatternType,
  VisualFeedbackType,
  DEFAULT_SPEED_CHALLENGE_SETTINGS,
  DEFAULT_PATTERN_QUEUE_SIZE,
  type Pattern,
  type SpeedChallengeSettings,
  type ValidationResult,
  type PerformanceMetrics
} from '../types';
import { PatternGenerator } from '../services/PatternGenerator';
import { SessionAnalytics } from '../services/SessionAnalytics';
import { perfLogger } from '@/renderer/utils/performance-logger';

// ============================================================================
// STORE STATE INTERFACE
// ============================================================================

/**
 * Visual feedback state for UI display
 * Matches test expectations from speedChallengeStore.test.ts
 */
interface VisualFeedbackState {
  noteNumber: number;
  type: VisualFeedbackType;
  timestamp: number;
}

/**
 * Complete store state including actions
 * Optimized for performance and following urtext-piano patterns
 */
interface SpeedChallengeStoreState {
  // ========== Core State ==========
  isActive: boolean;
  currentLevel: DifficultyLevel;
  currentPattern: Pattern | null;
  generatedMusicXML: string | null;
  
  // ========== Progress Tracking ==========
  score: number;
  streak: number;
  accuracy: number;
  averageResponseTime: number;
  totalNotes: number;
  correctNotes: number;
  sessionStartTime: number;
  
  // ========== Pattern Management ==========
  patternQueue: Pattern[];
  queueSize: number;
  currentPatternIndex: number;
  
  // ========== Timing State ==========
  patternStartTime: number;
  noteExpectedTime: number;
  lastNoteTime: number;
  
  // ========== UI State ==========
  showSettings: boolean;
  showStats: boolean;
  visualFeedback: VisualFeedbackState | null;
  
  // ========== User Settings ==========
  settings: SpeedChallengeSettings;
  
  // ========== Analytics ==========
  sessionAnalytics: SessionAnalytics | null;
  currentSessionId: string | null;
  
  // ========== Simplified Difficulty Access ==========
  difficulty: 'singleNotes' | 'intervals' | 'triads';
  
  // ========== Progressive Black Key System ==========
  blackKeysUnlocked: string[];
  progressLevel: 'beginner' | 'intermediate' | 'advanced';
  
  // ========== Timing State ==========
  currentPatternElapsed: number;     // Current timer in milliseconds
  patternCompletionTimes: number[];  // Last 5 completion times (FIFO)
  averageCompletionTime: number;     // Rolling average of times
  
  // ========== Crash Recovery ==========
  snapshotInterval: NodeJS.Timeout | null;
  lastSnapshotTime: number;
  
  // ========== Actions ==========
  startChallenge: () => void;
  stopChallenge: () => Promise<void>;
  pauseChallenge: () => void;
  resumeChallenge: () => void;
  generateNextPattern: () => void;
  validateNote: (midiNote: number, timestamp?: number) => ValidationResult;
  updateDifficulty: (metricsOrLevel: PerformanceMetrics | DifficultyLevel) => void;
  setDifficulty: (difficulty: 'singleNotes' | 'intervals' | 'triads') => void;
  preGeneratePatterns: (count: number) => void;
  updateSettings: (settings: Partial<SpeedChallengeSettings>) => void;
  showVisualFeedback: (noteNumber: number, type: VisualFeedbackType, duration?: number) => void;
  clearVisualFeedback: () => void;
  toggleSettings: () => void;
  toggleStats: () => void;
  resetProgress: () => void;
  
  /** Persist current session on-demand (e.g., when viewing stats) */
  persistCurrentSession: () => Promise<void>;
  
  /** Reset store to completely initial state (for testing) */
  resetToInitialState: () => void;
  
  // Progressive Black Key Actions
  unlockBlackKey: (key: string) => void;
  updateProgressLevel: (level: 'beginner' | 'intermediate' | 'advanced') => void;
  
  // Timer Actions
  updateElapsedTime: (elapsed: number) => void;
  recordPatternCompletion: () => void;
  
  // Crash Recovery Actions
  createSnapshot: () => void;
  restoreFromSnapshot: () => boolean;
  startSnapshotTimer: () => void;
  stopSnapshotTimer: () => void;
  
  // ========== Internal Zustand Methods ==========
  setState: (
    partial: Partial<SpeedChallengeStoreState> | ((state: SpeedChallengeStoreState) => Partial<SpeedChallengeStoreState>),
    replace?: boolean
  ) => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState = {
  // Core state
  isActive: false,
  currentLevel: DifficultyLevel.SINGLE_NOTES,
  currentPattern: null,
  generatedMusicXML: null,
  
  // Progress tracking
  score: 0,
  streak: 0,
  accuracy: 0,
  averageResponseTime: 0,
  totalNotes: 0,
  correctNotes: 0,
  sessionStartTime: 0,
  
  // Pattern management
  patternQueue: [] as Pattern[],
  queueSize: DEFAULT_PATTERN_QUEUE_SIZE,
  currentPatternIndex: 0,
  
  // Timing
  patternStartTime: 0,
  noteExpectedTime: 0,
  lastNoteTime: 0,
  
  // UI state
  showSettings: false,
  showStats: false,
  visualFeedback: null as VisualFeedbackState | null,
  
  // Settings
  settings: { ...DEFAULT_SPEED_CHALLENGE_SETTINGS },
  
  // Analytics
  sessionAnalytics: null,
  
  // Simplified difficulty access
  difficulty: 'singleNotes' as 'singleNotes' | 'intervals' | 'triads',
  
  // Progressive Black Key System
  blackKeysUnlocked: [] as string[],
  progressLevel: 'beginner' as 'beginner' | 'intermediate' | 'advanced',
  
  // Timing state
  currentPatternElapsed: 0,
  patternCompletionTimes: [],
  averageCompletionTime: 0,
  
  // Crash recovery
  snapshotInterval: null as NodeJS.Timeout | null,
  lastSnapshotTime: 0,
  
  // Session management
  currentSessionId: null
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate adaptive difficulty based on performance metrics
 * Follows urtext-piano pattern of extracting logic into pure functions
 */
function calculateAdaptiveDifficulty(
  currentLevel: DifficultyLevel, 
  metrics: PerformanceMetrics, 
  adaptiveEnabled: boolean
): DifficultyLevel {
  if (!adaptiveEnabled || metrics.totalNotes < 10) {
    return currentLevel;
  }
  
  // Advancement thresholds
  const highAccuracy = metrics.accuracy >= 0.85;
  const fastResponse = metrics.averageResponseTime <= 120;
  const goodStreak = metrics.streak >= 10;
  
  // Advancement logic
  if (highAccuracy && fastResponse && goodStreak) {
    switch (currentLevel) {
      case DifficultyLevel.SINGLE_NOTES:
        return DifficultyLevel.INTERVALS;
      case DifficultyLevel.INTERVALS:
        return DifficultyLevel.BASIC_TRIADS;
      case DifficultyLevel.BASIC_TRIADS:
        return DifficultyLevel.BASIC_TRIADS; // Max level
    }
  }
  
  return currentLevel;
}

/**
 * Update performance metrics incrementally for efficiency
 */
function updateMetrics(
  state: SpeedChallengeStoreState,
  correct: boolean,
  responseTime: number
): Partial<SpeedChallengeStoreState> {
  const newTotalNotes = state.totalNotes + 1;
  const newCorrectNotes = state.correctNotes + (correct ? 1 : 0);
  const newAccuracy = newCorrectNotes / newTotalNotes;
  
  // Incremental average calculation (avoids storing all response times)
  const newAverageResponseTime = responseTime > 0 
    ? ((state.averageResponseTime * state.totalNotes) + responseTime) / newTotalNotes
    : state.averageResponseTime;
  
  const newStreak = correct ? state.streak + 1 : 0;
  const newScore = correct ? state.score + 1 : state.score;
  
  return {
    totalNotes: newTotalNotes,
    correctNotes: newCorrectNotes,
    accuracy: newAccuracy,
    averageResponseTime: newAverageResponseTime,
    streak: newStreak,
    score: newScore
  };
}

/**
 * Update pattern completion history with FIFO queue management
 * Maintains a rolling average of the last N completion times
 */
function updateCompletionHistory(
  times: number[],
  newTime: number,
  maxHistory: number = 5
): { times: number[], average: number } {
  const updatedTimes = [newTime, ...times].slice(0, maxHistory);
  const average = updatedTimes.reduce((sum, t) => sum + t, 0) / updatedTimes.length;
  return { times: updatedTimes, average };
}

// ============================================================================
// PATTERN GENERATOR INSTANCE
// ============================================================================

/**
 * Global pattern generator instance for the store
 * Shared across all store operations for optimal performance
 */
const patternGenerator = new PatternGenerator();

/**
 * Adapter function to convert PatternGenerator output to store-compatible Pattern interface
 */
function convertGeneratedPattern(generated: any): Pattern {
  // Convert NoteData to PatternNote
  const convertedNotes = generated.notes ? generated.notes.map((noteData: any) => {
    // Calculate MIDI number from step and octave
    const stepToMidi: Record<string, number> = {
      'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
    };
    const baseMidi = (noteData.octave + 1) * 12 + stepToMidi[noteData.step];
    const midi = baseMidi + (noteData.alter || 0);
    
    return {
      midi,
      duration: noteData.duration,
      startTime: 0,
      voice: 1
    };
  }) : [];

  return {
    id: generated.id,
    type: PatternType.SINGLE_NOTES, // Map based on difficulty
    difficulty: generated.difficulty,
    notes: convertedNotes,
    musicXML: generated.musicXML,
    expectedDuration: 2000, // Default duration
    metadata: {
      key: 'C',
      timeSignature: '4/4',
      tempo: 120,
      description: `Generated pattern: ${generated.difficulty}`
    }
  };
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useSpeedChallengeStore = create<SpeedChallengeStoreState>()(
  persist(
    devtools(
      (set, get) => ({
        ...initialState,
        
        // ========== CORE ACTIONS ==========
        
        startChallenge: () => {
          const now = performance.now();
          const state = get();
          
          // Check for crash recovery first
          const restored = get().restoreFromSnapshot();
          
          // Generate session ID
          const sessionId = crypto.randomUUID ? crypto.randomUUID() : 
                            `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          
          // Create new SessionAnalytics instance for this session
          const sessionAnalytics = new SessionAnalytics();
          
          // Generate initial pattern and queue
          const initialPattern = convertGeneratedPattern(patternGenerator.generatePattern(
            restored ? state.currentLevel : state.settings.startingDifficulty
          ));
          const initialQueue = Array.from({ length: state.queueSize }, () =>
            convertGeneratedPattern(patternGenerator.generatePattern(
              restored ? state.currentLevel : state.settings.startingDifficulty
            ))
          );
          
          if (restored) {
            // Restored from snapshot - keep score/stats but generate new pattern
            set(
              {
                isActive: true,
                patternStartTime: now,
                currentPattern: initialPattern,
                generatedMusicXML: initialPattern.musicXML,
                patternQueue: initialQueue,
                currentPatternIndex: 0,
                sessionAnalytics,
                currentSessionId: sessionId
              },
              false,
              'speedChallenge/startRestored'
            );
            perfLogger.info('Challenge restored from snapshot');
          } else {
            // Fresh start
            set(
              {
                isActive: true,
                sessionStartTime: now,
                patternStartTime: now,
                currentLevel: state.settings.startingDifficulty,
                currentPattern: initialPattern,
                generatedMusicXML: initialPattern.musicXML,
                patternQueue: initialQueue,
                currentPatternIndex: 0,
                sessionAnalytics,
                currentSessionId: sessionId
              },
              false,
              'speedChallenge/startChallenge'
            );
          }
          
          // Start snapshot timer
          get().startSnapshotTimer();
          
          perfLogger.info('Speed Challenge started', { 
            difficulty: restored ? state.currentLevel : state.settings.startingDifficulty,
            restored,
            timestamp: now 
          });
        },
        
        stopChallenge: async () => {
          const state = get();
          
          // Stop snapshots
          get().stopSnapshotTimer();
          
          // Save session before stopping
          if (state.sessionAnalytics && state.currentSessionId) {
            try {
              await state.sessionAnalytics.persistSession(state.currentSessionId);
              perfLogger.info('Session data persisted successfully');
            } catch (error) {
              perfLogger.error('Failed to persist session', error);
            }
          }
          
          set(
            {
              isActive: false,
              currentPattern: null,
              generatedMusicXML: null,
              patternQueue: [],
              visualFeedback: null,
              showSettings: false,
              showStats: false,
              sessionAnalytics: null,
              currentSessionId: null
            },
            false,
            'speedChallenge/stopChallenge'
          );
          
          perfLogger.info('Speed Challenge stopped');
        },
        
        pauseChallenge: () => {
          set(
            { isActive: false },
            false,
            'speedChallenge/pauseChallenge'
          );
        },
        
        resumeChallenge: () => {
          const now = performance.now();
          set(
            { 
              isActive: true,
              patternStartTime: now 
            },
            false,
            'speedChallenge/resumeChallenge'
          );
        },
        
        // ========== PATTERN MANAGEMENT ==========
        
        generateNextPattern: () => {
          const state = get();
          const nextIndex = state.currentPatternIndex + 1;
          
          if (nextIndex < state.patternQueue.length) {
            set(
              {
                currentPatternIndex: nextIndex,
                currentPattern: state.patternQueue[nextIndex],
                generatedMusicXML: state.patternQueue[nextIndex].musicXML,
                patternStartTime: performance.now(),
                currentPatternElapsed: 0  // Reset timer for new pattern
              },
              false,
              'speedChallenge/generateNextPattern'
            );
          } else {
            // Queue exhausted - generate new patterns
            const newPatterns = Array.from({ length: state.queueSize }, () =>
              convertGeneratedPattern(patternGenerator.generatePattern(state.currentLevel))
            );
            
            set(
              {
                patternQueue: newPatterns,
                currentPatternIndex: 0,
                currentPattern: newPatterns[0],
                generatedMusicXML: newPatterns[0].musicXML,
                patternStartTime: performance.now(),
                currentPatternElapsed: 0  // Reset timer for new pattern
              },
              false,
              'speedChallenge/generateNextPattern'
            );
          }
        },
        
        preGeneratePatterns: (count: number) => {
          const state = get();
          const newPatterns = Array.from({ length: count }, () =>
            convertGeneratedPattern(patternGenerator.generatePattern(state.currentLevel))
          );
          
          set(
            {
              patternQueue: [...state.patternQueue, ...newPatterns]
            },
            false,
            'speedChallenge/preGeneratePatterns'
          );
        },
        
        // ========== VALIDATION ==========
        
        validateNote: (midiNote: number, timestamp = Date.now()): ValidationResult => {
          const state = get();
          
          // DEBUG LOGGING: Track validation calls
          if (process.env.NODE_ENV === 'development') {
            console.log('[SPEED CHALLENGE STORE DEBUG] validateNote called:', {
              midiNote,
              timestamp,
              isActive: state.isActive,
              currentPattern: state.currentPattern ? state.currentPattern.id : 'none',
              patternNotes: state.currentPattern ? state.currentPattern.notes.map(n => n.midi) : []
            });
          }
          
          // Handle invalid inputs gracefully
          if (isNaN(midiNote) || isNaN(timestamp)) {
            if (process.env.NODE_ENV === 'development') {
              console.log('[SPEED CHALLENGE STORE DEBUG] Invalid inputs - returning false');
            }
            return {
              correct: false,
              timestamp: isNaN(timestamp) ? Date.now() : timestamp,
              actualNote: isNaN(midiNote) ? 0 : midiNote,
              patternComplete: false
            };
          }
          
          // No validation when inactive
          if (!state.isActive || !state.currentPattern) {
            if (process.env.NODE_ENV === 'development') {
              console.log('[SPEED CHALLENGE STORE DEBUG] Speed Challenge inactive or no pattern - returning false');
            }
            return {
              correct: false,
              timestamp,
              actualNote: midiNote,
              patternComplete: false
            };
          }
          
          // Check if note matches current pattern expectation
          const expectedNotes = state.currentPattern.notes.map(note => note.midi);
          const correct = expectedNotes.includes(midiNote);
          const responseTime = timestamp - state.patternStartTime;
          
          if (process.env.NODE_ENV === 'development') {
            console.log('[SPEED CHALLENGE STORE DEBUG] Note validation:', {
              expectedNotes,
              actualNote: midiNote,
              correct,
              responseTime
            });
          }
          
          // Update metrics
          const metrics = updateMetrics(state, correct, responseTime);
          
          // Track pattern performance in analytics
          if (state.sessionAnalytics && state.currentPattern) {
            state.sessionAnalytics.trackPatternPerformance({
              patternId: state.currentPattern.id,
              difficulty: state.currentLevel,
              attemptTime: responseTime,
              correct,
              midiNotes: state.currentPattern.notes.map(n => n.midi),
              timestamp
            });
          }
          
          set(
            {
              ...metrics,
              lastNoteTime: timestamp
            },
            false,
            'speedChallenge/validateNote'
          );
          
          // Auto-advance on correct note (MVP behavior)
          if (correct) {
            if (process.env.NODE_ENV === 'development') {
              console.log('[SPEED CHALLENGE STORE DEBUG] Correct note - scheduling pattern advancement');
            }
            
            // Record completion time before advancing
            get().recordPatternCompletion();
            
            setTimeout(() => {
              const currentState = get();
              if (currentState.isActive) {
                if (process.env.NODE_ENV === 'development') {
                  console.log('[SPEED CHALLENGE STORE DEBUG] Generating next pattern');
                }
                currentState.generateNextPattern();
              }
            }, 0);
          }
          
          return {
            correct,
            timestamp,
            actualNote: midiNote,
            patternComplete: correct, // MVP: single notes complete immediately
            responseTime
          };
        },
        
        // ========== DIFFICULTY MANAGEMENT ==========
        
        updateDifficulty: (metricsOrLevel: PerformanceMetrics | DifficultyLevel) => {
          const state = get();
          
          let newLevel: DifficultyLevel;
          
          if (typeof metricsOrLevel === 'string') {
            // Direct level setting
            newLevel = metricsOrLevel;
          } else {
            // Adaptive difficulty based on metrics
            newLevel = calculateAdaptiveDifficulty(
              state.currentLevel,
              metricsOrLevel,
              state.settings.adaptiveDifficulty
            );
          }
          
          if (newLevel !== state.currentLevel) {
            // Map DifficultyLevel to simplified difficulty
            const difficultyMap: Record<DifficultyLevel, 'singleNotes' | 'intervals' | 'triads'> = {
              [DifficultyLevel.SINGLE_NOTES]: 'singleNotes',
              [DifficultyLevel.INTERVALS]: 'intervals',
              [DifficultyLevel.BASIC_TRIADS]: 'triads'
            };
            
            // Regenerate patterns for new difficulty
            const newPattern = convertGeneratedPattern(patternGenerator.generatePattern(newLevel));
            const newQueue = Array.from({ length: state.queueSize }, () =>
              convertGeneratedPattern(patternGenerator.generatePattern(newLevel))
            );
            
            set(
              {
                currentLevel: newLevel,
                difficulty: difficultyMap[newLevel],
                patternQueue: newQueue,
                currentPatternIndex: 0,
                currentPattern: newPattern,
                generatedMusicXML: newPattern.musicXML
              },
              false,
              'speedChallenge/updateDifficulty'
            );
            
            perfLogger.info('Difficulty updated', { 
              from: state.currentLevel, 
              to: newLevel 
            });
          }
        },
        
        setDifficulty: (difficulty: 'singleNotes' | 'intervals' | 'triads') => {
          // Map simplified difficulty to DifficultyLevel
          const levelMap: Record<'singleNotes' | 'intervals' | 'triads', DifficultyLevel> = {
            singleNotes: DifficultyLevel.SINGLE_NOTES,
            intervals: DifficultyLevel.INTERVALS,
            triads: DifficultyLevel.BASIC_TRIADS
          };
          
          const newLevel = levelMap[difficulty];
          const state = get();
          
          if (newLevel !== state.currentLevel) {
            // Regenerate patterns for new difficulty
            const newPattern = convertGeneratedPattern(patternGenerator.generatePattern(newLevel));
            const newQueue = Array.from({ length: state.queueSize }, () =>
              convertGeneratedPattern(patternGenerator.generatePattern(newLevel))
            );
            
            set(
              {
                currentLevel: newLevel,
                difficulty,
                patternQueue: newQueue,
                currentPatternIndex: 0,
                currentPattern: newPattern,
                generatedMusicXML: newPattern.musicXML
              },
              false,
              'speedChallenge/setDifficulty'
            );
            
            perfLogger.info('Difficulty set', { 
              difficulty,
              level: newLevel 
            });
          }
        },
        
        // ========== SETTINGS ==========
        
        updateSettings: (newSettings: Partial<SpeedChallengeSettings>) => {
          const state = get();
          
          // Handle invalid inputs gracefully
          if (!newSettings || typeof newSettings !== 'object') {
            return;
          }
          
          set(
            {
              settings: {
                ...state.settings,
                ...newSettings
              }
            },
            false,
            'speedChallenge/updateSettings'
          );
        },
        
        // ========== VISUAL FEEDBACK ==========
        
        showVisualFeedback: (noteNumber: number, type: VisualFeedbackType, duration?: number) => {
          const timestamp = performance.now();
          const state = get();
          const feedbackDuration = duration ?? state.settings.visualFeedbackDuration;
          
          set(
            {
              visualFeedback: {
                noteNumber,
                type,
                timestamp
              }
            },
            false,
            'speedChallenge/showVisualFeedback'
          );
          
          // Auto-clear after duration
          if (feedbackDuration > 0) {
            setTimeout(() => {
              const currentState = get();
              if (currentState.visualFeedback?.timestamp === timestamp) {
                currentState.clearVisualFeedback();
              }
            }, feedbackDuration);
          }
        },
        
        clearVisualFeedback: () => {
          set(
            { visualFeedback: null },
            false,
            'speedChallenge/clearVisualFeedback'
          );
        },
        
        // ========== UI CONTROLS ==========
        
        toggleSettings: () => {
          const state = get();
          set(
            { showSettings: !state.showSettings },
            false,
            'speedChallenge/toggleSettings'
          );
        },
        
        toggleStats: () => {
          const state = get();
          set(
            { showStats: !state.showStats },
            false,
            'speedChallenge/toggleStats'
          );
        },
        
        // ========== PROGRESS MANAGEMENT ==========
        
        resetProgress: () => {
          const state = get();
          
          // Reset analytics if active
          if (state.sessionAnalytics) {
            state.sessionAnalytics.resetSession();
          }
          
          set(
            {
              score: 0,
              streak: 0,
              accuracy: 0,
              averageResponseTime: 0,
              totalNotes: 0,
              correctNotes: 0,
              sessionStartTime: 0,
              patternStartTime: 0,
              noteExpectedTime: 0,
              lastNoteTime: 0,
              currentLevel: state.settings.startingDifficulty,
              currentPatternIndex: 0,
              visualFeedback: null,
              showSettings: false,
              showStats: false,
              patternQueue: [],
              currentPattern: null,
              generatedMusicXML: null,
              isActive: false,
              sessionAnalytics: null
            },
            false,
            'speedChallenge/resetProgress'
          );
        },
        
        persistCurrentSession: async () => {
          const state = get();
          if (state.sessionAnalytics && state.isActive && state.currentSessionId) {
            try {
              await state.sessionAnalytics.persistSession(state.currentSessionId);
              perfLogger.debug('Session persisted on-demand', { sessionId: state.currentSessionId });
            } catch (error) {
              perfLogger.warn('Failed to persist session on-demand', error);
            }
          }
        },
        
        resetToInitialState: () => {
          set(
            { ...initialState },
            true, // Replace entire state
            'speedChallenge/resetToInitialState'
          );
        },
        
        // ========== PROGRESSIVE BLACK KEY SYSTEM ==========
        
        unlockBlackKey: (key: string) => {
          set(
            (state) => ({
              blackKeysUnlocked: state.blackKeysUnlocked.includes(key) 
                ? state.blackKeysUnlocked 
                : [...state.blackKeysUnlocked, key]
            }),
            false,
            'speedChallenge/unlockBlackKey'
          );
        },
        
        updateProgressLevel: (level: 'beginner' | 'intermediate' | 'advanced') => {
          set(
            { progressLevel: level },
            false,
            'speedChallenge/updateProgressLevel'
          );
        },
        
        // ========== TIMER ACTIONS ==========
        
        updateElapsedTime: (elapsed: number) => {
          set(
            { currentPatternElapsed: elapsed },
            false,
            'speedChallenge/updateElapsedTime'
          );
        },
        
        recordPatternCompletion: () => {
          const state = get();
          const completionTime = performance.now() - state.patternStartTime;
          
          const { times, average } = updateCompletionHistory(
            state.patternCompletionTimes,
            completionTime
          );
          
          // Removed auto-save - persistence now happens on-demand only
          // (on stop, stats view, or page unload)
          
          set(
            {
              patternCompletionTimes: times,
              averageCompletionTime: average,
              currentPatternElapsed: 0
            },
            false,
            'speedChallenge/recordPatternCompletion'
          );
        },
        
        // ========== CRASH RECOVERY ==========
        
        createSnapshot: () => {
          const state = get();
          if (!state.isActive) return;
          
          const snapshot = {
            timestamp: Date.now(),
            score: state.score,
            streak: state.streak,
            accuracy: state.accuracy,
            totalNotes: state.totalNotes,
            correctNotes: state.correctNotes,
            sessionStartTime: state.sessionStartTime,
            currentLevel: state.currentLevel,
            blackKeysUnlocked: state.blackKeysUnlocked,
            progressLevel: state.progressLevel
          };
          
          try {
            sessionStorage.setItem('speed-challenge-snapshot', JSON.stringify(snapshot));
            set({ lastSnapshotTime: Date.now() });
            perfLogger.debug('Snapshot created');
          } catch (error) {
            // SessionStorage might be full or disabled
            perfLogger.debug('Snapshot failed', error);
          }
        },
        
        restoreFromSnapshot: () => {
          try {
            const snapshotStr = sessionStorage.getItem('speed-challenge-snapshot');
            if (!snapshotStr) return false;
            
            const snapshot = JSON.parse(snapshotStr);
            const age = Date.now() - snapshot.timestamp;
            
            // Only restore if less than 5 minutes old
            if (age < 300000) {
              set({
                score: snapshot.score,
                streak: snapshot.streak,
                accuracy: snapshot.accuracy,
                totalNotes: snapshot.totalNotes,
                correctNotes: snapshot.correctNotes,
                sessionStartTime: snapshot.sessionStartTime,
                currentLevel: snapshot.currentLevel,
                blackKeysUnlocked: snapshot.blackKeysUnlocked,
                progressLevel: snapshot.progressLevel
              });
              
              sessionStorage.removeItem('speed-challenge-snapshot');
              perfLogger.info('Restored from snapshot', { age: Math.round(age / 1000) + 's' });
              return true;
            }
            
            // Snapshot too old, remove it
            sessionStorage.removeItem('speed-challenge-snapshot');
          } catch (error) {
            perfLogger.debug('Snapshot restore failed', error);
          }
          return false;
        },
        
        startSnapshotTimer: () => {
          const state = get();
          if (state.snapshotInterval) return;
          
          // Create initial snapshot
          get().createSnapshot();
          
          // Set up periodic snapshots every 60 seconds
          const interval = setInterval(() => {
            get().createSnapshot();
          }, 60000);
          
          set({ snapshotInterval: interval });
          perfLogger.debug('Snapshot timer started');
        },
        
        stopSnapshotTimer: () => {
          const state = get();
          if (state.snapshotInterval) {
            clearInterval(state.snapshotInterval);
            set({ snapshotInterval: null });
            perfLogger.debug('Snapshot timer stopped');
          }
          sessionStorage.removeItem('speed-challenge-snapshot');
        },
        
        // ========== ZUSTAND INTERNAL ==========
        setState: set
      }),
      {
        name: 'speed-challenge-store',
        trace: process.env.NODE_ENV === 'development'
      }
    ),
    {
      name: 'abc-piano-speed-challenge-settings',
      // Only persist settings, not transient state
      partialize: (state) => ({ settings: state.settings }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...persistedState
      })
    }
  )
);

// ============================================================================
// SELECTORS AND UTILITIES
// ============================================================================

/**
 * Get current pattern from store (computed selector)
 * Follows urtext-piano pattern of avoiding circular dependencies
 */
export const getCurrentPattern = (): Pattern | null => {
  return useSpeedChallengeStore.getState().currentPattern;
};

/**
 * Get current session duration in milliseconds
 */
export const getSessionDuration = (): number => {
  const state = useSpeedChallengeStore.getState();
  if (state.sessionStartTime === 0) return 0;
  return performance.now() - state.sessionStartTime;
};

/**
 * Check if speed challenge is currently active
 */
export const isSpeedChallengeActive = (): boolean => {
  return useSpeedChallengeStore.getState().isActive;
};

/**
 * Get current performance metrics
 */
export const getCurrentMetrics = (): PerformanceMetrics => {
  const state = useSpeedChallengeStore.getState();
  return {
    accuracy: state.accuracy,
    averageResponseTime: state.averageResponseTime,
    streak: state.streak,
    totalNotes: state.totalNotes,
    correctNotes: state.correctNotes,
    sessionDuration: getSessionDuration()
  };
};

// ============================================================================
// PAGE UNLOAD HANDLER
// ============================================================================

/**
 * Set up page unload handler for emergency saves
 * This ensures data is persisted even if user closes browser without stopping
 */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const state = useSpeedChallengeStore.getState();
    if (state.isActive && state.sessionAnalytics) {
      // Try to persist (might not complete due to browser restrictions)
      // Using sendBeacon would be ideal but we're using IndexedDB
      state.sessionAnalytics.persistSession().catch(() => {
        // Silent fail - browser is closing
      });
      
      // At minimum, ensure snapshot is current
      state.createSnapshot();
    }
  });
  
  // Also handle visibility change for mobile browsers
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      const state = useSpeedChallengeStore.getState();
      if (state.isActive) {
        // Create snapshot when page becomes hidden
        state.createSnapshot();
      }
    }
  });
}