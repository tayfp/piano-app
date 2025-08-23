/**
 * MIDI Error Boundary - Graceful degradation when MIDI fails
 * 
 * Version Production Optimization
 * Catches MIDI-related errors and provides fallback UI
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { perfLogger } from '@/renderer/utils/performance-logger';
import './MidiErrorBoundary.css';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class MidiErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    perfLogger.error(`MIDI Error: ${error.message} - Component Stack: ${errorInfo.componentStack}`, error);
    
    // Could send to error tracking service in the future
    // Note: window.electronAPI.logError would be implemented in production
    // when error tracking is added to the electron API
  }
  
  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };
  
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="midi-error-fallback">
          <div className="error-icon"></div>
          <h3>MIDI functionality is currently unavailable</h3>
          <p>You can still use the on-screen piano keyboard.</p>
          <div className="error-details">
            <details>
              <summary>Technical details</summary>
              <pre>{this.state.error?.message}</pre>
            </details>
          </div>
          <button 
            className="retry-button"
            onClick={this.handleReset}
          >
            Try Again
          </button>
        </div>
      );
    }
    
    return this.props.children;
  }
}