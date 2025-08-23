import { perfLogger } from '@/renderer/utils/performance-logger';
/**
 * Lightweight Latency Monitor
 * 
 * Minimal performance monitoring to validate <20ms MIDI latency requirement.
 * Uses performance marks without React overhead.
 */

export class LightweightLatencyMonitor {
  private measurements: Map<string, number[]> = new Map();
  private readonly maxMeasurements = 100; // Keep last 100 measurements per metric
  
  /**
   * Start timing an operation
   */
  startMeasure(name: string): void {
    performance.mark(`${name}-start`);
  }
  
  /**
   * End timing and record measurement
   */
  endMeasure(name: string): void {
    performance.mark(`${name}-end`);
    
    try {
      performance.measure(name, `${name}-start`, `${name}-end`);
      const measure = performance.getEntriesByName(name, 'measure')[0];
      
      if (measure) {
        this.recordMeasurement(name, measure.duration);
        
        // Warn if approaching latency budget
        if (name.includes('midi') && measure.duration > 15) {
          perfLogger.warn(`[PERF] ${name} took ${measure.duration.toFixed(2)}ms - approaching 20ms budget`);
        }
      }
      
      // Clean up marks
      performance.clearMarks(`${name}-start`);
      performance.clearMarks(`${name}-end`);
      performance.clearMeasures(name);
    } catch (error) {
      perfLogger.error(`Failed to measure ${name}:`, error);
    }
  }
  
  /**
   * Measure a function execution time
   */
  measure<T>(name: string, fn: () => T): T {
    this.startMeasure(name);
    try {
      return fn();
    } finally {
      this.endMeasure(name);
    }
  }
  
  /**
   * Measure an async function execution time
   */
  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.startMeasure(name);
    try {
      return await fn();
    } finally {
      this.endMeasure(name);
    }
  }
  
  /**
   * Record a measurement
   */
  private recordMeasurement(name: string, duration: number): void {
    if (!this.measurements.has(name)) {
      this.measurements.set(name, []);
    }
    
    const values = this.measurements.get(name)!;
    values.push(duration);
    
    // Keep only last N measurements
    if (values.length > this.maxMeasurements) {
      values.shift();
    }
  }
  
  /**
   * Get statistics for a metric
   */
  getStats(name: string): {
    count: number;
    avg: number;
    min: number;
    max: number;
    p95: number;
  } | null {
    const values = this.measurements.get(name);
    if (!values || values.length === 0) return null;
    
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((acc, val) => acc + val, 0);
    
    return {
      count: values.length,
      avg: sum / values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p95: sorted[Math.floor(sorted.length * 0.95)]
    };
  }
  
  /**
   * Log all statistics
   */
  logStats(): void {
    // Stats logging removed for production
  }
  
  /**
   * Clear all measurements
   */
  clear(): void {
    this.measurements.clear();
  }
}

// Global instance for easy access
export const latencyMonitor = new LightweightLatencyMonitor();

// Expose to window for debugging
if (typeof window !== 'undefined') {
  (window as any).latencyMonitor = latencyMonitor;
}