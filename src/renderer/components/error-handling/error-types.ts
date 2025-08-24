/**
 * Error Types for Speed Challenge Error Boundary
 * 
 * Centralized type definitions for error handling across the application.
 * These types ensure consistency and type safety for error boundary operations.
 * 
 * Performance requirement: Type definitions have zero runtime cost
 */

import { ReactNode, ErrorInfo } from 'react';

// ============================================================================
// CORE ERROR BOUNDARY TYPES
// ============================================================================

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  isolateErrors?: boolean; // If true, prevents errors from bubbling up
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string;
  errorTimestamp: number;
  retryCount: number;
}

export interface SerializedError {
  message: string;
  stack?: string;
  componentStack?: string;
  timestamp: number;
  errorId: string;
  retryCount: number;
  speedChallengeContext?: SpeedChallengeErrorContext;
}

export interface SpeedChallengeErrorContext {
  isActive: boolean;
  currentDifficulty?: string;
  currentPattern?: {
    id: string;
    type: string;
    noteCount: number;
  } | null;
  performanceMetrics?: {
    score: number;
    streak: number;
    accuracy: number;
    averageResponseTime: number;
    totalNotes: number;
  };
  contextGatheringFailed?: boolean;
}

// ============================================================================
// ERROR RECOVERY STRATEGY TYPES
// ============================================================================

export enum RecoveryStrategy {
  RETRY = 'retry',
  FALLBACK = 'fallback',
  DISABLE = 'disable',
  RESTART = 'restart'
}

export interface RecoveryConfig {
  maxRetryCount: number;
  retryDelayMs: number;
  errorCooldownMs: number;
}

// ============================================================================
// ERROR CLASSIFICATION TYPES
// ============================================================================

export type ErrorCategory = 
  | 'pattern_generation'
  | 'midi_validation'
  | 'ui_rendering'
  | 'store_integration'
  | 'performance'
  | 'unknown';

export interface ErrorClassification {
  category: ErrorCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoverable: boolean;
  recommendedStrategy: RecoveryStrategy;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const ERROR_CONSTANTS = {
  MAX_RETRY_COUNT: 3,
  RETRY_DELAY_MS: 1000,
  ERROR_COOLDOWN_MS: 5000,
  ERROR_HANDLING_TIMEOUT_MS: 1, // Performance requirement: <1ms
} as const;