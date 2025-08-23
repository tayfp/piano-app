/**
 * Main App Component - Refactored
 * 
 * Reduced from 371 lines to ~200 lines by extracting:
 * - Providers → AppProviders.tsx
 * - Error handling → useGlobalErrorHandler.ts
 * - Practice mode logic → usePracticeMode.ts
 * - MIDI handlers → useMidiHandlers.ts
 * - Error display → ErrorDisplay.tsx
 */

import React, { useEffect, useState } from 'react';
import { AppLayout } from './components/Layout/AppLayout';
import { PianoKeyboard } from './components/PianoKeyboard';
import { SheetMusic } from './components/SheetMusic';
import { MusicXMLDropZone } from './components/FileUpload';
import { MidiErrorBoundary } from './components/MidiErrorBoundary/MidiErrorBoundary';
import { ErrorDisplay } from './components/ErrorDisplay';
import { AppProviders } from './providers/AppProviders';
import { TopControlsMenu } from './components/TopControlsMenu';
import { FingeringEditIndicator } from './components/FingeringEditIndicator';
import { AlphaBanner } from './components/AlphaBanner';

// Stores and contexts
import { useSheetMusicStore } from './stores/sheetMusicStore';
import { useMidiContext } from './contexts/MidiContext';
import { usePianoStore } from './stores/pianoStore';
import { usePracticeStore } from './features/practice-mode/stores/practiceStore';
import { useSpeedChallengeStore } from './features/speed-challenge/stores/speedChallengeStore';
import { resetAnimations } from './services/animatorInstance';

// Custom hooks
import { useGlobalErrorHandler } from './hooks/useGlobalErrorHandler';
import { usePracticeMode } from './hooks/usePracticeMode';
import { useMidiHandlers } from './hooks/useMidiHandlers';

// Practice mode components
import { PracticeModeOverlay } from './features/practice-mode/components/PracticeModeOverlay';
import { HintSystem } from './features/practice-mode/components/HintSystem';
import { RepeatWarning } from './features/practice-mode/components/RepeatWarning';

// Speed Challenge components
import { SpeedChallengeOverlay } from './features/speed-challenge/components/SpeedChallengeOverlay';

// Utils
import { IS_DEVELOPMENT } from './utils/env';

// Debug components removed - using clean cursor implementation

// Performance overlay - lazy loaded for development only
// TODO: Implement PerformanceOverlay component at ./components/PerformanceOverlay
// Should display real-time MIDI latency stats from midiStore.latencyStats
// See: src/renderer/stores/midiStore.ts for available performance data
// const PerformanceOverlay = IS_DEVELOPMENT
//   ? React.lazy(() => import('./components/PerformanceOverlay'))
//   : () => null;

import './App.css';

// Main app content with clean UI
function AppContent() {
  const { musicXML, scoreId } = useSheetMusicStore();
  const { resetAllNotes } = usePianoStore();
  const { devices, status } = useMidiContext();
  const { appError, setAppError } = useGlobalErrorHandler();
  const { isActive: isSpeedChallengeActive } = useSpeedChallengeStore();
  
  // Practice mode management
  const {
    isPracticeActive,
    osmdReady,
    practiceController,
    showRepeatWarning,
    handleStartPractice,
    handleRepeatWarningProceed,
    handleRepeatWarningCancel
  } = usePracticeMode();

  // Reset piano highlighting when MIDI disconnects
  useEffect(() => {
    if (status === 'error' || (status === 'ready' && devices.length === 0)) {
      resetAllNotes();
      resetAnimations();
    }
  }, [status, devices.length, resetAllNotes]);

  // Reset practice warning when new score is loaded
  useEffect(() => {
    if (musicXML) {
      usePracticeStore.getState().resetRepeatWarning();
    }
  }, [musicXML]);

  // Handle practice errors
  useEffect(() => {
    if (appError) {
      practiceController.stopPractice();
    }
  }, [appError, practiceController]);

  // Show error screen if there's a critical error
  if (appError) {
    return <ErrorDisplay error={appError} onClearError={() => setAppError(null)} />;
  }

  return (
    <AppLayout>
      <AlphaBanner />
      <MidiErrorBoundary>
        {/* Top Controls Menu - All controls in one place */}
        <TopControlsMenu 
          osmdReady={osmdReady}
          isPracticeActive={isPracticeActive}
          onStartPractice={handleStartPractice}
          onStopPractice={practiceController.stopPractice}
        />
        
        {/* Fingering Edit Mode Indicator */}
        <FingeringEditIndicator />
        
        <MusicXMLDropZone className="app-container">
          <div className="app-layout-clean">
            {/* Sheet Music Area */}
            <div className="sheet-music-area">
              {musicXML ? (
                <SheetMusic 
                  musicXML={musicXML}
                  scoreId={scoreId}
                  autoShowCursor={true}
                />
              ) : (
                <div className="welcome-minimal">
                  <h2>Urtext Piano</h2>
                  <p>Drag and drop a MusicXML file or use the menu above ↑</p>
                </div>
              )}
            </div>
            
            {/* Piano Keyboard */}
            <div className="piano-area">
              <PianoKeyboard />
            </div>
          </div>
          
          {/* Practice Mode Overlays */}
          {isPracticeActive && <PracticeModeOverlay />}
          {isPracticeActive && <HintSystem />}
          {showRepeatWarning && (
            <RepeatWarning 
              onProceed={handleRepeatWarningProceed}
              onCancel={handleRepeatWarningCancel}
            />
          )}
          
          {/* Speed Challenge Overlay */}
          {isSpeedChallengeActive && <SpeedChallengeOverlay />}
          
          {/* Performance Overlay - Development Only - DISABLED */}
          {/* TODO: Re-enable when PerformanceOverlay component is implemented
          {IS_DEVELOPMENT && (
            <React.Suspense fallback={null}>
              <PerformanceOverlay />
            </React.Suspense>
          )}
          */}
        </MusicXMLDropZone>
      </MidiErrorBoundary>
    </AppLayout>
  );
}

// Root component with providers
export default function App() {
  const { handleMidiEventWithPractice } = useMidiHandlers();
  
  return (
    <AppProviders 
      onMidiEvent={handleMidiEventWithPractice}
    >
      <AppContent />
    </AppProviders>
  );
}