/**
 * Tempo Service - Core tempo calculation and delay computation
 * 
 * Replaces fixed 500ms delays with BPM-based musical timing using 
 * existing tempo extraction data from osmdStore.tempoMap.
 * 
 * Phase 1B Enhancement: Adds musical context-aware breathing room
 * via dependency injection of MusicalContextProvider.
 * 
 * Performance targets:
 * - Tempo calculation: <1ms per note
 * - Service initialization: <10ms
 * - Memory overhead: <1MB
 */

import type { MusicalContextProvider, BreathingRoomStrategy } from '../types/musical-context';
import { ConstantBreathingRoom, DynamicBreathingRoom } from './DynamicBreathingRoom';
import { perfLogger } from '@/renderer/utils/performance-logger';

// Type definitions for tempo service
export interface TempoService {
  getCurrentBpm(): number;
  computeDelay(noteDuration: number, noteId?: string): number;
  setManualOverride(bpm: number | null): void;
  applyTempoAdjustmentFactor(delta: number): void;
  preloadMusicalContext?(osmdData: any): Promise<void>;
  isContextReady?(): boolean;
  computeOrnamentTiming(principalDurationMs: number, graceNoteCount: number): {
    graceDelayMs: number;
    principalAdjustedMs: number;
  };
}

// Interface for OSMD store tempo data
interface OSMDStoreTempoMap {
  defaultBpm?: number;
  averageBpm?: number;
  hasExplicitTempo?: boolean;
}

interface OSMDStoreType {
  tempoMap: OSMDStoreTempoMap | null;
}

/**
 * Implementation of tempo service using existing tempo extraction data
 * 
 * Key features:
 * - Leverages osmdStore.tempoMap from completed Phase 3 tempo extraction
 * - Manual tempo override via localStorage persistence
 * - Musical time calculation: (60_000 / bpm) * duration + breathing room
 * - Minimum delay enforcement for very fast tempos
 * - Phase 1B: Musical context-aware breathing room via dependency injection
 */
export class TempoServiceImpl implements TempoService {
  private static readonly BREATHING_ROOM_MS = 40; // Constant for MVP
  private static readonly MIN_DELAY_MS = 50; // Minimum delay for very fast tempos
  private static readonly DEFAULT_BPM = 90; // Moderate default when no tempo data
  private static readonly STORAGE_KEY = 'tempo-override';
  
  private breathingRoomStrategy: BreathingRoomStrategy;

  constructor(
    private getOsmdStore: () => OSMDStoreType,
    private contextProvider?: MusicalContextProvider
  ) {
    // Service initialization should be <10ms (performance target)
    // No heavy computation in constructor
    
    // Initialize with constant strategy by default
    this.breathingRoomStrategy = new ConstantBreathingRoom();
  }

  /**
   * Get current BPM with precedence: manual override > tempo extraction > default
   */
  getCurrentBpm(): number {
    // Check for manual override first (highest precedence)
    const manualBpm = localStorage.getItem(TempoServiceImpl.STORAGE_KEY);
    if (manualBpm) {
      const parsedBpm = Number(manualBpm);
      if (!isNaN(parsedBpm) && parsedBpm > 0) {
        return parsedBpm;
      }
    }

    // Use tempo extraction data from completed Phase 3
    const tempoMap = this.getOsmdStore().tempoMap;
    if (tempoMap) {
      // Prefer defaultBpm from tempo extraction
      if (tempoMap.defaultBpm && tempoMap.defaultBpm > 0) {
        return tempoMap.defaultBpm;
      }
      
      // Fallback to averageBpm if available
      if (tempoMap.averageBpm && tempoMap.averageBpm > 0) {
        return tempoMap.averageBpm;
      }
    }

    // Ultimate fallback to moderate default
    return TempoServiceImpl.DEFAULT_BPM;
  }

  /**
   * Compute delay for note duration using musical timing
   * 
   * @param noteDuration Beat fraction (1.0 = quarter note, 2.0 = half note, 0.5 = eighth note)
   * @param noteId Optional identifier for context-aware delays (Phase 1B)
   * @returns Delay in milliseconds
   */
  computeDelay(noteDuration: number, noteId?: string): number {
    // Performance target: <1ms per computation
    const bpm = this.getCurrentBpm();
    
    // Calculate base delay: (60 seconds / bpm) * 1000ms * note duration
    const beatDurationMs = 60_000 / bpm;
    const noteDelayMs = beatDurationMs * noteDuration;
    
    // Get context-aware breathing room (Phase 1B enhancement)
    let breathingRoom = TempoServiceImpl.BREATHING_ROOM_MS; // Default fallback
    
    if (noteId && this.contextProvider?.isReady()) {
      const context = this.contextProvider.getContext(noteId);
      if (context) {
        breathingRoom = this.breathingRoomStrategy.extraMs(noteId, context);
      }
    }
    
    // Add breathing room for musical phrasing
    const totalDelay = noteDelayMs + breathingRoom;
    
    // Enforce minimum delay for very fast tempos
    const finalDelay = Math.max(TempoServiceImpl.MIN_DELAY_MS, totalDelay);
    
    
    return finalDelay;
  }

  /**
   * Set manual tempo override with localStorage persistence
   * 
   * @param bpm BPM value or null to clear override
   */
  setManualOverride(bpm: number | null): void {
    if (bpm === null) {
      localStorage.removeItem(TempoServiceImpl.STORAGE_KEY);
    } else if (bpm > 0) {
      localStorage.setItem(TempoServiceImpl.STORAGE_KEY, bpm.toString());
    } else {
      throw new Error('BPM must be positive or null');
    }
  }

  /**
   * Apply tempo adjustment factor (for Phase 2 real-time adjustments)
   * 
   * @param delta Adjustment factor (-0.1 = 10% slower, +0.1 = 10% faster)
   */
  applyTempoAdjustmentFactor(delta: number): void {
    const currentBpm = this.getCurrentBpm();
    const adjustedBpm = currentBpm * (1 + delta);
    
    // Clamp to reasonable range
    const clampedBpm = Math.max(30, Math.min(300, adjustedBpm));
    
    this.setManualOverride(clampedBpm);
  }

  /**
   * Check if manual override is currently active
   */
  isOverridden(): boolean {
    return localStorage.getItem(TempoServiceImpl.STORAGE_KEY) !== null;
  }

  /**
   * Get override status and value for UI display
   */
  getOverrideStatus(): { isOverridden: boolean; bpm?: number } {
    const manualBpm = localStorage.getItem(TempoServiceImpl.STORAGE_KEY);
    if (manualBpm) {
      const parsedBpm = Number(manualBpm);
      if (!isNaN(parsedBpm) && parsedBpm > 0) {
        return { isOverridden: true, bpm: parsedBpm };
      }
    }
    return { isOverridden: false };
  }
  
  /**
   * Preload musical context during score load (Phase 1B)
   * Switches to dynamic breathing room strategy when ready
   */
  async preloadMusicalContext(osmdData: any): Promise<void> {
    if (!this.contextProvider) {
      return; // No provider, maintain Phase 1 behavior
    }
    
    await this.contextProvider.preloadContext(osmdData);
    
    // Switch to dynamic strategy once context is ready
    if (this.contextProvider.isReady()) {
      // Create a dynamic strategy that uses the provider's context
      this.breathingRoomStrategy = {
        extraMs: (noteId: string) => {
          const context = this.contextProvider!.getContext(noteId);
          if (!context) return 40; // Default fallback
          
          // Graduated breathing room
          if (context.hasFermata) return 200;
          if (context.isPhraseEnd) return 100;
          if (context.isBarlineEnd) return 60;
          return 40;
        }
      };
    }
  }
  
  /**
   * Check if musical context is ready (Phase 1B)
   */
  isContextReady(): boolean {
    return this.contextProvider?.isReady() ?? false;
  }
  
  /**
   * Compute timing for ornamental notes (grace notes) using bounded time-stealing
   * 
   * Implementation approach:
   * - Grace notes "steal" time from their principal note
   * - Bounded approach: max 20% of principal or 100ms total
   * - Each grace note gets 15-40ms for audibility
   * 
   * @param principalDurationMs Duration of the principal note in milliseconds
   * @param graceNoteCount Number of grace notes to schedule
   * @returns Timing values for grace notes and adjusted principal
   */
  computeOrnamentTiming(principalDurationMs: number, graceNoteCount: number): {
    graceDelayMs: number;
    principalAdjustedMs: number;
  } {
    // Handle edge case: no grace notes
    if (graceNoteCount <= 0) {
      return {
        graceDelayMs: 0,
        principalAdjustedMs: principalDurationMs
      };
    }
    
    // Bounded time-stealing: max 20% of principal or 100ms total
    const maxStealPercentage = 0.20; // 20% max steal
    const maxStealMs = 100;           // Never steal more than 100ms
    
    const stealBudgetMs = Math.min(
      principalDurationMs * maxStealPercentage,
      maxStealMs
    );
    
    // Each grace note gets equal share, bounded by min/max for audibility
    const minGraceMs = 15;  // Minimum for audibility
    const maxGraceMs = 40;  // Maximum to prevent sluggishness
    
    const idealGraceMs = stealBudgetMs / graceNoteCount;
    const graceDelayMs = Math.max(
      minGraceMs,
      Math.min(idealGraceMs, maxGraceMs)
    );
    
    // Calculate total time stolen and adjust principal
    const totalStolenMs = graceDelayMs * graceNoteCount;
    const principalAdjustedMs = Math.max(
      principalDurationMs - totalStolenMs,
      TempoServiceImpl.MIN_DELAY_MS // Never go below minimum
    );
    
    return {
      graceDelayMs,
      principalAdjustedMs
    };
  }
}

// Export for dependency injection and testing
export { TempoServiceImpl as default };