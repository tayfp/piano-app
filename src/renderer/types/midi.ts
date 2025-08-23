/**
 * MIDI Type Definitions
 * 
 * Discriminated unions for type-safe MIDI event handling
 * Version Core types for MVP implementation
 */

// Base interface for common properties
interface MidiEventBase {
  timestamp: number;   // performance.now() timestamp
  channel: number;     // 0-15 MIDI channel (default: 0)
}

export interface NoteOnEvent extends MidiEventBase {
  type: 'noteOn';
  note: number;        // 0-127 MIDI note number
  velocity: number;    // 1-127 (velocity 0 is noteOff)
}

export interface NoteOffEvent extends MidiEventBase {
  type: 'noteOff';
  note: number;        // 0-127 MIDI note number
  velocity: number;    // 0-127 (usually 0)
}

export interface ControlChangeEvent extends MidiEventBase {
  type: 'controlChange';
  controller: number;  // 0-127 (e.g., 64 for sustain pedal)
  value: number;       // 0-127
}

// Discriminated union for type safety
export type MidiEvent = NoteOnEvent | NoteOffEvent | ControlChangeEvent;

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
  type: 'input' | 'output';
  state: 'connected' | 'disconnected';
}

// Handler types
export type MidiEventHandler = (event: MidiEvent) => void;
export type DeviceChangeHandler = (devices: MidiDevice[]) => void;