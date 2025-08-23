/**
 * Type Guards for Practice Mode
 * 
 * Pure type checking utilities extracted from practice mode hooks.
 * These have zero performance impact and improve type safety.
 */

import type { PracticeStep, PracticeStepResult } from '@/renderer/features/practice-mode/types';

/**
 * Type guard to check if PracticeStepResult is a PracticeStep
 * Used to distinguish between regular steps and END_OF_SCORE markers
 */
export function isPracticeStep(result: PracticeStepResult): result is PracticeStep {
  return !('type' in result && result.type === 'END_OF_SCORE');
}