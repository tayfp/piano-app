/**
 * Session Analytics Service for Speed Challenge Mode
 * Quick Win #5: Track pattern-specific performance metrics
 * 
 * Provides comprehensive analytics for practice sessions including:
 * - Pattern-specific performance tracking
 * - Session summaries with recommendations
 * - Progress tracking over time
 * - Note-specific difficulty analysis
 * 
 * Performance Target: <1ms per tracking call, <10ms for summary generation
 * 
 * Optimized: Extracted types, constants, utilities, and recommendation engine
 * for better modularity and maintainability.
 */

import { DifficultyLevel } from '../types';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { speedChallengeDB, type NoteMetric } from './SpeedChallengeDatabase';

// Extracted modules for better organization
import {
  PatternPerformance,
  PatternMetrics,
  DifficultyMetrics,
  PatternProgress,
  NoteMetrics,
  SessionSummary,
  ExportedAnalytics,
  PatternData
} from '../types/analytics-types';

// Re-export types for backward compatibility
export type {
  PatternPerformance,
  PatternMetrics,
  DifficultyMetrics,
  PatternProgress,
  NoteMetrics,
  SessionSummary,
  ExportedAnalytics
};

import { 
  ANALYTICS_THRESHOLDS, 
  ANALYTICS_DEFAULTS, 
  PERFORMANCE_THRESHOLDS 
} from '../constants/analytics-constants';

import { 
  calculateVariation,
  calculateAverage,
  calculateAccuracy,
  roundToDecimals,
  calculateImprovement
} from '../utils/statistics-utils';

import {
  identifyStrengths,
  identifyWeaknesses,
  generateRecommendations
} from '../utils/recommendation-engine';

import {
  transformNoteMetricsForPersistence,
  findFastestTimeForNote,
  extractPatternAttempts,
  countCorrectPatterns,
  extractPatternTimes
} from '../utils/data-transformers';

// ============================================================================
// SESSION ANALYTICS CLASS
// ============================================================================

export class SessionAnalytics {
  private readonly version = '1.0.0';
  private sessionStart: number;
  private patterns: Map<string, PatternData> = new Map();
  private noteMetrics: NoteMetrics = {};
  private difficultyMetrics: Map<DifficultyLevel, DifficultyMetrics> = new Map();
  
  // Performance thresholds (now using extracted constants)
  private readonly accuracyThreshold = ANALYTICS_THRESHOLDS.ACCURACY_THRESHOLD;
  private readonly slowResponseThreshold = ANALYTICS_THRESHOLDS.SLOW_RESPONSE_THRESHOLD;
  private readonly plateauThreshold = ANALYTICS_THRESHOLDS.PLATEAU_THRESHOLD;

  constructor() {
    this.sessionStart = Date.now();
    this.initializeDifficultyMetrics();
  }

  /**
   * Initialize metrics for all difficulty levels
   */
  private initializeDifficultyMetrics(): void {
    const difficulties: DifficultyLevel[] = ['single_notes', 'intervals', 'basic_triads'];
    difficulties.forEach(difficulty => {
      this.difficultyMetrics.set(difficulty, {
        difficulty,
        totalAttempts: 0,
        correctAttempts: 0,
        accuracy: 0,
        averageTime: 0
      });
    });
  }

  /**
   * Track performance for a pattern attempt
   */
  public trackPatternPerformance(performance: PatternPerformance): void {
    const perfStart = Date.now();

    // Update pattern-specific data
    this.updatePatternData(performance);

    // Update note-specific metrics
    this.updateNoteMetrics(performance);

    // Update difficulty-level metrics
    this.updateDifficultyMetrics(performance);

    const trackingTime = Date.now() - perfStart;
    if (trackingTime > PERFORMANCE_THRESHOLDS.MAX_TRACKING_TIME) {
      perfLogger.warn('Slow analytics tracking', { trackingTime, patternId: performance.patternId });
    }
  }

  /**
   * Update pattern-specific data
   */
  private updatePatternData(performance: PatternPerformance): void {
    let patternData = this.patterns.get(performance.patternId);

    if (!patternData) {
      patternData = {
        attempts: [],
        metrics: {
          patternId: performance.patternId,
          attempts: 0,
          correctAttempts: 0,
          accuracy: 0,
          averageTime: 0,
          bestTime: Infinity,
          worstTime: 0
        }
      };
      this.patterns.set(performance.patternId, patternData);
    }

    // Add attempt
    patternData.attempts.push(performance);

    // Update metrics
    const metrics = patternData.metrics;
    metrics.attempts++;
    if (performance.correct) {
      metrics.correctAttempts++;
    }
    metrics.accuracy = metrics.correctAttempts / metrics.attempts;

    // Update timing metrics
    const totalTime = patternData.attempts.reduce((sum, a) => sum + a.attemptTime, 0);
    metrics.averageTime = Math.round(totalTime / metrics.attempts * 100) / 100; // Round to 2 decimals
    metrics.bestTime = Math.min(metrics.bestTime, performance.attemptTime);
    metrics.worstTime = Math.max(metrics.worstTime, performance.attemptTime);
  }

  /**
   * Update note-specific metrics
   */
  private updateNoteMetrics(performance: PatternPerformance): void {
    performance.midiNotes.forEach(note => {
      if (!this.noteMetrics[note]) {
        this.noteMetrics[note] = {
          attempts: 0,
          correct: 0,
          accuracy: 0,
          averageTime: 0
        };
      }

      const metrics = this.noteMetrics[note];
      metrics.attempts++;
      if (performance.correct) {
        metrics.correct++;
      }
      metrics.accuracy = metrics.correct / metrics.attempts;

      // Update average time (incremental calculation)
      metrics.averageTime = ((metrics.averageTime * (metrics.attempts - 1)) + performance.attemptTime) / metrics.attempts;
    });
  }

  /**
   * Update difficulty-level metrics
   */
  private updateDifficultyMetrics(performance: PatternPerformance): void {
    const metrics = this.difficultyMetrics.get(performance.difficulty);
    if (!metrics) return;

    metrics.totalAttempts++;
    if (performance.correct) {
      metrics.correctAttempts++;
    }
    metrics.accuracy = metrics.correctAttempts / metrics.totalAttempts;

    // Update average time
    metrics.averageTime = ((metrics.averageTime * (metrics.totalAttempts - 1)) + performance.attemptTime) / metrics.totalAttempts;
  }

  /**
   * Get metrics for a specific pattern
   */
  public getPatternMetrics(patternId: string): PatternMetrics {
    const data = this.patterns.get(patternId);
    if (!data) {
      return {
        patternId,
        attempts: 0,
        correctAttempts: 0,
        accuracy: 0,
        averageTime: 0,
        bestTime: 0,
        worstTime: 0
      };
    }
    return { ...data.metrics };
  }

  /**
   * Get metrics for a difficulty level
   */
  public getDifficultyMetrics(difficulty: DifficultyLevel): DifficultyMetrics {
    const metrics = this.difficultyMetrics.get(difficulty);
    return metrics ? { ...metrics } : {
      difficulty,
      totalAttempts: 0,
      correctAttempts: 0,
      accuracy: 0,
      averageTime: 0
    };
  }

  /**
   * Get comprehensive session summary
   */
  public getSessionSummary(): SessionSummary {
    const perfStart = performance.now();

    const sessionDuration = Date.now() - this.sessionStart;
    const allAttempts = Array.from(this.patterns.values()).flatMap(p => p.attempts);
    const totalPatterns = allAttempts.length;
    const uniquePatterns = this.patterns.size;

    // Calculate overall metrics
    const correctAttempts = allAttempts.filter(a => a.correct).length;
    const overallAccuracy = totalPatterns > 0 ? correctAttempts / totalPatterns : 0;
    const averageResponseTime = totalPatterns > 0 
      ? allAttempts.reduce((sum, a) => sum + a.attemptTime, 0) / totalPatterns 
      : 0;

    // Build difficulty breakdown
    const difficultyBreakdown: SessionSummary['difficultyBreakdown'] = {};
    this.difficultyMetrics.forEach((metrics, difficulty) => {
      if (metrics.totalAttempts > 0) {
        difficultyBreakdown[difficulty] = {
          attempts: metrics.totalAttempts,
          accuracy: metrics.accuracy,
          averageTime: metrics.averageTime
        };
      }
    });

    // Identify strengths and weaknesses (using extracted utilities)
    const strengths = identifyStrengths(this.difficultyMetrics);
    const weaknesses = identifyWeaknesses(this.difficultyMetrics);

    // Generate recommendations (using extracted recommendation engine)
    const recommendations = generateRecommendations(strengths, weaknesses, overallAccuracy, this.difficultyMetrics);

    const summaryTime = performance.now() - perfStart;
    if (summaryTime > PERFORMANCE_THRESHOLDS.MAX_SUMMARY_GENERATION_TIME) {
      perfLogger.warn('Slow summary generation', { summaryTime });
    }

    return {
      sessionDuration,
      totalPatterns,
      uniquePatterns,
      overallAccuracy,
      averageResponseTime,
      difficultyBreakdown,
      strengths,
      weaknesses,
      recommendations
    };
  }


  /**
   * Get patterns with poor performance
   */
  public getProblemPatterns(accuracyThreshold: number = 0.5): PatternMetrics[] {
    const problemPatterns: PatternMetrics[] = [];

    this.patterns.forEach(data => {
      if (data.metrics.attempts >= 2 && data.metrics.accuracy < accuracyThreshold) {
        problemPatterns.push({ ...data.metrics });
      }
    });

    return problemPatterns.sort((a, b) => a.accuracy - b.accuracy);
  }

  /**
   * Get patterns with slow response times
   */
  public getSlowPatterns(timeThreshold: number = 2000): PatternMetrics[] {
    const slowPatterns: PatternMetrics[] = [];

    this.patterns.forEach(data => {
      if (data.metrics.averageTime > timeThreshold) {
        slowPatterns.push({ ...data.metrics });
      }
    });

    return slowPatterns.sort((a, b) => b.averageTime - a.averageTime);
  }

  /**
   * Get progress for a specific pattern
   */
  public getPatternProgress(patternId: string): PatternProgress {
    const data = this.patterns.get(patternId);
    
    if (!data || data.attempts.length < 2) {
      return {
        patternId,
        improving: false,
        plateau: false,
        timeImprovement: 0,
        accuracyImprovement: 0
      };
    }

    const attempts = data.attempts;
    const halfPoint = Math.max(1, Math.floor(attempts.length / 2));
    const recentAttempts = attempts.slice(halfPoint); // Second half of attempts
    const olderAttempts = attempts.slice(0, halfPoint); // First half of attempts

    // Calculate improvement metrics
    const recentAccuracy = recentAttempts.length > 0
      ? recentAttempts.filter(a => a.correct).length / recentAttempts.length
      : 0;
    const olderAccuracy = olderAttempts.length > 0 
      ? olderAttempts.filter(a => a.correct).length / olderAttempts.length 
      : 0;

    const recentAvgTime = recentAttempts.length > 0
      ? recentAttempts.reduce((sum, a) => sum + a.attemptTime, 0) / recentAttempts.length
      : 0;
    const olderAvgTime = olderAttempts.length > 0
      ? olderAttempts.reduce((sum, a) => sum + a.attemptTime, 0) / olderAttempts.length
      : recentAvgTime || 1; // Avoid division by zero

    const accuracyImprovement = recentAccuracy - olderAccuracy;
    const timeImprovement = (olderAvgTime - recentAvgTime) / olderAvgTime;

    // Detect plateau (low variation in recent attempts)
    // Use last 5 attempts or all recent attempts if less than 5
    const lastAttempts = attempts.slice(-5);
    const lastTimes = lastAttempts.map(a => a.attemptTime);
    const timeVariation = calculateVariation(lastTimes);
    
    // For alternating patterns (like 0,1,0,1), check overall accuracy consistency
    const overallAccuracy = attempts.filter(a => a.correct).length / attempts.length;
    const isAroundFiftyPercent = Math.abs(overallAccuracy - 0.5) < 0.1;
    
    // For plateau: need at least 5 attempts with low time variation
    // AND either minimal accuracy change OR consistent ~50% accuracy (alternating pattern)
    const plateau = attempts.length >= 5 && 
                   timeVariation < this.plateauThreshold && 
                   (Math.abs(accuracyImprovement) < 0.15 || isAroundFiftyPercent);

    return {
      patternId,
      improving: accuracyImprovement > 0.1 || timeImprovement > 0.1,
      plateau,
      timeImprovement,
      accuracyImprovement
    };
  }


  /**
   * Get note-specific metrics
   */
  public getNoteMetrics(): NoteMetrics {
    return { ...this.noteMetrics };
  }

  /**
   * Get problematic notes based on accuracy threshold
   */
  public getProblematicNotes(accuracyThreshold: number = 0.5): number[] {
    const problematicNotes: number[] = [];

    Object.entries(this.noteMetrics).forEach(([note, metrics]) => {
      if (metrics.attempts >= 3 && metrics.accuracy < accuracyThreshold) {
        problematicNotes.push(parseInt(note));
      }
    });

    return problematicNotes.sort((a, b) => 
      this.noteMetrics[a].accuracy - this.noteMetrics[b].accuracy
    );
  }

  /**
   * Export analytics data for persistence
   */
  public exportData(): ExportedAnalytics {
    const patterns: Record<string, PatternData> = {};
    this.patterns.forEach((data, id) => {
      patterns[id] = data;
    });

    const difficultyMetrics: Record<DifficultyLevel, DifficultyMetrics> = {} as any;
    this.difficultyMetrics.forEach((metrics, difficulty) => {
      difficultyMetrics[difficulty] = metrics;
    });

    return {
      version: this.version,
      sessionStart: this.sessionStart,
      patterns,
      noteMetrics: this.noteMetrics,
      difficultyMetrics
    };
  }

  /**
   * Import previously exported data
   */
  public importData(data: ExportedAnalytics): void {
    if (data.version !== this.version) {
      perfLogger.warn('Analytics version mismatch', { 
        expected: this.version, 
        received: data.version 
      });
    }

    this.sessionStart = data.sessionStart;
    this.patterns = new Map(Object.entries(data.patterns));
    this.noteMetrics = data.noteMetrics;
    this.difficultyMetrics = new Map(Object.entries(data.difficultyMetrics) as any);
  }

  /**
   * Reset session data
   */
  public resetSession(): void {
    this.sessionStart = Date.now();
    this.patterns.clear();
    this.noteMetrics = {};
    this.initializeDifficultyMetrics();
  }

  /**
   * Clear data for a specific pattern
   */
  public clearPatternData(patternId: string): void {
    this.patterns.delete(patternId);
  }

  /**
   * Persist current session to database
   */
  public async persistSession(sessionId?: string): Promise<void> {
    const summary = this.getSessionSummary();
    const noteMetrics = transformNoteMetricsForPersistence(this.noteMetrics, this.patterns);
    const patternMetrics = extractPatternAttempts(this.patterns);
    
    // Get pattern completion times using extracted utility
    const patternTimes = extractPatternTimes(this.patterns);
    
    try {
      await speedChallengeDB.saveOrUpdateSession({
        sessionId: sessionId || `session-${Date.now()}`,
        timestamp: Date.now(),
        duration: Date.now() - this.sessionStart,
        totalPatterns: summary.totalPatterns,
        correctPatterns: countCorrectPatterns(this.patterns),
        accuracy: summary.overallAccuracy,
        averageResponseTime: summary.averageResponseTime,
        noteMetrics,
        patternMetrics,
        patternCompletionTimes: patternTimes,
        fastestPatternTime: patternTimes.length > 0 ? Math.min(...patternTimes) : undefined,
        slowestPatternTime: patternTimes.length > 0 ? Math.max(...patternTimes) : undefined
      });
      
      perfLogger.debug('Session persisted successfully', { 
        sessionId: sessionId || 'generated',
        patterns: summary.totalPatterns,
        accuracy: summary.overallAccuracy,
        patternTimes: patternTimes.length
      });
    } catch (error) {
      perfLogger.error('Failed to persist session', error);
    }
  }
}