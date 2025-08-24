/**
 * Speed Challenge Error Boundary Component
 * 
 * Core error boundary for Speed Challenge Mode with modular architecture:
 * - Delegated error context gathering via ErrorContextService
 * - Delegated recovery strategies via ErrorRecoveryStrategies
 * - Modular UI via ErrorFallbackUI component
 * - Reusable HOC via withErrorBoundary
 * 
 * Performance: <1ms error handling overhead maintained
 * Architecture: Clean separation of concerns with service layer
 */

import React, { Component, ReactNode, ErrorInfo } from 'react';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { speedChallengeLogger } from '../utils/performance-logger';
import {
  ErrorBoundaryProps as Props,
  ErrorBoundaryState as State,
  SerializedError,
  RecoveryStrategy,
  ERROR_CONSTANTS,
} from '@/renderer/components/error-handling/error-types';
import ErrorFallbackUI from '@/renderer/components/error-handling/ErrorFallbackUI';
import { errorContextService } from '@/renderer/services/error-handling/ErrorContextService';
import { errorRecoveryStrategies } from '@/renderer/services/error-handling/ErrorRecoveryStrategies';

// ============================================================================
// MAIN ERROR BOUNDARY CLASS
// ============================================================================
export class SpeedChallengeErrorBoundary extends Component<Props, State> {
  private errorCooldownTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false, error: null, errorInfo: null, errorId: '', errorTimestamp: 0, retryCount: 0,
    };
  }

  /** Capture errors and update state */
  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      errorId: `sc_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      errorTimestamp: performance.now(),
    };
  }

  /** Handle component errors with performance monitoring and recovery */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const startTime = performance.now();
    
    try {
      // Update state and gather context
      this.setState(prevState => ({ errorInfo, retryCount: prevState.retryCount + 1 }));
      const speedChallengeContext = errorContextService.gatherSpeedChallengeContext();

      // Log error
      this.logError({
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: this.state.errorTimestamp,
        errorId: this.state.errorId,
        retryCount: this.state.retryCount,
        speedChallengeContext,
      });

      // Execute custom error handler and recovery strategy
      this.props.onError?.(error, errorInfo);
      const strategy = errorRecoveryStrategies.determineRecoveryStrategy(error, this.state.retryCount);
      errorRecoveryStrategies.executeRecoveryStrategy(strategy, this.scheduleRetry, this.reset);

    } catch (errorHandlingError) {
      perfLogger.error('Error in SpeedChallengeErrorBoundary error handling', {
        originalError: error.message, handlingError: errorHandlingError,
      });
    } finally {
      const endTime = performance.now();
      const errorHandlingTime = endTime - startTime;
      if (errorHandlingTime > 1) {
        perfLogger.warn(`Speed Challenge error handling took ${errorHandlingTime.toFixed(2)}ms`);
      }
      speedChallengeLogger.logUIUpdate(errorHandlingTime);
    }
  }

  /** Log error with appropriate channels and performance tracking */
  private logError(serializedError: SerializedError): void {
    perfLogger.error('Speed Challenge component error', serializedError);
    window.api?.logError?.(serializedError);
    if (process.env.NODE_ENV === 'development') {
      console.error('Speed Challenge Error:', serializedError);
    }
  }

  /** Schedule automatic retry with delay */
  private scheduleRetry = (): void => {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.setState({ hasError: false, error: null, errorInfo: null });
    }, ERROR_CONSTANTS.RETRY_DELAY_MS);
  };

  /** Manual retry function for user-triggered recovery */
  public retry = (): void => {
    if (this.state.retryCount < ERROR_CONSTANTS.MAX_RETRY_COUNT) {
      this.setState(prevState => ({
        hasError: false, error: null, errorInfo: null, retryCount: prevState.retryCount + 1,
      }));
    }
  };

  /** Reset error boundary to initial state */
  public reset = (): void => {
    this.setState({
      hasError: false, error: null, errorInfo: null, errorId: '', errorTimestamp: 0, retryCount: 0,
    });
  };

  /** Component cleanup */
  componentWillUnmount(): void {
    if (this.errorCooldownTimer) clearTimeout(this.errorCooldownTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  /** Render error fallback UI or children */
  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <ErrorFallbackUI
          errorId={this.state.errorId}
          errorMessage={this.state.error?.message}
          errorTimestamp={this.state.errorTimestamp}
          retryCount={this.state.retryCount}
          onRetry={this.retry}
          showDetails={true}
        />
      );
    }
    return this.props.children;
  }
}


export default SpeedChallengeErrorBoundary;