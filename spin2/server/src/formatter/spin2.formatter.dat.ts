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

  // Determine column positions using tabstop snapping
  // Labels are at column 0
  const condCol = maxLabelWidth > 0 ? snapToNextTabstop(maxLabelWidth, tabStops) : (tabStops.length > 0 ? tabStops[0] : 8);
  const mnemCol = maxCondWidth > 0 ? snapToNextTabstop(condCol + maxCondWidth, tabStops) : snapToNextTabstop(condCol, tabStops);
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

  // Pass 2: apply alignment
  for (const p of pasmLines) {
    let formatted = '';

    // Label at column 0
    if (p.label.length > 0) {
      formatted = p.label;
    }

    // Condition
    if (p.condition.length > 0) {
      formatted = padToColumn(formatted, condCol) + p.condition;
    }

    // Mnemonic
    if (p.mnemonic.length > 0) {
      formatted = padToColumn(formatted, mnemCol) + p.mnemonic;
    }

    // Operands
    if (p.operands.length > 0) {
      formatted = padToColumn(formatted, operandCol) + p.operands;
    }

    // Effects
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

  let remaining = codePart;
  let label = '';
  let condition = '';
  let mnemonic = '';
  let operands = '';
  let effects = '';

  // Extract label: non-whitespace at column 0, or local label (.name) at column 0
  if (remaining.length > 0 && remaining[0] !== ' ' && remaining[0] !== '\t') {
    const match = remaining.match(/^(\S+)\s*/);
    if (match) {
      label = match[1];
      remaining = remaining.substring(match[0].length);
    }
  } else {
    remaining = remaining.trimStart();
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

  // Two-pass alignment for DAT data lines
  let maxLabelWidth = 0;
  let maxTypeWidth = 0;

  for (const d of dataLines) {
    if (d.label.length > maxLabelWidth) maxLabelWidth = d.label.length;
    if (d.type.length > maxTypeWidth) maxTypeWidth = d.type.length;
  }

  // Labels at column 0
  const typeCol = maxLabelWidth > 0 ? snapToNextTabstop(maxLabelWidth, tabStops) : (tabStops.length > 1 ? tabStops[1] : 14);
  const valueCol = snapToNextTabstop(typeCol + maxTypeWidth, tabStops);

  const contentEndCols: number[] = [];
  for (const d of dataLines) {
    if (d.comment.length > 0) {
      contentEndCols.push(valueCol + d.value.length);
    }
  }
  const commentCol = computeBlockCommentColumn(contentEndCols, tabStops);

  for (const d of dataLines) {
    let formatted = d.label;
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
  let remaining = codePart;
  let label = '';

  // Extract label at column 0
  if (remaining.length > 0 && remaining[0] !== ' ' && remaining[0] !== '\t') {
    const match = remaining.match(/^(\S+)\s*/);
    if (match) {
      label = match[1];
      remaining = remaining.substring(match[0].length);
    }
  } else {
    remaining = remaining.trimStart();
  }

  // Extract type keyword
  const typeMatch = remaining.match(DATA_TYPE_RE);
  if (!typeMatch) {
    // Not a data declaration line — might be something else
    return null;
  }
  const type = typeMatch[1].toLowerCase();
  remaining = remaining.substring(typeMatch[0].length).trimStart();

  return { lineIdx, label, type, value: remaining.trimEnd(), comment };
}
