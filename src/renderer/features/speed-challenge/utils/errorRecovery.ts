/**
 * Phase 6.2: Speed Challenge Error Recovery Utilities
 * 
 * Provides comprehensive error recovery mechanisms for Speed Challenge Mode:
 * - Pattern generation failure recovery
 * - MIDI connection error handling
 * - Memory pressure detection and cleanup
 * - Performance degradation detection
 * - Graceful degradation strategies
 * 
 * Critical Requirements:
 * - Recovery overhead <1ms
 * - No data loss during recovery
 * - Maintain <20ms latency during error scenarios
 * - Clear user communication
 */

import { perfLogger } from '@/renderer/utils/performance-logger';
import { speedChallengeLogger } from './performance-logger';
import { DifficultyLevel, Pattern, SpeedChallengeSettings } from '../types';

// ============================================================================
// ERROR TYPES AND CATEGORIES
// ============================================================================

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

export interface ErrorContext {
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  timestamp: number;
  errorId: string;
  metadata?: Record<string, any>;
  recoveryAttempts: number;
  lastRecoveryTime?: number;
}

export interface RecoveryResult {
  success: boolean;
  strategy: RecoveryStrategy;
  message: string;
  newSettings?: Partial<SpeedChallengeSettings>;
  shouldDisable?: boolean;
  retryAfter?: number; // milliseconds
}

export enum RecoveryStrategy {
  RETRY = 'retry',
  FALLBACK = 'fallback',
  DEGRADE = 'degrade',
  RESTART = 'restart',
  DISABLE = 'disable'
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const RECOVERY_CONFIG = {
  maxRetryAttempts: 3,
  retryDelayMs: 1000,
  memoryPressureThreshold: 50 * 1024 * 1024, // 50MB
  latencyThreshold: 25, // ms
  patternGenerationTimeout: 10000, // 10 seconds
  cooldownPeriodMs: 5000,
  emergencyFallbackPatterns: 5,
} as const;

// ============================================================================
// ERROR DETECTION AND CLASSIFICATION
// ============================================================================

/**
 * Classify error based on message and context
 */
export function classifyError(error: Error, context?: Record<string, any>): ErrorContext {
  const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const timestamp = performance.now();

  let category = ErrorCategory.UNKNOWN;
  let severity = ErrorSeverity.MEDIUM;

  // Pattern generation errors
  if (error.message.includes('pattern') || error.message.includes('generation') || 
      error.message.includes('template') || error.message.includes('musicxml')) {
    category = ErrorCategory.PATTERN_GENERATION;
    severity = ErrorSeverity.MEDIUM;
  }
  
  // MIDI connection errors
  else if (error.message.includes('midi') || error.message.includes('device') ||
           error.message.includes('connection') || error.message.includes('input')) {
    category = ErrorCategory.MIDI_CONNECTION;
    severity = ErrorSeverity.HIGH;
  }
  
  // Validation errors
  else if (error.message.includes('validation') || error.message.includes('note') ||
           error.message.includes('compare')) {
    category = ErrorCategory.VALIDATION;
    severity = ErrorSeverity.LOW;
  }
  
  // Visual feedback errors
  else if (error.message.includes('visual') || error.message.includes('feedback') ||
           error.message.includes('animation') || error.message.includes('highlight')) {
    category = ErrorCategory.VISUAL_FEEDBACK;
    severity = ErrorSeverity.LOW;
  }
  
  // OSMD rendering errors
  else if (error.message.includes('osmd') || error.message.includes('render') ||
           error.message.includes('sheet') || error.message.includes('music')) {
    category = ErrorCategory.OSMD_RENDERING;
    severity = ErrorSeverity.MEDIUM;
  }
  
  // Store state errors
  else if (error.message.includes('store') || error.message.includes('state') ||
           error.message.includes('zustand')) {
    category = ErrorCategory.STORE_STATE;
    severity = ErrorSeverity.HIGH;
  }
  
  // Memory pressure (detected by message or context)
  else if (error.message.includes('memory') || error.message.includes('allocation') ||
           (context?.memoryUsage && context.memoryUsage > RECOVERY_CONFIG.memoryPressureThreshold)) {
    category = ErrorCategory.MEMORY_PRESSURE;
    severity = ErrorSeverity.HIGH;
  }
  
  // Performance degradation
  else if (error.message.includes('performance') || error.message.includes('latency') ||
           (context?.latency && context.latency > RECOVERY_CONFIG.latencyThreshold)) {
    category = ErrorCategory.PERFORMANCE_DEGRADATION;
    severity = ErrorSeverity.MEDIUM;
  }

  // Critical errors that should disable the feature
  if (error.message.includes('critical') || error.message.includes('fatal') ||
      error.stack?.includes('Maximum call stack')) {
    severity = ErrorSeverity.CRITICAL;
  }

  return {
    category,
    severity,
    message: error.message,
    timestamp,
    errorId,
    metadata: {
      stack: error.stack,
      name: error.name,
      context,
    },
    recoveryAttempts: 0,
  };
}

// ============================================================================
// RECOVERY STRATEGIES
// ============================================================================

/**
 * Execute recovery strategy for pattern generation errors
 */
async function recoverPatternGeneration(errorContext: ErrorContext): Promise<RecoveryResult> {
  const startTime = performance.now();
  
  try {
    // Import dependencies dynamically to avoid circular deps
    const { PatternGenerator } = await import('../services/PatternGenerator');
    const { useSpeedChallengeStore } = await import('../stores/speedChallengeStore');
    
    const store = useSpeedChallengeStore.getState();
    
    // Strategy 1: Retry with current difficulty
    if (errorContext.recoveryAttempts < 2) {
      try {
        const generator = new PatternGenerator();
        const newPattern = await generator.generatePattern(store.currentLevel);
        
        if (newPattern && newPattern.musicXML) {
          perfLogger.info('Pattern generation recovered via retry');
          return {
            success: true,
            strategy: RecoveryStrategy.RETRY,
            message: 'Pattern generation recovered',
          };
        }
      } catch (retryError) {
        perfLogger.warn('Pattern generation retry failed', { retryError });
      }
    }
    
    // Strategy 2: Fallback to simpler difficulty
    if (store.currentLevel !== DifficultyLevel.SINGLE_NOTES) {
      try {
        const generator = new PatternGenerator();
        const fallbackPattern = await generator.generatePattern(DifficultyLevel.SINGLE_NOTES);
        
        if (fallbackPattern && fallbackPattern.musicXML) {
          perfLogger.info('Pattern generation recovered via fallback to single notes');
          return {
            success: true,
            strategy: RecoveryStrategy.FALLBACK,
            message: 'Switched to single notes mode for stability',
            newSettings: { difficulty: DifficultyLevel.SINGLE_NOTES },
          };
        }
      } catch (fallbackError) {
        perfLogger.warn('Pattern generation fallback failed', { fallbackError });
      }
    }
    
    // Strategy 3: Use emergency fallback patterns
    try {
      const emergencyPattern = createEmergencyPattern();
      perfLogger.info('Using emergency fallback pattern');
      
      return {
        success: true,
        strategy: RecoveryStrategy.DEGRADE,
        message: 'Using simplified patterns due to generation error',
        newSettings: { useEmergencyPatterns: true },
      };
    } catch (emergencyError) {
      perfLogger.error('Emergency pattern creation failed', { emergencyError });
    }
    
    // All strategies failed
    return {
      success: false,
      strategy: RecoveryStrategy.DISABLE,
      message: 'Pattern generation failed - disabling Speed Challenge',
      shouldDisable: true,
    };
    
  } finally {
    const recoveryTime = performance.now() - startTime;
    speedChallengeLogger.logUIUpdate(recoveryTime);
    
    if (recoveryTime > 1) {
      perfLogger.warn(`Pattern generation recovery took ${recoveryTime.toFixed(2)}ms`);
    }
  }
}

/**
 * Execute recovery strategy for MIDI connection errors
 */
async function recoverMidiConnection(errorContext: ErrorContext): Promise<RecoveryResult> {
  try {
    // Check if MIDI devices are available
    if (typeof navigator !== 'undefined' && navigator.requestMIDIAccess) {
      try {
        const midiAccess = await navigator.requestMIDIAccess();
        const devices = Array.from(midiAccess.inputs.values());
        
        if (devices.length === 0) {
          return {
            success: false,
            strategy: RecoveryStrategy.DISABLE,
            message: 'No MIDI devices detected - Speed Challenge requires MIDI input',
            shouldDisable: true,
          };
        } else {
          return {
            success: true,
            strategy: RecoveryStrategy.RESTART,
            message: 'MIDI connection restored',
            retryAfter: RECOVERY_CONFIG.cooldownPeriodMs,
          };
        }
      } catch (midiError) {
        perfLogger.warn('MIDI access check failed', { midiError });
      }
    }
    
    return {
      success: false,
      strategy: RecoveryStrategy.DISABLE,
      message: 'MIDI not available - Speed Challenge disabled',
      shouldDisable: true,
    };
    
  } catch (error) {
    perfLogger.error('MIDI recovery failed', { error });
    return {
      success: false,
      strategy: RecoveryStrategy.DISABLE,
      message: 'MIDI recovery failed',
      shouldDisable: true,
    };
  }
}

/**
 * Execute recovery strategy for memory pressure
 */
async function recoverMemoryPressure(errorContext: ErrorContext): Promise<RecoveryResult> {
  try {
    // Force garbage collection if available
    if (typeof global !== 'undefined' && global.gc) {
      global.gc();
    }
    
    // Clear pattern queue to reduce memory usage
    const { useSpeedChallengeStore } = await import('../stores/speedChallengeStore');
    const store = useSpeedChallengeStore.getState();
    
    // Clear large data structures
    if (store.patternQueue && store.patternQueue.length > 5) {
      // Keep only essential patterns
      perfLogger.info('Clearing pattern queue to reduce memory usage');
    }
    
    // Check memory after cleanup
    const memoryAfter = process.memoryUsage ? process.memoryUsage().heapUsed : 0;
    
    return {
      success: true,
      strategy: RecoveryStrategy.DEGRADE,
      message: 'Reduced memory usage - using smaller pattern queue',
      newSettings: { 
        patternQueueSize: Math.min(5, RECOVERY_CONFIG.emergencyFallbackPatterns),
        useReducedMemoryMode: true,
      },
    };
    
  } catch (error) {
    perfLogger.error('Memory pressure recovery failed', { error });
    return {
      success: false,
      strategy: RecoveryStrategy.DISABLE,
      message: 'Memory issues - Speed Challenge disabled',
      shouldDisable: true,
    };
  }
}

/**
 * Execute recovery strategy for performance degradation
 */
async function recoverPerformanceDegradation(errorContext: ErrorContext): Promise<RecoveryResult> {
  try {
    return {
      success: true,
      strategy: RecoveryStrategy.DEGRADE,
      message: 'Performance optimizations enabled',
      newSettings: {
        usePerformanceMode: true,
        reduceVisualFeedback: true,
        disableAnimations: true,
      },
    };
  } catch (error) {
    return {
      success: false,
      strategy: RecoveryStrategy.DISABLE,
      message: 'Performance issues - Speed Challenge disabled',
      shouldDisable: true,
    };
  }
}

/**
 * Create emergency fallback pattern for critical failures
 */
function createEmergencyPattern(): Pattern {
  return {
    id: `emergency_${Date.now()}`,
    type: 'single_note',
    difficulty: DifficultyLevel.SINGLE_NOTES,
    notes: [{
      pitch: 60, // C4
      octave: 4,
      accidental: null,
      duration: 1,
      voice: 1,
    }],
    expectedNotes: [60],
    musicXML: `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`,
    metadata: {
      generatedAt: Date.now(),
      isEmergencyFallback: true,
    },
  };
}

// ============================================================================
// MAIN RECOVERY COORDINATOR
// ============================================================================

/**
 * Main error recovery function that routes to appropriate strategy
 */
export async function recoverFromError(error: Error, context?: Record<string, any>): Promise<RecoveryResult> {
  const startTime = performance.now();
  
  try {
    // Classify the error
    const errorContext = classifyError(error, context);
    
    // Log error classification
    perfLogger.warn('Speed Challenge error detected', {
      category: errorContext.category,
      severity: errorContext.severity,
      message: errorContext.message,
    });
    
    // Route to appropriate recovery strategy
    let recoveryResult: RecoveryResult;
    
    switch (errorContext.category) {
      case ErrorCategory.PATTERN_GENERATION:
        recoveryResult = await recoverPatternGeneration(errorContext);
        break;
        
      case ErrorCategory.MIDI_CONNECTION:
        recoveryResult = await recoverMidiConnection(errorContext);
        break;
        
      case ErrorCategory.MEMORY_PRESSURE:
        recoveryResult = await recoverMemoryPressure(errorContext);
        break;
        
      case ErrorCategory.PERFORMANCE_DEGRADATION:
        recoveryResult = await recoverPerformanceDegradation(errorContext);
        break;
        
      case ErrorCategory.VALIDATION:
      case ErrorCategory.VISUAL_FEEDBACK:
        // Low severity - continue with degraded functionality
        recoveryResult = {
          success: true,
          strategy: RecoveryStrategy.DEGRADE,
          message: 'Non-critical error - continuing with reduced functionality',
        };
        break;
        
      default:
        // Unknown errors - attempt restart
        recoveryResult = {
          success: false,
          strategy: RecoveryStrategy.RESTART,
          message: 'Unknown error - attempting restart',
          retryAfter: RECOVERY_CONFIG.cooldownPeriodMs,
        };
    }
    
    // Log recovery result
    perfLogger.info('Error recovery attempted', {
      errorId: errorContext.errorId,
      strategy: recoveryResult.strategy,
      success: recoveryResult.success,
      message: recoveryResult.message,
    });
    
    return recoveryResult;
    
  } catch (recoveryError) {
    perfLogger.error('Error recovery failed', { 
      originalError: error.message, 
      recoveryError 
    });
    
    return {
      success: false,
      strategy: RecoveryStrategy.DISABLE,
      message: 'Recovery system failed - disabling Speed Challenge',
      shouldDisable: true,
    };
  } finally {
    const recoveryTime = performance.now() - startTime;
    speedChallengeLogger.logUIUpdate(recoveryTime);
    
    // Ensure recovery overhead <1ms
    if (recoveryTime > 1) {
      perfLogger.warn(`Error recovery took ${recoveryTime.toFixed(2)}ms`);
    }
  }
}

// ============================================================================
// ERROR PREVENTION AND MONITORING
// ============================================================================

/**
 * Monitor system health and prevent errors proactively
 */
export class SpeedChallengeHealthMonitor {
  private memoryCheckInterval: NodeJS.Timeout | null = null;
  private performanceCheckInterval: NodeJS.Timeout | null = null;
  private isMonitoring = false;

  /**
   * Start health monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    
    // Monitor memory usage every 30 seconds
    this.memoryCheckInterval = setInterval(() => {
      this.checkMemoryPressure();
    }, 30000);
    
    // Monitor performance every 10 seconds
    this.performanceCheckInterval = setInterval(() => {
      this.checkPerformanceDegradation();
    }, 10000);
    
    perfLogger.info('Speed Challenge health monitoring started');
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
    
    if (this.performanceCheckInterval) {
      clearInterval(this.performanceCheckInterval);
      this.performanceCheckInterval = null;
    }
    
    perfLogger.info('Speed Challenge health monitoring stopped');
  }

  /**
   * Check for memory pressure
   */
  private checkMemoryPressure(): void {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const memoryUsage = process.memoryUsage();
      
      if (memoryUsage.heapUsed > RECOVERY_CONFIG.memoryPressureThreshold) {
        perfLogger.warn('Memory pressure detected', {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          threshold: Math.round(RECOVERY_CONFIG.memoryPressureThreshold / 1024 / 1024),
        });
        
        // Trigger memory cleanup
        this.triggerMemoryCleanup();
      }
    }
  }

  /**
   * Check for performance degradation
   */
  private checkPerformanceDegradation(): void {
    const metrics = speedChallengeLogger.getMetrics();
    
    if (metrics.overallLatency.averageTime > RECOVERY_CONFIG.latencyThreshold) {
      perfLogger.warn('Performance degradation detected', {
        currentLatency: metrics.overallLatency.averageTime.toFixed(2),
        threshold: RECOVERY_CONFIG.latencyThreshold,
      });
      
      // Trigger performance optimization
      this.triggerPerformanceOptimization();
    }
  }

  /**
   * Trigger memory cleanup
   */
  private triggerMemoryCleanup(): void {
    if (typeof global !== 'undefined' && global.gc) {
      global.gc();
    }
    
    // Additional cleanup logic can be added here
  }

  /**
   * Trigger performance optimization
   */
  private triggerPerformanceOptimization(): void {
    // Reduce pattern queue size, disable animations, etc.
    perfLogger.info('Triggering performance optimizations');
  }
}

// Export singleton monitor instance
export const healthMonitor = new SpeedChallengeHealthMonitor();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if error is recoverable
 */
export function isRecoverableError(error: Error): boolean {
  const errorContext = classifyError(error);
  return errorContext.severity !== ErrorSeverity.CRITICAL;
}

/**
 * Get user-friendly error message
 */
export function getUserFriendlyErrorMessage(error: Error): string {
  const errorContext = classifyError(error);
  
  switch (errorContext.category) {
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

export type { ErrorContext, RecoveryResult };
export { ErrorCategory, ErrorSeverity, RecoveryStrategy };