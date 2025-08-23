import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useOSMD } from '../../hooks/useOSMD';
import { useOSMDContext } from '../../contexts/OSMDContext';
import { SheetMusicErrorBoundary } from './SheetMusicErrorBoundary';
import { FingeringLayer } from '../../features/fingering/components/FingeringLayer';
import { useFingeringStore } from '../../features/fingering/stores/fingeringStore';
import { FingeringErrorBoundary } from '../../features/fingering/components/FingeringErrorBoundary';
import { useFingeringEnabled } from '../../features/fingering/hooks/useFingeringSettings';
import { usePracticeModeIntegration } from '../../features/fingering/hooks/usePracticeModeIntegration';
import { useFingeringPersistence } from '../../features/fingering/hooks/useFingeringPersistence';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { logger } from '@/renderer/utils/simple-logger';
import { IS_DEVELOPMENT } from '@/renderer/utils/env';
import './SheetMusic.css';

interface SheetMusicProps {
  musicXML?: string;
  scoreId?: string;
  className?: string;
  onOSMDReady?: (osmd: any, controls: any, detectRepeats: any) => void;
  autoShowCursor?: boolean;
}

export const SheetMusic: React.FC<SheetMusicProps> = ({ musicXML, scoreId, className = '', onOSMDReady, autoShowCursor = true }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const { isLoading, error, controls, osmd, isReady, osmdReady, noteMapping, graphicalNoteMap, detectRepeats } = useOSMD(containerRef, musicXML, autoShowCursor, scoreId);
  const { setOSMDInstance, clearOSMDInstance } = useOSMDContext();
  const [showDebugOverlay, setShowDebugOverlay] = useState(process.env.NODE_ENV === 'development');
  const [cursorVisible, setCursorVisible] = useState(false);
  const diagnosticsRunRef = useRef(false); // Prevent duplicate diagnostics
  const osmdSetRef = useRef(false); // CRITICAL: Prevent double OSMD instance setting
  
  // Performance-optimized selectors
  const fingeringEnabled = useFingeringEnabled();
  const { shouldShowFingeringEdit } = usePracticeModeIntegration(scoreId || null);
  
  // BUGFIX: shouldShowFingeringEdit is a function, not a boolean
  const isFingeringInteractive = shouldShowFingeringEdit();
  
  // Load fingerings from persistence when scoreId changes
  useFingeringPersistence(scoreId || null);
  
  // DEBUG: Log rendering conditions
  useEffect(() => {
    if (IS_DEVELOPMENT) {
      perfLogger.debug('FINGERING DEBUG - SheetMusic render conditions:', {
        osmd: !!osmd,
        isReady,
        scoreId,
        fingeringEnabled,
        isFingeringInteractive,
        willRenderOverlay: !!(osmd && isReady && scoreId),
        willRenderFingeringLayer: !!(osmd && isReady && scoreId && fingeringEnabled)
      });
      
      if (scoreId) {
        perfLogger.debug('FINGERING DEBUG - scoreId is now available:', { scoreId });
      }
    }
  }, [osmd, isReady, scoreId, fingeringEnabled, isFingeringInteractive]);
  
  // Removed cursor visibility fix - using clean OSMD native API
  
  // Robust synchronization mechanism for overlay
  const syncOverlayDimensions = useCallback(() => {
    if (!osmd || !overlayRef.current || !containerRef.current) return;
    
    try {
      const osmdSvg = containerRef.current.querySelector('svg');
      if (osmdSvg && overlayRef.current) {
        const { width, height } = osmdSvg.getBoundingClientRect();
        overlayRef.current.style.width = `${width}px`;
        overlayRef.current.style.height = `${height}px`;
        
        // Copy viewBox for proper scaling
        const viewBox = osmdSvg.getAttribute('viewBox');
        if (viewBox) {
          overlayRef.current.setAttribute('viewBox', viewBox);
        }
      }
    } catch (error) {
      if (IS_DEVELOPMENT) {
        perfLogger.warn('Error synchronizing overlay dimensions', error instanceof Error ? error : undefined);
      }
    }
  }, [osmd]);
  
  // Robust event handling with cleanup
  useEffect(() => {
    if (!osmd || !isReady) return;
    
    // Sync on initial render
    syncOverlayDimensions();
    
    // Debounced resize handler to prevent memory issues
    let timeoutId: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(syncOverlayDimensions, 150); // Increased debounce
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timeoutId);
    };
  }, [osmd, isReady, syncOverlayDimensions]);
  
  // Expose imperative API for tests
  React.useEffect(() => {
    if (containerRef.current) {
      (containerRef.current as any).imperativeApi = controls;
    }
  }, [controls]);
  
  // Provide OSMD instance to context and call onOSMDReady
  React.useEffect(() => {
    if (osmd && controls && detectRepeats) {
      // CRITICAL FIX: Singleton check to prevent double initialization
      if (!osmdSetRef.current) {
        osmdSetRef.current = true;
        
        // Provide to context
        setOSMDInstance(osmd, controls, detectRepeats);
        
        // Call legacy callback for backward compatibility
        if (onOSMDReady) {
          try {
            onOSMDReady(osmd, controls, detectRepeats);
          } catch (e) {
            perfLogger.error('Error thrown in onOSMDReady callback', e instanceof Error ? e : undefined);
          }
        }
      } else {
        perfLogger.debug('[SheetMusic] OSMD instance already set, skipping duplicate initialization');
      }
      
      // ENHANCED DIAGNOSTIC LOGGING - DEBUG THE BACKGROUND EXTENSION ISSUE
      if (process.env.NODE_ENV === 'development' && !diagnosticsRunRef.current) {
        diagnosticsRunRef.current = true; // Prevent duplicate runs
        setTimeout(() => {
          const container = containerRef.current;
          const wrapper = container?.parentElement; // .sheet-music-wrapper
          const area = wrapper?.parentElement; // .sheet-music-area (scrolling + background)
          const section = area?.parentElement; // .sheet-music-section
          const svg = container?.querySelector('svg');
          
          // Only show DOM debug with explicit flag
          const DEBUG_DOM = localStorage.getItem('debug:dom') === 'true';
          if (DEBUG_DOM) {
            logger.osmd('OSMD BACKGROUND EXTENSION DEBUG:');
            logger.system('=====================================');
          
          // Element hierarchy verification
          logger.system('ELEMENT HIERARCHY:');
          logger.system(`- Container (.sheet-music-container): ${container?.className}`);
          logger.system(`- Wrapper (.sheet-music-wrapper): ${wrapper?.className}`);
          logger.system(`- Area (.sheet-music-area): ${area?.className}`);
          logger.system(`- Section (.sheet-music-section): ${section?.className}`);
          
          // Dimensions analysis
          logger.system('DIMENSIONS:');
          logger.system('Container rect:', container?.getBoundingClientRect());
          logger.system('Wrapper rect:', wrapper?.getBoundingClientRect());
          logger.system('Area rect (BACKGROUND ELEMENT):', area?.getBoundingClientRect());
          logger.system('Section rect:', section?.getBoundingClientRect());
          logger.system('SVG rect:', svg?.getBoundingClientRect());
          
          // Scroll properties analysis
          logger.system('SCROLL PROPERTIES:');
          logger.system(`Area scrollHeight vs clientHeight: ${area?.scrollHeight} vs ${area?.clientHeight}`);
          logger.system(`Area should scroll: ${(area?.scrollHeight || 0) > (area?.clientHeight || 0)}`);
          logger.system(`Section scrollHeight vs clientHeight: ${section?.scrollHeight} vs ${section?.clientHeight}`);
          logger.system(`Section should scroll: ${(section?.scrollHeight || 0) > (section?.clientHeight || 0)}`);
          
          // SVG positioning analysis
          if (svg) {
            const svgStyles = window.getComputedStyle(svg);
            logger.system('SVG POSITIONING:');
            logger.system(`SVG position: ${svgStyles.position}`);
            logger.system(`SVG transform: ${svgStyles.transform}`);
            logger.system(`SVG width x height: ${svg.getAttribute('width')}`);
            logger.system(`SVG viewBox: ${svg.getAttribute('viewBox')}`);
            
            // Check for absolute positioning that could disconnect flow
            if (svgStyles.position === 'absolute') {
              perfLogger.warn('FOUND ISSUE: SVG is position:absolute - this disconnects it from normal flow!')
            }
          }
          
          // Background styling verification
          if (area) {
            const areaStyles = window.getComputedStyle(area);
            logger.osmd('BACKGROUND ELEMENT STYLES (.sheet-music-area):');
            logger.system(`Background color: ${areaStyles.backgroundColor}`);
            logger.system(`Border radius: ${areaStyles.borderRadius}`);
            logger.system(`Box shadow: ${areaStyles.boxShadow}`);
            logger.system(`Padding: ${areaStyles.padding}`);
            logger.system(`Box sizing: ${areaStyles.boxSizing}`);
            logger.system(`Overflow Y: ${areaStyles.overflowY}`);
            logger.system(`Height: ${areaStyles.height}`);
            logger.system(`Min height: ${areaStyles.minHeight}`);
            logger.system(`Max height: ${areaStyles.maxHeight}`);
          }
          
          // Content height vs background height analysis
          const contentHeight = svg?.getBoundingClientRect().height || 0;
          const backgroundHeight = area?.getBoundingClientRect().height || 0;
          const wrapperHeight = wrapper?.getBoundingClientRect().height || 0;
          logger.system('HEIGHT ANALYSIS:');
          logger.system(`Content height (SVG): ${contentHeight}`);
          logger.system(`Background height (Area - viewport): ${backgroundHeight}`);
          logger.system(`Wrapper height (with background): ${wrapperHeight}`);
          logger.system(`Background extends to content: ${wrapperHeight >= contentHeight}`);
          
          // Check both old issue (area too small) and new fix (wrapper grows)
          if (backgroundHeight < contentHeight && wrapperHeight < contentHeight) {
            perfLogger.error('CONFIRMED ISSUE: Both area and wrapper are smaller than content height!');
            logger.system(`Missing background coverage: ${contentHeight - Math.max(backgroundHeight, wrapperHeight)} pixels`);
          } else if (wrapperHeight >= contentHeight) {
            logger.system('SUCCESS: Wrapper grows to full content height - background covers everything!');
            logger.system(`Background coverage: ${wrapperHeight - contentHeight >= 0 ? 'Complete' : 'Partial'}`);
          } else {
            perfLogger.warn('PARTIAL FIX: Wrapper still constrained, but area is viewport-only (expected)')
          }
          }
          
          // Reset flag after a delay to allow re-running if needed
          setTimeout(() => {
            diagnosticsRunRef.current = false;
          }, 2000);
        }, 500); // Wait for full render
      }
    }
  }, [osmd, controls, detectRepeats, onOSMDReady]); // Removed setOSMDInstance, clearOSMDInstance from deps
  
  // Separate cleanup effect that only runs on unmount
  React.useEffect(() => {
    return () => {
      clearOSMDInstance();
      osmdSetRef.current = false; // Reset singleton flag on unmount
    };
  }, []); // Empty deps - only runs on unmount

  // Check cursor visibility when ready
  useEffect(() => {
    if (isReady && controls) {
      // ✅ CLEAN CURSOR: Check cursor availability directly
      const iterator = controls.cursor?.iterator;
      const hasPosition = iterator && !iterator.EndReached && !iterator.endReached;
      setCursorVisible(hasPosition);
    }
  }, [isReady, controls]);

  // Keyboard shortcuts for debugging
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
        e.preventDefault();
        setShowDebugOverlay(prev => !prev);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!musicXML) {
    return (
      <div className={`sheet-music-wrapper ${className}`}>
        <div className="sheet-music-empty">
          <h3>Load a music score to begin</h3>
          <p>Upload MusicXML files to display sheet music</p>
        </div>
      </div>
    );
  }

  return (
    <SheetMusicErrorBoundary>
      <div className={`sheet-music-wrapper ${className}`} role="region" aria-label="Sheet music">
        {isLoading && (
          <div className="sheet-music-loading" role="status" aria-live="polite">
            <div className="loading-spinner"></div>
            <span>Loading sheet music...</span>
          </div>
        )}
        
        {error && (
          <div className="sheet-music-error">
            <h3>Failed to load sheet music</h3>
            <p>{error.message}</p>
          </div>
        )}
        
        <div 
          className="osmd-container" 
          style={{ position: 'relative' }}
          data-fingering-edit={isFingeringInteractive ? 'true' : 'false'}
        >
          {/* Existing OSMD render container */}
          <div 
            ref={containerRef} 
            className="sheet-music-container"
            role="img"
            aria-label="Sheet music display"
            tabIndex={0}
          />
          
          {/* Fingering overlay - only render when OSMD is ready and scoreId is provided */}
          {osmd && isReady && scoreId && (
            <svg 
              ref={overlayRef}
              className="fingering-overlay"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none', // Always none to allow clicks to pass through to OSMD notes
                zIndex: 10
              }}
              // Force remount on score change for state consistency
              key={scoreId}
            >
              {/* Integration with settings, practice mode, and error boundary */}
              {fingeringEnabled && (
                <FingeringErrorBoundary>
                  <FingeringLayer 
                    scoreId={scoreId} 
                    graphicalNoteMap={graphicalNoteMap}
                    interactive={isFingeringInteractive}
                    containerRef={containerRef as React.RefObject<HTMLDivElement>}
                  />
                </FingeringErrorBoundary>
              )}
            </svg>
          )}
        </div>
        
      </div>
    </SheetMusicErrorBoundary>
  );
};