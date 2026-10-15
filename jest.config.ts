import nextJest from "next/jest.js";

// next/jest wires up SWC (same compiler as the app), path aliases and CSS mocks.
const createJestConfig = nextJest({ dir: "./" });

export default createJestConfig({
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
  // The data API (./api) is its own package with its own test runner (node:test).
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/api/"],
  modulePathIgnorePatterns: ["<rootDir>/api/"],
  collectCoverageFrom: ["lib/analytics.ts", "lib/safe-redirect.ts", "lib/format.ts", "components/**/*.tsx"],
});
