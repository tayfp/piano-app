import { perfLogger } from './simple-perf-logger';

// OSMD coordinate conversion constants
export const OSMD_UNIT_TO_PIXELS = 10; // 1 OSMD unit = 10 pixels at zoom 1.0
export const FINGERING_OFFSET_OSMD_UNITS = 0; // No offset - fingering at note position

export interface NotePosition {
  x: number;
  y: number;
  noteElement: any;
}

export interface ContainerRef {
  current: HTMLDivElement | null;
}

/**
 * Calculate fingering position for a single note using OSMD internal coordinates
 * This eliminates DOM measurement feedback loop that caused position drift (ISSUE #10 FIX)
 */
export const calculateFingeringPosition = (
  noteId: string,
  graphicalNoteMap: Map<string, any> | null,
  containerRef: ContainerRef
): NotePosition | null => {
  if (!graphicalNoteMap || !containerRef?.current) return null;
  
  const graphicalNote = graphicalNoteMap.get(noteId);
  if (!graphicalNote) {
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug('DISPLAY: Looking for ID:', {
        noteId,
        mapSize: graphicalNoteMap.size,
        sampleMapKeys: Array.from(graphicalNoteMap.keys()).slice(0, 5),
        mismatch: `Expected format from map keys vs actual noteId`
      });
    }
    return null;
  }

  const containerRect = containerRef.current.getBoundingClientRect();
  
  try {
    // Get the actual SVG element for accurate visual positioning
    let svgElement = null;
    if (typeof graphicalNote.getSVGGElement === 'function') {
      try {
        svgElement = graphicalNote.getSVGGElement();
      } catch (err) {
        // Silent catch
      }
    }
    
    if (svgElement) {
      // Use actual visual bounds from the rendered SVG
      // getBoundingClientRect() returns viewport coordinates already adjusted for zoom
      const rect = svgElement.getBoundingClientRect();
      
      return {
        x: (rect.left + rect.right) / 2 - containerRect.left,
        y: rect.top - containerRect.top - 15, // 15px above notehead
        noteElement: graphicalNote
      };
    }
    
    // Fallback to OSMD position if no SVG element
    const positionAndShape = graphicalNote.PositionAndShape;
    if (positionAndShape?.AbsolutePosition) {
      const abs = positionAndShape.AbsolutePosition;
      const xPixels = abs.x * OSMD_UNIT_TO_PIXELS;
      const yPixels = (abs.y - FINGERING_OFFSET_OSMD_UNITS) * OSMD_UNIT_TO_PIXELS;
      
      return {
        x: xPixels - containerRect.left,
        y: yPixels - containerRect.top,
        noteElement: graphicalNote
      };
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      perfLogger.warn('Error getting fingering position', { 
        noteId, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }
  
  return null;
};

/**
 * ISSUE #10 FIX: Position cache to prevent DOM measurement feedback loop
 * Calculate all note positions once from clean DOM before any fingerings render
 */
export const buildNotePositionCache = (
  graphicalNoteMap: Map<string, any> | null,
  containerRef: ContainerRef,
  containerVersion: number
): Map<string, NotePosition | null> => {
  const positions = new Map<string, NotePosition | null>();
  if (!graphicalNoteMap) return positions;
  
  // Pre-calculate positions for all notes from clean DOM
  // This prevents measuring DOM that includes rendered fingering elements
  for (const [noteId] of graphicalNoteMap) {
    const pos = calculateFingeringPosition(noteId, graphicalNoteMap, containerRef);
    positions.set(noteId, pos);
  }
  
  if (process.env.NODE_ENV === 'development') {
    perfLogger.debug('[ISSUE #10 FIX] Note position cache built:', {
      noteCount: positions.size,
      containerVersion,
      timestamp: Date.now()
    });
  }
  
  return positions;
};