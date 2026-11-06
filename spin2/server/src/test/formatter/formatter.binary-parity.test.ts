'use strict';
// server/src/test/formatter/formatter.binary-parity.test.ts
//
// Binary equivalence tests. Sources are the only saved input: each test compiles the
// original and the formatted text with the installed compiler and compares the bytes.
// Whether that compiler matches PNut is the PNut-TS project's regression suite's job.
//   Phase 1: Format the file, recompile, verify it matches the compiled original
//   Phase 2: Verify idempotency (format twice → same output)
//   Phase 3: Format twice, recompile, verify it matches the compiled original

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { assertFormattingPreservesBinary, formatSpin2Text, getBinaryParityFixtures } from './formatter.test-utils';

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

// Get all .spin2 fixtures, including the format-only ones
function getAllFixtures(): { name: string; spin2Path: string }[] {
  const fixtures: { name: string; spin2Path: string }[] = [];
  const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.spin2'));
  for (const f of files) {
    const base = f.replace('.spin2', '');
    fixtures.push({
      name: base,
      spin2Path: path.join(FIXTURES_DIR, f)
    });
  }
  return fixtures;
}

describe('Formatter: Binary equivalence', function () {
  const pnutAvailable = hasPnutTs();
  const allFixtures = getAllFixtures();
  const parityFixtures = getBinaryParityFixtures();

  before(function () {
    assert.ok(pnutAvailable, 'pnut-ts is required: without the compiler these tests prove nothing');
  });

  // =========================================================================
  //  Phase 1: Format + recompile — formatted code produces same binary
  //  THIS IS THE MOST CRITICAL SAFETY TEST.
  //  If the formatter changes indentation or code structure in a way that
  //  alters semantics, the binary will differ.
  // =========================================================================
  describe('Phase 1: Format + recompile binary parity', function () {
    for (const fixture of parityFixtures) {
      it(`${fixture.name}: formatted file compiles to the same binary as the original`, function () {
        const originalText = fs.readFileSync(fixture.spin2Path, 'utf-8');
        assertFormattingPreservesBinary(fixture, formatSpin2Text(originalText), 'Formatted file');
      });
    }
  });

  // =========================================================================
  //  Phase 2: Idempotency — formatting twice produces identical output
  //  If this fails, the formatter is unstable and will keep changing code
  //  on every save.
  // =========================================================================
  describe('Phase 2: Idempotency (format twice → same output)', function () {
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
  //  Phase 3: Format + recompile idempotent binary —
  //  Format twice, recompile, still matches the compiled original.
  //  Catches cases where first format passes but is unstable.
  // =========================================================================
  describe('Phase 3: Double-format + recompile binary parity', function () {
    for (const fixture of parityFixtures) {
      it(`${fixture.name}: double-formatted file compiles to the same binary as the original`, function () {
        const originalText = fs.readFileSync(fixture.spin2Path, 'utf-8');
        const secondPass = formatSpin2Text(formatSpin2Text(originalText));
        assertFormattingPreservesBinary(fixture, secondPass, 'Double-formatted file');
      });
    }
  });
});
