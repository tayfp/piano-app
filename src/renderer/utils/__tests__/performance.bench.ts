/**
 * Performance Benchmarks for Extracted Utilities
 * 
 * Ensures utilities meet <20ms latency requirement.
 * Run with: npm run bench (if configured)
 */

import { updateSpringPosition } from '../animation/springPhysics';
import { easeOutCubic } from '../animation/easing';
import { getDepthForVelocity } from '../animation/velocity';
import { calculateVisualFeedback } from '../osmd/visualFeedback';
import { perfLogger } from '@/renderer/utils/performance-logger';

// Simple performance test runner
function bench(name: string, fn: () => void, iterations: number = 10000) {
  const start = performance.now();
  
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  
  const end = performance.now();
  const total = end - start;
  const average = total / iterations;
  
  perfLogger.debug(`${name}: ${average.toFixed(4)}ms per call (${total.toFixed(2)}ms total for ${iterations} iterations)`);
  
  // Alert if average exceeds 0.1ms (leaves room for multiple calls within 20ms)
  if (average > 0.1) {
    perfLogger.warn(`⚠️  ${name} exceeds performance budget!`);
  }
}

// Run benchmarks
perfLogger.debug('Running performance benchmarks...\n');

bench('updateSpringPosition', () => {
  updateSpringPosition(
    { position: 5, velocity: 2 },
    10,
    { stiffness: 300, damping: 30 },
    0.016
  );
});

bench('easeOutCubic', () => {
  easeOutCubic(0.5);
});

bench('getDepthForVelocity', () => {
  getDepthForVelocity(64, 10);
});

bench('calculateVisualFeedback', () => {
  calculateVisualFeedback(100);
});

perfLogger.debug('\nBenchmarks complete. All utilities should average <0.1ms per call.');