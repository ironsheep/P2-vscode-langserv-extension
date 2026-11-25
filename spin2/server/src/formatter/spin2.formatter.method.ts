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
  isPreprocessorLine,
  findStatementStarts,
  StatementStart,
  expandTabsFromColumn,
  findCurlyBlockCommentLines,
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
  const tabStops = elasticConfig.tabStops[sectionType] || DEFAULT_TABSTOPS[sectionType];

  // Find inline PASM regions (ORG...END)
  const inlinePasm = findInlinePasmRegions(lines, startLine, endLine);

  // Format inline PASM regions (content drops to column 0, aligned independently)
  for (const region of inlinePasm) {
    formatInlinePasmRegion(lines, region, findings, elasticConfig);
  }

  // Which lines start a statement, and at what column, is decided the way the compiler
  // decides it (findStatementStarts), not from the parser's block-comment report. A
  // one-line { } comment such as {$flexspin #endif}, or a line continuing a statement
  // through a { } comment, taken as code at its column, reset the indent base and moved
  // the code after it into a different block (D.21).
  // Normalize indentation for Spin2 code lines (not inline PASM content)
  normalizeIndentation(lines, startLine, endLine, indentSize, inlinePasm, findStatementStarts(lines, startLine, endLine));

  // Columns moved: find the statement starts again for the comment passes.
  const statements = findStatementStarts(lines, startLine, endLine);

  // Align indented full-line comments to the indent of the next code line below
  alignFullLineComments(lines, startLine, endLine, inlinePasm, statements);

  // Align trailing comments within the method
  alignMethodComments(lines, startLine, endLine, findings, tabStops, inlinePasm, elasticConfig.commentGap, statements);
}

/** Lines on which a statement starts, from findStatementStarts(). */
type Statements = Map<number, StatementStart>;

/** True when a statement starts on the line and it takes part in block structure. */
function isStatementLine(lines: string[], lineIdx: number, statements: Statements): boolean {
  return statements.has(lineIdx) && !isPreprocessorLine(lines[lineIdx]);
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function formatInlinePasmRegion(lines: string[], region: InlinePasmRegion, findings: DocumentFindings, elasticConfig: ElasticTabstopConfig): void {
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
  // Always use DEFAULT_TABSTOPS.dat with tabstop-snapped layout (commentGap=0)
  // so PASM gets proper assembly column positions regardless of indent mode.
  const tabStops = DEFAULT_TABSTOPS.dat;
  formatPasmRegionDirect(lines, region.orgLine + 1, region.endLine - 1, findings, tabStops, 0);
}

function normalizeIndentation(
  lines: string[],
  startLine: number,
  endLine: number,
  indentSize: number,
  inlinePasm: InlinePasmRegion[],
  statements: Statements
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
  // A line that starts no statement (blank, comment, or continuing a statement through a
  // { } comment) carries no depth and keeps its text as written (1.3). A statement's
  // depth comes from the column of its first code character.
  for (let i = startLine + 1; i <= endLine; i++) {
    if (isInInlinePasmContent(i, inlinePasm)) continue;
    if (!isStatementLine(lines, i, statements)) continue;
    codeLines.push({ lineIdx: i, indent: statements.get(i)!.column });
  }

  if (codeLines.length === 0) return;

  // Stack-based nesting: walk code lines top-to-bottom.
  // The indent stack tracks column positions we've seen at each nesting level.
  // - Indent increases → push (go deeper)
  // - Indent same → same level
  // - Indent decreases → pop back to the matching level
  //
  // Mixed-indent handling: when a file uses inconsistent indent widths
  // (e.g., tabs=8 and spaces=4 for the same nesting level), a line can
  // have LESS indent than the base (stack[0]).  In that case, update the
  // base rather than pushing a false deeper level.
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
      if (indentStack[indentStack.length - 1] !== indent) {
        if (indentStack.length === 1 && indent <= indentStack[0]) {
          // Indent is below the base level (mixed indent widths for the same
          // nesting depth, e.g., tabs=8 and spaces=4 both meaning level 1).
          // Update the base to the smaller value — this line is at the same
          // logical level, not a deeper one.
          indentStack[0] = indent;
        } else {
          // New level between existing levels (indent > base but < previous top)
          indentStack.push(indent);
        }
      }
    }
    // else indent === topIndent → same level, no stack change

    lineLevels.set(cl.lineIdx, indentStack.length); // level = stack depth
  }

  // Apply: level 1 → indentSize * 1, level 2 → indentSize * 2, etc.
  // The statement's first code character goes to the target column:
  // - after a comment's closing } at the start of the line, only the whitespace between
  //   the } and the statement can change;
  // - otherwise the whole line moves, a { } comment in front of the statement with it.
  // When the target cannot be reached that way, the method cannot be re-expressed without
  // moving a statement to another depth, so its indentation is left exactly as written.
  const newLines: Map<number, string> = new Map();
  for (const cl of codeLines) {
    const level = lineLevels.get(cl.lineIdx) || 1;
    const targetCol = indentSize * level;
    const line = lines[cl.lineIdx];
    const stmt = statements.get(cl.lineIdx)!;
    if (stmt.startsInComment) {
      const tailCol = visualColumn(line, stmt.tailEnd);
      if (targetCol < tailCol) return;
      newLines.set(cl.lineIdx, line.substring(0, stmt.tailEnd) + ' '.repeat(targetCol - tailCol) + line.substring(stmt.codeStart));
    } else {
      const leadCol = getIndentColumns(line);
      const newLeadCol = leadCol + (targetCol - stmt.column);
      if (newLeadCol < 0) return;
      const textStart = line.length - line.trimStart().length;
      // a comment in front of the statement keeps its width wherever it moves to
      const prefix = expandTabsFromColumn(line.substring(textStart, stmt.codeStart), leadCol);
      newLines.set(cl.lineIdx, ' '.repeat(newLeadCol) + prefix + line.substring(stmt.codeStart));
    }
  }
  for (const [lineIdx, newLine] of newLines) {
    lines[lineIdx] = newLine;
  }
}

/** The visual column at string index `index`, tabs at 8-column stops. */
function visualColumn(line: string, index: number): number {
  let col = 0;
  for (let i = 0; i < index && i < line.length; i++) {
    col = line[i] === '\t' ? col + 8 - (col % 8) : col + 1;
  }
  return col;
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

function alignFullLineComments(lines: string[], startLine: number, endLine: number, inlinePasm: InlinePasmRegion[], statements: Statements): void {
  // Find the first actual code line in the method body.  Everything before it
  // is method documentation ('' doc blocks for PUB, ' description blocks for
  // PRI, local variable descriptions, blank lines).  Doc comments ('') should
  // be at column 0; other comments before code are left alone.
  const firstCodeLine = findFirstCodeLine(lines, startLine + 1, endLine, inlinePasm, statements);

  // Move accidentally-indented method comments (' and '') to column 0.
  // All comment lines between the PUB/PRI declaration and the first code line
  // are method documentation and belong at column 0.
  // Use curly-block scan so { } block content is not touched.
  const curlyBlockDocLines = findCurlyBlockCommentLines(lines, startLine, endLine);
  const docEnd = firstCodeLine >= 0 ? firstCodeLine : endLine + 1;
  for (let i = startLine + 1; i < docEnd; i++) {
    if (curlyBlockDocLines.has(i)) continue;
    if (lines[i].trim().length === 0) continue;
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith("'") && !isColumnZero(lines[i])) {
      lines[i] = trimmed;
    }
  }

  if (firstCodeLine < 0) return; // no code lines in method

  // Use curly-block scan to skip { } content while allowing ' groups through.
  const curlyBlockLines = findCurlyBlockCommentLines(lines, startLine, endLine);
  for (let i = firstCodeLine; i <= endLine; i++) {
    if (isInInlinePasmContent(i, inlinePasm)) continue;
    if (isInlinePasmBoundary(i, inlinePasm)) continue;
    if (curlyBlockLines.has(i)) continue;
    if (lines[i].trim().length === 0) continue;
    if (!isFullLineComment(lines[i])) continue;

    const trimmed = lines[i].trimStart();

    // Doc comments ('' at column 0) are documentation, not commented-out code — skip them.
    if (isColumnZero(lines[i]) && trimmed.startsWith("''")) continue;

    // All other full-line comments after the first code line are treated as
    // commented-out code and aligned to the next code line below.
    const nextIndent = findNextCodeLineIndent(lines, i + 1, endLine, inlinePasm, statements);
    if (nextIndent >= 0) {
      lines[i] = ' '.repeat(nextIndent) + lines[i].trimStart();
    }
  }
}

function findFirstCodeLine(lines: string[], fromLine: number, endLine: number, inlinePasm: InlinePasmRegion[], statements: Statements): number {
  for (let i = fromLine; i <= endLine; i++) {
    if (isInInlinePasmContent(i, inlinePasm)) continue;
    if (isInlinePasmBoundary(i, inlinePasm)) continue;
    if (!statements.has(i)) continue;
    return i;
  }
  return -1;
}

function findNextCodeLineIndent(lines: string[], fromLine: number, endLine: number, inlinePasm: InlinePasmRegion[], statements: Statements): number {
  for (let i = fromLine; i <= endLine; i++) {
    // ORG and END are code at the enclosing statement's level (D.2), so a comment
    // above ORG lines up with ORG, not with the code after END.
    if (isInInlinePasmContent(i, inlinePasm)) continue;
    if (!isStatementLine(lines, i, statements)) continue;
    return statements.get(i)!.column;
  }
  return -1; // no code line found below
}

function alignMethodComments(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  tabStops: number[],
  inlinePasm: InlinePasmRegion[],
  commentGap: number,
  statements: Statements
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
    // No statement on the line, or one after comment text the ' search could misread
    const stmt = statements.get(i);
    if (stmt === undefined || stmt.startsInComment) continue;

    const [codePart, commentPart] = splitTrailingComment(lines[i]);
    if (commentPart.length > 0) {
      linesWithComments.push({ lineIdx: i, codePart: codePart.trimEnd(), commentPart });
      contentEndCols.push(codePart.trimEnd().length);
    }
  }

  if (linesWithComments.length === 0) return;

  const commentCol = computeBlockCommentColumn(contentEndCols, tabStops, commentGap);

  for (const entry of linesWithComments) {
    lines[entry.lineIdx] = padToColumn(entry.codePart, commentCol) + entry.commentPart;
  }
}
