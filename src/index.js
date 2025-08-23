const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('fs').promises;
const crypto = require('crypto');
const unzipper = require('unzipper');
const { pipeline } = require('stream/promises');
const { XMLParser } = require('fast-xml-parser');

// Enable TypeScript support for preload in development
if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
  try {
    require('ts-node').register({
      transpileOnly: true,
      compilerOptions: {
        module: 'CommonJS'
      }
    });
  } catch (error) {
    // ts-node not available, preload must be JavaScript in development
  }
}

// Import configuration and custom streams
const { AppConfig } = require('./main/config.js');
const { SizeCheckStream } = require('./main/streams/SizeCheckStream.js');

// File operation queue to prevent concurrent access issues
const fileOperationQueue = [];
let isProcessingFile = false;
let currentOperation = null;

// Helper function for cancellation
function throwIfAborted(signal) {
  if (signal.aborted) {
    const error = new Error('Operation cancelled');
    error.name = 'AbortError';
    throw error;
  }
}

async function processFileQueue() {
  if (isProcessingFile || fileOperationQueue.length === 0) return;
  
  isProcessingFile = true;
  currentOperation = fileOperationQueue.shift();
  const { operation, resolve, reject, abortController } = currentOperation;
  
  try {
    // Check if already cancelled
    if (abortController.signal.aborted) {
      reject(new Error('Operation cancelled'));
      return;
    }
    
    const result = await operation(abortController.signal);
    
    // Check if cancelled during operation
    if (abortController.signal.aborted) {
      reject(new Error('Operation cancelled'));
    } else {
      resolve(result);
    }
  } catch (error) {
    reject(error);
  } finally {
    currentOperation = null;
    isProcessingFile = false;
    processFileQueue(); // Process next in queue
  }
}

function queueFileOperation(operation) {
  const abortController = new AbortController();
  
  const promise = new Promise((resolve, reject) => {
    fileOperationQueue.push({ operation, resolve, reject, abortController });
    processFileQueue();
  });
  
  // Add cancel method to promise
  promise.cancel = () => {
    abortController.abort();
    // Remove from queue if not yet processed
    const index = fileOperationQueue.findIndex(item => item.abortController === abortController);
    if (index !== -1) {
      fileOperationQueue.splice(index, 1);
    }
  };
  
  return promise;
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window with optimal piano dimensions
  const mainWindow = new BrowserWindow({
    width: 1680,     // Optimal default for full piano (1600px + padding)
    height: 720,     // Space for piano (180px) + content area (540px)
    minWidth: 1120,  // Minimum for usable piano (1080px + padding)
    minHeight: 400,  // Minimum for piano (120px) + basic content
    show: false,     // Prevent flash during load
    webPreferences: {
      // Enable context isolation and disable node integration
      nodeIntegration: false,         // Disable Node.js access in renderer
      contextIsolation: true,         // Enable context isolation
      sandbox: false,                 // Keep false for now (Step 2)
      preload: path.join(__dirname, '../dist/preload.js'),
      webSecurity: true,              // Enable web security
    },
  });

  // and load the index.html of the app.
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
    // In development, load from Vite dev server
    mainWindow.loadURL('http://localhost:3000');
  } else {
    // In production, load the built files
    mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
  }

  // Set up MIDI permissions for WebMIDI API
  // Based on research: Electron requires explicit permission handlers for MIDI access
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    // Permission request
    if (permission === 'midi' || permission === 'midiSysex') {
      // Auto-approve MIDI permissions for piano learning app
      callback(true);
    } else {
      // Deny other permissions by default
      callback(false);
    }
  });

  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    // Permission check
    if (permission === 'midi' || permission === 'midiSysex') {
      return true;
    }
    return false;
  });

  // Set CSP headers - different policies for dev vs production
  // CRITICAL: Set CSP before any content loads to prevent security warnings
  const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
  
  // Apply CSP as early as possible in the session lifecycle
  mainWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    // Allow all requests but ensure CSP is active
    callback({ cancel: false });
  });
  
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    // Development CSP - relaxed to allow Vite HMR and React DevTools
    const devCSP = 
      "default-src 'self' http://localhost:3000 http://localhost:3001; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:3000 http://localhost:3001; " +  // Required for Vite HMR
      "style-src 'self' 'unsafe-inline' http://localhost:3000 http://localhost:3001; " +
      "img-src 'self' data: blob: http://localhost:3000 http://localhost:3001; " +
      "media-src 'self' blob:; " +
      "connect-src 'self' ws://localhost:3000 ws://localhost:3001 http://localhost:3000 http://localhost:3001 ws: wss:;";  // WebSocket for HMR
    
    // Production CSP - strict security
    const prodCSP = 
      "default-src 'self'; " +
      "script-src 'self'; " +  // No unsafe-eval or unsafe-inline in production
      "style-src 'self' 'unsafe-inline'; " +  // Keep unsafe-inline for existing inline styles
      "img-src 'self' data: blob:; " +
      "media-src 'self' blob:; " +
      "connect-src 'self';";  // No websockets in production
    
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [isDev ? devCSP : prodCSP]
      }
    });
  });
  
  // Also set CSP via protocol to ensure it's applied early
  if (!isDev) {
    mainWindow.webContents.session.protocol.interceptHttpProtocol('http', (request, callback) => {
      callback(request);
    });
    
    mainWindow.webContents.session.protocol.interceptHttpProtocol('https', (request, callback) => {
      callback(request);
    });
  }

  // Open the DevTools in development
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Show window when ready to prevent flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  return mainWindow;
};

// CRITICAL FIX: Import enhanced handlers ONLY if we're using them
// This prevents double registration issues
// 
// IPC Handler Registration Flow:
// 1. If USE_ENHANCED_FILE_HANDLER !== 'false' (default true):
//    - Imports fileHandlers.ts which registers handlers on load
//    - Later skips legacy registration in registerFileHandlers()
// 2. If USE_ENHANCED_FILE_HANDLER === 'false':
//    - Skips fileHandlers.ts import
//    - Uses legacy handlers in registerFileHandlers()
//
const USE_ENHANCED_FILE_HANDLER = process.env.USE_ENHANCED_FILE_HANDLER !== 'false';
if (USE_ENHANCED_FILE_HANDLER) {
  // Loading enhanced file handlers from fileHandlers.ts (tempo extraction enabled)
  require('./main/handlers/fileHandlers');
  // Enhanced handlers loaded - will skip legacy registration later
} else {
  // Enhanced file handlers disabled - will use legacy handlers
}

// Register IPC handlers for file operations
// Helper: coerce incoming data to Node Buffer safely
function toNodeBuffer(input) {
  // If it's already a Buffer, return as-is
  if (Buffer.isBuffer(input)) {
    return input;
  }
  // If it's an ArrayBuffer, wrap it
  if (input instanceof ArrayBuffer) {
    return Buffer.from(input);
  }
  throw new Error('Invalid file buffer provided');
}

function registerFileHandlers() {
  // Secure XML parser configuration (prevents XXE attacks)
  const xmlParser = new XMLParser(AppConfig.xmlParserOptions);

  ipcMain.handle('dialog:openFile', async () => {
    // Remove queue for file dialog operations to improve performance
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: AppConfig.dialogFilters
    });

    if (canceled || filePaths.length === 0) {
      return null; // User cancelled
    }

    const filePath = filePaths[0];
    
    // Security: Normalize and validate path
    const normalizedPath = path.resolve(path.normalize(filePath));
    
    // Check file exists and get stats
    const stats = await fs.stat(normalizedPath);
    if (!stats.isFile()) {
      throw new Error('Selected path is not a file');
    }
    
    if (stats.size > AppConfig.limits.MAX_COMPRESSED_FILE_SIZE_BYTES) {
      throw new Error(`File too large. Maximum size is ${AppConfig.limits.MAX_COMPRESSED_FILE_SIZE_BYTES / 1024 / 1024}MB`);
    }

    const fileName = path.basename(normalizedPath);
    const ext = path.extname(normalizedPath).toLowerCase();
    
    // Validate file extension
    const allowedExtensions = ['.xml', '.musicxml', '.mxl'];
    if (!allowedExtensions.includes(ext)) {
      throw new Error(`Unsupported file type: ${ext}. Please select a MusicXML file (.xml, .musicxml, or .mxl)`);
    }

    let content;
    
    if (ext === '.mxl') {
      // Handle compressed MusicXML with async unzipper
      content = await queueFileOperation(async (signal) => {
        return await processMXLFile(normalizedPath, xmlParser, signal);
      });
    } else {
      // Direct XML read - skip validation in main process for performance
      // Renderer will validate with OSMD
      content = await fs.readFile(normalizedPath, 'utf-8');
      
      // Basic check for XML structure only
      if (!content.includes('<?xml')) {
        throw new Error('File does not appear to be a valid XML file');
      }
    }
    
    // CRITICAL FIX: Store content in memory and return an ID for fast IPC
    // This prevents sending large content over IPC which causes 1764ms delays
    const fileId = crypto.randomUUID();
    global.fileCache = global.fileCache || new Map();
    global.fileCache.set(fileId, { fileName, content, fileSize: stats.size });
    
    // Clean up after 5 minutes to prevent memory leaks
    setTimeout(() => {
      global.fileCache.delete(fileId);
    }, 5 * 60 * 1000);
    
    // Return minimal payload for fast IPC
    return {
      fileName,
      fileId,
      fileSize: stats.size
    };
  });

  // Handle drag-dropped file content with ArrayBuffer data
  ipcMain.handle('file:loadContent', async (event, fileName, fileBuffer) => {
    // Validate input parameters
    if (!fileName || typeof fileName !== 'string') {
      throw new Error('Invalid file name provided');
    }

    // ✅ accept Buffer OR ArrayBuffer
    const buf = toNodeBuffer(fileBuffer);

    // Security: Check buffer size limit
    if (buf.byteLength > AppConfig.limits.MAX_COMPRESSED_FILE_SIZE_BYTES) {
      throw new Error(`File too large. Maximum size is ${AppConfig.limits.MAX_COMPRESSED_FILE_SIZE_BYTES / 1024 / 1024}MB`);
    }
    
    // Sanitize file name to prevent path traversal
    const sanitizedFileName = path.basename(fileName);
    const ext = path.extname(sanitizedFileName).toLowerCase();
    
    let content;

    if (ext === '.mxl') {
      // Handle compressed MusicXML from ArrayBuffer/Buffer
      content = await queueFileOperation(async (signal) => {
        return await processMXLBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), xmlParser, signal);
      });
    } else {
      // Direct XML — defer deep validation to renderer (OSMD)
      content = buf.toString('utf-8');
      if (!content.includes('<?xml')) {
        throw new Error('File does not appear to be a valid XML file');
      }
    }

    const fileId = crypto.randomUUID();
    global.fileCache = global.fileCache || new Map();
    global.fileCache.set(fileId, { fileName: sanitizedFileName, content, fileSize: buf.byteLength });
    setTimeout(() => global.fileCache.delete(fileId), 5 * 60 * 1000);

    return { fileName: sanitizedFileName, fileId, fileSize: buf.byteLength };
  });
  
  // CRITICAL FIX: New handler to fetch content by ID (fast path)
  ipcMain.handle('file:getContent', async (event, fileId) => {
    if (!fileId || typeof fileId !== 'string') {
      throw new Error('Invalid file ID');
    }
    
    const cached = global.fileCache?.get(fileId);
    if (!cached) {
      throw new Error('File not found or expired');
    }
    
    return cached.content;
  });

  // CRITICAL FIX: Feature flag to disable duplicate handler
  // Set USE_ENHANCED_FILE_HANDLER=true to use fileHandlers.ts (with tempo extraction)
  // Set USE_ENHANCED_FILE_HANDLER=false to use legacy index.js handler (fallback)
  const useEnhancedHandler = process.env.USE_ENHANCED_FILE_HANDLER !== 'false';
  
  if (!useEnhancedHandler) {
    // Registering LEGACY file handler (index.js) - tempo extraction disabled
    // HOTFIX: Add missing dialog:openFileSync handler 
    ipcMain.handle('dialog:openFileSync', async () => {
    // Reuse existing logic from dialog:openFile but return immediately
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: AppConfig.dialogFilters
    });

    if (canceled || filePaths.length === 0) {
      return null; // User cancelled
    }

    const filePath = filePaths[0];
    
    // Security: Normalize and validate path
    const normalizedPath = path.resolve(path.normalize(filePath));
    
    // Check file exists and get stats
    const stats = await fs.stat(normalizedPath);
    if (!stats.isFile()) {
      throw new Error('Selected path is not a file');
    }
    
    if (stats.size > AppConfig.limits.MAX_COMPRESSED_FILE_SIZE_BYTES) {
      throw new Error(`File too large. Maximum size is ${AppConfig.limits.MAX_COMPRESSED_FILE_SIZE_BYTES / 1024 / 1024}MB`);
    }

    const fileName = path.basename(normalizedPath);
    const ext = path.extname(normalizedPath).toLowerCase();
    
    // Validate file extension
    const allowedExtensions = ['.xml', '.musicxml', '.mxl'];
    if (!allowedExtensions.includes(ext)) {
      throw new Error(`Unsupported file type: ${ext}. Please select a MusicXML file (.xml, .musicxml, or .mxl)`);
    }

    let content;
    
    if (ext === '.mxl') {
      // Handle compressed MusicXML with async unzipper
      content = await queueFileOperation(async (signal) => {
        return await processMXLFile(normalizedPath, xmlParser, signal);
      });
    } else {
      // Direct XML read - skip validation in main process for performance
      // Renderer will validate with OSMD
      content = await fs.readFile(normalizedPath, 'utf-8');
      
      // Basic check for XML structure only
      if (!content.includes('<?xml')) {
        throw new Error('File does not appear to be a valid XML file');
      }
    }
    
    // Store content in cache for consistency with other handlers
    const fileId = crypto.randomUUID();
    global.fileCache = global.fileCache || new Map();
    global.fileCache.set(fileId, { fileName, content, fileSize: stats.size });
    
    // Clean up after 5 minutes to prevent memory leaks
    setTimeout(() => {
      global.fileCache.delete(fileId);
    }, 5 * 60 * 1000);
    
    // Return direct content for synchronous API compatibility
    return {
      fileName,
      content,
      fileSize: stats.size,
      fileId
    };
    });
  } else {
    // Skipping legacy handler - using ENHANCED file handler (fileHandlers.ts) with tempo extraction
    // Enhanced handler was already registered by the require() statement above
    // No duplicate registration needed here
  }
}

// Process MXL (compressed MusicXML) files with security validation
async function processMXLFile(filePath, xmlParser, signal) {
  throwIfAborted(signal);
  
  const directory = await unzipper.Open.file(filePath);
  throwIfAborted(signal);
  
  // Find the main XML file from container.xml
  let scoreEntryPath;
  const containerEntry = directory.files.find(f => f.path === 'META-INF/container.xml');
  
  if (containerEntry) {
    const containerBuffer = await containerEntry.buffer();
    const containerContent = containerBuffer.toString('utf-8');
    throwIfAborted(signal);
    
    // Parse container.xml securely
    try {
      throwIfAborted(signal);
      const containerData = xmlParser.parse(containerContent);
      
      // Extract score path safely
      if (containerData.container?.rootfiles?.rootfile) {
        const rootfile = Array.isArray(containerData.container.rootfiles.rootfile) 
          ? containerData.container.rootfiles.rootfile[0]
          : containerData.container.rootfiles.rootfile;
        
        if (rootfile && typeof rootfile['@_full-path'] === 'string') {
          scoreEntryPath = rootfile['@_full-path'];
        }
      }
    } catch (error) {
      throw new Error('Invalid container.xml in MXL archive');
    }
    
    // Security: Validate the extracted path
    if (scoreEntryPath) {
      const cleanPath = path.normalize(scoreEntryPath);
      if (cleanPath.includes('..') || path.isAbsolute(cleanPath)) {
        throw new Error('Invalid path in container.xml: potential security risk');
      }
    }
  }
  
  // Find the score file
  let scoreFileEntry = scoreEntryPath 
    ? directory.files.find(f => f.path === scoreEntryPath)
    : null;
  
  // Fallback: find any .xml file not in META-INF
  if (!scoreFileEntry) {
    scoreFileEntry = directory.files.find(f => 
      f.path.endsWith('.xml') && 
      !f.path.startsWith('META-INF/')
    );
  }
  
  if (!scoreFileEntry) {
    throw new Error('No valid MusicXML file found in the MXL archive');
  }
  
  // Stream the entry with size limit to prevent zip bombs
  const content = await new Promise((resolve, reject) => {
    const chunks = [];
    const stream = scoreFileEntry.stream();
    const sizeChecker = new SizeCheckStream(AppConfig.limits.MAX_UNCOMPRESSED_FILE_SIZE_BYTES);
    
    // Set up pipeline for proper resource cleanup
    pipeline(stream, sizeChecker).catch(reject);
    
    // Collect chunks from the size checker
    sizeChecker.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    sizeChecker.on('end', () => {
      const content = Buffer.concat(chunks).toString('utf-8');
      resolve(content);
    });
    
    sizeChecker.on('error', (error) => {
      reject(new Error(`Failed to extract file: ${error.message}`));
    });
  });
  
  // Validate and parse the extracted XML
  throwIfAborted(signal);
  return await validateAndParseXML(content, xmlParser);
}

// Process MXL ArrayBuffer (for drag-drop) with security validation
async function processMXLBuffer(arrayBuffer, xmlParser, signal) {
  throwIfAborted(signal);
  
  // Convert ArrayBuffer to Buffer for unzipper
  const buffer = Buffer.from(arrayBuffer);
  
  // Use unzipper to parse buffer directly
  const directory = await unzipper.Open.buffer(buffer);
  throwIfAborted(signal);
  
  // Find the main XML file from container.xml (same logic as file version)
  let scoreEntryPath;
  const containerEntry = directory.files.find(f => f.path === 'META-INF/container.xml');
  
  if (containerEntry) {
    const containerBuffer = await containerEntry.buffer();
    const containerContent = containerBuffer.toString('utf-8');
    throwIfAborted(signal);
    
    // Parse container.xml securely
    try {
      throwIfAborted(signal);
      const containerData = xmlParser.parse(containerContent);
      
      // Extract score path safely
      if (containerData.container?.rootfiles?.rootfile) {
        const rootfile = Array.isArray(containerData.container.rootfiles.rootfile) 
          ? containerData.container.rootfiles.rootfile[0]
          : containerData.container.rootfiles.rootfile;
        
        if (rootfile && typeof rootfile['@_full-path'] === 'string') {
          scoreEntryPath = rootfile['@_full-path'];
        }
      }
    } catch (error) {
      throw new Error('Invalid container.xml in MXL archive');
    }
    
    // Security: Validate the extracted path
    if (scoreEntryPath) {
      const cleanPath = path.normalize(scoreEntryPath);
      if (cleanPath.includes('..') || path.isAbsolute(cleanPath)) {
        throw new Error('Invalid path in container.xml: potential security risk');
      }
    }
  }
  
  // Find the score file
  let scoreFileEntry = scoreEntryPath 
    ? directory.files.find(f => f.path === scoreEntryPath)
    : null;
  
  // Fallback: find any .xml file not in META-INF
  if (!scoreFileEntry) {
    scoreFileEntry = directory.files.find(f => 
      f.path.endsWith('.xml') && 
      !f.path.startsWith('META-INF/')
    );
  }
  
  if (!scoreFileEntry) {
    throw new Error('No valid MusicXML file found in the MXL archive');
  }
  
  // Stream the entry with size limit to prevent zip bombs
  const content = await new Promise((resolve, reject) => {
    const chunks = [];
    const stream = scoreFileEntry.stream();
    const sizeChecker = new SizeCheckStream(AppConfig.limits.MAX_UNCOMPRESSED_FILE_SIZE_BYTES);
    
    // Set up pipeline for proper resource cleanup
    pipeline(stream, sizeChecker).catch(reject);
    
    // Collect chunks from the size checker
    sizeChecker.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    sizeChecker.on('end', () => {
      const content = Buffer.concat(chunks).toString('utf-8');
      resolve(content);
    });
    
    sizeChecker.on('error', (error) => {
      reject(new Error(`Failed to extract file: ${error.message}`));
    });
  });
  
  // Validate and parse the extracted XML
  throwIfAborted(signal);
  return await validateAndParseXML(content, xmlParser);
}

// Validate and parse XML content securely
async function validateAndParseXML(content, xmlParser) {
  // Fast structural checks
  if (!content || typeof content !== 'string' || !content.includes('<?xml')) {
    throw new Error('File does not appear to be a valid XML file');
  }

  // Synchronous parse — validates xml well-formedness
  try {
    xmlParser.parse(content);
  } catch (error) {
    throw new Error(`Invalid XML structure: ${error.message}`);
  }

  // MusicXML flavor check
  if (!content.includes('<score-partwise') && !content.includes('<score-timewise')) {
    throw new Error('File does not appear to be valid MusicXML format');
  }

  return content;
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Conditional IPC handler registration
  // Feature flag to enable new enhanced handlers with worker threads
  // Usage: ENABLE_NEW_IPC=true npm run electron:dev
  // Additional flags:
  //   ENABLE_GRADUAL_ROLLOUT=true ROLLOUT_PERCENTAGE=50 (A/B testing)
  //   ENABLE_PERF_MONITORING=true (latency monitoring)
  const useEnhancedHandlers = process.env.ENABLE_NEW_IPC === 'true';
  
  if (useEnhancedHandlers) {
    // Using enhanced IPC handlers with worker threads
    try {
      // Import and use the centralized registration system
      const { registerAllIpcHandlers } = require('./main/ipcRegistration.ts');
      registerAllIpcHandlers({
        enableWorkerThreads: true,
        enableGradualRollout: process.env.ENABLE_GRADUAL_ROLLOUT === 'true',
        rolloutPercentage: parseInt(process.env.ROLLOUT_PERCENTAGE || '100'),
        enablePerformanceMonitoring: process.env.ENABLE_PERF_MONITORING === 'true'
      });
    } catch (error) {
      // Failed to load enhanced handlers, falling back to legacy
      registerFileHandlers(); // Fallback to legacy
    }
  } else {
    // Check if enhanced file handlers were already loaded
    const usingEnhancedFileHandler = process.env.USE_ENHANCED_FILE_HANDLER !== 'false';
    if (usingEnhancedFileHandler) {
      // Enhanced file handlers already loaded - skipping legacy registration
    } else {
      // Using legacy IPC handlers
      registerFileHandlers(); // Existing legacy implementation
    }
  }

  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup handler for app shutdown
app.on('before-quit', () => {
  // Clear any pending file operations
  fileOperationQueue.length = 0;
  
  // Cancel current operation if running
  if (currentOperation && currentOperation.abortController) {
    currentOperation.abortController.abort();
  }
});

// Export queue function for testing
module.exports = { queueFileOperation };

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
