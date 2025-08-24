/**
 * Constants for Speed Challenge Analytics
 * Extracted from SessionAnalytics.ts for better configuration management
 */

/**
 * Performance thresholds used in analytics calculations
 */
export const ANALYTICS_THRESHOLDS = {
  /** 70% accuracy threshold for "good" performance */
  ACCURACY_THRESHOLD: 0.7,
  
  /** 2 seconds is considered slow response time */
  SLOW_RESPONSE_THRESHOLD: 2000,
  
  /** 10% variation indicates performance plateau */
  PLATEAU_THRESHOLD: 0.1,
} as const;

/**
 * Default values for analytics calculations
 */
export const ANALYTICS_DEFAULTS = {
  /** Default accuracy threshold for problem pattern identification */
  PROBLEM_PATTERN_ACCURACY_THRESHOLD: 0.5,
  
  /** Default time threshold for slow pattern identification */
  SLOW_PATTERN_TIME_THRESHOLD: 2000,
  
  /** Minimum attempts required for analysis */
  MIN_ATTEMPTS_FOR_ANALYSIS: 2,
  
  /** Minimum attempts for strength/weakness identification */
  MIN_ATTEMPTS_FOR_DIFFICULTY_ANALYSIS: 5,
  
  /** Minimum attempts for note analysis */
  MIN_ATTEMPTS_FOR_NOTE_ANALYSIS: 3,
} as const;

/**
 * Performance monitoring thresholds
 */
export const PERFORMANCE_THRESHOLDS = {
  /** Maximum tracking time in milliseconds (1ms target) */
  MAX_TRACKING_TIME: 1,
  
  /** Maximum summary generation time in milliseconds (10ms target) */
  MAX_SUMMARY_GENERATION_TIME: 10,
} as const;