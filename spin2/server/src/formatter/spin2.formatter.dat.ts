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
// Debug call pattern (handled specially to avoid splitting at whitespace inside strings)
const DEBUG_CALL_RE = /^debug\s*\(/i;
// Full P2 PASM instruction set (from spin2.utils.ts).
// Used to distinguish labels from mnemonics: if the token AFTER the first word
// is a known instruction, the first word is a label.  Also used for standalone
// single-token lines (stalli, nop, ret, etc.).
// prettier-ignore
const P2_PASM_MNEMONICS = new Set(
  ('abs add addct1 addct2 addct3 addpix adds addsx addx akpin allowi altb altd altgb altgn altgw alti altr alts altsb altsn altsw ' +
  'and andn asmclk augd augs bitc bith bitl bitnc bitnot bitnz bitrnd bitz blnpix bmask brk ' +
  'call calla callb calld callpa callpb cmp cmpm cmpr cmps cmpsub cmpsx cmpx cogatn cogbrk cogid coginit cogstop crcbit crcnib ' +
  'debug decmod decod dirc dirh dirl dirnc dirnot dirnz dirrnd dirz djf djnf djnz djz ' +
  'drvc drvh drvl drvnc drvnot drvnz drvrnd drvz encod execf fblock fge fges fle fles ' +
  'fltc flth fltl fltnc fltnot fltnz fltrnd fltz getbrk getbyte getct getnib getptr getqx getqy getrnd getscp getword getxacc ' +
  'hubset ijnz ijz incmod jatn jct1 jct2 jct3 jfbw jint jmp jmprel ' +
  'jnatn jnct1 jnct2 jnct3 jnfbw jnint jnpat jnqmt jnse1 jnse2 jnse3 jnse4 jnxfi jnxmt jnxrl jnxro ' +
  'jpat jqmt jse1 jse2 jse3 jse4 jxfi jxmt jxrl jxro ' +
  'loc locknew lockrel lockret locktry mergeb mergew mixpix modc modcz modz mov movbyts mul mulpix muls ' +
  'muxc muxnc muxnibs muxnits muxnz muxq muxz neg negc negnc negnz negz nixint1 nixint2 nixint3 nop not ones or ' +
  'outc outh outl outnc outnot outnz outrnd outz pollatn pollct1 pollct2 pollct3 pollfbw pollint pollpat pollqmt ' +
  'pollse1 pollse2 pollse3 pollse4 pollxfi pollxmt pollxrl pollxro pop popa popb push pusha pushb ' +
  'qdiv qexp qfrac qlog qmul qrotate qsqrt qvector rcl rcr rczl rczr rdbyte rdfast rdlong rdlut rdpin rdword ' +
  'rep resi0 resi1 resi2 resi3 ret reta retb reti0 reti1 reti2 reti3 rev rfbyte rflong rfvar rfvars rfword rgbexp rgbsqz ' +
  'rol rolbyte rolnib rolword ror rqpin sal sar sca scas ' +
  'setbyte setcfrq setci setcmod setcq setcy setd setdacs setint1 setint2 setint3 setluts setnib setpat setpiv setpix setq setq2 setr sets ' +
  'setscp setse1 setse2 setse3 setse4 setword setxfrq seussf seussr shl shr signx skip skipf splitb splitw stalli ' +
  'sub subr subs subsx subx sumc sumnc sumnz sumz test testb testbn testn testp testpn ' +
  'tjf tjnf tjns tjnz tjs tjv tjz trgint1 trgint2 trgint3 ' +
  'waitatn waitct1 waitct2 waitct3 waitfbw waitint waitpat waitse1 waitse2 waitse3 waitse4 waitx waitxfi waitxmt waitxrl waitxro ' +
  'wfbyte wflong wfword wmlong wrbyte wrc wrfast wrlong wrlut wrnc wrnz wrpin wrword wrz wxpin wypin ' +
  'xcont xinit xor xoro32 xstop xzero zerox').split(' ')
);

/** Check if the text starts with a known PASM instruction mnemonic */
function afterFirstStartsWithMnemonic(text: string): boolean {
  const match = text.trimStart().match(/^([a-z_]\w*)\b/i);
  return match !== null && P2_PASM_MNEMONICS.has(match[1].toLowerCase());
}

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
  formatPasmRegion(lines, startLine, endLine, findings, tabStops, true);
}

function formatPasmRegion(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  tabStops: number[],
  isInlinePasm: boolean = false
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
  // Pass 1: measure column widths, separating data declarations from instructions.
  // Data declarations (label LONG/WORD/BYTE value) have their own type column
  // driven by data label widths.  PASM instruction mnemonics are only pushed
  // out by long conditions, NOT by long data labels.
  let maxDataLabelWidth = 0;
  let maxDataTypeWidth = 0;
  let maxCondWidth = 0;
  let maxInstrMnemWidth = 0;

  for (const p of pasmLines) {
    const isData = DATA_TYPE_RE.test(p.mnemonic);
    if (isData) {
      if (p.label.length > maxDataLabelWidth) maxDataLabelWidth = p.label.length;
      if (p.mnemonic.length > maxDataTypeWidth) maxDataTypeWidth = p.mnemonic.length;
    } else {
      if (p.condition.length > maxCondWidth) maxCondWidth = p.condition.length;
      // Exclude debug() calls — they are self-contained expressions
      if (p.mnemonic.length > maxInstrMnemWidth && !DEBUG_CALL_RE.test(p.mnemonic)) {
        maxInstrMnemWidth = p.mnemonic.length;
      }
    }
  }

  // Column positions from tabstops
  const defaultCondCol = tabStops.length > 0 ? tabStops[0] : 8;
  const defaultMnemCol = tabStops.length > 1 ? tabStops[1] : 14;
  const condCol = defaultCondCol;

  // Instruction mnemonic column: driven by conditions ONLY
  const condEnd = maxCondWidth > 0 ? condCol + maxCondWidth : 0;
  const instrMnemCol = condEnd >= defaultMnemCol
    ? snapToNextTabstop(condEnd, tabStops)
    : defaultMnemCol;
  const instrOperandCol = snapToNextTabstop(instrMnemCol + maxInstrMnemWidth, tabStops);

  // Data type column: driven by data label widths (independent of conditions)
  const dataMnemCol = maxDataLabelWidth >= defaultMnemCol
    ? snapToNextTabstop(maxDataLabelWidth, tabStops)
    : defaultMnemCol;
  const dataValueCol = snapToNextTabstop(dataMnemCol + maxDataTypeWidth, tabStops);

  // Compute operand end columns for effects alignment (instructions only)
  const operandEndCols: number[] = [];
  for (const p of pasmLines) {
    if (p.effects.length > 0) {
      operandEndCols.push(instrOperandCol + p.operands.length);
    }
  }
  const effectsCol = operandEndCols.length > 0 ? snapToNextTabstop(Math.max(...operandEndCols), tabStops) : instrOperandCol;

  // Compute content end for comment alignment (shared across both types)
  const contentEndCols: number[] = [];
  for (const p of pasmLines) {
    if (p.comment.length > 0) {
      const isData = DATA_TYPE_RE.test(p.mnemonic);
      let contentEnd: number;
      if (isData) {
        contentEnd = p.operands.length > 0 ? dataValueCol + p.operands.length : dataMnemCol + p.mnemonic.length;
      } else if (p.effects.length > 0) {
        contentEnd = effectsCol + p.effects.length;
      } else if (p.operands.length > 0) {
        contentEnd = instrOperandCol + p.operands.length;
      } else if (p.mnemonic.length > 0) {
        contentEnd = instrMnemCol + p.mnemonic.length;
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
    const isData = DATA_TYPE_RE.test(p.mnemonic);
    const mnemCol = isData ? dataMnemCol : instrMnemCol;
    const operandCol = isData ? dataValueCol : instrOperandCol;
    let formatted = '';
    const indent = repIndentLines.has(p.lineIdx) ? REP_INDENT : 0;

    // Label at column 0 (labels are never inside REP blocks)
    if (p.label.length > 0) {
      formatted = p.label;
    }

    // Condition — always at fixed column (instructions only)
    if (p.condition.length > 0) {
      formatted = padToColumn(formatted, condCol) + p.condition;
    }

    // Mnemonic (or type keyword for data lines)
    if (p.mnemonic.length > 0) {
      formatted = padToColumn(formatted, mnemCol + indent) + p.mnemonic;
    }

    // Operands (or value for data lines)
    if (p.operands.length > 0) {
      formatted = padToColumn(formatted, operandCol) + p.operands;
    }

    // Effects — instructions only
    if (p.effects.length > 0) {
      formatted = padToColumn(formatted, effectsCol) + p.effects;
    }

    // Comment
    if (p.comment.length > 0) {
      formatted = padToColumn(formatted, commentCol) + p.comment;
    }

    lines[p.lineIdx] = formatted;
  }

  // Align full-line comments within the PASM region.
  // Inside an ORG...END region (whether in DAT or inline PASM), all comments
  // are PASM commentary and should be aligned — there are no "section headers"
  // within ORG regions.  Align to condCol (the first code column after labels).
  //
  // Note: the real parser records consecutive ' comment groups as "block comments"
  // in its tracking.  We must allow '-prefixed lines through even when
  // isLineInBlockComment returns true — only skip true { } block comments.
  for (let i = startLine; i <= endLine; i++) {
    const trimmed = lines[i].trimStart();
    if (findings.isLineInBlockComment(i) && !trimmed.startsWith("'")) continue;
    if (lines[i].trim().length === 0) continue;
    if (!isFullLineComment(lines[i])) continue;
    // skip org/fit/end directive lines
    if (ORG_RE.test(trimmed) || FIT_RE.test(trimmed)) continue;
    // Align to condCol (where conditions/code start)
    lines[i] = ' '.repeat(condCol) + trimmed;
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
      // Single token that is a known PASM instruction (stalli, nop, ret, mov, etc.)
      // — NOT a label, leave in remaining for mnemonic extraction
      else if (afterFirst.trim().length === 0 && P2_PASM_MNEMONICS.has(firstToken.toLowerCase())) {
        // intentionally not extracting as label
      }
      // The first token is a label if what follows it is a recognizable PASM
      // pattern: condition, type keyword, debug call, known instruction, or nothing.
      else if (
        CONDITION_RE.test(afterFirst) ||
        DATA_TYPE_RE.test(afterFirst) ||
        DEBUG_CALL_RE.test(afterFirst) ||
        afterFirstStartsWithMnemonic(afterFirst) ||
        afterFirst.trim().length === 0
      ) {
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

  // Handle debug() calls: parse balanced parens to keep the entire debug(...)
  // as a single mnemonic token, avoiding splits at whitespace inside strings
  if (DEBUG_CALL_RE.test(remaining.trimStart())) {
    const trimmedRemaining = remaining.trimStart();
    let depth = 0;
    let inStr = false;
    let inBacktick = false;
    let btParenDepth = 0;
    let endIdx = -1;
    for (let j = 0; j < trimmedRemaining.length; j++) {
      const ch = trimmedRemaining[j];
      if (inBacktick) {
        if (ch === '(') btParenDepth++;
        else if (ch === ')') {
          btParenDepth--;
          if (btParenDepth < 0) {
            inBacktick = false;
            depth--;
            if (depth === 0) { endIdx = j; break; }
          }
        }
        continue;
      }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '`') { inBacktick = true; btParenDepth = 0; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) { endIdx = j; break; }
      }
    }
    mnemonic = endIdx >= 0 ? trimmedRemaining.substring(0, endIdx + 1) : trimmedRemaining;
    return { lineIdx, label, condition, mnemonic, operands: '', effects: '', comment };
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

  // Align non-col-0 full-line comments outside ORG regions to the label indent.
  // The real parser records consecutive ' comment groups as "block comments" —
  // allow '-prefixed lines through, only skip true { } block comments.
  for (let i = startLine; i <= endLine; i++) {
    if (isInOrgRegion(i, orgRegions)) continue;
    const trimmed = lines[i].trimStart();
    if (findings.isLineInBlockComment(i) && !trimmed.startsWith("'")) continue;
    if (lines[i].trim().length === 0) continue;
    if (!isFullLineComment(lines[i])) continue;
    if (/^dat\b/i.test(trimmed)) continue;
    // Column-0 comments are section headers — leave them
    if (isColumnZero(lines[i])) continue;
    // Align to the label indent position (where data content starts)
    lines[i] = ' '.repeat(labelIndent) + trimmed;
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
