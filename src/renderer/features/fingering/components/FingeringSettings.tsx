import React from 'react';
import { useFingeringSettings } from '../hooks/useFingeringSettings';

export const FingeringSettings: React.FC = () => {
  const {
    isEnabled,
    showOnAllNotes,
    fontSize,
    color,
    updateSettings
  } = useFingeringSettings();

  return (
    <div className="fingering-settings">
      <h3>Fingering Annotations</h3>
      
      <div className="setting-group">
        <label>
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => updateSettings({ isEnabled: e.target.checked })}
            aria-label="Enable fingering annotations"
          />
          Enable fingering annotations
        </label>
      </div>

      {isEnabled && (
        <>
          <div className="setting-group">
            <label>
              <input
                type="checkbox"
                checked={showOnAllNotes}
                onChange={(e) => updateSettings({ showOnAllNotes: e.target.checked })}
                aria-label="Show fingerings on all notes"
                aria-describedby="show-all-help"
              />
              Show fingerings on all notes (even without annotations)
            </label>
            <small id="show-all-help" className="small">Displays suggested fingerings for unmarked notes</small>
          </div>

          <div className="setting-group">
            <label>
              Font Size: {fontSize}px
              <input
                type="range"
                min="8"
                max="16"
                value={fontSize}
                onChange={(e) => updateSettings({ fontSize: parseInt(e.target.value, 10) })}
                aria-label={`Font size: ${fontSize} pixels`}
              />
            </label>
          </div>

          <div className="setting-group">
            <label htmlFor="fingering-color-select">
              Color:
              <select
                id="fingering-color-select"
                value={color}
                onChange={(e) => updateSettings({ color: e.target.value })}
                aria-label="Fingering color"
              >
                <option value="#000080">Blue</option>
                <option value="#006600">Green</option>
                <option value="#800000">Red</option>
                <option value="#000000">Black</option>
              </select>
            </label>
          </div>

          <div className="setting-group">
            <p className="help-text">
              <small>How to use: Enable 'Edit Fingerings' above, then click on any note to add a fingering number (1-5).</small>
            </p>
          </div>
        </>
      )}
    </div>
  );
};