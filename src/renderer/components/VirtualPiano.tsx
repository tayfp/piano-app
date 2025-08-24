/**
 * Enhanced Virtual Piano Component
 * 
 * Provides a full-featured virtual piano when hardware MIDI is unavailable.
 * Maintains feature parity with hardware MIDI for seamless user experience.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMidiStore } from '@/renderer/stores/midiStore';

interface VirtualPianoProps {
  onNotePlay?: (note: number, velocity: number) => void;
  onNoteStop?: (note: number) => void;
  className?: string;
  octaveRange?: { min: number; max: number };
  showLabels?: boolean;
  enableVelocitySensitivity?: boolean;
}

interface PianoKey {
  note: number;
  isBlack: boolean;
  keyLabel: string;
  keyboardKey?: string; // Computer keyboard mapping
}

export const VirtualPiano: React.FC<VirtualPianoProps> = ({
  onNotePlay,
  onNoteStop,
  className = '',
  octaveRange = { min: 3, max: 6 }, // C3 to C6 (4 octaves)
  showLabels = true,
  enableVelocitySensitivity = true
}) => {
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set());
  const [currentOctave, setCurrentOctave] = useState(4); // Default to octave 4
  const [velocityMode, setVelocityMode] = useState<'touch' | 'keyboard'>('touch');
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorsRef = useRef<Map<number, OscillatorNode>>(new Map());

  // Get velocity curve from store for consistency with MIDI
  const { velocityCurve, applyVelocityCurve } = useMidiStore();

  // Initialize audio context
  useEffect(() => {
    audioContextRef.current = new AudioContext();
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  // Generate piano keys for the specified octave range
  const generateKeys = useCallback((): PianoKey[] => {
    const keys: PianoKey[] = [];
    const keyboardMappings = [
      'a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j' // One octave
    ];

    for (let octave = octaveRange.min; octave <= octaveRange.max; octave++) {
      const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      
      noteNames.forEach((noteName, index) => {
        const note = octave * 12 + index;
        const isBlack = noteName.includes('#');
        const keyboardIndex = index % keyboardMappings.length;
        const keyboardKey = octave === currentOctave ? keyboardMappings[keyboardIndex] : undefined;
        
        keys.push({
          note,
          isBlack,
          keyLabel: `${noteName}${octave}`,
          keyboardKey
        });
      });
    }

    return keys;
  }, [octaveRange, currentOctave]);

  // Convert note number to frequency
  const noteToFrequency = useCallback((note: number): number => {
    return 440 * Math.pow(2, (note - 69) / 12); // A4 = 440Hz (note 69)
  }, []);

  // Play note with Web Audio API
  const playNote = useCallback((note: number, velocity: number = 100) => {
    if (!audioContextRef.current) return;

    // Apply velocity curve transformation
    const adjustedVelocity = applyVelocityCurve(velocity, velocityCurve);
    
    // Create oscillator
    const oscillator = audioContextRef.current.createOscillator();
    const gainNode = audioContextRef.current.createGain();
    
    oscillator.type = 'triangle'; // Piano-like tone
    oscillator.frequency.setValueAtTime(
      noteToFrequency(note), 
      audioContextRef.current.currentTime
    );
    
    // Set volume based on velocity
    const volume = (adjustedVelocity / 127) * 0.3; // Max 0.3 to avoid distortion
    gainNode.gain.setValueAtTime(volume, audioContextRef.current.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.01, 
      audioContextRef.current.currentTime + 2 // 2 second decay
    );
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContextRef.current.destination);
    
    oscillator.start();
    oscillator.stop(audioContextRef.current.currentTime + 2);
    
    // Track oscillator for potential early stopping
    oscillatorsRef.current.set(note, oscillator);
    
    // Cleanup
    oscillator.onended = () => {
      oscillatorsRef.current.delete(note);
    };

    // Update pressed keys state
    setPressedKeys(prev => new Set(prev).add(note));
    
    // Call external handlers
    onNotePlay?.(note, adjustedVelocity);
  }, [noteToFrequency, applyVelocityCurve, velocityCurve, onNotePlay]);

  // Stop note
  const stopNote = useCallback((note: number) => {
    const oscillator = oscillatorsRef.current.get(note);
    if (oscillator) {
      try {
        oscillator.stop();
      } catch (e) {
        // Oscillator may already be stopped
      }
      oscillatorsRef.current.delete(note);
    }

    // Update pressed keys state
    setPressedKeys(prev => {
      const newSet = new Set(prev);
      newSet.delete(note);
      return newSet;
    });

    onNoteStop?.(note);
  }, [onNoteStop]);

  // Keyboard event handlers
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.repeat) return; // Ignore key repeat

    const keys = generateKeys();
    const key = keys.find(k => k.keyboardKey === event.key.toLowerCase());
    
    if (key && !pressedKeys.has(key.note)) {
      event.preventDefault();
      
      // Determine velocity based on mode
      let velocity = 100; // Default velocity
      if (enableVelocitySensitivity && velocityMode === 'keyboard') {
        // Simulate velocity based on key timing (simple approach)
        velocity = Math.random() * 40 + 80; // 80-120 range
      }
      
      playNote(key.note, velocity);
    }

    // Handle octave switching
    if (event.key === 'z') {
      setCurrentOctave(prev => Math.max(octaveRange.min, prev - 1));
    } else if (event.key === 'x') {
      setCurrentOctave(prev => Math.min(octaveRange.max, prev + 1));
    }
  }, [generateKeys, pressedKeys, playNote, octaveRange, enableVelocitySensitivity, velocityMode]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    const keys = generateKeys();
    const key = keys.find(k => k.keyboardKey === event.key.toLowerCase());
    
    if (key && pressedKeys.has(key.note)) {
      event.preventDefault();
      stopNote(key.note);
    }
  }, [generateKeys, pressedKeys, stopNote]);

  // Mouse/touch handlers for on-screen piano
  const handleMouseDown = useCallback((note: number, event: React.MouseEvent) => {
    event.preventDefault();
    
    let velocity = 100;
    if (enableVelocitySensitivity && velocityMode === 'touch') {
      // Use click position for velocity sensitivity
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      const relativeY = (event.clientY - rect.top) / rect.height;
      velocity = Math.floor(40 + (1 - relativeY) * 87); // 40-127 range
    }
    
    if (!pressedKeys.has(note)) {
      playNote(note, velocity);
    }
  }, [playNote, pressedKeys, enableVelocitySensitivity, velocityMode]);

  const handleMouseUp = useCallback((note: number, event: React.MouseEvent) => {
    event.preventDefault();
    stopNote(note);
  }, [stopNote]);

  // Set up keyboard event listeners
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // Cleanup oscillators on unmount
  useEffect(() => {
    return () => {
      oscillatorsRef.current.forEach(oscillator => {
        try {
          oscillator.stop();
        } catch (e) {
          // Ignore errors
        }
      });
      oscillatorsRef.current.clear();
    };
  }, []);

  const keys = generateKeys();

  return (
    <div className={`virtual-piano ${className}`}>
      <div className="piano-controls">
        <div className="octave-controls">
          <button 
            onClick={() => setCurrentOctave(prev => Math.max(octaveRange.min, prev - 1))}
            disabled={currentOctave <= octaveRange.min}
          >
            ← Octave
          </button>
          <span>Octave: {currentOctave}</span>
          <button 
            onClick={() => setCurrentOctave(prev => Math.min(octaveRange.max, prev + 1))}
            disabled={currentOctave >= octaveRange.max}
          >
            Octave →
          </button>
        </div>

        {enableVelocitySensitivity && (
          <div className="velocity-controls">
            <label>
              <input
                type="radio"
                value="touch"
                checked={velocityMode === 'touch'}
                onChange={(e) => setVelocityMode(e.target.value as 'touch')}
              />
              Touch Velocity
            </label>
            <label>
              <input
                type="radio"
                value="keyboard"
                checked={velocityMode === 'keyboard'}
                onChange={(e) => setVelocityMode(e.target.value as 'keyboard')}
              />
              Random Velocity
            </label>
          </div>
        )}
      </div>

      <div className="piano-keyboard">
        <div className="white-keys">
          {keys.filter(key => !key.isBlack).map(key => (
            <button
              key={key.note}
              className={`piano-key white-key ${pressedKeys.has(key.note) ? 'pressed' : ''}`}
              onMouseDown={(e) => handleMouseDown(key.note, e)}
              onMouseUp={(e) => handleMouseUp(key.note, e)}
              onMouseLeave={(e) => handleMouseUp(key.note, e)}
            >
              {showLabels && (
                <div className="key-labels">
                  <span className="note-label">{key.keyLabel}</span>
                  {key.keyboardKey && (
                    <span className="keyboard-label">{key.keyboardKey.toUpperCase()}</span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="black-keys">
          {keys.filter(key => key.isBlack).map(key => (
            <button
              key={key.note}
              className={`piano-key black-key ${pressedKeys.has(key.note) ? 'pressed' : ''}`}
              onMouseDown={(e) => handleMouseDown(key.note, e)}
              onMouseUp={(e) => handleMouseUp(key.note, e)}
              onMouseLeave={(e) => handleMouseUp(key.note, e)}
              style={{
                left: `${((key.note % 12) * 8.33) + getBlackKeyOffset(key.note % 12)}%`
              }}
            >
              {showLabels && key.keyboardKey && (
                <span className="keyboard-label black">{key.keyboardKey.toUpperCase()}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="piano-help">
        <p>
          <strong>Keyboard:</strong> Use keys A-J for current octave • Z/X to change octave •
          Click piano keys for touch velocity
        </p>
      </div>

      <style jsx>{`
        .virtual-piano {
          user-select: none;
          max-width: 800px;
          margin: 0 auto;
        }

        .piano-controls {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding: 16px;
          background: #f8f9fa;
          border-radius: 8px;
        }

        .octave-controls {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .octave-controls button {
          padding: 8px 16px;
          border: 1px solid #ddd;
          border-radius: 4px;
          background: white;
          cursor: pointer;
        }

        .octave-controls button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .velocity-controls {
          display: flex;
          gap: 16px;
        }

        .velocity-controls label {
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
        }

        .piano-keyboard {
          position: relative;
          height: 200px;
          background: #333;
          border-radius: 8px;
          padding: 8px;
        }

        .white-keys {
          display: flex;
          height: 100%;
        }

        .black-keys {
          position: absolute;
          top: 8px;
          left: 8px;
          right: 8px;
          height: 60%;
          pointer-events: none;
        }

        .piano-key {
          border: 1px solid #ccc;
          cursor: pointer;
          user-select: none;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding: 8px;
          transition: all 0.1s ease;
          position: relative;
        }

        .white-key {
          flex: 1;
          background: white;
          color: #333;
          margin-right: 1px;
        }

        .white-key:hover {
          background: #f0f0f0;
        }

        .white-key.pressed {
          background: #ddd;
          transform: translateY(2px);
        }

        .black-key {
          position: absolute;
          width: 6%;
          height: 100%;
          background: #222;
          color: white;
          pointer-events: auto;
          z-index: 1;
          border-radius: 0 0 4px 4px;
        }

        .black-key:hover {
          background: #333;
        }

        .black-key.pressed {
          background: #444;
          transform: translateY(2px);
        }

        .key-labels {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }

        .note-label {
          font-size: 10px;
          font-weight: bold;
        }

        .keyboard-label {
          font-size: 12px;
          padding: 2px 6px;
          background: rgba(0,0,0,0.1);
          border-radius: 3px;
        }

        .keyboard-label.black {
          background: rgba(255,255,255,0.2);
        }

        .piano-help {
          margin-top: 16px;
          text-align: center;
          color: #666;
          font-size: 14px;
        }
      `}</style>
    </div>
  );
};

// Helper function to calculate black key positions
function getBlackKeyOffset(noteIndex: number): number {
  // Black key positions relative to white keys
  const offsets = {
    1: 5.5,   // C#
    3: 13.5,  // D#
    6: 27,    // F#
    8: 35,    // G#
    10: 43    // A#
  };
  
  return offsets[noteIndex as keyof typeof offsets] || 0;
}