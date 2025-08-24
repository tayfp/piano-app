/**
 * Error Context Service
 * 
 * Responsible for gathering contextual information from Speed Challenge
 * store for enhanced error reporting and debugging.
 * 
 * Performance requirement: Context gathering <0.5ms
 * Security: Safe error handling to prevent context gathering failures from affecting main app
 */

import { perfLogger } from '@/renderer/utils/performance-logger';
import { SpeedChallengeErrorContext } from '@/renderer/components/error-handling/error-types';

// ============================================================================
// ERROR CONTEXT GATHERING SERVICE
// ============================================================================

export class ErrorContextService {
  private static instance: ErrorContextService;
  private contextCache: SpeedChallengeErrorContext | null = null;
  private lastCacheUpdate: number = 0;
  private readonly CACHE_TTL_MS = 100; // Cache for 100ms to avoid repeated store access

  private constructor() {}

  public static getInstance(): ErrorContextService {
    if (!ErrorContextService.instance) {
      ErrorContextService.instance = new ErrorContextService();
    }
    return ErrorContextService.instance;
  }

  /**
   * Gather Speed Challenge specific context for error reporting
   * Safely handles store access with fallback for any failures
   */
  public gatherSpeedChallengeContext(): SpeedChallengeErrorContext {
    const now = performance.now();

    // Use cached context if still valid
    if (this.contextCache && (now - this.lastCacheUpdate) < this.CACHE_TTL_MS) {
      return this.contextCache;
    }

    try {
      // Import store dynamically to avoid circular dependencies
      const { useSpeedChallengeStore } = require('@/renderer/features/speed-challenge/stores/speedChallengeStore');
      const store = useSpeedChallengeStore.getState();
      
      const context: SpeedChallengeErrorContext = {
        isActive: store.isActive,
        currentDifficulty: store.currentLevel,
        currentPattern: store.currentPattern ? {
          id: store.currentPattern.id,
          type: store.currentPattern.type,
          noteCount: store.currentPattern.notes?.length || 0,
        } : null,
        performanceMetrics: {
          score: store.score,
          streak: store.streak,
          accuracy: store.accuracy,
          averageResponseTime: store.averageResponseTime,
          totalNotes: store.totalNotes,
        },
      };

      // Cache the context
      this.contextCache = context;
      this.lastCacheUpdate = now;

      return context;
    } catch (contextError) {
      perfLogger.warn('Failed to gather Speed Challenge context for error', { contextError });
      
      const fallbackContext: SpeedChallengeErrorContext = {
        isActive: false,
        contextGatheringFailed: true,
      };

      // Cache the fallback to prevent repeated failures
      this.contextCache = fallbackContext;
      this.lastCacheUpdate = now;

      return fallbackContext;
    }
  }

  /**
   * Clear the context cache to force fresh data gathering
   * Useful when store state has changed significantly
   */
  public clearCache(): void {
    this.contextCache = null;
    this.lastCacheUpdate = 0;
  }

  /**
   * Get cached context without triggering new gathering
   * Returns null if no cached context is available
   */
  public getCachedContext(): SpeedChallengeErrorContext | null {
    const now = performance.now();
    if (this.contextCache && (now - this.lastCacheUpdate) < this.CACHE_TTL_MS) {
      return this.contextCache;
    }
    return null;
  }
}

// Export singleton instance
export const errorContextService = ErrorContextService.getInstance();