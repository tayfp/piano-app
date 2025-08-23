/**
 * Phase 6.2: Speed Challenge Error Boundary Component
 * 
 * Provides comprehensive error handling for Speed Challenge Mode with:
 * - Graceful degradation for component failures
 * - Error recovery mechanisms
 * - Performance monitoring for error handling overhead
 * - Integration with existing error reporting infrastructure
 * 
 * Critical Requirements:
 * - Error handling overhead <1ms
 * - Graceful recovery without breaking main app
 * - Clear error messages for users
 * - Proper cleanup on errors
 */

import React, { Component, ReactNode, ErrorInfo } from 'react';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { speedChallengeLogger } from '../utils/performance-logger';

// ============================================================================
// INTERFACES AND TYPES
// ============================================================================

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  isolateErrors?: boolean; // If true, prevents errors from bubbling up
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string;
  errorTimestamp: number;
  retryCount: number;
}

interface SerializedError {
  message: string;
  stack?: string;
  componentStack?: string;
  timestamp: number;
  errorId: string;
  retryCount: number;
  speedChallengeContext?: {
    isActive: boolean;
    currentDifficulty?: string;
    currentPattern?: any;
    performanceMetrics?: any;
  };
}

// ============================================================================
// ERROR RECOVERY STRATEGIES
// ============================================================================

enum RecoveryStrategy {
  RETRY = 'retry',
  FALLBACK = 'fallback',
  DISABLE = 'disable',
  RESTART = 'restart'
}

const MAX_RETRY_COUNT = 3;
const RETRY_DELAY_MS = 1000;
const ERROR_COOLDOWN_MS = 5000;

// ============================================================================
// SPEED CHALLENGE ERROR BOUNDARY
// ============================================================================

/**
 * Error boundary specifically designed for Speed Challenge Mode
 * Provides graceful degradation and recovery mechanisms
 */
export class SpeedChallengeErrorBoundary extends Component<Props, State> {
  private errorCooldownTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(props: Props) {
    super(props);
    
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: '',
      errorTimestamp: 0,
      retryCount: 0,
    };
  }

  /**
   * Static method to capture errors and update state
   */
  static getDerivedStateFromError(error: Error): Partial<State> {
    const errorId = `sc_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return {
      hasError: true,
      error,
      errorId,
      errorTimestamp: performance.now(),
    };
  }

  /**
   * Handle component errors with performance monitoring
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const startTime = performance.now();
    
    try {
      // Update state with error info
      this.setState(prevState => ({
        errorInfo,
        retryCount: prevState.retryCount + 1,
      }));

      // Gather Speed Challenge context
      const speedChallengeContext = this.gatherSpeedChallengeContext();

      // Create serialized error for reporting
      const serializedError: SerializedError = {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: this.state.errorTimestamp,
        errorId: this.state.errorId,
        retryCount: this.state.retryCount,
        speedChallengeContext,
      };

      // Log error with performance tracking
      this.logError(serializedError);

      // Call custom error handler if provided
      if (this.props.onError) {
        this.props.onError(error, errorInfo);
      }

      // Determine recovery strategy
      const strategy = this.determineRecoveryStrategy(error, this.state.retryCount);
      this.executeRecoveryStrategy(strategy);

    } catch (errorHandlingError) {
      // Fallback error handling - prevent infinite loops
      perfLogger.error('Error in SpeedChallengeErrorBoundary error handling', {
        originalError: error.message,
        handlingError: errorHandlingError,
      });
    } finally {
      // Track error handling performance
      const endTime = performance.now();
      const errorHandlingTime = endTime - startTime;
      
      // Ensure error handling overhead <1ms
      if (errorHandlingTime > 1) {
        perfLogger.warn(`Speed Challenge error handling took ${errorHandlingTime.toFixed(2)}ms`);
      }
      
      speedChallengeLogger.logUIUpdate(errorHandlingTime);
    }
  }

  /**
   * Gather Speed Challenge specific context for error reporting
   */
  private gatherSpeedChallengeContext() {
    try {
      // Import store dynamically to avoid circular dependencies
      const { useSpeedChallengeStore } = require('../stores/speedChallengeStore');
      const store = useSpeedChallengeStore.getState();
      
      return {
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
    } catch (contextError) {
      perfLogger.warn('Failed to gather Speed Challenge context for error', { contextError });
      return {
        isActive: false,
        contextGatheringFailed: true,
      };
    }
  }

  /**
   * Log error with appropriate channels and performance tracking
   */
  private logError(serializedError: SerializedError): void {
    // Log to performance logger
    perfLogger.error('Speed Challenge component error', serializedError);

    // Log to main error reporting if available
    if (typeof window !== 'undefined' && window.api?.logError) {
      window.api.logError(serializedError);
    }

    // Log critical errors to console for development
    if (process.env.NODE_ENV === 'development') {
      console.error('Speed Challenge Error:', serializedError);
    }
  }

  /**
   * Determine appropriate recovery strategy based on error type and retry count
   */
  private determineRecoveryStrategy(error: Error, retryCount: number): RecoveryStrategy {
    // Too many retries - disable feature
    if (retryCount >= MAX_RETRY_COUNT) {
      return RecoveryStrategy.DISABLE;
    }

    // Pattern generation errors - retry
    if (error.message.includes('pattern') || error.message.includes('generation')) {
      return RecoveryStrategy.RETRY;
    }

    // MIDI or validation errors - restart
    if (error.message.includes('midi') || error.message.includes('validation')) {
      return RecoveryStrategy.RESTART;
    }

    // UI or rendering errors - fallback
    if (error.message.includes('render') || error.message.includes('component')) {
      return RecoveryStrategy.FALLBACK;
    }

    // Default strategy
    return retryCount < 2 ? RecoveryStrategy.RETRY : RecoveryStrategy.FALLBACK;
  }

  /**
   * Execute the determined recovery strategy
   */
  private executeRecoveryStrategy(strategy: RecoveryStrategy): void {
    switch (strategy) {
      case RecoveryStrategy.RETRY:
        this.scheduleRetry();
        break;
        
      case RecoveryStrategy.FALLBACK:
        // Error state is already set, will show fallback UI
        break;
        
      case RecoveryStrategy.DISABLE:
        this.disableSpeedChallenge();
        break;
        
      case RecoveryStrategy.RESTART:
        this.restartSpeedChallenge();
        break;
    }
  }

  /**
   * Schedule automatic retry with delay
   */
  private scheduleRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    this.retryTimer = setTimeout(() => {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
      });
    }, RETRY_DELAY_MS);
  }

  /**
   * Disable Speed Challenge Mode due to repeated errors
   */
  private disableSpeedChallenge(): void {
    try {
      const { useSpeedChallengeStore } = require('../stores/speedChallengeStore');
      const store = useSpeedChallengeStore.getState();
      
      if (store.isActive) {
        store.stopChallenge();
      }
      
      perfLogger.warn('Speed Challenge disabled due to repeated errors');
    } catch (disableError) {
      perfLogger.error('Failed to disable Speed Challenge', { disableError });
    }
  }

  /**
   * Restart Speed Challenge Mode after error
   */
  private restartSpeedChallenge(): void {
    try {
      const { useSpeedChallengeStore } = require('../stores/speedChallengeStore');
      const store = useSpeedChallengeStore.getState();
      
      // Stop and restart
      if (store.isActive) {
        store.stopChallenge();
      }
      
      // Clear error state and restart after cooldown
      setTimeout(() => {
        this.setState({
          hasError: false,
          error: null,
          errorInfo: null,
        });
        
        // Restart with same difficulty
        store.startChallenge(store.currentLevel);
      }, ERROR_COOLDOWN_MS);
      
    } catch (restartError) {
      perfLogger.error('Failed to restart Speed Challenge', { restartError });
      // Fall back to disable strategy
      this.disableSpeedChallenge();
    }
  }

  /**
   * Manual retry function for user-triggered recovery
   */
  public retry = (): void => {
    if (this.state.retryCount < MAX_RETRY_COUNT) {
      this.setState(prevState => ({
        hasError: false,
        error: null,
        errorInfo: null,
        retryCount: prevState.retryCount + 1,
      }));
    }
  };

  /**
   * Reset error boundary to initial state
   */
  public reset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: '',
      errorTimestamp: 0,
      retryCount: 0,
    });
  };

  /**
   * Component cleanup
   */
  componentWillUnmount(): void {
    if (this.errorCooldownTimer) {
      clearTimeout(this.errorCooldownTimer);
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
  }

  /**
   * Render error fallback UI or children
   */
  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="speed-challenge-error-boundary" role="alert">
          <div className="error-content">
            <h3>Speed Challenge Temporarily Unavailable</h3>
            <p>
              An error occurred in Speed Challenge Mode. The feature has been temporarily disabled
              to maintain application stability.
            </p>
            
            {this.state.retryCount < MAX_RETRY_COUNT && (
              <div className="error-actions">
                <button 
                  onClick={this.retry}
                  className="retry-button"
                  aria-label="Retry Speed Challenge"
                >
                  Retry ({MAX_RETRY_COUNT - this.state.retryCount} attempts remaining)
                </button>
              </div>
            )}
            
            {this.state.retryCount >= MAX_RETRY_COUNT && (
              <div className="error-message">
                <p>
                  Please refresh the page to restore Speed Challenge functionality.
                  If the problem persists, please report this issue.
                </p>
                <details>
                  <summary>Error Details (for support)</summary>
                  <pre>
                    Error ID: {this.state.errorId}{'\n'}
                    Message: {this.state.error?.message}{'\n'}
                    Timestamp: {new Date(this.state.errorTimestamp).toISOString()}
                  </pre>
                </details>
              </div>
            )}
          </div>
          
          <style jsx>{`
            .speed-challenge-error-boundary {
              padding: 1rem;
              border: 1px solid #ff6b6b;
              border-radius: 4px;
              background-color: #ffe0e0;
              color: #d63031;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            
            .error-content h3 {
              margin: 0 0 0.5rem 0;
              font-size: 1.1rem;
              font-weight: 600;
            }
            
            .error-content p {
              margin: 0 0 1rem 0;
              line-height: 1.4;
            }
            
            .error-actions {
              margin: 1rem 0;
            }
            
            .retry-button {
              background: #d63031;
              color: white;
              border: none;
              padding: 0.5rem 1rem;
              border-radius: 4px;
              cursor: pointer;
              font-size: 0.9rem;
              transition: background-color 0.2s;
            }
            
            .retry-button:hover {
              background: #a71e1e;
            }
            
            .retry-button:disabled {
              background: #ccc;
              cursor: not-allowed;
            }
            
            .error-message details {
              margin-top: 1rem;
            }
            
            .error-message summary {
              cursor: pointer;
              font-weight: 500;
            }
            
            .error-message pre {
              background: #f5f5f5;
              padding: 0.5rem;
              border-radius: 4px;
              font-size: 0.8rem;
              margin-top: 0.5rem;
              overflow-x: auto;
            }
          `}</style>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// HOC FOR EASY INTEGRATION
// ============================================================================

/**
 * Higher-order component for wrapping Speed Challenge components with error boundary
 */
export function withSpeedChallengeErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Partial<Props>
) {
  const WithErrorBoundaryComponent = (props: P) => (
    <SpeedChallengeErrorBoundary {...errorBoundaryProps}>
      <WrappedComponent {...props} />
    </SpeedChallengeErrorBoundary>
  );

  WithErrorBoundaryComponent.displayName = 
    `withSpeedChallengeErrorBoundary(${WrappedComponent.displayName || WrappedComponent.name})`;

  return WithErrorBoundaryComponent;
}

// ============================================================================
// HOOK FOR ERROR BOUNDARY INTERACTION
// ============================================================================

/**
 * Hook for components to interact with their error boundary
 */
export function useSpeedChallengeErrorBoundary() {
  const [errorBoundaryRef, setErrorBoundaryRef] = React.useState<SpeedChallengeErrorBoundary | null>(null);

  const triggerError = React.useCallback((error: Error) => {
    if (errorBoundaryRef) {
      // Trigger error in boundary
      throw error;
    }
  }, [errorBoundaryRef]);

  const retry = React.useCallback(() => {
    if (errorBoundaryRef) {
      errorBoundaryRef.retry();
    }
  }, [errorBoundaryRef]);

  const reset = React.useCallback(() => {
    if (errorBoundaryRef) {
      errorBoundaryRef.reset();
    }
  }, [errorBoundaryRef]);

  return {
    setErrorBoundaryRef,
    triggerError,
    retry,
    reset,
  };
}

export default SpeedChallengeErrorBoundary;