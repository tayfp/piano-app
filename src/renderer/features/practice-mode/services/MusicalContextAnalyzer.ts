/**
 * Musical Context Analyzer Service
 * 
 * Analyzes OSMD score data to identify musical context:
 * - Phrase endings (double barlines, long rests)
 * - Fermatas (pause symbols)
 * - Barline endings
 * 
 * Performance: Designed to complete analysis in <200ms for 100-measure scores
 */

import type { NoteContext, NoteContextMap } from '../types/musical-context';

export class MusicalContextAnalyzer {
  /**
   * Analyzes a score and returns a map of note contexts
   * @param osmdData - The OSMD score data
   * @returns Map of noteId to NoteContext for O(1) lookup
   */
  async analyzeScore(osmdData: any): Promise<NoteContextMap> {
    const contextMap = new Map<string, NoteContext>();
    
    if (!osmdData?.measureList) {
      return contextMap;
    }

    // Process all measures
    for (let measureIndex = 0; measureIndex < osmdData.measureList.length; measureIndex++) {
      const measureRow = osmdData.measureList[measureIndex];
      
      if (!Array.isArray(measureRow)) continue;
      
      for (const measure of measureRow) {
        if (!measure) continue;
        
        // Check for phrase endings (double barlines)
        const isDoubleBarline = measure.parentSourceMeasure?.BarlineType === 'DOUBLE';
        
        // Process staff entries in the measure
        const staffEntries = measure.staffEntries || [];
        
        for (const entry of staffEntries) {
          if (!entry?.id) continue;
          
          const context: NoteContext = {
            noteId: entry.id,
            measureIndex,
            isPhraseEnd: false,
            hasFermata: false,
            isBarlineEnd: false,
            restDurationAfter: entry.restDurationAfter
          };
          
          // Check for fermata
          if (entry.hasFermata === true) {
            context.hasFermata = true;
          }
          
          // Check for long rests (>2 beats indicates phrase boundary)
          if (entry.restDurationAfter && entry.restDurationAfter > 2.0) {
            context.isPhraseEnd = true;
          }
          
          // Mark barline endings
          if (measureIndex < osmdData.measureList.length - 1) {
            context.isBarlineEnd = true;
          }
          
          // If this measure has a double barline, mark previous notes as phrase end
          if (isDoubleBarline && measureIndex > 0) {
            // Mark this as phrase end
            context.isPhraseEnd = true;
          }
          
          contextMap.set(entry.id, context);
        }
      }
    }
    
    return contextMap;
  }
  
  /**
   * Helper to detect if a staff entry has fermata articulations
   */
  private hasFermataArticulation(staffEntry: any): boolean {
    // Check for fermata in articulations
    if (staffEntry?.articulations) {
      return staffEntry.articulations.some((art: any) => 
        art.type === 'fermata' || art.ArticulationType === 'fermata'
      );
    }
    return false;
  }
}