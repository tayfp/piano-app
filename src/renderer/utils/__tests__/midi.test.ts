/**
 * MIDI Utility Tests
 */

import { 
  halfToneToMidi, 
  midiToHalfTone, 
  midiToNoteName,
  isValidMidiNote,
  isValidMidiVelocity 
} from '../midi/conversion';

describe('MIDI Conversion Utilities', () => {
  describe('halfToneToMidi', () => {
    it('should convert C4 (halfTone 0) to MIDI 60', () => {
      expect(halfToneToMidi(0)).toBe(60);
    });

    it('should convert C5 (halfTone 12) to MIDI 72', () => {
      expect(halfToneToMidi(12)).toBe(72);
    });

    it('should convert C3 (halfTone -12) to MIDI 48', () => {
      expect(halfToneToMidi(-12)).toBe(48);
    });

    it('should clamp values above 127', () => {
      expect(halfToneToMidi(100)).toBe(127);
    });

    it('should clamp values below 0', () => {
      expect(halfToneToMidi(-100)).toBe(0);
    });
  });

  describe('midiToHalfTone', () => {
    it('should convert MIDI 60 (C4) to halfTone 0', () => {
      expect(midiToHalfTone(60)).toBe(0);
    });

    it('should convert MIDI 72 (C5) to halfTone 12', () => {
      expect(midiToHalfTone(72)).toBe(12);
    });

    it('should convert MIDI 48 (C3) to halfTone -12', () => {
      expect(midiToHalfTone(48)).toBe(-12);
    });
  });

  describe('midiToNoteName', () => {
    it('should convert MIDI 60 to C4', () => {
      expect(midiToNoteName(60)).toBe('C4');
    });

    it('should convert MIDI 69 to A4', () => {
      expect(midiToNoteName(69)).toBe('A4');
    });

    it('should convert MIDI 61 to C#4', () => {
      expect(midiToNoteName(61)).toBe('C#4');
    });

    it('should convert MIDI 0 to C-1', () => {
      expect(midiToNoteName(0)).toBe('C-1');
    });

    it('should convert MIDI 127 to G9', () => {
      expect(midiToNoteName(127)).toBe('G9');
    });
  });

  describe('isValidMidiNote', () => {
    it('should accept valid MIDI notes', () => {
      expect(isValidMidiNote(0)).toBe(true);
      expect(isValidMidiNote(60)).toBe(true);
      expect(isValidMidiNote(127)).toBe(true);
    });

    it('should reject invalid values', () => {
      expect(isValidMidiNote(-1)).toBe(false);
      expect(isValidMidiNote(128)).toBe(false);
      expect(isValidMidiNote(60.5)).toBe(false);
      expect(isValidMidiNote('60')).toBe(false);
      expect(isValidMidiNote(null)).toBe(false);
      expect(isValidMidiNote(undefined)).toBe(false);
    });
  });

  describe('isValidMidiVelocity', () => {
    it('should accept valid velocities', () => {
      expect(isValidMidiVelocity(0)).toBe(true);
      expect(isValidMidiVelocity(64)).toBe(true);
      expect(isValidMidiVelocity(127)).toBe(true);
    });

    it('should reject invalid values', () => {
      expect(isValidMidiVelocity(-1)).toBe(false);
      expect(isValidMidiVelocity(128)).toBe(false);
      expect(isValidMidiVelocity(64.5)).toBe(false);
      expect(isValidMidiVelocity('64')).toBe(false);
    });
  });
});