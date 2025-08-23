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
 */

import { DifficultyLevel } from '../types';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { speedChallengeDB, type NoteMetric } from './SpeedChallengeDatabase';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

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
interface PatternData {
  attempts: PatternPerformance[];
  metrics: PatternMetrics;
}

// ============================================================================
// SESSION ANALYTICS CLASS
// ============================================================================

export class SessionAnalytics {
  private readonly version = '1.0.0';
  private sessionStart: number;
  private patterns: Map<string, PatternData> = new Map();
  private noteMetrics: NoteMetrics = {};
  private difficultyMetrics: Map<DifficultyLevel, DifficultyMetrics> = new Map();
  
  // Performance thresholds
  private readonly accuracyThreshold = 0.7; // 70% accuracy for "good" performance
  private readonly slowResponseThreshold = 2000; // 2 seconds is considered slow
  private readonly plateauThreshold = 0.1; // 10% variation indicates plateau

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
    if (trackingTime > 1) {
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

    // Identify strengths and weaknesses
    const strengths = this.identifyStrengths();
    const weaknesses = this.identifyWeaknesses();

    // Generate recommendations
    const recommendations = this.generateRecommendations(strengths, weaknesses, overallAccuracy);

    const summaryTime = performance.now() - perfStart;
    if (summaryTime > 10) {
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
   * Identify difficulty levels where user excels
   */
  private identifyStrengths(): DifficultyLevel[] {
    const strengths: DifficultyLevel[] = [];
    
    this.difficultyMetrics.forEach((metrics, difficulty) => {
      if (metrics.totalAttempts >= 5 && metrics.accuracy >= this.accuracyThreshold) {
        strengths.push(difficulty);
      }
    });

    return strengths;
  }

  /**
   * Identify difficulty levels that need improvement
   */
  private identifyWeaknesses(): DifficultyLevel[] {
    const weaknesses: DifficultyLevel[] = [];
    
    this.difficultyMetrics.forEach((metrics, difficulty) => {
      if (metrics.totalAttempts >= 5 && metrics.accuracy < 0.5) {
        weaknesses.push(difficulty);
      }
    });

    return weaknesses;
  }

  /**
   * Generate actionable recommendations
   */
  private generateRecommendations(
    strengths: DifficultyLevel[], 
    weaknesses: DifficultyLevel[], 
    overallAccuracy: number
  ): string[] {
    const recommendations: string[] = [];

    // Recommendations based on weaknesses
    if (weaknesses.includes('basic_triads')) {
      recommendations.push('Practice triads at a slower tempo to improve accuracy');
      recommendations.push('Focus on individual chord tones before attempting full triads');
    }

    if (weaknesses.includes('intervals')) {
      recommendations.push('Practice intervals with visual cues enabled');
      recommendations.push('Start with smaller intervals (3rds and 4ths) before larger ones');
    }

    if (weaknesses.includes('single_notes')) {
      recommendations.push('Slow down and focus on accuracy over speed');
      recommendations.push('Practice with a metronome to improve timing');
    }

    // General recommendations
    if (overallAccuracy < 0.5) {
      recommendations.push('Reduce tempo to improve accuracy');
      recommendations.push('Consider practicing with easier patterns first');
    }

    if (strengths.length > 0 && weaknesses.length === 0) {
      recommendations.push(`Great job on ${strengths.join(', ')}! Consider increasing difficulty`);
    }

    // Detect if user is ready for next level
    const singleNotesMetrics = this.difficultyMetrics.get('single_notes');
    if (singleNotesMetrics && singleNotesMetrics.accuracy > 0.9 && singleNotesMetrics.totalAttempts > 10) {
      recommendations.push('Excellent single note accuracy! Try moving to intervals');
    }

    return recommendations;
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
    const timeVariation = this.calculateVariation(lastTimes);
    
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
   * Calculate coefficient of variation for plateau detection
   */
  private calculateVariation(values: number[]): number {
    if (values.length < 2) return 0;

    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1); // Sample variance
    const stdDev = Math.sqrt(variance);

    // Coefficient of variation
    const cv = mean > 0 ? stdDev / mean : 0;
    
    // For times around 1500ms with ±50ms variation, CV should be around 0.02-0.03
    // which is less than our threshold of 0.1
    return cv;
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
    const noteMetrics = this.calculateNoteMetricsForPersistence();
    const patternMetrics = this.extractPatternAttempts();
    
    // Get pattern completion times from patterns map
    const patternTimes: number[] = [];
    if (this.patterns && this.patterns.size > 0) {
      this.patterns.forEach((patternData) => {
        // Check if metrics exist and have valid average time
        if (patternData && patternData.metrics && patternData.metrics.averageTime > 0) {
          patternTimes.push(patternData.metrics.averageTime);
        }
      });
    }
    
    try {
      await speedChallengeDB.saveOrUpdateSession({
        sessionId: sessionId || `session-${Date.now()}`,
        timestamp: Date.now(),
        duration: Date.now() - this.sessionStart,
        totalPatterns: summary.totalPatterns,
        correctPatterns: this.countCorrectPatterns(),
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

  /**
   * Calculate note metrics for database persistence
   */
  private calculateNoteMetricsForPersistence(): Record<number, NoteMetric> {
    const noteMetrics: Record<number, NoteMetric> = {};
    
    Object.entries(this.noteMetrics).forEach(([note, metrics]) => {
      const noteNum = Number(note);
      noteMetrics[noteNum] = {
        note: noteNum,
        attempts: metrics.attempts,
        correct: metrics.correct,
        averageTime: metrics.averageTime,
        fastestTime: this.findFastestTimeForNote(noteNum)
      };
    });
    
    return noteMetrics;
  }

  /**
   * Find the fastest response time for a specific note
   */
  private findFastestTimeForNote(note: number): number {
    let fastestTime = Infinity;
    
    this.patterns.forEach(patternData => {
      patternData.attempts.forEach(attempt => {
        if (attempt.midiNotes.includes(note) && attempt.correct) {
          fastestTime = Math.min(fastestTime, attempt.attemptTime);
        }
      });
    });
    
    return fastestTime === Infinity ? 0 : fastestTime;
  }

  /**
   * Extract pattern attempts for persistence
   */
  private extractPatternAttempts(): Array<{
    patternId: string;
    timestamp: number;
    responseTime: number;
    correct: boolean;
    expectedNotes: number[];
    playedNote: number;
    difficulty: string;
  }> {
    const attempts: Array<{
      patternId: string;
      timestamp: number;
      responseTime: number;
      correct: boolean;
      expectedNotes: number[];
      playedNote: number;
      difficulty: string;
    }> = [];
    
    this.patterns.forEach((patternData, patternId) => {
      patternData.attempts.forEach(attempt => {
        // For each attempt, create a simplified record
        attempts.push({
          patternId,
          timestamp: attempt.timestamp,
          responseTime: attempt.attemptTime,
          correct: attempt.correct,
          expectedNotes: attempt.midiNotes,
          playedNote: attempt.midiNotes[0] || 0, // Use first note as representative
          difficulty: attempt.difficulty
        });
      });
    });
    
    return attempts;
  }

  /**
   * Count total number of correct patterns
   */
  private countCorrectPatterns(): number {
    let correctCount = 0;
    
    this.patterns.forEach(patternData => {
      correctCount += patternData.attempts.filter(a => a.correct).length;
    });
    
    return correctCount;
  }
}