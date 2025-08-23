/**
 * TopControlsMenu - Clean UI hover/click menu
 * 
 * Pragmatic implementation that uses CSS :hover for desktop
 * and explicit state management only for keyboard/touch.
 * Performance-optimized with GPU-accelerated transforms.
 */

import React, { useEffect, useRef, useState } from 'react';
import { FileUploadButton } from '../FileUpload';
import { MidiDeviceSelector } from '../MidiDeviceSelector/MidiDeviceSelector';
import { AssistModeSelector } from '@/renderer/features/practice-mode/components/AssistModeSelector';
import { RepeatIndicator } from '@/renderer/features/practice-mode/components/RepeatIndicator';
import { MeasureRangeSelector } from '@/renderer/features/practice-mode/components/MeasureRangeSelector';
import { ThemeSwitcher } from '@/renderer/features/theme';
import { FingeringSettings } from '@/renderer/features/fingering/components/FingeringSettings';
import { ZoomControls } from '../ZoomControls/ZoomControls';
import { useFingeringStore } from '@/renderer/features/fingering/hooks/useFingeringStore';
import { usePracticeModeIntegration } from '@/renderer/features/fingering/hooks/usePracticeModeIntegration';
import { usePracticeStore } from '@/renderer/features/practice-mode/stores/practiceStore';
import { useSheetMusicStore } from '@/renderer/stores/sheetMusicStore';
import { useMidiContext } from '@/renderer/contexts/MidiContext';
import { useOSMDContext } from '@/renderer/contexts/OSMDContext';
import { useOSMDStore } from '@/renderer/stores/osmdStore';
import { useSpeedChallengeStore } from '@/renderer/features/speed-challenge/stores/speedChallengeStore';
import { announceToScreenReader } from '@/renderer/utils/accessibility';
import './TopControlsMenu.css';

interface TopControlsMenuProps {
  osmdReady?: boolean;
  isPracticeActive?: boolean;
  onStartPractice?: () => void;
  onStopPractice?: () => void;
}

export const TopControlsMenu: React.FC<TopControlsMenuProps> = ({
  osmdReady = false,
  isPracticeActive = false,
  onStartPractice = () => {},
  onStopPractice = () => {}
}) => {
  const { musicXML } = useSheetMusicStore();
  const { devices, isConnected, status } = useMidiContext();
  const { hasRepeats } = usePracticeStore();
  const { measureTimeline } = useOSMDContext();
  const fingeringStore = useFingeringStore();
  const { shouldShowFingeringEdit } = usePracticeModeIntegration();
  const { isActive: isSpeedChallengeActive, startChallenge, stopChallenge } = useSpeedChallengeStore();
  const [isOpen, setIsOpen] = useState(!musicXML); // Open by default when no score
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const firstFocusableRef = useRef<HTMLButtonElement>(null);
  const menuHandleRef = useRef<HTMLButtonElement>(null);
  
  
  // Toggle menu
  const handleToggle = () => {
    setIsOpen(prev => !prev);
  };
  
  // Handle mouse leave with grace period
  const handleMouseLeave = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      closeTimerRef.current = undefined;
    }, 300);
  };
  
  // Handle mouse enter (cancel close timer)
  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  };
  
  // ESC key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        // Return focus to menu handle
        menuHandleRef.current?.focus();
      }
    };
    
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen]);
  
  // Focus management
  useEffect(() => {
    if (isOpen && firstFocusableRef.current) {
      // Delay focus to ensure DOM is ready
      setTimeout(() => {
        firstFocusableRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);
  
  // Keyboard shortcuts for zoom
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl/Cmd key
      const isCtrlCmd = e.ctrlKey || e.metaKey;
      
      if (!isCtrlCmd) return;
      
      const { zoomIn, zoomOut, resetZoom } = useOSMDStore.getState();
      
      switch (e.key) {
        case '+':
        case '=': // Handle both + and = (same key without shift)
          e.preventDefault();
          zoomIn();
          announceToScreenReader(`Zoom ${Math.round(useOSMDStore.getState().zoomLevel * 100)}%`);
          break;
        case '-':
          e.preventDefault();
          zoomOut();
          announceToScreenReader(`Zoom ${Math.round(useOSMDStore.getState().zoomLevel * 100)}%`);
          break;
        case '0':
          e.preventDefault();
          resetZoom();
          announceToScreenReader('Zoom reset to 100%');
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);
  
  // Connection status display
  const connectionStatus = isConnected 
    ? ` ${devices.length} device${devices.length !== 1 ? 's' : ''}`
    : status === 'error' 
    ? ' Error'
    : ' No device';

  return (
    <>
      {/* Invisible hover trigger zone for desktop */}
      <div className="menu-hover-zone" />
      
      {/* Visible menu handle */}
      <button
        ref={menuHandleRef}
        className="menu-handle"
        onClick={handleToggle}
        aria-label="Toggle controls menu"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path d="M3 5h14v2H3V5zm0 4h14v2H3V9zm0 4h14v2H3v-2z"/>
        </svg>
      </button>
      
      {/* The actual menu */}
      <nav
        id="top-controls-menu"
        className={`controls-menu ${isOpen ? 'is-open' : ''}`}
        onMouseLeave={handleMouseLeave}
        onMouseEnter={handleMouseEnter}
        role="navigation"
        aria-label="Main controls"
      >
        <div className="menu-content">
          {/* Score Controls */}
          <div className="menu-section">
            <FileUploadButton 
              ref={firstFocusableRef}
              variant={musicXML ? "secondary" : "primary"} 
            />
            {musicXML && (
              <button 
                className="menu-button practice-button"
                onClick={isPracticeActive ? onStopPractice : onStartPractice}
                disabled={!osmdReady || isSpeedChallengeActive}
              >
                {!osmdReady ? 'Loading...' : (isPracticeActive ? 'Stop Practice' : 'Start Practice')}
              </button>
            )}
            {musicXML && (
              <button 
                className="menu-button speed-challenge-button"
                onClick={isSpeedChallengeActive ? stopChallenge : startChallenge}
                disabled={!osmdReady || isPracticeActive}
              >
                {!osmdReady ? 'Loading...' : (isSpeedChallengeActive ? 'Stop Speed Challenge' : 'Speed Challenge')}
              </button>
            )}
          </div>
          
          {/* MIDI Controls */}
          <div className="menu-section">
            <MidiDeviceSelector />
            <span className="connection-status" title={`MIDI ${status}`}>
              {connectionStatus}
            </span>
          </div>
          
          {/* Practice Settings */}
          <div className="menu-section">
            <AssistModeSelector />
            {hasRepeats && osmdReady && <RepeatIndicator />}
            {/* Add custom range selector when practice is active */}
            {osmdReady && isPracticeActive && (
              <MeasureRangeSelector 
                totalMeasures={measureTimeline?.getMeasureCount() ?? 1}
                className="practice-setting" 
              />
            )}
          </div>
          
          {/* Fingering Settings */}
          {musicXML && (
            <section className="menu-section">
              <h3 className="menu-section-title">Fingering</h3>
              <FingeringSettings />
              <div className="control-group">
                <label className="control-label">
                  <input
                    type="checkbox"
                    checked={fingeringStore.isEditingMode}
                    onChange={(e) => fingeringStore.setEditingMode(e.target.checked)}
                    disabled={!shouldShowFingeringEdit()}
                    aria-label="Toggle fingering edit mode"
                  />
                  Edit Fingerings
                  {!shouldShowFingeringEdit() && (
                    <span className="control-hint"> (disabled during practice)</span>
                  )}
                </label>
              </div>
            </section>
          )}
          
          {/* Theme Settings */}
          <div className="menu-section">
            <ThemeSwitcher />
          </div>
          
          {/* Zoom Controls */}
          {musicXML && osmdReady && (
            <div className="menu-section">
              <h3 className="menu-section-title">View</h3>
              <ZoomControls />
            </div>
          )}
        </div>
      </nav>
    </>
  );
};