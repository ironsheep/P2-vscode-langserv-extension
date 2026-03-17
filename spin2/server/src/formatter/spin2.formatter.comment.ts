'use strict';
// src/formatter/spin2.formatter.comment.ts
//
// Phase 6: Comment formatting and case normalization.
// - Keyword case normalization (lowercase for Spin2 keywords)
// - PASM instruction case normalization
// - Space after comment opener (' text vs 'text)

import { splitTrailingComment, isFullLineComment, isColumnZero } from './spin2.formatter.base';
import { DocumentFindings, eBLockType } from '../parser/spin.semantic.findings';

// Spin2 keywords that should be lowercase
const SPIN2_KEYWORDS = new Set([
  'con', 'var', 'obj', 'dat', 'pub', 'pri',
  'byte', 'word', 'long',
  'if', 'ifnot', 'elseif', 'elseifnot', 'else',
  'case', 'case_fast', 'other',
  'repeat', 'from', 'to', 'step', 'while', 'until', 'with',
  'next', 'quit', 'return', 'abort',
  'lookupz', 'lookup', 'lookdownz', 'lookdown',
  'cogspin', 'coginit', 'cogstop', 'cogid', 'cogchk',
  'locknew', 'lockret', 'locktry', 'lockrel', 'lockchk',
  'pinwrite', 'pinlow', 'pinhigh', 'pintoggle', 'pinfloat',
  'pinread', 'pinstart', 'pinclear', 'wrpin', 'wxpin', 'wypin',
  'rdpin', 'rqpin', 'akpin',
  'waitms', 'waitus', 'waitct', 'waitx', 'pollct',
  'getct', 'getcnt',
  'string', 'float', 'round', 'trunc',
  'abs', 'encod', 'decod', 'bmask', 'ones', 'sqrt', 'qlog', 'qexp',
  'sar', 'ror', 'rol', 'rev', 'zerox', 'signx',
  'sca', 'scas', 'frac', 'addbits', 'addpins',
  'not', 'and', 'or', 'xor',
  'org', 'orgh', 'orgf', 'fit', 'end', 'res',
  'alignw', 'alignl',
  'debug',
  'recv', 'send',
  'true', 'false', 'negx', 'posx', 'pi',
  'clkmode', 'clkfreq', '_clkfreq', 'clkmode_', 'clkfreq_',
  'varbase', 'field',
  'reg', 'pr0', 'pr1', 'pr2', 'pr3', 'pr4', 'pr5', 'pr6', 'pr7',
  'ijmp1', 'ijmp2', 'ijmp3', 'iret1', 'iret2', 'iret3',
  'pa', 'pb', 'ptra', 'ptrb', 'dira', 'dirb', 'outa', 'outb', 'ina', 'inb'
]);

// PASM mnemonics (for case normalization)
const PASM_INSTRUCTIONS = new Set([
  'nop', 'ror', 'rol', 'shr', 'shl', 'rcr', 'rcl', 'sar', 'sal',
  'add', 'addx', 'adds', 'addsx', 'sub', 'subx', 'subs', 'subsx',
  'cmp', 'cmpx', 'cmps', 'cmpsx', 'cmpr', 'cmpm', 'subr',
  'cmpsub', 'fge', 'fle', 'fges', 'fles',
  'sumc', 'sumz', 'sumnc', 'sumnz',
  'testb', 'testbn', 'bitl', 'bith', 'bitc', 'bitnc', 'bitz', 'bitnz', 'bitrnd', 'bitnot',
  'and', 'andn', 'or', 'xor', 'muxc', 'muxnc', 'muxz', 'muxnz',
  'mov', 'not', 'abs', 'neg', 'negc', 'negnc', 'negz', 'negnz',
  'incmod', 'decmod', 'zerox', 'signx', 'encod', 'ones', 'test', 'testn',
  'setnib', 'getnib', 'rolnib', 'setbyte', 'getbyte', 'rolbyte', 'setword', 'getword', 'rolword',
  'altsn', 'altgn', 'altsb', 'altgb', 'altsw', 'altgw', 'altd', 'alts', 'altr', 'altds',
  'decod', 'bmask', 'crcbit', 'crcnib',
  'muls', 'mulu', 'sca', 'scas',
  'addpix', 'mulpix', 'blnpix', 'mixpix',
  'addct1', 'addct2', 'addct3', 'wmlong',
  'rqpin', 'rdpin', 'rdlut', 'rdbyte', 'rdword', 'rdlong',
  'calld', 'resi3', 'resi2', 'resi1', 'resi0', 'reti3', 'reti2', 'reti1', 'reti0',
  'callpa', 'callpb',
  'djz', 'djnz', 'djf', 'djnf', 'ijz', 'ijnz', 'tjz', 'tjnz', 'tjf', 'tjnf',
  'tjs', 'tjns', 'tjv',
  'jint', 'jct1', 'jct2', 'jct3', 'jse1', 'jse2', 'jse3', 'jse4',
  'jpat', 'jfbw', 'jxmt', 'jxfi', 'jxro', 'jxrl', 'jatn', 'jqmt',
  'jnint', 'jnct1', 'jnct2', 'jnct3', 'jnse1', 'jnse2', 'jnse3', 'jnse4',
  'jnpat', 'jnfbw', 'jnxmt', 'jnxfi', 'jnxro', 'jnxrl', 'jnatn', 'jnqmt',
  'setpat', 'wrpin', 'wxpin', 'wypin', 'wrlut', 'wrbyte', 'wrword', 'wrlong',
  'rdfast', 'wrfast', 'fblock', 'xinit', 'xstop', 'xzero', 'xcont',
  'rep', 'coginit', 'qmul', 'qdiv', 'qfrac', 'qsqrt', 'qrotate', 'qvector',
  'hubset', 'cogid', 'cogstop', 'locknew', 'lockret', 'locktry', 'lockrel',
  'qlog', 'qexp',
  'rfbyte', 'rfword', 'rflong', 'rfvar', 'rfvars',
  'wfbyte', 'wfword', 'wflong',
  'getbrk', 'cogbrk', 'brk',
  'getqx', 'getqy',
  'getct', 'getrnd', 'getregs', 'setregs',
  'setdacs', 'setxfrq', 'getxacc', 'waitx', 'waitxfi', 'waitxmt', 'waitxrl', 'waitxro',
  'setint1', 'setint2', 'setint3',
  'waitint', 'subcon', 'waitatn',
  'setq', 'setq2',
  'push', 'pop',
  'jmp', 'call', 'calla', 'callb', 'ret', 'reta', 'retb',
  'jmprel',
  'skip', 'skipf', 'execf',
  'getptr', 'getbrk', 'cogbrk', 'brk',
  'setluts', 'setcy', 'setci', 'setcq', 'setcfrq', 'setcmod',
  'loc', 'augs', 'augd',
  'testp', 'testpn', 'dirl', 'dirh', 'dirc', 'dirnc', 'dirz', 'dirnz', 'dirrnd', 'dirnot',
  'outl', 'outh', 'outc', 'outnc', 'outz', 'outnz', 'outrnd', 'outnot',
  'fltl', 'flth', 'fltc', 'fltnc', 'fltz', 'fltnz', 'fltrnd', 'fltnot',
  'drvl', 'drvh', 'drvc', 'drvnc', 'drvz', 'drvnz', 'drvrnd', 'drvnot',
  'splitb', 'mergeb', 'splitw', 'mergew', 'seussf', 'seussr',
  'rgbsqr', 'rgbexp', 'xoro32',
  'rev', 'rczr', 'rczl', 'wrc', 'wrnc', 'wrz', 'wrnz',
  'modcz', 'modc', 'modz',
  'setscp', 'getscp',
  'akpin', 'asmclk',
  'nop', 'pinread', 'pinwrite', 'pinlow', 'pinhigh', 'pintoggle', 'pinfloat',
  'pinstart', 'pinclear',
  'longfill', 'wordfill', 'bytefill', 'longmove', 'wordmove', 'bytemove'
]);

/**
 * Normalize keyword case in PUB/PRI method lines.
 */
export function normalizeKeywordCase(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  keywordCase: string // 'lowercase' | 'uppercase' | 'preserve'
): void {
  if (keywordCase === 'preserve') return;

  for (let i = startLine; i <= endLine; i++) {
    if (findings.isLineInBlockComment(i)) continue;
    if (lines[i].trim().length === 0) continue;
    if (isColumnZero(lines[i]) && isFullLineComment(lines[i])) continue;

    const [codePart, commentPart] = splitTrailingComment(lines[i]);
    const normalized = normalizeWordsInCode(codePart, SPIN2_KEYWORDS, keywordCase);
    lines[i] = commentPart.length > 0 ? normalized + commentPart : normalized;
  }
}

/**
 * Normalize PASM instruction case in DAT sections.
 */
export function normalizePasmCase(
  lines: string[],
  startLine: number,
  endLine: number,
  findings: DocumentFindings,
  pasmCase: string // 'lowercase' | 'uppercase' | 'preserve'
): void {
  if (pasmCase === 'preserve') return;

  for (let i = startLine; i <= endLine; i++) {
    if (findings.isLineInBlockComment(i)) continue;
    if (lines[i].trim().length === 0) continue;
    if (isFullLineComment(lines[i])) continue;

    const [codePart, commentPart] = splitTrailingComment(lines[i]);
    const normalized = normalizeWordsInCode(codePart, PASM_INSTRUCTIONS, pasmCase);
    lines[i] = commentPart.length > 0 ? normalized + commentPart : normalized;
  }
}

function normalizeWordsInCode(code: string, wordSet: Set<string>, targetCase: string): string {
  // Replace words that match the set with the target case, preserving non-word characters.
  //
  // Two types of regions are preserved (no keyword normalization):
  //   1. Backtick expressions (debug widget syntax) — display text, not compiled code
  //   2. debug() call arguments — the compiler handles keywords specially inside debug()
  //      and case changes to type keywords (LONG/BYTE/WORD) can produce different binaries
  //
  // Strategy: split the code into normalizable and preserved segments, then rejoin.
  const segments: { text: string; preserve: boolean }[] = [];
  let inDebugCall = false;
  let inBacktick = false;
  let parenDepth = 0;
  let segStart = 0;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];

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

    // Ensure space after ' or ''
    const normalized = commentPart.replace(/^('{1,2})(\S)/, '$1 $2');
    if (normalized !== commentPart) {
      lines[i] = codePart.length > 0 ? codePart + '  ' + normalized : normalized;
    }
  }
}
