/**
 * Worker-Based Musical Context Provider
 * 
 * Production implementation of MusicalContextProvider that uses
 * MusicalContextAnalyzer to preload context during score loading.
 * 
 * Performance: Designed for <200ms analysis of 100-measure scores
 */

import type { MusicalContextProvider, NoteContext, NoteContextMap } from '../types/musical-context';
import { MusicalContextAnalyzer } from './MusicalContextAnalyzer';
import { perfLogger } from '@/renderer/utils/performance-logger';

export class WorkerBasedContextProvider implements MusicalContextProvider {
  private contextMap: NoteContextMap = new Map();
  private ready = false;
  private analyzer = new MusicalContextAnalyzer();
  
  /**
   * Get context for a specific note
   * O(1) lookup performance
   */
  getContext(noteId: string): NoteContext | null {
    return this.contextMap.get(noteId) || null;
  }
  
  /**
   * Check if context is ready for use
   */
  isReady(): boolean {
    return this.ready;
  }
  
  /**
   * Preload context from OSMD score data
   * Run once during score loading, not during practice
   */
  async preloadContext(osmdData: any): Promise<void> {
    try {
      // Analyze score and populate context map
      this.contextMap = await this.analyzer.analyzeScore(osmdData);
      this.ready = true;
    } catch (error) {
      perfLogger.error('Failed to preload musical context:', error);
      // Graceful degradation - remain not ready, fallback to constant breathing room
      this.ready = false;
    }
  }
  
  /**
   * Clear context (for memory management when switching scores)
   */
  clearContext(): void {
    this.contextMap.clear();
    this.ready = false;
  }
}