/**
 * Simple Adaptive Difficulty Service
 * 
 * Uses EWMA (Exponential Weighted Moving Average) for lightweight performance tracking.
 * Replaces the complex 20-point rolling window with a simple, efficient approach.
 */

import type { DifficultySettings } from '../types';
import { perfLogger } from '@/renderer/utils/performance-logger';

export class SimpleAdaptiveDifficulty {
  // EWMA parameters
  private performanceEWMA: number = 0.7; // Start at 70% (neutral)
  private readonly alpha = 0.15; // Smoothing factor (0.15 = responsive but not jumpy)
  private updateCount = 0;
  
  private currentSettings: DifficultySettings = {
    waitForCorrectNote: true,
    showHintsAfterAttempts: 3,
    autoAdvanceRests: true,
    highlightExpectedNotes: true,
    playbackSpeed: 1.0,
    sectionLooping: false
  };
  
  private manualOverrides: Partial<DifficultySettings> = {};
  
  constructor() {
    this.loadPreferences();
  }
  
  /**
   * Update performance with a new accuracy score (0-1)
   */
  updatePerformance(accuracy: number): void {
    // EWMA calculation: new = α * current + (1-α) * previous
    this.performanceEWMA = this.alpha * accuracy + (1 - this.alpha) * this.performanceEWMA;
    this.updateCount++;
    
    // Adjust difficulty every 5 updates
    if (this.updateCount % 5 === 0) {
      this.adjustDifficulty();
    }
  }
  
  /**
   * Get current difficulty settings
   */
  getSettings(): DifficultySettings {
    return { ...this.currentSettings };
  }
  
  /**
   * Manually set difficulty settings
   */
  setSettings(settings: Partial<DifficultySettings>): void {
    this.manualOverrides = { ...this.manualOverrides, ...settings };
    this.currentSettings = {
      ...this.currentSettings,
      ...settings
    };
    this.savePreferences();
  }
  
  /**
   * Get current performance level (0-1)
   */
  getPerformanceLevel(): number {
    return this.performanceEWMA;
  }
  
  /**
   * Adjust difficulty based on EWMA performance
   */
  private adjustDifficulty(): void {
    // Simple thresholds: >0.8 = increase, <0.6 = decrease
    if (this.performanceEWMA > 0.8) {
      this.increaseDifficulty();
    } else if (this.performanceEWMA < 0.6) {
      this.decreaseDifficulty();
    }
    // 0.6-0.8 = maintain current
  }
  
  private increaseDifficulty(): void {
    // Only adjust non-overridden settings
    if (!this.manualOverrides.showHintsAfterAttempts) {
      this.currentSettings.showHintsAfterAttempts = Math.min(
        this.currentSettings.showHintsAfterAttempts + 1,
        5
      );
    }
    
    if (!this.manualOverrides.highlightExpectedNotes) {
      this.currentSettings.highlightExpectedNotes = false;
    }
  }
  
  private decreaseDifficulty(): void {
    if (!this.manualOverrides.showHintsAfterAttempts) {
      this.currentSettings.showHintsAfterAttempts = Math.max(
        this.currentSettings.showHintsAfterAttempts - 1,
        1
      );
    }
    
    if (!this.manualOverrides.highlightExpectedNotes) {
      this.currentSettings.highlightExpectedNotes = true;
    }
  }
  
  private savePreferences(): void {
    try {
      localStorage.setItem('abc-piano-difficulty', JSON.stringify({
        performanceEWMA: this.performanceEWMA,
        manualOverrides: this.manualOverrides
      }));
    } catch (error) {
      perfLogger.error('Failed to save difficulty preferences:', error);
    }
  }
  
  private loadPreferences(): void {
    try {
      const stored = localStorage.getItem('abc-piano-difficulty');
      if (stored) {
        const { performanceEWMA, manualOverrides } = JSON.parse(stored);
        this.performanceEWMA = performanceEWMA || 0.7;
        this.manualOverrides = manualOverrides || {};
        this.currentSettings = {
          ...this.currentSettings,
          ...this.manualOverrides
        };
      }
    } catch (error) {
      perfLogger.error('Failed to load difficulty preferences:', error);
    }
  }
  
  reset(): void {
    this.performanceEWMA = 0.7;
    this.updateCount = 0;
    this.manualOverrides = {};
    this.currentSettings = {
      waitForCorrectNote: true,
      showHintsAfterAttempts: 3,
      autoAdvanceRests: true,
      highlightExpectedNotes: true,
      playbackSpeed: 1.0,
      sectionLooping: false
    };
  }
}