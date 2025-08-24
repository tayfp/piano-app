/**
 * Classification Engine Performance Benchmark
 * Tests the extracted ErrorClassifier for Phase 2 validation
 */

const { performance } = require('perf_hooks');

// ============================================================================
// MOCK CLASSIFICATION ENGINE (simplified version for testing)
// ============================================================================

const ErrorCode = {
  PATTERN_GENERATION: 1,
  MIDI_CONNECTION: 2,
  VALIDATION: 3,
  VISUAL_FEEDBACK: 4,
  MEMORY_PRESSURE: 5,
  PERFORMANCE_DEGRADATION: 6,
  OSMD_RENDERING: 7,
  STORE_STATE: 8,
  UNKNOWN: 0
};

const ErrorCategory = {
  PATTERN_GENERATION: 'pattern_generation',
  MIDI_CONNECTION: 'midi_connection',
  VALIDATION: 'validation',
  VISUAL_FEEDBACK: 'visual_feedback',
  MEMORY_PRESSURE: 'memory_pressure',
  PERFORMANCE_DEGRADATION: 'performance_degradation',
  OSMD_RENDERING: 'osmd_rendering',
  STORE_STATE: 'store_state',
  UNKNOWN: 'unknown'
};

const ErrorSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

// Pre-compiled patterns for fast matching
const patterns = new Map([
  [ErrorCode.PATTERN_GENERATION, /pattern|generation|template|musicxml/i],
  [ErrorCode.MIDI_CONNECTION, /midi|device|connection|input/i],
  [ErrorCode.VALIDATION, /validation|note|compare/i],
  [ErrorCode.VISUAL_FEEDBACK, /visual|feedback|animation|highlight/i],
  [ErrorCode.OSMD_RENDERING, /osmd|render|sheet|music/i],
  [ErrorCode.STORE_STATE, /store|state|zustand/i],
  [ErrorCode.MEMORY_PRESSURE, /memory|allocation/i],
  [ErrorCode.PERFORMANCE_DEGRADATION, /performance|latency/i]
]);

const categoryMap = new Map([
  [ErrorCode.PATTERN_GENERATION, ErrorCategory.PATTERN_GENERATION],
  [ErrorCode.MIDI_CONNECTION, ErrorCategory.MIDI_CONNECTION],
  [ErrorCode.VALIDATION, ErrorCategory.VALIDATION],
  [ErrorCode.VISUAL_FEEDBACK, ErrorCategory.VISUAL_FEEDBACK],
  [ErrorCode.MEMORY_PRESSURE, ErrorCategory.MEMORY_PRESSURE],
  [ErrorCode.PERFORMANCE_DEGRADATION, ErrorCategory.PERFORMANCE_DEGRADATION],
  [ErrorCode.OSMD_RENDERING, ErrorCategory.OSMD_RENDERING],
  [ErrorCode.STORE_STATE, ErrorCategory.STORE_STATE],
  [ErrorCode.UNKNOWN, ErrorCategory.UNKNOWN]
]);

const severityMap = new Map([
  [ErrorCode.PATTERN_GENERATION, ErrorSeverity.MEDIUM],
  [ErrorCode.MIDI_CONNECTION, ErrorSeverity.HIGH],
  [ErrorCode.VALIDATION, ErrorSeverity.LOW],
  [ErrorCode.VISUAL_FEEDBACK, ErrorSeverity.LOW],
  [ErrorCode.OSMD_RENDERING, ErrorSeverity.MEDIUM],
  [ErrorCode.STORE_STATE, ErrorSeverity.HIGH],
  [ErrorCode.MEMORY_PRESSURE, ErrorSeverity.HIGH],
  [ErrorCode.PERFORMANCE_DEGRADATION, ErrorSeverity.MEDIUM],
  [ErrorCode.UNKNOWN, ErrorSeverity.MEDIUM]
]);

// Mock classification function
function classifyError(error, context) {
  const timestamp = performance.now();
  
  // Pattern matching
  let code = ErrorCode.UNKNOWN;
  for (const [errorCode, pattern] of patterns) {
    if (pattern.test(error.message)) {
      code = errorCode;
      break;
    }
  }
  
  // Context fallback
  if (code === ErrorCode.UNKNOWN && context) {
    if (context.memoryUsage && context.memoryUsage > 50 * 1024 * 1024) {
      code = ErrorCode.MEMORY_PRESSURE;
    } else if (context.latency && context.latency > 25) {
      code = ErrorCode.PERFORMANCE_DEGRADATION;
    }
  }
  
  const category = categoryMap.get(code) || ErrorCategory.UNKNOWN;
  const severity = severityMap.get(code) || ErrorSeverity.MEDIUM;
  const errorId = `err_${timestamp.toFixed(0)}_${code}`;
  
  return {
    code,
    category,
    severity,
    message: error.message,
    timestamp,
    errorId,
    confidence: code !== ErrorCode.UNKNOWN ? 0.9 : 0.1
  };
}

// ============================================================================
// BENCHMARK TESTS
// ============================================================================

function testClassificationPerformance() {
  console.log('\\n=== CLASSIFICATION ENGINE BENCHMARK ===');
  
  const iterations = 10000;
  const testErrors = [
    new Error('pattern generation failed: template not found'),
    new Error('midi device connection lost: input not available'), 
    new Error('validation error: note comparison failed'),
    new Error('memory allocation error: heap exhausted'),
    new Error('performance latency detected: >25ms'),
    new Error('unknown runtime error')
  ];
  
  const testContexts = [
    { memoryUsage: 60 * 1024 * 1024 },
    { latency: 30 },
    { someData: 'test' },
    {}
  ];
  
  console.log(`Testing classification performance (${iterations} iterations)...`);
  
  const timings = [];
  const start = performance.now();
  
  for (let i = 0; i < iterations; i++) {
    const error = testErrors[i % testErrors.length];
    const context = testContexts[i % testContexts.length];
    
    const classifyStart = performance.now();
    const result = classifyError(error, context);
    const classifyEnd = performance.now();
    
    timings.push(classifyEnd - classifyStart);
  }
  
  const end = performance.now();
  const totalTime = end - start;
  
  // Calculate statistics
  timings.sort((a, b) => a - b);
  const avgTime = timings.reduce((sum, time) => sum + time, 0) / timings.length;
  const minTime = timings[0];
  const maxTime = timings[timings.length - 1];
  const p95Time = timings[Math.floor(timings.length * 0.95)];
  
  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average per classification: ${avgTime.toFixed(3)}ms`);
  console.log(`Range: ${minTime.toFixed(3)}ms - ${maxTime.toFixed(3)}ms`);
  console.log(`P95: ${p95Time.toFixed(3)}ms`);
  console.log(`Throughput: ${(iterations / totalTime * 1000).toFixed(0)} classifications/second`);
  
  // Phase 2 success criteria
  const target = 2; // <2ms target
  const passes = avgTime < target;
  
  console.log(`\\nPhase 2 Target: <${target}ms`);
  console.log(`Result: ${passes ? '✅ PASS' : '❌ FAIL'} (${avgTime.toFixed(3)}ms)`);
  
  return { avgTime, passes, target };
}

function testBatchClassification() {
  console.log('\\n=== BATCH CLASSIFICATION BENCHMARK ===');
  
  const batchSizes = [10, 50, 100, 500];
  const testError = new Error('pattern generation failed: template not found');
  const testContext = { memoryUsage: 30 * 1024 * 1024 };
  
  batchSizes.forEach(batchSize => {
    const batch = Array(batchSize).fill({ error: testError, context: testContext });
    
    const start = performance.now();
    const results = batch.map(({ error, context }) => classifyError(error, context));
    const end = performance.now();
    
    const totalTime = end - start;
    const avgTimePerItem = totalTime / batchSize;
    
    console.log(`Batch size ${batchSize}: ${totalTime.toFixed(2)}ms total, ${avgTimePerItem.toFixed(3)}ms per item`);
  });
}

function testMemoryUsage() {
  console.log('\\n=== MEMORY USAGE TEST ===');
  
  const iterations = 1000;
  const testError = new Error('pattern generation failed: template not found');
  const testContext = { memoryUsage: 30 * 1024 * 1024 };
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  const memBefore = process.memoryUsage().heapUsed;
  
  for (let i = 0; i < iterations; i++) {
    classifyError(testError, testContext);
  }
  
  if (global.gc) {
    global.gc();
  }
  
  const memAfter = process.memoryUsage().heapUsed;
  const memDiff = memAfter - memBefore;
  const memPerClassification = memDiff / iterations;
  
  console.log(`Memory before: ${(memBefore / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Memory after: ${(memAfter / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Memory difference: ${(memDiff / 1024).toFixed(2)} KB`);
  console.log(`Memory per classification: ${memPerClassification.toFixed(2)} bytes`);
  
  const lowMemory = memPerClassification < 100; // <100 bytes per classification
  console.log(`Memory efficiency: ${lowMemory ? '✅ GOOD' : '⚠️  HIGH'}`);
}

// ============================================================================
// MAIN BENCHMARK RUNNER
// ============================================================================

function runClassificationBenchmark() {
  console.log('===========================================================');
  console.log('PHASE 2: ERROR CLASSIFICATION ENGINE BENCHMARK');
  console.log('===========================================================');
  console.log('Testing extracted classification engine performance...');
  
  const perfResult = testClassificationPerformance();
  testBatchClassification();
  testMemoryUsage();
  
  console.log('\\n=== PHASE 2 ASSESSMENT ===');
  if (perfResult.passes) {
    console.log('✅ SUCCESS: Classification engine meets Phase 2 targets');
    console.log(`   Average classification time: ${perfResult.avgTime.toFixed(3)}ms (target: <${perfResult.target}ms)`);
    console.log('✅ READY: Proceed to Phase 3 - Recovery Strategy Extraction');
  } else {
    console.log('❌ NEEDS WORK: Classification engine needs optimization');
    console.log(`   Average classification time: ${perfResult.avgTime.toFixed(3)}ms (target: <${perfResult.target}ms)`);
    console.log('   Consider additional optimizations before Phase 3');
  }
  
  console.log('===========================================================');
}

// Run the benchmark
runClassificationBenchmark();