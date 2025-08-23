/**
 * Test suite for Speed Challenge Store timer functionality
 * Tests completion time tracking, history management, and performance
 */

import { act, renderHook } from '@testing-library/react';
import { useSpeedChallengeStore } from '../speedChallengeStore';

// Mock performance.now
const mockPerformanceNow = jest.spyOn(performance, 'now');

beforeEach(() => {
  // Reset store to initial state
  const store = useSpeedChallengeStore.getState();
  store.resetToInitialState();
  
  // Reset performance.now mock
  mockPerformanceNow.mockReturnValue(0);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('Timer State Management', () => {
  it('should initialize timer state correctly', () => {
    const { result } = renderHook(() => useSpeedChallengeStore());
    
    expect(result.current.currentPatternElapsed).toBe(0);
    expect(result.current.patternCompletionTimes).toEqual([]);
    expect(result.current.averageCompletionTime).toBe(0);
  });
  
  it('should update elapsed time', () => {
    const { result } = renderHook(() => useSpeedChallengeStore());
    
    act(() => {
      result.current.updateElapsedTime(1500);
    });
    
    expect(result.current.currentPatternElapsed).toBe(1500);
  });
  
  it('should reset elapsed time when generating next pattern', () => {
    const { result } = renderHook(() => useSpeedChallengeStore());
    
    // Start challenge
    act(() => {
      result.current.startChallenge();
    });
    
    // Set some elapsed time
    act(() => {
      result.current.updateElapsedTime(2000);
    });
    
    expect(result.current.currentPatternElapsed).toBe(2000);
    
    // Generate next pattern
    act(() => {
      result.current.generateNextPattern();
    });
    
    expect(result.current.currentPatternElapsed).toBe(0);
  });
});

describe('Pattern Completion Recording', () => {
  it('should record pattern completion time', () => {
    const { result } = renderHook(() => useSpeedChallengeStore());
    
    // Start challenge
    mockPerformanceNow.mockReturnValue(1000);
    act(() => {
      result.current.startChallenge();
    });
    
    // Simulate time passing
    mockPerformanceNow.mockReturnValue(3500);
    
    // Record completion
    act(() => {
      result.current.recordPatternCompletion();
    });
    
    expect(result.current.patternCompletionTimes).toEqual([2500]);
    expect(result.current.averageCompletionTime).toBe(2500);
    expect(result.current.currentPatternElapsed).toBe(0);
  });
  
  it('should maintain FIFO queue of 5 completion times', () => {
    const { result } = renderHook(() => useSpeedChallengeStore());
    
    // Record 7 completions
    const times = [2000, 2500, 3000, 2800, 2600, 3200, 2900];
    
    times.forEach((time, index) => {
      mockPerformanceNow.mockReturnValue(index * 1000);
      act(() => {
        result.current.startChallenge();
      });
      
      mockPerformanceNow.mockReturnValue(index * 1000 + time);
      act(() => {
        result.current.recordPatternCompletion();
      });
    });
    
    // Should only keep last 5 times (newest first)
    expect(result.current.patternCompletionTimes).toEqual([
      2900, // Most recent
      3200,
      2600,
      2800,
      3000  // 5th most recent
    ]);
    expect(result.current.patternCompletionTimes.length).toBe(5);
  });
  
  it('should calculate rolling average correctly', () => {
    const { result } = renderHook(() => useSpeedChallengeStore());
    
    // Record 3 completions
    const times = [2000, 3000, 2500];
    
    times.forEach((time, index) => {
      mockPerformanceNow.mockReturnValue(index * 10000);
      act(() => {
        result.current.startChallenge();
      });
      
      mockPerformanceNow.mockReturnValue(index * 10000 + time);
      act(() => {
        result.current.recordPatternCompletion();
      });
    });
    
    // Average should be (2500 + 3000 + 2000) / 3 = 2500
    expect(result.current.averageCompletionTime).toBe(2500);
  });
});

describe('Integration with validateNote', () => {
  it('should record completion time before advancing pattern', () => {
    const { result } = renderHook(() => useSpeedChallengeStore());
    
    // Start challenge
    mockPerformanceNow.mockReturnValue(1000);
    act(() => {
      result.current.startChallenge();
    });
    
    // Get expected note from current pattern
    const expectedNote = result.current.currentPattern?.notes[0]?.midi || 60;
    
    // Simulate correct note after 2 seconds
    mockPerformanceNow.mockReturnValue(3000);
    
    let validationResult: any;
    act(() => {
      validationResult = result.current.validateNote(expectedNote, 3000);
    });
    
    expect(validationResult.correct).toBe(true);
    
    // Wait for async pattern generation
    setTimeout(() => {
      expect(result.current.patternCompletionTimes.length).toBeGreaterThan(0);
      expect(result.current.patternCompletionTimes[0]).toBe(2000);
    }, 10);
  });
  
  it('should not record completion time for incorrect notes', () => {
    const { result } = renderHook(() => useSpeedChallengeStore());
    
    // Start challenge
    mockPerformanceNow.mockReturnValue(1000);
    act(() => {
      result.current.startChallenge();
    });
    
    // Simulate incorrect note
    const wrongNote = 100; // Unlikely to be in pattern
    mockPerformanceNow.mockReturnValue(3000);
    
    let validationResult: any;
    act(() => {
      validationResult = result.current.validateNote(wrongNote, 3000);
    });
    
    expect(validationResult.correct).toBe(false);
    expect(result.current.patternCompletionTimes).toEqual([]);
  });
});

describe('Performance Requirements', () => {
  it('should update timer with minimal overhead', () => {
    const { result } = renderHook(() => useSpeedChallengeStore());
    
    const iterations = 1000;
    const start = performance.now();
    
    for (let i = 0; i < iterations; i++) {
      act(() => {
        result.current.updateElapsedTime(i * 100);
      });
    }
    
    const end = performance.now();
    const avgTime = (end - start) / iterations;
    
    // Should average less than 0.1ms per update
    expect(avgTime).toBeLessThan(0.1);
  });
  
  it('should record completion with minimal overhead', () => {
    const { result } = renderHook(() => useSpeedChallengeStore());
    
    // Setup initial state
    act(() => {
      result.current.startChallenge();
    });
    
    const iterations = 100;
    const start = performance.now();
    
    for (let i = 0; i < iterations; i++) {
      mockPerformanceNow.mockReturnValue(i * 1000 + 2000);
      act(() => {
        result.current.recordPatternCompletion();
      });
    }
    
    const end = performance.now();
    const avgTime = (end - start) / iterations;
    
    // Should average less than 0.1ms per recording
    expect(avgTime).toBeLessThan(0.1);
  });
});

describe('Edge Cases', () => {
  it('should handle recording completion without active pattern', () => {
    const { result } = renderHook(() => useSpeedChallengeStore());
    
    // Try to record without starting
    act(() => {
      result.current.recordPatternCompletion();
    });
    
    // Should handle gracefully
    expect(result.current.patternCompletionTimes).toEqual([]);
    expect(result.current.averageCompletionTime).toBe(0);
  });
  
  it('should handle very fast completions', () => {
    const { result } = renderHook(() => useSpeedChallengeStore());
    
    // Start and complete almost instantly
    mockPerformanceNow.mockReturnValue(1000);
    act(() => {
      result.current.startChallenge();
    });
    
    mockPerformanceNow.mockReturnValue(1010); // 10ms later
    act(() => {
      result.current.recordPatternCompletion();
    });
    
    expect(result.current.patternCompletionTimes).toEqual([10]);
    expect(result.current.averageCompletionTime).toBe(10);
  });
  
  it('should handle very slow completions', () => {
    const { result } = renderHook(() => useSpeedChallengeStore());
    
    // Start and complete after a long time
    mockPerformanceNow.mockReturnValue(1000);
    act(() => {
      result.current.startChallenge();
    });
    
    mockPerformanceNow.mockReturnValue(601000); // 10 minutes later
    act(() => {
      result.current.recordPatternCompletion();
    });
    
    expect(result.current.patternCompletionTimes).toEqual([600000]);
    expect(result.current.averageCompletionTime).toBe(600000);
  });
});