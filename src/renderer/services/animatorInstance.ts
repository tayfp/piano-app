/**
 * Singleton instance of PianoKeyAnimator
 * Manages animations for all piano keys in the application
 */

import { PianoKeyAnimator } from './PianoKeyAnimator';
import { perfLogger } from '@/renderer/utils/performance-logger';

// Lazy initialization to ensure DOM is ready
let pianoKeyAnimatorInstance: PianoKeyAnimator | null = null;

const getPianoKeyAnimator = (): PianoKeyAnimator => {
  if (!pianoKeyAnimatorInstance) {
    try {
      pianoKeyAnimatorInstance = new PianoKeyAnimator();
    } catch (error) {
      perfLogger.error('Failed to initialize PianoKeyAnimator:', error);
      // Create with fallback performance mode
      pianoKeyAnimatorInstance = new PianoKeyAnimator('medium');
    }
  }
  return pianoKeyAnimatorInstance;
};

// Export convenience methods with error handling
export const animateNoteOn = (midiNote: number, velocity: number) => {
  try {
    const animator = getPianoKeyAnimator();
    animator.noteOn(midiNote, velocity);
  } catch (error) {
    perfLogger.error('Error in animateNoteOn:', error);
  }
};

export const animateNoteOff = (midiNote: number) => {
  try {
    const animator = getPianoKeyAnimator();
    animator.noteOff(midiNote);
  } catch (error) {
    perfLogger.error('Error in animateNoteOff:', error);
  }
};

export const resetAnimations = () => {
  try {
    if (pianoKeyAnimatorInstance) {
      pianoKeyAnimatorInstance.resetAll();
    }
  } catch (error) {
    perfLogger.error('Error in resetAnimations:', error);
  }
};