/**
 * Error Fallback UI Component
 * 
 * Reusable error display UI for Speed Challenge error boundaries.
 * Provides consistent styling and interaction patterns for error states.
 * 
 * Performance: Minimal runtime overhead, pre-styled components
 */

import React from 'react';
import { ERROR_CONSTANTS } from './error-types';

// ============================================================================
// COMPONENT PROPS
// ============================================================================

export interface ErrorFallbackUIProps {
  errorId: string;
  errorMessage?: string;
  errorTimestamp: number;
  retryCount: number;
  onRetry: () => void;
  showDetails?: boolean;
}

// ============================================================================
// ERROR FALLBACK UI COMPONENT
// ============================================================================

export const ErrorFallbackUI: React.FC<ErrorFallbackUIProps> = ({
  errorId,
  errorMessage,
  errorTimestamp,
  retryCount,
  onRetry,
  showDetails = true,
}) => {
  const attemptsRemaining = ERROR_CONSTANTS.MAX_RETRY_COUNT - retryCount;
  const canRetry = retryCount < ERROR_CONSTANTS.MAX_RETRY_COUNT;

  return (
    <div className="speed-challenge-error-boundary" role="alert">
      <div className="error-content">
        <h3>Speed Challenge Temporarily Unavailable</h3>
        <p>
          An error occurred in Speed Challenge Mode. The feature has been temporarily disabled
          to maintain application stability.
        </p>
        
        {canRetry && (
          <div className="error-actions">
            <button 
              onClick={onRetry}
              className="retry-button"
              aria-label="Retry Speed Challenge"
            >
              Retry ({attemptsRemaining} attempts remaining)
            </button>
          </div>
        )}
        
        {!canRetry && (
          <div className="error-message">
            <p>
              Please refresh the page to restore Speed Challenge functionality.
              If the problem persists, please report this issue.
            </p>
            {showDetails && (
              <details>
                <summary>Error Details (for support)</summary>
                <pre>
                  Error ID: {errorId}{'\n'}
                  Message: {errorMessage}{'\n'}
                  Timestamp: {new Date(errorTimestamp).toISOString()}
                </pre>
              </details>
            )}
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
};

export default ErrorFallbackUI;