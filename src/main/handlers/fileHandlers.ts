import { ipcMain, dialog, BrowserWindow, IpcMainInvokeEvent, OpenDialogOptions } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { workerManager } from '../services/workerManager';
import { performanceLogger } from '../utils/performanceLogger';
import { fileCache } from '../services/fileCache';
import { perfLogger } from '../utils/performance-logger';

// ================================
// PERFORMANCE OPTIMIZATION LAYER
// ================================

// Buffer pool for file operations to reduce GC pressure
class BufferPool {
  private pools: Map<number, Buffer[]> = new Map();
  private readonly maxPoolSize = 10;
  private readonly poolSizes = [1024, 4096, 16384, 65536, 262144]; // Common file sizes
  
  constructor() {
    // Pre-allocate common buffer sizes
    this.poolSizes.forEach(size => {
      this.pools.set(size, []);
      for (let i = 0; i < 3; i++) {
        this.pools.get(size)!.push(Buffer.allocUnsafe(size));
      }
    });
  }
  
  getBuffer(size: number): Buffer {
    const poolSize = this.poolSizes.find(s => s >= size) || size;
    const pool = this.pools.get(poolSize);
    
    if (pool && pool.length > 0) {
      const buffer = pool.pop()!;
      return size === poolSize ? buffer : buffer.subarray(0, size);
    }
    
    return Buffer.allocUnsafe(size);
  }
  
  returnBuffer(buffer: Buffer): void {
    const size = buffer.length;
    const pool = this.pools.get(size);
    
    if (pool && pool.length < this.maxPoolSize) {
      pool.push(buffer);
    }
  }
}

// Pre-allocated error objects to reduce allocation overhead
const ErrorCache = {
  INVALID_FILE_PATH: new Error('File path cannot be empty'),
  PATH_TRAVERSAL: new Error('Path traversal not allowed'),
  INVALID_JOB_ID: new Error('Invalid job ID format'),
  INVALID_FILE_SIZE: new Error('Invalid file size'),
  INVALID_FILE_NAME: new Error('File name cannot be empty'),
  INVALID_INPUT: new Error('Invalid file input'),
  WORKER_RESULT_INVALID: new Error('Invalid worker result format'),
  WORKER_ERROR_INVALID: new Error('Invalid worker error format'),
  CHUNK_INVALID: new Error('Invalid chunk message format')
};

// Performance monitoring
class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();
  private startTimes: Map<string, number> = new Map();
  
  start(operation: string): void {
    this.startTimes.set(operation, performance.now());
  }
  
  end(operation: string): number {
    const startTime = this.startTimes.get(operation);
    if (!startTime) return 0;
    
    const duration = performance.now() - startTime;
    this.startTimes.delete(operation);
    
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, []);
    }
    
    const durations = this.metrics.get(operation)!;
    durations.push(duration);
    
    // Keep only last 100 measurements to prevent memory growth
    if (durations.length > 100) {
      durations.splice(0, durations.length - 100);
    }
    
    return duration;
  }
  
  getStats(operation: string): { avg: number; p95: number; count: number } | null {
    const durations = this.metrics.get(operation);
    if (!durations || durations.length === 0) return null;
    
    const sorted = [...durations].sort((a, b) => a - b);
    const avg = durations.reduce((a, b) => a + b) / durations.length;
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95 = sorted[p95Index] || sorted[sorted.length - 1];
    
    return { avg, p95, count: durations.length };
  }
}

// Global instances
const bufferPool = new BufferPool();
const perfMonitor = new PerformanceMonitor();

// IPC batching for performance
class IPCBatcher {
  private batches: Map<string, { payload: any; windows: BrowserWindow[] }[]> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly batchDelay = 1; // 1ms batching window
  
  send<T extends IPCChannelName>(windows: BrowserWindow[], channel: T, payload: IPCPayload<T>): void {
    if (!this.batches.has(channel)) {
      this.batches.set(channel, []);
    }
    
    this.batches.get(channel)!.push({ payload, windows });
    
    // Debounce batch sending
    const existingTimeout = this.timeouts.get(channel);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    this.timeouts.set(channel, setTimeout(() => {
      this.flush(channel);
    }, this.batchDelay));
  }
  
  private flush(channel: string): void {
    const batch = this.batches.get(channel);
    if (!batch || batch.length === 0) return;
    
    // Process batch efficiently
    const windowsSet = new Set<BrowserWindow>();
    batch.forEach(({ windows }) => {
      windows.forEach(w => windowsSet.add(w));
    });
    
    // Send to each window only once with batched payloads
    windowsSet.forEach(window => {
      batch.forEach(({ payload }) => {
        window.webContents.send(channel, payload);
      });
    });
    
    // Clear batch
    this.batches.set(channel, []);
    this.timeouts.delete(channel);
  }
}

const ipcBatcher = new IPCBatcher();

// ================================
// PHASE 1: CRITICAL TYPE SAFETY
// ================================

// Branded types for boundary safety
export type SafeFilePath = string & { __brand: 'SafeFilePath' };
export type JobId = string & { __brand: 'JobId' };
export type FileSize = number & { __brand: 'FileSize' };
export type Milliseconds = number & { __brand: 'Ms' };
export type FileName = string & { __brand: 'FileName' };

// Optimized branded type factories with pre-allocated errors
export const ms = (value: number): Milliseconds => {
  if (value < 0) throw new Error(`Invalid milliseconds: ${value}`);
  return value as Milliseconds;
};

export const safeFilePath = (path: string): SafeFilePath => {
  if (!path || path.length === 0) throw ErrorCache.INVALID_FILE_PATH;
  if (path.includes('..')) throw ErrorCache.PATH_TRAVERSAL;
  return path as SafeFilePath;
};

// Pre-compiled regex for performance
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID_FILENAME_REGEX = /[<>:"/\\|?*]/;

export const jobId = (id: string): JobId => {
  if (!id || !UUID_REGEX.test(id)) throw ErrorCache.INVALID_JOB_ID;
  return id as JobId;
};

export const fileSize = (size: number): FileSize => {
  // Require finite, safe, non-negative integer
  if (
    typeof size !== 'number' ||
    !Number.isFinite(size) ||
    !Number.isSafeInteger(size) ||
    size < 0
  ) {
    throw ErrorCache.INVALID_FILE_SIZE;
  }
  return size as FileSize;
};

export const fileName = (name: string): FileName => {
  if (!name || name.length === 0) throw ErrorCache.INVALID_FILE_NAME;
  if (name.length > 255) throw new Error(`File name too long: ${name.length}`);
  if (INVALID_FILENAME_REGEX.test(name)) throw new Error(`Invalid characters in filename: ${name}`);
  return name as FileName;
};

// Constants with proper typing
const FILE_PROCESSING_TIMEOUT_MS = ms(30_000); // 30 seconds
const ALLOWED_FILE_EXTENSIONS = ['.xml', '.musicxml', '.mxl'] as const;
type AllowedExtension = typeof ALLOWED_FILE_EXTENSIONS[number];
const MAX_FILENAME_LENGTH = 255;
const MAX_FILE_SIZE_BYTES = fileSize(50 * 1024 * 1024); // 50MB

// IPC Channel Type Safety
interface IPCChannelMap {
  'file:ready': {
    jobId: JobId;
    fileName: FileName;
    fileSize: FileSize;
  };
  'file:error': {
    jobId: JobId;
    error: string;
  };
  'file:chunk': {
    jobId: JobId;
    chunk: unknown;
  };
}

type IPCChannelName = keyof IPCChannelMap;
type IPCPayload<T extends IPCChannelName> = IPCChannelMap[T];

// Optimized type-safe IPC helper with batching
const safeIpcSend = <T extends IPCChannelName>(
  windows: BrowserWindow[],
  channel: T,
  payload: IPCPayload<T>
): void => {
  // Filter out closed/destroyed windows to prevent main process crashes
  const liveWindows = windows.filter(
    window => window &&
             typeof window.isDestroyed === 'function' && !window.isDestroyed() &&
             window.webContents &&
             typeof window.webContents.isDestroyed === 'function' && !window.webContents.isDestroyed()
  );

  // Use batching for non-critical messages
  if (channel === 'file:chunk') {
    ipcBatcher.send(liveWindows, channel, payload);
  } else {
    // Send immediately for critical messages
    liveWindows.forEach(window => {
      window.webContents.send(channel, payload);
    });
  }
};

// Result type for better error handling
export type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };

// Exhaustiveness helper
export const assertNever = (value: never): never => {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
};

// ================================
// PHASE 2: WORKER COMMUNICATION
// ================================

// Enhanced worker type definitions
interface WorkerPerformanceData {
  readTime: number;
  parseTime: number;
  totalTime: number;
}

interface TempoData {
  [key: string]: unknown;
}

interface WorkerResult {
  jobId: string;
  success: boolean;
  content?: string;
  fileName: string;
  fileSize: number;
  tempoData?: TempoData;
  error?: string;
  performance?: WorkerPerformanceData;
}

interface WorkerError {
  jobId: string;
  error: string;
}

interface ChunkMessage {
  jobId: string;
  data: unknown;
}

// Optimized type-safe worker message validation with early exits
function isWorkerResult(data: unknown): data is WorkerResult {
  // Fast path: early exit for obvious failures
  if (typeof data !== 'object' || data === null) return false;
  
  const obj = data as WorkerResult;
  
  // Require safe, non-negative integer for fileSize to avoid IEEE-754 precision traps
  const validSize = typeof obj.fileSize === 'number' &&
                    Number.isSafeInteger(obj.fileSize) &&
                    obj.fileSize >= 0;
  
  // Check most discriminating properties first
  return obj.jobId !== undefined &&
         obj.success !== undefined &&
         obj.fileName !== undefined &&
         obj.fileSize !== undefined &&
         typeof obj.jobId === 'string' &&
         typeof obj.success === 'boolean' &&
         typeof obj.fileName === 'string' &&
         validSize;
}

function isWorkerError(data: unknown): data is WorkerError {
  if (typeof data !== 'object' || data === null) return false;
  
  const obj = data as WorkerError;
  return obj.jobId !== undefined &&
         obj.error !== undefined &&
         typeof obj.jobId === 'string' &&
         typeof obj.error === 'string';
}

function isChunkMessage(data: unknown): data is ChunkMessage {
  if (typeof data !== 'object' || data === null) return false;
  
  const obj = data as ChunkMessage;
  return obj.jobId !== undefined &&
         obj.data !== undefined &&
         typeof obj.jobId === 'string';
}

// ================================
// VALIDATION FUNCTIONS
// ================================

function validateFileExtension(filePath: SafeFilePath): Result<AllowedExtension> {
  const ext = path.extname(filePath).toLowerCase();
  const isValid = ALLOWED_FILE_EXTENSIONS.includes(ext as AllowedExtension);
  
  return isValid
    ? { success: true, data: ext as AllowedExtension }
    : { success: false, error: new Error(`Unsupported file type: ${ext}. Please select a MusicXML file (.xml, .musicxml, or .mxl)`) };
}

function validateFileInput(name: string, buffer: ArrayBuffer): Result<{fileName: FileName; buffer: ArrayBuffer}> {
  try {
    // Validate filename
    if (!name || name.length === 0) {
      return { success: false, error: new Error('File name cannot be empty') };
    }
    if (name.length > MAX_FILENAME_LENGTH) {
      return { success: false, error: new Error(`File name too long (max ${MAX_FILENAME_LENGTH} characters)`) };
    }
    if (INVALID_FILENAME_REGEX.test(name)) {
      return { success: false, error: new Error('File name contains invalid characters') };
    }

    // Validate buffer
    if (!buffer || buffer.byteLength === 0) {
      return { success: false, error: new Error('File buffer cannot be empty') };
    }
    if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
      return { success: false, error: new Error('File too large (max 50MB)') };
    }

    return {
      success: true,
      data: {
        fileName: fileName(name),
        buffer
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

// ================================
// WORKER EVENT HANDLERS
// ================================

// Type-safe message handlers
function handleJobComplete(result: WorkerResult): void {
  const windows = BrowserWindow.getAllWindows();
  const safeJobId = jobId(result.jobId);
  const safeFileName = fileName(result.fileName);
  const safeFileSize = fileSize(result.fileSize);
  
  if (result.success) {
    fileCache.set(safeJobId, {
      content: result.content || '',
      fileName: safeFileName,
      fileSize: safeFileSize,
      tempoData: result.tempoData as any
    });
    
    safeIpcSend(windows, 'file:ready', {
      jobId: safeJobId,
      fileName: safeFileName,
      fileSize: safeFileSize
    });
    
    if (result.performance) {
      perfLogger.info('File processing complete', {
        readTime: result.performance.readTime,
        parseTime: result.performance.parseTime,
        totalTime: result.performance.totalTime
      });
    }
  } else {
    safeIpcSend(windows, 'file:error', {
      jobId: safeJobId,
      error: result.error || 'Unknown processing error'
    });
  }
}

function handleJobError(errorData: WorkerError): void {
  const windows = BrowserWindow.getAllWindows();
  const safeJobId = jobId(errorData.jobId);
  
  safeIpcSend(windows, 'file:error', {
    jobId: safeJobId,
    error: errorData.error
  });
}

function handleChunk(chunkMessage: ChunkMessage): void {
  const windows = BrowserWindow.getAllWindows();
  const safeJobId = jobId(chunkMessage.jobId);
  
  safeIpcSend(windows, 'file:chunk', {
    jobId: safeJobId,
    chunk: chunkMessage.data
  });
}

// Optimized worker event handlers with performance monitoring
workerManager.on('job-complete', (rawResult: unknown) => {
  perfMonitor.start('job-complete-handler');
  
  if (!isWorkerResult(rawResult)) {
    perfLogger.error('Invalid worker result received:', ErrorCache.WORKER_RESULT_INVALID);
    perfMonitor.end('job-complete-handler');
    return;
  }
  
  try {
    handleJobComplete(rawResult);
  } finally {
    const duration = perfMonitor.end('job-complete-handler');
    if (duration > 5) { // Log if handler takes >5ms
      perfLogger.warn(`Slow job-complete handler: ${duration.toFixed(2)}ms`);
    }
  }
});

workerManager.on('job-error', (rawErrorData: unknown) => {
  perfMonitor.start('job-error-handler');
  
  if (!isWorkerError(rawErrorData)) {
    perfLogger.error('Invalid worker error data received:', ErrorCache.WORKER_ERROR_INVALID);
    perfMonitor.end('job-error-handler');
    return;
  }
  
  try {
    handleJobError(rawErrorData);
  } finally {
    perfMonitor.end('job-error-handler');
  }
});

workerManager.on('chunk', (rawChunkMessage: unknown) => {
  // Skip performance monitoring for chunks due to high frequency
  if (!isChunkMessage(rawChunkMessage)) {
    perfLogger.error('Invalid chunk message received:', ErrorCache.CHUNK_INVALID);
    return;
  }
  handleChunk(rawChunkMessage);
});

// ================================
// HELPER FUNCTIONS
// ================================

// Pre-allocated dialog options for performance
const DIALOG_OPTIONS: OpenDialogOptions = {
  properties: ['openFile'],
  filters: [
    { name: 'MusicXML Files', extensions: ['xml', 'mxl', 'musicxml'] },
    { name: 'All Files', extensions: ['*'] }
  ]
};

// Optimized file dialog with caching and fast path
async function showFileDialog(): Promise<Result<{ canceled: boolean; filePaths: SafeFilePath[] }>> {
  perfMonitor.start('file-dialog');
  
  try {
    performanceLogger.mark('dialog-start');
    const result = await dialog.showOpenDialog(DIALOG_OPTIONS);
    performanceLogger.mark('dialog-end');
    performanceLogger.measure('dialog-start', 'dialog-end', 'File Dialog');
    
    const dialogResult = result as unknown as { canceled: boolean; filePaths: string[] };
    
    // Fast path for canceled dialog
    if (dialogResult.canceled || !dialogResult.filePaths.length) {
      perfMonitor.end('file-dialog');
      return {
        success: true,
        data: {
          canceled: true,
          filePaths: []
        }
      };
    }
    
    // Optimize path conversion with pre-allocated array
    const safeFilePaths: SafeFilePath[] = new Array(dialogResult.filePaths.length);
    for (let i = 0; i < dialogResult.filePaths.length; i++) {
      try {
        safeFilePaths[i] = safeFilePath(dialogResult.filePaths[i]);
      } catch (error) {
        perfMonitor.end('file-dialog');
        throw new Error(`Invalid file path from dialog: ${dialogResult.filePaths[i]}`);
      }
    }
    
    perfMonitor.end('file-dialog');
    return {
      success: true,
      data: {
        canceled: false,
        filePaths: safeFilePaths
      }
    };
  } catch (error) {
    perfMonitor.end('file-dialog');
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

// Helper function to get file size safely with branded types
async function getFileSize(filePath: SafeFilePath): Promise<Result<FileSize>> {
  try {
    const stats = await fs.stat(filePath);
    return {
      success: true,
      data: fileSize(stats.size)
    };
  } catch (error) {
    perfLogger.warn('Could not stat file for size:', error);
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

// ================================
// MAIN HANDLER FUNCTIONS
// ================================

// File open result type
export interface FileOpenResult {
  fileId: JobId;
  fileName: FileName;
  content?: string;
  fileSize: FileSize;
  tempoData?: TempoData;
}

// Async file open result type
export interface AsyncFileOpenResult {
  jobId: JobId;
  status: 'processing';
}

// Helper function for synchronous processing with enhanced type safety
async function processFileSynchronously(
  filePath: SafeFilePath,
  safeJobId: JobId,
  processFileSize?: FileSize,
  signal?: AbortSignal
): Promise<WorkerResult> {
  // Helper for creating standards-aligned AbortError
  function abortError(message = 'Operation aborted'): Error {
    const e = new Error(message);
    e.name = 'AbortError';
    return e;
  }

  return new Promise((resolve, reject) => {
    // Early abort check
    if (signal?.aborted) {
      return reject(abortError('Operation aborted before start'));
    }

    const timeout = setTimeout(() => {
      // On timeout, cancel the worker job to prevent CPU waste
      try {
        cleanup();
        if ('cancelJob' in workerManager && typeof (workerManager as any).cancelJob === 'function') {
          try {
            (workerManager as any).cancelJob(safeJobId);
          } catch {
            // Cancellation failure should not block timeout handling
          }
        }
      } finally {
        reject(new Error(`File processing timeout for job ${safeJobId}`));
      }
    }, FILE_PROCESSING_TIMEOUT_MS);

    // Centralized cleanup to prevent listener leaks
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortHandler);
      workerManager.off('job-complete', onComplete);
      workerManager.off('job-error', onError);
    };

    const onComplete = (rawResult: unknown) => {
      if (!isWorkerResult(rawResult)) {
        perfLogger.error('Invalid worker result in processFileSynchronously:', new Error('Invalid result format'));
        return;
      }
      
      const result = rawResult;
      if (result.jobId === safeJobId) {
        cleanup();
        if (result.success) {
          resolve(result);
        } else {
          reject(new Error(result.error || `File processing failed for job ${safeJobId}`));
        }
      }
    };

    const onError = (rawErrorData: unknown) => {
      if (!isWorkerError(rawErrorData)) {
        perfLogger.error('Invalid worker error in processFileSynchronously:', new Error('Invalid error format'));
        return;
      }
      
      const errorData = rawErrorData;
      if (errorData.jobId === safeJobId) {
        cleanup();
        reject(new Error(errorData.error || `Worker error for job ${safeJobId}`));
      }
    };

    const abortHandler = () => {
      // Always reject, even if cleanup/cancel fail
      try {
        try {
          // Best-effort cleanup
          cleanup();
        } finally {
          // Try to cancel worker job, but never let failures block rejection
          if ('cancelJob' in workerManager && typeof (workerManager as any).cancelJob === 'function') {
            try {
              (workerManager as any).cancelJob(safeJobId);
            } catch {
              // swallow or log; cancellation should not prevent rejection
            }
          }
        }
      } finally {
        reject(abortError());
      }
    };

    // CRITICAL: Attach listeners BEFORE starting the job
    workerManager.on('job-complete', onComplete);
    workerManager.on('job-error', onError);
    signal?.addEventListener('abort', abortHandler);

    // Start processing
    workerManager.processFile(filePath, safeJobId, processFileSize).catch(startError => {
      cleanup();
      reject(startError instanceof Error ? startError : new Error(String(startError)));
    });
  });
}

// NEW: Legacy handler for FileLoaderService (synchronous-style)
export async function handleFileOpenAndWait(
  event: IpcMainInvokeEvent
): Promise<FileOpenResult | null> {
  performanceLogger.mark('file-open-sync-start');
  
  try {
    const dialogResult = await showFileDialog();
    if (!dialogResult.success) {
      perfLogger.error('File dialog error:', new Error('Dialog failed'));
      throw new Error('Dialog failed');
    }
    
    const { canceled, filePaths } = dialogResult.data;
    if (canceled || !filePaths.length) {
      return null;
    }
    
    const filePath = filePaths[0];
    const safeJobId = jobId(crypto.randomUUID());
    
    // Validate file extension
    const extensionResult = validateFileExtension(filePath);
    if (!extensionResult.success) {
      throw new Error('Invalid file extension');
    }
    
    // Get file size for worker selection
    const fileSizeResult = await getFileSize(filePath);
    const processFileSize = fileSizeResult.success ? fileSizeResult.data : undefined;
    
    // Process file and wait for completion
    performanceLogger.mark('worker-process-start');
    const result = await processFileSynchronously(filePath, safeJobId, processFileSize);
    performanceLogger.mark('worker-process-end');
    performanceLogger.measure('worker-process-start', 'worker-process-end', 'Synchronous Processing');
    
    return {
      fileId: safeJobId,
      fileName: fileName(result.fileName),
      content: result.content,
      fileSize: fileSize(result.fileSize),
      tempoData: result.tempoData
    };
    
  } catch (error) {
    perfLogger.error('File open (sync) error:', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

// EXISTING: Async handler for new UI components
export async function handleFileOpen(
  event: IpcMainInvokeEvent
): Promise<AsyncFileOpenResult | null> {
  performanceLogger.mark('file-open-start');
  
  try {
    const dialogResult = await showFileDialog();
    if (!dialogResult.success) {
      perfLogger.error('File dialog error:', new Error('Dialog failed'));
      throw new Error('Dialog failed');
    }
    
    const { canceled, filePaths } = dialogResult.data;
    if (canceled || !filePaths.length) {
      return null;
    }
    
    const filePath = filePaths[0];
    
    // ✅ Mirror sync path: validate extension before dispatching work
    const extensionResult = validateFileExtension(filePath);
    if (!extensionResult.success) {
      throw new Error('Invalid file extension');
    }
    
    const safeJobId = jobId(crypto.randomUUID());
    
    // Get file size for progressive timeout
    const fileSizeResult = await getFileSize(filePath);
    const processFileSize = fileSizeResult.success ? fileSizeResult.data : undefined;
    
    // Start async processing
    performanceLogger.mark('worker-dispatch-start');
    await workerManager.processFile(filePath, safeJobId, processFileSize);
    performanceLogger.mark('worker-dispatch-end');
    performanceLogger.measure('worker-dispatch-start', 'worker-dispatch-end', 'Worker Dispatch');
    
    return {
      jobId: safeJobId,
      status: 'processing' as const
    };
    
  } catch (error) {
    perfLogger.error('File open error:', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

// ================================
// IPC HANDLERS
// ================================

// Handler to retrieve cached content with type safety
ipcMain.handle('file:getContent', async (event, rawJobId: string): Promise<Result<{
  content?: string;
  fileName: FileName;
  fileSize: FileSize;
  tempoData?: TempoData;
}>> => {
  try {
    const safeJobId = jobId(rawJobId);
    const cached = fileCache.get(safeJobId);
    
    if (cached) {
      return {
        success: true,
        data: {
          content: cached.content,
          fileName: fileName(cached.fileName),
          fileSize: fileSize(cached.fileSize),
          tempoData: cached.tempoData as unknown as TempoData
        }
      };
    }
    
    return {
      success: false,
      error: new Error('Content not found or still processing')
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
});

// Optimized drag-drop handler with streaming and buffer pooling
export async function handleFileLoadContent(
  event: IpcMainInvokeEvent,
  rawFileName: string,
  fileBuffer: ArrayBuffer
): Promise<FileOpenResult> {
  perfMonitor.start('file-load-content');
  
  try {
    // Fast validation
    const inputValidation = validateFileInput(rawFileName, fileBuffer);
    if (!inputValidation.success) {
      perfMonitor.end('file-load-content');
      throw ErrorCache.INVALID_INPUT;
    }
    
    const { fileName: validFileName } = inputValidation.data;
    const safeJobId = jobId(crypto.randomUUID());
    
    // Sanitize filename to prevent path traversal
    const sanitizedFileName = path.basename(validFileName);
    const safeFileName = fileName(sanitizedFileName);
    
    // Create safe temp file path
    const tempDir = tmpdir();
    const tempFilePath = safeFilePath(path.join(tempDir, `abc_piano_${safeJobId}_${sanitizedFileName}`));
    
    // Use buffer pool for file writing to reduce allocations
    const bufferSize = fileBuffer.byteLength;
    let writeBuffer: Buffer;
    const usedPool = bufferSize <= 262144;
    
    if (usedPool) { // 256KB - use pool
      writeBuffer = bufferPool.getBuffer(bufferSize);
      // Copy ArrayBuffer to Buffer efficiently
      const uint8Array = new Uint8Array(fileBuffer);
      writeBuffer.set(uint8Array, 0);
    } else {
      // Large files - direct conversion
      writeBuffer = Buffer.from(fileBuffer);
    }
    
    try {
      try {
        // Write buffer to temporary file
        await fs.writeFile(tempFilePath, usedPool ? writeBuffer.subarray(0, bufferSize) : writeBuffer);
      } finally {
        // ✅ Always return buffer to pool if borrowed, even if write fails
        if (usedPool) {
          bufferPool.returnBuffer(writeBuffer);
        }
      }
      
      // Process using our worker system
      const safeBytesLength = fileSize(fileBuffer.byteLength);
      const result = await processFileSynchronously(tempFilePath, safeJobId, safeBytesLength);
      
      perfMonitor.end('file-load-content');
      
      return {
        fileId: safeJobId,
        fileName: safeFileName,
        content: result.content,
        fileSize: fileSize(result.fileSize),
        tempoData: result.tempoData
      };
      
    } finally {
      // Clean up temp file asynchronously
      fs.unlink(tempFilePath).catch(cleanupError => {
        perfLogger.warn('Failed to cleanup temp file:', cleanupError);
      });
    }
    
  } catch (error) {
    const duration = perfMonitor.end('file-load-content');
    perfLogger.error(`File load content error (${duration.toFixed(2)}ms):`, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

// ================================
// REGISTRATION & CLEANUP
// ================================

// Register both file open handlers with type-safe channels
perfLogger.info('Registering enhanced file handlers with tempo extraction and type safety');

// Type-safe IPC handler registration
ipcMain.handle('dialog:openFile', handleFileOpen);          // Async for new UI
ipcMain.handle('dialog:openFileSync', handleFileOpenAndWait); // Sync for FileLoaderService  
ipcMain.handle('file:loadContent', handleFileLoadContent);    // Drag-drop for FileLoaderService

perfLogger.info('Enhanced file handlers registered successfully - tempo extraction and type safety available');

// Cleanup on app quit with proper return type
export function cleanupWorkers(): Promise<void> | void {
  return workerManager.shutdown();
}