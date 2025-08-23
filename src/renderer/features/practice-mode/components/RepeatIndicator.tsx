/**
 * RepeatIndicator Component
 * 
 * Accessible button for toggling measure repeat with WCAG compliance
 */

import React from 'react';
import { usePracticeController } from '../hooks';
import './RepeatIndicator.css';

export const RepeatIndicator: React.FC = () => {
  const controller = usePracticeController();
  const repeatActive = controller?.repeatActive || false;
  const toggleRepeat = controller?.toggleRepeat;

  const handleClick = () => {
    if (toggleRepeat) {
      toggleRepeat();
    }
  };

  return (
    <button
      className={`repeat-indicator ${repeatActive ? 'active' : ''}`}
      onClick={handleClick}
      aria-pressed={repeatActive}
      aria-label={repeatActive ? 'Repeat mode on, press to turn off' : 'Repeat mode off, press to turn on'}
      title="Toggle repeat (L)"
    >
      <span className="repeat-icon" aria-hidden="true">🔁</span>
      <span className="repeat-text">{repeatActive ? 'Repeat On' : 'Repeat'}</span>
    </button>
  );
};