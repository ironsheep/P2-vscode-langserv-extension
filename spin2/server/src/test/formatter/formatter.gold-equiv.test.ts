'use strict';
// server/src/test/formatter/formatter.gold-equiv.test.ts
//
// Gold-standard binary equivalence tests.
// For each .spin2 fixture that has a matching .bin.GOLD file:
//   Phase 1: Compile with PNut-TS and verify the output matches the PNut .bin.GOLD
//   Phase 2: Format the file, recompile, verify still matches .bin.GOLD
//   Phase 3: Verify idempotency (format twice → same output)

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { formatSpin2Text } from './formatter.test-utils';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

// Check if pnut-ts is available
function hasPnutTs(): boolean {
  try {
    execSync('pnut-ts --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Get all .spin2 fixtures that have a .bin.GOLD companion
function getGoldFixtures(): { name: string; spin2Path: string; goldPath: string; useDebug: boolean }[] {
  const fixtures: { name: string; spin2Path: string; goldPath: string; useDebug: boolean }[] = [];
  const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.spin2'));
  for (const f of files) {
    const base = f.replace('.spin2', '');
    const goldPath = path.join(FIXTURES_DIR, `${base}.bin.GOLD`);
    if (fs.existsSync(goldPath)) {
      fixtures.push({
        name: base,
        spin2Path: path.join(FIXTURES_DIR, f),
        goldPath,
        useDebug: f.includes('debug')
      });
    }
  }
  return fixtures;
}

// Get all .spin2 fixtures (with or without .bin.GOLD)
function getAllFixtures(): { name: string; spin2Path: string; useDebug: boolean }[] {
  const fixtures: { name: string; spin2Path: string; useDebug: boolean }[] = [];
  const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.spin2'));
  for (const f of files) {
    const base = f.replace('.spin2', '');
    fixtures.push({
      name: base,
      spin2Path: path.join(FIXTURES_DIR, f),
      useDebug: f.includes('debug')
    });
  }
  return fixtures;
}

// Helper: compile a .spin2 file and return the binary
function compileFixture(spin2Path: string, tmpDir: string, useDebug: boolean): Buffer {
  const srcFile = path.join(tmpDir, path.basename(spin2Path));
  fs.copyFileSync(spin2Path, srcFile);

  // Copy dummy_child.spin2 if available (needed by some fixtures)
  const dummyChildSrc = path.join(FIXTURES_DIR, 'dummy_child.spin2');
  if (fs.existsSync(dummyChildSrc)) {
    fs.copyFileSync(dummyChildSrc, path.join(tmpDir, 'dummy_child.spin2'));
  }

  const debugFlag = useDebug ? '-d' : '';
  const cmd = `pnut-ts -q ${debugFlag} "${path.basename(srcFile)}"`.trim();
  execSync(cmd, { cwd: tmpDir, stdio: 'pipe' });

  const binFile = path.join(tmpDir, path.basename(srcFile).replace('.spin2', '.bin'));
  assert.ok(fs.existsSync(binFile), `PNut-TS did not produce ${path.basename(binFile)}`);
  return fs.readFileSync(binFile);
}

describe('Formatter: Gold-standard binary equivalence', function () {
  const pnutAvailable = hasPnutTs();
  const goldFixtures = getGoldFixtures();
  const allFixtures = getAllFixtures();

  before(function () {
    if (!pnutAvailable) {
      this.skip();
    }
  });

  // =========================================================================
  //  Phase 1: Compiler parity — PNut-TS output matches PNut GOLD binary
  // =========================================================================
  describe('Phase 1: PNut-TS vs PNut GOLD (compiler parity)', function () {
    for (const fixture of goldFixtures) {
      it(`${fixture.name}: PNut-TS binary matches PNut GOLD`, function () {
        if (!pnutAvailable) {
          this.skip();
        }

        const tmpDir = fs.mkdtempSync(path.join(FIXTURES_DIR, '.tmp-'));
        try {
          const actual = compileFixture(fixture.spin2Path, tmpDir, fixture.useDebug);
          const gold = fs.readFileSync(fixture.goldPath);
          assert.strictEqual(
            actual.length,
            gold.length,
            `Binary size mismatch: PNut-TS=${actual.length} vs GOLD=${gold.length}`
          );
          assert.ok(actual.equals(gold), 'Binary content does not match GOLD');
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      });
    }
  });

  // =========================================================================
  //  Phase 2: Format + recompile — formatted code produces same binary
  //  THIS IS THE MOST CRITICAL SAFETY TEST.
  //  If the formatter changes indentation or code structure in a way that
  //  alters semantics, the binary will differ.
  // =========================================================================
  describe('Phase 2: Format + recompile binary parity', function () {
    for (const fixture of goldFixtures) {
      it(`${fixture.name}: formatted file still compiles to GOLD binary`, function () {
        if (!pnutAvailable) {
          this.skip();
        }

        const tmpDir = fs.mkdtempSync(path.join(FIXTURES_DIR, '.tmp-'));
        try {
          // Read original source
          const originalText = fs.readFileSync(fixture.spin2Path, 'utf-8');

          // Format it
          const formattedText = formatSpin2Text(originalText);

          // Write formatted text to temp dir
          const formattedFile = path.join(tmpDir, path.basename(fixture.spin2Path));
          fs.writeFileSync(formattedFile, formattedText, 'utf-8');

          // Copy dummy_child.spin2 if available
          const dummyChildSrc = path.join(FIXTURES_DIR, 'dummy_child.spin2');
          if (fs.existsSync(dummyChildSrc)) {
            fs.copyFileSync(dummyChildSrc, path.join(tmpDir, 'dummy_child.spin2'));
          }

          // Compile the formatted file
          const debugFlag = fixture.useDebug ? '-d' : '';
          const cmd = `pnut-ts -q ${debugFlag} "${path.basename(formattedFile)}"`.trim();
          try {
            execSync(cmd, { cwd: tmpDir, stdio: 'pipe' });
          } catch (e: any) {
            const stderr = e.stderr ? e.stderr.toString() : '';
            assert.fail(`Formatted file failed to compile: ${stderr}`);
          }

          // Compare binary to GOLD
          const binFile = path.join(tmpDir, path.basename(formattedFile).replace('.spin2', '.bin'));
          assert.ok(fs.existsSync(binFile), `PNut-TS did not produce binary from formatted file`);

          const actual = fs.readFileSync(binFile);
          const gold = fs.readFileSync(fixture.goldPath);
          assert.strictEqual(
            actual.length,
            gold.length,
            `Binary size mismatch after formatting: actual=${actual.length} vs GOLD=${gold.length}`
          );
          assert.ok(
            actual.equals(gold),
            'Formatted file produces different binary than GOLD — FORMATTER CHANGED SEMANTICS'
          );
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      });
    }
  });

  // =========================================================================
  //  Phase 3: Idempotency — formatting twice produces identical output
  //  If this fails, the formatter is unstable and will keep changing code
  //  on every save.
  // =========================================================================
  describe('Phase 3: Idempotency (format twice → same output)', function () {
    for (const fixture of allFixtures) {
      it(`${fixture.name}: formatting is idempotent`, function () {
        const originalText = fs.readFileSync(fixture.spin2Path, 'utf-8');

        // Format once
        const firstPass = formatSpin2Text(originalText);

        // Format again
        const secondPass = formatSpin2Text(firstPass);

        // They must be identical
        if (firstPass !== secondPass) {
          // Find the first differing line for a useful error message
          const lines1 = firstPass.split('\n');
          const lines2 = secondPass.split('\n');
          let diffLine = -1;
          const maxLines = Math.max(lines1.length, lines2.length);
          for (let i = 0; i < maxLines; i++) {
            if (lines1[i] !== lines2[i]) {
              diffLine = i + 1;
              break;
            }
          }
          assert.fail(
            `Formatter is NOT idempotent. First difference at line ${diffLine}:\n` +
              `  Pass 1: ${JSON.stringify(lines1[diffLine - 1])}\n` +
              `  Pass 2: ${JSON.stringify(lines2[diffLine - 1])}`
          );
        }
      });
    }
  });

  // =========================================================================
  //  Phase 4: Format + recompile idempotent binary —
  //  Format twice, recompile, still matches GOLD.
  //  Catches cases where first format passes but is unstable.
  // =========================================================================
  describe('Phase 4: Double-format + recompile binary parity', function () {
    for (const fixture of goldFixtures) {
      it(`${fixture.name}: double-formatted file still compiles to GOLD binary`, function () {
        if (!pnutAvailable) {
          this.skip();
        }

        const tmpDir = fs.mkdtempSync(path.join(FIXTURES_DIR, '.tmp-'));
        try {
          const originalText = fs.readFileSync(fixture.spin2Path, 'utf-8');

          // Format twice
          const firstPass = formatSpin2Text(originalText);
          const secondPass = formatSpin2Text(firstPass);

          // Write double-formatted text
          const formattedFile = path.join(tmpDir, path.basename(fixture.spin2Path));
          fs.writeFileSync(formattedFile, secondPass, 'utf-8');

          // Copy dummy_child.spin2 if available
          const dummyChildSrc = path.join(FIXTURES_DIR, 'dummy_child.spin2');
          if (fs.existsSync(dummyChildSrc)) {
            fs.copyFileSync(dummyChildSrc, path.join(tmpDir, 'dummy_child.spin2'));
          }

          // Compile
          const debugFlag = fixture.useDebug ? '-d' : '';
          const cmd = `pnut-ts -q ${debugFlag} "${path.basename(formattedFile)}"`.trim();
          try {
            execSync(cmd, { cwd: tmpDir, stdio: 'pipe' });
          } catch (e: any) {
            const stderr = e.stderr ? e.stderr.toString() : '';
            assert.fail(`Double-formatted file failed to compile: ${stderr}`);
          }

          // Compare binary to GOLD
          const binFile = path.join(tmpDir, path.basename(formattedFile).replace('.spin2', '.bin'));
          assert.ok(fs.existsSync(binFile), `PNut-TS did not produce binary from double-formatted file`);

          const actual = fs.readFileSync(binFile);
          const gold = fs.readFileSync(fixture.goldPath);
          assert.strictEqual(
            actual.length,
            gold.length,
            `Binary size mismatch after double-format: actual=${actual.length} vs GOLD=${gold.length}`
          );
          assert.ok(
            actual.equals(gold),
            'Double-formatted file produces different binary than GOLD — FORMATTER IS UNSTABLE'
          );
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      });
    }
  });
});
