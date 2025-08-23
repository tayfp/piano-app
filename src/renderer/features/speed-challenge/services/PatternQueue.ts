/**
 * Pattern Queue Management for Speed Challenge Mode
 * 
 * Maintains a queue of pre-generated patterns to ensure zero-delay
 * pattern advancement. Uses background generation with requestIdleCallback
 * to avoid blocking the main thread.
 * 
 * Performance Target: <1ms queue operations
 */

import { PatternGenerator, GeneratedPattern } from './PatternGenerator';
import { DifficultyLevel } from '../types';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { v4 as uuidv4 } from 'uuid';

export interface QueueStatistics {
  currentSize: number;
  capacity: number;
  difficulty: DifficultyLevel | null;
  totalGenerated: number;
  totalConsumed: number;
  avgGenerationTime: number;
  lastRefillTime: number;
}

/**
 * Intelligent pattern queue with background generation
 */
export class PatternQueue {
  private queue: GeneratedPattern[] = [];
  private generator: PatternGenerator;
  private currentDifficulty: DifficultyLevel | null = null;
  
  // Queue configuration
  readonly capacity: number = 10;
  private readonly refillThreshold: number = 5;
  
  // Statistics tracking
  private stats = {
    totalGenerated: 0,
    totalConsumed: 0,
    generationTimes: [] as number[],
    lastRefillTime: 0
  };
  
  // Background generation management
  private idleCallbackId: number | null = null;
  private isGenerating: boolean = false;
  private disposed: boolean = false;

  constructor() {
    this.generator = new PatternGenerator();
  }

  /**
   * Initialize the queue with a specific difficulty
   */
  async initialize(difficulty: DifficultyLevel): Promise<void> {
    const perfStart = performance.now();
    
    this.currentDifficulty = difficulty;
    this.queue = [];
    
    // Fill queue synchronously for initial patterns
    await this.fillQueue();
    
    perfLogger.debug('Pattern queue initialized', {
      difficulty,
      queueSize: this.queue.length,
      initTime: performance.now() - perfStart
    });
  }

  /**
   * Get the next pattern from the queue
   */
  getNext(): GeneratedPattern | null {
    if (this.queue.length === 0) {
      // Emergency generation if queue is empty
      if (this.currentDifficulty) {
        return this.generateEmergencyPattern();
      }
      return null;
    }

    const pattern = this.queue.shift()!;
    this.stats.totalConsumed++;
    
    // Trigger background refill if below threshold
    if (this.queue.length < this.refillThreshold && !this.isGenerating) {
      this.scheduleBackgroundGeneration();
    }

    perfLogger.debug('Pattern retrieved from queue', {
      remainingPatterns: this.queue.length,
      patternId: pattern.id
    });

    return pattern;
  }

  /**
   * Peek at the next pattern without removing it
   */
  peek(): GeneratedPattern | null {
    return this.queue[0] || null;
  }

  /**
   * Change difficulty and regenerate queue
   */
  async changeDifficulty(difficulty: DifficultyLevel): Promise<void> {
    const perfStart = performance.now();
    
    // Cancel any pending background generation
    this.cancelBackgroundGeneration();
    
    // Clear current queue
    this.queue = [];
    this.currentDifficulty = difficulty;
    
    // Refill with new difficulty
    await this.fillQueue();
    
    perfLogger.debug('Difficulty changed', {
      newDifficulty: difficulty,
      changeTime: performance.now() - perfStart,
      newQueueSize: this.queue.length
    });
  }

  /**
   * Fill the queue up to capacity
   */
  async fillQueue(): Promise<void> {
    if (!this.currentDifficulty || this.disposed) {
      return;
    }

    const perfStart = performance.now();
    const patternsNeeded = Math.min(
      this.capacity - this.queue.length,
      this.capacity // Never exceed capacity
    );

    if (patternsNeeded <= 0) {
      return;
    }

    try {
      const newPatterns = this.generator.generateBatch(
        this.currentDifficulty,
        patternsNeeded
      );

      this.queue.push(...newPatterns);
      this.stats.totalGenerated += newPatterns.length;
      
      const generationTime = performance.now() - perfStart;
      this.stats.generationTimes.push(generationTime / patternsNeeded);
      this.stats.lastRefillTime = Date.now();
      
      // Keep only last 100 generation times for average
      if (this.stats.generationTimes.length > 100) {
        this.stats.generationTimes.shift();
      }

      perfLogger.debug('Queue filled', {
        patternsAdded: newPatterns.length,
        totalQueueSize: this.queue.length,
        fillTime: generationTime
      });

    } catch (error) {
      perfLogger.error('Queue fill failed', error as Error);
      // Add fallback patterns
      this.addFallbackPatterns(patternsNeeded);
    }
  }

  /**
   * Schedule background pattern generation
   */
  private scheduleBackgroundGeneration(): void {
    if (this.idleCallbackId !== null || this.disposed) {
      return;
    }

    this.isGenerating = true;

    // Use requestIdleCallback for non-blocking generation
    if ('requestIdleCallback' in window) {
      this.idleCallbackId = window.requestIdleCallback(
        (deadline) => this.performBackgroundGeneration(deadline),
        { timeout: 100 } // Max 100ms wait
      );
    } else {
      // Fallback for browsers without requestIdleCallback
      this.idleCallbackId = window.setTimeout(() => {
        this.performBackgroundGeneration();
      }, 10) as unknown as number;
    }
  }

  /**
   * Perform background pattern generation
   */
  private performBackgroundGeneration(deadline?: IdleDeadline): void {
    const perfStart = performance.now();
    
    if (this.disposed) {
      return;
    }

    try {
      // Generate patterns while we have idle time
      const maxTime = deadline ? deadline.timeRemaining() : 10;
      const patternsNeeded = this.capacity - this.queue.length;
      let patternsGenerated = 0;

      while (
        patternsGenerated < patternsNeeded &&
        (performance.now() - perfStart) < maxTime &&
        !this.disposed
      ) {
        if (this.currentDifficulty) {
          const pattern = this.generatePattern(this.currentDifficulty);
          if (pattern) {
            this.queue.push(pattern);
            patternsGenerated++;
            this.stats.totalGenerated++;
          }
        }
      }

      perfLogger.debug('Background generation complete', {
        patternsGenerated,
        timeUsed: performance.now() - perfStart,
        queueSize: this.queue.length
      });

      // Schedule more generation if still needed
      if (this.queue.length < this.capacity && !this.disposed) {
        this.scheduleBackgroundGeneration();
      } else {
        this.isGenerating = false;
      }

    } catch (error) {
      perfLogger.error('Background generation failed', error as Error);
      this.isGenerating = false;
    } finally {
      this.idleCallbackId = null;
    }
  }

  /**
   * Cancel pending background generation
   */
  private cancelBackgroundGeneration(): void {
    if (this.idleCallbackId !== null) {
      if ('cancelIdleCallback' in window) {
        window.cancelIdleCallback(this.idleCallbackId);
      } else {
        window.clearTimeout(this.idleCallbackId as unknown as number);
      }
      this.idleCallbackId = null;
    }
    this.isGenerating = false;
  }

  /**
   * Generate a single pattern with error handling
   */
  private generatePattern(difficulty: DifficultyLevel): GeneratedPattern | null {
    try {
      return this.generator.generatePattern(difficulty);
    } catch (error) {
      perfLogger.error('Pattern generation failed', error as Error);
      return null;
    }
  }

  /**
   * Generate an emergency pattern when queue is empty
   */
  private generateEmergencyPattern(): GeneratedPattern {
    perfLogger.warn('Emergency pattern generation triggered');
    
    try {
      if (this.currentDifficulty) {
        return this.generator.generatePattern(this.currentDifficulty);
      }
    } catch (error) {
      perfLogger.error('Emergency generation failed', error as Error);
    }

    // Ultimate fallback - simple C4 pattern
    return this.createFallbackPattern();
  }

  /**
   * Create a simple fallback pattern
   */
  private createFallbackPattern(): GeneratedPattern {
    const noteData = {
      step: 'C',
      octave: 4,
      duration: 4,
      type: 'quarter' as const
    };

    const musicXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

    return {
      id: uuidv4(),
      difficulty: this.currentDifficulty || 'single_notes',
      notes: [noteData],
      expectedMidiNotes: [60], // C4
      musicXML,
      createdAt: Date.now()
    };
  }

  /**
   * Add fallback patterns to the queue
   */
  private addFallbackPatterns(count: number): void {
    for (let i = 0; i < count; i++) {
      this.queue.push(this.createFallbackPattern());
    }
    this.stats.totalGenerated += count;
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Get queue statistics
   */
  getStatistics(): QueueStatistics {
    const avgGenerationTime = this.stats.generationTimes.length > 0
      ? this.stats.generationTimes.reduce((a, b) => a + b, 0) / this.stats.generationTimes.length
      : 0;

    return {
      currentSize: this.queue.length,
      capacity: this.capacity,
      difficulty: this.currentDifficulty,
      totalGenerated: this.stats.totalGenerated,
      totalConsumed: this.stats.totalConsumed,
      avgGenerationTime,
      lastRefillTime: this.stats.lastRefillTime
    };
  }

  /**
   * Dispose of the queue and clean up resources
   */
  dispose(): void {
    this.disposed = true;
    this.cancelBackgroundGeneration();
    this.queue = [];
    this.currentDifficulty = null;
    
    perfLogger.debug('Pattern queue disposed');
  }
}