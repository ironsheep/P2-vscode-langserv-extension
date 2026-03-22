'use strict';
// src/formatter/spin2.formatter.base.ts
//
// Shared utilities for all section formatters:
//   - Elastic tabstop snapping
//   - Column alignment (two-pass measure/apply)
//   - Trailing comment extraction
//   - Block comment line detection helpers

const MIN_COLUMN_GAP = 2;

/** Default PropellerTool tabstop arrays (used as fallback for elastic profiles with missing sections) */
export const DEFAULT_TABSTOPS: Record<string, number[]> = {
  con: [2, 8, 16, 18, 32, 56, 78, 80],
  var: [2, 8, 22, 32, 56, 80],
  obj: [2, 8, 16, 18, 32, 56, 80],
  pub: [2, 4, 6, 8, 10, 12, 14, 16, 32, 56, 80],
  pri: [2, 4, 6, 8, 10, 12, 14, 16, 32, 56, 80],
  dat: [8, 14, 24, 32, 48, 56, 80]
};

/**
 * Build a regular-grid tabstop array for all sections.
 * Used when elastic tabstops are disabled — the grid spacing is the indentSize.
 * @param gridSize - column spacing (indentSize)
 * @param lineWidth - maximum line width (default 80)
 */
export function buildRegularTabStops(gridSize: number, lineWidth: number = 80): Record<string, number[]> {
  const stops: number[] = [];
  for (let col = gridSize; col <= lineWidth; col += gridSize) {
    stops.push(col);
  }
  // Ensure lineWidth is the last stop (for getLineWidth/getCommentColumn conventions)
  if (stops.length === 0 || stops[stops.length - 1] !== lineWidth) {
    stops.push(lineWidth);
  }
  return {
    con: stops,
    var: stops,
    obj: stops,
    pub: stops,
    pri: stops,
    dat: stops
  };
}

/**
 * Snap a column position to the next tabstop that provides at least MIN_COLUMN_GAP
 * after the given content end position.
 * @param contentEndCol - column where the content ends (0-based)
 * @param tabStops - the elastic tabstop array for this section
 * @returns the column to place the next token at
 */
export function snapToNextTabstop(contentEndCol: number, tabStops: number[]): number {
  const minCol = contentEndCol + MIN_COLUMN_GAP;
  for (const stop of tabStops) {
    if (stop >= minCol) {
      return stop;
    }
  }
  // past all tabstops — just use min gap
  return minCol;
}

/**
 * Get the trailing comment column from a tabstop array.
 * Convention: last stop = line width, second-to-last = comment column.
 */
export function getCommentColumn(tabStops: number[]): number {
  if (tabStops.length >= 2) {
    return tabStops[tabStops.length - 2];
  }
  return 56; // fallback
}

/**
 * Get the line width from a tabstop array (last stop).
 */
export function getLineWidth(tabStops: number[]): number {
  if (tabStops.length >= 1) {
    return tabStops[tabStops.length - 1];
  }
  return 80; // fallback
}

/**
 * Split a line into code portion and trailing comment.
 * Handles: ' comment, '' doc comment
 * Does NOT treat ' inside strings or debug backtick expressions as comments.
 * In Spin2, debug(`widget 'title' ...) uses ' as a title delimiter inside
 * backtick expressions — these must not be mistaken for line comments.
 * Returns [codePart, commentPart] where commentPart includes the ' character.
 * If no trailing comment, commentPart is empty string.
 */
export function splitTrailingComment(line: string): [string, string] {
  let inDoubleQuote = false;
  let inBacktick = false;
  let parenDepth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inBacktick) {
      // Inside a backtick expression: track parens to find the enclosing close-paren.
      // Paren depth starts at 0 when entering backtick mode; nested ( ) pairs within
      // the expression are balanced.  The ) that closes the enclosing debug() call
      // brings depth below 0 — that is where the backtick expression ends.
      if (ch === '(') {
        parenDepth++;
      } else if (ch === ')') {
        parenDepth--;
        if (parenDepth < 0) {
          inBacktick = false;
          parenDepth = 0;
        }
      }
      // ' inside backtick is a title delimiter, not a comment
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inDoubleQuote) continue;
    if (ch === '`') {
      // Start of a backtick expression (debug widget syntax)
      inBacktick = true;
      parenDepth = 0;
      continue;
    }
    if (ch === "'") {
      // found a comment start — return code trimmed of trailing space, and the comment
      const codePart = line.substring(0, i).trimEnd();
      const commentPart = line.substring(i);
      return [codePart, commentPart];
    }
  }
  return [line, ''];
}

/**
 * Check if a line is a full-line comment (only a comment, no code).
 * Includes lines starting with ' or '' (with optional leading whitespace).
 */
export function isFullLineComment(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("'");
}

/**
 * Check if a line starts at column 0 (no leading whitespace).
 * Column-0 comments are never reformatted.
 */
export function isColumnZero(line: string): boolean {
  return line.length > 0 && line[0] !== ' ' && line[0] !== '\t';
}

/**
 * Build a set of line indices that are inside { } block comments.
 * This is independent of the parser's isLineInBlockComment() which also
 * includes consecutive ' comment groups.  The formatter needs to distinguish
 * the two: { } block content is truly untouchable, while ' groups may need
 * comment alignment.
 */
export function findCurlyBlockCommentLines(lines: string[], startLine: number, endLine: number): Set<number> {
  const result = new Set<number>();
  let depth = 0;
  let blockStartLine = -1;
  for (let i = startLine; i <= endLine; i++) {
    const line = lines[i];
    let inString = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (depth === 0 && ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (depth === 0 && ch === "'") break;
      if (ch === '{') { if (depth === 0) blockStartLine = i; depth++; }
      else if (ch === '}' && depth > 0) {
        depth--;
        if (depth === 0) {
          for (let k = blockStartLine; k <= i; k++) result.add(k);
          blockStartLine = -1;
        }
      }
    }
    if (depth > 0) result.add(i);
  }
  return result;
}

/**
 * Check if a line is a preprocessor directive (#define, #ifdef, #include, etc.).
 * These are never reformatted — they must stay exactly as written.
 */
export function isPreprocessorLine(line: string): boolean {
  const trimmed = line.trimStart();
  return /^#(define|ifdef|ifndef|else|elseifdef|elseifndef|endif|undef|pragma|include|error|warn)\b/i.test(trimmed);
}

/**
 * Given an array of measured content-end columns (one per line in a block),
 * determine the best comment alignment column.
 *
 * When fixedGap > 0 (non-elastic mode): column = maxContentEnd + fixedGap,
 * with a floor of MIN_COLUMN_GAP so comments never overlap code.
 *
 * When fixedGap == 0 (elastic mode): snap to the profile's tabstop grid.
 */
export function computeBlockCommentColumn(contentEndCols: number[], tabStops: number[], fixedGap: number = 0): number {
  if (contentEndCols.length === 0) {
    return getCommentColumn(tabStops);
  }
  const maxContentEnd = Math.max(...contentEndCols);

  if (fixedGap > 0) {
    // Non-elastic: fixed gap past widest line, floor of MIN_COLUMN_GAP
    return maxContentEnd + Math.max(fixedGap, MIN_COLUMN_GAP);
  }

  // Elastic: snap to profile tabstop grid
  const defaultCommentCol = getCommentColumn(tabStops);
  if (maxContentEnd + MIN_COLUMN_GAP <= defaultCommentCol) {
    return defaultCommentCol;
  }
  return snapToNextTabstop(maxContentEnd, tabStops);
}

/**
 * Pad a string to a target column width.
 */
export function padToColumn(content: string, targetCol: number): string {
  if (content.length >= targetCol) {
    return content + ' '.repeat(MIN_COLUMN_GAP);
  }
  return content + ' '.repeat(targetCol - content.length);
}

/**
 * Rebuild a line from token columns, snapping each to the appropriate position.
 * @param tokens - array of token strings in left-to-right order
 * @param tabStops - elastic tabstops for this section
 * @param startCol - column to place the first token (for indented content)
 * @returns the formatted line
 */
export function alignTokensToGrid(tokens: string[], tabStops: number[], startCol: number = 0): string {
  if (tokens.length === 0) {
    return '';
  }
  let result = ' '.repeat(startCol) + tokens[0];
  let col = startCol + tokens[0].length;
  for (let i = 1; i < tokens.length; i++) {
    const nextCol = snapToNextTabstop(col, tabStops);
    result = padToColumn(result, nextCol) + tokens[i];
    col = nextCol + tokens[i].length;
  }
  return result;
}

/**
 * Align `...` line-continuation markers vertically within each group of
 * consecutive continuation lines.  The `...` column is placed at
 * widestCodePart + gap, where gap = commentGap (non-elastic) or snaps to
 * the next tabstop (elastic).  A group is one or more consecutive lines
 * whose code (before any trailing comment) ends with ` ...`.
 */
export function alignContinuationGroups(lines: string[], commentGap: number, tabStops: number[]): void {
  let groupStart = -1;

  const flush = (groupEnd: number) => {
    if (groupStart === -1) return;
    alignGroup(lines, groupStart, groupEnd, commentGap, tabStops);
    groupStart = -1;
  };

  for (let i = 0; i < lines.length; i++) {
    if (lineHasContinuation(lines[i])) {
      if (groupStart === -1) groupStart = i;
    } else {
      flush(i - 1);
    }
  }
  flush(lines.length - 1);
}

/** Does this line end with ` ...` (before an optional trailing comment)? */
function lineHasContinuation(line: string): boolean {
  const [codePart] = splitTrailingComment(line);
  const trimmed = codePart.trimEnd();
  return trimmed.endsWith(' ...') || trimmed === '...';
}

/** Split a continuation line into: code before `...`, and `... [comment]`. */
function splitContinuation(line: string): [string, string] {
  const [codePart, commentPart] = splitTrailingComment(line);
  const trimmedCode = codePart.trimEnd();
  const dotsIdx = trimmedCode.lastIndexOf('...');
  if (dotsIdx < 0) return [line, ''];
  const beforeDots = trimmedCode.substring(0, dotsIdx).trimEnd();
  const afterDots = commentPart; // trailing comment (may be empty)
  return [beforeDots, afterDots];
}

function alignGroup(lines: string[], start: number, end: number, commentGap: number, tabStops: number[]): void {
  // Measure widest code portion (before `...`) in the group
  const parts: { beforeDots: string; comment: string }[] = [];
  let maxCodeWidth = 0;
  for (let i = start; i <= end; i++) {
    const [beforeDots, comment] = splitContinuation(lines[i]);
    parts.push({ beforeDots, comment });
    if (beforeDots.length > maxCodeWidth) {
      maxCodeWidth = beforeDots.length;
    }
  }

  // Compute the `...` column: fixed gap or tabstop-snapped
  let dotsCol: number;
  if (commentGap > 0) {
    dotsCol = maxCodeWidth + Math.max(commentGap, MIN_COLUMN_GAP);
  } else {
    dotsCol = snapToNextTabstop(maxCodeWidth, tabStops);
  }

  // Rebuild each line with aligned `...`
  for (let i = start; i <= end; i++) {
    const { beforeDots, comment } = parts[i - start];
    let rebuilt = beforeDots;
    // Pad to the dots column
    if (rebuilt.length < dotsCol) {
      rebuilt += ' '.repeat(dotsCol - rebuilt.length);
    } else {
      rebuilt += ' '.repeat(MIN_COLUMN_GAP);
    }
    rebuilt += '...';
    if (comment.length > 0) {
      rebuilt += '    ' + comment; // preserve some gap before comment
    }
    lines[i] = rebuilt;
  }
}

export interface ElasticTabstopConfig {
  enabled: boolean;
  tabStops: Record<string, number[]>;
  /** Fixed gap (in columns) between widest code and comment/continuation alignment.
   *  Set to 2×indentSize for non-elastic mode; 0 means use tabstop-snapping (elastic). */
  commentGap: number;
}
