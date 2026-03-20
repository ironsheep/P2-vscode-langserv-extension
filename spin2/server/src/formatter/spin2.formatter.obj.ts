'use strict';
// src/formatter/spin2.formatter.obj.ts
//
// OBJ section formatter.
// Lines have: NAME : "filename"  ' comment
// Token order: name, :, "filename"

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

interface ObjLine {
  lineIdx: number;
  name: string;
  filename: string; // includes the quotes
  comment: string;
}

/**
 * Format lines within an OBJ block.
 */
export function formatObjBlock(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  elasticConfig: ElasticTabstopConfig
): void {
  const tabStops = elasticConfig.enabled ? (elasticConfig.tabStops['obj'] || DEFAULT_TABSTOPS.obj) : DEFAULT_TABSTOPS.obj;

  const objLines: ObjLine[] = [];

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
    if (/^obj\b/i.test(trimmed)) {
      continue; // skip the OBJ keyword line
    }

    const parsed = parseObjLine(line, i);
    if (parsed) {
      objLines.push(parsed);
    }
  }

  if (objLines.length === 0) {
    return;
  }

  // Two-pass alignment
  const indentWidth = tabStops.length > 0 ? tabStops[0] : 2;

  // Pass 1: measure max name width
  let maxNameWidth = 0;
  for (const o of objLines) {
    if (o.name.length > maxNameWidth) {
      maxNameWidth = o.name.length;
    }
  }

  // : column — first tabstop after the longest name
  const colonCol = snapToNextTabstop(indentWidth + maxNameWidth, tabStops);

  // Measure content end for comment alignment
  // Filename is one space after the colon: ": filename"
  const contentEndCols: number[] = [];
  for (const o of objLines) {
    const contentEnd = colonCol + 2 + o.filename.length; // ": " + filename
    if (o.comment.length > 0) {
      contentEndCols.push(contentEnd);
    }
  }
  const commentCol = computeBlockCommentColumn(contentEndCols, tabStops);

  // Pass 2: apply
  for (const o of objLines) {
    let formatted = ' '.repeat(indentWidth) + o.name;
    formatted = padToColumn(formatted, colonCol) + ': ' + o.filename;
    if (o.comment.length > 0) {
      formatted = padToColumn(formatted, commentCol) + o.comment;
    }
    lines[o.lineIdx] = formatted;
  }
}

function parseObjLine(line: string, lineIdx: number): ObjLine | null {
  const [codePart, comment] = splitTrailingComment(line);
  const trimmed = codePart.trimStart();

  // Match: NAME : "filename" or NAME : "filename" | optional_params
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) {
    return null;
  }

  const name = trimmed.substring(0, colonIdx).trimEnd();
  const afterColon = trimmed.substring(colonIdx + 1).trimStart();

  // Validate it looks like an object declaration
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(name)) {
    return null;
  }

  return { lineIdx, name, filename: afterColon, comment };
}
