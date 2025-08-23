import React, { useMemo } from 'react';
import { usePianoStore, keyIdToMidiNote, getPianoKeyClasses } from '@/renderer/stores/pianoStore';
import { PianoKeyData } from '../utils/pianoUtils';

interface PianoKeyProps {
  keyData: PianoKeyData;
  style?: React.CSSProperties;
}

export const PianoKey = React.memo<PianoKeyProps>(({ keyData, style }): React.ReactElement => {
  // Convert piano key ID to MIDI note for state lookup
  const midiNote = useMemo(() => keyIdToMidiNote(keyData.id), [keyData.id]);
  
  // Use fine-grained selectors for performance optimization
  const isActive = usePianoStore((state) => 
    midiNote >= 0 ? (state.activeNotes.get(midiNote) || 0) > 0 : false
  );
  
  const velocity = usePianoStore((state) => 
    midiNote >= 0 ? (state.noteVelocities.get(midiNote) || 0) : 0
  );
  
  const practiceHighlight = usePianoStore((state) =>
    midiNote >= 0 ? state.practiceHighlights.get(midiNote) : undefined
  );
  
  // Generate unified CSS classes using the new helper
  const combinedClassName = useMemo(() => {
    if (midiNote < 0) return 'piano-key';
    
    return getPianoKeyClasses(
      midiNote,
      keyData.type === 'white',
      isActive,
      velocity,
      practiceHighlight,
      keyData.isLandmark
    ).join(' ');
  }, [midiNote, keyData.type, keyData.isLandmark, isActive, velocity, practiceHighlight]);
  
  return (
    <button
      className={combinedClassName}
      aria-label={`${keyData.isLandmark ? keyData.fullName + ' (landmark)' : 'Piano key ' + keyData.fullName}`}
      aria-pressed={isActive ? "true" : "false"}
      title={keyData.fullName}
      data-note={keyData.fullName}
      data-midi-note={midiNote}
      data-testid={`piano-key-${keyData.id}`}
      style={style}
      tabIndex={0}
    />
  );
}, (prevProps, nextProps) => {
  // Enhanced memo comparison - only re-render if keyData actually changes
  return prevProps.keyData.id === nextProps.keyData.id && 
         prevProps.style === nextProps.style;
});

PianoKey.displayName = 'PianoKey';