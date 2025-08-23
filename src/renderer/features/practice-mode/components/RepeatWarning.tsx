import React, { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import { usePracticeStore } from '../stores/practiceStore';
import { useOSMDContext } from '../../../contexts/OSMDContext';
import '../styles/repeat-warning.css';

interface RepeatWarningProps {
  onProceed: () => void;
  onCancel: () => void;
}

interface RepeatInfo {
  type: string;
  measureIndex: number;
}

export const RepeatWarning: React.FC<RepeatWarningProps> = ({ onProceed, onCancel }) => {
  const { repeatWarningDismissed, dismissRepeatWarning } = usePracticeStore();
  const { detectRepeats } = useOSMDContext();
  const [isVisible, setIsVisible] = useState(false);
  const [isEntering, setIsEntering] = useState(false);
  const proceedButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  
  // Detect repeats in the score
  const repeats = useMemo(() => {
    if (!detectRepeats) return [];
    return detectRepeats();
  }, [detectRepeats]);
  
  // Format repeat sections for display
  const repeatSections = useMemo(() => {
    if (repeats.length === 0) return [];
    
    const sections: string[] = [];
    let i = 0;
    
    while (i < repeats.length) {
      const repeat = repeats[i];
      
      if (repeat.type === 'repeat_start') {
        // Find matching end
        const endIndex = repeats.findIndex((r, idx) => 
          idx > i && r.type === 'repeat_end'
        );
        
        if (endIndex !== -1) {
          sections.push(`${repeat.measureIndex}-${repeats[endIndex].measureIndex}`);
          i = endIndex + 1;
        } else {
          i++;
        }
      } else if (repeat.type === 'dc_al_fine') {
        sections.push('D.C. al Fine');
        i++;
      } else if (repeat.type === 'ds_al_coda') {
        sections.push('D.S. al Coda');
        i++;
      } else {
        i++;
      }
    }
    
    // Deduplicate sections to avoid showing same repeat type multiple times
    const uniqueSections = [...new Set(sections)];
    return uniqueSections;
  }, [repeats]);
  
  // Determine if we should show the warning
  const shouldShow = repeats.length > 0 && !repeatWarningDismissed;
  
  useEffect(() => {
    if (shouldShow) {
      setIsVisible(true);
      setIsEntering(true);
      // Remove entering class after animation
      const timer = setTimeout(() => setIsEntering(false), 300);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [shouldShow]);
  
  // Focus management
  useEffect(() => {
    if (isVisible && proceedButtonRef.current) {
      // Focus first button when dialog opens
      setTimeout(() => {
        proceedButtonRef.current?.focus();
      }, 100);
    }
  }, [isVisible]);
  
  // Body scroll prevention
  useEffect(() => {
    if (isVisible) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isVisible]);
  
  const handleProceed = () => {
    dismissRepeatWarning();
    onProceed();
  };
  
  const handleCancel = () => {
    onCancel();
  };
  
  // Keyboard handling
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel();
    } else if (e.key === 'Tab') {
      // Trap focus within dialog
      e.preventDefault();
      if (e.shiftKey) {
        // Shift+Tab: go backwards
        if (document.activeElement === proceedButtonRef.current) {
          cancelButtonRef.current?.focus();
        } else {
          proceedButtonRef.current?.focus();
        }
      } else {
        // Tab: go forwards
        if (document.activeElement === cancelButtonRef.current) {
          proceedButtonRef.current?.focus();
        } else {
          cancelButtonRef.current?.focus();
        }
      }
    }
  }, [handleCancel]);
  
  // Global escape key handler
  useEffect(() => {
    if (isVisible) {
      const handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          handleCancel();
        }
      };
      
      document.addEventListener('keydown', handleGlobalKeyDown);
      return () => {
        document.removeEventListener('keydown', handleGlobalKeyDown);
      };
    }
  }, [isVisible, handleCancel]);
  
  // Don't render if not needed
  if (!isVisible) {
    return null;
  }
  
  // Check for special repeat types
  const hasDCAlFine = repeats.some(r => r.type === 'dc_al_fine');
  const hasDSAlCoda = repeats.some(r => r.type === 'ds_al_coda');
  
  return (
    <div 
      data-testid="repeat-warning" 
      className={`repeat-warning repeat-warning--visible ${isEntering ? 'repeat-warning--entering' : ''}`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="repeat-warning-title"
      aria-describedby="repeat-warning-description"
      onKeyDown={handleKeyDown}
    >
      <div className="repeat-warning__overlay" onClick={handleCancel} />
      <div className="repeat-warning__content">
        <h2 id="repeat-warning-title" className="repeat-warning__title">
          ⚠️ Musical Repeats Detected
        </h2>
        
        <div id="repeat-warning-description" className="repeat-warning__description">
          <p className="repeat-warning__main-text">
            This score contains musical repeats. Practice mode will play through once without observing repeat signs.
          </p>
          
          {repeatSections.length > 0 && (
            <p className="repeat-warning__details">
              Repeats found in measures: {repeatSections.join(', ')}
            </p>
          )}
          
          {(hasDCAlFine || hasDSAlCoda) && (
            <p className="repeat-warning__special">
              {hasDCAlFine && hasDSAlCoda 
                ? 'This score includes D.C. al Fine and D.S. al Coda navigation marks.'
                : hasDCAlFine 
                  ? 'This score includes D.C. al Fine navigation.'
                  : 'This score includes D.S. al Coda navigation.'
              }
            </p>
          )}
          
          <p className="repeat-warning__note">
            For full repeat support, consider using performance mode instead.
          </p>
        </div>
        
        <div className="repeat-warning__actions">
          <button 
            ref={proceedButtonRef}
            onClick={handleProceed}
            className="repeat-warning__button repeat-warning__button--primary"
            aria-label="Proceed anyway"
          >
            Proceed Anyway
          </button>
          <button 
            ref={cancelButtonRef}
            onClick={handleCancel}
            className="repeat-warning__button repeat-warning__button--secondary"
            aria-label="Choose different score"
          >
            Choose Different Score
          </button>
        </div>
      </div>
    </div>
  );
};