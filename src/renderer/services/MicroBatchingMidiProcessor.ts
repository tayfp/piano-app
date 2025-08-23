/**
 * Micro-Batching MIDI Processor
 * 
 * Replaces the 50ms debounce with 10ms micro-batching for <20ms latency compliance.
 * Groups MIDI events within a short window to detect chords while minimizing latency.
 * 
 * Performance Target: <20ms p95 latency from MIDI input to audio output
 * Security: No timing data leakage, minimal logging in production
 */

import { latencyMonitor } from './LightweightLatencyMonitor';
import { perfLogger } from '@/renderer/utils/performance-logger';

export interface MidiEvent {
  type: 'noteOn' | 'noteOff';
  note: number;
  velocity: number;
  timestamp: number;
  deviceId?: string;
}

export type NoteBatchCallback = (notes: number[]) => void;

export class MicroBatchingMidiProcessor {
  private batchWindow: number;
  private currentBatch: MidiEvent[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private callback: NoteBatchCallback | null = null;
  
  // Memory safeguards (from Code review:'s security audit)
  private readonly MAX_BATCH_SIZE = 128; // Prevent memory exhaustion
  private readonly MAX_BATCH_RATE = 1000; // Max batches per second
  private batchCount = 0;
  private lastRateReset = performance.now();
  
  constructor(batchWindowMs: number = 10) {
    this.batchWindow = batchWindowMs;
  }
  
  /**
   * Set the callback for processed note batches
   */
  setCallback(callback: NoteBatchCallback): void {
    this.callback = callback;
  }
  
  /**
   * Process a MIDI event, adding it to the current batch
   */
  processMidiEvent(event: MidiEvent): void {
    latencyMonitor.startMeasure('micro-batch-processing');
    
    try {
      // Security safeguard: Rate limiting
      if (!this.checkRateLimit()) {
        perfLogger.warn('[MicroBatch] Rate limit exceeded, dropping event');
        return;
      }
      
      // Memory safeguard: Prevent batch overflow
      if (this.currentBatch.length >= this.MAX_BATCH_SIZE) {
        perfLogger.warn('[MicroBatch] Batch size limit reached, forcing flush');
        this.flushBatch();
      }
      
      this.currentBatch.push(event);
      
      // Reset timer with each new event (chord grouping)
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
      }
      
      this.batchTimer = setTimeout(() => {
        this.flushBatch();
      }, this.batchWindow);
      
    } finally {
      latencyMonitor.endMeasure('micro-batch-processing');
    }
  }
  
  /**
   * Flush the current batch and notify callback
   */
  private flushBatch(): void {
    if (this.currentBatch.length === 0) {
      this.batchTimer = null;
      return;
    }
    
    latencyMonitor.startMeasure('micro-batch-flush');
    
    try {
      // Extract unique notes from the batch (chord detection)
      const uniqueNotes = new Set<number>();
      
      for (const event of this.currentBatch) {
        if (event.type === 'noteOn') {
          uniqueNotes.add(event.note);
        }
        // Note: We only process noteOn events for practice mode
        // noteOff events are handled separately for key highlighting
      }
      
      // Convert to array for callback
      const notesArray = Array.from(uniqueNotes);
      
      // Clear batch before callback to prevent re-entrancy issues
      this.currentBatch = [];
      this.batchTimer = null;
      
      // Notify callback if we have notes
      if (notesArray.length > 0 && this.callback) {
        this.callback(notesArray);
      }
      
    } catch (error) {
      perfLogger.error('[MicroBatch] Error during batch flush:', error);
      // Reset state on error to prevent stuck batches
      this.currentBatch = [];
      this.batchTimer = null;
    } finally {
      latencyMonitor.endMeasure('micro-batch-flush');
    }
  }
  
  /**
   * Rate limiting safeguard (from Code review:'s security audit)
   */
  private checkRateLimit(): boolean {
    const now = performance.now();
    
    // Reset counter every second
    if (now - this.lastRateReset > 1000) {
      this.batchCount = 0;
      this.lastRateReset = now;
    }
    
    this.batchCount++;
    return this.batchCount <= this.MAX_BATCH_RATE;
  }
  
  /**
   * Force flush any pending batch (for cleanup)
   */
  flush(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.flushBatch();
    }
  }
  
  /**
   * Get current batch size (for monitoring)
   */
  getCurrentBatchSize(): number {
    return this.currentBatch.length;
  }
  
  /**
   * Get performance stats
   */
  getStats(): {
    batchWindow: number;
    currentBatchSize: number;
    batchesPerSecond: number;
  } {
    const now = performance.now();
    const timeSinceReset = now - this.lastRateReset;
    const batchesPerSecond = timeSinceReset > 0 ? 
      (this.batchCount * 1000) / timeSinceReset : 0;
    
    return {
      batchWindow: this.batchWindow,
      currentBatchSize: this.currentBatch.length,
      batchesPerSecond: Math.round(batchesPerSecond * 100) / 100,
    };
  }
  
  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.currentBatch = [];
    this.callback = null;
  }
}