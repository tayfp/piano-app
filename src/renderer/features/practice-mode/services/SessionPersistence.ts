/**
 * Session Persistence Service
 * 
 * Manages practice session data using IndexedDB via Dexie.
 * Provides session CRUD operations, auto-save, and recovery features.
 */

import type { PracticeSession } from '../types';
import { perfLogger } from '../../../utils/performance-logger';
import { practiceDatabase } from '../../../services/PracticeDatabase';

export class SessionPersistence {
  private db = practiceDatabase;
  private currentSessionId: number | null = null;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  
  /**
   * Start a new practice session
   */
  async startSession(scoreId: string): Promise<number> {
    try {
      const session: PracticeSession = {
        scoreId,
        startTime: Date.now(),
        progress: {
          measureIndex: 0,
          noteIndex: 0,
          completedNotes: 0,
          totalNotes: 0
        },
        statistics: {
          correctNotes: 0,
          incorrectAttempts: 0,
          averageReactionTime: 0,
          practiceTimeMs: 0
        }
      };
      
      this.currentSessionId = await this.db.sessions.add(session);
      return this.currentSessionId;
    } catch (error) {
      throw new Error('Failed to start session: ' + (error as Error).message);
    }
  }
  
  // NOTE: Fingering methods removed - use FingeringPersistence service instead
  // These obsolete localStorage-based methods were deleted to prevent confusion
  // All fingering data is now managed via IndexedDB in FingeringPersistence

  /**
   * Update progress for the current session
   */
  async updateProgress(updates: Partial<PracticeSession>): Promise<void> {
    if (!this.currentSessionId) return;
    
    try {
      await this.db.sessions.update(this.currentSessionId, updates);
    } catch (error) {
      perfLogger.error('Failed to update session:', error);
    }
  }
  
  /**
   * End the current session with final statistics
   */
  async endSession(finalData?: Partial<PracticeSession>): Promise<void> {
    if (!this.currentSessionId) return;
    
    try {
      const updates = {
        ...finalData,
        endTime: Date.now()
      };
      
      await this.db.sessions.update(this.currentSessionId, updates);
      this.currentSessionId = null;
      
      // Stop auto-save
      if (this.autoSaveInterval) {
        clearInterval(this.autoSaveInterval);
        this.autoSaveInterval = null;
      }
    } catch (error) {
      perfLogger.error('Failed to end session:', error);
    }
  }
  
  /**
   * Get a specific session by ID
   */
  async getSession(sessionId: number): Promise<PracticeSession | undefined> {
    return this.db.sessions.get(sessionId);
  }
  
  /**
   * Get recent sessions for a score
   */
  async getRecentSessions(scoreId: string, limit = 10): Promise<PracticeSession[]> {
    return this.db.sessions
      .where('scoreId')
      .equals(scoreId)
      .reverse()
      .limit(limit)
      .toArray();
  }
  
  /**
   * Recover the last incomplete session for a score
   */
  async recoverLastSession(scoreId: string): Promise<PracticeSession | null> {
    const incompleteSessions = await this.db.sessions
      .where('scoreId')
      .equals(scoreId)
      .filter(session => !session.endTime)
      .reverse()
      .limit(1)
      .toArray();
    
    return incompleteSessions[0] || null;
  }
  
  /**
   * Get statistics summary for all sessions of a score
   */
  async getSessionsSummary(scoreId: string): Promise<{
    totalSessions: number;
    totalPracticeTime: number;
    totalCorrectNotes: number;
    totalIncorrectAttempts: number;
    averageAccuracy: number;
    averageSessionDuration: number;
  }> {
    const sessions = await this.db.sessions
      .where('scoreId')
      .equals(scoreId)
      .toArray();
    
    if (sessions.length === 0) {
      return {
        totalSessions: 0,
        totalPracticeTime: 0,
        totalCorrectNotes: 0,
        totalIncorrectAttempts: 0,
        averageAccuracy: 0,
        averageSessionDuration: 0
      };
    }
    
    const totalCorrectNotes = sessions.reduce((sum, s) => sum + s.statistics.correctNotes, 0);
    const totalIncorrectAttempts = sessions.reduce((sum, s) => sum + s.statistics.incorrectAttempts, 0);
    const totalPracticeTime = sessions.reduce((sum, s) => sum + s.statistics.practiceTimeMs, 0);
    
    const totalAttempts = totalCorrectNotes + totalIncorrectAttempts;
    const averageAccuracy = totalAttempts > 0 ? (totalCorrectNotes / totalAttempts) * 100 : 0;
    
    return {
      totalSessions: sessions.length,
      totalPracticeTime,
      totalCorrectNotes,
      totalIncorrectAttempts,
      averageAccuracy,
      averageSessionDuration: totalPracticeTime / sessions.length
    };
  }
  
  /**
   * Enable auto-save for the current session
   */
  enableAutoSave(getState: () => Partial<PracticeSession>): () => void {
    // Clear any existing interval
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    
    // Save every 30 seconds
    this.autoSaveInterval = setInterval(() => {
      if (this.currentSessionId) {
        const state = getState();
        this.updateProgress(state);
      }
    }, 30000);
    
    // Return cleanup function
    return () => {
      if (this.autoSaveInterval) {
        clearInterval(this.autoSaveInterval);
        this.autoSaveInterval = null;
      }
    };
  }
  
  /**
   * Clean up old sessions beyond retention limit
   */
  async cleanupOldSessions(scoreId: string, maxSessions = 20): Promise<void> {
    const sessions = await this.db.sessions
      .where('scoreId')
      .equals(scoreId)
      .reverse()
      .toArray();
    
    if (sessions.length > maxSessions) {
      const toDelete = sessions.slice(maxSessions);
      const ids = toDelete.map(s => s.id!).filter(id => id !== undefined);
      
      await this.db.sessions.bulkDelete(ids);
    }
  }
  
  /**
   * Sync with practice store (for integration)
   */
  async syncWithStore(): Promise<void> {
    if (!this.currentSessionId) return;
    
    // Get current state from practice store
    const { usePracticeStore } = await import('../stores/practiceStore');
    let store: any;
    
    // Handle both Zustand patterns
    if (typeof usePracticeStore === 'function') {
      const result = usePracticeStore();
      store = result.getState ? result.getState() : result;
    } else {
      store = usePracticeStore;
    }
    
    // Extract relevant data
    const updates: Partial<PracticeSession> = {
      progress: {
        measureIndex: store?.currentStep?.measureIndex || 0,
        noteIndex: 0, // Would need to track this
        completedNotes: store?.statistics?.correctNotes || 0,
        totalNotes: 100 // Would need to track this
      },
      statistics: store?.statistics || {
        correctNotes: 0,
        incorrectAttempts: 0,
        averageReactionTime: 0,
        practiceTimeMs: 0
      }
    };
    
    await this.updateProgress(updates);
  }
  
  /**
   * Export sessions as JSON for backup
   */
  async exportSessions(scoreId?: string): Promise<string> {
    const sessions = scoreId
      ? await this.getRecentSessions(scoreId, 1000)
      : await this.db.sessions.toArray();
    
    return JSON.stringify(sessions, null, 2);
  }
  
  /**
   * Import sessions from JSON backup
   */
  async importSessions(jsonData: string): Promise<number> {
    try {
      const sessions = JSON.parse(jsonData) as PracticeSession[];
      
      // Remove IDs to let DB auto-generate new ones
      const sessionsWithoutIds = sessions.map(({ id, ...session }) => session);
      
      await this.db.sessions.bulkAdd(sessionsWithoutIds);
      return sessionsWithoutIds.length;
    } catch (error) {
      throw new Error('Failed to import sessions: ' + (error as Error).message);
    }
  }
}