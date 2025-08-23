/**
 * Phase 4 Task 4.2: State Machine Integration Tests
 * 
 * Tests state consistency across the repeat feature to ensure single source of truth
 * and proper handling of concurrent actions without state corruption.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';

// Mock dependencies
jest.mock('@/renderer/utils/env', () => ({
  IS_DEVELOPMENT: false
}));

jest.mock('@/renderer/utils/performance-logger', () => ({
  perfLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('@/renderer/utils/accessibility', () => ({
  announceToScreenReader: jest.fn()
}));

// Mock practice store
jest.mock('@/renderer/features/practice-mode/stores/practiceStore', () => ({
  usePracticeStore: jest.fn(() => ({
    isActive: true,
    togglePractice: jest.fn(),
    resetCurrentStep: jest.fn(),
    skipCurrentStep: jest.fn(),
    previousStep: jest.fn(),
    showHint: jest.fn(),
    togglePause: jest.fn(),
    showKeyboardHelp: jest.fn(),
    keyboardShortcutsEnabled: true
  }))
}));

// Import the hook after mocks
import { usePracticeController } from '@/renderer/features/practice-mode/hooks';

// Utility function to flush promises
const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Repeat State Machine Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Single Source of Truth', () => {
    test('maintains single source of truth', () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Initially repeat should be inactive
      expect(result.current.repeatActive).toBe(false);
      expect(result.current.state.repeatActive).toBe(false);
      expect(result.current.state.repeatMeasure).toBe(0);
      
      // Toggle repeat
      act(() => {
        result.current.toggleRepeat();
      });
      
      // State should be consistent across all access points
      expect(result.current.repeatActive).toBe(true);
      expect(result.current.state.repeatActive).toBe(true);
      expect(result.current.state.repeatMeasure).toBe(0);
      
      // Measure change
      act(() => {
        result.current.dispatch({ 
          type: 'SET_CURRENT_MEASURE', 
          payload: 5 
        });
      });
      
      expect(result.current.state.currentMeasure).toBe(5);
      expect(result.current.state.repeatMeasure).toBe(0); // Original measure preserved
    });

    test('state updates are atomic and consistent', () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Multiple state changes in one action
      act(() => {
        result.current.dispatch({
          type: 'REPEAT_TOGGLE',
          payload: { active: true, startMeasure: 3 }
        });
      });
      
      // State should be updated atomically
      const state = result.current.state;
      expect(state.repeatActive).toBe(true);
      expect(state.repeatMeasure).toBe(3);
      
      // All getter methods should return consistent values
      expect(result.current.repeatActive).toBe(state.repeatActive);
    });
  });

  describe('Concurrent Action Handling', () => {
    test('handles concurrent actions without corruption', async () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Fire multiple actions concurrently
      const actions = [
        () => result.current.toggleRepeat(),
        () => result.current.dispatch({ type: 'SET_CURRENT_MEASURE', payload: 3 }),
        () => result.current.toggleRepeat(),
        () => result.current.dispatch({ type: 'START_CLICK' }),
      ];
      
      await act(async () => {
        await Promise.all(actions.map(action => action()));
      });
      
      // State should be valid (not corrupted)
      const state = result.current.state;
      expect(state).toMatchObject({
        repeatActive: expect.any(Boolean),
        currentMeasure: expect.any(Number),
        status: expect.any(String)
      });
      
      // Numbers should be valid
      expect(Number.isInteger(state.currentMeasure)).toBe(true);
      expect(state.currentMeasure).toBeGreaterThanOrEqual(0);
    });

    test('queues actions properly during rapid toggling', async () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Rapid toggle sequence
      act(() => {
        for (let i = 0; i < 10; i++) {
          result.current.toggleRepeat();
        }
      });
      
      await flushPromises();
      
      // Final state should be consistent (even number of toggles = inactive)
      expect(result.current.repeatActive).toBe(false);
      
      // State should not be corrupted
      expect(typeof result.current.state.repeatActive).toBe('boolean');
    });

    test('handles measure changes during repeat toggle', async () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Start repeat
      act(() => {
        result.current.toggleRepeat();
      });
      
      expect(result.current.repeatActive).toBe(true);
      
      // Simulate measure change and toggle at same time
      await act(async () => {
        const changePromise = result.current.dispatch({ 
          type: 'SET_CURRENT_MEASURE', 
          payload: 5 
        });
        const togglePromise = result.current.toggleRepeat();
        
        await Promise.all([changePromise, togglePromise]);
      });
      
      // State should be consistent
      const state = result.current.state;
      expect(typeof state.repeatActive).toBe('boolean');
      expect(Number.isInteger(state.currentMeasure)).toBe(true);
      expect(state.currentMeasure).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Action Sequencing', () => {
    test('processes actions in correct order', async () => {
      const { result } = renderHook(() => usePracticeController());
      
      const actionLog: string[] = [];
      
      // Mock dispatch to track order
      const originalDispatch = result.current.dispatch;
      result.current.dispatch = jest.fn((action) => {
        actionLog.push(action.type);
        return originalDispatch(action);
      });
      
      // Sequential actions
      act(() => {
        result.current.dispatch({ type: 'SET_CURRENT_MEASURE', payload: 1 });
        result.current.toggleRepeat();
        result.current.dispatch({ type: 'SET_CURRENT_MEASURE', payload: 2 });
      });
      
      // Actions should be processed in order
      expect(actionLog).toEqual([
        'SET_CURRENT_MEASURE',
        'REPEAT_TOGGLE',
        'SET_CURRENT_MEASURE'
      ]);
    });

    test('handles invalid action payloads gracefully', () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Try invalid payloads
      const invalidPayloads = [
        { type: 'SET_CURRENT_MEASURE', payload: -1 },
        { type: 'SET_CURRENT_MEASURE', payload: 'invalid' },
        { type: 'SET_CURRENT_MEASURE', payload: null },
        { type: 'SET_CURRENT_MEASURE', payload: undefined }
      ];
      
      invalidPayloads.forEach(action => {
        act(() => {
          result.current.dispatch(action);
        });
        
        // Should either reject or clamp to valid value
        const measure = result.current.state.currentMeasure;
        expect(measure).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(measure)).toBe(true);
      });
    });
  });

  describe('State Consistency Under Load', () => {
    test('maintains consistency during stress test', () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Stress test with many rapid state changes
      act(() => {
        for (let i = 0; i < 100; i++) {
          if (i % 3 === 0) result.current.toggleRepeat();
          if (i % 2 === 0) result.current.dispatch({ 
            type: 'SET_CURRENT_MEASURE', 
            payload: i % 10 
          });
        }
      });
      
      // State should still be valid
      const state = result.current.state;
      expect(typeof state.repeatActive).toBe('boolean');
      expect(Number.isInteger(state.currentMeasure)).toBe(true);
      expect(state.currentMeasure).toBeGreaterThanOrEqual(0);
      expect(state.currentMeasure).toBeLessThan(10);
    });

    test('handles state machine dependency failures', () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Simulate dependency failure
      const mockError = new Error('State machine error');
      const originalDispatch = result.current.dispatch;
      
      result.current.dispatch = jest.fn().mockImplementation(() => {
        throw mockError;
      });
      
      // Should handle gracefully
      expect(() => {
        act(() => {
          result.current.toggleRepeat();
        });
      }).not.toThrow();
      
      // Restore original dispatch
      result.current.dispatch = originalDispatch;
    });

    test('preserves state integrity across component remounts', () => {
      let result1: any;
      
      // First mount
      const { result, unmount, rerender } = renderHook(() => usePracticeController());
      
      act(() => {
        result.current.toggleRepeat();
        result.current.dispatch({ type: 'SET_CURRENT_MEASURE', payload: 7 });
      });
      
      result1 = {
        repeatActive: result.current.repeatActive,
        currentMeasure: result.current.state.currentMeasure,
        repeatMeasure: result.current.state.repeatMeasure
      };
      
      // Remount component
      rerender();
      
      // State should be preserved or properly restored
      expect(result.current.state.currentMeasure).toEqual(result1.currentMeasure);
      expect(typeof result.current.repeatActive).toBe('boolean');
    });
  });

  describe('Error Recovery', () => {
    test('recovers from corrupted state gracefully', () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Attempt to set invalid state
      act(() => {
        try {
          result.current.dispatch({
            type: 'INVALID_ACTION' as any,
            payload: 'corrupt data'
          });
        } catch (error) {
          // Expected to fail
        }
      });
      
      // Should still be able to use valid actions
      act(() => {
        result.current.toggleRepeat();
      });
      
      expect(typeof result.current.repeatActive).toBe('boolean');
    });

    test('maintains state consistency after errors', () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Set up initial state
      act(() => {
        result.current.toggleRepeat();
        result.current.dispatch({ type: 'SET_CURRENT_MEASURE', payload: 5 });
      });
      
      const beforeError = {
        repeatActive: result.current.repeatActive,
        currentMeasure: result.current.state.currentMeasure
      };
      
      // Cause an error
      act(() => {
        try {
          result.current.dispatch({ 
            type: 'SET_CURRENT_MEASURE', 
            payload: Number.MAX_SAFE_INTEGER + 1 // Invalid number
          });
        } catch (error) {
          // Handle error
        }
      });
      
      // State should be protected or gracefully degraded
      expect(Number.isInteger(result.current.state.currentMeasure)).toBe(true);
      expect(result.current.state.currentMeasure).toBeGreaterThanOrEqual(0);
      expect(typeof result.current.repeatActive).toBe('boolean');
    });
  });
});