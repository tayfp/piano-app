/**
 * useMidiDevices Hook - Device selection management
 * 
 * Implements Active Device pattern - manages which MIDI device
 * is actively selected for event processing
 */

import { useCallback, useEffect } from 'react';
import type { MidiDevice } from '@/renderer/types/midi';
import { useMidiContext } from '@/renderer/contexts/MidiContext';
import { useMidiStore } from '@/renderer/stores/midiStore';
import { perfLogger } from '@/renderer/utils/performance-logger';

interface UseMidiDevicesReturn {
  devices: MidiDevice[];
  activeDevice: MidiDevice | null;
  selectDevice: (deviceId: string) => void;
  isConnected: boolean;
  error: string | null;
  initializeMidi: () => Promise<void>;
}

export const useMidiDevices = (): UseMidiDevicesReturn => {
  const { devices, status, error, start } = useMidiContext();
  const { activeDeviceId, setActiveDevice } = useMidiStore();
  
  const activeDevice = devices.find(d => d.id === activeDeviceId) || null;
  const isConnected = status === 'ready' && activeDevice !== null;
  
  const selectDevice = useCallback((deviceId: string) => {
    // Set the active device immediately - no connection process
    setActiveDevice(deviceId || null);
  }, [setActiveDevice]);
  
  const initializeMidi = useCallback(async () => {
    try {
      await start();
    } catch (err) {
      perfLogger.error('Failed to initialize MIDI:', err);
    }
  }, [start]);
  
  // Auto-select device when only one is available
  useEffect(() => {
    // Only auto-select if:
    // 1. No device is currently selected
    // 2. Exactly one device is available
    // 3. System is ready
    if (!activeDeviceId && devices.length === 1 && status === 'ready') {
      perfLogger.debug('Auto-selecting single MIDI device', { deviceName: devices[0].name });
      selectDevice(devices[0].id);
    }
  }, [devices, activeDeviceId, status, selectDevice]);
  
  return {
    devices,
    activeDevice,
    selectDevice,
    isConnected,
    error,
    initializeMidi
  };
};