import React from 'react';
import { useAssist } from '../providers/AssistProvider';
import type { AssistMode } from '../services/PracticeAssistService';

// Narrow runtime check → keeps JSX options, AssistMode union, and setter in sync
const isAssistMode = (value: string): value is AssistMode =>
  value === 'off' || value === 'practice' || value === 'follow';

export const AssistModeSelector: React.FC = () => {
  const { config, setMode, toggleHandDifferentiation } = useAssist();

  const handleModeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const val = event.target.value;
    if (isAssistMode(val)) {
      setMode(val); // safe — val is now typed as AssistMode
    }
  };

  return (
    <div className="assist-mode-selector" role="group" aria-labelledby="assist-mode-label">
      <h3 id="assist-mode-label">Practice Assist</h3>
      
      <div className="assist-mode-control">
        <label htmlFor="assist-mode-select">Highlight Mode:</label>
        <select 
          id="assist-mode-select"
          value={config.mode} 
          onChange={handleModeChange}
          aria-describedby="assist-mode-description"
        >
          <option value="off">Off</option>
          <option value="practice">Practice Mode</option>
          <option value="follow">Follow Cursor</option>
        </select>
        <small id="assist-mode-description">
          {config.mode === 'off' && 'No piano key highlighting'}
          {config.mode === 'practice' && 'Highlight keys during practice mode'}
          {config.mode === 'follow' && 'Always highlight current cursor position'}
        </small>
      </div>

      {config.mode !== 'off' && (
        <div className="assist-enhancer-controls">
          <label>
            <input 
              type="checkbox"
              checked={config.enableHandDifferentiation}
              onChange={toggleHandDifferentiation}
              aria-describedby="hand-diff-description"
            />
            Hand Differentiation
          </label>
          <small id="hand-diff-description">
            Use different colors for left (green) and right (blue) hand notes
          </small>
        </div>
      )}
    </div>
  );
};