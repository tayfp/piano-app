/**
 * Data transformation utilities for Speed Challenge Analytics
 * Extracted from SessionAnalytics.ts for better separation of concerns
 */

import { NoteMetric } from '../services/SpeedChallengeDatabase';
import { PatternData, NoteMetrics, PatternPerformance } from '../types/analytics-types';

/**
 * Transform internal note metrics to database persistence format
 * 
 * @param noteMetrics Internal note metrics object
 * @param patterns Pattern data for finding fastest times
 * @returns Note metrics formatted for database storage
 */
export function transformNoteMetricsForPersistence(
  noteMetrics: NoteMetrics,
  patterns: Map<string, PatternData>
): Record<number, NoteMetric> {
  const result: Record<number, NoteMetric> = {};
  
  Object.entries(noteMetrics).forEach(([note, metrics]) => {
    const noteNum = Number(note);
    result[noteNum] = {
      note: noteNum,
      attempts: metrics.attempts,
      correct: metrics.correct,
      accuracy: metrics.accuracy,
      averageTime: metrics.averageTime,
      fastestTime: findFastestTimeForNote(noteNum, patterns)
    };
  });
  
  return result;
}

/**
 * Find the fastest completion time for a specific MIDI note
 * 
 * @param note MIDI note number
 * @param patterns Pattern data to search through
 * @returns Fastest time for the note, or Infinity if not found
 */
export function findFastestTimeForNote(note: number, patterns: Map<string, PatternData>): number {
  let fastestTime = Infinity;
  
  patterns.forEach(patternData => {
    patternData.attempts.forEach(attempt => {
      if (attempt.midiNotes.includes(note) && attempt.correct) {
        fastestTime = Math.min(fastestTime, attempt.attemptTime);
      }
    });
  });
  
  return fastestTime === Infinity ? 0 : fastestTime;
}

/**
 * Extract pattern attempts for database persistence
 * 
 * @param patterns Pattern data map
 * @returns Array of pattern attempts formatted for database
 */
export function extractPatternAttempts(patterns: Map<string, PatternData>): Array<{
  patternId: string;
  difficulty: string;
  timestamp: number;
  attemptTime: number;
  correct: boolean;
  midiNotes: number[];
}> {
  const attempts: Array<{
    patternId: string;
    difficulty: string;
    timestamp: number;
    attemptTime: number;
    correct: boolean;
    midiNotes: number[];
  }> = [];
  
  patterns.forEach((patternData, patternId) => {
    patternData.attempts.forEach(attempt => {
      // Convert PatternPerformance to database format
      attempts.push({
        patternId,
        difficulty: attempt.difficulty,
        timestamp: attempt.timestamp,
        attemptTime: attempt.attemptTime,
        correct: attempt.correct,
        midiNotes: attempt.midiNotes
      });
    });
  });
  
  return attempts;
}

/**
 * Count total correct patterns across all pattern data
 * 
 * @param patterns Pattern data map
 * @returns Total number of correct patterns
 */
export function countCorrectPatterns(patterns: Map<string, PatternData>): number {
  let correctCount = 0;
  
  patterns.forEach(patternData => {
    correctCount += patternData.attempts.filter(a => a.correct).length;
  });
  
  return correctCount;
}

/**
 * Extract pattern completion times for analysis
 * 
 * @param patterns Pattern data map
 * @returns Array of average completion times
 */
export function extractPatternTimes(patterns: Map<string, PatternData>): number[] {
  const patternTimes: number[] = [];
  
  patterns.forEach((patternData) => {
    if (patternData?.metrics?.averageTime > 0) {
      patternTimes.push(patternData.metrics.averageTime);
    }
  });
  
  return patternTimes;
}