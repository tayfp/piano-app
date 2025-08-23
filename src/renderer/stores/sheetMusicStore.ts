import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getFileLoader } from '../services/FileLoaderService';
import { recentFilesService, type RecentFileMetadata } from '../services/RecentFilesService';
import type { FileData, RecentFile, LoadState } from '../../common/types';
import { perfLogger } from '@/renderer/utils/performance-logger';

// Robust scoreId generator with collision resistance
const generateScoreId = (fileName: string, content: string): string => {
  const name = fileName.replace(/\.(xml|musicxml|mxl)$/i, '');
  const len = content.length;

  // FNV-1a 32-bit hash over first 4KB + file length for collision resistance
  let hash = 0x811c9dc5 >>> 0; // FNV offset basis
  const limit = Math.min(len, 4096);
  
  for (let i = 0; i < limit; i++) {
    hash ^= content.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0; // FNV prime
  }
  
  // Mix in file length to differentiate files with identical prefixes
  hash ^= len >>> 0;
  hash = Math.imul(hash, 0x01000193) >>> 0;

  return `${name}_${hash.toString(16)}`;
};

interface SheetMusicState {
  // Current file state
  musicXML: string | null;
  fileName: string | null;
  fileSize: number | null;
  scoreId: string | null; // Added for fingering system
  
  // Loading states
  loadState: LoadState;
  error: string | null;
  
  // Recent files (persisted via RecentFilesService)
  recentFiles: RecentFileMetadata[];
  maxRecentFiles: number;
  
  // Actions
  loadFromDialog: () => Promise<void>;
  loadFromFile: (fileName: string, content: string, size: number) => Promise<void>;
  clearScore: () => void;
  clearError: () => void;
  
  // Version Recent files methods (RecentFilesService integration)
  loadRecentFiles: () => void;
  addRecentFile: (metadata: RecentFileMetadata) => void;
  clearRecentFiles: () => void;
  
  // Backward compatibility (Phase 1/2 methods)
  addToRecent: (file: RecentFile) => void;
  removeFromRecent: (path: string) => void;
  loadFromRecent: (path: string) => Promise<void>;
}

export const useSheetMusicStore = create<SheetMusicState>()(
  persist(
    (set, get) => {
      // Initialize recent files from service safely
      let initialRecentFiles: RecentFileMetadata[] = [];
      try {
        initialRecentFiles = recentFilesService.get();
      } catch (error) {
        perfLogger.error('Failed to initialize recent files from service', error);
      }
      
      return {
        // Initial state
        musicXML: null,
        fileName: null,
        fileSize: null,
        scoreId: null,
        loadState: 'idle',
        error: null,
        recentFiles: initialRecentFiles, // Load from RecentFilesService
        maxRecentFiles: 5, // Version Reduced to 5 for UI
        
        // Load file via dialog
        loadFromDialog: async () => {
        set({ loadState: 'loading', error: null });
        
        try {
          const fileLoader = getFileLoader();
          const result = await fileLoader.loadFile();
          
          if (!result) {
            // User canceled - return to idle
            set({ loadState: 'idle' });
            return;
          }
          
          // Validate required fields (defensive programming)
          if (!result.content || !result.fileName || typeof result.fileSize !== 'number') {
            throw new Error('Invalid file data received from IPC');
          }
          
          // Additional content validation in renderer (defense in depth)
          if (!result.content.includes('<?xml')) {
            throw new Error('File does not contain valid XML');
          }
          
          if (!result.content.includes('<score-partwise') && !result.content.includes('<score-timewise')) {
            throw new Error('File is not a valid MusicXML document');
          }
          
          // Check uncompressed size in renderer as well (25MB limit)
          const contentSize = new Blob([result.content]).size;
          if (contentSize > 25 * 1024 * 1024) {
            throw new Error('File content exceeds maximum size limit (25MB)');
          }
          
          // Generate scoreId for fingering system
          const scoreId = generateScoreId(result.fileName, result.content);
          
          // Update state with loaded file
          set({
            musicXML: result.content,
            fileName: result.fileName,
            fileSize: result.fileSize,
            scoreId,
            loadState: 'success',
            error: null
          });
          
          // Add to recent files (Version Using RecentFilesService)
          get().addRecentFile({
            name: result.fileName,
            size: result.fileSize,
            lastOpened: new Date().toISOString()
          });
          
        } catch (error) {
          perfLogger.error('File loading error:', error);
          set({
            loadState: 'error',
            error: error instanceof Error ? error.message : 'Unknown error occurred'
          });
        }
      },
      
      // Load from file content (for drag-drop support in future phases)
      loadFromFile: async (fileName: string, content: string, size: number) => {
        set({ loadState: 'loading', error: null });
        
        try {
          // Validate MusicXML content
          if (!content.includes('<?xml') || 
              (!content.includes('<score-partwise') && !content.includes('<score-timewise'))) {
            throw new Error('Invalid MusicXML format');
          }
          
          // Size validation
          if (size > 25 * 1024 * 1024) {
            throw new Error('File exceeds maximum size limit (25MB)');
          }
          
          // Generate scoreId for fingering system
          const scoreId = generateScoreId(fileName, content);
          
          set({
            musicXML: content,
            fileName,
            fileSize: size,
            scoreId,
            loadState: 'success',
            error: null
          });
          
          get().addRecentFile({
            name: fileName,
            size,
            lastOpened: new Date().toISOString()
          });
          
        } catch (error) {
          set({
            loadState: 'error',
            error: error instanceof Error ? error.message : 'Unknown error occurred'
          });
        }
      },
      
      // Clear current score
      clearScore: () => {
        set({
          musicXML: null,
          fileName: null,
          fileSize: null,
          scoreId: null,
          loadState: 'idle',
          error: null
        });
      },
      
      // Clear error state only
      clearError: () => {
        set({ error: null });
      },
      
      // Version Recent files methods (RecentFilesService integration)
      loadRecentFiles: () => {
        const recent = recentFilesService.get();
        set({ recentFiles: recent });
      },
      
      addRecentFile: (metadata: RecentFileMetadata) => {
        recentFilesService.add(metadata);
        const updated = recentFilesService.get();
        set({ recentFiles: updated });
      },
      
      clearRecentFiles: () => {
        recentFilesService.clear();
        set({ recentFiles: [] });
      },
      
      // Backward compatibility: Recent files management (Phase 1/2)
      addToRecent: (file: RecentFile) => {
        // Convert to new format and delegate to new method
        const metadata: RecentFileMetadata = {
          name: file.name,
          size: file.size,
          lastOpened: file.date
        };
        get().addRecentFile(metadata);
      },
      
      removeFromRecent: (path: string) => {
        // Note: Since we no longer store paths, this removes by name
        const fileName = path.split('/').pop() || path;
        const current = recentFilesService.get();
        const filtered = current.filter(f => f.name !== fileName);
        
        // Replace entire list in service
        recentFilesService.clear();
        filtered.forEach(file => recentFilesService.add(file));
        
        set({ recentFiles: filtered });
      },
      
      // Load from recent (placeholder - needs IPC support in Phase 3)
      loadFromRecent: async (path: string) => {
        perfLogger.debug('[SheetMusicStore] Loading from recent', { path });
        set({ 
          loadState: 'error',
          error: 'Loading recent files is not yet implemented in Phase 1' 
        });
      }
      };
    },
    {
      name: 'sheet-music-storage',
      // Version Recent files now handled by RecentFilesService
      // Only persist non-sensitive settings and UI preferences
      partialize: (state) => ({ 
        maxRecentFiles: state.maxRecentFiles,
        // Don't persist musicXML or temporary state
      })
    }
  )
);

// Convenience hook for just the loading state (useful for UI components)
export const useSheetMusicLoadState = () => useSheetMusicStore(state => state.loadState);

// Convenience hook for recent files (useful for recent files dropdown)
export const useRecentFiles = () => useSheetMusicStore(state => state.recentFiles);