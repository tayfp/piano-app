/**
 * Practice Mode Store
 * 
 * Zustand store for managing practice mode state.
 * Follows immutable update patterns and provides actions for state transitions.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { PracticeState, PracticeStep, ComparisonResult, OptimizedPracticeStep } from '../types';

interface PracticeActions {
  /** Start a new practice session */
  startPractice: () => void;
  /** Stop the current practice session */
  stopPractice: () => void;
  /** Set the current step the user should play */
  setCurrentStep: (step: PracticeStep | null) => void;
  /** Update the set of currently pressed keys */
  updatePressedKeys: (keys: number[]) => void;
  /** Set the result of the last comparison */
  setResult: (result: ComparisonResult) => void;
  /** Update the current status */
  setStatus: (status: PracticeState['status']) => void;
  /** Reset attempt count for current step */
  resetAttempts: () => void;
  /** Set whether the score has repeats */
  setHasRepeats: (hasRepeats: boolean) => void;
  /** Dismiss the repeat warning */
  dismissRepeatWarning: () => void;
  /** Reset repeat warning dismissal (when new score loaded) */
  resetRepeatWarning: () => void;
  /** Toggle repeat navigation enabled/disabled */
  setRepeatsEnabled: (enabled: boolean) => void;
  /** Mark repeat navigation as failed */
  setRepeatsFailed: (failed: boolean) => void;
  
  // Phase 1 optimization: Pre-computed sequence management
  /** Set the pre-computed practice sequence */
  setOptimizedSequence: (sequence: OptimizedPracticeStep[]) => void;
  /** Get current optimized step by index */
  getCurrentOptimizedStep: () => OptimizedPracticeStep | null;
  /** Advance to next step in optimized sequence */
  advanceOptimizedStep: () => boolean;
  /** Reset optimized sequence position */
  resetOptimizedSequence: () => void;
  
  // V2 Controller sync
  /** Set isActive state directly (for V2 controller sync) */
  setIsActive: (isActive: boolean) => void;
  
  // Custom measure range actions
  /** Set custom measure range with validation */
  setCustomRange: (start: number, end: number) => void;
  /** Toggle custom range active state */
  toggleCustomRange: () => void;
  /** Clear custom range and reset to defaults */
  clearCustomRange: () => void;
  /** Set current measure index (0-based) */
  setCurrentMeasure: (measureIndex: number) => void;
  /** Set last valid measure index for recovery (0-based) */
  setLastValidMeasureIndex: (measureIndex: number) => void;
}

type PracticeStore = PracticeState & PracticeActions;

export const usePracticeStore = create<PracticeStore>()(
  devtools(
    (set) => ({
      // Initial state
      isActive: false,
      status: 'idle',
      currentStep: null,
      pressedKeys: new Set(),
      lastResult: null,
      attemptCount: 0,
      hasRepeats: false,
      repeatWarningDismissed: false,
      repeatsEnabled: true, // Default to ON for musical accuracy
      repeatsFailed: false, // Default to no errors
      
      // Phase 1 optimization: Pre-computed sequence state
      optimizedSequence: [] as OptimizedPracticeStep[],
      currentOptimizedIndex: 0,
      
      // Custom measure range state (with safe defaults)
      customRangeActive: false,
      customStartMeasure: 1,
      customEndMeasure: 1,
      currentMeasureIndex: undefined,
      lastValidMeasureIndex: 0,
      
      // Actions
      startPractice: () => set(
        { 
          isActive: true, 
          status: 'listening',
          attemptCount: 0,
          lastResult: null
        },
        false,
        'startPractice'
      ),
      
      stopPractice: () => set(
        { 
          isActive: false, 
          status: 'idle',
          currentStep: null,
          lastResult: null,
          pressedKeys: new Set(),
          attemptCount: 0,
          // Clear custom range when stopping practice
          customRangeActive: false,
          customStartMeasure: 1,
          customEndMeasure: 1
        },
        false,
        'stopPractice'
      ),
      
      setCurrentStep: (step) => set(
        { 
          currentStep: step,
          status: step ? 'listening' : 'idle',
          lastResult: null,
          attemptCount: 0
        },
        false,
        'setCurrentStep'
      ),
      
      updatePressedKeys: (keys) => set(
        { 
          pressedKeys: new Set(keys) 
        },
        false,
        'updatePressedKeys'
      ),
      
      setResult: (result) => set(
        (state) => ({ 
          lastResult: result,
          status: result.type === 'CORRECT' ? 'feedback_correct' : 'feedback_incorrect',
          attemptCount: state.attemptCount + 1
        }),
        false,
        'setResult'
      ),
      
      setStatus: (status) => set(
        { status },
        false,
        'setStatus'
      ),
      
      resetAttempts: () => set(
        { attemptCount: 0 },
        false,
        'resetAttempts'
      ),
      
      setHasRepeats: (hasRepeats) => set(
        { hasRepeats },
        false,
        'setHasRepeats'
      ),
      
      dismissRepeatWarning: () => set(
        { repeatWarningDismissed: true },
        false,
        'dismissRepeatWarning'
      ),
      
      resetRepeatWarning: () => set(
        { repeatWarningDismissed: false },
        false,
        'resetRepeatWarning'
      ),
      
      setRepeatsEnabled: (enabled) => set(
        { repeatsEnabled: enabled },
        false,
        'setRepeatsEnabled'
      ),
      
      setRepeatsFailed: (failed) => set(
        { repeatsFailed: failed },
        false,
        'setRepeatsFailed'
      ),
      
      // Phase 1 optimization: Pre-computed sequence actions
      setOptimizedSequence: (sequence) => set(
        { 
          optimizedSequence: sequence,
          currentOptimizedIndex: 0
        },
        false,
        'setOptimizedSequence'
      ),
      
      getCurrentOptimizedStep: () => {
        const state = usePracticeStore.getState();
        const { optimizedSequence, currentOptimizedIndex } = state;
        
        if (currentOptimizedIndex >= 0 && currentOptimizedIndex < optimizedSequence.length) {
          return optimizedSequence[currentOptimizedIndex];
        }
        return null;
      },
      
      advanceOptimizedStep: () => {
        const state = usePracticeStore.getState();
        const nextIndex = state.currentOptimizedIndex + 1;
        
        if (nextIndex < state.optimizedSequence.length) {
          set(
            { currentOptimizedIndex: nextIndex },
            false,
            'advanceOptimizedStep'
          );
          return true; // Successfully advanced
        }
        return false; // End of sequence
      },
      
      resetOptimizedSequence: () => set(
        { currentOptimizedIndex: 0 },
        false,
        'resetOptimizedSequence'
      ),
      
      // V2 Controller sync - allow V2 state machine to update isActive
      setIsActive: (isActive) => set(
        { isActive },
        false,
        'setIsActive'
      ),
      
      // Custom measure range actions
      setCustomRange: (start, end) => {
        // Store-level validation to prevent invalid state
        if (start < 1 || end < start) {
          console.warn('Invalid range provided to setCustomRange:', { start, end });
          return;
        }
        console.log('[MeasureRangeDebug] setCustomRange called:', { start, end });
        set(
          { 
            customStartMeasure: start, 
            customEndMeasure: end 
          },
          false,
          'setCustomRange'
        );
      },
      
      toggleCustomRange: () => {
        console.log('[MeasureRangeDebug] toggleCustomRange called');
        set(
          (state) => {
            const newActive = !state.customRangeActive;
            console.log('[MeasureRangeDebug] customRangeActive changing:', { 
              from: state.customRangeActive, 
              to: newActive,
              range: { start: state.customStartMeasure, end: state.customEndMeasure }
            });
            return { customRangeActive: newActive };
          },
          false,
          'toggleCustomRange'
        );
      },
      
      clearCustomRange: () => set(
        {
          customRangeActive: false,
          customStartMeasure: 1,
          customEndMeasure: 1
        },
        false,
        'clearCustomRange'
      ),
      
      setCurrentMeasure: (measureIndex) => set(
        { currentMeasureIndex: measureIndex },
        false,
        'setCurrentMeasure'
      ),
      
      setLastValidMeasureIndex: (measureIndex) => set(
        { lastValidMeasureIndex: measureIndex },
        false,
        'setLastValidMeasureIndex'
      )
    }),
    {
      name: 'practice-store',
      trace: process.env.NODE_ENV === 'development'
    }
  )
);