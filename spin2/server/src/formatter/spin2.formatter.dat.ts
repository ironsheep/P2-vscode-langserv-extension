'use strict';
// src/formatter/spin2.formatter.dat.ts
//
// DAT section formatter. Handles both data declarations and PASM instructions.
// Data lines: label, type (LONG/WORD/BYTE), value, comment (4 columns)
// PASM lines: label, condition, mnemonic, operands, effects, comment (6 columns)
// Each ORG region is an independent alignment scope.

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

// PASM condition prefixes
const CONDITION_RE = /^(if_[a-z_]+|_ret_)\s+/i;
// PASM effect suffixes
const EFFECTS_RE = /\b(wcz|wc|wz)\s*$/i;
// Data type keywords
const DATA_TYPE_RE = /^(byte|word|long)\b/i;
// ORG/FIT/END keywords
const ORG_RE = /^\s*(org|orgh)\b/i;
const FIT_RE = /^\s*(fit|end)\b/i;

interface DatDataLine {
  lineIdx: number;
  label: string;
  type: string;
  value: string;
  comment: string;
}

interface PasmLine {
  lineIdx: number;
  label: string;
  condition: string;
  mnemonic: string;
  operands: string;
  effects: string;
  comment: string;
}

interface OrgRegion {
  startLine: number;
  endLine: number; // inclusive
}

/**
 * Format lines within a DAT block.
 */
export function formatDatBlock(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  elasticConfig: ElasticTabstopConfig
): void {
  const tabStops = elasticConfig.enabled ? (elasticConfig.tabStops['dat'] || DEFAULT_TABSTOPS.dat) : DEFAULT_TABSTOPS.dat;

  // Identify ORG regions
  const orgRegions = findOrgRegions(lines, startLine, endLine);

  // Format each ORG region independently (PASM alignment)
  for (const region of orgRegions) {
    formatPasmRegion(lines, region.startLine, region.endLine, findings, tabStops);
  }

  // Format non-ORG DAT data lines
  formatDatDataLines(lines, startLine, endLine, findings, tabStops, orgRegions);
}

function findOrgRegions(lines: string[], startLine: number, endLine: number): OrgRegion[] {
  const regions: OrgRegion[] = [];
  let currentOrgStart = -1;

  for (let i = startLine; i <= endLine; i++) {
    const trimmed = lines[i].trimStart();
    if (ORG_RE.test(trimmed)) {
      if (currentOrgStart !== -1) {
        // close previous region
        regions.push({ startLine: currentOrgStart, endLine: i - 1 });
      }
      currentOrgStart = i;
    } else if (FIT_RE.test(trimmed) && currentOrgStart !== -1) {
      regions.push({ startLine: currentOrgStart, endLine: i });
      currentOrgStart = -1;
    }
  }
  // unclosed ORG region
  if (currentOrgStart !== -1) {
    regions.push({ startLine: currentOrgStart, endLine });
  }
  return regions;
}

function isInOrgRegion(lineIdx: number, orgRegions: OrgRegion[]): boolean {
  return orgRegions.some((r) => lineIdx >= r.startLine && lineIdx <= r.endLine);
}

/**
 * Format PASM lines directly (for use by inline PASM in methods).
 * Unlike formatDatBlock, this does not search for ORG...END regions —
 * it treats the entire range as PASM content.
 */
export function formatPasmRegionDirect(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  tabStops: number[]
): void {
  formatPasmRegion(lines, startLine, endLine, findings, tabStops);
}

function formatPasmRegion(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  tabStops: number[]
): void {
  const pasmLines: PasmLine[] = [];

  for (let i = startLine; i <= endLine; i++) {
    const line = lines[i];
    if (findings.isLineInBlockComment(i)) continue;
    if (line.trim().length === 0) continue;
    if (isColumnZero(line) && isFullLineComment(line)) continue;
    if (isFullLineComment(line)) continue;

    const trimmed = line.trimStart();
    // skip org/fit/end directives themselves
    if (ORG_RE.test(trimmed) || FIT_RE.test(trimmed)) continue;

    const parsed = parsePasmLine(line, i);
    if (parsed) {
      pasmLines.push(parsed);
    }
  }

  if (pasmLines.length === 0) return;

  // Two-pass alignment
  // Pass 1: measure column widths
  let maxLabelWidth = 0;
  let maxCondWidth = 0;
  let maxMnemWidth = 0;
  let maxOperandsEnd = 0;
  let maxEffectsEnd = 0;

  for (const p of pasmLines) {
    if (p.label.length > maxLabelWidth) maxLabelWidth = p.label.length;
    if (p.condition.length > maxCondWidth) maxCondWidth = p.condition.length;
    if (p.mnemonic.length > maxMnemWidth) maxMnemWidth = p.mnemonic.length;
  }

  // Determine column positions from tabstops.
  // Labels at column 0, conditions at first tabstop, instructions at second tabstop.
  // Labels and conditions share the pre-instruction space (they never appear on
  // the same line) so the instruction column is fixed, not computed from widths.
  const condCol = tabStops.length > 0 ? tabStops[0] : 8;
  const mnemCol = tabStops.length > 1 ? tabStops[1] : 14;
  const operandCol = snapToNextTabstop(mnemCol + maxMnemWidth, tabStops);

  // Compute operand end columns for effects alignment
  const operandEndCols: number[] = [];
  for (const p of pasmLines) {
    if (p.effects.length > 0) {
      operandEndCols.push(operandCol + p.operands.length);
    }
  }
  const effectsCol = operandEndCols.length > 0 ? snapToNextTabstop(Math.max(...operandEndCols), tabStops) : operandCol;

  // Compute content end for comment alignment
  const contentEndCols: number[] = [];
  for (const p of pasmLines) {
    if (p.comment.length > 0) {
      let contentEnd: number;
      if (p.effects.length > 0) {
        contentEnd = effectsCol + p.effects.length;
      } else if (p.operands.length > 0) {
        contentEnd = operandCol + p.operands.length;
      } else if (p.mnemonic.length > 0) {
        contentEnd = mnemCol + p.mnemonic.length;
      } else {
        contentEnd = condCol;
      }
      contentEndCols.push(contentEnd);
    }
  }
  const commentCol = computeBlockCommentColumn(contentEndCols, tabStops);

  // Detect REP blocks and mark lines that should be indented.
  // REP #N, #count — next N instruction lines are the block.
  // REP @label, #count — lines until the label are the block.
  const REP_INDENT = 1;
  const repIndentLines = new Set<number>();
  for (let pi = 0; pi < pasmLines.length; pi++) {
    const p = pasmLines[pi];
    if (p.mnemonic.toLowerCase() !== 'rep') continue;

    const operands = p.operands;
    // REP @label, ... — find the label
    const labelMatch = operands.match(/^@([^\s,]+)/);
    if (labelMatch) {
      const targetLabel = labelMatch[1];
      for (let pj = pi + 1; pj < pasmLines.length; pj++) {
        if (pasmLines[pj].label === targetLabel) break;
        if (pasmLines[pj].mnemonic.length > 0) {
          repIndentLines.add(pasmLines[pj].lineIdx);
        }
      }
      continue;
    }

    // REP #N, ... or REP ##N, ... — next N instruction lines
    const countMatch = operands.match(/^#{1,2}(\d+)/);
    if (countMatch) {
      const blockSize = parseInt(countMatch[1], 10);
      let count = 0;
      for (let pj = pi + 1; pj < pasmLines.length && count < blockSize; pj++) {
        if (pasmLines[pj].mnemonic.length > 0) {
          repIndentLines.add(pasmLines[pj].lineIdx);
          count++;
        }
      }
    }
  }

  // Pass 2: apply alignment
  for (const p of pasmLines) {
    let formatted = '';
    const indent = repIndentLines.has(p.lineIdx) ? REP_INDENT : 0;

    // Label at column 0 (labels are never inside REP blocks)
    if (p.label.length > 0) {
      formatted = p.label;
    }

    // Condition — always at fixed column
    if (p.condition.length > 0) {
      formatted = padToColumn(formatted, condCol) + p.condition;
    }

    // Mnemonic — indent inside REP blocks for visual grouping
    if (p.mnemonic.length > 0) {
      formatted = padToColumn(formatted, mnemCol + indent) + p.mnemonic;
    }

    // Operands — always at fixed column (no REP indent)
    if (p.operands.length > 0) {
      formatted = padToColumn(formatted, operandCol) + p.operands;
    }

    // Effects — always at fixed column (no REP indent)
    if (p.effects.length > 0) {
      formatted = padToColumn(formatted, effectsCol) + p.effects;
    }

    // Comment
    if (p.comment.length > 0) {
      formatted = padToColumn(formatted, commentCol) + p.comment;
    }

    lines[p.lineIdx] = formatted;
  }
}

function parsePasmLine(line: string, lineIdx: number): PasmLine | null {
  const [codePart, comment] = splitTrailingComment(line);
  if (codePart.trim().length === 0 && comment.length === 0) return null;

  let remaining = codePart.trimStart();
  let label = '';
  let condition = '';
  let mnemonic = '';
  let operands = '';
  let effects = '';

  // Check if the first token is a PASM keyword (condition, mnemonic, or data type).
  // If not, it may be a label.
  if (remaining.length > 0 && !CONDITION_RE.test(remaining) && !DATA_TYPE_RE.test(remaining)) {
    const firstTokenMatch = remaining.match(/^(\S+)\s*/);
    if (firstTokenMatch) {
      const firstToken = firstTokenMatch[1];
      const afterFirst = remaining.substring(firstTokenMatch[0].length);

      // Local labels (.name) are always labels
      if (firstToken.startsWith('.')) {
        label = firstToken;
        remaining = remaining.substring(firstTokenMatch[0].length);
      }
      // Otherwise: the first token is a label if what follows it is a recognizable
      // PASM pattern (condition, type keyword, or nothing).  If what follows looks
      // like operands (not a keyword), then the first token is a mnemonic, not a label.
      else if (CONDITION_RE.test(afterFirst) || DATA_TYPE_RE.test(afterFirst) || afterFirst.trim().length === 0) {
        label = firstToken;
        remaining = remaining.substring(firstTokenMatch[0].length);
      }
    }
  }

  // Extract condition prefix (if_*, _ret_)
  const condMatch = remaining.match(CONDITION_RE);
  if (condMatch) {
    condition = condMatch[1];
    remaining = remaining.substring(condMatch[0].length);
  }

  // Extract effects from end of remaining code (before comment was stripped)
  const effectsMatch = remaining.match(EFFECTS_RE);
  if (effectsMatch) {
    effects = effectsMatch[1];
    remaining = remaining.substring(0, remaining.length - effectsMatch[0].length).trimEnd();
  }

  // Split remaining into mnemonic and operands
  const parts = remaining.trimStart().match(/^(\S+)\s*(.*)/);
  if (parts) {
    mnemonic = parts[1];
    operands = parts[2].trim();
    // normalize operand spacing: collapse whitespace around commas
    operands = operands.replace(/\s*,\s*/g, ', ');
  }

  // Handle data declaration lines within ORG (e.g., "myvar long 0")
  // These look like PASM but have a type keyword as mnemonic — that's fine,
  // they align the same way

  return { lineIdx, label, condition, mnemonic, operands, effects, comment };
}

function formatDatDataLines(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  tabStops: number[],
  orgRegions: OrgRegion[]
): void {
  const dataLines: DatDataLine[] = [];

  for (let i = startLine; i <= endLine; i++) {
    if (isInOrgRegion(i, orgRegions)) continue;
    const line = lines[i];
    if (findings.isLineInBlockComment(i)) continue;
    if (line.trim().length === 0) continue;
    if (isColumnZero(line) && isFullLineComment(line)) continue;
    if (isFullLineComment(line)) continue;

    const trimmed = line.trimStart();
    if (/^dat\b/i.test(trimmed)) continue; // skip DAT keyword

    const parsed = parseDatDataLine(line, i);
    if (parsed) {
      dataLines.push(parsed);
    }
  }

  if (dataLines.length === 0) return;

  // Data-only DAT sections indent labels to the first tabstop (like CON/VAR/OBJ).
  // DAT sections containing PASM (ORG regions) keep labels at column 0.
  const dataOnly = orgRegions.length === 0;
  const labelIndent = dataOnly ? (tabStops.length > 0 ? tabStops[0] : 8) : 0;

  // Two-pass alignment for DAT data lines
  let maxLabelWidth = 0;
  let maxTypeWidth = 0;

  for (const d of dataLines) {
    if (d.label.length > maxLabelWidth) maxLabelWidth = d.label.length;
    if (d.type.length > maxTypeWidth) maxTypeWidth = d.type.length;
  }

  const typeCol = maxLabelWidth > 0
    ? snapToNextTabstop(labelIndent + maxLabelWidth, tabStops)
    : (tabStops.length > 1 ? tabStops[1] : 14);
  const valueCol = snapToNextTabstop(typeCol + maxTypeWidth, tabStops);

  const contentEndCols: number[] = [];
  for (const d of dataLines) {
    if (d.comment.length > 0) {
      contentEndCols.push(valueCol + d.value.length);
    }
  }
  const commentCol = computeBlockCommentColumn(contentEndCols, tabStops);

  for (const d of dataLines) {
    let formatted = ' '.repeat(labelIndent) + d.label;
    formatted = padToColumn(formatted, typeCol) + d.type;
    if (d.value.length > 0) {
      formatted = padToColumn(formatted, valueCol) + d.value;
    }
    if (d.comment.length > 0) {
      formatted = padToColumn(formatted, commentCol) + d.comment;
    }
    lines[d.lineIdx] = formatted;
  }
}

function parseDatDataLine(line: string, lineIdx: number): DatDataLine | null {
  const [codePart, comment] = splitTrailingComment(line);
  let remaining = codePart.trimStart();
  let label = '';

  if (remaining.length === 0) {
    return null;
  }

  // Check if the first token is a type keyword (no-label case, e.g. "  word  @addr")
  if (!DATA_TYPE_RE.test(remaining)) {
    // First token is a label — extract it
    const labelMatch = remaining.match(/^(\S+)\s*/);
    if (labelMatch) {
      label = labelMatch[1];
      remaining = remaining.substring(labelMatch[0].length);
    }
  }

  // Extract type keyword
  const typeMatch = remaining.match(DATA_TYPE_RE);
  if (!typeMatch) {
    // Not a data declaration line — label-only or unrecognized
    return null;
  }
  const type = typeMatch[1].toLowerCase();
  remaining = remaining.substring(typeMatch[0].length).trimStart();

  return { lineIdx, label, type, value: remaining.trimEnd(), comment };
}
