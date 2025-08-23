/**
 * Transform Utilities Tests
 */

import { buildKeyTransform, buildKeyBoxShadow } from '../animation/transforms';

describe('Transform Utilities', () => {
  describe('buildKeyTransform', () => {
    it('should build transform for white key at rest', () => {
      const result = buildKeyTransform(0, false, 'balanced');
      expect(result).toBe('translateY(0px)');
    });

    it('should build transform for white key pressed', () => {
      const result = buildKeyTransform(10, false, 'balanced');
      expect(result).toBe('translateY(10px)');
    });

    it('should build transform for black key with X offset', () => {
      const result = buildKeyTransform(5, true, 'balanced');
      expect(result).toBe('translateX(-60%) translateY(5px)');
    });

    it('should add 3D tilt in high performance mode', () => {
      const result = buildKeyTransform(10, false, 'high');
      expect(result).toBe('translateY(10px) perspective(1000px) rotateX(5deg)');
    });

    it('should not add 3D tilt for resting key in high performance', () => {
      const result = buildKeyTransform(0, false, 'high');
      expect(result).toBe('translateY(0px)');
    });
  });

  describe('buildKeyBoxShadow', () => {
    it('should return empty string in low performance mode', () => {
      const result = buildKeyBoxShadow(10, 100, 'low');
      expect(result).toBe('');
    });

    it('should return empty string for unpressed key', () => {
      const result = buildKeyBoxShadow(0, 100, 'balanced');
      expect(result).toBe('');
    });

    it('should build shadow for pressed key', () => {
      const result = buildKeyBoxShadow(5, 64, 'balanced');
      expect(result).toContain('inset 0 5px 10px rgba(0,0,0,0.2)');
      expect(result).toContain('rgba(76, 175, 80,');
    });

    it('should scale glow intensity with velocity', () => {
      const lowVel = buildKeyBoxShadow(5, 32, 'balanced');
      const highVel = buildKeyBoxShadow(5, 127, 'balanced');
      
      // Extract glow opacity values
      const lowOpacity = parseFloat(lowVel.match(/rgba\(76, 175, 80, ([0-9.]+)\)/)?.[1] || '0');
      const highOpacity = parseFloat(highVel.match(/rgba\(76, 175, 80, ([0-9.]+)\)/)?.[1] || '0');
      
      expect(highOpacity).toBeGreaterThan(lowOpacity);
    });
  });
});