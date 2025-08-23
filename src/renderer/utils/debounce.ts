import { useState, useEffect, useRef } from 'react';

/**
 * Debounce hook that delays value updates by specified milliseconds.
 * Ensures proper timer cleanup to prevent memory leaks (Code review: 4.1 feedback).
 * 
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds (e.g., 300ms for UI responsiveness)
 * @returns The debounced value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // Clear any existing timer (Code review: feedback on concurrent inputs)
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Set new timer
    timerRef.current = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Cleanup function
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [value, delay]);

  // Final cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return debouncedValue;
}