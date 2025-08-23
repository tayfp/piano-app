/**
 * Minimal Performance Logger for Urtext Piano
 * 
 * Design principles:
 * - Zero impact on <20ms latency requirement
 * - Ring buffer for hot paths (no console.log)
 * - Async flushing during idle time
 * - Compile-time stripping for production
 * 
 * Based on performance analysis:
 * - No string formatting in audio callbacks
 * - No object allocation in hot paths
 * - Deferred logging only
 */

import { useMidiStore } from '../stores/midiStore';
import { IS_DEVELOPMENT } from '@/renderer/utils/env';
import { logger, type LogCategory } from './simple-logger';

// Performance constants
const PERF_BUFFER_SIZE = 1000;
const FLUSH_INTERVAL_MS = 100;
const LATENCY_WARNING_THRESHOLD_MS = 20;
const LATENCY_ERROR_THRESHOLD_MS = 30;

// Compile-time flags
const ENABLE_DEBUG = IS_DEVELOPMENT;

// Minimal log entry for ring buffer (fixed size, no allocations)
interface PerfEntry {
  timestamp: number;  // performance.now()
  latency: number;    // measured latency in ms
  eventType: number;  // 0=midi, 1=audio, 2=render
}

/**
 * High-performance logger for real-time audio applications
 */
class PerformanceLogger {
  // Pre-allocated ring buffer (no dynamic allocation)
  private perfBuffer: PerfEntry[];
  private bufferIndex: number = 0;
  private flushScheduled: boolean = false;
  
  // Statistics (updated during flush, not in hot path)
  private stats = {
    totalEvents: 0,
    violations: 0,
    maxLatency: 0,
    avgLatency: 0,
    minLatency: 0
  };
  
  // Tracking for hybrid flush strategy
  private lastReportedMax: number = 0;
  private lastReportedTotal: number = 0;
  private lastReportTime: number = 0;

  constructor() {
    // Pre-allocate buffer
    this.perfBuffer = new Array(PERF_BUFFER_SIZE);
    for (let i = 0; i < PERF_BUFFER_SIZE; i++) {
      this.perfBuffer[i] = { timestamp: 0, latency: 0, eventType: 0 };
    }
    
    // Start periodic flushing if in development
    if (IS_DEVELOPMENT) {
      this.startPeriodicFlush();
    }
  }

  /**
   * Log performance metric (hot path - must be fast)
   * Called from MIDI/audio callbacks
   */
  logLatency(latencyMs: number, eventType: number = 0): void {
    // Direct array access, no allocation
    const entry = this.perfBuffer[this.bufferIndex];
    entry.timestamp = performance.now();
    entry.latency = latencyMs;
    entry.eventType = eventType;
    
    // Circular buffer increment
    this.bufferIndex = (this.bufferIndex + 1) % PERF_BUFFER_SIZE;
  }

  /**
   * Log error (non-hot path only)
   * Errors are never deduplicated - always visible
   */
  error(message: string, error?: Error): void {
    if (!IS_DEVELOPMENT) return; // Guard against production logging
    // Keep errors using console.error for proper stack traces
    // But add category prefix for consistency
    const category = this.inferCategory(message);
    console.error(`[${category}] ERROR: ${new Date().toISOString()} ${message}`, error || '');
  }

  /**
   * Debug logging (compiled out in production)
   */
  debug(message: string, data?: any): void {
    if (ENABLE_DEBUG) {
      // Infer category from message content
      const category = this.inferCategory(message);
      logger.log(category, message, data);
    }
  }
  
  /**
   * Infer log category from message content
   */
  private inferCategory(message: string): LogCategory {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('midi')) return 'MIDI';
    if (lowerMessage.includes('osmd') || lowerMessage.includes('sheet') || lowerMessage.includes('cursor')) return 'OSMD';
    if (lowerMessage.includes('practice') || lowerMessage.includes('controller')) return 'PRACTICE';
    if (lowerMessage.includes('audio') || lowerMessage.includes('scheduler')) return 'AUDIO';
    return 'SYSTEM';
  }

  /**
   * Warning logging (always enabled for important performance warnings)
   */
  warn(message: string, data?: any): void {
    // Always log warnings with inferred category
    const category = this.inferCategory(message);
    // Prepend WARN: to message for visibility
    logger.log(category, `WARN: ${message}`, data);
  }

  /**
   * Info logging (always enabled for important information)
   */
  info(message: string, data?: any): void {
    // Always log info with inferred category
    const category = this.inferCategory(message);
    logger.log(category, message, data);
  }

  /**
   * Flush performance buffer during idle time
   * This is where we can do string formatting and console output
   */
  private flushPerfBuffer = (): void => {
    if (!IS_DEVELOPMENT) return;
    
    let violations = 0;
    let maxLatency = 0;
    let minLatency = Infinity;
    let totalLatency = 0;
    let count = 0;
    
    // Scan buffer for aggregated stats
    for (let i = 0; i < PERF_BUFFER_SIZE; i++) {
      const entry = this.perfBuffer[i];
      if (entry.timestamp > 0) {
        count++;
        totalLatency += entry.latency;
        maxLatency = Math.max(maxLatency, entry.latency);
        minLatency = Math.min(minLatency, entry.latency);
        
        if (entry.latency > LATENCY_WARNING_THRESHOLD_MS) {
          violations++;
        }
      }
    }
    
    // Update internal stats
    if (count > 0) {
      this.stats.totalEvents += count;
      this.stats.violations += violations;
      this.stats.maxLatency = Math.max(this.stats.maxLatency, maxLatency);
      this.stats.avgLatency = totalLatency / count;
      this.stats.minLatency = minLatency === Infinity ? 0 : minLatency;
    }
    
    // Hybrid flush strategy: Update store when:
    // 1. Significant change in max latency (10% increase)
    // 2. Enough events accumulated (20 events)
    // 3. Enough time passed (250ms)
    const now = Date.now();
    const shouldUpdateStore = count > 0 && (
      maxLatency > this.lastReportedMax * 1.1 || // 10% increase
      this.stats.totalEvents - this.lastReportedTotal >= 20 || // 20 events
      now - this.lastReportTime >= 250 // 250ms elapsed
    );
    
    if (shouldUpdateStore) {
      // Update Zustand store with aggregated stats
      useMidiStore.getState().setLatencyStats({
        average: Math.round(this.stats.avgLatency * 10) / 10, // Round to 1 decimal
        max: Math.round(this.stats.maxLatency * 10) / 10,
        min: Math.round(this.stats.minLatency * 10) / 10,
        violations: this.stats.violations
      });
      
      this.lastReportedMax = maxLatency;
      this.lastReportedTotal = this.stats.totalEvents;
      this.lastReportTime = now;
    }
    
    // Only log warnings if there are issues
    if (violations > 0) {
      console.warn(
        `[PERF] Latency violations: ${violations}/${count} events exceeded ${LATENCY_WARNING_THRESHOLD_MS}ms (max: ${maxLatency.toFixed(1)}ms)`
      );
    }
    
    // Log critical errors immediately
    if (maxLatency > LATENCY_ERROR_THRESHOLD_MS) {
      console.error(
        `[PERF] CRITICAL: Latency exceeded ${LATENCY_ERROR_THRESHOLD_MS}ms! Max: ${maxLatency.toFixed(1)}ms`
      );
    }
    
    // Reset buffer timestamps
    for (let i = 0; i < PERF_BUFFER_SIZE; i++) {
      this.perfBuffer[i].timestamp = 0;
    }
    
    this.flushScheduled = false;
  };

  /**
   * Schedule flush using requestIdleCallback for zero impact
   */
  private scheduleFlush(): void {
    if (this.flushScheduled || !IS_DEVELOPMENT) return;
    
    this.flushScheduled = true;
    if ('requestIdleCallback' in window) {
      requestIdleCallback(this.flushPerfBuffer, { timeout: FLUSH_INTERVAL_MS });
    } else {
      setTimeout(this.flushPerfBuffer, FLUSH_INTERVAL_MS);
    }
  }

  /**
   * Start periodic flushing
   */
  private startPeriodicFlush(): void {
    setInterval(() => this.scheduleFlush(), FLUSH_INTERVAL_MS);
  }

  /**
   * Get current statistics (for UI display)
   */
  getStats() {
    return { 
      totalEvents: this.stats.totalEvents,
      violations: this.stats.violations,
      maxLatency: this.stats.maxLatency,
      avgLatency: this.stats.avgLatency,
      minLatency: this.stats.minLatency
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalEvents: 0,
      violations: 0,
      maxLatency: 0,
      avgLatency: 0,
      minLatency: 0
    };
    this.lastReportedMax = 0;
    this.lastReportedTotal = 0;
    this.lastReportTime = 0;
  }
}

// Singleton instance
export const perfLogger = new PerformanceLogger();

// Convenience functions for hot paths
export const logMidiLatency = (latencyMs: number) => perfLogger.logLatency(latencyMs, 0);
export const logAudioLatency = (latencyMs: number) => perfLogger.logLatency(latencyMs, 1);
export const logRenderLatency = (latencyMs: number) => perfLogger.logLatency(latencyMs, 2);

// Ring buffer logger for zoom operations
interface ZoomMetrics {
  avgZoomTime: number;
  maxZoomTime: number;
  zoomCount: number;
  slowZooms: number;
}

// Simple zoom metrics tracking
const zoomMetricsCache: number[] = [];
const MAX_ZOOM_METRICS = 100;

// Export zoom metrics
export const getZoomMetrics = (): ZoomMetrics => {
  if (zoomMetricsCache.length === 0) {
    return {
      avgZoomTime: 0,
      maxZoomTime: 0,
      zoomCount: 0,
      slowZooms: 0
    };
  }

  const sum = zoomMetricsCache.reduce((a, b) => a + b, 0);
  const avgZoomTime = sum / zoomMetricsCache.length;
  const maxZoomTime = Math.max(...zoomMetricsCache);
  const slowZooms = zoomMetricsCache.filter(v => v > 100).length;

  return {
    avgZoomTime,
    maxZoomTime,
    zoomCount: zoomMetricsCache.length,
    slowZooms
  };
};

// Enhanced zoom latency logging that tracks metrics
export const logZoomLatency = (latencyMs: number) => {
  // Track in cache for metrics
  zoomMetricsCache.push(latencyMs);
  if (zoomMetricsCache.length > MAX_ZOOM_METRICS) {
    zoomMetricsCache.shift(); // Remove oldest
  }
  
  // Call performance logger
  perfLogger.logLatency(latencyMs, 3);
};

// Type definitions for event types
export const EventType = {
  MIDI: 0,
  AUDIO: 1,
  RENDER: 2,
  ZOOM: 3
} as const;