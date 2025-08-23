/**
 * Integration test for SpeedChallengeStatus timer functionality
 * Verifies the timer card displays correctly with proper formatting
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { SpeedChallengeStatus } from '../SpeedChallengeStatus';
import { usePatternTimer } from '../../hooks/usePatternTimer';

// Mock the timer hook
jest.mock('../../hooks/usePatternTimer');

describe('SpeedChallengeStatus Timer Integration', () => {
  const mockUsePatternTimer = usePatternTimer as jest.MockedFunction<typeof usePatternTimer>;
  
  beforeEach(() => {
    // Default mock implementation
    mockUsePatternTimer.mockReturnValue({
      currentTime: 0,
      formattedTime: '0.0s',
      patternCompletionTimes: [],
      averageCompletionTime: 0,
      formattedAverage: null,
      formattedHistory: '',
      isRunning: false
    });
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  it('should render timer card with initial state', () => {
    render(
      <SpeedChallengeStatus 
        score={0} 
        streak={0} 
        accuracy={0} 
      />
    );
    
    // Check timer card exists
    const timerLabel = screen.getByText('Time');
    expect(timerLabel).toBeInTheDocument();
    
    // Check initial time display
    const timerValue = screen.getByText('0.0s');
    expect(timerValue).toBeInTheDocument();
  });
  
  it('should display timer with active state', () => {
    mockUsePatternTimer.mockReturnValue({
      currentTime: 2500,
      formattedTime: '2.5s',
      patternCompletionTimes: [],
      averageCompletionTime: 0,
      formattedAverage: null,
      formattedHistory: '',
      isRunning: true
    });
    
    const { container } = render(
      <SpeedChallengeStatus 
        score={10} 
        streak={3} 
        accuracy={0.85} 
      />
    );
    
    // Check timer value
    const timerValue = screen.getByText('2.5s');
    expect(timerValue).toBeInTheDocument();
    
    // Check active class
    const timerCard = container.querySelector('.stat-card--timer.timer-active');
    expect(timerCard).toBeInTheDocument();
  });
  
  it('should display completion history', () => {
    mockUsePatternTimer.mockReturnValue({
      currentTime: 1000,
      formattedTime: '1.0s',
      patternCompletionTimes: [2300, 3100, 2800],
      averageCompletionTime: 2733,
      formattedAverage: '2.7s',
      formattedHistory: '2.3s, 3.1s, 2.8s',
      isRunning: false
    });
    
    render(
      <SpeedChallengeStatus 
        score={25} 
        streak={5} 
        accuracy={0.92} 
      />
    );
    
    // Check history display
    const history = screen.getByText('2.3s, 3.1s, 2.8s');
    expect(history).toBeInTheDocument();
    expect(history).toHaveClass('stat-history');
  });
  
  it('should show average in tooltip', () => {
    mockUsePatternTimer.mockReturnValue({
      currentTime: 0,
      formattedTime: '0.0s',
      patternCompletionTimes: [2000, 2500, 2200],
      averageCompletionTime: 2233,
      formattedAverage: '2.2s',
      formattedHistory: '2.0s, 2.5s, 2.2s',
      isRunning: false
    });
    
    const { container } = render(
      <SpeedChallengeStatus 
        score={50} 
        streak={10} 
        accuracy={0.95} 
      />
    );
    
    // Check tooltip
    const timerCard = container.querySelector('.stat-card--timer');
    expect(timerCard).toHaveAttribute('title', 'Average: 2.2s');
  });
  
  it('should render all 4 stat cards', () => {
    mockUsePatternTimer.mockReturnValue({
      currentTime: 5000,
      formattedTime: '5.0s',
      patternCompletionTimes: [],
      averageCompletionTime: 0,
      formattedAverage: null,
      formattedHistory: '',
      isRunning: true
    });
    
    const { container } = render(
      <SpeedChallengeStatus 
        score={100} 
        streak={20} 
        accuracy={1.0} 
      />
    );
    
    // Count stat cards
    const statCards = container.querySelectorAll('.stat-card');
    expect(statCards).toHaveLength(4);
    
    // Verify each card type
    expect(container.querySelector('.stat-card--score')).toBeInTheDocument();
    expect(container.querySelector('.stat-card--streak')).toBeInTheDocument();
    expect(container.querySelector('.stat-card--accuracy')).toBeInTheDocument();
    expect(container.querySelector('.stat-card--timer')).toBeInTheDocument();
  });
});