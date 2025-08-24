/**
 * useMidiDevices Hook - Device selection management
 * 
 * Implements Active Device pattern - manages which MIDI device
 * is actively selected for event processing
 */

import { useCallback, useEffect, useState } from 'react';
import type { MidiDevice } from '@/renderer/types/midi';
import { useMidiContext } from '@/renderer/contexts/MidiContext';
import { useMidiStore } from '@/renderer/stores/midiStore';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { platformService } from '@/renderer/services/PlatformDetection';

interface UseMidiDevicesReturn {
  devices: MidiDevice[];
  activeDevice: MidiDevice | null;
  selectDevice: (deviceId: string) => void;
  isConnected: boolean;
  error: string | null;
  initializeMidi: () => Promise<void>;
  initializeMidiWithGesture: () => Promise<void>;
  platformCapable: boolean;
  errorContext?: {
    type: string;
    message: string;
    platformSpecific: boolean;
  };
}

export const useMidiDevices = (): UseMidiDevicesReturn => {
  const { devices, status, error, start, initializeWithAccess } = useMidiContext();
  const { activeDeviceId, setActiveDevice } = useMidiStore();
  const [platformCapable, setPlatformCapable] = useState(true);
  const [errorContext, setErrorContext] = useState<{
    type: string;
    message: string;
    platformSpecific: boolean;
  } | undefined>(undefined);
  
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
  
  // New gesture-preserving initialization method
  const initializeMidiWithGesture = useCallback(async () => {
    console.log("🎹 [HOOK] initializeMidiWithGesture() called");
    console.log("🎹 [HOOK] navigator.requestMIDIAccess available:", !!navigator.requestMIDIAccess);
    
    try {
      // Call navigator.requestMIDIAccess directly in gesture context
      console.log("🎹 [HOOK] About to call navigator.requestMIDIAccess({ sysex: false })");
      console.log("🎹 [HOOK] Timestamp before call:", Date.now());
      
      const midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      
      console.log("✅ [HOOK] navigator.requestMIDIAccess succeeded!");
      console.log("🎹 [HOOK] MIDI inputs:", midiAccess.inputs.size);
      console.log("🎹 [HOOK] MIDI outputs:", midiAccess.outputs.size);
      
      // Pass pre-granted access to context for initialization  
      if (initializeWithAccess) {
        console.log("🎹 [HOOK] Calling initializeWithAccess()...");
        await initializeWithAccess(midiAccess);
        console.log("✅ [HOOK] initializeWithAccess() succeeded");
        setErrorContext(undefined); // Clear any previous errors
        setPlatformCapable(true);
      } else {
        console.error("❌ [HOOK] initializeWithAccess method not available in context");
        // Handle missing method gracefully instead of throwing
        const contextualError = {
          type: 'ConfigurationError',
          message: 'MIDI initialization method not available in context',
          platformSpecific: false
        };
        setErrorContext(contextualError);
        setPlatformCapable(false);
        perfLogger.error('initializeWithAccess method not available in context');
      }
    } catch (err) {
      console.error("❌ [HOOK] navigator.requestMIDIAccess failed:", err);
      console.error("❌ [HOOK] Error name:", err.name);
      console.error("❌ [HOOK] Error message:", err.message);
      console.error("❌ [HOOK] Full error object:", err);
      
      // Enhanced error context for platform-specific issues
      const error = err instanceof Error ? err : new Error(String(err));
      const capability = await platformService.checkMidiCapability();
      
      console.log("🎹 [HOOK] Platform capability check:", capability);
      
      const contextualError = {
        type: error.name || 'MidiError',
        message: error.message,
        platformSpecific: !capability.webMidiSupported
      };
      
      setErrorContext(contextualError);
      setPlatformCapable(capability.webMidiSupported);
      
      perfLogger.error('Failed to initialize MIDI with gesture:', {
        error,
        platform: platformService.detectEnvironment(),
        capability
      });
      
      // DO NOT throw - handle gracefully instead
      // Application should continue with virtual piano mode
    }
  }, []);
  
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
    initializeMidi,
    initializeMidiWithGesture,
    platformCapable,
    errorContext
  };
};