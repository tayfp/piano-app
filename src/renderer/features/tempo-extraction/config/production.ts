/**
 * Production Configuration for Tempo Extraction
 * 
 * Environment-specific settings optimized for production performance
 */

export const ProductionTempoConfig = {
  performance: {
    maxExtractionTime: 20, // ms
    maxMidiLatencyImpact: 2, // ms
    enableEarlyBailout: true,
    webWorkerThreshold: 200, // measures
    cacheEnabled: true
  },
  
  extraction: {
    enableTextExtraction: true,
    enableHeuristics: false, // Disabled by default for performance
    enableAdvancedCaching: true,
    maxMeasuresPerExtractor: 500
  },
  
  monitoring: {
    enablePerformanceLogging: true,
    enableTelemetry: true,
    logLevel: 'warn' as const
  },
  
  features: {
    confidenceThreshold: 0.3,
    fallbackBpm: 120,
    enableUserOverrides: true,
    enableTempoPreview: true
  }
};

export const DevelopmentTempoConfig = {
  ...ProductionTempoConfig,
  performance: {
    ...ProductionTempoConfig.performance,
    enableEarlyBailout: false
  },
  extraction: {
    ...ProductionTempoConfig.extraction,
    enableHeuristics: true
  },
  monitoring: {
    ...ProductionTempoConfig.monitoring,
    logLevel: 'debug' as const
  }
};