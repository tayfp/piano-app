const { Transform } = require('stream');

/**
 * A transform stream that monitors the size of data passing through
 * and throws an error if it exceeds the specified limit.
 * Used to prevent zip bombs and excessive memory usage.
 */
class SizeCheckStream extends Transform {
  constructor(maxSize) {
    super();
    this.maxSize = maxSize;
    this.currentSize = 0;
  }

  _transform(chunk, encoding, callback) {
    this.currentSize += chunk.length;
    
    if (this.currentSize > this.maxSize) {
      const error = new Error(`File size exceeds maximum allowed size of ${this.maxSize} bytes`);
      error.code = 'FILE_TOO_LARGE';
      return callback(error);
    }
    
    // Pass the chunk through unchanged
    this.push(chunk);
    callback();
  }

  _flush(callback) {
    // Nothing to flush
    callback();
  }
}

module.exports = { SizeCheckStream };