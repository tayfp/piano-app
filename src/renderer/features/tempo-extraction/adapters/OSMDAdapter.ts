/**
 * OSMDAdapter - Anti-corruption layer for OSMD API
 * 
 * Provides defensive access to OSMD properties with comprehensive error handling
 * Never throws errors - always returns safe defaults
 */

import { IOSMDAdapter, TempoWithPosition, getOSMDProperty } from '../types';
import { perfLogger } from '@/renderer/utils/performance-logger';

export class OSMDAdapter implements IOSMDAdapter {
  // Cache for property paths that work
  private propertyPathCache = new Map<string, string[]>();
  
  // Add constants for Phase 1
  private readonly MAX_TEMPOS_PER_MEASURE = 50; // Prevent pathological cases
  private readonly MAX_OFFSET_VALUE = 10000;    // Reasonable upper bound
  
  constructor(private osmd: any) {}

  /**
   * Get all measures from OSMD sheet
   * Returns empty array on any error
   */
  getMeasures(osmd?: any): any[] {
    const target = osmd || this.osmd;
    
    // Try multiple property path variations
    const measurePaths = [
      'Sheet.SourceMeasures',
      'sheet.sourceMeasures',
      'Sheet.sourceMeasures',
      'sheet.SourceMeasures'
    ];
    
    const measures = getOSMDProperty(target, measurePaths);
    
    // Validate and filter measures
    if (Array.isArray(measures)) {
      return measures.filter(m => m !== null && m !== undefined);
    }
    
    return [];
  }

  /**
   * Version Get ALL tempos in a measure with position data
   * This is the core bug fix - collect ALL tempos, not just first
   */
  getTemposInMeasure(measure: any): TempoWithPosition[] {
    const tempos: TempoWithPosition[] = [];

    if (!measure || typeof measure !== 'object') {
      return tempos;
    }

    try {
      // Process TempoExpressions array with ALL fallback logic
      if (Array.isArray(measure.TempoExpressions)) {
        measure.TempoExpressions.forEach((expr: any, index: number) => {
          // Prevent runaway processing
          if (tempos.length >= this.MAX_TEMPOS_PER_MEASURE) {
            if (process.env.NODE_ENV === 'development') {
              perfLogger.warn(`[TEMPO] Max tempos (${this.MAX_TEMPOS_PER_MEASURE}) reached for measure`);
            }
            return;
          }

          let bpm: number | null = null;
          let offset: number | undefined = undefined;
          let text: string | undefined = undefined;

          // A. Primary source: instantaneousTempo (with strict validation)
          if (expr?.instantaneousTempo && 
              typeof expr.instantaneousTempo === 'object' &&
              expr.instantaneousTempo.tempoInBpm &&
              typeof expr.instantaneousTempo.tempoInBpm === 'number' &&
              expr.instantaneousTempo.tempoInBpm > 0 && 
              expr.instantaneousTempo.tempoInBpm <= 500 &&
              Number.isFinite(expr.instantaneousTempo.tempoInBpm)) {
            bpm = expr.instantaneousTempo.tempoInBpm;
            // Check multiple possible offset properties
            const rawOffset = expr.instantaneousTempo.offset ?? 
                            expr.instantaneousTempo.placement ?? 
                            expr.offset;
            offset = this.validateOffset(rawOffset);
          }
          // B. Fallback to other properties on the expression
          else {
            const tempoCandidate = expr.TempoInBpm ?? expr.tempoInBpm ?? 
                                  expr.TempoInBPM ?? expr.tempo ?? 
                                  expr.Tempo ?? expr.bpm ?? expr.BPM;
            if (typeof tempoCandidate === 'number' && 
                tempoCandidate > 0 && 
                tempoCandidate <= 500 && 
                Number.isFinite(tempoCandidate)) {
              bpm = tempoCandidate;
              offset = this.validateOffset(expr.offset);
            }
          }

          // Extract text label if available
          text = expr.label ?? expr.text ?? expr.Label ?? expr.Text;

          if (bpm !== null) {
            tempos.push({
              bpm,
              offset,
              beat: undefined, // Will be calculated if offset exists
              confidence: 1.0,
              source: 'osmd',
              text,
              index: index // For stable sorting
            });
          }
        });
      }

      // Fallback to measure-level tempo (only if no expressions found)
      if (tempos.length === 0) {
        const measureTempo = this.extractMeasureLevelTempo(measure);
        if (measureTempo !== null) {
          tempos.push({
            bpm: measureTempo,
            offset: 0, // Start of measure
            beat: 0,
            confidence: 1.0,
            source: 'osmd',
            index: 0
          });
        }
      }

    } catch (error) {
      perfLogger.error('[TEMPO] Error extracting tempos:', error);
      // Return empty array on error - don't break the app
    }

    // Sort by position with stable secondary sort
    const sortedTempos = tempos.sort((a, b) => {
      const offsetDiff = (a.offset ?? 0) - (b.offset ?? 0);
      if (offsetDiff !== 0) return offsetDiff;
      // Secondary sort by original index for stability
      return (a.index ?? 0) - (b.index ?? 0);
    });


    return sortedTempos;
  }

  /**
   * Get tempo in BPM from a measure
   * Returns null if not found or invalid
   * Updated for Version Now uses getTemposInMeasure internally
   */
  getTempoInBpm(measure: any): number | null {
    const tempos = this.getTemposInMeasure(measure);
    
    // Warn if multiple tempos exist but we're only returning first
    if (process.env.NODE_ENV === 'development' && tempos.length > 1) {
      perfLogger.warn('[TEMPO] Multiple tempos found but only first returned:', {
        measureNumber: this.getMeasureNumber(measure),
        count: tempos.length,
        bpms: tempos.map(t => t.bpm)
      });
    }
    
    return tempos.length > 0 ? tempos[0].bpm : null;
  }

  /**
   * Get metronome markings from a measure
   * Returns empty array if none found
   */
  getMetronomeMarks(measure: any): string[] {
    const marks: string[] = [];
    
    if (!measure || typeof measure !== 'object') {
      return marks;
    }
    
    // Try to find expressions in various locations
    const expressionPaths = [
      'VerticalSourceStaffEntryContainers',
      'verticalSourceStaffEntryContainers',
      'StaffEntries',
      'staffEntries'
    ];
    
    const containers = getOSMDProperty(measure, expressionPaths);
    
    if (Array.isArray(containers)) {
      for (const container of containers) {
        if (!container) continue;
        
        // Look for staff entries
        const staffEntries = Array.isArray(container.StaffEntries) 
          ? container.StaffEntries 
          : (Array.isArray(container.staffEntries) ? container.staffEntries : []);
          
        for (const entry of staffEntries) {
          if (!entry) continue;
          
          // Look for expressions
          const sourceEntry = entry.SourceStaffEntry || entry.sourceStaffEntry;
          if (sourceEntry) {
            const expressions = sourceEntry.Expressions || sourceEntry.expressions || [];
            
            for (const expr of expressions) {
              if (expr && expr.text && typeof expr.text === 'string') {
                marks.push(expr.text);
              }
            }
          }
        }
      }
    }
    
    return marks;
  }

  /**
   * Get text expressions from a measure
   * For Phase 2 - returns empty array in Phase 1
   */
  getTextExpressions(measure: any): string[] {
    // Phase 2 functionality - return empty for now
    return [];
  }

  /**
   * Get measure number (1-indexed)
   */
  getMeasureNumber(measure: any): number {
    if (!measure || typeof measure !== 'object') {
      return 1;
    }
    
    const numberPaths = [
      'MeasureNumber',
      'measureNumber',
      'Number',
      'number'
    ];
    
    for (const path of numberPaths) {
      const value = measure[path];
      if (typeof value === 'number' && value > 0 && Number.isInteger(value)) {
        return value;
      }
    }
    
    return 1; // Default to 1 if not found
  }

  /**
   * Get expression texts from a measure
   * Returns empty array if none found
   */
  getExpressionTexts(measure: any): string[] {
    const texts: string[] = [];
    
    if (!measure || typeof measure !== 'object') {
      return texts;
    }
    
    // Similar logic to getMetronomeMarks but for expressions
    try {
      const containers = measure.VerticalSourceStaffEntryContainers || 
                       measure.verticalSourceStaffEntryContainers || 
                       [];
      
      if (Array.isArray(containers)) {
        for (const container of containers) {
          const staffEntries = container.StaffEntries || container.staffEntries || [];
          
          if (Array.isArray(staffEntries)) {
            for (const staffEntry of staffEntries) {
              const sourceEntry = staffEntry.SourceStaffEntry || staffEntry.sourceStaffEntry;
              const expressions = sourceEntry?.Expressions || sourceEntry?.expressions || [];
              
              if (Array.isArray(expressions)) {
                for (const expr of expressions) {
                  const text = expr.ExpressionText || expr.expressionText || expr.text;
                  if (typeof text === 'string' && text.trim()) {
                    texts.push(text.trim());
                  }
                }
              }
            }
          }
        }
      }
    } catch (error) {
      perfLogger.warn('[OSMDAdapter] Error extracting expression texts:', error);
    }
    
    return texts;
  }

  /**
   * Check if OSMD object is valid
   */
  isValidOSMD(osmd: any): boolean {
    if (!osmd || typeof osmd !== 'object') {
      return false;
    }
    
    // Check for Sheet property
    const sheet = osmd.Sheet || osmd.sheet;
    if (!sheet || typeof sheet !== 'object') {
      return false;
    }
    
    // Check for measures (but empty is still valid)
    const measures = this.getMeasures(osmd);
    return Array.isArray(measures);
  }

  /**
   * Helper method for offset validation - Phase 1
   */
  private validateOffset(value: any): number | undefined {
    if (typeof value !== 'number') return undefined;
    if (!Number.isFinite(value)) return undefined;
    if (value < 0) {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.warn('[TEMPO] Negative offset detected:', value);
      }
      return 0; // Clamp to start of measure
    }
    if (value > this.MAX_OFFSET_VALUE) {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.warn('[TEMPO] Excessive offset detected:', value);
      }
      return this.MAX_OFFSET_VALUE;
    }
    return value;
  }

  /**
   * Helper method for measure-level tempo extraction - Phase 1
   */
  private extractMeasureLevelTempo(measure: any): number | null {
    // Direct tempo properties on measure
    const tempoPaths = ['tempoInBPM', 'TempoInBpm', 'tempoInBpm', 
                       'TempoInBPM', 'tempo', 'Tempo'];
    
    for (const path of tempoPaths) {
      const value = measure[path];
      if (typeof value === 'number' && 
          value > 0 && 
          value <= 500 && 
          Number.isFinite(value)) {
        return value;
      }
    }

    // Check for tempo in other common locations (preserving original logic)
    if (measure.VerticalSourceStaffEntryContainers) {
      // Use existing complex extraction logic from original method
      try {
        const containers = measure.VerticalSourceStaffEntryContainers;
        
        if (Array.isArray(containers)) {
          for (const container of containers) {
            if (!container) continue;
            
            const staffEntries = Array.isArray(container.StaffEntries) 
              ? container.StaffEntries 
              : (Array.isArray(container.staffEntries) ? container.staffEntries : []);
              
            for (const entry of staffEntries) {
              if (!entry) continue;
              
              const sourceEntry = entry.SourceStaffEntry || entry.sourceStaffEntry;
              if (sourceEntry) {
                // Check for tempo properties in source entry
                for (const path of tempoPaths) {
                  const value = sourceEntry[path];
                  if (typeof value === 'number' && value > 0 && value <= 500 && Number.isFinite(value)) {
                    return value;
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        // Silent fallback - don't break extraction
        perfLogger.warn('[TEMPO] Error in measure-level extraction:', error);
      }
    }

    return null;
  }
}