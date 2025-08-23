/**
 * Centralized IPC Handler Registration
 * 
 * Architecture: Clean separation of handler registration
 * Innovation: Type-safe channels and gradual rollout support
 * Implementation: Practical feature flag system
 */

import { ipcMain } from 'electron';
import { perfLogger } from './utils/performance-logger';
import {
  handleFileOpen,
  handleFileOpenAndWait,
  handleFileLoadContent,
  cleanupWorkers
} from './handlers/fileHandlers';

// Type-safe IPC channels for compile-time validation
export type IpcChannel = 
  | 'dialog:openFile'
  | 'dialog:openFileSync' 
  | 'file:loadContent'
  | 'file:getContent';

export interface IpcRegistrationConfig {
  enableWorkerThreads: boolean;
  enablePerformanceMonitoring: boolean;
}

// Default configuration - can be overridden via environment variables
const DEFAULT_CONFIG: IpcRegistrationConfig = {
  enableWorkerThreads: process.env.ENABLE_WORKER_THREADS === 'true',
  enablePerformanceMonitoring: process.env.ENABLE_PERF_MONITORING === 'true'
};

/**
 * Central IPC handler registration with enhancements
 * 
 * Features:
 * - Type-safe channel management
 * - Performance monitoring
 * - Clean architecture
 */
export function registerAllIpcHandlers(config: Partial<IpcRegistrationConfig> = {}): void {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  perfLogger.debug('🔧 Registering IPC handlers with configuration:', {
    workerThreads: finalConfig.enableWorkerThreads,
    performanceMonitoring: finalConfig.enablePerformanceMonitoring
  });

  // Register enhanced file handlers
  if (finalConfig.enableWorkerThreads) {
    registerEnhancedFileHandlers(finalConfig);
  } else {
    perfLogger.debug('📝 Enhanced handlers disabled - using legacy implementation');
  }

  // Register shutdown cleanup
  registerShutdownHandlers();

  perfLogger.debug('✅ All IPC handlers registered successfully');
}

/**
 * Register enhanced file handlers with worker threads and performance optimizations
 * Implementation
 */
function registerEnhancedFileHandlers(config: IpcRegistrationConfig): void {
  perfLogger.debug('🚀 Registering enhanced file handlers...');
  
  // Always use direct registration - gradual rollout was broken and removed
  registerDirectHandlers();
}


/**
 * Direct registration of enhanced handlers (no rollout)
 */
function registerDirectHandlers(): void {
  perfLogger.debug('⚡ Registering direct enhanced handlers...');

  // Clean, direct handler registration
  ipcMain.handle('dialog:openFile', handleFileOpen);
  ipcMain.handle('dialog:openFileSync', handleFileOpenAndWait);
  ipcMain.handle('file:loadContent', handleFileLoadContent);
  
  // Note: file:getContent is handled directly in fileHandlers.ts registration
  
  perfLogger.debug('✅ Direct enhanced handlers registered');
}

/**
 * Register shutdown and cleanup handlers
 */
function registerShutdownHandlers(): void {
  perfLogger.debug('🧹 Registering shutdown handlers...');
  
  // Register cleanup handler for app shutdown
  process.on('beforeExit', async () => {
    perfLogger.debug('🔄 Cleaning up workers before exit...');
    try {
      await cleanupWorkers();
      perfLogger.debug('✅ Worker cleanup completed');
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      perfLogger.error('❌ Worker cleanup failed:', error);
    }
  });
}

/**
 * Utility function to validate IPC channel names at compile time
 * (Preventing future registration gaps)
 */
export function validateIpcChannel(channel: string): channel is IpcChannel {
  const validChannels: IpcChannel[] = [
    'dialog:openFile',
    'dialog:openFileSync',
    'file:loadContent', 
    'file:getContent'
  ];
  
  return validChannels.includes(channel as IpcChannel);
}

/**
 * Development utility to list all registered IPC handlers
 * (For debugging and validation)
 */
export function listRegisteredHandlers(): string[] {
  if (process.env.NODE_ENV === 'development') {
    // This is a simplified version - in practice you'd track registrations
    return [
      'dialog:openFile',
      'dialog:openFileSync',
      'file:loadContent',
      'file:getContent'
    ];
  }
  return [];
}

/**
 * Performance monitoring utility
 * (For maintaining <20ms MIDI latency)
 */
export function createPerformanceWrapper<T extends Function>(
  handler: T, 
  channelName: string,
  maxLatencyMs: number = 20
): T {
  return (async (...args: any[]) => {
    const startTime = performance.now();
    try {
      const result = await handler(...args);
      const duration = performance.now() - startTime;
      
      if (duration > maxLatencyMs) {
        perfLogger.warn(`⚠️ [${channelName}] Latency warning: ${duration.toFixed(2)}ms > ${maxLatencyMs}ms`);
      }
      
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug(`📊 [${channelName}] Completed in ${duration.toFixed(2)}ms`);
      }
      
      return result;
    } catch (err: unknown) {
      const duration = performance.now() - startTime;
      const error = err instanceof Error ? err : new Error(String(err));
      perfLogger.error(`❌ [${channelName}] Failed after ${duration.toFixed(2)}ms:`, error);
      throw error;
    }
  }) as unknown as T;
}