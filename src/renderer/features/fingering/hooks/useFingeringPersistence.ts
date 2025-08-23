/**
 * Hook to manage loading and saving fingering data for a score
 * Connects Zustand store with IndexedDB persistence
 */

import { useEffect, useRef, useCallback } from 'react';
import { useFingeringStore } from '../stores/fingeringStore';
import { fingeringPersistence } from '../services/FingeringPersistence';
import { perfLogger } from '@/renderer/utils/performance-logger';

interface UseFingeringPersistenceReturn {
  isLoading: boolean;
  isReady: boolean;
  fingerings: Record<string, number>;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Hook to manage loading and saving fingering data for a score
 * 
 * @param scoreId - The ID of the current score (null if no score loaded)
 * @returns Loading state and fingering data
 */
export const useFingeringPersistence = (scoreId: string | null): UseFingeringPersistenceReturn => {
  const { loadAnnotations, annotations, getAllAnnotationsForScore } = useFingeringStore();
  const loadingRef = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>('');
  const isLoadingRef = useRef(true);
  const errorRef = useRef<string | null>(null);
  const pendingSaveRef = useRef(false); // Prevent race conditions
  
  // Manual loading function
  const reload = useCallback(async () => {
    if (!scoreId || loadingRef.current) return;
    
    loadingRef.current = true;
    isLoadingRef.current = true;
    errorRef.current = null;
    
    try {
      const fingerings = await fingeringPersistence.loadFingerings(scoreId);
      
      // Log what we got from persistence (development only)
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('[useFingeringPersistence] Loaded from DB:', {
          scoreId,
          fingeringsCount: Object.keys(fingerings).length,
          sampleFingerings: Object.entries(fingerings).slice(0, 3).map(([noteId, value]) => ({
            noteId,
            value,
            valueType: typeof value
          }))
        });
      }
      
      loadAnnotations(scoreId, fingerings);
      
      perfLogger.debug(`[useFingeringPersistence] Loaded ${Object.keys(fingerings).length} fingerings for score ${scoreId}`);
    } catch (error) {
      const message = `Failed to load fingerings: ${(error as Error).message}`;
      errorRef.current = message;
      perfLogger.error('[useFingeringPersistence] Load error:', error instanceof Error ? error : new Error(String(error)));
    } finally {
      loadingRef.current = false;
      isLoadingRef.current = false;
    }
  }, [scoreId, loadAnnotations]);
  
  // Load fingering data when score changes
  useEffect(() => {
    if (!scoreId) {
      isLoadingRef.current = false;
      return;
    }
    
    // Wait for database to be ready, then load
    const loadWhenReady = async () => {
      try {
        // Wait for database initialization to complete
        await fingeringPersistence.onReady();
        await reload();
      } catch (error) {
        perfLogger.error('[useFingeringPersistence] Database initialization failed:', error instanceof Error ? error : new Error(String(error)));
        errorRef.current = 'Database initialization failed';
        isLoadingRef.current = false;
      }
    };
    
    loadWhenReady();
  }, [scoreId, reload]);

  // Auto-save fingering changes (debounced)
  useEffect(() => {
    if (!scoreId) return;
    
    const currentAnnotations = annotations[scoreId];
    if (!currentAnnotations) return;
    
    // Skip if nothing changed
    const serialized = JSON.stringify(currentAnnotations);
    if (serialized === lastSavedRef.current) return;
    
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // Debounce saves to avoid excessive database writes
    saveTimeoutRef.current = setTimeout(async () => {
      // Prevent overlapping saves (race condition protection)
      if (pendingSaveRef.current) {
        perfLogger.debug('[useFingeringPersistence] Save already in progress, skipping debounced save');
        return;
      }
      
      pendingSaveRef.current = true;
      try {
        // Save all annotations for this score
        await fingeringPersistence.saveFingeringsBatch(scoreId, currentAnnotations);
        lastSavedRef.current = serialized;
        
        perfLogger.debug(`[useFingeringPersistence] Saved ${Object.keys(currentAnnotations).length} fingerings for score ${scoreId}`);
      } catch (error) {
        perfLogger.error('[useFingeringPersistence] Save error:', error instanceof Error ? error : new Error(String(error)));
      } finally {
        pendingSaveRef.current = false;
      }
    }, 1000); // 1 second debounce
    
    // Cleanup
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [scoreId, annotations]);
  
  // Flush saves on unmount or before unload
  useEffect(() => {
    const flushSaves = async () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        
        // Perform immediate save (with race condition protection)
        if (scoreId && annotations[scoreId] && !pendingSaveRef.current) {
          pendingSaveRef.current = true;
          try {
            await fingeringPersistence.saveFingeringsBatch(scoreId, annotations[scoreId]);
            perfLogger.debug('[useFingeringPersistence] Flushed pending saves');
          } catch (error) {
            perfLogger.error('[useFingeringPersistence] Flush save error:', error instanceof Error ? error : new Error(String(error)));
          } finally {
            pendingSaveRef.current = false;
          }
        } else if (pendingSaveRef.current) {
          perfLogger.debug('[useFingeringPersistence] Skipping flush - save already in progress');
        }
      }
    };
    
    // Handle page unload
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Synchronous save attempt (best effort)
      if (scoreId && annotations[scoreId]) {
        const serialized = JSON.stringify(annotations[scoreId]);
        if (serialized !== lastSavedRef.current) {
          // Try to save using sendBeacon if available
          if (navigator.sendBeacon) {
            const data = new Blob([JSON.stringify({
              scoreId,
              fingerings: annotations[scoreId]
            })], { type: 'application/json' });
            navigator.sendBeacon('/api/fingerings/save', data);
          }
          
          // Show warning to user
          e.preventDefault();
          e.returnValue = 'You have unsaved fingering annotations. Are you sure you want to leave?';
        }
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Cleanup on unmount
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushSaves();
    };
  }, [scoreId, annotations]);

  // Get current fingerings for the score
  const fingerings = scoreId ? getAllAnnotationsForScore(scoreId) : {};

  return {
    isLoading: isLoadingRef.current,
    isReady: !isLoadingRef.current && !errorRef.current,
    fingerings,
    error: errorRef.current,
    reload
  };
};