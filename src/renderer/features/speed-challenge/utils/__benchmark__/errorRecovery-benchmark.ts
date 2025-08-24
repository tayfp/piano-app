/**
 * Error Recovery Performance Benchmark
 * 
 * Measures current performance bottlenecks in errorRecovery.ts to establish
 * baseline metrics before optimization. Critical for validating 18-22ms → <5ms target.
 */

import { performance } from 'perf_hooks';
import { recoverFromError, classifyError, ErrorCategory, ErrorSeverity } from '../errorRecovery';
import { perfLogger } from '@/renderer/utils/performance-logger';

// ============================================================================
// BENCHMARK CONFIGURATION
// ============================================================================

const BENCHMARK_ITERATIONS = 1000;
const WARMUP_ITERATIONS = 100;
const PERFORMANCE_TARGET_MS = 5;
const CRITICAL_THRESHOLD_MS = 10;
const CURRENT_BASELINE_MS = 20; // Expected current performance

// ============================================================================
// TEST ERROR SCENARIOS
// ============================================================================

const testErrors = {
  patternGeneration: new Error('pattern generation failed: template not found'),
  midiConnection: new Error('midi device connection lost: input not available'),
  validation: new Error('validation error: note comparison failed'),
  visualFeedback: new Error('visual feedback animation error: highlight failed'),
  osmdRendering: new Error('osmd render error: sheet music display failed'),
  storeState: new Error('store state error: zustand update failed'),
  memoryPressure: new Error('memory allocation error: heap exhausted'),
  performanceDegradation: new Error('performance latency detected: >25ms'),
  criticalError: new Error('critical fatal error: maximum call stack exceeded'),
  unknown: new Error('unexpected runtime error')
};

const testContexts = {
  memoryPressure: { memoryUsage: 60 * 1024 * 1024 }, // 60MB
  performanceDegradation: { latency: 30 }, // 30ms
  normal: { someData: 'test' },
  empty: {}
};

// ============================================================================
// BENCHMARK UTILITIES
// ============================================================================

interface BenchmarkResult {
  operation: string;
  averageMs: number;
  minMs: number;
  maxMs: number;
  medianMs: number;
  p95Ms: number;
  iterations: number;
  totalTimeMs: number;
  passesTarget: boolean;
  passesCritical: boolean;
}

interface DetailedBenchmarkResults {
  classifyError: BenchmarkResult;
  recoverPatternGeneration: BenchmarkResult;
  recoverMidiConnection: BenchmarkResult;
  recoverMemoryPressure: BenchmarkResult;
  recoverPerformanceDegradation: BenchmarkResult;
  fullRecoveryPipeline: BenchmarkResult;
  summary: {
    totalTimeMs: number;
    criticalBottlenecks: string[];
    recommendedOptimizations: string[];
  };
}

/**
 * Run benchmark for a specific function with timing measurements
 */
async function benchmarkFunction<T>(
  name: string,
  fn: () => T | Promise<T>,
  iterations: number = BENCHMARK_ITERATIONS
): Promise<BenchmarkResult> {
  const timings: number[] = [];
  
  // Warmup phase
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    await fn();
  }
  
  // Force garbage collection if available
  if (typeof global !== 'undefined' && global.gc) {
    global.gc();
  }
  
  console.log(`Benchmarking ${name}...`);
  
  // Actual benchmark
  const startTotal = performance.now();
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    timings.push(end - start);
  }
  
  const endTotal = performance.now();
  const totalTime = endTotal - startTotal;
  
  // Calculate statistics
  timings.sort((a, b) => a - b);
  const averageMs = timings.reduce((sum, time) => sum + time, 0) / timings.length;
  const minMs = timings[0];
  const maxMs = timings[timings.length - 1];
  const medianMs = timings[Math.floor(timings.length / 2)];
  const p95Ms = timings[Math.floor(timings.length * 0.95)];
  
  return {
    operation: name,
    averageMs,
    minMs,
    maxMs,
    medianMs,
    p95Ms,
    iterations,
    totalTimeMs: totalTime,
    passesTarget: averageMs <= PERFORMANCE_TARGET_MS,
    passesCritical: averageMs <= CRITICAL_THRESHOLD_MS
  };
}

// ============================================================================
// SPECIFIC BENCHMARKS
// ============================================================================

/**
 * Benchmark error classification performance
 */
async function benchmarkClassifyError(): Promise<BenchmarkResult> {
  const errors = Object.values(testErrors);
  const contexts = Object.values(testContexts);
  let errorIndex = 0;
  let contextIndex = 0;
  
  return benchmarkFunction('Error Classification', () => {
    const error = errors[errorIndex % errors.length];
    const context = contexts[contextIndex % contexts.length];
    errorIndex++;
    contextIndex++;
    
    return classifyError(error, context);
  });
}

/**
 * Benchmark full recovery pipeline performance
 */
async function benchmarkFullRecovery(): Promise<BenchmarkResult> {
  const errors = Object.values(testErrors);
  const contexts = Object.values(testContexts);
  let errorIndex = 0;
  let contextIndex = 0;
  
  return benchmarkFunction('Full Recovery Pipeline', async () => {
    const error = errors[errorIndex % errors.length];
    const context = contexts[contextIndex % contexts.length];
    errorIndex++;
    contextIndex++;
    
    return recoverFromError(error, context);
  });
}

/**
 * Benchmark pattern generation recovery specifically
 */
async function benchmarkPatternRecovery(): Promise<BenchmarkResult> {
  return benchmarkFunction('Pattern Generation Recovery', async () => {
    return recoverFromError(testErrors.patternGeneration, testContexts.normal);
  });
}

/**
 * Benchmark MIDI connection recovery specifically
 */
async function benchmarkMidiRecovery(): Promise<BenchmarkResult> {
  return benchmarkFunction('MIDI Connection Recovery', async () => {
    return recoverFromError(testErrors.midiConnection, testContexts.normal);
  });
}

/**
 * Benchmark memory pressure recovery specifically
 */
async function benchmarkMemoryRecovery(): Promise<BenchmarkResult> {
  return benchmarkFunction('Memory Pressure Recovery', async () => {
    return recoverFromError(testErrors.memoryPressure, testContexts.memoryPressure);
  });
}

/**
 * Benchmark performance degradation recovery specifically
 */
async function benchmarkPerformanceRecovery(): Promise<BenchmarkResult> {
  return benchmarkFunction('Performance Degradation Recovery', async () => {
    return recoverFromError(testErrors.performanceDegradation, testContexts.performanceDegradation);
  });
}

// ============================================================================
// MAIN BENCHMARK RUNNER
// ============================================================================

/**
 * Run comprehensive error recovery benchmarks
 */
export async function runErrorRecoveryBenchmark(): Promise<DetailedBenchmarkResults> {
  console.log('='.repeat(60));
  console.log('ERROR RECOVERY PERFORMANCE BENCHMARK');
  console.log('='.repeat(60));
  console.log(`Target: <${PERFORMANCE_TARGET_MS}ms | Critical: <${CRITICAL_THRESHOLD_MS}ms | Current Baseline: ~${CURRENT_BASELINE_MS}ms`);
  console.log('');
  
  const startTime = performance.now();
  
  // Run individual benchmarks
  const classifyErrorResult = await benchmarkClassifyError();
  const patternRecoveryResult = await benchmarkPatternRecovery();
  const midiRecoveryResult = await benchmarkMidiRecovery();
  const memoryRecoveryResult = await benchmarkMemoryRecovery();
  const performanceRecoveryResult = await benchmarkPerformanceRecovery();
  const fullRecoveryResult = await benchmarkFullRecovery();
  
  const endTime = performance.now();
  const totalTime = endTime - startTime;
  
  // Analyze results
  const results: DetailedBenchmarkResults = {
    classifyError: classifyErrorResult,
    recoverPatternGeneration: patternRecoveryResult,
    recoverMidiConnection: midiRecoveryResult,
    recoverMemoryPressure: memoryRecoveryResult,
    recoverPerformanceDegradation: performanceRecoveryResult,
    fullRecoveryPipeline: fullRecoveryResult,
    summary: {
      totalTimeMs: totalTime,
      criticalBottlenecks: [],
      recommendedOptimizations: []
    }
  };
  
  // Identify critical bottlenecks
  const allResults = [
    classifyErrorResult,
    patternRecoveryResult,
    midiRecoveryResult,
    memoryRecoveryResult,
    performanceRecoveryResult,
    fullRecoveryResult
  ];
  
  allResults.forEach(result => {
    if (!result.passesCritical) {
      results.summary.criticalBottlenecks.push(
        `${result.operation}: ${result.averageMs.toFixed(2)}ms (>${CRITICAL_THRESHOLD_MS}ms)`
      );
    }
  });
  
  // Generate optimization recommendations
  if (classifyErrorResult.averageMs > 2) {
    results.summary.recommendedOptimizations.push(
      'Replace string matching with error code enum system'
    );
  }
  
  if (patternRecoveryResult.averageMs > 10) {
    results.summary.recommendedOptimizations.push(
      'Pre-cache dynamic imports for pattern generation recovery'
    );
  }
  
  if (fullRecoveryResult.averageMs > PERFORMANCE_TARGET_MS) {
    results.summary.recommendedOptimizations.push(
      'Implement object pooling for error context serialization'
    );
  }
  
  return results;
}

// ============================================================================
// BENCHMARK REPORTING
// ============================================================================

/**
 * Print detailed benchmark results
 */
export function printBenchmarkResults(results: DetailedBenchmarkResults): void {
  console.log('');
  console.log('='.repeat(60));
  console.log('BENCHMARK RESULTS');
  console.log('='.repeat(60));
  
  const allResults = [
    results.classifyError,
    results.recoverPatternGeneration,
    results.recoverMidiConnection,
    results.recoverMemoryPressure,
    results.recoverPerformanceDegradation,
    results.fullRecoveryPipeline
  ];
  
  allResults.forEach(result => {
    const status = result.passesTarget ? '✅ TARGET' : result.passesCritical ? '⚠️  CRITICAL' : '❌ FAIL';
    console.log(`${status} ${result.operation}`);
    console.log(`  Average: ${result.averageMs.toFixed(2)}ms`);
    console.log(`  Range: ${result.minMs.toFixed(2)}ms - ${result.maxMs.toFixed(2)}ms`);
    console.log(`  P95: ${result.p95Ms.toFixed(2)}ms`);
    console.log(`  Iterations: ${result.iterations}`);
    console.log('');
  });
  
  console.log('='.repeat(60));
  console.log('CRITICAL ANALYSIS');
  console.log('='.repeat(60));
  
  if (results.summary.criticalBottlenecks.length > 0) {
    console.log('🚨 CRITICAL BOTTLENECKS:');
    results.summary.criticalBottlenecks.forEach(bottleneck => {
      console.log(`  • ${bottleneck}`);
    });
    console.log('');
  }
  
  if (results.summary.recommendedOptimizations.length > 0) {
    console.log('💡 RECOMMENDED OPTIMIZATIONS:');
    results.summary.recommendedOptimizations.forEach(optimization => {
      console.log(`  • ${optimization}`);
    });
    console.log('');
  }
  
  console.log(`Total benchmark time: ${(results.summary.totalTimeMs / 1000).toFixed(2)}s`);
  console.log('='.repeat(60));
}

// ============================================================================
// PERFORMANCE GATE VALIDATION
// ============================================================================

/**
 * Validate performance gates for CI/CD
 */
export function validatePerformanceGates(results: DetailedBenchmarkResults): boolean {
  const criticalResults = [
    results.fullRecoveryPipeline,
    results.classifyError
  ];
  
  const failures = criticalResults.filter(result => !result.passesCritical);
  
  if (failures.length > 0) {
    console.error('❌ PERFORMANCE GATES FAILED:');
    failures.forEach(failure => {
      console.error(`  • ${failure.operation}: ${failure.averageMs.toFixed(2)}ms > ${CRITICAL_THRESHOLD_MS}ms`);
    });
    return false;
  }
  
  console.log('✅ All critical performance gates passed');
  return true;
}

// ============================================================================
// QUICK BENCHMARK FOR DEVELOPMENT
// ============================================================================

/**
 * Run quick benchmark for development use
 */
export async function runQuickBenchmark(): Promise<void> {
  console.log('Running quick error recovery benchmark...');
  
  const results = await runErrorRecoveryBenchmark();
  printBenchmarkResults(results);
  
  const passed = validatePerformanceGates(results);
  if (!passed) {
    process.exit(1);
  }
}

// Auto-run if called directly
if (require.main === module) {
  runQuickBenchmark().catch(console.error);
}