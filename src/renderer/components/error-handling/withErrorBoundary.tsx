/**
 * Higher-Order Component for Error Boundary Integration
 * 
 * Reusable HOC that wraps any component with SpeedChallengeErrorBoundary.
 * Provides consistent error handling across Speed Challenge components.
 * 
 * Performance: Zero runtime overhead, compile-time composition
 */

import React from 'react';
import { ErrorBoundaryProps } from './error-types';

// ============================================================================
// HOC TYPES
// ============================================================================

interface WithErrorBoundaryOptions extends Partial<ErrorBoundaryProps> {
  displayName?: string;
}

// ============================================================================
// ERROR BOUNDARY HOC
// ============================================================================

/**
 * Higher-order component for wrapping Speed Challenge components with error boundary
 * Provides consistent error handling and recovery across all Speed Challenge features
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options: WithErrorBoundaryOptions = {}
) {
  // Import SpeedChallengeErrorBoundary dynamically to avoid circular dependencies
  const SpeedChallengeErrorBoundary = React.lazy(() =>
    import('@/renderer/features/speed-challenge/components/SpeedChallengeErrorBoundary')
      .then(module => ({ default: module.SpeedChallengeErrorBoundary }))
  );

  const WithErrorBoundaryComponent = (props: P) => (
    <React.Suspense fallback={<div>Loading...</div>}>
      <SpeedChallengeErrorBoundary
        fallback={options.fallback}
        onError={options.onError}
        isolateErrors={options.isolateErrors ?? true}
      >
        <WrappedComponent {...props} />
      </SpeedChallengeErrorBoundary>
    </React.Suspense>
  );

  // Set display name for better debugging
  const componentName = WrappedComponent.displayName || WrappedComponent.name || 'Component';
  WithErrorBoundaryComponent.displayName = options.displayName || `withErrorBoundary(${componentName})`;

  return WithErrorBoundaryComponent;
}

// ============================================================================
// HOOK FOR ERROR BOUNDARY INTERACTION
// ============================================================================

/**
 * Hook for components to interact with their error boundary
 * Provides methods to trigger errors, retry, and reset error state
 */
export function useErrorBoundaryControl() {
  const [errorBoundary, setErrorBoundary] = React.useState<any>(null);

  const triggerError = React.useCallback((error: Error) => {
    // Throw error to be caught by error boundary
    setTimeout(() => {
      throw error;
    }, 0);
  }, []);

  const retry = React.useCallback(() => {
    if (errorBoundary?.retry) {
      errorBoundary.retry();
    }
  }, [errorBoundary]);

  const reset = React.useCallback(() => {
    if (errorBoundary?.reset) {
      errorBoundary.reset();
    }
  }, [errorBoundary]);

  return {
    setErrorBoundaryRef: setErrorBoundary,
    triggerError,
    retry,
    reset,
  };
}

export default withErrorBoundary;