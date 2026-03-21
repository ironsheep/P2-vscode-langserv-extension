'use strict';
// src/formatter/spin2.formatter.base.ts
//
// Shared utilities for all section formatters:
//   - Elastic tabstop snapping
//   - Column alignment (two-pass measure/apply)
//   - Trailing comment extraction
//   - Block comment line detection helpers

const MIN_COLUMN_GAP = 2;

/** Default PropellerTool tabstop arrays (used when elastic tabstops are disabled) */
export const DEFAULT_TABSTOPS: Record<string, number[]> = {
  con: [2, 8, 16, 18, 32, 56, 78, 80],
  var: [2, 8, 22, 32, 56, 80],
  obj: [2, 8, 16, 18, 32, 56, 80],
  pub: [2, 4, 6, 8, 10, 12, 14, 16, 32, 56, 80],
  pri: [2, 4, 6, 8, 10, 12, 14, 16, 32, 56, 80],
  dat: [8, 14, 24, 32, 48, 56, 80]
};

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
 * Check if a line is a preprocessor directive (#define, #ifdef, #include, etc.).
 * These are never reformatted — they must stay exactly as written.
 */
export function isPreprocessorLine(line: string): boolean {
  const trimmed = line.trimStart();
  return /^#(define|ifdef|ifndef|else|elseifdef|elseifndef|endif|undef|pragma|include|error|warn)\b/i.test(trimmed);
}

/**
 * Given an array of measured content-end columns (one per line in a block),
 * determine the best comment alignment column using the tabstop grid.
 */
export function computeBlockCommentColumn(contentEndCols: number[], tabStops: number[]): number {
  if (contentEndCols.length === 0) {
    return getCommentColumn(tabStops);
  }
  const maxContentEnd = Math.max(...contentEndCols);
  const defaultCommentCol = getCommentColumn(tabStops);
  // if all content fits before the default comment column (with gap), use it
  if (maxContentEnd + MIN_COLUMN_GAP <= defaultCommentCol) {
    return defaultCommentCol;
  }
  // otherwise snap to next tabstop after the longest content
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

export interface ElasticTabstopConfig {
  enabled: boolean;
  tabStops: Record<string, number[]>;
}
