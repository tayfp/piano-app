/**
 * ESLint Configuration for Console Usage
 * 
 * Configuration to prevent console.* usage except for specific allowed cases.
 * Prevents future console.* usage except for specific allowed cases.
 */

module.exports = {
  rules: {
    'no-console': ['error', {
      allow: [] // No console methods allowed by default
    }],
    
    // Custom rule for allowed console usage (startup/env only)
    'no-restricted-syntax': [
      'error',
      {
        selector: 'CallExpression[callee.object.name="console"]',
        message: 'Use perfLogger for debug/error/warn, or ring buffer logging for performance metrics. See docs/performance-logging-guide.md'
      }
    ]
  },
  
  overrides: [
    {
      // Allow console in specific startup files only
      files: [
        'src/main/index.ts',
        'src/renderer/index.tsx'
      ],
      rules: {
        'no-console': ['error', {
          allow: ['info'] // Only console.info for startup messages
        }],
        'no-restricted-syntax': 'off'
      }
    },
    {
      // Completely disable in hot paths
      files: [
        '**/useMidi.ts',
        '**/WebAudioScheduler.ts',
        '**/MidiService.ts',
        '**/AudioEngine.ts',
        '**/PracticeController*.ts'
      ],
      rules: {
        'no-console': 'error', // No exceptions in hot paths
      }
    }
  ]
};