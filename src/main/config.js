// Configuration constants for the Electron main process
const AppConfig = {
  // XML Parser options for security
  xmlParserOptions: {
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    trimValues: true,
    processEntities: false, // Prevent XXE attacks
    htmlEntities: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    transformTagName: false,
    transformAttributeName: false,
    isArray: false,
    parseTrueNumberOnly: true,
    arrayMode: false,
    stopNodes: [],
    alwaysCreateTextNode: false,
    commentPropName: false,
    unpairedTags: [],
    allowBooleanAttributes: true,
    parseTagValue: true,
    parseNodeValue: true,
    parseCDATA: false,
    cdataPropName: false,
    numberParseOptions: {
      hex: false,
      leadingZeros: true
    },
    preserveOrder: false
  },
  
  // File dialog filters
  dialogFilters: [
    { name: 'MusicXML Files', extensions: ['xml', 'musicxml', 'mxl'] },
    { name: 'All Files', extensions: ['*'] }
  ],
  
  // File size and processing limits
  limits: {
    MAX_COMPRESSED_FILE_SIZE_BYTES: 50 * 1024 * 1024, // 50MB for compressed files
    MAX_UNCOMPRESSED_FILE_SIZE_BYTES: 200 * 1024 * 1024, // 200MB for uncompressed files
    XML_PARSE_TIMEOUT_MS: 30000 // 30 seconds timeout for parsing
  }
};

module.exports = { AppConfig };