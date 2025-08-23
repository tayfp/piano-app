/**
 * MIDI Zustand Store - Global state management for MIDI devices and settings
 * 
 * Version Production Optimization
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MidiDevice } from '../types/midi';
import { perfLogger } from '@/renderer/utils/performance-logger';

// MIDI System States - Active Device pattern
export type MidiSystemStatus = 
  | 'not_initialized'  // MIDI not yet initialized (user action required)
  | 'initializing'     // MIDI system starting up
  | 'ready'           // MIDI system ready, devices may or may not be available
  | 'error';          // Unrecoverable error

// Legacy type for backward compatibility during migration
export type MidiConnectionStatus = MidiSystemStatus | 'scanning' | 'no_devices' | 'devices_available' | 'connecting' | 'connected' | 'disconnected';

interface MidiState {
  // System state
  status: MidiSystemStatus;
  devices: MidiDevice[];
  activeDeviceId: string | null;  // Which device to process events from
  error: string | null;
  
  // Performance metrics (legacy - to be removed)
  latencyHistory: number[];
  averageLatency: number;
  
  // New aggregated performance stats
  latencyStats: {
    average: number;
    max: number;
    min: number;
    violations: number;
  };
  
  // User preferences
  velocityCurve: 'linear' | 'exponential' | 'logarithmic';
  transpose: number; // Semitones to transpose
  
  // Actions
  setStatus: (status: MidiSystemStatus) => void;
  setDevices: (devices: MidiDevice[]) => void;
  setActiveDevice: (deviceId: string | null) => void;
  setError: (error: string | null) => void;
  recordLatency: (latency: number) => void; // Legacy - to be removed
  setLatencyStats: (stats: MidiState['latencyStats']) => void;
  setVelocityCurve: (curve: MidiState['velocityCurve']) => void;
  setTranspose: (semitones: number) => void;
}

export const useMidiStore = create<MidiState>()(
  persist(
    (set, get) => ({
      // Initial state
      status: 'not_initialized',
      devices: [],
      activeDeviceId: null,
      error: null,
      latencyHistory: [],
      averageLatency: 0,
      latencyStats: {
        average: 0,
        max: 0,
        min: 0,
        violations: 0
      },
      velocityCurve: 'linear',
      transpose: 0,
      
      // Actions
      setStatus: (status) => set({ status }),
      
      setDevices: (devices) => {
        const currentState = get();
        
        // Only update status if we're initializing
        if (currentState.status === 'initializing') {
          set({ devices, status: 'ready' });
        } else {
          set({ devices });
        }
      },
      
      setActiveDevice: (deviceId) => {
        // Active Device pattern - selection is immediate, no connection states
        set({ 
          activeDeviceId: deviceId,
          error: null 
        });
        
        if (deviceId) {
          perfLogger.debug(`MIDI device ${deviceId} is now active`);
        } else {
          perfLogger.debug('No active MIDI device');
        }
      },
      
      setError: (error) => set({ error, status: error ? 'error' : get().status }),
      
      recordLatency: (latency) => set((state) => {
        // Filter out invalid values
        if (!isFinite(latency) || latency < 0) {
          return state;
        }
        
        const history = [...state.latencyHistory, latency].slice(-100);
        const average = history.length > 0 ? history.reduce((a, b) => a + b, 0) / history.length : 0;
        
        return {
          latencyHistory: history,
          averageLatency: Math.round(average * 10) / 10
        };
      }),
      
      setLatencyStats: (stats) => set({ latencyStats: stats }),
      
      setVelocityCurve: (curve) => set({ velocityCurve: curve }),
      setTranspose: (transpose) => set({ transpose }),
    }),
    {
      name: 'midi-preferences',
      partialize: (state) => ({
        activeDeviceId: state.activeDeviceId,
        velocityCurve: state.velocityCurve,
        transpose: state.transpose,
      }),
    }
  )
);

/**
 * Apply velocity curve transformations
 */
export function applyVelocityCurve(velocity: number, curve: MidiState['velocityCurve']): number {
  const normalized = velocity / 127;
  
  switch (curve) {
    case 'exponential':
      return Math.round(normalized * normalized * 127);
    case 'logarithmic': 
      return Math.round(Math.sqrt(normalized) * 127);
    case 'linear':
    default:
      return velocity;
  }
}

/**
 * Helper to get active device ID for event filtering
 */
export function getActiveDeviceId(): string | null {
  return useMidiStore.getState().activeDeviceId;
}

/**
 * Helper to check if there's an active device
 */
export function hasActiveDevice(): boolean {
  return useMidiStore.getState().activeDeviceId !== null;
}