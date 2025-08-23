import React, { Component, ErrorInfo, ReactNode } from 'react';
import { perfLogger } from '@/renderer/utils/performance-logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details for debugging
    perfLogger.error('GlobalErrorBoundary caught error:', error);
    perfLogger.error('Error info:', errorInfo);
    perfLogger.error('Component stack:', errorInfo.componentStack);
    
    // Update state with error details
    this.setState({
      error,
      errorInfo
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          padding: '20px',
          backgroundColor: '#f5f5f5',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          <h1 style={{ color: '#e53e3e', marginBottom: '20px' }}>
            Oops! Something went wrong
          </h1>
          
          <div style={{
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '8px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
            maxWidth: '600px',
            width: '100%'
          }}>
            <h2 style={{ marginBottom: '10px', color: '#333' }}>Error Details</h2>
            <p style={{ color: '#666', marginBottom: '10px' }}>
              {this.state.error?.message || 'Unknown error'}
            </p>
            
            {process.env.NODE_ENV === 'development' && (
              <details style={{ marginTop: '20px' }}>
                <summary style={{ cursor: 'pointer', color: '#4299e1' }}>
                  Technical Details (Development Only)
                </summary>
                <pre style={{
                  backgroundColor: '#f7fafc',
                  padding: '10px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  overflow: 'auto',
                  marginTop: '10px'
                }}>
                  {this.state.error?.stack}
                </pre>
              </details>
            )}
            
            <button
              onClick={this.handleReset}
              style={{
                marginTop: '20px',
                padding: '10px 20px',
                backgroundColor: '#4299e1',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '16px'
              }}
            >
              Reload Application
            </button>
          </div>
          
          <p style={{ marginTop: '20px', color: '#666', fontSize: '14px' }}>
            If this problem persists, please check the console for more details.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}