'use strict';
// server/src/test/formatter/formatter.test-utils.ts
//
// Formatter test utilities. Every test formats through the shipped pipeline: the real
// parsers feed the real DocumentFormattingProvider, so nothing here can drift from what
// users run.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { TextDocument } from 'vscode-languageserver-textdocument';
import DocumentFormattingProvider, { FormatterConfig } from '../../providers/DocumentFormattingProvider';
import { DocumentFindings } from '../../parser/spin.semantic.findings';
import { Spin2DocumentSymbolParser } from '../../parser/spin2.documentSymbolParser';
import { Spin2DocumentSemanticParser } from '../../parser/spin2.documentSemanticParser';
import { ElasticTabstopConfig, buildRegularTabStops } from '../../formatter/spin2.formatter.base';
import { createTestContext } from '../testContext';

export { FormatterConfig };

// The defaults getFormatterConfig() applies, with the formatter switched on.
export const DEFAULT_FORMATTER_CONFIG: FormatterConfig = {
  enable: true,
  trimTrailingWhitespace: true,
  insertFinalNewline: true,
  maxConsecutiveBlankLines: 1,
  blankLinesBetweenSections: 1,
  blankLinesBetweenMethods: 2,
  indentSize: 2,
  blockNameCase: 'uppercase',
  controlFlowCase: 'preserve',
  methodCase: 'preserve',
  typeCase: 'uppercase',
  constantCase: 'uppercase',
  pasmInstructionCase: 'preserve',
  spaceAfterCommentStart: true
};

/**
 * Format .spin2 text the way the language server does.
 *
 * @param text - the raw .spin2 file content
 * @param config - formatter configuration (defaults applied for missing fields)
 * @param elastic - elastic tabstop configuration (spaces mode when omitted)
 * @returns the formatted text
 */
export function formatSpin2Text(text: string, config?: Partial<FormatterConfig>, elastic?: ElasticTabstopConfig): string {
  const cfg: FormatterConfig = { ...DEFAULT_FORMATTER_CONFIG, ...config };
  const elasticConfig: ElasticTabstopConfig = elastic || {
    enabled: false,
    tabStops: buildRegularTabStops(cfg.indentSize),
    commentGap: 2 * cfg.indentSize
  };

  const ctx = createTestContext();
  const uri = 'file:///formatter-test/source.spin2';
  const document = TextDocument.create(uri, 'spin2', 0, text);
  const findings = new DocumentFindings(uri);
  findings.setFilename(uri);
  new Spin2DocumentSymbolParser(ctx).reportDocumentSymbols(document, findings);
  new Spin2DocumentSemanticParser(ctx).reportDocumentSemanticTokens(document, findings, '/formatter-test');

  return new DocumentFormattingProvider(ctx).formatLines(text.split(/\r?\n/), findings, cfg, elasticConfig).join('\n');
}

// ---------------------------------------------------------------------------
//  Binary parity: the original source and the formatted source, same compiler
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

// Column-alignment reproducers (D.12, D.14) that have never compiled. They are still
// formatted by the idempotency tests. Any other fixture that does not compile fails.
const FORMAT_ONLY_FIXTURES: string[] = ['regr-dat-data-instr-columns', 'regr-pasm-label-detection'];

export interface BinaryParityFixture {
  name: string;
  spin2Path: string;
}

export function getBinaryParityFixtures(): BinaryParityFixture[] {
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((fileName) => fileName.endsWith('.spin2'))
    .map((fileName) => ({
      name: fileName.replace('.spin2', ''),
      spin2Path: path.join(FIXTURES_DIR, fileName)
    }))
    .filter((fixture) => !FORMAT_ONLY_FIXTURES.includes(fixture.name));
}

// Many config variants format to the same text, and the same text compiles to the same
// bytes, so each distinct source compiles once per run in each mode.
const compiledBinaries = new Map<string, Buffer>();

function compileSource(fixture: BinaryParityFixture, sourceText: string, debugEnabled: boolean, label: string): Buffer {
  const cacheKey = `${fixture.name}\0${debugEnabled}\0${sourceText}`;
  const cached = compiledBinaries.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const tmpDir = fs.mkdtempSync(path.join(FIXTURES_DIR, '.tmp-'));
  try {
    // The child object goes first: when the fixture under test is dummy_child itself, its text must win.
    fs.copyFileSync(path.join(FIXTURES_DIR, 'dummy_child.spin2'), path.join(tmpDir, 'dummy_child.spin2'));
    const sourceName = path.basename(fixture.spin2Path);
    fs.writeFileSync(path.join(tmpDir, sourceName), sourceText, 'utf-8');

    const debugFlag = debugEnabled ? '-d ' : '';
    try {
      execSync(`pnut-ts -q ${debugFlag}"${sourceName}"`, { cwd: tmpDir, stdio: 'pipe' });
    } catch (err) {
      const failure = err as { stdout?: Buffer; stderr?: Buffer };
      assert.fail(`${label} failed to compile: ${failure.stderr?.toString() ?? ''}${failure.stdout?.toString() ?? ''}`);
    }

    const binFile = path.join(tmpDir, sourceName.replace('.spin2', '.bin'));
    assert.ok(fs.existsSync(binFile), `${label} produced no binary`);
    const binary = fs.readFileSync(binFile);
    compiledBinaries.set(cacheKey, binary);
    return binary;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** True when the fixture's original source compiles both with and without debug. */
export function originalCompiles(fixture: BinaryParityFixture): boolean {
  const originalText = fs.readFileSync(fixture.spin2Path, 'utf-8');
  try {
    compileSource(fixture, originalText, false, 'Original source');
    compileSource(fixture, originalText, true, 'Original source');
    return true;
  } catch {
    return false;
  }
}

/**
 * Compile the fixture's original source and the given formatted text with the installed
 * compiler, with debug off and with debug on, and require byte-identical binaries each
 * way. Debug text only reaches the binary with -d, so a change to it is invisible without
 * it. Nothing is stored between runs, so a new compiler cannot make this stale, and any
 * difference comes from the formatting.
 */
export function assertFormattingPreservesBinary(fixture: BinaryParityFixture, formattedText: string, label: string): void {
  const originalText = fs.readFileSync(fixture.spin2Path, 'utf-8');
  for (const debugEnabled of [false, true]) {
    const modeLabel = `${label} (${debugEnabled ? 'with -d' : 'without -d'})`;
    const original = compileSource(fixture, originalText, debugEnabled, `${modeLabel}: original source`);
    const formatted = compileSource(fixture, formattedText, debugEnabled, modeLabel);
    assert.strictEqual(
      formatted.length,
      original.length,
      `${modeLabel}: binary size changed: original=${original.length} formatted=${formatted.length}`
    );
    if (!formatted.equals(original)) {
      const firstDifference = formatted.findIndex((byte, offset) => byte !== original[offset]);
      assert.fail(`${modeLabel}: FORMATTER CHANGED SEMANTICS, first differing byte at offset ${firstDifference}`);
    }
  }
}
