// ChunkProcessor is integrated into fileProcessor.ts
// This file exists for compatibility with tests

export { processFileWithStreaming as ChunkProcessor } from './fileProcessor';

// Re-export streaming functionality
export { StreamingMusicXMLParser } from '../parsers/streamingMusicXMLParser';