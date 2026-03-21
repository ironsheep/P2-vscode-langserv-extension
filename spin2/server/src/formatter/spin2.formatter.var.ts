'use strict';
// src/formatter/spin2.formatter.var.ts
//
// VAR section formatter.
// Lines have: TYPE NAME[COUNT], NAME[COUNT], ...  ' comment
// Token order: type (BYTE/WORD/LONG), name(s) with optional [count]
// Columns: type, name+count, comment

import {
  splitTrailingComment,
  isFullLineComment,
  isColumnZero,
  isPreprocessorLine,
  findCurlyBlockCommentLines,
  snapToNextTabstop,
  computeBlockCommentColumn,
  padToColumn,
  DEFAULT_TABSTOPS,
  ElasticTabstopConfig
} from './spin2.formatter.base';
import { DocumentFindings } from '../parser/spin.semantic.findings';

interface VarLine {
  lineIdx: number;
  type: string;
  names: string; // the name(s) portion including array counts, commas
  comment: string;
}

/**
 * Format lines within a VAR block.
 */
export function formatVarBlock(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  elasticConfig: ElasticTabstopConfig
): void {
  const tabStops = elasticConfig.enabled ? (elasticConfig.tabStops['var'] || DEFAULT_TABSTOPS.var) : DEFAULT_TABSTOPS.var;

  const varLines: VarLine[] = [];

  for (let i = startLine; i <= endLine; i++) {
    const line = lines[i];
    if (findings.isLineInBlockComment(i)) {
      continue;
    }
    if (line.trim().length === 0) {
      continue;
    }
    if (isColumnZero(line) && isFullLineComment(line)) {
      continue;
    }
    if (isFullLineComment(line)) {
      continue;
    }

    const trimmed = line.trimStart();
    if (/^var\b/i.test(trimmed)) {
      continue; // skip the VAR keyword line
    }
    if (isPreprocessorLine(line)) {
      continue;
    }

    const parsed = parseVarLine(line, i);
    if (parsed) {
      varLines.push(parsed);
    }
  }

  if (varLines.length === 0) {
    return;
  }

  // Two-pass alignment
  // Pass 1: measure
  const indentWidth = tabStops.length > 0 ? tabStops[0] : 2;
  let maxTypeWidth = 0;
  for (const v of varLines) {
    if (v.type.length > maxTypeWidth) {
      maxTypeWidth = v.type.length;
    }
  }

  const nameCol = snapToNextTabstop(indentWidth + maxTypeWidth, tabStops);

  // Measure content end for comment alignment
  const contentEndCols: number[] = [];
  for (const v of varLines) {
    const contentEnd = nameCol + v.names.length;
    if (v.comment.length > 0) {
      contentEndCols.push(contentEnd);
    }
  }
  const commentCol = computeBlockCommentColumn(contentEndCols, tabStops);

  // Pass 2: apply
  for (const v of varLines) {
    let formatted = ' '.repeat(indentWidth) + v.type;
    formatted = padToColumn(formatted, nameCol) + v.names;
    if (v.comment.length > 0) {
      formatted = padToColumn(formatted, commentCol) + v.comment;
    }
    lines[v.lineIdx] = formatted;
  }

  // Align indented full-line comments to the same indent as declarations.
  const curlyBlockLines = findCurlyBlockCommentLines(lines, startLine, endLine);
  for (let i = startLine; i <= endLine; i++) {
    if (curlyBlockLines.has(i)) continue;
    const trimmed = lines[i].trimStart();
    if (lines[i].trim().length === 0) continue;
    if (!isFullLineComment(lines[i])) continue;
    if (/^var\b/i.test(trimmed)) continue;
    if (isColumnZero(lines[i])) continue;
    lines[i] = ' '.repeat(indentWidth) + trimmed;
  }
}

function parseVarLine(line: string, lineIdx: number): VarLine | null {
  const [codePart, comment] = splitTrailingComment(line);
  const trimmed = codePart.trimStart();

  // Match type keyword at start
  const typeMatch = trimmed.match(/^(byte|word|long)\b\s*/i);
  if (!typeMatch) {
    return null;
  }

  const type = typeMatch[1].toUpperCase();
  const rest = trimmed.substring(typeMatch[0].length).trim();
  // Normalize spacing in the names portion: single space after comma
  const names = rest.replace(/\s*,\s*/g, ', ');

  return { lineIdx, type, names, comment };
}
