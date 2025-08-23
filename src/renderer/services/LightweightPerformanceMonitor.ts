import { perfLogger } from '@/renderer/utils/performance-logger';
/**
 * Lightweight Performance Monitor
 * 
 * High-performance, non-blocking latency monitoring for real-time MIDI processing.
 * Implementation: circular buffer + requestIdleCallback
 * 
 * ZERO React overhead - operates completely outside React render cycle.
 */

interface PerformanceMetrics {
  currentLatency: number;
  averageLatency: number;
  maxLatency: number;
  minLatency: number;
  sampleCount: number;
}

export class LightweightPerformanceMonitor {
  private static instance: LightweightPerformanceMonitor | null = null;
  
  // Circular buffer for ultra-fast latency storage
  private readonly BUFFER_SIZE = 100;
  private latencyBuffer: number[] = new Array(this.BUFFER_SIZE);
  private bufferIndex = 0;
  private sampleCount = 0;
  
  // Cached metrics (updated only during idle time)
  private cachedMetrics: PerformanceMetrics = {
    currentLatency: 0,
    averageLatency: 0,
    maxLatency: 0,
    minLatency: Infinity,
    sampleCount: 0
  };
  
  // Update frequency control
  private lastMetricsUpdate = 0;
  private readonly UPDATE_INTERVAL = 500; // Update UI metrics every 500ms
  
  private constructor() {
    this.startIdleUpdates();
  }
  
  /**
   * Singleton instance for global access
   */
  static getInstance(): LightweightPerformanceMonitor {
    if (!LightweightPerformanceMonitor.instance) {
      LightweightPerformanceMonitor.instance = new LightweightPerformanceMonitor();
    }
    return LightweightPerformanceMonitor.instance;
  }
  
  /**
   * PERFORMANCE CRITICAL: Record latency measurement
   * This runs on every MIDI event - must be ultra-fast
   */
  recordLatency(latencyMs: number): void {
    // Store in circular buffer (extremely fast operation)
    this.latencyBuffer[this.bufferIndex] = latencyMs;
    this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
    this.sampleCount = Math.min(this.sampleCount + 1, this.BUFFER_SIZE);
    
    // Update current latency immediately (for debugging)
    this.cachedMetrics.currentLatency = latencyMs;
  }
  
  /**
   * Get current metrics (cached, non-blocking)
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.cachedMetrics };
  }
  
  /**
   * Check if performance is meeting <20ms target
   */
  isPerformanceGood(): boolean {
    return this.cachedMetrics.averageLatency < 20 && this.cachedMetrics.maxLatency < 30;
  }
  
  /**
   * Get performance status for logging
   */
  getPerformanceStatus(): string {
    const metrics = this.cachedMetrics;
    const status = this.isPerformanceGood() ? ' GOOD' : ' SLOW';
    return `${status} | Avg: ${metrics.averageLatency.toFixed(1)}ms | Max: ${metrics.maxLatency.toFixed(1)}ms`;
  }
  
  /**
   * Reset all metrics
   */
  reset(): void {
    this.latencyBuffer.fill(0);
    this.bufferIndex = 0;
    this.sampleCount = 0;
    this.cachedMetrics = {
      currentLatency: 0,
      averageLatency: 0,
      maxLatency: 0,
      minLatency: Infinity,
      sampleCount: 0
    };
  }
  
  /**
   * Start non-blocking metrics calculation using requestIdleCallback
   * Updates metrics only when browser is idle
   */
  private startIdleUpdates(): void {
    const updateMetrics = () => {
      const now = performance.now();
      
      // Throttle updates to avoid excessive computation
      if (now - this.lastMetricsUpdate < this.UPDATE_INTERVAL) {
        this.scheduleNextUpdate();
        return;
      }
      
      this.lastMetricsUpdate = now;
      this.calculateMetrics();
      this.scheduleNextUpdate();
    };
    
    // Initial update
    this.scheduleNextUpdate();
    
    function scheduleUpdate() {
      // Use requestIdleCallback if available, fallback to setTimeout
      if ('requestIdleCallback' in window) {
        requestIdleCallback(updateMetrics, { timeout: 100 });
      } else {
        setTimeout(updateMetrics, 50);
      }
    }
    
    this.scheduleNextUpdate = scheduleUpdate;
  }
  
  private scheduleNextUpdate!: () => void;
  
  /**
   * Calculate metrics from circular buffer (runs during idle time)
   */
  private calculateMetrics(): void {
    if (this.sampleCount === 0) return;
    
    let sum = 0;
    let max = 0;
    let min = Infinity;
    
    // Only process valid samples
    const validSamples = this.latencyBuffer.slice(0, this.sampleCount);
    
    for (const latency of validSamples) {
      if (latency > 0) { // Skip empty buffer slots
        sum += latency;
        max = Math.max(max, latency);
        min = Math.min(min, latency);
      }
    }
    
    this.cachedMetrics = {
      currentLatency: this.cachedMetrics.currentLatency,
      averageLatency: sum / this.sampleCount,
      maxLatency: max,
      minLatency: min === Infinity ? 0 : min,
      sampleCount: this.sampleCount
    };
  }
}

/**
 * Convenience functions for easy integration
 */

// Singleton instance
const monitor = LightweightPerformanceMonitor.getInstance();

/**
 * Record MIDI processing latency (use in hot path)
 */
export function recordMidiLatency(latencyMs: number): void {
  if (process.env.NODE_ENV === 'development') {
    monitor.recordLatency(latencyMs);
  }
}

/**
 * Get current performance metrics
 */
export function getPerformanceMetrics(): PerformanceMetrics {
  return monitor.getMetrics();
}

/**
 * Log performance status to console (for debugging)
 */
export function logPerformanceStatus(): void {
  if (process.env.NODE_ENV === 'development') {
    perfLogger.debug(`[Performance] ${monitor.getPerformanceStatus()}`);
  }
}

/**
 * Check if app is meeting performance targets
 */
export function isPerformanceGood(): boolean {
  return monitor.isPerformanceGood();
}

/**
 * Reset performance monitoring
 */
export function resetPerformanceMonitoring(): void {
  monitor.reset();
}