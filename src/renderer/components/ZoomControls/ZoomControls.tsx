import React, { useState, useEffect } from 'react';
import { useOSMDStore } from '@/renderer/stores/osmdStore';
import { announceToScreenReader } from '@/renderer/utils/accessibility';
import './ZoomControls.css';

export const ZoomControls: React.FC = () => {
  const storeState = useOSMDStore();
  const [isAnimating, setIsAnimating] = useState(false);
  
  // Handle store disconnection gracefully
  if (!storeState) {
    return (
      <div className="zoom-controls" role="group" aria-label="Zoom controls">
        <span>Zoom controls unavailable</span>
      </div>
    );
  }
  
  const { zoomLevel, zoomIn, zoomOut, resetZoom } = storeState;
  
  // Format zoom as percentage
  const zoomPercent = Math.round(zoomLevel * 100);
  
  // Animation effect for zoom changes
  useEffect(() => {
    setIsAnimating(true);
    const timer = setTimeout(() => {
      setIsAnimating(false);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [zoomLevel]);
  
  // Enhanced zoom handlers with limit feedback
  const handleZoomIn = () => {
    if (zoomLevel >= 2.0) {
      // Visual shake to indicate limit
      const button = document.activeElement as HTMLElement;
      button?.classList.add('zoom-limit-shake');
      setTimeout(() => button?.classList.remove('zoom-limit-shake'), 300);
      announceToScreenReader('Maximum zoom reached');
    } else {
      zoomIn();
    }
  };
  
  const handleZoomOut = () => {
    if (zoomLevel <= 0.5) {
      // Visual shake to indicate limit
      const button = document.activeElement as HTMLElement;
      button?.classList.add('zoom-limit-shake');
      setTimeout(() => button?.classList.remove('zoom-limit-shake'), 300);
      announceToScreenReader('Minimum zoom reached');
    } else {
      zoomOut();
    }
  };
  
  return (
    <div className="zoom-controls" role="group" aria-label="Zoom controls">
      <button
        className="zoom-button"
        onClick={handleZoomOut}
        disabled={zoomLevel <= 0.5}
        aria-label="Zoom out"
        title="Zoom out (Ctrl+-)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3 8h10v1H3z"/>
        </svg>
      </button>
      
      <button
        className={`zoom-level ${isAnimating ? 'zoom-animating' : ''}`}
        onClick={resetZoom}
        aria-label={`Reset zoom to 100%`}
        title="Reset zoom (Ctrl+0)"
      >
        {zoomPercent}%
      </button>
      
      <button
        className="zoom-button"
        onClick={handleZoomIn}
        disabled={zoomLevel >= 2.0}
        aria-label="Zoom in"
        title="Zoom in (Ctrl++)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 3v5H3v1h5v5h1V9h5V8H9V3H8z"/>
        </svg>
      </button>
    </div>
  );
};