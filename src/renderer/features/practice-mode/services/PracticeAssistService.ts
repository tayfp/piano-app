/**
 * Unified Practice Assist Service - Performance Optimized
 * 
 * Replaces the over-abstracted ComposableAssistService + Strategy pattern
 * with a single, fast function optimized for <20ms MIDI latency.
 * 
 * Design decisions:
 * - Collapsed abstraction hierarchy for better performance
 * - Switch-case for JIT optimization, minimal allocations
 * - Direct inlining, decoupled from React render cycle
 */

import type { PracticeStepResult } from '../types';

// Simplified interfaces for performance
export interface CursorData {
  currentStep: PracticeStepResult | null;
  position: { measure: number; note: number } | null;
  isActive: boolean;
}

export interface KeyHighlight {
  midiNote: number;
  type: 'expected' | 'correct' | 'incorrect' | 'upcoming';
  hand?: 'left' | 'right';
  fingering?: number;
  options?: {
    opacity?: number;
    intensity?: number;
    glow?: boolean;
  };
}

export type AssistMode = 'practice' | 'follow' | 'off';

export interface AssistConfig {
  mode: AssistMode;
  enableHandDifferentiation: boolean;
  enableFingering: boolean;
  enableTiming: boolean;
}

/**
 * High-performance practice assist processor
 * Replaces ComposableAssistService + all strategies + enhancers
 */
export class PracticeAssistService {
  private config: AssistConfig;

  constructor(config: AssistConfig) {
    this.config = config;
  }

  /**
   * PERFORMANCE-CRITICAL: Main processing function
   * Optimized for <20ms latency - zero dynamic dispatch
   */
  getHighlightsForCursor(cursorData: CursorData): KeyHighlight[] {
    // Fast exit for inactive cursors
    if (!cursorData.isActive || !cursorData.currentStep) {
      return [];
    }

    const step = cursorData.currentStep;
    
    // Pre-allocate array to avoid garbage collection
    const highlights: KeyHighlight[] = [];

    //  COLLAPSED LOGIC: All strategies + enhancers inlined
    switch (this.config.mode) {
      case 'practice':
        this.addPracticeHighlights(highlights, step);
        break;
      
      case 'follow':
        this.addFollowHighlights(highlights, step, cursorData.position);
        break;
      
      case 'off':
        // No highlights when disabled
        break;
      
      default:
        // Default to practice mode for unknown configs
        this.addPracticeHighlights(highlights, step);
        break;
    }

    // Apply enhancers inline for performance
    if (this.config.enableHandDifferentiation) {
      this.enhanceWithHandInfo(highlights);
    }

    if (this.config.enableFingering) {
      this.enhanceWithFingering(highlights, step);
    }

    return highlights;
  }

  /**
   * Basic practice mode highlighting (was BasicAssistStrategy)
   */
  private addPracticeHighlights(highlights: KeyHighlight[], step: PracticeStepResult): void {
    if ('notes' in step) {
      for (const note of step.notes) {
        if (note && typeof note.midiValue === 'number') {
          highlights.push({
            midiNote: note.midiValue,
            type: 'expected'
          });
        }
      }
    }
  }

  /**
   * Cursor follow mode highlighting (was CursorFollowStrategy)
   */
  private addFollowHighlights(
    highlights: KeyHighlight[], 
    step: PracticeStepResult,
    position: { measure: number; note: number } | null
  ): void {
    // Add both current and upcoming notes for smoother following
    this.addPracticeHighlights(highlights, step);
    
    // Add upcoming note preview if position is available
    if (position && 'notes' in step && step.notes.length > 0) {
      // Simple upcoming note logic (can be enhanced later)
      const currentNoteIndex = position.note;
      const nextNoteIndex = currentNoteIndex + 1;
      
      if (nextNoteIndex < step.notes.length) {
        const nextNote = step.notes[nextNoteIndex];
        if (nextNote && typeof nextNote.midiValue === 'number') {
          highlights.push({
            midiNote: nextNote.midiValue,
            type: 'upcoming',
            options: { opacity: 0.6 }
          });
        }
      }
    }
  }

  /**
   * Hand differentiation enhancement (was HandDifferentiationEnhancer)
   * Inlined for performance
   */
  private enhanceWithHandInfo(highlights: KeyHighlight[]): void {
    for (const highlight of highlights) {
      // Simple heuristic: notes below middle C (60) are typically left hand
      highlight.hand = highlight.midiNote < 60 ? 'left' : 'right';
    }
  }

  /**
   * Fingering enhancement (placeholder for future acoustic validation)
   */
  private enhanceWithFingering(highlights: KeyHighlight[], step: PracticeStepResult): void {
    // TODO: Implement fingering suggestions based on step context
    // This was likely part of AcousticValidationStrategy
    // For now, this is a no-op to maintain interface compatibility
  }

  /**
   * Update configuration without recreating service
   */
  updateConfig(newConfig: Partial<AssistConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration (for debugging)
   */
  getConfig(): AssistConfig {
    return { ...this.config };
  }
}

/**
 * Factory function for creating optimized practice assist service
 */
export function createPracticeAssistService(mode: AssistMode = 'practice'): PracticeAssistService {
  return new PracticeAssistService({
    mode,
    enableHandDifferentiation: true,
    enableFingering: false, // Disabled by default for performance
    enableTiming: false     // Future feature
  });
}