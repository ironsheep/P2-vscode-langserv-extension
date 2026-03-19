'use strict';
// src/formatter/spin2.formatter.con.ts
//
// CON section formatter.
// Two types of lines:
//   1. Named constants: NAME = value  → align = and value to tabstops
//   2. Enum groups: #N, MEMBER, MEMBER, ...  → single space after comma, no column alignment

import {
  splitTrailingComment,
  isFullLineComment,
  isColumnZero,
  snapToNextTabstop,
  computeBlockCommentColumn,
  padToColumn,
  DEFAULT_TABSTOPS,
  ElasticTabstopConfig
} from './spin2.formatter.base';
import { DocumentFindings } from '../parser/spin.semantic.findings';

interface ConAssignment {
  lineIdx: number;
  indent: string;
  name: string;
  value: string;
  comment: string;
}

/**
 * Format lines within a CON block.
 * @param lines - all document lines (mutable reference)
 * @param startLine - first line of CON block (the CON keyword line)
 * @param endLine - last line of CON block (inclusive)
 * @param findings - parsed document findings
 * @param elasticConfig - elastic tabstop configuration
 */
export function formatConBlock(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  elasticConfig: ElasticTabstopConfig
): void {
  const tabStops = elasticConfig.enabled ? (elasticConfig.tabStops['con'] || DEFAULT_TABSTOPS.con) : DEFAULT_TABSTOPS.con;

  // Collect assignment lines for alignment
  const assignments: ConAssignment[] = [];
  const assignmentLineIndices: Set<number> = new Set();

  for (let i = startLine; i <= endLine; i++) {
    const line = lines[i];
    if (findings.isLineInBlockComment(i)) {
      continue;
    }
    if (line.trim().length === 0) {
      continue;
    }
    if (isColumnZero(line) && isFullLineComment(line)) {
      continue; // column-0 comments are never touched
    }
    if (isFullLineComment(line)) {
      continue; // indented full-line comments are not column-aligned
    }

    const trimmed = line.trimStart();

    // Skip the CON keyword line itself
    if (/^con\b/i.test(trimmed)) {
      continue;
    }

    // Detect enum lines: start with # or are comma-separated without =
    if (isEnumLine(trimmed)) {
      lines[i] = formatEnumLine(line, tabStops);
      continue;
    }

    // Detect assignment lines: contain =
    const parsed = parseAssignment(line, i);
    if (parsed) {
      assignments.push(parsed);
      assignmentLineIndices.add(i);
    }
  }

  if (assignments.length === 0) {
    return;
  }

  // Two-pass alignment for assignment lines
  // Pass 1: measure maximum name width
  let maxNameWidth = 0;
  for (const a of assignments) {
    if (a.name.length > maxNameWidth) {
      maxNameWidth = a.name.length;
    }
  }

  // Determine the = column: fixed gap after longest name (no tabstop snapping)
  const indentWidth = tabStops.length > 0 ? tabStops[0] : 2;
  const equalsCol = indentWidth + maxNameWidth + 2;

  // Value follows immediately after "= " (one space)
  const valueCol = equalsCol + 2;

  // Pass 1b: measure max content end for comment alignment
  const contentEndCols: number[] = [];
  for (const a of assignments) {
    const contentEnd = valueCol + a.value.length;
    if (a.comment.length > 0) {
      contentEndCols.push(contentEnd);
    }
  }
  const commentCol = computeBlockCommentColumn(contentEndCols, tabStops);

  // Pass 2: apply alignment
  for (const a of assignments) {
    let formatted = ' '.repeat(indentWidth) + a.name;
    formatted = padToColumn(formatted, equalsCol) + '=';
    formatted = padToColumn(formatted, valueCol) + a.value;
    if (a.comment.length > 0) {
      formatted = padToColumn(formatted, commentCol) + a.comment;
    }
    lines[a.lineIdx] = formatted;
  }
}

function isEnumLine(trimmed: string): boolean {
  // Lines starting with # are enum declarations
  if (trimmed.startsWith('#')) {
    return true;
  }
  // Lines without = that contain identifiers (continuation of enum group)
  // Check for comma-separated identifiers without =
  if (!trimmed.includes('=') && /^[A-Z_][A-Z0-9_]*\s*[,\s]/i.test(trimmed)) {
    // Could be an enum continuation — check there's no section keyword
    if (!/^(con|var|obj|dat|pub|pri)\b/i.test(trimmed)) {
      return true;
    }
  }
  return false;
}

function formatEnumLine(line: string, tabStops: number[]): string {
  const indent = line.match(/^(\s*)/)?.[1] || '';
  const [codePart, commentPart] = splitTrailingComment(line);
  const trimmedCode = codePart.trimStart();

  // Normalize whitespace: single space after each comma
  const normalized = trimmedCode.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ');

  let result = indent + normalized;

  if (commentPart.length > 0) {
    const commentCol = computeBlockCommentColumn([result.length], tabStops);
    result = padToColumn(result, commentCol) + commentPart;
  }

  return result;
}

function parseAssignment(line: string, lineIdx: number): ConAssignment | null {
  const [codePart, comment] = splitTrailingComment(line);
  const indent = codePart.match(/^(\s*)/)?.[1] || '';
  const trimmed = codePart.trimStart();

  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) {
    return null;
  }

  const name = trimmed.substring(0, eqIdx).trimEnd();
  const value = trimmed.substring(eqIdx + 1).trimStart();

  // Validate it looks like a constant assignment
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(name)) {
    return null;
  }

  return { lineIdx, indent, name, value, comment };
}
