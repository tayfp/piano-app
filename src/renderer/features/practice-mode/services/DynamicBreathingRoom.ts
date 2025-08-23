/**
 * Dynamic Breathing Room Strategy
 * 
 * Provides graduated breathing room based on musical context:
 * - Fermata: 200ms (long pause for held notes)
 * - Phrase end: 100ms (natural musical breathing)
 * - Barline end: 60ms (slight pause at measure boundaries)
 * - Default: 40ms (standard breathing room)
 * 
 * Performance: O(1) calculation in <1ms
 */

import type { BreathingRoomStrategy, NoteContext, NoteContextMap } from '../types/musical-context';

export class DynamicBreathingRoom implements BreathingRoomStrategy {
  constructor(private noteContextMap: NoteContextMap) {}
  
  /**
   * Calculate extra milliseconds of breathing room based on musical context
   * @param noteId - The note identifier
   * @param context - The note context (can be provided or looked up)
   * @returns Milliseconds of breathing room to add
   */
  extraMs(noteId: string, context?: NoteContext): number {
    // Use provided context or look up from map
    const noteContext = context || this.noteContextMap.get(noteId);
    
    if (!noteContext) {
      return 40; // Default fallback
    }
    
    // Graduated breathing room based on musical importance
    // Priority order: fermata > phrase end > barline > default
    
    if (noteContext.hasFermata) {
      return 200; // Extra pause for fermatas (hold symbols)
    }
    
    if (noteContext.isPhraseEnd) {
      return 100; // More time at phrase endings for musical breathing
    }
    
    if (noteContext.isBarlineEnd) {
      return 60;  // Slight pause at measure boundaries
    }
    
    return 40; // Standard breathing room
  }
}

/**
 * Default constant breathing room strategy (Phase 1 behavior)
 */
export class ConstantBreathingRoom implements BreathingRoomStrategy {
  extraMs(noteId: string, context?: NoteContext): number {
    return 40; // Always return constant 40ms
  }
}