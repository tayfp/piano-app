/**
 * Practice Mode Hook
 * 
 * Manages practice mode initialization and repeat warnings.
 * Extracted from App.tsx to isolate practice-specific logic.
 */

import { useState, useRef, useEffect } from 'react';
import { usePracticeStore } from '@/renderer/features/practice-mode/stores/practiceStore';
import { usePracticeController } from '@/renderer/features/practice-mode/hooks';
import { useOSMDContext } from '@/renderer/contexts/OSMDContext';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { logger } from '@/renderer/utils/simple-logger';

interface UsePracticeModeReturn {
  isPracticeActive: boolean;
  osmdReady: boolean;
  practiceController: ReturnType<typeof usePracticeController>;
  showRepeatWarning: boolean;
  handleStartPractice: () => void;
  handleRepeatWarningProceed: () => void;
  handleRepeatWarningCancel: () => void;
  debugButtonState: () => Record<string, any>;
}

export function usePracticeMode(): UsePracticeModeReturn {
  const [showRepeatWarning, setShowRepeatWarning] = useState(false);
  const { isReady: osmdReady, controls: osmdControls, osmd, detectRepeats, validateState } = useOSMDContext();
  const { isActive: isPracticeActive } = usePracticeStore();
  const practiceController = usePracticeController();

  // Production-safe logging guards (eliminates logging overhead)
  const DEV = process.env.NODE_ENV !== 'production';
  const debug = (...args: any[]) => { if (DEV) perfLogger?.debug?.(...args); };
  const dlog = (...args: any[]) => { if (DEV) console.log(...args); };

  // FIX: Ref to avoid stale closures in async callbacks
  const osmdControlsRef = useRef<typeof osmdControls | null>(null);
  useEffect(() => { osmdControlsRef.current = osmdControls ?? null; }, [osmdControls]);

  const debugButtonState = () => {
    const state = {
      osmdReady,
      hasControls: !!osmdControls,
      isPracticeActive,
      hasOsmd: !!osmd,
      practiceStoreState: usePracticeStore.getState()
    };
    debug('[App] Button state debug:', state);
    return state;
  };

  const handleStartPractice = () => {
    // FIX: Guard heavy debug logging for production performance
    dlog('[IMMEDIATE] Practice start button clicked - testing console.log directly');
    dlog('[IMMEDIATE] Environment check:', { isDevelopment: import.meta.env.DEV, importMeta: import.meta.env });
    logger.system?.('[App] Practice start button clicked');
    debug('[App] handleStartPractice called');
    
    const currentState = {
      osmdReady,
      hasControls: !!osmdControls,
      controlsKeys: osmdControls ? Object.keys(osmdControls) : [],
      isPracticeActive,
      osmdInstance: !!osmd
    };
    logger.system?.('[App] Practice mode state at start', currentState);
    debug('[App] Current state:', currentState);
    
    if (!osmdReady) {
      perfLogger.error('[App] OSMD not ready yet');
      return;
    }
    
    if (!osmdControls) {
      perfLogger.error('[App] OSMD controls not available');
      
      const isStateValid = validateState();
      debug('[App] State validation result:', isStateValid);
      
      if (osmd) {
        debug('[App] OSMD instance exists, attempting recovery...');
        setTimeout(() => {
          // FIX: Use ref to get current controls, not captured stale value
          const validNow = validateState();
          const controlsNow = osmdControlsRef.current;

          if (validNow && controlsNow) {
            debug('[App] State recovered, starting practice directly');
            practiceController.startPractice(); // Avoid recursive stale-call
          } else {
            perfLogger.error?.('[App] Failed to recover state');
          }
        }, 100);
      }
      return;
    }
    
    try {
      if (detectRepeats && typeof detectRepeats === 'function') {
        const repeats = detectRepeats();
        
        if (repeats && repeats.length > 0) {
          const practiceState = usePracticeStore.getState();
          const { repeatsEnabled, repeatsFailed } = practiceState;
          
          if (practiceState.repeatWarningDismissed && repeatsEnabled && !repeatsFailed) {
            debug('[App] Starting practice directly (repeats handled)');
            practiceController.startPractice();
          } else if (!practiceState.repeatWarningDismissed && (!repeatsEnabled || repeatsFailed)) {
            debug('[App] Showing repeat warning');
            setShowRepeatWarning(true);
          } else {
            debug('[App] Starting practice (repeats detected, proceeding)');
            practiceController.startPractice();
          }
        } else {
          debug('[App] Starting practice (no repeats)');
          practiceController.startPractice();
        }
      } else {
        debug('[App] Starting practice (no repeat detection)');
        practiceController.startPractice();
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      perfLogger.error('[App] Error in handleStartPractice:', error);
      throw err; // Let parent handle the error
    }
  };

  const handleRepeatWarningProceed = () => {
    setShowRepeatWarning(false);
    practiceController.startPractice();
  };

  const handleRepeatWarningCancel = () => {
    setShowRepeatWarning(false);
  };

  return {
    isPracticeActive,
    osmdReady,
    practiceController,
    showRepeatWarning,
    handleStartPractice,
    handleRepeatWarningProceed,
    handleRepeatWarningCancel,
    debugButtonState
  };
}

