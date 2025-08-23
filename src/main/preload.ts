import { perfLogger } from './utils/performance-logger';
// Preload script for Urtext Piano with secure file operations
const { contextBridge, ipcRenderer } = require('electron');

// Debug: Verify preload script is executing
perfLogger.debug('[PRELOAD] Urtext Piano preload script loaded successfully');

// Only log detailed process info in development mode
if (process.env.NODE_ENV === 'development') {
  perfLogger.debug('[PRELOAD] Process info', { 
    cwd: process.cwd(), 
    env: process.env.NODE_ENV,
    platform: process.platform
  });
}

// Security validation - ensure no Node.js globals are accessible
if (process.env.NODE_ENV === 'development') {
  // Log security status for development (only in verbose debug mode)
  const isVerbose = process.env.DEBUG === 'verbose' || process.env.ELECTRON_DEBUG === 'true';
  if (isVerbose) {
    perfLogger.debug('[PRELOAD] Security check', {
      nodeIntegration: process.versions ? 'ENABLED (INSECURE)' : 'DISABLED',
      contextIsolation: window === self ? 'DISABLED (INSECURE)' : 'ENABLED',
      sandbox: typeof require === 'undefined' ? 'ENABLED' : 'DISABLED',
    });
  }
}

// Expose secure file operations to renderer via context bridge
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations - returns FileData directly (synchronous-style for FileLoaderService)
  openFile: () => ipcRenderer.invoke('dialog:openFileSync'),
  
  // Drag-drop file operations - handles ArrayBuffer for .mxl files
  loadDroppedFile: (fileName, fileBuffer) => 
    ipcRenderer.invoke('file:loadContent', fileName, fileBuffer),
    
  // CRITICAL FIX: Fast path to get file content by ID
  getFileContent: (fileId) => 
    ipcRenderer.invoke('file:getContent', fileId)
});

// Also expose window.api for the new async pattern (Phase 1)
contextBridge.exposeInMainWorld('api', {
  // File operations
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  getFileContent: (jobId) => ipcRenderer.invoke('file:getContent', jobId),
  
  // Event listeners
  on: (channel, callback) => {
    const validChannels = ['file:ready', 'file:error', 'file:chunk'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
  
  // Remove listeners
  removeAllListeners: (channel) => {
    const validChannels = ['file:ready', 'file:error', 'file:chunk'];
    if (validChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  }
});

// TypeScript global augmentation for renderer process
declare global {
  interface Window {
    electronAPI: {
      openFile: () => Promise<any>;
      loadDroppedFile: (fileName: string, fileBuffer: ArrayBuffer) => Promise<any>;
      getFileContent: (fileId: string) => Promise<string>;
    };
    api: {
      openFile: () => Promise<{ jobId: string; status: string } | null>;
      getFileContent: (jobId: string) => Promise<{
        success: boolean;
        content?: string;
        fileName?: string;
        fileSize?: number;
        tempoData?: Array<{
          measureNumber: number;
          bpm: number;
          offset?: number;
          beat?: number;
          text?: string;
          source: 'direction' | 'sound' | 'metronome';
          sourceMeasure?: number;
          sourcePart?: string;
        }>; // Version XML tempo data
        error?: string;
      }>;
      on: (channel: string, callback: (...args: any[]) => void) => void;
      removeAllListeners: (channel: string) => void;
    };
  }
}