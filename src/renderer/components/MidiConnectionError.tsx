/**
 * Context-Aware MIDI Connection Error Component
 * 
 * Provides helpful error messages and setup guidance based on
 * the user's platform and specific error type.
 */

import React, { useEffect, useState } from 'react';
import { platformService, type PlatformEnvironment, type MidiCapability, type SetupInstruction } from '../services/PlatformDetection';

interface MidiError {
  type: string;
  message: string;
  code?: string;
}

interface MidiConnectionErrorProps {
  error: MidiError;
  onRetry?: () => void;
  onUseFallback?: () => void;
  className?: string;
}

interface ErrorContext {
  title: string;
  description: string;
  actions: Array<{
    label: string;
    action: () => void;
    primary?: boolean;
  }>;
  instructions?: SetupInstruction[];
  severity: 'error' | 'warning' | 'info';
}

export const MidiConnectionError: React.FC<MidiConnectionErrorProps> = ({
  error,
  onRetry,
  onUseFallback,
  className = ''
}) => {
  const [platform, setPlatform] = useState<PlatformEnvironment | null>(null);
  const [capability, setCapability] = useState<MidiCapability | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    const loadPlatformInfo = async () => {
      const platformInfo = platformService.detectEnvironment();
      const capabilityInfo = await platformService.checkMidiCapability();
      
      setPlatform(platformInfo);
      setCapability(capabilityInfo);
    };

    loadPlatformInfo();
  }, []);

  const getErrorContext = (): ErrorContext => {
    if (!platform || !capability) {
      return getDefaultErrorContext();
    }

    // WSL2 specific handling
    if (platform.isWSL2 && error.type === 'NotAllowedError') {
      return {
        title: 'MIDI Hardware Not Available in WSL2',
        description: 'Your development environment (WSL2) cannot access Windows USB MIDI devices directly. This is a platform limitation, not an app issue.',
        severity: 'info',
        actions: [
          {
            label: 'Continue with Virtual Piano',
            action: () => onUseFallback?.(),
            primary: true
          },
          {
            label: 'Show Setup Guide',
            action: () => setShowInstructions(true)
          }
        ],
        instructions: platformService.getRecommendedSetup()
      };
    }

    // Linux specific handling
    if (platform.os === 'linux' && !platform.isWSL2) {
      return {
        title: 'MIDI Permission or Setup Required',
        description: 'Linux systems require additional setup for MIDI device access. This usually involves user permissions and ALSA configuration.',
        severity: 'warning',
        actions: [
          {
            label: 'Show Linux Setup Guide',
            action: () => setShowInstructions(true),
            primary: true
          },
          {
            label: 'Try Again',
            action: () => onRetry?.()
          },
          {
            label: 'Use Virtual Piano',
            action: () => onUseFallback?.()
          }
        ],
        instructions: platformService.getRecommendedSetup()
      };
    }

    // Windows/macOS permission denied
    if ((platform.os === 'windows' || platform.os === 'macos') && error.type === 'NotAllowedError') {
      return {
        title: 'MIDI Permission Denied',
        description: 'Browser denied access to MIDI devices. This might be due to browser settings or no MIDI devices being connected.',
        severity: 'warning',
        actions: [
          {
            label: 'Try Again',
            action: () => onRetry?.(),
            primary: true
          },
          {
            label: 'Check Setup',
            action: () => setShowInstructions(true)
          },
          {
            label: 'Continue Without Hardware',
            action: () => onUseFallback?.()
          }
        ],
        instructions: platformService.getRecommendedSetup()
      };
    }

    // General timeout or connection issues
    if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      return {
        title: 'MIDI Connection Timeout',
        description: 'Connection to MIDI devices timed out. This might indicate hardware or driver issues.',
        severity: 'error',
        actions: [
          {
            label: 'Retry Connection',
            action: () => onRetry?.(),
            primary: true
          },
          {
            label: 'Continue with Virtual Piano',
            action: () => onUseFallback?.()
          }
        ]
      };
    }

    return getDefaultErrorContext();
  };

  const getDefaultErrorContext = (): ErrorContext => ({
    title: 'MIDI Connection Failed',
    description: `Unable to connect to MIDI devices: ${error.message}`,
    severity: 'error',
    actions: [
      {
        label: 'Try Again',
        action: () => onRetry?.(),
        primary: true
      },
      {
        label: 'Continue with Virtual Piano',
        action: () => onUseFallback?.()
      }
    ]
  });

  const context = getErrorContext();

  return (
    <div className={`midi-connection-error ${className}`}>
      <div className={`error-card severity-${context.severity}`}>
        <div className="error-header">
          <div className="error-icon">
            {context.severity === 'error' && <span>❌</span>}
            {context.severity === 'warning' && <span>⚠️</span>}
            {context.severity === 'info' && <span>ℹ️</span>}
          </div>
          <h3 className="error-title">{context.title}</h3>
        </div>

        <div className="error-content">
          <p className="error-description">{context.description}</p>

          {platform && (
            <div className="platform-info">
              <small>
                Platform: {platform.os}
                {platform.isWSL2 && ' (WSL2)'}
                {platform.isDevelopment && ' (Development)'}
              </small>
            </div>
          )}

          <div className="error-actions">
            {context.actions.map((action, index) => (
              <button
                key={index}
                className={`error-action ${action.primary ? 'primary' : 'secondary'}`}
                onClick={action.action}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showInstructions && context.instructions && (
        <div className="setup-instructions">
          <div className="instructions-header">
            <h4>Setup Instructions</h4>
            <button 
              className="close-instructions"
              onClick={() => setShowInstructions(false)}
              aria-label="Close instructions"
            >
              ✕
            </button>
          </div>

          <div className="instructions-content">
            {context.instructions.map((instruction, index) => (
              <div 
                key={index} 
                className={`instruction-item difficulty-${instruction.difficulty} ${instruction.isOptional ? 'optional' : 'required'}`}
              >
                <div className="instruction-header">
                  <h5>{instruction.title}</h5>
                  <div className="instruction-badges">
                    {instruction.isOptional && (
                      <span className="badge optional">Optional</span>
                    )}
                    <span className={`badge difficulty ${instruction.difficulty}`}>
                      {instruction.difficulty}
                    </span>
                  </div>
                </div>
                
                <p>{instruction.description}</p>
                
                {instruction.commands && (
                  <div className="command-list">
                    {instruction.commands.map((command, cmdIndex) => (
                      <code key={cmdIndex} className="command">
                        {command}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <style jsx>{`
        .midi-connection-error {
          max-width: 600px;
          margin: 0 auto;
        }

        .error-card {
          background: #f8f9fa;
          border-radius: 8px;
          padding: 24px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .severity-error { border-left: 4px solid #dc3545; }
        .severity-warning { border-left: 4px solid #ffc107; }
        .severity-info { border-left: 4px solid #17a2b8; }

        .error-header {
          display: flex;
          align-items: center;
          margin-bottom: 16px;
        }

        .error-icon {
          font-size: 24px;
          margin-right: 12px;
        }

        .error-title {
          margin: 0;
          color: #212529;
          font-size: 20px;
        }

        .error-description {
          color: #495057;
          line-height: 1.5;
          margin-bottom: 16px;
        }

        .platform-info {
          color: #6c757d;
          font-style: italic;
          margin-bottom: 16px;
        }

        .error-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }

        .error-action {
          padding: 10px 20px;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          font-weight: 500;
          transition: all 0.2s;
        }

        .error-action.primary {
          background: #007bff;
          color: white;
        }

        .error-action.primary:hover {
          background: #0056b3;
        }

        .error-action.secondary {
          background: #6c757d;
          color: white;
        }

        .error-action.secondary:hover {
          background: #545b62;
        }

        .setup-instructions {
          margin-top: 20px;
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .instructions-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px;
          border-bottom: 1px solid #e9ecef;
        }

        .instructions-header h4 {
          margin: 0;
          color: #212529;
        }

        .close-instructions {
          background: none;
          border: none;
          font-size: 18px;
          cursor: pointer;
          color: #6c757d;
          padding: 4px;
        }

        .instructions-content {
          padding: 20px;
        }

        .instruction-item {
          margin-bottom: 24px;
          padding: 16px;
          border-radius: 6px;
          background: #f8f9fa;
        }

        .instruction-item.required {
          border-left: 3px solid #007bff;
        }

        .instruction-item.optional {
          border-left: 3px solid #6c757d;
        }

        .instruction-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 8px;
        }

        .instruction-header h5 {
          margin: 0;
          color: #212529;
        }

        .instruction-badges {
          display: flex;
          gap: 6px;
        }

        .badge {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
        }

        .badge.optional {
          background: #6c757d;
          color: white;
        }

        .badge.difficulty.easy {
          background: #28a745;
          color: white;
        }

        .badge.difficulty.medium {
          background: #ffc107;
          color: #212529;
        }

        .badge.difficulty.advanced {
          background: #dc3545;
          color: white;
        }

        .command-list {
          margin-top: 12px;
        }

        .command {
          display: block;
          background: #e9ecef;
          padding: 8px 12px;
          border-radius: 4px;
          font-family: 'Monaco', 'Consolas', monospace;
          font-size: 14px;
          margin: 4px 0;
        }
      `}</style>
    </div>
  );
};