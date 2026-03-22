'use strict';
// src/formatter/spin2.formatter.comment.ts
//
// Phase 6: Comment formatting and case normalization.
// - Keyword case normalization with 6 granular controls
// - PASM instruction case normalization
// - Space after comment opener (' text vs 'text)

import { splitTrailingComment, isFullLineComment, isColumnZero, isPreprocessorLine } from './spin2.formatter.base';
import { DocumentFindings, eBLockType } from '../parser/spin.semantic.findings';

// Block section keywords
const BLOCK_NAME_KEYWORDS = new Set([
  'con', 'var', 'obj', 'dat', 'pub', 'pri'
]);

// Control flow keywords
const CONTROL_FLOW_KEYWORDS = new Set([
  'if', 'ifnot', 'elseif', 'elseifnot', 'else',
  'case', 'case_fast', 'other',
  'repeat', 'from', 'to', 'step', 'while', 'until', 'with',
  'next', 'quit', 'return', 'abort'
]);

// Full set of built-in methods, constants, and registers (from spin2.utils.ts).
// Sourced from: _tableSpinHubMethods, _tableSpinPinMethods, _tableSpinTimingMethods,
// _tablePAsmInterfaceMethods, _tableSpinMathMethods, _tableSpinMemoryMethods,
// _tableSpinStringMethods, _tableSpinStringBuilder, _tableSpinIndexValueMethods,
// _tableSpinControlFlowMethods, _tableSpinFloatConversions, _tableSpinMethodPointerSymbols,
// _tableSpinEnhancements_v42/_v44/_v44_replaced/_v45/_v47/_v52/_v53,
// _tableSpinNumericSymbols, _tableSpinCogRegisters, _tableSpinHubLocations,
// _tableSpinHubVariables, _tableClockSpinSymbols, _tableClockControlSymbols_v46,
// _tableSpinCoginitSymbols, _tableSpinCogexecSymbols, _tableSpinTaskSymbols_v47,
// _tableSpinTaskRegisters_v47
// prettier-ignore
const METHOD_KEYWORDS = new Set(
  (// Hub methods
  'hubset clkset cogspin coginit cogstop cogid cogchk locknew lockret locktry lockrel lockchk cogatn pollatn waitatn ' +
  // Pin methods
  'pinw pinwrite pinr pinread pinl pinlow pinh pinhigh pint pintoggle pinf pinfloat pinstart pinclear ' +
  'wrpin wxpin wypin akpin rdpin rqpin ' +
  // Timing methods
  'getct pollct waitct waitus waitms getsec getms ' +
  // PASM interface methods
  'call regexec regload ' +
  // Math methods
  'rotxy polxy xypol qsin qcos muldiv64 getrnd nan ' +
  // Memory methods
  'getregs setregs bytemove wordmove longmove bytefill wordfill longfill movbyts ' +
  // String methods
  'strsize strcomp strcopy getcrc string lstring ' +
  // Index/value methods
  'lookup lookupz lookdown lookdownz ' +
  // Control flow methods (used as expressions)
  'abort return ' +
  // Float conversions
  'float round trunc ' +
  // Method pointers
  'send recv ' +
  // Spin2 operators used as built-in methods
  'abs encod decod bmask ones sqrt qlog qexp sar ror rol rev zerox signx sca scas frac addbits addpins not and or xor ' +
  // v42 enhancements
  'bytes words longs ' +
  // v44 enhancements
  'byteswap wordswap longswap bytecomp wordcomp longcomp ' +
  // v44 struct methods (replaced in later versions)
  'fill copy swap comp ' +
  // v45 enhancements
  'sizeof ' +
  // v47 enhancements (task methods)
  'taskspin tasknext taskstop taskhalt taskcont taskchk taskid ' +
  // v52 enhancements
  'endianl endianw ' +
  // v53 enhancements
  'offsetof ' +
  // Debug
  'debug ' +
  // Built-in numeric constants
  'true false negx posx pi ' +
  // Hub locations and variables
  'clkmode clkfreq varbase ' +
  // Clock symbols
  'clkmode_ clkfreq_ _clkfreq _autoclk ' +
  // Coginit/cogexec symbols
  'cogexec hubexec cogexec_new hubexec_new cogexec_new_pair hubexec_new_pair newcog ' +
  // Task symbols
  'newtask thistask ' +
  // Task registers
  'taskhlt ' +
  // Cog registers
  'reg field pr0 pr1 pr2 pr3 pr4 pr5 pr6 pr7 ijmp1 ijmp2 ijmp3 iret1 iret2 iret3 ' +
  'pa pb ptra ptrb dira dirb outa outb ina inb').split(' ')
);

// Type keywords
const TYPE_KEYWORDS = new Set([
  'byte', 'word', 'long', 'struct'
]);

// Full P2 PASM instruction set + assembler directives (from spin2.utils.ts isP2AsmInstruction).
// Used for pasmInstructionCase normalization.
// NOTE: byte/word/long are NOT included — they use TYPE_KEYWORDS with typeCase instead.
// prettier-ignore
const PASM_INSTRUCTIONS = new Set(
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
  'xcont xinit xor xoro32 xstop xzero zerox ' +
  // assembler directives (not instructions, but need case normalization in DAT)
  'org orgh orgf fit end res alignw alignl').split(' ')
);

/**
 * Case normalization configuration for the 6 granular controls.
 */
export interface CaseConfig {
  blockNameCase: string;       // 'lowercase' | 'uppercase' | 'preserve'
  controlFlowCase: string;     // 'lowercase' | 'uppercase' | 'preserve'
  methodCase: string;          // 'lowercase' | 'uppercase' | 'preserve'
  typeCase: string;            // 'lowercase' | 'uppercase' | 'preserve'
  constantCase: string;        // 'lowercase' | 'uppercase' | 'preserve'
  pasmInstructionCase: string; // 'lowercase' | 'uppercase' | 'preserve'
}

/**
 * Normalize case in PUB/PRI method lines using granular controls.
 */
export function normalizeMethodBlockCase(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  caseConfig: CaseConfig,
  conConstants?: Set<string>
): void {
  // Apply each non-preserve word set in order.
  // PASM instructions are included because PUB/PRI blocks can contain
  // inline PASM (org...end) whose mnemonics need case normalization.
  const sets: { words: Set<string>; targetCase: string }[] = [];

  if (caseConfig.blockNameCase !== 'preserve') {
    sets.push({ words: BLOCK_NAME_KEYWORDS, targetCase: caseConfig.blockNameCase });
  }
  if (caseConfig.controlFlowCase !== 'preserve') {
    sets.push({ words: CONTROL_FLOW_KEYWORDS, targetCase: caseConfig.controlFlowCase });
  }
  if (caseConfig.methodCase !== 'preserve') {
    sets.push({ words: METHOD_KEYWORDS, targetCase: caseConfig.methodCase });
  }
  if (caseConfig.typeCase !== 'preserve') {
    sets.push({ words: TYPE_KEYWORDS, targetCase: caseConfig.typeCase });
  }
  if (caseConfig.pasmInstructionCase !== 'preserve') {
    sets.push({ words: PASM_INSTRUCTIONS, targetCase: caseConfig.pasmInstructionCase });
  }
  if (caseConfig.constantCase !== 'preserve' && conConstants && conConstants.size > 0) {
    sets.push({ words: conConstants, targetCase: caseConfig.constantCase });
  }

  if (sets.length === 0) return;

  for (let i = startLine; i <= endLine; i++) {
    if (findings.isLineInBlockComment(i)) continue;
    if (lines[i].trim().length === 0) continue;
    if (isColumnZero(lines[i]) && isFullLineComment(lines[i])) continue;
    if (isPreprocessorLine(lines[i])) continue;

    const [codePart, commentPart] = splitTrailingComment(lines[i]);
    let normalized = codePart;
    for (const { words, targetCase } of sets) {
      normalized = normalizeWordsInCode(normalized, words, targetCase);
    }
    if (commentPart.length > 0) {
      const originalGapStart = codePart.length;
      const commentIdx = lines[i].indexOf(commentPart, originalGapStart);
      const originalGap = commentIdx > originalGapStart ? lines[i].substring(originalGapStart, commentIdx) : '  ';
      const lengthDelta = normalized.trimEnd().length - codePart.length;
      let gap: string;
      if (lengthDelta === 0) {
        gap = originalGap;
      } else {
        const newGapLen = Math.max(2, originalGap.length - lengthDelta);
        gap = ' '.repeat(newGapLen);
      }
      lines[i] = normalized.trimEnd() + gap + commentPart;
    } else {
      lines[i] = normalized;
    }
  }
}

/**
 * Normalize case in DAT blocks using granular controls.
 */
export function normalizeDatBlockCase(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  caseConfig: CaseConfig,
  conConstants?: Set<string>
): void {
  // In DAT blocks, apply PASM instructions, block names, and type keywords
  const sets: { words: Set<string>; targetCase: string }[] = [];

  if (caseConfig.pasmInstructionCase !== 'preserve') {
    sets.push({ words: PASM_INSTRUCTIONS, targetCase: caseConfig.pasmInstructionCase });
  }
  if (caseConfig.blockNameCase !== 'preserve') {
    sets.push({ words: BLOCK_NAME_KEYWORDS, targetCase: caseConfig.blockNameCase });
  }
  if (caseConfig.typeCase !== 'preserve') {
    sets.push({ words: TYPE_KEYWORDS, targetCase: caseConfig.typeCase });
  }
  if (caseConfig.constantCase !== 'preserve' && conConstants && conConstants.size > 0) {
    sets.push({ words: conConstants, targetCase: caseConfig.constantCase });
  }

  if (sets.length === 0) return;

  for (let i = startLine; i <= endLine; i++) {
    if (findings.isLineInBlockComment(i)) continue;
    if (lines[i].trim().length === 0) continue;
    if (isFullLineComment(lines[i])) continue;
    if (isPreprocessorLine(lines[i])) continue;

    const [codePart, commentPart] = splitTrailingComment(lines[i]);
    let normalized = codePart;
    for (const { words, targetCase } of sets) {
      normalized = normalizeWordsInCode(normalized, words, targetCase);
    }
    if (commentPart.length > 0) {
      const originalGapStart = codePart.length;
      const commentIdx = lines[i].indexOf(commentPart, originalGapStart);
      const originalGap = commentIdx > originalGapStart ? lines[i].substring(originalGapStart, commentIdx) : '  ';
      const lengthDelta = normalized.trimEnd().length - codePart.length;
      const newGapLen = Math.max(2, originalGap.length - lengthDelta);
      lines[i] = normalized.trimEnd() + ' '.repeat(newGapLen) + commentPart;
    } else {
      lines[i] = normalized;
    }
  }
}

/**
 * Normalize case in CON/VAR/OBJ blocks (block name keyword + type keywords).
 */
export function normalizeNonCodeBlockCase(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  caseConfig: CaseConfig,
  conConstants?: Set<string>
): void {
  const sets: { words: Set<string>; targetCase: string }[] = [];

  if (caseConfig.blockNameCase !== 'preserve') {
    sets.push({ words: BLOCK_NAME_KEYWORDS, targetCase: caseConfig.blockNameCase });
  }
  if (caseConfig.typeCase !== 'preserve') {
    sets.push({ words: TYPE_KEYWORDS, targetCase: caseConfig.typeCase });
  }
  if (caseConfig.constantCase !== 'preserve' && conConstants && conConstants.size > 0) {
    sets.push({ words: conConstants, targetCase: caseConfig.constantCase });
  }

  if (sets.length === 0) return;

  for (let i = startLine; i <= endLine; i++) {
    if (findings.isLineInBlockComment(i)) continue;
    if (lines[i].trim().length === 0) continue;
    if (isColumnZero(lines[i]) && isFullLineComment(lines[i])) continue;
    if (isPreprocessorLine(lines[i])) continue;

    const [codePart, commentPart] = splitTrailingComment(lines[i]);
    let normalized = codePart;
    for (const { words, targetCase } of sets) {
      normalized = normalizeWordsInCode(normalized, words, targetCase);
    }
    if (commentPart.length > 0) {
      const originalGapStart = codePart.length;
      const commentIdx = lines[i].indexOf(commentPart, originalGapStart);
      const originalGap = commentIdx > originalGapStart ? lines[i].substring(originalGapStart, commentIdx) : '  ';
      const lengthDelta = normalized.trimEnd().length - codePart.length;
      let gap: string;
      if (lengthDelta === 0) {
        gap = originalGap;
      } else {
        const newGapLen = Math.max(2, originalGap.length - lengthDelta);
        gap = ' '.repeat(newGapLen);
      }
      lines[i] = normalized.trimEnd() + gap + commentPart;
    } else {
      lines[i] = normalized;
    }
  }
}

function normalizeWordsInCode(code: string, wordSet: Set<string>, targetCase: string): string {
  // Replace words that match the set with the target case, preserving non-word characters.
  //
  // Three types of regions are preserved (no keyword normalization):
  //   1. Double-quoted strings — user text, not code keywords
  //   2. Backtick expressions (debug widget syntax) — display text, not compiled code
  //   3. debug() call arguments — the compiler handles keywords specially inside debug()
  //      and case changes to type keywords (LONG/BYTE/WORD) can produce different binaries
  //
  // Strategy: split the code into normalizable and preserved segments, then rejoin.
  const segments: { text: string; preserve: boolean }[] = [];
  let inDebugCall = false;
  let inBacktick = false;
  let inString = false;
  let parenDepth = 0;
  let segStart = 0;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];

    // Track double-quoted strings — preserve their content
    if (inString) {
      if (ch === '"') {
        segments.push({ text: code.substring(segStart, i + 1), preserve: true });
        segStart = i + 1;
        inString = false;
      }
      continue;
    }
    if (ch === '"' && !inBacktick) {
      segments.push({ text: code.substring(segStart, i), preserve: false });
      segStart = i;
      inString = true;
      continue;
    }

    if (inBacktick) {
      // Inside backtick expression: track parens to find enclosing close-paren
      if (ch === '(') {
        parenDepth++;
      } else if (ch === ')') {
        parenDepth--;
        if (parenDepth < 0) {
          segments.push({ text: code.substring(segStart, i), preserve: true });
          segStart = i;
          inBacktick = false;
          inDebugCall = false;
          parenDepth = 0;
        }
      }
      continue;
    }

    if (inDebugCall) {
      // Inside debug() call: track parens to find matching close-paren
      if (ch === '`') {
        inBacktick = true;
        continue;
      }
      if (ch === '(') {
        parenDepth++;
      } else if (ch === ')') {
        parenDepth--;
        if (parenDepth < 0) {
          // End of debug() call
          segments.push({ text: code.substring(segStart, i), preserve: true });
          segStart = i;
          inDebugCall = false;
          parenDepth = 0;
        }
      }
      continue;
    }

    // Outside protected regions: detect debug( and backtick starts
    if (ch === '`') {
      segments.push({ text: code.substring(segStart, i), preserve: false });
      segStart = i;
      inBacktick = true;
      parenDepth = 0;
      continue;
    }

    if (ch === '(') {
      // Check if the preceding word is "debug" (case-insensitive)
      const preceding = code.substring(Math.max(0, i - 5), i);
      if (/debug$/i.test(preceding)) {
        // Include "debug(" in the preserved segment so "debug" itself gets normalized
        // by the preceding non-preserved segment, but the arguments are preserved.
        // First, flush the segment up to (but not including) the open paren.
        segments.push({ text: code.substring(segStart, i + 1), preserve: false });
        segStart = i + 1;
        inDebugCall = true;
        parenDepth = 0;
      }
    }
  }
  // Final segment
  segments.push({ text: code.substring(segStart), preserve: inBacktick || inDebugCall });

  // Normalize only non-preserved segments
  return segments
    .map((seg) => {
      if (seg.preserve) return seg.text;
      return seg.text.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
        if (wordSet.has(match.toLowerCase())) {
          return targetCase === 'lowercase' ? match.toLowerCase() : match.toUpperCase();
        }
        return match;
      });
    })
    .join('');
}

/**
 * Ensure a space after comment opener (' text vs 'text).
 */
export function normalizeCommentSpacing(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  spaceAfterCommentStart: boolean
): void {
  if (!spaceAfterCommentStart) return;

  for (let i = startLine; i <= endLine; i++) {
    if (findings.isLineInBlockComment(i)) continue;

    const [codePart, commentPart] = splitTrailingComment(lines[i]);
    if (commentPart.length === 0) continue;

    // Ensure space after ' or '' — the [^'\s] prevents the regex from
    // backtracking and splitting '' into ' ' (inserting a space between quotes)
    const normalized = commentPart.replace(/^('{1,2})([^'\s])/, '$1 $2');
    if (normalized !== commentPart) {
      if (codePart.length > 0) {
        lines[i] = codePart + '  ' + normalized;
      } else {
        // Full-line comment — preserve leading whitespace
        const leadingWs = lines[i].match(/^(\s*)/)?.[1] || '';
        lines[i] = leadingWs + normalized;
      }
    }
  }
}

/**
 * Extract CON constant names from lines within CON block spans.
 * Scans for assignment lines (NAME = value) and enum members.
 */
export function extractConConstants(lines: string[], blockSpans: { startLineIdx: number; endLineIdx: number; blockType: eBLockType }[]): Set<string> {
  const constants = new Set<string>();
  for (const span of blockSpans) {
    if (span.blockType !== eBLockType.isCon) continue;

    for (let i = span.startLineIdx; i <= span.endLineIdx; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      // Skip empty lines, comments, and the CON keyword itself
      if (trimmed.length === 0) continue;
      if (trimmed.startsWith("'") || trimmed.startsWith('{')) continue;
      if (/^con\b/i.test(trimmed)) {
        // CON keyword line — may have inline assignments like "CON  NAME = value"
        const afterKw = trimmed.substring(3).trim();
        if (afterKw.length === 0) continue;
        // Fall through to parse the rest
        extractConstantNames(afterKw, constants);
        continue;
      }
      extractConstantNames(trimmed, constants);
    }
  }
  return constants;
}

/**
 * Extract constant names from a CON block line (after removing leading CON keyword if any).
 * Handles: NAME = value, NAME[size], #enumStart, NAME, NAME[size]
 */
function extractConstantNames(text: string, constants: Set<string>): void {
  // Remove trailing comment
  const commentIdx = text.indexOf("'");
  const code = commentIdx >= 0 ? text.substring(0, commentIdx) : text;

  // Split by comma to handle enum lists: NAME1, NAME2, NAME3
  const parts = code.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    // Skip #enumStart directives (just the # part)
    if (trimmed.startsWith('#')) {
      // #0, #1, etc. — no name to extract, but #NAME could be an enum reset
      const afterHash = trimmed.substring(1).trim();
      // If it's just a number, skip
      if (/^\d+$/.test(afterHash)) continue;
      // Otherwise extract the name part (before any = or [)
      const match = afterHash.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (match) {
        constants.add(match[1].toLowerCase());
      }
      continue;
    }
    // Match NAME (optionally followed by = value or [size])
    const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (match) {
      const name = match[1].toLowerCase();
      // Don't add type keywords or block names as constants
      if (!BLOCK_NAME_KEYWORDS.has(name) && !TYPE_KEYWORDS.has(name)) {
        constants.add(name);
      }
    }
  }
}
