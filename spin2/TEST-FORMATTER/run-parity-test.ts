#!/usr/bin/env ts-node
// run-parity-test.ts — Format each .spin2 file with IronSheep elastic config,
// compile with pnut-ts -d, compare to .bin.GOLD, and verify idempotency.

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Import formatter utilities
const testUtilsPath = path.resolve(__dirname, '../server/src/test/formatter/formatter.test-utils');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { formatSpin2Text, DEFAULT_FORMATTER_CONFIG } = require(testUtilsPath);

const PNUT_TS = path.join(process.env.HOME || '', '.local/bin/pnut-ts');
const TEST_DIR = __dirname;

// IronSheep elastic tabstop config
const IRONSHEEP_ELASTIC = {
  enabled: true,
  tabStops: {
    con: [4, 8, 16, 20, 32, 44, 56, 68, 80],
    var: [4, 12, 24, 28, 32, 44, 56, 68, 80],
    obj: [4, 8, 16, 20, 32, 44, 56, 68, 80],
    pub: [4, 8, 12, 16, 20, 24, 28, 32, 56, 80],
    pri: [4, 8, 12, 16, 20, 24, 28, 32, 56, 80],
    dat: [4, 16, 20, 24, 28, 48, 52, 56, 60, 64, 68, 80]
  }
};

function compile(spin2File: string, outBin: string): boolean {
  try {
    // pnut-ts requires relative filenames run from the source directory
    const fileName = path.basename(spin2File);
    const outName = path.basename(outBin);
    execSync(`${PNUT_TS} "${fileName}" -d -o "${outName}" 2>&1`, { cwd: TEST_DIR });
    return true;
  } catch (e: any) {
    console.error(`  COMPILE FAILED: ${e.stdout?.toString() || e.message}`);
    return false;
  }
}

function filesMatch(a: string, b: string): boolean {
  const bufA = fs.readFileSync(a);
  const bufB = fs.readFileSync(b);
  return bufA.equals(bufB);
}

// Find all .spin2 files with matching .bin.GOLD
const spin2Files = fs.readdirSync(TEST_DIR)
  .filter(f => f.endsWith('.spin2'))
  .filter(f => fs.existsSync(path.join(TEST_DIR, f.replace('.spin2', '.bin.GOLD'))))
  .sort();

console.log(`Testing ${spin2Files.length} files with IronSheep elastic config\n`);

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

for (const file of spin2Files) {
  const baseName = file.replace('.spin2', '');
  const spin2Path = path.join(TEST_DIR, file);
  const goldPath = path.join(TEST_DIR, `${baseName}.bin.GOLD`);
  const origBinPath = path.join(TEST_DIR, `${baseName}.orig.bin`);
  const fmtSpin2Path = path.join(TEST_DIR, `${baseName}.fmt.spin2`);
  const fmtBinPath = path.join(TEST_DIR, `${baseName}.fmt.bin`);
  const fmt2Spin2Path = path.join(TEST_DIR, `${baseName}.fmt2.spin2`);

  process.stdout.write(`${baseName}: `);

  // 1. Baseline: compile original
  if (!compile(spin2Path, origBinPath)) {
    console.log('SKIP (compile failed)');
    continue;
  }
  if (!filesMatch(origBinPath, goldPath)) {
    console.log('SKIP (baseline != GOLD)');
    continue;
  }

  // 2. Format with IronSheep elastic
  const originalText = fs.readFileSync(spin2Path, 'utf8');
  const formattedText = formatSpin2Text(originalText, DEFAULT_FORMATTER_CONFIG, IRONSHEEP_ELASTIC);
  fs.writeFileSync(fmtSpin2Path, formattedText);

  // 3. Compile formatted
  const fmtCompiled = compile(fmtSpin2Path, fmtBinPath);
  if (!fmtCompiled) {
    console.log('FAIL (formatted won\'t compile)');
    failures.push(`${baseName}: formatted won't compile`);
    failCount++;
    continue;
  }

  // 4. Binary parity check
  const binaryMatch = fs.existsSync(fmtBinPath) && filesMatch(fmtBinPath, goldPath);

  // 5. Idempotency: format again, compare text
  const formattedText2 = formatSpin2Text(formattedText, DEFAULT_FORMATTER_CONFIG, IRONSHEEP_ELASTIC);
  fs.writeFileSync(fmt2Spin2Path, formattedText2);
  const idempotent = formattedText === formattedText2;

  if (binaryMatch && idempotent) {
    console.log('PASS');
    passCount++;
  } else {
    const issues: string[] = [];
    if (!binaryMatch) issues.push('binary mismatch');
    if (!idempotent) {
      // Find first differing line
      const lines1 = formattedText.split('\n');
      const lines2 = formattedText2.split('\n');
      for (let i = 0; i < Math.max(lines1.length, lines2.length); i++) {
        if (lines1[i] !== lines2[i]) {
          issues.push(`not idempotent (first diff at line ${i + 1}: "${lines1[i]}" → "${lines2[i]}")`);
          break;
        }
      }
    }
    console.log(`FAIL (${issues.join(', ')})`);
    failures.push(`${baseName}: ${issues.join(', ')}`);
    failCount++;
  }

  // Cleanup temp files
  for (const tmp of [origBinPath, fmtBinPath, fmt2Spin2Path]) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
  // Keep .fmt.spin2 for failed files to inspect
  if (binaryMatch && idempotent && fs.existsSync(fmtSpin2Path)) {
    fs.unlinkSync(fmtSpin2Path);
  }
}

console.log(`\n${passCount} passed, ${failCount} failed out of ${spin2Files.length}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
}
