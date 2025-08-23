/**
 * Timing Utilities - Debounce
 * 
 * General-purpose debounce function for rate-limiting function calls.
 * Extracted from practice mode for broader reusability.
 */

/**
 * Debounce function that delays execution until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked.
 * 
 * @param func Function to debounce
 * @param wait Time window in milliseconds
 * @returns Debounced function with cancel method
 * 
 * @example
 * const debouncedSave = debounce(saveData, 300);
 * // Rapid calls will only execute once after 300ms of inactivity
 * debouncedSave(data1);
 * debouncedSave(data2); 
 * debouncedSave(data3); // Only this call executes after 300ms
 * 
 * // Cancel pending execution
 * debouncedSave.cancel();
 */
export function debounce<T extends (...args: any[]) => void>(
  func: T, 
  wait: number
): T & { cancel: () => void } {
  let timeout: NodeJS.Timeout | undefined;
  
  const debounced = ((...args: Parameters<T>) => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func(...args);
      timeout = undefined;
    }, wait);
  }) as T;
  
  // Add cancel method
  (debounced as any).cancel = () => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
      timeout = undefined;
    }
  };
  
  return debounced as T & { cancel: () => void };
}