'use strict';
// src/formatter/spin2.formatter.method.ts
//
// PUB/PRI method body formatter (Phase 4).
// - Indentation normalization (preserve nesting level, re-express at target indent)
// - Trailing comment alignment within method bodies
// - Inline PASM delegation (ORG...END blocks drop to column 0)
// - Operator/comma spacing

import {
  splitTrailingComment,
  isFullLineComment,
  isColumnZero,
  computeBlockCommentColumn,
  padToColumn,
  DEFAULT_TABSTOPS,
  ElasticTabstopConfig
} from './spin2.formatter.base';
import { formatPasmRegionDirect } from './spin2.formatter.dat';
import { DocumentFindings } from '../parser/spin.semantic.findings';

const ORG_RE = /^\s*(org|orgh)\b/i;
const END_RE = /^\s*end\b/i;

interface InlinePasmRegion {
  orgLine: number; // the ORG keyword line
  endLine: number; // the END keyword line
}

/**
 * Format lines within a PUB or PRI method block.
 */
export function formatMethodBlock(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  elasticConfig: ElasticTabstopConfig,
  indentSize: number
): void {
  const sectionType = lines[startLine].trimStart().toLowerCase().startsWith('pub') ? 'pub' : 'pri';
  const tabStops = elasticConfig.enabled
    ? (elasticConfig.tabStops[sectionType] || DEFAULT_TABSTOPS[sectionType])
    : DEFAULT_TABSTOPS[sectionType];

  // Find inline PASM regions (ORG...END)
  const inlinePasm = findInlinePasmRegions(lines, startLine, endLine);

  // Format inline PASM regions (content drops to column 0, aligned independently)
  for (const region of inlinePasm) {
    formatInlinePasmRegion(lines, region, findings, elasticConfig);
  }

  // Normalize indentation for Spin2 code lines (not inline PASM content)
  normalizeIndentation(lines, startLine, endLine, findings, tabStops, indentSize, inlinePasm);

  // Align indented full-line comments to the indent of the next code line below
  alignFullLineComments(lines, startLine, endLine, findings, inlinePasm);

  // Align trailing comments within the method
  alignMethodComments(lines, startLine, endLine, findings, tabStops, inlinePasm);
}

function findInlinePasmRegions(lines: string[], startLine: number, endLine: number): InlinePasmRegion[] {
  const regions: InlinePasmRegion[] = [];
  let orgLine = -1;

  for (let i = startLine + 1; i <= endLine; i++) {
    const trimmed = lines[i].trimStart();
    if (ORG_RE.test(trimmed) && orgLine === -1) {
      orgLine = i;
    } else if (END_RE.test(trimmed) && orgLine !== -1) {
      regions.push({ orgLine, endLine: i });
      orgLine = -1;
    }
  }
  return regions;
}

function isInInlinePasmContent(lineIdx: number, regions: InlinePasmRegion[]): boolean {
  // Returns true for lines BETWEEN org and end (not the org/end lines themselves)
  return regions.some((r) => lineIdx > r.orgLine && lineIdx < r.endLine);
}

function isInlinePasmBoundary(lineIdx: number, regions: InlinePasmRegion[]): boolean {
  return regions.some((r) => lineIdx === r.orgLine || lineIdx === r.endLine);
}

// findNearestCodeIndent removed — org/end always use method base indent (level 1)

function formatInlinePasmRegion(
  lines: string[],
  region: InlinePasmRegion,
  findings: DocumentFindings,
  elasticConfig: ElasticTabstopConfig
): void {
  // Content between ORG and END drops to column 0 (like DAT PASM)
  for (let i = region.orgLine + 1; i < region.endLine; i++) {
    if (findings.isLineInBlockComment(i)) continue;
    if (lines[i].trim().length === 0) continue;
    // Strip leading whitespace — PASM content goes to column 0
    lines[i] = lines[i].trimStart();
  }
  // Delegate to PASM formatter directly for column alignment.
  // formatDatBlock can't be used here because it looks for ORG...END regions
  // within the range, but the ORG/END keywords are outside this range.
  const tabStops = elasticConfig.enabled
    ? (elasticConfig.tabStops['dat'] || DEFAULT_TABSTOPS.dat)
    : DEFAULT_TABSTOPS.dat;
  formatPasmRegionDirect(lines, region.orgLine + 1, region.endLine - 1, findings, tabStops);
}

function normalizeIndentation(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  tabStops: number[],
  indentSize: number,
  inlinePasm: InlinePasmRegion[]
): void {
  // Derive nesting levels from line-to-line indent changes using a stack.
  // This correctly handles files with mixed indent widths (e.g., some methods
  // at 4-space, others at 2-space) because it tracks relative depth changes
  // rather than computing absolute levels from a single global step.

  if (startLine >= endLine) return;

  // Collect code-line indices and their current indents.
  // ORG/END boundary lines participate in indent normalization (they are at the
  // enclosing code's nesting level), but PASM content between them is skipped.
  const codeLines: { lineIdx: number; indent: number }[] = [];
  for (let i = startLine + 1; i <= endLine; i++) {
    if (isInInlinePasmContent(i, inlinePasm)) continue;
    if (findings.isLineInBlockComment(i)) continue;
    const line = lines[i];
    if (line.trim().length === 0) continue;
    if (isFullLineComment(line)) continue;
    codeLines.push({ lineIdx: i, indent: getIndentColumns(line) });
  }

  if (codeLines.length === 0) return;

  // Stack-based nesting: walk code lines top-to-bottom.
  // The indent stack tracks column positions we've seen at each nesting level.
  // - Indent increases → push (go deeper)
  // - Indent same → same level
  // - Indent decreases → pop back to the matching level
  const indentStack: number[] = [codeLines[0].indent]; // level 1 = first code line's indent
  const lineLevels: Map<number, number> = new Map();

  for (const cl of codeLines) {
    const indent = cl.indent;
    const topIndent = indentStack[indentStack.length - 1];

    if (indent > topIndent) {
      // Deeper nesting — push new level
      indentStack.push(indent);
    } else if (indent < topIndent) {
      // Shallower — pop until we find a level <= this indent
      while (indentStack.length > 1 && indentStack[indentStack.length - 1] > indent) {
        indentStack.pop();
      }
      // If the indent doesn't exactly match any level we've seen,
      // it's a new level at this position (push it)
      if (indentStack[indentStack.length - 1] !== indent) {
        indentStack.push(indent);
      }
    }
    // else indent === topIndent → same level, no stack change

    lineLevels.set(cl.lineIdx, indentStack.length); // level = stack depth
  }

  // Apply: level 1 → indentSize * 1, level 2 → indentSize * 2, etc.
  for (const cl of codeLines) {
    const level = lineLevels.get(cl.lineIdx) || 1;
    const targetCol = indentSize * level;
    lines[cl.lineIdx] = ' '.repeat(targetCol) + lines[cl.lineIdx].trimStart();
  }
}

function detectIndentStep(
  lines: string[],
  startLine: number,
  endLine: number,
  inlinePasm: InlinePasmRegion[],
  findings: DocumentFindings
): number {
  // Find the smallest non-zero indentation difference between adjacent code lines
  const indents: number[] = [];
  for (let i = startLine; i <= endLine; i++) {
    if (isInInlinePasmContent(i, inlinePasm)) continue;
    if (isInlinePasmBoundary(i, inlinePasm)) continue;
    if (findings.isLineInBlockComment(i)) continue;
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    // Skip all full-line comments — their indent is not meaningful for step detection
    if (isFullLineComment(lines[i])) continue;
    indents.push(getIndentColumns(lines[i]));
  }

  if (indents.length < 2) return 2; // default

  // Find smallest positive difference
  let minDiff = Infinity;
  const uniqueIndents = [...new Set(indents)].sort((a, b) => a - b);
  for (let i = 1; i < uniqueIndents.length; i++) {
    const diff = uniqueIndents[i] - uniqueIndents[i - 1];
    if (diff > 0 && diff < minDiff) {
      minDiff = diff;
    }
  }

  return minDiff === Infinity ? 2 : minDiff;
}

function getIndentColumns(line: string): number {
  let col = 0;
  for (const ch of line) {
    if (ch === ' ') col++;
    else if (ch === '\t') col += 8 - (col % 8);
    else break;
  }
  return col;
}

function alignFullLineComments(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  inlinePasm: InlinePasmRegion[]
): void {
  // Find the first actual code line in the method body.  Everything before it
  // is method documentation ('' doc blocks for PUB, ' description blocks for
  // PRI, local variable descriptions, blank lines).  Doc comments ('') should
  // be at column 0; other comments before code are left alone.
  const firstCodeLine = findFirstCodeLine(lines, startLine + 1, endLine, findings, inlinePasm);

  // Move accidentally-indented doc comments ('') to column 0
  const docEnd = firstCodeLine >= 0 ? firstCodeLine : endLine + 1;
  for (let i = startLine + 1; i < docEnd; i++) {
    if (lines[i].trim().length === 0) continue;
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith("''") && !isColumnZero(lines[i])) {
      lines[i] = trimmed;
    }
  }

  if (firstCodeLine < 0) return; // no code lines in method

  for (let i = firstCodeLine; i <= endLine; i++) {
    if (isInInlinePasmContent(i, inlinePasm)) continue;
    if (isInlinePasmBoundary(i, inlinePasm)) continue;
    if (lines[i].trim().length === 0) continue;
    if (!isFullLineComment(lines[i])) continue;

    // The parser records consecutive single-' comment lines as "block comments"
    // in its tracking.  But these are commented-out code, not { } block comments.
    // Only skip lines that are truly inside { } or {{ }} block comments — NOT
    // single-line comment groups.
    const trimmed = lines[i].trimStart();
    if (findings.isLineInBlockComment(i) && !trimmed.startsWith("'")) continue;

    // Doc comments ('' at column 0) are documentation, not commented-out code — skip them.
    if (isColumnZero(lines[i]) && trimmed.startsWith("''")) continue;

    // All other full-line comments after the first code line are treated as
    // commented-out code and aligned to the next code line below.
    const nextIndent = findNextCodeLineIndent(lines, i + 1, endLine, findings, inlinePasm);
    if (nextIndent >= 0) {
      lines[i] = ' '.repeat(nextIndent) + lines[i].trimStart();
    }
  }
}

function findFirstCodeLine(
  lines: string[],
  fromLine: number,
  endLine: number,
  findings: DocumentFindings,
  inlinePasm: InlinePasmRegion[]
): number {
  for (let i = fromLine; i <= endLine; i++) {
    if (isInInlinePasmContent(i, inlinePasm)) continue;
    if (isInlinePasmBoundary(i, inlinePasm)) continue;
    if (findings.isLineInBlockComment(i)) continue;
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    if (isFullLineComment(lines[i])) continue;
    return i;
  }
  return -1;
}

function findNextCodeLineIndent(
  lines: string[],
  fromLine: number,
  endLine: number,
  findings: DocumentFindings,
  inlinePasm: InlinePasmRegion[]
): number {
  for (let i = fromLine; i <= endLine; i++) {
    if (isInInlinePasmContent(i, inlinePasm)) continue;
    if (isInlinePasmBoundary(i, inlinePasm)) continue;
    if (findings.isLineInBlockComment(i)) continue;
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    if (isFullLineComment(lines[i])) continue; // skip other comments too
    return getIndentColumns(lines[i]);
  }
  return -1; // no code line found below
}

function alignMethodComments(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  tabStops: number[],
  inlinePasm: InlinePasmRegion[]
): void {
  // Collect content end columns for all lines with trailing comments
  const linesWithComments: { lineIdx: number; codePart: string; commentPart: string }[] = [];
  const contentEndCols: number[] = [];

  for (let i = startLine + 1; i <= endLine; i++) {
    if (isInInlinePasmContent(i, inlinePasm)) continue;
    if (isInlinePasmBoundary(i, inlinePasm)) continue;
    if (findings.isLineInBlockComment(i)) continue;
    if (lines[i].trim().length === 0) continue;
    if (isFullLineComment(lines[i])) continue;

    const [codePart, commentPart] = splitTrailingComment(lines[i]);
    if (commentPart.length > 0) {
      linesWithComments.push({ lineIdx: i, codePart: codePart.trimEnd(), commentPart });
      contentEndCols.push(codePart.trimEnd().length);
    }
  }

  if (linesWithComments.length === 0) return;

  const commentCol = computeBlockCommentColumn(contentEndCols, tabStops);

  for (const entry of linesWithComments) {
    lines[entry.lineIdx] = padToColumn(entry.codePart, commentCol) + entry.commentPart;
  }
}
