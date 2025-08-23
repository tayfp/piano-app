/**
 * Session History Component
 * 
 * Displays a list of recent practice sessions with performance metrics.
 * Shows trends and improvement indicators.
 */

import React, { useEffect, useState } from 'react';
import { SessionPersistence } from '../services/SessionPersistence';
import type { PracticeSession } from '../types';
import { perfLogger } from '@/renderer/utils/performance-logger';
import './PracticeStats.css';

interface SessionHistoryProps {
  scoreId: string;
  limit?: number;
  showTrends?: boolean;
}

export const SessionHistory: React.FC<SessionHistoryProps> = ({ scoreId, limit = 10, showTrends = false }) => {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const persistence = new SessionPersistence();
        const recentSessions = await persistence.getRecentSessions(scoreId, limit);
        setSessions(recentSessions);
      } catch (err) {
        perfLogger.error('Failed to load sessions:', err);
      } finally {
        setLoading(false);
      }
    };
    
    loadSessions();
  }, [scoreId, limit]);
  
  if (loading) {
    return <div>Loading sessions...</div>;
  }
  
  if (sessions.length === 0) {
    return (
      <div className="session-history-empty">
        <p>No practice sessions yet</p>
        <p>Start practicing to see your progress!</p>
      </div>
    );
  }
  
  const calculateAccuracy = (session: PracticeSession) => {
    const total = session.statistics.correctNotes + session.statistics.incorrectAttempts;
    return total > 0 ? ((session.statistics.correctNotes / total) * 100).toFixed(0) : '0';
  };
  
  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    return `${minutes}m`;
  };
  
  // Calculate trends if requested
  let trends: any = null;
  if (showTrends && sessions.length >= 2) {
    const latestSession = sessions[0];
    const previousSession = sessions[1];
    
    const latestAccuracy = parseFloat(calculateAccuracy(latestSession));
    const previousAccuracy = parseFloat(calculateAccuracy(previousSession));
    const accuracyChange = latestAccuracy - previousAccuracy;
    
    const speedChange = latestSession.statistics.averageReactionTime - previousSession.statistics.averageReactionTime;
    
    trends = {
      accuracy: accuracyChange,
      speed: speedChange
    };
  }
  
  return (
    <div className="session-history">
      <h4>Session History</h4>
      
      {showTrends && trends && (
        <div className="session-trends">
          <div>
            <span>Accuracy Trend</span>
            <span className={trends.accuracy >= 0 ? 'trend-up' : 'trend-down'}>
              {trends.accuracy >= 0 ? '+' : ''}{trends.accuracy.toFixed(0)}%
            </span>
          </div>
          <div>
            <span>Speed Trend</span>
            <span className={trends.speed <= 0 ? 'trend-up' : 'trend-down'}>
              {trends.speed > 0 ? '+' : ''}{trends.speed}ms
            </span>
          </div>
        </div>
      )}
      
      <div className="session-list">
        {sessions.map((session, index) => (
          <div key={session.id || index} className="session-item" data-testid="session-item">
            <div className="session-date">
              {new Date(session.startTime).toLocaleDateString()}
            </div>
            <div className="session-stats">
              <span>{calculateAccuracy(session)}%</span>
              <span>{formatDuration(session.statistics.practiceTimeMs)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};