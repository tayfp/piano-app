/**
 * MusicXMLTempoExtractor - Direct XML parsing for ALL tempo data
 * 
 * Extracts tempo information directly from MusicXML source before any processing/filtering
 * Fixes the core issue where OSMD-based extraction only returns first tempo
 */

import { XMLParser } from 'fast-xml-parser';
import { perfLogger } from '../utils/performance-logger';

export interface XMLTempoEvent {
  measureNumber: number;
  bpm: number;
  offset?: number;     // Position in divisions (validated 0-10000)
  beat?: number;       // Calculated from offset
  text?: string;       // "Andantino", "Moderato", etc.
  source: 'direction' | 'sound' | 'metronome';  // Added 'metronome' for metronome elements
  sourceMeasure?: number;  // Future-proofing
  sourcePart?: string;     // Future-proofing
}

export class MusicXMLTempoExtractor {
  private parser: XMLParser;
  private readonly MAX_TEMPOS = 1000; // Sanity limit
  private readonly MAX_OFFSET = 10000; // Reasonable upper bound
  private readonly MAX_BPM = 500;     // Upper tempo limit
  
  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: true,
      processEntities: false  // Security: Disable entity processing to prevent XXE attacks
    });
  }
  
  extract(xmlContent: string): XMLTempoEvent[] {
    try {
      const parsed = this.parser.parse(xmlContent);
      const tempos: XMLTempoEvent[] = [];
      
      // Handle both score-partwise and score-timewise
      const score = parsed['score-partwise'] || parsed['score-timewise'];
      if (!score) {
        return tempos;
      }
      
      
      if (parsed['score-partwise']) {
        this.extractFromPartwise(score, tempos);
      } else if (parsed['score-timewise']) {
        this.extractFromTimewise(score, tempos);
      }
      
      // Sort by measure then offset - don't rely on traversal order
      return tempos.sort((a, b) => {
        const measureDiff = a.measureNumber - b.measureNumber;
        if (measureDiff !== 0) return measureDiff;
        return (a.offset ?? 0) - (b.offset ?? 0);
      });
      
    } catch (error) {
      perfLogger.error('[XML Tempo] Extraction error:', error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }
  
  /**
   * Extract from score-partwise format: score-partwise → part[] → measure[]
   */
  private extractFromPartwise(score: any, tempos: XMLTempoEvent[]): void {
    if (!score.part) return;
    
    const parts = this.ensureArray(score.part);
    
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex];
      if (!part?.measure) continue;
      
      const partId = part['@_id'] || `Part${partIndex + 1}`;
      const measures = this.ensureArray(part.measure);
      
      for (let i = 0; i < measures.length && tempos.length < this.MAX_TEMPOS; i++) {
        const measure = measures[i];
        if (!measure) continue;
        
        const measureNumber = parseInt(measure['@_number']) || i + 1;
        
        // Use break not return to preserve partial data
        if (tempos.length >= this.MAX_TEMPOS) break;
        
        this.extractFromMeasure(measure, measureNumber, partId, tempos);
      }
    }
  }
  
  /**
   * Extract from score-timewise format: score-timewise → measure[] → part[]
   */
  private extractFromTimewise(score: any, tempos: XMLTempoEvent[]): void {
    if (!score.measure) return;
    
    const measures = this.ensureArray(score.measure);
    
    for (let i = 0; i < measures.length && tempos.length < this.MAX_TEMPOS; i++) {
      const measure = measures[i];
      if (!measure) continue;
      
      const measureNumber = parseInt(measure['@_number']) || i + 1;
      
      if (!measure.part) continue;
      const parts = this.ensureArray(measure.part);
      
      for (const part of parts) {
        if (!part) continue;
        
        const partId = part['@_id'];
        
        // Use break not return to preserve partial data
        if (tempos.length >= this.MAX_TEMPOS) break;
        
        this.extractFromMeasure(part, measureNumber, partId, tempos);
      }
    }
  }
  
  /**
   * Extract tempo events from a measure (works for both formats)
   */
  private extractFromMeasure(
    measure: any, 
    measureNumber: number,
    partId: string | undefined,
    tempos: XMLTempoEvent[]
  ): void {
    
    // Extract from direction elements
    this.extractDirectionTempos(measure, measureNumber, partId, tempos);
    
    // Extract from standalone sound elements
    this.extractSoundTempos(measure, measureNumber, partId, tempos);
  }
  
  private extractDirectionTempos(
    measure: any, 
    measureNumber: number,
    partId: string | undefined,
    tempos: XMLTempoEvent[]
  ): void {
    
    if (!measure.direction) return;
    
    const directions = this.ensureArray(measure.direction);
    
    for (let index = 0; index < directions.length; index++) {
      const direction = directions[index];
      
      // Extract from sound element
      if (direction?.sound?.['@_tempo']) {
        try {
          const bpm = parseFloat(direction.sound['@_tempo']);
          const endTempo = direction.sound['@_end-tempo'] ? parseFloat(direction.sound['@_end-tempo']) : undefined;
          
          if (this.isValidTempo(bpm)) {
            tempos.push({
              measureNumber,
              bpm,
              offset: this.parseOffset(direction.offset),
              text: this.extractDirectionText(direction),
              source: 'direction',
              sourceMeasure: measureNumber,
              sourcePart: partId
            });
            
            // If there's an end-tempo, add it as a separate event
            // This is a simplification - ideally we'd interpolate
            if (endTempo && this.isValidTempo(endTempo)) {
              tempos.push({
                measureNumber,
                bpm: endTempo,
                offset: this.parseOffset(direction.offset) || 0 + 100, // Slightly after start
                text: 'Tempo change',
                source: 'direction',
                sourceMeasure: measureNumber,
                sourcePart: partId
              });
            }
          }
        } catch (e) {
          // Skip invalid tempo, continue processing (error resilience)
        }
      }
      
      // Extract from metronome element (NEW)
      if (direction?.['direction-type']?.metronome) {
        try {
          const metronome = direction['direction-type'].metronome;
          const perMinute = parseFloat(metronome['per-minute']);
          
          if (this.isValidTempo(perMinute)) {
            const beatUnit = metronome['beat-unit'];
            // Check for dotted notes
            // Empty XML elements like <beat-unit-dot/> are parsed as various values
            const hasDot = metronome['beat-unit-dot'] !== undefined;
            
            
            // For dotted notes in MusicXML, the interpretation is special:
            // "dotted quarter = 60" means 60 dotted quarters per minute, which equals 90 regular quarters per minute
            // "dotted eighth = 56.67" means the effective quarter note tempo is 56.67 × 1.5 = 85 BPM
            // First convert to quarter note BPM, then apply dot multiplier if needed
            const rawBpm = this.convertToQuarterNoteBPM(perMinute, beatUnit);
            const bpm = hasDot ? rawBpm * 1.5 : rawBpm;
            
            
            tempos.push({
              measureNumber,
              bpm,
              offset: this.parseOffset(direction.offset),
              text: this.extractDirectionText(direction),
              source: 'metronome',
              sourceMeasure: measureNumber,
              sourcePart: partId
            });
          }
        } catch (e) {
          // Skip invalid metronome, continue processing
        }
      }
    }
  }
  
  private extractSoundTempos(
    measure: any,
    measureNumber: number,
    partId: string | undefined,
    tempos: XMLTempoEvent[]
  ): void {
    
    if (!measure.sound?.['@_tempo']) return;
    
    try {
      const bpm = parseFloat(measure.sound['@_tempo']);
      
      if (this.isValidTempo(bpm)) {
        tempos.push({
          measureNumber,
          bpm,
          offset: this.parseOffset(measure.sound['@_offset']),
          source: 'sound',
          sourceMeasure: measureNumber, // Future-proofing
          sourcePart: partId           // Future-proofing
        });
      }
    } catch (e) {
      // Skip invalid tempo, continue processing (error resilience)
    }
  }
  
  private extractDirectionText(direction: any): string | undefined {
    const dirType = direction['direction-type'];
    if (dirType?.words) {
      if (typeof dirType.words === 'string') {
        return dirType.words;
      } else if (dirType.words['#text']) {
        return dirType.words['#text'];
      } else if (typeof dirType.words === 'object') {
        return dirType.words.toString();
      }
    }
    return undefined;
  }
  
  private parseOffset(value: any): number | undefined {
    if (value == null) return undefined;
    
    const offset = parseInt(value);
    if (Number.isFinite(offset) && offset >= 0 && offset <= this.MAX_OFFSET) {
      return offset;
    }
    return undefined;
  }
  
  private isValidTempo(bpm: number): boolean {
    return Number.isFinite(bpm) && bpm > 0 && bpm <= this.MAX_BPM;
  }
  
  private ensureArray<T>(item: T | T[]): T[] {
    if (!item) return [];
    return Array.isArray(item) ? item : [item];
  }
  
  /**
   * Convert tempo from any beat unit to quarter-note BPM
   * @param perMinute The tempo value (beats per minute)
   * @param beatUnit The beat unit (half, quarter, eighth, etc.)
   * @returns BPM normalized to quarter notes
   */
  private convertToQuarterNoteBPM(perMinute: number, beatUnit: string): number {
    switch (beatUnit) {
      case 'whole':
        return perMinute * 4;     // 1 whole = 4 quarters
      case 'half':
        return perMinute * 2;     // 1 half = 2 quarters
      case 'quarter':
        return perMinute;         // Already in quarters
      case 'eighth':
        return perMinute / 2;     // 120 eighths/min = 60 quarters/min
      case '16th':
        return perMinute / 4;     // 240 sixteenths/min = 60 quarters/min
      case '32nd':
        return perMinute / 8;     // 480 32nds/min = 60 quarters/min
      default:
        return perMinute;
    }
  }
}