/**
 * Error Recovery Strategies Service
 * 
 * Centralized logic for determining and executing error recovery strategies
 * based on error type, frequency, and context.
 * 
 * Performance requirement: Strategy determination <0.5ms
 * Recovery actions must maintain Speed Challenge state integrity
 */

import { perfLogger } from '@/renderer/utils/performance-logger';
import { RecoveryStrategy, ERROR_CONSTANTS } from '@/renderer/components/error-handling/error-types';
import { errorContextService } from './ErrorContextService';

// ============================================================================
// RECOVERY STRATEGY SERVICE
// ============================================================================

export class ErrorRecoveryStrategies {
  private static instance: ErrorRecoveryStrategies;

  private constructor() {}

  public static getInstance(): ErrorRecoveryStrategies {
    if (!ErrorRecoveryStrategies.instance) {
      ErrorRecoveryStrategies.instance = new ErrorRecoveryStrategies();
    }
    return ErrorRecoveryStrategies.instance;
  }

  /**
   * Determine appropriate recovery strategy based on error type and retry count
   * Uses pattern matching on error messages and retry history
   */
  public determineRecoveryStrategy(error: Error, retryCount: number): RecoveryStrategy {
    // Too many retries - disable feature to prevent infinite loops
    if (retryCount >= ERROR_CONSTANTS.MAX_RETRY_COUNT) {
      return RecoveryStrategy.DISABLE;
    }

    const errorMessage = error.message.toLowerCase();

    // Pattern generation errors - usually transient, retry quickly
    if (errorMessage.includes('pattern') || errorMessage.includes('generation')) {
      return RecoveryStrategy.RETRY;
    }

    // MIDI or validation errors - may need full restart to clear state
    if (errorMessage.includes('midi') || errorMessage.includes('validation')) {
      return RecoveryStrategy.RESTART;
    }

    // UI or rendering errors - show fallback UI while maintaining functionality
    if (errorMessage.includes('render') || errorMessage.includes('component')) {
      return RecoveryStrategy.FALLBACK;
    }

    // Store or state errors - restart to reset state
    if (errorMessage.includes('store') || errorMessage.includes('state')) {
      return RecoveryStrategy.RESTART;
    }

    // Default strategy based on retry count
    return retryCount < 2 ? RecoveryStrategy.RETRY : RecoveryStrategy.FALLBACK;
  }

  /**
   * Execute the determined recovery strategy with proper error handling
   * Each strategy maintains Speed Challenge state integrity
   */
  public executeRecoveryStrategy(
    strategy: RecoveryStrategy,
    onRetry: () => void,
    onReset: () => void
  ): void {
    switch (strategy) {
      case RecoveryStrategy.RETRY:
        this.scheduleRetry(onRetry);
        break;
        
      case RecoveryStrategy.FALLBACK:
        // Error state is already set, will show fallback UI
        this.handleFallback();
        break;
        
      case RecoveryStrategy.DISABLE:
        this.disableSpeedChallenge();
        break;
        
      case RecoveryStrategy.RESTART:
        this.restartSpeedChallenge(onReset);
        break;

      default:
        perfLogger.warn(`Unknown recovery strategy: ${strategy}`);
        this.handleFallback();
    }
  }

  /**
   * Schedule automatic retry with appropriate delay
   */
  private scheduleRetry(onRetry: () => void): void {
    setTimeout(() => {
      onRetry();
    }, ERROR_CONSTANTS.RETRY_DELAY_MS);
  }

  /**
   * Handle fallback strategy - log and maintain current state
   */
  private handleFallback(): void {
    perfLogger.info('Speed Challenge entering fallback mode');
    // Clear context cache to ensure fresh data on next attempt
    errorContextService.clearCache();
  }

  /**
   * Disable Speed Challenge Mode due to repeated errors
   * Safely stops the challenge without affecting main application
   */
  private disableSpeedChallenge(): void {
    try {
      const { useSpeedChallengeStore } = require('@/renderer/features/speed-challenge/stores/speedChallengeStore');
      const store = useSpeedChallengeStore.getState();
      
      if (store.isActive) {
        store.stopChallenge();
      }
      
      // Clear any cached context
      errorContextService.clearCache();
      
      perfLogger.warn('Speed Challenge disabled due to repeated errors');
    } catch (disableError) {
      perfLogger.error('Failed to disable Speed Challenge', disableError as Error);
    }
  }

  /**
   * Restart Speed Challenge Mode after error
   * Performs clean shutdown and restart with appropriate delay
   */
  private restartSpeedChallenge(onReset: () => void): void {
    try {
      const { useSpeedChallengeStore } = require('@/renderer/features/speed-challenge/stores/speedChallengeStore');
      const store = useSpeedChallengeStore.getState();
      
      const currentLevel = store.currentLevel; // Preserve difficulty level
      
      // Stop current challenge
      if (store.isActive) {
        store.stopChallenge();
      }
      
      // Clear context cache
      errorContextService.clearCache();
      
      // Reset error boundary state and restart after cooldown
      setTimeout(() => {
        onReset();
        
        // Restart with same difficulty level
        try {
          store.startChallenge(currentLevel);
        } catch (restartError) {
          perfLogger.error('Failed to restart Speed Challenge', restartError as Error);
          // Fall back to disable strategy
          this.disableSpeedChallenge();
        }
      }, ERROR_CONSTANTS.ERROR_COOLDOWN_MS);
      
    } catch (restartError) {
      perfLogger.error('Failed to prepare Speed Challenge restart', restartError as Error);
      // Fall back to disable strategy
      this.disableSpeedChallenge();
    }
  }

  /**
   * Get recovery strategy recommendations for testing/debugging
   */
  public getStrategyRecommendation(errorMessage: string, retryCount: number): {
    strategy: RecoveryStrategy;
    reason: string;
  } {
    const mockError = new Error(errorMessage);
    const strategy = this.determineRecoveryStrategy(mockError, retryCount);
    
    let reason = 'Default strategy based on retry count';
    
    if (retryCount >= ERROR_CONSTANTS.MAX_RETRY_COUNT) {
      reason = 'Maximum retry count reached';
    } else if (errorMessage.includes('pattern')) {
      reason = 'Pattern generation error - transient issue';
    } else if (errorMessage.includes('midi')) {
      reason = 'MIDI error - requires state reset';
    } else if (errorMessage.includes('render')) {
      reason = 'Rendering error - show fallback UI';
    } else if (errorMessage.includes('store')) {
      reason = 'Store error - requires restart';
    }
    
    return { strategy, reason };
  }
}

// Export singleton instance
export const errorRecoveryStrategies = ErrorRecoveryStrategies.getInstance();