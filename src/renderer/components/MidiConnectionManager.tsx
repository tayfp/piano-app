/**
 * MIDI Connection Manager Component
 * 
 * Orchestrates MIDI connection attempts with platform-aware error handling,
 * graceful degradation to virtual piano, and comprehensive user guidance.
 * 
 * This component demonstrates the complete solution to the NotAllowedError issue.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useMidiDevices } from '@/renderer/hooks/useMidiDevices';
import { MidiConnectionError } from './MidiConnectionError';
import { VirtualPiano } from './VirtualPiano';
import { platformService } from '@/renderer/services/PlatformDetection';

interface MidiConnectionManagerProps {
  onMidiEvent?: (event: { type: 'noteOn' | 'noteOff'; note: number; velocity: number }) => void;
  className?: string;
}

type ConnectionState = 
  | 'initial'           // Not attempted connection
  | 'connecting'        // Connection in progress
  | 'connected'         // Successfully connected to hardware MIDI
  | 'failed'            // Connection failed, showing error
  | 'virtual'           // Using virtual piano fallback
  | 'platform-limited'; // Platform doesn't support MIDI, using virtual

export const MidiConnectionManager: React.FC<MidiConnectionManagerProps> = ({
  onMidiEvent,
  className = ''
}) => {
  const {
    devices,
    isConnected,
    error,
    initializeMidiWithGesture,
    platformCapable,
    errorContext
  } = useMidiDevices();

  const [connectionState, setConnectionState] = useState<ConnectionState>('initial');
  const [platformInfo, setPlatformInfo] = useState<string>('');

  // Initialize platform detection
  useEffect(() => {
    const initializePlatformDetection = async () => {
      const environment = platformService.detectEnvironment();
      const capability = await platformService.checkMidiCapability();
      
      const info = `${environment.os}${environment.isWSL2 ? ' (WSL2)' : ''}${environment.isDevelopment ? ' (Dev)' : ''}`;
      setPlatformInfo(info);

      // If platform definitely cannot support MIDI, go straight to virtual mode
      if (!capability.webMidiSupported && !capability.nativeMidiAvailable) {
        setConnectionState('platform-limited');
      }
    };

    initializePlatformDetection();
  }, []);

  // Update connection state based on MIDI hook state
  useEffect(() => {
    if (isConnected) {
      setConnectionState('connected');
    } else if (error && connectionState === 'connecting') {
      setConnectionState('failed');
    }
  }, [isConnected, error, connectionState]);

  // Attempt MIDI connection
  const handleConnectMidi = useCallback(async () => {
    setConnectionState('connecting');
    
    try {
      await initializeMidiWithGesture();
      
      // Connection successful - state will be updated by useEffect
    } catch (err) {
      // Error handled by useMidiDevices hook and shown via MidiConnectionError
      // State will be updated to 'failed' by useEffect
    }
  }, [initializeMidiWithGesture]);

  // Retry connection
  const handleRetry = useCallback(() => {
    setConnectionState('initial');
    // Reset any error state
    setTimeout(() => {
      handleConnectMidi();
    }, 100);
  }, [handleConnectMidi]);

  // Switch to virtual piano
  const handleUseVirtual = useCallback(() => {
    setConnectionState('virtual');
  }, []);

  // Handle virtual piano events
  const handleVirtualMidiEvent = useCallback((note: number, velocity: number, type: 'noteOn' | 'noteOff') => {
    onMidiEvent?.({
      type,
      note,
      velocity
    });
  }, [onMidiEvent]);

  // Render connection status and appropriate UI
  const renderContent = () => {
    switch (connectionState) {
      case 'initial':
        return (
          <div className="midi-connection-initial">
            <div className="connection-card">
              <h3>Connect Your MIDI Piano</h3>
              <p>Connect your USB MIDI keyboard or controller to get started with hardware piano input.</p>
              
              <div className="connection-options">
                <button 
                  className="connect-button primary"
                  onClick={handleConnectMidi}
                >
                  🎹 Connect MIDI Device
                </button>
                
                <button 
                  className="connect-button secondary"
                  onClick={handleUseVirtual}
                >
                  💻 Use Virtual Piano
                </button>
              </div>
              
              <div className="platform-info">
                <small>Platform: {platformInfo}</small>
              </div>
            </div>
          </div>
        );

      case 'connecting':
        return (
          <div className="midi-connection-connecting">
            <div className="connection-card">
              <div className="loading-spinner">🔄</div>
              <h3>Connecting to MIDI devices...</h3>
              <p>Please wait while we scan for available MIDI devices.</p>
              
              <button 
                className="connect-button secondary"
                onClick={handleUseVirtual}
              >
                Skip to Virtual Piano
              </button>
            </div>
          </div>
        );

      case 'connected':
        return (
          <div className="midi-connection-success">
            <div className="success-card">
              <span className="success-icon">✅</span>
              <h3>MIDI Connected Successfully!</h3>
              <p>
                Connected to {devices.length} device{devices.length !== 1 ? 's' : ''}:
                {devices.map(device => (
                  <span key={device.id} className="device-name"> {device.name}</span>
                ))}
              </p>
              <p className="success-note">Your piano is ready for practice!</p>
            </div>
          </div>
        );

      case 'failed':
        return (
          <div className="midi-connection-failed">
            {error && errorContext && (
              <MidiConnectionError
                error={{
                  type: errorContext.type,
                  message: errorContext.message
                }}
                onRetry={handleRetry}
                onUseFallback={handleUseVirtual}
              />
            )}
          </div>
        );

      case 'platform-limited':
        return (
          <div className="midi-platform-limited">
            <div className="info-card">
              <span className="info-icon">ℹ️</span>
              <h3>Using Virtual Piano</h3>
              <p>
                Your platform ({platformInfo}) has limited MIDI support. 
                The virtual piano provides the complete learning experience with all features.
              </p>
            </div>
            
            <VirtualPiano
              onNotePlay={(note, velocity) => handleVirtualMidiEvent(note, velocity, 'noteOn')}
              onNoteStop={(note) => handleVirtualMidiEvent(note, 0, 'noteOff')}
              enableVelocitySensitivity={true}
              showLabels={true}
            />
          </div>
        );

      case 'virtual':
        return (
          <div className="midi-virtual-mode">
            <div className="virtual-mode-header">
              <h3>Virtual Piano Mode</h3>
              <p>Use your computer keyboard or click the keys below to play.</p>
              
              <button 
                className="reconnect-button"
                onClick={() => setConnectionState('initial')}
              >
                Try MIDI Connection Again
              </button>
            </div>
            
            <VirtualPiano
              onNotePlay={(note, velocity) => handleVirtualMidiEvent(note, velocity, 'noteOn')}
              onNoteStop={(note) => handleVirtualMidiEvent(note, 0, 'noteOff')}
              enableVelocitySensitivity={true}
              showLabels={true}
            />
          </div>
        );

      default:
        return <div>Unknown connection state</div>;
    }
  };

  return (
    <div className={`midi-connection-manager ${className}`}>
      {renderContent()}

      <style jsx>{`
        .midi-connection-manager {
          max-width: 900px;
          margin: 0 auto;
          padding: 20px;
        }

        .connection-card,
        .success-card,
        .info-card {
          background: white;
          border-radius: 12px;
          padding: 32px;
          text-align: center;
          box-shadow: 0 4px 20px rgba(0,0,0,0.1);
          border: 1px solid #e9ecef;
        }

        .connection-card h3,
        .success-card h3,
        .info-card h3 {
          margin: 0 0 16px 0;
          color: #212529;
          font-size: 24px;
        }

        .connection-card p,
        .success-card p,
        .info-card p {
          color: #495057;
          line-height: 1.6;
          margin-bottom: 24px;
        }

        .connection-options {
          display: flex;
          gap: 16px;
          justify-content: center;
          margin-bottom: 20px;
        }

        .connect-button {
          padding: 12px 24px;
          border-radius: 8px;
          border: none;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .connect-button.primary {
          background: #007bff;
          color: white;
        }

        .connect-button.primary:hover {
          background: #0056b3;
          transform: translateY(-1px);
        }

        .connect-button.secondary {
          background: #6c757d;
          color: white;
        }

        .connect-button.secondary:hover {
          background: #545b62;
          transform: translateY(-1px);
        }

        .platform-info {
          color: #6c757d;
          margin-top: 16px;
        }

        .loading-spinner {
          font-size: 48px;
          animation: spin 1s linear infinite;
          margin-bottom: 16px;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .success-icon,
        .info-icon {
          font-size: 48px;
          display: block;
          margin-bottom: 16px;
        }

        .device-name {
          font-weight: 600;
          color: #007bff;
        }

        .success-note {
          font-weight: 600;
          color: #28a745;
          margin-top: 16px;
        }

        .virtual-mode-header {
          text-align: center;
          margin-bottom: 32px;
          padding: 24px;
          background: #f8f9fa;
          border-radius: 8px;
        }

        .virtual-mode-header h3 {
          margin: 0 0 8px 0;
          color: #212529;
        }

        .virtual-mode-header p {
          color: #495057;
          margin: 0 0 16px 0;
        }

        .reconnect-button {
          padding: 8px 16px;
          background: #17a2b8;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }

        .reconnect-button:hover {
          background: #117a8b;
        }

        @media (max-width: 768px) {
          .connection-options {
            flex-direction: column;
            align-items: center;
          }
          
          .connect-button {
            min-width: 200px;
          }
        }
      `}</style>
    </div>
  );
};