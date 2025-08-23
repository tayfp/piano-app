/**
 * MidiDeviceSelector Component
 * 
 * Simple dropdown for MIDI device selection
 * Version Basic UI only
 * Version Will integrate with global state
 */

import React from 'react';
import { useMidiDevices } from '@/renderer/hooks/useMidiDevices';
import { useMidiStore } from '@/renderer/stores/midiStore';
import './MidiDeviceSelector.css';

export const MidiDeviceSelector: React.FC = () => {
  const { devices, activeDevice, selectDevice, error, initializeMidi } = useMidiDevices();
  const { status } = useMidiStore();
  
  // Error state - highest priority
  if (error) {
    return (
      <div className="midi-error">
        <span> MIDI Error: {error}</span>
        <button 
          onClick={() => window.location.reload()} 
          className="retry-button"
          title="Restart application to retry MIDI initialization"
        >
          Retry
        </button>
      </div>
    );
  }
  
  // Not initialized - show button to start MIDI
  if (status === 'not_initialized') {
    return (
      <div className="midi-not-initialized">
        <button 
          onClick={initializeMidi} 
          className="midi-initialize-button"
          title="Click to connect to MIDI devices"
        >
           Connect MIDI Device
        </button>
      </div>
    );
  }
  
  // Loading state
  if (status === 'initializing') {
    return (
      <div className="midi-status">
         Starting MIDI system...
      </div>
    );
  }
  
  // MIDI system ready - show device selector or no devices message
  if (status === 'ready') {
    if (!devices || devices.length === 0) {
      return (
        <div className="midi-no-devices">
          <span> No MIDI devices detected</span>
          <button 
            onClick={() => alert('Virtual keyboard coming soon!')} 
            className="virtual-keyboard-button"
          >
            Use Virtual Keyboard
          </button>
        </div>
      );
    }
    
    // Devices available - show selector or active device
    if (activeDevice) {
      return (
        <div className="midi-connected">
          <span> Active: {activeDevice.name}</span>
          <button 
            onClick={() => selectDevice('')} 
            className="disconnect-button"
            title="Select a different device"
          >
            Change Device
          </button>
        </div>
      );
    } else {
      return (
        <div className="midi-device-selector">
          <label htmlFor="midi-device"> Select MIDI Device:</label>
          <select 
            id="midi-device"
            value=""
            onChange={(e) => selectDevice(e.target.value)}
            aria-label="Select MIDI device"
          >
            <option value="">Choose your piano/keyboard...</option>
            {devices?.map(device => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </div>
      );
    }
  }
  
  // Fallback for any other status
  return (
    <div className="midi-status">
       MIDI Status: {status}
    </div>
  );
};