/**
 * Type definitions for Speed Challenge Analytics
 * Extracted from SessionAnalytics.ts for better modularity
 */

import { DifficultyLevel } from '../types';

/**
 * Performance data for a single pattern attempt
 */
export interface PatternPerformance {
  patternId: string;
  difficulty: DifficultyLevel;
  attemptTime: number;
  correct: boolean;
  midiNotes: number[];
  timestamp: number;
}

/**
 * Aggregated metrics for a specific pattern
 */
export interface PatternMetrics {
  patternId: string;
  attempts: number;
  correctAttempts: number;
  accuracy: number;
  averageTime: number;
  bestTime: number;
  worstTime: number;
}

/**
 * Metrics grouped by difficulty level
 */
export interface DifficultyMetrics {
  difficulty: DifficultyLevel;
  totalAttempts: number;
  correctAttempts: number;
  accuracy: number;
  averageTime: number;
}

/**
 * Progress tracking for a pattern
 */
export interface PatternProgress {
  patternId: string;
  improving: boolean;
  plateau: boolean;
  timeImprovement: number;
  accuracyImprovement: number;
}

/**
 * Note-specific performance metrics
 */
export interface NoteMetrics {
  [midiNote: number]: {
    attempts: number;
    correct: number;
    accuracy: number;
    averageTime: number;
  };
}

/**
 * Comprehensive session summary
 */
export interface SessionSummary {
  sessionDuration: number;
  totalPatterns: number;
  uniquePatterns: number;
  overallAccuracy: number;
  averageResponseTime: number;
  difficultyBreakdown: {
    [key in DifficultyLevel]?: {
      attempts: number;
      accuracy: number;
      averageTime: number;
    };
  };
  strengths: DifficultyLevel[];
  weaknesses: DifficultyLevel[];
  recommendations: string[];
}

/**
 * Exported data format for persistence
 */
export interface ExportedAnalytics {
  version: string;
  sessionStart: number;
  patterns: Record<string, PatternData>;
  noteMetrics: NoteMetrics;
  difficultyMetrics: Record<DifficultyLevel, DifficultyMetrics>;
}

/**
 * Internal pattern data storage
 */
export interface PatternData {
  attempts: PatternPerformance[];
  metrics: PatternMetrics;
}