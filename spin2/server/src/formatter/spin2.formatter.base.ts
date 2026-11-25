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

/** Where a line's literal text and trailing comment are. */
export interface LineTextRegions {
  /** literal[i] is true when line[i] is part of a string or inside a debug() call. */
  literal: boolean[];
  /** Index of the ' that starts a trailing comment, or the line length when there is none. */
  commentStart: number;
  /** Depth of a debug() call this line leaves open with `...`, for scanning the next line. */
  openDebugDepth: number;
  /** Depth of a { } comment this line leaves open, for scanning the next line. */
  openCurlyDepth: number;
}

const DEBUG_CALL_OPEN_RE = /(^|[^\w.])debug\s*(\[[^\]]*\]\s*)?$/i;

/**
 * Find the text in a line that whitespace rewriting must not touch.
 * The compiler stores strings, debug backtick text and the source text of debug()
 * expressions (debug(udec(a + b)) prints "a + b = 3"), so their whitespace is data.
 * Only a continuation line's indent is free to change.
 * Does NOT treat ' inside strings or debug backtick expressions as comments.
 * In Spin2, debug(`widget 'title' ...) uses ' as a title delimiter inside
 * backtick expressions — these must not be mistaken for line comments.
 * { } comment text is the author's (1.3), so it is marked literal too, and a ' inside
 * it starts no comment. A { opens a comment anywhere but in a string or in backtick
 * text, including in debug() arguments (checked against pnut-ts).
 *
 * @param line - the line to scan
 * @param openDebugDepth - openDebugDepth from the previous line, when scanning a whole file
 * @param openCurlyDepth - openCurlyDepth from the previous line, when scanning a whole file
 */
export function findLineTextRegions(line: string, openDebugDepth: number = 0, openCurlyDepth: number = 0): LineTextRegions {
  const literal: boolean[] = new Array(line.length).fill(false);
  let inDoubleQuote = false;
  let inBacktick = false;
  let parenDepth = 0;
  let debugDepth = openDebugDepth;
  let curlyDepth = openCurlyDepth;
  let atIndent = true;
  let commentStart = line.length;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    // a line's indent is free to change, unless the line begins inside a comment
    if (atIndent && curlyDepth === 0 && (ch === ' ' || ch === '\t')) {
      continue;
    }
    atIndent = false;
    if (curlyDepth > 0) {
      literal[i] = true;
      if (ch === '{') {
        curlyDepth++;
      } else if (ch === '}') {
        curlyDepth--;
      }
      continue;
    }
    if (inBacktick) {
      literal[i] = true;
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
          debugDepth = Math.max(0, debugDepth - 1);
        }
      }
      // ' inside backtick is a title delimiter, not a comment
      continue;
    }
    if (ch === '"') {
      literal[i] = true;
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inDoubleQuote) {
      literal[i] = true;
      continue;
    }
    if (ch === '`') {
      // Start of a backtick expression (debug widget syntax)
      literal[i] = true;
      inBacktick = true;
      parenDepth = 0;
      continue;
    }
    if (ch === '{') {
      literal[i] = true;
      curlyDepth = 1;
      continue;
    }
    if (ch === "'") {
      commentStart = i;
      break;
    }
    if (debugDepth > 0) {
      literal[i] = true;
      if (ch === '(') {
        debugDepth++;
      } else if (ch === ')') {
        debugDepth--;
      }
    } else if (ch === '(' && DEBUG_CALL_OPEN_RE.test(line.substring(0, i))) {
      debugDepth = 1;
    }
  }
  const code = line.substring(0, commentStart).trim();
  if (code.length === 0) {
    return { literal, commentStart, openDebugDepth, openCurlyDepth: curlyDepth };
  }
  return { literal, commentStart, openDebugDepth: code.endsWith('...') ? debugDepth : 0, openCurlyDepth: curlyDepth };
}

/**
 * The { } comment depth at the start of each line: 0 when the line begins outside a
 * comment. For passes that skip lines but must still know whether a line begins inside
 * a comment, e.g. a statement continued through comments that close at the start of
 * each next line.
 */
export function curlyDepthAtLineStarts(lines: string[]): number[] {
  const depths: number[] = new Array(lines.length).fill(0);
  let debugDepth = 0;
  let curlyDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    depths[i] = curlyDepth;
    const regions = findLineTextRegions(lines[i], debugDepth, curlyDepth);
    debugDepth = regions.openDebugDepth;
    curlyDepth = regions.openCurlyDepth;
  }
  return depths;
}

/**
 * Split a line into code portion and trailing comment.
 * Handles: ' comment, '' doc comment
 * Returns [codePart, commentPart] where commentPart includes the ' character.
 * If no trailing comment, commentPart is empty string.
 */
export function splitTrailingComment(line: string): [string, string] {
  const { commentStart } = findLineTextRegions(line);
  if (commentStart === line.length) {
    return [line, ''];
  }
  // found a comment start — return code trimmed of trailing space, and the comment
  return [line.substring(0, commentStart).trimEnd(), line.substring(commentStart)];
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
      if (depth === 0 && ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (depth === 0 && ch === "'") break;
      if (ch === '{') {
        if (depth === 0) blockStartLine = i;
        depth++;
      } else if (ch === '}' && depth > 0) {
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
 * Where a statement starts on a line, as the compiler reads it.
 * - `column`: visual column (tabs at 8-column stops) of the statement's first code
 *   character. The compiler takes the statement's block depth from this column, not
 *   from a { } comment in front of it.
 * - `codeStart`: string index of that character.
 * - `startsInComment`: the line begins inside a { } comment opened on an earlier line.
 *   Its lead-in up to `tailEnd` (just past the closing }) is comment text; only the
 *   whitespace from `tailEnd` to `codeStart` may change.
 */
export interface StatementStart {
  column: number;
  codeStart: number;
  startsInComment: boolean;
  tailEnd: number;
}

/**
 * Find every line in the range on which a statement starts. A line is left out when it
 * holds no code (blank, ' comment, { } comment, a line inside a { } comment) or when it
 * only continues a statement through a { } comment that spans the line break:
 *     id := init(cog,        { the cog to use
 *     }          @display)   { the display
 * The compiler skips a { } comment whole, line breaks included, so the second line is
 * part of the first statement and carries no block depth. But in
 *     { note
 *     }   b := 3
 * nothing came before the comment, so `b := 3` starts a statement at the column of `b`.
 *
 * Verified with pnut-ts: { } opens a comment anywhere except inside a "..." string and
 * inside a backtick debug string, which runs to the ) that closes the debug( call; a '
 * inside a backtick string does not start a comment either.
 * The parser's isLineInBlockComment() cannot stand in for this: it does not report
 * one-line { } comments or comment-continued lines, and it does report the closing line
 * of a multi-line comment even when a statement follows the }.
 */
export function findStatementStarts(lines: string[], startLine: number, endLine: number): Map<number, StatementStart> {
  const result = new Map<number, StatementStart>();
  let depth = 0;
  let logicalLineHasCode = false;
  for (let i = startLine; i <= endLine; i++) {
    const line = lines[i];
    const startsInComment = depth > 0;
    if (!startsInComment) logicalLineHasCode = false;
    let tailEnd = 0;
    let inString = false;
    let inBacktick = false;
    let parenDepth = 0;
    let column = 0;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const charColumn = column;
      column = ch === '\t' ? column + 8 - (column % 8) : column + 1;
      if (inString) {
        if (ch === '"') inString = false;
        continue;
      }
      if (inBacktick) {
        if (ch === '(') {
          parenDepth++;
        } else if (ch === ')' && --parenDepth < 0) {
          inBacktick = false;
        }
        continue;
      }
      if (ch === '{') {
        depth++;
        continue;
      }
      if (depth > 0) {
        if (ch === '}') {
          depth--;
          // the last comment close before the statement bounds the editable whitespace
          if (depth === 0 && startsInComment && !result.has(i)) tailEnd = j + 1;
        }
        continue;
      }
      if (ch === "'") break;
      if (ch === ' ' || ch === '\t') continue;
      // code
      if (!logicalLineHasCode && !result.has(i)) {
        result.set(i, { column: charColumn, codeStart: j, startsInComment, tailEnd });
      }
      logicalLineHasCode = true;
      if (ch === '"') {
        inString = true;
      } else if (ch === '`') {
        inBacktick = true;
        parenDepth = 0;
      }
    }
  }
  return result;
}

/** Expand tabs in `text` to spaces, given the visual column `text` starts at. */
export function expandTabsFromColumn(text: string, startColumn: number): string {
  let out = '';
  let col = startColumn;
  for (const ch of text) {
    if (ch === '\t') {
      const width = 8 - (col % 8);
      out += ' '.repeat(width);
      col += width;
    } else {
      out += ch;
      col++;
    }
  }
  return out;
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
