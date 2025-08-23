/**
 * Performance logger for main process
 * Zero-allocation ring buffer implementation for <20ms MIDI latency
 */

// Ring buffer for zero-allocation logging
class RingBuffer {
  private buffer: Float32Array;
  private head: number = 0;
  private count: number = 0;
  
  constructor(private size: number) {
    this.buffer = new Float32Array(size);
  }
  
  push(value: number): void {
    this.buffer[this.head] = value;
    this.head = (this.head + 1) % this.size;
    this.count = Math.min(this.count + 1, this.size);
  }
  
  getStats(): { min: number; max: number; avg: number; count: number } {
    if (this.count === 0) {
      return { min: 0, max: 0, avg: 0, count: 0 };
    }
    
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    
    for (let i = 0; i < this.count; i++) {
      const value = this.buffer[i];
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
    }
    
    return {
      min,
      max,
      avg: sum / this.count,
      count: this.count
    };
  }
  
  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

// Performance logger implementation
class PerformanceLogger {
  private midiBuffer = new RingBuffer(1000);
  private fileBuffer = new RingBuffer(100);
  private workerBuffer = new RingBuffer(100);
  
  // Log MIDI events (hot path)
  logMidiEvent(latency: number): void {
    this.midiBuffer.push(latency);
  }
  
  // Log file operations
  logFileOperation(duration: number): void {
    this.fileBuffer.push(duration);
  }
  
  // Log worker operations
  logWorkerOperation(duration: number): void {
    this.workerBuffer.push(duration);
  }
  
  // Get performance stats
  getStats(): { midi: ReturnType<RingBuffer['getStats']>; file: ReturnType<RingBuffer['getStats']>; worker: ReturnType<RingBuffer['getStats']> } {
    return {
      midi: this.midiBuffer.getStats(),
      file: this.fileBuffer.getStats(),
      worker: this.workerBuffer.getStats()
    };
  }
  
  // For compatibility with existing code
  debug(message: string, ...args: any[]): void {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }
  
  info(message: string, ...args: any[]): void {
    console.info(`[INFO] ${message}`, ...args);
  }
  
  warn(message: string, ...args: any[]): void {
    console.warn(`[WARN] ${message}`, ...args);
  }
  
  error(message: string, error?: Error): void {
    console.error(`[ERROR] ${message}`, error);
  }
}

// Export singleton instance
export const perfLogger = new PerformanceLogger();

// Export specific logging functions for hot paths
export const logMidiEvent = (latency: number) => perfLogger.logMidiEvent(latency);
export const logFileOperation = (duration: number) => perfLogger.logFileOperation(duration);
export const logWorkerOperation = (duration: number) => perfLogger.logWorkerOperation(duration);