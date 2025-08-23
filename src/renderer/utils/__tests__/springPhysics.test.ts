/**
 * Spring Physics Tests
 * 
 * Validates spring calculations for correctness and performance.
 */

import { updateSpringPosition, calculateCriticalDamping, isSpringSettled } from '../animation/springPhysics';

describe('springPhysics', () => {
  describe('updateSpringPosition', () => {
    it('should move towards target with proper physics', () => {
      const initial = { position: 0, velocity: 0 };
      const config = { stiffness: 300, damping: 30 };
      
      const result = updateSpringPosition(initial, 10, config, 0.016);
      
      // Should move towards target
      expect(result.position).toBeGreaterThan(0);
      expect(result.position).toBeLessThan(10);
      
      // Should have positive velocity
      expect(result.velocity).toBeGreaterThan(0);
    });
    
    it('should snap to target when very close', () => {
      const nearTarget = { position: 9.99, velocity: 0.05 };
      const config = { stiffness: 300, damping: 30 };
      
      const result = updateSpringPosition(nearTarget, 10, config, 0.016);
      
      expect(result.position).toBe(10);
      expect(result.velocity).toBe(0);
    });
    
    it('should handle negative displacement', () => {
      const initial = { position: 10, velocity: 0 };
      const config = { stiffness: 300, damping: 30 };
      
      const result = updateSpringPosition(initial, 0, config, 0.016);
      
      expect(result.position).toBeLessThan(10);
      expect(result.velocity).toBeLessThan(0);
    });
    
    it('should cap dt for stability', () => {
      const initial = { position: 0, velocity: 0 };
      const config = { stiffness: 300, damping: 30 };
      
      // Large dt should be capped
      const result1 = updateSpringPosition(initial, 10, config, 1.0);
      const result2 = updateSpringPosition(initial, 10, config, 0.016);
      
      // Results should be identical due to capping
      expect(result1.position).toBe(result2.position);
      expect(result1.velocity).toBe(result2.velocity);
    });
  });
  
  describe('calculateCriticalDamping', () => {
    it('should calculate correct damping coefficient', () => {
      const stiffness = 300;
      const damping = calculateCriticalDamping(stiffness);
      
      // Critical damping = 2 * sqrt(k * m)
      // With mass = 1: 2 * sqrt(300) ≈ 34.64
      expect(damping).toBeCloseTo(34.64, 2);
    });
    
    it('should scale with mass', () => {
      const stiffness = 300;
      const mass = 2;
      const damping = calculateCriticalDamping(stiffness, mass);
      
      // 2 * sqrt(300 * 2) ≈ 48.99
      expect(damping).toBeCloseTo(48.99, 2);
    });
  });
  
  describe('isSpringSettled', () => {
    it('should detect settled spring', () => {
      const settled = { position: 9.995, velocity: 0.05 };
      expect(isSpringSettled(settled, 10)).toBe(true);
    });
    
    it('should detect unsettled spring by position', () => {
      const farAway = { position: 5, velocity: 0 };
      expect(isSpringSettled(farAway, 10)).toBe(false);
    });
    
    it('should detect unsettled spring by velocity', () => {
      const fastMoving = { position: 9.99, velocity: 5 };
      expect(isSpringSettled(fastMoving, 10)).toBe(false);
    });
    
    it('should respect custom tolerances', () => {
      const state = { position: 9.9, velocity: 0.2 };
      
      // Should be settled with loose tolerances
      expect(isSpringSettled(state, 10, 0.2, 0.3)).toBe(true);
      
      // Should not be settled with tight tolerances
      expect(isSpringSettled(state, 10, 0.05, 0.1)).toBe(false);
    });
  });
});