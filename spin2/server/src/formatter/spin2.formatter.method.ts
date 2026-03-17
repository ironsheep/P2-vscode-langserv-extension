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
import { formatDatBlock } from './spin2.formatter.dat';
import { DocumentFindings } from '../parser/spin.semantic.findings';

const ORG_RE = /^\s*org\b/i;
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
  // Delegate to DAT formatter for column alignment within the region
  formatDatBlock(lines, region.orgLine + 1, region.endLine - 1, findings, elasticConfig);
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
  // Skip the PUB/PRI declaration line itself
  // Determine the base indent of the method body
  // Derive nesting levels from relative indentation changes

  if (startLine >= endLine) return;

  // Find the first non-blank code line after the method declaration to establish base indent
  let baseIndent = -1;
  for (let i = startLine + 1; i <= endLine; i++) {
    if (isInInlinePasmContent(i, inlinePasm)) continue;
    if (isInlinePasmBoundary(i, inlinePasm)) continue;
    if (findings.isLineInBlockComment(i)) continue;
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    if (isColumnZero(lines[i]) && isFullLineComment(lines[i])) continue;
    baseIndent = getIndentColumns(lines[i]);
    break;
  }

  if (baseIndent < 0) return; // no code lines found

  // Compute the current indent step being used
  const currentIndentStep = detectIndentStep(lines, startLine + 1, endLine, inlinePasm, findings);
  if (currentIndentStep <= 0) return; // can't determine

  for (let i = startLine + 1; i <= endLine; i++) {
    if (isInInlinePasmContent(i, inlinePasm)) continue;
    if (isInlinePasmBoundary(i, inlinePasm)) continue;
    if (findings.isLineInBlockComment(i)) continue;

    const line = lines[i];
    if (line.trim().length === 0) continue;
    if (isColumnZero(line) && isFullLineComment(line)) continue;

    const currentIndent = getIndentColumns(line);
    // Compute logical nesting level relative to the base indent
    const level = Math.max(0, Math.round((currentIndent - baseIndent) / currentIndentStep)) + 1;

    // Re-express at target indent using indentSize * level.
    // This produces consistent, predictable indentation that is always idempotent.
    // The tabstop arrays (e.g. pub: [2, 4, 6, 8, 10, 12, 14, 16, 32, 56, 80])
    // have their indentation region sized in increments of 2, which matches the
    // default indentSize.  For non-default indentSize values, tabstop-based
    // indentation would create mixed progressions that break on re-detection.
    const targetCol = indentSize * level;

    const newLine = ' '.repeat(targetCol) + line.trimStart();
    lines[i] = newLine;
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
    if (isColumnZero(lines[i]) && isFullLineComment(lines[i])) continue;
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
