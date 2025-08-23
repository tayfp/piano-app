// Version MeasureTimeline Service - Core implementation for measure navigation
import { perfLogger } from '@/renderer/utils/performance-logger';

interface MeasureInfo {
  measureIdx: number;
  sourceIdx: number;  // Source measure index in OSMD
  partIdx: number;    // Part/instrument index
  duration: number;   // Measure duration in beats
}

export class MeasureTimeline {
  private timeline: MeasureInfo[] = [];
  private isBuilt = false;
  private hasMusicalRepeats = false;

  constructor() {
    // Initialize with empty timeline
  }

  /**
   * Build timeline from OSMD score
   * @param osmd - OpenSheetMusicDisplay instance
   */
  build(osmd: any): void {
    perfLogger.debug('[MeasureTimeline] build() called with OSMD:', {
      hasOsmd: !!osmd,
      osmdType: osmd?.constructor?.name,
      osmdKeys: osmd ? Object.keys(osmd).slice(0, 8) : [],
      hasSheet: !!osmd?.Sheet,
      hasGraphicSheet: !!osmd?.GraphicSheet
    });

    if (!osmd) {
      perfLogger.error('[MeasureTimeline] Cannot build timeline: OSMD is null');
      this.hasMusicalRepeats = false;
      this.isBuilt = false;
      return;
    }

    if (this.isBuilt) {
      perfLogger.info('[MeasureTimeline] Timeline already built, skipping rebuild');
      return;
    }

    try {
      this.timeline = [];
      this.hasMusicalRepeats = false;

      perfLogger.debug('[MeasureTimeline] Starting build process...');

      // Check for musical repeats first
      // TODO: Post-MVP - Implement proper repeat handling for voltas and D.C. al Fine
      perfLogger.debug('[MeasureTimeline] Checking for musical repeats...');
      if (this.detectMusicalRepeats(osmd)) {
        this.hasMusicalRepeats = true;
        perfLogger.warn('[MeasureTimeline] Repeats detected - building linear timeline (repeats ignored)');
      }
      perfLogger.debug('[MeasureTimeline] Proceeding with timeline build...');

      // Build timeline for linear score
      const sourceMeasures = osmd.GraphicSheet?.MeasureList || [];
      perfLogger.debug('[MeasureTimeline] Source measures analysis:', {
        hasGraphicSheet: !!osmd.GraphicSheet,
        hasMeasureList: !!osmd.GraphicSheet?.MeasureList,
        measureListLength: sourceMeasures.length,
        measureListType: Array.isArray(sourceMeasures) ? 'array' : typeof sourceMeasures
      });

      if (sourceMeasures.length === 0) {
        perfLogger.error('[MeasureTimeline] CRITICAL: sourceMeasures is empty! No measures to build timeline from.');
        perfLogger.debug('[MeasureTimeline] Trying alternative paths...');
        
        // Try alternative measure sources
        const altSources = {
          'sheet.SourceMeasures': osmd.Sheet?.SourceMeasures?.length || 0,
          'sheet.musicSheet.sourceMeasures': osmd.sheet?.musicSheet?.sourceMeasures?.length || 0,
          'graphic.MeasureList': osmd.graphic?.MeasureList?.length || 0
        };
        perfLogger.debug('[MeasureTimeline] Alternative measure sources:', altSources);
      }
      
      for (let measureIdx = 0; measureIdx < sourceMeasures.length; measureIdx++) {
        const sourceMeasure = sourceMeasures[measureIdx];
        if (!sourceMeasure || sourceMeasure.length === 0) {
          perfLogger.debug(`[MeasureTimeline] Skipping empty measure at index ${measureIdx}`);
          continue;
        }

        // For multi-stave instruments, we treat all staves as one measure
        const firstStaffMeasure = sourceMeasure[0];
        
        this.timeline.push({
          measureIdx,
          sourceIdx: measureIdx,
          partIdx: 0,
          duration: this.getMeasureDuration(firstStaffMeasure)
        });
      }

      // Only mark as built if we have measures
      this.isBuilt = this.timeline.length > 0;
      perfLogger.debug(`[MeasureTimeline] Build completed:`, {
        timelineLength: this.timeline.length,
        isBuilt: this.isBuilt,
        hasRepeats: this.hasMusicalRepeats
      });

      if (this.timeline.length > 0) {
        perfLogger.info(`[MeasureTimeline] Successfully built timeline for ${this.timeline.length} measures`);
      } else {
        perfLogger.error('[MeasureTimeline] FAILED: Built timeline but got 0 measures');
      }

    } catch (error) {
      perfLogger.error('[MeasureTimeline] Error building timeline:', error);
      // On error, clear state
      this.timeline = [];
      this.hasMusicalRepeats = false;
      this.isBuilt = false;
    }
  }

  /**
   * Detect if score contains musical repeats (not supported in MVP)
   */
  private detectMusicalRepeats(osmd: any): boolean {
    perfLogger.debug('[MeasureTimeline] detectMusicalRepeats() called');
    
    try {
      const sheet = osmd.Sheet;
      perfLogger.debug('[MeasureTimeline] Sheet analysis:', {
        hasSheet: !!sheet,
        sheetKeys: sheet ? Object.keys(sheet).slice(0, 10) : []
      });
      
      if (!sheet) {
        perfLogger.debug('[MeasureTimeline] No sheet found, no repeats detected');
        return false;
      }

      // Check for repeat instructions
      const instructions = sheet.SheetPlaybackSetting?.Repetitions || [];
      perfLogger.debug('[MeasureTimeline] Repeat instructions check:', {
        hasSheetPlaybackSetting: !!sheet.SheetPlaybackSetting,
        hasRepetitions: !!sheet.SheetPlaybackSetting?.Repetitions,
        instructionsLength: instructions.length
      });
      
      if (instructions.length > 0) {
        perfLogger.info('[MeasureTimeline] Found repeat instructions');
        return true;
      }

      // Check for repeat barlines in measures
      const sourceMeasures = sheet.SourceMeasures || [];
      perfLogger.debug('[MeasureTimeline] Source measures check:', {
        hasSourceMeasures: !!sheet.SourceMeasures,
        sourceMeasuresLength: sourceMeasures.length,
        sourceMeasuresType: Array.isArray(sourceMeasures) ? 'array' : typeof sourceMeasures
      });
      
      for (let i = 0; i < sourceMeasures.length; i++) {
        const measure = sourceMeasures[i];
        if (!measure) continue;

        // Check for repeat start/end barlines
        if (measure.FirstRepetitionBarline || measure.LastRepetitionBarline) {
          perfLogger.info(`[MeasureTimeline] Found repeat barlines in measure ${i}`);
          return true;
        }

        // Check for numbered endings (1st, 2nd ending)
        if (measure.HasEndLine || measure.EndingBarlines?.length > 0) {
          perfLogger.info(`[MeasureTimeline] Found numbered endings in measure ${i}`);
          return true;
        }
      }

      // Check for D.C. al Fine and similar instructions
      const musicSystem = osmd.MusicSystem;
      perfLogger.debug('[MeasureTimeline] Music system check:', {
        hasMusicSystem: !!musicSystem,
        hasRepetitionInstructions: !!musicSystem?.RepetitionInstructions,
        repetitionInstructionsLength: musicSystem?.RepetitionInstructions?.length || 0
      });
      
      if (musicSystem?.RepetitionInstructions?.length > 0) {
        perfLogger.info('[MeasureTimeline] Found D.C. al Fine or similar');
        return true;
      }

      perfLogger.debug('[MeasureTimeline] No musical repeats detected');
      return false;
    } catch (error) {
      perfLogger.error('[MeasureTimeline] Error detecting repeats:', error);
      // Assume no repeats on error
      return false;
    }
  }

  /**
   * Get measure duration in beats
   */
  private getMeasureDuration(graphicMeasure: any): number {
    try {
      const timeSig = graphicMeasure.parentSourceMeasure?.Duration?.RealValue || 4;
      return timeSig;
    } catch {
      return 4; // Default to 4/4
    }
  }

  /**
   * Seek OSMD cursor to specific measure
   */
  seekToMeasure(measureIndex: number, cursor: any): boolean {
    // Note: We now allow seeking even with musical repeats since we build linear timelines

    if (!this.isBuilt) {
      perfLogger.error('[MeasureTimeline] Cannot seek: timeline not built');
      return false;
    }

    if (!cursor) {
      perfLogger.error('[MeasureTimeline] Cannot seek: cursor is null');
      return false;
    }

    if (measureIndex < 0 || measureIndex >= this.timeline.length) {
      perfLogger.warn(`[MeasureTimeline] Invalid measure index: ${measureIndex}`);
      return false;
    }

    try {
      // Reset cursor to beginning first
      cursor.reset();

      // Use real OSMD cursor navigation - iterate to target measure
      const measureInfo = this.timeline[measureIndex];
      while (cursor.iterator?.currentMeasureIndex < measureIndex && !cursor.iterator?.EndReached) {
        cursor.next();
      }

      perfLogger.info(`[MeasureTimeline] Seeked to measure ${measureIndex}`);
      return true;

    } catch (error) {
      perfLogger.error('[MeasureTimeline] Seek error:', error);
      return false;
    }
  }

  /**
   * Check if timeline can handle the loaded score
   * Now returns true for any built timeline, including those with repeats (handled linearly)
   */
  canHandleScore(): boolean {
    return this.isBuilt;
  }

  /**
   * Get total measure count
   */
  getMeasureCount(): number {
    return this.timeline.length;
  }

  /**
   * Get measure info by index
   */
  getMeasureInfo(measureIndex: number): MeasureInfo | null {
    if (measureIndex < 0 || measureIndex >= this.timeline.length) {
      return null;
    }
    return this.timeline[measureIndex];
  }
}