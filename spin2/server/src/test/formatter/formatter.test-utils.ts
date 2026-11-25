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

// ---------------------------------------------------------------------------
//  Block depth: Spin2 decides blocks by indentation
// ---------------------------------------------------------------------------

export interface CodeLineDepth {
  lineNumber: number; // 1-based, in the text it came from
  code: string; // the line's code, comments removed
  depth: number;
}

/**
 * The block depth of every statement line in each PUB/PRI body, read the way the
 * compiler reads indentation: tabs reach the next 8-column stop, and a line is inside
 * the block of the nearest shallower line above it, and a statement's column is that of
 * its first code character, after any { } comment in front of it. Comments ({ } of any
 * length and '), blank lines, preprocessor lines, inline PASM between ORG and END,
 * continuation lines after `...`, and lines that continue a statement through a { }
 * comment spanning the line break carry no depth and are left out. ORG and END lines
 * are statements.
 * Deliberately written apart from the formatter's own code so it cannot share its
 * blind spots.
 */
export function spinBlockDepths(text: string): CodeLineDepth[] {
  const result: CodeLineDepth[] = [];
  let curlyDepth = 0;
  let inMethod = false;
  let inInlinePasm = false;
  let continued = false;
  let indentStack: number[] = [];

  let statementOpen = false; // a statement continues through a { } comment's line break

  text.split(/\r?\n/).forEach((rawLine, idx) => {
    // Expand tabs, then blank out comments, keeping columns. A { } comment does not open
    // inside a "..." string or inside a backtick debug string, which runs to the ) that
    // closes debug( (checked against pnut-ts).
    let line = '';
    for (const ch of rawLine) {
      line += ch === '\t' ? ' '.repeat(8 - (line.length % 8)) : ch;
    }
    const startsInComment = curlyDepth > 0;
    let code = '';
    let inString = false;
    let inBacktick = false;
    let parens = 0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inString || inBacktick) {
        if (inString && ch === '"') inString = false;
        if (inBacktick && ch === '(') parens++;
        if (inBacktick && ch === ')' && --parens < 0) inBacktick = false;
        code += ch;
        continue;
      }
      if (curlyDepth === 0 && ch === "'") break;
      if (ch === '{') curlyDepth++;
      code += curlyDepth > 0 ? ' ' : ch;
      if (ch === '}' && curlyDepth > 0) curlyDepth--;
      if (curlyDepth === 0 && ch === '"') inString = true;
      if (curlyDepth === 0 && ch === '`') {
        inBacktick = true;
        parens = 0;
      }
    }
    const statement = code.trim();
    // A line break ends the statement only outside a { } comment.
    const continuesThroughComment = startsInComment && statementOpen;
    if (!startsInComment) statementOpen = false;
    if (statement.length > 0) statementOpen = true;
    if (statement.length === 0) return;
    if (continuesThroughComment) return; // part of the statement on an earlier line
    if (statement.startsWith('#')) return; // preprocessor

    const indent = code.length - code.trimStart().length;
    if (indent === 0 && /^(con|var|obj|dat|pub|pri)\b/i.test(statement)) {
      inMethod = /^(pub|pri)\b/i.test(statement);
      inInlinePasm = false;
      continued = false;
      indentStack = [];
      return;
    }
    if (!inMethod) return;

    const wasContinued = continued;
    continued = statement.endsWith('...');
    if (wasContinued) return;

    const isOrg = /^(org|orgh)\b/i.test(statement);
    const isEnd = /^end\b/i.test(statement);
    if (inInlinePasm && !isEnd) return;
    if (isOrg) inInlinePasm = true;
    if (isEnd) inInlinePasm = false;

    while (indentStack.length > 0 && indentStack[indentStack.length - 1] >= indent) {
      indentStack.pop();
    }
    result.push({ lineNumber: idx + 1, code: statement, depth: indentStack.length });
    indentStack.push(indent);
  });
  return result;
}

/**
 * Require every statement line in every method to keep its block depth: the same
 * statements, in the same order, each as deep as before. A formatter may change how
 * wide a level is, never which block a line belongs to.
 */
export function assertBlockDepthsPreserved(originalText: string, formattedText: string, label: string): void {
  const before = spinBlockDepths(originalText);
  const after = spinBlockDepths(formattedText);
  assert.strictEqual(after.length, before.length, `${label}: statement count changed: original=${before.length} formatted=${after.length}`);
  // Spacing and letter case inside a statement may change; the statement may not.
  const sameStatement = (a: string, b: string): boolean => a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();
  for (let i = 0; i < before.length; i++) {
    if (after[i].depth !== before[i].depth || !sameStatement(after[i].code, before[i].code)) {
      assert.fail(
        `${label}: block depth changed\n` +
          `  original  line ${before[i].lineNumber}, depth ${before[i].depth}: ${before[i].code}\n` +
          `  formatted line ${after[i].lineNumber}, depth ${after[i].depth}: ${after[i].code}`
      );
    }
  }
}
