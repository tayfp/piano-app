/**
 * Error Classification Engine - Phase 2 Extraction
 * 
 * High-performance error classification system extracted from errorRecovery.ts
 * Target: <2ms classification time (down from integrated approach)
 * 
 * Optimizations:
 * - Pre-compiled pattern matching
 * - Lookup table-based severity mapping  
 * - Minimal object allocation
 * - Context-aware classification
 */

import { perfLogger } from '@/renderer/utils/performance-logger';
import { speedChallengeLogger } from './performance-logger';

// ============================================================================
// ERROR CLASSIFICATION TYPES
// ============================================================================

export const enum ErrorCode {
  PATTERN_GENERATION = 1,
  MIDI_CONNECTION = 2,
  VALIDATION = 3,
  VISUAL_FEEDBACK = 4,
  MEMORY_PRESSURE = 5,
  PERFORMANCE_DEGRADATION = 6,
  OSMD_RENDERING = 7,
  STORE_STATE = 8,
  UNKNOWN = 0
}

export enum ErrorCategory {
  PATTERN_GENERATION = 'pattern_generation',
  MIDI_CONNECTION = 'midi_connection',
  VALIDATION = 'validation',
  VISUAL_FEEDBACK = 'visual_feedback',
  MEMORY_PRESSURE = 'memory_pressure',
  PERFORMANCE_DEGRADATION = 'performance_degradation',
  OSMD_RENDERING = 'osmd_rendering',
  STORE_STATE = 'store_state',
  UNKNOWN = 'unknown'
}

export enum ErrorSeverity {
  LOW = 'low',           // Can continue with degraded functionality
  MEDIUM = 'medium',     // Requires recovery action
  HIGH = 'high',         // Requires mode restart
  CRITICAL = 'critical'  // Requires mode disable
}

export interface ClassifiedError {
  code: ErrorCode;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  timestamp: number;
  errorId: string;
  confidence: number; // 0-1, classification confidence score
}

// ============================================================================
// HIGH-PERFORMANCE CLASSIFICATION ENGINE
// ============================================================================

/**
 * Pre-compiled pattern matching for maximum performance
 * Patterns are compiled once at module load, not per classification
 */
class PatternMatcher {
  private static readonly patterns = new Map([
    [ErrorCode.PATTERN_GENERATION, /pattern|generation|template|musicxml/i],
    [ErrorCode.MIDI_CONNECTION, /midi|device|connection|input/i],
    [ErrorCode.VALIDATION, /validation|note|compare/i],
    [ErrorCode.VISUAL_FEEDBACK, /visual|feedback|animation|highlight/i],
    [ErrorCode.OSMD_RENDERING, /osmd|render|sheet|music/i],
    [ErrorCode.STORE_STATE, /store|state|zustand/i],
    [ErrorCode.MEMORY_PRESSURE, /memory|allocation/i],
    [ErrorCode.PERFORMANCE_DEGRADATION, /performance|latency/i]
  ]);

  private static readonly criticalPattern = /critical|fatal|maximum call stack/i;

  /**
   * Fast pattern matching using pre-compiled RegExp
   * Target: <0.5ms per classification
   */
  static matchErrorCode(message: string): { code: ErrorCode; confidence: number } {
    // Fast path: Check for patterns in priority order
    for (const [code, pattern] of this.patterns) {
      if (pattern.test(message)) {
        return { code, confidence: 0.9 }; // High confidence for pattern match
      }
    }
    
    return { code: ErrorCode.UNKNOWN, confidence: 0.1 };
  }

  /**
   * Check if error should be escalated to critical severity
   */
  static isCritical(message: string, stack?: string): boolean {
    return this.criticalPattern.test(message) || 
           (stack ? this.criticalPattern.test(stack) : false);
  }
}

/**
 * Lookup tables for O(1) performance characteristics
 */
class ClassificationLookup {
  private static readonly errorCodeToCategory = new Map([
    [ErrorCode.PATTERN_GENERATION, ErrorCategory.PATTERN_GENERATION],
    [ErrorCode.MIDI_CONNECTION, ErrorCategory.MIDI_CONNECTION],
    [ErrorCode.VALIDATION, ErrorCategory.VALIDATION],
    [ErrorCode.VISUAL_FEEDBACK, ErrorCategory.VISUAL_FEEDBACK],
    [ErrorCode.MEMORY_PRESSURE, ErrorCategory.MEMORY_PRESSURE],
    [ErrorCode.PERFORMANCE_DEGRADATION, ErrorCategory.PERFORMANCE_DEGRADATION],
    [ErrorCode.OSMD_RENDERING, ErrorCategory.OSMD_RENDERING],
    [ErrorCode.STORE_STATE, ErrorCategory.STORE_STATE],
    [ErrorCode.UNKNOWN, ErrorCategory.UNKNOWN]
  ]);

  private static readonly errorCodeToSeverity = new Map([
    [ErrorCode.PATTERN_GENERATION, ErrorSeverity.MEDIUM],
    [ErrorCode.MIDI_CONNECTION, ErrorSeverity.HIGH],
    [ErrorCode.VALIDATION, ErrorSeverity.LOW],
    [ErrorCode.VISUAL_FEEDBACK, ErrorSeverity.LOW],
    [ErrorCode.OSMD_RENDERING, ErrorSeverity.MEDIUM],
    [ErrorCode.STORE_STATE, ErrorSeverity.HIGH],
    [ErrorCode.MEMORY_PRESSURE, ErrorSeverity.HIGH],
    [ErrorCode.PERFORMANCE_DEGRADATION, ErrorSeverity.MEDIUM],
    [ErrorCode.UNKNOWN, ErrorSeverity.MEDIUM]
  ]);

  private static readonly memoryPressureThreshold = 50 * 1024 * 1024; // 50MB
  private static readonly latencyThreshold = 25; // ms

  static getCategory(code: ErrorCode): ErrorCategory {
    return this.errorCodeToCategory.get(code) || ErrorCategory.UNKNOWN;
  }

  static getSeverity(code: ErrorCode): ErrorSeverity {
    return this.errorCodeToSeverity.get(code) || ErrorSeverity.MEDIUM;
  }

  /**
   * Context-based classification for cases where message patterns don't match
   */
  static classifyByContext(context?: Record<string, any>): { code: ErrorCode; confidence: number } {
    if (!context) {
      return { code: ErrorCode.UNKNOWN, confidence: 0.1 };
    }

    if (context.memoryUsage && context.memoryUsage > this.memoryPressureThreshold) {
      return { code: ErrorCode.MEMORY_PRESSURE, confidence: 0.8 };
    }

    if (context.latency && context.latency > this.latencyThreshold) {
      return { code: ErrorCode.PERFORMANCE_DEGRADATION, confidence: 0.8 };
    }

    return { code: ErrorCode.UNKNOWN, confidence: 0.2 };
  }
}

// ============================================================================
// MAIN CLASSIFICATION ENGINE
// ============================================================================

/**
 * High-performance error classifier
 * Extracted from errorRecovery.ts for independent testing and optimization
 */
export class ErrorClassifier {
  /**
   * Classify error with high performance and confidence scoring
   * Target: <2ms classification time
   */
  static classify(error: Error, context?: Record<string, any>): ClassifiedError {
    const classificationStart = performance.now();
    
    // Fast error code determination
    let { code, confidence } = PatternMatcher.matchErrorCode(error.message);
    
    // Fallback to context-based classification if pattern matching fails
    if (code === ErrorCode.UNKNOWN && confidence < 0.5) {
      const contextResult = ClassificationLookup.classifyByContext(context);
      if (contextResult.confidence > confidence) {
        code = contextResult.code;
        confidence = contextResult.confidence;
      }
    }
    
    // Get category and base severity
    const category = ClassificationLookup.getCategory(code);
    let severity = ClassificationLookup.getSeverity(code);
    
    // Critical error escalation
    if (PatternMatcher.isCritical(error.message, error.stack)) {
      severity = ErrorSeverity.CRITICAL;
      confidence = Math.max(confidence, 0.9); // High confidence for critical patterns
    }
    
    // Generate fast error ID (no random strings)
    const timestamp = performance.now();
    const errorId = `err_${timestamp.toFixed(0)}_${code}`;
    
    const classificationTime = performance.now() - classificationStart;
    
    // Log slow classification
    if (classificationTime > 2) {
      perfLogger.warn(`Slow error classification: ${classificationTime.toFixed(2)}ms`);
    }
    
    // Track classification performance
    speedChallengeLogger.logValidation(classificationTime);
    
    return {
      code,
      category,
      severity,
      message: error.message,
      timestamp,
      errorId,
      confidence
    };
  }

  /**
   * Batch classify multiple errors for improved performance
   * Useful for error burst scenarios
   */
  static classifyBatch(errors: Array<{ error: Error; context?: Record<string, any> }>): ClassifiedError[] {
    const batchStart = performance.now();
    
    const results = errors.map(({ error, context }) => this.classify(error, context));
    
    const batchTime = performance.now() - batchStart;
    const avgTimePerError = batchTime / errors.length;
    
    perfLogger.info(`Batch classified ${errors.length} errors in ${batchTime.toFixed(2)}ms (${avgTimePerError.toFixed(2)}ms avg)`);
    
    return results;
  }

  /**
   * Get classification statistics for monitoring
   */
  static getStatistics(): {
    totalClassifications: number;
    averageTime: number;
    patternMatchSuccessRate: number;
  } {
    // This would integrate with the performance logger to track real statistics
    // For now, return placeholder values
    return {
      totalClassifications: 0,
      averageTime: 0,
      patternMatchSuccessRate: 0
    };
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick classification function for hot paths
 * Target: <1ms for simple cases
 */
export function classifyError(error: Error, context?: Record<string, any>): ClassifiedError {
  return ErrorClassifier.classify(error, context);
}

/**
 * Check if error is recoverable based on classification
 */
export function isRecoverableError(classified: ClassifiedError): boolean {
  return classified.severity !== ErrorSeverity.CRITICAL;
}

/**
 * Get user-friendly message based on classification
 */
export function getUserFriendlyMessage(classified: ClassifiedError): string {
  switch (classified.category) {
    case ErrorCategory.PATTERN_GENERATION:
      return 'Unable to generate new practice patterns. Trying again...';
    case ErrorCategory.MIDI_CONNECTION:
      return 'MIDI device connection lost. Please check your MIDI device.';
    case ErrorCategory.MEMORY_PRESSURE:
      return 'System running low on memory. Optimizing performance...';
    case ErrorCategory.PERFORMANCE_DEGRADATION:
      return 'Performance issues detected. Enabling optimization mode...';
    default:
      return 'A temporary issue occurred. Attempting to recover...';
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  ErrorCode,
  ErrorCategory, 
  ErrorSeverity,
  type ClassifiedError
};