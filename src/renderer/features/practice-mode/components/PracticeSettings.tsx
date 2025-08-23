/**
 * Practice Settings Component
 * 
 * User interface for configuring practice mode preferences.
 * Supports basic and advanced settings with persistence.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePracticeStore } from '../stores/practiceStore';
import { SimpleEventLogger } from '../services/SimpleEventLogger';
import { SimpleAdaptiveDifficulty } from '../services/SimpleAdaptiveDifficulty';
import type { DifficultySettings } from '../types';
import { perfLogger } from '@/renderer/utils/performance-logger';
import './PracticeSettings.css';

export function PracticeSettings() {
  const difficultyService = useMemo(() => new SimpleAdaptiveDifficulty(), []);
  const [settings, setSettings] = useState<DifficultySettings>(() => difficultyService.getSettings());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'showing-options' | 'exporting' | 'success' | 'error'>('idle');
  const [exportError, setExportError] = useState<string>('');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 480);
  const [announcement, setAnnouncement] = useState('');

  // Handle mobile/desktop breakpoint changes
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 480px)');
    const handleChange = () => setIsMobile(mq.matches);
    
    // Modern browsers: addEventListener; older: addListener fallback
    mq.addEventListener?.('change', handleChange) ?? mq.addListener?.(handleChange);
    handleChange(); // Set initial state
    
    return () => {
      mq.removeEventListener?.('change', handleChange) ?? mq.removeListener?.(handleChange);
    };
  }, []);

  // Sync settings with service on mount
  useEffect(() => {
    const currentSettings = difficultyService.getSettings();
    setSettings(currentSettings);
  }, [difficultyService]);

  // Update settings via difficulty service
  const handleSettingChange = useCallback((key: keyof DifficultySettings, value: any) => {
    const newSettings = { [key]: value };
    
    // Update the difficulty service
    difficultyService.setSettings(newSettings);
    
    // Update local state to trigger re-render
    setSettings(prevSettings => ({ ...prevSettings, ...newSettings }));
    
    // Save to localStorage
    const allSettings = { ...settings, ...newSettings };
    localStorage.setItem('abc-piano-practice-settings', JSON.stringify(allSettings));
    
    // Announce change for screen readers
    setAnnouncement(`Setting updated: ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
    setTimeout(() => setAnnouncement(''), 500);
  }, [settings, difficultyService]);

  // Export analytics data
  const handleExport = useCallback(async (format: 'json' | 'csv') => {
    setExportStatus('exporting');
    setExportError('');
    
    try {
      // For testing purposes, check if there's a mocked export function
      const mockExport = (window as any).mockExportAnalytics;
      if (mockExport) {
        await mockExport(format);
        setExportStatus('success');
        setTimeout(() => setExportStatus('idle'), 1500);
        return;
      }
      
      const analytics = new SimpleEventLogger();
      let data: string;
      let filename: string;
      let mimeType: string;
      
      if (format === 'json') {
        data = analytics.exportToJSON();
        filename = `practice-data-${Date.now()}.json`;
        mimeType = 'application/json';
      } else {
        data = analytics.exportToCSV();
        filename = `practice-data-${Date.now()}.csv`;
        mimeType = 'text/csv';
      }
      
      // Create download link
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setExportStatus('success');
      setTimeout(() => setExportStatus('idle'), 3000);
    } catch (error) {
      perfLogger.error('Export failed:', error);
      setExportStatus('error');
      setExportError(error instanceof Error ? error.message : 'Export failed');
    }
  }, []);

  const containerClass = `practice-settings ${isMobile ? 'practice-settings--mobile' : ''}`;
  const toggleClass = `setting-toggle ${isMobile ? 'setting-toggle--compact' : ''}`;

  return (
    <div className={containerClass}>
      <h2>Practice Settings</h2>
      
      {/* Learning Assistance Section */}
      <div className="settings-section">
        <h3>Learning Assistance</h3>
        
        <div className={toggleClass}>
          <label htmlFor="wait-for-correct" className={isMobile ? 'setting-toggle--compact' : ''}>
            <input
              id="wait-for-correct"
              type="checkbox"
              checked={settings.waitForCorrectNote}
              onChange={(e) => handleSettingChange('waitForCorrectNote', e.target.checked)}
              aria-label="Wait for Correct Note"
            />
            <span className="setting-label">Wait for Correct Note</span>
            <span className="setting-description">Pause until you play the right note</span>
          </label>
        </div>
        
        <div className={toggleClass}>
          <label htmlFor="highlight-notes" className={isMobile ? 'setting-toggle--compact' : ''}>
            <input
              id="highlight-notes"
              type="checkbox"
              checked={settings.highlightExpectedNotes}
              onChange={(e) => handleSettingChange('highlightExpectedNotes', e.target.checked)}
              aria-label="Highlight Expected Notes"
            />
            <span className="setting-label">Highlight Expected Notes</span>
            <span className="setting-description">Show which keys to press</span>
          </label>
        </div>
        
        <div className="setting-group">
          <label htmlFor="hint-attempts">
            <span className="setting-label">Show Hints After</span>
            <select
              id="hint-attempts"
              value={settings.showHintsAfterAttempts}
              onChange={(e) => handleSettingChange('showHintsAfterAttempts', parseInt(e.target.value))}
              aria-label="Show Hints After"
            >
              <option value="1">1 attempt</option>
              <option value="2">2 attempts</option>
              <option value="3">3 attempts</option>
              <option value="5">5 attempts</option>
              <option value="10">10 attempts</option>
            </select>
          </label>
        </div>
      </div>
      
      {/* Playback Section */}
      <div className="settings-section">
        <h3>Playback</h3>
        
        <div className={toggleClass}>
          <label htmlFor="auto-advance" className={isMobile ? 'setting-toggle--compact' : ''}>
            <input
              id="auto-advance"
              type="checkbox"
              checked={settings.autoAdvanceRests}
              onChange={(e) => handleSettingChange('autoAdvanceRests', e.target.checked)}
              aria-label="Auto-advance on Rests"
            />
            <span className="setting-label">Auto-advance on Rests</span>
            <span className="setting-description">Automatically continue past rest notes</span>
          </label>
        </div>
        
        <div className="setting-group">
          <label htmlFor="practice-speed">
            <span className="setting-label">Practice Speed</span>
            <div className="speed-control">
              <input
                id="practice-speed"
                type="range"
                min="0.25"
                max="2"
                step="0.25"
                value={settings.playbackSpeed}
                onChange={(e) => handleSettingChange('playbackSpeed', parseFloat(e.target.value))}
                aria-label="Practice Speed"
                aria-valuemin={0.25}
                aria-valuemax={2}
                aria-valuenow={settings.playbackSpeed}
                role="slider"
              />
              <span className="speed-value">{settings.playbackSpeed}x</span>
            </div>
          </label>
        </div>
      </div>
      
      {/* Advanced Settings Toggle */}
      <button
        className="advanced-toggle"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
      </button>
      
      {/* Advanced Settings */}
      {showAdvanced && (
        <div className="settings-section">
          <h3>Advanced</h3>
          
          <div className={toggleClass}>
            <label htmlFor="section-looping" className={isMobile ? 'setting-toggle--compact' : ''}>
              <input
                id="section-looping"
                type="checkbox"
                checked={settings.sectionLooping}
                onChange={(e) => handleSettingChange('sectionLooping', e.target.checked)}
                aria-label="Section Looping"
              />
              <span className="setting-label">Section Looping</span>
              <span className="setting-description">Loop difficult sections for practice</span>
            </label>
          </div>
          
          <div className={toggleClass}>
            <label htmlFor="adaptive-difficulty" className={isMobile ? 'setting-toggle--compact' : ''}>
              <input
                id="adaptive-difficulty"
                type="checkbox"
                checked={settings.adaptiveDifficulty || false}
                onChange={(e) => handleSettingChange('adaptiveDifficulty', e.target.checked)}
                aria-label="Adaptive Difficulty"
              />
              <span className="setting-label">Adaptive Difficulty</span>
              <span className="setting-description">Automatically adjust difficulty based on performance</span>
            </label>
          </div>
          
          <div className="export-section">
            <button
              className="export-button"
              onClick={() => {
                if (exportStatus === 'idle') {
                  // Show export options
                  setExportStatus('showing-options');
                } else {
                  setExportStatus('idle');
                }
              }}
              disabled={exportStatus === 'exporting'}
            >
              Export Practice Data
            </button>
            
            {(exportStatus === 'exporting' || exportStatus === 'showing-options') && (
              <div className="export-options">
                <button onClick={() => handleExport('json')}>Export as JSON</button>
                <button onClick={() => handleExport('csv')}>Export as CSV</button>
              </div>
            )}
            
            {exportStatus === 'success' && (
              <div className="export-success">Export completed successfully!</div>
            )}
            
            {exportStatus === 'error' && (
              <div className="export-error">Export failed: {exportError}</div>
            )}
          </div>
        </div>
      )}
      
      {/* Screen reader announcements */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}