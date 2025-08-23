import { useState, useCallback, useRef, useEffect } from 'react';
import { useFingeringStore } from '../stores/fingeringStore';
import { createFingeringId, parseFingeringId } from '../utils/fingeringId';
import { getFirstNoteId } from '../utils/getDataNoteId';

export interface FingeringPosition {
  x: number;
  y: number;
  noteElement?: any;
}

export interface FingeringInteractionState {
  selectedNoteId: string | null;
  isInputOpen: boolean;
  inputPosition: FingeringPosition | null;
  isEditingMode: boolean;
  error: string | null;
}

export interface NoteClickInfo {
  noteId: string;
  timestamp: number;
  midiValue: number;
  position: FingeringPosition;
}

export const useFingeringInteraction = () => {
  const [state, setState] = useState<FingeringInteractionState>({
    selectedNoteId: null,
    isInputOpen: false,
    inputPosition: null,
    isEditingMode: false,
    error: null
  });

  const { setFingeringByNoteId, removeFingeringByNoteId } = useFingeringStore();
  const debounceTimeoutRef = useRef<NodeJS.Timeout>();

  const setEditingMode = useCallback((enabled: boolean) => {
    setState(prev => ({ ...prev, isEditingMode: enabled }));
  }, []);

  const setActiveInput = useCallback((noteId: string, position: FingeringPosition, currentValue?: number | null) => {
    setState(prev => ({
      ...prev,
      selectedNoteId: noteId,
      isInputOpen: true,
      inputPosition: position,
      error: null
    }));
  }, []);

  const closeInput = useCallback(() => {
    setState(prev => ({
      ...prev,
      selectedNoteId: null,
      isInputOpen: false,
      inputPosition: null,
      error: null
    }));
  }, []);

  const handleNoteClick = useCallback((event: React.MouseEvent | MouseEvent, noteElement?: Element) => {
    if (!state.isEditingMode) return;

    // Clear existing debounce
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Debounce rapid clicks (150ms)
    debounceTimeoutRef.current = setTimeout(() => {
      try {
        let targetElement = noteElement;
        if (!targetElement) {
          targetElement = event.target as Element;
        }

        // Find note element with data-note-id using centralized utility
        const noteId = getFirstNoteId(targetElement);

        if (!noteId) return;

        // Calculate position
        const rect = targetElement?.getBoundingClientRect();
        if (rect) {
          const position: FingeringPosition = {
            x: rect.left + rect.width / 2,
            y: rect.top - 40, // Above note
            noteElement: targetElement
          };

          setActiveInput(noteId, position);
        }
      } catch (error) {
        console.warn('Error handling note click:', error);
      }
    }, 150);
  }, [state.isEditingMode, setActiveInput]);

  const submitFingering = useCallback(async (value: number | null, scoreId = 'default') => {
    if (!state.selectedNoteId) return;

    try {
      // Use the noteId directly without parsing
      if (value === null) {
        await removeFingeringByNoteId(scoreId, state.selectedNoteId);
      } else {
        await setFingeringByNoteId(scoreId, state.selectedNoteId, value);
      }

      closeInput();
    } catch (error) {
      setState(prev => ({ ...prev, error: 'Failed to save. Please try again.' }));
      console.error('Failed to submit fingering:', error);
    }
  }, [state.selectedNoteId, setFingeringByNoteId, removeFingeringByNoteId, closeInput]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return {
    ...state,
    setEditingMode,
    setActiveInput,
    closeInput,
    handleNoteClick,
    submitFingering
  };
};