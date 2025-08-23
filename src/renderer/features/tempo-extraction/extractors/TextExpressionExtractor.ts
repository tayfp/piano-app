/**
 * TextExpressionExtractor - Maps tempo terms to BPM values
 * 
 * Extracts tempo from text expressions like "Allegro", "Andante", etc.
 * with confidence calculation based on text matching quality.
 * 
 * Performance: Early bailout after 30 measures at 10ms to maintain <15ms target
 */

import { ITempoExtractor, TempoChangeEvent } from '../types';
import { OSMDAdapter } from '../adapters/OSMDAdapter';
import { perfLogger } from '@/renderer/utils/performance-logger';

interface TempoTermMapping {
  term: string;
  bpm: number;
  baseConfidence: number;
}

export class TextExpressionExtractor implements ITempoExtractor {
  readonly name = 'TextExpressionExtractor';
  readonly priority = 500; // Medium priority
  
  // Core tempo term mappings with typical BPM values
  private readonly TEMPO_TERMS: TempoTermMapping[] = [
    { term: 'larghissimo', bpm: 25, baseConfidence: 0.75 },
    { term: 'grave', bpm: 35, baseConfidence: 0.75 },
    { term: 'largo', bpm: 50, baseConfidence: 0.8 },
    { term: 'lento', bpm: 55, baseConfidence: 0.75 },
    { term: 'larghetto', bpm: 60, baseConfidence: 0.7 },
    { term: 'adagio', bpm: 70, baseConfidence: 0.8 },
    { term: 'adagietto', bpm: 75, baseConfidence: 0.7 },
    { term: 'andante', bpm: 90, baseConfidence: 0.8 },
    { term: 'andantino', bpm: 95, baseConfidence: 0.7 },
    { term: 'moderato', bpm: 120, baseConfidence: 0.8 },
    { term: 'allegretto', bpm: 120, baseConfidence: 0.75 },
    { term: 'allegro', bpm: 140, baseConfidence: 0.85 },
    { term: 'vivace', bpm: 160, baseConfidence: 0.8 },
    { term: 'presto', bpm: 180, baseConfidence: 0.85 },
    { term: 'prestissimo', bpm: 200, baseConfidence: 0.8 }
  ];
  
  // Language aliases mapping to core terms
  private readonly ALIASES: Map<string, string> = new Map([
    // German
    ['schnell', 'allegro'],
    ['sehr langsam', 'larghissimo'],
    ['lebhaft', 'vivace'],
    // French
    ['vif', 'allegro'],
    // English
    ['walking pace', 'andante']
  ]);
  
  extract(adapter: OSMDAdapter, measures: any[]): TempoChangeEvent[] {
    try {
      const startTime = performance.now();
      const events: TempoChangeEvent[] = [];
      
      if (!measures || measures.length === 0) {
        return events;
      }
      
      let processedCount = 0;
      
      for (let i = 0; i < measures.length; i++) {
        // Performance check - early bailout after 30 measures if taking too long
        if (processedCount >= 30 && performance.now() - startTime > 10) {
          perfLogger.warn('[TextExpressionExtractor] Early bailout for performance');
          break;
        }
        
        const measure = measures[i];
        const expressions = adapter.getExpressionTexts(measure);
        
        if (!expressions || expressions.length === 0) {
          continue;
        }
        
        const tempoMatch = this.findBestTempoMatch(expressions);
        
        if (tempoMatch) {
          events.push({
            measureIndex: i,
            measureNumber: adapter.getMeasureNumber(measure),
            bpm: tempoMatch.bpm,
            confidence: tempoMatch.confidence,
            source: 'text',
            timestamp: Date.now()
          });
        }
        
        processedCount++;
      }
      
      return events;
    } catch (error) {
      perfLogger.error('[TextExpressionExtractor] Extraction failed:', error);
      return [];
    }
  }
  
  private findBestTempoMatch(expressions: string[]): { bpm: number; confidence: number } | null {
    let bestMatch: { bpm: number; confidence: number } | null = null;
    let highestConfidence = 0;
    
    for (const expression of expressions) {
      if (typeof expression !== 'string' || !expression) {
        continue;
      }
      
      const normalizedExpr = expression.toLowerCase().trim();
      
      // Check direct matches first
      for (const mapping of this.TEMPO_TERMS) {
        const confidence = this.calculateConfidence(normalizedExpr, mapping.term, mapping.baseConfidence);
        
        if (confidence > highestConfidence) {
          highestConfidence = confidence;
          bestMatch = { bpm: mapping.bpm, confidence };
        }
      }
      
      // Check aliases
      for (const [alias, term] of Array.from(this.ALIASES)) {
        if (normalizedExpr.includes(alias.toLowerCase())) {
          const mapping = this.TEMPO_TERMS.find(m => m.term === term);
          if (mapping) {
            // Alias confidence penalty
            const confidence = mapping.baseConfidence * 0.7;
            if (confidence > highestConfidence) {
              highestConfidence = confidence;
              bestMatch = { bpm: mapping.bpm, confidence };
            }
          }
        }
      }
    }
    
    return bestMatch;
  }
  
  private calculateConfidence(expression: string, term: string, baseConfidence: number): number {
    const exprLower = expression.toLowerCase();
    const termLower = term.toLowerCase();
    
    // Exact match gets highest confidence
    if (exprLower === termLower) {
      return Math.min(baseConfidence + 0.1, 0.95);
    }
    
    // Check if term is contained in expression
    if (exprLower.includes(termLower)) {
      // Calculate significance of the match
      const termLength = termLower.length;
      const exprLength = exprLower.length;
      const significance = termLength / exprLength;
      
      // Adjust confidence based on how significant the term is
      if (significance > 0.6) {
        return baseConfidence; // Term is majority of expression
      } else if (significance > 0.4) {
        return baseConfidence * 0.9; // Term is significant part
      } else {
        return baseConfidence * 0.8; // Term is small part
      }
    }
    
    return 0;
  }
}