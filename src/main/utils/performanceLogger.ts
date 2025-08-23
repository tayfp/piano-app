import { performance } from 'perf_hooks';
import { perfLogger } from './performance-logger';

interface PerformanceMark {
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface PerformanceMeasure {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

class PerformanceLogger {
  private marks = new Map<string, PerformanceMark>();
  private measures: PerformanceMeasure[] = [];

  mark(name: string, metadata?: Record<string, unknown>): void {
    this.marks.set(name, {
      timestamp: performance.now(),
      metadata
    });
  }

  measure(startMark: string, endMark: string, measureName?: string): number {
    const start = this.marks.get(startMark);
    const end = this.marks.get(endMark);
    
    if (!start || !end) {
      perfLogger.warn(`Missing marks: ${startMark} or ${endMark}`);
      return -1;
    }
    
    const duration = end.timestamp - start.timestamp;
    const name = measureName || `${startMark} → ${endMark}`;
    
    this.measures.push({
      name,
      duration,
      timestamp: Date.now(),
      metadata: { ...(start.metadata ?? {}), ...(end.metadata ?? {}) }
    });
    
    perfLogger.debug(`[PERF] ${name}: ${duration.toFixed(0)}ms`);
    return duration;
  }

  async measureAsync<T>(
    name: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const startMark = `${name}-start`;
    const endMark = `${name}-end`;
    
    this.mark(startMark);
    try {
      const result = await operation();
      this.mark(endMark);
      this.measure(startMark, endMark, name);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.mark(endMark, { error: errorMessage });
      this.measure(startMark, endMark, `${name} (failed)`);
      throw error;
    }
  }

  getReport(): string {
    const report = this.measures
      .map(m => `${m.name}: ${m.duration.toFixed(0)}ms`)
      .join('\n');
    return `Performance Report:\n${report}`;
  }

  reset(): void {
    this.marks.clear();
    this.measures = [];
  }

  // Additional methods for testing
  getMarks(): Map<string, PerformanceMark> {
    return this.marks;
  }

  getMeasures(): PerformanceMeasure[] {
    return this.measures;
  }
  
  getMeasure(startMark: string, endMark: string): number | undefined {
    const start = this.marks.get(startMark);
    const end = this.marks.get(endMark);
    
    if (!start || !end) {
      return undefined;
    }
    
    return end.timestamp - start.timestamp;
  }
}

export const performanceLogger = new PerformanceLogger();
export { PerformanceLogger };