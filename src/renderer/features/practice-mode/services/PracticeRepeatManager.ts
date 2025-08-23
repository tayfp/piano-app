// Version PracticeRepeatManager Service - Manages repeat logic with state machine
import { perfLogger } from '@/renderer/utils/performance-logger';
import { MeasureTimeline } from './MeasureTimeline';

export interface IRepeatAdapter {
  jumpToMeasure(measureIndex: number): Promise<boolean>;
  getCurrentMeasure(): number;
  onMeasureChange(callback: (measure: number) => void): void;
}

export interface RepeatState {
  phase: 'idle' | 'active';
  targetMeasure: number | null;
  cyclesCompleted: number;
  lastMeasure: number | null; // For external seek detection
}

export class PracticeRepeatManager {
  private state: RepeatState = {
    phase: 'idle',
    targetMeasure: null,
    cyclesCompleted: 0,
    lastMeasure: null
  };
  
  private lastToggleTime = 0;
  private readonly TOGGLE_DEBOUNCE_MS = 50;
  
  constructor(
    private timeline: MeasureTimeline,
    private adapter: IRepeatAdapter
  ) {
    // Subscribe to measure changes
    this.adapter.onMeasureChange(this.handleMeasureChange.bind(this));
  }
  
  /**
   * Toggle repeat mode on/off with debounce protection
   */
  async toggleRepeat(): Promise<boolean> {
    // Debounce rapid toggles
    const now = Date.now();
    if (now - this.lastToggleTime < this.TOGGLE_DEBOUNCE_MS) {
      perfLogger.warn('[RepeatManager] Toggle ignored - too rapid');
      return this.state.phase === 'active';
    }
    this.lastToggleTime = now;
    
    if (this.state.phase === 'idle') {
      // Check if timeline can handle score
      if (!this.timeline.canHandleScore()) {
        perfLogger.warn('[RepeatManager] Cannot start repeat - timeline not ready');
        return false;
      }
      
      // Start repeat at current measure
      const currentMeasure = this.adapter.getCurrentMeasure();
      this.state = {
        phase: 'active',
        targetMeasure: currentMeasure,
        cyclesCompleted: 0,
        lastMeasure: currentMeasure
      };
      
      perfLogger.info(`[RepeatManager] Started repeat for measure ${currentMeasure}`);
      return true;
      
    } else {
      // Stop repeat
      const targetMeasure = this.state.targetMeasure;
      const cycles = this.state.cyclesCompleted;
      
      this.state = {
        phase: 'idle',
        targetMeasure: null,
        cyclesCompleted: 0,
        lastMeasure: null
      };
      
      perfLogger.info(`[RepeatManager] Stopped repeat for measure ${targetMeasure} after ${cycles} cycles`);
      return false;
    }
  }
  
  /**
   * Handle measure changes from adapter
   */
  private async handleMeasureChange(currentMeasure: number): Promise<void> {
    // Check if timeline is still valid
    if (!this.timeline.canHandleScore()) {
      // Timeline invalid - deactivate if active
      if (this.state.phase === 'active') {
        perfLogger.warn('[RepeatManager] Timeline invalid - deactivating repeat');
        this.state = {
          phase: 'idle',
          targetMeasure: null,
          cyclesCompleted: 0,
          lastMeasure: null
        };
      }
      return;
    }
    
    // Only react when active
    if (this.state.phase !== 'active' || this.state.targetMeasure === null) {
      // Update last measure for tracking
      this.state.lastMeasure = currentMeasure;
      return;
    }
    
    // Detect external seek (non-sequential jump)
    if (this.state.lastMeasure !== null && 
        currentMeasure !== this.state.lastMeasure + 1 &&
        currentMeasure !== this.state.targetMeasure &&
        currentMeasure !== this.state.lastMeasure) {  // Allow staying on same measure
      
      // Special case: backward seek is allowed
      if (currentMeasure < this.state.targetMeasure) {
        // Just update last measure, don't deactivate
        this.state.lastMeasure = currentMeasure;
        return;
      }
      
      // Special case: moving forward past target from before target is OK
      if (this.state.lastMeasure < this.state.targetMeasure && 
          currentMeasure > this.state.targetMeasure) {
        // This is like normal playback crossing the repeat point
        // Don't deactivate, let it fall through to jump logic
      } else {
        // Forward non-sequential jump - deactivate repeat
        perfLogger.info(`[RepeatManager] External seek detected (${this.state.lastMeasure} -> ${currentMeasure}) - deactivating repeat`);
        this.state = {
          phase: 'idle',
          targetMeasure: null,
          cyclesCompleted: 0,
          lastMeasure: currentMeasure
        };
        return;
      }
    }
    
    // Update last measure
    this.state.lastMeasure = currentMeasure;
    
    // Check if we need to jump back
    if (currentMeasure > this.state.targetMeasure) {
      // Special case: repeating last measure
      const measureCount = this.timeline.getMeasureCount();
      if (this.state.targetMeasure === measureCount - 1) {
        // On last measure - don't jump, just increment cycles
        this.state.cyclesCompleted++;
        perfLogger.info(`[RepeatManager] Last measure repeat - cycle ${this.state.cyclesCompleted}`);
        return;
      }
      
      // Normal case: jump back to target
      try {
        const success = await this.adapter.jumpToMeasure(this.state.targetMeasure);
        
        if (success) {
          // Increment cycle count atomically
          this.state = {
            ...this.state,
            cyclesCompleted: this.state.cyclesCompleted + 1,
            lastMeasure: this.state.targetMeasure
          };
          
          perfLogger.info(`[RepeatManager] Jumped back to measure ${this.state.targetMeasure} - cycle ${this.state.cyclesCompleted}`);
        } else {
          // Jump failed - stop repeat
          perfLogger.error('[RepeatManager] Failed to jump back to repeat measure');
          this.state = {
            phase: 'idle',
            targetMeasure: null,
            cyclesCompleted: 0,
            lastMeasure: currentMeasure
          };
        }
      } catch (error) {
        // Handle async errors
        perfLogger.error('[RepeatManager] Error during jump:', error);
        this.state = {
          phase: 'idle',
          targetMeasure: null,
          cyclesCompleted: 0,
          lastMeasure: currentMeasure
        };
      }
    }
  }
  
  /**
   * Get current repeat state (immutable copy)
   */
  getState(): RepeatState {
    return { ...this.state };
  }
  
  /**
   * Check if repeat is currently active
   */
  isActive(): boolean {
    return this.state.phase === 'active';
  }
}