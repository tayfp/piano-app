/**
 * Speed Challenge Performance Logger
 * Phase 1 Task 1.3 - Performance Monitoring Implementation
 * 
 * Specialized performance logging for Speed Challenge Mode that integrates with
 * existing urtext-piano performance infrastructure while providing ring buffer
 * logging with <0.1ms overhead for hot paths.
 */

import { perfLogger } from '@/renderer/utils/performance-logger';
import { IS_DEVELOPMENT } from '@/renderer/utils/env';

// ============================================================================
// CONSTANTS AND CONFIGURATION
// ============================================================================

const SPEED_CHALLENGE_BUFFER_SIZE = 1000;
const LATENCY_VIOLATION_THRESHOLD = 20; // ms
const FLUSH_INTERVAL_MS = 250;

// Event type constants for speed challenge metrics
const SC_EVENT_TYPES = {
  OVERALL_LATENCY: 100,
  PATTERN_GENERATION: 101,
  VALIDATION: 102,
  UI_UPDATE: 103
} as const;

// ============================================================================
// INTERFACES AND TYPES
// ============================================================================

/**
 * Ring buffer entry for zero-allocation logging
 */
interface SpeedChallengeEntry {
  timestamp: number;
  value: number;
  eventType: number;
}

/**
 * Aggregated metrics for a specific measurement category
 */
interface CategoryMetrics {
  count: number;
  averageTime: number;
  maxTime: number;
  minTime: number;
  violations?: number; // Only for latency measurements
}

/**
 * Complete speed challenge metrics for UI display
 */
interface SpeedChallengeMetrics {
  overallLatency: CategoryMetrics & { violations: number };
  patternGeneration: CategoryMetrics;
  validation: CategoryMetrics;
  uiUpdate: CategoryMetrics;
  lastUpdated: number;
}

// ============================================================================
// RING BUFFER IMPLEMENTATION
// ============================================================================

/**
 * High-performance ring buffer for speed challenge measurements
 * Zero allocation in hot paths, periodic aggregation during idle time
 */
class SpeedChallengeRingBuffer {
  private buffer: SpeedChallengeEntry[];
  private writeIndex: number = 0;
  private size: number;
  private lastFlushTime: number = 0;

  constructor(size: number) {
    this.size = size;
    this.buffer = new Array(size);
    
    // Pre-allocate all entries to avoid allocation in hot path
    for (let i = 0; i < size; i++) {
      this.buffer[i] = { timestamp: 0, value: 0, eventType: 0 };
    }
  }

  /**
   * Log a measurement (hot path - must be fast)
   * @param value Measurement value in milliseconds
   * @param eventType Event type constant
   */
  log(value: number, eventType: number): void {
    // Validate input without throwing (graceful degradation)
    if (!isFinite(value) || value < 0) {
      return;
    }

    // Direct array access for performance
    const entry = this.buffer[this.writeIndex];
    entry.timestamp = performance.now();
    entry.value = value;
    entry.eventType = eventType;

    // Circular buffer increment
    this.writeIndex = (this.writeIndex + 1) % this.size;
  }

  /**
   * Calculate aggregated metrics for display
   * Called during idle time, not in hot path
   */
  getMetrics(): SpeedChallengeMetrics {
    const now = performance.now();
    
    // Initialize category accumulators
    const categories = {
      [SC_EVENT_TYPES.OVERALL_LATENCY]: { 
        count: 0, sum: 0, max: 0, min: Infinity, violations: 0 
      },
      [SC_EVENT_TYPES.PATTERN_GENERATION]: { 
        count: 0, sum: 0, max: 0, min: Infinity, violations: 0 
      },
      [SC_EVENT_TYPES.VALIDATION]: { 
        count: 0, sum: 0, max: 0, min: Infinity, violations: 0 
      },
      [SC_EVENT_TYPES.UI_UPDATE]: { 
        count: 0, sum: 0, max: 0, min: Infinity, violations: 0 
      }
    };

    // Scan buffer and accumulate statistics
    for (let i = 0; i < this.size; i++) {
      const entry = this.buffer[i];
      
      // Skip empty entries
      if (entry.timestamp === 0) continue;
      
      const category = categories[entry.eventType];
      if (!category) continue;

      category.count++;
      category.sum += entry.value;
      category.max = Math.max(category.max, entry.value);
      category.min = Math.min(category.min, entry.value);
      
      // Track violations for latency measurements
      if (entry.eventType === SC_EVENT_TYPES.OVERALL_LATENCY && 
          entry.value > LATENCY_VIOLATION_THRESHOLD) {
        category.violations++;
      }
    }

    // Convert to final metrics format
    const createCategoryMetrics = (cat: typeof categories[keyof typeof categories]): CategoryMetrics => ({
      count: cat.count,
      averageTime: cat.count > 0 ? cat.sum / cat.count : 0,
      maxTime: cat.count > 0 ? cat.max : 0,
      minTime: cat.count > 0 ? (cat.min === Infinity ? 0 : cat.min) : 0
    });

    return {
      overallLatency: {
        ...createCategoryMetrics(categories[SC_EVENT_TYPES.OVERALL_LATENCY]),
        violations: categories[SC_EVENT_TYPES.OVERALL_LATENCY].violations
      },
      patternGeneration: createCategoryMetrics(categories[SC_EVENT_TYPES.PATTERN_GENERATION]),
      validation: createCategoryMetrics(categories[SC_EVENT_TYPES.VALIDATION]),
      uiUpdate: createCategoryMetrics(categories[SC_EVENT_TYPES.UI_UPDATE]),
      lastUpdated: now
    };
  }

  /**
   * Clear all measurements (for testing)
   */
  clear(): void {
    for (let i = 0; i < this.size; i++) {
      this.buffer[i].timestamp = 0;
      this.buffer[i].value = 0;
      this.buffer[i].eventType = 0;
    }
    this.writeIndex = 0;
  }
}

// ============================================================================
// GLOBAL INSTANCE AND PUBLIC API
// ============================================================================

// Singleton ring buffer instance
const speedChallengeBuffer = new SpeedChallengeRingBuffer(SPEED_CHALLENGE_BUFFER_SIZE);

// Cached metrics to avoid recalculation
let cachedMetrics: SpeedChallengeMetrics | null = null;
let cacheExpireTime: number = 0;

/**
 * Speed Challenge Logger - integrates with existing perfLogger infrastructure
 */
export const speedChallengeLogger = {
  /**
   * Log overall speed challenge latency (MIDI input to feedback)
   * @param latencyMs End-to-end latency in milliseconds
   */
  logOverallLatency: (latencyMs: number) => {
    speedChallengeBuffer.log(latencyMs, SC_EVENT_TYPES.OVERALL_LATENCY);
    
    // Also log to main performance logger for integration
    if (IS_DEVELOPMENT) {
      perfLogger.logLatency(latencyMs, 0); // 0 = MIDI event type
    }
    
    // Log violations immediately
    if (latencyMs > LATENCY_VIOLATION_THRESHOLD) {
      perfLogger.warn(`Speed Challenge latency violation: ${latencyMs.toFixed(1)}ms`);
    }
  },

  /**
   * Log pattern generation timing
   * @param generationMs Time to generate pattern in milliseconds
   */
  logPatternGeneration: (generationMs: number) => {
    speedChallengeBuffer.log(generationMs, SC_EVENT_TYPES.PATTERN_GENERATION);
    
    // Log slow pattern generation
    if (generationMs > 5) {
      perfLogger.warn(`Slow pattern generation: ${generationMs.toFixed(1)}ms`);
    }
  },

  /**
   * Log MIDI validation timing
   * @param validationMs Time to validate note in milliseconds
   */
  logValidation: (validationMs: number) => {
    speedChallengeBuffer.log(validationMs, SC_EVENT_TYPES.VALIDATION);
    
    // Log slow validation
    if (validationMs > 2) {
      perfLogger.warn(`Slow MIDI validation: ${validationMs.toFixed(1)}ms`);
    }
  },

  /**
   * Log UI update timing
   * @param updateMs Time to update UI in milliseconds
   */
  logUIUpdate: (updateMs: number) => {
    speedChallengeBuffer.log(updateMs, SC_EVENT_TYPES.UI_UPDATE);
  },

  /**
   * Get aggregated speed challenge metrics
   * Cached for performance, updated every FLUSH_INTERVAL_MS
   */
  getMetrics: (): SpeedChallengeMetrics => {
    const now = performance.now();
    
    // Return cached metrics if still valid
    if (cachedMetrics && now < cacheExpireTime) {
      return cachedMetrics;
    }
    
    // Recalculate metrics
    cachedMetrics = speedChallengeBuffer.getMetrics();
    cacheExpireTime = now + FLUSH_INTERVAL_MS;
    
    return cachedMetrics;
  },

  /**
   * Clear all measurements (for testing)
   */
  clear: () => {
    speedChallengeBuffer.clear();
    cachedMetrics = null;
    cacheExpireTime = 0;
  },

  /**
   * Debug information about buffer state
   */
  getDebugInfo: () => ({
    bufferSize: SPEED_CHALLENGE_BUFFER_SIZE,
    cacheExpireTime,
    hasCachedMetrics: cachedMetrics !== null
  })
};

// ============================================================================
// CONVENIENCE FUNCTIONS FOR HOT PATHS
// ============================================================================

/**
 * Log speed challenge overall latency (hot path function)
 * @param latencyMs End-to-end latency in milliseconds
 */
export const logSpeedChallengeLatency = (latencyMs: number): void => {
  speedChallengeLogger.logOverallLatency(latencyMs);
};

/**
 * Log pattern generation time (hot path function)
 * @param generationMs Pattern generation time in milliseconds
 */
export const logPatternGenerationTime = (generationMs: number): void => {
  speedChallengeLogger.logPatternGeneration(generationMs);
};

/**
 * Log MIDI validation time (hot path function)
 * @param validationMs Validation time in milliseconds
 */
export const logValidationTime = (validationMs: number): void => {
  speedChallengeLogger.logValidation(validationMs);
};

/**
 * Log UI update time (hot path function)
 * @param updateMs UI update time in milliseconds
 */
export const logUIUpdateTime = (updateMs: number): void => {
  speedChallengeLogger.logUIUpdate(updateMs);
};

/**
 * Get current speed challenge metrics
 * @returns Aggregated performance metrics
 */
export const getSpeedChallengeMetrics = (): SpeedChallengeMetrics => {
  return speedChallengeLogger.getMetrics();
};

// ============================================================================
// DEVELOPMENT INTEGRATION
// ============================================================================

if (IS_DEVELOPMENT) {
  // Log startup
  perfLogger.info('Speed Challenge performance logger initialized', {
    bufferSize: SPEED_CHALLENGE_BUFFER_SIZE,
    thresholds: {
      latencyViolation: LATENCY_VIOLATION_THRESHOLD,
      slowPatternGeneration: 5,
      slowValidation: 2
    }
  });

  // Expose to window for debugging
  (window as any).speedChallengeLogger = speedChallengeLogger;
  (window as any).getSpeedChallengeMetrics = getSpeedChallengeMetrics;
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type {
  SpeedChallengeMetrics,
  CategoryMetrics
};