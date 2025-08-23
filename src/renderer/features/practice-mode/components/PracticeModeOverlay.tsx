/**
 * Practice Mode UI Overlay Component
 * 
 * Displays current practice status, expected notes, and feedback
 * with smooth animations and keyboard shortcuts support.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { usePracticeStore } from '../stores/practiceStore';
import type { PracticeStatus, ComparisonResult } from '../types';
import { formatNoteNames, formatWrongNotes, isValidNoteName, midiToNoteName } from '@/renderer/utils/noteUtils';
import { perfLogger } from '@/renderer/utils/performance-logger';

const statusMessages: Record<PracticeStatus, string> = {
  idle: 'Ready',
  listening: 'Waiting for input...',
  evaluating: 'Checking...',
  feedback_correct: 'Correct!',
  feedback_incorrect: 'Try again',
};

export const PracticeModeOverlay: React.FC = () => {
  const {
    isActive,
    status,
    currentStep,
    lastResult,
    attemptCount,
    startPractice,
    stopPractice,
  } = usePracticeStore();

  const [isEntering, setIsEntering] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [hasBeenActivated, setHasBeenActivated] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  
  // Track if component has been properly mounted (for StrictMode double-mount)
  const isMountedRef = useRef(false);

  // Handle visibility transitions
  useEffect(() => {
    if (isActive) {
      setHasBeenActivated(true);
      if (!shouldRender) {
        setShouldRender(true);
        setIsEntering(true);
        setTimeout(() => setIsEntering(false), 100);
      }
    } else if (!isActive && shouldRender) {
      // Keep rendering to show prompt after deactivation
      setIsExiting(true);
      setTimeout(() => {
        setIsExiting(false);
      }, 300);
    }
  }, [isActive, shouldRender]);

  // Handle spacebar keyboard shortcut
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault();
      console.log('[PracticeModeOverlay] Spacebar pressed, isActive:', isActive, 'isMounted:', isMountedRef.current);
      
      // Prevent handling events before component is fully mounted
      if (!isMountedRef.current) {
        perfLogger.debug('[PracticeModeOverlay] Ignoring spacebar - component not fully mounted yet');
        return;
      }
      
      if (isActive) {
        perfLogger.debug('[PracticeModeOverlay] Calling stopPractice from spacebar handler');
        stopPractice();
      } else {
        startPractice();
      }
    }
  }, [isActive, startPractice, stopPractice]);

  useEffect(() => {
    perfLogger.debug('[PracticeModeOverlay] Component mounted, registering keydown listener');
    
    // Set mounted flag after a small delay to prevent immediate triggers
    const mountTimer = setTimeout(() => {
      isMountedRef.current = true;
      perfLogger.debug('[PracticeModeOverlay] Component fully mounted, ready for input');
    }, 100);
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      perfLogger.debug('[PracticeModeOverlay] Component unmounting, removing keydown listener');
      clearTimeout(mountTimer);
      isMountedRef.current = false;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // Don't render if never activated and currently inactive
  if (!hasBeenActivated && !isActive) {
    return null;
  }

  // Don't render if transitioning to hidden after deactivation is complete
  if (!isActive && !shouldRender && hasBeenActivated) {
    return null;
  }

  // Format expected notes display
  const formatExpectedNotes = () => {
    if (!currentStep) return '';
    
    if (currentStep.isRest) {
      return 'Rest';
    }
    
    // Extract note names with validation and fallbacks
    const noteNames = currentStep.notes.map(note => {
      // Validate the pitchName and provide fallback
      if (isValidNoteName(note.pitchName)) {
        return note.pitchName;
      }
      
      // Fallback to MIDI-to-note conversion
      perfLogger.warn(`Invalid pitch name detected: "${note.pitchName}", using MIDI fallback`);
      return midiToNoteName(note.midiValue);
    });
    
    return formatNoteNames(noteNames);
  };

  // Get additional classes based on state
  const getOverlayClasses = () => {
    const classes = ['practice-overlay'];
    
    if (isActive) classes.push('practice-overlay--active');
    if (isEntering) classes.push('practice-overlay--entering');
    if (isExiting) classes.push('practice-overlay--exiting');
    
    // Status-based classes
    const statusClass = {
      listening: 'practice-overlay--listening',
      evaluating: 'practice-overlay--evaluating',
      feedback_correct: 'practice-overlay--correct',
      feedback_incorrect: 'practice-overlay--incorrect',
    }[status];
    
    if (statusClass) classes.push(statusClass);
    
    return classes.join(' ');
  };

  // Render wrong notes feedback
  const renderWrongNotesFeedback = () => {
    if (!lastResult || lastResult.type !== 'WRONG_NOTES') return null;
    
    const wrongNotesText = formatWrongNotes(lastResult.wrong);
    
    return (
      <div className="practice-overlay__wrong-notes">
        Wrong notes: {wrongNotesText}
      </div>
    );
  };

  return (
    <div
      data-testid="practice-overlay"
      className={getOverlayClasses()}
      role="status"
      aria-live="polite"
      aria-label="Practice mode status"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    >
      <div className="practice-overlay__content">
        {/* Status message */}
        <div className="practice-overlay__status">
          {statusMessages[status]}
        </div>

        {/* Expected notes display */}
        {currentStep && isActive && (
          <div className="practice-overlay__expected">
            {currentStep.isRest ? (
              <>
                <div>Rest</div>
                <div className="practice-overlay__hint">Wait for the rest to complete</div>
              </>
            ) : (
              <>
                <div>
                  <span>Play:</span> <span>{formatExpectedNotes()}</span>
                </div>
                {currentStep.isChord && <span className="practice-overlay__chord-indicator">(chord)</span>}
              </>
            )}
          </div>
        )}

        {/* Attempt counter */}
        {attemptCount > 0 && status === 'feedback_incorrect' && (
          <div className="practice-overlay__attempts">
            Attempt {attemptCount}
          </div>
        )}

        {/* Wrong notes feedback */}
        {renderWrongNotesFeedback()}

        {/* Inactive prompt - show after practice has been activated once */}
        {!isActive && hasBeenActivated && (
          <div className="practice-overlay__prompt">
            Press spacebar to start practice
          </div>
        )}
      </div>
    </div>
  );
};