import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { usePracticeStore } from '../stores/practiceStore';
import { formatNoteNames, isValidNoteName, midiToNoteName } from '@/renderer/utils/noteUtils';
import '../styles/hint-system.css';

export const HintSystem: React.FC = () => {
  const { isActive, status, currentStep, attemptCount } = usePracticeStore();
  const audioContextRef = useRef<AudioContext | null>(null);
  const [isEntering, setIsEntering] = useState(false);
  const prevHintLevelRef = useRef(0);
  
  // Determine hint level based on attempt count
  const hintLevel = useMemo(() => {
    if (!isActive || status !== 'feedback_incorrect' || !currentStep || currentStep.isRest) {
      return 0;
    }
    
    if (attemptCount < 3) return 0;
    if (attemptCount < 6) return 1;
    if (attemptCount < 9) return 2;
    return 3;
  }, [isActive, status, currentStep, attemptCount]);
  
  // Get note names for current step
  const noteNames = useMemo(() => {
    if (!currentStep || currentStep.isRest) return '';
    
    // Extract note names with validation and fallbacks
    const validatedNames = currentStep.notes.map(note => {
      if (isValidNoteName(note.pitchName)) {
        return note.pitchName;
      }
      // Fallback to MIDI conversion
      return midiToNoteName(note.midiValue);
    });
    
    return formatNoteNames(validatedNames);
  }, [currentStep]);
  
  // Handle animation when hint level changes
  useEffect(() => {
    if (hintLevel > 0 && hintLevel !== prevHintLevelRef.current) {
      setIsEntering(true);
      const timer = setTimeout(() => {
        setIsEntering(false);
      }, 300); // Match CSS animation duration
      
      prevHintLevelRef.current = hintLevel;
      return () => clearTimeout(timer);
    }
  }, [hintLevel]);
  
  // Cleanup audio context on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);
  
  // Play audio sample for Level 3 hint
  const playAudioSample = useCallback(() => {
    if (!currentStep || currentStep.isRest) return;
    
    // Initialize audio context if needed
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    
    const audioContext = audioContextRef.current;
    const now = audioContext.currentTime;
    
    // Play each note in the chord/step
    currentStep.notes.forEach((note, index) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      // Calculate frequency from MIDI note
      const frequency = 440 * Math.pow(2, (note.midiValue - 69) / 12);
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      
      // Set up envelope
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.3, now + 0.05);
      gainNode.gain.linearRampToValueAtTime(0.2, now + 0.1);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1);
      
      // Connect and play
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Slight delay for chord notes
      const startTime = now + (index * 0.05);
      oscillator.start(startTime);
      oscillator.stop(startTime + 1);
    });
  }, [currentStep]);
  
  // Don't render if no hint should be shown
  if (hintLevel === 0) {
    return null;
  }
  
  return (
    <div 
      data-testid="hint-display" 
      className={`hint-display hint--level-${hintLevel} ${isEntering ? 'hint--entering' : ''}`}
      role="alert"
      aria-live="polite"
      aria-label={`Practice hint level ${hintLevel}: ${noteNames ? `Play ${noteNames}` : 'Follow the guidance'}`}
    >
      {/* Level 1: Note names */}
      {hintLevel >= 1 && (
        <div className="hint-text">
          Hint: Play {noteNames}
        </div>
      )}
      
      {/* Level 2: Keyboard position */}
      {hintLevel >= 2 && currentStep && (
        <div 
          data-testid="keyboard-position-hint" 
          className="keyboard-position-hint"
        >
          <div className="mini-keyboard">
            {/* Show a simplified keyboard with highlighted keys */}
            {currentStep.notes.map(note => (
              <div
                key={note.midiValue}
                data-testid={`hint-key-${note.midiValue}`}
                className="hint-key hint-key--highlighted"
                style={{
                  // Position based on note (simplified)
                  left: `${((note.midiValue - 21) / 88) * 100}%`
                }}
              >
                {note.pitchName}
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Level 3: Play sample */}
      {hintLevel >= 3 && (
        <div className="audio-hint-container">
          <button
            onClick={playAudioSample}
            className="play-sample-button"
            aria-label="Play example"
          >
            🔊 Play Example
          </button>
        </div>
      )}
    </div>
  );
};