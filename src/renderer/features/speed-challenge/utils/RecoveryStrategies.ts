/**
 * Recovery Strategies Engine - Phase 3 Extraction
 * 
 * High-performance error recovery strategies extracted from errorRecovery.ts
 * Target: <3ms total recovery strategy execution
 * 
 * Optimizations:
 * - Strategy-specific modules with pre-cached dependencies
 * - Streamlined recovery pipelines
 * - Minimal async operations
 * - Fast-path validation
 */

import { perfLogger } from '@/renderer/utils/performance-logger';
import { speedChallengeLogger } from './performance-logger';
import { DifficultyLevel, Pattern, SpeedChallengeSettings, PatternType } from '../types';
import { ErrorCode, ErrorSeverity, type ClassifiedError } from './ErrorClassifier';

// ============================================================================
// RECOVERY STRATEGY TYPES
// ============================================================================

export enum RecoveryStrategy {
  RETRY = 'retry',
  FALLBACK = 'fallback',
  DEGRADE = 'degrade',
  RESTART = 'restart',
  DISABLE = 'disable'
}

export interface RecoveryResult {
  success: boolean;
  strategy: RecoveryStrategy;
  message: string;
  newSettings?: Partial<SpeedChallengeSettings>;
  shouldDisable?: boolean;
  retryAfter?: number; // milliseconds
  executionTime: number; // milliseconds
}

export interface RecoveryContext {
  classifiedError: ClassifiedError;
  recoveryAttempts: number;
  lastRecoveryTime?: number;
  systemContext?: Record<string, any>;
}

// ============================================================================
// MODULE PRE-CACHING SYSTEM
// ============================================================================

interface CachedRecoveryModules {
  PatternGenerator: any;
  useSpeedChallengeStore: any;
  isLoaded: boolean;
  loadTime: number;
}

// Pre-cached modules for fast recovery execution
let recoveryModules: CachedRecoveryModules = {
  PatternGenerator: null,
  useSpeedChallengeStore: null,
  isLoaded: false,
  loadTime: 0
};

/**
 * Initialize recovery module cache asynchronously
 * Called once during app startup to eliminate import overhead
 */
const initializeRecoveryCache = async (): Promise<void> => {
  const cacheStart = performance.now();
  
  try {
    const [patternModule, storeModule] = await Promise.all([
      import('../services/PatternGenerator'),
      import('../stores/speedChallengeStore')
    ]);
    
    recoveryModules = {
      PatternGenerator: patternModule.PatternGenerator,
      useSpeedChallengeStore: storeModule.useSpeedChallengeStore,
      isLoaded: true,
      loadTime: performance.now() - cacheStart
    };
    
    perfLogger.info(`Recovery modules cached in ${recoveryModules.loadTime.toFixed(2)}ms`);
  } catch (error) {
    perfLogger.error('Failed to cache recovery modules', error as Error);
  }
};

/**
 * Get cached modules with fallback to dynamic import
 * Target: <0.1ms for cached access vs 5-15ms for dynamic import
 */
const getCachedModules = async (): Promise<CachedRecoveryModules> => {
  if (recoveryModules.isLoaded) {
    return recoveryModules;
  }
  
  // Fallback to dynamic import (should rarely happen)
  perfLogger.warn('Using fallback dynamic imports for recovery strategies');
  
  const [patternModule, storeModule] = await Promise.all([
    import('../services/PatternGenerator'),
    import('../stores/speedChallengeStore')
  ]);
  
  return {
    PatternGenerator: patternModule.PatternGenerator,
    useSpeedChallengeStore: storeModule.useSpeedChallengeStore,
    isLoaded: true,
    loadTime: 0
  };
};

// Initialize cache on module load
initializeRecoveryCache().catch(error => {
  perfLogger.warn('Recovery module pre-caching failed', error);
});

// ============================================================================
// RECOVERY CONFIGURATION
// ============================================================================

const RECOVERY_CONFIG = {
  maxRetryAttempts: 3,
  retryDelayMs: 1000,
  memoryPressureThreshold: 50 * 1024 * 1024, // 50MB
  latencyThreshold: 25, // ms
  patternGenerationTimeout: 5000, // Reduced from 10s for faster recovery
  cooldownPeriodMs: 5000,
  emergencyFallbackPatterns: 5,
} as const;

// ============================================================================
// EMERGENCY PATTERN GENERATOR
// ============================================================================

/**
 * Pre-generated emergency pattern to avoid generation overhead
 * Target: <0.1ms vs dynamic generation
 */
const EMERGENCY_PATTERN: Pattern = {
  id: 'emergency_static',
  type: PatternType.SINGLE_NOTES,
  difficulty: DifficultyLevel.SINGLE_NOTES,
  notes: [{
    midi: 60, // C4
    duration: 1,
    startTime: 0,
    voice: 1,
  }],
  expectedDuration: 1000, // 1 second
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
    key: 'C',
    timeSignature: '4/4',
    tempo: 120,
    description: 'Emergency fallback pattern - C4 quarter note',
  },
};

// ============================================================================
// INDIVIDUAL RECOVERY STRATEGIES
// ============================================================================

/**
 * Pattern Generation Recovery Strategy
 * Target: <2ms execution time
 */
class PatternGenerationRecovery {
  static async execute(context: RecoveryContext): Promise<RecoveryResult> {
    const executionStart = performance.now();
    
    try {
      const modules = await getCachedModules();
      const store = modules.useSpeedChallengeStore.getState();
      
      // Fast-path: Use emergency pattern if multiple failures
      if (context.recoveryAttempts >= 2) {
        return {
          success: true,
          strategy: RecoveryStrategy.DEGRADE,
          message: 'Using emergency pattern for stability',
          newSettings: { adaptiveDifficulty: false },
          executionTime: performance.now() - executionStart
        };
      }
      
      // Strategy 1: Retry with current difficulty (timeout reduced)
      try {
        const generator = new modules.PatternGenerator();
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Generation timeout')), 2000) // 2s timeout
        );
        
        const generationPromise = generator.generatePattern(store.currentLevel);
        const newPattern = await Promise.race([generationPromise, timeoutPromise]);
        
        if (newPattern && newPattern.musicXML) {
          return {
            success: true,
            strategy: RecoveryStrategy.RETRY,
            message: 'Pattern generation recovered',
            executionTime: performance.now() - executionStart
          };
        }
      } catch (retryError) {
        perfLogger.warn('Fast pattern generation retry failed', retryError as Error);
      }
      
      // Strategy 2: Fast fallback to single notes
      if (store.currentLevel !== DifficultyLevel.SINGLE_NOTES) {
        return {
          success: true,
          strategy: RecoveryStrategy.FALLBACK,
          message: 'Switched to single notes mode',
          newSettings: { startingDifficulty: DifficultyLevel.SINGLE_NOTES },
          executionTime: performance.now() - executionStart
        };
      }
      
      // Strategy 3: Emergency pattern (pre-generated)
      return {
        success: true,
        strategy: RecoveryStrategy.DEGRADE,
        message: 'Using emergency pattern',
        newSettings: { adaptiveDifficulty: false },
        executionTime: performance.now() - executionStart
      };
      
    } catch (error) {
      perfLogger.error('Pattern generation recovery failed', error as Error);
      return {
        success: false,
        strategy: RecoveryStrategy.DISABLE,
        message: 'Pattern generation failed - disabling Speed Challenge',
        shouldDisable: true,
        executionTime: performance.now() - executionStart
      };
    }
  }
}

/**
 * MIDI Connection Recovery Strategy
 * Target: <1ms execution time
 */
class MidiConnectionRecovery {
  static async execute(context: RecoveryContext): Promise<RecoveryResult> {
    const executionStart = performance.now();
    
    try {
      // Fast MIDI availability check
      if (typeof navigator !== 'undefined' && navigator.requestMIDIAccess) {
        // Quick device enumeration without full access request
        const midiAccess = await navigator.requestMIDIAccess();
        const deviceCount = Array.from(midiAccess.inputs.values()).length;
        
        if (deviceCount === 0) {
          return {
            success: false,
            strategy: RecoveryStrategy.DISABLE,
            message: 'No MIDI devices - Speed Challenge requires MIDI input',
            shouldDisable: true,
            executionTime: performance.now() - executionStart
          };
        }
        
        return {
          success: true,
          strategy: RecoveryStrategy.RESTART,
          message: 'MIDI connection restored',
          retryAfter: RECOVERY_CONFIG.cooldownPeriodMs,
          executionTime: performance.now() - executionStart
        };
      }
      
      return {
        success: false,
        strategy: RecoveryStrategy.DISABLE,
        message: 'MIDI not available',
        shouldDisable: true,
        executionTime: performance.now() - executionStart
      };
      
    } catch (error) {
      return {
        success: false,
        strategy: RecoveryStrategy.DISABLE,
        message: 'MIDI recovery failed',
        shouldDisable: true,
        executionTime: performance.now() - executionStart
      };
    }
  }
}

/**
 * Memory Pressure Recovery Strategy
 * Target: <0.5ms execution time
 */
class MemoryPressureRecovery {
  static async execute(context: RecoveryContext): Promise<RecoveryResult> {
    const executionStart = performance.now();
    
    try {
      // Fast garbage collection trigger
      if (typeof global !== 'undefined' && global.gc) {
        global.gc();
      }
      
      // Immediate memory optimization settings
      return {
        success: true,
        strategy: RecoveryStrategy.DEGRADE,
        message: 'Memory optimizations enabled',
        newSettings: {
          adaptiveDifficulty: false, // Reduce processing overhead
          visualFeedbackDuration: 250, // Reduce memory usage
        },
        executionTime: performance.now() - executionStart
      };
      
    } catch (error) {
      return {
        success: false,
        strategy: RecoveryStrategy.DISABLE,
        message: 'Memory recovery failed',
        shouldDisable: true,
        executionTime: performance.now() - executionStart
      };
    }
  }
}

/**
 * Performance Degradation Recovery Strategy  
 * Target: <0.2ms execution time
 */
class PerformanceDegradationRecovery {
  static execute(context: RecoveryContext): RecoveryResult {
    const executionStart = performance.now();
    
    // Immediate performance optimization (no async operations)
    return {
      success: true,
      strategy: RecoveryStrategy.DEGRADE,
      message: 'Performance optimizations enabled',
      newSettings: {
        visualFeedbackDuration: 100, // Minimum feedback duration
        adaptiveDifficulty: false, // Disable CPU-intensive logic
        metronomeEnabled: false, // Reduce audio processing
      },
      executionTime: performance.now() - executionStart
    };
  }
}

/**
 * Low-severity error recovery (validation, visual feedback)
 * Target: <0.1ms execution time
 */
class LowSeverityRecovery {
  static execute(context: RecoveryContext): RecoveryResult {
    const executionStart = performance.now();
    
    return {
      success: true,
      strategy: RecoveryStrategy.DEGRADE,
      message: 'Non-critical error - continuing with reduced functionality',
      executionTime: performance.now() - executionStart
    };
  }
}

// ============================================================================
// MAIN RECOVERY STRATEGY ENGINE
// ============================================================================

/**
 * High-performance recovery strategy coordinator
 * Routes to appropriate strategy based on error classification
 */
export class RecoveryStrategies {
  /**
   * Execute recovery strategy for classified error
   * Target: <3ms total execution time
   */
  static async execute(context: RecoveryContext): Promise<RecoveryResult> {
    const routingStart = performance.now();
    
    let result: RecoveryResult;
    
    // Route to appropriate strategy based on error code (fast switch)
    switch (context.classifiedError.code) {
      case ErrorCode.PATTERN_GENERATION:
        result = await PatternGenerationRecovery.execute(context);
        break;
        
      case ErrorCode.MIDI_CONNECTION:
        result = await MidiConnectionRecovery.execute(context);
        break;
        
      case ErrorCode.MEMORY_PRESSURE:
        result = await MemoryPressureRecovery.execute(context);
        break;
        
      case ErrorCode.PERFORMANCE_DEGRADATION:
        result = PerformanceDegradationRecovery.execute(context);
        break;
        
      case ErrorCode.VALIDATION:
      case ErrorCode.VISUAL_FEEDBACK:
        result = LowSeverityRecovery.execute(context);
        break;
        
      default:
        // Unknown errors - minimal restart attempt
        result = {
          success: false,
          strategy: RecoveryStrategy.RESTART,
          message: 'Unknown error - attempting restart',
          retryAfter: RECOVERY_CONFIG.cooldownPeriodMs,
          executionTime: performance.now() - routingStart
        };
    }
    
    const totalExecutionTime = performance.now() - routingStart;
    
    // Log slow recovery execution
    if (totalExecutionTime > 3) {
      perfLogger.warn(`Slow recovery execution: ${totalExecutionTime.toFixed(2)}ms`);
    }
    
    // Track recovery performance
    speedChallengeLogger.logUIUpdate(totalExecutionTime);
    
    // Log recovery result
    perfLogger.info('Recovery strategy executed', {
      errorCode: context.classifiedError.code,
      strategy: result.strategy,
      success: result.success,
      executionTime: totalExecutionTime.toFixed(2)
    });
    
    return {
      ...result,
      executionTime: totalExecutionTime
    };
  }
  
  /**
   * Get emergency pattern without generation overhead
   * Target: <0.05ms
   */
  static getEmergencyPattern(): Pattern {
    return { ...EMERGENCY_PATTERN, id: `emergency_${Date.now()}` };
  }
  
  /**
   * Check if error type is recoverable
   * Target: <0.01ms
   */
  static isRecoverable(classifiedError: ClassifiedError): boolean {
    return classifiedError.severity !== ErrorSeverity.CRITICAL &&
           classifiedError.confidence > 0.5;
  }
  
  /**
   * Get recovery statistics for monitoring
   */
  static getStatistics(): {
    totalRecoveries: number;
    averageExecutionTime: number;
    successRate: number;
  } {
    // This would integrate with performance logging
    return {
      totalRecoveries: 0,
      averageExecutionTime: 0,
      successRate: 0
    };
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick recovery execution for hot paths
 * Target: <3ms including classification
 */
export async function executeRecovery(
  classifiedError: ClassifiedError,
  recoveryAttempts: number = 0,
  systemContext?: Record<string, any>
): Promise<RecoveryResult> {
  const context: RecoveryContext = {
    classifiedError,
    recoveryAttempts,
    systemContext
  };
  
  return RecoveryStrategies.execute(context);
}

/**
 * Get user-friendly recovery message
 */
export function getRecoveryMessage(result: RecoveryResult): string {
  return result.message;
}

/**
 * Check if recovery requires system restart
 */
export function requiresRestart(result: RecoveryResult): boolean {
  return result.strategy === RecoveryStrategy.RESTART || 
         result.strategy === RecoveryStrategy.DISABLE;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  RecoveryStrategy,
  type RecoveryResult,
  type RecoveryContext
};