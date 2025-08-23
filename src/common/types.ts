// Shared types across main and renderer processes
// This prevents type drift across the IPC boundary

export interface FileData {
  fileName: string;
  content?: string;    // Optional - fetched separately for performance
  fileId?: string;     // Used to fetch content via fast path
  fileSize: number;
}

export interface RecentFile {
  name: string;
  path: string;
  date: string;
  size: number;
}

// Union type for file loading states
export type LoadState = 'idle' | 'loading' | 'success' | 'error';

// Tempo extraction types (Version Direct XML Tempo Extraction)
export interface XMLTempoEvent {
  measureNumber: number;
  bpm: number;
  offset?: number;     // Position in divisions (validated 0-10000)
  beat?: number;       // Calculated from offset
  text?: string;       // "Andantino", "Moderato", etc.
  source: 'direction' | 'sound' | 'metronome';
  sourceMeasure?: number;  // Future-proofing
  sourcePart?: string;     // Future-proofing
}

// Export for use in both main and renderer processes
export type { FileData as IPCFileData };