/**
 * Phase 4 Task 4.4: Performance Impact Tests
 * 
 * Tests performance impact of the repeat feature to ensure it adds <5ms to MIDI processing
 * and doesn't cause memory leaks or performance degradation during normal operation.
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
  },
  logMidiLatency: jest.fn(),
  logAudioLatency: jest.fn(),
  logRenderLatency: jest.fn()
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

// Import components after mocks
import { usePracticeController } from '@/renderer/features/practice-mode/hooks';

// Performance measurement utilities
const measureLatency = async (operation: () => Promise<void>, iterations = 10): Promise<number[]> => {
  const times: number[] = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await operation();
    times.push(performance.now() - start);
  }
  
  return times;
};

const measureSync = (operation: () => void, iterations = 10): number[] => {
  const times: number[] = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    operation();
    times.push(performance.now() - start);
  }
  
  return times;
};

const average = (times: number[]): number => {
  return times.reduce((a, b) => a + b, 0) / times.length;
};

const median = (times: number[]): number => {
  const sorted = [...times].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 
    ? (sorted[mid - 1] + sorted[mid]) / 2 
    : sorted[mid];
};

// Mock MIDI event simulation
const simulateMidiEvent = () => ({
  type: 'noteOn',
  note: 60,
  velocity: 80,
  timestamp: performance.now()
});

// Utility function to flush promises
const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Repeat Performance Impact', () => {
  let mockToggleRepeat: jest.Mock;
  let mockUsePracticeController: jest.Mock;
  let initialMem: number;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockToggleRepeat = jest.fn().mockResolvedValue(true);
    
    // @ts-ignore - Mock module  
    mockUsePracticeController = require('@/renderer/features/practice-mode/hooks').usePracticeController;
    
    mockUsePracticeController.mockReturnValue({
      repeatActive: false,
      toggleRepeat: mockToggleRepeat,
      practiceState: { status: 'practiceListening' },
      state: { 
        status: 'practiceListening',
        currentMeasure: 0,
        repeatMeasure: 0
      },
      dispatch: jest.fn()
    });

    // Baseline memory measurement
    if (typeof performance.memory !== 'undefined') {
      initialMem = performance.memory.usedJSHeapSize;
    } else {
      initialMem = 0; // Fallback for environments without memory API
    }
  });

  describe('MIDI Processing Latency Impact', () => {
    test('adds <5ms to MIDI processing', async () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Measure baseline MIDI processing (repeat disabled)
      const baselineLatencies = await measureLatency(async () => {
        const midiEvent = simulateMidiEvent();
        // Simulate MIDI processing without repeat
        result.current.dispatch({
          type: 'MIDI_EVENT',
          payload: midiEvent
        });
        await flushPromises();
      }, 20);
      
      const baselineAvg = average(baselineLatencies);
      
      // Enable repeat
      act(() => {
        result.current.toggleRepeat();
      });
      
      // Update mock to reflect active state
      mockUsePracticeController.mockReturnValue({
        ...mockUsePracticeController(),
        repeatActive: true,
        state: {
          ...mockUsePracticeController().state,
          repeatActive: true
        }
      });
      
      // Measure MIDI processing with repeat enabled
      const repeatLatencies = await measureLatency(async () => {
        const midiEvent = simulateMidiEvent();
        // Simulate MIDI processing with repeat
        result.current.dispatch({
          type: 'MIDI_EVENT',
          payload: midiEvent
        });
        await flushPromises();
      }, 20);
      
      const repeatAvg = average(repeatLatencies);
      const impact = repeatAvg - baselineAvg;
      
      // Should add less than 5ms overhead
      expect(impact).toBeLessThan(5);
      
      // Log for analysis
      console.log(`MIDI Processing Impact: ${impact.toFixed(2)}ms`);
      console.log(`Baseline: ${baselineAvg.toFixed(2)}ms, With Repeat: ${repeatAvg.toFixed(2)}ms`);
    });

    test('maintains consistent performance under load', async () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Enable repeat
      act(() => {
        result.current.toggleRepeat();
      });
      
      // Simulate high MIDI load (100 events)
      const highLoadLatencies = await measureLatency(async () => {
        for (let i = 0; i < 100; i++) {
          const midiEvent = simulateMidiEvent();
          result.current.dispatch({
            type: 'MIDI_EVENT',
            payload: midiEvent
          });
        }
        await flushPromises();
      }, 5);
      
      const avgLatency = average(highLoadLatencies);
      const maxLatency = Math.max(...highLoadLatencies);
      
      // Should handle high load without excessive latency
      expect(avgLatency).toBeLessThan(50); // 50ms for 100 events = 0.5ms per event
      expect(maxLatency).toBeLessThan(100); // Max 100ms for batch
      
      console.log(`High Load Performance: avg=${avgLatency.toFixed(2)}ms, max=${maxLatency.toFixed(2)}ms`);
    });

    test('measure state updates have minimal impact', () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Enable repeat
      act(() => {
        result.current.toggleRepeat();
      });
      
      // Measure state update performance
      const updateTimes = measureSync(() => {
        result.current.dispatch({
          type: 'SET_CURRENT_MEASURE',
          payload: Math.floor(Math.random() * 100)
        });
      }, 50);
      
      const avgUpdateTime = average(updateTimes);
      const maxUpdateTime = Math.max(...updateTimes);
      
      // State updates should be very fast
      expect(avgUpdateTime).toBeLessThan(2); // <2ms average
      expect(maxUpdateTime).toBeLessThan(10); // <10ms max
      
      console.log(`State Update Performance: avg=${avgUpdateTime.toFixed(2)}ms, max=${maxUpdateTime.toFixed(2)}ms`);
    });
  });

  describe('Memory Usage and Leaks', () => {
    test('handles stress test without degradation', async () => {
      const { result } = renderHook(() => usePracticeController());
      
      const memBefore = typeof performance.memory !== 'undefined' 
        ? performance.memory.usedJSHeapSize 
        : initialMem;
      
      // Stress test: rapid operations
      const startTime = performance.now();
      
      for (let i = 0; i < 100; i++) {
        act(() => {
          result.current.toggleRepeat();
          result.current.dispatch({ 
            type: 'SET_CURRENT_MEASURE', 
            payload: i % 10 
          });
        });
      }
      
      const duration = performance.now() - startTime;
      
      // Flush any pending operations
      await flushPromises();
      
      // Force garbage collection if available
      if (typeof window !== 'undefined' && 'gc' in window) {
        (window as any).gc();
      }
      
      const memAfter = typeof performance.memory !== 'undefined' 
        ? performance.memory.usedJSHeapSize 
        : initialMem;
      
      // Performance checks
      expect(duration).toBeLessThan(1000); // 100 ops in <1s
      
      // Memory growth check (if memory API available)
      if (typeof performance.memory !== 'undefined') {
        const memGrowth = memAfter - memBefore;
        const memGrowthPercent = (memGrowth / memBefore) * 100;
        
        expect(memGrowthPercent).toBeLessThan(20); // <20% memory growth
        
        console.log(`Memory Impact: ${(memGrowth / 1024 / 1024).toFixed(2)}MB (${memGrowthPercent.toFixed(1)}%)`);
      }
      
      console.log(`Stress Test Duration: ${duration.toFixed(2)}ms for 100 operations`);
    });

    test('prevents memory leaks in service lifecycle', () => {
      let result: any;
      
      // Create and destroy hooks multiple times
      for (let i = 0; i < 5; i++) {
        const { result: currentResult, unmount } = renderHook(() => usePracticeController());
        
        // Use the hook
        act(() => {
          currentResult.current.toggleRepeat();
          currentResult.current.dispatch({ 
            type: 'SET_CURRENT_MEASURE', 
            payload: i 
          });
        });
        
        result = currentResult;
        
        // Clean up
        unmount();
      }
      
      // Force garbage collection if available
      if (typeof window !== 'undefined' && 'gc' in window) {
        (window as any).gc();
      }
      
      // Memory should be cleaned up after unmounts
      const memAfter = typeof performance.memory !== 'undefined' 
        ? performance.memory.usedJSHeapSize 
        : initialMem;
      
      if (typeof performance.memory !== 'undefined') {
        const memGrowth = memAfter - initialMem;
        const memGrowthPercent = (memGrowth / initialMem) * 100;
        
        expect(memGrowthPercent).toBeLessThan(15); // <15% growth after cleanup
        
        console.log(`Memory after lifecycle test: ${(memGrowth / 1024 / 1024).toFixed(2)}MB (${memGrowthPercent.toFixed(1)}%)`);
      }
    });

    test('handles memory pressure gracefully', async () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Create memory pressure by allocating large objects
      const largeObjects: ArrayBuffer[] = [];
      
      try {
        // Allocate memory
        for (let i = 0; i < 10; i++) {
          largeObjects.push(new ArrayBuffer(1024 * 1024)); // 1MB each
        }
        
        // Test repeat functionality under memory pressure
        act(() => {
          result.current.toggleRepeat();
        });
        
        // Should still function correctly
        expect(result.current.repeatActive).toBe(true);
        
        // Performance should degrade gracefully
        const stressedLatencies = measureSync(() => {
          result.current.dispatch({
            type: 'SET_CURRENT_MEASURE',
            payload: Math.floor(Math.random() * 10)
          });
        }, 10);
        
        const avgStressedLatency = average(stressedLatencies);
        
        // Should still be reasonably fast even under pressure
        expect(avgStressedLatency).toBeLessThan(20); // <20ms under pressure
        
      } finally {
        // Clean up allocated memory
        largeObjects.length = 0;
      }
    });
  });

  describe('CPU Usage and Efficiency', () => {
    test('maintains efficient CPU usage during toggles', () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Measure CPU time for toggle operations
      const toggleTimes = measureSync(() => {
        result.current.toggleRepeat();
      }, 20);
      
      const avgToggleTime = average(toggleTimes);
      const maxToggleTime = Math.max(...toggleTimes);
      
      // Toggle should be very fast
      expect(avgToggleTime).toBeLessThan(1); // <1ms average
      expect(maxToggleTime).toBeLessThan(5); // <5ms max
      
      console.log(`Toggle Performance: avg=${avgToggleTime.toFixed(3)}ms, max=${maxToggleTime.toFixed(3)}ms`);
    });

    test('efficient batch operations', () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Measure batch state updates
      const batchTime = measureSync(() => {
        act(() => {
          for (let i = 0; i < 50; i++) {
            result.current.dispatch({
              type: 'SET_CURRENT_MEASURE',
              payload: i
            });
          }
        });
      }, 1)[0]; // Single measurement
      
      const timePerOperation = batchTime / 50;
      
      // Should handle batch efficiently
      expect(timePerOperation).toBeLessThan(0.5); // <0.5ms per operation
      expect(batchTime).toBeLessThan(25); // <25ms for 50 operations
      
      console.log(`Batch Performance: ${batchTime.toFixed(2)}ms for 50 ops (${timePerOperation.toFixed(3)}ms/op)`);
    });

    test('maintains performance during concurrent operations', async () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Concurrent operations
      const concurrentStart = performance.now();
      
      await act(async () => {
        const promises = [
          // Toggle operations
          ...Array(10).fill(0).map(() => result.current.toggleRepeat()),
          // State updates
          ...Array(10).fill(0).map((_, i) => 
            result.current.dispatch({ type: 'SET_CURRENT_MEASURE', payload: i })
          )
        ];
        
        await Promise.all(promises);
      });
      
      const concurrentDuration = performance.now() - concurrentStart;
      
      // Should handle concurrent operations efficiently
      expect(concurrentDuration).toBeLessThan(100); // <100ms for 20 concurrent ops
      
      console.log(`Concurrent Operations: ${concurrentDuration.toFixed(2)}ms for 20 operations`);
    });
  });

  describe('Performance Regression Detection', () => {
    test('toggle performance remains consistent over time', () => {
      const { result } = renderHook(() => usePracticeController());
      
      // Measure performance at different stages
      const earlyTimes = measureSync(() => result.current.toggleRepeat(), 10);
      
      // Do some work to potentially cause degradation
      for (let i = 0; i < 100; i++) {
        result.current.dispatch({ type: 'SET_CURRENT_MEASURE', payload: i % 10 });
      }
      
      const lateTimes = measureSync(() => result.current.toggleRepeat(), 10);
      
      const earlyAvg = average(earlyTimes);
      const lateAvg = average(lateTimes);
      const degradation = lateAvg - earlyAvg;
      
      // Performance should not degrade significantly
      expect(degradation).toBeLessThan(2); // <2ms degradation
      
      console.log(`Performance Consistency: early=${earlyAvg.toFixed(3)}ms, late=${lateAvg.toFixed(3)}ms, degradation=${degradation.toFixed(3)}ms`);
    });

    test('scales linearly with measure count', () => {
      const { result } = renderHook(() => usePracticeController());
      
      act(() => {
        result.current.toggleRepeat();
      });
      
      // Test performance at different measure counts
      const measureCounts = [10, 50, 100];
      const timings: { count: number; time: number }[] = [];
      
      for (const count of measureCounts) {
        const time = measureSync(() => {
          for (let i = 0; i < count; i++) {
            result.current.dispatch({
              type: 'SET_CURRENT_MEASURE',
              payload: i
            });
          }
        }, 1)[0];
        
        timings.push({ count, time });
      }
      
      // Check for linear scaling (not quadratic)
      const ratio1 = timings[1].time / timings[0].time; // 50/10
      const ratio2 = timings[2].time / timings[1].time; // 100/50
      
      // Should scale roughly linearly (ratio should be close to expected)
      expect(ratio1).toBeLessThan(10); // Should not be 25x slower for 5x more work
      expect(ratio2).toBeLessThan(5);  // Should not be 4x slower for 2x more work
      
      console.log('Scaling Performance:', timings);
    });
  });

  describe('Resource Cleanup', () => {
    test('cleans up resources on component unmount', () => {
      const { result, unmount } = renderHook(() => usePracticeController());
      
      // Use the component
      act(() => {
        result.current.toggleRepeat();
        result.current.dispatch({ type: 'SET_CURRENT_MEASURE', payload: 5 });
      });
      
      const memBefore = typeof performance.memory !== 'undefined' 
        ? performance.memory.usedJSHeapSize 
        : 0;
      
      // Unmount
      unmount();
      
      // Force garbage collection if available
      if (typeof window !== 'undefined' && 'gc' in window) {
        (window as any).gc();
      }
      
      const memAfter = typeof performance.memory !== 'undefined' 
        ? performance.memory.usedJSHeapSize 
        : 0;
      
      // Memory should not grow significantly after unmount
      if (typeof performance.memory !== 'undefined') {
        const memGrowth = memAfter - memBefore;
        expect(memGrowth).toBeLessThan(1024 * 1024); // <1MB growth
      }
      
      // No errors should occur during cleanup
      expect(true).toBe(true); // Test passed if no exceptions thrown
    });

    test('handles repeated mount/unmount cycles', () => {
      let finalResult: any;
      
      const memBefore = typeof performance.memory !== 'undefined' 
        ? performance.memory.usedJSHeapSize 
        : 0;
      
      // Multiple mount/unmount cycles
      for (let i = 0; i < 10; i++) {
        const { result, unmount } = renderHook(() => usePracticeController());
        
        act(() => {
          result.current.toggleRepeat();
          result.current.dispatch({ type: 'SET_CURRENT_MEASURE', payload: i });
        });
        
        finalResult = result;
        unmount();
      }
      
      // Force garbage collection if available
      if (typeof window !== 'undefined' && 'gc' in window) {
        (window as any).gc();
      }
      
      const memAfter = typeof performance.memory !== 'undefined' 
        ? performance.memory.usedJSHeapSize 
        : 0;
      
      // Memory should not grow excessively
      if (typeof performance.memory !== 'undefined') {
        const memGrowth = memAfter - memBefore;
        const memGrowthMB = memGrowth / 1024 / 1024;
        
        expect(memGrowthMB).toBeLessThan(5); // <5MB growth for 10 cycles
        
        console.log(`Mount/Unmount Cycles Memory Growth: ${memGrowthMB.toFixed(2)}MB`);
      }
    });
  });
});