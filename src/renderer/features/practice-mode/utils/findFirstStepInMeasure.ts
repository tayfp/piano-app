// Helper function for O(n) sequence sync in advanceCursor
// Replaces O(n²) nested indexOf/findIndex pattern

interface OptimizedPracticeStep {
  id: string;
  measureIndex: number;
  timestamp?: number;
  notes: Array<{ midiValue: number }>;
}

/**
 * Find the first step in a measure with optional precise timestamp matching.
 * Single O(n) pass instead of O(n²) nested searches.
 * 
 * @param seq - The optimized practice sequence
 * @param measureIndex - Target measure index to find
 * @param cursorTimestamp - Optional timestamp for precise matching
 * @returns Index of matching step, or -1 if not found
 */
export function findFirstStepInMeasure(
  seq: OptimizedPracticeStep[] | undefined,
  measureIndex: number,
  cursorTimestamp?: number
): number {
  if (!Array.isArray(seq) || seq.length === 0) return -1;

  let firstIdx = -1;
  
  // Single pass through sequence
  for (let i = 0; i < seq.length; i++) {
    const step = seq[i];
    if (step.measureIndex !== measureIndex) continue;

    // Remember first step in measure
    if (firstIdx === -1) firstIdx = i;

    // If timestamps are present on both sides, prefer precise match
    if (
      cursorTimestamp != null &&
      step.timestamp != null &&
      Math.abs(step.timestamp - cursorTimestamp) < 1e-6
    ) {
      return i;
    }
  }
  
  return firstIdx; // may be -1 if no steps in that measure
}