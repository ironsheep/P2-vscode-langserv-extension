'use strict';
// server/src/test/formatter/formatter.test-utils.ts
//
// Standalone test utilities for formatter testing.
// Provides a lightweight mock for DocumentFindings and a standalone
// formatting pipeline that doesn't require the full LSP server.

import { IBlockSpan, eBLockType } from '../../parser/spin.semantic.findings';
import { ElasticTabstopConfig, DEFAULT_TABSTOPS } from '../../formatter/spin2.formatter.base';
import { formatConBlock } from '../../formatter/spin2.formatter.con';
import { formatVarBlock } from '../../formatter/spin2.formatter.var';
import { formatObjBlock } from '../../formatter/spin2.formatter.obj';
import { formatDatBlock } from '../../formatter/spin2.formatter.dat';
import { formatMethodBlock } from '../../formatter/spin2.formatter.method';
import { normalizeKeywordCase, normalizePasmCase, normalizeCommentSpacing } from '../../formatter/spin2.formatter.comment';

// ---------------------------------------------------------------------------
//  Formatter configuration (mirrors DocumentFormattingProvider's config)
// ---------------------------------------------------------------------------
export interface FormatterConfig {
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
  maxConsecutiveBlankLines: number;
  blankLinesBetweenSections: number;
  blankLinesBetweenMethods: number;
  tabsToSpaces: boolean;
  tabWidth: number;
  indentSize: number;
  keywordCase: string;
  pasmInstructionCase: string;
  spaceAfterCommentStart: boolean;
}

export const DEFAULT_FORMATTER_CONFIG: FormatterConfig = {
  trimTrailingWhitespace: true,
  insertFinalNewline: true,
  maxConsecutiveBlankLines: 1,
  blankLinesBetweenSections: 1,
  blankLinesBetweenMethods: 2,
  tabsToSpaces: true,
  tabWidth: 8,
  indentSize: 2,
  keywordCase: 'lowercase',
  pasmInstructionCase: 'preserve',
  spaceAfterCommentStart: true
};

// ---------------------------------------------------------------------------
//  Lightweight mock for DocumentFindings
// ---------------------------------------------------------------------------

/**
 * Mock that satisfies the formatter's dependency on DocumentFindings.
 * The formatter only calls two methods:
 *   - blockSpans() → IBlockSpan[]
 *   - isLineInBlockComment(lineIdx) → boolean
 */
export class MockDocumentFindings {
  private _blockSpans: IBlockSpan[];
  private _blockCommentLines: Set<number>;

  constructor(lines: string[]) {
    this._blockSpans = scanBlocks(lines);
    this._blockCommentLines = scanBlockComments(lines);
  }

  public blockSpans(): IBlockSpan[] {
    return this._blockSpans;
  }

  public isLineInBlockComment(lineIdx: number): boolean {
    return this._blockCommentLines.has(lineIdx);
  }
}

// ---------------------------------------------------------------------------
//  Lightweight section scanner
// ---------------------------------------------------------------------------

const SECTION_KW_RE = /^(con|var|obj|dat|pub|pri)\b/i;

function keywordToBlockType(kw: string): eBLockType {
  switch (kw.toLowerCase()) {
    case 'con':
      return eBLockType.isCon;
    case 'var':
      return eBLockType.isVar;
    case 'obj':
      return eBLockType.isObj;
    case 'dat':
      return eBLockType.isDat;
    case 'pub':
      return eBLockType.isPub;
    case 'pri':
      return eBLockType.isPri;
    default:
      return eBLockType.Unknown;
  }
}

/**
 * Scan lines for section keywords (CON/VAR/OBJ/DAT/PUB/PRI) at column 0
 * and build IBlockSpan array matching the real parser's output.
 */
export function scanBlocks(lines: string[]): IBlockSpan[] {
  const spans: IBlockSpan[] = [];
  let currentType: eBLockType | null = null;
  let currentStart = 0;
  let sequenceNbr = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(SECTION_KW_RE);
    if (match) {
      // Close previous block
      if (currentType !== null) {
        spans.push({
          startLineIdx: currentStart,
          endLineIdx: i - 1,
          blockType: currentType,
          sequenceNbr: sequenceNbr++
        });
      }
      // Start new block
      currentType = keywordToBlockType(match[1]);
      currentStart = i;
    }
  }

  // Close the last block
  if (currentType !== null) {
    spans.push({
      startLineIdx: currentStart,
      endLineIdx: lines.length - 1,
      blockType: currentType,
      sequenceNbr: sequenceNbr
    });
  }

  return spans;
}

// ---------------------------------------------------------------------------
//  Lightweight block comment scanner
// ---------------------------------------------------------------------------

/**
 * Scan lines for multi-line block comments ({ } and {{ }}).
 * Returns a set of line indices that are inside block comments.
 *
 * A line is considered "in a block comment" if a { was opened on a previous
 * line and has not yet been closed, OR if the line contains the opening/closing
 * of a multi-line block comment.
 */
export function scanBlockComments(lines: string[]): Set<number> {
  const commentLines = new Set<number>();
  let depth = 0;
  let blockStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let inString = false;
    const depthAtLineStart = depth;

    for (let j = 0; j < line.length; j++) {
      const ch = line[j];

      // Track string literals (only outside block comments)
      if (depth === 0 && ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      // Line comment — skip rest of line (only outside block comments)
      if (depth === 0 && ch === "'") {
        break;
      }

      if (ch === '{') {
        if (depth === 0) {
          blockStartLine = i;
        }
        depth++;
      } else if (ch === '}' && depth > 0) {
        depth--;
        if (depth === 0) {
          // Block comment closed — mark lines if multi-line
          if (blockStartLine >= 0 && blockStartLine < i) {
            for (let k = blockStartLine; k <= i; k++) {
              commentLines.add(k);
            }
          }
          // Single-line block comment: mark if entire line is the comment
          else if (blockStartLine === i) {
            const trimmed = line.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('{{')) {
              commentLines.add(i);
            }
          }
          blockStartLine = -1;
        }
      }
    }

    // If we're still inside a multi-line block comment at end of line
    if (depth > 0) {
      commentLines.add(i);
    }
  }

  return commentLines;
}

// ---------------------------------------------------------------------------
//  Standalone formatting pipeline
// ---------------------------------------------------------------------------

/**
 * Format a .spin2 file's text using the same pipeline as DocumentFormattingProvider.
 * Does not require LSP server, Context, or real DocumentFindings.
 *
 * @param text - the raw .spin2 file content
 * @param config - formatter configuration (defaults applied for missing fields)
 * @returns the formatted text
 */
export function formatSpin2Text(text: string, config?: Partial<FormatterConfig>, elastic?: ElasticTabstopConfig): string {
  const cfg: FormatterConfig = { ...DEFAULT_FORMATTER_CONFIG, ...config };
  const elasticConfig: ElasticTabstopConfig = elastic || { enabled: false, tabStops: DEFAULT_TABSTOPS };

  let lines = text.split(/\r?\n/);

  // Build mock findings from the source lines
  const findings = new MockDocumentFindings(lines) as any; // cast to satisfy DocumentFindings parameter type

  // Phase 1a: Tab-to-space conversion (always convert for internal processing)
  lines = convertTabsToSpaces(lines, findings, cfg.tabWidth);

  // Phase 1b: Trailing whitespace trimming
  if (cfg.trimTrailingWhitespace) {
    lines = trimTrailingWhitespace(lines, findings);
  }

  // Phase 2-4: Section column alignment and method formatting
  const blockSpans: IBlockSpan[] = findings.blockSpans();
  for (const span of blockSpans) {
    switch (span.blockType) {
      case eBLockType.isCon:
        formatConBlock(lines, span.startLineIdx, span.endLineIdx, findings, elasticConfig);
        break;
      case eBLockType.isVar:
        formatVarBlock(lines, span.startLineIdx, span.endLineIdx, findings, elasticConfig);
        break;
      case eBLockType.isObj:
        formatObjBlock(lines, span.startLineIdx, span.endLineIdx, findings, elasticConfig);
        break;
      case eBLockType.isDat:
        formatDatBlock(lines, span.startLineIdx, span.endLineIdx, findings, elasticConfig);
        break;
      case eBLockType.isPub:
      case eBLockType.isPri:
        formatMethodBlock(lines, span.startLineIdx, span.endLineIdx, findings, elasticConfig, cfg.indentSize);
        break;
    }
  }

  // Phase 6: Case normalization and comment spacing
  for (const span of blockSpans) {
    if (span.blockType === eBLockType.isPub || span.blockType === eBLockType.isPri) {
      normalizeKeywordCase(lines, span.startLineIdx, span.endLineIdx, findings, cfg.keywordCase);
    }
    if (span.blockType === eBLockType.isDat) {
      normalizePasmCase(lines, span.startLineIdx, span.endLineIdx, findings, cfg.pasmInstructionCase);
    }
  }
  normalizeCommentSpacing(lines, 0, lines.length - 1, findings, cfg.spaceAfterCommentStart);

  // Phase 1c: Blank line normalization
  lines = normalizeBlankLines(lines, findings, cfg);

  // Phase 1d: Final newline
  if (cfg.insertFinalNewline) {
    lines = ensureFinalNewline(lines);
  }

  // Phase 7: Enforce tab/space preference
  // All internal formatting uses spaces. As the final step, convert to user's preference.
  if (!cfg.tabsToSpaces) {
    lines = convertSpacesToTabs(lines, findings, cfg.tabWidth);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
//  Formatting phases (replicated from DocumentFormattingProvider)
// ---------------------------------------------------------------------------

function convertTabsToSpaces(lines: string[], findings: MockDocumentFindings, tabWidth: number): string[] {
  return lines.map((line, idx) => {
    if (findings.isLineInBlockComment(idx)) {
      return line;
    }
    if (line.indexOf('\t') === -1) {
      return line;
    }
    let result = '';
    let column = 0;
    for (const ch of line) {
      if (ch === '\t') {
        const spaces = tabWidth - (column % tabWidth);
        result += ' '.repeat(spaces);
        column += spaces;
      } else {
        result += ch;
        column++;
      }
    }
    return result;
  });
}

function convertSpacesToTabs(lines: string[], findings: MockDocumentFindings, tabWidth: number): string[] {
  return lines.map((line, idx) => {
    if (findings.isLineInBlockComment(idx)) {
      return line;
    }
    // Count leading spaces
    let leadingSpaces = 0;
    while (leadingSpaces < line.length && line[leadingSpaces] === ' ') {
      leadingSpaces++;
    }
    if (leadingSpaces === 0) {
      return line;
    }
    // Convert: every tabWidth spaces → one tab, remainder stays as spaces
    const tabs = Math.floor(leadingSpaces / tabWidth);
    const remainingSpaces = leadingSpaces % tabWidth;
    return '\t'.repeat(tabs) + ' '.repeat(remainingSpaces) + line.substring(leadingSpaces);
  });
}

function trimTrailingWhitespace(lines: string[], findings: MockDocumentFindings): string[] {
  return lines.map((line, idx) => {
    if (findings.isLineInBlockComment(idx)) {
      return line;
    }
    return line.trimEnd();
  });
}

function normalizeBlankLines(lines: string[], findings: MockDocumentFindings, config: FormatterConfig): string[] {
  const blockSpans: IBlockSpan[] = findings.blockSpans();
  const result: string[] = [];
  let consecutiveBlanks = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBlank = line.trim().length === 0;
    const inBlockComment = findings.isLineInBlockComment(i);

    if (inBlockComment) {
      consecutiveBlanks = 0;
      result.push(line);
      continue;
    }

    if (isBlank) {
      consecutiveBlanks++;
      if (consecutiveBlanks <= config.maxConsecutiveBlankLines) {
        result.push(line);
      }
    } else {
      if (consecutiveBlanks > 0) {
        const boundaryBlanks = getDesiredBlanksBeforeLine(i, blockSpans, config);
        if (boundaryBlanks !== undefined) {
          while (result.length > 0 && result[result.length - 1].trim().length === 0) {
            result.pop();
          }
          for (let b = 0; b < boundaryBlanks; b++) {
            result.push('');
          }
        }
      }
      consecutiveBlanks = 0;
      result.push(line);
    }
  }

  return result;
}

function getDesiredBlanksBeforeLine(lineIdx: number, blockSpans: IBlockSpan[], config: FormatterConfig): number | undefined {
  for (let i = 0; i < blockSpans.length; i++) {
    const span = blockSpans[i];
    if (span.startLineIdx === lineIdx && i > 0) {
      const prevSpan = blockSpans[i - 1];
      const isMethodTransition =
        (prevSpan.blockType === eBLockType.isPub || prevSpan.blockType === eBLockType.isPri) &&
        (span.blockType === eBLockType.isPub || span.blockType === eBLockType.isPri);
      if (isMethodTransition) {
        return config.blankLinesBetweenMethods;
      }
      return config.blankLinesBetweenSections;
    }
  }
  return undefined;
}

function ensureFinalNewline(lines: string[]): string[] {
  if (lines.length === 0) {
    return [''];
  }
  while (lines.length > 1 && lines[lines.length - 1].trim().length === 0) {
    lines.pop();
  }
  if (lines[lines.length - 1].length > 0) {
    lines.push('');
  }
  return lines;
}
