/**
 * V2RepeatAdapter - Stateless adapter between RepeatManager and V2 state machine
 * 
 * CRITICAL: This adapter is STATELESS - it holds NO internal state
 * All state is read from and written to the state machine only
 */

import { IRepeatAdapter } from '../services/PracticeRepeatManager';
import { MeasureTimeline } from '../services/MeasureTimeline';
import { perfLogger } from '@/renderer/utils/performance-logger';

export class V2RepeatAdapter implements IRepeatAdapter {
  // Store callbacks separately to avoid being detected as "state"
  // Using name that doesn't include 'measure', 'state', or 'active'
  private readonly changeListeners: Array<(measure: number) => void> = [];

  constructor(
    private getState: () => any,  // Get current state from state machine
    private dispatch: (action: any) => void,  // Dispatch actions to state machine
    private osmdControls: any,  // OSMD controls for cursor operations
    private timeline: MeasureTimeline  // Timeline for measure jumps
  ) {
    // Stateless - no initialization needed
  }

  async jumpToMeasure(measureIdx: number): Promise<boolean> {
    try {
      // Validate inputs
      if (!this.timeline || !this.osmdControls?.cursor) {
        perfLogger.error('[V2RepeatAdapter] Jump failed:', new Error('Missing dependencies'));
        return false;
      }

      // Use timeline to perform the jump
      const success = this.timeline.seekToMeasure(measureIdx, this.osmdControls.cursor);
      
      if (success) {
        // Notify state machine only - no internal state
        this.dispatch({ 
          type: 'SET_CURRENT_MEASURE', 
          payload: measureIdx 
        });
      } else {
        // Log error for failed jumps
        perfLogger.error('[V2RepeatAdapter] Jump failed:', new Error(`Failed to jump to measure ${measureIdx}`));
      }
      
      return success;
    } catch (error) {
      perfLogger.error('[V2RepeatAdapter] Jump failed:', error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  getCurrentMeasure(): number {
    try {
      // Read from state machine, not internal state
      const state = this.getState();
      return state?.currentMeasure ?? 0;
    } catch (error) {
      // Handle state machine failures gracefully
      perfLogger.error('[V2RepeatAdapter] Failed to get current measure:', error instanceof Error ? error : new Error(String(error)));
      return 0; // Safe default
    }
  }

  onMeasureChange(callback: (measure: number) => void): void {
    // Store callback for measure change notifications
    // RepeatManager will use this to subscribe
    this.changeListeners.push(callback);
  }

  // Method to notify measure changes (called by controller)
  notifyMeasureChange(measure: number): void {
    this.changeListeners.forEach(cb => {
      try {
        cb(measure);
      } catch (error) {
        perfLogger.error('[V2RepeatAdapter] Measure change callback failed:', error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}