'use strict';
// server/src/test/formatter/formatter.safety.test.ts
//
// Additional safety tests for the formatter:
//   - Configuration variation (different settings produce stable output)
//   - Pre-formatted file preservation (already-correct files unchanged)
//   - Real-world file resilience (files from TEST_LANG_SERVER don't crash)
//   - Format + recompile across config variants

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { formatSpin2Text, FormatterConfig, DEFAULT_FORMATTER_CONFIG } from './formatter.test-utils';
import { ElasticTabstopConfig, DEFAULT_TABSTOPS } from '../../formatter/spin2.formatter.base';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const REALWORLD_DIR = path.resolve(__dirname, '../../../../TEST_LANG_SERVER/spin2');

function hasPnutTs(): boolean {
  try {
    execSync('pnut-ts --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getFixtures(): { name: string; spin2Path: string }[] {
  const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.spin2'));
  return files.map((f) => ({
    name: f.replace('.spin2', ''),
    spin2Path: path.join(FIXTURES_DIR, f)
  }));
}

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

// Find real-world .spin2 files (standalone, no multi-file dependencies)
function getRealWorldFiles(): { name: string; spin2Path: string }[] {
  const results: { name: string; spin2Path: string }[] = [];
  if (!fs.existsSync(REALWORLD_DIR)) return results;

  // Pick a small set of standalone files from various directories
  const candidates = [
    'LoaderTesting/blink.spin2',
    'LoaderTesting/blink_single.spin2',
    'LoaderTesting/blink_pasm.spin2'
  ];

  for (const candidate of candidates) {
    const fullPath = path.join(REALWORLD_DIR, candidate);
    if (fs.existsSync(fullPath)) {
      results.push({
        name: path.basename(candidate, '.spin2'),
        spin2Path: fullPath
      });
    }
  }
  return results;
}

// =========================================================================
//  Configuration variants to test
// =========================================================================
const CONFIG_VARIANTS: { name: string; config: Partial<FormatterConfig> }[] = [
  {
    name: 'defaults',
    config: {}
  },
  {
    name: 'indent-4',
    config: { indentSize: 4 }
  },
  {
    name: 'keyword-uppercase',
    config: { keywordCase: 'uppercase' }
  },
  {
    name: 'keyword-preserve',
    config: { keywordCase: 'preserve' }
  },
  {
    name: 'pasm-lowercase',
    config: { pasmInstructionCase: 'lowercase' }
  },
  {
    name: 'pasm-uppercase',
    config: { pasmInstructionCase: 'uppercase' }
  },
  {
    name: 'no-trailing-ws-trim',
    config: { trimTrailingWhitespace: false }
  },
  {
    name: 'no-final-newline',
    config: { insertFinalNewline: false }
  },
  {
    name: 'no-comment-spacing',
    config: { spaceAfterCommentStart: false }
  },
  {
    name: 'no-tab-conversion',
    config: { tabsToSpaces: false }
  },
  {
    name: 'blank-lines-0',
    config: { maxConsecutiveBlankLines: 0, blankLinesBetweenSections: 0, blankLinesBetweenMethods: 0 }
  },
  {
    name: 'blank-lines-3',
    config: { maxConsecutiveBlankLines: 3, blankLinesBetweenSections: 2, blankLinesBetweenMethods: 3 }
  }
];

describe('Formatter: Safety tests', function () {
  const pnutAvailable = hasPnutTs();
  const fixtures = getFixtures();
  const goldFixtures = getGoldFixtures();
  const realWorldFiles = getRealWorldFiles();

  // =========================================================================
  //  Config variation: idempotency under each config
  //  Formatter must be stable regardless of configuration settings.
  // =========================================================================
  describe('Config variation: idempotency', function () {
    for (const variant of CONFIG_VARIANTS) {
      describe(`config: ${variant.name}`, function () {
        for (const fixture of fixtures) {
          it(`${fixture.name}: idempotent with ${variant.name}`, function () {
            const text = fs.readFileSync(fixture.spin2Path, 'utf-8');
            const pass1 = formatSpin2Text(text, variant.config);
            const pass2 = formatSpin2Text(pass1, variant.config);

            if (pass1 !== pass2) {
              const lines1 = pass1.split('\n');
              const lines2 = pass2.split('\n');
              for (let i = 0; i < Math.max(lines1.length, lines2.length); i++) {
                if (lines1[i] !== lines2[i]) {
                  assert.fail(
                    `NOT idempotent with config ${variant.name} at line ${i + 1}:\n` +
                      `  Pass 1: ${JSON.stringify(lines1[i])}\n` +
                      `  Pass 2: ${JSON.stringify(lines2[i])}`
                  );
                }
              }
            }
          });
        }
      });
    }
  });

  // =========================================================================
  //  Config variation: format + recompile binary parity
  //  Changing cosmetic settings must not change the binary output.
  // =========================================================================
  describe('Config variation: format + recompile', function () {
    before(function () {
      if (!pnutAvailable) this.skip();
    });

    // Only test configs that are purely cosmetic (don't affect compilation)
    const safeConfigs = CONFIG_VARIANTS.filter(
      (v) => !['no-tab-conversion'].includes(v.name)
    );

    for (const variant of safeConfigs) {
      describe(`config: ${variant.name}`, function () {
        for (const fixture of goldFixtures) {
          it(`${fixture.name}: binary parity with ${variant.name}`, function () {
            if (!pnutAvailable) this.skip();

            const text = fs.readFileSync(fixture.spin2Path, 'utf-8');
            const formatted = formatSpin2Text(text, variant.config);

            const tmpDir = fs.mkdtempSync(path.join(FIXTURES_DIR, '.tmp-'));
            try {
              const formattedFile = path.join(tmpDir, path.basename(fixture.spin2Path));
              fs.writeFileSync(formattedFile, formatted, 'utf-8');

              const dummyChildSrc = path.join(FIXTURES_DIR, 'dummy_child.spin2');
              if (fs.existsSync(dummyChildSrc)) {
                fs.copyFileSync(dummyChildSrc, path.join(tmpDir, 'dummy_child.spin2'));
              }

              const debugFlag = fixture.useDebug ? '-d' : '';
              const cmd = `pnut-ts -q ${debugFlag} "${path.basename(formattedFile)}"`.trim();
              try {
                execSync(cmd, { cwd: tmpDir, stdio: 'pipe' });
              } catch (e: any) {
                const stderr = e.stderr ? e.stderr.toString() : '';
                assert.fail(`Formatted file (${variant.name}) failed to compile: ${stderr}`);
              }

              const binFile = path.join(tmpDir, path.basename(formattedFile).replace('.spin2', '.bin'));
              assert.ok(fs.existsSync(binFile), 'PNut-TS did not produce binary');

              const actual = fs.readFileSync(binFile);
              const gold = fs.readFileSync(fixture.goldPath);
              assert.strictEqual(
                actual.length,
                gold.length,
                `Binary size mismatch with ${variant.name}: actual=${actual.length} vs GOLD=${gold.length}`
              );
              assert.ok(
                actual.equals(gold),
                `Config ${variant.name} changes binary — FORMATTER BROKE SEMANTICS`
              );
            } finally {
              fs.rmSync(tmpDir, { recursive: true, force: true });
            }
          });
        }
      });
    }
  });

  // =========================================================================
  //  Crash resilience: formatter must not throw on any input
  //  Even malformed or unusual files should not crash the formatter.
  // =========================================================================
  describe('Crash resilience', function () {
    it('empty file does not crash', function () {
      const result = formatSpin2Text('');
      assert.ok(typeof result === 'string');
    });

    it('file with only whitespace does not crash', function () {
      const result = formatSpin2Text('   \n\n  \n');
      assert.ok(typeof result === 'string');
    });

    it('file with only comments does not crash', function () {
      const result = formatSpin2Text("' just a comment\n' another one\n");
      assert.ok(typeof result === 'string');
    });

    it('single CON section does not crash', function () {
      const result = formatSpin2Text('CON\n  _clkfreq = 10_000_000\n');
      assert.ok(typeof result === 'string');
    });

    it('section keyword with no content does not crash', function () {
      const result = formatSpin2Text('CON\nVAR\nDAT\nPUB main()\n');
      assert.ok(typeof result === 'string');
    });

    it('very long line does not crash', function () {
      const longLine = '  x := ' + '1 + '.repeat(200) + '1';
      const result = formatSpin2Text('CON\n  _clkfreq = 10_000_000\nPUB main() | x\n' + longLine + '\n');
      assert.ok(typeof result === 'string');
    });

    it('deeply nested blocks do not crash', function () {
      let code = 'CON\n  _clkfreq = 10_000_000\nVAR\n  LONG x\nPUB main() | i\n';
      for (let level = 0; level < 20; level++) {
        code += '  '.repeat(level + 1) + 'if i > ' + level + '\n';
      }
      code += '  '.repeat(21) + 'x := 1\n';
      const result = formatSpin2Text(code);
      assert.ok(typeof result === 'string');
    });

    it('block comment spanning many lines does not crash', function () {
      let code = 'CON\n  _clkfreq = 10_000_000\n{\n';
      for (let i = 0; i < 50; i++) {
        code += '  line ' + i + ' of block comment\n';
      }
      code += '}\nPUB main()\n';
      const result = formatSpin2Text(code);
      assert.ok(typeof result === 'string');
    });

    it('file with mixed CRLF and LF line endings does not crash', function () {
      const result = formatSpin2Text('CON\r\n  _clkfreq = 10_000_000\nPUB main()\r\n  x := 0\n');
      assert.ok(typeof result === 'string');
    });
  });

  // =========================================================================
  //  Real-world file resilience: format standalone files from TEST_LANG_SERVER
  //  These are actual user files — the formatter must not crash on them.
  // =========================================================================
  describe('Real-world file resilience', function () {
    if (realWorldFiles.length === 0) {
      it('(no real-world files found — skipping)', function () {
        this.skip();
      });
    }

    for (const file of realWorldFiles) {
      it(`${file.name}: does not crash`, function () {
        const text = fs.readFileSync(file.spin2Path, 'utf-8');
        const result = formatSpin2Text(text);
        assert.ok(typeof result === 'string');
        assert.ok(result.length > 0, 'Formatted result should not be empty');
      });

      it(`${file.name}: idempotent`, function () {
        const text = fs.readFileSync(file.spin2Path, 'utf-8');
        const pass1 = formatSpin2Text(text);
        const pass2 = formatSpin2Text(pass1);

        if (pass1 !== pass2) {
          const lines1 = pass1.split('\n');
          const lines2 = pass2.split('\n');
          for (let i = 0; i < Math.max(lines1.length, lines2.length); i++) {
            if (lines1[i] !== lines2[i]) {
              assert.fail(
                `Real-world file ${file.name} NOT idempotent at line ${i + 1}:\n` +
                  `  Pass 1: ${JSON.stringify(lines1[i])}\n` +
                  `  Pass 2: ${JSON.stringify(lines2[i])}`
              );
            }
          }
        }
      });

      if (hasPnutTs()) {
        it(`${file.name}: format + recompile`, function () {
          if (!pnutAvailable) this.skip();

          const text = fs.readFileSync(file.spin2Path, 'utf-8');

          // Compile original
          const origTmpDir = fs.mkdtempSync(path.join(FIXTURES_DIR, '.tmp-'));
          const origFile = path.join(origTmpDir, path.basename(file.spin2Path));
          fs.copyFileSync(file.spin2Path, origFile);
          let origBin: Buffer;
          try {
            execSync(`pnut-ts -q "${path.basename(origFile)}"`, { cwd: origTmpDir, stdio: 'pipe' });
            const binPath = origFile.replace('.spin2', '.bin');
            if (!fs.existsSync(binPath)) {
              // Some files may not produce a .bin (only .obj for libraries)
              fs.rmSync(origTmpDir, { recursive: true, force: true });
              this.skip();
              return;
            }
            origBin = fs.readFileSync(binPath);
          } catch {
            // File may not compile standalone (missing dependencies)
            fs.rmSync(origTmpDir, { recursive: true, force: true });
            this.skip();
            return;
          }
          fs.rmSync(origTmpDir, { recursive: true, force: true });

          // Format and compile
          const formatted = formatSpin2Text(text);
          const fmtTmpDir = fs.mkdtempSync(path.join(FIXTURES_DIR, '.tmp-'));
          const fmtFile = path.join(fmtTmpDir, path.basename(file.spin2Path));
          fs.writeFileSync(fmtFile, formatted, 'utf-8');
          try {
            execSync(`pnut-ts -q "${path.basename(fmtFile)}"`, { cwd: fmtTmpDir, stdio: 'pipe' });
            const binPath = fmtFile.replace('.spin2', '.bin');
            assert.ok(fs.existsSync(binPath), 'Formatted file should produce a binary');
            const fmtBin = fs.readFileSync(binPath);
            assert.ok(
              origBin!.equals(fmtBin),
              `Real-world file ${file.name}: formatting changed binary output`
            );
          } catch (e: any) {
            const stderr = e.stderr ? e.stderr.toString() : '';
            assert.fail(`Formatted real-world file ${file.name} failed to compile: ${stderr}`);
          } finally {
            fs.rmSync(fmtTmpDir, { recursive: true, force: true });
          }
        });
      }
    }
  });

  // =========================================================================
  //  Cross-config binary parity: reformat through tabs-8, spaces-2,
  //  spaces-4, and elastic tabs — each must compile to the same GOLD binary.
  //  This verifies that no whitespace mode produces semantic changes.
  // =========================================================================
  describe('Cross-config binary parity (tabs-8 → spaces-2 → spaces-4 → elastic)', function () {
    before(function () {
      if (!pnutAvailable) this.skip();
    });

    const crossConfigs: { name: string; config: Partial<FormatterConfig>; elastic?: ElasticTabstopConfig }[] = [
      { name: 'tabs-8', config: { tabsToSpaces: false, tabWidth: 8, indentSize: 2 } },
      { name: 'spaces-2', config: { tabsToSpaces: true, indentSize: 2 } },
      { name: 'spaces-4', config: { tabsToSpaces: true, indentSize: 4 } },
      { name: 'elastic', config: { tabsToSpaces: true, indentSize: 2 }, elastic: { enabled: true, tabStops: DEFAULT_TABSTOPS } }
    ];

    for (const fixture of goldFixtures) {
      it(`${fixture.name}: tabs-8 → spaces-2 → spaces-4 → elastic all match GOLD`, function () {
        if (!pnutAvailable) this.skip();

        const originalText = fs.readFileSync(fixture.spin2Path, 'utf-8');
        const gold = fs.readFileSync(fixture.goldPath);

        // Chain: format through each config sequentially, recompile after each
        let currentText = originalText;
        for (const cc of crossConfigs) {
          currentText = formatSpin2Text(currentText, cc.config, cc.elastic);

          const tmpDir = fs.mkdtempSync(path.join(FIXTURES_DIR, '.tmp-'));
          try {
            const fmtFile = path.join(tmpDir, path.basename(fixture.spin2Path));
            fs.writeFileSync(fmtFile, currentText, 'utf-8');

            const dummyChildSrc = path.join(FIXTURES_DIR, 'dummy_child.spin2');
            if (fs.existsSync(dummyChildSrc)) {
              fs.copyFileSync(dummyChildSrc, path.join(tmpDir, 'dummy_child.spin2'));
            }

            const debugFlag = fixture.useDebug ? '-d' : '';
            const cmd = `pnut-ts -q ${debugFlag} "${path.basename(fmtFile)}"`.trim();
            try {
              execSync(cmd, { cwd: tmpDir, stdio: 'pipe' });
            } catch (e: any) {
              const stderr = e.stderr ? e.stderr.toString() : '';
              assert.fail(`After ${cc.name}: compile failed: ${stderr}`);
            }

            const binFile = path.join(tmpDir, path.basename(fmtFile).replace('.spin2', '.bin'));
            assert.ok(fs.existsSync(binFile), `After ${cc.name}: no binary produced`);

            const actual = fs.readFileSync(binFile);
            assert.strictEqual(
              actual.length,
              gold.length,
              `After ${cc.name}: binary size mismatch: actual=${actual.length} vs GOLD=${gold.length}`
            );
            assert.ok(
              actual.equals(gold),
              `After ${cc.name}: binary content differs from GOLD`
            );
          } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
        }
      });
    }
  });

  // =========================================================================
  //  Pre-formatted file preservation
  //  The indent-already-correct fixture should produce identical output
  //  (the formatter should be a no-op on already-formatted code).
  // =========================================================================
  describe('Pre-formatted file preservation', function () {
    it('indent-already-correct: formatting does not change the file', function () {
      const filePath = path.join(FIXTURES_DIR, 'indent-already-correct.spin2');
      if (!fs.existsSync(filePath)) {
        this.skip();
        return;
      }

      const original = fs.readFileSync(filePath, 'utf-8');
      const formatted = formatSpin2Text(original);

      if (original !== formatted) {
        const origLines = original.split('\n');
        const fmtLines = formatted.split('\n');
        for (let i = 0; i < Math.max(origLines.length, fmtLines.length); i++) {
          if (origLines[i] !== fmtLines[i]) {
            assert.fail(
              `Pre-formatted file changed at line ${i + 1}:\n` +
                `  Original:  ${JSON.stringify(origLines[i])}\n` +
                `  Formatted: ${JSON.stringify(fmtLines[i])}`
            );
          }
        }
      }
    });
  });
});
