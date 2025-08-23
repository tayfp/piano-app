/**
 * Practice Controller v2 - State Machine Implementation
 * 
 * Refactored from 573-line hook with nested setTimeout pyramids to 
 * clean state machine using useReducer + useEffect pattern.
 * 
 * Key improvements:
 * - Explicit state transitions (no hidden state)
 * - Eliminated setTimeout pyramids 
 * - Single responsibility per function
 * - Comprehensive test coverage
 * - <20ms MIDI latency maintained
 * 
 * Architecture: Modular design with efficient implementation pattern
 */

import { useCallback, useEffect, useReducer, useMemo, useRef, useState } from 'react';
import { useMidiContext } from '@/renderer/contexts/MidiContext';
import { useOSMDContext } from '@/renderer/contexts/OSMDContext';
import { usePracticeStore } from '../stores/practiceStore';
import type { PracticeStep, PracticeStepResult } from '../types';
import type { MidiEvent } from '@/renderer/types/midi';
import { latencyMonitor } from '@/renderer/services/LightweightLatencyMonitor';
import { isPracticeStep } from '@/renderer/utils/practice/typeGuards';
import { Flags } from '@/shared/featureFlags';
import { midiToNoteName } from '@/renderer/utils/noteUtils';
import { findFirstStepInMeasure } from '../utils/findFirstStepInMeasure';
import { useDebounce } from '@/renderer/utils/debounce';
import { SimpleAdaptiveDifficulty } from '../services/SimpleAdaptiveDifficulty';

// Performance guard: eliminate unguarded logging allocations in production
const DEV = process.env.NODE_ENV !== 'production';

/**
 * OSMD Cursor Synchronization Workaround
 * 
 * After seek operations, OSMD's cursor iterator needs time to rebuild.
 * This helper polls for readiness using semantic checks on the cursor state.
 * 
 * DEPENDENCY WARNING: This relies on OSMD's internal cursor API:
 * - cursor.NotesUnderCursor()
 * - cursor.iterator.EndReached
 * 
 * Re-test when upgrading OSMD versions.
 */
const waitForCursorReady = (cursor: any, timeoutMs = 120): Promise<void> => {
  return new Promise((resolve, reject) => {
    // Early validation
    if (!cursor) {
      return reject(new Error('Cursor is undefined'));
    }
    
    const start = performance.now();
    
    const checkReady = () => {
      try {
        // Semantic readiness checks (not just null)
        if (
          cursor.NotesUnderCursor?.()?.length ||     // iterator has notes ready
          cursor.iterator?.EndReached              // or we're at end of score
        ) {
          return resolve();
        }
        
        // Also check if cursor has valid position
        if (cursor.iterator?.currentMeasureIndex !== undefined) {
          return resolve();
        }
      } catch (error: unknown) {
        // If cursor methods throw, it might be in invalid state
        const errorMessage = error instanceof Error ? error.message : String(error);
        return reject(new Error(`Cursor in invalid state: ${errorMessage}`));
      }
      
      // Check timeout
      if (performance.now() - start > timeoutMs) {
        return reject(new Error('Cursor readiness timeout'));
      }
      
      // Continue polling
      requestAnimationFrame(checkReady);
    };
    
    checkReady();
  });
};

// PHASE 1: Tempo-aware cursor advancement imports
// Note: These will be implemented in Tasks 1.4 and 1.2
import { useTempoServices } from '../providers/TempoServicesProvider';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { logger } from '@/renderer/utils/simple-logger';

// PHASE 2: Repeat service imports
import { V2RepeatAdapter } from '../adapters/V2RepeatAdapter';
import { PracticeRepeatManager } from '../services/PracticeRepeatManager';
import { MeasureTimeline } from '../services/MeasureTimeline';

// Visual animation imports
import { animateNoteOff } from '@/renderer/services/animatorInstance';

// ============================================================================
// STATE MACHINE TYPES (Code review: Code review:'s refined design)
// ============================================================================

export type PracticeStatus = 
  | 'idle'                    // Not started
  | 'loading'                 // Loading assets/score  
  | 'ready'                   // Ready to start
  | 'countIn'                 // Optional count-in period
  | 'practiceListening'       // Waiting for MIDI input
  | 'practiceEvaluating'      // Processing note input
  | 'practiceFeedbackCorrect' // Showing correct feedback
  | 'practiceFeedbackIncorrect' // Showing incorrect feedback  
  | 'advancing'               // Moving cursor to next note
  | 'paused'                  // User paused practice
  | 'completed'               // Reached end of piece
  | 'error';                  // Unrecoverable error

export interface PracticeState {
  status: PracticeStatus;
  currentStep: PracticeStep | null;
  currentIdx: number;
  lastNote?: number;
  error?: string;
  score: number;
  // Store previous state for pause/resume
  previousStatus?: PracticeStatus;
  // FIXED: Track all currently pressed keys for proper chord evaluation
  activeNotes: Set<number>;
  // PHASE 2: Repeat-related state
  repeatActive: boolean;
  repeatMeasure: number | null;  // Which measure to repeat
  currentMeasure: number;  // Current measure index
}

// ============================================================================
// ACTION TYPES (Semantic, not device-specific)
// ============================================================================

export type PracticeAction =
  | { type: 'START_CLICK' }
  | { type: 'STOP_CLICK' }
  | { type: 'PAUSE_CLICK' }
  | { type: 'RESUME_CLICK' }
  | { type: 'ASSETS_LOADED' }
  | { type: 'COUNT_IN_DONE' }
  | { type: 'MIDI_NOTE_ON'; payload: { note: number; velocity: number; timestamp: number } }
  | { type: 'MIDI_NOTE_OFF'; payload: { note: number } }
  | { type: 'NOTE_TIMEOUT' }
  | { type: 'EVAL_SUCCESS' }
  | { type: 'EVAL_FAIL' }
  | { type: 'FEEDBACK_TIMEOUT' }
  | { type: 'ADVANCE_DONE'; payload: { nextStep: PracticeStepResult; autoAdvanceRests: boolean } }
  | { type: 'UNRECOVERABLE_ERROR'; payload: { error: string } }
  // PHASE 2: Repeat-related actions
  | { type: 'TOGGLE_REPEAT' }
  | { type: 'SET_CURRENT_MEASURE'; payload: number };

// ============================================================================
// CONFIGURATION (Extracted from hardcoded timeouts)
// ============================================================================

const TIMING_CONFIG = {
  NOTE_TIMEOUT_MS: 30000,        // 30s wait for note input
  FEEDBACK_CORRECT_MS: 500,      // Green feedback duration  
  FEEDBACK_INCORRECT_MS: 1000,   // Red feedback duration
  COUNT_IN_BEATS: 2,             // Optional count-in beats
  GRACE_PERIOD_MS: 100,          // MIDI event grace period
} as const;

// ============================================================================
// PURE HELPER FUNCTIONS (Extracted business logic)
// ============================================================================

/**
 * Evaluate if the active notes match the expected notes for the current step
 * For single notes: exact match required
 * For chords: ALL notes must be held simultaneously
 */
function evaluateActiveNotes(activeNotes: Set<number>, currentStep: PracticeStep | null): 'SUCCESS' | 'FAIL' | 'PARTIAL' {
  if (process.env.NODE_ENV === 'development') {
    perfLogger.debug('[TIED_NOTES] Stage: Evaluation Start', {
      stage: 'practice_evaluation_start',
      currentStep: currentStep ? {
        measureIndex: currentStep.measureIndex,
        expectedNotes: currentStep.notes.map(n => n.midiValue),
        isChord: currentStep.isChord,
        stepIndex: currentStep.timestamp
      } : 'null',
      activeNotes: Array.from(activeNotes),
      timestamp: Date.now()
    });
  }
  
  if (!currentStep) return 'FAIL';
  
  let result: 'SUCCESS' | 'FAIL' | 'PARTIAL';
  
  // Single note evaluation - avoid Set creation for performance
  if (!currentStep.isChord) {
    // For single notes, only one key should be pressed and it must match
    if (activeNotes.size === 1 && currentStep.notes.length > 0 && activeNotes.has(currentStep.notes[0].midiValue)) {
      result = 'SUCCESS';
    } else {
      result = 'FAIL';
    }
  } else {
    // Chord evaluation - avoid spreads, use Set iteration for performance
    const expectedNotes = new Set(currentStep.notes.map(n => n.midiValue));
    
    // Check all expected notes are present using Set.has() directly
    let allNotesPresent = expectedNotes.size <= activeNotes.size;
    if (allNotesPresent) {
      for (const note of expectedNotes) {
        if (!activeNotes.has(note)) {
          allNotesPresent = false;
          break;
        }
      }
    }
    
    // Check no extra notes - both sets must be equal size if all expected are present
    const noExtraNotes = allNotesPresent && activeNotes.size === expectedNotes.size;
    
    if (allNotesPresent && noExtraNotes) {
      result = 'SUCCESS';
    } else if (allNotesPresent && !noExtraNotes) {
      // All required notes are present but there are extra notes
      result = 'FAIL'; // Could be 'PARTIAL' if we want to be more lenient
    } else {
      // Missing some required notes
      result = 'PARTIAL';
    }
  }
  
  if (process.env.NODE_ENV === 'development') {
    perfLogger.debug('[TIED_NOTES] Stage: Evaluation Result', {
      stage: 'practice_evaluation_result',
      result,
      expected: currentStep.notes.map(n => n.midiValue),
      played: Array.from(activeNotes),
      isChord: currentStep.isChord
    });
  }
  
  return result;
}

/**
 * Determine next step - O(1) pre-computed lookup or fallback to real-time OSMD
 */
function getNextStep(osmdControls: any, practiceStore: any): PracticeStepResult | null {
  if (!osmdControls) return null;
  
  // Get next practice step
  
  if (DEV) {
    perfLogger.debug('[GETNEXT DEBUG] getNextStep called', {
      hasOsmdControls: !!osmdControls,
      hasPracticeStore: !!practiceStore,
      preComputedSequenceFlag: Flags.preComputedSequence,
      hasGetCurrentOptimizedStep: !!practiceStore?.getCurrentOptimizedStep
    });
  }
  
  try {
    // Phase 1 optimization: Use pre-computed sequence when available
    // Add null check to prevent error when method doesn't exist
    if (Flags.preComputedSequence && practiceStore?.getCurrentOptimizedStep) {
      const optimizedStep = practiceStore.getCurrentOptimizedStep();
      if (DEV) {
        perfLogger.debug('[GETNEXT DEBUG] Using optimized path, got step:', {
          id: optimizedStep?.id,
          realDuration: optimizedStep?.realDuration,
          advanceAfterBeats: (optimizedStep as any)?.advanceAfterBeats,
          midiNotes: optimizedStep ? Array.from(optimizedStep.midiNotes) : []
        });
      }
      
      if (optimizedStep) {
        // Convert optimized step to practice step format
        // CRITICAL: Preserve realDuration AND advanceAfterBeats from optimized step!
        const practiceStep: PracticeStep & { realDuration?: number; ornaments?: any; id?: string; noteDurations?: any; advanceAfterBeats?: number } = {
          notes: Array.from(optimizedStep.midiNotes as number[]).map((midiValue: number) => ({
            midiValue,
            pitchName: midiToNoteName(midiValue), // Convert to proper note name
            octave: Math.floor(midiValue / 12),
          })),
          isChord: optimizedStep.isChord,
          isRest: optimizedStep.isRest,
          measureIndex: optimizedStep.measureIndex,
          timestamp: Date.now(),
          // Preserve duration and other fields from optimized step
          realDuration: optimizedStep.realDuration,
          advanceAfterBeats: (optimizedStep as any).advanceAfterBeats, // CRITICAL: Add this!
          ornaments: optimizedStep.ornaments,
          id: optimizedStep.id,
          midiNotes: optimizedStep.midiNotes, // Also preserve the Set for extractNoteDuration
          noteDurations: optimizedStep.noteDurations // Preserve per-note durations for sustain
        };
        
        if (DEV) {
          perfLogger.debug('[GETNEXT DEBUG] Returning optimized step:', {
            measureIndex: practiceStep.measureIndex,
            notes: practiceStep.notes.map(n => n.midiValue),
            realDuration: practiceStep.realDuration,
            advanceAfterBeats: practiceStep.advanceAfterBeats,
            hasOrnaments: !!practiceStep.ornaments,
            id: practiceStep.id,
            isPolyphonic: practiceStep.advanceAfterBeats && practiceStep.realDuration && 
                          practiceStep.advanceAfterBeats < practiceStep.realDuration
          });
        }
        
        // Advance to next step in optimized sequence for next call
        practiceStore.advanceOptimizedStep();
        
        return practiceStep;
      }
    }
    
    // Fallback: Real-time OSMD traversal (legacy path)
    if (DEV) perfLogger.debug('[CURSOR-SYNC] [GETNEXT DEBUG] Using fallback OSMD path - reading cursor position directly');
    const cursorStep = osmdControls.getExpectedNotesAtCursor();
    
    if (DEV) {
      // [CURSOR-SYNC] Enhanced debug for cursor step
      perfLogger.debug('[CURSOR-SYNC] OSMD cursor returned step:', {
        hasStep: !!cursorStep,
        stepType: cursorStep?.type || 'practice-step',
        isRest: cursorStep?.isRest,
        noteCount: cursorStep?.notes?.length || 0,
        measureIndex: cursorStep?.measureIndex,
        timestamp: Date.now()
      });
      
      perfLogger.debug('[GETNEXT DEBUG] OSMD returned:', {
        hasStep: !!cursorStep,
        measureIndex: cursorStep?.measureIndex,
        notes: cursorStep?.notes?.map((n: any) => n.midiValue)
      });
    }
    return cursorStep;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error : new Error(String(error));
    perfLogger.error('Failed to get next step:', errorMessage);
    return null;
  }
}

/**
 * Advance cursor to next position with measure range looping support
 */
function advanceCursor(osmdControls: any, osmd: any, options?: {
  currentMeasure?: number;
  measureTimeline?: MeasureTimeline;
  practiceStore?: any;
  scheduler?: any;
}): boolean {
  // Initialize cursor if it doesn't exist (OSMD requires getCursor() call)
  const cursor = osmd?.cursor || osmd?.getCursor?.();
  if (!cursor) {
    return false;
  }
  
  try {
    // Simple cursor advancement - let OSMD handle the details
    cursor.next();
    
    
    // MEASURE RANGE LOOPING: Check actual cursor position after advancement
    if (options?.currentMeasure !== undefined && options?.measureTimeline && options?.practiceStore) {
      const store = options.practiceStore.getState();
      
      // Only check boundaries if custom range is active
      if (store.customRangeActive) {
        const { customStartMeasure, customEndMeasure } = store;
        
        // Get actual new cursor position after advancement
        const actualNewMeasure = cursor.iterator?.currentMeasureIndex ?? 0;
        
        // Validate range to prevent infinite loops
        if (customStartMeasure >= 1 && customEndMeasure >= customStartMeasure) {
          
          // CRITICAL FIX: Convert user 1-based measures to OSMD 0-based measures
          const osmdEndMeasure = customEndMeasure - 1;
          
          perfLogger.debug('[MeasureRangeDebug] Boundary check:', {
            actualNewMeasure,
            userEndMeasure: customEndMeasure,
            osmdEndMeasure,
            willTrigger: actualNewMeasure > osmdEndMeasure
          });
          
          if (actualNewMeasure > osmdEndMeasure) {
            // Handle single-measure loop case explicitly
            if (customStartMeasure === customEndMeasure) {
              perfLogger.debug('[MeasureRangeLoop] Single-measure loop detected', {
                actualNewMeasure,
                loopMeasure: customStartMeasure
              });
            }
            
            perfLogger.debug('[MeasureRangeLoop] Reached end of range, looping back', {
              actualNewMeasure,
              customStartMeasure,
              customEndMeasure,
              osmdEndMeasure,
              isSingleMeasureLoop: customStartMeasure === customEndMeasure
            });
            
            // Convert 1-based user measure to 0-based timeline index
            const targetMeasureIndex = customStartMeasure - 1;
            
            perfLogger.debug('[MeasureRangeDebug] Looping back to start:', {
              userStartMeasure: customStartMeasure,
              osmdStartMeasure: targetMeasureIndex,
              seeking: true
            });
            
            // Additional validation for timeline bounds
            if (targetMeasureIndex < 0) {
              perfLogger.error('[MeasureRangeLoop] Invalid target measure index:', new Error(`Invalid target measure index: ${targetMeasureIndex}`));
              return false;
            }
            
            // 🔍 DEBUG: Capture state BEFORE seek operation
            const debugState = {
              beforeSeek: {
                cursorMeasure: cursor?.iterator?.currentMeasureIndex ?? 'unknown',
                cursorVoice: cursor?.iterator?.currentVoiceEntryIndex ?? 'unknown',
                currentStep: options.practiceStore?.getState().currentStep,
                expectedStep: null
              },
              afterSeek: {
                cursorMeasure: null as any,
                cursorVoice: null as any,
                actualStep: null as any
              }
            };
            
            // Get what step SHOULD be at target position for comparison
            try {
              const tempCursor = osmd?.cursor || osmd?.getCursor?.();
              if (tempCursor && options.measureTimeline) {
                tempCursor.reset();
                // Navigate to target measure to see what step should be there
                let attempts = 0;
                while (tempCursor.iterator?.currentMeasureIndex < targetMeasureIndex && 
                       !tempCursor.iterator?.EndReached && attempts < 100) {
                  tempCursor.next();
                  attempts++;
                }
                debugState.beforeSeek.expectedStep = osmdControls?.getExpectedNotesAtCursor?.() || 'unavailable';
              }
            } catch (error) {
              perfLogger.warn('[DEBUG] Could not get expected step:', error);
            }
            
            perfLogger.debug('🔍 [SEEK DEBUG] State before seek:', debugState.beforeSeek);
            
            // ENHANCED DEBUG: Capture complete cursor state BEFORE seek
            perfLogger.debug('[CURSOR DEBUG] === PRE-SEEK STATE ===');
            if (cursor?.cursorElement) {
              const elem = cursor.cursorElement;
              perfLogger.debug('[CURSOR DEBUG] Pre-seek DOM state:', {
                elementExists: true,
                computedDisplay: window.getComputedStyle(elem).display,
                computedVisibility: window.getComputedStyle(elem).visibility,
                computedOpacity: window.getComputedStyle(elem).opacity,
                classList: Array.from(elem.classList),
                parentExists: !!elem.parentElement,
                isConnected: elem.isConnected
              });
            } else {
              perfLogger.debug('[CURSOR DEBUG] Pre-seek: No cursorElement');
            }
            
            // Seek back to start measure using MeasureTimeline
            const seekSuccess = options.measureTimeline.seekToMeasure(targetMeasureIndex, cursor);
            
            if (seekSuccess) {
              // CRITICAL FIX: Reset optimized sequence to target measure
              if (options.practiceStore && cursor?.iterator) {
                const state = options.practiceStore.getState();
                const cursorMeasureIndex = cursor.iterator.currentMeasureIndex;
                
                // Single O(n) pass to find target step (replaces O(n²) nested searches)
                const cursorTimestamp = cursor.iterator.currentTimeStamp?.RealValue ||
                                       cursor.iterator.currentTimeStamp?.realValue;
                                       
                const targetStepIndex = findFirstStepInMeasure(
                  state.optimizedSequence,
                  cursorMeasureIndex,
                  cursorTimestamp
                );
                
                if (targetStepIndex >= 0) {
                  // Update optimized index and clear current step to force re-evaluation
                  options.practiceStore.setState({
                    currentOptimizedIndex: targetStepIndex,
                    currentStep: null
                  });
                  
                  perfLogger.debug('[MeasureRangeDebug] Synced with cursor position', {
                    cursorMeasureIndex,
                    targetStepIndex,
                    cursorVoiceEntry: cursor.iterator.currentVoiceEntryIndex,
                    requestedMeasure: targetMeasureIndex
                  });
                } else {
                  // Fallback: If no steps found in measure, reset to beginning
                  options.practiceStore.resetOptimizedSequence();
                  perfLogger.warn('[MeasureRangeDebug] No steps found in cursor measure', {
                    cursorMeasureIndex,
                    sequenceLength: state.optimizedSequence.length
                  });
                }
              }
              
              // 🔍 DEBUG: Capture state AFTER seek operation
              debugState.afterSeek = {
                cursorMeasure: cursor?.iterator?.currentMeasureIndex ?? 'unknown',
                cursorVoice: cursor?.iterator?.currentVoiceEntryIndex ?? 'unknown',
                actualStep: null
              };
              
              // Get what step is actually retrieved after seek
              try {
                debugState.afterSeek.actualStep = osmdControls?.getExpectedNotesAtCursor?.() || 'unavailable';
              } catch (error) {
                perfLogger.warn('[DEBUG] Could not get actual step after seek:', error);
              }
              
              perfLogger.debug('🔍 [SEEK DEBUG] State after seek:', debugState.afterSeek);
              
              // 🔍 DEBUG: Compare expected vs actual
              const beforeNotes = debugState.beforeSeek.currentStep?.notes?.map((n: any) => n.midiValue) || [];
              const expectedNotes = (debugState.beforeSeek.expectedStep && typeof debugState.beforeSeek.expectedStep === 'object' && 'notes' in debugState.beforeSeek.expectedStep) ? (debugState.beforeSeek.expectedStep as any).notes.map((n: any) => n.midiValue) : [];
              const actualNotes = debugState.afterSeek.actualStep?.notes?.map((n: any) => n.midiValue) || [];
              
              perfLogger.debug('🔍 [SEEK DEBUG] Note comparison:', {
                beforeSeekNotes: beforeNotes,
                expectedAtTarget: expectedNotes,
                actualAfterSeek: actualNotes,
                match: JSON.stringify(expectedNotes) === JSON.stringify(actualNotes),
                issue: JSON.stringify(expectedNotes) !== JSON.stringify(actualNotes) ? 'STEP DESYNC DETECTED' : 'OK'
              });
              
              // CRITICAL: Synchronize audio scheduler to prevent audio/visual desync
              if (options.scheduler?.seekToMeasure) {
                try {
                  options.scheduler.seekToMeasure(targetMeasureIndex);
                  perfLogger.debug('[MeasureRangeLoop] Audio scheduler synchronized to measure index:', targetMeasureIndex);
                } catch (error) {
                  perfLogger.warn('[MeasureRangeLoop] Audio scheduler sync failed:', error);
                }
              }
              
              perfLogger.debug('[MeasureRangeDebug] ✅ LOOP SUCCESS: Returned to start measure');
              perfLogger.debug('[MeasureRangeLoop] Successfully looped back to start measure');
              
              // CRITICAL FIX: Show cursor and synchronize practice step
              
              
              
              // Simplified synchronization - always sync the step after seek
              const syncStep = () => {
                // Performance guard: eliminate unguarded logging allocations in production
                const DEV = process.env.NODE_ENV !== 'production';
                // MINIMAL FIX: Reset cursor hidden state right before use
                // OSMD sets cursor.hidden = true after seeking to position 0,0
                if (cursor?.hidden === true) {
                  cursor.hidden = false;
                  cursor.show();
                  cursor.update();
                }
                
                const nextStep = getNextStep(osmdControls, options.practiceStore);
                
                if (nextStep && isPracticeStep(nextStep)) {
                  options.practiceStore?.setCurrentStep(nextStep);
                  if (DEV) {
                    perfLogger.debug('[MeasureRangeDebug] ✅ Practice step synchronized:', 
                      nextStep.notes.map(n => n.midiValue));
                  }
                }
              };
              
              // Try async wait first, but always fallback to sync
              if (cursor) {
                waitForCursorReady(cursor)
                  .then(syncStep)
                  .catch(() => {
                    perfLogger.warn('[MeasureRangeDebug] Cursor not ready, syncing anyway');
                    syncStep();
                  });
              } else {
                perfLogger.warn('[MeasureRangeDebug] No cursor available');
                syncStep();
              }
              
              return true;
            } else {
              perfLogger.error('[MeasureRangeLoop] Failed to seek to start measure');
              return false;
            }
          }
        } else {
          perfLogger.warn('[MeasureRangeLoop] Invalid measure range detected:', {
            customStartMeasure,
            customEndMeasure
          });
        }
      }
    }
    
    
    // CRITICAL FIX: Force visual cursor update after position change
    // This ensures the cursor visually moves after calling next()
    if (cursor.show) {
      cursor.show();
    }
    
    // OSMD requires update() to trigger visual refresh after show()
    if (cursor.update) {
      cursor.update();
    }
    
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error : new Error(String(error));
    perfLogger.error('Cursor advancement failed:', errorMessage);
    return false;
  }
}

/**
 * Extract note duration from practice step for tempo-based timing
 * PHASE 1: Critical missing function identified by code review
 * 
 * @param practiceStep Current practice step with note information
 * @returns Beat fraction (1.0 = quarter note, 2.0 = half note, 0.5 = eighth note)
 */
function getStepAdvancementBeats(practiceStep: PracticeStep | null): number {
  // Check for cursor advancement timing first
  const step = practiceStep as any;
  
  // Debug log what we received
  if (process.env.NODE_ENV === 'development') {
    perfLogger.debug('[POLYPHONIC_DEBUG] getStepAdvancementBeats input', {
      hasStep: !!step,
      stepId: step?.id,
      advanceAfterBeats: step?.advanceAfterBeats,
      realDuration: step?.realDuration,
      hasAdvanceField: step?.advanceAfterBeats !== undefined,
      hasRealDurationField: step?.realDuration !== undefined
    });
  }
  
  // Simple timing: use the step's duration
  if (step?.advanceAfterBeats !== undefined) {
    return step.advanceAfterBeats;
  }
  
  // Fallback to realDuration if advanceAfterBeats not set
  if (step?.realDuration !== undefined) {
    return step.realDuration;
  }
  
  // Check why realDuration is missing and provide fallback
  let fallbackReason = 'unknown';
  if (!practiceStep) {
    fallbackReason = 'no practiceStep';
  } else if (!step.realDuration && step.realDuration !== 0) {
    fallbackReason = 'realDuration undefined';
  }
  
  // Default to quarter note if no step or note information
  if (!practiceStep || !practiceStep.notes || practiceStep.notes.length === 0) {
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug('[DURATION_DEBUG] Fallback - No notes', {
        stepId: step?.id || 'unknown',
        midiNotes: Array.from(step?.midiNotes || []),
        fallbackReason: fallbackReason,
        fallbackUsed: true,
        isRest: !practiceStep || practiceStep.notes?.length === 0
      });
    }
    return 1.0; // Quarter note default
  }

  // For chords, use the first note's duration (all notes in chord have same duration)
  const firstNote = practiceStep.notes[0];
  
  // Check if note has duration information
  // Note: This depends on how OSMD provides duration data in the practice step
  // May need adjustment based on actual OSMD data structure
  if (firstNote && typeof firstNote === 'object' && 'duration' in firstNote) {
    const duration = (firstNote as any).duration;
    
    // Map OSMD duration values to beat fractions
    // Based on standard musical note duration conventions
    const durationMap: Record<string, number> = {
      'whole': 4.0,      // Whole note = 4 beats
      'half': 2.0,       // Half note = 2 beats  
      'quarter': 1.0,    // Quarter note = 1 beat (base unit)
      'eighth': 0.5,     // Eighth note = 0.5 beats
      'sixteenth': 0.25, // Sixteenth note = 0.25 beats
      '32nd': 0.125,     // Thirty-second note = 0.125 beats
      
      // Alternative naming conventions
      '1': 4.0,          // Whole note alternative
      '2': 2.0,          // Half note alternative  
      '4': 1.0,          // Quarter note alternative
      '8': 0.5,          // Eighth note alternative
      '16': 0.25,        // Sixteenth note alternative
      '32': 0.125        // Thirty-second note alternative
    };
    
    // Get base duration from map
    const baseDuration = durationMap[String(duration)] || 1.0;
    
    // Handle dotted notes (multiply by 1.5)
    // Check for dotted flag in note data
    const isDotted = (firstNote as any).isDotted || (firstNote as any).dotted || false;
    const finalDuration = isDotted ? baseDuration * 1.5 : baseDuration;
    
    // Debug logging for fallback case (LOG 2 fallback)
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug('[DURATION_DEBUG] Fallback - String mapping', {
        stepId: (practiceStep as any)?.id || 'unknown',
        midiNotes: Array.from((practiceStep as any)?.midiNotes || []),
        durationString: String(duration),
        baseDuration: baseDuration,
        isDotted: isDotted,
        fallbackUsed: true,
        fallbackReason: 'using duration string mapping',
        isRest: (practiceStep as any)?.midiNotes?.size === 0 || false
      });
    }
    
    return finalDuration;
  }
  
  // Fallback: Try to infer from note name or other properties
  // This is a backup in case duration isn't directly available
  // TODO: May need to enhance based on actual OSMD data structure
  
  return 1.0; // Default to quarter note
}

// ============================================================================
// STATE MACHINE REDUCER (Pure state transitions)
// ============================================================================

const initialState: PracticeState = {
  status: 'idle',
  currentStep: null,
  currentIdx: 0,
  score: 0,
  activeNotes: new Set<number>(),
  // PHASE 2: Repeat state
  repeatActive: false,
  repeatMeasure: null,
  currentMeasure: 0,
};

function practiceReducer(state: PracticeState, action: PracticeAction): PracticeState {
  // Performance guard: eliminate unguarded logging allocations in production
  const DEV = process.env.NODE_ENV !== 'production';
  // FIXED: Handle MIDI_NOTE_OFF to track active notes for chord evaluation
  if (action.type === 'MIDI_NOTE_OFF') {
    const newActiveNotes = new Set(state.activeNotes);
    newActiveNotes.delete(action.payload.note);
    
    // Debug logging for note releases
    if (DEV && state.currentStep?.isChord && state.status === 'practiceListening') {
      logger.practice('V2 Note Release', { released: action.payload.note, remainingActive: Array.from(newActiveNotes) });
    }
    
    return { ...state, activeNotes: newActiveNotes };
  }

  // PHASE 2: Handle repeat-related actions
  if (action.type === 'TOGGLE_REPEAT') {
    if (state.repeatActive) {
      // Turn off
      return {
        ...state,
        repeatActive: false,
        repeatMeasure: null
      };
    } else {
      // Turn on for current measure
      return {
        ...state,
        repeatActive: true,
        repeatMeasure: state.currentMeasure
      };
    }
  }

  if (action.type === 'SET_CURRENT_MEASURE') {
    if (DEV) {
      perfLogger.debug('[MeasureRangeDebug] SET_CURRENT_MEASURE dispatched:', {
        from: state.currentMeasure,
        to: action.payload,
        status: state.status
      });
    }
    return {
      ...state,
      currentMeasure: action.payload
    };
  }

  // Debug log all state transitions
  if (action.type !== 'MIDI_NOTE_ON' && action.type !== 'MIDI_NOTE_OFF') {
    console.log(`[RESTDEBUG-STATE] ${state.status} + ${action.type} → ?`);
  }
  
  switch (state.status) {
    case 'idle':
      if (action.type === 'START_CLICK') {
        console.log(`[RESTDEBUG-START-CLICK] 🚀 START_CLICK received - transitioning from idle to loading`);
        perfLogger.debug('[V2 State Machine] Transitioning from idle to loading');
        return { ...state, status: 'loading' };
      }
      if (action.type === 'STOP_CLICK') {
        perfLogger.debug('[V2 State Machine] STOP_CLICK received in idle state - already idle');
        // Stay in idle when already idle
        return state;
      }
      return state;

    case 'loading':
      if (action.type === 'ASSETS_LOADED') {
        // FIXED: Transition directly to practiceListening for single-click start
        perfLogger.debug('[V2 State Machine] Assets loaded, transitioning directly to practiceListening');
        return { ...state, status: 'practiceListening' };
      }
      if (action.type === 'ADVANCE_DONE') {
        // Handle initial step setup during loading
        if (isPracticeStep(action.payload.nextStep)) {
          // CURSOR-SYNC Debug initial step processing using system category
          logger.system('🎯 CURSOR-SYNC: Processing initial step for practice start', {
            isRest: action.payload.nextStep.isRest,
            noteCount: action.payload.nextStep.notes?.length || 0,
            measureIndex: action.payload.nextStep.measureIndex,
            timestamp: Date.now()
          });

          // NOTE: OSMD cursor synchronization handled in effect to avoid ref scope issues
          
          // POLYPHONIC FIX: Check if initial step is a rest and settings allow auto-advance
          const targetStatus = action.payload.nextStep.isRest && action.payload.autoAdvanceRests
            ? 'practiceFeedbackCorrect' 
            : 'practiceListening';
          
          console.log(`[RESTDEBUG-ADVANCE-DONE-1] Step: ${action.payload.nextStep.isRest ? 'REST' : 'NOTE'}, autoAdvanceRests: ${action.payload.autoAdvanceRests}, targetStatus: ${targetStatus}`);
          logger.system(`🎯 CURSOR-SYNC: Initial step loaded, transitioning to ${targetStatus}`);
          
          if (action.payload.nextStep.isRest) {
            console.log(`[RESTDEBUG-ADVANCE-DONE-1] 🚨 STARTING PRACTICE ON REST - autoAdvanceRests=${action.payload.autoAdvanceRests}`);
            logger.system('🚨 CURSOR-SYNC: STARTING PRACTICE ON REST - this indicates positioning mismatch!');
          }
          return {
            ...state,
            status: targetStatus,
            currentStep: action.payload.nextStep,
            currentIdx: 0,
          };
        }
      }
      if (action.type === 'UNRECOVERABLE_ERROR') {
        return { ...state, status: 'error', error: action.payload.error };
      }
      return state;

    case 'ready':
      if (action.type === 'START_CLICK') {
        // MEASURE RANGE FIX: Force through loading state to ensure sequence synchronization
        return { ...state, status: 'loading' };
      }
      if (action.type === 'ADVANCE_DONE') {
        // Handle setting currentStep if it arrives while in ready state
        if (isPracticeStep(action.payload.nextStep) && !state.currentStep) {
          return {
            ...state,
            currentStep: action.payload.nextStep,
          };
        }
      }
      return state;

    case 'practiceListening':
      if (action.type === 'MIDI_NOTE_ON') {
        // FIXED: Add note to activeNotes and trigger evaluation
        const newActiveNotes = new Set(state.activeNotes);
        newActiveNotes.add(action.payload.note);
        
        // Immediately evaluate with the new active notes
        const evaluation = evaluateActiveNotes(newActiveNotes, state.currentStep);
        
        // Debug logging for chord evaluation
        if (DEV && state.currentStep?.isChord) {
          logger.practice('V2 Chord Evaluation', { 
            activeNotes: Array.from(newActiveNotes), 
            expected: state.currentStep.notes.map(n => n.midiValue),
            result: evaluation 
          });
        }
        
        // Only transition to evaluating if we have a definitive result
        if (evaluation === 'SUCCESS' || (evaluation === 'FAIL' && !state.currentStep?.isChord)) {
          return {
            ...state,
            status: 'practiceEvaluating',
            lastNote: action.payload.note,
            activeNotes: newActiveNotes,
          };
        }
        
        // For chords with PARTIAL result, stay in listening state
        return {
          ...state,
          activeNotes: newActiveNotes,
        };
      }
      if (action.type === 'NOTE_TIMEOUT') {
        return { ...state, status: 'practiceFeedbackIncorrect' };
      }
      if (action.type === 'PAUSE_CLICK') {
        return { ...state, status: 'paused', previousStatus: 'practiceListening' };
      }
      if (action.type === 'STOP_CLICK') {
        perfLogger.debug('[V2 State Machine] STOP_CLICK received in practiceListening - transitioning to ready');
        perfLogger.debug('[V2 State Machine] Stack trace for STOP_CLICK');
        // FIXED: Transition to 'ready' instead of 'idle' so restart doesn't reload assets
        return { ...state, status: 'ready', currentStep: null, currentIdx: 0 };
      }
      return state;

    case 'practiceEvaluating':
      if (action.type === 'EVAL_SUCCESS') {
        return {
          ...state,
          status: 'practiceFeedbackCorrect',
          score: state.score + 1,
        };
      }
      if (action.type === 'EVAL_FAIL') {
        return { ...state, status: 'practiceFeedbackIncorrect' };
      }
      return state;

    case 'practiceFeedbackCorrect':
      if (action.type === 'FEEDBACK_TIMEOUT') {
        // CORRECT: Advance to next note
        console.log(`[RESTDEBUG-FEEDBACK-TIMEOUT] 🎯 FEEDBACK_TIMEOUT received in practiceFeedbackCorrect state - advancing to next step`);
        perfLogger.debug('[CURSOR-SYNC] FEEDBACK_TIMEOUT: Advancing to next step (correct feedback complete)');
        return { ...state, status: 'advancing' };
      }
      if (action.type === 'PAUSE_CLICK') {
        return { ...state, status: 'paused', previousStatus: state.status };
      }
      if (action.type === 'STOP_CLICK') {
        // FIXED: Transition to 'ready' for quick restart
        return { ...state, status: 'ready', currentStep: null, currentIdx: 0, activeNotes: new Set<number>() };
      }
      return state;

    case 'practiceFeedbackIncorrect':
      if (action.type === 'FEEDBACK_TIMEOUT') {
        // INCORRECT: Return to listening for SAME note (no advancement)
        perfLogger.debug('[CURSOR-SYNC] FEEDBACK_TIMEOUT: Returning to listening for retry (incorrect feedback, no cursor advancement)');
        perfLogger.debug('[V2 State Machine] Incorrect feedback timeout - returning to practiceListening for retry');
        return { ...state, status: 'practiceListening' };
      }
      if (action.type === 'PAUSE_CLICK') {
        return { ...state, status: 'paused', previousStatus: state.status };
      }
      if (action.type === 'STOP_CLICK') {
        // FIXED: Transition to 'ready' for quick restart
        return { ...state, status: 'ready', currentStep: null, currentIdx: 0, activeNotes: new Set<number>() };
      }
      return state;

    case 'advancing':
      if (action.type === 'ADVANCE_DONE') {
        if (isPracticeStep(action.payload.nextStep)) {
          // POLYPHONIC FIX: If next step is a rest and settings allow auto-advance, skip listening state
          if (action.payload.nextStep.isRest && action.payload.autoAdvanceRests) {
            console.log(`[RESTDEBUG-ADVANCE-DONE-2] 🟢 REST with auto-advance enabled → practiceFeedbackCorrect`);
            perfLogger.debug('[CURSOR-SYNC] ADVANCE_DONE: Next step is REST - skipping to feedback state (auto-advance):', {
              measureIndex: action.payload.nextStep.measureIndex,
              stepIndex: state.currentIdx + 1,
              timestamp: Date.now()
            });
            return {
              ...state,
              status: 'practiceFeedbackCorrect', // Skip directly to timed delay
              currentStep: action.payload.nextStep,
              currentIdx: state.currentIdx + 1,
              activeNotes: new Set<number>(),
            };
          }
          // Normal notes/chords go to listening state
          perfLogger.debug('[CURSOR-SYNC] ADVANCE_DONE: Next step is PLAYABLE - transitioning to listening state:', {
            measureIndex: action.payload.nextStep.measureIndex,
            stepIndex: state.currentIdx + 1,
            noteCount: action.payload.nextStep.notes?.length || 0,
            expectedNotes: action.payload.nextStep.notes?.map(n => n.midiValue) || [],
            timestamp: Date.now()
          });
          return {
            ...state,
            status: 'practiceListening',
            currentStep: action.payload.nextStep,
            currentIdx: state.currentIdx + 1,
            // FIXED: Clear activeNotes when advancing to prevent note spillover
            activeNotes: new Set<number>(),
          };
        } else {
          // End of piece or error
          return { ...state, status: 'completed', activeNotes: new Set<number>() };
        }
      }
      return state;

    case 'paused':
      if (action.type === 'RESUME_CLICK') {
        return {
          ...state,
          status: state.previousStatus || 'practiceListening',
          previousStatus: undefined,
        };
      }
      if (action.type === 'STOP_CLICK') {
        return { ...state, status: 'idle', currentStep: null, currentIdx: 0, previousStatus: undefined };
      }
      return state;

    case 'completed':
    case 'error':
      if (action.type === 'START_CLICK') {
        return { ...state, status: 'loading', error: undefined, score: 0, currentIdx: 0 };
      }
      return state;

    default:
      return state;
  }
}

// ============================================================================
// MAIN HOOK (Orchestrator using state machine)
// ============================================================================

export function usePracticeControllerV2() {
  // Performance guard: eliminate unguarded logging allocations in production
  const DEV = process.env.NODE_ENV !== 'production';
  
  const [state, dispatch] = useReducer(practiceReducer, initialState);
  const { controls: osmdControls, osmd, isReady: osmdReady, measureTimeline } = useOSMDContext();
  const { subscribeMidiEvents } = useMidiContext();
  
  // PHASE 1: Tempo-aware cursor advancement services
  // Note: Will be wrapped with TempoServicesProvider in Task 1.4
  const { tempoService, scheduler } = useTempoServices();
  
  // Store compatibility for gradual transition
  const practiceStore = usePracticeStore();
  const setIsActive = usePracticeStore((state: any) => state.setIsActive);
  
  // Settings access for rest auto-advance behavior
  const difficultyService = useMemo(() => new SimpleAdaptiveDifficulty(), []);
  // Get fresh settings on each render to ensure reactivity to user changes
  const settings = difficultyService.getSettings();
  
  // Track performance for <20ms latency requirement
  const latencyStartRef = useRef<number>(0);
  
  // Prevent immediate stop after start (React StrictMode protection)
  const startTimeRef = useRef<number>(0);
  
  // PHASE 2: Repeat service refs
  const adapterRef = useRef<V2RepeatAdapter | null>(null);
  const repeatManagerRef = useRef<PracticeRepeatManager | null>(null);
  
  // PHASE 3: Race condition prevention refs
  const currentSeekId = useRef<number>(0);
  const osmdStateVersion = useRef<number>(0);
  const isMounted = useRef<boolean>(true);
  
  // PHASE 0: Performance instrumentation and session timing
  const sessionTimingRef = useRef({
    advancementTimes: [] as number[],
    totalAdvancementCount: 0,
    performanceViolations: 0,
    sessionStartTime: 0,
    tempoAwareAdvancementCount: 0, // For Phase 1 integration
    averageTempoDelay: 0 // For Phase 1 integration
  });
  
  // CRITICAL FIX: Store latest OSMD controls/state to avoid stale closures
  const osmdLatestRef = useRef({ osmdControls, osmd, osmdReady });
  useEffect(() => {
    osmdLatestRef.current = { osmdControls, osmd, osmdReady };
  }, [osmdControls, osmd, osmdReady]);
  
  // PHASE 3: Track component mount state for cleanup
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  
  // PHASE 3: Track OSMD state changes
  useEffect(() => {
    osmdStateVersion.current++;
  }, [osmd, osmdReady]);

  // PHASE 0: Measure cursor advancement latency (moved here to fix hoisting issue)
  const measureAdvancementLatency = useCallback(() => {
    const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    return {
      markComplete: () => {
        const duration = (typeof performance !== 'undefined' && performance.now) ? performance.now() - start : Date.now() - start;
        
        if (sessionTimingRef.current) {
          sessionTimingRef.current.advancementTimes.push(duration);
          sessionTimingRef.current.totalAdvancementCount++;
          
          // Calculate moving average of last 10 measurements
          const recent = sessionTimingRef.current.advancementTimes.slice(-10);
          const avg = recent.reduce((sum, t) => sum + t, 0) / recent.length;
          // Store average in advancementTimes array for reference
          // Note: Using advancementTimes array as the data structure
          const currentTimes = sessionTimingRef.current.advancementTimes;
          if (currentTimes.length > 0) {
            // Update the timing data (avg calculated but not stored separately)
          }
          
        }
      }
    };
  }, []);

  // ========================================================================
  // PHASE 1: IMMEDIATE CURSOR SEEK FUNCTIONS
  // ========================================================================

  /**
   * Seek OSMD cursor to a specific measure and synchronize practice state
   * PHASE 3: Enhanced with race condition prevention and comprehensive error handling
   * 
   * @param targetMeasureIndex - 0-based measure index to seek to
   * @param seekId - Optional seek ID for cancellation tracking
   * @param stateVersion - Optional OSMD state version for staleness detection
   * @returns Promise<boolean> - true if seek succeeded, false otherwise
   */
  const seekToMeasureAndSync = useCallback(async (
    targetMeasureIndex: number,
    seekId?: number,
    stateVersion?: number
  ): Promise<boolean> => {
    const startTime = performance.now();
    
    try {
      const cursor = osmd?.cursor;
      if (!cursor || !measureTimeline) {
        perfLogger.error('[Seek] Missing cursor or measureTimeline');
        return false;
      }

      // Early cancellation check
      if (seekId !== undefined && currentSeekId.current !== seekId) {
        perfLogger.debug('[Seek] Cancelled - newer seek in progress');
        return false;
      }

      // OSMD state validation
      if (stateVersion !== undefined && osmdStateVersion.current !== stateVersion) {
        perfLogger.warn('[Seek] OSMD state changed during seek');
        return false;
      }

      // Validate measure bounds for large scores
      const totalMeasures = measureTimeline.getMeasureCount();
      if (targetMeasureIndex < 0 || targetMeasureIndex >= totalMeasures) {
        perfLogger.error('[Seek] Invalid measure index for score size', new Error(`Invalid measure index ${targetMeasureIndex} for score size ${totalMeasures}`));
        return false;
      }

      // Performance optimization for large scores
      const currentMeasure = cursor.iterator?.currentMeasureIndex ?? 0;
      const measureDistance = Math.abs(targetMeasureIndex - currentMeasure);
      if (measureDistance > 100) {
        perfLogger.info('[Seek] Large jump detected', { distance: measureDistance });
      }
      
      const success = measureTimeline.seekToMeasure(targetMeasureIndex, cursor);
      if (!success) {
        perfLogger.error('[Seek] Failed to seek to measure:', new Error(`Failed to seek to measure ${targetMeasureIndex}`));
        
        // Auto-recovery: fall back to last valid position
        const lastValid = usePracticeStore.getState().lastValidMeasureIndex;
        if (lastValid !== undefined && lastValid !== targetMeasureIndex) {
          perfLogger.warn('[Seek] Attempting recovery to last valid position');
          const recoverySuccess = measureTimeline.seekToMeasure(lastValid, cursor);
          return recoverySuccess;
        }
        
        return false;
      }
      await waitForCursorReady(cursor);

      // Multiple staleness checks
      if (seekId !== undefined && currentSeekId.current !== seekId) {
        perfLogger.debug('[Seek] Cancelled during wait - newer seek started');
        return false;
      }
      
      if (stateVersion !== undefined && osmdStateVersion.current !== stateVersion) {
        perfLogger.debug('[Seek] Cancelled during wait - OSMD state changed');
        return false;
      }
      
      // Check if component unmounted
      if (!isMounted.current) {
        perfLogger.debug('[Seek] Cancelled - component unmounted');
        return false;
      }

      // Handle cursor visibility with validation
      // Note: cursor.hidden is the correct OSMD boolean property (not cursor.hide which is a method)
      if ((cursor as any).hidden === true) {
        (cursor as any).hidden = false;
        cursor.show();
        cursor.update();
      }

      // Verify cursor actually moved
      const actualMeasure = cursor.iterator?.currentMeasureIndex;
      if (actualMeasure !== targetMeasureIndex) {
        perfLogger.error('[Seek] Cursor position mismatch', new Error(`Expected measure ${targetMeasureIndex}, got ${actualMeasure}`));
        return false;
      }
      
      // CRITICAL: Sync the optimized sequence index with cursor position
      const state = usePracticeStore.getState();
      const cursorTimestamp = cursor.iterator.currentTimeStamp?.RealValue ||
                             cursor.iterator.currentTimeStamp?.realValue;
      
      // Single O(n) pass to find target step (replaces O(n²) nested searches)
      const targetStepIndex = findFirstStepInMeasure(
        state.optimizedSequence,
        actualMeasure,
        cursorTimestamp
      );
      
      if (targetStepIndex >= 0) {
        // Set the index to match cursor position
        usePracticeStore.setState({ currentOptimizedIndex: targetStepIndex });
      } else {
        // If no matching step found, reset to beginning of sequence
        practiceStore.resetOptimizedSequence();
      }
      
      const nextStep = getNextStep(osmdControls, practiceStore);
      if (nextStep && isPracticeStep(nextStep)) {
        // Final staleness check before state mutation
        if (seekId !== undefined && currentSeekId.current !== seekId) {
          return false;
        }
        
        // DEBUG: Track state sync timing issue
        perfLogger.debug('[SEEK-DEBUG] About to set state machine step', {
          stepMeasureIndex: nextStep.measureIndex,
          measureIndex: targetMeasureIndex,
          timestamp: performance.now()
        });
        
        // Update both Zustand store AND state machine
        practiceStore?.setCurrentStep(nextStep);
        practiceStore?.setCurrentMeasure(targetMeasureIndex);
        
        // CRITICAL FIX: Dispatch to state machine to sync practice step
        dispatch({ 
          type: 'ADVANCE_DONE', 
          payload: { nextStep, autoAdvanceRests: settings.autoAdvanceRests } 
        });
        
        // DEBUG: Check Zustand store state immediately after state machine update
        const zustandState = usePracticeStore.getState();
        perfLogger.debug('[SEEK-DEBUG] Zustand state after state machine update', {
          currentStep: zustandState.currentStep?.measureIndex || 'NULL',
          isActive: zustandState.isActive,
          status: zustandState.status,
          timestamp: performance.now()
        });
        
        // On success, update last valid position
        practiceStore?.setLastValidMeasureIndex(targetMeasureIndex);
        
        const duration = performance.now() - startTime;
        
        // Different thresholds for large scores
        const threshold = measureDistance > 100 ? 100 : 35;
        if (duration > threshold) {
          perfLogger.warn(`[Seek] Latency warning: ${duration.toFixed(2)}ms (threshold: ${threshold}ms)`);
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error : new Error(String(error));
      perfLogger.error('[Seek] Error during seek operation:', errorMessage);
      
      // Attempt recovery on error
      const lastValid = usePracticeStore.getState().lastValidMeasureIndex;
      if (lastValid !== undefined && lastValid > 0) {
        try {
          if (measureTimeline) {
            await measureTimeline.seekToMeasure(lastValid, osmd?.cursor);
          }
        } catch (recoveryError: unknown) {
          const recoveryErrorMessage = recoveryError instanceof Error ? recoveryError : new Error(String(recoveryError));
          perfLogger.error('[Seek] Recovery also failed:', recoveryErrorMessage);
        }
      }
      
      return false;
    }
  }, [osmd, measureTimeline, osmdControls, practiceStore, dispatch]);

  // ========================================================================
  // SIDE EFFECTS (useEffect responding to state changes)
  // ========================================================================

  // Listening timeout effect
  useEffect(() => {
    if (state.status === 'practiceListening') {
      const timerId = setTimeout(() => {
        dispatch({ type: 'NOTE_TIMEOUT' });
      }, TIMING_CONFIG.NOTE_TIMEOUT_MS);

      return () => clearTimeout(timerId);
    }
  }, [state.status]);

  // Feedback timeout effect - PHASE 1: Enhanced with tempo-aware timing
  useEffect(() => {
    if (state.status === 'practiceFeedbackCorrect' || state.status === 'practiceFeedbackIncorrect') {
      console.log(`[RESTDEBUG-FEEDBACK-TIMEOUT] 🕐 Feedback timeout effect triggered: status=${state.status}, step=${state.currentStep?.isRest ? 'REST' : 'NOTE'}`);
      let duration: number;
      let baseDuration: number = 0; // Declare outside try block for access in catch/debug
      
      if (state.status === 'practiceFeedbackCorrect') {
        // PHASE 1: Use tempo-based calculation for correct feedback
        try {
          const noteDuration = getStepAdvancementBeats(state.currentStep);
          
          // Debug log the complete state data
          if (process.env.NODE_ENV === 'development') {
            const stepData = state.currentStep as any;
            perfLogger.debug('[POLYPHONIC_DEBUG] Feedback scheduling data', {
              stepId: stepData?.id,
              noteDurationReturned: noteDuration,
              advanceAfterBeats: stepData?.advanceAfterBeats,
              realDuration: stepData?.realDuration,
              midiNotes: stepData?.midiNotes ? Array.from(stepData.midiNotes).slice(0, 5) : [],
              noteDurations: stepData?.noteDurations?.slice(0, 3),
              isPolyphonicStep: stepData?.advanceAfterBeats !== undefined && 
                               stepData?.realDuration !== undefined &&
                               stepData.advanceAfterBeats < stepData.realDuration
            });
          }
          
          baseDuration = tempoService.computeDelay(noteDuration, state.currentStep?.id);
          
          // Check if current step has ornaments (grace notes)
          const step = state.currentStep as any;
          const hasOrnaments = step?.ornaments && step.ornaments.length > 0;
          
          if (hasOrnaments) {
            // Handle grace notes with bounded time-stealing
            const ornamentTiming = tempoService.computeOrnamentTiming(
              baseDuration, 
              step.ornaments.length
            );
            
            // Schedule grace notes with rapid timing
            let graceDelay = 0;
            step.ornaments.forEach((ornament: { midiNote: number }, index: number) => {
              scheduler.scheduleCallback(() => {
                // Optional: Add visual feedback for grace notes
                perfLogger.debug('[GRACE_NOTES] Playing ornament', {
                  midiNote: ornament.midiNote,
                  delay: graceDelay,
                  index
                });
              }, graceDelay);
              
              graceDelay += ornamentTiming.graceDelayMs;
            });
            
            // Use adjusted duration for principal note
            duration = ornamentTiming.principalAdjustedMs;
          } else {
            // No ornaments - use standard duration
            duration = baseDuration;
          }
          
          // Performance instrumentation
          const timing = measureAdvancementLatency();
          
          // Debug logging for scheduling (LOG 4)
          if (process.env.NODE_ENV === 'development') {
            // Handle both Set and Array for midiNotes
            const midiNotesArray = step?.midiNotes instanceof Set 
              ? Array.from(step.midiNotes)
              : Array.from(state.currentStep.midiNotes || []);
              
            const perNoteDurations = step?.noteDurations || (state.currentStep as any)?.noteDurations;
            
            perfLogger.debug('[DURATION_DEBUG] Scheduling Step', {
              stepId: step?.id || state.currentStep.id || 'unknown',
              midiNotes: midiNotesArray,
              hasOrnaments: !!step?.ornaments,
              scheduledDelayMs: duration,
              hasTie: step?.tieType || 'none',
              isRest: midiNotesArray.length === 0,
              noteDuration: noteDuration,
              perNoteDurations: perNoteDurations?.map((n: any) => ({ midi: n.midi, beats: n.durationBeats })),
              maxNoteDuration: perNoteDurations ? Math.max(...perNoteDurations.map((n: any) => n.durationBeats)) : undefined,
              holdRequired: perNoteDurations && noteDuration < Math.max(...perNoteDurations.map((n: any) => n.durationBeats))
            });
          }
          
          // POLYPHONIC FIX: Per-note visual sustain scheduling
          // Schedule visual note-offs based on individual note durations
          if (perNoteDurations && state.status === 'practiceFeedbackCorrect') {
            perNoteDurations.forEach((noteData: { midi: number; durationBeats: number }) => {
              const noteOffDelayMs = tempoService.computeDelay(noteData.durationBeats, step?.id || state.currentStep?.id);
              scheduler.scheduleCallback(() => {
                animateNoteOff(noteData.midi);
              }, noteOffDelayMs);
            });
          }
          
          // Use WebAudio scheduler for precise timing (cursor advancement)
          scheduler.scheduleCallback(() => {
            // CRITICAL DEBUG: Log when the timer actually fires
            if (process.env.NODE_ENV === 'development') {
              perfLogger.warn('[BPM_TIMING_DEBUG] Timer fired - dispatching FEEDBACK_TIMEOUT', {
                stepId: state.currentStep?.id || 'unknown',
                scheduledDelayMs: duration,
                timerFireTime: performance.now(),
                aboutToAdvanceCursor: true
              });
            }
            
            timing.markComplete();
            console.log(`[RESTDEBUG-FEEDBACK-TIMEOUT] ⏰ WebAudio scheduler firing FEEDBACK_TIMEOUT for ${state.currentStep?.isRest ? 'REST' : 'NOTE'}`);
            dispatch({ type: 'FEEDBACK_TIMEOUT' });
          }, duration);
          
          // No cleanup needed for WebAudio scheduler - it handles its own cleanup
          return;
          
        } catch (error) {
          // Fallback to setTimeout with tempo-based timing
          perfLogger.warn('[V2 Practice Controller] WebAudio scheduler failed, using setTimeout with tempo-based timing:', error);
          // duration already set to baseDuration above, no need to override
        }
      } else {
        // Keep incorrect feedback timing unchanged (1000ms)
        duration = TIMING_CONFIG.FEEDBACK_INCORRECT_MS;
      }
      
      // Fallback setTimeout for incorrect feedback or scheduler failure
      const timerId = setTimeout(() => {
        console.log(`[RESTDEBUG-FEEDBACK-TIMEOUT] ⏰ Fallback setTimeout firing FEEDBACK_TIMEOUT for ${state.currentStep?.isRest ? 'REST' : 'NOTE'} after ${duration}ms`);
        dispatch({ type: 'FEEDBACK_TIMEOUT' });
      }, duration);

      return () => clearTimeout(timerId);
    }
  }, [state.status, state.currentStep, tempoService, scheduler, measureAdvancementLatency]);

  // Evaluation effect (triggers after MIDI_NOTE_ON)
  useEffect(() => {
    if (state.status === 'practiceEvaluating' && state.lastNote !== undefined) {
      // Measure latency performance
      latencyMonitor.startMeasure('note-evaluation-v2');
      
      // FIXED: Use activeNotes for evaluation instead of single note
      const result = evaluateActiveNotes(state.activeNotes, state.currentStep);
      
      latencyMonitor.endMeasure('note-evaluation-v2');
      
      // Dispatch evaluation result
      if (result === 'SUCCESS') {
        dispatch({ type: 'EVAL_SUCCESS' });
      } else {
        dispatch({ type: 'EVAL_FAIL' });
      }
    }
  }, [state.status, state.lastNote, state.currentStep, state.activeNotes]);

  // Cursor advancement effect
  useEffect(() => {
    if (state.status === 'advancing') {
      if (DEV) perfLogger.debug('[DEBUG] Cursor advancement effect triggered');
      
      // CRITICAL DEBUG: Log when cursor advancement actually starts
      if (process.env.NODE_ENV === 'development') {
        perfLogger.warn('[BPM_TIMING_DEBUG] FEEDBACK_TIMEOUT received, starting cursor advancement', {
          cursorAdvancementTime: performance.now(),
          state: state.status,
          currentStep: state.currentStep?.id || 'unknown'
        });
      }
      
      // Debug: Log ref contents BEFORE any checks
      if (DEV) {
        perfLogger.debug('[DEBUG] osmdLatestRef.current:', {
          hasRef: !!osmdLatestRef.current,
          osmdReady: osmdLatestRef.current?.osmdReady,
          hasControls: !!osmdLatestRef.current?.osmdControls,
          hasOsmd: !!osmdLatestRef.current?.osmd
        });
      }
      
      // CRITICAL FIX: Use latest OSMD controls from ref to avoid stale closure
      if (!osmdLatestRef.current) {
        perfLogger.error('[V2 Practice Controller] osmdLatestRef.current is null during cursor advancement');
        return;
      }
      const { osmdControls: currentControls, osmd: currentOsmd, osmdReady: currentReady } = osmdLatestRef.current;
      
      // Additional safety check for OSMD readiness
      if (!currentReady || !currentControls) {
        const errorMessage = `Cannot advance - OSMD not ready. osmdReady: ${currentReady}, hasControls: ${!!currentControls}`;
        perfLogger.error('[V2 Practice Controller] ' + errorMessage, new Error(errorMessage));
        dispatch({ 
          type: 'UNRECOVERABLE_ERROR', 
          payload: { error: 'OSMD not ready for cursor advancement' } 
        });
        return;
      }
      
      // DEBUGGING: Targeted logging to identify silent failure point
      if (DEV) {
        perfLogger.debug('[DEBUG] About to call advanceCursor');
        perfLogger.debug('[DEBUG] Parameters:', { 
          hasControls: !!currentControls, 
          hasOsmd: !!currentOsmd,
          controlsType: typeof currentControls,
          osmdType: typeof currentOsmd
        });
      }
      
      try {
        // CRITICAL DEBUG: Log all parameters being passed to advanceCursor
        const options = {
          currentMeasure: state.currentMeasure,
          measureTimeline: measureTimeline, // FIXED: Use context timeline
          practiceStore: usePracticeStore,
          scheduler: scheduler
        };
        
        if (DEV) {
          perfLogger.debug('[MeasureRangeDebug] About to call advanceCursor with options:', {
            currentMeasure: options.currentMeasure,
            hasMeasureTimeline: !!options.measureTimeline,
            hasPracticeStore: !!options.practiceStore,
            hasScheduler: !!options.scheduler,
            measureTimelineType: typeof options.measureTimeline,
            practiceStoreType: typeof options.practiceStore,
            schedulerType: typeof options.scheduler
          });
        }
        
        // Log current practice store state
        if (DEV && options.practiceStore) {
          const storeState = options.practiceStore.getState();
          perfLogger.debug('[MeasureRangeDebug] Current practice store state:', {
            customRangeActive: storeState.customRangeActive,
            customStartMeasure: storeState.customStartMeasure,
            customEndMeasure: storeState.customEndMeasure,
            isActive: storeState.isActive,
            status: storeState.status
          });
        }
        
        // Fix: Convert null to undefined for type compatibility
        const optionsWithCorrectTypes = {
          ...options,
          measureTimeline: options.measureTimeline ?? undefined
        };
        
        // Advance cursor and get next step with measure range looping support
        const advanceSuccess = advanceCursor(currentControls, currentOsmd, optionsWithCorrectTypes);
        if (DEV) perfLogger.debug('[DEBUG] advanceCursor returned:', advanceSuccess);
        
        if (advanceSuccess) {
          if (DEV) {
            perfLogger.debug('[CURSOR-SYNC] advanceCursor returned true - cursor successfully moved');
            perfLogger.debug('[DEBUG] About to call getNextStep');
          }
          
          // 🔍 DEBUG: Capture what getNextStep returns after potential seek
          const nextStepResult = getNextStep(currentControls, practiceStore);
          
          if (DEV) {
            if (nextStepResult) {
              // Type guard check before accessing PracticeStep properties
              if (isPracticeStep(nextStepResult)) {
                const retrievedNotes = nextStepResult.notes?.map((n: any) => n.midiValue) || [];
                perfLogger.debug('🔍 [GETNEXT DEBUG] Step retrieved by getNextStep:', {
                  notes: retrievedNotes,
                  measureIndex: nextStepResult.measureIndex,
                  isChord: nextStepResult.isChord,
                  isRest: nextStepResult.isRest
                });
              } else {
                perfLogger.debug('🔍 [GETNEXT DEBUG] End of score reached');
              }
            } else {
              perfLogger.debug('🔍 [GETNEXT DEBUG] getNextStep returned null/undefined');
            }
            
            perfLogger.debug('[DEBUG] getNextStep returned:', !!nextStepResult);
          }
          
          // Only dispatch if we have a valid next step
          if (nextStepResult) {
            dispatch({ 
              type: 'ADVANCE_DONE', 
              payload: { nextStep: nextStepResult, autoAdvanceRests: settings.autoAdvanceRests } 
            });
          } else {
            if (DEV) perfLogger.debug('[DEBUG] No next step available, treating as end of score');
            dispatch({ 
              type: 'UNRECOVERABLE_ERROR', 
              payload: { error: 'No next step available' } 
            });
          }
          if (DEV) perfLogger.debug('[DEBUG] ADVANCE_DONE dispatched successfully');
        } else {
          if (DEV) {
            perfLogger.debug('[CURSOR-SYNC] advanceCursor returned false - cursor could not be moved');
            perfLogger.debug('[DEBUG] advanceCursor failed, dispatching error');
          }
          dispatch({ 
            type: 'UNRECOVERABLE_ERROR', 
            payload: { error: 'Failed to advance cursor' } 
          });
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error : new Error(String(error));
        perfLogger.error('[DEBUG] Exception in cursor advancement:', errorMessage);
        if (DEV && errorMessage.stack) {
          perfLogger.debug('[DEBUG] Error stack: ' + errorMessage.stack);
        }
        dispatch({ 
          type: 'UNRECOVERABLE_ERROR', 
          payload: { error: `Cursor advancement exception: ${errorMessage.message}` } 
        });
      }
    }
  }, [state.status]); // CRITICAL FIX: Removed practiceStore to prevent effect cancellation

  // ========================================================================
  // MIDI EVENT SUBSCRIPTION (Fast path for <20ms latency)
  // ========================================================================

  // Store status in ref to avoid recreating callback
  const statusRef = useRef(state.status);
  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  const handleMidiEvent = useCallback((event: MidiEvent) => {
    // Only process during active practice
    if (!statusRef.current.startsWith('practice')) return;
    
    // Track latency performance
    latencyStartRef.current = performance.now();
    
    if (event.type === 'noteOn') {
      // DEBUG: Track what state is available during MIDI evaluation
      if (DEV) {
        const zustandStateAtMidi = usePracticeStore.getState();
        perfLogger.debug('[MIDI-DEBUG] Note played, checking available state', {
          midiNote: event.note,
          stateMachineStatus: statusRef.current,
          stateMachineStep: state.currentStep?.measureIndex ?? 'NULL',
          zustandCurrentStep: zustandStateAtMidi.currentStep?.measureIndex ?? 'NULL',
          zustandIsActive: zustandStateAtMidi.isActive,
          zustandStatus: zustandStateAtMidi.status,
          timestamp: performance.now()
        });
      }
      
      dispatch({
        type: 'MIDI_NOTE_ON',
        payload: {
          note: event.note,
          velocity: event.velocity,
          timestamp: event.timestamp,
        },
      });
    } else if (event.type === 'noteOff') {
      // FIXED: Handle note off to track active notes for chord evaluation
      dispatch({
        type: 'MIDI_NOTE_OFF',
        payload: {
          note: event.note,
        },
      });
    }
  }, []); // No dependencies - uses ref for status

  useEffect(() => {
    const unsubscribe = subscribeMidiEvents(handleMidiEvent);
    return unsubscribe;
  }, [subscribeMidiEvents, handleMidiEvent]);

  // ========================================================================
  // INITIALIZATION EFFECT (Load assets when starting)
  // ========================================================================

  useEffect(() => {
    if (state.status === 'loading') {
      // CRITICAL FIX: Use latest OSMD state from ref
      const { osmdControls: currentControls, osmd: currentOsmd, osmdReady: currentReady } = osmdLatestRef.current;
      logger.practice('V2 Practice Controller - Loading effect triggered', { osmdReady: currentReady, osmdControls: !!currentControls });
      
      // Simulate asset loading (could be OSMD initialization, audio samples, etc.)
      const loadAssets = async () => {
        try {
          // Wait for OSMD to be ready
          if (!currentReady || !currentControls) {
            const errorMessage = `OSMD not ready: osmdReady=${currentReady}, hasControls=${!!currentControls}`;
            perfLogger.error('[V2 Practice Controller] ' + errorMessage, new Error(errorMessage));
            throw new Error('OSMD not ready');
          }

          // CRITICAL: Reset optimized sequence index to start from beginning
          // Check if this is a measure range restart
          const practiceState = usePracticeStore.getState();
          const customRangeActive = practiceState.customRangeActive;
          const currentMeasure = currentControls?.cursor?.iterator?.currentMeasureIndex ?? 0;

          if (customRangeActive && currentMeasure > 0) {
            // Measure range practice - sync sequence index to cursor position
            const targetStepIndex = practiceState.optimizedSequence.findIndex(step => 
              step.measureIndex === currentMeasure
            );
            
            if (targetStepIndex >= 0) {
              usePracticeStore.setState({ currentOptimizedIndex: targetStepIndex });
              perfLogger.debug('[MEASURE-RANGE-FIX] Synced sequence to cursor', {
                targetStepIndex,
                currentMeasure
              });
            } else {
              // Fallback to reset if no step found
              practiceState.resetOptimizedSequence();
              perfLogger.warn('[MEASURE-RANGE-FIX] No step found, reset to beginning');
            }
          } else {
            // Normal practice start - reset to beginning as usual
            practiceState.resetOptimizedSequence();
            perfLogger.debug('[MEASURE-RANGE-FIX] Normal practice reset');
          }

          // [CURSOR-SYNC] Debug initial step acquisition
          if (DEV) {
            perfLogger.debug('[CURSOR-SYNC] Getting initial step for practice start:', {
              hasControls: !!currentControls,
              hasCursor: !!currentControls?.cursor,
              cursorState: currentControls?.cursor?.iterator ? {
                measureIndex: currentControls.cursor.iterator.currentMeasureIndex,
                voiceEntryIndex: currentControls.cursor.iterator.currentVoiceEntryIndex,
                endReached: currentControls.cursor.iterator.EndReached || currentControls.cursor.iterator.endReached
              } : null,
              timestamp: Date.now()
            });
          }
          
          // Get initial step
          const initialStep = getNextStep(currentControls, usePracticeStore.getState());
          
          // [CURSOR-SYNC] Debug initial step result
          if (DEV) {
            perfLogger.debug('[CURSOR-SYNC] Initial step acquired:', {
              stepType: initialStep?.type || 'practice-step',
              isRest: initialStep?.isRest,
              noteCount: initialStep?.notes?.length ?? 0,
              measureIndex: initialStep?.measureIndex,
              stepValid: isPracticeStep(initialStep),
              timestamp: Date.now()
            });
          }
          
          logger.practice('V2 Practice Controller - Initial step:', initialStep);
          if (!initialStep || !isPracticeStep(initialStep)) {
            throw new Error('No valid initial step');
          }

          // Let OSMD cursor work naturally - no forced synchronization needed

          // FIXED: Only dispatch ADVANCE_DONE which now handles the transition to practiceListening
          dispatch({
            type: 'ADVANCE_DONE',
            payload: { nextStep: initialStep, autoAdvanceRests: settings.autoAdvanceRests },
          });
          
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error : new Error(String(error));
          perfLogger.error('[V2 Practice Controller] Error loading assets:', errorMessage);
          dispatch({
            type: 'UNRECOVERABLE_ERROR',
            payload: { error: error instanceof Error ? error.message : 'Unknown error' },
          });
        }
      };

      loadAssets();
    }
  }, [state.status]); // Only depend on state.status - use ref for OSMD state

  // ========================================================================
  // PHASE 2: REPEAT SERVICE INITIALIZATION
  // ========================================================================
  
  useEffect(() => {
    if (!osmdControls || !osmdReady || !osmd) return;
    
    perfLogger.debug('[V2 Practice Controller] Initializing repeat services');
    
    // FIXED: Use timeline from OSMDContext instead of creating duplicate
    // The OSMDContext already creates and builds the timeline properly
    if (!measureTimeline) {
      perfLogger.warn('[V2 Practice Controller] No timeline available from OSMDContext yet');
      return;
    }
    
    // Create stateless adapter
    const adapter = new V2RepeatAdapter(
      () => state,  // Get state function
      dispatch,     // Dispatch function
      osmdControls,
      measureTimeline
    );
    
    // Create repeat manager
    const manager = new PracticeRepeatManager(measureTimeline, adapter);
    
    // Store refs
    adapterRef.current = adapter;
    repeatManagerRef.current = manager;
    
    // Cleanup
    return () => {
      adapterRef.current = null;
      repeatManagerRef.current = null;
    };
  }, [osmdControls, osmdReady, osmd, measureTimeline, dispatch]); // Note: state getter is always fresh
  
  // ========================================================================
  // PHASE 2: MEASURE TRACKING
  // ========================================================================
  
  useEffect(() => {
    if (DEV) {
      perfLogger.debug('[MeasureRangeDebug] MEASURE TRACKING useEffect triggered:', {
        hasOsmd: !!osmd,
        hasCursor: !!osmd?.cursor,
        hasOsmdControls: !!osmdControls,
        currentMeasure: state.currentMeasure,
        status: state.status,
        dependencyHash: JSON.stringify({
          osmd: !!osmd,
          currentMeasure: state.currentMeasure,
          status: state.status,
          dispatch: !!dispatch
        })
      });
    }
    
    // IMMEDIATE FIX: Use direct OSMD instance instead of osmdControls wrapper
    if (!osmd?.cursor) {
      if (DEV) {
        perfLogger.debug('[MeasureRangeDebug] Early return - no cursor:', {
          hasOsmd: !!osmd,
          hasCursor: !!osmd?.cursor,
          osmdType: osmd?.constructor?.name
        });
      }
      return;
    }
    
    const cursor = osmd.cursor;
    
    // CRITICAL DEBUG: Inspect OSMD cursor properties
    if (DEV) {
      perfLogger.debug('[MeasureRangeDebug] OSMD Cursor inspection:', {
        cursorType: cursor.constructor?.name,
        cursorKeys: Object.keys(cursor).slice(0, 15),
        hasIterator: !!cursor.iterator,
        iteratorKeys: cursor.iterator ? Object.keys(cursor.iterator).slice(0, 15) : null,
        hasCursorPositionChanged: !!(cursor as any).cursorPositionChanged,
        currentMeasureIndex: cursor.iterator?.currentMeasureIndex,
        currentMeasureIndexUndefined: cursor.iterator?.currentMeasureIndex === undefined,
        currentMeasureIndexType: typeof cursor.iterator?.currentMeasureIndex
      });
    }
    
    // Try event-driven approach first
    if ((cursor as any).cursorPositionChanged) {
      if (DEV) perfLogger.debug('[MeasureRangeDebug] Using EVENT-DRIVEN approach');
      // OSMD supports events - use them
      const handler = () => {
        const measure = cursor.iterator?.currentMeasureIndex ?? 0;
        if (DEV) {
          perfLogger.debug('[MeasureRangeDebug] Cursor event handler - measure:', {
            osmdMeasure: measure,
            stateMeasure: state.currentMeasure,
            changed: measure !== state.currentMeasure
          });
        }
        if (measure !== state.currentMeasure) {
          if (DEV) perfLogger.debug('[MeasureRangeDebug] SET_CURRENT_MEASURE dispatched:', measure);
          dispatch({ type: 'SET_CURRENT_MEASURE', payload: measure });
        }
      };
      
      (cursor as any).cursorPositionChanged.connect(handler);
      return () => (cursor as any).cursorPositionChanged.disconnect(handler);
    } else {
      if (DEV) perfLogger.debug('[MeasureRangeDebug] Using POLLING approach');
      // Fallback: Smart polling only during playback
      if (state.status !== 'practiceListening' && state.status !== 'advancing') {
        if (DEV) perfLogger.debug('[MeasureRangeDebug] Polling skipped - status not eligible:', state.status);
        return; // Don't poll when not needed
      }
      
      if (DEV) perfLogger.debug('[MeasureRangeDebug] Starting polling interval');
      const checkMeasure = () => {
        const measure = cursor.iterator?.currentMeasureIndex ?? 0;
        // Only log when measure actually changes to prevent spam
        if (measure !== state.currentMeasure) {
          if (DEV) {
            perfLogger.debug('[MeasureRangeDebug] Measure changed:', {
              from: state.currentMeasure,
              to: measure
            });
          }
          dispatch({ type: 'SET_CURRENT_MEASURE', payload: measure });
        }
      };
      
      const interval = setInterval(checkMeasure, 100);
      return () => {
        if (DEV) perfLogger.debug('[MeasureRangeDebug] Polling interval cleared');
        clearInterval(interval);
      };
    }
  }, [osmd, state.currentMeasure, state.status, dispatch]);
  
  // ========================================================================
  // PHASE 2: REPEAT LOGIC
  // ========================================================================
  
  useEffect(() => {
    if (!repeatManagerRef.current || !state.repeatActive) return;
    
    // Notify adapter of measure changes
    if (adapterRef.current) {
      adapterRef.current.notifyMeasureChange(state.currentMeasure);
    }
    
    // Note: Repeat manager automatically handles measure changes via adapter
    // Private handleMeasureChange method is called internally by the repeat manager
  }, [state.currentMeasure, state.repeatActive, state.repeatMeasure]);

  // ========================================================================
  // SYNC STATE MACHINE WITH ZUSTAND STORE
  // ========================================================================
  
  // Critical fix: Sync V2 state machine with Zustand store
  useEffect(() => {
    const isActive = state.status.startsWith('practice') || state.status === 'advancing';
    
    // DEBUG: Enhanced sync effect logging
    perfLogger.debug('[SYNC-DEBUG] State sync effect triggered', {
      stateMachineStatus: state.status,
      stateMachineStep: state.currentStep?.measureIndex || 'NULL',
      stateMachineIsActive: isActive,
      timestamp: performance.now()
    });
    
    // Update the Zustand store to reflect the state machine's status
    usePracticeStore.getState().setIsActive(isActive);
    
    // CRITICAL: Also sync currentStep to the store so UI components can access it
    if (state.currentStep) {
      perfLogger.debug('[SYNC-DEBUG] Setting currentStep in Zustand store', {
        stepId: state.currentStep.measureIndex,
        timestamp: performance.now()
      });
      usePracticeStore.getState().setCurrentStep(state.currentStep);
    } else if (state.status === 'idle' || state.status === 'ready') {
      perfLogger.debug('[SYNC-DEBUG] Clearing currentStep in Zustand store', {
        reason: state.status,
        timestamp: performance.now()
      });
      // Clear currentStep when practice stops or is ready to restart
      usePracticeStore.getState().setCurrentStep(null);
    }
    
    // DEBUG: Verify what actually got set in Zustand store
    const zustandAfterSync = usePracticeStore.getState();
    perfLogger.debug('[SYNC-DEBUG] Zustand state after sync', {
      currentStep: zustandAfterSync.currentStep?.measureIndex || 'NULL',
      isActive: zustandAfterSync.isActive,
      status: zustandAfterSync.status,
      timestamp: performance.now()
    });
    
    logger.practice(`V2 State Sync - Status: ${state.status}, isActive: ${isActive}`, { currentStep: state.currentStep });
  }, [state.status, state.currentStep]); // Removed practiceStore to prevent circular updates

  // ========================================================================
  // CURSOR SYNCHRONIZATION EFFECT
  // ========================================================================
  
  // OSMD cursor works naturally - no forced synchronization needed

  // ========================================================================
  // PHASE 1: CUSTOM RANGE IMMEDIATE SEEK EFFECT
  // ========================================================================
  
  // Subscribe to custom range state changes
  const customRangeActive = usePracticeStore(state => state.customRangeActive);
  const customStartMeasure = usePracticeStore(state => state.customStartMeasure);
  const customEndMeasure = usePracticeStore(state => state.customEndMeasure);
  
  // Use debounced values for smooth adjustments
  const debouncedStartMeasure = useDebounce(customStartMeasure, 300);
  const debouncedEndMeasure = useDebounce(customEndMeasure, 300);
  
  // Track active seek operation (Code review: feedback on concurrent operations)
  const activeSeekRef = useRef<boolean>(false);
  
  // FIXED: Preserve wasActiveBeforeSeek across multiple effect runs
  const wasActiveBeforeSeekRef = useRef<boolean | null>(null);
  
  // Track last seeked configuration to prevent re-execution
  const lastSeekedConfig = useRef<{
    active: boolean;
    startMeasure: number;
    endMeasure: number;
  }>({ active: false, startMeasure: 0, endMeasure: 0 });
  
  // Enhanced effect with comprehensive safeguards
  useEffect(() => {
    perfLogger.debug('[CustomRange] Effect triggered', {
      customRangeActive,
      debouncedStartMeasure,
      debouncedEndMeasure
    });
    
    if (!customRangeActive) {
      // Track that custom range is no longer active
      lastSeekedConfig.current.active = false;
      // FIXED: Reset ref when custom range deactivated
      wasActiveBeforeSeekRef.current = null;
      return;
    }
    if (!osmdReady || !osmdControls || !osmd?.cursor) return;

    // Check if we've already seeked for this exact configuration
    const configChanged = 
      lastSeekedConfig.current.active !== customRangeActive ||
      lastSeekedConfig.current.startMeasure !== debouncedStartMeasure ||
      lastSeekedConfig.current.endMeasure !== debouncedEndMeasure;
    
    perfLogger.debug('[CustomRange] Config changed check', {
      configChanged,
      lastActive: lastSeekedConfig.current.active,
      currentActive: customRangeActive,
      lastStart: lastSeekedConfig.current.startMeasure,
      currentStart: debouncedStartMeasure,
      lastEnd: lastSeekedConfig.current.endMeasure,
      currentEnd: debouncedEndMeasure
    });
    
    if (!configChanged) {
      // We've already seeked for this configuration, skip
      return;
    }

    const performSeek = async () => {
      perfLogger.debug('[CustomRange] Starting seek operation', {
        customRangeActive,
        debouncedStartMeasure
      });
      
      // Capture state versions at start
      const seekId = ++currentSeekId.current;
      const stateVersion = osmdStateVersion.current;
      
      // FIXED: Preserve wasActiveBeforeSeek across multiple effect runs
      if (wasActiveBeforeSeekRef.current === null) {
        wasActiveBeforeSeekRef.current = usePracticeStore.getState().isActive;
      }
      const wasActiveBeforeSeek = wasActiveBeforeSeekRef.current;
      const needsStop = wasActiveBeforeSeek; // If active, we need to stop first
        
      if (needsStop) {
        perfLogger.debug('[CustomRange] Stopping practice before seek');
        dispatch({ type: 'STOP_CLICK' });
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Re-check after stop
        if (currentSeekId.current !== seekId) {
          return;
        }
      }

      const targetMeasureIndex = debouncedStartMeasure - 1;
      if (targetMeasureIndex < 0) {
        perfLogger.warn('[CustomRange] Invalid target measure index', { 
          debouncedStartMeasure, 
          targetMeasureIndex 
        });
        return;
      }
      
      perfLogger.info('[CustomRange] Performing seek', {
        targetMeasureIndex,
        seekId,
        stateVersion
      });
      
      const success = await seekToMeasureAndSync(targetMeasureIndex, seekId, stateVersion);
      
      perfLogger.info('[CustomRange] Seek result', { success });
      
      if (success) {
        // Only update last seeked config on successful seek
        lastSeekedConfig.current = {
          active: customRangeActive,
          startMeasure: debouncedStartMeasure,
          endMeasure: debouncedEndMeasure
        };
        perfLogger.debug('[CustomRange] Updated last seeked config', lastSeekedConfig.current);
        
        // Restart practice if it was active before seek
        if (wasActiveBeforeSeek) {
          console.log(`[RESTDEBUG-MEASURE-RANGE] 🚀 Restarting practice after measure range seek`);
          perfLogger.info('[CustomRange] Restarting practice after seek');
          dispatch({ type: 'START_CLICK' });
          
          // REMOVED: No longer needed - measure range now goes through proper loading state
          // which handles initial step detection and rest auto-advance correctly
        }
      }
    };

    performSeek();
  }, [
    customRangeActive, 
    debouncedStartMeasure,
    debouncedEndMeasure,
    osmdReady,
    osmdControls,
    osmd,
    dispatch,
    seekToMeasureAndSync
  ]);

  // ========================================================================
  // PHASE 0: PERFORMANCE INSTRUMENTATION FUNCTIONS
  // ========================================================================

  // PHASE 0: Get session timing statistics
  const getSessionTimingStats = useCallback(() => {
    const times = sessionTimingRef.current.advancementTimes;
    return {
      averageAdvancementTime: times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      maxAdvancementTime: times.length > 0 ? Math.max(...times) : 0,
      totalAdvancementCount: sessionTimingRef.current.totalAdvancementCount,
      performanceViolations: sessionTimingRef.current.performanceViolations,
      // Phase 1 integration placeholders
      tempoAwareAdvancementCount: sessionTimingRef.current.tempoAwareAdvancementCount,
      averageTempoDelay: sessionTimingRef.current.averageTempoDelay
    };
  }, []);

  // PHASE 0: Get current timing baseline (FEEDBACK_CORRECT_MS)
  const getCurrentTimingBaseline = useCallback(() => {
    return {
      feedbackDelayMs: TIMING_CONFIG.FEEDBACK_CORRECT_MS,
      cursorAdvancementLatency: 0, // Will be measured during practice
      totalResponseTime: TIMING_CONFIG.FEEDBACK_CORRECT_MS,
      // Additional details
      feedbackCorrectMs: TIMING_CONFIG.FEEDBACK_CORRECT_MS,
      feedbackIncorrectMs: TIMING_CONFIG.FEEDBACK_INCORRECT_MS,
      noteTimeoutMs: TIMING_CONFIG.NOTE_TIMEOUT_MS,
      countInBeats: TIMING_CONFIG.COUNT_IN_BEATS,
      gracePeriodMs: TIMING_CONFIG.GRACE_PERIOD_MS,
    };
  }, []);

  // PHASE 0: Log performance baseline for comparison
  const logPerformanceBaseline = useCallback(() => {
    const baseline = getCurrentTimingBaseline();
    perfLogger.debug('PERFORMANCE BASELINE:', baseline);
    perfLogger.debug(`Current fixed delay: ${baseline.feedbackDelayMs} ms`);
  }, [getCurrentTimingBaseline]);

  // ========================================================================
  // PUBLIC API (Adapter pattern for compatibility)
  // ========================================================================

  const publicApi = useMemo(() => ({
    // State mappings for backward compatibility
    isActive: state.status.startsWith('practice') || state.status === 'advancing',
    status: mapStatusToLegacyStatus(state.status),
    currentStep: state.currentStep,
    score: state.score,
    error: state.error,
    
    // Actions
    startPractice: () => {
      perfLogger.debug('[V2 Practice Controller] startPractice called, current state:', state.status);
      startTimeRef.current = Date.now();
      dispatch({ type: 'START_CLICK' });
    },
    stopPractice: () => {
      const timeSinceStart = Date.now() - startTimeRef.current;
      perfLogger.debug('[V2 Practice Controller] stopPractice called, time since start:', timeSinceStart);
      perfLogger.debug('[V2 Practice Controller] Stack trace for stopPractice');
      
      // Prevent immediate stop after start (likely React StrictMode double-mount)
      if (timeSinceStart < 500 && process.env.NODE_ENV === 'development') {
        perfLogger.warn('[V2 Practice Controller] Ignoring stopPractice - called too soon after start (likely StrictMode)');
        return;
      }
      
      dispatch({ type: 'STOP_CLICK' });
    },
    pausePractice: () => dispatch({ type: 'PAUSE_CLICK' }),
    resumePractice: () => dispatch({ type: 'RESUME_CLICK' }),
    
    // PHASE 2: Repeat functionality
    toggleRepeat: () => dispatch({ type: 'TOGGLE_REPEAT' }),
    repeatActive: state.repeatActive,
    repeatMeasure: state.repeatMeasure,
    currentMeasure: state.currentMeasure,
    
    // Expose refs for tests
    repeatManagerRef,
    adapterRef,
    timeline: measureTimeline,
    currentSeekId, // PHASE 3: Expose for tests
    
    // PHASE 1: Immediate cursor seek
    seekToMeasureAndSync,
    
    // PHASE 0: Performance instrumentation functions
    measureAdvancementLatency,
    getSessionTimingStats,
    getCurrentTimingBaseline,
    logPerformanceBaseline,
    
    // Integration test support (expose internal state/dispatch)
    practiceState: state,
    dispatch,
    
    // Internal state for debugging
    _internalStatus: state.status,
  }), [state, measureAdvancementLatency, getSessionTimingStats, getCurrentTimingBaseline, logPerformanceBaseline, dispatch, seekToMeasureAndSync]);

  // DEBUGGING: Expose debug functions to window for console testing
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
      (window as any).MeasureRangeDebug = {
        // Get current state
        getState: () => ({
          practiceState: {
            status: state.status,
            currentMeasure: state.currentMeasure,
            isActive: usePracticeStore.getState().isActive
          },
          practiceStore: {
            customRangeActive: usePracticeStore.getState().customRangeActive,
            customStartMeasure: usePracticeStore.getState().customStartMeasure,
            customEndMeasure: usePracticeStore.getState().customEndMeasure
          },
          osmdCursor: osmdControls ? {
            position: osmdControls.cursor?.iterator?.currentMeasureIndex,
            voiceEntry: osmdControls.cursor?.iterator?.currentVoiceEntryIndex,
            endReached: osmdControls.cursor?.iterator?.EndReached
          } : null
        }),
        
        // Test custom range functions
        setCustomRange: (start: number, end: number) => {
          perfLogger.debug('[MeasureRangeDebug] Manual setCustomRange:', { start, end });
          usePracticeStore.getState().setCustomRange(start, end);
        },
        
        toggleCustomRange: () => {
          perfLogger.debug('[MeasureRangeDebug] Manual toggleCustomRange');
          usePracticeStore.getState().toggleCustomRange();
        },
        
        // Test measure setting
        setCurrentMeasure: (measure: number) => {
          perfLogger.debug('[MeasureRangeDebug] Manual setCurrentMeasure:', measure);
          dispatch({ type: 'SET_CURRENT_MEASURE', payload: measure });
        },
        
        // Test cursor advancement with debug
        testAdvanceCursor: () => {
          if (osmdControls && osmd && measureTimeline) {
            perfLogger.debug('[MeasureRangeDebug] Manual advanceCursor test');
            advanceCursor(osmdControls, osmd, {
              currentMeasure: state.currentMeasure,
              measureTimeline: measureTimeline, // FIXED: Use context timeline
              practiceStore: practiceStore,
              scheduler: scheduler
            });
          } else {
            perfLogger.debug('[MeasureRangeDebug] Cannot test - missing osmdControls, osmd, or measureTimeline');
          }
        }
      };
      
      perfLogger.debug('[MeasureRangeDebug] Debug commands available: window.MeasureRangeDebug');
      perfLogger.debug('[MeasureRangeDebug] Usage: MeasureRangeDebug.getState(), MeasureRangeDebug.setCustomRange(1, 2), etc.');
    }
    
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).MeasureRangeDebug;
      }
    };
  }, [state, osmdControls, osmd, practiceStore, dispatch, scheduler, measureTimeline]);

  return publicApi;
}

// ============================================================================
// ADAPTER HELPERS (Bridge to legacy API)
// ============================================================================

function mapStatusToLegacyStatus(status: PracticeStatus): string {
  switch (status) {
    case 'practiceListening':
      return 'listening';
    case 'practiceEvaluating':
      return 'evaluating';
    case 'practiceFeedbackCorrect':
      return 'feedback_correct';
    case 'practiceFeedbackIncorrect':
      return 'feedback_incorrect';
    case 'advancing':
      return 'feedback_correct'; // Legacy behavior during advancement
    case 'paused':
      return 'paused';
    case 'completed':
      return 'completed';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

// ============================================================================
// PHASE 0: EXPORT ALIAS FOR TDD TESTS
// ============================================================================

// Export V2 controller with original name for test compatibility
export { usePracticeControllerV2 as usePracticeController };