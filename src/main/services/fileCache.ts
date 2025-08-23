import { XMLTempoEvent } from '../../common/types';

interface CachedFile {
  content: string;
  fileName: string;
  fileSize: number;
  tempoData?: XMLTempoEvent[]; // Version Direct XML Tempo Extraction
  version: number;
  timestamp: number;
}

export class FileCache {
  private cache = new Map<string, CachedFile>();
  private versionCounter = 0;
  private readonly maxCacheSize = 10; // Limit cache entries
  private readonly maxAge = 5 * 60 * 1000; // 5 minutes
  
  set(jobId: string, data: Omit<CachedFile, 'version' | 'timestamp'>): void {
    // Evict oldest entries if cache is full
    if (this.cache.size >= this.maxCacheSize && this.maxCacheSize > 0) {
      const oldestKey = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      this.cache.delete(oldestKey);
    }
    
    this.cache.set(jobId, {
      ...data,
      version: ++this.versionCounter,
      timestamp: Date.now()
    });
  }
  
  get(jobId: string): CachedFile | null {
    const entry = this.cache.get(jobId);
    if (!entry) return null;
    
    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(jobId);
      return null;
    }
    
    return entry;
  }
  
  clear(): void {
    this.cache.clear();
  }
}

export const fileCache = new FileCache();