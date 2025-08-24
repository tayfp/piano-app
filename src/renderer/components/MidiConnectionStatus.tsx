/**
 * MIDI Connection Status Component
 * 
 * Provides clear visual feedback on MIDI connectivity status
 * and user-actionable error recovery options.
 */

import React from 'react';
import { useMidiContext } from '../contexts/MidiContext';
import { perfLogger } from '../utils/performance-logger';

interface MidiConnectionStatusProps {
  className?: string;
  showDeviceCount?: boolean;
}

export const MidiConnectionStatus: React.FC<MidiConnectionStatusProps> = ({
  className = '',
  showDeviceCount = true
}) => {
  const { devices, status, isConnected, error, requestMidiAccess } = useMidiContext();

  const handleRequestAccess = async () => {
    try {
      await requestMidiAccess();
      perfLogger.debug('MIDI access requested via user interaction');
    } catch (err) {
      perfLogger.error('Failed to request MIDI access:', err instanceof Error ? err : new Error(String(err)));
    }
  };

  // Connection status styling
  const getStatusColor = () => {
    if (error) return 'text-red-500';
    if (isConnected && devices.length > 0) return 'text-green-500';
    if (status === 'connecting') return 'text-yellow-500';
    return 'text-gray-500';
  };

  const getStatusText = () => {
    if (error) return 'Connection Error';
    if (isConnected && devices.length > 0) {
      return showDeviceCount ? `Connected (${devices.length} device${devices.length === 1 ? '' : 's'})` : 'Connected';
    }
    if (status === 'connecting') return 'Connecting...';
    if (status === 'disconnected' && devices.length === 0) return 'No MIDI Devices';
    return 'Not Connected';
  };

  return (
    <div className={`midi-connection-status ${className}`}>
      <div className={`status-indicator ${getStatusColor()}`}>
        <span className="status-dot inline-block w-2 h-2 rounded-full bg-current mr-2" />
        <span className="status-text">{getStatusText()}</span>
      </div>
      
      {error && (
        <div className="error-recovery mt-2">
          <p className="text-sm text-red-600 mb-2">{error}</p>
          {error.includes('click') || error.includes('user') ? (
            <button
              onClick={handleRequestAccess}
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Enable MIDI Access
            </button>
          ) : error.includes('CSP') || error.includes('Security') ? (
            <p className="text-xs text-gray-600">
              Please restart the application or contact support if this persists.
            </p>
          ) : (
            <button
              onClick={handleRequestAccess}
              className="px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
            >
              Retry Connection
            </button>
          )}
        </div>
      )}
      
      {!error && !isConnected && (
        <button
          onClick={handleRequestAccess}
          className="mt-2 px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Connect MIDI Device
        </button>
      )}
    </div>
  );
};