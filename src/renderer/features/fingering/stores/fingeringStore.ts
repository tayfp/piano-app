import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { createFingeringId as createId, isValidFingeringValue } from '../utils/fingeringId';
import { perfLogger } from '../utils/simple-perf-logger';
import { fingeringPersistence } from '../services/FingeringPersistence';

interface FingeringState {
  // Map of scoreId -> { map of noteId -> fingering }
  annotations: Record<string, Record<string, number>>;
  
  // Edit mode state (Phase 2 fingering-mvp-ui)
  isEditingMode: boolean;
  
  // Actions (simplified API for Phase 1 tests)
  loadAnnotations: (scoreId: string, data: Record<string, number[] | number>) => void;
  setFingering: (scoreId: string, timestamp: number, midiValue: number, finger: number) => Promise<void>;
  setFingeringByNoteId: (scoreId: string, noteId: string, finger: number) => Promise<void>;
  removeFingering: (scoreId: string, timestamp: number, midiValue: number) => Promise<void>;
  removeFingeringByNoteId: (scoreId: string, noteId: string) => Promise<void>;
  clearAnnotationsForScore: (scoreId: string) => void;
  getFingeringForNote: (scoreId: string, timestamp: number, midiValue: number) => number | null;
  
  // Edit mode actions (Phase 2 fingering-mvp-ui)
  setEditingMode: (enabled: boolean) => void;
  
  // Additional actions (not in tests but useful)
  getAllAnnotationsForScore: (scoreId: string) => Record<string, number>;
  resetStore: () => void;
  clearAllFingerings: () => Promise<void>;
}

// Use the fingering persistence service for IndexedDB storage

export const useFingeringStore = create<FingeringState>()(
  devtools(
    (set, get) => ({
      annotations: {},
      isEditingMode: false,
      
      loadAnnotations: (scoreId, data) => {
        if (!scoreId) {
          perfLogger.warn('[FingeringStore] Cannot load annotations without scoreId');
          return;
        }
        
        // DEBUG: Log what we're loading
        console.log('🔍 DEBUG loadAnnotations:', {
          scoreId,
          dataKeys: Object.keys(data),
          sampleData: Object.entries(data).slice(0, 3).map(([k, v]) => ({
            noteId: k,
            value: v,
            type: Array.isArray(v) ? 'array' : typeof v
          }))
        });
        
        // Validate and migrate fingering values before loading
        const validData: Record<string, number> = {};
        let invalidCount = 0;
        
        for (const [noteId, fingerValue] of Object.entries(data)) {
          // Migrate from array format to single value (take last value if array)
          let finger: number;
          if (Array.isArray(fingerValue)) {
            finger = fingerValue[fingerValue.length - 1]; // Take last value from array
          } else {
            finger = fingerValue as number;
          }
          
          if (isValidFingeringValue(finger)) {
            validData[noteId] = finger;
          } else {
            invalidCount++;
          }
        }
        
        if (invalidCount > 0) {
          perfLogger.warn(`[FingeringStore] Skipped ${invalidCount} invalid fingering values`);
        }
        
        // DEBUG: Log what we're setting
        console.log('🔍 DEBUG loadAnnotations result:', {
          validDataKeys: Object.keys(validData),
          sampleValidData: Object.entries(validData).slice(0, 3)
        });
        
        set(
          (state) => ({
            annotations: { ...state.annotations, [scoreId]: validData }
          }),
          false,
          'loadAnnotations'
        );
      },
      
      setFingering: async (scoreId, timestamp, midiValue, finger) => {
        if (!scoreId) {
          perfLogger.warn('[FingeringStore] Cannot set fingering without scoreId');
          return;
        }
        
        if (!isValidFingeringValue(finger)) {
          perfLogger.warn(`[FingeringStore] Invalid fingering value: ${finger}`);
          return;
        }
        
        const noteId = createId(timestamp, midiValue);
        
        // ISSUE #10 DEBUG LOG 5: Log Zustand State Before Update
        if (process.env.NODE_ENV === 'development') {
          const currentState = get();
          console.log('🐛 [ISSUE #10 DEBUG] Pre-update Zustand fingerings state:', {
            scoreId,
            noteId,
            newFinger: finger,
            existingAnnotations: currentState.annotations[scoreId] || {},
            totalFingeringsForScore: Object.keys(currentState.annotations[scoreId] || {}).length
          });
        }
        
        // 1. Update UI immediately (optimistic update)
        set(
          (state) => {
            // Simple replacement - each note has one fingering
            console.log('🔍 FINGERING DEBUG - setFingering:', {
              scoreId,
              noteId,
              finger,
              operation: 'REPLACE'
            });
            
            return {
              annotations: {
                ...state.annotations,
                [scoreId]: {
                  ...(state.annotations[scoreId] || {}),
                  [noteId]: finger,
                },
              },
            };
          },
          false,
          'setFingering'
        );
        
        // ISSUE #10 DEBUG LOG 5: Log Zustand State After Update
        if (process.env.NODE_ENV === 'development') {
          const newState = get();
          console.log('🐛 [ISSUE #10 DEBUG] Post-update Zustand fingerings state:', {
            scoreId,
            noteId,
            finger,
            updatedAnnotations: newState.annotations[scoreId] || {},
            totalFingeringsForScore: Object.keys(newState.annotations[scoreId] || {}).length
          });
        }
        
        // 2. Persist atomically in background
        try {
          await fingeringPersistence.saveFingering(scoreId, noteId, finger);
          perfLogger.debug('[FingeringStore] Persisted fingering:', { scoreId, noteId, finger });
        } catch (error) {
          perfLogger.error('[FingeringStore] Failed to persist fingering:', error);
          // Could implement rollback here if needed
        }
      },
      
      setFingeringByNoteId: async (scoreId, noteId, finger) => {
        // 💾 DEBUG: Log exactly what we're saving
        console.log('💾 STORE: Saving with ID:', noteId, {
          scoreId,
          finger,
          caller: new Error().stack?.split('\n')[2]
        });
        
        if (!scoreId || !noteId) {
          perfLogger.warn('[FingeringStore] Cannot set fingering without scoreId and noteId');
          return;
        }
        
        if (!isValidFingeringValue(finger)) {
          perfLogger.warn(`[FingeringStore] Invalid fingering value: ${finger}`);
          return;
        }
        
        // 1. Update UI immediately (optimistic update)
        set(
          (state) => {
            // Simple replacement - each note has one fingering
            console.log('🔍 FINGERING DEBUG - setFingeringByNoteId:', {
              scoreId,
              noteId,
              finger,
              operation: 'REPLACE'
            });
            
            return {
              annotations: {
                ...state.annotations,
                [scoreId]: {
                  ...(state.annotations[scoreId] || {}),
                  [noteId]: finger,
                },
              },
            };
          },
          false,
          'setFingeringByNoteId'
        );
        
        // 2. Persist atomically in background
        try {
          await fingeringPersistence.saveFingering(scoreId, noteId, finger);
          perfLogger.debug('[FingeringStore] Persisted fingering by noteId:', { scoreId, noteId, finger });
        } catch (error) {
          perfLogger.error('[FingeringStore] Failed to persist fingering:', error);
        }
      },

      removeFingering: async (scoreId, timestamp, midiValue) => {
        if (!scoreId) {
          perfLogger.warn('[FingeringStore] Cannot remove fingering without scoreId');
          return;
        }
        
        const noteId = createId(timestamp, midiValue);
        
        // 1. Update UI immediately (optimistic update)
        set(
          (state) => {
            const scoreAnnotations = state.annotations[scoreId];
            if (!scoreAnnotations) {
              return state; // No annotations for this score
            }
            
            const { [noteId]: removed, ...rest } = scoreAnnotations;
            
            // If no annotations left for this score, remove the score entry entirely
            const updatedAnnotations = Object.keys(rest).length > 0
              ? { ...state.annotations, [scoreId]: rest }
              : (() => {
                  const { [scoreId]: removedScore, ...remainingScores } = state.annotations;
                  return remainingScores;
                })();
            
            return { annotations: updatedAnnotations };
          },
          false,
          'removeFingering'
        );
        
        // 2. Persist atomically in background
        try {
          await fingeringPersistence.removeFingering(scoreId, noteId);
          perfLogger.debug('[FingeringStore] Removed fingering from storage:', { scoreId, noteId });
        } catch (error) {
          perfLogger.error('[FingeringStore] Failed to remove fingering:', error);
          // Could implement rollback here if needed
        }
      },
      
      removeFingeringByNoteId: async (scoreId, noteId) => {
        if (!scoreId || !noteId) {
          perfLogger.warn('[FingeringStore] Cannot remove fingering without scoreId and noteId');
          return;
        }
        
        // 1. Update UI immediately (optimistic update)
        set(
          (state) => {
            const scoreAnnotations = state.annotations[scoreId];
            if (!scoreAnnotations) {
              return state; // No annotations for this score
            }
            
            const { [noteId]: removed, ...rest } = scoreAnnotations;
            
            // If no annotations left for this score, remove the score entry entirely
            const updatedAnnotations = Object.keys(rest).length > 0
              ? { ...state.annotations, [scoreId]: rest }
              : (() => {
                  const { [scoreId]: removedScore, ...remainingScores } = state.annotations;
                  return remainingScores;
                })();
            
            return { annotations: updatedAnnotations };
          },
          false,
          'removeFingeringByNoteId'
        );
        
        // 2. Persist atomically in background
        try {
          await fingeringPersistence.removeFingering(scoreId, noteId);
          perfLogger.debug('[FingeringStore] Removed fingering by noteId from storage:', { scoreId, noteId });
        } catch (error) {
          perfLogger.error('[FingeringStore] Failed to remove fingering:', error);
        }
      },

      clearAnnotationsForScore: (scoreId) => {
        if (!scoreId) {
          perfLogger.warn('[FingeringStore] Cannot clear annotations without scoreId');
          return;
        }
        
        set(
          (state) => {
            const { [scoreId]: removed, ...rest } = state.annotations;
            return { annotations: rest };
          },
          false,
          'clearAnnotationsForScore'
        );
      },

      getFingeringForNote: (scoreId, timestamp, midiValue) => {
        if (!scoreId) return null;
        
        const state = get();
        const noteId = createId(timestamp, midiValue);
        return state.annotations[scoreId]?.[noteId] ?? null;
      },
      
      getAllAnnotationsForScore: (scoreId) => {
        if (!scoreId) return {};
        
        const state = get();
        const annotations = state.annotations[scoreId] || {};
        
        // DEBUG: Log what we're returning
        console.log('🔍 DEBUG getAllAnnotationsForScore:', {
          scoreId,
          annotationCount: Object.keys(annotations).length,
          sampleAnnotations: Object.entries(annotations).slice(0, 3).map(([noteId, value]) => ({
            noteId,
            value,
            isArray: Array.isArray(value),
            type: typeof value
          }))
        });
        
        return annotations;
      },

      setEditingMode: (enabled: boolean) => {
        set(
          { isEditingMode: enabled },
          false,
          'setEditingMode'
        );
      },
      
      resetStore: () => {
        set(
          { annotations: {}, isEditingMode: false },
          false,
          'resetStore'
        );
      },

      clearAllFingerings: async () => {
        // Clear from memory first
        set(
          { annotations: {} },
          false,
          'clearAllFingerings'
        );
        
        // Clear from database
        try {
          await fingeringPersistence.clearAllFingerings();
          perfLogger.debug('[FingeringStore] Cleared all fingerings from memory and database');
        } catch (error) {
          perfLogger.error('[FingeringStore] Failed to clear all fingerings from database:', error);
        }
      }
    }),
    { 
      name: 'fingering-store',
      // Only track state changes in development
      trace: process.env.NODE_ENV === 'development'
    }
  )
);