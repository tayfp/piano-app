/**
 * OSMD Store - Global state for OpenSheetMusicDisplay with tempo extraction
 * 
 * Features:
 * - Tempo extraction integration (Phase 1)
 * - Complete error isolation
 * - Performance monitoring
 * - Backwards compatibility
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { TempoMap, OSMDTempoData } from '@/renderer/features/tempo-extraction/types';
import { TempoService } from '@/renderer/features/tempo-extraction/services/TempoService';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { logger } from '@/renderer/utils/simple-logger';

// Zoom constants - configurable for future flexibility
const MIN_ZOOM = 0.5; // 50%
const MAX_ZOOM = 2.0; // 200%
const ZOOM_STEP = 0.1; // 10% increments

interface OSMDState extends OSMDTempoData {
  // Core OSMD state
  osmd: any | null;
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;
  
  // Zoom state
  zoomLevel: number;
  targetZoomLevel: number; // Saved zoom to apply after initial render
  isFirstFileOpen: boolean; // Track if this is the first file opened in session
  
  // Actions - Core
  setOSMD: (osmd: any) => void;
  setIsLoading: (loading: boolean) => void;
  setIsLoaded: (loaded: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
  
  // Actions - Zoom
  setZoomLevel: (level: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  
  // Actions - Tempo extraction
  extractTempo: () => Promise<void>;
  extractTempoEnhanced: (options?: { enableTextExtraction?: boolean; enableHeuristics?: boolean }) => Promise<void>;
  getTempoAtMeasure: (measureIndex: number) => number;
  clearTempoData: () => void;
}

// Load saved zoom separately to set as target
const savedZoom = (() => {
  try {
    const stored = localStorage.getItem('osmd-store');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.state?.zoomLevel || 1.0;
    }
  } catch (e) {
    // Ignore parse errors
  }
  return 1.0;
})();

export const useOSMDStore = create<OSMDState>()(
  persist(
    (set, get) => ({
  // Initial state
  osmd: null,
  isLoading: false,
  isLoaded: false,
  error: null,
  
  // Zoom state
  zoomLevel: 1.0, // Always start at 100%
  targetZoomLevel: savedZoom, // Saved zoom to apply after initial render
  isFirstFileOpen: true, // First file in session gets zoom transition
  
  // Tempo extraction state
  tempoMap: null,
  isExtracting: false,
  extractionError: null,
  lastExtractedAt: null,
  
  // Core actions
  setOSMD: (osmd) => {
    perfLogger.debug('[OSMDStore] setOSMD called with:', osmd ? 'valid osmd object' : 'null');
    set({ osmd });
    
    // Trigger tempo extraction after OSMD is set (if loaded)
    if (osmd && get().isLoaded) {
      perfLogger.debug('[OSMDStore] OSMD is set and loaded, triggering tempo extraction...');
      // Extract tempo asynchronously without blocking
      setTimeout(() => {
        get().extractTempo().catch(error => {
          perfLogger.error('[OSMDStore] Tempo extraction failed:', error);
        });
      }, 0);
    } else {
      perfLogger.debug('[OSMDStore] Skipping tempo extraction', { hasOsmd: !!osmd, isLoaded: get().isLoaded });
    }
  },
  
  setIsLoading: (isLoading) => set({ isLoading }),
  
  setIsLoaded: (isLoaded) => {
    perfLogger.debug('[OSMDStore] setIsLoaded called', { isLoaded });
    set({ isLoaded });
    
    // Trigger tempo extraction when loaded
    if (isLoaded && get().osmd) {
      perfLogger.debug('[OSMDStore] File is loaded and OSMD exists, triggering tempo extraction...');
      
      setTimeout(() => {
        get().extractTempo().catch(error => {
          perfLogger.error('[OSMDStore] Tempo extraction failed:', error);
        });
      }, 0);
    } else {
      perfLogger.debug('[OSMDStore] Skipping tempo extraction', { isLoaded, hasOsmd: !!get().osmd });
    }
  },
  
  setError: (error) => set({ error }),
  
  reset: () => set({
    osmd: null,
    isLoading: false,
    isLoaded: false,
    error: null,
    zoomLevel: 1.0,
    targetZoomLevel: 1.0,
    tempoMap: null,
    isExtracting: false,
    extractionError: null,
    lastExtractedAt: null
    // Note: isFirstFileOpen is NOT reset - it tracks the session
  }),
  
  // Zoom actions
  setZoomLevel: (level) => {
    // Handle invalid inputs by keeping previous value
    if (typeof level !== 'number' || isNaN(level) || level === null || level === undefined) {
      perfLogger.warn('[OSMDStore] Invalid zoom level provided:', level);
      return;
    }
    
    // Clamp zoom level between MIN and MAX
    const clampedLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
    
    // Only update if value actually changes (prevent unnecessary renders)
    if (clampedLevel !== get().zoomLevel) {
      set({ zoomLevel: clampedLevel });
    }
  },
  
  zoomIn: () => {
    const currentZoom = get().zoomLevel;
    // Round to avoid floating point precision issues
    const newZoom = Math.round((currentZoom + ZOOM_STEP) * 10) / 10;
    
    // Check if we're already at max before calling setZoomLevel
    if (currentZoom < MAX_ZOOM) {
      get().setZoomLevel(newZoom);
    }
  },
  
  zoomOut: () => {
    const currentZoom = get().zoomLevel;
    // Round to avoid floating point precision issues
    const newZoom = Math.round((currentZoom - ZOOM_STEP) * 10) / 10;
    
    // Check if we're already at min before calling setZoomLevel
    if (currentZoom > MIN_ZOOM) {
      get().setZoomLevel(newZoom);
    }
  },
  
  resetZoom: () => set({ zoomLevel: 1.0 }),
  
  // Tempo extraction actions
  extractTempo: async () => {
    perfLogger.debug('[OSMDStore] extractTempo called');
    const { osmd, isLoaded } = get();
    
    // Guard conditions
    if (!osmd || !isLoaded) {
      perfLogger.debug('[OSMDStore] extractTempo guard failed', { hasOsmd: !!osmd, isLoaded });
      return;
    }
    
    // Don't extract if already extracting
    if (get().isExtracting) {
      return;
    }
    
    set({ 
      isExtracting: true, 
      extractionError: null 
    });
    
    try {
      perfLogger.debug('[OSMDStore] Getting TempoService instance...');
      const tempoService = TempoService.getInstance();
      perfLogger.debug('[OSMDStore] TempoService instance obtained, calling extractFromOSMD...');
      const tempoMap = await tempoService.extractFromOSMD(osmd);
      perfLogger.debug('[OSMDStore] Tempo extraction completed', { 
        defaultBpm: tempoMap.defaultBpm,
        eventCount: tempoMap.events.length,
        confidence: tempoMap.confidence
      });
      
      set({
        tempoMap,
        isExtracting: false,
        lastExtractedAt: Date.now()
      });
      
      // Simplified tempo extraction output
      if (tempoMap.events.length > 0) {
        const tempoChanges = tempoMap.events.map(e => e.bpm).filter((v, i, a) => a.indexOf(v) === i).join('→');
        logger.system(`[TEMPO] ${tempoMap.events.length} events: ${tempoChanges} BPM`);
      } else {
        logger.system(`[TEMPO] Default: ${tempoMap.defaultBpm} BPM`);
      }
      
    } catch (error) {
      // Error isolation - never affect core OSMD functionality
      perfLogger.error('[OSMDStore] Tempo extraction error:', error);
      
      set({
        isExtracting: false,
        extractionError: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Don't propagate error - use default tempo
    }
  },
  
  getTempoAtMeasure: (measureIndex: number): number => {
    const { tempoMap } = get();
    
    if (!tempoMap) {
      return 120; // Default tempo
    }
    
    const tempoService = TempoService.getInstance();
    return tempoService.getTempoAtMeasure(tempoMap, measureIndex);
  },
  
  clearTempoData: () => set({
    tempoMap: null,
    isExtracting: false,
    extractionError: null,
    lastExtractedAt: null
  }),
  
  // Enhanced tempo extraction with text expressions
  extractTempoEnhanced: async (options = {}) => {
    const { osmd, isLoaded } = get();
    
    // Guard conditions
    if (!osmd || !isLoaded) {
      return;
    }
    
    // Don't extract if already extracting
    if (get().isExtracting) {
      return;
    }
    
    set({ 
      isExtracting: true, 
      extractionError: null 
    });
    
    try {
      const tempoService = TempoService.getInstance();
      const tempoMap = await tempoService.extractFromOSMDEnhanced(osmd, {
        enableTextExtraction: options.enableTextExtraction,
        enableHeuristics: options.enableHeuristics,
        useCache: true
      });
      
      set({
        tempoMap,
        isExtracting: false,
        lastExtractedAt: Date.now()
      });
      
    } catch (error) {
      // Error isolation - never affect core OSMD functionality
      perfLogger.error('[OSMDStore] Enhanced tempo extraction error:', error);
      
      set({
        isExtracting: false,
        extractionError: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Don't propagate error - use default tempo
    }
  }
    }),
    {
      name: 'osmd-store',
      partialize: (state) => ({ 
        zoomLevel: state.zoomLevel // Only persist zoom level
        // isFirstFileOpen is NOT persisted - resets on app restart
      }),
    }
  )
);