/**
 * Singleton MIDI Service - Unified MIDI event handling
 * 
 * Implements the Active Device pattern - connects to ALL MIDI devices
 * but only processes events from the selected active device.
 * 
 * Features:
 * - Singleton pattern prevents service instance conflicts
 * - Pub/Sub architecture for multiple event subscribers
 * - Active Device filtering for focused input
 * - Raw events for real-time piano highlighting
 * - Debounced key state for practice mode chord evaluation
 * - Automatic cleanup and memory leak prevention
 */

// Minimal Web MIDI API type declarations to fix TypeScript errors
declare namespace WebMidi {
  interface MIDIAccess {
    inputs: Map<string, MIDIInput>;
    outputs: Map<string, MIDIOutput>;
    onstatechange: ((event: MIDIConnectionEvent) => void) | null;
  }

  interface MIDIInput {
    id: string;
    name?: string;
    manufacturer?: string;
    state: 'connected' | 'disconnected';
    onmidimessage: ((event: MIDIMessageEvent) => void) | null;
  }

  interface MIDIOutput {
    id: string;
    name?: string;
    manufacturer?: string;
    state: 'connected' | 'disconnected';
  }

  interface MIDIMessageEvent {
    data: Uint8Array;
    timeStamp?: number;
  }

  interface MIDIConnectionEvent {
    port: MIDIInput | MIDIOutput;
  }
}

export interface MidiEvent {
  type: 'noteOn' | 'noteOff';
  note: number;
  velocity: number;
  timestamp: number;
  deviceId?: string;  // Optional for backward compatibility
}

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer?: string;
  state: 'connected' | 'disconnected';
}

export type RawMidiEventCallback = (event: MidiEvent) => void;
export type KeyStateChangeCallback = (pressedKeys: Set<number>) => void;
export type DeviceChangeCallback = (devices: MidiDevice[]) => void;

import { latencyMonitor } from './LightweightLatencyMonitor';
import { MicroBatchingMidiProcessor } from './MicroBatchingMidiProcessor';
import { Flags } from '@/shared/featureFlags';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { logger } from '@/renderer/utils/simple-logger';

export class MidiService {
  private static instance: MidiService | null = null;
  
  // State management
  private pressedKeys: Set<number> = new Set();
  private connectedDevices: Map<string, MidiDevice> = new Map();
  private midiAccess: WebMidi.MIDIAccess | null = null;
  
  // Subscriber management
  private rawEventSubscribers: Set<RawMidiEventCallback> = new Set();
  private keyStateSubscribers: Set<KeyStateChangeCallback> = new Set();
  private deviceChangeSubscribers: Set<DeviceChangeCallback> = new Set();
  
  // Debouncing for key state updates (legacy) OR micro-batching (optimized)
  private debounceTimeout: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_DELAY = Flags.microBatching ? 10 : 50; // ms
  private microBatcher: MicroBatchingMidiProcessor | null = null;
  
  // Service state
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  private constructor() {
    // Private constructor for singleton pattern
    
    // Initialize micro-batching processor if feature flag is enabled
    if (Flags.microBatching) {
      this.microBatcher = new MicroBatchingMidiProcessor(10); // 10ms window
      this.microBatcher.setCallback((notes: number[]) => {
        this.handleBatchedNotes(notes);
      });
      // Micro-batching mode active
    } else {
      // Legacy debouncing mode active  
    }
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): MidiService {
    if (!MidiService.instance) {
      MidiService.instance = new MidiService();
    }
    return MidiService.instance;
  }

  /**
   * Initialize MIDI access (called automatically on first subscription)
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.performInitialization();
    return this.initializationPromise;
  }

  private async performInitialization(): Promise<void> {
    try {
      // Check if Web MIDI is supported
      if (!('requestMIDIAccess' in navigator)) {
        throw new Error('Web MIDI API is not supported in this browser');
      }

      logger.midi('Requesting MIDI access...');
      
      // Request MIDI access with timeout protection
      const MIDI_TIMEOUT = 10000; // 10 seconds
      let timeoutId: NodeJS.Timeout;
      
      // Fix deprecation warning by explicitly setting sysex: false
      const midiPromise = navigator.requestMIDIAccess({ sysex: false });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('MIDI access request timed out')), MIDI_TIMEOUT);
      });
      
      try {
        this.midiAccess = await Promise.race([midiPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId!);
      }
      
      // Set up device change listener
      this.midiAccess.onstatechange = (event: WebMidi.MIDIConnectionEvent) => {
        this.handleDeviceStateChange(event);
      };
      
      // Initialize existing devices
      this.setupExistingDevices();
      
      this.isInitialized = true;
      logger.midi('Initialized successfully');
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      perfLogger.error('MidiService: Failed to initialize MIDI access:', error);
      throw err;
    }
  }

  private setupExistingDevices(): void {
    if (!this.midiAccess) return;

    // Setup inputs
    this.midiAccess.inputs.forEach((input: WebMidi.MIDIInput) => {
      this.setupMidiInput(input);
    });
    
    // Track all devices
    this.updateDeviceList();
  }

  private setupMidiInput(input: WebMidi.MIDIInput): void {
    // Prevent duplicate handlers - check if already connected
    if (input.onmidimessage !== null) {
      logger.midi(`Input already connected: ${input.name} (${input.id})`);
      return;
    }
    
    // Set up the MIDI message handler
    input.onmidimessage = (event: WebMidi.MIDIMessageEvent) => {
      // RAW MIDI DEBUG: Log every event received (temporary for debugging)
      // logger.midi(`RAW ${input.name} data: [${Array.from(event.data).join(',')}] timestamp: ${event.timeStamp}`);
      this.handleMidiMessage(event, input.id!);
    };
    
    logger.midi(`Connected to input: ${input.name} (${input.id})`);
  }

  private handleMidiMessage(event: WebMidi.MIDIMessageEvent, deviceId: string): void {
    // Start measuring MIDI processing time
    latencyMonitor.startMeasure('midi-processing');
    
    try {
      const command = event.data[0];
      const timestamp = event.timeStamp || performance.now();
      
      // Filter out Active Sensing messages (Yamaha P-Series sends these every 300ms)
      if (command === 0xFE) {
        // Silently ignore Active Sensing - no log needed
        return;
      }
      
      // Filter out other system messages that aren't note events
      if (command >= 0xF0) {
        // Silently ignore system messages
        return;
      }
      
      // Guard against malformed MIDI messages (must have at least 3 bytes for Note On/Off)
      if (event.data.length < 3) {
        logger.midi(`Ignoring MIDI message with insufficient data: command 0x${command.toString(16)}, length ${event.data.length}`);
        return;
      }
      
      const note = event.data[1];
      const velocity = event.data[2];
      
      // DEBUG: Log command details for Yamaha P-Series debugging
      // logger.midi(`CMD Command: 0x${command.toString(16).toUpperCase()} Note: ${note} Velocity: ${velocity}`);
      
      let midiEvent: MidiEvent | null = null;
      
      // Parse MIDI message
      if (command >= 144 && command <= 159) {
        // Note On (channel 1-16: 144-159)
        const channel = (command & 0x0F) + 1; // Extract channel (1-16)
        logger.midi(`NOTE ON Channel: ${channel} Note: ${note} Velocity: ${velocity}`);
        
        if (velocity > 0) {
          midiEvent = {
            type: 'noteOn',
            note,
            velocity,
            timestamp
          };
          this.pressedKeys.add(note);
        } else {
          // Note On with velocity 0 = Note Off (common MIDI convention)
          logger.midi('NOTE OFF: Note On with velocity 0 interpreted as Note Off');
          midiEvent = {
            type: 'noteOff',
            note,
            velocity: 0,
            timestamp
          };
          this.pressedKeys.delete(note);
        }
      } else if (command >= 128 && command <= 143) {
        // Note Off (channel 1-16: 128-143)
        const channel = (command & 0x0F) + 1; // Extract channel (1-16)
        logger.midi(`NOTE OFF Channel: ${channel} Note: ${note} Velocity: ${velocity}`);
        
        midiEvent = {
          type: 'noteOff',
          note,
          velocity,
          timestamp
        };
        this.pressedKeys.delete(note);
      } else {
        logger.midi(`UNKNOWN: Unhandled command: 0x${command.toString(16).toUpperCase()}`);
        // Fix: Ensure latency monitor is ended for unknown commands
        return;
      }
      
      if (midiEvent) {
        // Add device ID to the event for filtering
        const eventWithDevice = { ...midiEvent, deviceId };
        
        // Distribute to raw event subscribers immediately
        this.rawEventSubscribers.forEach(callback => {
          try {
            callback(eventWithDevice);
          } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            perfLogger.error('MidiService: Error in raw event callback:', error);
          }
        });
        
        // Trigger key state update (micro-batched or debounced)
        if (Flags.microBatching && this.microBatcher) {
          this.microBatcher.processMidiEvent(eventWithDevice);
        } else {
          this.scheduleKeyStateUpdate();
        }
      }
    } finally {
      // End MIDI processing measurement - always called regardless of how function exits
      latencyMonitor.endMeasure('midi-processing');
    }
  }

  private scheduleKeyStateUpdate(): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    
    this.debounceTimeout = setTimeout(() => {
      const keyState = new Set(this.pressedKeys);
      logger.midi('Debounced key state update:', Array.from(keyState));
      this.keyStateSubscribers.forEach(callback => {
        try {
          callback(keyState);
        } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          perfLogger.error('MidiService: Error in key state callback:', error);
        }
      });
    }, this.DEBOUNCE_DELAY);
  }

  /**
   * Handle batched notes from micro-batching processor
   */
  private handleBatchedNotes(notes: number[]): void {
    try {
      // Convert notes array to Set for consistency with existing API
      const keyState = new Set(notes);
      
      // Performance-critical path: no logging in production
      
      // Notify all key state subscribers
      this.keyStateSubscribers.forEach(callback => {
        try {
          callback(keyState);
        } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          perfLogger.error('MidiService: Error in micro-batch callback:', error);
        }
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      perfLogger.error('MidiService: Error handling batched notes:', error);
    }
  }

  private handleDeviceStateChange(event: WebMidi.MIDIConnectionEvent): void {
    logger.midi(`Device state changed: ${event.port.name} ${event.port.state}`);
    
    if (event.port.type === 'input') {
      if (event.port.state === 'connected') {
        this.setupMidiInput(event.port as WebMidi.MIDIInput);
      }
      this.updateDeviceList();
    }
  }

  private updateDeviceList(): void {
    if (!this.midiAccess) return;
    
    this.connectedDevices.clear();
    
    this.midiAccess.inputs.forEach((input: WebMidi.MIDIInput) => {
      const device: MidiDevice = {
        id: input.id!,
        name: input.name || 'Unknown Device',
        manufacturer: input.manufacturer || undefined,
        state: input.state as 'connected' | 'disconnected'
      };
      this.connectedDevices.set(device.id, device);
    });
    
    // Notify device change subscribers
    const devices = Array.from(this.connectedDevices.values());
    this.deviceChangeSubscribers.forEach(callback => {
      try {
        callback(devices);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        perfLogger.error('MidiService: Error in device change callback:', error);
      }
    });
  }

  /**
   * Subscribe to raw MIDI events (immediate, no debouncing)
   * Perfect for real-time piano key highlighting
   */
  public subscribeToRawEvents(callback: RawMidiEventCallback): () => void {
    this.rawEventSubscribers.add(callback);
    
    // Note: Auto-initialization removed to prevent race conditions
    // Initialization should be explicitly called by the consuming hook
    
    // Return unsubscribe function
    return () => {
      this.rawEventSubscribers.delete(callback);
    };
  }

  /**
   * Subscribe to debounced key state changes
   * Perfect for practice mode chord evaluation
   */
  public subscribeToKeyStateChanges(callback: KeyStateChangeCallback): () => void {
    // Check if this exact callback is already subscribed to prevent duplicates
    if (this.keyStateSubscribers.has(callback)) {
      perfLogger.debug('[MidiService] Key state callback already subscribed, skipping duplicate');
      return () => {
        this.keyStateSubscribers.delete(callback);
      };
    }
    
    this.keyStateSubscribers.add(callback);
    
    // Immediately provide current state to new subscriber
    callback(new Set(this.pressedKeys));
    
    // Note: Auto-initialization removed to prevent race conditions
    // Initialization should be explicitly called by the consuming hook
    
    // Return unsubscribe function
    return () => {
      this.keyStateSubscribers.delete(callback);
    };
  }

  /**
   * Subscribe to device connection changes
   */
  public subscribeToDeviceChanges(callback: DeviceChangeCallback): () => void {
    this.deviceChangeSubscribers.add(callback);
    
    // Immediately provide current devices to new subscriber (will be empty until initialized)
    const devices = Array.from(this.connectedDevices.values());
    callback(devices);
    
    // Note: Auto-initialization removed to prevent race conditions
    // Initialization should be explicitly called by the consuming hook
    
    // Return unsubscribe function
    return () => {
      this.deviceChangeSubscribers.delete(callback);
    };
  }

  /**
   * Get current pressed keys (for immediate access)
   */
  public getPressedKeys(): Set<number> {
    return new Set(this.pressedKeys);
  }

  /**
   * Get current connected devices (for immediate access)
   */
  public getConnectedDevices(): MidiDevice[] {
    return Array.from(this.connectedDevices.values());
  }

  /**
   * Check if MIDI is available in the browser
   */
  public static isWebMidiSupported(): boolean {
    return 'requestMIDIAccess' in navigator;
  }

  /**
   * Cleanup all resources (for testing or app shutdown)
   */
  public destroy(): void {
    // Clear all timers and processors
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    
    if (this.microBatcher) {
      this.microBatcher.destroy();
      this.microBatcher = null;
    }
    
    // Clear all subscribers
    this.rawEventSubscribers.clear();
    this.keyStateSubscribers.clear();
    this.deviceChangeSubscribers.clear();
    
    // Clean up MIDI access
    if (this.midiAccess) {
      this.midiAccess.inputs.forEach((input: WebMidi.MIDIInput) => {
        input.onmidimessage = null;
      });
      this.midiAccess.onstatechange = null;
    }
    
    // Reset state
    this.pressedKeys.clear();
    this.connectedDevices.clear();
    this.midiAccess = null;
    this.isInitialized = false;
    this.initializationPromise = null;
    
    perfLogger.debug('MidiService: Destroyed and cleaned up');
  }

  /**
   * Reset singleton instance (for testing)
   */
  public static resetInstance(): void {
    if (MidiService.instance) {
      MidiService.instance.destroy();
      MidiService.instance = null;
    }
  }
}

// Export the singleton instance
export const midiService = MidiService.getInstance();