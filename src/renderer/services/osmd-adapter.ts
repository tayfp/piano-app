/**
 * OSMD Version Adapter
 * 
 * Provides a unified interface for different OSMD versions
 * Handles API differences between OSMD 1.9.x and 2.x
 */

import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { perfLogger } from '@/renderer/utils/performance-logger';

export class OSMDAdapter {
  private osmd: OpenSheetMusicDisplay;
  private version: string;
  
  constructor(osmdInstance: OpenSheetMusicDisplay) {
    this.osmd = osmdInstance;
    this.version = this.detectVersion();
    
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug(` OSMD Adapter initialized for version: ${this.version}`);
    }
  }
  
  /**
   * Detect OSMD version based on available properties
   */
  private detectVersion(): string {
    // Try direct version properties
    if ((this.osmd as any).Version) return (this.osmd as any).Version;
    if ((this.osmd as any).version) return (this.osmd as any).version;
    
    // Feature detection for version inference
    if ((this.osmd as any).GraphicSheet?.MeasureList) {
      return '1.9.x'; // OSMD 1.9.x uses GraphicSheet.MeasureList
    }
    
    if ((this.osmd as any).graphic?.musicPages) {
      return '2.x.x'; // OSMD 2.x uses graphic.musicPages
    }
    
    return 'unknown';
  }
  
  /**
   * Get the graphics sheet object based on version
   */
  getGraphicSheet(): any {
    if (this.version.startsWith('1.9')) {
      return (this.osmd as any).GraphicSheet;
    } else if (this.version.startsWith('2')) {
      return (this.osmd as any).graphic;
    }
    return null;
  }
  
  /**
   * Get measures list based on version
   */
  getMeasureList(): any[] {
    const graphicSheet = this.getGraphicSheet();
    if (!graphicSheet) return [];
    
    if (this.version.startsWith('1.9')) {
      return graphicSheet.MeasureList || [];
    } else if (this.version.startsWith('2')) {
      // For OSMD 2.x, need to extract measures from pages
      const measures: any[] = [];
      const pages = graphicSheet.musicPages || [];
      pages.forEach((page: any) => {
        if (page.staffMeasures) {
          measures.push(...page.staffMeasures);
        }
      });
      return measures;
    }
    
    return [];
  }
  
  /**
   * Get cursor based on version
   */
  getCursor(): any {
    // Priority: Use auto-created cursor (modern pattern)
    if ((this.osmd as any).cursor) {
      return (this.osmd as any).cursor;
    }
    // Fallback: Legacy cursors array for older versions
    else if (this.osmd.cursors?.[0]) {
      return this.osmd.cursors[0];
    }
    return null;
  }
  
  /**
   * Enable or disable cursors based on version
   */
  enableCursors(enable: boolean): void {
    try {
      if (this.version.startsWith('1.9')) {
        // OSMD 1.9.x method
        (this.osmd as any).enableOrDisableCursors(enable);
      } else if (this.version.startsWith('2')) {
        // OSMD 2.x might use different method
        if ((this.osmd as any).setCursorEnabled) {
          (this.osmd as any).setCursorEnabled(enable);
        }
      }
    } catch (err) {
      perfLogger.warn(' Failed to enable/disable cursors:', err);
    }
  }
  
  /**
   * Show cursor based on version
   */
  showCursor(): void {
    const cursor = this.getCursor();
    if (cursor && cursor.show) {
      cursor.show();
    }
  }
  
  /**
   * Hide cursor based on version
   */
  hideCursor(): void {
    const cursor = this.getCursor();
    if (cursor && cursor.hide) {
      cursor.hide();
    }
  }
  
  /**
   * Move cursor to next position
   */
  nextCursorPosition(): void {
    const cursor = this.getCursor();
    if (cursor && cursor.next) {
      cursor.next();
    }
  }
  
  /**
   * Move cursor to previous position
   */
  previousCursorPosition(): void {
    const cursor = this.getCursor();
    if (cursor && cursor.previous) {
      cursor.previous();
    }
  }
  
  /**
   * Get current cursor position
   */
  getCursorPosition(): { measure: number; note: number } | null {
    const cursor = this.getCursor();
    if (!cursor || !cursor.iterator) return null;
    
    return {
      measure: cursor.iterator.currentMeasureIndex || 0,
      note: cursor.iterator.currentVoiceEntryIndex || 0
    };
  }
  
  /**
   * Check if version is supported
   */
  isVersionSupported(): boolean {
    return this.version !== 'unknown';
  }
  
  /**
   * Get version string
   */
  getVersion(): string {
    return this.version;
  }
}