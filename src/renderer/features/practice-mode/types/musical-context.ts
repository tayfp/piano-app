/**
 * Musical Context Types for Phase 1B
 * 
 * Defines data structures for musical context analysis including
 * phrase endings, fermatas, and barline information.
 */

/**
 * Context information for a musical note
 */
export interface NoteContext {
  noteId: string;
  measureIndex: number;
  isPhraseEnd: boolean;
  hasFermata: boolean;
  isBarlineEnd: boolean;
  restDurationAfter?: number; // in beats
}

/**
 * Strategy interface for calculating breathing room
 */
export interface BreathingRoomStrategy {
  extraMs(noteId: string, context: NoteContext): number;
}

/**
 * Map type for O(1) context lookup
 */
export type NoteContextMap = Map<string, NoteContext>;

/**
 * Provider interface for musical context
 * Supports dependency injection for testing
 */
export interface MusicalContextProvider {
  getContext(noteId: string): NoteContext | null;
  isReady(): boolean;
  preloadContext(osmdData: any): Promise<void>;
}