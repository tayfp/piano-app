/**
 * Shared Practice Database Module
 * 
 * Centralized IndexedDB database definition for Urtext Piano.
 * This ensures all services use the same database instance and schema.
 */

import Dexie, { type Table } from 'dexie';
import type { PracticeSession } from '../features/practice-mode/types';
import { perfLogger } from '../utils/performance-logger';

// Interface for fingering annotation records
interface FingeringAnnotation {
  id?: number;
  scoreId: string;
  noteId: string;
  finger: number;
}

// Singleton database class
class PracticeDatabase extends Dexie {
  sessions!: Table<PracticeSession>;
  fingeringAnnotations!: Table<FingeringAnnotation>;
  
  constructor() {
    super('UrtextPianoPractice');
    
    // Version 1: Original schema
    this.version(1).stores({
      sessions: '++id, scoreId, startTime, endTime'
    });

    // Version 2: Add fingering annotations table
    this.version(2).stores({
      sessions: '++id, scoreId, startTime, endTime', // Unchanged
      // Compound unique index prevents duplicate fingerings for same note
      fingeringAnnotations: '++id, &[scoreId+noteId], scoreId'
    });
    // No .upgrade() needed - adding new empty table
  }
}

// Create and initialize singleton instance
const practiceDatabase = new PracticeDatabase();

// Open the database immediately to ensure it's ready
// This ensures tables are initialized before any service tries to use them
practiceDatabase.open().catch(error => {
  perfLogger.error('Failed to open practice database:', error instanceof Error ? error : new Error(String(error)));
});

// Export initialized instance
export { practiceDatabase };

// Export types
export type { FingeringAnnotation };