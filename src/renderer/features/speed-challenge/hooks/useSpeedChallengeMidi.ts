/**
 * Speed Challenge MIDI Integration Hook
 * Phase 3 Task 3.1 - MIDI Handler Implementation
 * 
 * Integrates with existing MIDI pipeline while maintaining <20ms latency.
 * Provides immediate pattern validation and advancement.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useSpeedChallengeStore } from '../stores/speedChallengeStore';
import { useMidiStore, getActiveDeviceId } from '@/renderer/stores/midiStore';
import type { MidiEvent } from '@/renderer/services/MidiService';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { VisualFeedbackType } from '../types';

/**
 * Hook return type for MIDI integration
 */
interface SpeedChallengeMidiHook {
  /** Process MIDI event for speed challenge (optimized hot path) */
  handleSpeedChallengeMidiEvent: (event: MidiEvent) => void;
  /** Current activation state */
  isActive: boolean;
  /** Current expected MIDI note(s) */
  expectedNotes: number[];
}

/**
 * MIDI integration hook for Speed Challenge Mode
 * 
 * Performance characteristics:
 * - Event processing: <1ms overhead
 * - Zero allocations in hot path
 * - Immediate pattern advancement
 */
export function useSpeedChallengeMidi(): SpeedChallengeMidiHook {
  // Direct store access for performance (Zustand actions are stable)
  const { 
    isActive, 
    currentPattern,
    validateNote,
    showVisualFeedback,
    generateNextPattern
  } = useSpeedChallengeStore();

  // Get active MIDI device for filtering
  const activeDeviceId = getActiveDeviceId();

  // Pre-compute expected notes to avoid allocation in hot path
  const expectedNotes = useMemo(() => {
    if (!currentPattern) return [];
    return currentPattern.notes.map(n => n.midi);
  }, [currentPattern]);

  /**
   * Handle MIDI event with minimal overhead
   * Performance-critical hot path - no allocations
   */
  const handleSpeedChallengeMidiEvent = useCallback((event: MidiEvent) => {
    // DEBUG LOGGING: Track Speed Challenge MIDI handler calls
    if (process.env.NODE_ENV === 'development') {
      console.log('[SPEED CHALLENGE DEBUG] handleSpeedChallengeMidiEvent called:', {
        isActive,
        eventType: event.type,
        note: event.note,
        velocity: event.velocity,
        currentPattern: currentPattern ? currentPattern.id : 'none',
        expectedNotes: expectedNotes
      });
    }
    
    // Early exit checks (ordered by likelihood)
    if (!isActive) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[SPEED CHALLENGE DEBUG] Early exit - Speed Challenge not active');
      }
      return;
    }
    if (event.type !== 'noteOn') {
      if (process.env.NODE_ENV === 'development') {
        console.log('[SPEED CHALLENGE DEBUG] Early exit - not a noteOn event:', event.type);
      }
      return;
    }
    
    // Validate event structure (graceful error handling)
    if (!event || typeof event.note !== 'number') {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.warn('Speed Challenge: Invalid MIDI event', event);
      }
      return;
    }

    // Device filtering (only process from active device)
    if (activeDeviceId && event.deviceId !== activeDeviceId) {
      return;
    }

    // Performance measurement start (development only)
    const processingStart = process.env.NODE_ENV === 'development' ? performance.now() : 0;

    try {
      // Validate note against current pattern
      if (process.env.NODE_ENV === 'development') {
        console.log('[SPEED CHALLENGE DEBUG] Calling validateNote with:', {
          note: event.note,
          timestamp: event.timestamp,
          expectedNotes
        });
      }
      
      const validationResult = validateNote(event.note, event.timestamp);
      
      if (process.env.NODE_ENV === 'development') {
        console.log('[SPEED CHALLENGE DEBUG] Validation result:', validationResult);
      }
      
      // Trigger visual feedback based on result
      if (validationResult.correct) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[SPEED CHALLENGE DEBUG] Correct note! Showing success feedback and advancing pattern');
        }
        showVisualFeedback(event.note, VisualFeedbackType.SUCCESS);
        
        // Pattern advancement is handled by the store's validateNote action
        // which schedules generateNextPattern() asynchronously
      } else {
        if (process.env.NODE_ENV === 'development') {
          console.log('[SPEED CHALLENGE DEBUG] Incorrect note! Showing error feedback');
        }
        showVisualFeedback(event.note, VisualFeedbackType.ERROR);
      }

      // Log performance in development
      if (process.env.NODE_ENV === 'development') {
        const processingTime = performance.now() - processingStart;
        if (processingTime > 1) {
          perfLogger.warn(`Speed Challenge MIDI processing took ${processingTime.toFixed(2)}ms`);
        }
      }
    } catch (error) {
      // Graceful error handling - don't crash the app
      if (process.env.NODE_ENV === 'development') {
        perfLogger.error('Speed Challenge MIDI handler error:', error);
      }
    }
  }, [isActive, activeDeviceId, validateNote, showVisualFeedback]);

  // Log activation state changes (development only)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug(`Speed Challenge MIDI handler ${isActive ? 'activated' : 'deactivated'}`);
    }
  }, [isActive]);

  return {
    handleSpeedChallengeMidiEvent,
    isActive,
    expectedNotes
  };
}

/**
 * Integration helper for main MIDI handler
 * This function should be called from useMidiHandlers.ts
 */
export function integrateSpeedChallengeMidi(
  event: MidiEvent,
  speedChallengeHandler: (event: MidiEvent) => void
): void {
  // Process event through speed challenge if active
  // This is designed to be called inline without breaking existing flow
  speedChallengeHandler(event);
}