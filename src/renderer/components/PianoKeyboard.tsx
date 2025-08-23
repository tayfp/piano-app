import React, { useMemo, useEffect } from 'react';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { logger } from '@/renderer/utils/simple-logger';
import { usePiano } from '../hooks/usePiano';
import { PianoKey } from './PianoKey';
import { usePracticeStore } from '../features/practice-mode/stores/practiceStore';
import { usePianoStore } from '../stores/pianoStore';
import { useAssist } from '../features/practice-mode/providers/AssistProvider';
import type { CursorData } from '../features/practice-mode/services/PracticeAssistService';
import type { PracticeHighlight } from '../stores/pianoStore';
import './PianoKeyboard.css';

// Error Boundary Component
export class PianoErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    perfLogger.error('Piano component error:', error);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="piano-error">
          <p>Something went wrong with the piano component.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

export const PianoKeyboard: React.FC = (): React.ReactElement => {
  const { keys } = usePiano();
  
  // Practice mode state
  const { isActive, currentStep } = usePracticeStore();
  
  // Piano store actions for unified highlighting
  const { setPracticeHighlight, clearAllPracticeHighlights } = usePianoStore();
  
  // Get assist service from context
  const { assistService, config } = useAssist();
  
  // Handle practice mode highlighting with unified state
  useEffect(() => {
    // Skip if assist is off
    if (config.mode === 'off') {
      clearAllPracticeHighlights();
      return;
    }
    
    // Build cursor data - different logic for different modes
    let cursorData: CursorData;
    
    if (config.mode === 'practice') {
      // Practice mode: use practice store state
      cursorData = {
        currentStep,
        position: null,
        isActive: isActive, // Only active when practice mode is running
      };
    } else if (config.mode === 'follow') {
      // Follow mode: get current cursor position from OSMD
      // TODO: In Phase 2, get actual cursor position from OSMD
      // For now, use currentStep when available (when practice was active before)
      cursorData = {
        currentStep,
        position: null,
        isActive: !!currentStep, // Active if there's a valid cursor position
      };
    } else {
      // Off mode: no highlighting
      cursorData = {
        currentStep: null,
        position: null,
        isActive: false,
      };
    }
    
    // Get highlights from assist service
    const highlights = assistService.getHighlightsForCursor(cursorData);
    
    // Debug logging
    if (process.env.NODE_ENV !== 'production') {
      logger.practice('Got highlights from assist service', {
        count: highlights.length,
        highlights: highlights,
        currentStep: currentStep,
        isActive: isActive,
        settingsMode: config.mode
      });
    }
    
    // Clear previous highlights before applying new ones
    clearAllPracticeHighlights();
    
    // Apply highlights to state
    highlights.forEach((highlight, index) => {
      const practiceHighlight: PracticeHighlight = {
        type: highlight.type,
        hand: highlight.hand,
        fingering: highlight.fingering,
        options: highlight.options
      };
      if (process.env.NODE_ENV !== 'production') {
        logger.practice(`[PianoKeyboard] Setting highlight ${index} for note ${highlight.midiNote}:`, practiceHighlight);
      }
      setPracticeHighlight(highlight.midiNote, practiceHighlight);
    });
    
    // Cleanup function
    return () => {
      clearAllPracticeHighlights();
    };
  }, [assistService, config, currentStep, isActive, setPracticeHighlight, clearAllPracticeHighlights]);
  
  // Note: Normal key highlighting is now handled by PianoKey components
  // directly through usePianoStore state subscriptions
  
  // Performance monitoring
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && typeof performance !== 'undefined' && performance.mark) {
      try {
        performance.mark('piano-render-start');
        return () => {
          try {
            performance.mark('piano-render-end');
            if (performance.measure) {
              performance.measure('piano-render', 'piano-render-start', 'piano-render-end');
            }
          } catch (error) {
            // Silently fail - performance monitoring should not break the app
          }
        };
      } catch (error) {
        // Silently fail - performance monitoring should not break the app
      }
    }
  }, []);
  
  // Memoize key elements for performance
  const keyElements = useMemo(() => {
    return keys.map((key) => {
      const style = key.type === 'white'
        ? { gridColumn: `${(key.whiteKeyIndex ?? 0) + 1} / span 1` }
        : { 
            gridColumn: `${key.referenceGridColumn ?? 1} / span 1`,
            zIndex: 2 
          };
      
      return (
        <PianoKey
          key={key.id}
          keyData={key}
          style={style}
        />
      );
    });
  }, [keys]);
  
  return (
    <div className="piano-container">
      <div className="piano-keyboard" role="group" aria-label="88-key piano keyboard">
        {keyElements}
      </div>
    </div>
  );
};