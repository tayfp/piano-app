import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { EventEmitter } from 'events';
import { perfLogger } from '@/renderer/utils/performance-logger';

interface ChunkInfo {
  type: 'first' | 'progress' | 'complete';
  content: string;
  measureCount: number;
  isComplete: boolean;
}

interface ProgressEvent {
  jobId: string;
  measureCount?: number;
  totalMeasures?: number;
  stage: 'first-render' | 'complete-render';
}

export class ProgressiveOSMDLoader extends EventEmitter {
  private osmd: OpenSheetMusicDisplay | null = null;
  private currentJobId: string | null = null;
  private chunks: Map<string, ChunkInfo[]> = new Map();
  private container: HTMLElement | null = null;
  
  constructor() {
    super();
    this.setupEventListeners();
  }
  
  private setupEventListeners(): void {
    // Listen for chunk events from main process
    window.api.on('file:chunk', this.handleChunk.bind(this));
  }
  
  async loadProgressive(jobId: string, container: HTMLElement): Promise<void> {
    this.currentJobId = jobId;
    this.container = container;
    this.chunks.set(jobId, []);
    
    // Initialize OSMD if needed
    if (!this.osmd || this.osmd.container !== container) {
      this.osmd = new OpenSheetMusicDisplay(container, {
        autoResize: true,
        backend: 'svg',
        drawingParameters: 'compact',
        renderSingleHorizontalStaffline: false
      });
    }
  }
  
  private async handleChunk(data: { jobId: string; chunk: ChunkInfo }): Promise<void> {
    if (data.jobId !== this.currentJobId) return;
    
    const chunks = this.chunks.get(data.jobId) || [];
    chunks.push(data.chunk);
    this.chunks.set(data.jobId, chunks);
    
    if (data.chunk.type === 'first') {
      // Load and render first chunk immediately
      try {
        await this.renderFirstChunk(data.jobId, data.chunk);
      } catch (error) {
        perfLogger.error('Failed to render first chunk:', error);
        this.emit('error', { jobId: data.jobId, error });
      }
    } else if (data.chunk.type === 'complete') {
      // Combine all chunks and re-render complete score
      try {
        await this.renderCompleteScore(data.jobId, chunks);
      } catch (error) {
        perfLogger.error('Failed to render complete score:', error);
        this.emit('error', { jobId: data.jobId, error });
      }
    }
  }
  
  private async renderFirstChunk(jobId: string, chunk: ChunkInfo): Promise<void> {
    if (!this.osmd) return;
    
    await this.osmd.load(chunk.content);
    await this.osmd.render();
    
    // Notify UI that first measures are ready
    const progressEvent: ProgressEvent = {
      jobId,
      measureCount: chunk.measureCount,
      stage: 'first-render'
    };
    
    this.emit('first-render', progressEvent);
    
    // Also emit to window for global event handling
    if (window.api) {
      window.dispatchEvent(new CustomEvent('osmd:first-render', { 
        detail: progressEvent 
      }));
    }
  }
  
  private async renderCompleteScore(jobId: string, chunks: ChunkInfo[]): Promise<void> {
    if (!this.osmd) return;
    
    // Find the complete chunk (should be the last one)
    const completeChunk = chunks.find(c => c.type === 'complete');
    if (!completeChunk) {
      throw new Error('No complete chunk found');
    }
    
    // Re-render with complete content
    await this.osmd.load(completeChunk.content);
    await this.osmd.render();
    
    // Get actual measure count from OSMD
    const totalMeasures = this.osmd.sheet?.SourceMeasures?.length || completeChunk.measureCount;
    
    // Notify UI that complete score is ready
    const progressEvent: ProgressEvent = {
      jobId,
      totalMeasures,
      stage: 'complete-render'
    };
    
    this.emit('complete-render', progressEvent);
    
    // Also emit to window for global event handling
    if (window.api) {
      window.dispatchEvent(new CustomEvent('osmd:complete-render', { 
        detail: progressEvent 
      }));
    }
    
    // Clean up chunks for this job
    this.chunks.delete(jobId);
  }
  
  getOSMD(): OpenSheetMusicDisplay | null {
    return this.osmd;
  }
  
  getCurrentJobId(): string | null {
    return this.currentJobId;
  }
  
  clear(): void {
    if (this.osmd) {
      this.osmd.clear();
    }
    this.currentJobId = null;
    this.chunks.clear();
  }
  
  destroy(): void {
    this.clear();
    if (window.api) {
      window.api.removeAllListeners('file:chunk');
    }
    this.removeAllListeners();
    this.osmd = null;
    this.container = null;
  }
}

// Export singleton instance
export const progressiveOSMDLoader = new ProgressiveOSMDLoader();