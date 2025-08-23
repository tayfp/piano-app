/**
 * Speed Challenge Floating Controls Component
 * 
 * Provides floating overlay controls for Speed Challenge Mode, following Practice Mode patterns.
 * Replaces the full-screen overlay approach with minimal floating controls.
 */

import React, { useState, useEffect } from 'react';
import { useSpeedChallengeStore } from '../stores/speedChallengeStore';
import { SpeedChallengeControls } from './SpeedChallengeControls';
import { SpeedChallengeStatus } from './SpeedChallengeStatus';
import './SpeedChallengeFloatingControls.css';

export const SpeedChallengeFloatingControls: React.FC = () => {
  const {
    isActive,
    score,
    streak,
    accuracy,
  } = useSpeedChallengeStore();

  const [showControls, setShowControls] = useState(false);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC to toggle menu (when Speed Challenge is active)
      if (e.key === 'Escape' && isActive) {
        setShowControls(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive]);

  // Auto-hide controls after 3 seconds
  useEffect(() => {
    if (showControls) {
      const timer = setTimeout(() => {
        setShowControls(false);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [showControls]);

  // Don't render anything when Speed Challenge is inactive
  if (!isActive) {
    return null;
  }

  const handleMenuToggle = () => {
    setShowControls(!showControls);
  };

  return (
    <div className="speed-challenge-floating-overlay">
      {/* Minimal header with menu button */}
      <div className="speed-challenge-floating-header">
        <button
          className="speed-challenge-menu-button"
          onClick={handleMenuToggle}
          aria-label="Speed Challenge Menu"
          type="button"
        >
          ≡
        </button>
        
        {showControls && (
          <div className="speed-challenge-controls-dropdown">
            <SpeedChallengeControls
              onClose={() => setShowControls(false)}
            />
          </div>
        )}
      </div>

      {/* Status bar (always visible when active) */}
      <div className="speed-challenge-floating-status">
        <SpeedChallengeStatus
          score={score}
          streak={streak}
          accuracy={accuracy}
        />
      </div>
    </div>
  );
};

