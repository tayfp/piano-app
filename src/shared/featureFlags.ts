
/**
 * Feature Flags for Urtext Piano
 * 
 * Service-level feature flags for safe rollout of performance optimizations.
 * Flags can be controlled via URL parameters or localStorage for development/testing.
 */

interface FeatureFlags {
  /** Replace 50ms MIDI debounce with 10ms micro-batching */
  microBatching: boolean;
  /** Use pre-computed practice sequences instead of real-time OSMD traversal */
  preComputedSequence: boolean;
  /** Enable Audio Worklet for off-main-thread MIDI processing (Phase 2) */
  audioWorklet: boolean;
  /** Enable WASM chord comparison with SIMD (Phase 3) */
  wasmComparison: boolean;
  /** Practice controller version: "auto" | "v1" | "v2" */
  practiceControllerVersion: "auto" | "v1" | "v2";
}

/**
 * Read feature flag from URL parameters or localStorage
 */
function readFromQueryOrLocalStorage(key: string, defaultValue: boolean): boolean {
  // Check URL parameters first (for testing)
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has(key)) {
      return urlParams.get(key) === 'true';
    }
    
    // Check localStorage for persistent overrides
    const stored = localStorage.getItem(`abc_piano_flag_${key}`);
    if (stored !== null) {
      return stored === 'true';
    }
  }
  
  return defaultValue;
}

/**
 * Read string feature flag from URL parameters or localStorage
 */
function readStringFromQueryOrLocalStorage<T extends string>(
  key: string, 
  defaultValue: T, 
  validValues: readonly T[]
): T {
  if (typeof window !== 'undefined') {
    // Check URL parameters first (for testing)
    const urlParams = new URLSearchParams(window.location.search);
    const urlValue = urlParams.get(key);
    if (urlValue && validValues.includes(urlValue as T)) {
      return urlValue as T;
    }
    
    // Check localStorage for persistent overrides
    const stored = localStorage.getItem(`abc_piano_flag_${key}`);
    if (stored && validValues.includes(stored as T)) {
      return stored as T;
    }
  }
  
  return defaultValue;
}

/**
 * Global feature flags instance
 */
export const Flags: FeatureFlags = {
  // Version Critical latency fixes (enabled by default for V2)
  microBatching: readFromQueryOrLocalStorage('mb', true),
  preComputedSequence: readFromQueryOrLocalStorage('pcs', true),
  
  // Version Performance optimization  
  audioWorklet: readFromQueryOrLocalStorage('aw', false),
  
  // Version Advanced optimization
  wasmComparison: readFromQueryOrLocalStorage('wasm', false),
  
  // Controller version selection (v2 default - state machine with optimizations)
  practiceControllerVersion: readStringFromQueryOrLocalStorage('pcv', 'v2', ['auto', 'v1', 'v2'] as const),
};

/**
 * Debug helper to show current flag state
 */
export function logFeatureFlags(): void {
  console.group('[FeatureFlags] Current State');
  Object.entries(Flags).forEach(([key, value]) => {
    console.log(`${key}: ${value ? 'ON' : 'off'}`);
  });
  console.groupEnd();
}

/**
 * Enable a feature flag for testing (persists to localStorage)
 */
export function enableFlag(key: keyof FeatureFlags): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(`abc_piano_flag_${key}`, 'true');
  }
  // Keep in-memory state in sync immediately
  (Flags as any)[key] = true;
}

/**
 * Disable a feature flag for testing
 */
export function disableFlag(key: keyof FeatureFlags): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(`abc_piano_flag_${key}`);
  }
  // Keep in-memory state in sync immediately
  (Flags as any)[key] = false;
}

// Expose to window for debugging
if (typeof window !== 'undefined') {
  (window as any).abcFeatureFlags = {
    current: Flags,
    enable: enableFlag,
    disable: disableFlag,
    log: logFeatureFlags,
  };
}