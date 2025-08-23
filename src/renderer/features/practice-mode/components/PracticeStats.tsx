/**
 * Practice Statistics Dashboard Component
 * 
 * Displays real-time and historical practice statistics.
 * Shows accuracy, progress, session history, and performance trends.
 */

import React, { useEffect, useState } from 'react';
import { usePracticeStore } from '../stores/practiceStore';
import { SessionPersistence } from '../services/SessionPersistence';
import { perfLogger } from '@/renderer/utils/performance-logger';
import './PracticeStats.css';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export const StatsCard: React.FC<StatsCardProps> = ({ title, value, subtitle, trend = 'neutral' }) => (
  <div className={`stats-card stats-card--${trend}`}>
    <h4>{title}</h4>
    <div className="stats-value">{value}</div>
    {subtitle && <div className="stats-subtitle">{subtitle}</div>}
  </div>
);

interface PracticeStatsProps {
  scoreId: string;
  isLoading?: boolean;
  error?: string;
}

export const PracticeStats: React.FC<PracticeStatsProps> = ({ scoreId, isLoading, error }) => {
  const { statistics, currentStep } = usePracticeStore();
  const [historicalStats, setHistoricalStats] = useState<any>(null);
  
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const persistence = new SessionPersistence();
        const sessions = await persistence.getRecentSessions(scoreId);
        
        if (sessions.length === 0) {
          setHistoricalStats(null);
          return;
        }
        
        // Single pass: calculate avg accuracy, best streak, and total time
        let sumAcc = 0;
        let bestStreak = 0;
        let totalPracticeTime = 0;

        for (const s of sessions) {
          const stats = s.statistics;
          const total = stats.correctNotes + stats.incorrectAttempts;
          sumAcc += total > 0 ? stats.correctNotes / total : 0;
          if (stats.correctNotes > bestStreak) bestStreak = stats.correctNotes;
          totalPracticeTime += stats.practiceTimeMs;
        }

        const avgAccuracy = sumAcc / sessions.length;
        
        setHistoricalStats({
          totalSessions: sessions.length,
          totalPracticeTime,
          avgAccuracy: (avgAccuracy * 100).toFixed(1),
          bestStreak
        });
      } catch (err) {
        perfLogger.error('Failed to load historical stats:', err);
      }
    };
    
    loadHistory();
  }, [scoreId]);
  
  if (isLoading) {
    return <div data-testid="stats-skeleton" className="stats-skeleton">Loading...</div>;
  }
  
  if (error) {
    return (
      <div className="stats-error">
        <p>{error}</p>
        <button>Try again</button>
      </div>
    );
  }
  
  const currentAccuracy = statistics.correctNotes + statistics.incorrectAttempts > 0
    ? ((statistics.correctNotes / (statistics.correctNotes + statistics.incorrectAttempts)) * 100).toFixed(1)
    : '0';
  
  const getTrend = (current: number): 'up' | 'down' | 'neutral' => {
    if (current > 80) return 'up';
    if (current < 60) return 'down';
    return 'neutral';
  };
  
  // Calculate progress (mock implementation - would need total notes from score)
  const progress = currentStep ? 33 : 0; // Mock 33% progress
  
  return (
    <div className="practice-stats">
      <h3>Practice Statistics</h3>
      
      <div className="stats-grid" data-testid="stats-grid">
        <StatsCard 
          title="Current Accuracy" 
          value={`${currentAccuracy}%`}
          trend={getTrend(parseFloat(currentAccuracy))}
        />
        
        <StatsCard 
          title="Notes Played" 
          value={statistics.correctNotes}
          subtitle={`${statistics.incorrectAttempts} mistakes`}
        />
        
        <StatsCard 
          title="Reaction Time" 
          value={`${statistics.averageReactionTime}ms`}
          trend={statistics.averageReactionTime < 500 ? 'up' : 'down'}
        />
        
        <StatsCard
          title="Progress"
          value={`${progress}%`}
          subtitle="of piece completed"
        />
        
        {historicalStats && (
          <>
            <StatsCard 
              title="Total Sessions" 
              value={historicalStats.totalSessions}
            />
            
            <StatsCard 
              title="Practice Time" 
              value={`${Math.floor(historicalStats.totalPracticeTime / 60000)}m`}
            />
            
            <StatsCard 
              title="Best Streak" 
              value={historicalStats.bestStreak}
              subtitle="correct notes"
            />
          </>
        )}
      </div>
    </div>
  );
};