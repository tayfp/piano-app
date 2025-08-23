/**
 * Core data structures for BPM/Tempo Extraction
 * 
 * Strict TypeScript interfaces with validation guards
 * following code review: requirements
 */

export interface TempoChangeEvent {
  measureIndex: number;      // 0-indexed for array access
  measureNumber: number;     // 1-indexed for display
  bpm: number;              // Beats per minute (validated)
  confidence: number;       // 0.0 to 1.0
  source: 'explicit' | 'metronome' | 'text' | 'heuristic' | 'default' | 'user';
  timestamp?: number;       // For debugging/telemetry
  raw?: string;            // Original text that was parsed
}

// Add new interface for Phase 1 - Multiple tempos with position data
export interface TempoWithPosition {
  bpm: number;
  offset?: number;      // Position in divisions (validated 0-10000)
  beat?: number;        // Calculated beat position (0-based)
  confidence: number;
  source: 'osmd' | 'xml' | 'cache';
  text?: string;        // Tempo expression text
  index?: number;       // Original array index for stable sorting
}

export interface TempoMap {
  events: TempoChangeEvent[];
  defaultBpm: number;
  averageBpm: number;
  hasExplicitTempo: boolean;
  hasTextTempo?: boolean;  // Version Tracks if text-based tempo found
  confidence: number;      // Overall confidence
  extractedAt?: number;    // Timestamp of extraction
  extractionDuration?: number; // Performance metric
}

export interface ITempoExtractor {
  extract(adapter: IOSMDAdapter, measures: any[]): Promise<TempoChangeEvent[]> | TempoChangeEvent[];
  readonly name: string;
  readonly priority: number; // Higher priority wins conflicts
}

export interface IOSMDAdapter {
  getMeasures(osmd: any): any[];
  getTempoInBpm(measure: any): number | null;
  getTemposInMeasure(measure: any): TempoWithPosition[]; // ADD THIS LINE
  getMetronomeMarks(measure: any): string[];
  getTextExpressions(measure: any): string[];
  getMeasureNumber(measure: any): number;
  isValidOSMD(osmd: any): boolean;
}

export interface OSMDTempoData {
  tempoMap: TempoMap | null;
  isExtracting: boolean;
  extractionError: string | null;
  lastExtractedAt: number | null;
}

export interface ExtractionOptions {
  useCache?: boolean;
  maxDurationMs?: number;
  extractors?: string[];
  enableTextExtraction?: boolean;
  enableHeuristics?: boolean;
}

// Strict type guards to prevent runtime errors (Code review: requirement)
export function isValidBpm(value: unknown): value is number {
  return typeof value === 'number' && 
         value > 0 && 
         value <= 300 && 
         Number.isFinite(value);
}

export function isValidMeasureIndex(value: unknown): value is number {
  return typeof value === 'number' && 
         value >= 0 && 
         Number.isInteger(value);
}

export function isValidConfidence(value: unknown): value is number {
  return typeof value === 'number' && 
         value >= 0 && 
         value <= 1 && 
         Number.isFinite(value);
}

// Defensive OSMD property checker
export function getOSMDProperty(obj: any, propertyPaths: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  
  for (const path of propertyPaths) {
    try {
      // Handle nested property paths like "Sheet.SourceMeasures"
      const parts = path.split('.');
      let current: any = obj;
      
      for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
          current = current[part];
        } else {
          current = undefined;
          break;
        }
      }
      
      if (current !== undefined && current !== null) {
        return current;
      }
    } catch {
      // Ignore access errors, try next property path
    }
  }
  
  return undefined;
}

// Helper to create default tempo map
export function createDefaultTempoMap(defaultBpm: number = 120): TempoMap {
  const now = Date.now();
  return {
    events: [{
      measureIndex: 0,
      measureNumber: 1,
      bpm: defaultBpm,
      confidence: 0.5,
      source: 'default',
      timestamp: now
    }],
    defaultBpm,
    averageBpm: defaultBpm,
    hasExplicitTempo: false,
    confidence: 0.5,
    extractedAt: now
  };
}

// Type assertions for better error messages
export function assertValidBpm(value: unknown, context: string): asserts value is number {
  if (!isValidBpm(value)) {
    throw new TypeError(`Invalid BPM value in ${context}: ${value}`);
  }
}

export function assertValidMeasureIndex(value: unknown, context: string): asserts value is number {
  if (!isValidMeasureIndex(value)) {
    throw new TypeError(`Invalid measure index in ${context}: ${value}`);
  }
}

// Export all types for convenience
export type { TempoChangeEvent as TempoEvent }; // Alias for backward compatibility