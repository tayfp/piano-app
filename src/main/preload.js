"use strict";
var import_performance_logger = require("./utils/performance-logger");
const { contextBridge, ipcRenderer } = require("electron");
import_performance_logger.perfLogger.debug("[PRELOAD] Urtext Piano preload script loaded successfully");
if (process.env.NODE_ENV === "development") {
  import_performance_logger.perfLogger.debug("[PRELOAD] Process info", {
    cwd: process.cwd(),
    env: process.env.NODE_ENV,
    platform: process.platform
  });
}
if (process.env.NODE_ENV === "development") {
  const isVerbose = process.env.DEBUG === "verbose" || process.env.ELECTRON_DEBUG === "true";
  if (isVerbose) {
    import_performance_logger.perfLogger.debug("[PRELOAD] Security check", {
      nodeIntegration: process.versions ? "ENABLED (INSECURE)" : "DISABLED",
      contextIsolation: window === self ? "DISABLED (INSECURE)" : "ENABLED",
      sandbox: typeof require === "undefined" ? "ENABLED" : "DISABLED"
    });
  }
}
contextBridge.exposeInMainWorld("electronAPI", {
  // File operations - returns FileData directly (synchronous-style for FileLoaderService)
  openFile: () => ipcRenderer.invoke("dialog:openFileSync"),
  // Drag-drop file operations - handles ArrayBuffer for .mxl files
  loadDroppedFile: (fileName, fileBuffer) => ipcRenderer.invoke("file:loadContent", fileName, fileBuffer),
  // CRITICAL FIX: Fast path to get file content by ID
  getFileContent: (fileId) => ipcRenderer.invoke("file:getContent", fileId)
});
contextBridge.exposeInMainWorld("api", {
  // File operations
  openFile: () => ipcRenderer.invoke("dialog:openFile"),
  getFileContent: (jobId) => ipcRenderer.invoke("file:getContent", jobId),
  // Event listeners
  on: (channel, callback) => {
    const validChannels = ["file:ready", "file:error", "file:chunk"];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
  // Remove listeners
  removeAllListeners: (channel) => {
    const validChannels = ["file:ready", "file:error", "file:chunk"];
    if (validChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  }
});
