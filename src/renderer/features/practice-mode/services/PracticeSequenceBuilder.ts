/**
 * Practice Sequence Builder
 * 
 * Pre-computes practice sequences from OSMD scores for O(1) lookup during practice.
 * Replaces real-time OSMD traversal that caused 10-15ms latency penalties.
 * 
 * Architecture: One-time complex traversal on score load → simple array access during practice
 * Performance Target: <2ms sequence generation time, <1.5MB memory per 1-hour score
 * Security: Memory safeguards against OOM attacks, bounded computation
 */

import { OpenSheetMusicDisplay, Cursor } from 'opensheetmusicdisplay';
import type { PracticeNote } from '../types';
import { perfLogger } from '@/renderer/utils/performance-logger';

export interface OptimizedPracticeStep {
  /** Unique identifier for React keys and debugging */
  id: string;
  /** Pre-computed MIDI notes for O(1) lookup */
  midiNotes: Set<number>;
  /** Pre-calculated boolean flags */
  isChord: boolean;
  isRest: boolean;
  /** OSMD element IDs for visual highlighting */
  visualElements: string[];
  /** Position metadata */
  measureIndex: number;
  stepIndex: number;
  /** Musical timing information */
  timestamp?: number;
  /** Grace notes/ornaments attached to this step */
  ornaments?: Array<{ midiNote: number }>;
  /** OSMD's RealValue - duration in beats (quarter note = 1.0) */
  realDuration?: number;
  /** Per-note durations for proper sustain (separate from cursor advancement) */
  noteDurations?: Array<{ midi: number; durationBeats: number }>;
  /** When to advance cursor to next step (beats) - calculated in post-pass */
  advanceAfterBeats?: number;
}

export interface SequenceBuildResult {
  steps: OptimizedPracticeStep[];
  metadata: {
    totalSteps: number;
    totalNotes: number;
    memoryUsage: number; // Estimated memory usage in bytes
    buildTime: number;   // Time taken to build sequence in ms
  };
}

export class PracticeSequenceBuilder {
  // Memory safeguards (from Code review:'s security audit)
  private static readonly MAX_STEPS = 50000;      // Prevent OOM from malicious scores
  private static readonly MAX_NOTES_PER_STEP = 32; // Reasonable chord limit
  private static readonly MIDI_C0_VALUE = 12;      // C0 = MIDI 12
  
  // Grace note accumulator for grouping with principal notes
  private static graceNoteBuffer: Array<{ midiNote: number }> = [];
  
  /**
   * Build optimized practice sequence from OSMD instance
   * One-time pre-computation to replace real-time traversal
   */
  static build(osmd: OpenSheetMusicDisplay): SequenceBuildResult {
    const buildStartTime = performance.now();
    
    // Starting sequence generation
    
    let tiedNotesDetected = 0;
    let tiedContinuationsFiltered = 0;
    
    try {
      const sequence: OptimizedPracticeStep[] = [];
      let totalNotes = 0;
      
      // Create cursor for traversal
      const cursor = osmd.cursor;
      if (!cursor) {
        throw new Error('OSMD cursor not available');
      }
      
      // Reset to beginning
      cursor.reset();
      
      // Memory monitoring
      const startMemory = (performance as any).memory?.usedJSHeapSize || 0;
      
      // Traverse score once, building optimized steps
      let stepIndex = 0;
      
      while (!cursor.Iterator.EndReached && sequence.length < this.MAX_STEPS) {
        const step = this.extractStepFromCursor(cursor, stepIndex);
        
        if (step) {
          sequence.push(step);
          totalNotes += step.midiNotes.size;
          stepIndex++;
          
          // Memory safeguard: Check for runaway generation
          if (sequence.length % 1000 === 0) {
            const currentMemory = (performance as any).memory?.usedJSHeapSize || 0;
            const memoryDelta = currentMemory - startMemory;
            
            // Warn if memory usage is growing suspiciously fast
            if (memoryDelta > 50 * 1024 * 1024) { // 50MB
              perfLogger.warn(`[PracticeSequenceBuilder] High memory usage: ${Math.round(memoryDelta / 1024 / 1024)}MB`);
            }
          }
        }
        
        // Advance cursor
        cursor.next();
      }
      
      // Check if we hit the safety limit
      if (sequence.length >= this.MAX_STEPS) {
        perfLogger.warn(`[PracticeSequenceBuilder] Hit max step limit (${this.MAX_STEPS}). Score may be truncated.`);
      }
      
      const buildTime = performance.now() - buildStartTime;
      const endMemory = (performance as any).memory?.usedJSHeapSize || 0;
      const memoryUsage = endMemory - startMemory;
      
      // Sequence generation complete
      
      // Simple timing: Each step uses its actual duration
      // This gives Synthesia-like behavior where cursor waits for note duration
      for (let i = 0; i < sequence.length; i++) {
        sequence[i].advanceAfterBeats = sequence[i].realDuration || 1.0;
      }
      
      
      return {
        steps: sequence,
        metadata: {
          totalSteps: sequence.length,
          totalNotes,
          memoryUsage,
          buildTime,
        },
      };
      
    } catch (error) {
      perfLogger.error('[PracticeSequenceBuilder] Failed to build sequence:', error);
      throw error;
    }
  }
  
  /**
   * Extract practice step from current cursor position
   */
  private static extractStepFromCursor(cursor: Cursor, stepIndex: number): OptimizedPracticeStep | null {
    try {
      const notes = new Set<number>();
      const visualElements: string[] = [];
      const ornaments: Array<{ midiNote: number }> = [];
      
      // Get current measure index
      const measureIndex = cursor.Iterator.currentMeasureIndex || 0;
      
      
      // Extract notes from all voice entries at current position
      const voiceEntries = cursor.Iterator.CurrentVoiceEntries;
      if (!voiceEntries || voiceEntries.length === 0) {
        return null;
      }
      
      let hasNonGraceNotes = false;
      
      for (let voiceIndex = 0; voiceIndex < voiceEntries.length; voiceIndex++) {
        const voiceEntry = voiceEntries[voiceIndex];
        
        // Get notes from voice entry
        const entryNotes = voiceEntry.Notes || voiceEntry.notes || [];
        
        for (let noteIndex = 0; noteIndex < entryNotes.length; noteIndex++) {
          const note = entryNotes[noteIndex];
          
          
          // Skip tied notes from previous - use OSMD's native tie handling
          if ((note as any).NoteTie && (note as any).NoteTie.StartNote !== note) {
            continue;
          }
          
          // Calculate MIDI value
          const halfTone = note.halfTone !== undefined ? note.halfTone : note.HalfTone;
          
          if (halfTone !== undefined) {
            const midiValue = halfTone + this.MIDI_C0_VALUE;
            
            // Only add notes within standard 88-key piano range (A0 to C8)
            if (midiValue >= 21 && midiValue <= 108) {
              // Handle grace notes separately - accumulate them
              if (note.IsGrace) {
                this.graceNoteBuffer.push({ midiNote: midiValue });
                
              } else {
                // Regular note - add to step
                notes.add(midiValue);
                hasNonGraceNotes = true;
                
                // Store visual element ID for highlighting
                const elementId = note.graphicalNote?.id || `note_${measureIndex}_${stepIndex}_${midiValue}`;
                visualElements.push(elementId);
                
              }
            }
          }
        }
      }
      
      // Safeguard: Limit notes per step to prevent memory abuse
      if (notes.size > this.MAX_NOTES_PER_STEP) {
        perfLogger.warn(`[PracticeSequenceBuilder] Step ${stepIndex} has ${notes.size} notes, truncating to ${this.MAX_NOTES_PER_STEP}`);
        const limitedNotes = Array.from(notes).slice(0, this.MAX_NOTES_PER_STEP);
        notes.clear();
        limitedNotes.forEach(note => notes.add(note));
      }
      
      
      // Capture duration from first non-grace note (representative for chord)
      let realDuration: number | undefined = undefined;
      let firstNote: any = null;
      let isRest = false;
      
      // Check if this is a rest step
      if (!hasNonGraceNotes && notes.size === 0) {
        isRest = true;
        // Look for rest duration in voice entries
        for (let voiceIndex = 0; voiceIndex < voiceEntries.length; voiceIndex++) {
          const voiceEntry = voiceEntries[voiceIndex];
          // Check for rest fraction (OSMD property for rests)
          if ((voiceEntry as any).restFraction !== undefined) {
            realDuration = (voiceEntry as any).restFraction * 4; // Convert to beats
            break;
          }
        }
      } else {
        // Regular notes - find duration
        for (let voiceIndex = 0; voiceIndex < voiceEntries.length; voiceIndex++) {
          const voiceEntry = voiceEntries[voiceIndex];
          const entryNotes = voiceEntry.Notes || voiceEntry.notes || [];
          
          for (let noteIndex = 0; noteIndex < entryNotes.length; noteIndex++) {
            const note = entryNotes[noteIndex];
            // Find first non-grace note for duration
            if (!note.IsGrace && note.Length?.RealValue !== undefined) {
              firstNote = note;
              // RealValue is in whole note units, convert to beats (quarter note = 1.0)
              // In 4/4 time: whole note = 4 beats, so multiply by 4
              realDuration = note.Length.RealValue * 4;
              break;
            }
          }
          if (realDuration !== undefined) break;
        }
      }
      
      // Capture per-note durations for proper sustain
      const noteDurations: Array<{ midi: number; durationBeats: number }> = [];
      
      // Re-traverse notes to capture individual durations
      for (let voiceIndex = 0; voiceIndex < voiceEntries.length; voiceIndex++) {
        const voiceEntry = voiceEntries[voiceIndex];
        const entryNotes = voiceEntry.Notes || voiceEntry.notes || [];
        
        for (let noteIndex = 0; noteIndex < entryNotes.length; noteIndex++) {
          const note = entryNotes[noteIndex];
          
          // Skip grace notes and tied continuations for duration tracking
          if (note.IsGrace || ((note as any).NoteTie && (note as any).NoteTie.StartNote !== note)) {
            continue;
          }
          
          const halfTone = note.halfTone !== undefined ? note.halfTone : note.HalfTone;
          if (halfTone !== undefined) {
            const midiValue = halfTone + this.MIDI_C0_VALUE;
            
            if (midiValue >= 21 && midiValue <= 108 && note.Length?.RealValue !== undefined) {
              let durationBeats = note.Length.RealValue * 4; // Convert to beats
              
              // Apply tuplet ratio if needed
              if ((note as any).Tuplet) {
                const tuplet = (note as any).Tuplet;
                if (tuplet.normalNotes && tuplet.actualNotes) {
                  const ratio = tuplet.normalNotes / tuplet.actualNotes;
                  durationBeats *= ratio;
                }
              }
              
              noteDurations.push({ midi: midiValue, durationBeats });
              
            }
          }
        }
      }
      
      // Calculate the step's duration (for chords, use the shortest duration)
      // This ensures cursor advances when the shortest note is done
      const stepDurationBeats = noteDurations.length > 0
        ? Math.min(...noteDurations.map(n => n.durationBeats))
        : (realDuration || 1.0);
      
      // Create optimized step
      const step: OptimizedPracticeStep = {
        id: `m${measureIndex}-s${stepIndex}`,
        midiNotes: notes,
        isChord: notes.size > 1,
        isRest: notes.size === 0,
        visualElements,
        measureIndex,
        stepIndex,
        // CRITICAL: Capture timestamp for precise intra-measure positioning
        timestamp: cursor.Iterator.currentTimeStamp?.RealValue ||
                   cursor.Iterator.currentTimeStamp?.realValue,
        // Attach accumulated grace notes to this step
        ornaments: hasNonGraceNotes && this.graceNoteBuffer.length > 0 
          ? [...this.graceNoteBuffer] 
          : undefined,
        // Store duration in beats for tempo calculations
        realDuration: stepDurationBeats,
        // Synthesia-like behavior: cursor waits for note duration
        advanceAfterBeats: stepDurationBeats,
        // Per-note durations for proper sustain
        noteDurations: noteDurations.length > 0 ? noteDurations : undefined
      };
      
      // Clear grace note buffer if we attached them to this step
      if (hasNonGraceNotes && this.graceNoteBuffer.length > 0) {
        this.graceNoteBuffer = [];
      }
      
      
      
      return step;
      
    } catch (error) {
      perfLogger.error(`[PracticeSequenceBuilder] Error extracting step ${stepIndex}:`, error);
      return null;
    }
  }
  
  /**
   * Validate that a sequence is safe to use
   */
  static validateSequence(steps: OptimizedPracticeStep[]): boolean {
    if (!Array.isArray(steps)) return false;
    if (steps.length === 0) return true; // Empty sequence is valid
    if (steps.length > this.MAX_STEPS) return false;
    
    // Check each step has required properties
    for (const step of steps) {
      if (!step.id || typeof step.id !== 'string') return false;
      if (!(step.midiNotes instanceof Set)) return false;
      if (typeof step.isChord !== 'boolean') return false;
      if (typeof step.isRest !== 'boolean') return false;
      if (!Array.isArray(step.visualElements)) return false;
      if (typeof step.measureIndex !== 'number') return false;
      if (typeof step.stepIndex !== 'number') return false;
      
      // Validate MIDI notes are in valid range
      for (const note of step.midiNotes) {
        if (typeof note !== 'number' || note < 0 || note > 127) {
          return false;
        }
      }
    }
    
    return true;
  }
  
  /**
   * Get memory estimation for a sequence
   */
  static estimateMemoryUsage(steps: OptimizedPracticeStep[]): number {
    let totalBytes = 0;
    
    for (const step of steps) {
      // Base object overhead
      totalBytes += 200; // Rough estimate for object overhead
      
      // String properties
      totalBytes += step.id.length * 2; // UTF-16
      
      // Set<number> - roughly 32 bytes per number + overhead
      totalBytes += step.midiNotes.size * 40;
      
      // Array of strings
      totalBytes += step.visualElements.reduce((sum, str) => sum + str.length * 2, 0);
      totalBytes += step.visualElements.length * 8; // Array overhead
    }
    
    return totalBytes;
  }
}