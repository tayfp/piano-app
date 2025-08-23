/**
 * OSMD Context - Shares the single OSMD instance across components
 * 
 * Solves the practice mode issue where controller was creating
 * its own instance instead of using the shared one from SheetMusic.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { MeasureTimeline } from '@/renderer/features/practice-mode/services/MeasureTimeline';
import { useOSMDStore } from '@/renderer/stores/osmdStore';

// Import the OSMDControls type from the hook
interface OSMDControls {
  highlightNote: (noteNumber: number, velocity?: number) => void;
  unhighlightNote: (noteNumber: number) => void;
  clearAllHighlights: () => void;
  updatePlaybackPosition: (timestamp: number) => void;
  getVisibleNotes: () => number[];
  //  CLEAN CURSOR: Direct access to OSMD cursor
  cursor: any; // Direct access to OSMD cursor for simple operations
  // Practice mode
  getExpectedNotesAtCursor: () => any; // PracticeStepResult
  // Cursor visibility control
  hideCursor: () => void;
  showCursor: () => void;
}

interface OSMDContextType {
  osmd: OpenSheetMusicDisplay | null;
  controls: OSMDControls | null;
  isReady: boolean;
  error: Error | null;
  detectRepeats: (() => any[]) | null;
  measureTimeline: MeasureTimeline | null;
  timelineError: Error | null;
  setOSMDInstance: (osmd: OpenSheetMusicDisplay, controls: OSMDControls, detectRepeats: () => any[]) => void;
  clearOSMDInstance: () => void;
  validateState: () => boolean;
  getStateHistory: () => Array<{timestamp: number, action: string, state: any}>;
}

const OSMDContext = createContext<OSMDContextType>({
  osmd: null,
  controls: null,
  isReady: false,
  error: null,
  detectRepeats: null,
  measureTimeline: null,
  timelineError: null,
  setOSMDInstance: () => {},
  clearOSMDInstance: () => {},
  validateState: () => false,
  getStateHistory: () => []
});

interface OSMDProviderProps {
  children: React.ReactNode;
}

export const OSMDProvider: React.FC<OSMDProviderProps> = ({ children }) => {
  const [osmd, setOsmd] = useState<OpenSheetMusicDisplay | null>(null);
  const [controls, setControls] = useState<OSMDControls | null>(null);
  const [detectRepeats, setDetectRepeats] = useState<(() => any[]) | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [measureTimeline, setMeasureTimeline] = useState<MeasureTimeline | null>(null);
  const [timelineError, setTimelineError] = useState<Error | null>(null);
  
  // Subscribe to OSMDStore.isLoaded for correct timing
  const isLoaded = useOSMDStore((state) => state.isLoaded);
  
  // Create MeasureTimeline only when OSMD is ready AND score is loaded
  useEffect(() => {
    perfLogger.debug('[OSMDContext] useEffect triggered:', { 
      hasOsmd: !!osmd, 
      isLoaded,
      osmdConstructor: osmd?.constructor?.name,
      osmdId: osmd?._id || osmd?.id || 'no-id'
    });

    if (osmd && isLoaded) {
      // COMPREHENSIVE OSMD STATE ANALYSIS
      perfLogger.debug('[OSMDContext] OSMD Instance Analysis:', {
        // Basic OSMD properties
        osmdType: osmd.constructor.name,
        osmdKeys: Object.keys(osmd).slice(0, 10), // First 10 keys
        
        // Sheet structure
        hasSheet: !!osmd.sheet,
        hasMusicSheet: !!osmd.sheet?.musicSheet,
        hasSourceMeasures: !!osmd.sheet?.musicSheet?.sourceMeasures,
        sourceMeasuresLength: osmd.sheet?.musicSheet?.sourceMeasures?.length || 'undefined',
        
        // OSMD state
        isReady: osmd.isReady,
        hasGraphic: !!osmd.graphic,
        hasDrawingParameters: !!osmd.drawingParameters,
        
        // Rendering state  
        hasBackend: !!osmd.backend,
        hasRules: !!osmd.rules,
        hasContainer: !!osmd.container
      });

      try {
        setTimelineError(null);
        perfLogger.debug('[OSMDContext] Creating MeasureTimeline instance...');
        const timeline = new MeasureTimeline();
        
        perfLogger.debug('[OSMDContext] Calling timeline.build() with OSMD...');
        timeline.build(osmd);
        
        const measureCount = timeline.getMeasureCount();
        perfLogger.debug('[OSMDContext] MeasureTimeline.build() completed:', {
          measureCount,
          timelineBuilt: timeline.isBuilt || 'unknown state',
          timelineLength: timeline.timeline?.length || 'no timeline property'
        });
        
        setMeasureTimeline(timeline);
        
        // CRITICAL: Compare with expected count
        if (measureCount === 0) {
          perfLogger.error('[OSMDContext] CRITICAL: MeasureTimeline returned 0 measures despite successful conditions!');
          perfLogger.error('[OSMDContext] This indicates MeasureTimeline.build() internal failure');
        } else {
          perfLogger.debug('[OSMDContext] SUCCESS: MeasureTimeline working correctly with', measureCount, 'measures');
        }
        
      } catch (timelineError) {
        perfLogger.error('[OSMDContext] Failed to create MeasureTimeline:', timelineError instanceof Error ? timelineError : new Error(String(timelineError)));
        setTimelineError(timelineError instanceof Error ? timelineError : new Error(String(timelineError)));
        setMeasureTimeline(null);
      }
    } else {
      perfLogger.debug('[OSMDContext] Clearing timeline - conditions not met:', { hasOsmd: !!osmd, isLoaded });
      setMeasureTimeline(null);
      setTimelineError(null);
    }
  }, [osmd, isLoaded]);
  
  // Track state changes for debugging
  const [stateHistory, setStateHistory] = useState<Array<{timestamp: number, action: string, state: any}>>([]);

  // Expose context getter for debugging
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
      (window as any).getOSMDFromContext = () => ({
        // Basic context state
        osmd,
        controls,
        isReady,
        detectRepeats,
        measureTimeline,
        timelineError,
        isLoaded,
        
        // COMPREHENSIVE OSMD ANALYSIS
        osmdAnalysis: osmd ? {
          type: osmd.constructor.name,
          keys: Object.keys(osmd).slice(0, 15),
          
          // Sheet structure
          hasSheet: !!osmd.Sheet,
          hassheet: !!osmd.sheet,
          sheetKeys: osmd.Sheet ? Object.keys(osmd.Sheet).slice(0, 10) : [],
          
          // Graphic structure
          hasGraphicSheet: !!osmd.GraphicSheet,
          hasgraphic: !!osmd.graphic,
          graphicSheetKeys: osmd.GraphicSheet ? Object.keys(osmd.GraphicSheet).slice(0, 10) : [],
          
          // Measure sources
          measureSources: {
            'GraphicSheet.MeasureList': osmd.GraphicSheet?.MeasureList?.length || 0,
            'Sheet.SourceMeasures': osmd.Sheet?.SourceMeasures?.length || 0,
            'sheet.musicSheet.sourceMeasures': osmd.sheet?.musicSheet?.sourceMeasures?.length || 0,
            'graphic.MeasureList': osmd.graphic?.MeasureList?.length || 0
          },
          
          // State flags
          isReady: osmd.isReady,
          hasBackend: !!osmd.backend,
          hasRules: !!osmd.rules,
          hasContainer: !!osmd.container
        } : null,
        
        // Timeline analysis
        timelineAnalysis: measureTimeline ? {
          measureCount: measureTimeline.getMeasureCount(),
          isBuilt: measureTimeline.isBuilt,
          hasRepeats: measureTimeline.hasMusicalRepeats,
          canHandle: measureTimeline.canHandleScore()
        } : null
      });
      perfLogger.debug(' OSMD context getter exposed: window.getOSMDFromContext()');
    }
    
    return () => {
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
        delete (window as any).getOSMDFromContext;
      }
    };
  }, [osmd, controls, isReady, detectRepeats, measureTimeline, timelineError, isLoaded]);

  const setOSMDInstance = useCallback((
    osmdInstance: OpenSheetMusicDisplay, 
    osmdControls: OSMDControls,
    detectRepeatsFn: () => any[]
  ) => {
    // Prevent duplicate setting of the same instance
    if (osmd === osmdInstance && controls === osmdControls) {
      perfLogger.debug('[OSMDContext] OSMD instance already set, skipping duplicate');
      return;
    }
    
    perfLogger.debug('[OSMDContext] Setting OSMD instance', { osmdInstance, osmdControls });
    
    // Create a protective wrapper around controls that logs access
    const protectedControls: OSMDControls = {
      ...osmdControls,
      hideCursor: () => {
        try {
          perfLogger.debug('[OSMDContext] hideCursor called');
          osmdControls.cursor?.hide();
          perfLogger.debug('[OSMDContext] hideCursor completed successfully');
        } catch (error) {
          perfLogger.error('[OSMDContext] Error in hideCursor:', error instanceof Error ? error : new Error(String(error)));
          // Don't let cursor errors propagate
        }
      },
      showCursor: () => {
        try {
          perfLogger.debug('[OSMDContext] showCursor called');
          osmdControls.cursor?.show();
          perfLogger.debug('[OSMDContext] showCursor completed successfully');
        } catch (error) {
          perfLogger.error('[OSMDContext] Error in showCursor:', error instanceof Error ? error : new Error(String(error)));
        }
      }
    };
    
    setOsmd(osmdInstance);
    setControls(protectedControls);
    setDetectRepeats(() => detectRepeatsFn);
    setIsReady(true);
    setError(null);
    
    // Log state change
    setStateHistory(prev => [...prev.slice(-9), {
      timestamp: Date.now(),
      action: 'setOSMDInstance',
      state: { hasOsmd: !!osmdInstance, hasControls: !!osmdControls, isReady: true }
    }]);
  }, [osmd, controls]);

  const clearOSMDInstance = useCallback(() => {
    perfLogger.debug('[OSMDContext] Clearing OSMD instance');
    setOsmd(null);
    setControls(null);
    setDetectRepeats(null);
    setMeasureTimeline(null);
    setTimelineError(null);
    setIsReady(false);
    setError(null);
    
    // Log state change
    setStateHistory(prev => [...prev.slice(-9), {
      timestamp: Date.now(),
      action: 'clearOSMDInstance',
      state: { hasOsmd: false, hasControls: false, isReady: false }
    }]);
  }, []);
  
  // State validation function
  const validateState = useCallback(() => {
    const valid = isReady && !!osmd && !!controls;
    perfLogger.debug('[OSMDContext] State validation:', {
      isReady,
      hasOsmd: !!osmd,
      hasControls: !!controls,
      valid
    });
    return valid;
  }, [isReady, osmd, controls]);
  
  // Get state history for debugging
  const getStateHistory = useCallback(() => stateHistory, [stateHistory]);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    osmd,
    controls,
    isReady,
    error,
    detectRepeats,
    measureTimeline,
    timelineError,
    setOSMDInstance,
    clearOSMDInstance,
    validateState,
    getStateHistory
  }), [osmd, controls, isReady, error, detectRepeats, measureTimeline, timelineError, setOSMDInstance, clearOSMDInstance, validateState, getStateHistory]);

  return (
    <OSMDContext.Provider value={contextValue}>
      {children}
    </OSMDContext.Provider>
  );
};

// Custom hook with error boundary
export const useOSMDContext = () => {
  const context = useContext(OSMDContext);
  
  if (!context) {
    throw new Error('useOSMDContext must be used within an OSMDProvider');
  }
  
  return context;
};