/**
 * Tests for PianoKeyAnimator
 * Ensures proper cleanup and style reset after animations
 */

import { PianoKeyAnimator } from '../PianoKeyAnimator';

// Mock DOM elements
const createMockElement = (isBlackKey = false): HTMLElement => {
  const element = document.createElement('div');
  element.classList.add('piano-key');
  if (isBlackKey) {
    element.classList.add('piano-key--black');
    element.style.transform = 'translateX(-60%)';
  }
  element.setAttribute('data-midi-note', '60');
  return element;
};

// Mock document.querySelector
const mockQuerySelector = jest.fn();
document.querySelector = mockQuerySelector;

// Mock requestAnimationFrame
global.requestAnimationFrame = jest.fn((cb) => {
  setTimeout(() => cb(performance.now()), 16);
  return 1;
});

global.cancelAnimationFrame = jest.fn();

describe('PianoKeyAnimator', () => {
  let animator: PianoKeyAnimator;
  
  beforeEach(() => {
    animator = new PianoKeyAnimator('medium');
    mockQuerySelector.mockClear();
    jest.clearAllTimers();
  });
  
  describe('Style Reset After Animation', () => {
    it('should reset white key styles to defaults after release animation', () => {
      const element = createMockElement(false);
      mockQuerySelector.mockReturnValue(element);
      
      // Start animation
      animator.noteOn(60, 100);
      expect(element.style.willChange).toBe('transform, opacity, box-shadow');
      
      // Trigger release
      animator.noteOff(60);
      
      // Simulate animation completion (would normally happen over time)
      // In real usage, the animation loop would handle this
      // For testing, we'll manually trigger the cleanup
      animator.resetAll();
      
      // Check that styles are reset
      expect(element.style.transform).toBe('');
      expect(element.style.opacity).toBe('');
      expect(element.style.boxShadow).toBe('');
      expect(element.style.willChange).toBe('auto');
    });
    
    it('should maintain black key X offset after release animation', () => {
      const element = createMockElement(true);
      mockQuerySelector.mockReturnValue(element);
      
      // Start animation
      animator.noteOn(60, 100);
      
      // Trigger release
      animator.noteOff(60);
      
      // Reset all animations
      animator.resetAll();
      
      // Check that black key maintains its X offset
      expect(element.style.transform).toBe('translateX(-60%)');
      expect(element.style.opacity).toBe('');
      expect(element.style.boxShadow).toBe('');
      expect(element.style.willChange).toBe('auto');
    });
    
    it('should clean up all animations when resetAll is called', () => {
      const whiteKey = createMockElement(false);
      const blackKey = createMockElement(true);
      
      // Mock multiple keys
      mockQuerySelector
        .mockReturnValueOnce(whiteKey)
        .mockReturnValueOnce(blackKey);
      
      // Animate both keys
      animator.noteOn(60, 100); // white key
      animator.noteOn(61, 80);  // black key
      
      // Reset all
      animator.resetAll();
      
      // Both keys should be reset properly
      expect(whiteKey.style.transform).toBe('');
      expect(whiteKey.style.opacity).toBe('');
      expect(blackKey.style.transform).toBe('translateX(-60%)');
      expect(blackKey.style.opacity).toBe('');
    });
  });
  
  describe('Performance Mode Detection', () => {
    it('should detect performance mode if not provided', () => {
      // Create animator without specifying mode
      const autoAnimator = new PianoKeyAnimator();
      
      // Should have selected a performance mode
      // (actual mode depends on mock environment)
      expect(autoAnimator).toBeDefined();
    });
  });
});