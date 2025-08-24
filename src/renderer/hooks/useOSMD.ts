/**
 * useOSMD Hook - Core OSMD integration with performance-critical fast path
 * 
 * IMPORTANT: This hook CREATES and manages a NEW OSMD instance.
 * - Use this hook ONLY in components that need to render sheet music (e.g., SheetMusic component)
 * - Requires a containerRef parameter pointing to the DOM element where OSMD will render
 * 
 * For accessing a SHARED OSMD instance (e.g., in dialogs, controls, or other components):
 * - Use useOSMDContext() instead
 * - Do NOT use this hook without a proper containerRef
 * 
 * Architectural patterns:
 * - Component lifecycle + hybrid state management
 * - Velocity-based visual feedback + innovation patterns  
 * - Robust error handling + testing strategies
 */

// BUILD VERIFICATION - Development only (must be after guard definition)

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { OpenSheetMusicDisplay, IOSMDOptions, Cursor } from 'opensheetmusicdisplay';
import type { PracticeStepResult, PracticeNote } from '@/renderer/features/practice-mode/types';
import { extractNoteNameFromPitch } from '@/renderer/utils/noteUtils';
import { calculateVisualFeedback } from '@/renderer/utils/osmd/visualFeedback';
import { Flags } from '@/shared/featureFlags';
import { PracticeSequenceBuilder } from '@/renderer/features/practice-mode/services/PracticeSequenceBuilder';
import { usePracticeStore } from '@/renderer/features/practice-mode/stores/practiceStore';
import { useTheme } from '@/renderer/features/theme';
import { getOSMDThemeOptions, useOSMDTheme } from '@/renderer/features/theme/lib/osmd-theme-integration';
import { useOSMDStore } from '@/renderer/stores/osmdStore';
import { logRenderLatency, perfLogger } from '@/renderer/utils/performance-logger';
import { logger } from '@/renderer/utils/simple-logger';
import { createFullFingeringId } from '@/renderer/features/fingering/utils/fingeringId';
import { injectFingeringsIntoMusicXML, benchmarkFingeringInjection } from '@/renderer/utils/musicxml-fingering-injector';
import { debounce } from '@/renderer/utils/timing/debounce';
import { useFingeringStore } from '@/renderer/features/fingering/stores/fingeringStore';
// Removed complex cursor utilities - using OSMD native API only

// Production-safe logging guards (eliminates 16,002x performance overhead)
const DEV = process.env.NODE_ENV !== 'production';
const debug = (...args: any[]) => { if (DEV) perfLogger?.debug?.(...args); };
const dlog = (...args: any[]) => { if (DEV) console.log(...args); };
// Keep warnings/errors in production (operationally necessary)
const warn = (...args: any[]) => perfLogger?.warn?.(...args);
const error = (...args: any[]) => perfLogger?.error?.(...args);

// BUILD VERIFICATION - Now safe to use guards
if (process.env.NODE_ENV === 'development') {
  debug('useOSMD.ts loaded', { timestamp: new Date().toISOString(), buildVersion: Math.random() });
}

// =========================================================================
// RESIZE CASCADE FIX - SURGICAL UTILITIES
// =========================================================================
// AUTHORITATIVE FIX: Single ResizeObserver with width-only gating (ChatGPT-5)
// Eliminates resize cascade by focusing on layout-driving changes only

// Module-scoped single observer - no dual system confusion
let resizeObserverSingle: ResizeObserver | null = null;
let lastWidth = -1;  // Only track width - height is consequence, not driver
let resizePaused = false;

// Singleflight scheduler - prevent render storms (latest-wins pattern)
let rendering = false;
let rerun = false;

function scheduleResize(run: () => Promise<void>) {
  if (rendering) { 
    rerun = true; 
    return; 
  }
  rendering = true;
  requestAnimationFrame(async () => {
    await run();            // Perform the resize operation
    rendering = false;
    if (rerun) { 
      rerun = false; 
      scheduleResize(run);  // Run one more if needed
    }
  });
}

// Single observer with width-only gating - the conceptual breakthrough
function setupResizeObserverOnce(target: Element, run: () => Promise<void>) {
  if (resizeObserverSingle) resizeObserverSingle.disconnect();
  
  resizeObserverSingle = new ResizeObserver((entries) => {
    if (resizePaused || !entries.length) return;
    
    // WIDTH-ONLY GATING: Music layout depends on available width
    // Height increases are a RESULT of our content - don't feed them back
    const w = Math.round(entries[0].contentRect.width);
    if (w === lastWidth) return;  // Ignore height-only changes entirely
    lastWidth = w;
    
    scheduleResize(run);  // Singleflight prevents storms
  });
  
  resizeObserverSingle.observe(target);
}

// Clean observer (single system)
function cleanupResizeObserver() {
  if (resizeObserverSingle) { 
    try { resizeObserverSingle.disconnect(); } catch {} 
    resizeObserverSingle = null; 
  }
  rendering = false;  // Reset render state
  rerun = false;
}

// Pause ResizeObserver during DOM mutations (keep this working pattern)
function withResizeObserverPaused<T>(fn: () => T): T {
  const wasResizePaused = resizePaused;
  resizePaused = true;
  try { 
    return fn(); 
  } finally { 
    resizePaused = wasResizePaused; 
  }
}

// Main resize function with idempotent zoom and overlay pattern
async function performResize(
  osmdRef: React.MutableRefObject<any>,
  containerRef: React.MutableRefObject<HTMLDivElement | null>,
  zoomLevel: number,
  buildMeasureCache: () => void,
  injectNoteIdAttributes: () => void,
  drawPracticeRangeBorder: () => void,
  isReady: boolean
) {
  const osmd = osmdRef.current;
  const container = containerRef.current;
  if (!osmd || !container || !isReady) return;

  const rect = container.getBoundingClientRect();
  if (!rect.width || rect.width <= 0) return;

  // Idempotent zoom (avoid re-applying the same value)
  const targetZoom = Number(zoomLevel.toFixed(3));
  if (Math.abs(osmd.zoom - targetZoom) > 0.001) {
    osmd.zoom = targetZoom;
  }

  // Render OSMD with new dimensions
  osmd.render();

  // Pause observer while mutating (no bounce)
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      withResizeObserverPaused(() => {
        buildMeasureCache();        // reads
        injectNoteIdAttributes();   // reads (ok)
        drawPracticeRangeBorder();  // overlay writes (no layout impact)
      });
      resolve();
    });
  });
}

// =========================================================================
// PRACTICE BORDER OVERLAY SYSTEM (LAYOUT-NEUTRAL)
// =========================================================================
// ChatGPT-5 solution: Draw borders in absolutely-positioned overlay
// Benefits: No SVG appendChild to main content = No height changes = No resize cascade

// Create or get the overlay container (absolutely positioned, no layout impact)
function ensurePracticeBorderOverlay(containerEl: HTMLElement): HTMLDivElement {
  let overlay = containerEl.querySelector<HTMLDivElement>('.osmd-practice-border-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'osmd-practice-border-overlay';
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '0',              // top:0 right:0 bottom:0 left:0
      pointerEvents: 'none',   // no hit-testing (clicks pass through)
      overflow: 'visible',     // don't clip SVG elements
      zIndex: '1000',         // above all OSMD content and UI elements
    });
    containerEl.appendChild(overlay);
  }
  return overlay;
}

// Create or get the overlay SVG (scales with container, no layout impact)
function ensurePracticeBorderSvg(overlay: HTMLElement): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  let svg = overlay.querySelector<SVGSVGElement>('svg');
  if (!svg) {
    svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('preserveAspectRatio', 'xMinYMin slice');
    svg.style.display = 'block';
    overlay.appendChild(svg);
  }
  return svg;
}

// Clear all practice border overlays from container
function clearPracticeBorderOverlays(containerEl: HTMLElement) {
  const overlays = containerEl.querySelectorAll('.osmd-practice-border-overlay');
  overlays.forEach(overlay => overlay.remove());
}

// =========================================================================
// ULTRA-DEEP RESIZE DEBUG LOGGING SYSTEM
// =========================================================================
// Filterable debug prefix for resize analysis
const RESIZE_DEBUG_PREFIX = 'OSMD_RESIZE_DEBUG';
let debugSequenceCounter = 0;
const debugStartTime = performance.now();

// Comprehensive resize debug logger
const resizeDebugLog = (operation: string, data: any = {}, timing: { start?: number; end?: number } = {}) => {
  if (!DEV) return;
  
  const sequence = ++debugSequenceCounter;
  const timestamp = performance.now();
  const elapsed = timestamp - debugStartTime;
  const duration = timing.start && timing.end ? timing.end - timing.start : undefined;
  
  // Get container dimensions with full precision
  let containerDimensions = 'N/A';
  try {
    const container = document.querySelector('[data-osmd-container]') as HTMLElement;
    if (container) {
      const rect = container.getBoundingClientRect();
      containerDimensions = `${rect.width.toFixed(6)}x${rect.height.toFixed(6)}`;
    }
  } catch (e) {
    containerDimensions = 'ERROR';
  }
  
  // Create detailed log entry
  const logData = {
    seq: sequence,
    timestamp: timestamp.toFixed(3),
    elapsed: elapsed.toFixed(3),
    operation,
    container: containerDimensions,
    duration: duration?.toFixed(3),
    ...data
  };
  
  console.log(`${RESIZE_DEBUG_PREFIX}[${sequence.toString().padStart(3, '0')}] ${operation}`, logData);
};

// Performance timer utility
const createTimer = () => {
  const start = performance.now();
  return {
    start,
    end: () => performance.now(),
    elapsed: () => performance.now() - start
  };
};

// Dimension change detector
let lastKnownDimensions = { width: 0, height: 0 };
const trackDimensionChange = (source: string, element?: Element) => {
  try {
    const target = element || document.querySelector('[data-osmd-container]') as HTMLElement;
    if (!target) return;
    
    const rect = target.getBoundingClientRect();
    const current = { width: rect.width, height: rect.height };
    const widthDelta = current.width - lastKnownDimensions.width;
    const heightDelta = current.height - lastKnownDimensions.height;
    
    if (widthDelta !== 0 || heightDelta !== 0) {
      resizeDebugLog(`DIMENSION_CHANGE`, {
        source,
        previous: `${lastKnownDimensions.width.toFixed(6)}x${lastKnownDimensions.height.toFixed(6)}`,
        current: `${current.width.toFixed(6)}x${current.height.toFixed(6)}`,
        delta: `${widthDelta.toFixed(6)}x${heightDelta.toFixed(6)}`,
        element: target.tagName + (target.className ? `.${target.className}` : '')
      });
      lastKnownDimensions = current;
    }
  } catch (e) {
    resizeDebugLog(`DIMENSION_ERROR`, { source, error: e.message });
  }
};

// SVG element tracking
const trackSVGModification = (operation: string, details: any = {}) => {
  if (!DEV) return;
  
  try {
    const svg = document.querySelector('svg');
    const svgDimensions = svg ? {
      viewBox: svg.getAttribute('viewBox'),
      width: svg.getAttribute('width'),
      height: svg.getAttribute('height'),
      clientWidth: svg.clientWidth,
      clientHeight: svg.clientHeight,
      childElementCount: svg.childElementCount
    } : null;
    
    resizeDebugLog(`SVG_MODIFICATION`, {
      operation,
      svg: svgDimensions,
      ...details
    });
  } catch (e) {
    resizeDebugLog(`SVG_ERROR`, { operation, error: e.message });
  }
};

// Call stack tracer (simplified)
const getCallStack = () => {
  try {
    const stack = new Error().stack;
    const lines = stack?.split('\n').slice(2, 6); // Skip Error and current function
    return lines?.map(line => line.trim().replace(/.*\//, '')) || [];
  } catch {
    return ['stack_unavailable'];
  }
};

// Performance monitoring (following existing PianoKeyboard patterns)
const PERFORMANCE_CONFIG = {
  HIGHLIGHT_DEBOUNCE_MS: 16, // ~60fps for smooth updates
  MAX_CONCURRENT_HIGHLIGHTS: 50, // Prevent DOM overload
  CLEANUP_INTERVAL_MS: 30000, // Cleanup unused mappings
} as const;

// Note mapping for MIDI coordination
interface NoteMapping {
  timestamp: number;
  svgElements: SVGGElement[];
  noteId: string;
  midiNote?: number; // MIDI note number for fast lookup
}

// For fingering feature - extend refs structure
interface NoteMappingRef {
  noteMapping: Map<number, NoteMapping>;
  midiToTimestamp: Map<number, number[]>;
  graphicalNoteMap: Map<string, any>; // noteId -> graphicalNote for O(1) fingering lookups
}


interface OSMDControls {
  highlightNote: (noteNumber: number, velocity?: number) => void;
  unhighlightNote: (noteNumber: number) => void;
  clearAllHighlights: () => void;
  updatePlaybackPosition: (timestamp: number) => void;
  getVisibleNotes: () => number[];
  // Simple cursor control - using OSMD native API
  cursor: any; // Direct access to OSMD cursor for simple operations
  // Practice mode
  getExpectedNotesAtCursor: () => PracticeStepResult;
}


interface UseOSMDReturn {
  osmd: OpenSheetMusicDisplay | null;
  isLoading: boolean;
  isReady: boolean;
  osmdReady: boolean;
  error: Error | null;
  controls: OSMDControls;
  noteMapping: Map<number, NoteMapping>;
  graphicalNoteMap: Map<string, any>;
  detectRepeats: () => any; // Function for detecting musical repeats
}

export const useOSMD = (
  containerRef: React.RefObject<HTMLDivElement | null>, 
  musicXML?: string,
  autoShowCursor: boolean = true, // Default to showing cursor
  scoreId?: string // Optional scoreId for fingering injection
): UseOSMDReturn => {
  if (process.env.NODE_ENV === 'development') {
    debug('useOSMD hook executed', {
      timestamp: Date.now(),
      hasContainer: !!containerRef.current,
      hasMusicXML: !!musicXML,
      autoShowCursor
    });
  }

  // Access theme for OSMD color integration
  const { theme } = useTheme();
  // Access practice store for pre-computed sequence integration
  const { setOptimizedSequence } = usePracticeStore();
  // Access zoom level from OSMD store
  const { zoomLevel } = useOSMDStore();
  // Core OSMD instance
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const noteMappingRef = useRef<NoteMappingRef>({
    noteMapping: new Map(),
    midiToTimestamp: new Map(),
    graphicalNoteMap: new Map()
  });
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const noteMappingBuiltRef = useRef(false); // Track if mapping built for current score
  
  // Component state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [osmdReady, setOsmdReady] = useState(false); // Flag to signal OSMD instance creation
  
  // Performance monitoring (following existing patterns)
  const performanceRef = useRef<{
    initStart?: number;
    renderStart?: number;
    highlightCount: number;
  }>({ highlightCount: 0 });



  // Re-inject data-note-id attributes after OSMD re-renders
  const injectNoteIdAttributes = useCallback(() => {
    if (!osmdRef.current?.GraphicSheet || !containerRef.current) return;
    
    const graphicalNoteMap = noteMappingRef.current.graphicalNoteMap;
    if (!graphicalNoteMap || graphicalNoteMap.size === 0) return;
    
    trackDimensionChange('before_inject_note_ids_layout_queries');
    
    let injected = 0;
    let chordCount = 0;
    
    // Re-inject attributes for all notes with correct musical relationships
    for (const [fingeringNoteId, graphicalNote] of graphicalNoteMap) {
      try {
        const svgElement = graphicalNote.getSVGGElement?.();
        if (svgElement) {
          // Extract noteIndex from fingeringNoteId (format: m0-s0-v0-n{noteIndex}-...)
          const noteIndexMatch = fingeringNoteId.match(/-n(\d+)-/);
          const noteIndex = noteIndexMatch ? parseInt(noteIndexMatch[1], 10) : 0;
          
          // Check if this is part of a chord
          const noteheadElements = svgElement.querySelectorAll('g.vf-notehead');
          
          if (noteheadElements.length > 1) {
            // CHORD: Inject ID on individual notehead
            chordCount++;
            
            // Sort noteheads by Y position - WARNING: getBoundingClientRect() can trigger layout!
            const sortedNoteheads = Array.from(noteheadElements).sort((a, b) => {
              const aRect = a.getBoundingClientRect(); // SUSPECT: Layout trigger
              const bRect = b.getBoundingClientRect(); // SUSPECT: Layout trigger  
              return aRect.top - bRect.top;
            }).reverse();
            
            if (sortedNoteheads[noteIndex]) {
              sortedNoteheads[noteIndex].setAttribute('data-note-id', fingeringNoteId);
              sortedNoteheads[noteIndex].style.pointerEvents = 'auto';
              sortedNoteheads[noteIndex].style.cursor = 'pointer';
            } else {
              // Fallback to parent
              svgElement.setAttribute('data-note-id', fingeringNoteId);
              svgElement.style.pointerEvents = 'auto';
              svgElement.style.cursor = 'pointer';
            }
          } else {
            // SINGLE NOTE: Set ID on parent element
            svgElement.setAttribute('data-note-id', fingeringNoteId);
            svgElement.style.pointerEvents = 'auto';
            svgElement.style.cursor = 'pointer';
          }
          
          injected++;
        }
      } catch (error) {
        // Ignore errors
      }
    }
    
    trackDimensionChange('after_inject_note_ids_layout_queries');
    
    if (process.env.NODE_ENV === 'development') {
      debug('Re-injected data-note-id attributes', { injected, total: graphicalNoteMap.size });
    }
  }, []);

  // Render with zoom support
  const renderWithZoom = useCallback(() => {
    if (!osmdRef.current || !isReady) return;
    
    const renderStart = performance.now();
    
    try {
      // Track if this is a zoom-triggered render
      const previousZoom = osmdRef.current.zoom;
      const isZoomChange = Math.abs(previousZoom - zoomLevel) > 0.01;
      
      // Optimize: Skip re-render if zoom hasn't actually changed
      if (!isZoomChange) return;
      
      // Save scroll position before render
      const scrollContainer = containerRef.current?.parentElement;
      const scrollPercent = scrollContainer 
        ? scrollContainer.scrollTop / scrollContainer.scrollHeight
        : 0;
      
      // Set zoom property on OSMD instance
      osmdRef.current.zoom = zoomLevel;
      
      // ISSUE #10 DEBUG: Log before/after for zoom renders too
      if (process.env.NODE_ENV === 'development') {
        dlog('🐛 [ISSUE #10 DEBUG] Zoom change triggering re-render:', {
          previousZoom,
          newZoom: zoomLevel
        });
      }
      
      // Call render without parameters
      osmdRef.current.render();
      
      // Restore scroll position proportionally
      requestAnimationFrame(() => {
        if (scrollContainer && scrollPercent > 0) {
          scrollContainer.scrollTop = scrollPercent * scrollContainer.scrollHeight;
        }
        
        // Build cache after render completes - with ResizeObserver pause
        withResizeObserverPaused(() => {
          buildMeasureCache();
          
          // Re-inject note attributes after render
          injectNoteIdAttributes();
          drawPracticeRangeBorder();
        });
      });
      
      // Performance monitoring
      const renderTime = performance.now() - renderStart;
      logRenderLatency(renderTime);
      
      if (renderTime > 100) {
        perfLogger.warn('Slow zoom render', { 
          renderTime, 
          zoomLevel,
          measureCount: osmdRef.current?.GraphicSheet?.MeasureList?.length 
        });
      }
    } catch (error) {
      perfLogger.error('Zoom render failed:', error);
    }
  }, [zoomLevel, isReady, injectNoteIdAttributes]);

  // Debounced zoom handler (stabilized with useMemo to prevent recreation)
  const debouncedZoomRender = useMemo(
    () => debounce(renderWithZoom, 16),
    [renderWithZoom]
  );

  // Create OSMD instance (once on mount)
  const createOSMDInstance = useCallback(async () => {
    // Remove verbose initialization logging
    
    if (!containerRef.current || osmdRef.current) return;


    try {
      setError(null);
      
      // Performance tracking and dimension validation
      const rect = containerRef.current.getBoundingClientRect();
      if (process.env.NODE_ENV === 'development') {
        performanceRef.current.initStart = performance.now();
      }

      // Get theme-specific options
      const themeOptions = getOSMDThemeOptions();
      
      // OSMD configuration optimized for performance
      const options: IOSMDOptions = {
        // autoResize disabled: We use manual ResizeObserver (setupResizeObserver) 
        // to control timing and ensure cursor updates after render completion.
        // See lines 321-394 for implementation. Re-test if upgrading OSMD.
        autoResize: false,
        backend: 'svg', // Required for SVG manipulation
        drawTitle: true,
        drawComposer: true,
        // drawingParameters defined below with theme overrides
        pageFormat: 'Endless', // Better for scrolling interfaces
        
        // Performance optimizations
        drawSlurs: true,
        // ISSUE #10 FIX: Disable native OSMD fingering to prevent dual rendering conflict
        // Custom FingeringLayer handles all fingering rendering and interaction
        drawFingerings: false,
        drawMeasureNumbers: false, // Reduce visual clutter for MVP
        drawPartNames: false,
        
        // Additional rendering options that might affect cursor
        renderSingleHorizontalStaffline: false,
        
        // No cursor options - use OSMD defaults
        
        // Explicit fingering positioning to avoid 'auto' mode feedback loops
        drawingParameters: {
          fingeringPosition: 'Above',
          fingeringInsideStafflines: false,
          ...themeOptions.drawingParameters
        },
        
        // Merge with theme options (theme options take precedence)
        ...themeOptions
      };

      osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, options);
      
      // ISSUE #10 DEBUG LOG 1: Log OSMD Version
      if (process.env.NODE_ENV === 'development') {
        dlog('🐛 [ISSUE #10 DEBUG] OSMD Version:', (OpenSheetMusicDisplay as any).VERSION || 'Version not available');
        debug('[ISSUE #10] OSMD instance created', {
          version: (OpenSheetMusicDisplay as any).VERSION,
          drawFingerings: options.drawFingerings,
          fingeringPosition: options.drawingParameters?.fingeringPosition
        });
      }
      
      // Signal that OSMD instance is ready
      setOsmdReady(true);
      
      // OSMD instance created - log consolidated later
    } catch (err) {
      const error = err as Error;
      setError(error);
      perfLogger.error(' OSMD instance creation failed:', error);
    }
  }, []);

  // Build optimized note mapping for fast MIDI lookup (Code review:'s strategy)
  const buildNoteMapping = useCallback(() => {
    if (!osmdRef.current?.GraphicSheet) {
      perfLogger.warn(' OSMD GraphicSheet not available for note mapping');
      return;
    }
    
    // CRITICAL FIX: Prevent rebuilding note mapping multiple times
    if (noteMappingBuiltRef.current) {
      debug('Note mapping already built, skipping rebuild');
      return;
    }
    
    if (process.env.NODE_ENV === 'development') {
      debug('Building note mapping', { timestamp: new Date().toISOString() });
    }
    noteMappingBuiltRef.current = false;

    const noteMapping = new Map<number, NoteMapping>();
    const midiToTimestamp = new Map<number, number[]>();
    const graphicalNoteMap = new Map<string, any>();

    try {
      let mappingCount = 0;
      
      // Track collisions for development debugging
      const collisions: Array<{
        noteId: string;
        indices: string;
        timestamp: number;
        midiNote: number;
      }> = [];
      
      // OSMD 1.9.0 uses GraphicSheet.MeasureList (capital G)
      const measureList = osmdRef.current.GraphicSheet.MeasureList;
      
      if (process.env.NODE_ENV === 'development') {
        debug('Note mapping build starting', {
          timestamp: new Date().toISOString(),
          measureCount: measureList?.length || 0
        });
        
        // Debug MeasureList orientation
        if (measureList && measureList.length > 0) {
          debug('MeasureList structure analysis:', {
            firstDimLength: measureList.length,
            secondDimLength: measureList[0]?.length || 0,
            isLikelyTransposed: measureList.length > 4,
            sampleStructure: {
              'measureList[0][0]': measureList[0]?.[0] ? 'exists' : 'undefined',
              'measureList[0][1]': measureList[0]?.[1] ? 'exists' : 'undefined',
              'measureList[1]?.[0]': measureList[1]?.[0] ? 'exists' : 'undefined'
            }
          });
        }
      }
      
      if (!measureList || !Array.isArray(measureList) || measureList.length === 0) {
        perfLogger.warn(' No measures available for note mapping');
        return;
      }
      
      // Detect MeasureList orientation (ADR-007)
      // Piano scores typically have 2 staves, if first dimension > 4, it's likely [measure][staff]
      const firstDimLength = measureList.length;
      const secondDimLength = measureList[0]?.length || 0;
      const isTransposedOrientation = firstDimLength > 4 && secondDimLength <= 4;
      
      if (process.env.NODE_ENV === 'development') {
        debug('MeasureList orientation detection:', {
          firstDimLength,
          secondDimLength,
          isTransposedOrientation,
          interpretation: isTransposedOrientation ? '[measure][staff]' : '[staff][measure]'
        });
      }
      
      // Iterate based on detected orientation
      if (isTransposedOrientation) {
        // MeasureList is [measure][staff] - need to iterate differently
        const numMeasures = firstDimLength;
        const numStaves = secondDimLength;
        
        for (let staffIndex = 0; staffIndex < numStaves; staffIndex++) {
          for (let measureIndex = 0; measureIndex < numMeasures; measureIndex++) {
            const measure = measureList[measureIndex]?.[staffIndex];
            if (!measure || !measure.staffEntries) continue;
            
            // Process each staff entry in the measure
            measure.staffEntries.forEach((staffEntry: any, entryIndex: number) => {
            // Add more defensive checks for different possible structures
            const sourceStaffEntry = staffEntry.sourceStaffEntry || staffEntry.SourceStaffEntry;
            if (!sourceStaffEntry) {
              return;
            }
            
            const absoluteTimestamp = sourceStaffEntry.absoluteTimestamp || sourceStaffEntry.AbsoluteTimestamp;
            if (!absoluteTimestamp) {
              return;
            }
            
            const timestamp = absoluteTimestamp.realValue || absoluteTimestamp.RealValue || 0;
            const svgElements: SVGGElement[] = [];
            const midiNotes: number[] = [];
            
            // Track chord detection
            const notesAtThisTimestamp: number[] = [];
            
            // Log first few timestamps for development debugging
            if (process.env.NODE_ENV === 'development' && mappingCount < 10) {
              debug('Processing timestamp', { timestamp, measureIndex, mappingCount });
            }

            // Process voice entries - check both lowercase and uppercase
            const graphicalVoiceEntries = staffEntry.graphicalVoiceEntries || staffEntry.GraphicalVoiceEntries;
            if (graphicalVoiceEntries && Array.isArray(graphicalVoiceEntries)) {
              // Debug chord detection - ALWAYS CHECK
              const isChord = graphicalVoiceEntries.length > 1 || (graphicalVoiceEntries[0]?.notes?.length > 1);
              
              
              graphicalVoiceEntries.forEach((voiceEntry: any, voiceIndex: number) => {
                const notes = voiceEntry.notes || voiceEntry.Notes;
                if (notes && Array.isArray(notes)) {
                  
                  notes.forEach((note: any, noteIndex: number) => {
                    // Debug note processing in development
                    if (process.env.NODE_ENV === 'development' && mappingCount < 10) {
                      debug('Processing note', {
                        noteIndex,
                        totalNotes: notes.length,
                        hasGetSVGGElement: typeof note.getSVGGElement === 'function',
                        hasGetSVGElement: typeof note.getSVGElement === 'function',
                        hasSvgElement: !!(note.svgElement || note.SVGElement)
                      });
                    }
                    
                    // Check for SVG element getter - OSMD 1.9.0 might use different method names
                    let svgElement = null;
                    
                    const isChord = notes.length > 1;
                    
                    
                    const debugInfo = {
                      noteIndex,
                      totalNotes: notes.length,
                      isChord,
                      isFirstNote: noteIndex === 0,
                      isLastNote: noteIndex === notes.length - 1,
                      hasSvgElement: false
                    };
                    
                    if (typeof note.getSVGGElement === 'function') {
                      try {
                        svgElement = note.getSVGGElement();
                      } catch (err) {
                        // Silent catch
                      }
                    } else if (typeof note.getSVGElement === 'function') {
                      try {
                        svgElement = note.getSVGElement();
                      } catch (err) {
                        // Silent catch
                      }
                    } else if (note.svgElement || note.SVGElement) {
                      svgElement = note.svgElement || note.SVGElement;
                    }
                    
                    // Only log in development with debug flag
                    if (process.env.NODE_ENV === 'development' && process.env.DEBUG_CHORDS) {
                      debugInfo.hasSvgElement = !!svgElement;
                      if (isChord) {
                        debug(`🎵 CHORD NOTE ${noteIndex + 1}/${notes.length}:`, {
                          ...debugInfo,
                          svgElementId: svgElement?.id || 'NO_ELEMENT'
                        });
                      }
                    }
                    
                    if (!svgElement) {
                      return; // Skip this note - no SVG element
                    }
                    
                    if (svgElement) {
                      // Extract MIDI note number early to create note ID
                      // REVERTED: Using sourceNote approach that was working
                      const sourceNote = note.sourceNote || note.SourceNote;
                      const halfTone = sourceNote?.halfTone ?? sourceNote?.HalfTone;
                      
                      // Extract actual staff number from OSMD data (fixes cross-staff grouping)
                      let actualStaffIndex = staffIndex; // Default to loop index as fallback
                      
                      // Try various OSMD properties to find actual staff number
                      if (sourceNote?.StaffNumber !== undefined) {
                        actualStaffIndex = sourceNote.StaffNumber - 1; // MusicXML uses 1-based indexing
                      } else if (sourceNote?.staff !== undefined) {
                        actualStaffIndex = sourceNote.staff;
                      } else if (note.ParentStaffEntry?.ParentStaff?.Id !== undefined) {
                        actualStaffIndex = note.ParentStaffEntry.ParentStaff.Id;
                      } else if (note.parentStaffEntry?.parentStaff?.id !== undefined) {
                        actualStaffIndex = note.parentStaffEntry.parentStaff.id;
                      }
                      
                      // Debug logging for first note to verify staff detection
                      if (process.env.NODE_ENV === 'development' && noteIndex === 0 && measureIndex === 0) {
                        debug('🎼 Staff number detection:', {
                          loopStaffIndex: staffIndex,
                          actualStaffIndex,
                          sourceNoteStaffNumber: sourceNote?.StaffNumber,
                          sourceNoteStaff: sourceNote?.staff,
                          parentStaffId: note.ParentStaffEntry?.ParentStaff?.Id || note.parentStaffEntry?.parentStaff?.id
                        });
                      }
                      
                      if (halfTone === null || typeof halfTone !== 'number') {
                        return; // Skip this note - invalid halfTone
                      }
                        
                      if (halfTone !== null && typeof halfTone === 'number') {
                          const midiNote = halfTone + 12; // OSMD uses C4=48, MIDI uses C4=60
                          
                          // Create fingering note ID for data attribute with timestamp to prevent collisions
                          const timestampStr = timestamp.toFixed(2).replace('.', '_');
                          const fingeringNoteId = `m${measureIndex}-s${actualStaffIndex}-v${voiceIndex}-n${noteIndex}-ts${timestampStr}-midi${midiNote}`;
                          
                          
                          // Visual debugging for chord notes - only with explicit debug flag
                          if (process.env.NODE_ENV === 'development' && process.env.DEBUG_CHORDS_VISUAL && isChord) {
                            // Color code based on position in chord
                            const colors = ['#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#ffff00'];
                            const debugColor = colors[noteIndex % colors.length];
                            
                            svgElement.setAttribute('fill', debugColor);
                            svgElement.setAttribute('stroke', debugColor);
                            svgElement.setAttribute('data-debug-color', debugColor);
                            svgElement.setAttribute('data-debug-note-index', noteIndex.toString());
                          }
                          
                          // Check if this is a chord (multiple notes at same timestamp)
                          const noteheadElements = svgElement.querySelectorAll('g.vf-notehead');
                          
                          if (noteheadElements.length > 1) {
                            // CHORD: Inject ID on individual notehead
                            
                            // Sort noteheads by Y position (top to bottom = high to low pitch)
                            const sortedNoteheads = Array.from(noteheadElements).sort((a, b) => {
                              const aRect = a.getBoundingClientRect();
                              const bRect = b.getBoundingClientRect();
                              return aRect.top - bRect.top;
                            });
                            
                            // Reverse to match MIDI order (index 0 = lowest pitch = bottom notehead)
                            sortedNoteheads.reverse();
                            
                            if (sortedNoteheads[noteIndex]) {
                              sortedNoteheads[noteIndex].setAttribute('data-note-id', fingeringNoteId);
                            } else {
                              // Fallback to parent if notehead not found
                              svgElement.setAttribute('data-note-id', fingeringNoteId);
                            }
                          } else {
                            // SINGLE NOTE: Set ID on parent element as before
                            svgElement.setAttribute('data-note-id', fingeringNoteId);
                          }
                          
                          
                          // MIDI calculation validation (development debugging)
                          if (process.env.NODE_ENV === 'development' && mappingCount < 20) {
                            const midiNoteOld = halfTone + 60; // Legacy calculation
                            debug('MIDI calculation analysis', {
                              halfTone,
                              midiNoteOld,
                              midiNoteNew: midiNote,
                              timestamp,
                              indices: `m${measureIndex}-s${staffIndex}-v${voiceIndex}-n${noteIndex}`,
                              warning: midiNoteOld > 100 ? 'MIDI value seems too high for piano range' : null
                            });
                          }
                          notesAtThisTimestamp.push(noteIndex);
                          
                          // Check for ID collisions BEFORE adding to map
                          if (graphicalNoteMap.has(fingeringNoteId)) {
                            if (process.env.NODE_ENV === 'development') {
                              perfLogger.warn('Fingering ID collision detected', {
                                collidingId: fingeringNoteId,
                                notePosition: `${noteIndex + 1}/${notes.length}`,
                                timestamp,
                                indices: `m${measureIndex}-s${staffIndex}-v${voiceIndex}-n${noteIndex}`
                              });
                            }
                            
                            collisions.push({
                              noteId: fingeringNoteId,
                              indices: `m${measureIndex}-s${staffIndex}-v${voiceIndex}-n${noteIndex}`,
                              timestamp,
                              midiNote
                            });
                          }
                          
                          // ALWAYS add to graphicalNoteMap for fingering click detection
                          if (process.env.NODE_ENV === 'development' && mappingCount < 10) {
                            debug('Setting graphicalNoteMap', { 
                              fingeringNoteId,
                              halfTone,
                              midiNote,
                              hasSourceNote: !!sourceNote
                            });
                          }
                          
                          // Preserve tie information from sourceNote
                          if (sourceNote?.NoteTie) {
                            (note as any).NoteTie = sourceNote.NoteTie;
                          }
                          
                          graphicalNoteMap.set(fingeringNoteId, note);
                          
                          // Only process MIDI-specific logic if in valid range
                          if (midiNote >= 0 && midiNote <= 127) { // Valid MIDI range
                            midiNotes.push(midiNote);
                            
                            // Build reverse lookup map
                            if (!midiToTimestamp.has(midiNote)) {
                              midiToTimestamp.set(midiNote, []);
                            }
                            midiToTimestamp.get(midiNote)!.push(timestamp);
                            
                            // Debug chord note IDs in development
                            if (process.env.NODE_ENV === 'development' && notes.length > 1) {
                              debug('Chord note processed', {
                                fingeringNoteId,
                                notePosition: `${noteIndex}/${notes.length}`,
                                midiNote,
                                halfTone,
                                targetIndex: noteIndex
                              });
                            }
                          }
                          
                          // Always push the svgElement to the array
                          svgElements.push(svgElement);
                      }
                    }
                  });
                }
              });
            }
            
            // Comprehensive chord analysis (development debugging)
            if (notesAtThisTimestamp.length > 1) {
              const svgElementsFound = svgElements.filter(Boolean).length;
              const uniqueSvgElements = new Set(svgElements.filter(Boolean)).size;
              
              
              if (process.env.NODE_ENV === 'development') {
                debug('Chord analysis summary', {
                  timestamp,
                  totalNotes: notesAtThisTimestamp.length,
                  svgElementsFound,
                  uniqueSvgElements,
                  hasSharedElements: svgElementsFound !== uniqueSvgElements
                });
              }
              
              // Check if multiple notes share the same SVG element
              const svgToNotes = new Map();
              notesAtThisTimestamp.forEach((noteData, idx) => {
                const svg = svgElements[idx];
                if (svg) {
                  const key = svg.id || svg;
                  if (!svgToNotes.has(key)) {
                    svgToNotes.set(key, []);
                  }
                  svgToNotes.get(key).push({
                    noteIndex: idx,
                    noteId: noteData
                  });
                }
              });
              
              // Report shared SVG elements
              svgToNotes.forEach((notes, svgKey) => {
                if (notes.length > 1) {
                  perfLogger.warn('Shared SVG element in chord', {
                    svgKey: typeof svgKey === 'string' ? svgKey : 'object',
                    sharedByNotes: notes.length,
                    warning: 'Only last note data-note-id will persist'
                  });
                  
                }
              });
            }

            // Store mapping if we found SVG elements
            if (svgElements.length > 0) {
              noteMapping.set(timestamp, {
                timestamp,
                svgElements,
                noteId: `note-${timestamp}`,
                midiNote: midiNotes[0], // Primary MIDI note for this timestamp
              });
              mappingCount++;
            }
          });
          }
        }
      } else {
        // Normal orientation: [staff][measure]
        measureList.forEach((staffMeasures: any[], staffIndex: number) => {
          if (!Array.isArray(staffMeasures)) return;
          
          staffMeasures.forEach((measure: any, measureIndex: number) => {
            if (!measure || !measure.staffEntries) return;
            
            // Process each staff entry in the measure
            measure.staffEntries.forEach((staffEntry: any, entryIndex: number) => {
              // Add more defensive checks for different possible structures
              const sourceStaffEntry = staffEntry.sourceStaffEntry || staffEntry.SourceStaffEntry;
              if (!sourceStaffEntry) {
                return;
              }
              
              const absoluteTimestamp = sourceStaffEntry.absoluteTimestamp || sourceStaffEntry.AbsoluteTimestamp;
              if (!absoluteTimestamp) {
                return;
              }
              
              const timestamp = absoluteTimestamp.realValue || absoluteTimestamp.RealValue || 0;
              const svgElements: SVGGElement[] = [];
              const midiNotes: number[] = [];
              
              // Track chord detection
              const notesAtThisTimestamp: number[] = [];
              
              // Log first few timestamps for development debugging
              if (process.env.NODE_ENV === 'development' && mappingCount < 10) {
                debug('Processing timestamp', { timestamp, measureIndex, mappingCount });
              }

              // Process voice entries - check both lowercase and uppercase
              const graphicalVoiceEntries = staffEntry.graphicalVoiceEntries || staffEntry.GraphicalVoiceEntries;
              if (graphicalVoiceEntries && Array.isArray(graphicalVoiceEntries)) {
                // Debug chord detection - ALWAYS CHECK
                const isChord = graphicalVoiceEntries.length > 1 || (graphicalVoiceEntries[0]?.notes?.length > 1);
                
                
                graphicalVoiceEntries.forEach((voiceEntry: any, voiceIndex: number) => {
                  const notes = voiceEntry.notes || voiceEntry.Notes;
                  if (notes && Array.isArray(notes)) {
                    
                    notes.forEach((note: any, noteIndex: number) => {
                      // Debug note processing in development
                      if (process.env.NODE_ENV === 'development' && mappingCount < 10) {
                        debug('Processing note', {
                          noteIndex,
                          totalNotes: notes.length,
                          hasGetSVGGElement: typeof note.getSVGGElement === 'function',
                          hasGetSVGElement: typeof note.getSVGElement === 'function',
                          hasSvgElement: !!(note.svgElement || note.SVGElement)
                        });
                      }
                      
                      // Check for SVG element getter - OSMD 1.9.0 might use different method names
                      let svgElement = null;
                      
                      const isChord = notes.length > 1;
                      
                      
                      const debugInfo = {
                        noteIndex,
                        totalNotes: notes.length,
                        isChord,
                        isFirstNote: noteIndex === 0,
                        isLastNote: noteIndex === notes.length - 1,
                        hasSvgElement: false
                      };
                      
                      if (typeof note.getSVGGElement === 'function') {
                        try {
                          svgElement = note.getSVGGElement();
                        } catch (err) {
                          // Silent catch
                        }
                      } else if (typeof note.getSVGElement === 'function') {
                        try {
                          svgElement = note.getSVGElement();
                        } catch (err) {
                          // Silent catch
                        }
                      } else if (note.svgElement || note.SVGElement) {
                        svgElement = note.svgElement || note.SVGElement;
                      }
                      
                      // Only log in development with debug flag
                      if (process.env.NODE_ENV === 'development' && process.env.DEBUG_CHORDS) {
                        debugInfo.hasSvgElement = !!svgElement;
                        if (isChord) {
                          debug(`🎵 CHORD NOTE ${noteIndex + 1}/${notes.length}:`, {
                            ...debugInfo,
                            svgElementId: svgElement?.id || 'NO_ELEMENT'
                          });
                        }
                      }
                      
                      if (!svgElement) {
                        return; // Skip this note - no SVG element
                      }
                      
                      if (svgElement) {
                        // Extract MIDI note number early to create note ID
                        // REVERTED: Using sourceNote approach that was working
                        const sourceNote = note.sourceNote || note.SourceNote;
                        const halfTone = sourceNote?.halfTone ?? sourceNote?.HalfTone;
                        
                        // Extract actual staff number from OSMD data (fixes cross-staff grouping)
                        let actualStaffIndex = staffIndex; // Default to loop index as fallback
                        
                        // Try various OSMD properties to find actual staff number
                        if (sourceNote?.StaffNumber !== undefined) {
                          actualStaffIndex = sourceNote.StaffNumber - 1; // MusicXML uses 1-based indexing
                        } else if (sourceNote?.staff !== undefined) {
                          actualStaffIndex = sourceNote.staff;
                        } else if (note.ParentStaffEntry?.ParentStaff?.Id !== undefined) {
                          actualStaffIndex = note.ParentStaffEntry.ParentStaff.Id;
                        } else if (note.parentStaffEntry?.parentStaff?.id !== undefined) {
                          actualStaffIndex = note.parentStaffEntry.parentStaff.id;
                        }
                        
                        // Debug logging for first note to verify staff detection
                        if (process.env.NODE_ENV === 'development' && noteIndex === 0 && measureIndex === 0) {
                          debug('🎼 Staff number detection:', {
                            loopStaffIndex: staffIndex,
                            actualStaffIndex,
                            sourceNoteStaffNumber: sourceNote?.StaffNumber,
                            sourceNoteStaff: sourceNote?.staff,
                            parentStaffId: note.ParentStaffEntry?.ParentStaff?.Id || note.parentStaffEntry?.parentStaff?.id
                          });
                        }
                        
                        if (halfTone === null || typeof halfTone !== 'number') {
                          return; // Skip this note - invalid halfTone
                        }
                          
                        if (halfTone !== null && typeof halfTone === 'number') {
                            const midiNote = halfTone + 12; // OSMD uses C4=48, MIDI uses C4=60
                            
                            // Create fingering note ID for data attribute with timestamp to prevent collisions
                            const timestampStr = timestamp.toFixed(2).replace('.', '_');
                            const fingeringNoteId = `m${measureIndex}-s${actualStaffIndex}-v${voiceIndex}-n${noteIndex}-ts${timestampStr}-midi${midiNote}`;
                            
                            
                            // Visual debugging for chord notes - only with explicit debug flag
                            if (process.env.NODE_ENV === 'development' && process.env.DEBUG_CHORDS_VISUAL && isChord) {
                              // Color code based on position in chord
                              const colors = ['#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#ffff00'];
                              const debugColor = colors[noteIndex % colors.length];
                              
                              svgElement.setAttribute('fill', debugColor);
                              svgElement.setAttribute('stroke', debugColor);
                              svgElement.setAttribute('data-debug-color', debugColor);
                              svgElement.setAttribute('data-debug-note-index', noteIndex.toString());
                            }
                            
                            // Check if this is a chord (multiple notes at same timestamp)
                            const noteheadElements = svgElement.querySelectorAll('g.vf-notehead');
                            
                            if (noteheadElements.length === 0) {
                              // Inject fingering note ID on the parent SVG element
                              svgElement.setAttribute('data-note-id', fingeringNoteId);
                              // Log data attribute directly
                              if (process.env.NODE_ENV === 'development' && mappingCount < 5) {
                                debug(`NOTE: data-note-id="${fingeringNoteId}" added to note`);
                              }
                            } else {
                              // Multiple noteheads found - handle chords
                              
                              // We'll set the data attribute on the parent element as well
                              svgElement.setAttribute('data-note-id', fingeringNoteId);
                              
                              // SIMPLIFICATION: Also set on all noteheads for redundancy
                              noteheadElements.forEach((notehead: Element, i: number) => {
                                notehead.setAttribute('data-note-id', fingeringNoteId);
                              });
                            }
                            
                            // Track for mapping
                            svgElements.push(svgElement);
                            midiNotes.push(midiNote);
                            
                            const midiNoteOld = halfTone + 24; // Old incorrect calculation
                            
                            if (mappingCount < 10 && halfTone > 88) {
                              debug('MIDI calculation analysis', {
                                halfTone,
                                midiNoteOld,
                                midiNoteNew: midiNote,
                                timestamp,
                                indices: `m${measureIndex}-s${staffIndex}-v${voiceIndex}-n${noteIndex}`,
                                warning: midiNoteOld > 100 ? 'MIDI value seems too high for piano range' : null
                              });
                            }
                            notesAtThisTimestamp.push(noteIndex);
                            
                            // Track collisions
                            if (graphicalNoteMap.has(fingeringNoteId)) {
                              if (process.env.NODE_ENV === 'development') {
                                perfLogger.warn('Fingering ID collision detected', {
                                  collidingId: fingeringNoteId,
                                  notePosition: `${noteIndex + 1}/${notes.length}`,
                                  timestamp,
                                  indices: `m${measureIndex}-s${staffIndex}-v${voiceIndex}-n${noteIndex}`
                                });
                              }
                              
                              collisions.push({
                                noteId: fingeringNoteId,
                                indices: `m${measureIndex}-s${staffIndex}-v${voiceIndex}-n${noteIndex}`,
                                timestamp,
                                midiNote
                              });
                            }
                            
                            // Store graphical note object for position calculations
                            graphicalNoteMap.set(fingeringNoteId, note);
                            
                            // Track MIDI to timestamp mapping
                            if (!midiToTimestamp.has(midiNote)) {
                              midiToTimestamp.set(midiNote, []);
                            }
                            midiToTimestamp.get(midiNote)!.push(timestamp);
                        }
                      }
                    });
                  }
                });
              }
              
              // For debugging chord detection, check SVG reuse only in dev
              if (process.env.NODE_ENV === 'development' && svgElements.length > 1) {
                const svgToNotes = new Map<string | object, number[]>();
                svgElements.forEach((svg, idx) => {
                  const key = typeof svg === 'object' ? svg : String(svg);
                  if (!svgToNotes.has(key)) {
                    svgToNotes.set(key, []);
                  }
                  svgToNotes.get(key)!.push(idx);
                });
                
                // Report shared SVG elements
                svgToNotes.forEach((notes, svgKey) => {
                  if (notes.length > 1) {
                    perfLogger.warn('Shared SVG element in chord', {
                      svgKey: typeof svgKey === 'string' ? svgKey : 'object',
                      sharedByNotes: notes.length,
                      warning: 'Only last note data-note-id will persist'
                    });
                    
                  }
                });
              }

              // Store mapping if we found SVG elements
              if (svgElements.length > 0) {
                noteMapping.set(timestamp, {
                  timestamp,
                  svgElements,
                  noteId: `note-${timestamp}`,
                  midiNote: midiNotes[0], // Primary MIDI note for this timestamp
                });
                mappingCount++;
              }
            });
          });
        });
      }

      noteMappingRef.current = {
        noteMapping,
        midiToTimestamp,
        graphicalNoteMap
      };
      
      // Mark as built to prevent rebuilds
      noteMappingBuiltRef.current = true;
      
      
      if (process.env.NODE_ENV === 'development') {
        debug('buildNoteMapping completed successfully');
      }
      debug('Built note mapping', {
        positions: mappingCount,
        uniqueMidiNotes: midiToTimestamp.size,
        fingeringNotes: graphicalNoteMap.size,
        mappingDifference: mappingCount - graphicalNoteMap.size
      });

      // Post-injection orphan detection
      if (osmdInstance && containerRef.current) {
        const container = containerRef.current;
        const allNoteheads = container.querySelectorAll('.vf-notehead:not([data-note-id])');
        if (allNoteheads.length > 0) {
          // Orphaned noteheads detected: ${allNoteheads.length}
        }
      }
      
      if (process.env.NODE_ENV === 'development') {
        debug('Chord SVG element analysis completed', {
          totalPositions: mappingCount,
          uniqueMidiNotes: midiToTimestamp.size,
          fingeringNotes: graphicalNoteMap.size,
          potentialIssues: mappingCount - graphicalNoteMap.size,
          visualDebugInstructions: 'Check colored chord notes in sheet music for shared SVG elements'
        });
      }
      
      // Check for duplicate noteIds (should not happen if working correctly)
      const noteIds = Array.from(graphicalNoteMap.keys());
      const uniqueIds = new Set(noteIds);
      if (noteIds.length !== uniqueIds.size) {
        perfLogger.warn('Duplicate note IDs detected', {
          totalIds: noteIds.length,
          uniqueIds: uniqueIds.size,
          duplicates: noteIds.length - uniqueIds.size
        });
      } else if (process.env.NODE_ENV === 'development') {
        debug('All note IDs are unique', { totalIds: noteIds.length });
      }
      
      // Analyze timestamps with multiple notes for potential collisions
      if (process.env.NODE_ENV === 'development') {
        const timestampCounts = new Map<number, number>();
        for (const [noteId] of graphicalNoteMap) {
          const match = noteId.match(/^t(.+)-m/);
          if (match) {
            const ts = parseFloat(match[1]);
            timestampCounts.set(ts, (timestampCounts.get(ts) || 0) + 1);
          }
        }
        const multiNoteTimestamps = Array.from(timestampCounts.entries())
          .filter(([_, count]) => count > 1)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        
        if (multiNoteTimestamps.length > 0) {
          debug('Timestamps with multiple notes detected', {
            collisionProneTimestamps: multiNoteTimestamps.map(([ts, count]) => ({ timestamp: ts, noteCount: count }))
          });
        }
      }
      
      // Report ID collisions
      if (collisions.length > 0) {
        perfLogger.warn('Note ID collisions detected', {
          totalCollisions: collisions.length,
          firstCollisions: collisions.slice(0, 10).map(c => ({
            noteId: c.noteId,
            indices: c.indices,
            timestamp: c.timestamp,
            midiNote: c.midiNote
          })),
          suggestedFix: 'Use createFullFingeringId() instead of timestamp-based IDs'
        });
      } else if (process.env.NODE_ENV === 'development') {
        debug('No ID collisions detected - all noteIds are unique');
      }
      
    } catch (error) {
      perfLogger.error(' Failed to build note mapping:', error instanceof Error ? error : new Error(String(error)));
      if (error instanceof Error) {
        perfLogger.error('Error details:', error);
      }
    }
  }, []);

  // Cache for measure bounding boxes - built after render
  const measureCacheRef = useRef<Map<number, Array<{
    systemIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>>>(new Map());
  const cacheBuiltRef = useRef(false);

  // Build measure cache after OSMD render completes
  const buildMeasureCache = useCallback(() => {
    console.log('🎹 [RED-BOX-DEBUG] buildMeasureCache called');
    
    const osmdInstance = osmdRef.current;
    console.log('🎹 [RED-BOX-DEBUG] OSMD Instance check:', { 
      hasInstance: !!osmdInstance, 
      hasGraphic: !!osmdInstance?.graphic 
    });
    
    if (!osmdInstance || !osmdInstance.graphic) {
      console.log('🎹 [RED-BOX-DEBUG] EARLY EXIT: No OSMD instance or graphic');
      return;
    }

    const cache = new Map<number, Array<{ systemIndex: number; x: number; y: number; width: number; height: number }>>();
    const graphic = osmdInstance.graphic;
    
    console.log('🎹 [RED-BOX-DEBUG] OSMD Graphic properties available:', {
      GraphicalMeasureParents: !!graphic.GraphicalMeasureParents,
      VerticalGraphicalStaffEntryContainers: !!graphic.VerticalGraphicalStaffEntryContainers,
      MeasureList: !!graphic.MeasureList,
      MeasureListLength: graphic.MeasureList?.length
    });

    // Access GraphicalMeasureParent objects (spans all staves)
    // Try different property names as OSMD API may vary
    const graphicalMeasures = 
      graphic.GraphicalMeasureParents ||
      graphic.VerticalGraphicalStaffEntryContainers ||
      graphic.MeasureList;

    console.log('🎹 [RED-BOX-DEBUG] GraphicalMeasures selection:', {
      selected: graphicalMeasures ? 'found' : 'none',
      type: graphic.GraphicalMeasureParents ? 'GraphicalMeasureParents' : 
            graphic.VerticalGraphicalStaffEntryContainers ? 'VerticalGraphicalStaffEntryContainers' :
            graphic.MeasureList ? 'MeasureList' : 'unknown'
    });

    if (!graphicalMeasures) {
      console.log('🎹 [RED-BOX-DEBUG] EARLY EXIT: No graphicalMeasures found');
      return;
    }

    // If we have MeasureList, we need to iterate differently
    if (graphic.MeasureList && !graphic.GraphicalMeasureParents) {
      console.log('🎹 [RED-BOX-DEBUG] Processing MeasureList');
      
      // Fallback: Build from MeasureList
      const measureList = graphic.MeasureList;
      const isStaffFirst = measureList.length <= 4; // Assume max 4 staves
      
      console.log('🎹 [RED-BOX-DEBUG] MeasureList analysis:', {
        measureListLength: measureList.length,
        isStaffFirst: isStaffFirst,
        format: isStaffFirst ? '[staff][measure]' : '[measure][staff]'
      });
      
      if (isStaffFirst) {
        console.log('🎹 [RED-BOX-DEBUG] Processing [staff][measure] format');
        let processedMeasures = 0;
        
        // [staff][measure] format
        measureList.forEach((staffMeasures: any[], staffIndex: number) => {
          console.log(`🎹 [RED-BOX-DEBUG] Processing staff ${staffIndex}, measures count: ${staffMeasures?.length}`);
          
          staffMeasures.forEach((measure: any, measureIndex: number) => {
            if (!measure || !measure.parentSourceMeasure) {
              console.log(`🎹 [RED-BOX-DEBUG] Skipping invalid measure at staff ${staffIndex}, measure ${measureIndex}`);
              return;
            }
            
            const measureNumber = measure.parentSourceMeasure.MeasureNumber;
            const systemId = measure.parentMusicSystem?.Id ?? 0;
            const bbox = measure.PositionAndShape;
            
            console.log(`🎹 [RED-BOX-DEBUG] Processing measure ${measureNumber}:`, {
              hasBbox: !!bbox,
              systemId: systemId,
              AbsolutePosition: bbox?.AbsolutePosition,
              absolutePosition: bbox?.absolutePosition,
              Size: bbox?.Size,
              size: bbox?.size
            });
            
            if (!bbox) {
              console.log(`🎹 [RED-BOX-DEBUG] No bbox for measure ${measureNumber}, skipping`);
              return;
            }
            
            if (!cache.has(measureNumber)) {
              cache.set(measureNumber, []);
            }
            
            const coords = {
              systemIndex: systemId,
              x: bbox.AbsolutePosition?.x ?? bbox.absolutePosition?.x ?? 0,
              y: bbox.AbsolutePosition?.y ?? bbox.absolutePosition?.y ?? 0,
              width: bbox.Size?.width ?? bbox.size?.width ?? 0,
              height: bbox.Size?.height ?? bbox.size?.height ?? 0
            };
            
            console.log(`🎹 [RED-BOX-DEBUG] Adding coordinates for measure ${measureNumber}:`, coords);
            cache.get(measureNumber)!.push(coords);
            processedMeasures++;
          });
        });
        
        console.log(`🎹 [RED-BOX-DEBUG] Processed ${processedMeasures} measures in [staff][measure] format`);
      } else {
        // [measure][staff] format - transpose first
        const staffCount = measureList[0]?.length ?? 0;
        for (let m = 0; m < measureList.length; m++) {
          for (let s = 0; s < staffCount; s++) {
            const measure = measureList[m]?.[s];
            if (!measure || !measure.parentSourceMeasure) continue;
            
            const measureNumber = measure.parentSourceMeasure.MeasureNumber;
            const systemId = measure.parentMusicSystem?.Id ?? 0;
            const bbox = measure.PositionAndShape;
            
            if (!bbox) continue;
            
            if (!cache.has(measureNumber)) {
              cache.set(measureNumber, []);
            }
            
            cache.get(measureNumber)!.push({
              systemIndex: systemId,
              x: bbox.AbsolutePosition?.x ?? bbox.absolutePosition?.x ?? 0,
              y: bbox.AbsolutePosition?.y ?? bbox.absolutePosition?.y ?? 0,
              width: bbox.Size?.width ?? bbox.size?.width ?? 0,
              height: bbox.Size?.height ?? bbox.size?.height ?? 0
            });
          }
        }
      }
    } else if (Array.isArray(graphicalMeasures)) {
      console.log('🎹 [RED-BOX-DEBUG] Processing GraphicalMeasureParent array');
      let processedMeasures = 0;
      
      // Direct GraphicalMeasureParent array
      graphicalMeasures.forEach((measureParent: any, index: number) => {
        if (!measureParent?.sourceMeasure) {
          console.log(`🎹 [RED-BOX-DEBUG] Skipping invalid measureParent at index ${index}`);
          return;
        }
        
        const measureNumber = measureParent.sourceMeasure.MeasureNumber; // 1-based
        const systemIndex = measureParent.parentMusicSystem?.Id ?? 0;
        const bbox = measureParent.PositionAndShape;
        
        console.log(`🎹 [RED-BOX-DEBUG] Processing measureParent ${measureNumber}:`, {
          hasBbox: !!bbox,
          systemIndex: systemIndex
        });
        
        if (!bbox) {
          console.log(`🎹 [RED-BOX-DEBUG] No bbox for measureParent ${measureNumber}, skipping`);
          return;
        }
        
        if (!cache.has(measureNumber)) {
          cache.set(measureNumber, []);
        }
        
        const coords = {
          systemIndex,
          x: bbox.AbsolutePosition?.x ?? bbox.absolutePosition?.x ?? 0,
          y: bbox.AbsolutePosition?.y ?? bbox.absolutePosition?.y ?? 0,
          width: bbox.Size?.width ?? bbox.size?.width ?? 0,
          height: bbox.Size?.height ?? bbox.size?.height ?? 0
        };
        
        console.log(`🎹 [RED-BOX-DEBUG] Adding coordinates for measureParent ${measureNumber}:`, coords);
        cache.get(measureNumber)!.push(coords);
        processedMeasures++;
      });
      
      console.log(`🎹 [RED-BOX-DEBUG] Processed ${processedMeasures} measures in GraphicalMeasureParent array`);
    }

    measureCacheRef.current = cache;
    cacheBuiltRef.current = true;
    
    console.log('🎹 [RED-BOX-DEBUG] buildMeasureCache COMPLETE:', {
      cacheSize: cache.size,
      cacheBuilt: true,
      measureNumbers: Array.from(cache.keys()).sort((a, b) => a - b),
      totalEntries: Array.from(cache.values()).reduce((total, entries) => total + entries.length, 0)
    });

    if (process.env.NODE_ENV === 'development') {
      dlog('[Practice Range Cache] Built cache with', cache.size, 'measures');
      const sampleEntries = Array.from(cache.entries()).slice(0, 3);
      sampleEntries.forEach(([measureNum, bboxes]) => {
        dlog(`  Measure ${measureNum}: ${bboxes.length} bbox(es) on system(s) ${bboxes.map(b => b.systemIndex).join(',')}`);        
      });
    }
  }, []);

  // Draw practice range border in layout-neutral overlay (ChatGPT-5 fix)
  const drawPracticeRangeBorder = useCallback((
    opts?: { color?: string; strokeWidth?: number },
    practiceState?: { customRangeActive: boolean; customStartMeasure: number; customEndMeasure: number }
  ) => {
    const { color = '#ff0000', strokeWidth = 3 } = opts || {};
    
    const osmdInstance = osmdRef.current;
    const containerEl = containerRef.current;
    
    if (!osmdInstance || !containerEl) return;
    
    // Use passed state (current) instead of getState() (stale)
    const state = practiceState || usePracticeStore.getState();
    
    if (!state.customRangeActive) return;

    // Get practice range state
    const { customRangeActive, customStartMeasure, customEndMeasure } = state;
    
    console.log('🎹 [RED-BOX-DEBUG] drawPracticeRangeBorder - State validation:', {
      customRangeActive,
      customStartMeasure,
      customEndMeasure,
      validRange: customStartMeasure <= customEndMeasure
    });
    
    if (!customRangeActive || !customStartMeasure || !customEndMeasure || customStartMeasure > customEndMeasure) {
      console.log('🎹 [RED-BOX-DEBUG] EARLY EXIT: Invalid state or range');
      return;
    }

    // Check if cache is built - CRITICAL CHECK!
    console.log('🎹 [RED-BOX-DEBUG] Cache status check:', {
      cacheBuilt: cacheBuiltRef.current,
      cacheSize: measureCacheRef.current.size,
      cacheEmpty: measureCacheRef.current.size === 0
    });
    
    if (!cacheBuiltRef.current || measureCacheRef.current.size === 0) {
      console.log('🎹 [RED-BOX-DEBUG] CRITICAL EARLY EXIT: Cache not built or empty!');
      console.log('🎹 [RED-BOX-DEBUG] This is why red boxes are not appearing!');
      if (process.env.NODE_ENV === 'development') {
        console.warn('[Practice Range] Measure cache not built - cannot draw practice range');
      }
      return;
    }
    
    console.log('🎹 [RED-BOX-DEBUG] Cache check PASSED - Proceeding with red box rendering...');

    // ===== OVERLAY RENDERING (NO LAYOUT IMPACT) =====
    console.log('🎹 [RED-BOX-DEBUG] Starting SVG overlay rendering...');
    
    // Get or create the absolutely-positioned overlay
    const overlay = ensurePracticeBorderOverlay(containerEl);
    const overlaySvg = ensurePracticeBorderSvg(overlay);
    
    console.log('🎹 [RED-BOX-DEBUG] SVG overlay elements:', {
      hasOverlay: !!overlay,
      hasOverlaySvg: !!overlaySvg,
      overlayParent: overlay?.parentElement?.tagName
    });
    
    // Clear previous overlay content
    while (overlaySvg.firstChild) {
      overlaySvg.removeChild(overlaySvg.firstChild);
    }

    // Group selected measures by system using cache
    const measuresBySystem = new Map<number, Array<{ x: number; y: number; width: number; height: number }>>();
    const minVisibleWidth = 8; // Minimum width in OSMD units
    
    console.log(`🎹 [RED-BOX-DEBUG] Processing measures ${customStartMeasure} to ${customEndMeasure}`);
    
    for (let m = customStartMeasure; m <= customEndMeasure; m++) {
      const bboxes = measureCacheRef.current.get(m);
      console.log(`🎹 [RED-BOX-DEBUG] Measure ${m} cache lookup:`, {
        found: !!bboxes,
        bboxCount: bboxes?.length || 0
      });
      
      if (!bboxes) continue;
      
      for (const bbox of bboxes) {
        if (!measuresBySystem.has(bbox.systemIndex)) {
          measuresBySystem.set(bbox.systemIndex, []);
        }
        measuresBySystem.get(bbox.systemIndex)!.push(bbox);
        
        console.log(`🎹 [RED-BOX-DEBUG] Added measure ${m} to system ${bbox.systemIndex}:`, bbox);
      }
    }

    console.log('🎹 [RED-BOX-DEBUG] Measures grouped by system:', {
      systemCount: measuresBySystem.size,
      systems: Array.from(measuresBySystem.keys()),
      totalMeasures: Array.from(measuresBySystem.values()).reduce((sum, measures) => sum + measures.length, 0)
    });

    if (measuresBySystem.size === 0) {
      console.log('🎹 [RED-BOX-DEBUG] EARLY EXIT: No measures found in cache for range');
      return;
    }

    // Get OSMD SVG for coordinate calculations
    const backend = osmdInstance.drawer?.Backends?.[0];
    console.log('🎹 [RED-BOX-DEBUG] OSMD backend check:', {
      hasBackend: !!backend,
      hasGetSvgElement: !!(backend && typeof backend.getSvgElement === 'function')
    });
    
    if (!backend || typeof backend.getSvgElement !== 'function') {
      console.log('🎹 [RED-BOX-DEBUG] EARLY EXIT: No OSMD backend or getSvgElement function');
      return;
    }
    
    const osmdSvg = backend.getSvgElement() as SVGSVGElement;
    const osmdRect = osmdSvg.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    
    console.log('🎹 [RED-BOX-DEBUG] Coordinate calculation:', {
      osmdRect: { left: osmdRect.left, top: osmdRect.top, width: osmdRect.width, height: osmdRect.height },
      containerRect: { left: containerRect.left, top: containerRect.top, width: containerRect.width, height: containerRect.height },
      scrollLeft: containerEl.scrollLeft,
      scrollTop: containerEl.scrollTop
    });
    
    // Calculate offset between OSMD SVG and container
    const offsetX = osmdRect.left - containerRect.left + containerEl.scrollLeft;
    const offsetY = osmdRect.top - containerRect.top + containerEl.scrollTop;
    
    // Get current zoom for scaling
    const currentZoom = osmdInstance.zoom || 1;
    const paddingInOSMDUnits = 0.4; // 4px at 100% zoom
    
    console.log('🎹 [RED-BOX-DEBUG] Rendering parameters:', {
      offsetX,
      offsetY,
      currentZoom,
      paddingInOSMDUnits
    });
    
    // Create SVG namespace
    const ns = 'http://www.w3.org/2000/svg';
    let rectanglesCreated = 0;

    // Draw rectangles in overlay (absolutely positioned, no layout impact)
    measuresBySystem.forEach((bboxes, systemIndex) => {
      if (bboxes.length === 0) {
        console.log(`🎹 [RED-BOX-DEBUG] Skipping system ${systemIndex} - no bboxes`);
        return;
      }
      
      console.log(`🎹 [RED-BOX-DEBUG] Creating rectangle for system ${systemIndex} with ${bboxes.length} measures:`, {
        rawBboxes: bboxes.map(b => ({ x: b.x, y: b.y, w: b.width, h: b.height }))
      });
      
      // Sort by X position
      bboxes.sort((a, b) => a.x - b.x);
      
      const firstBox = bboxes[0];
      const lastBox = bboxes[bboxes.length - 1];
      
      // Calculate union bounds in OSMD coordinates
      const x = firstBox.x;
      const y = Math.min(...bboxes.map(b => b.y));
      const maxX = lastBox.x + lastBox.width;
      const maxY = Math.max(...bboxes.map(b => b.y + b.height));
      
      let width = maxX - x;
      const height = maxY - y;
      
      console.log(`🎹 [RED-BOX-DEBUG] Calculated OSMD coordinates for system ${systemIndex}:`, {
        osmdBounds: { x, y, width, height, maxX, maxY },
        firstBox: { x: firstBox.x, y: firstBox.y, w: firstBox.width, h: firstBox.height },
        lastBox: { x: lastBox.x, y: lastBox.y, w: lastBox.width, h: lastBox.height },
        minVisibleWidth,
        paddingInOSMDUnits,
        currentZoom
      });
      
      // Apply minimum width if needed
      if (width < minVisibleWidth) {
        console.log(`🎹 [RED-BOX-DEBUG] Width ${width} < minVisible ${minVisibleWidth}, applying minimum width`);
        width = minVisibleWidth;
      }

      // Guard against invalid dimensions
      if (width <= 0 || height <= 0) {
        console.error(`🎹 [RED-BOX-DEBUG] Invalid dimensions for system ${systemIndex}:`, { width, height });
        return;
      }

      // Convert OSMD coordinates to overlay coordinates
      const overlayX = offsetX + (x - paddingInOSMDUnits) * 10 * currentZoom;
      const overlayY = offsetY + (y - paddingInOSMDUnits) * 10 * currentZoom;
      const overlayWidth = (width + 2 * paddingInOSMDUnits) * 10 * currentZoom;
      const overlayHeight = (height + 2 * paddingInOSMDUnits) * 10 * currentZoom;

      console.log(`🎹 [RED-BOX-DEBUG] Converted to overlay coordinates for system ${systemIndex}:`, {
        overlay: { x: overlayX, y: overlayY, width: overlayWidth, height: overlayHeight },
        conversion: {
          offsetX, offsetY,
          scaleFactors: { x: (x - paddingInOSMDUnits) * 10 * currentZoom, y: (y - paddingInOSMDUnits) * 10 * currentZoom }
        }
      });

      // Create rectangle in overlay (no layout impact!)
      const rect = document.createElementNS(ns, 'rect');
      console.log(`🎹 [RED-BOX-DEBUG] Created SVG rect element:`, { 
        element: rect,
        tagName: rect.tagName,
        namespace: rect.namespaceURI,
        ns: ns
      });
      
      rect.setAttribute('class', 'practice-range-border');
      rect.setAttribute('x', overlayX.toString());
      rect.setAttribute('y', overlayY.toString());
      rect.setAttribute('width', overlayWidth.toString());
      rect.setAttribute('height', overlayHeight.toString());
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', color);
      rect.setAttribute('stroke-width', Math.max(1, strokeWidth / currentZoom).toString()); // Ensure minimum 1px stroke
      rect.setAttribute('vector-effect', 'non-scaling-stroke'); // Stable stroke under zoom
      rect.style.pointerEvents = 'none';

      console.log(`🎹 [RED-BOX-DEBUG] Configured rect attributes for system ${systemIndex}:`, {
        attributes: {
          class: rect.getAttribute('class'),
          x: rect.getAttribute('x'),
          y: rect.getAttribute('y'),
          width: rect.getAttribute('width'),
          height: rect.getAttribute('height'),
          fill: rect.getAttribute('fill'),
          stroke: rect.getAttribute('stroke'),
          strokeWidth: rect.getAttribute('stroke-width'),
          vectorEffect: rect.getAttribute('vector-effect')
        },
        style: {
          pointerEvents: rect.style.pointerEvents
        }
      });

      // Append to overlay SVG (NOT to OSMD content!)
      try {
        overlaySvg.appendChild(rect);
        rectanglesCreated++;
        console.log(`🎹 [RED-BOX-DEBUG] Successfully appended rect to overlaySvg for system ${systemIndex}. Total rectangles: ${rectanglesCreated}`);
        
        // Verify the rect was actually added to DOM
        const addedRect = overlaySvg.querySelector(`rect.practice-range-border:nth-of-type(${rectanglesCreated})`);
        console.log(`🎹 [RED-BOX-DEBUG] DOM verification for system ${systemIndex}:`, {
          rectInDom: !!addedRect,
          totalRectsInSvg: overlaySvg.querySelectorAll('rect.practice-range-border').length,
          svgChildCount: overlaySvg.children.length,
          boundingClientRect: addedRect ? addedRect.getBoundingClientRect() : null
        });
      } catch (error) {
        console.error(`🎹 [RED-BOX-DEBUG] Failed to append rect for system ${systemIndex}:`, error);
      }
    });

    if (process.env.NODE_ENV === 'development') {
      dlog(`[Practice Range Overlay] Drew ${measuresBySystem.size} system borders in overlay`);
    }
  }, [osmdRef, buildMeasureCache]);

  // Handle resize with debouncing and scroll preservation
  const handleResize = useCallback(() => {
    const timer = createTimer();
    const callStack = getCallStack();
    
    resizeDebugLog('HANDLE_RESIZE_START', {
      isReady,
      hasOsmd: !!osmdRef.current,
      hasContainer: !!containerRef.current,
      callStack: callStack.slice(0, 3)
    });

    if (!osmdRef.current || !isReady || !containerRef.current) {
      resizeDebugLog('HANDLE_RESIZE_ABORT', { 
        reason: !osmdRef.current ? 'no_osmd' : !isReady ? 'not_ready' : 'no_container'
      });
      return;
    }

    // Track dimension before clearing timeout
    trackDimensionChange('before_resize_timeout');

    // Clear any pending resize
    if (resizeTimeoutRef.current) {
      resizeDebugLog('RESIZE_TIMEOUT_CLEARED', { 
        previousTimeoutActive: true 
      });
      clearTimeout(resizeTimeoutRef.current);
    }

    resizeDebugLog('RESIZE_TIMEOUT_SCHEDULED', { 
      delay: '16ms',
      queuedAt: timer.elapsed().toFixed(3)
    });

    resizeTimeoutRef.current = setTimeout(() => {
      const timeoutTimer = createTimer();
      resizeDebugLog('RESIZE_TIMEOUT_EXECUTING', {
        delayedBy: timer.elapsed().toFixed(3)
      });

      try {
        // Save scroll position from parent section (new architecture)
        const parentSection = containerRef.current?.parentElement;
        const scrollPercent = parentSection 
          ? parentSection.scrollTop / parentSection.scrollHeight
          : 0;

        resizeDebugLog('SCROLL_POSITION_CAPTURED', {
          hasParentSection: !!parentSection,
          scrollPercent: scrollPercent.toFixed(6),
          scrollTop: parentSection?.scrollTop || 0,
          scrollHeight: parentSection?.scrollHeight || 0
        });

        // Check dimensions before re-render
        const rect = containerRef.current?.getBoundingClientRect();
        trackDimensionChange('before_osmd_render');
        
        resizeDebugLog('PRE_RENDER_DIMENSIONS', {
          container: `${rect?.width.toFixed(6)}x${rect?.height.toFixed(6)}`,
          osmdZoom: osmdRef.current?.zoom || 'unknown',
          containerElement: containerRef.current?.tagName + (containerRef.current?.className ? `.${containerRef.current.className}` : '')
        });
        
        if (process.env.NODE_ENV === 'development') {
          debug(`OSMD resize triggered. Container: ${rect?.width}x${rect?.height}`);
        }

        // Re-render OSMD with new dimensions and current zoom
        if (rect && rect.width > 0) {
          const renderTimer = createTimer();
          
          // Apply current zoom level before render
          if (osmdRef.current) {
            const previousZoom = osmdRef.current.zoom;
            osmdRef.current.zoom = zoomLevel;
            
            resizeDebugLog('ZOOM_APPLIED', {
              previousZoom: previousZoom.toFixed(3),
              newZoom: zoomLevel.toFixed(3),
              zoomChanged: Math.abs(previousZoom - zoomLevel) > 0.001
            });
          }
          
          resizeDebugLog('OSMD_RENDER_START', {
            containerWidth: rect.width.toFixed(6),
            containerHeight: rect.height.toFixed(6),
            zoom: zoomLevel.toFixed(3)
          });
          
          trackDimensionChange('before_osmd_render_call');
          trackSVGModification('before_osmd_render');
          
          osmdRef.current?.render();
          
          const renderTime = renderTimer.elapsed();
          trackDimensionChange('after_osmd_render_call');
          trackSVGModification('after_osmd_render');
          
          resizeDebugLog('OSMD_RENDER_COMPLETE', {
            renderTime: renderTime.toFixed(3)
          });
          
          // Re-inject data-note-id attributes after OSMD re-render
          // Use requestAnimationFrame to ensure DOM is fully updated
          resizeDebugLog('POST_RENDER_RAF_SCHEDULED', {
            scheduledAt: renderTimer.elapsed().toFixed(3)
          });
          
          requestAnimationFrame(() => {
            const rafTimer = createTimer();
            
            // SCOPING FIX: Declare timing variables at RAF scope level
            let cacheTime: number;
            let injectTime: number; 
            let borderTime: number;
            
            resizeDebugLog('POST_RENDER_RAF_EXECUTING', {
              totalDelay: renderTimer.elapsed().toFixed(3)
            });
            
            trackDimensionChange('post_render_raf_start');
            
            // ===== CRITICAL FIX: Pause ResizeObserver during DOM mutations =====
            withResizeObserverPaused(() => {
              // Rebuild cache after re-render
              const cacheTimer = createTimer();
              buildMeasureCache();
              cacheTime = cacheTimer.elapsed(); // Assignment instead of declaration
              trackDimensionChange('after_build_cache');
              resizeDebugLog('BUILD_CACHE_COMPLETE', {
                duration: cacheTime.toFixed(3)
              });
              
              // Inject note IDs
              const injectTimer = createTimer(); 
              injectNoteIdAttributes();
              injectTime = injectTimer.elapsed(); // Assignment instead of declaration
              trackDimensionChange('after_inject_note_ids');
              resizeDebugLog('INJECT_NOTE_IDS_COMPLETE', {
                duration: injectTime.toFixed(3)
              });
              
              // Draw practice range border (now uses layout-neutral overlay)
              const borderTimer = createTimer();
              drawPracticeRangeBorder();
              borderTime = borderTimer.elapsed(); // Assignment instead of declaration
              trackDimensionChange('after_draw_border');
              trackSVGModification('after_draw_border');
              resizeDebugLog('DRAW_BORDER_COMPLETE', {
                duration: borderTime.toFixed(3)
              });
            });
            // ===== END ResizeObserver PAUSE - Mutations complete =====
            
            resizeDebugLog('POST_RENDER_RAF_COMPLETE', {
              totalRafTime: rafTimer.elapsed().toFixed(3),
              cacheTime: cacheTime.toFixed(3),
              injectTime: injectTime.toFixed(3), 
              borderTime: borderTime.toFixed(3)
            });
          });
          
          // Note: We no longer rebuild note mappings on resize
          // The mapping is built once per score load

          // Re-show cursor after resize (fixes disappearing cursor issue)
          if (osmdRef.current?.cursor && autoShowCursor) {
            // Store current position before resize
            const currentPosition = osmdRef.current.cursor.iterator?.currentMeasureIndex || 0;
            
            // Set fixed green cursor color
            osmdRef.current.setOptions({
              cursorsOptions: [{
                color: '#33e02f',
                alpha: 0.5
              }]
            });
            
            // Ensure cursor stays visible after resize
            osmdRef.current.cursor.show();
            
            // Force cursor update to ensure visibility
            if (osmdRef.current.cursor.update) {
              osmdRef.current.cursor.update();
            }
            
            // Check and fix cursor element visibility
            requestAnimationFrame(() => {
              const cursorElement = containerRef.current?.querySelector('#selectionStartSymbol');
              if (cursorElement) {
                const style = (cursorElement as HTMLElement).style;
                if (style.display === 'none' || style.visibility === 'hidden') {
                  perfLogger.warn(' Cursor hidden after resize, forcing visibility');
                  style.display = 'block';
                  style.visibility = 'visible';
                }
              }
            });
            
            logger.osmd('Cursor re-shown after resize at measure:', currentPosition);
          }

          // Restore scroll position in parent section after next paint
          requestAnimationFrame(() => {
            resizeDebugLog('SCROLL_RESTORE_RAF', {
              hasParentSection: !!parentSection,
              scrollPercent: scrollPercent.toFixed(6),
              willRestoreScroll: !!(parentSection && scrollPercent > 0)
            });
            
            if (parentSection && scrollPercent > 0) {
              const previousScrollTop = parentSection.scrollTop;
              parentSection.scrollTop = scrollPercent * parentSection.scrollHeight;
              const newScrollTop = parentSection.scrollTop;
              
              resizeDebugLog('SCROLL_RESTORED', {
                previousScrollTop,
                newScrollTop,
                scrollHeight: parentSection.scrollHeight,
                scrollChanged: Math.abs(newScrollTop - previousScrollTop) > 1
              });
            }
          });

          trackDimensionChange('resize_operation_complete');
          resizeDebugLog('RESIZE_OPERATION_SUCCESS', {
            totalTime: timeoutTimer.elapsed().toFixed(3)
          });

          if (process.env.NODE_ENV === 'development') {
            debug(' OSMD resized and re-rendered successfully');
          }
        } else {
          resizeDebugLog('RESIZE_SKIPPED', {
            reason: 'invalid_dimensions',
            rectWidth: rect?.width || 'undefined',
            rectHeight: rect?.height || 'undefined'
          });
        }
      } catch (error) {
        resizeDebugLog('RESIZE_ERROR', {
          error: error.message || String(error),
          totalTime: timeoutTimer.elapsed().toFixed(3)
        });
        perfLogger.error(' Resize render failed:', error instanceof Error ? error : new Error(String(error)));
      }
    }, 16); // One frame delay (16ms) for instant resize at 60fps
  }, [isReady, autoShowCursor, injectNoteIdAttributes, zoomLevel]);

  // Create performResize function bound to current component state
  const createPerformResize = useCallback((): (() => Promise<void>) => {
    return () => performResize(
      osmdRef,
      containerRef,
      zoomLevel,
      buildMeasureCache,
      injectNoteIdAttributes,
      drawPracticeRangeBorder,
      isReady
    );
  }, [zoomLevel, buildMeasureCache, injectNoteIdAttributes, drawPracticeRangeBorder, isReady]);

  // Setup single ResizeObserver (ChatGPT-5 authoritative fix)
  const setupResizeObserver = useCallback(() => {
    if (!containerRef.current || !osmdRef.current || !isReady) {
      return;
    }

    // Observe the parent container (scrollable wrapper) that actually changes size
    const observeTarget = containerRef.current.parentElement || containerRef.current;
    
    if (process.env.NODE_ENV === 'development') {
      const targetRect = observeTarget.getBoundingClientRect();
      debug('Setting up SINGLE ResizeObserver with width-only gating', {
        targetElement: observeTarget.tagName + (observeTarget.className ? `.${observeTarget.className}` : ''),
        initialWidth: targetRect.width.toFixed(2)
      });
    }

    // Create single observer with width-only gating and singleflight scheduler
    setupResizeObserverOnce(observeTarget, createPerformResize());
  }, [createPerformResize, isReady]);

  // Ensure ResizeObserver is set up when conditions are met
  useEffect(() => {
    if (isReady && osmdRef.current && containerRef.current) {
      setupResizeObserver();
      
      if (process.env.NODE_ENV === 'development') {
        debug(' ResizeObserver setup triggered by conditions');
      }
    }
  }, [isReady, setupResizeObserver]);
  
  // Effect to trigger re-render on zoom change
  useEffect(() => {
    if (isReady && osmdRef.current) {
      debouncedZoomRender();
    }
    
    // Cleanup on unmount
    return () => {
      debouncedZoomRender.cancel();
    };
  }, [zoomLevel, isReady, debouncedZoomRender]);
  
  // REMOVED: Order-based injection strategy (Strategy #3) - was actively harmful
  // This code assigned noteIds by DOM element order rather than musical relationships,
  // causing chord notes to get wrong IDs. Coordinate detection works as robust fallback.

  // Import the OSMD store to sync tempo extraction
  const { setOSMD: setOSMDInStore, setIsLoaded: setIsLoadedInStore } = useOSMDStore();

  // Load score into existing OSMD instance
  const loadScore = useCallback(async () => {
    if (process.env.NODE_ENV === 'development') {
      logger.osmd('loadScore called with', { 
        hasOSMD: !!osmdRef.current, 
        hasMusicXML: !!musicXML, 
        musicXMLLength: musicXML?.length 
      });
    }
    
    if (!osmdRef.current || !musicXML) return;
    
    try {
      setIsLoading(true);
      setError(null);
      noteMappingBuiltRef.current = false; // Reset when loading new score
      
      if (process.env.NODE_ENV === 'development') {
        logger.osmd('Loading new score into existing OSMD instance...');
      }
      
      // CRITICAL FIX: Properly dispose of previous score to prevent memory leak (120MB+ per song)
      if (osmdRef.current.GraphicSheet) {
        logger.osmd('Disposing previous score to prevent memory leak');
        
        // Clear all graphical music pages
        (osmdRef.current.GraphicSheet as any).MusicPages?.forEach((page: any) => {
          if (page && typeof page.clear === 'function') {
            page.clear();
          }
        });
        
        // Clear the OSMD instance
        osmdRef.current.clear();
        
        // Force clear the DOM container to remove detached nodes
        const svgContainer = containerRef.current?.querySelector('svg');
        if (svgContainer && svgContainer.parentNode) {
          svgContainer.parentNode.removeChild(svgContainer);
        }
      }
      
      // Reset note mappings to free memory
      noteMappingRef.current.noteMapping.clear();
      noteMappingRef.current.midiToTimestamp.clear();
      noteMappingRef.current.graphicalNoteMap.clear();
      
      // PROTOTYPE: Inject fingerings if native mode is enabled
      let xmlToLoad = musicXML;
      const useNativeFingerings = process.env.USE_NATIVE_FINGERINGS === 'true' || process.env.DEBUG_NATIVE_FINGERINGS === 'true';
      
      if (useNativeFingerings && scoreId) {
        if (process.env.NODE_ENV === 'development') {
          debug('Native fingering mode enabled, injecting fingerings...');
        }
        
        // Benchmark the injection if in debug mode
        if (process.env.DEBUG_NATIVE_FINGERINGS === 'true') {
          const benchmark = await benchmarkFingeringInjection(musicXML, scoreId);
          debug('Fingering injection benchmark:', benchmark);
          
          if (!benchmark.success) {
            perfLogger.warn('Fingering injection exceeded 20ms threshold');
          }
        }
        
        // Inject fingerings into MusicXML
        try {
          xmlToLoad = await injectFingeringsIntoMusicXML(musicXML, scoreId);
        } catch (error) {
          perfLogger.error('Failed to inject fingerings, using original XML:', error);
          xmlToLoad = musicXML;
        }
      }
      
      // Load and render new score with separate timing
      const loadStart = performance.now();
      let loadTime = 0;
      let renderTime = 0;
      
      try {
        // Load phase
        await osmdRef.current.load(xmlToLoad);
        loadTime = performance.now() - loadStart;
        
        // ISSUE #10 DEBUG LOG 3: Log Fingering Positions Function
        const logFingeringPositions = (label: string = 'Positions') => {
          if (!osmdRef.current?.GraphicSheet || process.env.NODE_ENV !== 'development') return;
          
          try {
            dlog(`🐛 [ISSUE #10 DEBUG] ${label}:`);
            
            const measureList = osmdRef.current.GraphicSheet.MeasureList;
            if (!measureList || !Array.isArray(measureList)) return;
            
            measureList.forEach((staffMeasures: any[], staffIndex: number) => {
              if (!Array.isArray(staffMeasures)) return;
              
              staffMeasures.forEach((measure: any, measureIndex: number) => {
                if (!measure?.staffEntries) return;
                
                measure.staffEntries.forEach((staffEntry: any, entryIndex: number) => {
                  if (!staffEntry?.graphicalVoiceEntries) return;
                  
                  staffEntry.graphicalVoiceEntries.forEach((voiceEntry: any) => {
                    if (!voiceEntry?.notes) return;
                    
                    voiceEntry.notes.forEach((note: any) => {
                      // Check for fingering in various possible locations
                      const fingering = note.sourceNote?.Fingering || 
                                       note.sourceNote?.fingering || 
                                       note.parentVoiceEntry?.labels?.find((l: any) => l.type === 'fingering');
                      
                      if (fingering) {
                        dlog(`🐛 [ISSUE #10 DEBUG] Fingering found:`, {
                          measureIndex,
                          staffIndex,
                          entryIndex,
                          value: fingering.text || fingering.value || fingering,
                          // Try to get position info if available
                          position: fingering.absolutePosition || fingering.Position || 'N/A',
                          boundingBox: fingering.boundingBox || 'N/A'
                        });
                      }
                    });
                  });
                });
              });
            });
          } catch (error) {
            console.error('🐛 [ISSUE #10 DEBUG] Error logging fingering positions:', error);
          }
        };
        
        // Log positions before render
        logFingeringPositions('Before Render');
        
        // ISSUE #10 DEBUG LOG 4: Log Layout Recalculation Events
        dlog('🐛 [ISSUE #10 DEBUG] Starting re-render - Current Skyline/Bottomline heights:', 
          osmdRef.current.GraphicSheet.calculateSkyBottomLines ? 'Available' : 'Not Supported');
        
        // Render phase with zoom
        const renderStart = performance.now();
        const { isFirstFileOpen } = useOSMDStore.getState();
        // For first file, render at 100% initially
        osmdRef.current.zoom = isFirstFileOpen ? 1.0 : zoomLevel;
        osmdRef.current.render();
        renderTime = performance.now() - renderStart;
        
        // Log positions after render
        logFingeringPositions('After Render');
        
        // Log post-render info
        dlog('🐛 [ISSUE #10 DEBUG] Post-render - Any collisions detected?', 
          (osmdRef.current as any).rules ? 
            (osmdRef.current as any).rules.CollisionDetection || 'No CollisionDetection property' : 
            'No rules access');
        
        // Log render time to ring buffer
        logRenderLatency(renderTime);
        
        // Build measure cache after render
        buildMeasureCache();
        
        // Debug: Check if render actually happened
        // Measure count captured above
        
        // Debug logging for slow operations
        const totalTime = loadTime + renderTime;
        if (totalTime > 1000) {
          debug(
            `Slow OSMD operation: ${totalTime.toFixed(0)}ms ` +
            `(load: ${loadTime.toFixed(0)}ms, render: ${renderTime.toFixed(0)}ms)`
          );
        }
        
        // Get measure count for consolidated log
        const measureCount = osmdRef.current?.GraphicSheet?.MeasureList?.length || 0;
      } catch (renderError) {
        perfLogger.error('OSMD render failed', renderError as Error);
        throw renderError;
      }
      
      // CRITICAL: Enable cursors after render
      if (autoShowCursor) {
        osmdRef.current.enableOrDisableCursors?.(true);
      }
      
      // Sync with OSMD store for tempo extraction
      setOSMDInStore(osmdRef.current);
      
      // Consolidated log for entire OSMD load operation
      const measureCount = osmdRef.current?.GraphicSheet?.MeasureList?.length || 0;
      if (measureCount > 0) {
        logger.osmd(`Score loaded (${measureCount} measures)`);
        
        // Inspect OSMD DOM structure (development debugging)
        if (process.env.NODE_ENV === 'development') {
          debug('OSMD DOM inspection started');
          if (containerRef.current) {
            const svg = containerRef.current.querySelector('svg');
            
            if (svg) {
              // Find all text elements (potential fingerings)
              const textElements = svg.querySelectorAll('text');
              const fingeringTexts = svg.querySelectorAll('text.vf-fingering');
              
              // Sample first few text elements
              const sampleTexts = Array.from(textElements).slice(0, 5).map((text, i) => ({
                index: i,
                content: text.textContent,
                className: typeof text.className === 'string' ? text.className : (text.className as SVGAnimatedString).baseVal,
                parentClass: text.parentElement ? (typeof text.parentElement.className === 'string' ? text.parentElement.className : (text.parentElement.className as SVGAnimatedString).baseVal) : undefined
              }));
              
              // Check for various VexFlow classes
              const classCheck = {
                'vf-note': svg.querySelectorAll('.vf-note').length,
                'vf-notehead': svg.querySelectorAll('.vf-notehead').length,
                'vf-stavenote': svg.querySelectorAll('.vf-stavenote').length,
                'vf-modifiers': svg.querySelectorAll('.vf-modifiers').length,
                'vf-fingering': svg.querySelectorAll('.vf-fingering').length
              };
              
              debug('OSMD DOM structure analyzed', {
                svgFound: true,
                totalTextElements: textElements.length,
                fingeringTexts: fingeringTexts.length,
                sampleTexts,
                classCheck
              });
            } else {
              debug('OSMD DOM structure analyzed', { svgFound: false });
            }
          }
        }
      }
      
      // Let SVG content naturally determine height for proper scrolling
      // Note: Removed dynamic minHeight setting which interfered with flexbox scrolling

      // Setup manual ResizeObserver for responsive behavior and cursor positioning
      setupResizeObserver();
      
      // Wait for the next animation frame to ensure SVG elements are rendered
      requestAnimationFrame(() => {
        // Build note-to-MIDI mapping for fast path (critical for <30ms latency)
        buildNoteMapping();
        
        
        // IMMEDIATE DOM CHECK - What exists right after render?
        if (process.env.NODE_ENV === 'development') {
          debug('Post-render DOM check', {
            timestamp: Date.now(),
            containerChildren: containerRef.current?.children.length,
            svgExists: !!containerRef.current?.querySelector('svg'),
            noteHeads: containerRef.current?.querySelectorAll('.vf-notehead').length || 0,
            anyG: containerRef.current?.querySelectorAll('g').length || 0,
            totalStaveNotes: containerRef.current?.querySelectorAll('.vf-stavenote').length || 0
          });
        }
        
        // Inject data-note-id attributes after initial render
        // Use nested requestAnimationFrame to ensure DOM is fully committed
        requestAnimationFrame(() => {
          // Build measure cache first - with ResizeObserver pause
          withResizeObserverPaused(() => {
            buildMeasureCache();
            injectNoteIdAttributes();
            drawPracticeRangeBorder();
          });
        });
        
        //  MINIMAL CURSOR IMPLEMENTATION
        if (process.env.NODE_ENV === 'development') {
          logger.osmd('Cursor init check', {
            hasOSMD: !!osmdRef.current,
            autoShowCursor,
            hasCursor: !!osmdRef.current?.cursor
          });
        }
        
        try {
          if (osmdRef.current && autoShowCursor) {
            // Ensure cursor exists before trying to use it
            if (!osmdRef.current.cursor) {
              debug(' Cursor not ready yet, will retry...');
              setTimeout(() => {
                if (osmdRef.current?.cursor) {
                  // Set fixed green cursor color
                  osmdRef.current.setOptions({
                    cursorsOptions: [{
                      color: '#33e02f',
                      alpha: 0.5
                    }]
                  });
                  osmdRef.current.cursor.reset();
                  
                  // [CURSOR-SYNC] Debug delayed cursor position
                  debug('[CURSOR-SYNC] Delayed cursor positioned after reset:', {
                    hasIterator: !!osmdRef.current.cursor.iterator,
                    endReached: osmdRef.current.cursor.iterator?.EndReached,
                    currentMeasureIndex: osmdRef.current.cursor.iterator?.currentMeasureIndex,
                    currentVoiceEntryIndex: osmdRef.current.cursor.iterator?.currentVoiceEntryIndex,
                    timestamp: Date.now()
                  });
                  
                  // [CURSOR-SYNC] Check what's at the delayed cursor position
                  try {
                    const delayedStep = getExpectedNotesAtCursor();
                    debug('[CURSOR-SYNC] Delayed step at cursor position:', {
                      stepType: delayedStep.type || 'practice-step',
                      isRest: delayedStep.isRest,
                      noteCount: delayedStep.notes?.length || 0,
                      measureIndex: delayedStep.measureIndex,
                      timestamp: Date.now()
                    });
                    
                    if (delayedStep.isRest) {
                      perfLogger.warn('[CURSOR-SYNC] POTENTIAL ISSUE: Delayed cursor also on rest note');
                    }
                  } catch (error) {
                    perfLogger.error('[CURSOR-SYNC] Error checking delayed cursor position:', error instanceof Error ? error : new Error(String(error)));
                  }
                  
                  osmdRef.current.cursor.show();
                  const cursor = osmdRef.current.cursor as any;
                  if (cursor.update) {
                    cursor.update();
                  }
                  
                  // Fix cursor z-index for delayed showing
                  requestAnimationFrame(() => {
                    const cursorElements = containerRef.current?.querySelectorAll('[id^="cursorImg"]');
                    if (cursorElements && cursorElements.length > 0) {
                      cursorElements.forEach((element) => {
                        const cursorEl = element as HTMLElement;
                        cursorEl.style.zIndex = '1000';
                        cursorEl.style.display = 'block';
                        cursorEl.style.visibility = 'visible';
                      });
                    }
                  });
                  
                  debug(' OSMD cursor shown (delayed)');
                }
              }, 100);
            } else {
              // Set fixed green cursor color
              osmdRef.current.setOptions({
                cursorsOptions: [{
                  color: '#33e02f',
                  alpha: 0.5
                }]
              });
              osmdRef.current.cursor.reset(); // Position at start
              
              // [CURSOR-SYNC] Debug initial cursor position
              debug('[CURSOR-SYNC] Initial cursor positioned after reset:', {
                hasIterator: !!osmdRef.current.cursor.iterator,
                endReached: osmdRef.current.cursor.iterator?.EndReached,
                currentMeasureIndex: osmdRef.current.cursor.iterator?.currentMeasureIndex,
                currentVoiceEntryIndex: osmdRef.current.cursor.iterator?.currentVoiceEntryIndex,
                timestamp: Date.now()
              });
              
              // [CURSOR-SYNC] Check what's at the initial cursor position
              try {
                const initialStep = getExpectedNotesAtCursor();
                debug('[CURSOR-SYNC] Initial step at cursor position:', {
                  stepType: initialStep.type || 'practice-step',
                  isRest: initialStep.isRest,
                  noteCount: initialStep.notes?.length || 0,
                  measureIndex: initialStep.measureIndex,
                  timestamp: Date.now()
                });
                
                if (initialStep.isRest) {
                  perfLogger.warn('[CURSOR-SYNC] POTENTIAL ISSUE: Cursor initialized on rest note - this may cause visual disconnect with practice logic');
                }
              } catch (error) {
                perfLogger.error('[CURSOR-SYNC] Error checking initial cursor position:', error instanceof Error ? error : new Error(String(error)));
              }
              
              osmdRef.current.cursor.show();  // Make visible
              
              // Force cursor update to ensure visibility
              const cursor = osmdRef.current.cursor as any;
              if (cursor.update) {
                cursor.update();
              }
              
              // [CURSOR-SYNC] 🧪 ADD MANUAL TESTING FUNCTION
              (window as any).testCursor = () => {
                try {
                  debug('[CURSOR-SYNC] 🧪 MANUAL TEST: Testing cursor access patterns');
                  
                  // Test pattern 1: osmdRef.current (working in useOSMD)
                  const osmdRefCursor = osmdRef.current?.cursor;
                  const hasOsmdRefCursor = !!osmdRefCursor?.iterator;
                  
                  debug('[CURSOR-SYNC] 🧪 MANUAL TEST: Cursor availability:', {
                    osmdRefCursor: !!osmdRefCursor,
                    osmdRefIterator: !!osmdRefCursor?.iterator,
                    osmdInstance: !!osmdRef.current
                  });
                  
                  if (hasOsmdRefCursor) {
                    debug('[CURSOR-SYNC] 🧪 MANUAL TEST: osmdRef.current.cursor is available - advancing');
                    osmdRefCursor.next();
                    return 'Cursor advanced via osmdRef.current';
                  }
                  
                  debug('[CURSOR-SYNC] 🧪 MANUAL TEST: No cursor found');
                  return 'No cursor found';
                } catch (error) {
                  perfLogger.error('[CURSOR-SYNC] 🧪 MANUAL TEST ERROR:', error);
                  return `Error: ${error}`;
                }
              };
              
              // Fix cursor z-index immediately after showing
              requestAnimationFrame(() => {
                const cursorElements = containerRef.current?.querySelectorAll('[id^="cursorImg"]');
                if (cursorElements && cursorElements.length > 0) {
                  cursorElements.forEach((element) => {
                    const cursorEl = element as HTMLElement;
                    cursorEl.style.zIndex = '1000';
                    cursorEl.style.display = 'block';
                    cursorEl.style.visibility = 'visible';
                  });
                }
              });
              
              debug(' OSMD cursor shown');
            }
          }
        } catch (err) {
          perfLogger.error(' Cursor initialization error:', err instanceof Error ? err : new Error(String(err)));
        }
        
        setIsReady(true);
        
        // Mark as loaded in the store to trigger tempo extraction
        debug(' Marking OSMD as loaded in store to trigger tempo extraction...');
        setIsLoadedInStore(true);
        
        // Apply saved zoom after initial render (one frame at 100% for stable layout) - only for first file
        const { targetZoomLevel, zoomLevel: currentZoomLevel, setZoomLevel, isFirstFileOpen } = useOSMDStore.getState();
        if (isFirstFileOpen && targetZoomLevel !== currentZoomLevel && osmdRef.current) {
          // Mark that we've handled the first file
          useOSMDStore.setState({ isFirstFileOpen: false });
          
          requestAnimationFrame(() => {
            if (osmdRef.current) {
              osmdRef.current.zoom = targetZoomLevel;
              osmdRef.current.render();
              setZoomLevel(targetZoomLevel);
            }
          });
        } else if (isFirstFileOpen) {
          // Even if zoom doesn't need transition, mark first file as handled
          useOSMDStore.setState({ isFirstFileOpen: false });
        }
        
        // Phase 1 optimization: Generate pre-computed practice sequence
        if (Flags.preComputedSequence && osmdRef.current) {
          try {
            // Generate pre-computed practice sequence
            const result = PracticeSequenceBuilder.build(osmdRef.current);
            
            // Sequence generation complete
            
            // Store sequence in practice store for O(1) access during practice
            setOptimizedSequence(result.steps);
            
            // CRITICAL FIX: Reset auto-created cursor after pre-computation
            // PracticeSequenceBuilder traverses the entire score, leaving cursor at the end
            if (osmdRef.current.cursor && autoShowCursor) {
              // Debug: Log cursor state before reset
              const cursorBefore = osmdRef.current.cursor as any;
              if (process.env.NODE_ENV === 'development') {
                debug('[DEBUG] Cursor state BEFORE reset:', {
                  hasIterator: !!cursorBefore.iterator,
                  endReached: cursorBefore.iterator?.EndReached,
                  position: cursorBefore.iterator?.currentMeasureIndex,
                  voiceEntry: cursorBefore.iterator?.currentVoiceEntryIndex
                });
              }
              
              // Force a complete cursor reset and visibility restoration
              osmdRef.current.cursor.reset();
              debug(' OSMD cursor reset after pre-computation');
              
              // Debug: Log cursor state after reset
              const cursorAfter = osmdRef.current.cursor as any;
              if (process.env.NODE_ENV === 'development') {
                debug('[DEBUG] Cursor state AFTER reset:', {
                  hasIterator: !!cursorAfter.iterator,
                  endReached: cursorAfter.iterator?.EndReached,
                  position: cursorAfter.iterator?.currentMeasureIndex,
                  voiceEntry: cursorAfter.iterator?.currentVoiceEntryIndex
                });
              }
              
              // CRITICAL: Ensure cursor is truly reset
              // PracticeSequenceBuilder can leave EndReached=true even after reset
              if (cursorAfter.iterator?.EndReached) {
                perfLogger.warn('[useOSMD] Cursor still at end after reset, forcing clean state');
                cursorAfter.iterator.EndReached = false;
                osmdRef.current.cursor.reset();
                if (process.env.NODE_ENV === 'development') {
                  debug('[DEBUG] Forced EndReached=false and reset again');
                }
              }
              
              // Ensure cursor is shown and properly rendered
              osmdRef.current.cursor.show();
              
              // Force cursor update to ensure visibility
              // Note: update() exists but may not be in TypeScript definitions
              const cursor = osmdRef.current.cursor as any;
              if (cursor.update) {
                cursor.update();
              }
              
              // Additional safeguard: Fix cursor z-index and visibility
              requestAnimationFrame(() => {
                // OSMD uses dynamic cursor IDs like cursorImg-0, cursorImg-1, etc.
                const cursorElements = containerRef.current?.querySelectorAll('[id^="cursorImg"]');
                if (cursorElements && cursorElements.length > 0) {
                  cursorElements.forEach((element) => {
                    const cursorEl = element as HTMLElement;
                    // Fix z-index issue (cursor was behind sheet music with z-index: -1)
                    cursorEl.style.zIndex = '1000';
                    cursorEl.style.display = 'block';
                    cursorEl.style.visibility = 'visible';
                    // Fixed cursor element z-index and visibility
                  });
                } else {
                  perfLogger.warn(' No cursor elements found with ID pattern cursorImg*');
                }
                // OSMD cursor visibility restored
              });
            }
            
          } catch (error) {
            perfLogger.error('[useOSMD] Failed to generate practice sequence:', error instanceof Error ? error : new Error(String(error)));
            // Fallback to legacy real-time extraction
            setOptimizedSequence([]); // Clear any existing sequence
          }
        }
      });
      
      // Performance logging already handled by performance-logger

    } catch (err) {
      const error = err as Error;
      setError(error);
      perfLogger.error(' Score loading failed:', error);
      
      // Don't destroy or clear the instance on error
      // OSMD will handle its own state when loading the next score
      
      // Reset store state on error
      setOSMDInStore(null);
      setIsLoadedInStore(false);
    } finally {
      setIsLoading(false);
    }
  }, [musicXML, autoShowCursor, setupResizeObserver, buildNoteMapping]);

  // Fast path note highlighting (critical for <30ms latency)
  const highlightNote = useCallback((noteNumber: number, velocity: number = 100) => {
    if (!isReady || !osmdRef.current) return;

    const timestamps = noteMappingRef.current.midiToTimestamp.get(noteNumber);
    if (!timestamps || timestamps.length === 0) return;

    // Calculate visual feedback based on velocity (Code review:'s innovation)
    const feedback = calculateVisualFeedback(velocity);
    
    // Performance tracking
    const highlightStart = performance.now();
    
    // Batch all DOM operations in a single animation frame for better performance
    requestAnimationFrame(() => {
      // Pre-calculate style values to avoid string allocations in the loop
      const strokeWidthValue = feedback.strokeWidth + 'px';
      const opacityValue = String(feedback.opacity);
      const filterValue = feedback.glowIntensity && feedback.glowIntensity > 5 
        ? `drop-shadow(0 0 ${feedback.glowIntensity}px ${feedback.color})`
        : '';
      
      // Apply highlighting to all timestamps for this MIDI note
      timestamps.forEach(timestamp => {
        const mapping = noteMappingRef.current.noteMapping.get(timestamp);
        if (mapping) {
          // Direct SVG manipulation for maximum performance
          mapping.svgElements.forEach(element => {
            // Batch style changes for better performance
            element.style.cssText += `fill: ${feedback.color}; stroke-width: ${strokeWidthValue}; opacity: ${opacityValue};${filterValue ? ` filter: ${filterValue};` : ''}`;
            element.classList.add('note-highlighted');
          });
        }
      });
    });

    // Performance monitoring
    if (process.env.NODE_ENV === 'development') {
      const highlightTime = performance.now() - highlightStart;
      performanceRef.current.highlightCount++;
      
      if (highlightTime > 30) {
        perfLogger.warn(` Highlight latency: ${highlightTime.toFixed(2)}ms (target: <30ms)`);
      }
    }
  }, [isReady, calculateVisualFeedback]);

  // Remove note highlighting
  const unhighlightNote = useCallback((noteNumber: number) => {
    if (!isReady) return;

    const timestamps = noteMappingRef.current.midiToTimestamp.get(noteNumber);
    if (!timestamps) return;

    // Batch all DOM operations in a single animation frame
    requestAnimationFrame(() => {
      timestamps.forEach(timestamp => {
        const mapping = noteMappingRef.current.noteMapping.get(timestamp);
        if (mapping) {
          mapping.svgElements.forEach(element => {
            // Reset styles efficiently by removing inline styles
            element.style.removeProperty('fill');
            element.style.removeProperty('stroke-width');
            element.style.removeProperty('opacity');
            element.style.removeProperty('filter');
            element.classList.remove('note-highlighted');
          });
        }
      });
    });
  }, [isReady]);

  // Clear all highlights
  const clearAllHighlights = useCallback(() => {
    if (!containerRef.current) return;

    requestAnimationFrame(() => {
      // More efficient: get highlighted elements once and batch operations
      const highlightedElements = containerRef.current!.getElementsByClassName('note-highlighted');
      // Convert to array once to avoid live collection performance issues
      const elementsArray = Array.from(highlightedElements) as HTMLElement[];
      
      elementsArray.forEach(el => {
        // Remove inline styles efficiently
        el.style.removeProperty('fill');
        el.style.removeProperty('stroke-width');
        el.style.removeProperty('opacity');
        el.style.removeProperty('filter');
        el.classList.remove('note-highlighted');
      });
    });

    performanceRef.current.highlightCount = 0;
  }, []);

  // Update playback position (for future playback features)
  const updatePlaybackPosition = useCallback((timestamp: number) => {
    if (!isReady || !osmdRef.current) return;
    
    // Future: Implement cursor movement for playback
    debug(` Playback position: ${timestamp}`);
  }, [isReady]);

  // Get currently visible notes (for optimization)
  const getVisibleNotes = useCallback((): number[] => {
    if (!isReady) return [];
    
    // Future: Implement viewport-based optimization
    return Array.from(noteMappingRef.current.midiToTimestamp.keys());
  }, [isReady]);

  // Helper function to extract notes from voice entry
  const extractNotesFromVoiceEntry = useCallback((voiceEntry: any): PracticeNote[] => {
    const notes: PracticeNote[] = [];
    
    if (!voiceEntry || !voiceEntry.Notes) {
      return notes;
    }
    
    for (const note of voiceEntry.Notes) {
      // Log tie information for debugging
      if (process.env.NODE_ENV === 'development') {
        const sourceNote = note.sourceNote || note.SourceNote;
        const halfTone = sourceNote?.halfTone ?? sourceNote?.HalfTone;
        debug('[TIED_NOTES] Stage: OSMD Parsing', {
          stage: 'osmd_tie_parsing',
          halfTone,
          hasTie: !!note.Tie,
          isStartNote: note.Tie ? note.Tie.StartNote === note : 'no_tie',
          tieStartNote: note.Tie ? (note.Tie.StartNote ? 'exists' : 'null') : 'no_tie',
          noteType: note.constructor?.name || 'unknown'
        });
      }
      
      // Skip tied note continuations
      if ((note as any).NoteTie && (note as any).NoteTie.StartNote !== note) {
        if (process.env.NODE_ENV === 'development') {
          debug('[TIED_NOTES] Skipping tied continuation in OSMD parsing');
        }
        continue;
      }
      
      const pitch = note.Pitch;
      if (!pitch) continue;
      
      // Calculate MIDI value from OSMD's halfTone
      const sourceNote = note.sourceNote || note.SourceNote;
      const halfTone = sourceNote?.halfTone ?? sourceNote?.HalfTone;
      if (halfTone === undefined) continue;
      
      // OSMD's halfTone is offset from C0 (MIDI 12)
      const midiValue = Math.max(0, Math.min(127, halfTone + 12));
      
      notes.push({
        midiValue,
        pitchName: extractNoteNameFromPitch(pitch, midiValue),
        octave: pitch.Octave ?? Math.floor(midiValue / 12) - 1
      });
    }
    
    return notes;
  }, []);

  //  CLEAN CURSOR API: Simple access to OSMD cursor
  // getExpectedNotesAtCursor - simplified for practice mode
  const getExpectedNotesAtCursor = useCallback((): PracticeStepResult => {
    // [CURSOR-SYNC] Debug every call to getExpectedNotesAtCursor
    debug('[CURSOR-SYNC] getExpectedNotesAtCursor called:', {
      hasOSMD: !!osmdRef.current,
      timestamp: Date.now(),
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join(' <- ') // Show calling context
    });
    
    if (!osmdRef.current) {
      perfLogger.error('[CURSOR-SYNC] getExpectedNotesAtCursor: No OSMD instance');
      return { type: 'END_OF_SCORE' };
    }
    
    try {
      // Simple cursor access - trust OSMD native implementation
      if (!osmdRef.current.cursor) {
        debug('[CURSOR-SYNC] No cursor available');
        return { type: 'END_OF_SCORE' };
      }
      const cursor = osmdRef.current.cursor;
      if (!cursor || !cursor.iterator) {
        debug('[CURSOR-SYNC] No cursor iterator available');
        return { type: 'END_OF_SCORE' };
      }
      
      // Get current cursor position
      const iterator = cursor.iterator;
      const currentVoiceEntry = (iterator as any).Current;
      
      // [CURSOR-SYNC] Debug cursor state
      debug('[CURSOR-SYNC] Current cursor state:', {
        hasIterator: !!iterator,
        endReached: iterator.EndReached || iterator.endReached,
        currentMeasureIndex: iterator.currentMeasureIndex,
        currentVoiceEntryIndex: iterator.currentVoiceEntryIndex,
        hasVoiceEntry: !!currentVoiceEntry,
        voiceEntryType: currentVoiceEntry?.constructor?.name,
        timestamp: Date.now()
      });
      
      if (!currentVoiceEntry || iterator.EndReached || iterator.endReached) {
        return { type: 'END_OF_SCORE' };
      }
      
      // Extract notes from current position
      const notes = extractNotesFromVoiceEntry(currentVoiceEntry);
      
      if (notes.length === 0) {
        // This is a rest
        const restResult = {
          notes: [],
          isChord: false,
          isRest: true,
          measureIndex: iterator.currentMeasureIndex || 0,
          timestamp: Date.now(),
        };
        
        // [CURSOR-SYNC] Log rest detection
        debug('[CURSOR-SYNC] REST DETECTED at cursor position:', {
          measureIndex: restResult.measureIndex,
          cursorPosition: {
            measureIndex: iterator.currentMeasureIndex,
            voiceEntryIndex: iterator.currentVoiceEntryIndex
          },
          timestamp: Date.now()
        });
        
        return restResult;
      }
      
      const noteResult = {
        notes,
        isChord: notes.length > 1,
        isRest: false,
        measureIndex: iterator.currentMeasureIndex || 0,
        timestamp: Date.now(),
      };
      
      // [CURSOR-SYNC] Log note detection
      debug('[CURSOR-SYNC] NOTES DETECTED at cursor position:', {
        noteCount: notes.length,
        isChord: noteResult.isChord,
        measureIndex: noteResult.measureIndex,
        notes: notes.map(n => ({ pitch: n.pitch, name: n.name })),
        cursorPosition: {
          measureIndex: iterator.currentMeasureIndex,
          voiceEntryIndex: iterator.currentVoiceEntryIndex
        },
        timestamp: Date.now()
      });
      
      return noteResult;
      
    } catch (error) {
      perfLogger.error('Error getting expected notes at cursor:', error instanceof Error ? error : new Error(String(error)));
      return { type: 'END_OF_SCORE' };
    }
  }, [isReady]);

  // Removed hideCursor - using OSMD native API directly

  // Removed nextCursorPosition - using OSMD native API directly (osmdRef.current.cursor.next())

  // Removed previousCursorPosition - using OSMD native API directly (osmdRef.current.cursor.previous())

  // Removed setCursorToMeasure - using OSMD native API directly (osmdRef.current.cursor.reset() + cursor.next())

  // Removed getCursorPosition - using OSMD native API directly (osmdRef.current.cursor.iterator.currentMeasureIndex)

  // Removed duplicate getExpectedNotesAtCursor - using clean implementation above

  //  CLEAN CURSOR: Memoized controls object with direct cursor access
  const controls = useMemo((): OSMDControls => ({
    highlightNote,
    unhighlightNote,
    clearAllHighlights,
    updatePlaybackPosition,
    getVisibleNotes,
    cursor: osmdRef.current?.cursor, // Direct access to OSMD auto-created cursor
    getExpectedNotesAtCursor,
    // [CURSOR-SYNC] Add cursor access methods
    hideCursor: () => osmdRef.current?.cursor?.hide?.(),
    showCursor: () => osmdRef.current?.cursor?.show?.(),
  }), [highlightNote, unhighlightNote, clearAllHighlights, updatePlaybackPosition, getVisibleNotes, getExpectedNotesAtCursor, osmdReady, osmdRef.current?.cursor]);

  // Create OSMD instance once on mount
  useEffect(() => {
    let cancelled = false;
    
    const initInstance = async () => {
      if (cancelled) return;
      try {
        await createOSMDInstance();
      } catch (error) {
        perfLogger.error('Failed to initialize OSMD instance:', error as Error);
        setError(error as Error);
      }
    };
    
    initInstance().catch((error) => {
      perfLogger.error('Uncaught error in OSMD initialization:', error);
      setError(error);
    });
    
    // Cleanup function
    return () => {
      cancelled = true;
      if (osmdRef.current) {
        osmdRef.current = null;
      }
      setOsmdReady(false);
    };
  }, [createOSMDInstance]);

  // Load score when OSMD instance is ready AND musicXML changes
  useEffect(() => {
    // Wait for OSMD instance to be ready
    if (!osmdReady) return;
    
    if (!musicXML) {
      // Clear the score display if musicXML is null/undefined
      if (osmdRef.current) {
        try {
          // Only clear the visual content, don't destroy the instance
          osmdRef.current.clear();
          // Clear mappings
          noteMappingRef.current.noteMapping.clear();
          noteMappingRef.current.midiToTimestamp.clear();
          noteMappingRef.current.graphicalNoteMap.clear();
          noteMappingBuiltRef.current = false; // Reset for next score
          setIsReady(false);
          
          // Reset store state when clearing
          setOSMDInStore(null);
          setIsLoadedInStore(false);
        } catch (err) {
          perfLogger.warn(' Failed to clear OSMD:', err);
        }
      }
      return;
    }
    
    if (process.env.NODE_ENV === 'development') {
      performance.mark('osmd-init-start');
    }
    
    loadScore().catch((error) => {
      perfLogger.error('Uncaught error in score loading:', error);
      setError(error);
    });
  }, [osmdReady, musicXML]); // Removed loadScore from deps to prevent double loading

  // Enable theme re-rendering with cursor preservation
  useOSMDTheme(osmdRef.current, theme);
  
  // Apply cursor color when theme changes
  useEffect(() => {
    if (osmdRef.current && autoShowCursor && osmdRef.current.cursor) {
      // Fixed green cursor tint (usual OSMD default)
      osmdRef.current.setOptions({
        cursorsOptions: [{
          color: '#33e02f', // Green hex
          alpha: 0.5 // Semi-transparent
        }]
      });
      
      osmdRef.current.cursor.reset();
      osmdRef.current.render();
      osmdRef.current.cursor.show();
    }
  }, [theme, autoShowCursor]);

  // Add global debug function
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
      (window as any).debugOSMDCursorPosition = () => {
        if (osmdRef.current && osmdRef.current.cursor) {
          const cursor = osmdRef.current.cursor;
          const iterator = cursor.iterator;
          return {
            measure: iterator?.currentMeasureIndex || 0,
            note: iterator?.currentVoiceEntryIndex || 0,
            endReached: iterator?.EndReached || iterator?.endReached || false
          };
        } else {
          perfLogger.warn('No OSMD instance available for debugging');
          return null;
        }
      };
      // Debug commands only with explicit debug flag
      const DEBUG_CURSOR = localStorage.getItem('debug:cursor') === 'true';
      if (DEBUG_CURSOR) {
        logger.osmd('Debug cursor position: run window.debugOSMDCursorPosition() in console');
        
        // Simple cursor debug function
        (window as any).showCursor = () => {
          if (osmdRef.current?.cursor) {
            osmdRef.current.cursor.reset();
            osmdRef.current.cursor.show();
            debug(' Cursor shown at start position');
          } else {
            debug(' No OSMD cursor available');
          }
        };
        logger.osmd('Show cursor: run window.showCursor() in console');
        
        // Monitor cursor mutations
        (window as any).monitorCursor = () => {
          const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
              const target = mutation.target as HTMLElement;
              if (target.id?.includes('cursor') || 
                  (mutation.removedNodes.length > 0 && 
                   Array.from(mutation.removedNodes).some((node: any) => 
                     node.id?.includes('cursor') || node.classList?.contains('cursor')))) {
                if (process.env.NODE_ENV === 'development') {
                  debug('Cursor mutation detected', {
                    type: mutation.type,
                    targetId: target.id,
                    removedNodes: mutation.removedNodes.length,
                    addedNodes: mutation.addedNodes.length,
                    timestamp: Date.now()
                  });
                }
              }
            });
          });
          
          const container = containerRef.current;
          if (container) {
            observer.observe(container, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['style', 'display', 'visibility']
            });
            debug(' Now monitoring cursor mutations in container');
          }
        };
        logger.osmd('Monitor cursor: run window.monitorCursor() in console');
      }
    }
    
    return () => {
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
        delete (window as any).debugOSMDCursorPosition;
        delete (window as any).showCursor;
        delete (window as any).monitorCursor;
      }
    };
  }, []);
  
  // Expose OSMD instance to window when it changes
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && osmdRef.current) {
      (window as any).osmd = osmdRef.current;
      // OSMD instance exposed to window.osmd
      
      // Add a global function to fix cursor visibility
      (window as any).fixOSMDCursor = () => {
        if (osmdRef.current?.cursor) {
          osmdRef.current.cursor.reset();
          osmdRef.current.cursor.show();
          const cursor = osmdRef.current.cursor as any;
          if (cursor.update) {
            cursor.update();
          }
          
          // Fix z-index for all cursor elements
          const cursorElements = document.querySelectorAll('[id^="cursorImg"]');
          cursorElements.forEach((element) => {
            const cursorEl = element as HTMLElement;
            cursorEl.style.zIndex = '1000';
            cursorEl.style.display = 'block';
            cursorEl.style.visibility = 'visible';
          });
          
          debug(' Cursor fixed via window.fixOSMDCursor()');
          return 'Cursor fixed!';
        }
        return 'No OSMD cursor found';
      };
    }
    
    return () => {
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
        delete (window as any).osmd;
        delete (window as any).fixOSMDCursor;
      }
    };
  }, [osmdReady, isReady]); // Update when OSMD instance is ready

  // Removed cursor visibility monitoring - using OSMD native API only

  // React to practice range changes using Zustand hooks directly
  const { customRangeActive, customStartMeasure, customEndMeasure } = usePracticeStore();
  
  useEffect(() => {
    if (osmdRef.current) {
      withResizeObserverPaused(() => {
        drawPracticeRangeBorder(undefined, { customRangeActive, customStartMeasure, customEndMeasure });
      });
    }
  }, [customRangeActive, customStartMeasure, customEndMeasure, drawPracticeRangeBorder]);
  
  // Invalidate cache when needed
  useEffect(() => {
    cacheBuiltRef.current = false;
  }, [osmdRef.current]); // Reset when OSMD instance changes

  // Also redraw on zoom changes
  useEffect(() => {
    if (isReady && osmdRef.current) {
      withResizeObserverPaused(() => {
        drawPracticeRangeBorder();
      });
    }
  }, [zoomLevel, isReady, drawPracticeRangeBorder]);

  // Cleanup effect (critical for memory management)
  useEffect(() => {
    return () => {
      // Cleanup single ResizeObserver system
      cleanupResizeObserver();

      // Clear any pending resize timeout
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }

      // Cleanup practice border overlays
      if (containerRef.current) {
        clearPracticeBorderOverlays(containerRef.current);
      }

      // CRITICAL: Proper OSMD disposal to prevent memory leaks
      if (osmdRef.current) {
        try {
          // Clear all graphical music pages first
          if ((osmdRef.current.GraphicSheet as any)?.MusicPages) {
            (osmdRef.current.GraphicSheet as any).MusicPages.forEach((page: any) => {
              if (page && typeof page.clear === 'function') {
                page.clear();
              }
            });
          }
          
          // Clear the OSMD instance
          osmdRef.current.clear();
          
          // Hint for garbage collection in dev mode
          if (process.env.NODE_ENV === 'development' && (window as any).performance?.memory) {
            debug(' Memory before cleanup', {
              memoryMB: (window as any).performance.memory.usedJSHeapSize / 1048576
            });
          }
        } catch (error) {
          perfLogger.warn(' OSMD cleanup warning:', error);
        }
        osmdRef.current = null;
      }

      // Clear DOM container completely
      if (containerRef.current) {
        // Remove all child nodes to ensure no detached DOM references
        while (containerRef.current.firstChild) {
          containerRef.current.removeChild(containerRef.current.firstChild);
        }
      }

      // Clear mappings
      noteMappingRef.current.noteMapping.clear();
      noteMappingRef.current.midiToTimestamp.clear();
      noteMappingRef.current.graphicalNoteMap.clear();

      debug(' OSMD hook cleaned up');
    };
  }, []);

  // DOM inspection for debugging - only with explicit debug flag
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && process.env.DEBUG_DOM_INSPECTION) {
      debug('🎯 DEBUG Effect triggered', { 
        isReady,
        hasGraphicalNoteMap: noteMappingRef.current.graphicalNoteMap.size,
        timestamp: Date.now()
      });
      
      if (!isReady || !containerRef.current) {
        debug('❌ DEBUG skipped: not ready');
        return;
      }
    
      // Simple DOM inspection after a short delay
      const timer = setTimeout(() => {
        debug('🔍 DEBUG: Checking OSMD DOM after render...');
        const svg = containerRef.current?.querySelector('svg');
        
        if (!svg) {
          debug('❌ No SVG found in container');
          return;
        }
        
        // Log what we find
        debug('✅ SVG found, inspecting structure...');
        debug('GraphicalNoteMap keys:', Array.from(noteMappingRef.current.graphicalNoteMap.keys()).slice(0, 5));
      
      // Find fingering elements
      const fingeringElements = svg.querySelectorAll('text');
      let fingeringCount = 0;
      
      fingeringElements.forEach((text) => {
        const content = text.textContent?.trim();
        if (content && /^[1-5]$/.test(content)) {
          fingeringCount++;
          if (fingeringCount <= 3) {
            const parentClass = (() => {
              const className = text.parentElement?.className;
              if (!className) return undefined;
              if (typeof className === 'string') return className;
              return (className as SVGAnimatedString).baseVal;
            })();
            
            debug(`Fingering found: "${content}"`, {
              class: typeof text.className === 'string' ? text.className : (text.className as SVGAnimatedString).baseVal,
              parent: text.parentElement?.tagName,
              parentClass
            });
          }
        }
      });
      
      debug(`Total fingering elements: ${fingeringCount}`);
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [isReady]);

  // Detect repeats in the score
  const detectRepeats = useCallback(() => {
    if (!osmdRef.current) return [];
    
    const repeats: Array<{ type: string; measureIndex: number }> = [];
    
    try {
      // Use correct OSMD property name
      const musicSheet = (osmdRef.current as any).sheet || (osmdRef.current as any).Sheet;
      if (!musicSheet) return [];
      
      // Check each measure for repeat signs
      musicSheet.SourceMeasures?.forEach((measure: any, index: number) => {
        // Check for repeat barlines
        if (measure.FirstRepetitionInstructions && measure.FirstRepetitionInstructions.length > 0) {
          measure.FirstRepetitionInstructions.forEach((instruction: any) => {
            if (instruction.type === 0) { // RepeatStartInstruction
              repeats.push({ type: 'repeat_start', measureIndex: index });
            } else if (instruction.type === 1) { // RepeatEndInstruction
              repeats.push({ type: 'repeat_end', measureIndex: index });
            }
          });
        }
        
        // Check for D.C. al Fine, D.S. al Coda, etc.
        if (measure.LastRepetitionInstructions && measure.LastRepetitionInstructions.length > 0) {
          measure.LastRepetitionInstructions.forEach((instruction: any) => {
            if (instruction.type === 2) { // DaCapo
              repeats.push({ type: 'dc_al_fine', measureIndex: index });
            } else if (instruction.type === 3) { // DalSegno
              repeats.push({ type: 'ds_al_coda', measureIndex: index });
            }
          });
        }
      });
    } catch (error) {
      perfLogger.warn('Error detecting repeats:', error);
    }
    
    return repeats;
  }, []);

  // ISSUE #10 FIX: Removed re-render trigger that was causing feedback loop
  // The custom FingeringLayer handles all fingering rendering independently
  // OSMD only renders the base score, preventing dual rendering conflicts

  return {
    osmd: osmdRef.current,
    isLoading,
    isReady,
    osmdReady,
    error,
    controls,
    noteMapping: noteMappingRef.current.noteMapping,
    graphicalNoteMap: noteMappingRef.current.graphicalNoteMap,
    detectRepeats,
  };
};