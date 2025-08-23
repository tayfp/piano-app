import React, { useEffect, useRef } from 'react';
import { useSpeedChallengeStore } from '../stores/speedChallengeStore';
import { useSpeedChallengeStatsStore } from '../stores/speedChallengeStatsStore';
import { ZoomControls } from '@/renderer/components/ZoomControls/ZoomControls';
import type { Difficulty } from '../types';

interface SpeedChallengeControlsProps {
  onClose: () => void;
}

/**
 * SpeedChallengeControls - Dropdown menu for Speed Challenge settings
 * 
 * Progressive disclosure pattern:
 * - Hidden by default
 * - Auto-hides after 3 seconds of inactivity
 * - Keyboard shortcuts: ESC to close, Ctrl+Shift+S to toggle
 */
export const SpeedChallengeControls: React.FC<SpeedChallengeControlsProps> = ({ onClose }) => {
  const {
    isActive,
    difficulty,
    startChallenge,
    stopChallenge,
    setDifficulty,
  } = useSpeedChallengeStore();

  const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Reset auto-hide timer
  const resetAutoHideTimer = () => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
    }
    
    autoHideTimerRef.current = setTimeout(() => {
      onClose();
    }, 3000);
  };

  // Set up auto-hide timer on mount
  useEffect(() => {
    resetAutoHideTimer();

    return () => {
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
      }
    };
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC to close
      if (e.key === 'Escape') {
        onClose();
      }
      
      // Ctrl+Shift+S to toggle challenge
      if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        if (isActive) {
          stopChallenge();
        } else {
          startChallenge();
        }
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, startChallenge, stopChallenge, onClose]);

  // Handle any interaction to reset timer
  const handleInteraction = () => {
    resetAutoHideTimer();
  };

  const handleStartStop = () => {
    handleInteraction();
    if (isActive) {
      stopChallenge();
    } else {
      startChallenge();
    }
    // Don't close immediately when toggling challenge
  };

  const handleDifficultyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    handleInteraction();
    setDifficulty(e.target.value as Difficulty);
  };

  return (
    <div
      ref={panelRef}
      className="speed-challenge-controls-panel"
      data-testid="speed-challenge-controls-panel"
      role="menu"
      aria-label="Speed Challenge Controls"
      onMouseMove={handleInteraction}
      onClick={handleInteraction}
    >
      <div className="speed-challenge-controls-content">
        <h3 className="speed-challenge-controls-title">Speed Challenge</h3>
        
        {/* Difficulty Selector */}
        <div className="speed-challenge-control-group">
          <label htmlFor="difficulty-selector" className="speed-challenge-control-label">
            Difficulty:
          </label>
          <select
            id="difficulty-selector"
            className="speed-challenge-control-select"
            value={difficulty}
            onChange={handleDifficultyChange}
            disabled={isActive}
          >
            <option value="singleNotes">Single Notes</option>
            <option value="intervals">Intervals</option>
            <option value="triads">Triads</option>
          </select>
        </div>

        {/* Zoom Controls */}
        <div className="speed-challenge-control-group">
          <label className="speed-challenge-control-label">
            Zoom:
          </label>
          <ZoomControls />
        </div>

        {/* Start/Stop Button */}
        <button
          type="button"
          className={`speed-challenge-control-button ${isActive ? 'stop' : 'start'}`}
          onClick={handleStartStop}
        >
          {isActive ? 'Stop Challenge' : 'Start Challenge'}
        </button>

        {/* Statistics Button */}
        <button
          type="button"
          className="speed-challenge-control-button stats"
          onClick={() => {
            handleInteraction();
            useSpeedChallengeStatsStore.getState().openStats();
          }}
        >
          View Statistics
        </button>

        {/* Keyboard Shortcuts Info */}
        <div className="speed-challenge-shortcuts">
          <div className="speed-challenge-shortcut">
            <kbd>ESC</kbd> Close menu
          </div>
          <div className="speed-challenge-shortcut">
            <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> Toggle challenge
          </div>
        </div>
      </div>
    </div>
  );
};

// Add styles for the controls
const styles = `
  .speed-challenge-controls-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .speed-challenge-controls-title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: #333;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #e0e0e0;
  }

  .speed-challenge-control-group {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .speed-challenge-control-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #666;
  }

  .speed-challenge-control-select {
    flex: 1;
    padding: 0.375rem 0.5rem;
    border: 1px solid #d0d0d0;
    border-radius: 4px;
    background: white;
    font-size: 0.875rem;
    cursor: pointer;
    transition: border-color 0.2s;
  }

  .speed-challenge-control-select:hover:not(:disabled) {
    border-color: #a0a0a0;
  }

  .speed-challenge-control-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .speed-challenge-control-button {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .speed-challenge-control-button.start {
    background: #10b981;
    color: white;
  }

  .speed-challenge-control-button.start:hover {
    background: #059669;
  }

  .speed-challenge-control-button.stop {
    background: #ef4444;
    color: white;
  }

  .speed-challenge-control-button.stop:hover {
    background: #dc2626;
  }

  .speed-challenge-control-button:active {
    transform: translateY(1px);
  }

  .speed-challenge-shortcuts {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-top: 0.5rem;
    border-top: 1px solid #e0e0e0;
  }

  .speed-challenge-shortcut {
    font-size: 0.75rem;
    color: #888;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .speed-challenge-shortcut kbd {
    padding: 0.125rem 0.25rem;
    background: #f5f5f5;
    border: 1px solid #d0d0d0;
    border-radius: 3px;
    font-family: 'Courier New', monospace;
    font-size: 0.75rem;
  }
`;

// Inject styles
if (typeof document !== 'undefined') {
  const styleElement = document.createElement('style');
  styleElement.textContent = styles;
  document.head.appendChild(styleElement);
}