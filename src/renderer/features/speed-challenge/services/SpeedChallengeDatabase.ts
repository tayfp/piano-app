import Dexie, { type Table } from 'dexie';

interface NoteMetric {
  note: number;
  attempts: number;
  correct: number;
  averageTime: number;
  fastestTime: number;
}

interface PatternAttempt {
  patternId: string;
  timestamp: number;
  responseTime: number;
  correct: boolean;
  expectedNotes: number[];
  playedNote: number;
  difficulty: string;
}

interface SessionRecord {
  id?: number;
  sessionId?: string;
  timestamp: number;
  duration: number;
  totalPatterns: number;
  correctPatterns: number;
  accuracy: number;
  averageResponseTime: number;
  noteMetrics: Record<number, NoteMetric>;
  patternMetrics: PatternAttempt[];
  patternCompletionTimes?: number[];
  fastestPatternTime?: number;
  slowestPatternTime?: number;
}

class SpeedChallengeDatabase extends Dexie {
  sessions!: Table<SessionRecord>;
  patterns!: Table<PatternAttempt>;
  
  constructor() {
    super('SpeedChallengeData');
    
    // Define schema with sessionId support
    this.version(1).stores({
      sessions: '++id, timestamp, accuracy, sessionId',
      patterns: '++id, timestamp, correct, playedNote'
    });
  }
  
  async saveOrUpdateSession(session: SessionRecord): Promise<void> {
    if (session.sessionId) {
      // Try to find existing session
      const existing = await this.sessions
        .where('sessionId')
        .equals(session.sessionId)
        .first();
      
      if (existing && existing.id) {
        // Update existing session
        await this.sessions.update(existing.id, session);
      } else {
        // Create new session
        await this.sessions.add(session);
      }
    } else {
      // Legacy support - just add
      await this.sessions.add(session);
    }
  }
  
  // Keep old method for compatibility but delegate
  async saveSession(session: SessionRecord): Promise<void> {
    return this.saveOrUpdateSession(session);
  }
  
  async getRecentSessions(limit = 30): Promise<SessionRecord[]> {
    return await this.sessions
      .orderBy('timestamp')
      .reverse()
      .limit(limit)
      .toArray();
  }
  
  async getNotePerformance(): Promise<Map<number, NoteMetric>> {
    const sessions = await this.sessions.toArray();
    const noteMap = new Map<number, NoteMetric>();
    
    sessions.forEach(session => {
      Object.entries(session.noteMetrics).forEach(([note, metric]) => {
        const noteNum = Number(note);
        const existing = noteMap.get(noteNum) || {
          note: noteNum,
          attempts: 0,
          correct: 0,
          averageTime: 0,
          fastestTime: Infinity
        };
        
        // Aggregate the metrics
        const totalAttempts = existing.attempts + metric.attempts;
        const totalCorrect = existing.correct + metric.correct;
        
        // Weighted average for time
        const weightedAvg = existing.attempts > 0 
          ? (existing.averageTime * existing.attempts + metric.averageTime * metric.attempts) / totalAttempts
          : metric.averageTime;
        
        existing.attempts = totalAttempts;
        existing.correct = totalCorrect;
        existing.averageTime = weightedAvg;
        existing.fastestTime = Math.min(existing.fastestTime, metric.fastestTime);
        
        noteMap.set(noteNum, existing);
      });
    });
    
    return noteMap;
  }
  
  async clearOldSessions(daysToKeep = 30): Promise<void> {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    await this.sessions.where('timestamp').below(cutoffTime).delete();
  }
  
  async clearAllData(): Promise<boolean> {
    try {
      await this.transaction('rw', this.sessions, this.patterns, async () => {
        await this.sessions.clear();
        await this.patterns.clear();
      });
      return true;
    } catch (error) {
      console.error('Failed to clear all data:', error);
      throw error;
    }
  }

  async getDataStatistics(): Promise<{
    sessionCount: number;
    patternCount: number;
    oldestSession: number | null;
    newestSession: number | null;
    estimatedSizeKB: number;
  }> {
    try {
      const sessionCount = await this.sessions.count();
      const patternCount = await this.patterns.count();
      
      let oldestSession: number | null = null;
      let newestSession: number | null = null;
      
      if (sessionCount > 0) {
        const oldest = await this.sessions.orderBy('timestamp').first();
        const newest = await this.sessions.orderBy('timestamp').last();
        oldestSession = oldest?.timestamp || null;
        newestSession = newest?.timestamp || null;
      }
      
      // Rough estimate: 1KB per session, 0.2KB per pattern
      const estimatedSizeKB = sessionCount > 0 || patternCount > 0
        ? (sessionCount * 1) + (patternCount * 0.2)
        : 0;
      
      return {
        sessionCount,
        patternCount,
        oldestSession,
        newestSession,
        estimatedSizeKB: Math.round(estimatedSizeKB * 10) / 10,
      };
    } catch (error) {
      console.error('Failed to get data statistics:', error);
      throw error;
    }
  }
}

export const speedChallengeDB = new SpeedChallengeDatabase();
export type { SessionRecord, NoteMetric, PatternAttempt };