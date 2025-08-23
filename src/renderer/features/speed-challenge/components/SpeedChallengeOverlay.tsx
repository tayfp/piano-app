import React, { useEffect, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { useSpeedChallengeStore } from '../stores/speedChallengeStore';
import { useSpeedChallengeMidi } from '../hooks/useSpeedChallengeMidi';
import { useOSMDStore } from '@/renderer/stores/osmdStore';
import { SpeedChallengeControls } from './SpeedChallengeControls';
import { SpeedChallengeStatus } from './SpeedChallengeStatus';
import './SpeedChallenge.css';

/**
 * SpeedChallengeOverlay - Main UI component for Speed Challenge Mode
 * 
 * Layout: Exact 90/8/2 distribution
 * - 2% header (menu icon only - progressive disclosure)
 * - 90% content (sheet music display via OSMD)
 * - 8% status bar (score, streak, accuracy)
 * 
 * Performance target: <5ms render time
 */
export const SpeedChallengeOverlay: React.FC = () => {
  const {
    isActive,
    currentPattern,
    score,
    streak,
    accuracy,
  } = useSpeedChallengeStore();

  // Get zoom level from global OSMD store
  const zoomLevel = useOSMDStore(state => state.zoomLevel);

  const [showControls, setShowControls] = useState(false);
  const [osmdError, setOsmdError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const osmdContainerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const renderStartRef = useRef<number>(0);

  // Track render performance
  useEffect(() => {
    renderStartRef.current = performance.now();
  });

  // Initialize MIDI handling
  useSpeedChallengeMidi();

  // Initialize OSMD when container is ready
  useEffect(() => {
    if (!osmdContainerRef.current || !isActive) {
      return;
    }

    const initializeOSMD = async () => {
      try {
        setIsLoading(true);
        setOsmdError(null);

        // Create OSMD instance with optimized settings for speed
        osmdRef.current = new OpenSheetMusicDisplay(osmdContainerRef.current, {
          autoResize: true,
          backend: 'svg',
          drawTitle: false,
          drawSubtitle: false,
          drawComposer: false,
          drawLyricist: false,
          drawPartNames: false,
          drawFingerings: true,
          fingeringPosition: 'above',
          renderSingleHorizontalStaffline: false,
          colorStemsLikeNoteheads: true,
          drawMetronomeMarks: false,
          stretchLastSystemLine: false,
          defaultFontFamily: 'Inter, sans-serif',
        });

        // Set render options for minimal display
        osmdRef.current.setOptions({
          renderSingleHorizontalStaffline: false,
          spacingFactorSoftmax: 10,
          spacingBetweenTextLines: 1,
        });

        setIsLoading(false);
      } catch (error) {
        console.error('Failed to initialize OSMD:', error);
        setOsmdError('Failed to initialize sheet music display');
        setIsLoading(false);
      }
    };

    initializeOSMD();

    return () => {
      if (osmdRef.current) {
        osmdRef.current.clear();
        osmdRef.current = null;
      }
    };
  }, [isActive]);

  // Load and render current pattern
  useEffect(() => {
    if (!osmdRef.current || !currentPattern || !isActive) {
      return;
    }

    const loadPattern = async () => {
      try {
        setIsLoading(true);
        setOsmdError(null);

        // Load the MusicXML pattern
        await osmdRef.current!.load(currentPattern.musicXML);

        // Apply current zoom level if not at default (100%)
        if (zoomLevel !== 1.0) {
          osmdRef.current!.setZoom(zoomLevel);
        }

        // Render to the container
        osmdRef.current!.render();

        setIsLoading(false);
      } catch (error) {
        console.error('Failed to load pattern:', error);
        setOsmdError('Failed to load pattern');
        setIsLoading(false);
      }
    };

    loadPattern();
  }, [currentPattern, isActive, zoomLevel]);

  // Apply zoom changes in real-time when zoom level changes
  useEffect(() => {
    if (osmdRef.current && !isLoading && isActive) {
      try {
        osmdRef.current.setZoom(zoomLevel);
        osmdRef.current.render();
      } catch (error) {
        console.error('Failed to apply zoom:', error);
        // Don't break the application on zoom errors
      }
    }
  }, [zoomLevel, isLoading, isActive]);

  // Handle menu toggle
  const handleMenuToggle = () => {
    setShowControls(!showControls);
  };

  // Auto-hide controls after 3 seconds
  useEffect(() => {
    if (showControls) {
      const timer = setTimeout(() => {
        setShowControls(false);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [showControls]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC to toggle menu
      if (e.key === 'Escape') {
        setShowControls(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className={`speed-challenge-overlay ${isActive ? 'active' : ''}`}>
      {/* 2% Header - Menu icon only */}
      <div className="speed-challenge-header">
        <button
          className="speed-challenge-menu-button"
          onClick={handleMenuToggle}
          aria-label="Menu"
          type="button"
        >
          ≡
        </button>
        
        {showControls && (
          <SpeedChallengeControls
            onClose={() => setShowControls(false)}
          />
        )}
      </div>

      {/* 90% Content - Sheet music display */}
      <div className="speed-challenge-content">
        <div className="speed-challenge-osmd-container">
          {isLoading && (
            <div className="speed-challenge-loading">
              Loading pattern...
            </div>
          )}
          
          {osmdError && (
            <div className="speed-challenge-error">
              Failed to load pattern: {osmdError}
            </div>
          )}
          
          {!isLoading && !osmdError && (
            <div 
              ref={osmdContainerRef}
              className="speed-challenge-osmd-render"
              id="speed-challenge-osmd"
            />
          )}
        </div>
      </div>

      {/* 8% Status bar */}
      <SpeedChallengeStatus
        score={score}
        streak={streak}
        accuracy={accuracy}
      />
    </div>
  );
};