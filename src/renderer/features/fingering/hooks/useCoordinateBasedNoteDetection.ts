/**
 * Coordinate-based note detection for fingering clicks
 * 
 * This is a workaround for the data-note-id injection issue.
 * Instead of relying on DOM attributes, we use the graphicalNoteMap
 * to find notes based on click coordinates.
 */

import { useCallback, useRef } from 'react';
import { selectNoteFromTies } from '../utils/selectNoteFromTies';
import { extractFirstDataNoteId } from '@/renderer/utils/noteUtils';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GraphicalNoteWithBounds {
  noteId: string;
  graphicalNote: any;
  bounds?: BoundingBox;
}

export const useCoordinateBasedNoteDetection = (
  graphicalNoteMap: Map<string, any> | undefined,
  containerRef: React.RefObject<HTMLElement>
) => {
  // Cache bounds for performance
  const boundsCache = useRef<Map<string, GraphicalNoteWithBounds>>(new Map());
  
  // Update bounds cache when graphicalNoteMap changes
  const updateBoundsCache = useCallback(() => {
    if (!containerRef.current) return;
    
    boundsCache.current.clear();
    const container = containerRef.current;
    
    // Query notehead elements directly for precise bounds
    // Fixed selector: Matches OSMD/VexFlow noteheads (g.vf-notehead with data-note-id)
    const noteheadElements = container.querySelectorAll('g.vf-notehead[data-note-id]');
    const containerRect = container.getBoundingClientRect();
    
    // Build bounds cache from notehead elements
    noteheadElements.forEach(el => {
      const id = el.getAttribute('data-note-id');
      if (!id) return;
      
      const rect = el.getBoundingClientRect();
      const bounds = {
        x: rect.left - containerRect.left,
        y: rect.top - containerRect.top,
        width: rect.width,
        height: rect.height
      };
      
      boundsCache.current.set(id, {
        noteId: id,
        graphicalNote: graphicalNoteMap?.get(id),
        bounds
      });
      
    });
  }, [containerRef, graphicalNoteMap]);
  
  // Simplified findNoteAtCoordinates with closest-match fallback
  const findNoteAtCoordinates = useCallback((clientX: number, clientY: number): string | null => {
    if (!containerRef.current) return null;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const relativeX = clientX - containerRect.left;
    const relativeY = clientY - containerRect.top;
    
    // Direct hit check
    for (const [id, noteData] of boundsCache.current) {
      const { bounds } = noteData;
      if (!bounds) continue;
      
      if (relativeX >= bounds.x && relativeX <= bounds.x + bounds.width &&
          relativeY >= bounds.y && relativeY <= bounds.y + bounds.height) {
        return id;
      }
    }
    
    // Closest match fallback (for near-misses)
    let closest: string | null = null;
    let minDist = Infinity;
    
    for (const [id, noteData] of boundsCache.current) {
      const { bounds } = noteData;
      if (!bounds) continue;
      
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      const dist = Math.hypot(relativeX - centerX, relativeY - centerY);
      
      if (dist < minDist) {
        minDist = dist;
        closest = id;
      }
    }
    
    return minDist < 20 ? closest : null; // 20px threshold for "close enough"
  }, [containerRef]);
  
  // Alternative: Find note using OSMD's internal hit testing
  const findNoteUsingOSMD = useCallback((event: MouseEvent): string | null => {
    if (!graphicalNoteMap || !containerRef.current) return null;
    
    // Get all potential note elements at click position
    const elementsAtPoint = document.elementsFromPoint(event.clientX, event.clientY);
    
    // FIRST: Check ALL elements at click point for data-note-id
    // Start from the topmost element (first in array) which is the actual clicked element
    for (const element of elementsAtPoint) {
      if (element instanceof Element && element.hasAttribute('data-note-id')) {
        const noteId = extractFirstDataNoteId(element.getAttribute('data-note-id'));
        if (noteId) {
          return noteId;
        }
      }
    }
    
    // SECOND: If no direct hit, try closest() as fallback
    for (const element of elementsAtPoint) {
      if (element instanceof Element) {
        const noteElement = element.closest('[data-note-id]');
        if (noteElement && noteElement.hasAttribute('data-note-id')) {
          const noteId = extractFirstDataNoteId(noteElement.getAttribute('data-note-id'));
          if (noteId) {
            return noteId;
          }
        }
      }
    }
    
    // FALLBACK: Removed - causes wrong chord note selection
    // The primary data-note-id lookup should handle all cases
    // If it fails, the click detection has deeper issues that need investigation
    
    return null;
  }, [graphicalNoteMap, containerRef]);
  
  return {
    updateBoundsCache,
    findNoteAtCoordinates,
    findNoteUsingOSMD
  };
};