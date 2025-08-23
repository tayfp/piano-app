/**
 * Simple Event Logger
 * 
 * Lightweight event logging for practice sessions with CSV/JSON export.
 * Replaces the over-engineered AnalyticsService.
 */

import type { PracticeEvent } from '../types';

export class SimpleEventLogger {
  private events: PracticeEvent[] = [];
  private sessionStartTime: number = 0;
  
  /**
   * Start a new logging session
   */
  startSession(): void {
    this.events = [];
    this.sessionStartTime = Date.now();
    this.recordEvent('SESSION_START', {});
  }
  
  /**
   * Record a practice event
   */
  recordEvent(type: PracticeEvent['type'], data: PracticeEvent['data']): void {
    this.events.push({
      timestamp: Date.now(),
      type,
      data
    });
    
    // Keep only last 500 events to prevent memory bloat
    if (this.events.length > 500) {
      this.events = this.events.slice(-500);
    }
  }
  
  /**
   * Get basic session metrics for display
   */
  getBasicMetrics() {
    const noteEvents = this.events.filter(e => 
      e.type === 'NOTE_CORRECT' || e.type === 'NOTE_INCORRECT'
    );
    
    const correctNotes = noteEvents.filter(e => e.type === 'NOTE_CORRECT').length;
    const totalNotes = noteEvents.length;
    
    return {
      duration: Date.now() - this.sessionStartTime,
      totalNotes,
      correctNotes,
      accuracy: totalNotes > 0 ? correctNotes / totalNotes : 0
    };
  }
  
  /**
   * Export events as JSON
   */
  exportToJSON(): string {
    const metrics = this.getBasicMetrics();
    
    return JSON.stringify({
      sessionId: `session_${this.sessionStartTime}`,
      ...metrics,
      events: this.events
    }, null, 2);
  }
  
  /**
   * Export events as CSV
   */
  exportToCSV(): string {
    const header = 'Timestamp,Event Type,Note,Reaction Time (ms),Measure\n';
    
    const rows = this.events.map(e => {
      const timestamp = new Date(e.timestamp).toISOString();
      const note = e.data.note ?? '';
      const reactionTime = e.data.reactionTimeMs ?? '';
      const measure = e.data.measureIndex ?? '';
      
      return `${timestamp},${e.type},${note},${reactionTime},${measure}`;
    }).join('\n');
    
    return header + rows;
  }
}