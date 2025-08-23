/**
 * Speed Challenge Validator Service
 * Phase 3 Task 3.2 - Pattern Validation Implementation
 * 
 * Validates MIDI input against expected patterns with <1ms processing time.
 * Handles single notes, intervals, and triads with accuracy tracking.
 */

import { Pattern, PatternType } from '../types';
import { perfLogger } from '@/renderer/utils/performance-logger';

/**
 * Validation result with detailed information
 */
export interface ValidationResult {
  /** Whether the played note(s) match the expected pattern */
  correct: boolean;
  /** Whether the entire pattern has been completed */
  patternComplete: boolean;
  /** Expected MIDI note numbers */
  expectedNotes: number[];
  /** Actually played MIDI note numbers */
  playedNotes: number[];
  /** Response time in milliseconds from pattern start */
  responseTime?: number;
}

/**
 * Internal state for tracking pattern progress
 */
interface ValidationState {
  /** Notes that have been correctly played */
  playedNotes: Set<number>;
  /** Total attempts for this pattern */
  attempts: number;
  /** Correct attempts for this pattern */
  correctAttempts: number;
  /** Pattern start timestamp */
  patternStartTime: number;
}

/**
 * High-performance pattern validator for Speed Challenge Mode
 * 
 * Features:
 * - O(1) note lookup using Sets
 * - Minimal memory allocation
 * - Support for chords in any order
 * - Accurate timing measurements
 */
export class SpeedChallengeValidator {
  // Current validation state
  private state: ValidationState;
  
  // Session-wide statistics
  private totalAttempts: number = 0;
  private totalCorrect: number = 0;
  private currentStreak: number = 0;
  private maxStreak: number = 0;
  
  // Pre-allocated result object to avoid allocation in hot path
  private cachedResult: ValidationResult;
  
  constructor() {
    this.state = this.createFreshState();
    this.cachedResult = {
      correct: false,
      patternComplete: false,
      expectedNotes: [],
      playedNotes: [],
      responseTime: 0
    };
  }
  
  /**
   * Validate a MIDI note against the current pattern
   * 
   * @param midiNote - The MIDI note number played
   * @param pattern - The expected pattern
   * @param timestamp - When the note was played
   * @param patternStartTime - When the pattern started (optional)
   * @returns Validation result with completion status
   */
  validateNote(
    midiNote: number | null | undefined,
    pattern: Pattern | null | undefined,
    timestamp: number,
    patternStartTime?: number
  ): ValidationResult {
    // Handle invalid inputs gracefully
    if (!pattern || midiNote === null || midiNote === undefined) {
      return this.buildResult(false, false, [], [], 0);
    }
    
    // Handle empty pattern
    if (!pattern.notes || pattern.notes.length === 0) {
      return this.buildResult(false, false, [], [midiNote], 0);
    }
    
    // Extract expected notes
    const expectedNotes = pattern.notes.map(n => n.midi);
    
    // Update pattern start time if provided
    if (patternStartTime !== undefined) {
      this.state.patternStartTime = patternStartTime;
    }
    
    // Calculate response time
    const responseTime = this.state.patternStartTime > 0 
      ? timestamp - this.state.patternStartTime 
      : 0;
    
    // Check if any wrong note has been played for this pattern
    const patternFailed = Array.from(this.state.playedNotes).some(n => n < 0);
    
    // Check if note is expected
    const isExpected = expectedNotes.includes(midiNote);
    
    // If pattern already failed, all subsequent notes are considered incorrect
    const isCorrect = !patternFailed && isExpected;
    
    // Update state
    this.state.attempts++;
    this.totalAttempts++;
    
    if (isCorrect) {
      this.state.playedNotes.add(midiNote);
      this.state.correctAttempts++;
      this.totalCorrect++;
      this.currentStreak++;
      this.maxStreak = Math.max(this.maxStreak, this.currentStreak);
    } else {
      this.currentStreak = 0;
      if (!isExpected) {
        // Mark pattern as failed by adding wrong note to tracking
        // This prevents pattern completion even if correct notes are played later
        this.state.playedNotes.add(-midiNote); // Use negative to track wrong notes
      }
    }
    
    // Determine if pattern is complete
    const patternComplete = this.isPatternComplete(pattern, this.state.playedNotes);
    
    // Build result - filter out negative (wrong) notes and convert to positive for display
    const playedNotesArray = Array.from(this.state.playedNotes)
      .filter(n => n > 0); // Only include correctly played notes
    
    if (!isExpected) {
      playedNotesArray.push(midiNote); // Include current wrong note in result
    }
    
    return this.buildResult(
      isCorrect,  // Use isCorrect instead of isExpected
      patternComplete,
      expectedNotes,
      playedNotesArray,
      responseTime
    );
  }
  
  /**
   * Check if a pattern has been completed
   */
  private isPatternComplete(pattern: Pattern, playedNotes: Set<number>): boolean {
    // Check if any wrong notes were played (stored as negative values)
    for (const note of playedNotes) {
      if (note < 0) {
        return false; // Pattern failed due to wrong note
      }
    }
    
    // All expected notes must be played
    const expectedNotes = pattern.notes.map(n => n.midi);
    
    for (const note of expectedNotes) {
      if (!playedNotes.has(note)) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Build validation result (reuses cached object to avoid allocation)
   */
  private buildResult(
    correct: boolean,
    patternComplete: boolean,
    expectedNotes: number[],
    playedNotes: number[],
    responseTime: number
  ): ValidationResult {
    // Reuse cached object and update properties
    this.cachedResult.correct = correct;
    this.cachedResult.patternComplete = patternComplete;
    this.cachedResult.expectedNotes = expectedNotes;
    this.cachedResult.playedNotes = playedNotes;
    this.cachedResult.responseTime = responseTime;
    
    return { ...this.cachedResult }; // Return a copy for safety
  }
  
  /**
   * Reset state for a new pattern
   */
  resetForNewPattern(): void {
    this.state = this.createFreshState();
  }
  
  /**
   * Create fresh validation state
   */
  private createFreshState(): ValidationState {
    return {
      playedNotes: new Set<number>(),
      attempts: 0,
      correctAttempts: 0,
      patternStartTime: Date.now()
    };
  }
  
  /**
   * Get current accuracy (0.0 to 1.0)
   */
  getCurrentAccuracy(): number {
    if (this.totalAttempts === 0) return 0;
    return this.totalCorrect / this.totalAttempts;
  }
  
  /**
   * Get current streak count
   */
  getCurrentStreak(): number {
    return this.currentStreak;
  }
  
  /**
   * Get maximum streak achieved
   */
  getMaxStreak(): number {
    return this.maxStreak;
  }
  
  /**
   * Reset all statistics
   */
  resetStatistics(): void {
    this.totalAttempts = 0;
    this.totalCorrect = 0;
    this.currentStreak = 0;
    this.maxStreak = 0;
    this.resetForNewPattern();
  }
  
  /**
   * Get the next expected note(s) that haven't been played yet
   */
  getExpectedNotes(pattern: Pattern): number[] {
    if (!pattern || !pattern.notes) return [];
    
    const expectedNotes = pattern.notes.map(n => n.midi);
    // Filter out notes that have been correctly played (positive values only)
    const remainingNotes = expectedNotes.filter(note => !this.state.playedNotes.has(note));
    
    return remainingNotes;
  }
  
  /**
   * Check if a specific note has already been played for current pattern
   */
  hasPlayedNote(midiNote: number): boolean {
    return this.state.playedNotes.has(midiNote);
  }
  
  /**
   * Get detailed statistics for monitoring
   */
  getStatistics(): {
    accuracy: number;
    streak: number;
    maxStreak: number;
    totalAttempts: number;
    totalCorrect: number;
  } {
    return {
      accuracy: this.getCurrentAccuracy(),
      streak: this.currentStreak,
      maxStreak: this.maxStreak,
      totalAttempts: this.totalAttempts,
      totalCorrect: this.totalCorrect
    };
  }
}