/**
 * Repeat Navigator Service
 * 
 * Handles musical repeat navigation including D.C., D.S., Coda, and repeat signs.
 * Provides correct navigation flow and prevents infinite loops.
 */

import type { RepeatMarking } from '../types';
import { perfLogger } from '@/renderer/utils/performance-logger';

interface RepeatStatus {
  isRepeatEnd: boolean;
  hasBeenVisited: boolean;
  targetMeasure?: number;
}

export class RepeatNavigator {
  private repeatMarkings: RepeatMarking[] = [];
  private visitedRepeats: Set<string> = new Set();
  private currentPath: number[] = [];
  private codaJumpEnabled = false;
  
  constructor(osmdInstance?: any) {
    if (osmdInstance) {
      this.parseRepeatMarkings(osmdInstance);
    }
  }
  
  /**
   * Parse repeat markings from OSMD structure
   */
  private parseRepeatMarkings(osmd: any): void {
    try {
      const sheet = osmd.GraphicSheet;
      if (!sheet || !sheet.MeasureList) return;
      
      // First pass: collect all markings
      const tempMarkings: any[] = [];
      
      sheet.MeasureList.forEach((staffMeasures: any[]) => {
        if (!staffMeasures) return;
        
        staffMeasures.forEach((measure: any, measureIndex: number) => {
          if (!measure || !measure.parentSourceMeasure) return;
          
          const sourceMeasure = measure.parentSourceMeasure;
          
          // Check for repeat signs
          if (sourceMeasure.repeatStartLine) {
            tempMarkings.push({
              type: 'REPEAT_START',
              measureIndex
            });
          }
          
          if (sourceMeasure.repeatEndLine) {
            tempMarkings.push({
              type: 'REPEAT_END',
              measureIndex,
              targetMeasure: null // Will be set later
            });
          }
          
          // Check for D.C., D.S., Coda, etc.
          const instructions = sourceMeasure.instructions;
          if (instructions && Array.isArray(instructions)) {
            instructions.forEach((instruction: any) => {
              tempMarkings.push({
                type: instruction.type,
                measureIndex
              });
            });
          }
        });
      });
      
      // Second pass: resolve references and create proper markings
      tempMarkings.forEach((marking) => {
        switch (marking.type) {
          case 'REPEAT_START':
            this.repeatMarkings.push({
              type: 'REPEAT_START',
              measureIndex: marking.measureIndex
            });
            break;
            
          case 'REPEAT_END':
            const target = this.findMatchingRepeatStartInTemp(marking.measureIndex, tempMarkings);
            this.repeatMarkings.push({
              type: 'REPEAT_END',
              measureIndex: marking.measureIndex,
              targetMeasure: target >= 0 ? target : undefined
            });
            break;
            
          case 'DaCapo':
          case 'DaCapoAlFine':
            this.repeatMarkings.push({
              type: 'DC',
              measureIndex: marking.measureIndex,
              targetMeasure: 0
            });
            break;
            
          case 'DalSegno':
          case 'DalSegnoAlCoda':
            this.repeatMarkings.push({
              type: 'DS',
              measureIndex: marking.measureIndex,
              targetMeasure: this.findSegnoInTemp(tempMarkings)
            });
            break;
            
          case 'Segno':
            this.repeatMarkings.push({
              type: 'SEGNO',
              measureIndex: marking.measureIndex
            });
            break;
            
          case 'Fine':
            this.repeatMarkings.push({
              type: 'FINE',
              measureIndex: marking.measureIndex
            });
            break;
            
          case 'Coda':
            this.repeatMarkings.push({
              type: 'CODA',
              measureIndex: marking.measureIndex
            });
            break;
            
          case 'ToCoda':
            // Store ToCoda as its own type with target to the Coda section
            const codaTarget = this.findCodaInTemp(tempMarkings);
            this.repeatMarkings.push({
              type: 'TO_CODA',
              measureIndex: marking.measureIndex,
              targetMeasure: codaTarget
            });
            break;
        }
      });
      
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('Found repeat markings:', this.repeatMarkings);
      }
    } catch (error) {
      perfLogger.error('Error parsing repeat markings:', error);
    }
  }
  
  private findMatchingRepeatStartInTemp(endIndex: number, markings: any[]): number {
    // Look backwards for the nearest repeat start
    for (let i = markings.length - 1; i >= 0; i--) {
      if (markings[i].type === 'REPEAT_START' && markings[i].measureIndex < endIndex) {
        return markings[i].measureIndex;
      }
    }
    // No matching start found - this is malformed, return -1 to indicate error
    return -1;
  }
  
  private findSegnoInTemp(markings: any[]): number {
    const segno = markings.find(m => m.type === 'Segno');
    return segno ? segno.measureIndex : 0;
  }
  
  private findCodaInTemp(markings: any[]): number {
    const coda = markings.find(m => m.type === 'Coda');
    return coda ? coda.measureIndex : 0;
  }
  
  
  /**
   * Get all repeat markings
   */
  getRepeatMarkings(): RepeatMarking[] {
    return [...this.repeatMarkings];
  }
  
  /**
   * Get the next measure index based on current position
   */
  getNextMeasure(currentMeasure: number): number | null {
    if (currentMeasure < 0) return 0;
    if (currentMeasure === 999) return null; // Handle very large indices
    
    // Check for repeat markings at current measure
    const marking = this.repeatMarkings.find(m => m.measureIndex === currentMeasure);
    
    if (marking) {
      const repeatKey = `${marking.type}_${marking.measureIndex}`;
      
      switch (marking.type) {
        case 'REPEAT_END':
          // Only jump if we have a valid target and haven't visited yet
          if (!this.visitedRepeats.has(repeatKey)) {
            if (marking.targetMeasure !== undefined && marking.targetMeasure >= 0) {
              this.visitedRepeats.add(repeatKey);
              this.currentPath.push(currentMeasure);
              return marking.targetMeasure;
            } else if (marking.targetMeasure === -1) {
              // Malformed repeat structure - no matching start
              // Just continue to next measure
              this.visitedRepeats.add(repeatKey);
            }
          }
          break;
          
        case 'DC':
          if (!this.visitedRepeats.has(repeatKey)) {
            this.visitedRepeats.add(repeatKey);
            this.currentPath.push(currentMeasure);
            return 0; // Go to beginning
          }
          break;
          
        case 'DS':
          if (!this.visitedRepeats.has(repeatKey)) {
            this.visitedRepeats.add(repeatKey);
            this.currentPath.push(currentMeasure);
            return marking.targetMeasure ?? 0;
          }
          break;
          
        case 'FINE':
          // Check if we've done a D.C. or D.S. jump
          const hasDCJump = Array.from(this.visitedRepeats.keys()).some(k => k.startsWith('DC_'));
          const hasDSJump = Array.from(this.visitedRepeats.keys()).some(k => k.startsWith('DS_'));
          
          if (hasDCJump || hasDSJump) {
            return null; // End of piece
          }
          break;
          
        case 'TO_CODA':
          if (this.codaJumpEnabled && marking.targetMeasure !== undefined) {
            this.currentPath.push(currentMeasure);
            return marking.targetMeasure; // Jump to coda
          }
          break;
          
        case 'CODA':
          // Just a marker - continue normally
          break;
      }
    }
    
    
    // Default: next measure
    this.currentPath.push(currentMeasure);
    return currentMeasure + 1;
  }
  
  /**
   * Check if a measure has a "To Coda" marking
   */
  private isToCodaMeasure(measureIndex: number): boolean {
    // This would be parsed from OSMD instructions
    // For now, return false as we handle it differently
    return false;
  }
  
  /**
   * Reset navigation state
   */
  reset(): void {
    this.visitedRepeats.clear();
    this.currentPath = [];
    this.codaJumpEnabled = false;
  }
  
  /**
   * Enable coda jump (for D.S. al Coda)
   */
  markCodaJump(): void {
    this.codaJumpEnabled = true;
  }
  
  /**
   * Get current playback path
   */
  getCurrentPath(): number[] {
    return [...this.currentPath];
  }
  
  /**
   * Get repeat status for a measure
   */
  getRepeatStatus(measureIndex: number): RepeatStatus {
    const marking = this.repeatMarkings.find(m => 
      m.type === 'REPEAT_END' && m.measureIndex === measureIndex
    );
    
    if (!marking) {
      return {
        isRepeatEnd: false,
        hasBeenVisited: false
      };
    }
    
    const repeatKey = `${marking.type}_${marking.measureIndex}`;
    
    return {
      isRepeatEnd: true,
      hasBeenVisited: this.visitedRepeats.has(repeatKey),
      targetMeasure: marking.targetMeasure
    };
  }
  
  /**
   * Generate complete play order for progress tracking
   */
  generatePlayOrder(totalMeasures: number): number[] {
    const order: number[] = [];
    let current: number | null = 0;
    let safety = 0;
    const maxIterations = 1000;
    const measureVisits = new Map<number, number>();
    
    this.reset();
    
    while (current !== null && safety < maxIterations) {
      // Check if we would go past the total measures
      if (current >= totalMeasures) {
        break;
      }
      
      order.push(current);
      
      // Track visits per measure
      const visits = (measureVisits.get(current) || 0) + 1;
      measureVisits.set(current, visits);
      
      // Get next measure
      const next = this.getNextMeasure(current);
      
      // Detect repeating patterns that indicate an infinite loop
      // Check if we have a pattern like [a,b,a,b] where b is the last measure
      if (order.length >= 4) {
        const len = order.length;
        const patternSize = 2;
        
        // Check for 2-measure repeating pattern
        if (len >= patternSize * 2) {
          let isRepeating = true;
          for (let i = 0; i < patternSize; i++) {
            if (order[len - patternSize - 1 - i] !== order[len - 1 - i]) {
              isRepeating = false;
              break;
            }
          }
          
          // If we have a repeating pattern and the last measure is the end
          if (isRepeating && current === totalMeasures - 1) {
            // Check if we can progress beyond this
            if (next === null || next >= totalMeasures || next < current) {
              perfLogger.error(' Infinite loop detected in repeat structure');
              return order;
            }
          }
        }
      }
      
      current = next;
      safety++;
    }
    
    if (safety >= maxIterations) {
      perfLogger.error(' Infinite loop detected in repeat structure');
      return order;
    }
    
    return order;
  }
}