/**
 * Web Worker for tempo extraction
 * 
 * Moves heavy extraction processing to background thread
 * to maintain UI responsiveness
 */

import type { TempoChangeEvent, ITempoExtractor } from '../types';
import { perfLogger } from '@/renderer/utils/performance-logger';

interface WorkerMessage {
  type: 'EXTRACT_TEMPO';
  payload: {
    osmdData: any; // Serialized OSMD data
    options: {
      enableTextExtraction: boolean;
      enableHeuristics: boolean;
      fallbackBpm: number;
    };
  };
}

interface WorkerResponse {
  type: 'TEMPO_EXTRACTED' | 'TEMPO_ERROR';
  payload: {
    events?: TempoChangeEvent[];
    error?: string;
    performance?: {
      totalTime: number;
      extractorTimes: Record<string, number>;
    };
  };
}

// Worker context
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const startTime = performance.now();
  
  try {
    const { osmdData, options } = event.data.payload;
    
    // Reconstruct OSMD-like object from serialized data
    const mockOSMD = reconstructOSMDData(osmdData);
    
    // Dynamic imports to reduce initial bundle
    const { OSMDAdapter } = await import('../adapters/OSMDAdapter');
    const adapter = new OSMDAdapter(mockOSMD);
    
    const extractorTimes: Record<string, number> = {};
    const allEvents: TempoChangeEvent[] = [];
    
    // Explicit extraction - always run
    const explicitStart = performance.now();
    const { ExplicitTempoExtractor } = await import('../extractors/ExplicitTempoExtractor');
    const explicitExtractor = new ExplicitTempoExtractor();
    const explicitEvents = explicitExtractor.extract(adapter, adapter.getMeasures());
    extractorTimes['explicit'] = performance.now() - explicitStart;
    allEvents.push(...explicitEvents);
    
    // Text extraction if enabled
    if (options.enableTextExtraction) {
      try {
        const textStart = performance.now();
        const { TextExpressionExtractor } = await import('../extractors/TextExpressionExtractor');
        const textExtractor = new TextExpressionExtractor();
        const textEvents = textExtractor.extract(adapter, adapter.getMeasures());
        extractorTimes['text'] = performance.now() - textStart;
        allEvents.push(...textEvents);
      } catch (error) {
        perfLogger.warn('[TempoWorker] Text extraction failed:', error);
      }
    }
    
    // Heuristic extraction if enabled and no events found
    if (options.enableHeuristics && allEvents.length === 0) {
      try {
        const heuristicStart = performance.now();
        const { HeuristicTempoExtractor } = await import('../extractors/HeuristicTempoExtractor');
        const heuristicExtractor = new HeuristicTempoExtractor();
        const heuristicEvents = heuristicExtractor.extract(adapter, adapter.getMeasures());
        extractorTimes['heuristic'] = performance.now() - heuristicStart;
        allEvents.push(...heuristicEvents);
      } catch (error) {
        perfLogger.warn('[TempoWorker] Heuristic extraction failed:', error);
      }
    }
    
    const totalTime = performance.now() - startTime;
    
    const response: WorkerResponse = {
      type: 'TEMPO_EXTRACTED',
      payload: {
        events: allEvents,
        performance: {
          totalTime,
          extractorTimes
        }
      }
    };
    
    self.postMessage(response);
    
  } catch (error) {
    const response: WorkerResponse = {
      type: 'TEMPO_ERROR',
      payload: {
        error: error instanceof Error ? error.message : 'Unknown worker error'
      }
    };
    
    self.postMessage(response);
  }
};

function reconstructOSMDData(serializedData: any): any {
  // Reconstruct minimal OSMD-like structure from serialized data
  return {
    Sheet: {
      SourceMeasures: serializedData.measures || [],
      Title: serializedData.title,
      Composer: serializedData.composer
    }
  };
}

// Type assertion for TypeScript
export default {} as typeof Worker & { new (): Worker };