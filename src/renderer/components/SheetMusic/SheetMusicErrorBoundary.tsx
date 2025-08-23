import React, { Component, ReactNode } from 'react';
import { perfLogger } from '@/renderer/utils/performance-logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class SheetMusicErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    perfLogger.error('SheetMusicErrorBoundary caught error:', error);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    perfLogger.error(`SheetMusic Error: ${error.message} - Component Stack: ${errorInfo.componentStack}`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="sheet-music-error-boundary">
          <h2>Unable to display sheet music</h2>
          <p>Something went wrong while rendering the score.</p>
          {this.state.error && (
            <details>
              <summary>Error details</summary>
              <pre>{this.state.error.toString()}</pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}