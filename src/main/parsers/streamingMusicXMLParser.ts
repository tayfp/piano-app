import { Transform, TransformCallback } from 'stream';

interface StreamingParserOptions {
  chunkSize?: number;
  maxBufferSize?: number;
  firstChunkMeasures?: number;
}

interface MeasureData {
  number: number;
  content: string;
}

export class StreamingMusicXMLParser extends Transform {
  private readonly chunkSize: number;
  private readonly maxBufferSize: number;
  private readonly firstChunkMeasures: number;
  private buffer = '';
  private measuresSent = 0;
  private measureBuffer: MeasureData[] = [];
  private isFirstChunkSent = false;
  private headerContent = '';
  private inHeader = true;
  
  constructor(options: StreamingParserOptions = {}) {
    super({ 
      encoding: 'utf8',
      objectMode: false,
      highWaterMark: options.chunkSize || 64 * 1024
    });
    
    this.chunkSize = options.chunkSize || 64 * 1024;
    this.maxBufferSize = options.maxBufferSize || 10 * 1024 * 1024;
    this.firstChunkMeasures = options.firstChunkMeasures || 4;
  }
  
  getChunkSize(): number {
    return this.chunkSize;
  }
  
  _transform(chunk: any, encoding: string, callback: TransformCallback): void {
    try {
      // Add chunk to buffer
      this.buffer += chunk.toString();
      
      // Check buffer size limit
      if (this.buffer.length > this.maxBufferSize) {
        return callback(new Error(`Buffer size exceeded maximum of ${this.maxBufferSize} bytes`));
      }
      
      // Extract header if still parsing it
      if (this.inHeader) {
        this.extractHeader();
      }
      
      // Extract complete measures
      const measures = this.extractCompleteMeasures();
      
      // Emit individual measure events
      for (const measure of measures) {
        this.emit('measure', {
          number: measure.number,
          content: measure.content,
          index: this.measuresSent++
        });
        this.measureBuffer.push(measure);
      }
      
      // Send first chunk if we have enough measures
      if (!this.isFirstChunkSent && this.measureBuffer.length >= this.firstChunkMeasures) {
        this.sendFirstChunk();
      }
      
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }
  
  _flush(callback: TransformCallback): void {
    try {
      // Process any remaining buffer content
      if (this.buffer.trim()) {
        const remainingMeasures = this.extractCompleteMeasures(true);
        
        for (const measure of remainingMeasures) {
          this.emit('measure', {
            number: measure.number,
            content: measure.content,
            index: this.measuresSent++
          });
          this.measureBuffer.push(measure);
        }
      }
      
      // Send complete chunk
      if (this.measureBuffer.length > 0) {
        const completeXML = this.createCompleteXML();
        this.emit('complete', {
          content: completeXML,
          totalMeasures: this.measureBuffer.length
        });
      }
      
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }
  
  private extractHeader(): void {
    // Look for the start of the first part
    const partMatch = this.buffer.match(/^([\s\S]*?)(<part\s+id="[^"]+"\s*>)/);
    if (partMatch) {
      this.headerContent = partMatch[1] + partMatch[2];
      this.inHeader = false;
      // Remove header from buffer to avoid re-processing
      this.buffer = this.buffer.substring(partMatch[0].length);
    }
  }
  
  private extractCompleteMeasures(flush = false): MeasureData[] {
    const measures: MeasureData[] = [];
    const measureRegex = /<measure\s+number="(\d+)"[^>]*>[\s\S]*?<\/measure>/g;
    
    let match;
    let lastIndex = 0;
    
    while ((match = measureRegex.exec(this.buffer)) !== null) {
      const measureNumber = parseInt(match[1], 10);
      measures.push({
        number: measureNumber,
        content: match[0]
      });
      lastIndex = match.index + match[0].length;
    }
    
    // Keep unparsed content in buffer unless flushing
    if (lastIndex > 0 && !flush) {
      this.buffer = this.buffer.substring(lastIndex);
    } else if (flush) {
      // First, trim the buffer to only contain unparsed content
      if (lastIndex > 0) {
        this.buffer = this.buffer.substring(lastIndex);
      }
      
      // When flushing, try to extract any partial measure from the remaining buffer
      const partialMatch = this.buffer.match(/<measure\s+number="(\d+)"[^>]*>[\s\S]*/);
      if (partialMatch) {
        // This is incomplete but we're flushing
        measures.push({
          number: parseInt(partialMatch[1], 10),
          content: partialMatch[0] + '</measure>' // Close it artificially
        });
      }
      this.buffer = '';
    }
    
    return measures;
  }
  
  private sendFirstChunk(): void {
    const firstMeasures = this.measureBuffer.slice(0, this.firstChunkMeasures);
    const firstChunkXML = this.createValidXML(firstMeasures);
    
    this.emit('first-chunk', {
      content: firstChunkXML,
      measureCount: firstMeasures.length
    });
    
    this.isFirstChunkSent = true;
  }
  
  private createValidXML(measures: MeasureData[]): string {
    const header = this.headerContent || this.getMinimalHeader();
    const footer = `
    </part>
  </score-partwise>`;
    
    const measureContent = measures.map(m => m.content).join('\n    ');
    return header + '\n    ' + measureContent + footer;
  }
  
  private createCompleteXML(): string {
    return this.createValidXML(this.measureBuffer);
  }
  
  private getMinimalHeader(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">`;
  }
}