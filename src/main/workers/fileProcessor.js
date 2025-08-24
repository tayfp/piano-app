"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var fileProcessor_exports = {};
__export(fileProcessor_exports, {
  processFile: () => processFile,
  processFileWithParams: () => processFileWithParams,
  processFileWithStreaming: () => processFileWithStreaming,
  processMXLFile: () => processMXLFile,
  validateXMLContent: () => validateXMLContent
});
module.exports = __toCommonJS(fileProcessor_exports);
var import_worker_threads = require("worker_threads");
var fs = __toESM(require("fs/promises"));
var import_fs = require("fs");
var path = __toESM(require("path"));
var import_fast_xml_parser = require("fast-xml-parser");
var unzipper = __toESM(require("unzipper"));
var import_performanceLogger = require("../utils/performanceLogger");
var import_streamingMusicXMLParser = require("../parsers/streamingMusicXMLParser");
var import_musicXMLTempoExtractor = require("../parsers/musicXMLTempoExtractor");
function sendTelemetry(type, payload = {}) {
  if (!import_worker_threads.parentPort) return;
  import_worker_threads.parentPort.postMessage({
    __telemetry: true,
    type,
    ts: performance.now(),
    ...payload
  });
}
function extractTempoData(content) {
  try {
    import_performanceLogger.performanceLogger.mark("tempo-extract-start");
    const tempoExtractor = new import_musicXMLTempoExtractor.MusicXMLTempoExtractor();
    const tempoData = tempoExtractor.extract(content);
    import_performanceLogger.performanceLogger.mark("tempo-extract-end");
    const extractTime = import_performanceLogger.performanceLogger.measure("tempo-extract-start", "tempo-extract-end");
    sendTelemetry("tempo:extracted", {
      count: tempoData.length,
      extractTime,
      hasPositions: tempoData.some((t) => t.offset !== void 0)
    });
    return tempoData;
  } catch (error) {
    return void 0;
  }
}
async function readAndValidateFile(normalizedPath) {
  const ext = path.extname(normalizedPath).toLowerCase();
  let content;
  import_performanceLogger.performanceLogger.mark("read-start");
  if (ext === ".mxl") {
    content = await processMXLFile(normalizedPath);
  } else if ([".xml", ".musicxml"].includes(ext)) {
    content = await fs.readFile(normalizedPath, "utf-8");
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }
  import_performanceLogger.performanceLogger.mark("read-end");
  const readTime = import_performanceLogger.performanceLogger.measure("read-start", "read-end");
  import_performanceLogger.performanceLogger.mark("validate-start");
  validateXMLContent(content);
  import_performanceLogger.performanceLogger.mark("validate-end");
  return { content, readTime };
}
async function validateAndStatFile(filePath) {
  const normalizedPath = path.normalize(filePath);
  if (!path.isAbsolute(normalizedPath)) {
    throw new Error("Invalid file path");
  }
  import_performanceLogger.performanceLogger.mark("stat-start");
  const stats = await fs.stat(normalizedPath);
  import_performanceLogger.performanceLogger.mark("stat-end");
  const MAX_FILE_SIZE = 100 * 1024 * 1024;
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB (max: 100MB)`);
  }
  return { normalizedPath, stats };
}
async function processFile() {
  var _a, _b;
  const { filePath, jobId } = import_worker_threads.workerData;
  try {
    import_performanceLogger.performanceLogger.mark("worker-start");
    sendTelemetry("worker:start", { filePath: path.basename(filePath) });
    const { normalizedPath, stats } = await validateAndStatFile(filePath);
    sendTelemetry("file:stats", {
      size: stats.size,
      sizeMB: (stats.size / 1024 / 1024).toFixed(2)
    });
    const STREAMING_THRESHOLD = 1024 * 1024;
    if (stats.size > STREAMING_THRESHOLD) {
      sendTelemetry("processing:mode", { mode: "streaming", threshold: STREAMING_THRESHOLD });
      await processFileWithStreaming(normalizedPath, jobId, stats.size);
      return;
    }
    sendTelemetry("processing:mode", { mode: "synchronous", threshold: STREAMING_THRESHOLD });
    const { content, readTime } = await readAndValidateFile(normalizedPath);
    const tempoData = extractTempoData(content);
    import_performanceLogger.performanceLogger.mark("worker-end");
    const totalTime = import_performanceLogger.performanceLogger.measure("worker-start", "worker-end");
    sendTelemetry("worker:complete", {
      readTime,
      totalTime,
      contentLength: content.length
    });
    const result = {
      success: true,
      jobId,
      content,
      fileName: path.basename(normalizedPath),
      fileSize: stats.size,
      tempoData,
      performance: {
        readTime,
        parseTime: import_performanceLogger.performanceLogger.measure("validate-start", "validate-end"),
        totalTime
      }
    };
    (_a = import_worker_threads.parentPort) == null ? void 0 : _a.postMessage(result);
  } catch (error) {
    const errorResult = {
      success: false,
      jobId,
      error: error instanceof Error ? error.message : "Unknown error"
    };
    (_b = import_worker_threads.parentPort) == null ? void 0 : _b.postMessage(errorResult);
  }
}
async function processMXLFile(filePath) {
  import_performanceLogger.performanceLogger.mark("unzip-start");
  const directory = await unzipper.Open.file(filePath);
  const scoreFile = directory.files.find(
    (file) => file.path.endsWith(".xml") && !file.path.startsWith("META-INF/") && !file.path.includes("container.xml")
  );
  if (!scoreFile) {
    throw new Error("No MusicXML score file found in MXL archive");
  }
  const content = await scoreFile.buffer();
  import_performanceLogger.performanceLogger.mark("unzip-end");
  import_performanceLogger.performanceLogger.measure("unzip-start", "unzip-end", "MXL Extraction");
  return content.toString("utf-8");
}
function validateXMLContent(content) {
  if (!content.includes("<?xml")) {
    throw new Error("Invalid XML: Missing XML declaration");
  }
  if (!content.includes("<score-partwise") && !content.includes("<score-timewise")) {
    throw new Error("Invalid MusicXML: Missing score element");
  }
  const parser = new import_fast_xml_parser.XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false
  });
  try {
    parser.parse(content);
  } catch (error) {
    throw new Error(`XML parsing failed: ${error.message}`);
  }
}
async function processFileWithStreaming(filePath, jobId, fileSize) {
  import_performanceLogger.performanceLogger.mark("stream-start");
  sendTelemetry("stream:start", { fileSize, fileSizeMB: (fileSize / 1024 / 1024).toFixed(2) });
  return new Promise((resolve, reject) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".mxl") {
      reject(new Error("Streaming not supported for MXL files"));
      return;
    }
    if (![".xml", ".musicxml"].includes(ext)) {
      reject(new Error(`Unsupported file type: ${ext}`));
      return;
    }
    const readStream = (0, import_fs.createReadStream)(filePath, {
      encoding: "utf8",
      highWaterMark: 64 * 1024
      // 64KB chunks
    });
    const parser = new import_streamingMusicXMLParser.StreamingMusicXMLParser({
      chunkSize: 64 * 1024,
      maxBufferSize: 10 * 1024 * 1024,
      firstChunkMeasures: 4
    });
    let firstChunkSent = false;
    let measureCount = 0;
    parser.on("first-chunk", (data) => {
      var _a;
      import_performanceLogger.performanceLogger.mark("first-chunk");
      sendTelemetry("stream:first-chunk", {
        measureCount: data.measureCount,
        contentLength: data.content.length
      });
      (_a = import_worker_threads.parentPort) == null ? void 0 : _a.postMessage({
        type: "chunk",
        jobId,
        data: {
          type: "first",
          content: data.content,
          measureCount: data.measureCount,
          isComplete: false
        }
      });
      firstChunkSent = true;
      measureCount = data.measureCount;
    });
    parser.on("measure", () => {
      measureCount++;
    });
    parser.on("complete", (data) => {
      var _a, _b;
      import_performanceLogger.performanceLogger.mark("stream-end");
      import_performanceLogger.performanceLogger.measure("stream-start", "stream-end", "Streaming Parse");
      const streamingTotalTime = import_performanceLogger.performanceLogger.getMeasure("stream-start", "stream-end") || 0;
      sendTelemetry("stream:complete", {
        totalMeasures: data.totalMeasures,
        totalTime: streamingTotalTime,
        contentLength: data.content.length
      });
      (_a = import_worker_threads.parentPort) == null ? void 0 : _a.postMessage({
        type: "chunk",
        jobId,
        data: {
          type: "complete",
          content: data.content,
          measureCount: data.totalMeasures,
          isComplete: true
        }
      });
      const result = {
        success: true,
        jobId,
        fileName: path.basename(filePath),
        fileSize,
        performance: {
          readTime: import_performanceLogger.performanceLogger.getMeasure("stream-start", "first-chunk") || 0,
          parseTime: import_performanceLogger.performanceLogger.getMeasure("first-chunk", "stream-end") || 0,
          totalTime: streamingTotalTime
        }
      };
      (_b = import_worker_threads.parentPort) == null ? void 0 : _b.postMessage(result);
      resolve();
    });
    parser.on("error", (error) => {
      var _a;
      (_a = import_worker_threads.parentPort) == null ? void 0 : _a.postMessage({
        success: false,
        jobId,
        error: error.message
      });
      reject(error);
    });
    readStream.pipe(parser).on("error", (error) => {
      var _a;
      (_a = import_worker_threads.parentPort) == null ? void 0 : _a.postMessage({
        success: false,
        jobId,
        error: error.message
      });
      reject(error);
    });
  });
}
async function processFileWithParams(filePath, jobId) {
  try {
    import_performanceLogger.performanceLogger.mark("worker-start");
    const { normalizedPath, stats } = await validateAndStatFile(filePath);
    const { content, readTime } = await readAndValidateFile(normalizedPath);
    import_performanceLogger.performanceLogger.mark("worker-end");
    const totalTime = import_performanceLogger.performanceLogger.measure("worker-start", "worker-end");
    return {
      success: true,
      jobId,
      content,
      fileName: path.basename(normalizedPath),
      fileSize: stats.size,
      performance: {
        readTime,
        parseTime: import_performanceLogger.performanceLogger.measure("validate-start", "validate-end"),
        totalTime
      }
    };
  } catch (error) {
    return {
      success: false,
      jobId,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
if (import_worker_threads.parentPort) {
  processFile().catch((error) => {
    var _a, _b;
    console.error("Worker error:", error);
    (_b = import_worker_threads.parentPort) == null ? void 0 : _b.postMessage({
      success: false,
      jobId: (_a = import_worker_threads.workerData) == null ? void 0 : _a.jobId,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  processFile,
  processFileWithParams,
  processFileWithStreaming,
  processMXLFile,
  validateXMLContent
});
