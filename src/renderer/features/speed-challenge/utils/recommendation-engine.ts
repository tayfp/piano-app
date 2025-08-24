/**
 * Recommendation Engine for Speed Challenge Analytics
 * Extracted from SessionAnalytics.ts for better modularity and testability
 */

import { DifficultyLevel } from '../types';
import { DifficultyMetrics } from '../types/analytics-types';
import { ANALYTICS_THRESHOLDS, ANALYTICS_DEFAULTS } from '../constants/analytics-constants';

/**
 * Identify areas of strength based on performance metrics
 * 
 * @param difficultyMetrics Map of difficulty metrics
 * @returns Array of difficulty levels where user excels
 */
export function identifyStrengths(difficultyMetrics: Map<DifficultyLevel, DifficultyMetrics>): DifficultyLevel[] {
  const strengths: DifficultyLevel[] = [];
  
  difficultyMetrics.forEach((metrics, difficulty) => {
    if (metrics.totalAttempts >= ANALYTICS_DEFAULTS.MIN_ATTEMPTS_FOR_DIFFICULTY_ANALYSIS && 
        metrics.accuracy >= ANALYTICS_THRESHOLDS.ACCURACY_THRESHOLD) {
      strengths.push(difficulty);
    }
  });
  
  return strengths;
}

/**
 * Identify areas of weakness based on performance metrics
 * 
 * @param difficultyMetrics Map of difficulty metrics
 * @returns Array of difficulty levels where user struggles
 */
export function identifyWeaknesses(difficultyMetrics: Map<DifficultyLevel, DifficultyMetrics>): DifficultyLevel[] {
  const weaknesses: DifficultyLevel[] = [];
  
  difficultyMetrics.forEach((metrics, difficulty) => {
    if (metrics.totalAttempts >= ANALYTICS_DEFAULTS.MIN_ATTEMPTS_FOR_DIFFICULTY_ANALYSIS && 
        metrics.accuracy < 0.5) { // Below 50% accuracy is considered weak
      weaknesses.push(difficulty);
    }
  });
  
  return weaknesses;
}

/**
 * Generate personalized recommendations based on performance analysis
 * 
 * @param strengths Areas where user excels
 * @param weaknesses Areas where user struggles
 * @param overallAccuracy Overall session accuracy
 * @param difficultyMetrics Map of difficulty metrics for advanced recommendations
 * @returns Array of recommendation strings
 */
export function generateRecommendations(
  strengths: DifficultyLevel[],
  weaknesses: DifficultyLevel[],
  overallAccuracy: number,
  difficultyMetrics?: Map<DifficultyLevel, DifficultyMetrics>
): string[] {
  const recommendations: string[] = [];

  // Recommendations based on weaknesses
  if (weaknesses.includes('basic_triads')) {
    recommendations.push('Practice triads at a slower tempo to improve accuracy');
    recommendations.push('Focus on individual chord tones before attempting full triads');
  }

  if (weaknesses.includes('intervals')) {
    recommendations.push('Practice intervals with visual cues enabled');
    recommendations.push('Start with smaller intervals (3rds and 4ths) before larger ones');
  }

  if (weaknesses.includes('single_notes')) {
    recommendations.push('Slow down and focus on accuracy over speed');
    recommendations.push('Practice with a metronome to improve timing');
  }

  // General accuracy recommendations
  if (overallAccuracy < 0.5) {
    recommendations.push('Reduce tempo to improve accuracy');
    recommendations.push('Consider practicing with easier patterns first');
  }

  // Progression recommendations
  if (strengths.length > 0 && weaknesses.length === 0) {
    recommendations.push(`Great job on ${strengths.join(', ')}! Consider increasing difficulty`);
  }

  // Advanced progression detection
  if (difficultyMetrics) {
    const singleNotesMetrics = difficultyMetrics.get('single_notes');
    if (singleNotesMetrics && singleNotesMetrics.accuracy > 0.9 && singleNotesMetrics.totalAttempts > 10) {
      recommendations.push('Excellent single note accuracy! Try moving to intervals');
    }
  }

  return recommendations;
}

/**
 * Get difficulty-specific practice tips
 * 
 * @param difficulty The difficulty level to get tips for
 * @returns Array of specific practice tips
 */
export function getDifficultySpecificTips(difficulty: DifficultyLevel): string[] {
  const tips: Record<DifficultyLevel, string[]> = {
    single_notes: [
      'Focus on finger positioning and hand posture',
      'Practice scales to improve note recognition',
      'Use a slow, steady tempo initially'
    ],
    intervals: [
      'Practice interval recognition aurally',
      'Start with perfect 4ths and 5ths before moving to 2nds and 7ths',
      'Use visual cues to identify interval patterns'
    ],
    basic_triads: [
      'Learn the triad patterns: Major (1-3-5), Minor (1-♭3-5)',
      'Practice root position triads first',
      'Work on smooth voice leading between chords'
    ]
  };

  return tips[difficulty] || [];
}