import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import * as unzipper from 'unzipper';
import { performanceLogger } from '../utils/performanceLogger';
import { StreamingMusicXMLParser } from '../parsers/streamingMusicXMLParser';
import { MusicXMLTempoExtractor } from '../parsers/musicXMLTempoExtractor';
import { XMLTempoEvent } from '../../common/types';

// Worker Telemetry System - FIXED
// Workers don't inherit process.env - centralize filtering in main process instead


function sendTelemetry(type: string, payload: any = {}) {
  // Worker's job is to report unconditionally - main process will filter
  if (!parentPort) return;
  
  parentPort.postMessage({
    __telemetry: true,
    type,
    ts: performance.now(),
    ...payload
  });
}

interface WorkerData {
  filePath: string;
  jobId: string;
}

interface WorkerResult {
  success: boolean;
  jobId: string;
  content?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
  tempoData?: XMLTempoEvent[]; // Version Direct XML Tempo Extraction
  performance?: {
    readTime: number;
    parseTime: number;
    totalTime: number;
  };
}

interface ChunkMessage {
  type: 'chunk';
  jobId: string;
  data: {
    type: 'first' | 'progress' | 'complete';
    content: string;
    measureCount: number;
    isComplete: boolean;
  };
}

// Helper: Extract tempo data from XML content (deduplicates XML vs MXL logic)
function extractTempoData(content: string): XMLTempoEvent[] | undefined {
  try {
    performanceLogger.mark('tempo-extract-start');
    const tempoExtractor = new MusicXMLTempoExtractor();
    const tempoData = tempoExtractor.extract(content);
    performanceLogger.mark('tempo-extract-end');
    
    const extractTime = performanceLogger.measure('tempo-extract-start', 'tempo-extract-end');
    sendTelemetry('tempo:extracted', { 
      count: tempoData.length,
      extractTime,
      hasPositions: tempoData.some(t => t.offset !== undefined)
    });
    
    return tempoData;
  } catch (error) {
    return undefined; // Continue without tempo data (error resilience)
  }
}

// Helper: Read and validate file content (deduplicates processFile vs processFileWithParams)
async function readAndValidateFile(normalizedPath: string): Promise<{ content: string; readTime: number }> {
  const ext = path.extname(normalizedPath).toLowerCase();
  let content: string;
  
  performanceLogger.mark('read-start');
  
  if (ext === '.mxl') {
    content = await processMXLFile(normalizedPath);
  } else if (['.xml', '.musicxml'].includes(ext)) {
    content = await fs.readFile(normalizedPath, 'utf-8');
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }
  
  performanceLogger.mark('read-end');
  const readTime = performanceLogger.measure('read-start', 'read-end');
  
  // Basic XML validation
  performanceLogger.mark('validate-start');
  validateXMLContent(content);
  performanceLogger.mark('validate-end');
  
  return { content, readTime };
}

// Helper: Validate path and check file size (deduplicates validation logic)
async function validateAndStatFile(filePath: string): Promise<{ normalizedPath: string; stats: any }> {
  const normalizedPath = path.normalize(filePath);
  if (!path.isAbsolute(normalizedPath)) {
    throw new Error('Invalid file path');
  }
  
  performanceLogger.mark('stat-start');
  const stats = await fs.stat(normalizedPath);
  performanceLogger.mark('stat-end');
  
  const MAX_FILE_SIZE = 100 * 1024 * 1024;
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB (max: 100MB)`);
  }
  
  return { normalizedPath, stats };
}

async function processFile(): Promise<void> {
  const { filePath, jobId } = workerData as WorkerData;
  
  try {
    performanceLogger.mark('worker-start');
    sendTelemetry('worker:start', { filePath: path.basename(filePath) });
    
    const { normalizedPath, stats } = await validateAndStatFile(filePath);
    
    sendTelemetry('file:stats', { 
      size: stats.size, 
      sizeMB: (stats.size / 1024 / 1024).toFixed(2) 
    });
    
    // Use streaming for files > 1MB
    const STREAMING_THRESHOLD = 1024 * 1024; // 1MB
    if (stats.size > STREAMING_THRESHOLD) {
      sendTelemetry('processing:mode', { mode: 'streaming', threshold: STREAMING_THRESHOLD });
      await processFileWithStreaming(normalizedPath, jobId, stats.size);
      return;
    }
    
    sendTelemetry('processing:mode', { mode: 'synchronous', threshold: STREAMING_THRESHOLD });
    
    const { content, readTime } = await readAndValidateFile(normalizedPath);
    
    // Extract tempo data (now unified for all file types)
    const tempoData = extractTempoData(content);
    
    performanceLogger.mark('worker-end');
    const totalTime = performanceLogger.measure('worker-start', 'worker-end');
    
    sendTelemetry('worker:complete', { 
      readTime, 
      totalTime,
      contentLength: content.length 
    });
    
    const result: WorkerResult = {
      success: true,
      jobId,
      content,
      fileName: path.basename(normalizedPath),
      fileSize: stats.size,
      tempoData,
      performance: {
        readTime,
        parseTime: performanceLogger.measure('validate-start', 'validate-end'),
        totalTime
      }
    };
    
    parentPort?.postMessage(result);
  } catch (error) {
    const errorResult: WorkerResult = {
      success: false,
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    parentPort?.postMessage(errorResult);
  }
}

async function processMXLFile(filePath: string): Promise<string> {
  performanceLogger.mark('unzip-start');
  
  const directory = await unzipper.Open.file(filePath);
  
  // Find the main score file
  const scoreFile = directory.files.find((file: any) => 
    file.path.endsWith('.xml') && 
    !file.path.startsWith('META-INF/') &&
    !file.path.includes('container.xml')
  );
  
  if (!scoreFile) {
    throw new Error('No MusicXML score file found in MXL archive');
  }
  
  const content = await scoreFile.buffer();
  performanceLogger.mark('unzip-end');
  performanceLogger.measure('unzip-start', 'unzip-end', 'MXL Extraction');
  
  return content.toString('utf-8');
}

function validateXMLContent(content: string): void {
  // Basic XML structure validation
  if (!content.includes('<?xml')) {
    throw new Error('Invalid XML: Missing XML declaration');
  }
  
  if (!content.includes('<score-partwise') && !content.includes('<score-timewise')) {
    throw new Error('Invalid MusicXML: Missing score element');
  }
  
  // Quick parse test
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false
  });
  
  try {
    parser.parse(content);
  } catch (error) {
    throw new Error(`XML parsing failed: ${(error as Error).message}`);
  }
}

async function processFileWithStreaming(filePath: string, jobId: string, fileSize: number): Promise<void> {
  performanceLogger.mark('stream-start');
  sendTelemetry('stream:start', { fileSize, fileSizeMB: (fileSize / 1024 / 1024).toFixed(2) });
  
  return new Promise((resolve, reject) => {
    const ext = path.extname(filePath).toLowerCase();
    
    // Streaming only supported for XML files, not MXL
    if (ext === '.mxl') {
      reject(new Error('Streaming not supported for MXL files'));
      return;
    }
    
    if (!['.xml', '.musicxml'].includes(ext)) {
      reject(new Error(`Unsupported file type: ${ext}`));
      return;
    }
    
    const readStream = createReadStream(filePath, {
      encoding: 'utf8',
      highWaterMark: 64 * 1024 // 64KB chunks
    });
    
    const parser = new StreamingMusicXMLParser({
      chunkSize: 64 * 1024,
      maxBufferSize: 10 * 1024 * 1024,
      firstChunkMeasures: 4
    });
    
    let firstChunkSent = false;
    let measureCount = 0;
    
    parser.on('first-chunk', (data) => {
      performanceLogger.mark('first-chunk');
      sendTelemetry('stream:first-chunk', { 
        measureCount: data.measureCount,
        contentLength: data.content.length
      });
      parentPort?.postMessage({
        type: 'chunk',
        jobId,
        data: {
          type: 'first',
          content: data.content,
          measureCount: data.measureCount,
          isComplete: false
        }
      } as ChunkMessage);
      firstChunkSent = true;
      measureCount = data.measureCount;
    });
    
    parser.on('measure', () => {
      measureCount++;
    });
    
    parser.on('complete', (data) => {
      performanceLogger.mark('stream-end');
      performanceLogger.measure('stream-start', 'stream-end', 'Streaming Parse');
      
      const streamingTotalTime = performanceLogger.getMeasure('stream-start', 'stream-end') || 0;
      sendTelemetry('stream:complete', { 
        totalMeasures: data.totalMeasures,
        totalTime: streamingTotalTime,
        contentLength: data.content.length
      });
      
      parentPort?.postMessage({
        type: 'chunk',
        jobId,
        data: {
          type: 'complete',
          content: data.content,
          measureCount: data.totalMeasures,
          isComplete: true
        }
      } as ChunkMessage);
      
      // Send success result
      const result: WorkerResult = {
        success: true,
        jobId,
        fileName: path.basename(filePath),
        fileSize,
        performance: {
          readTime: performanceLogger.getMeasure('stream-start', 'first-chunk') || 0,
          parseTime: performanceLogger.getMeasure('first-chunk', 'stream-end') || 0,
          totalTime: streamingTotalTime
        }
      };
      
      parentPort?.postMessage(result);
      resolve();
    });
    
    parser.on('error', (error) => {
      parentPort?.postMessage({
        success: false,
        jobId,
        error: error.message
      } as WorkerResult);
      reject(error);
    });
    
    readStream
      .pipe(parser)
      .on('error', (error) => {
        parentPort?.postMessage({
          success: false,
          jobId,
          error: error.message
        } as WorkerResult);
        reject(error);
      });
  });
}

// Export for testing
export { processFile, processMXLFile, validateXMLContent, processFileWithStreaming };

// For testing - export a version that takes parameters (now deduplicated)
export async function processFileWithParams(filePath: string, jobId: string): Promise<WorkerResult> {
  try {
    performanceLogger.mark('worker-start');
    
    const { normalizedPath, stats } = await validateAndStatFile(filePath);
    const { content, readTime } = await readAndValidateFile(normalizedPath);
    
    performanceLogger.mark('worker-end');
    const totalTime = performanceLogger.measure('worker-start', 'worker-end');
    
    return {
      success: true,
      jobId,
      content,
      fileName: path.basename(normalizedPath),
      fileSize: stats.size,
      performance: {
        readTime,
        parseTime: performanceLogger.measure('validate-start', 'validate-end'),
        totalTime
      }
    };
  } catch (error) {
    return {
      success: false,
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Start processing when worker is initialized
if (parentPort) {
  processFile().catch(error => {
    console.error('Worker error:', error);
    parentPort?.postMessage({
      success: false,
      jobId: workerData?.jobId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  });
}