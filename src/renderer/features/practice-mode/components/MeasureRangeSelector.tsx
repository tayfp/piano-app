/**
 * MeasureRangeSelector Component
 * 
 * Allows users to define a custom range of measures to practice repeatedly.
 * Features validation, accessibility, and integration with practice store.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { usePracticeStore } from '../stores/practiceStore';
import { isValidMeasureRange, getMeasureRangeError } from '../utils/measureRangeValidation';
import { useOSMDContext } from '@/renderer/contexts/OSMDContext';
import './MeasureRangeSelector.css';

interface MeasureRangeSelectorProps {
  /** Total number of measures in the current score (REQUIRED) */
  totalMeasures: number;
  /** Optional CSS class name for styling */
  className?: string;
}

export const MeasureRangeSelector: React.FC<MeasureRangeSelectorProps> = ({
  totalMeasures,
  className = ''
}) => {
  const { 
    customStartMeasure, 
    customEndMeasure, 
    customRangeActive, 
    setCustomRange, 
    toggleCustomRange,
    hasRepeats 
  } = usePracticeStore();
  
  // Local validation state for UI feedback
  const [errors, setErrors] = useState<{start?: string; end?: string}>({});
  
  // Show disabled state when musical repeats are present
  if (hasRepeats) {
    return (
      <div className={`measure-range-selector measure-range-selector--disabled ${className}`}>
        <div className="disabled-state">
          <span className="disabled-icon">🎼</span>
          <div className="disabled-content">
            <span className="disabled-title">Custom Range Unavailable</span>
            <span className="disabled-reason">
              Musical repeats detected in score. Custom range disabled to prevent conflicts.
            </span>
          </div>
        </div>
      </div>
    );
  }
  
  // Validation logic (real-time feedback)
  const validateRange = useCallback((start: number, end: number) => {
    const newErrors: typeof errors = {};
    
    if (start < 1) {
      newErrors.start = 'Start measure must be at least 1';
    } else if (start > totalMeasures) {
      newErrors.start = `Start measure cannot exceed ${totalMeasures}`;
    }
    
    if (end < 1) {
      newErrors.end = 'End measure must be at least 1';
    } else if (end > totalMeasures) {
      newErrors.end = `End measure cannot exceed ${totalMeasures}`;
    } else if (start > end) {
      newErrors.end = 'End measure must be greater than or equal to start measure';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [totalMeasures]);
  
  const handleStartChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    
    // Handle empty input
    if (value === '') {
      setCustomRange(1, customEndMeasure);
      validateRange(1, customEndMeasure);
      return;
    }
    
    const start = parseInt(value, 10);
    
    // Handle NaN case (per Code review:)
    if (isNaN(start)) {
      return;
    }
    
    // Check MAX_SAFE_INTEGER (per Code review:)
    if (start > Number.MAX_SAFE_INTEGER) {
      return;
    }
    
    if (validateRange(start, customEndMeasure)) {
      setCustomRange(start, customEndMeasure);
    }
  }, [customEndMeasure, setCustomRange, validateRange]);
  
  const handleEndChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    
    // Handle empty input
    if (value === '') {
      setCustomRange(customStartMeasure, 1);
      validateRange(customStartMeasure, 1);
      return;
    }
    
    const end = parseInt(value, 10);
    
    // Handle NaN case (per Code review:)
    if (isNaN(end)) {
      return;
    }
    
    // Check MAX_SAFE_INTEGER (per Code review:)
    if (end > Number.MAX_SAFE_INTEGER) {
      return;
    }
    
    if (validateRange(customStartMeasure, end)) {
      setCustomRange(customStartMeasure, end);
    }
  }, [customStartMeasure, setCustomRange, validateRange]);
  
  const isRangeValid = Object.keys(errors).length === 0 && 
                       isValidMeasureRange(customStartMeasure, customEndMeasure, totalMeasures);
  
  // Get OSMD context for cursor position
  const { controls } = useOSMDContext();
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Helper to get current cursor measure
  const getCurrentCursorMeasure = useCallback((): number => {
    try {
      const currentMeasure = controls?.cursor?.iterator?.currentMeasureIndex;
      return typeof currentMeasure === 'number' ? currentMeasure + 1 : 1; // Convert to 1-based
    } catch {
      return 1;
    }
  }, [controls]);
  
  // Keyboard shortcuts handler (scoped to component)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Only handle shortcuts when component or its children are focused
    if (!containerRef.current?.contains(e.target as Node) && !customRangeActive) {
      return;
    }
    
    // Ctrl+M: Toggle custom range (changed from Ctrl+R per Code review: feedback)
    if (e.ctrlKey && e.key === 'm') {
      e.preventDefault();
      toggleCustomRange();
    }
    
    // Ctrl+1: Set start measure to current cursor position
    if (e.ctrlKey && e.key === '1') {
      e.preventDefault();
      const currentMeasure = getCurrentCursorMeasure();
      if (currentMeasure > 0 && currentMeasure <= totalMeasures) {
        setCustomRange(currentMeasure, Math.max(currentMeasure, customEndMeasure));
      }
    }
    
    // Ctrl+2: Set end measure to current cursor position
    if (e.ctrlKey && e.key === '2') {
      e.preventDefault();
      const currentMeasure = getCurrentCursorMeasure();
      if (currentMeasure > 0 && currentMeasure <= totalMeasures) {
        setCustomRange(Math.min(customStartMeasure, currentMeasure), currentMeasure);
      }
    }
  }, [customRangeActive, customStartMeasure, customEndMeasure, setCustomRange, toggleCustomRange, getCurrentCursorMeasure, totalMeasures]);
  
  // Register keyboard shortcuts with proper cleanup
  useEffect(() => {
    // Add listener to component container for scoped shortcuts
    const container = containerRef.current;
    if (container) {
      container.addEventListener('keydown', handleKeyDown as any);
    }
    
    // Also add to window for when range is active
    if (customRangeActive) {
      window.addEventListener('keydown', handleKeyDown);
    }
    
    // Cleanup function to prevent memory leaks (per Code review: critical feedback)
    return () => {
      if (container) {
        container.removeEventListener('keydown', handleKeyDown as any);
      }
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown, customRangeActive]);
  
  return (
    <div 
      ref={containerRef}
      className={`measure-range-selector ${className}`}
      aria-label="Practice measure range selector"
      role="region"
      tabIndex={0} // Make focusable for keyboard shortcuts
    >
      <label className="measure-range__label">Practice Range:</label>
      
      <div className="measure-range__inputs">
        <div className="measure-input-group">
          <span className="measure-prefix">SM:</span>
          <input 
            type="number"
            min="1"
            max={totalMeasures}
            value={customStartMeasure}
            onChange={handleStartChange}
            className={`measure-input ${errors.start ? 'error' : ''}`}
            aria-label="Start measure"
            aria-describedby={errors.start ? 'start-error' : 'start-description'}
            aria-invalid={!!errors.start}
          />
          {errors.start && (
            <span id="start-error" className="error-text" role="alert">
              {errors.start}
            </span>
          )}
          <span id="start-description" className="visually-hidden">
            Enter the first measure to practice, between 1 and {totalMeasures}
          </span>
        </div>
        
        <span className="measure-range__separator">|</span>
        
        <div className="measure-input-group">
          <span className="measure-prefix">EM:</span>
          <input 
            type="number"
            min="1"
            max={totalMeasures}
            value={customEndMeasure}
            onChange={handleEndChange}
            className={`measure-input ${errors.end ? 'error' : ''}`}
            aria-label="End measure"
            aria-describedby={errors.end ? 'end-error' : 'end-description'}
            aria-invalid={!!errors.end}
          />
          {errors.end && (
            <span id="end-error" className="error-text" role="alert">
              {errors.end}
            </span>
          )}
          <span id="end-description" className="visually-hidden">
            Enter the last measure to practice, between 1 and {totalMeasures}
          </span>
        </div>
      </div>
      
      <button 
        className={`range-toggle ${customRangeActive ? 'active' : ''}`}
        onClick={toggleCustomRange}
        disabled={!isRangeValid}
        aria-pressed={customRangeActive}
        aria-label={customRangeActive ? 'Disable custom measure range' : 'Enable custom measure range'}
      >
        {customRangeActive ? 'Disable Range' : 'Enable Range'}
      </button>
      
      {/* Keyboard shortcut hints */}
      <div className="keyboard-hints" aria-label="Keyboard shortcuts">
        <span className="hint">Ctrl+M: Toggle range</span>
        <span className="hint">Ctrl+1/2: Set start/end to cursor</span>
      </div>
    </div>
  );
};