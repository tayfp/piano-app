import React, { useMemo, useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useFingeringStore } from '../stores/fingeringStore';
import { useOSMDStore } from '@/renderer/stores/osmdStore';
import { useFingeringPositioning } from '../hooks/useFingeringPositioning';
import { useFingeringInteraction } from '../hooks/useFingeringInteraction';
import { useCoordinateBasedNoteDetection } from '../hooks/useCoordinateBasedNoteDetection';
import { FingeringInlineInput } from './FingeringInlineInput';
import { createFingeringId } from '../utils/fingeringId';
import { perfLogger } from '../utils/simple-perf-logger';
import { getDataNoteId } from '../utils/getDataNoteId';

interface FingeringLayerProps {
  scoreId: string;
  /** Viewport optimization - only render visible fingerings */
  visibleTimeRange?: { start: number; end: number };
  /** Direct access to graphicalNoteMap from parent */
  graphicalNoteMap?: Map<string, any>;
  /** Phase 3 escape hatch: onClick handler for fingering interaction */
  onFingeringClick?: (noteId: string, finger: number) => void;
  /** Phase 3 escape hatch: Enable interaction mode */
  interactive?: boolean;
  /** Container ref from parent for coordinate detection */
  containerRef?: React.RefObject<HTMLDivElement>;
}

// Configurable performance limit
// Can be overridden via MAX_FINGERING_RENDER_LIMIT environment variable
const MAX_FINGERING_RENDER_LIMIT = process.env.MAX_FINGERING_RENDER_LIMIT 
  ? parseInt(process.env.MAX_FINGERING_RENDER_LIMIT) 
  : 300;


export const FingeringLayer: React.FC<FingeringLayerProps> = ({ 
  scoreId, 
  visibleTimeRange,
  graphicalNoteMap,
  onFingeringClick,
  interactive = false,
  containerRef
}) => {
  // Initialize coordinate-based detection with parent's container ref
  const { updateBoundsCache, findNoteAtCoordinates, findNoteUsingOSMD } = 
    useCoordinateBasedNoteDetection(graphicalNoteMap, containerRef || { current: null } as unknown as React.RefObject<HTMLElement>);
  
  // Make OSMD image overlays transparent to clicks
  useEffect(() => {
    const styleId = 'osmd-img-click-through';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        /* RELEASE BLOCKER FIX: Chord fingering clicks intercepted by IMG overlays
         * 
         * PROBLEM: OSMD renders image overlays that capture clicks meant for SVG notes.
         * This prevents getDataNoteId from identifying the correct chord note.
         * 
         * SOLUTION: Make images transparent to pointer events, allowing clicks to
         * reach the underlying SVG elements with data-note-id attributes.
         * 
         * Tested with OSMD 1.9.0. If OSMD adds interactive images in future,
         * they'll need pointer-events: auto override.
         */
        .osmd-container img,
        .osmd-container image {
          pointer-events: none !important;
        }
      `;
      document.head.appendChild(style);
    }
    
    return () => {
      // Clean up on unmount
      const style = document.getElementById(styleId);
      if (style) {
        style.remove();
      }
    };
  }, []);
  
  // DEBUG: Log initialization and test SVG element access
  useEffect(() => {
    if (interactive && graphicalNoteMap && containerRef?.current) {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('Fingering click detection ready', {
          notes: graphicalNoteMap.size,
          container: containerRef.current.className
        });
      }
      
      // Test if SVG element access works
      const firstNote = Array.from(graphicalNoteMap.values())[0];
      if (firstNote) {
        try {
          let svgElement: SVGElement | null = null;
          
          if (typeof firstNote.getSVGGElement === 'function') {
            svgElement = firstNote.getSVGGElement();
          } else if (typeof firstNote.getSVGElement === 'function') {
            svgElement = firstNote.getSVGElement();
          }
          
          if (process.env.NODE_ENV === 'development') {
            perfLogger.debug('First note SVG element test:', {
              noteObject: firstNote,
              hasSVGElement: !!svgElement,
              hasSVGGElement: typeof firstNote.getSVGGElement === 'function',
              hasSVGElementMethod: typeof firstNote.getSVGElement === 'function',
              bounds: svgElement ? svgElement.getBoundingClientRect() : null
            });
          }
        } catch (e) {
          if (process.env.NODE_ENV === 'development') {
            perfLogger.debug('SVG element access failed:', e);
          }
        }
      }
    }
  }, [interactive, graphicalNoteMap, containerRef]);
  const annotations = useFingeringStore(state => state.annotations[scoreId] || {});
  const { setFingering, removeFingering, setFingeringByNoteId, removeFingeringByNoteId } = useFingeringStore();
  
  // Get zoom level for damped scaling
  const zoomLevel = useOSMDStore(state => state.zoomLevel);
  
  // 📊 DEBUG: Log what annotations we have
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug('DISPLAY: Annotations in store:', {
        scoreId,
        annotationCount: Object.keys(annotations).length,
        allAnnotations: annotations,
        annotationFormats: Object.keys(annotations).map(key => {
          const parts = key.split('-');
          return `${key} => format: ${parts.length} parts`;
        })
      });
    }
  }, [scoreId, annotations]);
  const { getFingeringPosition } = useFingeringPositioning();
  const { 
    selectedNoteId, 
    isInputOpen, 
    inputPosition, 
    isEditingMode,
    setEditingMode,
    setActiveInput,
    closeInput,
    handleNoteClick,
    submitFingering 
  } = useFingeringInteraction();

  // Enhanced filtering with viewport and performance limits
  const visibleFingerings = useMemo(() => {
    const startTime = performance.now();
    
    // DEBUG: Log what we're trying to filter
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug('FINGERING DEBUG - visibleFingerings calculation:', {
        annotationsCount: Object.keys(annotations).length,
        visibleTimeRange,
        sampleNoteIds: Object.keys(annotations).slice(0, 3),
        // DEBUG: Show full annotations to see if chord notes both have fingerings
        allAnnotations: annotations
      });
    }
    
    const filtered = Object.entries(annotations).filter(([noteId, finger]) => {
      if (!visibleTimeRange) return true;
      
      // Parse timestamp from noteId (format: t{timestamp}-m{midiValue})
      const timestampMatch = noteId.match(/^t(.+)-m/);
      if (!timestampMatch) {
        // Non-timestamp IDs (e.g. m0-s0-v0-n0-midi60) should be visible
        // This handles the new position-based ID format
        return true;
      }
      
      const timestamp = parseFloat(timestampMatch[1]);
      return timestamp >= visibleTimeRange.start && timestamp <= visibleTimeRange.end;
    });
    
    // Limit rendering for performance (configurable)
    if (filtered.length > MAX_FINGERING_RENDER_LIMIT) {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.warn(`Large number of fingerings (${filtered.length}), limiting to ${MAX_FINGERING_RENDER_LIMIT} for performance`);
      }
      const result = filtered.slice(0, MAX_FINGERING_RENDER_LIMIT);
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('Fingering filtering performance', { 
          duration: performance.now() - startTime,
          totalAnnotations: Object.keys(annotations).length,
          filteredCount: filtered.length,
          renderedCount: result.length
        });
      }
      return result;
    }
    
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug('Fingering filtering performance', { 
        duration: performance.now() - startTime,
        totalAnnotations: Object.keys(annotations).length,
        renderedCount: filtered.length
      });
    }
    
    return filtered;
  }, [annotations, visibleTimeRange]);

  // MINIMAL FIX: Track container version to force recalculation on resize
  const [containerVersion, setContainerVersion] = useState(0);

  // OSMD coordinate conversion constants
  const OSMD_UNIT_TO_PIXELS = 10; // 1 OSMD unit = 10 pixels at zoom 1.0
  const FINGERING_OFFSET_OSMD_UNITS = 0; // No offset - fingering at note position

  // Force cache rebuild when OSMD data changes (ensures fresh position calculations)
  useEffect(() => {
    setContainerVersion(v => v + 1);
  }, [graphicalNoteMap]);

  // Calculate positions using OSMD internal coordinates (ISSUE #10 FIX)
  // This eliminates DOM measurement feedback loop that caused position drift
  const getPosition = useCallback((noteId: string) => {
    if (!graphicalNoteMap || !containerRef?.current) return null;
    
    const graphicalNote = graphicalNoteMap.get(noteId);
    if (!graphicalNote) {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('DISPLAY: Looking for ID:', {
          noteId,
          mapSize: graphicalNoteMap.size,
          sampleMapKeys: Array.from(graphicalNoteMap.keys()).slice(0, 5),
          mismatch: `Expected format from map keys vs actual noteId`
        });
      }
      return null;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    
    try {
      // Get the actual SVG element for accurate visual positioning
      let svgElement = null;
      if (typeof graphicalNote.getSVGGElement === 'function') {
        try {
          svgElement = graphicalNote.getSVGGElement();
        } catch (err) {
          // Silent catch
        }
      }
      
      if (svgElement) {
        // Use actual visual bounds from the rendered SVG
        // getBoundingClientRect() returns viewport coordinates already adjusted for zoom
        const rect = svgElement.getBoundingClientRect();
        
        return {
          x: (rect.left + rect.right) / 2 - containerRect.left,
          y: rect.top - containerRect.top - 15, // 15px above notehead
          noteElement: graphicalNote
        };
      }
      
      // Fallback to OSMD position if no SVG element
      const positionAndShape = graphicalNote.PositionAndShape;
      if (positionAndShape?.AbsolutePosition) {
        const abs = positionAndShape.AbsolutePosition;
        const xPixels = abs.x * OSMD_UNIT_TO_PIXELS;
        const yPixels = (abs.y - FINGERING_OFFSET_OSMD_UNITS) * OSMD_UNIT_TO_PIXELS;
        
        return {
          x: xPixels - containerRect.left,
          y: yPixels - containerRect.top,
          noteElement: graphicalNote
        };
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.warn('Error getting fingering position', { 
          noteId, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }
    
    return null;
  }, [graphicalNoteMap, containerRef, containerVersion]);
  

  // ISSUE #10 FIX: Position cache to prevent DOM measurement feedback loop
  // Calculate all note positions once from clean DOM before any fingerings render
  const notePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; noteElement: any } | null>();
    if (!graphicalNoteMap) return positions;
    
    // Pre-calculate positions for all notes from clean DOM
    // This prevents measuring DOM that includes rendered fingering elements
    for (const [noteId] of graphicalNoteMap) {
      const pos = getPosition(noteId);
      positions.set(noteId, pos);
    }
    
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug('[ISSUE #10 FIX] Note position cache built:', {
        noteCount: positions.size,
        containerVersion,
        timestamp: Date.now()
      });
    }
    
    return positions;
  }, [graphicalNoteMap, containerVersion]);

  // Build chord groupings and calculate vertical offsets
  // MOVED UP: Must be declared before any callbacks that use it
  const chordGroupings = useMemo(() => {
    const staffTimestampMap = new Map<string, Array<{ noteId: string; x: number; y: number; finger: number }>>();
    
    // Group fingerings by TIMESTAMP AND STAFF to prevent cross-staff grouping
    visibleFingerings.forEach(([noteId, finger]) => {
      const pos = notePositions.get(noteId);
      if (pos) {
        // Extract timestamp from noteId (e.g., "m0-s0-v0-n0-ts0_25-midi64" -> "ts0_25")
        const timestampMatch = noteId.match(/ts(\d+_\d+)/);
        const timestamp = timestampMatch ? timestampMatch[0] : 'no-ts';
        
        // Extract staff index from noteId - this should be the actual MusicXML staff
        const staffMatch = noteId.match(/s(\d+)/);
        const staffIndex = staffMatch ? staffMatch[1] : '0';
        
        // Use the actual staff index from MusicXML structure
        // This will be correct once MeasureList orientation is fixed in useOSMD.ts
        const groupKey = `${timestamp}|staff${staffIndex}`;
        
        if (!staffTimestampMap.has(groupKey)) staffTimestampMap.set(groupKey, []);
        staffTimestampMap.get(groupKey)!.push({ noteId, x: pos.x, y: pos.y, finger });
      }
    });
    
    // Calculate offsets for chord notes
    const offsetMap = new Map<string, { x: number; y: number }>();
    
    staffTimestampMap.forEach((notes, groupKey) => {
      if (notes.length > 1) {
        // Real chord - multiple notes at same timestamp
        
        // Sort by MIDI pitch (descending - highest pitch first for top position)
        const sortedNotes = [...notes].sort((a, b) => {
          const midiA = parseInt(a.noteId.match(/midi(\d+)/)?.[1] || '0');
          const midiB = parseInt(b.noteId.match(/midi(\d+)/)?.[1] || '0');
          return midiB - midiA; // Higher MIDI number = higher pitch = should display on top
        });
        
        // Apply vertical spacing
        const VERTICAL_SPACING = 14; // pixels between fingerings
        // Find the topmost Y position (smallest Y value) among all notes
        const topmostY = Math.min(...notes.map(n => n.y));
        
        sortedNotes.forEach((note, index) => {
          offsetMap.set(note.noteId, {
            x: note.x,
            y: topmostY + (index * VERTICAL_SPACING)  // Stack downward from topmost position
          });
        });
      } else {
        // Single note - use original position WITHOUT modification
        notes.forEach(note => {
          offsetMap.set(note.noteId, { x: note.x, y: note.y });
        });
      }
    });
    
    return offsetMap;
  }, [visibleFingerings, notePositions]);

  // Handle click-to-edit functionality
  const handleFingeringSubmit = useCallback(async (value: number | null) => {
    if (!selectedNoteId) return;
    
    try {
      if (value === null) {
        await removeFingeringByNoteId(scoreId, selectedNoteId);
      } else {
        await setFingeringByNoteId(scoreId, selectedNoteId, value);
      }
      closeInput();
    } catch (error) {
      // Guard production logging
      if (process.env.NODE_ENV === 'development') {
        perfLogger.error('Failed to update fingering:', error instanceof Error ? error : new Error(String(error)));
      }
      // In production, could report to monitoring service if needed
    }
  }, [selectedNoteId, scoreId, setFingeringByNoteId, removeFingeringByNoteId, closeInput]);

  // Handle note clicks for editing
  const handleNoteElementClick = useCallback((noteId: string, event: React.MouseEvent) => {
    if (!interactive && !isEditingMode) return;
    
    event.stopPropagation(); // Prevent OSMD handling
    
    // Use adjusted position from chord groupings if available
    const adjustedPos = chordGroupings.get(noteId);
    const position = adjustedPos || notePositions.get(noteId);
    if (position) {
      const currentValue = annotations[noteId] || null;
      setActiveInput(noteId, position, currentValue);
    }
  }, [interactive, isEditingMode, annotations, setActiveInput, chordGroupings, notePositions]);


  // Enable editing mode by default for interactive mode
  useEffect(() => {
    if (interactive && !isEditingMode) {
      setEditingMode(true);
    }
  }, [interactive, isEditingMode, setEditingMode]);

  // Update bounds cache when graphicalNoteMap changes
  useEffect(() => {
    if (graphicalNoteMap && graphicalNoteMap.size > 0 && containerRef?.current) {
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('Updating bounds cache for coordinate detection...');
      }
      
      // Wait for noteheads to appear in DOM before building cache
      let attempts = 0;
      const maxAttempts = 20; // 2 seconds max
      
      const checkAndBuildCache = () => {
        const root = containerRef?.current;
        if (!root) return;

        const hasNoteheads = () => 
          root.querySelector('g.vf-notehead[data-note-id]') !== null;

        // Declare variables before functions that use them (fix temporal dead zone)
        let observer: MutationObserver | null = null;
        let fallbackTimer: number | null = null;

        const updateOnce = () => {
          updateBoundsCache();
          observer?.disconnect();
          if (fallbackTimer) clearTimeout(fallbackTimer);
        };

        if (hasNoteheads()) {
          updateOnce();
          return;
        }

        // Initialize observer for first appearance of noteheads
        observer = new MutationObserver(() => {
          if (hasNoteheads()) updateOnce();
        });

        observer.observe(root, { childList: true, subtree: true });

        // Fallback: stop observing after 2s to avoid leaks
        fallbackTimer = window.setTimeout(() => {
          observer?.disconnect();
        }, 2000);
      };
      
      // Start checking immediately
      checkAndBuildCache();
    }
  }, [graphicalNoteMap, updateBoundsCache, containerRef]);

  // MINIMAL FIX: Force position recalculation when container resizes
  useEffect(() => {
    if (!containerRef?.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Force recalculation of positions by incrementing version
        setContainerVersion(v => v + 1);
      }
    });
    
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [containerRef]); // DRIFT FIX: Removed annotations dependency!

  /**
   * Note Click Detection Priority (Updated 2024-01-12)
   * 
   * 1. data-note-id attribute lookup (PRIMARY) - Most reliable for chords
   * 2. OSMD DOM traversal (FALLBACK) - When attributes missing  
   * 3. Coordinate detection (DEPRECATED) - Complex workaround, keep for compatibility
   * 
   * Previous coordinate-first approach failed for chords due to normalization
   * issues where both clicks would select same note despite different positions.
   * 
   * Research validation confirmed
   * data-note-id approach as industry best practice for SVG element identification.
   */
  useEffect(() => {
    if (!isEditingMode) return;

    const handleGlobalClick = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target) return;

      // Skip if click is on fingering overlay elements or input
      if (target.closest('.fingering-layer') || 
          target.closest('.fingering-number') || 
          target.closest('.fingering-input-container') ||
          target.closest('.fingering-input')) {
        return;
      }

      
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('Click at:', { x: event.clientX, y: event.clientY });
        perfLogger.debug('Note click detected, trying detection methods...');
      }

      // Simplified click traversal
      let noteId = getDataNoteId(event.target as Element);
      
      if (!noteId) {
        // COORDINATE FALLBACK: Use coordinate-based detection
        updateBoundsCache(); // Ensure bounds are fresh
        noteId = findNoteAtCoordinates(event.clientX, event.clientY);
        if (!noteId) {
          return;
        }
      } else {
      }
      
      // TODO: Handle ties - Map to start of tie chain
      // For now, use the noteId as-is since selectNoteFromTies has different signature
      let finalNoteId = noteId;
      
      // Handle comma-separated chord IDs (backwards compatibility fallback)
      if (noteId && noteId.includes(',')) {
        // Take the first ID as fallback
        finalNoteId = noteId.split(',')[0].trim();
      }

      if (finalNoteId) {
        
        if (process.env.NODE_ENV === 'development') {
          perfLogger.debug('CLICK: Found note with ID:', {
            noteId: finalNoteId,
            format: finalNoteId.split('-').length + ' parts',
            parts: finalNoteId.split('-')
          });
        }
        event.stopPropagation();
        
        // Get position for the input - use adjusted position from chord groupings
        const adjustedPos = chordGroupings.get(finalNoteId);
        const position = adjustedPos || notePositions.get(finalNoteId);
        
        
        if (position) {
          // DEBUG: Log what we're getting from annotations (global click)
          const rawValue = annotations[finalNoteId];
          if (process.env.NODE_ENV === 'development') {
            perfLogger.debug('DEBUG currentValue access (global click):', {
              noteId: finalNoteId,
              rawValue,
              isArray: Array.isArray(rawValue),
              type: typeof rawValue
            });
          }
          const currentValue = rawValue || null;
          setActiveInput(finalNoteId, position, currentValue);
        }
      } else {
        if (process.env.NODE_ENV === 'development') {
          perfLogger.debug('All detection methods failed');
        }
      }
    };

    document.addEventListener('click', handleGlobalClick, true);
    return () => document.removeEventListener('click', handleGlobalClick, true);
  }, [isEditingMode, interactive, annotations, setActiveInput, findNoteAtCoordinates, findNoteUsingOSMD, chordGroupings, notePositions]);

  // Get the absolute position for the portal-rendered input
  const getAbsolutePosition = useCallback(() => {
    if (!inputPosition || !containerRef?.current) return null;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    return {
      x: containerRect.left + inputPosition.x,
      y: containerRect.top + inputPosition.y
    };
  }, [inputPosition, containerRef]);


  return (
    <>
      <g 
        className="fingering-layer" 
        data-testid="fingering-layer"
        style={{ pointerEvents: 'none' }}
      >
        {/* REMOVED: Debug log in render loop - threatens <20ms latency */}
        {visibleFingerings.map(([noteId, finger], index) => {
          const adjustedPosition = chordGroupings.get(noteId);
          if (!adjustedPosition) {
            if (process.env.NODE_ENV === 'development') {
              perfLogger.debug('FINGERING DEBUG - No position for noteId:', noteId);
            }
            return null;
          }
          

          const isEditing = selectedNoteId === noteId;
          
          // REMOVED: Debug log in render loop - threatens <20ms latency
          
          return (
            <text
              key={`${noteId}-${finger}`}
              x={adjustedPosition.x}
              y={adjustedPosition.y}
              className={`fingering-number ${isEditing ? 'editing' : ''}`}
              aria-label={`Fingering ${finger} for note at timestamp ${noteId.split('-')[0].slice(1)}`}
              role="img"
              style={{
                // Damped scaling: text scales WITH zoom but slower
                fontSize: `${Math.min(20, Math.max(9, 12 * Math.sqrt(Math.max(0.25, zoomLevel ?? 1))))}px`,
                fontFamily: 'Arial, sans-serif',
                fontWeight: 'bold',
                // Theme-aware colors with fallbacks
                fill: isEditing ? 'var(--abc-accent-primary, #0066cc)' : 'var(--abc-sheet-ink, #000080)',
                // Contrast stroke with background color
                stroke: 'var(--abc-bg-primary, #ffffff)',
                strokeWidth: `${Math.min(2.5, Math.max(0.75, 1.5 * Math.sqrt(Math.max(0.25, zoomLevel ?? 1))))}px`,
                paintOrder: 'stroke',
                textAnchor: 'middle',
                dominantBaseline: 'central',
                pointerEvents: (interactive || isEditingMode) ? 'auto' : 'auto',
                userSelect: 'none',
                cursor: (interactive || isEditingMode) ? 'pointer' : 'default'
              }}
              data-testid={`fingering-${noteId}-${finger}`}
              onClick={(e) => {
                if (process.env.NODE_ENV === 'development') {
                  perfLogger.debug('DIRECT FINGERING CLICK:', { noteId, finger });
                }
                if (onFingeringClick) {
                  onFingeringClick(noteId, finger);
                } else {
                  handleNoteElementClick(noteId, e);
                }
              }}
            >
              {finger}
            </text>
          );
        })}
      </g>
      
      {/* Render input outside SVG using Portal */}
      {isInputOpen && inputPosition && selectedNoteId && (() => {
        const absPos = getAbsolutePosition();
        if (!absPos) return null;
        
        return ReactDOM.createPortal(
          <FingeringInlineInput
            position={absPos}
            initialValue={null} // Always start empty to add new fingerings
            onSubmit={handleFingeringSubmit}
            onCancel={closeInput}
          />,
          document.body
        );
      })()}
    </>
  );
};