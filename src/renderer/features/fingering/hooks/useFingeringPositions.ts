import { useMemo } from 'react';
import { buildNotePositionCache, NotePosition } from '../utils/positionCalculator';
import { buildChordGroupings, ChordGrouping } from '../utils/chordGrouping';

export interface UseFingeringPositionsProps {
  graphicalNoteMap: Map<string, any> | null;
  containerRef: { current: HTMLDivElement | null };
  visibleFingerings: Array<[string, number]>;
  containerVersion: number;
}

export interface UseFingeringPositionsResult {
  notePositions: Map<string, NotePosition | null>;
  chordGroupings: Map<string, ChordGrouping>;
}

/**
 * Hook that combines position calculation and chord grouping from Phase 1 modules
 * Manages the coordination between raw note positions and final display positions
 */
export const useFingeringPositions = ({
  graphicalNoteMap,
  containerRef,
  visibleFingerings,
  containerVersion
}: UseFingeringPositionsProps): UseFingeringPositionsResult => {
  // ISSUE #10 FIX: Position cache to prevent DOM measurement feedback loop
  // Calculate all note positions once from clean DOM before any fingerings render
  const notePositions = useMemo(() => {
    return buildNotePositionCache(graphicalNoteMap, containerRef, containerVersion);
  }, [graphicalNoteMap, containerRef, containerVersion]);

  // Build chord groupings and calculate vertical offsets
  const chordGroupings = useMemo(() => {
    // Prepare fingerings with their positions for chord grouping algorithm
    const fingeringsWithPositions = visibleFingerings
      .map(([noteId, finger]) => {
        const pos = notePositions.get(noteId);
        if (pos) {
          return [noteId, finger, { x: pos.x, y: pos.y }] as [string, number, { x: number; y: number }];
        }
        return null;
      })
      .filter((item): item is [string, number, { x: number; y: number }] => item !== null);

    return buildChordGroupings(fingeringsWithPositions);
  }, [visibleFingerings, notePositions]);

  return {
    notePositions,
    chordGroupings
  };
};