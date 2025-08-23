// File loading abstraction for renderer process
import type { FileData } from '../../common/types';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { TempoService } from '../features/tempo-extraction/services/TempoService';

export interface IFileLoader {
  loadFile(): Promise<FileData | null>;
  loadFromFile(file: File): Promise<FileData | null>;
}

export class ElectronFileLoader implements IFileLoader {
  async loadFile(): Promise<FileData | null> {
    // Enhanced error checking with debug info
    if (!window.electronAPI) {
      perfLogger.error('[FileLoader] window.electronAPI is undefined');
      perfLogger.error('[FileLoader] Available window properties:', Object.keys(window));
      throw new Error('Electron API not available. Preload script may not have loaded correctly.');
    }
    
    if (!window.electronAPI.openFile || !window.electronAPI.getFileContent) {
      perfLogger.error('[FileLoader] electronAPI methods missing:', {
        hasOpenFile: !!window.electronAPI.openFile,
        hasGetFileContent: !!window.electronAPI.getFileContent,
        availableMethods: Object.keys(window.electronAPI)
      });
      throw new Error('File operations not available. Please ensure you are running in Electron.');
    }
    
    // CRITICAL FIX: Two-phase loading for performance
    const startTime = performance.now();
    
    try {
      // Version Get file metadata quickly (no content transfer over IPC)
      const fileInfo = await window.electronAPI.openFile();
      if (!fileInfo) return null; // User cancelled
      
      const phase1Duration = performance.now() - startTime;
      perfLogger.debug(` File info loaded in ${phase1Duration.toFixed(0)}ms`);
      
      // Version Handle content loading (sync vs async patterns)
      if (fileInfo.content) {
        // Synchronous path: content already included (handleFileOpenAndWait)
        perfLogger.debug(` Content already included in sync response`);
        
        // DEBUG: Check what we actually received
        if ((fileInfo as any).tempoData) {
        }
        
        // Version Wire tempo data to TempoService from sync response
        if ((fileInfo as any).tempoData) {
          const tempoService = TempoService.getInstance();
          const cacheKey = this.generateCacheKey(fileInfo.fileName, fileInfo.content);
          tempoService.setXMLTempoData(cacheKey, (fileInfo as any).tempoData);
          perfLogger.debug(`[TEMPO V2] Loaded from file: ${(fileInfo as any).tempoData.length} events`);
        }
        
        return fileInfo;
      } else if (fileInfo.fileId) {
        // Async path: fetch content separately (handleFileOpen)
        const contentStartTime = performance.now();
        const response = await window.electronAPI.getFileContent(fileInfo.fileId);
        const phase2Duration = performance.now() - contentStartTime;
        perfLogger.debug(` File content loaded in ${phase2Duration.toFixed(0)}ms`);
        
        // Version Check if content retrieval was successful
        if (!response.success) {
          throw new Error(response.error || 'Failed to load file content');
        }
        
        // Validate content exists
        if (!response.content) {
          throw new Error('File content is empty or missing');
        }
        
        // Version Wire tempo data to TempoService from async response
        if (response.tempoData) {
          const tempoService = TempoService.getInstance();
          const cacheKey = this.generateCacheKey(response.fileName || fileInfo.fileName, response.content);
          tempoService.setXMLTempoData(cacheKey, response.tempoData);
          perfLogger.debug(`[TEMPO V2] Loaded from file: ${response.tempoData.length} events`);
        }
        
        return {
          ...fileInfo,
          content: response.content
        };
      }
      
      // Fallback for backward compatibility
      return fileInfo;
    } catch (error) {
      const duration = performance.now() - startTime;
      perfLogger.error(`File loading failed after ${duration.toFixed(0)}ms:`, error);
      throw error;
    }
  }

  async loadFromFile(file: File): Promise<FileData | null> {
    if (!window.electronAPI?.loadDroppedFile || !window.electronAPI?.getFileContent) {
      throw new Error('File operations not available. Please ensure you are running in Electron.');
    }

    // Security: Check file size before reading
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File exceeds size limit of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    // Validate file type
    const validExtensions = ['.xml', '.musicxml', '.mxl'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!validExtensions.includes(ext)) {
      throw new Error('Invalid file type. Only .xml, .musicxml, and .mxl files are supported.');
    }

    // CRITICAL FIX: Two-phase loading for drag-drop
    const startTime = performance.now();

    try {
      // Version Send file metadata to main process
      let fileInfo: FileData | null;

      if (ext === '.mxl') {
        // Handle .mxl files with ArrayBuffer
        const arrayBuffer = await this.readFileAsArrayBuffer(file);
        fileInfo = await window.electronAPI.loadDroppedFile(file.name, arrayBuffer);
      } else {
        // Handle .xml files with text content
        const content = await this.readFileAsText(file);
        const arrayBuffer = new TextEncoder().encode(content).buffer;
        fileInfo = await window.electronAPI.loadDroppedFile(file.name, arrayBuffer);
      }

      if (!fileInfo) return null;

      const phase1Duration = performance.now() - startTime;
      perfLogger.debug(` Drag-drop file info processed in ${phase1Duration.toFixed(0)}ms`);

      // Version Handle content loading (drag-drop uses sync pattern)
      if (fileInfo.content) {
        // Synchronous path: content already included (handleFileLoadContent)
        perfLogger.debug(` Drag-drop content already included in sync response`);
        
        // Version Wire tempo data to TempoService from sync response
        if ((fileInfo as any).tempoData) {
          const tempoService = TempoService.getInstance();
          const cacheKey = this.generateCacheKey(fileInfo.fileName, fileInfo.content);
          tempoService.setXMLTempoData(cacheKey, (fileInfo as any).tempoData);
          perfLogger.debug(`[TEMPO V2] Loaded from file: ${(fileInfo as any).tempoData.length} events`);
        }
        
        return fileInfo;
      } else if (fileInfo.fileId) {
        // Async path: fetch content separately (shouldn't happen for drag-drop)
        const contentStartTime = performance.now();
        const response = await window.electronAPI.getFileContent(fileInfo.fileId);
        const phase2Duration = performance.now() - contentStartTime;
        perfLogger.debug(` Drag-drop content loaded in ${phase2Duration.toFixed(0)}ms`);
        
        // Version Check if content retrieval was successful
        if (!response.success) {
          throw new Error(response.error || 'Failed to load drag-drop file content');
        }
        
        // Validate content exists
        if (!response.content) {
          throw new Error('Drag-drop file content is empty or missing');
        }
        
        // Version Wire tempo data to TempoService from async response
        if (response.tempoData) {
          const tempoService = TempoService.getInstance();
          const cacheKey = this.generateCacheKey(response.fileName || fileInfo.fileName, response.content);
          tempoService.setXMLTempoData(cacheKey, response.tempoData);
          perfLogger.debug(`[TEMPO V2] Loaded from file: ${response.tempoData.length} events`);
        }
        
        return {
          ...fileInfo,
          content: response.content
        };
      }

      // Fallback for backward compatibility
      return fileInfo;
    } catch (error) {
      const duration = performance.now() - startTime;
      perfLogger.error(`File loading failed after ${duration.toFixed(0)}ms:`, error);
      throw error;
    }
  }

  private readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to read file as ArrayBuffer'));
        }
      };
      reader.onerror = () => reject(new Error('File reading failed'));
      reader.readAsArrayBuffer(file);
    });
  }

  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to read file as text'));
        }
      };
      reader.onerror = () => reject(new Error('File reading failed'));
      reader.readAsText(file);
    });
  }
  
  /**
   * Generate cache key for tempo data (Phase 3)
   * Creates a consistent key that matches TempoService expectations
   */
  private generateCacheKey(fileName?: string, content?: string): string {
    try {
      // Extract basic info from filename
      const name = fileName || 'untitled';
      const baseName = name.replace(/\.(xml|musicxml|mxl)$/i, '');
      
      // Simple content hash for uniqueness
      let contentHash = '0';
      if (content) {
        // Basic hash of content length and first/last chars
        const firstChar = content.charCodeAt(0) || 0;
        const lastChar = content.charCodeAt(content.length - 1) || 0;
        contentHash = (content.length + firstChar + lastChar).toString(16);
      }
      
      return `${baseName}::${contentHash}::file`;
    } catch {
      return 'unknown::unknown::file';
    }
  }
}

// Mock loader for testing scenarios
export class MockFileLoader implements IFileLoader {
  constructor(private mockResponse: FileData | null | Error) {}
  
  async loadFile(): Promise<FileData | null> {
    // Simulate some async delay for realistic testing
    await new Promise(resolve => setTimeout(resolve, 10));
    
    if (this.mockResponse instanceof Error) {
      throw this.mockResponse;
    }
    return this.mockResponse;
  }

  async loadFromFile(file: File): Promise<FileData | null> {
    // Simulate some async delay for realistic testing
    await new Promise(resolve => setTimeout(resolve, 10));
    
    if (this.mockResponse instanceof Error) {
      throw this.mockResponse;
    }
    
    // If we have a mock response, return it with file info
    if (this.mockResponse) {
      return {
        ...this.mockResponse,
        fileName: file.name,
        fileSize: file.size
      };
    }
    
    return this.mockResponse;
  }
}

// Factory function for environment-aware creation
export function createFileLoader(): IFileLoader {
  if (process.env.NODE_ENV === 'test') {
    // Return mock loader with null response in tests by default
    return new MockFileLoader(null);
  }
  return new ElectronFileLoader();
}

// Singleton instance management
let fileLoaderInstance: IFileLoader | null = null;

export function getFileLoader(): IFileLoader {
  if (!fileLoaderInstance) {
    fileLoaderInstance = createFileLoader();
  }
  return fileLoaderInstance;
}

// Reset for testing - allows clean state between tests
export function resetFileLoader(): void {
  fileLoaderInstance = null;
}

// Test utilities for easier mock creation
export const FileLoaderTestUtils = {
  createMockFileData: (overrides?: Partial<FileData>): FileData => ({
    fileName: 'test.xml',
    content: '<?xml version="1.0"?><score-partwise></score-partwise>',
    fileSize: 1024,
    ...overrides
  }),
  
  createMockError: (message: string = 'Mock error'): Error => {
    return new Error(message);
  }
};