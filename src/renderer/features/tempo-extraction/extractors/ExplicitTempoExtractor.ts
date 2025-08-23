/**
 * ExplicitTempoExtractor - Extracts explicit tempo markings
 * 
 * Handles:
 * 1. Direct BPM properties (confidence 1.0)
 * 2. Metronome markings like "♩ = 120" (confidence 0.95)
 * 
 * Performance: Processes measures with early bailout at 80% of budget
 */

import { ITempoExtractor, TempoChangeEvent, IOSMDAdapter } from '../types';
import { perfLogger } from '@/renderer/utils/performance-logger';

export class ExplicitTempoExtractor implements ITempoExtractor {
  readonly name = 'explicit';
  readonly priority = 100; // Highest priority for explicit markings
  
  // Expanded regex patterns based on musical notation standards
  private readonly METRONOME_PATTERNS = [
    /[♩♪♫♬]\s*=\s*(\d+)/,          // Unicode notes
    /quarter\s*=\s*(\d+)/i,         // Text variations
    /M\.M\.\s*=?\s*(\d+)/i,         // M.M. = 120
    /Tempo\s*[:=]\s*(\d+)/i,        // Tempo: 120
    /bpm\s*[:=]\s*(\d+)/i,          // bpm = 120
    /(\d+)\s*bpm/i,                 // 120 bpm
    /♩\s*=\s*ca\.\s*(\d+)/i,        // ca. approximations
  ];
  
  extract(adapter: IOSMDAdapter, measures: any[]): TempoChangeEvent[] {
    const events: TempoChangeEvent[] = [];
    const MAX_MEASURE_BUDGET_MS = 15;
    const startTime = performance.now();
    
    // Process measures with dynamic limit based on performance
    for (let i = 0; i < measures.length; i++) {
      // Early bailout at 80% of budget
      if (performance.now() - startTime > MAX_MEASURE_BUDGET_MS * 0.8) {
        perfLogger.debug(`[ExplicitTempoExtractor] Early bailout at measure ${i + 1} to maintain performance`);
        break;
      }
      
      const measure = measures[i];
      if (!measure) continue;
      
      // 1. Extract BPM property (highest confidence)
      const bpm = adapter.getTempoInBpm(measure);
      if (bpm !== null) {
        events.push({
          measureIndex: i,
          measureNumber: adapter.getMeasureNumber(measure),
          bpm,
          confidence: 1.0,
          source: 'explicit',
          timestamp: Date.now()
        });
      }
      
      // 2. Extract metronome markings
      const marks = adapter.getMetronomeMarks(measure);
      for (const mark of marks) {
        const parsedBpm = this.parseMetronomeMark(mark);
        if (parsedBpm !== null) {
          events.push({
            measureIndex: i,
            measureNumber: adapter.getMeasureNumber(measure),
            bpm: parsedBpm,
            confidence: 0.95,
            source: 'metronome',
            timestamp: Date.now(),
            raw: mark
          });
        }
      }
    }
    
    return events;
  }
  
  /**
   * Parse metronome marking to extract BPM
   * Returns null if no valid BPM found
   */
  parseMetronomeMark(text: string): number | null {
    if (!text || typeof text !== 'string') {
      return null;
    }
    
    // Try each pattern
    for (const pattern of this.METRONOME_PATTERNS) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const bpm = parseInt(match[1], 10);
        
        // Validate BPM range
        if (bpm > 0 && bpm <= 300 && Number.isFinite(bpm)) {
          return bpm;
        }
      }
    }
    
    return null;
  }
}