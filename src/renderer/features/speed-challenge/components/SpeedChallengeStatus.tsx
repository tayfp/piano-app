import React from 'react';
import { usePatternTimer } from '../hooks/usePatternTimer';
import './SpeedChallengeStatus.css';

interface SpeedChallengeStatusProps {
  score: number;
  streak: number;
  accuracy: number;
}

/**
 * SpeedChallengeStatus - Enhanced glassmorphic status bar for Speed Challenge
 * 
 * Features:
 * - Individual stat cards with icons and gradients
 * - Glassmorphic backdrop blur effect
 * - Color-coded accuracy (green >90%, yellow 70-90%, red <70%)
 * - Pulse animation for streak > 5
 * - Pattern completion timer with history
 * - Theme support (light/dark/sepia)
 * - Performance target: <1ms update time
 */
export const SpeedChallengeStatus: React.FC<SpeedChallengeStatusProps> = React.memo(({
  score,
  streak,
  accuracy,
}) => {
  // Get timer state from hook
  const { 
    formattedTime, 
    patternCompletionTimes, 
    formattedHistory,
    formattedAverage,
    isRunning 
  } = usePatternTimer();
  // Determine accuracy color class
  const getAccuracyClass = (acc: number): string => {
    if (acc > 90) return 'stat-card--accuracy-high';
    if (acc > 70) return 'stat-card--accuracy-medium';
    return 'stat-card--accuracy-low';
  };

  // Convert decimal accuracy (0-1) to percentage (0-100) and round
  const roundedAccuracy = Math.round(accuracy * 100);

  // Check if streak should pulse
  const streakActiveClass = streak > 5 ? 'stat-card--streak-active' : '';

  return (
    <div className="speed-challenge-status-container">
      <div 
        className="speed-challenge-status"
        role="status"
        aria-live="polite"
      >
        {/* Score Card */}
        <div className="stat-card stat-card--score">
          <div className="stat-icon">🎯</div>
          <div className="stat-content">
            <span className="stat-label">Score</span>
            <span className="stat-value">{score}</span>
          </div>
        </div>
        
        {/* Streak Card */}
        <div className={`stat-card stat-card--streak ${streakActiveClass}`}>
          <div className="stat-icon">🔥</div>
          <div className="stat-content">
            <span className="stat-label">Streak</span>
            <span className="stat-value">{streak}</span>
          </div>
        </div>
        
        {/* Accuracy Card */}
        <div className={`stat-card stat-card--accuracy ${getAccuracyClass(roundedAccuracy)}`}>
          <div className="stat-icon">✨</div>
          <div className="stat-content">
            <span className="stat-label">Accuracy</span>
            <span className="stat-value">{roundedAccuracy}%</span>
          </div>
        </div>
        
        {/* Timer Card */}
        <div 
          className={`stat-card stat-card--timer ${isRunning ? 'timer-active' : ''}`}
          title={formattedAverage ? `Average: ${formattedAverage}` : 'Pattern timer'}
        >
          <div className="stat-icon">⏱️</div>
          <div className="stat-content">
            <span className="stat-label">Time</span>
            <span className="stat-value">{formattedTime}</span>
            {patternCompletionTimes.length > 0 && (
              <span className="stat-history">
                {formattedHistory}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

SpeedChallengeStatus.displayName = 'SpeedChallengeStatus';