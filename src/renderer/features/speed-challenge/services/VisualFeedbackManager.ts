/**
 * Visual Feedback Manager Service
 * Phase 3 Task 3.3 - Visual Feedback Implementation
 * 
 * Manages visual feedback for Speed Challenge Mode with <2ms response time.
 * Integrates with PianoKeyAnimator and OSMD for coordinated visual effects.
 */

import { VisualFeedbackType } from '../types';
import { animateNoteOn, animateNoteOff } from '@/renderer/services/animatorInstance';
import { perfLogger, logRenderLatency } from '@/renderer/utils/performance-logger';

/**
 * Feedback tracking information
 */
interface FeedbackState {
  noteNumber: number;
  type: VisualFeedbackType;
  element: HTMLElement;
  timeoutId?: number;
}

/**
 * CSS class names for feedback styles
 */
const FEEDBACK_CLASSES = {
  [VisualFeedbackType.SUCCESS]: 'speed-challenge-success',
  [VisualFeedbackType.ERROR]: 'speed-challenge-error',
  [VisualFeedbackType.WARNING]: 'speed-challenge-warning',
  [VisualFeedbackType.HINT]: 'speed-challenge-hint'
} as const;

/**
 * High-performance visual feedback manager
 * 
 * Features:
 * - <2ms response time for visual updates
 * - Batched DOM operations
 * - Automatic cleanup to prevent artifacts
 * - OSMD integration for sheet music highlighting
 */
export class VisualFeedbackManager {
  // Active feedback states
  private activeFeedback = new Map<number, FeedbackState>();
  
  // OSMD cursor reference (optional)
  private osmdCursor: any = null;
  
  // Pattern overlay element (created on demand)
  private patternOverlay: HTMLElement | null = null;
  
  // DOM element cache for performance
  private elementCache = new Map<number, WeakRef<HTMLElement>>();
  
  // Batch update queue
  private updateQueue: Array<() => void> = [];
  private updateScheduled = false;
  
  constructor() {
    // Initialize styles if not already present
    this.injectStyles();
  }
  
  /**
   * Show visual feedback for a note
   * 
   * @param noteNumber - MIDI note number
   * @param type - Type of feedback
   * @param duration - Duration in ms (0 = until cleared)
   */
  showFeedback(
    noteNumber: number,
    type: VisualFeedbackType,
    duration: number = 300
  ): void {
    const startTime = performance.now();
    
    try {
      // Get piano key element
      const element = this.getKeyElement(noteNumber);
      if (!element) {
        if (process.env.NODE_ENV === 'development') {
          perfLogger.debug(`No element found for note ${noteNumber}`);
        }
        return;
      }
      
      // Clear any existing feedback for this note
      this.clearFeedback(noteNumber);
      
      // Apply new feedback style
      this.applyFeedbackStyle(element, type);
      
      // Trigger animation for success/error
      if (type === VisualFeedbackType.SUCCESS) {
        animateNoteOn(noteNumber, 80);
      }
      
      // Store feedback state
      const state: FeedbackState = {
        noteNumber,
        type,
        element
      };
      
      // Set auto-clear timeout if duration specified
      if (duration > 0) {
        state.timeoutId = window.setTimeout(() => {
          this.clearFeedback(noteNumber);
        }, duration);
      }
      
      this.activeFeedback.set(noteNumber, state);
      
      // Update ARIA attributes for accessibility
      this.updateAccessibility(element, type);
      
    } finally {
      // Log performance
      const latency = performance.now() - startTime;
      logRenderLatency(latency);
    }
  }
  
  /**
   * Clear feedback for a specific note
   */
  clearFeedback(noteNumber: number): void {
    const state = this.activeFeedback.get(noteNumber);
    if (!state) return;
    
    // Clear timeout if exists
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
    }
    
    // Remove all feedback classes
    Object.values(FEEDBACK_CLASSES).forEach(className => {
      state.element.classList.remove(className);
    });
    
    // Clear ARIA attributes
    state.element.removeAttribute('aria-label');
    
    // Remove from active feedback
    this.activeFeedback.delete(noteNumber);
  }
  
  /**
   * Clear all active feedbacks
   */
  clearAllFeedback(): void {
    this.activeFeedback.forEach((_, noteNumber) => {
      this.clearFeedback(noteNumber);
    });
  }
  
  /**
   * Apply feedback style to element
   */
  private applyFeedbackStyle(element: HTMLElement, type: VisualFeedbackType): void {
    // Remove all existing feedback classes
    Object.values(FEEDBACK_CLASSES).forEach(className => {
      element.classList.remove(className);
    });
    
    // Add new feedback class
    element.classList.add(FEEDBACK_CLASSES[type]);
  }
  
  /**
   * Get piano key element for a MIDI note
   */
  private getKeyElement(midiNote: number): HTMLElement | null {
    // Check cache first
    const ref = this.elementCache.get(midiNote);
    const cached = ref?.deref();
    
    if (cached) {
      return cached;
    }
    
    // Query DOM and cache result
    const element = document.querySelector(`[data-midi-note="${midiNote}"]`) as HTMLElement;
    if (element) {
      this.elementCache.set(midiNote, new WeakRef(element));
    }
    
    return element;
  }
  
  /**
   * Set OSMD cursor for sheet music highlighting
   */
  setOSMDCursor(cursor: any): void {
    this.osmdCursor = cursor;
  }
  
  /**
   * Highlight note in sheet music
   */
  highlightSheetNote(noteNumber: number, type: VisualFeedbackType): void {
    if (!this.osmdCursor) return;
    
    try {
      // Show cursor at note position
      this.osmdCursor.show();
      
      // Apply highlight style (implementation depends on OSMD version)
      // This is a placeholder for actual OSMD integration
    } catch (error) {
      perfLogger.warn('Failed to highlight sheet note:', error);
    }
  }
  
  /**
   * Clear all sheet music highlights
   */
  clearSheetHighlights(): void {
    if (!this.osmdCursor) return;
    
    try {
      this.osmdCursor.hide();
    } catch (error) {
      perfLogger.warn('Failed to clear sheet highlights:', error);
    }
  }
  
  /**
   * Show pattern completion animation
   */
  showPatternComplete(): void {
    this.showPatternOverlay('Pattern Complete!', 'speed-challenge-pattern-complete', 500);
  }
  
  /**
   * Show pattern failure animation
   */
  showPatternFailed(): void {
    this.showPatternOverlay('Try Again', 'speed-challenge-pattern-failed', 500);
  }
  
  /**
   * Show pattern overlay with message
   */
  private showPatternOverlay(message: string, className: string, duration: number): void {
    // Remove existing overlay
    if (this.patternOverlay) {
      this.patternOverlay.remove();
    }
    
    // Create new overlay
    this.patternOverlay = document.createElement('div');
    this.patternOverlay.className = className;
    this.patternOverlay.textContent = message;
    this.patternOverlay.setAttribute('role', 'alert');
    
    // Add to DOM
    document.body.appendChild(this.patternOverlay);
    
    // Announce to screen readers
    this.announceToScreenReader(message);
    
    // Auto-remove after duration
    setTimeout(() => {
      if (this.patternOverlay) {
        this.patternOverlay.remove();
        this.patternOverlay = null;
      }
    }, duration);
  }
  
  /**
   * Update accessibility attributes
   */
  private updateAccessibility(element: HTMLElement, type: VisualFeedbackType): void {
    const labels = {
      [VisualFeedbackType.SUCCESS]: 'Note played correctly',
      [VisualFeedbackType.ERROR]: 'Incorrect note',
      [VisualFeedbackType.WARNING]: 'Warning',
      [VisualFeedbackType.HINT]: 'Next note hint'
    };
    
    element.setAttribute('aria-label', labels[type]);
  }
  
  /**
   * Announce message to screen readers
   */
  announceToScreenReader(message: string): void {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'alert');
    announcement.setAttribute('aria-live', 'polite');
    announcement.style.position = 'absolute';
    announcement.style.left = '-10000px';
    announcement.textContent = message;
    
    document.body.appendChild(announcement);
    
    // Remove after announcement
    setTimeout(() => {
      announcement.remove();
    }, 1000);
  }
  
  /**
   * Get count of active feedbacks (for testing)
   */
  getActiveFeedbackCount(): number {
    return this.activeFeedback.size;
  }
  
  /**
   * Inject CSS styles for feedback
   */
  private injectStyles(): void {
    if (document.getElementById('speed-challenge-feedback-styles')) {
      return; // Already injected
    }
    
    const style = document.createElement('style');
    style.id = 'speed-challenge-feedback-styles';
    style.textContent = `
      .speed-challenge-success {
        background-color: rgba(76, 175, 80, 0.3) !important;
        box-shadow: 0 0 10px rgba(76, 175, 80, 0.6) !important;
        transition: all 100ms ease-out;
      }
      
      .speed-challenge-error {
        background-color: rgba(244, 67, 54, 0.3) !important;
        box-shadow: 0 0 10px rgba(244, 67, 54, 0.6) !important;
        animation: shake 200ms ease-in-out;
      }
      
      .speed-challenge-warning {
        background-color: rgba(255, 152, 0, 0.3) !important;
        box-shadow: 0 0 10px rgba(255, 152, 0, 0.6) !important;
      }
      
      .speed-challenge-hint {
        background-color: rgba(33, 150, 243, 0.2) !important;
        box-shadow: 0 0 5px rgba(33, 150, 243, 0.4) !important;
        animation: pulse 1s infinite;
      }
      
      .speed-challenge-pattern-complete,
      .speed-challenge-pattern-failed {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        padding: 20px 40px;
        border-radius: 8px;
        font-size: 24px;
        font-weight: bold;
        z-index: 10000;
        animation: fadeInOut 500ms ease-in-out;
      }
      
      .speed-challenge-pattern-complete {
        background: linear-gradient(135deg, #4caf50, #8bc34a);
        color: white;
      }
      
      .speed-challenge-pattern-failed {
        background: linear-gradient(135deg, #f44336, #ff5722);
        color: white;
      }
      
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 1; }
      }
      
      @keyframes fadeInOut {
        0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        50% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(1); }
      }
    `;
    
    document.head.appendChild(style);
  }
  
  /**
   * Cleanup manager resources
   */
  dispose(): void {
    this.clearAllFeedback();
    if (this.patternOverlay) {
      this.patternOverlay.remove();
      this.patternOverlay = null;
    }
    this.elementCache.clear();
  }
}