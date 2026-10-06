import nextJest from "next/jest.js";

// next/jest wires up SWC (same compiler as the app), path aliases and CSS mocks.
const createJestConfig = nextJest({ dir: "./" });

export default createJestConfig({
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
  collectCoverageFrom: ["lib/analytics.ts", "lib/safe-redirect.ts", "components/**/*.tsx"],
});
