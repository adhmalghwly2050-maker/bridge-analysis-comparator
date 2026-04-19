/**
 * Validation Suite
 * ═══════════════════════════════════════════════════════════════
 * Re-exports from the comprehensive benchmark suite.
 * Kept for backward compatibility.
 */

export { testSimplySupported, testPortalFrame } from './benchmarkSuite';
export { runFullBenchmarkSuite as runValidationSuite } from './benchmarkSuite';
export type { BenchmarkResult as ValidationResult } from './benchmarkSuite';
