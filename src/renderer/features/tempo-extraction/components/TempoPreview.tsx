/**
 * TempoPreview - Visual tempo timeline display
 * 
 * Shows extracted tempo events with confidence indicators,
 * source labels, and support for loading/error/empty states.
 * 
 * Performance: Optimized for rendering 100+ events
 */

import React, { useMemo } from 'react';
import { TempoMap } from '../types';

export interface TempoPreviewProps {
  tempoMap: TempoMap | null;
  isExtracting: boolean;
  extractionError: string | null;
  onTempoOverride?: (measureIndex: number, bpm: number) => void;
}

export const TempoPreview: React.FC<TempoPreviewProps> = ({
  tempoMap,
  isExtracting,
  extractionError,
  onTempoOverride
}) => {
  // Memoize confidence classes for performance
  const getConfidenceClass = useMemo(() => (confidence: number) => {
    if (confidence >= 0.8) return 'confidence-high';
    if (confidence >= 0.5) return 'confidence-medium';
    return 'confidence-low';
  }, []);
  
  const getSourceLabel = (source: string) => {
    switch (source) {
      case 'explicit':
        return 'Explicit';
      case 'metronome':
        return 'Metronome';
      case 'text':
        return 'Text';
      case 'heuristic':
        return 'Heuristic';
      default:
        return source;
    }
  };
  
  // Loading state
  if (isExtracting) {
    return (
      <div className="tempo-preview tempo-preview--loading" role="status">
        <div className="tempo-preview__spinner" aria-hidden="true" />
        <span>Extracting tempo...</span>
      </div>
    );
  }
  
  // Error state
  if (extractionError) {
    return (
      <div className="tempo-preview tempo-preview--error" role="alert">
        <span className="tempo-preview__error-icon" aria-hidden="true">⚠️</span>
        <span>Error: {extractionError}</span>
      </div>
    );
  }
  
  // Empty state
  if (!tempoMap || tempoMap.events.length === 0) {
    return (
      <div className="tempo-preview tempo-preview--empty">
        <span>No tempo information available</span>
      </div>
    );
  }
  
  // Render tempo timeline
  return (
    <div className="tempo-preview" role="region" aria-label="Tempo timeline">
      <div className="tempo-preview__summary">
        <span>Default: {tempoMap.defaultBpm} BPM</span>
        <span>Average: {tempoMap.averageBpm} BPM</span>
        {tempoMap.hasExplicitTempo && <span className="tempo-preview__badge">Explicit</span>}
        {tempoMap.hasTextTempo && <span className="tempo-preview__badge">Text-based</span>}
      </div>
      
      <div className="tempo-preview__timeline">
        {tempoMap.events.map((event, index) => (
          <div
            key={`${event.measureIndex}-${index}`}
            className={`tempo-preview__event ${getConfidenceClass(event.confidence)}`}
            data-measure={event.measureIndex}
          >
            <div className="tempo-preview__measure">
              Measure {event.measureNumber}
            </div>
            <div className="tempo-preview__bpm">
              {event.bpm} BPM
            </div>
            <div className="tempo-preview__metadata">
              <span className="tempo-preview__source">
                {getSourceLabel(event.source)}
              </span>
              <span 
                className="tempo-preview__confidence"
                aria-label={`Confidence: ${Math.round(event.confidence * 100)}%`}
              >
                {event.confidence >= 0.8 ? '●' : event.confidence >= 0.5 ? '◐' : '○'}
              </span>
            </div>
            {onTempoOverride && (
              <button
                className="tempo-preview__override"
                onClick={() => onTempoOverride(event.measureIndex, event.bpm)}
                aria-label={`Override tempo at measure ${event.measureNumber}`}
              >
                Override
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};