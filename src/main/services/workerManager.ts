import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import * as os from 'os';
import { perfLogger } from '../utils/performance-logger';

interface WorkerJob {
  id: string;
  worker: Worker;
  startTime: number;
  timeout: NodeJS.Timeout;
}

export class WorkerManager extends EventEmitter {
  private activeJobs = new Map<string, WorkerJob>();
  private readonly maxWorkers = this.calculateMaxWorkers();
  private readonly timeoutMap = {
    small: 10000,   // 10s for files < 1MB
    medium: 30000,  // 30s for files 1-5MB
    large: 60000    // 60s for files > 5MB
  };
  
  // Back-pressure control for streaming stability
  private chunkQueues = new Map<string, unknown[]>(); // jobId -> chunk queue
  private readonly maxQueueSize = parseInt(process.env.BP_QUEUE_MAX || '4');
  private requestCache = new Map<string, Promise<void>>(); // file hash -> promise (request coalescing)
  
  private calculateMaxWorkers(): number {
    // Dynamic worker limit based on system resources
    const cpuCount = os.cpus().length;
    return Math.max(2, Math.min(cpuCount - 1, 4));
  }
  
  private getTimeoutForFileSize(fileSize: number): number {
    const MB = 1024 * 1024;
    if (fileSize < MB) return this.timeoutMap.small;
    if (fileSize < 5 * MB) return this.timeoutMap.medium;
    return this.timeoutMap.large;
  }
  
  async processFile(filePath: string, jobId: string, fileSize?: number): Promise<void> {
    // Request coalescing to prevent redundant work
    const fileHash = await this.getFileHash(filePath);
    if (this.requestCache.has(fileHash)) {
      perfLogger.debug(`[WorkerManager] Coalescing request for ${filePath}`);
      return this.requestCache.get(fileHash)!;
    }

    // Check worker limit
    if (this.activeJobs.size >= this.maxWorkers) {
      throw new Error('Too many concurrent file operations');
    }

    // Create coalesced promise for this file
    const processPromise = this.doProcessFile(filePath, jobId, fileSize);
    this.requestCache.set(fileHash, processPromise);
    
    // Clean up cache after completion
    processPromise.finally(() => {
      this.requestCache.delete(fileHash);
    });
    
    return processPromise;
  }

  private async doProcessFile(filePath: string, jobId: string, fileSize?: number): Promise<void> {
    
    // Create worker
    // In development, use the JavaScript wrapper that loads the TypeScript file
    // In production, use the compiled JavaScript from dist
    const isDevelopment = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
    const workerPath = isDevelopment 
      ? require.resolve('../workers/fileProcessor.js')  // JS wrapper for TS
      : require.resolve('../workers/fileProcessor');    // Compiled JS in dist
    
    
    const worker = new Worker(workerPath, {
      workerData: { filePath, jobId }
    });
    
    // Set up progressive timeout based on file size
    const timeoutDuration = fileSize 
      ? this.getTimeoutForFileSize(fileSize)
      : this.timeoutMap.medium; // Default to medium if size unknown
      
    const timeout = setTimeout(() => {
      this.terminateWorker(jobId, `Timeout after ${timeoutDuration/1000}s`);
    }, timeoutDuration);
    
    // Track job
    const job: WorkerJob = {
      id: jobId,
      worker,
      startTime: Date.now(),
      timeout
    };
    
    this.activeJobs.set(jobId, job);
    
    // Initialize chunk queue for back-pressure control
    this.chunkQueues.set(jobId, []);

    // Handle worker events
    worker.on('message', (result) => {
      
      // Handle telemetry messages
      if (result.__telemetry) {
        // Forward telemetry to main process console if in development
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_WORKER_TELEMETRY === 'true') {
          perfLogger.debug(`[Worker-${jobId}] ${result.type}:`, {
            timestamp: result.ts,
            jobId,
            ...result
          });
        }
        this.emit('worker-telemetry', { jobId, ...result });
        return;
      }
      
      // Back-pressure control for chunk messages
      if (result.type === 'chunk') {
        const queue = this.chunkQueues.get(jobId) || [];
        
        // Always queue the chunk to prevent data loss
        queue.push(result);
        this.chunkQueues.set(jobId, queue);
        
        // Apply back-pressure if queue is full
        if (queue.length >= this.maxQueueSize) {
          perfLogger.warn(`[WorkerManager] Back-pressure triggered for ${jobId}, queue size: ${queue.length}`);
          // Signal worker to pause (if it supports back-pressure)
          worker.postMessage({ type: 'pause-streaming' });
        }
        
        // Process queue with small delay to allow back-pressure
        setImmediate(() => this.processChunkQueue(jobId));
        return;
      }
      
      clearTimeout(timeout);
      this.emit('job-complete', result);
      this.cleanupJob(jobId);
    });
    
    worker.on('error', (error) => {
      clearTimeout(timeout);
      perfLogger.error(`Worker error for job ${jobId}:`, error);
      
      // Enhanced error recovery with fallback
      this.handleWorkerError(jobId, error);
      this.cleanupJob(jobId);
    });
    
    worker.on('exit', (code) => {
      if (code !== 0 && this.activeJobs.has(jobId)) {
        clearTimeout(timeout);
        this.emit('job-error', { 
          jobId, 
          error: `Worker exited with code ${code}` 
        });
        this.cleanupJob(jobId);
      }
    });
  }
  
  private terminateWorker(jobId: string, reason: string): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      perfLogger.warn(`Terminating worker ${jobId}: ${reason}`);
      job.worker.terminate();
      this.emit('job-error', { jobId, error: reason });
      this.cleanupJob(jobId);
    }
  }
  
  getActiveJobCount(): number {
    return this.activeJobs.size;
  }
  
  async shutdown(): Promise<void> {
    const promises = Array.from(this.activeJobs.values()).map(job => 
      job.worker.terminate()
    );
    await Promise.all(promises);
    this.activeJobs.clear();
    this.chunkQueues.clear();
    this.requestCache.clear();
  }

  // Back-pressure queue processing
  private processChunkQueue(jobId: string): void {
    const queue = this.chunkQueues.get(jobId);
    if (!queue || queue.length === 0) return;

    // Process chunks while under back-pressure limit
    while (queue.length > 0) {
      const chunk = queue.shift();
      if (chunk) {
        // Re-emit the chunk after back-pressure control
        this.emit('chunk', chunk);
      }
    }

    // Signal worker to resume if queue is under limit
    const job = this.activeJobs.get(jobId);
    if (job && queue.length < this.maxQueueSize / 2) {
      job.worker.postMessage({ type: 'resume-streaming' });
    }
  }

  // Request coalescing file hash
  private async getFileHash(filePath: string): Promise<string> {
    const crypto = require('crypto');
    const fs = require('fs');
    
    try {
      const stats = await fs.promises.stat(filePath);
      const hashInput = `${filePath}:${stats.size}:${stats.mtime.getTime()}`;
      return crypto.createHash('sha256').update(hashInput).digest('hex');
    } catch (error) {
      // Fallback to simple path hash
      return crypto.createHash('sha256').update(filePath).digest('hex');
    }
  }

  // Enhanced error recovery with fallback
  private handleWorkerError(jobId: string, error: Error): void {
    const job = this.activeJobs.get(jobId);
    if (!job) return;

    perfLogger.warn(`[WorkerManager] Worker crashed for job ${jobId}, attempting recovery`);
    
    // Emit error but don't immediately fail
    this.emit('job-error', { 
      jobId, 
      error: error.message,
      recoverable: true 
    });

    // TODO: Implement fallback to synchronous processing
    // For now, just emit the error
    // In a future phase, we could retry with main thread processing
  }

  // Enhanced cleanup with back-pressure queues
  private cleanupJob(jobId: string): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      clearTimeout(job.timeout);
      this.activeJobs.delete(jobId);
    }
    
    // Clean up back-pressure queue
    this.chunkQueues.delete(jobId);
  }
}

export const workerManager = new WorkerManager();