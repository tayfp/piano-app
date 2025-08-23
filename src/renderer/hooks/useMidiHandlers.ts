/**
 * MIDI Event Handlers Hook
 * 
 * Centralizes MIDI event processing logic.
 * Handles both normal piano highlighting and practice mode integration.
 * 
 * IMPORTANT: Uses refs to store store functions to prevent re-renders.
 * This ensures that the handleMidiEvent callback remains stable and doesn't
 * cause the entire provider tree to remount when piano store updates.
 */

import { useCallback, useRef, useEffect } from 'react';
import { usePianoStore } from '@/renderer/stores/pianoStore';
import { animateNoteOn, animateNoteOff } from '@/renderer/services/animatorInstance';
import type { MidiEvent } from '@/renderer/types/midi';
import { perfLogger } from '@/renderer/utils/performance-logger';

interface MidiHandlers {
  handleMidiEvent: (event: MidiEvent) => void;
  handleMidiEventWithPractice: (event: MidiEvent) => void;
}

export function useMidiHandlers(): MidiHandlers {
  // Use refs to store the latest functions without causing re-renders
  const pressNoteRef = useRef(usePianoStore.getState().pressNote);
  const releaseNoteRef = useRef(usePianoStore.getState().releaseNote);
  
  // Subscribe to store updates to keep refs current
  useEffect(() => {
    const unsubscribe = usePianoStore.subscribe((state) => {
      pressNoteRef.current = state.pressNote;
      releaseNoteRef.current = state.releaseNote;
    });
    return unsubscribe;
  }, []);

  const handleMidiEvent = useCallback((event: MidiEvent) => {
    try {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('MIDI Event', { event });
      }
      
      if (event.type === 'noteOn') {
        if (process.env.NODE_ENV === 'development') {
          perfLogger.debug('Processing noteOn', { note: event.note, velocity: event.velocity });
        }
        pressNoteRef.current(event.note, event.velocity);
        animateNoteOn(event.note, event.velocity);
      } else if (event.type === 'noteOff') {
        if (process.env.NODE_ENV === 'development') {
          perfLogger.debug('Processing noteOff', { note: event.note });
        }
        releaseNoteRef.current(event.note);
        animateNoteOff(event.note);
      }
    } catch (err: unknown) {
      // Fix the type error: convert unknown to Error for perfLogger
      const error = err instanceof Error ? err : new Error(String(err));
      perfLogger.error('Error handling MIDI event:', error);
      throw err; // Let parent handle the error
    }
  }, []); // Empty deps - refs are always current

  // Removed handleKeysChanged - logging already done in useMidi.ts
  // This prevents duplicate "Keys changed" logs

  const handleMidiEventWithPractice = useCallback((event: MidiEvent) => {
    // First, handle the normal MIDI event processing
    handleMidiEvent(event);
    
    // Practice mode handling is done via MidiContext -> usePracticeController
  }, [handleMidiEvent]);

  return {
    handleMidiEvent,
    handleMidiEventWithPractice
  };
}