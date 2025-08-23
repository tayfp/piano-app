/**
 * PianoKeyAnimator - Advanced animation system for realistic piano key motion
 * 
 * Features:
 * - RequestAnimationFrame-based for smooth, interruptible animations
 * - Physics-based spring motion for natural feel
 * - Downward key press (like real pianos)
 * - Smooth fade-in effects
 * - Performance-optimized for 88 concurrent keys
 */

import { easeOutCubic } from '@/renderer/utils/animation/easing';
import { updateSpringPosition, type SpringState } from '@/renderer/utils/animation/springPhysics';
import { getDepthForVelocity } from '@/renderer/utils/animation/velocity';
import { buildKeyTransform, buildKeyBoxShadow } from '@/renderer/utils/animation/transforms';
import { perfLogger } from '@/renderer/utils/performance-logger';

export interface KeyAnimationState {
  state: 'idle' | 'pressing' | 'releasing' | 'held';
  startTime: number;
  currentY: number;
  targetY: number;
  currentOpacity: number;
  targetOpacity: number;
  velocity: number;
  springVelocity: number;
  element: HTMLElement | null;
}

export type PerformanceMode = 'high' | 'medium' | 'low';

export class PianoKeyAnimator {
  private keyStates = new Map<number, KeyAnimationState>();
  private animationId: number | null = null;
  private performanceMode: PerformanceMode;
  private practiceHighlights = new Map<number, string>(); // note -> highlight type
  
  // Animation constants
  private readonly SPRING_STIFFNESS = 300;
  private readonly SPRING_DAMPING = 30;
  private readonly FADE_IN_DURATION = 200; // ms for opacity fade
  private readonly PRESS_DURATION = 100;   // ms for key motion
  private readonly RELEASE_DURATION = 80;  // ms for release
  
  // Depth constants based on key type
  private readonly WHITE_KEY_DEPTH = 2;    // px
  private readonly BLACK_KEY_DEPTH = 1.5;  // px
  
  constructor(performanceMode?: PerformanceMode) {
    this.performanceMode = performanceMode || this.detectPerformanceMode();
  }
  
  /**
   * Trigger key press animation
   */
  noteOn(midiNote: number, velocity: number): void {
    const element = this.getKeyElement(midiNote);
    if (!element) {
      perfLogger.warn(`PianoKeyAnimator: No element found for MIDI note ${midiNote}`);
      return;
    }
    
    // Get current state or create new
    const currentState = this.keyStates.get(midiNote);
    const isBlackKey = element.classList.contains('piano-key--black');
    const maxDepth = isBlackKey ? this.BLACK_KEY_DEPTH : this.WHITE_KEY_DEPTH;
    
    // Calculate target depth based on velocity
    const targetY = getDepthForVelocity(velocity, maxDepth);
    
    // Enable hardware acceleration hints
    if (this.performanceMode !== 'low') {
      element.style.willChange = 'transform, box-shadow';
    }
    
    this.keyStates.set(midiNote, {
      state: 'pressing',
      startTime: performance.now(),
      currentY: currentState?.currentY || 0,
      targetY,
      currentOpacity: 1, // Keep at 1 - we don't animate key opacity anymore
      targetOpacity: 1, // CSS pseudo-element handles highlight
      velocity,
      springVelocity: 0,
      element
    });
    
    this.startAnimation();
  }
  
  /**
   * Trigger key release animation
   */
  noteOff(midiNote: number): void {
    const state = this.keyStates.get(midiNote);
    if (!state || !state.element) return;
    
    // Transition to releasing state
    state.state = 'releasing';
    state.startTime = performance.now();
    state.targetY = 0;
    // Don't change opacity - CSS handles highlight fade
    state.targetOpacity = 1;
    
    this.startAnimation();
  }
  
  /**
   * Reset all key animations
   */
  resetAll(): void {
    // Clean up all animations
    this.keyStates.forEach((state, note) => {
      if (state.element) {
        // Reset to default styles
        const isBlackKey = state.element.classList.contains('piano-key--black');
        if (isBlackKey) {
          // Black keys need to maintain their X offset
          state.element.style.transform = 'translateX(-60%)';
        } else {
          state.element.style.transform = '';
        }
        // Don't reset opacity - let it stay at default
        state.element.style.boxShadow = '';
        state.element.style.willChange = 'auto';
      }
    });
    
    this.keyStates.clear();
    
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
  
  /**
   * Main animation loop
   */
  private animate = (currentTime: number): void => {
    try {
      let hasActiveAnimations = false;
      const updates: Array<{
        element: HTMLElement;
        transform: string;
        opacity: string;
        boxShadow: string;
      }> = [];
      
      this.keyStates.forEach((state, note) => {
        if (!state.element || state.state === 'idle') return;
      
      const elapsed = currentTime - state.startTime;
      const isBlackKey = state.element.classList.contains('piano-key--black');
      
      // Update position with spring physics
      if (this.performanceMode === 'high') {
        this.updateSpringPhysics(state, elapsed);
      } else {
        // Simple easing for lower performance modes
        this.updateSimpleEasing(state, elapsed);
      }
      
      // Don't update opacity - CSS handles it through pseudo-element
      // Keep opacity at 1 for the key element
      state.currentOpacity = 1;
      
      // Check if animation is complete (only position matters now)
      const positionSettled = Math.abs(state.targetY - state.currentY) < 0.01;
      
      if (!positionSettled) {
        hasActiveAnimations = true;
        
        // Build transform string
        const transform = this.buildTransform(state, isBlackKey);
        const boxShadow = this.buildBoxShadow(state);
        
        // Don't set opacity - let CSS handle it
        updates.push({ element: state.element, transform, opacity: '', boxShadow });
      } else {
        // Animation complete
        if (state.state === 'releasing') {
          // Clean up after release - RESET STYLES TO DEFAULTS
          if (isBlackKey) {
            // Black keys need to maintain their X offset
            state.element.style.transform = 'translateX(-60%)';
          } else {
            state.element.style.transform = '';
          }
          // Don't reset opacity - CSS handles highlight through pseudo-element
          state.element.style.boxShadow = '';
          state.element.style.willChange = 'auto';
          this.keyStates.delete(note);
        } else if (state.state === 'pressing') {
          // Transition to held state
          state.state = 'held';
        }
      }
    });
    
    // Batch DOM updates for performance
    updates.forEach(({ element, transform, opacity, boxShadow }) => {
      element.style.transform = transform;
      // Don't set opacity - CSS pseudo-element handles highlight
      if (opacity !== '') {
        element.style.opacity = opacity;
      }
      element.style.boxShadow = boxShadow;
    });
    
    if (hasActiveAnimations) {
      this.animationId = requestAnimationFrame(this.animate);
    } else {
      this.animationId = null;
    }
    } catch (error) {
      perfLogger.error('PianoKeyAnimator: Error in animation loop:', error);
      // Stop animation on error to prevent infinite loop
      this.animationId = null;
    }
  };
  
  /**
   * Update position using spring physics
   */
  private updateSpringPhysics(state: KeyAnimationState, elapsed: number): void {
    const dt = elapsed / 1000; // Convert to seconds
    
    // Use extracted spring physics utility
    const springState: SpringState = {
      position: state.currentY,
      velocity: state.springVelocity
    };
    
    const newState = updateSpringPosition(
      springState,
      state.targetY,
      { stiffness: this.SPRING_STIFFNESS, damping: this.SPRING_DAMPING },
      dt
    );
    
    state.currentY = newState.position;
    state.springVelocity = newState.velocity;
  }
  
  /**
   * Update position using simple easing
   */
  private updateSimpleEasing(state: KeyAnimationState, elapsed: number): void {
    const duration = state.state === 'pressing' ? this.PRESS_DURATION : this.RELEASE_DURATION;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);
    
    state.currentY = state.currentY + (state.targetY - state.currentY) * eased;
  }
  
  
  /**
   * Build transform string based on key state
   */
  private buildTransform(state: KeyAnimationState, isBlackKey: boolean): string {
    return buildKeyTransform(state.currentY, isBlackKey, this.performanceMode);
  }
  
  /**
   * Build box shadow for depth effect
   */
  private buildBoxShadow(state: KeyAnimationState): string {
    return buildKeyBoxShadow(state.currentY, state.velocity, this.performanceMode);
  }
  
  
  /**
   * Get DOM element for a MIDI note
   */
  private getKeyElement(midiNote: number): HTMLElement | null {
    return document.querySelector(`[data-midi-note="${midiNote}"]`);
  }
  
  
  /**
   * Start animation loop if not running
   */
  private startAnimation(): void {
    if (!this.animationId) {
      this.animationId = requestAnimationFrame(this.animate);
    }
  }
  
  /**
   * Detect device performance capabilities
   */
  private detectPerformanceMode(): PerformanceMode {
    try {
      // Check for reduced motion preference
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return 'low';
      }
      
      // Simple performance test
      const testStart = performance.now();
      const testElement = document.createElement('div');
      testElement.style.transform = 'translateY(10px)';
      
      // Only append if document.body exists
      if (!document.body) {
        perfLogger.warn('PianoKeyAnimator: document.body not available, defaulting to medium performance');
        return 'medium';
      }
      
      document.body.appendChild(testElement);
      
      // Force reflow
      testElement.offsetHeight;
      
      // Measure
      const testDuration = performance.now() - testStart;
      document.body.removeChild(testElement);
      
      // Categorize based on test
      if (testDuration < 1) return 'high';
      if (testDuration < 3) return 'medium';
      return 'low';
    } catch (error) {
      perfLogger.warn('PianoKeyAnimator: Error detecting performance mode, defaulting to medium', error);
      return 'medium';
    }
  }

  /**
   * Practice Mode Methods
   */
  
  /**
   * Set practice highlight for a key
   * @deprecated Use usePianoStore.setPracticeHighlight() instead for unified state management
   */
  setPracticeHighlight(midiNote: number, type: 'expected' | 'correct' | 'incorrect'): void {
    const element = this.getKeyElement(midiNote);
    if (!element) return;
    
    // Remove previous practice classes
    element.classList.remove('piano-key--practice-expected', 'piano-key--practice-correct', 'piano-key--practice-incorrect');
    
    // Add new practice class
    element.classList.add(`piano-key--practice-${type}`);
    
    // Track highlight state
    this.practiceHighlights.set(midiNote, type);
  }
  
  /**
   * Clear all practice highlights
   * @deprecated Use usePianoStore.clearAllPracticeHighlights() instead for unified state management
   */
  clearPracticeHighlights(): void {
    this.practiceHighlights.forEach((type, midiNote) => {
      const element = this.getKeyElement(midiNote);
      if (element) {
        element.classList.remove('piano-key--practice-expected', 'piano-key--practice-correct', 'piano-key--practice-incorrect');
      }
    });
    this.practiceHighlights.clear();
  }
  
  /**
   * Enhanced practice highlight with hand and options support
   * @deprecated Use usePianoStore.setPracticeHighlight() instead for unified state management
   */
  setPracticeHighlightEnhanced(midiNote: number, type: 'expected' | 'correct' | 'incorrect', hand?: 'left' | 'right', options?: { opacity?: number; intensity?: number }): void {
    const element = this.getKeyElement(midiNote);
    if (!element) return;
    
    // Remove previous practice classes
    element.classList.remove(
      'piano-key--practice-expected', 
      'piano-key--practice-correct', 
      'piano-key--practice-incorrect',
      'piano-key--hand-left',
      'piano-key--hand-right'
    );
    
    // Add type class
    element.classList.add(`piano-key--practice-${type}`);
    
    // Add hand class if specified
    if (hand) {
      element.classList.add(`piano-key--hand-${hand}`);
    }
    
    // Apply custom options
    if (options?.opacity !== undefined) {
      element.style.setProperty('--practice-opacity', options.opacity.toString());
    }
    
    if (options?.intensity !== undefined) {
      element.style.setProperty('--practice-intensity', options.intensity.toString());
    }
    
    // Track highlight state
    this.practiceHighlights.set(midiNote, type);
  }

  /**
   * Clear enhanced practice highlights  
   * @deprecated Use usePianoStore.clearAllPracticeHighlights() instead for unified state management
   */
  clearPracticeHighlightsEnhanced(): void {
    this.practiceHighlights.forEach((type, midiNote) => {
      const element = this.getKeyElement(midiNote);
      if (element) {
        element.classList.remove(
          'piano-key--practice-expected', 
          'piano-key--practice-correct', 
          'piano-key--practice-incorrect',
          'piano-key--hand-left',
          'piano-key--hand-right'
        );
        element.style.removeProperty('--practice-opacity');
        element.style.removeProperty('--practice-intensity');
      }
    });
    this.practiceHighlights.clear();
  }

  /**
   * Additional helper methods for tests
   */
  highlightKey(midiNote: number, velocity: number): void {
    // Alias for noteOn to match test expectations
    this.noteOn(midiNote, velocity);
  }
  
  unhighlightKey(midiNote: number): void {
    // Alias for noteOff to match test expectations
    this.noteOff(midiNote);
  }
}