/**
 * TempoService - Orchestrates tempo extraction
 * 
 * Features:
 * - Singleton pattern for global access
 * - LRU cache with O(1) operations
 * - Conflict resolution (last-wins same measure, confidence-based otherwise)
 * - Performance monitoring
 */

import { 
  TempoMap, 
  TempoChangeEvent, 
  ExtractionOptions, 
  createDefaultTempoMap,
  isValidBpm,
  TempoWithPosition
} from '../types';
import type { XMLTempoEvent } from '../../../common/types';
import { OSMDAdapter } from '../adapters/OSMDAdapter';
import { ExplicitTempoExtractor } from '../extractors/ExplicitTempoExtractor';
import { ITempoExtractor } from '../types';
import { AdvancedTempoCache } from './AdvancedCache';
import { TempoPerformanceMonitor } from './PerformanceMonitor';
import { ProductionTempoConfig, DevelopmentTempoConfig } from '../config/production';
import { perfLogger } from '@/renderer/utils/performance-logger';

// Expose TempoDebug immediately for console access
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  (window as any).TempoDebug = {
    version: () => perfLogger.debug('[TEMPO V2] Enhanced XML+OSMD extraction active'),
    
    sources: () => {
      const service = TempoService.getInstance();
      const xmlCount = service.xmlTempos.get(service.currentCacheKey)?.length || 0;
      const cacheSize = service.cache.getStats().size;
      perfLogger.debug('[TEMPO V2] Sources:', {
        currentKey: service.currentCacheKey,
        xmlEvents: xmlCount,
        cacheSize: cacheSize
      });
    },
    
    lastExtraction: () => {
      const service = TempoService.getInstance();
      const xmlData = service.xmlTempos.get(service.currentCacheKey);
      if (xmlData && xmlData.length > 0) {
        perfLogger.debug('[TEMPO V2] Last extraction:', {
          source: 'XML (Direct from MusicXML)',
          events: xmlData.length,
          measures: [...new Set(xmlData.map(t => t.measureNumber))].sort((a, b) => a - b),
          hasPositions: xmlData.some(t => t.offset !== undefined)
        });
      } else {
        perfLogger.debug('[TEMPO V2] No XML data - using OSMD fallback');
      }
    },
    
    clearCache: () => {
      const service = TempoService.getInstance();
      service.cache.invalidate();
      perfLogger.debug('[TEMPO V2] Cache cleared');
    }
  };
}

// LRU Cache implementation with O(1) operations
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;
  
  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }
  
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recent)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }
  
  set(key: K, value: V): void {
    // Remove if exists to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove oldest (first) entry - O(1)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, value);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  get size(): number {
    return this.cache.size;
  }
}

export class TempoService {
  private static instance: TempoService | null = null;
  public cache: AdvancedTempoCache;
  private performanceMonitor: TempoPerformanceMonitor;
  private extractor = new ExplicitTempoExtractor();
  private config = process.env.NODE_ENV === 'production' ? ProductionTempoConfig : DevelopmentTempoConfig;
  private worker: Worker | null = null;
  
  // Version Enhanced extraction - Multiple tempo sources
  public xmlTempos = new Map<string, XMLTempoEvent[]>();
  private osmdTempos = new Map<string, TempoWithPosition[]>();
  public currentCacheKey: string = '';
  
  private constructor() {
    this.cache = new AdvancedTempoCache({
      maxEntries: this.config.performance.cacheEnabled ? 50 : 0,
      enablePersistence: this.config.performance.cacheEnabled
    });
    this.performanceMonitor = new TempoPerformanceMonitor();
  }
  
  static getInstance(): TempoService {
    if (!TempoService.instance) {
      TempoService.instance = new TempoService();
    }
    return TempoService.instance;
  }
  
  /**
   * Extract tempo from OSMD instance
   */
  async extractFromOSMD(osmd: any, options: ExtractionOptions = {}): Promise<TempoMap> {
    const monitor = this.performanceMonitor.startExtraction();
    
    try {
      // Check XML data first (Phase 3 priority)
      const xmlData = this.xmlTempos.get(this.currentCacheKey);
      if (xmlData && xmlData.length > 0) {
        perfLogger.debug(`[TEMPO V2] Using XML source directly: ${xmlData.length} events`);
        
        // Convert XML events to TempoChangeEvents
        const events: TempoChangeEvent[] = xmlData.map(xml => ({
          measureIndex: xml.measureNumber - 1, // Convert to 0-based
          bpm: xml.bpm,
          source: 'xml' as const,
          confidence: 1.0,
          timestamp: Date.now(),
          beat: xml.beat,
          offset: xml.offset,
          text: xml.text
        }));
        
        // Sort by measure
        events.sort((a, b) => a.measureIndex - b.measureIndex);
        
        const defaultBpm = events[0]?.bpm || 120;
        const avgBpm = events.reduce((sum, e) => sum + e.bpm, 0) / events.length;
        
        const tempoMap: TempoMap = {
          events,
          defaultBpm,
          averageBpm: Math.round(avgBpm),
          hasExplicitTempo: true,
          confidence: 1.0,
          extractedAt: Date.now(),
          extractionDuration: 0
        };
        
        monitor.markComplete(tempoMap.events.length);
        return tempoMap;
      }
      
      // Fall back to OSMD extraction only if no XML data
      perfLogger.debug('[TEMPO V2] No XML data, falling back to OSMD extraction');
      
      // Validate OSMD
      const adapter = new OSMDAdapter(osmd);
      if (!adapter.isValidOSMD(osmd)) {
        monitor.markError('Invalid OSMD data');
        return createDefaultTempoMap();
      }
      
      // Check cache if enabled
      if (options.useCache !== false && this.config.performance.cacheEnabled) {
        const cacheKey = this.generateCacheKey(osmd);
        const cached = this.cache.get(cacheKey);
        if (cached) {
          perfLogger.debug('[TempoService] Returning cached tempo map');
          monitor.markComplete(cached.events.length);
          return cached;
        }
      }
      
      // Check if should use Web Worker
      const measureCount = adapter.getMeasures().length;
      if (measureCount > this.config.performance.webWorkerThreshold) {
        return await this.extractWithWorker(osmd, options, monitor);
      }
      
      // Perform extraction
      const tempoMap = await this.performExtraction(adapter, osmd, options);
      
      // V2 verification logging
      perfLogger.debug(`[TEMPO V2] OSMD extraction: ${tempoMap.events.length} events`);
      
      // Cache result
      if (options.useCache !== false && this.config.performance.cacheEnabled) {
        const cacheKey = this.generateCacheKey(osmd);
        const checksum = this.generateChecksum(osmd);
        this.cache.set(cacheKey, tempoMap, checksum);
      }
      
      monitor.markComplete(tempoMap.events.length);
      
      return tempoMap;
      
    } catch (error) {
      perfLogger.error('[TempoService] Extraction failed:', error);
      return createDefaultTempoMap();
    }
  }
  
  /**
   * Enhanced extraction with text expressions and optional heuristics
   */
  async extractFromOSMDEnhanced(
    osmd: any, 
    options: {
      enableTextExtraction?: boolean;
      enableHeuristics?: boolean;
      useCache?: boolean;
    } = {}
  ): Promise<TempoMap> {
    const startTime = performance.now();
    
    // Check cache first if enabled
    if (options.useCache !== false) {
      const cacheKey = this.generateCacheKey(osmd) + '::enhanced';
      const cached = this.cache.get(cacheKey);
      if (cached) {
        perfLogger.debug('[TempoService] Returning cached enhanced tempo map');
        return cached;
      }
    }
    
    try {
      const adapter = new OSMDAdapter(osmd);
      const allEvents: TempoChangeEvent[] = [];
      
      // Always run explicit extractor
      const explicitEvents = await this.extractor.extract(adapter, adapter.getMeasures());
      allEvents.push(...explicitEvents);
      
      // Conditionally load and run text extractor
      if (options.enableTextExtraction !== false) {
        try {
          perfLogger.debug('[TempoService] Running TextExpressionExtractor');
          const { TextExpressionExtractor } = await import('../extractors/TextExpressionExtractor');
          const textExtractor = new TextExpressionExtractor();
          const textEvents = textExtractor.extract(adapter, adapter.getMeasures());
          allEvents.push(...textEvents);
        } catch (error) {
          perfLogger.warn('[TempoService] Failed to load TextExpressionExtractor:', error);
        }
      }
      
      // Conditionally load and run heuristic extractor if no events found
      if (options.enableHeuristics && allEvents.length === 0) {
        try {
          const { HeuristicTempoExtractor } = await import('../extractors/HeuristicTempoExtractor');
          const heuristicExtractor = new HeuristicTempoExtractor();
          const heuristicEvents = heuristicExtractor.extract(adapter, adapter.getMeasures());
          allEvents.push(...heuristicEvents);
        } catch (error) {
          perfLogger.warn('[TempoService] Failed to load HeuristicTempoExtractor:', error);
        }
      }
      
      // Resolve conflicts and build tempo map
      const resolvedEvents = this.resolveConflicts(allEvents);
      const tempoMap = this.buildEnhancedTempoMap(resolvedEvents);
      
      // Cache result if enabled
      if (options.useCache !== false && tempoMap.events.length > 0) {
        const cacheKey = this.generateCacheKey(osmd) + '::enhanced';
        const checksum = this.generateChecksum(osmd);
        this.cache.set(cacheKey, tempoMap, checksum);
      }
      
      const duration = performance.now() - startTime;
      perfLogger.debug(`[TempoService] Enhanced extraction completed in ${duration.toFixed(2)}ms`);
      
      if (duration > 25) {
        perfLogger.warn(`[TempoService] Performance warning: extraction took ${duration.toFixed(2)}ms (> 25ms budget)`);
      }
      
      return tempoMap;
    } catch (error) {
      perfLogger.error('[TempoService] Enhanced extraction failed:', error);
      return this.createEmptyTempoMap();
    }
  }
  
  /**
   * Get tempo at a specific measure
   */
  getTempoAtMeasure(tempoMap: TempoMap, measureIndex: number): number {
    if (!tempoMap || !tempoMap.events || tempoMap.events.length === 0) {
      return tempoMap?.defaultBpm || 120;
    }
    
    // Find the last tempo event at or before this measure
    let currentBpm = tempoMap.defaultBpm;
    
    for (const event of tempoMap.events) {
      if (event.measureIndex <= measureIndex) {
        currentBpm = event.bpm;
      } else {
        break; // Events should be sorted by measure
      }
    }
    
    return currentBpm;
  }
  
  
  /**
   * Perform the actual extraction
   */
  private async performExtraction(
    adapter: OSMDAdapter, 
    osmd: any, 
    options: ExtractionOptions
  ): Promise<TempoMap> {
    const measures = adapter.getMeasures();
    
    // Extract events
    const events = this.extractor.extract(adapter, measures);
    
    // Resolve conflicts
    const resolvedEvents = this.resolveConflicts(events);
    
    // Sort by measure index
    resolvedEvents.sort((a, b) => a.measureIndex - b.measureIndex);
    
    // Calculate statistics
    const hasExplicitTempo = resolvedEvents.some(e => 
      e.source === 'explicit' || e.source === 'metronome'
    );
    
    const defaultBpm = resolvedEvents.length > 0 ? resolvedEvents[0].bpm : 120;
    
    const averageBpm = resolvedEvents.length > 0
      ? resolvedEvents.reduce((sum, e) => sum + e.bpm, 0) / resolvedEvents.length
      : defaultBpm;
    
    const confidence = resolvedEvents.length > 0
      ? resolvedEvents.reduce((sum, e) => sum + e.confidence, 0) / resolvedEvents.length
      : 0.5;
    
    return {
      events: resolvedEvents,
      defaultBpm,
      averageBpm: Math.round(averageBpm),
      hasExplicitTempo,
      confidence,
      extractedAt: Date.now(),
      extractionDuration: performance.now() - (options.maxDurationMs || 0)
    };
  }
  
  /**
   * Resolve conflicts between tempo events
   * Rules:
   * 1. For same measure: last event wins
   * 2. Between measures: highest confidence wins
   * 3. Confidence threshold: 0.5 minimum
   */
  private resolveConflicts(events: TempoChangeEvent[]): TempoChangeEvent[] {
    const measureMap = new Map<number, TempoChangeEvent[]>();
    
    // Group by measure
    for (const event of events) {
      if (event.confidence < 0.5) continue; // Ignore low confidence
      
      const existing = measureMap.get(event.measureIndex) || [];
      existing.push(event);
      measureMap.set(event.measureIndex, existing);
    }
    
    // Resolve conflicts
    const resolved: TempoChangeEvent[] = [];
    
    // Use Array.from for ES5 compatibility
    const entries = Array.from(measureMap.entries());
    for (const [measureIndex, measureEvents] of entries) {
      if (measureEvents.length === 1) {
        resolved.push(measureEvents[0]);
      } else {
        // Multiple events at same measure
        // Sort by confidence (descending) then by timestamp (last wins)
        measureEvents.sort((a, b) => {
          if (Math.abs(a.confidence - b.confidence) > 0.01) {
            return b.confidence - a.confidence;
          }
          return (b.timestamp || 0) - (a.timestamp || 0);
        });
        
        resolved.push(measureEvents[0]);
      }
    }
    
    return resolved;
  }
  
  /**
   * Generate cache key from OSMD instance
   */
  private generateCacheKey(osmd: any): string {
    try {
      const sheet = osmd?.Sheet || osmd?.sheet || {};
      const title = sheet.Title?.TextString || sheet.title?.TextString || 'untitled';
      const composer = sheet.Composer?.TextString || sheet.composer?.TextString || 'unknown';
      const measureCount = this.getMeasureCount(osmd);
      
      return `${title}::${composer}::${measureCount}`;
    } catch {
      return 'unknown::unknown::0';
    }
  }
  
  private getMeasureCount(osmd: any): number {
    try {
      const adapter = new OSMDAdapter(osmd);
      return adapter.getMeasures().length;
    } catch {
      return 0;
    }
  }
  
  /**
   * Build enhanced tempo map with additional metadata
   */
  private buildEnhancedTempoMap(events: TempoChangeEvent[]): TempoMap {
    if (events.length === 0) {
      return this.createEmptyTempoMap();
    }
    
    // Sort by measure index
    events.sort((a, b) => a.measureIndex - b.measureIndex);
    
    // Calculate statistics
    const hasExplicitTempo = events.some(e => e.source === 'explicit' || e.source === 'metronome');
    const hasTextTempo = events.some(e => e.source === 'text');
    
    const defaultBpm = events[0].bpm;
    const averageBpm = events.reduce((sum, e) => sum + e.bpm, 0) / events.length;
    const confidence = events.reduce((sum, e) => sum + e.confidence, 0) / events.length;
    
    return {
      events,
      defaultBpm,
      averageBpm: Math.round(averageBpm),
      hasExplicitTempo,
      hasTextTempo,
      confidence,
      extractedAt: Date.now(),
      extractionDuration: 0 // Will be updated by caller
    };
  }
  
  /**
   * Create an empty tempo map with defaults
   */
  private createEmptyTempoMap(): TempoMap {
    return {
      events: [],
      defaultBpm: 120,
      averageBpm: 120,
      hasExplicitTempo: false,
      hasTextTempo: false,
      confidence: 0,
      extractedAt: Date.now(),
      extractionDuration: 0
    };
  }

  /**
   * Extract tempo using Web Worker for large files
   */
  private async extractWithWorker(
    osmd: any, 
    options: ExtractionOptions,
    monitor: ReturnType<TempoPerformanceMonitor['startExtraction']>
  ): Promise<TempoMap> {
    try {
      // Lazy load worker
      if (!this.worker) {
        const WorkerConstructor = (await import('../workers/tempoWorker')).default;
        this.worker = new WorkerConstructor();
      }

      // Serialize OSMD data
      const serializedData = {
        measures: osmd.Sheet?.SourceMeasures || [],
        title: osmd.Sheet?.Title,
        composer: osmd.Sheet?.Composer
      };

      // Create promise for worker response
      const workerPromise = new Promise<TempoMap>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Worker timeout'));
        }, 60000); // 60 second timeout

        this.worker!.onmessage = (event) => {
          clearTimeout(timeout);
          
          if (event.data.type === 'TEMPO_EXTRACTED') {
            const { events, performance } = event.data.payload;
            
            // Build tempo map from events
            const tempoMap = this.buildEnhancedTempoMap(events || []);
            tempoMap.extractionDuration = performance?.totalTime || 0;
            
            resolve(tempoMap);
          } else {
            reject(new Error(event.data.payload.error || 'Worker error'));
          }
        };

        // Send extraction request
        this.worker!.postMessage({
          type: 'EXTRACT_TEMPO',
          payload: {
            osmdData: serializedData,
            options: {
              enableTextExtraction: options.enableTextExtraction !== false,
              enableHeuristics: options.enableHeuristics === true,
              fallbackBpm: this.config.features.fallbackBpm
            }
          }
        });
      });

      const tempoMap = await workerPromise;
      monitor.markComplete(tempoMap.events.length);
      
      return tempoMap;
    } catch (error) {
      perfLogger.error('[TempoService] Worker extraction failed:', error);
      monitor.markError(error instanceof Error ? error.message : 'Unknown error');
      
      // Fall back to main thread extraction
      const adapter = new OSMDAdapter(osmd);
      return this.performExtraction(adapter, osmd, options);
    }
  }

  /**
   * Generate checksum for cache validation
   */
  private generateChecksum(osmd: any): string {
    try {
      const data = {
        measureCount: osmd.Sheet?.SourceMeasures?.length || 0,
        title: osmd.Sheet?.Title || '',
        composer: osmd.Sheet?.Composer || '',
        // Include first and last measure tempos for better accuracy
        firstTempo: osmd.Sheet?.SourceMeasures?.[0]?.TempoInBpm,
        lastTempo: osmd.Sheet?.SourceMeasures?.slice(-1)?.[0]?.TempoInBpm
      };
      
      // Simple checksum using JSON string hash
      const str = JSON.stringify(data);
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      
      return Math.abs(hash).toString(16);
    } catch {
      return 'unknown';
    }
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cache.invalidate();
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): {
    avgExtractionTime: number;
    cacheStats: ReturnType<AdvancedTempoCache['getStats']>;
  } {
    return {
      avgExtractionTime: this.performanceMonitor.getAverageExtractionTime(),
      cacheStats: this.cache.getStats()
    };
  }

  // ==========================================
  // Version Enhanced Multi-Source Tempo Extraction
  // ==========================================

  /**
   * Store XML tempo data from worker (Phase 3 - Primary source)
   */
  public setXMLTempoData(cacheKey: string, tempoData?: XMLTempoEvent[]): void {
    if (!cacheKey) return;
    
    this.currentCacheKey = cacheKey;
    
    if (tempoData && tempoData.length > 0) {
      this.xmlTempos.set(cacheKey, tempoData);
      
      // V2 verification logging
      perfLogger.debug(`[TEMPO V2] XML source: ${tempoData.length} events`);
    }
  }

  /**
   * Get all tempos for a measure (Phase 3 - Source priority system)
   * Priority: XML > OSMD > Cache
   */
  public getTemposForMeasure(measureNumber: number): TempoWithPosition[] {
    
    // 1. Try XML data first (most accurate)
    const xmlData = this.xmlTempos.get(this.currentCacheKey);
    if (xmlData) {
      const xmlTemposForMeasure = xmlData
        .filter(t => t.measureNumber === measureNumber)
        .map(t => ({
          bpm: t.bpm,
          offset: t.offset,
          beat: t.beat,
          confidence: 1.0,
          source: 'xml' as const,
          text: t.text
        }));
      
      if (xmlTemposForMeasure.length > 0) {
        if (xmlTemposForMeasure.length > 1) {
          perfLogger.debug(`[TEMPO V2] M${measureNumber}: ${xmlTemposForMeasure.length} tempos from XML`);
        }
        return xmlTemposForMeasure.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
      }
    }
    
    // 2. Try enhanced OSMD extraction
    const osmdData = this.osmdTempos.get(this.currentCacheKey);
    if (osmdData) {
      const osmdTemposForMeasure = osmdData.filter(t => 
        // Need to map OSMD tempo to measure number
        // This requires tracking which measure each tempo belongs to
        true // Placeholder - implement measure mapping
      );
      
      if (osmdTemposForMeasure.length > 0) {
        return osmdTemposForMeasure;
      }
    }
    
    // 3. Fallback to legacy single tempo
    const cached = this.cache.get(this.currentCacheKey);
    if (cached?.measureMap.has(measureNumber)) {
      return [{
        bpm: cached.measureMap.get(measureNumber)!,
        offset: 0,
        beat: 0,
        confidence: 0.5,
        source: 'cache'
      }];
    }
    
    return [];
  }

  /**
   * Get tempo at specific position within measure (Phase 3)
   */
  public getTempoAtPosition(measureNumber: number, position: number): number {
    const tempos = this.getTemposForMeasure(measureNumber);
    
    // Find the tempo that applies at this position
    let activeTempo = this.config.features?.fallbackBpm || 120;
    
    for (const tempo of tempos) {
      if ((tempo.offset ?? 0) <= position) {
        activeTempo = tempo.bpm;
      } else {
        break; // Tempos are sorted
      }
    }
    
    return activeTempo;
  }

  /**
   * Backward compatible method (Phase 3)
   */
  getTempoForMeasure(measureNumber: number): number {
    const tempos = this.getTemposForMeasure(measureNumber);
    return tempos.length > 0 ? tempos[0].bpm : (this.config.features?.fallbackBpm || 120);
  }
}