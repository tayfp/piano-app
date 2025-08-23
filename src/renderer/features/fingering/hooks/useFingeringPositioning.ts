import { useCallback } from 'react';

export interface FingeringPosition {
  x: number;
  y: number;
  noteElement: any; // GraphicalNote from OSMD
}

export const useFingeringPositioning = () => {
  // Pure stub until Phase 3 implementation
  // No OSMD dependency, no parsing, no console spam
  const getFingeringPosition = useCallback((_noteId: string): FingeringPosition | null => {
    return null;
  }, []);

  return { getFingeringPosition };
};