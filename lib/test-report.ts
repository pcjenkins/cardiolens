import "server-only";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Reads the files Jest wrote at release time. Nothing here runs tests - it only reads results.
const RELEASE_DIR = path.join(process.cwd(), "data", "release");

type Assertion = { title: string; ancestorTitles: string[]; status: string; duration: number | null; failureMessages: string[] };
type FileResult = { name: string; status: string; assertionResults: Assertion[] };
export type JestResults = {
  success: boolean; startTime: number;
  numTotalTests: number; numPassedTests: number; numFailedTests: number; numPendingTests: number;
  testResults: FileResult[];
};
type Pct = { pct: number };
export type CoverageSummary = Record<string, { lines: Pct; statements: Pct; functions: Pct; branches: Pct }>;

function readJson<T>(file: string): T | null {
  const full = path.join(RELEASE_DIR, file);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8")) as T;
}

export function getTestReport() {
  return {
    results: readJson<JestResults>("test-results.json"),
    coverage: readJson<CoverageSummary>(path.join("coverage", "coverage-summary.json")),
  };
}

/** Turn an absolute path from Jest into a short project-relative one. */
export function shortPath(p: string) {
  return path.relative(process.cwd(), p).replaceAll("\\", "/");
}