/**
 * Utility for extracting data-note-id from DOM elements
 * 
 * Centralized note ID resolution using Element.closest() for reliable
 * traversal up the DOM tree to find the nearest element with data-note-id.
 * 
 * This approach:
 * - Works reliably with chords (each note has unique ID)
 * - O(1) performance vs O(n) coordinate calculations
 * - No complex math or normalization issues
 * - Already injected by OSMD rendering pipeline
 */
export function getDataNoteId(element: Element | null): string | null {
  if (!element) return null;
  
  const found = element.closest('[data-note-id]');
  if (!found) return null;
  
  const id = found.getAttribute('data-note-id')?.trim();
  return id && id.length > 0 ? id : null;
}

/**
 * Extract note ID and handle comma-separated chord IDs (backwards compatibility)
 */
export function getFirstNoteId(element: Element | null): string | null {
  const noteId = getDataNoteId(element);
  if (!noteId) return null;
  
  // Handle comma-separated chord IDs - take first ID
  return noteId.includes(',') ? noteId.split(',')[0].trim() : noteId;
}