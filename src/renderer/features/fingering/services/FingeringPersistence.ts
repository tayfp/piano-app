/**
 * Fingering Persistence Service
 * 
 * Extends the Urtext Piano database to support fingering annotations.
 * Uses Dexie for IndexedDB storage with score-scoped data.
 */

import { perfLogger } from '@/renderer/utils/performance-logger';
import { practiceDatabase, type FingeringAnnotation } from '@/renderer/services/PracticeDatabase';

export class FingeringPersistence {
  private db: typeof practiceDatabase;
  private readyPromise: Promise<void>;
  
  constructor() {
    this.db = practiceDatabase;
    this.readyPromise = this.db.open().catch((error: unknown) => {
      perfLogger.error('FingeringPersistence: Database failed to open.', error instanceof Error ? error : new Error(String(error)));
      throw error;
    });
  }
  
  /**
   * Returns a promise that resolves when the database is initialized and ready.
   * This is the preferred way for consumers to await database readiness.
   */
  public onReady(): Promise<void> {
    return this.readyPromise;
  }
  
  /**
   * Get database instance (for testing)
   */
  getDatabase(): typeof practiceDatabase {
    return this.db;
  }

  /**
   * Save fingering annotation for a specific note in a score
   * Uses manual upsert pattern to handle compound unique index properly
   */
  async saveFingering(scoreId: string, noteId: string, finger: number): Promise<void> {
    if (!scoreId || !noteId) {
      perfLogger.warn('[FingeringPersistence] Missing scoreId or noteId');
      return;
    }

    if (!Number.isInteger(finger) || finger < 1 || finger > 5) {
      perfLogger.warn(`[FingeringPersistence] Invalid finger value: ${finger}`);
      return;
    }

    try {
      // Ensure database is ready before accessing tables
      await this.onReady();
      
      // Manual upsert pattern for compound unique index [scoreId+noteId]
      // Dexie's put() does NOT have true upsert semantics for unique indexes
      const existing = await this.db.fingeringAnnotations
        .where('[scoreId+noteId]')
        .equals([scoreId, noteId])
        .first();

      if (existing) {
        // Update existing record using its primary key
        await this.db.fingeringAnnotations.update(existing.id!, { finger });
      } else {
        // Add new record
        await this.db.fingeringAnnotations.add({ scoreId, noteId, finger });
      }
    } catch (error) {
      perfLogger.error('Failed to save fingering:', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Load all fingering annotations for a given score
   * @returns Record mapping noteId to fingering number
   */
  async loadFingerings(scoreId: string): Promise<Record<string, number>> {
    if (!scoreId) {
      perfLogger.warn('[FingeringPersistence] Cannot load fingerings without scoreId');
      return {};
    }

    try {
      // Ensure database is ready before accessing tables
      await this.onReady();
      const annotations = await this.db.fingeringAnnotations
        .where('scoreId')
        .equals(scoreId)
        .toArray();
      
      const result = annotations.reduce((acc, curr) => {
        acc[curr.noteId] = curr.finger;
        return acc;
      }, {} as Record<string, number>);
      
      return result;
    } catch (error) {
      perfLogger.error('Failed to load fingerings:', error instanceof Error ? error : new Error(String(error)));
      return {};
    }
  }

  /**
   * Get fingering for a specific note
   */
  async getFingeringAnnotation(scoreId: string, noteId: string): Promise<FingeringAnnotation | null> {
    if (!scoreId || !noteId) return null;

    try {
      // Ensure database is ready before accessing tables
      await this.onReady();
      const annotation = await this.db.fingeringAnnotations
        .where('[scoreId+noteId]')
        .equals([scoreId, noteId])
        .first();
      
      return annotation || null;
    } catch (error) {
      perfLogger.error('Failed to get fingering:', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * Remove fingering annotation for a specific note
   */
  async removeFingering(scoreId: string, noteId: string): Promise<void> {
    if (!scoreId || !noteId) return;

    try {
      // Ensure database is ready before accessing tables
      await this.onReady();
      await this.db.fingeringAnnotations
        .where('[scoreId+noteId]')
        .equals([scoreId, noteId])
        .delete();
    } catch (error) {
      perfLogger.error('Failed to remove fingering:', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Remove all fingering annotations for a score
   */
  async clearFingeringsForScore(scoreId: string): Promise<void> {
    if (!scoreId) return;

    try {
      // Ensure database is ready before accessing tables
      await this.onReady();
      await this.db.fingeringAnnotations
        .where('scoreId')
        .equals(scoreId)
        .delete();
    } catch (error) {
      perfLogger.error('Failed to clear fingerings for score:', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Remove ALL fingering annotations from database (dev/testing only)
   */
  async clearAllFingerings(): Promise<void> {
    try {
      await this.onReady();
      await this.db.fingeringAnnotations.clear();
      perfLogger.debug('[DEV] Cleared all fingerings from database');
    } catch (error) {
      perfLogger.error('Failed to clear all fingerings:', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Batch save multiple fingerings (for performance)
   * Uses manual upsert pattern to handle compound unique index properly
   */
  async saveFingeringsBatch(scoreId: string, fingerings: Record<string, number>): Promise<void> {
    if (!scoreId || !fingerings || Object.keys(fingerings).length === 0) return;

    try {
      // Ensure database is ready before accessing tables
      await this.onReady();
      
      // Deduplicate entries by noteId (prevents duplicate operations)
      const uniqueFingerings = new Map<string, number>();
      for (const [noteId, finger] of Object.entries(fingerings)) {
        if (Number.isInteger(finger) && finger >= 1 && finger <= 5) {
          uniqueFingerings.set(noteId, finger);
        }
      }

      if (uniqueFingerings.size === 0) return;

      // Manual upsert pattern for compound unique index [scoreId+noteId]
      // Dexie's put() does NOT have true upsert semantics for unique indexes
      await this.db.transaction('rw', this.db.fingeringAnnotations, async () => {
        for (const [noteId, finger] of uniqueFingerings) {
          try {
            // Try to get existing record first
            const existing = await this.db.fingeringAnnotations
              .where('[scoreId+noteId]')
              .equals([scoreId, noteId])
              .first();

            if (existing) {
              // Update existing record using its primary key
              await this.db.fingeringAnnotations.update(existing.id!, { finger });
            } else {
              // Add new record
              await this.db.fingeringAnnotations.add({ scoreId, noteId, finger });
            }
          } catch (innerError) {
            // If we still get a constraint error, log it but continue with other records
            perfLogger.warn(`Failed to save fingering for note ${noteId}:`, innerError instanceof Error ? innerError : new Error(String(innerError)));
          }
        }
      });
    } catch (error) {
      perfLogger.error('Failed to batch save fingerings:', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get count of fingering annotations for a score
   */
  async getFingeringCount(scoreId: string): Promise<number> {
    if (!scoreId) return 0;

    try {
      // Ensure database is ready before accessing tables
      await this.onReady();
      return await this.db.fingeringAnnotations
        .where('scoreId')
        .equals(scoreId)
        .count();
    } catch (error) {
      perfLogger.error('Failed to get fingering count:', error instanceof Error ? error : new Error(String(error)));
      return 0;
    }
  }

}

// Export singleton instance
export const fingeringPersistence = new FingeringPersistence();