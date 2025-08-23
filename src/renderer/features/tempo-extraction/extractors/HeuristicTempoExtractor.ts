/**
 * HeuristicTempoExtractor - Optional fallback based on note density
 * 
 * Analyzes note density in the first 8 measures to estimate tempo
 * when no explicit tempo markings are found.
 * 
 * Always returns low confidence (0.3) as these are estimates only.
 */

import { ITempoExtractor, TempoChangeEvent } from '../types';
import { OSMDAdapter } from '../adapters/OSMDAdapter';
import { perfLogger } from '@/renderer/utils/performance-logger';

export class HeuristicTempoExtractor implements ITempoExtractor {
  readonly name = 'HeuristicTempoExtractor';
  readonly priority = 100; // Low priority - fallback only
  
  private readonly MEASURES_TO_ANALYZE = 8;
  private readonly FIXED_CONFIDENCE = 0.3;
  
  extract(adapter: OSMDAdapter, measures: any[]): TempoChangeEvent[] {
    try {
      const startTime = performance.now();
      
      if (!measures || measures.length === 0) {
        return [];
      }
      
      // Only analyze first 8 measures for performance
      const measuresToAnalyze = Math.min(measures.length, this.MEASURES_TO_ANALYZE);
      let totalNotes = 0;
      let totalDuration = 0;
      
      for (let i = 0; i < measuresToAnalyze; i++) {
        const measure = measures[i];
        const noteCount = this.countNotesInMeasure(measure);
        const duration = this.getMeasureDuration(measure);
        
        totalNotes += noteCount;
        totalDuration += duration;
      }
      
      // If no notes found, return empty
      if (totalNotes === 0 || totalDuration === 0) {
        return [];
      }
      
      // Calculate average note density
      const notesPerMeasure = totalNotes / measuresToAnalyze;
      const estimatedBpm = this.densityToBpm(notesPerMeasure);
      
      // Return single event at measure 0 with heuristic tempo
      return [{
        measureIndex: 0,
        measureNumber: 1,
        bpm: estimatedBpm,
        confidence: this.FIXED_CONFIDENCE,
        source: 'heuristic',
        timestamp: Date.now()
      }];
      
    } catch (error) {
      perfLogger.error('[HeuristicTempoExtractor] Extraction failed:', error);
      return [];
    }
  }
  
  private countNotesInMeasure(measure: any): number {
    try {
      // Count notes in all staff entries
      let noteCount = 0;
      
      // Try multiple property paths for OSMD compatibility
      const containers = measure.VerticalSourceStaffEntryContainers || 
                        measure.verticalSourceStaffEntryContainers || 
                        [];
      
      for (const container of containers) {
        const staffEntries = container.StaffEntries || container.staffEntries || [];
        
        for (const staffEntry of staffEntries) {
          const sourceEntry = staffEntry.SourceStaffEntry || 
                             staffEntry.sourceStaffEntry || 
                             staffEntry;
          
          const notes = sourceEntry.VoiceEntries?.flatMap((ve: any) => ve.Notes || []) ||
                       sourceEntry.voiceEntries?.flatMap((ve: any) => ve.notes || []) ||
                       [];
          
          noteCount += notes.length;
        }
      }
      
      return noteCount;
    } catch {
      return 0;
    }
  }
  
  private getMeasureDuration(measure: any): number {
    try {
      // Get time signature to calculate measure duration
      const timeSig = measure.TimeSignature || 
                     measure.timeSignature ||
                     { Numerator: 4, Denominator: 4 };
      
      const numerator = timeSig.Numerator || timeSig.numerator || 4;
      const denominator = timeSig.Denominator || timeSig.denominator || 4;
      
      // Calculate measure duration in quarter notes
      return (numerator / denominator) * 4;
    } catch {
      return 4; // Default to 4/4 time
    }
  }
  
  private densityToBpm(notesPerMeasure: number): number {
    // Map note density to estimated tempo
    // These are rough estimates based on typical patterns
    
    if (notesPerMeasure <= 2) {
      return 60; // Very sparse = slow tempo
    } else if (notesPerMeasure <= 4) {
      return 80; // Sparse = moderate slow
    } else if (notesPerMeasure <= 8) {
      return 100; // Moderate density
    } else if (notesPerMeasure <= 16) {
      return 120; // Dense = moderate fast
    } else if (notesPerMeasure <= 32) {
      return 140; // Very dense = fast
    } else {
      return 160; // Extremely dense = very fast
    }
  }
}