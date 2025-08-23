import { perfLogger } from '@/renderer/utils/performance-logger';
/**
 * Recent Files Service - localStorage Abstraction
 * 
 * Version Production Features - Recent Files & Optimization
 * 
 * Provides secure localStorage abstraction for recent file metadata.
 * NO file paths stored - only metadata (name, size, date) for security.
 * 
 * Pattern: Component → Store → Service → localStorage
 * Validated approach for recent files management
 */

export interface RecentFileMetadata {
  name: string;
  size: number;
  lastOpened: string; // ISO 8601 string
}

const STORAGE_KEY = 'abc-piano-recent-files';
const MAX_FILES = 5;

/**
 * RecentFilesService - Stateless service for recent files persistence
 * 
 * Security: No file paths stored, only metadata
 * Performance: Simple localStorage operations, <1ms per call
 * Error Handling: Graceful degradation on localStorage errors
 */
export const recentFilesService = {
  /**
   * Get all recent files from localStorage
   * @returns Array of recent file metadata (empty on error)
   */
  get(): RecentFileMetadata[] {
    try {
      const rawData = localStorage.getItem(STORAGE_KEY);
      if (!rawData) {
        return [];
      }
      
      const parsed = JSON.parse(rawData);
      
      // Validate data structure
      if (!Array.isArray(parsed)) {
        perfLogger.warn('Recent files data is not an array, resetting');
        return [];
      }
      
      // Validate each item
      const validated = parsed.filter(item => 
        item && 
        typeof item.name === 'string' && 
        typeof item.size === 'number' && 
        typeof item.lastOpened === 'string'
      );
      
      return validated;
    } catch (error) {
      perfLogger.error('Failed to parse recent files from localStorage:', error);
      return [];
    }
  },

  /**
   * Add a recent file to the top of the list
   * Removes duplicates and enforces max limit
   * @param file Recent file metadata
   */
  add(file: RecentFileMetadata): void {
    try {
      let files = this.get();
      
      // Remove any existing entry with the same name (move to top)
      files = files.filter(f => f.name !== file.name);
      
      // Add new file to the top
      files.unshift(file);
      
      // Enforce max files limit
      const limitedFiles = files.slice(0, MAX_FILES);
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(limitedFiles));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        perfLogger.warn('localStorage quota exceeded, cannot save recent files');
      } else {
        perfLogger.error('Failed to save recent file to localStorage:', error);
      }
    }
  },

  /**
   * Clear all recent files
   */
  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      perfLogger.error('Failed to clear recent files from localStorage:', error);
    }
  }
};

// Export for testing/mocking
export { STORAGE_KEY, MAX_FILES };