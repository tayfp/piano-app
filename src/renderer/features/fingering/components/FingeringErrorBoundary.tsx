import React, { Component, ReactNode } from 'react';

import { perfLogger } from '@/renderer/utils/performance-logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  retryCount: number;
}

export class FingeringErrorBoundary extends Component<Props, State> {
  private maxRetries = 3; // Limit retry attempts

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Simplified error logging without risky side effects
    perfLogger.error('Fingering component error:', error instanceof Error ? error : new Error(String(error)));
    
    // Categorize errors for better debugging
    const errorCategory = this.categorizeError(error);
    perfLogger.warn('Error category:', { category: errorCategory });
    
    // Error logging handled by perfLogger which writes to main process via IPC
  }

  // Helper to categorize errors for debugging
  private categorizeError(error: Error): string {
    if (error.message.includes('OSMD') || error.message.includes('graphic')) {
      return 'OSMD_INTEGRATION';
    }
    if (error.message.includes('fingering') || error.message.includes('note')) {
      return 'DATA_PARSING';
    }
    if (error.message.includes('render') || error.message.includes('DOM')) {
      return 'RENDERING';
    }
    return 'UNKNOWN';
  }

  private handleRetry = () => {
    const newRetryCount = this.state.retryCount + 1;
    
    // Implement retry limit to prevent infinite loops
    if (newRetryCount <= this.maxRetries) {
      this.setState({ 
        hasError: false, 
        error: undefined,
        retryCount: newRetryCount 
      });
    }
  };

  render() {
    if (this.state.hasError) {
      const canRetry = this.state.retryCount < this.maxRetries;
      
      return this.props.fallback || (
        <div className="fingering-error-fallback" style={{
          padding: '10px',
          backgroundColor: '#fff3cd',
          border: '1px solid #ffeaa7',
          borderRadius: '4px',
          color: '#856404',
          fontSize: '12px'
        }}>
          ⚠️ Fingering annotations temporarily disabled due to an error.
          {canRetry ? (
            <button 
              onClick={this.handleRetry}
              style={{ 
                marginLeft: '10px', 
                fontSize: '11px',
                padding: '2px 8px',
                backgroundColor: '#f0ad4e',
                border: '1px solid #eea236',
                borderRadius: '2px',
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              Retry ({this.maxRetries - this.state.retryCount} left)
            </button>
          ) : (
            <div style={{ marginTop: '5px', fontSize: '10px' }}>
              Maximum retries exceeded. Please restart the app or contact support.
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}