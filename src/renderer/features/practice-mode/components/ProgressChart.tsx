/**
 * Progress Chart Component
 * 
 * Visualizes practice progress over time using simplified chart representation.
 * Shows accuracy or reaction time trends.
 */

import React, { useEffect, useState } from 'react';
import { SessionPersistence } from '../services/SessionPersistence';
import { perfLogger } from '@/renderer/utils/performance-logger';
import './PracticeStats.css';

interface ProgressChartProps {
  scoreId: string;
  metric: 'accuracy' | 'speed';
  showImprovement?: boolean;
}

export const ProgressChart: React.FC<ProgressChartProps> = ({ scoreId, metric, showImprovement = false }) => {
  const [chartData, setChartData] = useState<any>(null);
  
  useEffect(() => {
    const loadChartData = async () => {
      try {
        const persistence = new SessionPersistence();
        const sessions = await persistence.getRecentSessions(scoreId, 20);
        
        // Simple chart data structure
        // Reverse sessions to have oldest first for proper improvement calculation
        const reversedSessions = [...sessions].reverse();
        setChartData({
          labels: reversedSessions.map((_, i) => `Session ${i + 1}`),
          values: reversedSessions.map(s => {
            if (metric === 'accuracy') {
              const total = s.statistics.correctNotes + s.statistics.incorrectAttempts;
              return total > 0 ? (s.statistics.correctNotes / total) * 100 : 0;
            } else {
              return s.statistics.averageReactionTime;
            }
          })
        });
      } catch (err) {
        perfLogger.error('Failed to load chart data:', err);
      }
    };
    
    loadChartData();
  }, [scoreId, metric]);
  
  const title = metric === 'accuracy' ? 'Accuracy Over Time' : 'Reaction Time Over Time';
  
  return (
    <div className="progress-chart" data-testid="progress-chart">
      <h4>{title}</h4>
      
      {/* Simplified chart representation */}
      <svg width="100%" height="200">
        <text x="50%" y="50%" textAnchor="middle">
          Chart visualization here
        </text>
      </svg>
      
      {showImprovement && chartData && chartData.values.length >= 2 && (
        <div className="improvement-stats">
          <h5>Overall Improvement</h5>
          <p>
            {metric === 'accuracy' 
              ? `+${(chartData.values[chartData.values.length - 1] - chartData.values[0]).toFixed(1)}%`
              : `-${(chartData.values[0] - chartData.values[chartData.values.length - 1]).toFixed(0)}ms`
            }
          </p>
        </div>
      )}
    </div>
  );
};