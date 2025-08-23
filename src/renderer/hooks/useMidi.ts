/**
 * useMidi Hook - React interface for MIDI functionality
 * 
 * Refactored to use Singleton MidiService to eliminate service instance conflicts.
 * Now acts as a consumer of the centralized MIDI service instead of creating its own.
 * 
 * Features:
 * - Unified MIDI service prevents dual hook conflicts
 * - Velocity curve transformations
 * - Performance tracking
 * - User preferences (transpose, etc.)
 * - Backward compatible API
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { midiService, type MidiEvent as SingletonMidiEvent, type MidiDevice as SingletonMidiDevice } from '../services/MidiService';
import type { MidiEvent, MidiDevice, NoteOnEvent, NoteOffEvent } from '../types/midi';
import { useMidiStore, applyVelocityCurve, getActiveDeviceId } from '../stores/midiStore';
import { logMidiLatency, perfLogger } from '@/renderer/utils/performance-logger';

interface UseMidiOptions {
  onMidiEvent?: (event: MidiEvent) => void;
  onKeysChanged?: (keys: number[]) => void;
  autoStart?: boolean;
}

interface UseMidiReturn {
  devices: MidiDevice[];
  status: string;
  isConnected: boolean;
  error: string | null;
  pressedKeys: Set<number>;
  start: () => Promise<void>;
  stop: () => void;
}

// Type adapters to convert between singleton and legacy types
const adaptMidiEvent = (singletonEvent: SingletonMidiEvent): MidiEvent & { deviceId?: string } => ({
  type: singletonEvent.type,
  note: singletonEvent.note,
  velocity: singletonEvent.velocity,
  timestamp: singletonEvent.timestamp,
  channel: 0, // Default channel for compatibility
  deviceId: singletonEvent.deviceId // Pass through device ID for filtering
});

const adaptMidiDevice = (singletonDevice: SingletonMidiDevice): MidiDevice => ({
  id: singletonDevice.id,
  name: singletonDevice.name,
  manufacturer: singletonDevice.manufacturer || '',
  type: 'input', // All MIDI devices from singleton service are inputs
  state: singletonDevice.state
});

export const useMidi = (options: UseMidiOptions = {}): UseMidiReturn => {
  const { onMidiEvent, onKeysChanged, autoStart = false } = options;
  
  // Get global state from Zustand store
  const { 
    status: storeStatus,
    error: storeError,
    setStatus,
    setDevices,
    setError,
    transpose,
    velocityCurve 
  } = useMidiStore();
  
  // Local state for devices and pressed keys
  const [devices, setLocalDevices] = useState<MidiDevice[]>([]);
  const [pressedKeys, setPressedKeys] = useState(new Set<number>());
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Track if we have active subscriptions
  const subscriptionsRef = useRef<{
    rawEvents?: () => void;
    keyChanges?: () => void;
    deviceChanges?: () => void;
  }>({});
  
  // Promise guard to prevent concurrent initialization
  const startPromiseRef = useRef<Promise<void> | null>(null);
  
  // Enhanced callback with transformations and performance tracking
  const enhancedCallback = useCallback((singletonEvent: SingletonMidiEvent) => {
    // Active Device filtering - only process events from the selected device
    const activeDeviceId = getActiveDeviceId();
    if (activeDeviceId && singletonEvent.deviceId !== activeDeviceId) {
      return; // Ignore events from non-active devices
    }
    
    // Convert singleton event to legacy format
    let event = adaptMidiEvent(singletonEvent);
    
    // Apply transformations
    let transformedEvent = { ...event };
    
    // Apply transpose
    if (transpose !== 0 && (event.type === 'noteOn' || event.type === 'noteOff')) {
      const noteEvent = transformedEvent as NoteOnEvent | NoteOffEvent;
      noteEvent.note = Math.max(0, Math.min(127, event.note + transpose));
    }
    
    // Apply velocity curve
    if (event.type === 'noteOn' && velocityCurve !== 'linear') {
      const noteOnEvent = transformedEvent as NoteOnEvent;
      noteOnEvent.velocity = applyVelocityCurve(event.velocity, velocityCurve);
    }
    
    // Call user's handler
    onMidiEvent?.(transformedEvent);
    
    // Record latency (only in development)
    if (process.env.NODE_ENV === 'development') {
      const latency = performance.now() - event.timestamp;
      logMidiLatency(latency);
    }
  }, [onMidiEvent, transpose, velocityCurve]);

  // Key state change callback for practice mode
  const keyStateCallback = useCallback((keys: Set<number>) => {
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug('[useMidi] Received key state update', { keys: Array.from(keys) });
    }
    setPressedKeys(new Set(keys));
    onKeysChanged?.(Array.from(keys));
  }, [onKeysChanged]);

  // Device change callback
  const deviceChangeCallback = useCallback((singletonDevices: SingletonMidiDevice[]) => {
    const adaptedDevices = singletonDevices.map(adaptMidiDevice);
    setLocalDevices(adaptedDevices);
    setDevices(adaptedDevices);
    
    // Update status to ready when devices are available
    if (isInitialized) {
      setStatus('ready');
    }
  }, [setDevices, setStatus, isInitialized]);

  // Store current callbacks in ref to avoid dependency issues in initialization effect
  const currentCallbacksRef = useRef({
    enhancedCallback,
    keyStateCallback,
    deviceChangeCallback
  });
  
  // Update callback refs
  useEffect(() => {
    currentCallbacksRef.current = {
      enhancedCallback,
      keyStateCallback,
      deviceChangeCallback
    };
  });

  // Set up cleanup on unmount (no auto-initialization)
  useEffect(() => {
    return () => {
      // Cleanup subscriptions on unmount
      subscriptionsRef.current.rawEvents?.();
      subscriptionsRef.current.keyChanges?.();
      subscriptionsRef.current.deviceChanges?.();
      subscriptionsRef.current = {};
    };
  }, []); // Empty deps - only cleanup on unmount

  // Update subscriptions when callbacks change - CRITICAL: Prevent double subscriptions
  useEffect(() => {
    if (!isInitialized) return;
    
    // Check if subscription already exists to prevent duplicates
    if (onMidiEvent && !subscriptionsRef.current.rawEvents) {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('[useMidi] Setting up raw event subscription');
      }
      const unsubscribeRaw = midiService.subscribeToRawEvents(currentCallbacksRef.current.enhancedCallback);
      subscriptionsRef.current.rawEvents = unsubscribeRaw;
    } else if (!onMidiEvent && subscriptionsRef.current.rawEvents) {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('[useMidi] Cleaning up raw event subscription');
      }
      subscriptionsRef.current.rawEvents();
      subscriptionsRef.current.rawEvents = undefined;
    }
  }, [onMidiEvent, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;
    
    // Check if subscription already exists to prevent duplicates
    if (onKeysChanged && !subscriptionsRef.current.keyChanges) {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('[useMidi] Setting up key state subscription');
      }
      const unsubscribeKeys = midiService.subscribeToKeyStateChanges(currentCallbacksRef.current.keyStateCallback);
      subscriptionsRef.current.keyChanges = unsubscribeKeys;
    } else if (!onKeysChanged && subscriptionsRef.current.keyChanges) {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('[useMidi] Cleaning up key state subscription');
      }
      subscriptionsRef.current.keyChanges();
      subscriptionsRef.current.keyChanges = undefined;
    }
  }, [onKeysChanged, isInitialized]);

  // Start function - now just initializes if not auto-started
  const start = useCallback(async () => {
    if (isInitialized) {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('useMidi: Service already initialized');
      }
      return;
    }
    
    // If initialization is already in progress, await the existing promise
    if (startPromiseRef.current) {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('useMidi: Awaiting existing initialization...');
      }
      await startPromiseRef.current;
      return;
    }
    
    // Create and store the initialization promise
    const initPromise = (async () => {
      try {
        setStatus('initializing');
        setError(null);
        
        await midiService.initialize();
        
        // Set up subscriptions - CRITICAL: Check if not already subscribed
        if (onMidiEvent && !subscriptionsRef.current.rawEvents) {
          if (process.env.NODE_ENV === 'development') {
            perfLogger.debug('[useMidi] Setting up raw event subscription in start');
          }
          const unsubscribeRaw = midiService.subscribeToRawEvents(currentCallbacksRef.current.enhancedCallback);
          subscriptionsRef.current.rawEvents = unsubscribeRaw;
        }
        
        if (onKeysChanged && !subscriptionsRef.current.keyChanges) {
          if (process.env.NODE_ENV === 'development') {
            perfLogger.debug('[useMidi] Setting up key state subscription in start');
          }
          const unsubscribeKeys = midiService.subscribeToKeyStateChanges(currentCallbacksRef.current.keyStateCallback);
          subscriptionsRef.current.keyChanges = unsubscribeKeys;
        }
        
        if (!subscriptionsRef.current.deviceChanges) {
          if (process.env.NODE_ENV === 'development') {
            perfLogger.debug('[useMidi] Setting up device change subscription in start');
          }
          const unsubscribeDevices = midiService.subscribeToDeviceChanges(currentCallbacksRef.current.deviceChangeCallback);
          subscriptionsRef.current.deviceChanges = unsubscribeDevices;
        }
        
        setIsInitialized(true);
        if (process.env.NODE_ENV === 'development') {
          perfLogger.debug('useMidi: Manual start successful');
        }
        
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to start MIDI service';
        setError(errorMessage);
        setStatus('error');
        perfLogger.error('useMidi: Manual start error', err instanceof Error ? err : new Error(String(err)));
      } finally {
        // Clear the promise so future re-initializations can proceed
        startPromiseRef.current = null;
      }
    })();
    
    startPromiseRef.current = initPromise;
    await initPromise;
  }, [isInitialized, setStatus, setError, onMidiEvent, onKeysChanged]);
  
  // Stop function - cleanup subscriptions but don't destroy singleton
  const stop = useCallback(() => {
    // Clean up subscriptions
    subscriptionsRef.current.rawEvents?.();
    subscriptionsRef.current.keyChanges?.();
    subscriptionsRef.current.deviceChanges?.();
    subscriptionsRef.current = {};
    
    // Reset local state
    setLocalDevices([]);
    setPressedKeys(new Set());
    setIsInitialized(false);
    setStatus('initializing');
    setError(null);
    
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug('useMidi: Stopped (subscriptions cleaned up)');
    }
  }, [setStatus, setError]);
  
  return {
    devices,
    status: isInitialized ? storeStatus : 'not_initialized',
    isConnected: storeStatus === 'ready' && getActiveDeviceId() !== null,
    error: storeError,
    pressedKeys,
    start,
    stop
  };
};