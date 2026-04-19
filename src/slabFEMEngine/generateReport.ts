/**
 * Report Generator — run with:
 *   npx tsx --tsconfig artifacts/structural-design/tsconfig.json \
 *            artifacts/structural-design/src/slabFEMEngine/generateReport.ts
 *
 * Writes the topology report to:
 *   artifacts/structural-design/src/slabFEMEngine/reports/node_topology_report.txt
 */

import { generateTopologyReport, runSymmetryTest } from './symmetryValidation';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

console.log('\n[FEM Topology Fix] Running symmetry validation...\n');

// Run with mesh density 4 (the default production setting)
const result = runSymmetryTest(4);

console.log('\n[FEM Topology Fix] Test result:', result.passed ? '✓ PASSED' : '✗ FAILED');
console.log('[FEM Topology Fix] Notes:');
for (const note of result.notes) {
  console.log('  ', note);
}

// Generate the full text report
const report = generateTopologyReport(4);

// Write to the reports directory
const reportDir  = join(import.meta.dirname ?? __dirname, 'reports');
const reportPath = join(reportDir, 'node_topology_report.txt');

mkdirSync(reportDir, { recursive: true });
writeFileSync(reportPath, report, 'utf8');

console.log(`\n[FEM Topology Fix] Report written to:\n  ${reportPath}\n`);
console.log('─'.repeat(72));
console.log(report);
