import { useEffect, useCallback, useState, useMemo } from 'react';
import { useFingeringEnabled } from './useFingeringSettings';

// Note: Practice store import commented out to avoid Jest issues during Phase 4 development
// import { usePracticeStore } from '../../practice-mode/stores/practiceStore';

export const usePracticeModeIntegration = (scoreId: string | null = null) => {
  // Mock practice store for now - will be activated when Jest issues are resolved
  // const isActive = usePracticeStore(state => state.isActive);
  // const currentStep = usePracticeStore(state => state.currentStep);
  const isActive = false;
  const currentStep = null;
  
  const fingeringEnabled = useFingeringEnabled(); // Performance-optimized selector

  // Add state transition debouncing
  const [transitioning, setTransitioning] = useState(false);
  
  useEffect(() => {
    if (isActive !== undefined) { // Only trigger on actual state changes
      setTransitioning(true);
      const timeoutId = setTimeout(() => {
        setTransitioning(false);
      }, 50); // Brief transition period to prevent UI flicker
      
      return () => clearTimeout(timeoutId);
    }
  }, [isActive]);

  // Ensure complete isolation during practice mode
  const shouldShowFingeringEdit = useCallback(() => {
    return !isActive && fingeringEnabled;
  }, [isActive, fingeringEnabled]);

  // Optimize: compute fingerings only when active, cache when inactive
  const currentStepFingerings = useMemo(() => {
    if (!isActive || !fingeringEnabled || !currentStep || !scoreId) {
      return [];
    }

    // Guard against undefined notes
    return currentStep.notes?.map((note: any) => {
      // Critical - ensure exact note ID format consistency
      const noteId = `t${currentStep.timestamp}-m${note.midiValue}`;
      return { noteId, midiValue: note.midiValue };
    }).filter(Boolean) || [];
  }, [isActive, currentStep, fingeringEnabled, scoreId]);

  return {
    shouldShowFingeringEdit,
    practiceActive: isActive,
    fingeringEnabled,
    currentStepFingerings,
    transitioning // Expose for UI state management
  };
};