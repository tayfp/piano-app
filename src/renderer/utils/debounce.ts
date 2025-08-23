import { useState, useEffect, useRef } from 'react';

/**
 * Debounce hook that delays value updates by specified milliseconds.
 * Ensures proper timer cleanup to prevent memory leaks.
 * 
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds (e.g., 300ms for UI responsiveness)
 * @returns The debounced value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    // Set new timer (use window.setTimeout for DOM environment)
    timerRef.current = window.setTimeout(() => {
      setDebouncedValue(value);
      timerRef.current = null;
    }, delay);

    // Cleanup function
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [value, delay]);

  return debouncedValue;
}