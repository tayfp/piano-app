import { useMemo } from 'react';
import { MAX_FINGERING_RENDER_LIMIT } from '../utils/fingeringConfig';
import { perfLogger } from '../utils/simple-perf-logger';

export interface UseFingeringViewportProps {
  annotations: Record<string, number>;
  visibleTimeRange?: { start: number; end: number };
}

/**
 * Hook for viewport optimization - filters fingerings based on visible time range
 * and applies performance limits to maintain <20ms render budget
 */
export const useFingeringViewport = ({
  annotations,
  visibleTimeRange
}: UseFingeringViewportProps): Array<[string, number]> => {
  const visibleFingerings = useMemo(() => {
    const startTime = performance.now();
    
    // DEBUG: Log what we're trying to filter
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug('FINGERING DEBUG - visibleFingerings calculation:', {
        annotationsCount: Object.keys(annotations).length,
        visibleTimeRange,
        sampleNoteIds: Object.keys(annotations).slice(0, 3),
        // DEBUG: Show full annotations to see if chord notes both have fingerings
        allAnnotations: annotations
      });
    }
    
    const filtered = Object.entries(annotations).filter(([noteId, finger]) => {
      if (!visibleTimeRange) return true;
      
      // Parse timestamp from noteId (format: t{timestamp}-m{midiValue})
      const timestampMatch = noteId.match(/^t(.+)-m/);
      if (!timestampMatch) {
        // Non-timestamp IDs (e.g. m0-s0-v0-n0-midi60) should be visible
        // This handles the new position-based ID format
        return true;
      }
      
      const timestamp = parseFloat(timestampMatch[1]);
      
      // Handle invalid timestamps (NaN) by treating them as non-timestamp notes
      if (isNaN(timestamp)) {
        return true;
      }
      
      return timestamp >= visibleTimeRange.start && timestamp <= visibleTimeRange.end;
    });
    
    // Limit rendering for performance (configurable)
    if (filtered.length > MAX_FINGERING_RENDER_LIMIT) {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.warn(`Large number of fingerings (${filtered.length}), limiting to ${MAX_FINGERING_RENDER_LIMIT} for performance`);
      }
      const result = filtered.slice(0, MAX_FINGERING_RENDER_LIMIT);
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('Fingering filtering performance', { 
          duration: performance.now() - startTime,
          totalAnnotations: Object.keys(annotations).length,
          filteredCount: filtered.length,
          renderedCount: result.length
        });
      }
      return result;
    }
    
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug('Fingering filtering performance', { 
        duration: performance.now() - startTime,
        totalAnnotations: Object.keys(annotations).length,
        renderedCount: filtered.length
      });
    }
    
    return filtered;
  }, [annotations, visibleTimeRange]);

  return visibleFingerings;
};