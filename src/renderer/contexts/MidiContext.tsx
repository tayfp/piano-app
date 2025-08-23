/**
 * MidiContext - Single source of truth for MIDI state
 * 
 * Solves the multiple useMidi instance problem by providing
 * a shared context that all components can access.
 */

import React, { createContext, useContext, useEffect, useRef, ReactNode, useCallback, useMemo } from 'react';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { useMidi } from '../hooks/useMidi';
import type { MidiDevice, MidiEvent } from '../types/midi';
import { getActiveDeviceId } from '../stores/midiStore';

interface MidiContextType {
  // State
  devices: MidiDevice[];
  status: string;
  isConnected: boolean;
  error: string | null;
  pressedKeys: Set<number>;
  
  // Actions
  start: () => Promise<void>;
  stop: () => void;
  
  // Event subscription for practice mode
  subscribeMidiEvents: (callback: (event: MidiEvent) => void) => () => void;
}

// Create context with undefined default (will error if used outside provider)
const MidiContext = createContext<MidiContextType | undefined>(undefined);

interface MidiProviderProps {
  children: ReactNode;
  onMidiEvent?: (event: MidiEvent) => void;
  onKeysChanged?: (keys: number[]) => void;
}

/**
 * MidiProvider - Provides unified MIDI state to all child components
 */
export const MidiProvider: React.FC<MidiProviderProps> = ({ 
  children, 
  onMidiEvent,
  onKeysChanged 
}) => {
  // Enhanced MIDI event handler that forwards to subscribers
  const enhancedMidiEventHandler = useCallback((event: MidiEvent) => {
    // Call the original handler
    onMidiEvent?.(event);
    
    // Forward to all subscribers (practice mode, etc.)
    midiEventSubscribersRef.current.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        perfLogger.error('MidiContext: Error in MIDI event subscriber:', error instanceof Error ? error : new Error(String(error)));
      }
    });
  }, [onMidiEvent]);
  
  // Single instance of useMidi for the entire app
  const midi = useMidi({
    onMidiEvent: enhancedMidiEventHandler,
    onKeysChanged,
    autoStart: false // We'll manually start after mount
  });
  
  // Track MIDI event subscribers for practice mode
  const midiEventSubscribersRef = useRef<Set<(event: MidiEvent) => void>>(new Set());
  
  // Initialize MIDI system once when provider mounts
  useEffect(() => {
    const initializeMidi = async () => {
      try {
        perfLogger.debug('MidiProvider: Initializing MIDI system...');
        await midi.start();
        
        // Validate persisted active device
        const persistedDeviceId = getActiveDeviceId();
        if (persistedDeviceId && midi.devices.length > 0) {
          const deviceExists = midi.devices.some(d => d.id === persistedDeviceId);
          if (!deviceExists) {
            perfLogger.warn('MidiProvider: Persisted device no longer exists, clearing...');
            // The store will handle clearing via setActiveDevice(null)
          }
        }
      } catch (err) {
        perfLogger.error('MidiProvider: Failed to initialize MIDI:', err instanceof Error ? err : new Error(String(err)));
      }
    };
    
    initializeMidi();
    
    // Cleanup on unmount
    return () => {
      perfLogger.debug('MidiProvider: Cleaning up...');
      midi.stop();
    };
  }, []); // Empty deps - only run once on mount
  
  // REMOVED: Duplicate onKeysChanged call - useMidi already handles this in keyStateCallback
  // The pressedKeys tracking was causing duplicate logs since useMidi.ts line 121 
  // already calls onKeysChanged when keys change
  
  // Subscribe to MIDI events (for practice mode)
  const subscribeMidiEvents = useCallback((callback: (event: MidiEvent) => void) => {
    perfLogger.debug('[MidiContext] Adding MIDI event subscriber');
    midiEventSubscribersRef.current.add(callback);
    
    // Return unsubscribe function
    return () => {
      perfLogger.debug('[MidiContext] Removing MIDI event subscriber');
      midiEventSubscribersRef.current.delete(callback);
    };
  }, []);
  
  // Enhanced context value with subscription capability
  const contextValue = useMemo(() => ({
    ...midi,
    subscribeMidiEvents
  }), [midi, subscribeMidiEvents]);
  
  return (
    <MidiContext.Provider value={contextValue}>
      {children}
    </MidiContext.Provider>
  );
};

/**
 * useMidiContext - Hook to access MIDI context
 * Throws error if used outside of MidiProvider
 */
export const useMidiContext = (): MidiContextType => {
  const context = useContext(MidiContext);
  
  if (context === undefined) {
    throw new Error(
      'useMidiContext must be used within a MidiProvider. ' +
      'Make sure your component is wrapped with <MidiProvider>'
    );
  }
  
  return context;
};