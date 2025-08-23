const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

// Temporarily disable type checking for Phase 2 tests
const tsJestOptions = {
  ...tsJestTransformCfg,
  '^.+\\.tsx?$': ['ts-jest', {
    isolatedModules: true,
  }],
};

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "jsdom",
  transform: tsJestOptions,
  moduleNameMapper: {
    "^@/renderer/utils/env$": "<rootDir>/__tests__/__mocks__/renderer/utils/env.ts",
    "@/renderer/utils/env": "<rootDir>/__tests__/__mocks__/renderer/utils/env.ts",
    "^.*/env$": "<rootDir>/__tests__/__mocks__/renderer/utils/env.ts",
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@renderer/(.*)$": "<rootDir>/src/renderer/$1",
    "^@main/(.*)$": "<rootDir>/src/main/$1",
    "\\.(css|less|scss|sass)$": "<rootDir>/__tests__/__mocks__/styleMock.js"
  },
  setupFilesAfterEnv: ["<rootDir>/__tests__/setup.ts"],
  testMatch: [
    "<rootDir>/__tests__/**/*.test.ts",
    "<rootDir>/__tests__/**/*.test.tsx"
  ],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/index.js",
    "!src/main/**/*"
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"]
};