import { create } from 'zustand';
import { speedChallengeDB, type SessionRecord, type NoteMetric } from '../services/SpeedChallengeDatabase';
import { useSpeedChallengeStore } from './speedChallengeStore';
import { perfLogger } from '@/renderer/utils/performance-logger';

interface NoteStats {
  note: number;
  noteName: string;
  accuracy: number;
  averageTime: number;
  attempts: number;
}

interface SpeedChallengeStatsState {
  // Data
  isLoading: boolean;
  allTimeSessions: number;
  totalPracticeTime: number;
  overallAccuracy: number;
  fastestTime: number;
  slowestTime: number;
  longestStreak: number;
  notePerformance: NoteStats[];
  recentSessions: SessionRecord[];
  
  // UI State
  isOpen: boolean;
  activeTab: 'overview' | 'details' | 'trends' | 'manage';
  showClearConfirmation: boolean;
  isClearing: boolean;
  dataStatistics: {
    sessionCount: number;
    patternCount: number;
    oldestSession: number | null;
    newestSession: number | null;
    estimatedSizeKB: number;
  } | null;
  
  // Actions
  loadStats: () => Promise<void>;
  openStats: () => void;
  closeStats: () => void;
  setActiveTab: (tab: 'overview' | 'details' | 'trends' | 'manage') => void;
  exportData: () => void;
  clearAllStats: () => Promise<void>;
  setShowClearConfirmation: (show: boolean) => void;
  getDataStatistics: () => Promise<void>;
}

/**
 * Convert MIDI note number to note name
 */
function getNoteNameFromMidi(midi: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const note = noteNames[midi % 12];
  return `${note}${octave}`;
}

/**
 * Calculate streak of consecutive successful sessions
 */
function calculateLongestStreak(sessions: SessionRecord[]): number {
  let maxStreak = 0;
  let currentStreak = 0;
  
  // Sessions are already sorted by timestamp (newest first)
  for (const session of sessions) {
    if (session.accuracy >= 0.7) { // 70% accuracy threshold for "successful"
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }
  
  return maxStreak;
}

export const useSpeedChallengeStatsStore = create<SpeedChallengeStatsState>((set, get) => ({
  // Initial state
  isLoading: false,
  allTimeSessions: 0,
  totalPracticeTime: 0,
  overallAccuracy: 0,
  fastestTime: Infinity,
  slowestTime: 0,
  longestStreak: 0,
  notePerformance: [],
  recentSessions: [],
  isOpen: false,
  activeTab: 'overview',
  showClearConfirmation: false,
  isClearing: false,
  dataStatistics: null,
  
  // Actions
  loadStats: async () => {
    set({ isLoading: true });
    
    // DON'T auto-persist here - it creates duplicate sessions!
    // The active session will be persisted when it ends or when explicitly requested
    
    try {
      const sessions = await speedChallengeDB.getRecentSessions(100);
      const notePerf = await speedChallengeDB.getNotePerformance();
      
      if (sessions.length === 0) {
        set({
          isLoading: false,
          allTimeSessions: 0,
          totalPracticeTime: 0,
          overallAccuracy: 0,
          fastestTime: 0,
          slowestTime: 0,
          longestStreak: 0,
          notePerformance: [],
          recentSessions: []
        });
        return;
      }
      
      // Calculate aggregates
      const totalTime = sessions.reduce((sum, s) => sum + s.duration, 0);
      const avgAccuracy = sessions.reduce((sum, s) => sum + s.accuracy, 0) / sessions.length || 0;
      
      // Fix fastest time - use pattern times, not average response time
      const allPatternTimes = sessions
        .flatMap(s => s.patternCompletionTimes || [])
        .filter(t => t > 0);
      
      const fastest = allPatternTimes.length > 0 
        ? Math.min(...allPatternTimes) 
        : Infinity;  // Use Infinity for "no data", not 0
      
      const slowest = allPatternTimes.length > 0 
        ? Math.max(...allPatternTimes) 
        : 0;
      
      // Count unique sessions by sessionId
      const uniqueSessionIds = new Set(
        sessions
          .map(s => s.sessionId)
          .filter(Boolean)
      );
      const sessionCount = uniqueSessionIds.size || sessions.length;  // Fallback for legacy
      
      const longestStreak = calculateLongestStreak(sessions);
      
      // Convert note performance to array
      const noteStats: NoteStats[] = Array.from(notePerf.entries()).map(([note, metric]) => ({
        note,
        noteName: getNoteNameFromMidi(note),
        accuracy: metric.attempts > 0 ? (metric.correct / metric.attempts) * 100 : 0,
        averageTime: metric.averageTime,
        attempts: metric.attempts
      }));
      
      // Sort by accuracy (worst first) for easy identification of problem areas
      noteStats.sort((a, b) => a.accuracy - b.accuracy);
      
      set({
        allTimeSessions: sessionCount,  // Use unique count
        totalPracticeTime: totalTime,
        overallAccuracy: avgAccuracy,
        fastestTime: fastest === Infinity ? 0 : fastest,  // Convert Infinity back to 0 for display
        slowestTime: slowest,
        longestStreak,
        notePerformance: noteStats,
        recentSessions: sessions.slice(0, 30),
        isLoading: false
      });
    } catch (error) {
      console.error('Failed to load stats:', error);
      set({ isLoading: false });
    }
  },
  
  openStats: () => {
    set({ isOpen: true });
    get().loadStats();
  },
  
  closeStats: () => {
    set({ isOpen: false });
  },
  
  setActiveTab: (tab) => {
    set({ activeTab: tab });
  },
  
  exportData: () => {
    const state = get();
    const data = {
      exportDate: new Date().toISOString(),
      version: '1.0.0',
      sessions: state.recentSessions,
      notePerformance: state.notePerformance,
      summary: {
        totalSessions: state.allTimeSessions,
        totalPracticeTime: state.totalPracticeTime,
        overallAccuracy: state.overallAccuracy,
        fastestTime: state.fastestTime,
        slowestTime: state.slowestTime,
        longestStreak: state.longestStreak
      }
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `speed-challenge-stats-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
  
  clearAllStats: async () => {
    const state = get();
    
    // Check if there's an active session
    const speedChallengeStore = useSpeedChallengeStore.getState();
    if (speedChallengeStore.isActive) {
      console.warn('Cannot clear stats while session is active');
      return;
    }
    
    set({ isClearing: true, showClearConfirmation: false });
    
    try {
      await speedChallengeDB.clearAllData();
      
      // Reset all stats to initial state
      set({
        allTimeSessions: 0,
        totalPracticeTime: 0,
        overallAccuracy: 0,
        fastestTime: 0,
        slowestTime: 0,
        longestStreak: 0,
        notePerformance: [],
        recentSessions: [],
        dataStatistics: null,
        isClearing: false
      });
      
      perfLogger.info('Speed challenge stats cleared');
    } catch (error) {
      console.error('Failed to clear stats:', error);
      set({ isClearing: false });
    }
  },
  
  setShowClearConfirmation: (show: boolean) => {
    set({ showClearConfirmation: show });
  },
  
  getDataStatistics: async () => {
    try {
      const stats = await speedChallengeDB.getDataStatistics();
      set({ dataStatistics: stats });
    } catch (error) {
      console.error('Failed to get data statistics:', error);
    }
  }
}));