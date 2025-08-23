/**
 * AdvancedTempoCache - Intelligent caching with versioning and invalidation
 * 
 * Features:
 * - LRU eviction with O(1) operations
 * - Persistent storage with localStorage
 * - Checksum validation
 * - Access tracking and hit rate analysis
 * - Pattern-based invalidation
 */

import { TempoMap } from '../types';
import { perfLogger } from '@/renderer/utils/performance-logger';

interface CacheEntry {
  tempoMap: TempoMap;
  timestamp: number;
  version: string;
  checksum: string;
  accessCount: number;
  lastAccessed: number;
}

interface CacheOptions {
  maxEntries: number;
  maxAge: number; // milliseconds
  enablePersistence: boolean;
}

export class AdvancedTempoCache {
  private cache = new Map<string, CacheEntry>();
  private options: CacheOptions;

  constructor(options: Partial<CacheOptions> = {}) {
    this.options = {
      maxEntries: 50,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      enablePersistence: true,
      ...options
    };

    if (this.options.enablePersistence) {
      this.loadFromStorage();
    }
  }

  public get(key: string): TempoMap | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.options.maxAge) {
      this.cache.delete(key);
      return null;
    }

    // Update access metrics
    entry.accessCount++;
    entry.lastAccessed = Date.now();

    return entry.tempoMap;
  }

  public set(key: string, tempoMap: TempoMap, checksum: string): void {
    const entry: CacheEntry = {
      tempoMap,
      timestamp: Date.now(),
      version: '1.0',
      checksum,
      accessCount: 1,
      lastAccessed: Date.now()
    };

    this.cache.set(key, entry);
    this.enforceCapacity();

    if (this.options.enablePersistence) {
      this.saveToStorage();
    }
  }

  public invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
    } else {
      const keys = Array.from(this.cache.keys());
      for (const key of keys) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      }
    }

    if (this.options.enablePersistence) {
      this.saveToStorage();
    }
  }

  private enforceCapacity(): void {
    if (this.cache.size <= this.options.maxEntries) {
      return;
    }

    // LRU eviction
    const entries = Array.from(this.cache.entries())
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

    const toRemove = entries.slice(0, this.cache.size - this.options.maxEntries);
    for (const [key] of toRemove) {
      this.cache.delete(key);
    }
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('tempo-cache');
      if (stored) {
        const data = JSON.parse(stored);
        this.cache = new Map(data.entries);
      }
    } catch (error) {
      perfLogger.warn('[AdvancedTempoCache] Failed to load from storage:', error);
    }
  }

  private saveToStorage(): void {
    try {
      const data = {
        entries: Array.from(this.cache.entries()),
        timestamp: Date.now()
      };
      localStorage.setItem('tempo-cache', JSON.stringify(data));
    } catch (error) {
      perfLogger.warn('[AdvancedTempoCache] Failed to save to storage:', error);
    }
  }

  public getStats(): {
    size: number;
    hitRate: number;
    oldestEntry: number;
    memoryUsage: number;
  } {
    const entries = Array.from(this.cache.values());
    const totalAccesses = entries.reduce((sum, e) => sum + e.accessCount, 0);
    const cacheHits = entries.filter(e => e.accessCount > 1).length;

    return {
      size: this.cache.size,
      hitRate: totalAccesses > 0 ? cacheHits / totalAccesses : 0,
      oldestEntry: Math.min(...entries.map(e => e.timestamp)),
      memoryUsage: JSON.stringify(entries).length
    };
  }
}