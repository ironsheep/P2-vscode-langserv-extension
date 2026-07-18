'use strict';
// src/spin2.utils.ts

import { eBuiltInType, eDebugDisplayType, IBuiltinDescription } from './spin.common';
import { Pasm2DocUtils } from './spin2.pasm2.utils';
import { Context } from '../context';

export const displayEnumByTypeName = new Map<string, eDebugDisplayType>([
  ['logic', eDebugDisplayType.ddtLogic],
  ['scope', eDebugDisplayType.ddtScope],
  ['scope_xy', eDebugDisplayType.ddtScopeXY],
  ['fft', eDebugDisplayType.ddtFFT],
  ['spectro', eDebugDisplayType.ddtSpectro],
  ['plot', eDebugDisplayType.ddtPlot],
  ['term', eDebugDisplayType.ddtTerm],
  ['bitmap', eDebugDisplayType.ddtBitmap],
  ['midi', eDebugDisplayType.ddtMidi]
]);

// this is how we decribe our methods with parameters in our tables...
type TMethodTuple = readonly [signature: string, description: string, parameters: string[], returns?: string[] | undefined];

// documentation for one DEBUG display directive / color name (see docTextForDebugDirective)
type TDebugDirective = { signature: string; description: string };

// one lookup table of directives, keyed by lower-cased directive name
type TDebugDirectiveTable = { [Identifier: string]: TDebugDirective };

// a display type's two directive sets: window-CREATION (config) and window-UPDATE (feed).
//  Either may be omitted while a type is still being populated.
type TDebugDisplayDirectives = { config?: TDebugDirectiveTable; feed?: TDebugDirectiveTable };

export enum eSearchFilterType {
  Unknown = 0,
  FT_NO_PREFERENCE,
  FT_METHOD,
  FT_NOT_METHOD,
  FT_METHOD_MASK // debug[0](...)
}

export class Spin2ParseUtils {
  private utilsLogEnabled: boolean = false;
  private ctx: Context | undefined = undefined;
  private languageVersion: number = 0;
  private pasm2Utils: Pasm2DocUtils = new Pasm2DocUtils();

  public enableLogging(ctx: Context, doEnable: boolean = true): void {
    this.utilsLogEnabled = doEnable;
    this.ctx = ctx;
  }

  private _logMessage(message: string): void {
    if (this.utilsLogEnabled) {
      //Write to output window.
      if (this.ctx) {
        this.ctx.logger.log(message);
      }
    }
  }

  public setSpinVersion(requiredVersion: number): void {
    if (requiredVersion >= 0 && requiredVersion <= 999) {
      const newVersion: number = requiredVersion < 43 ? 0 : requiredVersion;
      if (newVersion != this.languageVersion) {
        this._logMessage(`sp2u:  -- set SpinVersion() (${this.languageVersion}) -> (${newVersion})`);
      } else {
        this._logMessage(`sp2u:  -- set SpinVersion() (${this.languageVersion})`);
      }
      this.languageVersion = newVersion;
    } else {
      this._logMessage(`sp2u:  -- set SpinVersion() (${requiredVersion} out of range!)`);
    }
  }

  public selectedSpinVersion(): number {
    const selectedVersion: number = this.languageVersion == 0 ? 41 : this.languageVersion;
    return selectedVersion;
  }

  public exactSpinVersion(requiredVersion: number): boolean {
    const supportedStatus: boolean = this.languageVersion == requiredVersion ? true : false;
    return supportedStatus;
  }

  public requestedSpinVersion(requiredVersion: number): boolean {
    const supportedStatus: boolean = this.languageVersion >= requiredVersion ? true : false;
    //this._logMessage(`sp2u:  -- langV=${this.languageVersion}, requestedSpinVersion(${requiredVersion}) -> ${supportedStatus}`);
    return supportedStatus;
  }

  public charsInsetCount(line: string, tabWidth: number): number {
    // count and return the number of columns of white space at start of line
    // NOTE: expands tabs appropriate to editor settings!
    let insetCount: number = 0;
    if (line !== undefined && line.length > 0) {
      let nonWhite: boolean = false;
      for (let index = 0; index < line.length; index++) {
        const char = line.charAt(index);
        switch (char) {
          case ' ':
            insetCount++;
            break;
          case '\t':
            insetCount += tabWidth - (insetCount % tabWidth);
            break;
          default:
            nonWhite = true;
            break; // no more whitespace, return count
        }
        if (nonWhite) {
          break;
        }
      }
    }
    return insetCount;
  }

  public indexOfMatchingCloseParen(line: string, openParenOffset: number): number {
    let desiredCloseOffset: number = -1;
    let nestingDepth: number = 1;
    for (let offset = openParenOffset + 1; offset < line.length; offset++) {
      if (line.substring(offset, offset + 1) == '(') {
        nestingDepth++;
      } else if (line.substring(offset, offset + 1) == ')') {
        nestingDepth--;
        if (nestingDepth == 0) {
          // we closed the inital open
          desiredCloseOffset = offset;
          break; // done, get outta here
        }
      }
    }
    // this._logMessage('  -- iomcp line=[' + line + ']');
    // this._logMessage('  --       open=(' + openParenOffset + '), close=(' + desiredCloseOffset + ')');
    return desiredCloseOffset;
  }

  public getDebugNonWhiteLineParts(line: string): string[] {
    // remove double and then any single quotes string from display list
    // FIXME: how to leave index expressions intact ??
    //this._logMessage('  -- gdnwlp() raw-line [' + line + ']');
    const nonDblStringLine: string = this.removeDoubleQuotedStrings(line);
    //this._logMessage(`  -- gdnwlp() nonDblStringLine=[${nonDblStringLine}]`);
    const nonSglStringLine: string = this.removeDebugSingleQuotedStrings(nonDblStringLine, true);
    //this._logMessage(`  -- gdnwlp() nonSglStringLine=[${nonSglStringLine}]`);
    const lineParts: string[] | null = nonSglStringLine.match(/[^ ,@=+\-*/#<>|^&\t()!?~\\]+/g);

    // remove new backtic directives
    const ignoreStrings: string[] = ['`?', '`.', '`$', '`%', '`#', '`'];

    // Filter out ignored strings
    let filteredLineParts = lineParts ? lineParts.filter((part) => !ignoreStrings.includes(part)) : [];
    //this._logMessage(`  -- gdnwlp() lineParts=[${filteredLineParts.join(', ')}](${filteredLineParts.length})`);

    // pre-pass to break-up elements with bitfield access
    let rebuiltLineParts: string[] = [];
    for (let index = 0; index < filteredLineParts.length; index++) {
      const element = filteredLineParts[index];
      let newElements: string[] = [];
      if (element.includes('.[')) {
        const nameParts: string[] = element.split(/\.\[|\.\./).filter(Boolean);
        newElements.push(...nameParts);
      } else {
        // keep as is
        newElements = [element];
      }
      if (newElements.length > 0) {
        rebuiltLineParts.push(...newElements);
      }
      //this._logMessage(`   --- gdnwlp() pass 1 element=[${element}](${element.length}) -> new=[${newElements.join(', ')}](${newElements.length})`);
    }

    filteredLineParts = rebuiltLineParts.length > 0 ? rebuiltLineParts : filteredLineParts;
    //this._logMessage(`  -- gdnwlp() filteredLineParts=[${filteredLineParts.join(', ')}](${filteredLineParts.length})`);
    // let's remove leading ']'on elements, trailing '[' on elements, element which is ']' or '[', and '[element]'
    rebuiltLineParts = [];
    for (let index = 0; index < filteredLineParts.length; index++) {
      const element = filteredLineParts[index];
      //const elementLowCase = element.toLowerCase();
      let newElements: string[] = [];

      /*
		**  HOLD
        !/\bbyte\s*\[/.test(elementLowCase) &&
        !/\bword\s*\[/.test(elementLowCase) &&
        !/\blong\s*\[/.test(elementLowCase) &&
		*/
      // remove all '[' and ']' from names except for
      //   names which are structure references  Ex: 'm.head[motor]', or 'm.stat[motor].velo', etc.
      if (element.includes('.[')) {
        const nameParts: string[] = element.split(/.[[\]]/).filter(Boolean);
        newElements.push(...nameParts);
      } else if (!element.includes('.') && (element.includes('[') || element.includes(']'))) {
        if (element.length > 1) {
          // handle "name1[name2", "name[", "]name",  and '[name]'
          //  NOTE: this also handes the case of 'debug[bitIndex]'
          const nameParts: string[] = element.split(/[[\]]/).filter(Boolean);
          newElements.push(...nameParts);
        } else {
          // don't do anything with these: ']' or '['
        }
      } else if (element.length > 0) {
        // BUGIFX found case where "...(`TERM EFZ`(i+1) POS..." parsed and left EFZ` as a single element (BAD)
        if (element.endsWith('`')) {
          // remove ending back tic
          newElements.push(element.substring(0, element.length - 1));
        } else {
          // keep as is
          newElements = [element];
        }
      }

      if (newElements.length > 0) {
        rebuiltLineParts.push(...newElements);
      }
      //this._logMessage(`   --- gdnwlp() pass 2 element=[${element}](${element.length}) -> new=[${newElements.join(', ')}](${newElements.length})`);
    }
    this._logMessage(`  -- gdnwlp() rebuiltLineParts=[${rebuiltLineParts.join(', ')}](${rebuiltLineParts.length})`);

    return rebuiltLineParts;
  }

  public getCommaDelimitedNonWhiteLineParts(line: string): string[] {
    const lineParts: string[] | null = line.match(/[^ \t,]+/g);
    return lineParts == null ? [] : lineParts;
  }

  public getCommaDelimitedLineParts(line: string): string[] {
    const lineParts: string[] | null = line.split(/\s*,\s*/);
    return lineParts == null ? [] : lineParts;
  }

  public removeQuotedStrings(line: string): string {
    let nonSglStringLine: string = line;
    if (line !== undefined && line.length > 3) {
      const nonDblStringLine: string = this.removeDoubleQuotedStrings(line);
      nonSglStringLine = this.removeDebugSingleQuotedStrings(nonDblStringLine);
      if (line.length > 0 && line !== nonSglStringLine) {
        this._logMessage(`  -- rmvQS()             Line=[${line}](${line.length})`);
        if (line !== nonDblStringLine) {
          this._logMessage(`  -- rmvQS() nonDblStringLine=[${nonDblStringLine}](${nonDblStringLine.length})`);
        }
        if (nonSglStringLine !== nonDblStringLine) {
          this._logMessage(`  -- rmvQS() nonSglStringLine=[${nonSglStringLine}](${nonSglStringLine.length})`);
        }
      }
    }
    return nonSglStringLine;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public removeDebugSingleQuotedStrings(line: string, showDebug: boolean = true): string {
    // remove single-quoted strings from keyword processing
    //  Ex #1:   ' a string '
    //  Ex #2:   ' a string up to [`(var)]
    //  Ex #3:   [)] a string after var'
    //  Ex #4:   [)] a string up to another [`(var)]
    //  Ex #5:   debug(`scope_xy xy size 200 range 1000 samples 200 dotsize 5 'Goertzel' `dly(#200))
    //  Ex #6:   debug(`logic MyLogic pos 30 150 samples 112 'p0=SO' 1 'p1=CLK' 1 'p2=CS' 1)
    //  Ex #7:   debug(`testTerm 1 'Pulse Width = ', '`(position)', ' microseconds  ')
    //  Ex #8:   debug(`term3 'FwdEnc=`(encVal), dty=`(duty), dxy=`(duty)' 10)    ' more than 1 `() within a single 'xxxx' string
    // NOTE: allowed `() specs: Decimal: `(var), Hex: `$(var), Binary: `%(var), Characters: `#(var)
    //  Also debug format specifier escapes: `zstr_(expr), `udec_(expr), `lstr_(expr), `sdec_(expr), etc.
    //this._logMessage(`- RQS line [${line}]`);
    let trimmedLine: string = line;
    const chrSingleQuote: string = "'";
    const chrCloseParen: string = ')';
    // skip past tic-open pairs and their closes
    let nextTicEscape: number = this._nextTicEscape(trimmedLine, 0);
    let quoteStartOffset: number = trimmedLine.indexOf(chrSingleQuote, 0);
    // should we process this line?

    // while we have tic pairs remove them
    //  if back-tic() operation within don't remove them!
    let badElement: string = '';
    while (quoteStartOffset != -1) {
      // SKIP past ticEscapes to locate last closing paren
      const quoteEndOffset: number = trimmedLine.indexOf(chrSingleQuote, quoteStartOffset + 1);
      if (quoteEndOffset == -1) {
        break; // no more pairs, exit
      }

      if (nextTicEscape != -1) {
        // skip tic escapes before our next quoted string
        while (nextTicEscape < quoteStartOffset) {
          nextTicEscape = this._nextTicEscape(trimmedLine, nextTicEscape + 1);
          if (nextTicEscape == -1) {
            break; // no more `() on line...
          }
        }
      }

      let stringNoTicEscape: boolean = true;
      if (nextTicEscape != -1) {
        if (nextTicEscape > quoteStartOffset && nextTicEscape < quoteEndOffset) {
          stringNoTicEscape = false; // we need to remove before and after tic escape
        }
      }
      //this._logMessage(
      //    `  -- RdsQS quoteStartOffset=(${quoteStartOffset}), nextTicEscape=(${nextTicEscape}), quoteEndOffset=(${quoteEndOffset}): stringNoTicEscape=(${stringNoTicEscape})`
      //);
      if (stringNoTicEscape) {
        // ----------------------------------------
        // have string with no tic escape, remove it
        //
        badElement = trimmedLine.substring(quoteStartOffset, quoteEndOffset + 1);
        trimmedLine = trimmedLine.replace(badElement, '#'.repeat(badElement.length));
        //this._logMessage(`sp2u:  -- RdsQS A trimmedLine=[${trimmedLine}](${trimmedLine.length})`);
        // FIXME: TODO: splice instead of search / replace (will work in face of dupe strings)
      } else {
        // ----------------------------------------
        // have string to first escape, remove it
        //
        // remove front
        badElement = trimmedLine.substring(quoteStartOffset, nextTicEscape); // no +1 leave tic there
        trimmedLine = trimmedLine.replace(badElement, '#'.repeat(badElement.length));
        //this._logMessage(`sp2u:  -- RdsQS B trimmedLine=[${trimmedLine}](${trimmedLine.length})`);

        const openParenOffsetA: number = trimmedLine.indexOf('(', nextTicEscape);
        let closeParenOffset: number = openParenOffsetA !== -1 ? this._findBalancedCloseParen(trimmedLine, openParenOffsetA) : -1;
        if (closeParenOffset == -1) {
          this._logMessage(`sp2u:  -- RdsQS FAILED A to locate close paren of \`() clause`);
          break;
        }

        // do we have another tic-escape inside this string?
        nextTicEscape = this._nextTicEscape(trimmedLine, closeParenOffset + 1);
        while (nextTicEscape != -1 && nextTicEscape < quoteEndOffset) {
          // yes remove string from `() to `()...
          badElement = trimmedLine.substring(closeParenOffset + 1, nextTicEscape);
          trimmedLine = trimmedLine.replace(badElement, '#'.repeat(badElement.length));
          //this._logMessage(`sp2u:  -- RdsQS C trimmedLine=[${trimmedLine}](${trimmedLine.length})`);

          const openParenOffsetB: number = trimmedLine.indexOf('(', nextTicEscape);
          closeParenOffset = openParenOffsetB !== -1 ? this._findBalancedCloseParen(trimmedLine, openParenOffsetB) : -1;
          if (closeParenOffset == -1) {
            this._logMessage(`sp2u:  -- RdsQS FAILED B to locate close paren of \`() clause`);
            break;
          }
          // locate a next tic-escape, if it's in our same string we'll continue in this loop
          nextTicEscape = this._nextTicEscape(trimmedLine, closeParenOffset + 1);
        }
        // if our tic-escape loop bailed we need to as well
        if (closeParenOffset == -1) {
          this._logMessage(`sp2u:  -- RdsQS FAILED C to locate close paren of \`() clause`);
          break;
        }
        // ----------------------------------------
        // have string from last escape to end quote
        badElement = trimmedLine.substring(closeParenOffset + 1, quoteEndOffset + 1);
        trimmedLine = trimmedLine.replace(badElement, '#'.repeat(badElement.length));
        //this._logMessage(`sp2u:  -- RdsQS D trimmedLine=[${trimmedLine}](${trimmedLine.length})`);

        // if we have `( followed by ) then skip this close, look for next
        nextTicEscape = this._nextTicEscape(trimmedLine, closeParenOffset + 1);
      }
      // see if we have another pair...
      quoteStartOffset = trimmedLine.indexOf(chrSingleQuote, quoteEndOffset + 1);
    }

    return trimmedLine;
  }

  private _nextTicEscape(line: string, startingOffset: number): number {
    // Find any backtick escape sequence starting from startingOffset
    // Handles simple escapes: `(var), `$(var), `%(var), `#(var)
    // AND debug format specifier escapes: `zstr_(expr), `udec_(expr), `lstr_(expr), etc.
    const searchLine: string = line.substring(startingOffset);
    const ticEscapeRegex: RegExp = /`(?:[a-zA-Z_]\w*)?[#$%]?\(/;
    const match: RegExpExecArray | null = ticEscapeRegex.exec(searchLine);
    return match !== null ? startingOffset + match.index : -1;
  }

  private _findBalancedCloseParen(line: string, openParenOffset: number): number {
    // Find the matching close paren for the open paren at openParenOffset,
    // handling nested parentheses within the expression
    let depth: number = 1;
    for (let i = openParenOffset + 1; i < line.length; i++) {
      if (line[i] === '(') {
        depth++;
      } else if (line[i] === ')') {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }
    return -1; // not found
  }

  public getNonInlineCommentLine(line: string): string {
    // NEW remove {comment} and {{comment}} single-line elements too
    let nonInlineCommentStr: string = line;
    // TODO: UNDONE make this into loop to find all single line {} or {{}} comments
    const startDoubleBraceOffset: number = nonInlineCommentStr.indexOf('{{');
    if (startDoubleBraceOffset != -1) {
      const endDoubleBraceOffset: number = nonInlineCommentStr.indexOf('}}', startDoubleBraceOffset + 2);
      if (endDoubleBraceOffset != -1) {
        // remove this comment
        const badElement = nonInlineCommentStr.substr(startDoubleBraceOffset, endDoubleBraceOffset - startDoubleBraceOffset + 1);
        //this._logMessage('  -- badElement=[' + badElement + ']');
        nonInlineCommentStr = nonInlineCommentStr.replace(badElement, ' '.repeat(badElement.length));
      }
    }
    const startSingleBraceOffset: number = nonInlineCommentStr.indexOf('{');
    if (startSingleBraceOffset != -1) {
      const endSingleBraceOffset: number = nonInlineCommentStr.indexOf('}', startSingleBraceOffset + 1);
      if (endSingleBraceOffset != -1) {
        // remove this comment
        const badElement = nonInlineCommentStr.substr(startSingleBraceOffset, endSingleBraceOffset - startSingleBraceOffset + 1);
        //this._logMessage('  -- badElement=[' + badElement + ']');
        nonInlineCommentStr = nonInlineCommentStr.replace(badElement, ' '.repeat(badElement.length));
      }
    }
    //if (nonInlineCommentStr.length != line.length) {
    //    this._logMessage('  -- NIC line [' + line + ']');
    //    this._logMessage('  --          [' + nonInlineCommentStr + ']');
    //}
    return nonInlineCommentStr;
  }

  public getNonDocCommentLineRemainder(startingOffset: number, line: string): string {
    let nonDocCommentRHSStr: string = line;
    //this._logMessage('  -- gNDCLR ofs=' + startingOffset + '[' + line + '](' + line.length + ')');
    // TODO: UNDONE make this into loop to find first ' not in string
    if (line.length - startingOffset > 0) {
      const nonCommentEOL: number = line.length - 1;
      //this._logMessage('- gNDCLR startingOffset=[' + startingOffset + '], currentOffset=[' + currentOffset + ']');
      nonDocCommentRHSStr = line.substr(startingOffset, nonCommentEOL - startingOffset + 1).trimEnd();
      //this._logMessage('- gNDCLR nonCommentRHSStr=[' + startingOffset + ']');

      const singleBraceBeginOffset: number = nonDocCommentRHSStr.indexOf('{', startingOffset);
      if (singleBraceBeginOffset != -1) {
        const singleBraceEndOffset: number = nonDocCommentRHSStr.indexOf('}', singleBraceBeginOffset);
        if (singleBraceEndOffset != -1) {
          const inLineComment: string = nonDocCommentRHSStr.substr(singleBraceBeginOffset, singleBraceEndOffset - singleBraceBeginOffset + 1);
          nonDocCommentRHSStr = nonDocCommentRHSStr.replace(inLineComment, '').trim();
        }
      }
    } else if (line.length - startingOffset == 0) {
      nonDocCommentRHSStr = '';
    }
    //if (line.substr(startingOffset).length != nonCommentRHSStr.length) {
    //    this._logMessage('  -- gNDCLR line [' + line.substr(startingOffset) + ']');
    //    this._logMessage('  --             [' + nonCommentRHSStr + ']');
    //}
    return nonDocCommentRHSStr;
  }

  public getNonWhiteDataDeclarationLineParts(line: string): string[] {
    const nonEqualsLine: string = this.removeDoubleQuotedStrings(line);
    const lineParts: string[] | null = nonEqualsLine.match(/[^ \t,()+\-/<>|&*^@]+/g);
    const filterParts: string[] = [];
    if (lineParts != null) {
      for (let index = 0; index < lineParts.length; index++) {
        const element = lineParts[index];
        if (element.length > 0) {
          filterParts.push(element);
        }
      }
    }

    return filterParts;
  }

  public getNonWhiteDataInitLineParts(line: string, preservePacked: boolean = false): string[] {
    const nonEqualsLine: string = this.removeDoubleQuotedStrings(line, preservePacked);
    const lineParts: string[] | null = nonEqualsLine.match(/[^ \t,[\]()+\-/<>|&*^@]+/g);
    const filterParts: string[] = [];
    if (lineParts != null) {
      for (let index = 0; index < lineParts.length; index++) {
        const element = lineParts[index];
        if (element.length > 0) {
          filterParts.push(element);
        }
      }
    }

    return filterParts;
  }

  public getNonWhiteCONLineParts(line: string, preservePacked: boolean = false): string[] {
    const nonEqualsLine: string = this.removeDoubleQuotedStrings(line, preservePacked);
    const lineParts: string[] | null = nonEqualsLine.match(/[^ \t()|?:*+\-/><=&]+/g);
    const filterParts: string[] = [];
    if (lineParts != null) {
      for (let index = 0; index < lineParts.length; index++) {
        const element = lineParts[index];
        if (element.length > 0) {
          filterParts.push(element);
        }
      }
    }

    return filterParts;
  }

  public getNonWhitePAsmLineParts(line: string): string[] {
    const nonEqualsLine: string = this.removeDoubleQuotedStrings(line);
    const lineParts: string[] | null = nonEqualsLine.match(/[^ \t,()[\]<>=?!^+*&|\-\\#@/]+/g);
    const filterParts: string[] = [];
    if (lineParts != null) {
      for (let index = 0; index < lineParts.length; index++) {
        const element = lineParts[index];
        if (element.length > 0) {
          filterParts.push(element);
        }
      }
    }

    return filterParts;
  }

  public getTrailingCommentOffset(startingOffset: number, line: string): number {
    let desiredOffset: number = -1;
    // ensure we have unique { and {{ offsets if possible
    const doubleBraceOffset: number = line.indexOf('{{', startingOffset);
    let singleBraceOffset: number = line.indexOf('{', startingOffset);
    if (doubleBraceOffset != -1 && doubleBraceOffset == singleBraceOffset) {
      singleBraceOffset = line.indexOf('{', doubleBraceOffset + 2);
    }
    const singleTicOffset: number = line.indexOf("'", startingOffset);
    // now return the earliest of the offsets (or -1 if none found)
    if (doubleBraceOffset != -1) {
      desiredOffset = doubleBraceOffset;
    }
    if (singleBraceOffset != -1) {
      if (desiredOffset == -1) {
        desiredOffset = singleBraceOffset;
      } else {
        desiredOffset = doubleBraceOffset < singleBraceOffset ? doubleBraceOffset : singleBraceOffset;
      }
    }
    if (singleTicOffset != -1) {
      if (desiredOffset == -1) {
        desiredOffset = singleTicOffset;
      } else {
        desiredOffset = singleTicOffset < desiredOffset ? singleTicOffset : desiredOffset;
      }
    }
    return desiredOffset;
  }

  public getLineWithoutInlineComments(line: string): string {
    // if we have {comment} in line remove it
    let cleanedLine: string = line;

    if (!line.trim().startsWith("'")) {
      //let didReplace: boolean = false;

      // if we have quoted string hide them for now...
      const startDoubleQuoteOffset: number = cleanedLine.indexOf('"');
      const KEEP_PACKED_CONSTANTS: boolean = true;
      const checkLine: string = startDoubleQuoteOffset != -1 ? this.removeDoubleQuotedStrings(cleanedLine, KEEP_PACKED_CONSTANTS) : cleanedLine;

      //   REPLACE {{...}} when found, all occurrences
      //do {
      const doubleBraceBeginOffset: number = checkLine.indexOf('{{');
      if (doubleBraceBeginOffset != -1) {
        const doubleBraceEndOffset: number = checkLine.indexOf('}}', doubleBraceBeginOffset);
        if (doubleBraceEndOffset != -1) {
          const inLineComment: string = cleanedLine.substring(doubleBraceBeginOffset, doubleBraceEndOffset + 2);
          cleanedLine = cleanedLine.replace(inLineComment, ' '.repeat(inLineComment.length));
          //didReplace = true;
          //this._logMessage(`sp2u:  -- RInCmt {{cmt}} [${cleanedLine}]`);
        }
      }
      //} while (cleanedLine.indexOf("{{") != -1);

      //   REPLACE {...} when found, all occurrences
      //do {
      const singleBraceBeginOffset: number = checkLine.indexOf('{');
      if (singleBraceBeginOffset != -1) {
        const singleBraceEndOffset: number = checkLine.indexOf('}', singleBraceBeginOffset);
        if (singleBraceEndOffset != -1) {
          const inLineComment: string = cleanedLine.substring(singleBraceBeginOffset, singleBraceEndOffset + 1);
          cleanedLine = cleanedLine.replace(inLineComment, ' '.repeat(inLineComment.length));
          //didReplace = true;
          //this._logMessage(`sp2u:  -- RInCmt {cmt} [${cleanedLine}]`);
        }
      }
      //} while (cleanedLine.indexOf("{") != -1);
      if (cleanedLine.trim().length == 0) {
        cleanedLine = '';
        //didReplace = true;
      }

      //if (didReplace) {
      //  this._logMessage(`sp2u:  -- gLWoInLnC line [${line}]`);
      //  this._logMessage(`sp2u:  --                [${cleanedLine}]`);
      //}
    }
    return cleanedLine;
  }

  private _removeOnlyInlineComments(startingOffset: number, line: string): string {
    // if we have {comment} in line remove it
    let cleanedLine: string = line;

    if (!line.trim().startsWith("'")) {
      //let didReplace: boolean = false;

      if (startingOffset > 0) {
        const prefixToStart: string = ' '.repeat(startingOffset);
        cleanedLine = `${prefixToStart}${line.substring(startingOffset)}`;
        //didReplace = true;
      }

      //   REPLACE {{...}} when found
      //   REPLACE {...} when found
      cleanedLine = this.getLineWithoutInlineComments(cleanedLine);

      //if (didReplace) {
      //  this._logMessage(`sp2u:  -- RInLnCmt line [${line}]`);
      //  this._logMessage(`sp2u:  --               [${cleanedLine}]`);
      //}
    }
    return cleanedLine;
  }

  private _removeAllCommentParts(startingOffset: number, line: string): string {
    // if we have {comment} in line remove it
    let cleanedLine: string = line;

    if (!line.trim().startsWith("'")) {
      //let didReplace: boolean = false;

      if (startingOffset > 0) {
        const prefixToStart: string = ' '.repeat(startingOffset);
        cleanedLine = `${prefixToStart}${line.substring(startingOffset)}`;
        //didReplace = true;
      }

      //   REPLACE {{...}} when found
      //   REPLACE {...} when found
      cleanedLine = this.getLineWithoutInlineComments(cleanedLine);

      // if we have quoted string hide them for now...
      const startDoubleQuoteOffset: number = cleanedLine.indexOf('"');
      const KEEP_PACKED_CONSTANTS: boolean = true;
      const checkLine: string = startDoubleQuoteOffset != -1 ? this.removeDoubleQuotedStrings(cleanedLine, KEEP_PACKED_CONSTANTS) : cleanedLine;

      //   REPLACE ^...}} when NO {{ before it on start of line (unless there's an earlier ' comment)
      const tickOffset: number = checkLine.indexOf("'", startingOffset);
      const doubleBraceEndOffset: number = checkLine.indexOf('}}', startingOffset);
      let isInComment: boolean = doubleBraceEndOffset != -1 && tickOffset != -1 && tickOffset < doubleBraceEndOffset;
      if (doubleBraceEndOffset != -1 && !isInComment) {
        const inLineComment: string = cleanedLine.substring(0, doubleBraceEndOffset + 2);
        cleanedLine = cleanedLine.replace(inLineComment, ' '.repeat(inLineComment.length));
        //didReplace = true;
        //this._logMessage(`sp2u:  -- RInCmt ^cmt}} [${cleanedLine}]`);
      }
      //   REPLACE ^...} when NO { before it on start of line (unless there's an earlier ' comment)
      const singleBraceEndOffset: number = checkLine.indexOf('}', startingOffset);
      isInComment = singleBraceEndOffset != -1 && tickOffset != -1 && tickOffset < singleBraceEndOffset;
      if (singleBraceEndOffset != -1 && !isInComment) {
        const inLineComment: string = cleanedLine.substring(0, singleBraceEndOffset + 1);
        cleanedLine = cleanedLine.replace(inLineComment, ' '.repeat(inLineComment.length));
        //didReplace = true;
        //this._logMessage(`sp2u:  -- RInCmt ^cmt} [${cleanedLine}]`);
      }

      //if (didReplace) {
      //  this._logMessage(`sp2u:  -- RInLnCmt line [${line}]`);
      //  this._logMessage(`sp2u:  --               [${cleanedLine}]`);
      //}
    }
    return cleanedLine;
  }

  public getRemainderWOutTrailingComment(startingOffset: number, line: string): string {
    let lineWithoutTrailingCommentStr: string = this.getRemainderWOutTrailingTicComment(startingOffset, line);
    //this._logMessage(`sp2u:  -- gRWorlTCmt() removeTic [${lineWithoutTrailingCommentStr}](${lineWithoutTrailingCommentStr.length})`);
    lineWithoutTrailingCommentStr = this.getRemainderWOutTrailingBraceComment(0, lineWithoutTrailingCommentStr);
    //this._logMessage(`sp2u:  -- gRWorlTCmt() RemoveBrace [${lineWithoutTrailingCommentStr}](${lineWithoutTrailingCommentStr.length})`);
    // check for continuation '...' but not inside quoted strings
    const lineForContinuationCheck: string = this.removeDoubleQuotedStrings(lineWithoutTrailingCommentStr);
    const continuePosn: number = lineForContinuationCheck.search(/\s\.\.\.\s/);
    if (continuePosn != -1) {
      // remove the comment part of the line (all text after the '...' )
      lineWithoutTrailingCommentStr = lineWithoutTrailingCommentStr.substring(0, continuePosn + 3 + 1).trimEnd();
    }
    if (lineWithoutTrailingCommentStr)
      if (line !== lineWithoutTrailingCommentStr) {
        this._logMessage(`sp2u:  -- gRWorlTCmt() line [${line}](${line.length})`);
        this._logMessage(`sp2u:  --                   [${lineWithoutTrailingCommentStr}](${lineWithoutTrailingCommentStr.length})`);
      }
    return lineWithoutTrailingCommentStr;
  }

  public getRemainderWOutTrailingBraceComment(startingOffset: number, line: string): string {
    //   REPLACE {{...}} when found
    //   REPLACE {...} when found
    // find comment at end of line and remove there to end of line
    //  ( where comment is ' or '' or unpaired {{ or { )
    //   return 0 len line if trim() removes all after removing/replacing comments
    let lineWithoutTrailingCommentStr: string = '';
    // TODO: UNDONE make this into loop to find first ' not in string
    if (line.length - startingOffset > 0) {
      // get line parts - we only care about first one
      lineWithoutTrailingCommentStr = this.getRemainderWOutTrailingTicComment(startingOffset, line);
      lineWithoutTrailingCommentStr = this._removeOnlyInlineComments(0, lineWithoutTrailingCommentStr);
      let beginCommentOffset: number = lineWithoutTrailingCommentStr.lastIndexOf('{');
      const startDoubleQuoteOffset: number = lineWithoutTrailingCommentStr.indexOf('"');
      if (startDoubleQuoteOffset != -1) {
        const nonStringLine: string = this.removeDoubleQuotedStrings(lineWithoutTrailingCommentStr);
        beginCommentOffset = nonStringLine.lastIndexOf('{');
      }

      // do we have a comment?
      //if (beginCommentOffset != -1) {
      //  this._logMessage(`sp2u: - p2 gRWoTTC ofs=${startingOffset}, line=[${line}](${line.length})`);
      //}
      const nonCommentEOL: number = beginCommentOffset != -1 ? beginCommentOffset + 1 : line.length;
      //this._logMessage('- gnclr startingOffset=[' + startingOffset + '], currentOffset=[' + currentOffset + ']');
      lineWithoutTrailingCommentStr = lineWithoutTrailingCommentStr.substring(0, nonCommentEOL).trimEnd();
      //this._logMessage('- gnclr lineWithoutTrailingCommentStr=[' + startingOffset + ']');
      if (lineWithoutTrailingCommentStr.trim().length == 0) {
        lineWithoutTrailingCommentStr = '';
        //this._logMessage(`sp2u:  -- gRWoTTC line forced to EMPTY`);
      }
      //if (line.substr(startingOffset) !== lineWithoutTrailingCommentStr) {
      //  this._logMessage(`sp2u:  -- gRWoTTC line [${line}](${line.length})`);
      //  this._logMessage(`sp2u:  --              [${lineWithoutTrailingCommentStr}](${lineWithoutTrailingCommentStr.length})`);
      //}
      //} else {
      //this._logMessage(`sp2u: - gRWoTTC SKIPPED ofs=${startingOffset}, line=[${line}](${line.length})`);
    }
    return lineWithoutTrailingCommentStr;
  }

  public getRemainderWOutTrailingTicComment(startingOffset: number, line: string): string {
    //   REPLACE {{...}} when found
    //   REPLACE {...} when found
    // find comment at end of line and remove there to end of line
    //  ( where comment is ' or '' or unpaired {{ or { )
    //   return 0 len line if trim() removes all after removing/replacing comments
    let lineWithoutTrailingCommentStr: string = '';
    // TODO: UNDONE make this into loop to find first ' not in string
    if (line.length - startingOffset > 0) {
      // get line parts - we only care about first one
      lineWithoutTrailingCommentStr = this._removeOnlyInlineComments(startingOffset, line);
      let beginCommentOffset: number = lineWithoutTrailingCommentStr.indexOf("'");
      if (beginCommentOffset != -1) {
        // have single quote, is it within quoted string?
        // if we have quited string hide them for now...
        const startDoubleQuoteOffset: number = lineWithoutTrailingCommentStr.indexOf('"');
        if (startDoubleQuoteOffset != -1) {
          const nonStringLine: string = this.removeDoubleQuotedStrings(lineWithoutTrailingCommentStr);
          beginCommentOffset = nonStringLine.indexOf("'");
        }
      }

      // do we have a comment?
      //if (beginCommentOffset != -1) {
      //  this._logMessage(`sp2u: - p2 gRWoTTC ofs=${startingOffset}, line=[${line}](${line.length})`);
      //}
      const nonCommentEOL: number = beginCommentOffset != -1 ? beginCommentOffset : line.length;
      //this._logMessage('- gnclr startingOffset=[' + startingOffset + '], currentOffset=[' + currentOffset + ']');
      lineWithoutTrailingCommentStr = lineWithoutTrailingCommentStr.substring(0, nonCommentEOL).trimEnd();
      //this._logMessage('- gnclr lineWithoutTrailingCommentStr=[' + startingOffset + ']');
      if (lineWithoutTrailingCommentStr.trim().length == 0) {
        lineWithoutTrailingCommentStr = '';
        //this._logMessage(`sp2u:  -- gRWoTTC line forced to EMPTY`);
      }
      //if (line.substr(startingOffset) !== lineWithoutTrailingCommentStr) {
      //  this._logMessage(`sp2u:  -- gRWoTTC line [${line}](${line.length})`);
      //  this._logMessage(`sp2u:  --              [${lineWithoutTrailingCommentStr}](${lineWithoutTrailingCommentStr.length})`);
      //}
      //} else {
      //this._logMessage(`sp2u: - gRWoTTC SKIPPED ofs=${startingOffset}, line=[${line}](${line.length})`);
    }
    return lineWithoutTrailingCommentStr;
  }

  public getNonCommentLineRemainder(startingOffset: number, line: string): string {
    // upgraded behaviors:
    //   remove { to EOL when NOT paired with }
    //   remove {{ to EOL when NOT paired with }}
    //   REPLACE ^...} when NO { before it on start of line
    //   REPLACE ^...}} when NO {{ before it on start of line
    //   REPLACE {{...}} when found
    //   REPLACE {...} when found
    // find comment at end of line and remove there to end of line
    //  ( where comment is ' or '' or unpaired {{ or { )
    //   return 0 len line if trim() removes all after removing/replacing comments
    let lineWithoutTrailingCommentStr: string = '';
    // TODO: UNDONE make this into loop to find first ' not in string
    if (line.length - startingOffset > 0) {
      // get line parts - we only care about first one
      lineWithoutTrailingCommentStr = this._removeAllCommentParts(startingOffset, line);
      let beginCommentOffset: number = lineWithoutTrailingCommentStr.indexOf("'");
      if (beginCommentOffset != -1) {
        // have single quote, is it within quoted string?
        const currentOffset: number = this.skipWhite(line, startingOffset);
        // if we have quited string hide them for now...
        const startDoubleQuoteOffset: number = line.indexOf('"', currentOffset);
        if (startDoubleQuoteOffset != -1) {
          const nonStringLine: string = this.removeDoubleQuotedStrings(lineWithoutTrailingCommentStr);
          beginCommentOffset = nonStringLine.indexOf("'");
        }
      }

      // do we have a comment?
      //if (beginCommentOffset != -1) {
      //  this._logMessage(`sp2u: - p2 gNCLR ofs=${startingOffset}, line=[${line}](${line.length})`);
      //}
      const nonCommentEOL: number = beginCommentOffset != -1 ? beginCommentOffset : line.length;
      //this._logMessage('- gnclr startingOffset=[' + startingOffset + '], currentOffset=[' + currentOffset + ']');
      lineWithoutTrailingCommentStr = lineWithoutTrailingCommentStr.substring(0, nonCommentEOL).trimEnd();
      //this._logMessage('- gnclr lineWithoutTrailingCommentStr=[' + startingOffset + ']');
      if (lineWithoutTrailingCommentStr.trim().length == 0) {
        lineWithoutTrailingCommentStr = '';
        //this._logMessage(`sp2u:  -- gNCLR line forced to EMPTY`);
      }
      //if (line.substr(startingOffset) !== lineWithoutTrailingCommentStr) {
      //  this._logMessage(`sp2u:  -- gNCLR line [${line}](${line.length})`);
      //  this._logMessage(`sp2u:  --            [${lineWithoutTrailingCommentStr}](${lineWithoutTrailingCommentStr.length})`);
      //}
      //} else {
      //  this._logMessage(`sp2u: - gNCLR SKIPPED ofs=${startingOffset}, line=[${line}](${line.length})`);
    }
    return lineWithoutTrailingCommentStr;
  }

  public removeDoubleQuotedStrings(line: string, preservePacked: boolean = false): string {
    let didRemove: boolean = false;
    let trimmedLine: string = line;
    const doubleQuote: string = '"';
    let packedLongOffset: number = preservePacked == true ? trimmedLine.indexOf('%"') : -1;
    let searchOffset = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let quoteStartOffset = trimmedLine.indexOf(doubleQuote, searchOffset);

      // Skip packed long if needed
      if (preservePacked && packedLongOffset !== -1 && quoteStartOffset === packedLongOffset + 1) {
        quoteStartOffset = trimmedLine.indexOf(doubleQuote, packedLongOffset + 2);
        if (quoteStartOffset === -1) break;
      }
      if (quoteStartOffset === -1) break;

      const quoteEndOffset = trimmedLine.indexOf(doubleQuote, quoteStartOffset + 1);
      if (quoteEndOffset === -1) break;

      const badElement = trimmedLine.substring(quoteStartOffset, quoteEndOffset + 1);
      didRemove = true;
      trimmedLine = trimmedLine.substring(0, quoteStartOffset) + '#'.repeat(badElement.length) + trimmedLine.substring(quoteEndOffset + 1);

      // Update packedLongOffset for next search
      packedLongOffset = preservePacked == true ? trimmedLine.indexOf('%"', quoteEndOffset + 1) : -1;

      // Move searchOffset past the replaced string
      searchOffset = quoteStartOffset + badElement.length;
    }

    // Remove {text} inline block comments — but only when NOT called with
    // preservePacked (i.e., not when building checkLine for comment detection).
    // When preservePacked is true, the caller needs braces preserved so it can
    // find and remove inline comments itself (getLineWithoutInlineComments).
    if (!preservePacked) {
      const braceStartChar: string = '{';
      const braceEndChar: string = '}';
      let braceStartOffset: number = 0; // value doesn't matter
      while ((braceStartOffset = trimmedLine.indexOf(braceStartChar)) != -1) {
        const braceEndOffset: number = trimmedLine.indexOf(braceEndChar, braceStartOffset + 1);
        if (braceEndOffset != -1) {
          const badElement = trimmedLine.substring(braceStartOffset, braceEndOffset + 1);
          trimmedLine = trimmedLine.replace(badElement, ' '.repeat(badElement.length));
          didRemove = true;
        } else {
          break; // we don't handle a single brace (of multi-line)
        }
      }
    }

    /*
    if (didRemove) {
      this._logMessage(`  -- RDQS line [${line}]${line.length}, preservePacked=(${preservePacked})`);
      this._logMessage(`  --           [${trimmedLine}](${trimmedLine.length})`);
    }
    //*/

    return trimmedLine;
  }

  public skipWhite(line: string, currentOffset: number): number {
    let firstNonWhiteIndex: number = currentOffset;
    for (let index = currentOffset; index < line.length; index++) {
      if (line.substr(index, 1) != ' ' && line.substr(index, 1) != '\t') {
        firstNonWhiteIndex = index;
        break;
      }
    }
    return firstNonWhiteIndex;
  }

  public getNonWhiteLineParts(line: string): string[] {
    const lineParts: string[] | null = line.match(/[^ \t]+/g);
    const filterParts: string[] = [];
    if (lineParts != null) {
      for (let index = 0; index < lineParts.length; index++) {
        const element = lineParts[index];
        if (element.length > 0) {
          filterParts.push(element);
        }
      }
    }
    return filterParts;
  }

  public getNonWhiteNOperatorLineParts(line: string): string[] {
    const lineParts: string[] | null = line.match(/[^ \t+<>[\]]+/g);
    return lineParts == null ? [] : lineParts;
  }

  public getNonWhiteNParenLineParts(line: string): string[] {
    const lineParts: string[] | null = line.match(/[^ \t()]+/g);
    return lineParts == null ? [] : lineParts;
  }

  // ----------------------------------------------------------------------------
  // Built-in SPIN variables P1, P2
  //
  private spin1ControlFlowKeywords: string[] = [
    'if',
    'ifnot',
    'elseif',
    'elseifnot',
    'else',
    'while',
    'repeat',
    'until',
    'from',
    'to',
    'step',
    'next',
    'quit',
    'case',
    'other',
    'abort',
    'return'
  ];

  private spin2ControlFlowKeywords: string[] = [
    'if',
    'ifnot',
    'elseif',
    'elseifnot',
    'else',
    'repeat',
    'while',
    'until',
    'from',
    'to',
    'step',
    'next',
    'quit',
    'with',
    'case',
    'case_fast',
    'other',
    'abort',
    'return'
  ];

  public isSpin1ControlFlowKeyword(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const reservedStatus: boolean = this.spin1ControlFlowKeywords.includes(nameKey);
    return reservedStatus;
  }

  public isSpin2ControlFlowKeyword(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const reservedStatus: boolean = this.spin2ControlFlowKeywords.includes(nameKey);
    return reservedStatus;
  }

  // ----------------------------------------------------------------------------
  // Built-in SPIN variables P2
  //
  private _tableSpinHubLocations: { [Identifier: string]: string } = {
    clkmode: 'Clock mode value',
    clkfreq: 'Clock frequency value'
  };

  private _tableSpinHubVariables: { [Identifier: string]: string } = {
    varbase: 'Object base pointer, @VARBASE is VAR base, used by method-pointer calls'
  };

  private _tableSpinTaskRegisters_v47: { [Identifier: string]: string } = {
    taskhlt: 'Register which holds the HALT bits (in reverse order)'
  };

  private _tableSpinCogRegisters: { [Identifier: string]: string } = {
    pr0: 'Spin2 <-> PASM communication',
    pr1: 'Spin2 <-> PASM communication',
    pr2: 'Spin2 <-> PASM communication',
    pr3: 'Spin2 <-> PASM communication',
    pr4: 'Spin2 <-> PASM communication',
    pr5: 'Spin2 <-> PASM communication',
    pr6: 'Spin2 <-> PASM communication',
    pr7: 'Spin2 <-> PASM communication',
    ijmp1: 'Interrupt JMP 1 (of 3)',
    ijmp2: 'Interrupt JMP 2 (of 3)',
    ijmp3: 'Interrupt JMP 3 (of 3)',
    iret1: 'Interrupt RET 1 (of 3)',
    iret2: 'Interrupt RET 2 (of 3)',
    iret3: 'Interrupt RET 3 (of 3)',
    pa: 'General pointer register A',
    pb: 'General pointer register B',
    ptra: 'Data pointer passed from COGINIT',
    ptrb: 'Code pointer passed from COGINIT',
    dira: 'Output enables for P31..P0',
    dirb: 'Output enables for P63..P32',
    outa: 'Output states for P31..P0',
    outb: 'Output states for P63..P32',
    ina: 'Input states from P31..P0',
    inb: 'Input states from P63..P32'
  };

  private _docTextForSpinBuiltInVariable(name: string): IBuiltinDescription {
    const nameKey: string = name.toLowerCase();
    const desiredDocText: IBuiltinDescription = {
      found: false,
      type: eBuiltInType.Unknown,
      category: '',
      description: '',
      signature: ''
    };
    if (this.isSpinBuiltInVariable(name)) {
      desiredDocText.found = true;
      if (nameKey in this._tableSpinHubLocations) {
        desiredDocText.category = 'Hub Location';
        desiredDocText.description = this._tableSpinHubLocations[nameKey];
      } else if (nameKey in this._tableSpinHubVariables) {
        desiredDocText.category = 'Hub Variable';
        desiredDocText.description = this._tableSpinHubVariables[nameKey];
      } else if (nameKey in this._tableSpinCogRegisters) {
        desiredDocText.category = 'Cog Register';
        desiredDocText.description = this._tableSpinCogRegisters[nameKey];
      } else if (this.requestedSpinVersion(46) && nameKey in this._tableClockControlSymbols_v46) {
        desiredDocText.category = 'Clock Control Symbol';
        desiredDocText.description = this._tableClockControlSymbols_v46[nameKey];
      } else if (this.requestedSpinVersion(47) && nameKey in this._tableSpinTaskRegisters_v47) {
        desiredDocText.category = 'Task Register';
        desiredDocText.description = this._tableSpinTaskRegisters_v47[nameKey];
      }
    }
    return desiredDocText;
  }

  public isValidSpinSymbolNameStartChar(name: string): boolean {
    let isValidSymbolName: boolean = false;
    if (name !== undefined) {
      // ^:
      //   Ensures the match starts at the beginning of the string.
      // [A-Z_a-z]:
      //   Matches the first character, which must be an uppercase letter (A-Z), lowercase letter (a-z), or an underscore (_).
      isValidSymbolName = name.charAt(0).match(/^[A-Z_a-z]/) ? true : false;
    }
    return isValidSymbolName;
  }

  public isValidSpinSymbolName(name: string): boolean {
    let isValidSymbolName: boolean = false;
    if (name !== undefined) {
      const dotPosn: number = name.indexOf('.');
      const ltBracketPosn: number = name.indexOf('[');
      const bracketIsFirst: boolean = (ltBracketPosn != -1 && ltBracketPosn < dotPosn) || (dotPosn == -1 && ltBracketPosn != -1);
      if (bracketIsFirst) {
        // Ex: LONG[address][index]
        const nameParts: string[] = name.split(/[[\]]/);
        if (nameParts.length > 0) {
          name = nameParts[0];
        }
      } else if (dotPosn != -1) {
        // Ex: HubVar.BYTE[index]
        const nameParts: string[] = name.split('.');
        if (nameParts.length > 0) {
          name = nameParts[0];
        }
      }

      const isSymbolNameRegEx = /^[A-Z_a-z][A-Z_a-z0-9]{0,31}$/;
      // ^:
      //   Ensures the match starts at the beginning of the string.
      // [A-Z_a-z]:
      //   Matches the first character, which must be an uppercase letter (A-Z), lowercase letter (a-z), or an underscore (_).
      // [A-Z_a-z0-9]{0,31}:
      //   Matches 0 to 31 additional characters, which can be uppercase letters, lowercase letters, digits (0-9), or underscores (_).
      //   This ensures the total length of the string is at most 32 characters.
      // $:
      //   Ensures the match ends at the end of the string.
      //
      const symbolNameMatch = isSymbolNameRegEx.test(name);
      isValidSymbolName = symbolNameMatch ? true : false;
    }
    return isValidSymbolName;
  }

  public isValidDatPAsmSymbolName(name: string): boolean {
    let isValidSymbolName: boolean = false;
    if (name !== undefined) {
      const isSymbolNameRegEx = /^[A-Z_a-z:.][A-Z_a-z0-9]{0,31}$/;
      // ^:
      //   Ensures the match starts at the beginning of the string.
      // [A-Z_a-z:.]:
      //   Matches the first character, which must be an uppercase letter (A-Z), lowercase letter (a-z), or an underscore (_), dot (.), or colon (:).
      // [A-Z_a-z0-9]{0,31}:
      //   Matches 0 to 31 additional characters, which can be uppercase letters, lowercase letters, digits (0-9), or underscores (_).
      //   This ensures the total length of the string is at most 32 characters.
      // $:
      //   Ensures the match ends at the end of the string.
      //
      const symbolNameMatch = isSymbolNameRegEx.test(name);
      isValidSymbolName = symbolNameMatch ? true : false;
    }
    return isValidSymbolName;
  }

  public isValidSpinConstantOrSpinSymbol(name: string, inPasm: boolean = false): [boolean, boolean] {
    let isSpinConstant: boolean = false;
    let isSpinSymbol: boolean = false;
    if (name !== undefined) {
      isSpinConstant = this.isValidSpinNumericConstant(name);
      if (!isSpinConstant) {
        if (inPasm) {
          isSpinSymbol = this.isValidDatPAsmSymbolName(name);
        } else {
          isSpinSymbol = this.isValidSpinSymbolName(name);
        }
      }
    }
    this._logMessage(`    --- isValidSpinConstOrSym([${name}],pasm=(${inPasm})) = (${isSpinConstant}, ${isSpinSymbol})`);
    return [isSpinConstant, isSpinSymbol];
  }

  public isValidSpinNumericConstant(possibleNumber: string): boolean {
    let numericConstantStatus: boolean = false;
    if (possibleNumber !== undefined) {
      if (this.isDigit(possibleNumber.charAt(0))) {
        // handle decimal or decimal-float convertion
        // is float number?
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        numericConstantStatus = this.isValidDecimalFloat(possibleNumber);
        if (!numericConstantStatus) {
          // hmmm, nope just decimal number
          const isDecimalNumberRegEx = /^(\d+[\d_]*)$/;
          const decimalNumberMatch = isDecimalNumberRegEx.test(possibleNumber);
          numericConstantStatus = decimalNumberMatch ? true : false;
        }
      } else if (possibleNumber.charAt(0) == '$' && this.isHexStartChar(possibleNumber.charAt(1))) {
        // handle hexadecimal conversion Ex: $0f, $dead_f00d, etc.
        const isHexNumberRegEx = /^\$([0-9A-Fa-f]+[0-9_A-Fa-f]*)$/;
        const isHexNumber = isHexNumberRegEx.test(possibleNumber);
        numericConstantStatus = isHexNumber ? true : false;
      } else if (possibleNumber.startsWith('%%') && this.isQuartStartChar(possibleNumber.charAt(2))) {
        // handle base-four numbers of the form %%012_032_000, %%0320213, etc
        const isQuaternaryNumberRegEx = /^%%([[0-3]+[0-3_]*)$/;
        const quaternaryNumberMatch = isQuaternaryNumberRegEx.test(possibleNumber);
        numericConstantStatus = quaternaryNumberMatch ? true : false;
      } else if (possibleNumber.charAt(0) == '%' && this.isBinStartChar(possibleNumber.charAt(1))) {
        // handle base-two numbers of the form %0100_0111, %01111010, etc
        const isBinaryNumberRegEx = /^%([[0-1]+[0-1_]*)$/;
        const binaryNumberMatch = isBinaryNumberRegEx.test(possibleNumber);
        numericConstantStatus = binaryNumberMatch ? true : false;
      } else if (possibleNumber.startsWith('%"') && possibleNumber.substring(2).includes('"')) {
        // handle %"abcd" one to four chars packed into long
        const isPackedAsciiRegEx = /%"[ -~]{1,4}"$/;
        // %:
        //   Matches the literal % character at the start of the pattern.
        // \\":
        //   Matches the literal double quote ("), escaped as \".
        // [ -~]{1,4}:
        //   Matches 1-4 characters in the ASCII printable range (from space 0x20 to tilde 0x7E).
        // \\":
        //   Matches the closing double quote ("), escaped as \".
        // $:
        //   Matches the end of the string.
        //
        const packedAsciiMatch = isPackedAsciiRegEx.test(possibleNumber);
        numericConstantStatus = packedAsciiMatch ? true : false;
      }
    }
    return numericConstantStatus;
  }

  private isValidDecimalFloat(possibleFloat: string): boolean {
    // we are parsing these
    //    = 1.4e5
    //    = 1e-5
    //    = 1.7exponent
    const isFloat1NumberRegEx = /^\d+[\d_]*\.\d+[\d_]*[eE](\+\d|-\d|\d)[\d_]*$/; // decimal and E
    const isFloat2NumberRegEx = /^\d+[\d_]*[eE](\+\d|-\d|\d)[\d_]*$/; // no decimal but E
    const isFloat3NumberRegEx = /^\d+[\d_]*\.\d+[\d_]*$/; // decimal no E
    // three tests, return at first one to match
    let didMatch: boolean = !!possibleFloat.match(isFloat1NumberRegEx);
    if (!didMatch) {
      didMatch = !!possibleFloat.match(isFloat2NumberRegEx);
      if (!didMatch) {
        didMatch = !!possibleFloat.match(isFloat3NumberRegEx);
      }
    }
    return didMatch;
  }

  private isSymbolStartChar(line: string): boolean {
    const findStatus: boolean = /^[A-Z_a-z]+/.test(line);
    //this.logMessage(`isSymbolStartChar(${line}) = (${findStatus})`);
    return findStatus;
  }

  private isDigit(line: string): boolean {
    return /^\d$/.test(line);
  }

  private isHexStartChar(line: string): boolean {
    const findStatus: boolean = /^[A-Fa-f0-9]+/.test(line);
    //this.logMessage(`isHexStartChar(${line}) = (${findStatus})`);
    return findStatus;
  }

  private isBinStartChar(line: string): boolean {
    const findStatus: boolean = /^[01]+/.test(line);
    //this.logMessage(`isBinStartChar(${line}) = (${findStatus})`);
    return findStatus;
  }

  private isQuartStartChar(line: string): boolean {
    const findStatus: boolean = /^[0-3]+/.test(line);
    //this.logMessage(`isQuartStartChar(${line}) = (${findStatus})`);
    return findStatus;
  }

  public isSpinRegister(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = nameKey in this._tableSpinCogRegisters;
    if (!reservedStatus && this.requestedSpinVersion(47)) {
      reservedStatus = nameKey in this._tableSpinTaskRegisters_v47;
    }
    return reservedStatus;
  }

  public isSpinBuiltInVariable(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = nameKey in this._tableSpinHubLocations;
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpinHubVariables;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpinCogRegisters;
    }
    if (!reservedStatus && this.requestedSpinVersion(46)) {
      reservedStatus = nameKey in this._tableClockControlSymbols_v46;
    }
    if (!reservedStatus && this.requestedSpinVersion(47)) {
      reservedStatus = nameKey in this._tableSpinTaskRegisters_v47;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableClockSpinSymbols;
    }
    return reservedStatus;
  }

  // ----------------------------------------------------------------------------
  // Built-in SPIN variables P2
  //
  private _tableSpinBlockNames: { [Identifier: string]: string } = {
    con: '32-bit Constant declarations<br>*(NOTE: CON is the initial/default block type)*',
    obj: 'Child object instantiations<br>*(objects manipulated by this object)*',
    var: 'Object Instance variable declarations',
    pub: 'Public method for use by the parent object and within this object',
    pri: 'Private method for use within this object',
    dat: 'Object Shared variable declarations and/or PASM code'
  };

  private _tableSpinPAsmLangParts: { [Identifier: string]: string[] } = {
    // DAT cogexec
    org: ['ORG', 'begin a cog-exec program (no symbol allowed before ORG), <br>or Start block of inline-pasm code within SPIN (ends with END)'],
    orgf: ['ORGF [value]', 'fill to cog address {value} with zeros (no symbol allowed before ORGF)'],
    orgh: ['ORGH [originValue[,limitValue]]', 'begin a hub-exec program (no symbol allowed before ORGH) (Default origin=$00400, limit=$100000)'],
    end: ['END', 'Ends block of inline-pasm code (started with ORG)'],
    fit: ['FIT [value]', 'test to make sure hub/cog address has not exceeded {value}']
  };

  private _tableSpinPAsmLangParts_v50: { [Identifier: string]: string[] } = {
    // DAT/InLine PASM
    ditto: [
      'DITTO [[count]|END]',
      "Code/data replication directive. 'DITTO count' starts a generative block that repeats count times ($$ provides iteration index 0 to count-1, count=0 generates no code).<br>'DITTO END' terminates the block."
    ]
  };

  public isSpinPAsmLangDirective(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = nameKey in this._tableSpinPAsmLangParts;
    if (!reservedStatus && this.requestedSpinVersion(50)) {
      reservedStatus = nameKey in this._tableSpinPAsmLangParts_v50;
    }
    return reservedStatus;
  }

  private _docTextForSpinBuiltInLanguagePart(name: string): IBuiltinDescription {
    const nameKey: string = name.toLowerCase();
    const desiredDocText: IBuiltinDescription = {
      found: false,
      type: eBuiltInType.Unknown,
      category: '',
      description: '',
      signature: ''
    };
    if (nameKey in this._tableSpinBlockNames) {
      desiredDocText.category = 'Block Name';
      desiredDocText.description = this._tableSpinBlockNames[nameKey];
    } else if (nameKey in this._tableSpinFloatConversions) {
      desiredDocText.category = 'Float Conversions';
      const methodDescr: TMethodTuple = this._tableSpinFloatConversions[nameKey];
      desiredDocText.signature = methodDescr[0];
      desiredDocText.description = methodDescr[1];
      if (methodDescr[2] && methodDescr[2].length > 0) {
        desiredDocText.parameters = methodDescr[2];
      }
      if (methodDescr[3] && methodDescr[3].length > 0) {
        desiredDocText.returns = methodDescr[3];
      }
    } else if (nameKey in this._tableSpinBinaryOperators) {
      desiredDocText.category = 'Binary Operators';
      desiredDocText.description = this._tableSpinBinaryOperators[nameKey];
    } else if (this.requestedSpinVersion(51) && nameKey in this._tableSpinBinaryOperators_v51) {
      desiredDocText.category = 'Binary Operators';
      desiredDocText.description = this._tableSpinBinaryOperators_v51[nameKey];
    } else if (nameKey in this._tableSpinUnaryOperators) {
      desiredDocText.category = 'Unary Operators';
      desiredDocText.description = this._tableSpinUnaryOperators[nameKey];
    } else if (this.requestedSpinVersion(51) && nameKey in this._tableSpinUnaryOperators_v51) {
      desiredDocText.category = 'Unary Operators';
      desiredDocText.description = this._tableSpinUnaryOperators_v51[nameKey];
    } else if (nameKey in this._tableSmartPinNames) {
      desiredDocText.category = 'Smart Pin Configuration';
      desiredDocText.description = this._tableSmartPinNames[nameKey];
    } else if (this.isBuiltinStreamerReservedWord(nameKey)) {
      const streamerDoc = this.pasm2Utils.docTextForStreamerConstant(nameKey);
      if (streamerDoc.found) {
        desiredDocText.category = streamerDoc.category;
        desiredDocText.description = streamerDoc.description;
      } else {
        desiredDocText.category = 'Streamer Mode Configuration';
        desiredDocText.description = '';
      }
    } else if (nameKey in this._tableEventNames) {
      desiredDocText.category = 'Event / Interrupt Source';
      desiredDocText.description = this._tableEventNames[nameKey];
    } else if (nameKey in this._tableSpinPAsmLangParts) {
      desiredDocText.category = 'DAT HubExec/CogExec Directives';
      const protoWDescr: string[] = this._tableSpinPAsmLangParts[nameKey];
      desiredDocText.signature = protoWDescr[0];
      desiredDocText.description = protoWDescr[1]; // bold
    } else if (this.requestedSpinVersion(50) && nameKey in this._tableSpinPAsmLangParts_v50) {
      desiredDocText.category = 'DAT / Inline PASM Directives';
      const protoWDescr: string[] = this._tableSpinPAsmLangParts_v50[nameKey];
      desiredDocText.signature = protoWDescr[0];
      desiredDocText.description = protoWDescr[1]; // bold
    }
    if (desiredDocText.category.length > 0) {
      desiredDocText.found = true;
    }
    return desiredDocText;
  }

  public docTextForDebugBuiltIn(name: string, typeFilter: eSearchFilterType = eSearchFilterType.FT_NO_PREFERENCE): IBuiltinDescription {
    this._logMessage(`sp2u: - docTextForDebugBuiltIn([${name}], ${eSearchFilterType[typeFilter]}) - ENTRY`);
    let desiredDocText: IBuiltinDescription = this._docTextForSpinDebugBuiltInMethod(name);
    if (desiredDocText.found) {
      desiredDocText.type = eBuiltInType.BIT_DEBUG_METHOD;
    } else {
      desiredDocText = this._docTextForSpinBuiltInDebugDisplayType(name);
      if (desiredDocText.found) {
        desiredDocText.type = eBuiltInType.BIT_DEBUG_SYMBOL;
        // FIXME: UNDONE: move the following values into method tables!!!
      } else if (!desiredDocText.found && name.toLowerCase() == 'debug' && typeFilter == eSearchFilterType.FT_METHOD_MASK) {
        desiredDocText.found = true;
        desiredDocText.type = eBuiltInType.BIT_DEBUG_SYMBOL;
        desiredDocText.signature = 'debug[bitPosition](...)';
        desiredDocText.category = 'Debug Output';
        let description: string =
          'Compile debug statement if the specified mask bit(s) are set in DEBUG_MASK. {bitPosition} is position of bit that must be set in DEBUG_MASK for this statement to be compiled. If compiled, run output commands that serially transmit the state of variables and equations as your application runs.  Each time a DEBUG statement is encountered during execution, the debugging program is invoked and it outputs the message for that statement.';
        description = description + '<br>*(Affected by DEBUG_PIN_TX symbol)*';
        desiredDocText.description = description;
      } else if (!desiredDocText.found && name.toLowerCase() == 'debug' && typeFilter == eSearchFilterType.FT_METHOD) {
        desiredDocText.found = true;
        desiredDocText.type = eBuiltInType.BIT_DEBUG_SYMBOL;
        desiredDocText.signature = 'debug(...)';
        desiredDocText.category = 'Debug Output';
        let description: string =
          'Run output commands that serially transmit the state of variables and equations as your application runs.  Each time a DEBUG statement is encountered during execution, the debugging program is invoked and it outputs the message for that statement.';
        description = description + '<br>*(Affected by DEBUG_PIN_TX symbol)*';
        desiredDocText.description = description;
      } else {
        // not a debug specific symbol then check other built-in's
        desiredDocText = this.docTextForBuiltIn(name, eSearchFilterType.FT_NO_PREFERENCE);
      }
    }
    this._logMessage(`sp2u: - docTextForDebugBuiltIn([${name}], ${eSearchFilterType[typeFilter]}) -> [${JSON.stringify(desiredDocText, null, 2)}]`);

    return desiredDocText;
  }

  public docTextForBuiltIn(
    name: string,
    typeFilter: eSearchFilterType = eSearchFilterType.FT_NO_PREFERENCE,
    inPasmCode: boolean = false
  ): IBuiltinDescription {
    this._logMessage(`sp2u: - docTextForBuiltIn([${name}], ${eSearchFilterType[typeFilter]}, inPasm=${inPasmCode})`);
    // When in PASM context, check PASM2 instructions/conditionals/effects FIRST
    // This handles name collisions (AND, OR, NOT, ABS, etc.) by giving PASM2 priority
    if (inPasmCode) {
      const pasmResult = this._lookupPasm2(name);
      if (pasmResult.found) {
        this._logMessage(`sp2u:  -- docTextForBuiltIn [${name}] -> PASM2 hit (${pasmResult.type})`);
        return pasmResult;
      }
    }
    let desiredDocText: IBuiltinDescription = this._docTextForSpinBuiltInVariable(name);
    if (desiredDocText.found) {
      desiredDocText.type = eBuiltInType.BIT_VARIABLE;
    } else {
      desiredDocText = this._docTextForSpinBuiltInMethod(name, typeFilter);
      if (desiredDocText.found && typeFilter != eSearchFilterType.FT_NOT_METHOD) {
        desiredDocText.type = eBuiltInType.BIT_METHOD;
      } else {
        desiredDocText = this._docTextForCogAndNumericSymbols(name);
        if (desiredDocText.found) {
          if (desiredDocText.category.includes('Method Pointer')) {
            desiredDocText.type = eBuiltInType.BIT_METHOD_POINTER;
          } else {
            desiredDocText.type = eBuiltInType.BIT_SYMBOL;
          }
        } else {
          desiredDocText = this._docTextForSpinBuiltInLanguagePart(name);
          if (desiredDocText.found) {
            if (desiredDocText.category.includes('Float Conversions')) {
              desiredDocText.type = eBuiltInType.BIT_METHOD;
            } else {
              desiredDocText.type = eBuiltInType.BIT_LANG_PART;
            }
          } else {
            desiredDocText = this._docTextForSpinClockVars(name);
            if (desiredDocText.found) {
              // desiredDocText.type =     -->  nope, this one sets the type for us!
            } else {
              desiredDocText = this._docTextForSpinStorageTypesAlignment(name);
              if (desiredDocText.found && typeFilter != eSearchFilterType.FT_METHOD) {
                desiredDocText.type = eBuiltInType.BIT_TYPE;
              } else {
                desiredDocText = this._docTextForSpinXYZZYDebugBuiltInInvoke(name);
                if (desiredDocText.found) {
                  desiredDocText.type = eBuiltInType.BIT_DEBUG_SYMBOL;
                } else {
                  desiredDocText = this._docTextForSpinDebugBuiltInSymbols(name);
                  if (desiredDocText.found) {
                    desiredDocText.type = eBuiltInType.BIT_DEBUG_SYMBOL;
                  } else {
                    // Fallback: check PASM2 tables (for items appearing outside PASM context)
                    desiredDocText = this._lookupPasm2(name);
                  }
                }
              }
            }
          }
        }
      }
    }
    this._logMessage(`sp2u:  -- docTextForBuiltIn [${name}],(${eSearchFilterType[typeFilter]}) -> (${JSON.stringify(desiredDocText, null, 2)})`);
    return desiredDocText;
  }

  private _lookupPasm2(name: string): IBuiltinDescription {
    // Try PASM2 instruction first, then conditional, then effect, then MODCZ operand
    let result = this.pasm2Utils.docTextForPasm2Instruction(name);
    if (!result.found) {
      result = this.pasm2Utils.docTextForPasm2Conditional(name);
    }
    if (!result.found) {
      result = this.pasm2Utils.docTextForPasm2Effect(name);
    }
    if (!result.found) {
      result = this.pasm2Utils.docTextForModczOperand(name);
    }
    if (!result.found) {
      result = this.pasm2Utils.docTextForStreamerConstant(name);
    }
    return result;
  }

  private _tableSmartPinNames: { [Identifier: string]: string } = {
    // smart pin names - "decr <br> mode bits"
    // FIXME: break this into multiple table each with own cat. name
    // - A Input Polarity
    p_true_a: 'True A input<br>%0000_0000_000_0000000000000_00_00000_0',
    p_invert_a: 'Invert A input<br>%1000_0000_000_0000000000000_00_00000_0',
    // - A Input Selection
    p_local_a: 'Select local pin for A input<br>%0000_0000_000_0000000000000_00_00000_0',
    p_plus1_a: 'Select pin+1 for A input<br>%0001_0000_000_0000000000000_00_00000_0',
    p_plus2_a: 'Select pin+2 for A input<br>%0010_0000_000_0000000000000_00_00000_0',
    p_plus3_a: 'Select pin+3 for A input<br>%0011_0000_000_0000000000000_00_00000_0',
    p_outbit_a: 'Select OUT bit for A input<br>%0100_0000_000_0000000000000_00_00000_0',
    p_minus3_a: 'Select pin-3 for A input<br>%0101_0000_000_0000000000000_00_00000_0',
    p_minus2_a: 'Select pin-2 for A input<br>%0110_0000_000_0000000000000_00_00000_0',
    p_minus1_a: 'Select pin-1 for A input<br>%0111_0000_000_0000000000000_00_00000_0',
    // - B Input Polarity
    p_true_b: 'True B input<br>%0000_0000_000_0000000000000_00_00000_0',
    p_invert_b: 'Invert B input<br>%0000_1000_000_0000000000000_00_00000_0',
    // - B Input Selection
    p_local_b: 'Select local pin for B input<br>%0000_0000_000_0000000000000_00_00000_0',
    p_plus1_b: 'Select pin+1 for B input<br>%0000_0001_000_0000000000000_00_00000_0',
    p_plus2_b: 'Select pin+2 for B input<br>%0000_0010_000_0000000000000_00_00000_0',
    p_plus3_b: 'Select pin+3 for B input<br>%0000_0011_000_0000000000000_00_00000_0',
    p_outbit_b: 'Select OUT bit for B input<br>%0000_0100_000_0000000000000_00_00000_0',
    p_minus3_b: 'Select pin-3 for B input<br>%0000_0101_000_0000000000000_00_00000_0',
    p_minus2_b: 'Select pin-2 for B input<br>%0000_0110_000_0000000000000_00_00000_0',
    p_minus1_b: 'Select pin-1 for B input<br>%0000_0111_000_0000000000000_00_00000_0',
    // - A,B Input Selection
    p_pass_ab: 'Select A, B<br>%0000_0000_000_0000000000000_00_00000_0',
    p_and_ab: 'Select A & B, B<br>%0000_0000_001_0000000000000_00_00000_0',
    p_or_ab: 'Select A | B, B<br>%0000_0000_010_0000000000000_00_00000_0',
    p_xor_ab: 'Select A ^ B, B<br>%0000_0000_011_0000000000000_00_00000_0',
    p_filt0_ab: 'Select FILT0 settings for A, B<br>%0000_0000_100_0000000000000_00_00000_0',
    p_filt1_ab: 'Select FILT1 settings for A, B<br>%0000_0000_101_0000000000000_00_00000_0',
    p_filt2_ab: 'Select FILT2 settings for A, B<br>%0000_0000_110_0000000000000_00_00000_0',
    p_filt3_ab: 'Select FILT3 settings for A, B<br>%0000_0000_111_0000000000000_00_00000_0',
    // - Low Level Pin Modes
    p_logic_a: 'Logic level A → IN, output OUT<br>%0000_0000_000_0000000000000_00_00000_0',
    p_logic_a_fb: 'Logic level A → IN, output feedback<br>%0000_0000_000_0001000000000_00_00000_0',
    p_logic_b_fb: 'Logic level B → IN, output feedback<br>%0000_0000_000_0010000000000_00_00000_0',
    p_schmitt_a: 'Schmitt trigger A → IN, output OUT<br>%0000_0000_000_0011000000000_00_00000_0',
    p_schmitt_a_fb: 'Schmitt trigger A → IN, output feedback<br>%0000_0000_000_0100000000000_00_00000_0',
    p_schmitt_b_fb: 'Schmitt trigger B → IN, output feedback<br>%0000_0000_000_0101000000000_00_00000_0',
    p_compare_ab: 'A > B → IN, output OUT<br>%0000_0000_000_0110000000000_00_00000_0',
    p_compare_ab_fb: 'A > B → IN, output feedback<br>%0000_0000_000_0111000000000_00_00000_0',
    // - ADC Input Modes
    p_adc_gio: 'ADC GIO → IN, output OUT<br>%0000_0000_000_1000000000000_00_00000_0',
    p_adc_vio: 'ADC VIO → IN, output OUT<br>%0000_0000_000_1000010000000_00_00000_0',
    p_adc_float: 'ADC FLOAT → IN, output OUT<br>%0000_0000_000_1000100000000_00_00000_0',
    p_adc_1x: 'ADC 1x → IN, output OUT<br>%0000_0000_000_1000110000000_00_00000_0',
    p_adc_3x: 'ADC 3.16x → IN, output OUT<br>%0000_0000_000_1001000000000_00_00000_0',
    p_adc_10x: 'ADC 10x → IN, output OUT<br>%0000_0000_000_1001010000000_00_00000_0',
    p_adc_30x: 'ADC 31.6x → IN, output OUT<br>%0000_0000_000_1001100000000_00_00000_0',
    p_adc_100x: 'ADC 100x → IN, output OUT<br>%0000_0000_000_1001110000000_00_00000_0',
    // - DAC Output Modes
    p_dac_990r_3v: 'DAC 990Ω, 3.3V peak, ADC 1x → IN<br>%0000_0000_000_1010000000000_00_00000_0',
    p_dac_600r_2v: 'DAC 600Ω, 2.0V peak, ADC 1x → IN<br>%0000_0000_000_1010100000000_00_00000_0',
    p_dac_124r_3v: 'DAC 123.75Ω, 3.3V peak, ADC 1x → IN<br>%0000_0000_000_1011000000000_00_00000_0',
    p_dac_75r_2v: 'DAC 75Ω, 2.0V peak, ADC 1x → IN<br>%0000_0000_000_1011100000000_00_00000_0',
    // - Level-Comparison Modes
    p_level_a: 'A > Level → IN, output OUT<br>%0000_0000_000_1100000000000_00_00000_0',
    p_level_a_fbn: 'A > Level → IN, output negative feedback<br>%0000_0000_000_1101000000000_00_00000_0',
    p_level_b_fbp: 'B > Level → IN, output positive feedback<br>%0000_0000_000_1110000000000_00_00000_0',
    p_level_b_fbn: 'B > Level → IN, output negative feedback<br>%0000_0000_000_1111000000000_00_00000_0',
    // - Low-Level Pin Sub-Modes: Sync Mode
    p_async_io: 'Select asynchronous I/O<br>%0000_0000_000_0000000000000_00_00000_0',
    p_sync_io: 'Select synchronous I/O<br>%0000_0000_000_0000100000000_00_00000_0',
    // - Low-Level Pin Sub-Modes: IN Polarity
    p_true_in: 'True IN bit<br>%0000_0000_000_0000000000000_00_00000_0',
    p_invert_in: 'Invert IN bit<br>%0000_0000_000_0000010000000_00_00000_0',
    // - Low-Level Pin Sub-Modes: Output Polarity
    p_true_out: 'Select true output (a.k.a. P_TRUE_OUTPUT)<br>%0000_0000_000_0000000000000_00_00000_0',
    p_true_output: 'Select true output<br>%0000_0000_000_0000000000000_00_00000_0',
    p_invert_out: 'Select inverted output (a.k.a.  P_INVERT_OUTPUT)<br>0000_0000_000_0000001000000_00_00000_0',
    p_invert_output: 'Select inverted output<br>0000_0000_000_0000001000000_00_00000_0',
    // - Low-Level Pin Sub-Modes: Drive-High Strength
    p_high_fast: 'Drive high fast (30mA)<br>%0000_0000_000_0000000000000_00_00000_0',
    p_high_1k5: 'Drive high 1.5kΩ<br>%0000_0000_000_0000000001000_00_00000_0',
    p_high_15k: 'Drive high 15kΩ<br>%0000_0000_000_0000000010000_00_00000_0',
    p_high_150k: 'Drive high 150kΩ<br>%0000_0000_000_0000000011000_00_00000_0',
    p_high_1ma: 'Drive high 1mA<br>%0000_0000_000_0000000100000_00_00000_0',
    p_high_100ua: 'Drive high 100μA<br>%0000_0000_000_0000000101000_00_00000_0',
    p_high_10ua: 'Drive high 10μA<br>%0000_0000_000_0000000110000_00_00000_0',
    p_high_float: 'Float high<br>%0000_0000_000_0000000111000_00_00000_0',
    // - Low-Level Pin Sub-Modes: Drive-Low Strength
    p_low_fast: 'Drive low fast (30mA)<br>%0000_0000_000_0000000000000_00_00000_0',
    p_low_1k5: 'Drive low 1.5kΩ<br>%0000_0000_000_0000000000001_00_00000_0',
    p_low_15k: 'Drive low 15kΩ<br>%0000_0000_000_0000000000010_00_00000_0',
    p_low_150k: 'Drive low 150kΩ<br>%0000_0000_000_0000000000011_00_00000_0',
    p_low_1ma: 'Drive low 1mA<br>%0000_0000_000_0000000000100_00_00000_0',
    p_low_100ua: 'Drive low 100μA<br>%0000_0000_000_0000000000101_00_00000_0',
    p_low_10ua: 'Drive low 10μA<br>%0000_0000_000_0000000000110_00_00000_0',
    p_low_float: 'Float low<br>%0000_0000_000_0000000000111_00_00000_0',
    // - DIR/OUT Control
    p_tt_00: 'TT = %00<br>%0000_0000_000_0000000000000_00_00000_0',
    p_tt_01: 'TT = %01<br>%0000_0000_000_0000000000000_01_00000_0',
    p_tt_10: 'TT = %10<br>%0000_0000_000_0000000000000_10_00000_0',
    p_tt_11: 'TT = %11<br>%0000_0000_000_0000000000000_11_00000_0',
    p_oe: 'Enable output in smart pin mode<br>%0000_0000_000_0000000000000_01_00000_0',
    p_channel: 'Enable DAC channel in non-smart pin DAC mode<br>%0000_0000_000_0000000000000_01_00000_0',
    p_bitdac: 'Enable BITDAC for non-smart pin DAC mode<br>%0000_0000_000_0000000000000_10_00000_0',
    // - Smart Pin Modes
    p_normal: 'Normal mode (not smart pin mode)<br>%0000_0000_000_0000000000000_00_00000_0',
    p_repository: 'Long repository (non-DAC mode)<br>%0000_0000_000_0000000000000_00_00001_0',
    p_dac_noise: 'DAC Noise (DAC mode)<br>%0000_0000_000_0000000000000_00_00001_0',
    p_dac_dither_rnd: 'DAC 16-bit random dither (DAC mode)<br>%0000_0000_000_0000000000000_00_00010_0',
    p_dac_dither_pwm: 'DAC 16-bit PWM dither (DAC mode)<br>%0000_0000_000_0000000000000_00_00011_0',
    p_pulse: 'Pulse/cycle output<br>%0000_0000_000_0000000000000_00_00100_0',
    p_transition: 'Transition output<br>%0000_0000_000_0000000000000_00_00101_0',
    p_nco_freq: 'NCO frequency output<br>%0000_0000_000_0000000000000_00_00110_0',
    p_nco_duty: 'NCO duty output<br>%0000_0000_000_0000000000000_00_00111_0',
    p_pwm_triangle: 'PWM triangle output<br>%0000_0000_000_0000000000000_00_01000_0',
    p_pwm_sawtooth: 'PWM sawtooth output<br>%0000_0000_000_0000000000000_00_01001_0',
    p_pwm_smps: 'PWM switch-mode power supply I/O<br>%0000_0000_000_0000000000000_00_01010_0',
    p_quadrature: 'A-B quadrature encoder input<br>%0000_0000_000_0000000000000_00_01011_0',
    p_reg_up: 'Inc on A-rise when B-high<br>%0000_0000_000_0000000000000_00_01100_0',
    p_reg_up_down: 'Inc on A-rise when B-high, dec on A-rise when B-low<br>%0000_0000_000_0000000000000_00_01101_0',
    p_count_rises: 'Inc on A-rise, optionally dec on B-rise<br>%0000_0000_000_0000000000000_00_01110_0',
    p_count_highs: 'Inc on A-high, optionally dec on B-high<br>%0000_0000_000_0000000000000_00_01111_0',
    p_state_ticks: 'For A-low and A-high states, count ticks<br>%0000_0000_000_0000000000000_00_10000_0',
    p_high_ticks: 'For A-high states, count ticks<br>%0000_0000_000_0000000000000_00_10001_0',
    p_events_ticks: 'For X A-highs/rises/edges, count ticks / Timeout on X ticks of no A-high/rise/edge<br>%0000_0000_000_0000000000000_00_10010_0',
    p_periods_ticks: 'For X periods of A, count ticks<br>%0000_0000_000_0000000000000_00_10011_0',
    p_periods_highs: 'For X periods of A, count highs<br>%0000_0000_000_0000000000000_00_10100_0',
    p_counter_ticks: 'For periods of A in X+ ticks, count ticks<br>%0000_0000_000_0000000000000_00_10101_0',
    p_counter_highs: 'For periods of A in X+ ticks, count highs<br>%0000_0000_000_0000000000000_00_10110_0',
    p_counter_periods: 'For periods of A in X+ ticks, count periods<br>%0000_0000_000_0000000000000_00_10111_0',
    p_adc: 'ADC sample/filter/capture, internally clocked<br>%0000_0000_000_0000000000000_00_11000_0',
    p_adc_ext: 'ADC sample/filter/capture, externally clocked<br>%0000_0000_000_0000000000000_00_11001_0',
    p_adc_scope: 'ADC scope with trigger<br>%0000_0000_000_0000000000000_00_11010_0',
    p_usb_pair: 'USB pin pair<br>%0000_0000_000_0000000000000_00_11011_0',
    p_sync_tx: 'Synchronous serial transmit<br>%0000_0000_000_0000000000000_00_11100_0',
    p_sync_rx: 'Synchronous serial receive<br>%0000_0000_000_0000000000000_00_11101_0',
    p_async_tx: 'Asynchronous serial transmit<br>%0000_0000_000_0000000000000_00_11110_0',
    p_async_rx: 'Asynchronous serial receive<br>%0000_0000_000_0000000000000_00_11111_0'
  };

  private _tableEventNames: { [Identifier: string]: string } = {
    // event names
    event_atn: '(14) event Attention-requested from another COG',
    event_ct1: '(01) event CT-passed-CT1',
    event_ct2: '(02) event CT-passed-CT2',
    event_ct3: '(03) event CT-passed-CT3',
    event_fbw: '(09) event Hub FIFO block-wrap',
    event_int: '(00) event Interrupt-occurred',
    int_off: '(00) interrupts off',
    event_pat: '(08) INA/INB pattern match/mismatch',
    event_qmt: '(15) event GETQX/GETQY-on-empty',
    event_se1: '(04) event Selectable event 1',
    event_se2: '(05) event Selectable event 2',
    event_se3: '(06) event Selectable event 3',
    event_se4: '(07) event Selectable event 4',
    event_xfi: '(11) event Streamer command-finished',
    event_xmt: '(10) event Streamer command-empty',
    event_xrl: '(13) event Streamer-read-last-LUT-location',
    event_xro: '(12) event Streamer NCO-rollover'
  };

  public isBuiltInSmartPinReservedWord(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const reservedStatus: boolean = nameKey in this._tableSmartPinNames;
    return reservedStatus;
  }

  public isBuiltinStreamerReservedWord(name: string): boolean {
    // streamer constants, smart-pin constants
    const builtinNamesOfNote: string[] = [
      // streamer names
      'x_16p_2dac8_wfword',
      'x_16p_4dac4_wfword',
      'x_1adc8_0p_1dac8_wfbyte',
      'x_1adc8_8p_2dac8_wfword',
      'x_1p_1dac1_wfbyte',
      'x_2adc8_0p_2dac8_wfword',
      'x_2adc8_16p_4dac8_wflong',
      'x_2p_1dac2_wfbyte',
      'x_2p_2dac1_wfbyte',
      'x_32p_4dac8_wflong',
      'x_4adc8_0p_4dac8_wflong',
      'x_4p_1dac4_wfbyte',
      'x_4p_2dac2_wfbyte',
      'x_4p_4dac1_wfbyte',
      'x_8p_1dac8_wfbyte',
      'x_8p_2dac4_wfbyte',
      'x_8p_4dac2_wfbyte',
      'x_alt_off',
      'x_alt_on',
      'x_dacs_0n0_0n0',
      'x_dacs_0n0_x_x',
      'x_dacs_0_0_0_0',
      'x_dacs_0_0_x_x',
      'x_dacs_0_x_x_x',
      'x_dacs_1n1_0n0',
      'x_dacs_1_0_1_0',
      'x_dacs_1_0_x_x',
      'x_dacs_3_2_1_0',
      'x_dacs_off',
      'x_dacs_x_0_x_x',
      'x_dacs_x_x_0n0',
      'x_dacs_x_x_0_0',
      'x_dacs_x_x_0_x',
      'x_dacs_x_x_1_0',
      'x_dacs_x_x_x_0',
      'x_dds_goertzel_sinc1',
      'x_dds_goertzel_sinc2',
      'x_imm_16x2_1dac2',
      'x_imm_16x2_2dac1',
      'x_imm_16x2_lut',
      'x_imm_1x32_4dac8',
      'x_imm_2x16_2dac8',
      'x_imm_2x16_4dac4',
      'x_imm_32x1_1dac1',
      'x_imm_32x1_lut',
      'x_imm_4x8_1dac8',
      'x_imm_4x8_2dac4',
      'x_imm_4x8_4dac2',
      'x_imm_4x8_lut',
      'x_imm_8x4_1dac4',
      'x_imm_8x4_2dac2',
      'x_imm_8x4_4dac1',
      'x_imm_8x4_lut',
      'x_pins_off',
      'x_pins_on',
      'x_rfbyte_1p_1dac1',
      'x_rfbyte_2p_1dac2',
      'x_rfbyte_2p_2dac1',
      'x_rfbyte_4p_1dac4',
      'x_rfbyte_4p_2dac2',
      'x_rfbyte_4p_4dac1',
      'x_rfbyte_8p_1dac8',
      'x_rfbyte_8p_2dac4',
      'x_rfbyte_8p_4dac2',
      'x_rfbyte_luma8',
      'x_rfbyte_rgb8',
      'x_rfbyte_rgbi8',
      'x_rflong_16x2_lut',
      'x_rflong_32p_4dac8',
      'x_rflong_32x1_lut',
      'x_rflong_4x8_lut',
      'x_rflong_8x4_lut',
      'x_rflong_rgb24',
      'x_rfword_16p_2dac8',
      'x_rfword_16p_4dac4',
      'x_rfword_rgb16',
      'x_write_off',
      'x_write_on'
    ];
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = builtinNamesOfNote.indexOf(nameKey) != -1;
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSmartPinNames;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableEventNames;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpinCogRegisters;
    }
    return reservedStatus;
  }

  // -------------------------------------------------------------------------
  // keyword checks
  private _tableDebugMethodsString: { [Identifier: string]: TMethodTuple } = {
    zstr: ['ZSTR(hub_pointer)', 'Output zero-terminated string found at hub_pointer', ['hub_pointer - address of zero-terminated string in HUB RAM']],
    lstr: [
      'LSTR(hub_pointer,byteCount)',
      "Output 'byteCount' characters found at hub_pointer",
      ['hub_pointer - address of bytes in HUB RAM', 'byteCount - number of bytes at location in HUB RAM']
    ]
  };

  private _tableDebugMethodsBool_v44: { [Identifier: string]: TMethodTuple } = {
    bool: ['BOOL(value)', 'Output "TRUE" if value is not 0 or "FALSE" if 0.', ['value - zero or non-zero value']]
  };

  private _tableDebugMethodsBool_v46: { [Identifier: string]: string[] } = {
    c_z: ['C_Z', 'Output the C and Z flags as "C=? Z=?". Useful in PASM code.']
  };

  private _tableDebugMethodsUnsignedDec: { [Identifier: string]: TMethodTuple } = {
    udec: ['UDEC(value)', 'Output as auto-sized unsigned decimal value (0 - 4_294_967_295)', ['value - BYTE, WORD or LONG value']],
    udec_byte: ['UDEC_BYTE(byteValue)', 'Output BYTE as unsigned decimal value (0 - 255)', ['byteValue - 8-bit value']],
    udec_word: ['UDEC_WORD(wordValue)', 'Output WORD as unsigned decimal value (0 - 65_535)', ['wordValue - 16-bit value']],
    udec_long: ['UDEC_LONG(longValue)', 'Output LONG as unsigned decimal value (0 - 4_294_967_295)', ['longValue - 32-bit value']],
    udec_reg_array: [
      'UDEC_REG_ARRAY(reg_pointer, size)',
      'Output register array as unsigned decimal values (0 - 4_294_967_295)',
      ['reg_pointer - address of array of COG registers', 'size - count of registers in array']
    ],
    udec_byte_array: [
      'UDEC_BYTE_ARRAY(hub_pointer, size)',
      'Output hub BYTE array as unsigned decimal values (0 - 255)',
      ['hub_pointer - address of array of BYTEs in HUB ram', 'size - count of BYTEs in array']
    ],
    udec_word_array: [
      'UDEC_WORD_ARRAY(hub_pointer, size)',
      'Output hub WORD array as unsigned decimal value (0 - 65_535)',
      ['hub_pointer - address of array of WORDs in HUB ram', 'size - count of WORDs in array']
    ],
    udec_long_array: [
      'UDEC_LONG_ARRAY(hub_pointer, size)',
      'Output hub LONG array as unsigned decimal value (0 - 4_294_967_295)',
      ['hub_pointer - address of array of LONGs in HUB ram', 'size - count of LONGs in array']
    ]
  };

  private _tableDebugMethodsSignedDec: { [Identifier: string]: TMethodTuple } = {
    sdec: ['SDEC(value)', 'Output as auto-sized signed decimal value (-2_147_483_648 - 2_147_483_647)', ['value - BYTE, WORD or LONG value']],
    sdec_byte: ['SDEC_BYTE(byteValue)', 'Output BYTE as signed decimal value (-128 - 127)', ['byteValue - 8-bit value']],
    sdec_word: ['SDEC_WORD(wordValue)', 'Output WORD as signed decimal value (-32_768 - 65_535)', ['wordValue - 16-bit value']],
    sdec_long: ['SDEC_LONG(longValue)', 'Output LONG as signed decimal value (-2_147_483_648 - 2_147_483_647)', ['longValue - 32-bit value']],
    sdec_reg_array: [
      'SDEC_REG_ARRAY(reg_pointer, size)',
      'Output COG register array as signed decimal values (-2_147_483_648 - 2_147_483_647)',
      ['reg_pointer - address of array of COG registers', 'size - count of registers in array']
    ],
    sdec_byte_array: [
      'SDEC_BYTE_ARRAY(hub_pointer, size)',
      'Output hub BYTE array as signed decimal values (-128 - 127)',
      ['hub_pointer - address of array of BYTEs in HUB ram', 'size - count of BYTEs in array']
    ],
    sdec_word_array: [
      'SDEC_WORD_ARRAY(hub_pointer, size)',
      'Output hub WORD array as signed decimal value (-32_768 - 32_767)',
      ['hub_pointer - address of array of WORDs in HUB ram', 'size - count of WORDs in array']
    ],
    sdec_long_array: [
      'SDEC_LONG_ARRAY(hub_pointer, size)',
      'Output hub LONG array as signed decimal value (-2_147_483_648 - 2_147_483_647)',
      ['hub_pointer - address of array of LONGs in HUB ram', 'size - count of LONGs in array']
    ]
  };

  private _tableDebugMethodsUnsignedHex: { [Identifier: string]: TMethodTuple } = {
    uhex: ['UHEX(value)', 'Output as auto-sized unsigned hex value ($0 - $FFFF_FFFF)', ['value - BYTE, WORD or LONG value']],
    uhex_byte: ['UHEX_BYTE(byteValue)', 'Output BYTE as unsigned hex value ($00 - $FF)', ['byteValue - 8-bit value']],
    uhex_word: ['UHEX_WORD(wordValue)', 'Output WORD as unsigned hex value ($0000 - $FFFF)', ['wordValue - 16-bit value']],
    uhex_long: ['UHEX_LONG(longValue)', 'Output LONG as unsigned hex value ($0000_0000 - $FFFF_FFFF)', ['longValue - 32-bit value']],
    uhex_reg_array: [
      'UHEX_REG_ARRAY(reg_pointer, size)',
      'Output register array as unsigned hex values ($0000_0000 - $FFFF_FFFF)',
      ['reg_pointer - address of array of COG registers', 'size - count of registers in array']
    ],
    uhex_byte_array: [
      'UHEX_BYTE_ARRAY(hub_pointer, size)',
      'Output hub BYTE array as unsigned hex values ($00 - $FF)',
      ['hub_pointer - address of array of BYTEs in HUB ram', 'size - count of BYTEs in array']
    ],
    uhex_word_array: [
      'UHEX_WORD_ARRAY(hub_pointer, size)',
      'Output hub WORD array as unsigned hex values ($0000 - $FFFF)',
      ['hub_pointer - address of array of WORDs in HUB ram', 'size - count of WORDs in array']
    ],
    uhex_long_array: [
      'UHEX_LONG_ARRAY(hub_pointer, size)',
      'Output hub LONG array as unsigned hex values ($0000_0000 - $FFFF_FFFF)',
      ['hub_pointer - address of array of LONGs in HUB ram', 'size - count of LONGs in array']
    ]
  };

  private _tableDebugMethodsSignedHex: { [Identifier: string]: TMethodTuple } = {
    shex: ['SHEX(value)', 'Output as auto-sized signed hex value (-$8000_0000 - $7FFF_FFFF)', ['value - BYTE, WORD or LONG value']],
    shex_byte: ['SHEX_BYTE(byteValue)', 'Output BYTE as signed hex value (-$80 - $7F)', ['byteValue - 8-bit value']],
    shex_word: ['SHEX_WORD(wordValue)', 'Output WORD as signed hex value (-$8000 - $7FFF)', ['wordValue - 16-bit value']],
    shex_long: ['SHEX_LONG(longValue)', 'Output LONG as signed hex value (-$8000_0000 - $7FFF_FFFF)', ['longValue - 32-bit value']],
    shex_reg_array: [
      'SHEX_REG_ARRAY(reg_pointer, size)',
      'Output register array as signed hex values (-$8000_0000 - $7FFF_FFFF)',
      ['reg_pointer - address of array of COG registers', 'size - count of registers in array']
    ],
    shex_byte_array: [
      'SHEX_BYTE_ARRAY(hub_pointer, size)',
      'Output hub BYTE array as signed hex values (-$80 - $7F)',
      ['hub_pointer - address of array of BYTEs in HUB ram', 'size - count of BYTEs in array']
    ],
    shex_word_array: [
      'SHEX_WORD_ARRAY(hub_pointer, size)',
      'Output hub WORD array as signed hex values (-$8000 - $7FFF)',
      ['hub_pointer - address of array of WORDs in HUB ram', 'size - count of WORDs in array']
    ],
    shex_long_array: [
      'SHEX_LONG_ARRAY(hub_pointer, size)',
      'Output hub LONG array as signed hex values (-$8000_0000 - $7FFF_FFFF)',
      ['hub_pointer - address of array of LONGs in HUB ram', 'size - count of LONGs in array']
    ]
  };

  private _tableDebugMethodsUnsignedBin: { [Identifier: string]: TMethodTuple } = {
    ubin: ['UBIN(value)', 'Output as auto-sized unsigned binary value', ['value - BYTE, WORD or LONG value']],
    ubin_byte: ['UBIN_BYTE(byteValue)', 'Output BYTE as unsigned binary value', ['byteValue - 8-bit value']],
    ubin_word: ['UBIN_WORD(wordValue)', 'Output WORD as unsigned binary value', ['wordValue - 16-bit value']],
    ubin_long: ['UBIN_LONG(longValue)', 'Output LONG as unsigned binary value', ['longValue - 32-bit value']],
    ubin_reg_array: [
      'UBIN_REG_ARRAY(reg_pointer, size)',
      'Output register array as unsigned binary values',
      ['reg_pointer - address of array of COG registers', 'size - count of registers in array']
    ],
    ubin_byte_array: [
      'UBIN_BYTE_ARRAY(hub_pointer, size)',
      'Output hub BYTE array as unsigned binary values',
      ['hub_pointer - address of array of BYTEs in HUB ram', 'size - count of BYTEs in array']
    ],
    ubin_word_array: [
      'UBIN_WORD_ARRAY(hub_pointer, size)',
      'Output hub WORD array as unsigned binary values',
      ['hub_pointer - address of array of WORDs in HUB ram', 'size - count of WORDs in array']
    ],
    ubin_long_array: [
      'UBIN_LONG_ARRAY(hub_pointer, size)',
      'Output hub LONG array as unsigned binary values',
      ['hub_pointer - address of array of LONGs in HUB ram', 'size - count of LONGs in array']
    ]
  };

  private _tableDebugMethodsSignedBin: { [Identifier: string]: TMethodTuple } = {
    sbin: ['SBIN(value)', 'Output as auto-sized signed binary value', ['value - BYTE, WORD or LONG value']],
    sbin_byte: ['SBIN_BYTE(byteValue)', 'Output BYTE as signed binary value', ['byteValue - 8-bit value']],
    sbin_word: ['SBIN_WORD(wordValue)', 'Output WORD as signed binary value', ['wordValue - 16-bit value']],
    sbin_long: ['SBIN_LONG(longValue)', 'Output LONG as signed binary value', ['longValue - 32-bit value']],
    sbin_reg_array: [
      'SBIN_REG_ARRAY(reg_pointer, size)',
      'Output register array as signed binary values',
      ['reg_pointer - address of array of COG registers', 'size - count of registers in array']
    ],
    sbin_byte_array: [
      'SBIN_BYTE_ARRAY(hub_pointer, size)',
      'Output hub BYTE array as signed binary values',
      ['hub_pointer - address of array of BYTEs in HUB ram', 'size - count of BYTEs in array']
    ],
    sbin_word_array: [
      'SBIN_WORD_ARRAY(hub_pointer, size)',
      'Output hub WORD array as signed binary values',
      ['hub_pointer - address of array of WORDs in HUB ram', 'size - count of WORDs in array']
    ],
    sbin_long_array: [
      'SBIN_LONGARRAY(hub_pointer, size)',
      'Output hub LONG array as signed binary values',
      ['hub_pointer - address of array of LONGs in HUB ram', 'size - count of LONGs in array']
    ]
  };

  private _tableDebugMethodsFloat: { [Identifier: string]: TMethodTuple } = {
    fdec: ['FDEC(value)', 'Output floating-point value (-3.4e+38 - 3.4e+38)', ['value - float 32-bit value']],
    fdec_array: [
      'FDEC_ARRAY(hub_pointer, size)',
      'Output hub long array as floating-point values (-3.4e+38 - 3.4e+38)',
      ['hub_pointer - address of long array in HUB ram', 'size - count of longs in the array']
    ],
    fdec_reg_array: [
      'FDEC_REG_ARRAY(reg_pointer, size)',
      'Output register array as floating-point values (-3.4e+38 - 3.4e+38)',
      ['reg_pointer - address of register array in COG ram', 'size - count of registers in the array']
    ]
  };

  private _tableDebugMethodsMisc: { [Identifier: string]: TMethodTuple } = {
    dly: [
      'DLY(milliseconds)',
      'Delay for some milliseconds to slow down continuous message outputs for this cog',
      ["milliseconds - number of 1/1_000's of seconds to delay"]
    ],
    pc_key: [
      'PC_KEY(pointer_to_long)',
      'FOR USE IN GRAPHICAL DEBUG() DISPLAYS - Must be the last command in a DEBUG() statement<br>Returns any new host-PC keypress that occurred within the last 100ms into a long inside the chip<br>The DEBUG() Display must have focus for keypresses to be noticed',
      ['pointer_to_long - address to long to receive the pressed key-value']
    ],
    pc_mouse: [
      'PC_MOUSE(pointer_to_7_longs)',
      'FOR USE IN GRAPHICAL DEBUG DISPLAYS - Must be the last command in a DEBUG() statement<br>Returns the current host-PC mouse status into a 7-long structure inside the chip',
      ['pointer_to_7_longs - address of the 7-long structure to receive the mouse status']
    ]
  };

  private _tableDebugMethodsConditionals: { [Identifier: string]: string[] } = {
    if: [
      'IF(condition)',
      'If condition <> 0 then continue at the next command within the DEBUG() statement, else skip all remaining commands and output CR+LF.'
    ],
    ifnot: [
      'IFNOT(condition)',
      'If condition = 0 then continue at the next command within the DEBUG() statement, else skip all remaining commands and output CR+LF.'
    ]
  };

  public isNewlyAddedDebugSymbol(name: string): boolean {
    const bIsUnderscoreSuffix: boolean = name.endsWith('_') ? true : false;
    const nameKey: string = bIsUnderscoreSuffix ? name.substring(0, name.length - 1).toLowerCase() : name.toLowerCase();
    let reservedStatus: boolean = false;
    if (this.requestedSpinVersion(44)) {
      // if {Spin2_v44} or greater then also search this table
      reservedStatus = nameKey in this._tableDebugMethodsBool_v44;
    }
    if (!reservedStatus && this.requestedSpinVersion(46)) {
      // if {Spin2_v46} or greater then also search this table
      reservedStatus = nameKey in this._tableDebugMethodsBool_v46;
    }
    return reservedStatus;
  }

  public isDebugMethod(name: string): boolean {
    const bIsUnderscoreSuffix: boolean = name.endsWith('_') ? true : false;
    const nameKey: string = bIsUnderscoreSuffix ? name.substring(0, name.length - 1).toLowerCase() : name.toLowerCase();
    let reservedStatus: boolean = nameKey in this._tableDebugMethodsString;
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableDebugMethodsUnsignedDec;
    }
    if (!reservedStatus && this.requestedSpinVersion(44)) {
      // if {Spin2_v44} or greater then also search this table
      reservedStatus = nameKey in this._tableDebugMethodsBool_v44;
    }
    if (!reservedStatus && this.requestedSpinVersion(46)) {
      // if {Spin2_v46} or greater then also search this table
      reservedStatus = nameKey in this._tableDebugMethodsBool_v46;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableDebugMethodsSignedDec;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableDebugMethodsUnsignedHex;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableDebugMethodsSignedHex;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableDebugMethodsUnsignedBin;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableDebugMethodsSignedBin;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableDebugMethodsFloat;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableDebugMethodsMisc;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableDebugMethodsConditionals;
    }
    return reservedStatus;
  }

  private _docTextForSpinDebugBuiltInMethod(name: string): IBuiltinDescription {
    const bIsUnderscoreSuffix: boolean = name.endsWith('_') ? true : false;
    // remove triling underscore
    const nameKey: string = bIsUnderscoreSuffix ? name.substring(0, name.length - 1).toLowerCase() : name.toLowerCase();
    const desiredDocText: IBuiltinDescription = {
      found: false,
      type: eBuiltInType.Unknown,
      category: '',
      description: '',
      signature: ''
    };
    let bSupportsSuffix: boolean = true;
    if (this.isDebugMethod(name)) {
      desiredDocText.found = true;
      let protoWDescr: string[] = [];
      let methodDescr: TMethodTuple = ['', '', []];
      if (nameKey in this._tableDebugMethodsString) {
        desiredDocText.category = 'String Output';
        methodDescr = this._tableDebugMethodsString[nameKey];
      } else if (nameKey in this._tableDebugMethodsUnsignedDec) {
        desiredDocText.category = 'Unsigned Decimal Output';
        methodDescr = this._tableDebugMethodsUnsignedDec[nameKey];
      } else if (this.requestedSpinVersion(44) && nameKey in this._tableDebugMethodsBool_v44) {
        // if {Spin2_v44} or greater then also search this table
        desiredDocText.category = 'Boolean Output';
        methodDescr = this._tableDebugMethodsBool_v44[nameKey];
      } else if (this.requestedSpinVersion(46) && nameKey in this._tableDebugMethodsBool_v46) {
        // if {Spin2_v46} or greater then also search this table
        desiredDocText.category = 'FLAGs Output';
        protoWDescr = this._tableDebugMethodsBool_v46[nameKey];
      } else if (this.requestedSpinVersion(46) && nameKey in this._tableDebugMaskInvoke_v46) {
        // if {Spin2_v46} or greater then also search this table
        desiredDocText.category = 'DEBUG output Conditionally compiled';
        methodDescr = this._tableDebugMaskInvoke_v46[nameKey];
      } else if (nameKey in this._tableDebugMethodsSignedDec) {
        desiredDocText.category = 'Signed Decimal Output';
        methodDescr = this._tableDebugMethodsSignedDec[nameKey];
      } else if (nameKey in this._tableDebugMethodsUnsignedHex) {
        desiredDocText.category = 'Unsigned Hexedecimal Output';
        methodDescr = this._tableDebugMethodsUnsignedHex[nameKey];
      } else if (nameKey in this._tableDebugMethodsSignedHex) {
        desiredDocText.category = 'Signed Hexedecimal Output';
        methodDescr = this._tableDebugMethodsSignedHex[nameKey];
      } else if (nameKey in this._tableDebugMethodsUnsignedBin) {
        desiredDocText.category = 'Unsigned Binary Output';
        methodDescr = this._tableDebugMethodsUnsignedBin[nameKey];
      } else if (nameKey in this._tableDebugMethodsSignedBin) {
        desiredDocText.category = 'Signed Binary Output';
        methodDescr = this._tableDebugMethodsSignedBin[nameKey];
      } else if (nameKey in this._tableDebugMethodsFloat) {
        desiredDocText.category = 'Floating Point Output';
        methodDescr = this._tableDebugMethodsFloat[nameKey];
      } else if (nameKey in this._tableDebugMethodsMisc) {
        bSupportsSuffix = false;
        desiredDocText.category = 'Miscellaneous';
        methodDescr = this._tableDebugMethodsMisc[nameKey];
      } else if (nameKey in this._tableDebugMethodsConditionals) {
        bSupportsSuffix = false;
        desiredDocText.category = 'Conditionals';
        protoWDescr = this._tableDebugMethodsConditionals[nameKey];
      }
      if (methodDescr[0].length > 0) {
        desiredDocText.signature = methodDescr[0];
        desiredDocText.description = methodDescr[1];
        if (methodDescr[2] && methodDescr[2].length > 0) {
          desiredDocText.parameters = methodDescr[2];
        }
        if (methodDescr[3] && methodDescr[3].length > 0) {
          desiredDocText.returns = methodDescr[3];
        }
      } else if (!bIsUnderscoreSuffix || (bIsUnderscoreSuffix && bSupportsSuffix)) {
        if (protoWDescr.length != 0) {
          desiredDocText.signature = protoWDescr[0];
          if (bIsUnderscoreSuffix) {
            desiredDocText.description = protoWDescr[1] + '<br>*(Trailing underscore: removes the variable name from the output)*'; // italics
          } else {
            desiredDocText.description = protoWDescr[1];
          }
        }
      } else {
        desiredDocText.signature = protoWDescr[0];
        desiredDocText.description = protoWDescr[1] + '<br>**(WARNING Underscore Suffix is NOT allowed)**'; // bold
      }
    }
    this._logMessage(`sp2u:  _docTextForSpinDebugBuiltInMethod(${nameKey}) -> [${JSON.stringify(desiredDocText, null, 2)}]`);
    return desiredDocText;
  }

  private _tableDebugInvokeSymbols: { [Identifier: string]: string } = {
    debug: "invoke this cog's PASM-level debugger",
    debug_main:
      "each cog's PASM-level debugger will initially be invoked when a COGINIT occurs, and it will be ready to single-step" +
      ' through main (non-interrupt) code. In this case, DEBUG commands will be ignored, until you select "DEBUG" sensitivity' +
      ' in the debugger. In this case, DEBUG commands will be ignored, until you select "DEBUG" sensitivity in the debugger.',
    debug_coginit: "each cog's PASM-level debugger will initially be invoked when a COGINIT occurs"
  };

  public isDebugInvocation(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const reservedStatus: boolean = nameKey in this._tableDebugInvokeSymbols;
    return reservedStatus;
  }

  private _tableDebugControlSymbols_v46: { [Identifier: string]: string } = {
    debug_mask:
      '(no default) Assigning a 32-bit mask value to this symbol allows individual DEBUG statements to be gated according' +
      ' to the state of a  particular mask bit. This is done by placing a mask bit number (0..31) in brackets, immediately' +
      ' after the DEBUG keyword and before any parameters: DEBUG[MaskBitNumber]{(parameters…)} . If the particular mask bit' +
      ' is high, the DEBUG will be compiled, otherwise it will be ignored.',
    debug_disable: '(no default) Assigning a non-0 value to this symbol will disable all DEBUG statements in the file/object.'
  };

  private _tableDebugMaskInvoke_v46: { [Identifier: string]: TMethodTuple } = {
    debug: [
      'DEBUG[bitPosition](...)',
      'Compile debug statement if the specified mask bit(s) are set in DEBUG_MASK',
      ['bitPosition - position of bit that must be set in DEBUG_MASK for this statement to be compiled']
    ]
  };

  private _tableDebugControlSymbols_v52: { [Identifier: string]: string } = {
    debug_end_session: '(27) Constant for use in DEBUG to end the debug session.'
  };

  private _tableDebugControlSymbols: { [Identifier: string]: string } = {
    download_baud: '(default 2_000_000)<br>Sets the download baud rate',
    debug_cogs: '(default %1111_1111)<br>Selects which cogs have debug interrupts enabled. Bits 7..0 enable debugging interrupts in cogs 7..0',
    debug_delay: '(default 0)<br>Sets a delay in milliseconds before your application runs and begins transmitting DEBUG messages',
    debug_pin_tx: '(default 62)<br>Sets the DEBUG serial output pin. For DEBUG windows to open, DEBUG_PIN must be 62',
    debug_pin_rx: '(default 63)<br>Sets the DEBUG serial input pin for interactivity with the host PC',
    debug_baud: '(default download_baud)<br>Sets the DEBUG baud rate. May be necessary to add DEBUG_DELAY if DEBUG_BAUD is less than DOWNLOAD_BAUD',
    debug_timestamp: 'By declaring this symbol, each DEBUG message will be time-stamped with the 64-bit CT value',
    debug_log_size:
      "(default 0)<br>Sets the maximum size in bytes of the 'DEBUG.log' file which will collect DEBUG messages. A value of 0 will inhibit log file generation",
    debug_left: 'Sets the left screen coordinate where the DEBUG message window will appear',
    debug_top: 'Sets the top screen coordinate where the DEBUG message window will appear',
    debug_width: 'Sets the width of the DEBUG message window',
    debug_height: 'Sets the height of the DEBUG message window',
    debug_display_left:
      "(default 0)<br>Sets the overall left screen offset where any DEBUG displays will appear (adds to 'POS' x coordinate in each DEBUG display)",
    debug_display_top:
      "(default 0)<br>Sets the overall top screen offset where any DEBUG displays will appear (adds to 'POS' y coordinate in each DEBUG display)",
    debug_windows_off: '(default 0)<br>Disables any DEBUG windows from opening after downloading, if set to a non-zero value'
  };

  public isDebugControlSymbol(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = nameKey in this._tableDebugControlSymbols;
    if (!reservedStatus && this.requestedSpinVersion(46)) {
      reservedStatus = nameKey in this._tableDebugControlSymbols_v46;
    }
    if (!reservedStatus && this.requestedSpinVersion(52)) {
      reservedStatus = nameKey in this._tableDebugControlSymbols_v52;
    }
    return reservedStatus;
  }

  private _docTextForSpinDebugBuiltInSymbols(name: string): IBuiltinDescription {
    const nameKey: string = name.toLowerCase();
    const desiredDocText: IBuiltinDescription = {
      found: false,
      type: eBuiltInType.Unknown,
      category: '',
      description: '',
      signature: ''
    };
    if (this.isDebugControlSymbol(nameKey)) {
      desiredDocText.found = true;
      //const protoWDescr: string[] = [];
      if (nameKey in this._tableDebugControlSymbols) {
        desiredDocText.category = 'Debug Symbol';
        desiredDocText.description = this._tableDebugControlSymbols[nameKey];
      } else if (this.requestedSpinVersion(46) && nameKey in this._tableDebugControlSymbols_v46) {
        desiredDocText.category = 'Debug Symbol';
        desiredDocText.description = this._tableDebugControlSymbols_v46[nameKey];
      } else if (this.requestedSpinVersion(52) && nameKey in this._tableDebugControlSymbols_v52) {
        desiredDocText.category = 'Debug Symbol';
        desiredDocText.description = this._tableDebugControlSymbols_v52[nameKey];
      }
    }
    return desiredDocText;
  }

  private _docTextForSpinXYZZYDebugBuiltInInvoke(name: string): IBuiltinDescription {
    //this._logMessage(`* _docTextForSpinDebugBuiltInInvoke([${name}])`);
    const nameKey: string = name.toLowerCase();
    const desiredDocText: IBuiltinDescription = {
      found: false,
      type: eBuiltInType.Unknown,
      category: '',
      description: '',
      signature: ''
    };
    if (this.isDebugInvocation(nameKey)) {
      desiredDocText.found = true;
      //const protoWDescr: string[] = [];
      if (nameKey in this._tableDebugInvokeSymbols) {
        desiredDocText.category = 'Debugger Invocation';
        desiredDocText.description = this._tableDebugInvokeSymbols[nameKey];
      }
    }
    this._logMessage(`* _docTextForSpinDebugBuiltInInvoke([${name}]) => [${JSON.stringify(desiredDocText, null, 2)}]`);
    return desiredDocText;
  }

  // operators
  // MAYBE??: add signature forms for all but last 3, logicals
  private _tableSpinBinaryOperators: { [Identifier: string]: string } = {
    sar: "Shift x right by y bits, insert MSB's",
    ror: 'Rotate x right by y bits',
    rol: 'Rotate x left by y bits',
    rev: 'Reverse order of bits 0..y of x and zero-extend',
    zerox: 'Zero-extend above bit y',
    signx: 'Sign-extend from bit y',
    sca: 'Unsigned scale, (x * y) >> 32',
    scas: 'Signed scale, (x * y) >> 30',
    frac: 'Unsigned fraction, (x << 32) / y',
    addbits: 'Make bitfield, (x & $1F) | (y & $1F) << 5',
    addpins: 'Make pinfield, (x & $3F) | (y & $1F) << 6',
    and: 'Logical AND (x <> 0 AND y <> 0, returns FALSE (0) or TRUE (-1))',
    or: 'Logical OR (x <> 0 OR y <> 0, returns FALSE (0) or TRUE (-1))',
    xor: 'Logical XOR (x <> 0 XOR y <> 0, returns FALSE (0) or TRUE (-1))'
  };
  // MAYBE??: add signature forms for all but last 3, logicals
  private _tableSpinBinaryOperators_v51: { [Identifier: string]: string } = {
    pow: 'Floating-point x-to-power-of-y function'
  };

  public isBinaryOperator(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = nameKey in this._tableSpinBinaryOperators;
    if (this.requestedSpinVersion(51) && nameKey in this._tableSpinBinaryOperators_v51) {
      reservedStatus = true;
    }
    return reservedStatus;
  }

  private _tableSpinUnaryOperators: { [Identifier: string]: string } = {
    not: 'Logical NOT (0 → -1, non-0 → 0)',
    abs: 'Absolute value',
    fabs: 'Floating-point absolute value (clears MSB)',
    encod: 'Encode MSB, 0..31',
    decod: 'Decode, 1 << (x & $1F)',
    bmask: 'Bitmask, (2 << (x & $1F)) - 1',
    ones: "Sum all '1' bits, 0..32",
    sqrt: 'Square root of unsigned value',
    fsqrt: 'Floating-point square root',
    qlog: "Unsigned value to logarithm {5'whole, 27'fraction}",
    qexp: 'Logarithm to unsigned value',
    field: 'Access bitfield of preceding value'
  };

  private _tableSpinUnaryOperators_v51: { [Identifier: string]: string } = {
    log: 'Floating-point natural logarithm function',
    log2: 'Floating-point base-2 logarithm function',
    log10: 'Floating-point base-10 logarithm function',
    exp: 'Floating-point e-to-power-of-x function',
    exp2: 'Floating-point 2-to-power-of-x function',
    exp10: 'Floating-point 10-to-power-of-x function'
  };

  public isUnaryOperator(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = nameKey in this._tableSpinUnaryOperators;
    if (this.requestedSpinVersion(51) && nameKey in this._tableSpinUnaryOperators_v51) {
      reservedStatus = true;
    }
    return reservedStatus;
  }

  public isFloatConversion(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const reservedStatus: boolean = nameKey in this._tableSpinFloatConversions;
    return reservedStatus;
  }

  private _tableSpinFloatConversions: { [Identifier: string]: TMethodTuple } = {
    float: [
      'FLOAT(x): floatValue',
      'Convert integer x to float',
      ['x - integer value to be converted'],
      ['floatValue - x-value represented as float']
    ],
    trunc: [
      'TRUNC(x): integerValue',
      'Convert float x to truncated integer',
      ['x - float value to be converted (remove all after decimal)'],
      ['integerValue - result of truncation operation']
    ],
    round: [
      'ROUND(x): integerValue',
      'Convert float x to rounded integer',
      ['x - float value to be converted (round to nearest integer)'],
      ['integerValue - result of rounding operation']
    ]
  };

  public isSpinReservedWord(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const spinInstructionsOfNote: string[] = [
      'reg',
      'field',
      'nan',
      'clkmode',
      'clkfreq',
      'varbase',
      'clkmode_',
      'clkfreq_',
      'if',
      'ifnot',
      'elseif',
      'elseifnot',
      'else',
      'while',
      'repeat',
      'with',
      'until',
      'from',
      'to',
      'step',
      'next',
      'quit',
      'case',
      'case_fast',
      'other',
      'abort',
      'return'
    ];
    let reservedStatus: boolean = spinInstructionsOfNote.indexOf(nameKey) != -1;
    if (reservedStatus == false) {
      reservedStatus = this.isBinaryOperator(name);
    }
    if (reservedStatus == false) {
      reservedStatus = this.isUnaryOperator(name);
    }
    if (reservedStatus == false) {
      reservedStatus = nameKey in this._tableSpinNumericSymbols;
    }
    if (reservedStatus == false) {
      reservedStatus = nameKey in this._tableSpinFloatConversions;
    }
    return reservedStatus;
  }

  public isSpinNumericSymbols(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const reservedStatus: boolean = nameKey in this._tableSpinNumericSymbols;
    return reservedStatus;
  }

  private _tableClockControlSymbols_v46: { [Identifier: string]: string } = {
    _autoclk: '_AUTOCLK = 0 prevents the clock setter code from being prepended. Code runs in RCFAST mode in this case.'
  };

  private _tableSpinNumericSymbols: { [Identifier: string]: string } = {
    false: '%0000_0000, Same as 0',
    true: '%FFFF_FFFF, Same as -1',
    negx: '%8000_0000, Negative-extreme integer, -2_147_483_648',
    posx: '%7FFF_FFFF, ositive-extreme integer, +2_147_483_647 ($7FFF_FFFF)',
    pi: '%4049_0FDB, Single-precision floating-point value of Pi, 3.14159265'
  };

  private _tableSpinCoginitSymbols: { [Identifier: string]: string } = {
    cogexec: '%00_0000, (default) Use "COGEXEC + CogNumber" to start a cog in cogexec mode',
    hubexec: '%10_0000, Use "HUBEXEC + CogNumber" to start a cog in hubexec mode',
    cogexec_new: '%01_0000, Starts an available cog in cogexec mode',
    hubexec_new: '%11_0000, Starts an available cog in hubexec mode',
    cogexec_new_pair: '%01_0001, Starts an available eve/odd pair of cogs in cogexec mode, useful for LUT sharing',
    hubexec_new_pair: '%11_0001, Starts an available eve/odd pair of cogs in hubexec mode, useful for LUT sharing'
  };

  private _tableSpinCogexecSymbols: { [Identifier: string]: string } = {
    newcog: '%01_0000, Starts an available cog'
  };

  private _tableSpinTaskSymbols_v47: { [Identifier: string]: string } = {
    newtask: '-1, Next available task. For use with TASKSPIN()',
    thistask: '-1, Current task. For use with TASKSTOP() and TASKHALT()'
  };

  private _tableSpinMethodPointerSymbols: { [Identifier: string]: TMethodTuple } = {
    send: [
      'SEND(userParam)',
      'SEND() is a special method pointer which is inherited from the calling method and, in turn, conveyed to all called methods. Must point to a method which takes one parameter and has no return values',
      ['userParam - single value or list of values passed to pointed to method']
    ],
    recv: [
      'RECV(): returnValue',
      'RECV(), like SEND(), is a special method pointer which is inherited from the calling method and, in turn, conveyed to all called methods. Must point to a method which takes no parameters and returns a single value',
      [],
      ['returnValue - single value returned from pointed to method']
    ]
  };

  public isSpinSpecialMethod(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const reservedStatus: boolean = nameKey in this._tableSpinMethodPointerSymbols;
    return reservedStatus;
  }

  public isSpinNoparenMethod(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = nameKey in this._tableSpinMethodPointerSymbols && nameKey == 'recv'; // recv of [send, recv]
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpinControlFlowMethods; // abort, return
    }
    return reservedStatus;
  }

  private _docTextForCogAndNumericSymbols(name: string): IBuiltinDescription {
    const nameKey: string = name.toLowerCase();
    const desiredDocText: IBuiltinDescription = {
      found: false,
      type: eBuiltInType.Unknown,
      category: '',
      description: '',
      signature: ''
    };
    let methodDescr: TMethodTuple = ['', '', []];
    if (this.isCoginitReservedSymbol(name)) {
      if (nameKey in this._tableSpinCoginitSymbols) {
        desiredDocText.category = 'Coginit';
        desiredDocText.description = this._tableSpinCoginitSymbols[nameKey];
      } else if (nameKey in this._tableSpinCogexecSymbols) {
        desiredDocText.category = 'Cogexec';
        desiredDocText.description = this._tableSpinCogexecSymbols[nameKey];
      }
    } else if (this.isTaskReservedSymbol(name) && this.requestedSpinVersion(47)) {
      desiredDocText.category = 'Task';
      desiredDocText.description = this._tableSpinTaskSymbols_v47[nameKey];
    } else if (nameKey in this._tableSpinNumericSymbols) {
      desiredDocText.category = 'Numeric';
      desiredDocText.description = this._tableSpinNumericSymbols[nameKey];
    } else if (nameKey in this._tableSpinMethodPointerSymbols) {
      desiredDocText.category = 'Method Pointer';
      methodDescr = this._tableSpinMethodPointerSymbols[nameKey];
    }
    if (methodDescr[0].length != 0) {
      desiredDocText.signature = methodDescr[0];
      desiredDocText.description = methodDescr[1];
      if (methodDescr[2] && methodDescr[2].length > 0) {
        desiredDocText.parameters = methodDescr[2];
      }
      if (methodDescr[3] && methodDescr[3].length > 0) {
        desiredDocText.returns = methodDescr[3];
      }
    }
    if (desiredDocText.category.length > 0) {
      desiredDocText.found = true;
    }
    return desiredDocText;
  }

  public isCoginitReservedSymbol(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = nameKey in this._tableSpinCoginitSymbols;
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpinCogexecSymbols;
    }
    return reservedStatus;
  }

  public isTaskReservedSymbol(name: string): boolean {
    let reservedStatus: boolean = false;
    if (this.requestedSpinVersion(47)) {
      const nameKey: string = name.toLowerCase();
      reservedStatus = nameKey in this._tableSpinTaskSymbols_v47;
    }
    return reservedStatus;
  }

  public isTaskReservedRegisterName(name: string): boolean {
    let reservedStatus: boolean = false;
    if (this.requestedSpinVersion(47)) {
      const nameKey: string = name.toLowerCase();
      reservedStatus = nameKey in this._tableSpinTaskRegisters_v47;
    }
    return reservedStatus;
  }

  public isP2AsmModczOperand(name: string): boolean {
    const pasmModczOperand: string[] = [
      '_clr',
      '_nc_and_nz',
      '_nz_and_nc',
      ' _gt',
      '_nc_and_z',
      '_z_and_nc',
      '_nc',
      '_ge',
      '_c_and_nz',
      '_nz_and_c',
      '_nz',
      '_ne',
      '_c_ne_z',
      '_z_ne_c',
      '_nc_or_nz',
      '_nz_or_nc',
      '_c_and_z',
      '_z_and_c',
      '_c_eq_z',
      '_z_eq_c',
      '_z',
      '_e',
      '_nc_or_z',
      '_z_or_nc',
      '_c',
      '_lt',
      '_c_or_nz',
      '_nz_or_c',
      '_c_or_z',
      '_z_or_c',
      '_le',
      '_set'
    ];
    const reservedStatus: boolean = pasmModczOperand.indexOf(name.toLowerCase()) != -1;
    return reservedStatus;
  }

  // ----------------------------------------------------------------------------
  // Built-in SPIN methods P2
  //
  private _tableSpinHubMethods: { [Identifier: string]: TMethodTuple } = {
    hubset: ['HUBSET(Value)', 'Set HUB configuration to Value, or reset the Propeller', ['Value - hub configuration value']],
    clkset: [
      'CLKSET(NewCLKMODE, NewCLKFREQ)',
      'Safely establish new clock settings, updates CLKMODE and CLKFREQ',
      ['NewCLKMODE - desired clock mode value', 'NewCLKFREQ - desired clock frequency']
    ],
    cogspin: [
      'COGSPIN(CogNum, Method({Pars}), StkAddr)[ : CogId]',
      "Start Spin2 method in a cog, returns cog's ID if used as an expression element, -1 = no cog free",
      [
        'CogNum - id of COG to be started (or NEWCOG for next available)',
        'Method({Pars}) - method (with parameters) to be run in cog',
        'StkAddr - Address of memory to be used as stack'
      ],
      ["CogId - cog's ID if used as an expression element, -1 = no cog free"]
    ],
    coginit: [
      'COGINIT(CogNum, PASMaddr, PTRAvalue)[ : CogId]',
      "Start PASM code in a cog, returns cog's ID if used as an expression element, -1 = no cog free",
      [
        'CogNum - COG id of cog to be started and/or COGINIT Symbol (e.g., COGEXEC_NEW)',
        'PASMaddr - Address of p2asm code to be run in COG',
        'PTRAvalue - value to be passed to new COG a startup'
      ],
      ["CogId - cog's ID if used as an expression element, -1 = no cog free"]
    ],
    cogstop: ['COGSTOP(CogNum)', 'Stop cog CogNum', ['CogNum - id of COG to be stopped']],
    cogid: ['COGID() : CogNum', "Get this cog's ID", [], ['CogNum - ID of currently running COG']],
    cogchk: [
      'COGCHK(CogNum) : Running',
      'Check if COG CogNum is running',
      ['CogNum - id of COG to be checked'],
      ['Running - TRUE (-1) if running or FALSE (0) if not']
    ],
    locknew: ['LOCKNEW() : LockNum', 'Check out a new LOCK from inventory', [], ['LockNum - 0..15 if successful or < 0 if no LOCK available']],
    lockret: ['LOCKRET(LockNum)', 'Return a LOCK to inventory', ['LockNum - [0-15] id of the lock to be returned']],
    locktry: [
      'LOCKTRY(LockNum) : LockState',
      'Try to capture a LOCK',
      ['LockNum - [0-15] id of the lock to capture'],
      ['LockState - TRUE (-1) if successful or FALSE (0) if another cog has captured the LOCK.']
    ],
    lockrel: ['LOCKREL(LockNum)', 'Release a LOCK', ['LockNum - [0-15] id of the lock to release']],
    lockchk: [
      'LOCKCHK(LockNum) : LockState',
      "Check a certain LOCK's state",
      ['LockNum - [0-15] id of the lock to check'],
      ['LockState - LockState[31] = captured, LockState[3:0] = current or last owner cog']
    ],
    cogatn: ['COGATN(CogMask)', 'Strobe ATN input(s) of cog(s) according to 16-bit CogMask', ['CogMask - [0-15] bitmask list of cogs to be Strobed']],
    pollatn: [
      'POLLATN() : AtnFlag',
      'Check if this cog has received an ATN strobe',
      [],
      ['AtnFlag - is TRUE (-1) if ATN strobed or FALSE (0) if not strobed']
    ],
    waitatn: ['WAITATN()', 'Wait for this cog to receive an ATN strobe', []]
  };

  private _tableSpinPinMethods: { [Identifier: string]: TMethodTuple } = {
    // key: [ signature, description, ["param1 - descr", "param2 - descr", "..."], ["return1 - descr", "return2 - descr", "..."] ]
    pinw: [
      'PINW(PinField, Data)',
      'Drive PinField pin(s) with Data<br>(same as PINWRITE(PinField, Data)',
      [
        'PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)',
        'Data - bit values to write, ea. bit in same position as each active pin in `PinField`'
      ]
    ],
    pinwrite: [
      'PINWRITE(PinField, Data)',
      'Drive PinField pin(s) with Data<br>(same as PINW(PinField, Data)',
      [
        'PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)',
        'Data - bit values to write, ea. bit in same position as each active pin in `PinField`'
      ]
    ],
    pinr: [
      'PINR(PinField) : PinStates : PinStates',
      'Read PinField pin(s)<br>(same as PINREAD(PinField) : PinStates)',
      ['PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)'],
      ['PinStates - bit values read, one bit in same position as each active pin in `PinField`']
    ],
    pinread: [
      'PINREAD(PinField) : PinStates',
      'Read PinField pin(s)<br>(same as PINR(PinField) : PinStates)',
      ['PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)'],
      ['PinStates - bit values read, one bit in same position as each active pin in `PinField`']
    ],
    pinl: [
      'PINL(PinField)',
      'Drive PinField pin(s) low<br>(same as PINLOW(PinField))',
      ['PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)']
    ],
    pinlow: [
      'PINLOW(PinField)',
      'Drive PinField pin(s) low<br>(same as PINL(PinField))',
      ['PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)']
    ],
    pinh: [
      'PINH(PinField)',
      'Drive PinField pin(s) high<br>(same as PINHIGH(PinField))',
      ['PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)']
    ],
    pinhigh: [
      'PINHIGH(PinField)',
      'Drive PinField pin(s) high<br>(same as PINH(PinField))',
      ['PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)']
    ],
    pint: [
      'PINT(PinField)',
      'Drive and toggle PinField pin(s)<br>(same as PINTOGGLE(PinField))',
      ['PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)']
    ],
    pintoggle: [
      'PINTOGGLE(PinField)',
      'Drive and toggle PinField pin(s)<br>(same as PINT(PinField))',
      ['PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)']
    ],
    pinf: [
      'PINF(PinField)',
      'Float PinField pin(s)<br>(same as PINFLOAT(PinField))',
      ['PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)']
    ],
    pinfloat: [
      'PINFLOAT(PinField)',
      'Float PinField pin(s)<br>(same as PINF(PinField))',
      ['PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)']
    ],
    pinstart: [
      'PINSTART(PinField, Mode, Xval, Yval)',
      'Start PinField smart pin(s): DIR=0, then WRPIN=Mode, WXPIN=Xval, WYPIN=Yval, then DIR=1',
      [
        'PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)',
        'Mode - mode bits for selected smart pin(s)',
        'XVal - initial value for X register of selected smart pin(s)',
        'YVal - initial value for Y register of selected smart pin(s)'
      ]
    ],
    pinclear: [
      'PINCLEAR(PinField)',
      'Clear PinField smart pin(s): DIR=0, then WRPIN=0',
      ['PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)']
    ],
    wrpin: [
      'WRPIN(PinField, Data)',
      "Write 'mode' register(s) of PinField smart pin(s) with Data",
      ['PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)', 'Data - mode bits for selected smart pin(s)']
    ],
    wxpin: [
      'WXPIN(PinField, Data)',
      "Write 'X' register(s) of PinField smart pin(s) with Data",
      [
        'PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)',
        'Data - initial value for X register of selected smart pin(s)'
      ]
    ],
    wypin: [
      'WYPIN(PinField, Data)',
      "Write 'Y' register(s) of PinField smart pin(s) with Data",
      [
        'PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)',
        'Data - initial value for Y register of selected smart pin(s)'
      ]
    ],
    akpin: [
      'AKPIN(PinField)',
      'Acknowledge PinField smart pin(s)',
      ['PinField - selects one or more pins within same 32-bit block (P0-P31 or P32-P63)']
    ],
    rdpin: [
      'RDPIN(Pin) : Zval',
      'Read Pin smart pin and acknowledge<br> NOTE: this read overwrites zval[31] with the c flag value, but this does not interfere with expected data',
      ['Pin - a single smart pin (P0-P63)'],
      ['Zval - Zval[31] = C flag from RQPIN, other bits are RQPIN data']
    ],
    rqpin: [
      'RQPIN(Pin) : Zval',
      'Read Pin smart pin without acknowledge<br> NOTE: this read overwrites zval[31] with the c flag value, but this does not interfere with expected data',
      ['Pin - a single smart pin (P0-P63)'],
      ['Zval - Zval[31] = C flag from RQPIN, other bits are RQPIN data']
    ]
  };

  private _tableSpinTimingMethods: { [Identifier: string]: TMethodTuple } = {
    getct: ['GETCT() : Count', 'Get 32-bit system counter', [], ['Count - the current 32-bit system counter value']],
    pollct: [
      'POLLCT(Tick) : Past',
      "Check if system counter has gone past 'Tick'",
      ['Tick - a 32-bit counter check value'],
      ['Past - returns TRUE (-1) if past or FALSE (0) if not']
    ],
    waitct: ['WAITCT(Tick)', "Wait for system counter to get past 'Tick'", ['Tick - 32-bit counter value']],
    waitus: [
      'WAITUS(Microseconds)',
      'Wait Microseconds, uses CLKFREQ, duration must not exceed $8000_0000 clocks',
      ["Microseconds - number of 1/1_000_000's of a second to wait"]
    ],
    waitms: [
      'WAITMS(Milliseconds)',
      'Wait Milliseconds, uses CLKFREQ, duration must not exceed $8000_0000 clocks',
      ["Milliseconds - number of 1/1_000's of a second to wait"]
    ],
    getsec: [
      'GETSEC() : Seconds',
      'Get seconds since booting, uses 64-bit system counter and CLKFREQ, rolls over every 136 years',
      [],
      ['Seconds - seconds since boot']
    ],
    getms: [
      'GETMS() : Milliseconds',
      'Get milliseconds since booting, uses 64-bit system counter and CLKFREQ, rolls over every 49.7 days',
      [],
      ['Milliseconds - milliseconds since boot']
    ]
  };

  private _tablePAsmInterfaceMethods: { [Identifier: string]: TMethodTuple } = {
    call: [
      'CALL(RegisterOrHubAddr)',
      'CALL PASM code at Addr, PASM code should avoid registers $130..$1D7 and LUT',
      ['RegisterOrHubAddr - address of COG register containing instruction to be executed']
    ],
    regexec: [
      'REGEXEC(HubAddr)',
      'Load a self-defined chunk of PASM code from HubAddr into COG registers and CALL it',
      [
        'HubAddr - address of chunk which is preceded with two words which provide the starting register and the number of registers (longs) to load, minus 1'
      ]
    ],
    regload: [
      'REGLOAD(HubAddr)',
      'Load a self-defined chunk of PASM code or data from HubAddr into registers',
      [
        'HubAddr - address of chunk which is preceded with two words which provide the starting register and the number of registers (longs) to load, minus 1'
      ]
    ]
  };

  private _tableSpinMathMethods: { [Identifier: string]: TMethodTuple } = {
    rotxy: [
      'ROTXY(x, y, angle32bit) : rotx, roty',
      'Rotate (x,y) by angle32bit and return rotated (x,y)',
      [
        'x - horizontal coordinate',
        'y - vertical coordinate',
        'angle32bit - unsigned 32-bit angle, where $00000000..$FFFFFFFF = 0..359.9999999 degrees'
      ],
      ['x - x rotated by angle32bit', 'y - y rotated by angle32bit']
    ],
    polxy: [
      'POLXY(length, angle32bit) : x, y',
      'Convert (length,angle32bit) to (x,y)',
      ['length - integer distance from 0,0', 'angle32bit - unsigned 32-bit angle, where $00000000..$FFFFFFFF = 0..359.9999999 degrees'],
      ['x - resulting X', 'y - resulting Y']
    ],
    xypol: [
      'XYPOL(x, y) : length, angle32bit',
      'Convert (x,y) to (length,angle32bit)',
      ['x - horizontal coordinate', 'y - vertical coordinate'],
      ['length - integer distance from 0,0', 'angle32bit - unsigned 32-bit angle, where $00000000..$FFFFFFFF = 0..359.9999999 degrees']
    ],
    qsin: [
      'QSIN(length, step, stepsInCircle) : y',
      'Rotate (length,0) by (step / stepsInCircle) * 2Pi and return y.',
      [
        'length - integer distance from 0,0',
        'step - is the positon on the circle in terms of stepsInCircle',
        'stepsInCircle - unsigned number of steps around the circle. Use 0 for stepsInCircle = $1_0000_0000'
      ],
      ['y - computed Y value from rotation']
    ],
    qcos: [
      'QCOS(length, step, stepsInCircle) : x',
      'Rotate (length, 0) by (step / stepsInCircle) * 2Pi and return x',
      [
        'length - integer distance from 0,0',
        'step - is the positon on the circle in terms of stepsInCircle',
        'stepsInCircle - unsigned number of steps around the circle. Use 0 for stepsInCircle = $1_0000_0000'
      ],
      ['x - computed X value from rotation']
    ],
    muldiv64: [
      'MULDIV64(mult1,mult2,divisor) : quotient',
      "Divide the 64-bit product of 'mult1' and 'mult2' by 'divisor', return quotient (unsigned operation)",
      ['mult1 - the 32-bit multiplicand', 'mult2 - the 32-bit multiplier', 'divisor - the 32-bit value to divide by'],
      ['quotient - 32-bit result of multiply followed by divide']
    ],
    getrnd: [
      'GETRND() : rnd',
      'Get random long (from xoroshiro128** pseudo-random number generator, seeded on boot with thermal noise from ADC)',
      [],
      ['rnd - a random 32-bit integer']
    ],
    nan: [
      'NAN(float) : NotANumber',
      'Determine if a floating-point value is not a number',
      ['float - floating point number to be evaluated'],
      ['NotANumber - returns TRUE (-1) if number or FALSE (0) if not']
    ]
  };

  private _tableSpinMemoryMethods: { [Identifier: string]: TMethodTuple } = {
    getregs: [
      'GETREGS(HubAddr, CogAddr, Count)',
      'Move Count registers at CogAddr to longs at HubAddr',
      [
        'HubAddr - address of HUB long array to receive values',
        'CogAddr - address of COG register array to be copied',
        'Count - number of registers to be copied'
      ]
    ],
    setregs: [
      'SETREGS(HubAddr, CogAddr, Count)',
      'Move Count longs at HubAddr to registers at CogAddr',
      [
        'HubAddr - address of HUB long array to be copied',
        'CogAddr - address of COG register array to receive values',
        'Count - number of registers to be copied'
      ]
    ],
    bytemove: [
      'BYTEMOVE(Destination, Source, Count)',
      'Move Count bytes from Source to Destination',
      [
        'Destination - address of BYTE array to receive values',
        'Source - address of BYTE array to be copied',
        'Count - the number of BYTEs to be copied'
      ]
    ],
    wordmove: [
      'WORDMOVE(Destination, Source, Count)',
      'Move Count words from Source to Destination',
      [
        'Destination - address of WORD array to receive values',
        'Source - address of WORD array to be copied',
        'Count - the number of WORDs to be copied'
      ]
    ],
    longmove: [
      'LONGMOVE(Destination, Source, Count)',
      'Move Count longs from Source to Destination',
      [
        'Destination - address of LONG array to receive values',
        'Source - address of LONG array to be copied',
        'Count - the number of LONGs to be copied'
      ]
    ],
    bytefill: [
      'BYTEFILL(Destination, Value, Count)',
      'Fill Count bytes starting at Destination with Value',
      ['Destination - address of BYTE array to receive values', 'Value - 8-bit value', 'Count - the number of BYTEs to be filled']
    ],
    wordfill: [
      'WORDFILL(Destination, Value, Count)',
      'Fill Count words starting at Destination with Value',
      ['Destination - address of WORD array to receive values', 'Value - 16-bit value', 'Count - the number of WORDs to be filled']
    ],
    longfill: [
      'LONGFILL(Destination, Value, Count)',
      'Fill Count longs starting at Destination with Value',
      ['Destination - address of LONG array to receive values', 'Value - 32-bit value', 'Count - the number of LONGs to be filled']
    ],
    movbyts: [
      'MOVBYTS(Value, Order) : Result',
      'Reorder the four bytes within a 32-bit long value according to a base-4 pattern. Each digit in the pattern selects which source byte occupies that position in the result.',
      ['Value - 32-bit value whose bytes will be reordered', 'Order - base-4 pattern (%%DDDD) specifying byte placement'],
      ['Result - the value with bytes rearranged per the order pattern']
    ]
  };

  private _tableSpinStringMethods: { [Identifier: string]: TMethodTuple } = {
    strsize: [
      'STRSIZE(Addr) : Size',
      'Count bytes of zero-terminated string at Addr',
      ['Addr - address of zero-terminated string'],
      ['Size - the string length, not including the zero']
    ],
    strcomp: [
      'STRCOMP(AddrA,AddrB) : Match',
      'Compare zero-terminated strings at AddrA and AddrB',
      ['AddrA - address of zero-terminated string', 'AddrB - address of zero-terminated string'],
      ['Match - return TRUE (-1) if match or FALSE (0) if not']
    ],
    strcopy: [
      'STRCOPY(Destination, Source, Max)',
      'Copy a zero-terminated string of up to Max characters from Source to Destination. The copied string will occupy up to Max+1 bytes, including the zero terminator',
      [
        'Destination - address of place to put string copy',
        'Source - address of zero-terminated string to be copied',
        'Max - maximum number of bytes of string to copy (less the terminator)'
      ]
    ],

    getcrc: [
      'GETCRC(BytePtr, Poly, Count) : CRC',
      'Compute a CRC of Count bytes starting at BytePtr using a custom polynomial of up to 32 bits',
      ['BytePtr - address of source byte array', 'Poly - the 32-bit polynomial to be used', 'Count - number of bytes in the source byte array'],
      ['CRC - the 32-bit computed CRC value']
    ]
  };

  private _tableSpinStringBuilder: { [Identifier: string]: string[] } = {
    // NOTE: this does NOT support signature help! (paramaters are not highlighted for signature help due to variant forms for string() being allowed)
    string: [
      'STRING("Text",13) : StringAddress',
      'Compose a zero-terminated string (quoted characters and values 1..255 allowed), return address of string<br><br>@param `listOfElements` - a comma separated list of elements to be built into a string (quoted characters and values 1..255 allowed)<br>@returns `StringAddress` - address of where string was placed in ram'
    ]
  };

  private _tableSpinEnhancements_v42: { [Identifier: string]: string[] } = {
    // NOTE: this does NOT support signature help! (paramaters are not highlighted for signature help due to variant forms for string() being allowed)
    lstring: [
      'LSTRING("Hello",0,"Terve",0) : StringAddress',
      'Compose a length-headed string (quoted characters and values 0..255), return address of string.'
    ]
  };

  private _tableSpinEnhancements_v42_replaced: { [Identifier: string]: string[] } = {
    // only used if version is EXACTLY v42
    bytes: ['BYTES($80,$09,$77,WORD $1234,LONG -1)', 'Compose a string of bytes, return address of string. WORD/LONG size overrides allowed.'],
    words: ['WORDS(1_000,10_000,50_000,LONG $12345678)', ' Compose a string of words, return address of string. BYTE/LONG size overrides allowed.'],
    longs: ['LONGS(1e-6,1e-3,1.0,1e3,1e6,-50,BYTE $FF)', ' Compose a string of longs, return address of string. BYTE/WORD size overrides allowed.']
  };

  private _tableSpinEnhancements_v43: { [Identifier: string]: string[] } = {
    // in v43 and later these became singular vs. plural names
    byte: ['BYTE($80,$09,$77,WORD $1234,LONG -1)', 'Compose a string of bytes, return address of string. WORD/LONG size overrides allowed.'],
    word: ['WORD(1_000,10_000,50_000,LONG $12345678)', ' Compose a string of words, return address of string. BYTE/LONG size overrides allowed.'],
    long: ['LONG(1e-6,1e-3,1.0,1e3,1e6,-50,BYTE $FF)', ' Compose a string of longs, return address of string. BYTE/WORD size overrides allowed.']
  };

  private _tableSpinEnhancements_v44: { [Identifier: string]: TMethodTuple } = {
    byteswap: [
      'BYTESWAP(AddrA, AddrB, Count)',
      'Swap Count bytes of data starting at AddrA and AddrB.',
      ['AddrA - address of first BYTE array', 'AddrB - address of second BYTE array', 'Count - number of BYTEs to swap']
    ],
    wordswap: [
      'WORDSWAP(AddrA, AddrB, Count)',
      'Swap Count words of data starting at AddrA and AddrB.',
      ['AddrA - address of first WORD array', 'AddrB - address of second WORD array', 'Count - number of WORDs to swap']
    ],
    longswap: [
      'LONGSWAP(AddrA, AddrB, Count)',
      'Swap Count longs of data starting at AddrA and AddrB.',
      ['AddrA - address of first LONG array', 'AddrB - address of second LONG array', 'Count - number of LONGs to swap']
    ],
    bytecomp: [
      'BYTECOMP(AddrA, AddrB, Count) : Match',
      'Compare Count bytes of data starting at AddrA and AddrB, return -1 if match or 0 if mismatch.',
      [
        'AddrA - address of first byte array',
        'AddrB - address of second byte array',
        'Count - number of BYTEs to compare',
        'Match - -1 if match or 0 if mismatch'
      ]
    ],
    wordcomp: [
      'WORDCOMP(AddrA, AddrB, Count) : Match',
      'Compare Count words of data starting at AddrA and AddrB, return -1 if match or 0 if mismatch.',
      [
        'AddrA - address of first byte array',
        'AddrB - address of second byte array',
        'Count - number of WORDs to compare',
        'Match - -1 if match or 0 if mismatch'
      ]
    ],
    longcomp: [
      'LONGCOMP(AddrA, AddrB, Count) : Match',
      'Compare Count longs of data starting at AddrA and AddrB, return -1 if match or 0 if mismatch.',
      [
        'AddrA - address of first byte array',
        'AddrB - address of second byte array',
        'Count - number of LONGs to compare',
        'Match - -1 if match or 0 if mismatch'
      ]
    ]
  };

  private _tableSpinEnhancements_v44_replaced: { [Identifier: string]: TMethodTuple } = {
    // only used if version is EXACTLY v44
    fill: ['FILL(StructA, ByteValue)', 'Fill StructA with ByteValue.', ['StructA - structure to be filled', 'ByteValue - value to fill with']],
    copy: [
      'COPY(StructA, StructB)',
      'Copy contents of StructB into StructA.',
      ['StructA - structure to be filled', 'StructB - structure to be copied']
    ],
    swap: [
      'SWAP(StructA, StructB)',
      'Swap contents of StructA and StructB.',
      ['StructA - structure to be swapped', 'StructB - structure to be swapped']
    ],
    comp: [
      'COMP(StructA, StructB) : Match',
      'Compare contents of StructA and StructB, return -1 if match or 0 if mismatch.',
      ['StructA - structure to be compared', 'StructB - structure to be compared'],
      ['Match - -1 if match or 0 if mismatch']
    ]
  };

  private _tableSpinEnhancements_v45: { [Identifier: string]: string[] } = {
    // used in DAT, VAR, PUB, and PRI blocks
    sizeof: ['SIZEOF(structure)', 'returns the size of the structure in bytes.']
  };

  private _tableSpinEnhancements_v47: { [Identifier: string]: TMethodTuple } = {
    taskspin: [
      'TASKSPIN(Task,Method({parameters}),Stack_address) : TaskId',
      'Initializes a Spin2 task, similarly to how COGSPIN initializes a Spin2 cog.',
      [
        'Task - Task = 0..31 for a fixed task or -1 (NEWTASK) for the first free task.',
        'Method({parameters}) - address of method to run as task and parameters to pass to it.',
        'Stack_address - pointer to LONG array to be used as the stack'
      ],
      ['TaskId - TaskId = 0..31 if successful or -1 if no task free']
    ],
    tasknext: ['TASKNEXT()', 'Switches to the next unhalted task.', []],
    taskstop: [
      'TASKSTOP(taskId)',
      'Switches to the next unhalted task.',
      ['taskId - Task = 0..31 for a fixed task or -1 (THISTASK) for the current task.'],
      []
    ],
    taskhalt: [
      'TASKHALT(taskId)',
      'Halts a task until TASKCONT allows it to continue.',
      ['taskId - Task = 0..31 for a fixed task or -1 (THISTASK) for the current task.'],
      []
    ],
    taskcont: ['TASKCONT(taskId)', 'Continues a task that was halted by TASKHALT.', ['taskId - Task = 0..31.'], []],
    taskchk: [
      'TASKCHK(taskId) : status',
      'Checks the status of a task.',
      ['taskId - Task = 0..31.'],
      ['status - Returns 0 if the task is free, 1 if the task is running, or 2 if the task is halted.']
    ],
    taskid: ['TASKID() : taskId', 'Returns the ID of the current task.', [], ['taskId - Task = 0..31.']]
  };

  private _tableSpinEnhancements_v52: { [Identifier: string]: TMethodTuple } = {
    endianl: [
      'ENDIANL(LongValue) : ReversedLong',
      'Return reverse-endian long value.',
      ['LongValue - a 32-bit long value'],
      ['ReversedLong - the value with bytes in reversed order']
    ],
    endianw: [
      'ENDIANW(WordValue) : ReversedWord',
      'Return reverse-endian word value.',
      ['WordValue - a 16-bit word value'],
      ['ReversedWord - the value with bytes in reversed order']
    ]
  };

  private _tableSpinEnhancements_v53: { [Identifier: string]: string[] } = {
    // used in DAT, VAR, PUB, and PRI blocks
    offsetof: [
      'OFFSETOF(struct_name{[index]}{.member{[index]}...})',
      'returns the byte offset of a member within a structure definition. Evaluated at compile time.'
    ]
  };

  private _tableSpinIndexValueMethods: { [Identifier: string]: string[] } = {
    // NOTE: this does NOT support signature help! (paramaters are not highlighted for signature help due to ':' being param separater)
    lookup: [
      'LOOKUP(Index: ExpressionList) : Value',
      'Lookup value (values and ranges allowed) using 1-based index, return value (0 if index out of range)<br><br>' +
        '@param `Index` - an expression indicating the position of the desired value in ExpressionList<br>' +
        '@param `ExpressionList` - a comma-separated list of expressions. Quoted strings of characters are also allowed; they are treated as a comma-separated list of characters<br>' +
        '@returns `Value` - the value found (or 0 if index out of range)<br>'
    ],
    lookupz: [
      'LOOKUPZ(Index: ExpressionList) : Value',
      'Lookup value (values and ranges allowed) using 0-based index, return value (0 if index out of range)<br><br>' +
        "@param `Index' -  is an expression indicating the position of the desired value in ExpressionList<br>" +
        "@param `ExpressionList' - a comma-separated list of expressions. Quoted strings of characters are also allowed; they are treated as a comma-separated list of characters<br>" +
        '@returns `Value` - the value found (or 0 if index out of range)<br>'
    ],
    lookdown: [
      'LOOKDOWN(Value: ExpressionList) : Index',
      'Determine 1-based index of matching value (values and ranges allowed), return index (0 if no match)<br><br>' +
        "@param `Value' - is an expression indicating the value to find in ExpressionList<br>" +
        "@param `ExpressionList' - a comma-separated list of expressions. Quoted strings of characters are also allowed; they are treated as a comma-separated list of characters<br>" +
        '@returns `Index` - the index found (or 0 if no match for value in list)<br>'
    ],
    lookdownz: [
      'LOOKDOWNZ(Value: ExpressionList) : Index',
      'Determine 0-based index of matching value (values and ranges allowed), return index (0 if no match)<br><br>' +
        "@param `Value' - is an expression indicating the value to find in ExpressionList<br>" +
        "@param `ExpressionList' - a comma-separated list of expressions. Quoted strings of characters are also allowed; they are treated as a comma-separated list of characters<br>" +
        '@returns `Index` - the index found (or 0 if no match for value in list)<br>'
    ]
  };

  private _tableSpinControlFlowMethods: { [Identifier: string]: string[] } = {
    abort: [
      'ABORT [ErrorCode]',
      "Instantly return, from any depth of nested method calls, back to a base caller which used '\\' before the method name. A single return value can be conveyed from the abort point back to the base caller"
    ],
    return: ['RETURN [Value[, Value[,...]]]', 'Return zero or more values from a PUB/PRI method.']
  };

  public isSpinBuiltinMethod(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = nameKey in this._tableSpinHubMethods;
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpinPinMethods;
      if (!reservedStatus) {
        reservedStatus = nameKey in this._tableSpinTimingMethods;
        if (!reservedStatus) {
          reservedStatus = nameKey in this._tablePAsmInterfaceMethods;
          if (!reservedStatus) {
            reservedStatus = nameKey in this._tableSpinMathMethods;
            if (!reservedStatus) {
              reservedStatus = nameKey in this._tableSpinMemoryMethods;
              if (!reservedStatus) {
                reservedStatus = nameKey in this._tableSpinStringMethods;
                if (!reservedStatus) {
                  reservedStatus = nameKey in this._tableSpinStringBuilder;
                  if (!reservedStatus) {
                    reservedStatus = nameKey in this._tableSpinIndexValueMethods;
                    if (!reservedStatus) {
                      reservedStatus = nameKey in this._tableSpinControlFlowMethods;
                      if (!reservedStatus) {
                        // see if we are using a keyword only present in a specific version
                        reservedStatus = this.isVersionSpecificMethod(nameKey);
                        if (!reservedStatus) {
                          // see if we are using a keyword provided by accumulated versions
                          reservedStatus = this.isVersionAddedMethod(nameKey);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    this._logMessage(`sp2u:  -- iSBM(${name}) = (${reservedStatus})`);
    return reservedStatus;
  }

  private isVersionSpecificMethod(name: string): boolean {
    // some keywords did NOT survivie to later versions
    //  this routine determines if we are using one of these
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = false;
    if (this.exactSpinVersion(42)) {
      // in version v42 we added some keywords, they were renamed in v43!
      reservedStatus = nameKey in this._tableSpinEnhancements_v42_replaced;
    } else if (this.exactSpinVersion(44)) {
      // in version v44 we added some keywords, they were replaced with operators in v45!
      reservedStatus = nameKey in this._tableSpinEnhancements_v44_replaced;
    }
    this._logMessage(`sp2u:  -- iVerSM(${name}) = (${reservedStatus})`);
    return reservedStatus;
  }

  public isVersionAddedMethod(name: string): boolean {
    // a number of keywords are added by later versions
    //  this routine checks all added keywords allowed by the file-specific version
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = false;
    if (this.requestedSpinVersion(42)) {
      // requested version is v42 or greater
      reservedStatus = nameKey in this._tableSpinEnhancements_v42;
    }
    if (!reservedStatus && this.requestedSpinVersion(43)) {
      // requested version is v43 or greater
      reservedStatus = nameKey in this._tableSpinEnhancements_v43;
    }
    if (!reservedStatus && this.requestedSpinVersion(44)) {
      // requested version is v44 or greater
      reservedStatus = nameKey in this._tableSpinEnhancements_v44;
    }
    if (!reservedStatus && this.requestedSpinVersion(45)) {
      // requested version is v45 or greater
      reservedStatus = nameKey in this._tableSpinEnhancements_v45;
    }
    if (!reservedStatus && this.requestedSpinVersion(47)) {
      // requested version is v47 or greater
      reservedStatus = nameKey in this._tableSpinEnhancements_v47;
    }
    if (!reservedStatus && this.requestedSpinVersion(52)) {
      // requested version is v52 or greater
      reservedStatus = nameKey in this._tableSpinEnhancements_v52;
    }
    if (!reservedStatus && this.requestedSpinVersion(53)) {
      // requested version is v53 or greater
      reservedStatus = nameKey in this._tableSpinEnhancements_v53;
    }
    this._logMessage(`sp2u:  -- iVerAM(${name}) = (${reservedStatus})`);
    return reservedStatus;
  }

  public versionRequiredForKeyword(name: string): number {
    // check all version-gated tables regardless of current version, return minimum version needed
    // returns 0 if the name is not a version-gated keyword
    const nameKey: string = name.toLowerCase();
    // spin enhancements (methods/builtins)
    if (nameKey in this._tableSpinEnhancements_v42 || nameKey in this._tableSpinEnhancements_v42_replaced) return 42;
    if (nameKey in this._tableSpinEnhancements_v43) return 43;
    if (nameKey in this._tableSpinEnhancements_v44 || nameKey in this._tableSpinEnhancements_v44_replaced) return 44;
    if (nameKey in this._tableSpinEnhancements_v45) return 45;
    if (nameKey in this._tableSpinEnhancements_v47) return 47;
    if (nameKey in this._tableSpinEnhancements_v52) return 52;
    if (nameKey in this._tableSpinEnhancements_v53) return 53;
    // storage types
    if (nameKey in this._tableSpinStorageTypes_v45) return 45;
    // operators
    if (nameKey in this._tableSpinBinaryOperators_v51) return 51;
    if (nameKey in this._tableSpinUnaryOperators_v51) return 51;
    // pasm directives
    if (nameKey in this._tableSpinPAsmLangParts_v50) return 50;
    // registers and clock symbols
    if (nameKey in this._tableClockControlSymbols_v46) return 46;
    if (nameKey in this._tableSpinTaskRegisters_v47) return 47;
    // task symbols
    if (nameKey in this._tableSpinTaskSymbols_v47) return 47;
    // debug-related
    if (nameKey in this._tableDebugMethodsBool_v44) return 44;
    if (nameKey in this._tableDebugMethodsBool_v46) return 46;
    if (nameKey in this._tableDebugMaskInvoke_v46) return 46;
    if (nameKey in this._tableDebugControlSymbols_v46) return 46;
    if (nameKey in this._tableDebugControlSymbols_v52) return 52;
    return 0;
  }

  private _docTextForSpinBuiltInMethod(name: string, typeFilter: eSearchFilterType = eSearchFilterType.FT_NO_PREFERENCE): IBuiltinDescription {
    const nameKey: string = name.toLowerCase();
    const desiredDocText: IBuiltinDescription = {
      found: false,
      type: eBuiltInType.Unknown,
      category: '',
      description: '',
      signature: ''
    };
    if (this.isSpinBuiltinMethod(name)) {
      desiredDocText.found = true;
      let protoWDescr: string[] = [];
      let methodDescr: TMethodTuple = ['', '', []];
      if (nameKey in this._tableSpinHubMethods) {
        desiredDocText.category = 'Hub Method';
        methodDescr = this._tableSpinHubMethods[nameKey];
      } else if (nameKey in this._tableSpinPinMethods) {
        desiredDocText.category = 'Pin Method';
        methodDescr = this._tableSpinPinMethods[nameKey];
      } else if (nameKey in this._tableSpinTimingMethods) {
        desiredDocText.category = 'Timing Method';
        methodDescr = this._tableSpinTimingMethods[nameKey];
      } else if (nameKey in this._tablePAsmInterfaceMethods) {
        desiredDocText.category = 'PAsm Interface Method';
        methodDescr = this._tablePAsmInterfaceMethods[nameKey];
      } else if (nameKey in this._tableSpinMathMethods) {
        desiredDocText.category = 'Math Method';
        methodDescr = this._tableSpinMathMethods[nameKey];
      } else if (nameKey in this._tableSpinMemoryMethods) {
        desiredDocText.category = 'Memory Method';
        methodDescr = this._tableSpinMemoryMethods[nameKey];
      } else if (nameKey in this._tableSpinStringMethods) {
        desiredDocText.category = 'String Method';
        methodDescr = this._tableSpinStringMethods[nameKey];
      } else if (nameKey in this._tableSpinStringBuilder) {
        desiredDocText.category = 'String Method';
        protoWDescr = this._tableSpinStringBuilder[nameKey];
      } else if (this.requestedSpinVersion(42) && nameKey in this._tableSpinEnhancements_v42) {
        // if {Spin2_v42} or greater then also search this table
        desiredDocText.category = 'String Method';
        protoWDescr = this._tableSpinEnhancements_v42[nameKey];
      } else if (this.requestedSpinVersion(43) && nameKey in this._tableSpinEnhancements_v43) {
        // if {Spin2_v43} or greater then also search this table
        desiredDocText.category = 'String Method';
        protoWDescr = this._tableSpinEnhancements_v43[nameKey];
      } else if (this.requestedSpinVersion(44) && nameKey in this._tableSpinEnhancements_v44) {
        // if {Spin2_v44} or greater then also search this table
        desiredDocText.category = 'Memory Method';
        methodDescr = this._tableSpinEnhancements_v44[nameKey];
      } else if (this.exactSpinVersion(44) && nameKey in this._tableSpinEnhancements_v44_replaced) {
        // if exactly {Spin2_v44} then also search this table
        desiredDocText.category = 'Structure Method';
        methodDescr = this._tableSpinEnhancements_v44_replaced[nameKey];
      } else if (this.requestedSpinVersion(45) && nameKey in this._tableSpinEnhancements_v45) {
        // if {Spin2_v45} or greater then also search this table
        desiredDocText.category = 'Structure Method';
        protoWDescr = this._tableSpinEnhancements_v45[nameKey];
      } else if (this.requestedSpinVersion(47) && nameKey in this._tableSpinEnhancements_v47) {
        // if {Spin2_v47} or greater then also search this table
        desiredDocText.category = 'Task Method';
        methodDescr = this._tableSpinEnhancements_v47[nameKey];
      } else if (this.requestedSpinVersion(52) && nameKey in this._tableSpinEnhancements_v52) {
        // if {Spin2_v52} or greater then also search this table
        desiredDocText.category = 'Endian Method';
        methodDescr = this._tableSpinEnhancements_v52[nameKey];
      } else if (this.requestedSpinVersion(53) && nameKey in this._tableSpinEnhancements_v53) {
        // if {Spin2_v53} or greater then also search this table
        desiredDocText.category = 'Structure Method';
        protoWDescr = this._tableSpinEnhancements_v53[nameKey];
      } else if (nameKey in this._tableSpinIndexValueMethods) {
        desiredDocText.category = 'Hub Method';
        protoWDescr = this._tableSpinIndexValueMethods[nameKey];
      } else if (nameKey in this._tableSpinControlFlowMethods) {
        desiredDocText.category = 'Control Flow Method';
        protoWDescr = this._tableSpinControlFlowMethods[nameKey];
      }
      if (methodDescr[0].length != 0) {
        desiredDocText.signature = methodDescr[0];
        desiredDocText.description = methodDescr[1];
        if (methodDescr[2] && methodDescr[2].length > 0) {
          desiredDocText.parameters = methodDescr[2];
        }
        if (methodDescr[3] && methodDescr[3].length > 0) {
          desiredDocText.returns = methodDescr[3];
        }
      } else if (protoWDescr.length != 0) {
        desiredDocText.signature = protoWDescr[0];
        desiredDocText.description = protoWDescr[1];
      }
    }
    this._logMessage(`sp2u:  -- _docTextForSpinBuiltInMethod(${name}) = (${JSON.stringify(desiredDocText, null, 2)})`);
    return desiredDocText;
  }

  public lineStartsWithFlexspinPreprocessorDirective(line: string): boolean {
    let lineIsDirectiveStatus: boolean = false;
    if (line && line.length > 0) {
      const lineParts: string[] = line.split(/[ \t]/).filter(Boolean);
      if (lineParts.length > 0) {
        lineIsDirectiveStatus = this.isFlexspinPreprocessorDirective(lineParts[0]);
      }
    }
    return lineIsDirectiveStatus;
  }

  public isPNutPreprocessorDirective(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const pnutDirectiveOfNote: string[] = ['#define', '#ifdef', '#ifndef', '#else', '#elseifdef', '#elseifndef', '#endif', '#undef', '#pragma'];
    const reservedStatus: boolean = pnutDirectiveOfNote.indexOf(nameKey) != -1;
    return reservedStatus;
  }

  public isFlexspinPreprocessorDirective(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const flexspinDirectiveOfNote: string[] = [
      '#define',
      '#ifdef',
      '#ifndef',
      '#else',
      '#elseifdef',
      '#elseifndef',
      '#endif',
      '#error',
      '#include',
      '#warn',
      '#undef'
    ];
    const reservedStatus: boolean = flexspinDirectiveOfNote.indexOf(nameKey) != -1;
    return reservedStatus;
  }

  public isFlexspinReservedWord(name: string): boolean {
    const flexspinReservedswordsOfNote: string[] = [
      '__propeller__',
      '__propeller2__',
      '__p2__',
      '__flexspin__',
      '__spincvt__',
      '__spin2pasm__',
      '__spin2cpp__',
      '__have_fcache__',
      '__cplusplus__',
      '__date__',
      '__file__',
      '__line__',
      '__time__',
      '__version__',
      '__debug__',
      '__output_asm__',
      '__output_bytecode__',
      '__output_c__',
      '__output_cpp__'
    ];
    const reservedStatus: boolean = flexspinReservedswordsOfNote.indexOf(name.toLowerCase()) != -1;
    return reservedStatus;
  }

  public isP2AsmReservedSymbols(name: string): boolean {
    const reservedPAsmSymbolNames: string[] = ['org', 'orgf', 'orgh', 'fit', 'end'];
    const reservedStatus: boolean = reservedPAsmSymbolNames.indexOf(name.toLowerCase()) != -1;
    return reservedStatus;
  }

  private _tableClockConstants: { [Identifier: string]: string } = {
    _clkfreq: 'Selects XI/XO-crystal-plus-PLL mode, assumes 20 MHz crystal',
    _xtlfreq: 'Selects XI/XO-crystal mode and frequency',
    _xinfreq: 'Selects XI-input mode and frequency',
    _rcslow: 'Selects internal RCSLOW oscillator which runs at ~20 KHz',
    _rcfast: 'Selects internal RCFAST oscillator which runs at 20 MHz+'
  };

  private _tableClockSpinSymbols: { [Identifier: string]: string } = {
    clkmode_: 'The compiled clock mode, settable via HUBSET',
    clkfreq_: 'The compiled clock frequency'
  };

  private _tableClockSpinVariables: { [Identifier: string]: string } = {
    clkmode: "The current clock mode, located at LONG[$40]. Initialized with the 'clkmode_' value",
    clkfreq: "The current clock frequency, located at LONG[$44]. Initialized with the 'clkfreq_' value"
  };

  private _docTextForSpinClockVars(name: string): IBuiltinDescription {
    const nameKey: string = name.toLowerCase();
    const desiredDocText: IBuiltinDescription = {
      found: false,
      type: eBuiltInType.Unknown,
      category: '',
      description: '',
      signature: ''
    };
    if (nameKey in this._tableClockConstants) {
      desiredDocText.description = this._tableClockConstants[nameKey];
      desiredDocText.type = eBuiltInType.BIT_CONSTANT;
    } else if (nameKey in this._tableClockSpinSymbols) {
      desiredDocText.description = this._tableClockSpinSymbols[nameKey];
      desiredDocText.type = eBuiltInType.BIT_SYMBOL;
    } else if (nameKey in this._tableClockSpinVariables) {
      desiredDocText.description = this._tableClockSpinVariables[nameKey];
      desiredDocText.type = eBuiltInType.BIT_VARIABLE;
    }
    if (desiredDocText.type != eBuiltInType.Unknown) {
      desiredDocText.category = 'Clock';
      desiredDocText.found = true;
    }
    return desiredDocText;
  }

  public isP2AsmReservedWord(name: string): boolean {
    const nameKey = name.toLowerCase();
    const pasmReservedswordsOfNote: string[] = [
      'addpins',
      'clkfreq_',
      'clkmode_',
      'clkfreq',
      'clkmode',
      '_clkfreq',
      '_rcfast',
      '_rcslow',
      '_xinfreq',
      '_xtlfreq',
      'round',
      'float',
      'trunc',
      'fvar',
      'fvars',
      'addbits',
      'true',
      'false'
    ];
    let reservedStatus: boolean = pasmReservedswordsOfNote.indexOf(nameKey) != -1;
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpinCogRegisters;
    } else if (this.requestedSpinVersion(46) && nameKey in this._tableClockControlSymbols_v46) {
      reservedStatus = true;
    } else if (this.requestedSpinVersion(47) && nameKey in this._tableSpinTaskRegisters_v47) {
      reservedStatus = true;
    }
    return reservedStatus;
  }

  public isP2AsmInstruction(name: string): boolean {
    const pasmInstructions: string[] = [
      'abs',
      'add',
      'addct1',
      'addct2',
      'addct3',
      'addpix',
      'adds',
      'addsx',
      'addx',
      'akpin',
      'allowi',
      'altb',
      'altd',
      'altgb',
      'altgn',
      'altgw',
      'alti',
      'altr',
      'alts',
      'altsb',
      'altsn',
      'altsw',
      'and',
      'andn',
      'asmclk',
      'augd',
      'augs',
      'bitc',
      'bith',
      'bitl',
      'bitnc',
      'bitnot',
      'bitnz',
      'bitrnd',
      'bitz',
      'blnpix',
      'bmask',
      'brk',
      'call',
      'calla',
      'callb',
      'calld',
      'callpa',
      'callpb',
      'cmp',
      'cmpm',
      'cmpr',
      'cmps',
      'cmpsub',
      'cmpsx',
      'cmpx',
      'cogatn',
      'cogbrk',
      'cogid',
      'coginit',
      'cogstop',
      'crcbit',
      'crcnib',
      'decmod',
      'decod',
      'dirc',
      'dirh',
      'dirl',
      'dirnc',
      'dirnot',
      'dirnz',
      'dirrnd',
      'dirz',
      'djf',
      'djnf',
      'djnz',
      'djz',
      'drvc',
      'drvh',
      'drvl',
      'drvnc',
      'drvnot',
      'drvnz',
      'drvrnd',
      'drvz',
      'encod',
      'execf',
      'fblock',
      'fge',
      'fges',
      'fle',
      'fles',
      'fltc',
      'flth',
      'fltl',
      'fltnc',
      'fltnot',
      'fltnz',
      'fltrnd',
      'fltz',
      'getbrk',
      'getbyte',
      'getct',
      'getnib',
      'getptr',
      'getqx',
      'getqy',
      'getrnd',
      'getrnd',
      'getscp',
      'getword',
      'getxacc',
      'hubset',
      'ijnz',
      'ijz',
      'incmod',
      'jatn',
      'jct1',
      'jct2',
      'jct3',
      'jfbw',
      'jint',
      'jmp',
      'jmprel',
      'jnatn',
      'jnct1',
      'jnct2',
      'jnct3',
      'jnfbw',
      'jnint',
      'jnpat',
      'jnqmt',
      'jnse1',
      'jnse2',
      'jnse3',
      'jnse4',
      'jnxfi',
      'jnxmt',
      'jnxrl',
      'jnxro',
      'jpat',
      'jqmt',
      'jse1',
      'jse2',
      'jse3',
      'jse4',
      'jxfi',
      'jxmt',
      'jxrl',
      'jxro',
      'loc',
      'locknew',
      'lockrel',
      'lockret',
      'locktry',
      'mergeb',
      'mergew',
      'mixpix',
      'modc',
      'modcz',
      'modz',
      'mov',
      'movbyts',
      'mul',
      'mulpix',
      'muls',
      'muxc',
      'muxnc',
      'muxnibs',
      'muxnits',
      'muxnz',
      'muxq',
      'muxz',
      'neg',
      'negc',
      'negnc',
      'negnz',
      'negz',
      'nixint1',
      'nixint2',
      'nixint3',
      'nop',
      'not',
      'ones',
      'or',
      'outc',
      'outh',
      'outl',
      'outnc',
      'outnot',
      'outnz',
      'outrnd',
      'outz',
      'pollatn',
      'pollct1',
      'pollct2',
      'pollct3',
      'pollfbw',
      'pollint',
      'pollpat',
      'pollqmt',
      'pollse1',
      'pollse2',
      'pollse3',
      'pollse4',
      'pollxfi',
      'pollxmt',
      'pollxrl',
      'pollxro',
      'pop',
      'popa',
      'popb',
      'push',
      'pusha',
      'pushb',
      'qdiv',
      'qexp',
      'qfrac',
      'qlog',
      'qmul',
      'qrotate',
      'qsqrt',
      'qvector',
      'rcl',
      'rcr',
      'rczl',
      'rczr',
      'rdbyte',
      'rdfast',
      'rdlong',
      'rdlut',
      'rdpin',
      'rdword',
      'rep',
      'resi0',
      'resi1',
      'resi2',
      'resi3',
      'ret',
      'reta',
      'retb',
      'reti0',
      'reti1',
      'reti2',
      'reti3',
      'rev',
      'rfbyte',
      'rflong',
      'rfvar',
      'rfvars',
      'rfword',
      'rgbexp',
      'rgbsqz',
      'rol',
      'rolbyte',
      'rolbyte',
      'rolnib',
      'rolword',
      'rolword',
      'ror',
      'rqpin',
      'sal',
      'sar',
      'sca',
      'scas',
      'setbyte',
      'setcfrq',
      'setci',
      'setcmod',
      'setcq',
      'setcy',
      'setd',
      'setdacs',
      'setint1',
      'setint2',
      'setint3',
      'setluts',
      'setnib',
      'setpat',
      'setpiv',
      'setpix',
      'setq',
      'setq2',
      'setr',
      'sets',
      'setscp',
      'setse1',
      'setse2',
      'setse3',
      'setse4',
      'setword',
      'setxfrq',
      'seussf',
      'seussr',
      'shl',
      'shr',
      'signx',
      'skip',
      'skipf',
      'splitb',
      'splitw',
      'stalli',
      'sub',
      'subr',
      'subs',
      'subsx',
      'subx',
      'sumc',
      'sumnc',
      'sumnz',
      'sumz',
      'test',
      'testb',
      'testbn',
      'testn',
      'testp',
      'testpn',
      'tjf',
      'tjnf',
      'tjns',
      'tjnz',
      'tjs',
      'tjv',
      'tjz',
      'trgint1',
      'trgint2',
      'trgint3',
      'waitatn',
      'waitct1',
      'waitct2',
      'waitct3',
      'waitfbw',
      'waitint',
      'waitpat',
      'waitse1',
      'waitse2',
      'waitse3',
      'waitse4',
      'waitx',
      'waitxfi',
      'waitxmt',
      'waitxrl',
      'waitxro',
      'wfbyte',
      'wflong',
      'wfword',
      'wmlong',
      'wrbyte',
      'wrc',
      'wrfast',
      'wrlong',
      'wrlut',
      'wrnc',
      'wrnz',
      'wrpin',
      'wrword',
      'wrz',
      'wxpin',
      'wypin',
      'xcont',
      'xinit',
      'xor',
      'xoro32',
      'xstop',
      'xzero',
      'zerox'
    ];
    const instructionStatus: boolean = pasmInstructions.indexOf(name.toLowerCase()) != -1;
    return instructionStatus;
  }

  public isP1AsmInstruction(name: string): boolean {
    // mark these RED if seen in P2 code
    const p1asmInstructions: string[] = [
      'absneg',
      'addabs',
      'clkset',
      'hubop',
      'jmpret',
      'lockclr',
      'lockset',
      'max',
      'maxs',
      'min',
      'mins',
      'movd',
      'movi',
      'movs',
      'subabs',
      'waitcnt',
      'waitpeq',
      'waitpne',
      'waitvid'
    ];
    const instructionStatus: boolean = p1asmInstructions.indexOf(name.toLowerCase()) != -1;
    return instructionStatus;
  }

  public isP1SpinVariable(name: string): boolean {
    // mark these RED if seen in P2 code
    const p1spinVariables: string[] = ['result'];
    const instructionStatus: boolean = p1spinVariables.indexOf(name.toLowerCase()) != -1;
    return instructionStatus;
  }

  public isP1SpinMethod(name: string): boolean {
    // mark these RED if seen in P2 code
    const p1spinMethods: string[] = ['lockclr', 'lockset', 'constant', 'chipver', 'cognew', 'waitcnt', 'waitpeq', 'waitpne', 'waitvid', 'reboot'];
    const instructionStatus: boolean = p1spinMethods.indexOf(name.toLowerCase()) != -1;
    return instructionStatus;
  }

  public isP1AsmVariable(name: string): boolean {
    // mark these RED if seen in P2 code
    const p1asmVariables: string[] = [
      '_clkmode',
      '_free',
      '_stack',
      'cnt',
      'xtal1',
      'xtal2',
      'xtal3',
      'rcfast',
      'rcslow',
      'pll1x',
      'pll2x',
      'pll4x',
      'pll8x',
      'pll16x',
      'ctra',
      'ctrb',
      'frqa',
      'frqb',
      'phsa',
      'phsb',
      'vcfg',
      'vscl',
      'par',
      'spr'
    ];
    const instructionStatus: boolean = p1asmVariables.indexOf(name.toLowerCase()) != -1;
    return instructionStatus;
  }

  public isP2AsmNonArgumentInstruction(name: string): boolean {
    const pasmNonArgumentInstructions: string[] = [
      'nop',
      'resi3',
      'resi2',
      'resi1',
      'resi0',
      'reti3',
      'reti2',
      'reti1',
      'reti0',
      'xstop',
      'allowi',
      'stalli',
      'trgint1',
      'trgint2',
      'trgint3',
      'nixint1',
      'nixint2',
      'nixint3',
      'ret',
      'reta',
      'retb',
      'pollint',
      'pollct1',
      'pollct2',
      'pollct3',
      'pollse1',
      'pollse2',
      'pollse3',
      'pollse4',
      'pollpat',
      'pollfbw',
      'pollxmt',
      'pollxfi',
      'pollxro',
      'pollxrl',
      'pollatn',
      'pollqmt',
      'waitint',
      'waitct1',
      'waitct2',
      'waitct3',
      'waitse1',
      'waitse2',
      'waitse3',
      'waitse4',
      'waitpat',
      'waitfbw',
      'waitxmt',
      'waitxfi',
      'waitxro',
      'waitxrl',
      'waitatn'
    ];
    const instructionStatus: boolean = pasmNonArgumentInstructions.indexOf(name.toLowerCase()) != -1;
    return instructionStatus;
  }

  public isIllegalInlinePAsmDirective(name: string): boolean {
    const illegalInlinePAsmDirective: string[] = ['alignw', 'alignl', 'file', 'orgh'];
    const illegalStatus: boolean = illegalInlinePAsmDirective.indexOf(name.toLowerCase()) != -1;
    return illegalStatus;
  }

  public isBadP1AsmEffectOrConditional(name: string): boolean {
    let returnStatus: boolean = this.isBadP1AsmEffect(name);
    if (name.length >= 2) {
      const checkType: string = name.toUpperCase();
      if (checkType == 'IF_ALWAYS' || checkType == 'IF_NEVER') {
        returnStatus = true;
      }
    }
    return returnStatus;
  }

  public isBadP1AsmEffect(name: string): boolean {
    let returnStatus: boolean = false;
    if (name.length >= 2) {
      const checkType: string = name.toUpperCase();
      if (checkType == 'NR' || checkType == 'WR') {
        returnStatus = true;
      }
    }
    return returnStatus;
  }

  public isP2AsmEffect(name: string): boolean {
    let returnStatus: boolean = false;
    if (name.length >= 2) {
      const checkType: string = name.toUpperCase();
      if (
        checkType == 'WC' ||
        checkType == 'WZ' ||
        checkType == 'WCZ' ||
        checkType == 'XORC' ||
        checkType == 'XORZ' ||
        checkType == 'ORC' ||
        checkType == 'ORZ' ||
        checkType == 'ANDC' ||
        checkType == 'ANDZ'
      ) {
        returnStatus = true;
      }
    }
    return returnStatus;
  }

  public isDatOrPAsmLabel(name: string): boolean {
    if (name === undefined || name === null || name.length === 0) {
      name = ' ';
      this._logMessage(`sp2u:  -- isDatOrPAsmLabel([{undefined??ERROR!!!}]) = (false)`);
    }
    let haveLabelStatus: boolean = name.charAt(0).match(/[a-zA-Z_.:]/) ? true : false;
    if (haveLabelStatus) {
      if (this.isDatNFileStorageType(name)) {
        haveLabelStatus = false;
      } else if (name.toUpperCase() == 'DAT') {
        haveLabelStatus = false;
      } else if (this.isIllegalInlinePAsmDirective(name)) {
        // these can't be label either!
        haveLabelStatus = false;
      } else if (this.isP2AsmReservedSymbols(name)) {
        haveLabelStatus = false;
      } else if (name.toUpperCase().startsWith('IF_') || name.toUpperCase() == '_RET_') {
        haveLabelStatus = false;
      } else if (this.isP2AsmEffect(name)) {
        haveLabelStatus = false;
      } else if (this.isP2AsmNonArgumentInstruction(name)) {
        haveLabelStatus = false;
      } else if (this.isP2AsmInstruction(name)) {
        haveLabelStatus = false;
      } else if (this.isBadP1AsmEffectOrConditional(name) && !this.isBadP1AsmEffect(name)) {
        haveLabelStatus = false;
      } else if (this.isP1AsmInstruction(name)) {
        haveLabelStatus = false;
      } else if (this.isSpinPAsmLangDirective(name)) {
        haveLabelStatus = false;
      }
    }
    return haveLabelStatus;
  }

  public isDatNFileStorageType(name: string): boolean {
    // storage type + RES + FILE
    let returnStatus: boolean = false;
    if (name.length > 2) {
      const checkType: string = name.toUpperCase();
      // yeah, FILE too!  (oddly enough)
      if (checkType == 'FILE') {
        returnStatus = true;
      } else {
        returnStatus = this.isDatStorageType(name);
      }
    }
    return returnStatus;
  }

  public isDatStorageType(name: string): boolean {
    // storage type + RES
    let returnStatus: boolean = false;
    if (name.length > 2) {
      const checkType: string = name.toUpperCase();
      if (checkType == 'RES') {
        returnStatus = true;
      } else {
        returnStatus = this.isStorageType(name);
      }
    }
    return returnStatus;
  }

  public isStorageType(name: string): boolean {
    // storage type : (BYTE|WORD)FIT, BYTE, WORD, LONG
    let returnStatus: boolean = false;
    if (name.length > 3) {
      const checkType: string = name.toUpperCase();
      if (checkType == 'BYTEFIT' || checkType == 'WORDFIT' || checkType == 'BYTE' || checkType == 'WORD' || checkType == 'LONG') {
        returnStatus = true;
      }
    }
    return returnStatus;
  }

  public isSpecialIndexType(name: string): boolean {
    // have a 'reg' of reg[cog-address][index].[bitfield]
    // have a 'byte' of byte[hub-address][index].[bitfield]
    // have a 'word' of word[hub-address][index].[bitfield]
    // have a 'long' of long[hub-address][index].[bitfield]
    let returnStatus: boolean = false;
    if (name.length >= 3) {
      const checkType: string = name.toUpperCase();
      if (checkType == 'REG' || checkType == 'BYTE' || checkType == 'WORD' || checkType == 'LONG') {
        returnStatus = true;
      }
    }
    return returnStatus;
  }

  public isAlignType(name: string): boolean {
    // align type : ALIGNL, ALIGNW
    let returnStatus: boolean = false;
    if (name.length > 5) {
      const checkType: string = name.toUpperCase();
      if (checkType == 'ALIGNL' || checkType == 'ALIGNW') {
        returnStatus = true;
      }
    }
    return returnStatus;
  }

  private _tableSpinStorageTypes: { [Identifier: string]: string } = {
    byte: '8-bit storage',
    word: '16-bit storage',
    long: '32-bit storage',
    bytefit: 'like BYTE for use in DAT sections, but verifies BYTE data are -$80 to $FF',
    wordfit: 'like WORD for use in DAT sections, but verifies word data are -$8000 to $FFFF'
  };

  private _tableSpinStorageTypes_v45: { [Identifier: string]: string } = {
    // found in CON only!!
    struct: 'structured storage'
  };

  private _tableSpinStorageSpecials: { [Identifier: string]: string[] } = {
    res: ['RES n', "reserve n register(s), advance cog address by n, don't advance hub address"],
    file: ['FileDat  FILE "Filename"', 'include binary file, "FileDat" is a BYTE symbol that points to file']
  };

  private _tableSpinAlignment: { [Identifier: string]: string } = {
    alignw: 'word-align to hub memory, advances variable pointer as necessary',
    alignl: 'long-align to hub memory, advances variable pointer as necessary'
  };

  private _docTextForSpinStorageTypesAlignment(name: string): IBuiltinDescription {
    const nameKey: string = name.toLowerCase();
    const desiredDocText: IBuiltinDescription = {
      found: false,
      type: eBuiltInType.Unknown,
      category: '',
      description: '',
      signature: ''
    };
    if (nameKey in this._tableSpinStorageTypes) {
      desiredDocText.found = true;
      desiredDocText.category = 'Storage Types';
      desiredDocText.description = this._tableSpinStorageTypes[nameKey];
    } else if (this.requestedSpinVersion(45) && nameKey in this._tableSpinStorageTypes_v45) {
      desiredDocText.found = true;
      desiredDocText.category = 'Storage Types';
      desiredDocText.description = this._tableSpinStorageTypes_v45[nameKey];
    } else if (nameKey in this._tableSpinAlignment) {
      desiredDocText.found = true;
      desiredDocText.category = 'DAT Alignment';
      desiredDocText.description = this._tableSpinAlignment[nameKey];
    } else if (nameKey in this._tableSpinStorageSpecials) {
      desiredDocText.found = true;
      desiredDocText.category = 'DAT Special';
      const protoWDescr: string[] = this._tableSpinStorageSpecials[nameKey];
      desiredDocText.signature = protoWDescr[0];
      desiredDocText.description = protoWDescr[1];
    }
    return desiredDocText;
  }

  // ---------------- new debug() support ----------------
  //  updated: 26 Mar 2022  - (as of Spin2 v35s)
  //  debug() statements for special displays support the following
  //    plot      - General-purpose plotter with cartesian and polar modes
  //    term      - Text terminal with up to 300 x 200 characters, 6..200 point font size, 4 simultaneous color schemes
  //    midi      - Piano keyboard with 1..128 keys, velocity depiction, variable screen scale
  //    logic     - PDM, Logic analyzer with single and multi-bit labels, 1..32 channels, can trigger on pattern
  //    scope     - PDM, Oscilloscope with 1..8 channels, can trigger on level with hysteresis
  //    scope_xy  - PDM, XY oscilloscope with 1..8 channels, persistence of 0..512 samples, polar mode, log scale mode
  //    fft       - PDM, Fast Fourier Transform with 1..8 channels, 4..2048 points, windowed results, log scale mode
  //    spectro   - PDM, Spectrograph with 4..2048-point FFT, windowed results, phase-coloring, and log scale mode
  //    bitmap    - PDM, Bitmap, 1..2048 x 1..2048 pixels, 1/2/4/8/16/32-bit pixels with 19 color systems, 15 direction/autoscroll modes, independent X and Y pixel size of 1..256
  // ----------------------------------------------------
  private _tableDebugDisplayTypes: { [Identifier: string]: string } = {
    plot: 'General-purpose plotter with cartesian and polar modes',
    term: 'Text terminal with up to 300 x 200 characters, 6..200 point font size, 4 simultaneous color schemes',
    midi: 'Piano keyboard with 1..128 keys, velocity depiction, variable screen scale',
    logic: 'PDM, Logic analyzer with single and multi-bit labels, 1..32 channels, can trigger on pattern',
    scope: 'PDM, Oscilloscope with 1..8 channels, can trigger on level with hysteresis',
    scope_xy: 'PDM, XY oscilloscope with 1..8 channels, persistence of 0..512 samples, polar mode, log scale mode',
    fft: 'PDM, Fast Fourier Transform with 1..8 channels, 4..2048 points, windowed results, log scale mode',
    spectro: 'PDM, Spectrograph with 4..2048-point FFT, windowed results, phase-coloring, and log scale mode',
    bitmap:
      'PDM, Bitmap, 1..2048 x 1..2048 pixels, 1/2/4/8/16/32-bit pixels with 19 color systems, 15 direction/autoscroll modes, independent X and Y pixel size of 1..256'
  };

  // ----------------------------------------------------------------------------
  // DEBUG display DIRECTIVE documentation (hover)
  //
  // A directive's meaning depends on BOTH the display type AND whether it appears in a
  //  window-CREATION message (config) or a window-UPDATE message (feed):
  //    - on TERM, SIZE is in CHARACTERS; on PLOT it is in PIXELS
  //    - on TERM, BACKCOLOR is the canvas fill at config time but the TEXT background at runtime
  //  So lookup is keyed [displayType][config|feed], falling back to the shared table.
  //
  // Source: P2 Knowledge Base (PNut/Spin2 v55 DebugDisplayUnit.pas + Spin2 Lang Ref v51a)
  // ----------------------------------------------------------------------------

  private _tableDebugDirectivesShared: { [Identifier: string]: TDebugDirective } = {
    title: {
      signature: "TITLE 'string'",
      description:
        'Window title-bar text. Text uses SINGLE quotes -- a double-quoted argument is silently ignored with no compile error.<br>Default caption is `<name> - <TYPE>`.'
    },
    pos: {
      signature: 'POS left top',
      description:
        'OPTIONAL window screen offset, in pixels.<br>Omit POS and the *display host* places the window -- where it lands is TOOL-dependent, not a P2 behavior: some hosts auto-arrange so windows do not overlap, others stack every window at the same origin (hiding all but one). Supply POS explicitly whenever layout matters.'
    },
    hidexy: {
      signature: 'HIDEXY',
      description: 'Hide the on-screen coordinate readout.<br>Does NOT disable `PC_MOUSE` reporting -- the values still come back to the P2.'
    },
    clear: { signature: 'CLEAR', description: 'Clear the window contents.' },
    close: {
      signature: 'CLOSE',
      description:
        'Close (free) this named window, reclaiming one of the 32 display slots.<br>Command ONLY -- takes no arguments. Accepts more than one window name in a message. UPDATE-FIRST / CLOSE-SECOND: the rest of the message runs before the close, so ``` `Win SAVE `shot` CLOSE ``` saves and *then* closes.<br>Distinct from `DEBUG(DEBUG_END_SESSION)`, which ends the whole DEBUG session.'
    },
    window: {
      signature: "SAVE WINDOW 'filename'",
      description:
        'MODIFIER of `SAVE` -- not a directive on its own.<br>Without it `SAVE` writes only the DISPLAY AREA; with it the ENTIRE window (frame and title bar included) is written.<br>Must sit between `SAVE` and the filename, which stays LAST.'
    },
    pc_key: { signature: 'PC_KEY', description: 'Transmit the latched host keypress back to the P2 as one LONG (0 if none), then clear it.' },
    pc_mouse: {
      signature: 'PC_MOUSE',
      description:
        'Transmit host mouse state back to the P2 as a LONG pair: position + wheel + L/M/R buttons, then the RGB under the cursor.<br>Off-text-area sentinel is `$03FFFFFF` / `$FFFFFFFF`.'
    }
  };

  private _tableDebugDirectivesTermConfig: { [Identifier: string]: TDebugDirective } = {
    size: {
      signature: 'SIZE cols rows',
      description:
        'Terminal size in **CHARACTERS** (columns x rows) -- **not pixels**. A common source of error.<br>`cols` 1..256 (default 40), `rows` 1..256 (default 20).'
    },
    textsize: { signature: 'TEXTSIZE n', description: 'Font point size.<br>`n` 6..200 (default 10).' },
    color: {
      signature: 'COLOR c0 .. c7',
      description:
        'Up to 8 RGB24 values = **4 text/background pairs** (pair0=c0,c1 ... pair3=c6,c7), selected at runtime by control codes 4..7.<br>Default pairs: ORANGE/BLACK, BLACK/ORANGE, GREEN/BLACK, BLACK/GREEN.<br>CAUTION: the defaults are palette literals -- default green is `$00FF00`, default orange is `$FF7F00`. The typeable `GREEN` keyword is COMPUTED and resolves to `$09FF09` at its default brightness, which is NOT the same value. To reproduce a default exactly, write the `$RRGGBB` literal.'
    },
    backcolor: {
      signature: 'BACKCOLOR color',
      description:
        'CONFIG sense: the canvas fill color used for clear and scroll.<br>Distinct from the runtime `BACKCOLOR`, which sets the TEXT background.'
    },
    update: {
      signature: 'UPDATE',
      description: 'CONFIG sense: enable buffered mode -- output accumulates and is shown only when a runtime `UPDATE` flushes it.'
    }
  };

  private _tableDebugDirectivesTermFeed: { [Identifier: string]: TDebugDirective } = {
    backcolor: {
      signature: 'BACKCOLOR color',
      description: 'RUNTIME sense: sets the TEXT background color only.<br>Distinct from the config-time `BACKCOLOR`, which is the canvas fill.'
    },
    update: {
      signature: 'UPDATE',
      description: 'RUNTIME sense: flush buffered output to the canvas (only meaningful when the window was created with `UPDATE`).'
    },
    save: {
      signature: "SAVE {WINDOW} 'filename'",
      description:
        'Write a `.bmp` of the display area -- or of the ENTIRE window if `WINDOW` is given -- to `<filename>.bmp`.<br>`filename` is REQUIRED and must be LAST: a bare `SAVE` writes nothing, silently. The extension is appended for you -- give the base name only.'
    },
    clear: { signature: 'CLEAR', description: 'Clear the window and home the cursor to (0,0).' }
  };

  // Packed-data color modes, accepted by PLOT (and later BITMAP) in BOTH the config and
  //  the update phase -- spread into each of those tables rather than duplicated.
  private _tableDebugColorModes: TDebugDirectiveTable = {
    lut1: { signature: 'LUT1', description: 'Color mode: 1 bit per pixel, indexed through `LUTCOLORS`.' },
    lut2: { signature: 'LUT2', description: 'Color mode: 2 bits per pixel, indexed through `LUTCOLORS`.' },
    lut4: { signature: 'LUT4', description: 'Color mode: 4 bits per pixel, indexed through `LUTCOLORS`.' },
    lut8: { signature: 'LUT8', description: 'Color mode: 8 bits per pixel, indexed through `LUTCOLORS`.' },
    luma8: { signature: 'LUMA8', description: 'Color mode: 8-bit luminance.<br>`LUMA8W` and `LUMA8X` are the word/long-packed variants.' },
    luma8w: { signature: 'LUMA8W', description: 'Color mode: 8-bit luminance, WORD-packed.' },
    luma8x: { signature: 'LUMA8X', description: 'Color mode: 8-bit luminance, LONG-packed.' },
    hsv8: { signature: 'HSV8', description: 'Color mode: 8-bit hue/saturation/value.<br>`HSV8W` and `HSV8X` are the word/long-packed variants.' },
    hsv8w: { signature: 'HSV8W', description: 'Color mode: 8-bit HSV, WORD-packed.' },
    hsv8x: { signature: 'HSV8X', description: 'Color mode: 8-bit HSV, LONG-packed.' },
    rgbi8: { signature: 'RGBI8', description: 'Color mode: 8-bit RGB + intensity.<br>`RGBI8W` and `RGBI8X` are the word/long-packed variants.' },
    rgbi8w: { signature: 'RGBI8W', description: 'Color mode: 8-bit RGB + intensity, WORD-packed.' },
    rgbi8x: { signature: 'RGBI8X', description: 'Color mode: 8-bit RGB + intensity, LONG-packed.' },
    rgb8: { signature: 'RGB8', description: 'Color mode: 8-bit RGB (3:3:2).' },
    hsv16: { signature: 'HSV16', description: 'Color mode: 16-bit HSV.<br>`HSV16W` and `HSV16X` are the word/long-packed variants.' },
    hsv16w: { signature: 'HSV16W', description: 'Color mode: 16-bit HSV, WORD-packed.' },
    hsv16x: { signature: 'HSV16X', description: 'Color mode: 16-bit HSV, LONG-packed.' },
    rgb16: { signature: 'RGB16', description: 'Color mode: 16-bit RGB (5:6:5).' },
    rgb24: { signature: 'RGB24', description: 'Color mode: 24-bit RGB, one `$RRGGBB` long per pixel.' }
  };

  private _tableDebugDirectivesPlotConfig: TDebugDirectiveTable = {
    ...this._tableDebugColorModes,
    size: {
      signature: 'SIZE width height',
      description:
        'Canvas size in **PIXELS**.<br>Each 32..2048 (default 256x256).<br>Contrast `TERM`, whose SIZE is in CHARACTERS -- the two displays do NOT share units.'
    },
    dotsize: {
      signature: 'DOTSIZE x {y}',
      description:
        'Pixel scale, each axis 1..256 (default 1x1; `y` copies `x` when omitted).<br>ALSO the divisor applied to reported `PC_MOUSE` cursor coordinates -- change DOTSIZE and the coordinates you read back change with it.'
    },
    lutcolors: {
      signature: 'LUTCOLORS rgb24...',
      description: 'Palette for the LUT color modes.<br>Up to 256 longs -- supply as many as the selected LUT mode actually uses.'
    },
    backcolor: { signature: 'BACKCOLOR color', description: 'Canvas background color (default `BLACK`).' },
    update: {
      signature: 'UPDATE',
      description:
        'CONFIG sense: enable buffered / manual-refresh mode.<br>Drawing accumulates in `Bitmap[0]` and reaches the screen only when a runtime `UPDATE` flushes it.'
    }
  };

  private _tableDebugDirectivesPlotFeed: TDebugDirectiveTable = {
    ...this._tableDebugColorModes,
    // ---- color / pen state ----
    color: {
      signature: 'COLOR (value | named {brightness})',
      description:
        'Drawing color: an RGB value, or a named color (`BLACK WHITE ORANGE BLUE GREEN CYAN RED MAGENTA YELLOW GRAY`) with an optional 0..15 brightness nibble on all but BLACK/WHITE.<br>A COLOR issued immediately before a `TEXT` directive also sets the TEXT color.'
    },
    opacity: {
      signature: 'OPACITY n',
      description:
        'Alpha for subsequent drawing, 0..255 (default 255 = most opaque).<br>TRAP: this is NOT a saturating clamp -- the value is truncated to a byte on store, so it WRAPS mod 256. `OPACITY 256` becomes 0 = FULLY TRANSPARENT, so reaching past the top of the range for "more opaque" makes everything you draw next invisible; `OPACITY 300` becomes 44.<br>The wrap belongs to this directive: the inline opacity argument on `DOT`/`LINE`/shape directives takes a different parse path -- do not assume it behaves the same.'
    },
    precise: {
      signature: 'PRECISE',
      description:
        'TOGGLE sub-pixel coordinates -- 8.8 fixed-point, coordinates shifted `<<8`.<br>Starts OFF at window creation, and each `PRECISE` flips it. It is not a set-on directive.'
    },
    linesize: { signature: 'LINESIZE n', description: 'Stroke width for subsequent strokes.' },
    lutcolors: { signature: 'LUTCOLORS rgb24...', description: 'RUNTIME sense: replace the LUT palette (up to 256 longs).' },
    backcolor: { signature: 'BACKCOLOR color', description: 'RUNTIME sense: set the background color used by `CLEAR`.' },
    // ---- geometry ----
    origin: { signature: 'ORIGIN {x y}', description: 'Set the drawing origin.<br>With no arguments, uses the current position.' },
    set: { signature: 'SET x y', description: 'Set the current pen position.<br>Polar-converted when `POLAR` is active.' },
    dot: {
      signature: 'DOT {linesize {opacity}}',
      description: 'Plot a dot at the current position (defaults to the current LINESIZE / OPACITY).<br>Does NOT advance the current position.'
    },
    line: {
      signature: 'LINE x y {linesize {opacity}}',
      description: 'Line from the current position to `x,y`.<br>ADVANCES the current position to the destination -- unlike `DOT`.'
    },
    circle: {
      signature: 'CIRCLE width {linesize {opacity}}',
      description: 'Circle CENTERED on the current position.<br>`linesize` 0 draws it FILLED.'
    },
    oval: {
      signature: 'OVAL width height {linesize {opacity}}',
      description: 'Ellipse CENTERED on the current position.<br>`linesize` 0 draws it FILLED.'
    },
    box: {
      signature: 'BOX width height {linesize {opacity}}',
      description: 'Rectangle CENTERED on the current position.<br>`linesize` 0 draws it FILLED.'
    },
    obox: {
      signature: 'OBOX width height xradius yradius {linesize {opacity}}',
      description:
        'ROUNDED rectangle -- corner radii `xradius`/`yradius` -- centered on the current position.<br>Rounded, NOT merely outlined: `linesize` 0 draws it filled, same as `BOX`.'
    },
    polar: {
      signature: 'POLAR {twopi {theta}}',
      description:
        'Interpret subsequent coordinates as POLAR (rho, theta).<br>`twopi` = full-circle units (default `$100000000`): 0 means +$100000000 (default, counter-clockwise), -1 means -$100000000 (clockwise) -- 0 and -1 are NOT equivalent. Any other value is taken literally, so 360 gives degrees.<br>theta=0 points EAST (+x); positive `twopi` increases theta counter-clockwise. `theta` is an angular offset (default 0).'
    },
    cartesian: {
      signature: 'CARTESIAN {flipy {flipx}}',
      description:
        'Interpret coordinates as CARTESIAN, with optional axis-flip flags (0 or 1).<br>DEFAULT orientation (both flags 0, the state at window creation) is origin BOTTOM-LEFT, x rightward, y UPWARD -- the mathematical convention, NOT the screen convention.<br>`flipy` 1 selects Y-DOWN (screen-native, origin top-left); `flipx` 1 makes x increase leftward.'
    },
    // ---- text ----
    text: {
      signature: "TEXT {size {style {angle}}} 'string'",
      description:
        'Draw text at the current position.<br>The optional inline size/style/angle override `TEXTSIZE`/`TEXTSTYLE`/`TEXTANGLE` for this string only.'
    },
    textsize: { signature: 'TEXTSIZE n', description: 'Label font point size (clamped 6..200).' },
    textstyle: {
      signature: 'TEXTSTYLE n',
      description:
        'Style byte 0..255: weight bits0-1, italic bit2, underline bit3, horizontal-align bits4-5, vertical-align bits6-7.<br>Align is per-axis: horizontal %10=right, %11=left; vertical %10=top, %11=bottom (%00/%01 center on both).<br>TRAP: the weight field selects a NOMINAL weight (0=thin, 1=normal, 2=bold, 3=heavy) that the DEBUG font does not render as a progression -- `$00` looks identical to the `$01` default, and `$02`/`$03` render with slightly LESS ink, not more. Do not rely on it to bolden text.'
    },
    textangle: { signature: 'TEXTANGLE n', description: 'Text rotation: degrees 0..359 in Cartesian, or 0..twopi in polar.' },
    // ---- bitmap layers / sprites ----
    layer: { signature: "LAYER n 'file.bmp'", description: 'Load a BMP into layer buffer `n` (1..8).<br>The `.bmp` file must already exist.' },
    crop: {
      signature: 'CROP layer (AUTO x y | left top width height {x y})',
      description: 'Copy a region of a layer to the canvas.<br>With no arguments, blits the full layer at 0,0.'
    },
    spritedef: {
      signature: 'SPRITEDEF id xsize ysize pixels... colors...',
      description:
        'Define a sprite: `id` 0..255; `xsize`,`ysize` 1..32 each; then `xsize*ysize` palette-index bytes (0..255); then the palette colors those indices reference, as `$AARRGGBB` longs.<br>Up to 256 colors -- the parser reads colors until the message ENDS, so supply only as many as your indices actually use.'
    },
    sprite: {
      signature: 'SPRITE id {orientation {scale {opacity}}}',
      description:
        'Render a defined sprite at the current position.<br>`id` 0..255; `orientation` 0..7 (default 0); `scale` 1..64 (default 1); `opacity` 0..255 (defaults to the current OPACITY).'
    },
    // ---- window ----
    clear: { signature: 'CLEAR', description: 'Clear the canvas to the background color.' },
    update: {
      signature: 'UPDATE',
      description:
        'RUNTIME sense: copy the accumulated buffer (`Bitmap[0]`) to the screen.<br>Only meaningful when the window was created with `UPDATE`.'
    },
    save: {
      signature: "SAVE {WINDOW | l t w h} 'filename'",
      description:
        "Write a `.bmp` of the canvas to `<filename>.bmp`.<br>`SAVE l t w h 'name'` writes a DESKTOP region instead; `SAVE WINDOW 'name'` writes the whole window.<br>`filename` is REQUIRED and must be LAST: a bare `SAVE` writes nothing, silently. The extension is appended for you -- give the base name only."
    }
  };

  // Sample-PACKING modes, accepted on the create line by the PDM-family displays
  //  (LOGIC SCOPE SCOPE_XY FFT SPECTRO). These are a DIFFERENT family from PLOT's
  //  packed COLOR modes above -- do not spread the two into the same display type.
  private _tableDebugPackedModes: TDebugDirectiveTable = {
    longs_1bit: {
      signature: 'LONGS_1BIT',
      description:
        'Sample packing: 32 x 1-bit sub-samples per LONG.<br>Omit every packing mode and the stream is UNPACKED -- one full 32-bit sample per long.'
    },
    longs_2bit: {
      signature: 'LONGS_2BIT',
      description:
        'Sample packing: 16 x 2-bit sub-samples per LONG.<br>Omit every packing mode and the stream is UNPACKED -- one full 32-bit sample per long.'
    },
    longs_4bit: {
      signature: 'LONGS_4BIT',
      description:
        'Sample packing: 8 x 4-bit sub-samples per LONG.<br>Omit every packing mode and the stream is UNPACKED -- one full 32-bit sample per long.'
    },
    longs_8bit: {
      signature: 'LONGS_8BIT',
      description:
        'Sample packing: 4 x 8-bit sub-samples per LONG.<br>Omit every packing mode and the stream is UNPACKED -- one full 32-bit sample per long.'
    },
    longs_16bit: {
      signature: 'LONGS_16BIT',
      description:
        'Sample packing: 2 x 16-bit sub-samples per LONG.<br>Omit every packing mode and the stream is UNPACKED -- one full 32-bit sample per long.'
    },
    words_1bit: {
      signature: 'WORDS_1BIT',
      description:
        'Sample packing: 16 x 1-bit sub-samples per WORD.<br>Omit every packing mode and the stream is UNPACKED -- one full 32-bit sample per long.'
    },
    words_2bit: {
      signature: 'WORDS_2BIT',
      description:
        'Sample packing: 8 x 2-bit sub-samples per WORD.<br>Omit every packing mode and the stream is UNPACKED -- one full 32-bit sample per long.'
    },
    words_4bit: {
      signature: 'WORDS_4BIT',
      description:
        'Sample packing: 4 x 4-bit sub-samples per WORD.<br>Omit every packing mode and the stream is UNPACKED -- one full 32-bit sample per long.'
    },
    words_8bit: {
      signature: 'WORDS_8BIT',
      description:
        'Sample packing: 2 x 8-bit sub-samples per WORD.<br>Omit every packing mode and the stream is UNPACKED -- one full 32-bit sample per long.'
    },
    bytes_1bit: {
      signature: 'BYTES_1BIT',
      description:
        'Sample packing: 8 x 1-bit sub-samples per BYTE.<br>Omit every packing mode and the stream is UNPACKED -- one full 32-bit sample per long.'
    },
    bytes_2bit: {
      signature: 'BYTES_2BIT',
      description:
        'Sample packing: 4 x 2-bit sub-samples per BYTE.<br>Omit every packing mode and the stream is UNPACKED -- one full 32-bit sample per long.'
    },
    bytes_4bit: {
      signature: 'BYTES_4BIT',
      description:
        'Sample packing: 2 x 4-bit sub-samples per BYTE.<br>Omit every packing mode and the stream is UNPACKED -- one full 32-bit sample per long.'
    }
  };

  private _tableDebugDirectivesLogicConfig: TDebugDirectiveTable = {
    ...this._tableDebugPackedModes,
    samples: {
      signature: 'SAMPLES n',
      description:
        'Number of samples displayed across the window.<br>Range `4`..`2047`, default `32`.<br>**A single integer only** -- LOGIC has NO `{first last}` two-value form; that shape belongs to FFT/SPECTRO.<br>Also sets the initial `HOLDOFF` value.'
    },
    spacing: {
      signature: 'SPACING n',
      description:
        '**HORIZONTAL** pixel spacing between successive samples -- the X-axis time base.<br>Range `1`..`32`, default `8`.<br>This is NOT vertical channel spacing: the per-channel vertical pitch is fixed at the font cell height and cannot be changed.'
    },
    rate: {
      signature: 'RATE n',
      description:
        'Draw-rate divisor -- draw every Nth qualifying sample.<br>Range `1`..`2048`, default `1`.<br>This is NOT a sample rate; it only thins what gets drawn.'
    },
    dotsize: {
      signature: 'DOTSIZE n',
      description:
        'Sample dot diameter, a single scalar.<br>Range `0`..`32`, default `0` = no dots -- dots are OFF unless you ask for them.<br>A single scalar only: LOGIC has NO `x {y}` two-axis form; that shape belongs to PLOT/BITMAP/SPECTRO.'
    },
    linesize: { signature: 'LINESIZE n', description: 'Waveform line thickness in pixels.<br>Range `1`..`32`, default `3`.' },
    textsize: { signature: 'TEXTSIZE n', description: 'Label font point size.<br>Range `6`..`200`, default `10`.' },
    color: {
      signature: 'COLOR back grid',
      description:
        'Background color then grid color, in that order -- each a named color or an RGB24 value.<br>Defaults: background black `$000000`, grid gray `$404040`.<br>Trace colors are NOT set here; each belongs to its channel-definition string.'
    },
    range: {
      signature: 'RANGE',
      description:
        'Modifier inside a channel-definition string.<br>With a channel count `>= 2`, RANGE makes those bits ONE multi-bit bus value drawn as an analog-style waveform, instead of that many independent single-bit traces.<br>The bus is shown as a raw value only -- there is NO protocol decoding of any kind.'
    },
    alt: {
      signature: 'ALT',
      description: 'Optional modifier on a packing mode -- bit-reverses each sub-unit on unpack.<br>May be combined with `SIGNED`.'
    },
    signed: {
      signature: 'SIGNED',
      description: 'Optional modifier on a packing mode -- sign-extends each sub-sample on unpack.<br>May be combined with `ALT`.'
    }
  };

  private _tableDebugDirectivesLogicFeed: TDebugDirectiveTable = {
    trigger: {
      signature: 'TRIGGER mask match {offset}',
      description:
        'Mask/match trigger. The compare is `((sample XOR match) AND mask) == 0` -- bits OUTSIDE the mask are DONT-CARES, and `match` is compared only on the masked bits. (The AND-form `(sample AND mask) == match` is equivalent only when `match` is a subset of `mask` -- do not rely on it.)<br>**EDGE-armed, not a level match:** the window arms on a NON-matching sample, then fires on the next sample that matches. A stream already sitting in the match state never fires until it leaves and re-enters.<br>`offset` `0`..`SAMPLES-1`, default `SAMPLES/2`, positions the trigger within the capture.<br>Re-issuing TRIGGER resets the armed state.<br>Single mask/match compare only -- NOT an I2C/SPI/UART decoder, edge-sequence, or glitch engine.'
    },
    holdoff: {
      signature: 'HOLDOFF n',
      description:
        'Minimum number of samples between triggers.<br>Range `2`..`2048`; the initial value is whatever `SAMPLES` was at configure time, NOT a fixed constant.<br>Supplying a count sets the holdoff AND resets its counter to 0.<br>**A bare `HOLDOFF` with no count is a silent no-op** -- it leaves both the holdoff and its counter unchanged.'
    },
    clear: {
      signature: 'CLEAR',
      description:
        'Clear the display AND reset the sample-population and rate counters.<br>More than a visual wipe: it restarts the capture accounting.'
    },
    save: {
      signature: "SAVE {WINDOW} 'filename'",
      description:
        'Write a `.bmp` of the display area -- or of the ENTIRE window if `WINDOW` is given -- to `<filename>.bmp`.<br>An `l t w h` region variant selects a sub-rectangle.<br>`filename` is REQUIRED. Use SINGLE quotes: a double-quoted argument is silently ignored with no compile error.'
    }
  };

  private _tableDebugDirectivesScopeConfig: TDebugDirectiveTable = {
    ...this._tableDebugPackedModes,
    size: { signature: 'SIZE width height', description: 'Window size in PIXELS.<br>Each of `width` and `height` is `32`..`2048`, default 256x256.' },
    samples: {
      signature: 'SAMPLES n',
      description:
        'Horizontal resolution -- the number of sample columns across the window.<br>Range `16`..`2048`, default `256`.<br>Also sets two runtime defaults: `HOLDOFF` defaults to `SAMPLES`, and the `TRIGGER` offset defaults to `SAMPLES/2`.'
    },
    rate: { signature: 'RATE n', description: 'Draw-rate divisor.<br>Range `1`..`2048`, default `1`.' },
    dotsize: {
      signature: 'DOTSIZE n',
      description:
        'Sample dot diameter in pixels.<br>Range `0`..`32`, **default `0` -- dots are OFF by default**; the trace is drawn as lines via `LINESIZE`.<br>TRAP: if BOTH `DOTSIZE` and `LINESIZE` are 0, DOTSIZE is forced to 1 so something is still drawn.'
    },
    linesize: {
      signature: 'LINESIZE n',
      description:
        'Trace line thickness in pixels.<br>Range `0`..`32`, default `3` (lines on).<br>Set 0 for a dots-only display -- but then give a non-zero `DOTSIZE`, or DOTSIZE is forced to 1.'
    },
    textsize: { signature: 'TEXTSIZE n', description: 'Label font point size.<br>Range `6`..`200`, default `10`.' },
    color: {
      signature: 'COLOR back grid',
      description:
        'Window background color and grid color (named color or RGB24).<br>Defaults: background black, grid `$404040`.<br>TRAP: this is NOT the trace color. Per-channel trace color is the LAST field of each channel-definition string.'
    }
  };

  private _tableDebugDirectivesScopeFeed: TDebugDirectiveTable = {
    trigger: {
      signature: 'TRIGGER channel {AUTO | arm fire} {offset}',
      description:
        'Level-based arm/fire trigger.<br>`channel` `-1`..`7`; `-1` = free-run (no trigger).<br>`AUTO` auto-computes the arm and fire levels, or give explicit `arm` and `fire` thresholds.<br>`offset` `0`..`SAMPLES-1`, default `SAMPLES/2`.<br>**TRAP -- the offset mapping is counter-intuitive:** it is counted back from the NEWEST sample at the RIGHT edge (the trace runs oldest-left to newest-right). `offset 0` puts the trigger at the RIGHT edge, showing the lead-up TO it (pre-trigger view); `offset SAMPLES-1` puts it at the LEFT edge, showing what happens AFTER it; `SAMPLES/2` centers it.<br>Level arm/fire ONLY -- no edge, window, or external trigger, and no Auto/Normal/Single mode selector.'
    },
    holdoff: {
      signature: 'HOLDOFF n',
      description:
        'Minimum number of samples between successive triggers.<br>Range `2`..`2048`, default `SAMPLES` -- the default depends on the create-line `SAMPLES` value, not a fixed number.'
    },
    auto: {
      signature: 'AUTO',
      description:
        "Two distinct meanings depending on where it appears.<br>CHANNEL-DEF sense: `'label' AUTO` selects auto-ranging for that channel, in place of an explicit `lo hi` pair.<br>RUNTIME sense: `TRIGGER channel AUTO` auto-computes the arm and fire levels, in place of explicit `arm fire` thresholds."
    },
    clear: {
      signature: 'CLEAR',
      description:
        'Clear the bitmap AND reset the sample and rate counters.<br>More than a repaint -- the sample position restarts from the beginning.'
    },
    save: {
      signature: "SAVE {WINDOW} 'filename'",
      description:
        'Write a `.bmp` of the display area to `<filename>.bmp`.<br>Add `WINDOW` to capture the entire window instead of just the display area.<br>`filename` is REQUIRED. Use SINGLE quotes: a double-quoted argument is silently ignored with no compile error.'
    }
  };

  private _tableDebugDirectivesScopeXyConfig: TDebugDirectiveTable = {
    ...this._tableDebugPackedModes,
    size: {
      signature: 'SIZE n',
      description:
        "Display size -- **a SINGLE value here, unlike SCOPE's two-value `SIZE w h`**: the SCOPE_XY window is always SQUARE.<br>Effective width = height = `n*2` pixels, clamped `32`..`2048`, so `SIZE 128` gives a 256px window.<br>Default 256x256 when omitted."
    },
    range: {
      signature: 'RANGE n',
      description:
        'Coordinate extent of the plot.<br>Range `1`..`$7FFFFFFF`, default `$7FFFFFFF`.<br>Cartesian mode: `+-n` on BOTH axes. Polar mode: `0`..`n` radius.<br>Scale = width/2/RANGE.<br>There is NO auto-ranging in SCOPE_XY -- you must set RANGE yourself.'
    },
    samples: {
      signature: 'SAMPLES n',
      description:
        '**Persistence / fade control -- NOT a time-buffer depth as in SCOPE.**<br>Range `0`..`2048`, default `256`.<br>`SAMPLES 0` = persistent accumulating display with no buffer: points build up indefinitely, which is what you want for a complete Lissajous or phase figure.<br>`SAMPLES n` (n > 0) = circular buffer of n pairs per trace forming a fading trail; older points decay by `opa = 255 - k*255/n`.'
    },
    rate: { signature: 'RATE n', description: 'Display-update divisor: only every nth sample set is drawn.<br>Range `1`..`2048`, default `1`.' },
    dotsize: {
      signature: 'DOTSIZE n',
      description:
        'Dot diameter in pixels.<br>Range `2`..`20`, default `6`.<br>SCOPE_XY plots DOTS only -- there is no `LINESIZE` and no stroked traces.'
    },
    textsize: { signature: 'TEXTSIZE n', description: 'Trace-label font point size.<br>Range `6`..`200`, default `10`.' },
    color: { signature: 'COLOR back grid', description: 'Window background and grid colors (RGB24).<br>Defaults: background `BLACK`, grid `GRAY`.' },
    polar: {
      signature: 'POLAR {twopi {theta}}',
      description:
        'Enable polar `(rho, theta)` mode -- incoming pairs become radius/angle instead of X/Y, and `RANGE` then means a `0`..`n` radius.<br>`twopi` = units in a full circle. **`0` and `-1` are NOT equivalent:** 0 means `+$100000000` (counter-clockwise winding), -1 means `-$100000000` (clockwise). Any other value is literal, e.g. `POLAR 360` for degrees.<br>`theta` = optional angular offset applied to every sample.'
    },
    logscale: {
      signature: 'LOGSCALE',
      description:
        'Apply log scaling to both axes, or to the radius in polar mode.<br>Default is linear. Takes no arguments -- presence alone enables it.'
    }
  };

  private _tableDebugDirectivesScopeXyFeed: TDebugDirectiveTable = {
    clear: {
      signature: 'CLEAR',
      description:
        'Clear the bitmap AND reset the sample and rate counters.<br>Accumulated persistence/fade history and the `RATE` divisor phase are discarded too.'
    },
    save: {
      signature: "SAVE {WINDOW} 'filename'",
      description:
        'Write a `.bmp` of the display area -- or of the ENTIRE window if `WINDOW` is given -- to `<filename>.bmp`.<br>`filename` is REQUIRED and single-quoted; the `.bmp` extension is appended for you.'
    }
  };

  private _tableDebugDirectivesFftConfig: TDebugDirectiveTable = {
    ...this._tableDebugPackedModes,
    samples: {
      signature: 'SAMPLES n {first last}',
      description:
        'FFT size `n` -- a power of two, `4`..`2048` (default `512`). **The maximum is 2048; there is no 4096.**<br>**A non-power-of-two is truncated DOWN to the next lower power of two, never rounded up: `SAMPLES 1000` gives 512, NOT 1024.**<br>Optional `first`/`last` select the displayed bin range -- the only form of zoom: `first` `0`..`n/2-2` (default 0), `last` `first+1`..`n/2-1` (default `n/2-1`).<br>The window function is a FIXED Hanning and is not selectable.'
    },
    rate: {
      signature: 'RATE n',
      description:
        'Redraw every `n` new sample sets, `1`..`2048`.<br>**Default is not 1 -- it is the current `SAMPLES` value.**<br>Drawing begins only once the SAMPLES buffer has filled.'
    },
    size: {
      signature: 'SIZE width height',
      description: 'Plot-area size in pixels.<br>Each of `width` and `height` is `32`..`2048`, default 256x256.'
    },
    dotsize: { signature: 'DOTSIZE n', description: 'Bin dot diameter in pixels.<br>Range `0`..`32`, default `0` (no dots).' },
    linesize: {
      signature: 'LINESIZE n',
      description:
        'Trace line width, `-32`..`32` (default `3`).<br>**Positive = polyline thickness; `0` = no line; NEGATIVE = vertical filled bars of width `|n|`** -- bar-mode spectra are selected by making this negative.'
    },
    textsize: { signature: 'TEXTSIZE n', description: 'Label font point size.<br>Range `6`..`200`, default `10`.' },
    color: {
      signature: 'COLOR back grid',
      description:
        'Window background and grid colors (named color or RGB24; defaults black, gray).<br>This sets the window chrome ONLY -- trace color is not set here. Each channel takes its color from the trailing `color` field of its channel-definition string.'
    },
    logscale: {
      signature: 'LOGSCALE',
      description:
        'Plot the log of power instead of linear power.<br>**This is log of arbitrary power units, NOT calibrated dB** -- there is no dB or power-spectral-density normalization in the P2 FFT.'
    }
  };

  private _tableDebugDirectivesFftFeed: TDebugDirectiveTable = {
    clear: {
      signature: 'CLEAR',
      description:
        'Erase the display AND reset the sample and rate counters.<br>More than a repaint: after CLEAR the FFT will not redraw until a fresh `SAMPLES` buffer has been accumulated.'
    },
    save: {
      signature: "SAVE {WINDOW} 'filename'",
      description:
        'Write a `.bmp` of the display area -- or of the entire window if `WINDOW` is given -- to `<filename>.bmp`.<br>`filename` is REQUIRED. Use SINGLE quotes: a double-quoted argument is silently ignored with no compile error.'
    }
  };

  private _tableDebugDirectivesSpectroConfig: TDebugDirectiveTable = {
    ...this._tableDebugPackedModes,
    // SPECTRO accepts a RESTRICTED set of intensity modes -- the LUT/RGB color modes
    //  that PLOT takes are REJECTED here, so those are deliberately NOT spread in.
    luma8: {
      signature: 'LUMA8',
      description:
        'SPECTRO intensity mode: 8-bit luminance.<br>One of the SIX modes SPECTRO accepts; the LUT/RGB8/RGB16/RGB24/HSV8 modes are REJECTED.'
    },
    luma8w: { signature: 'LUMA8W', description: 'SPECTRO intensity mode: 8-bit luminance, WORD-packed.<br>One of the SIX modes SPECTRO accepts.' },
    luma8x: {
      signature: 'LUMA8X',
      description:
        'SPECTRO intensity mode: 8-bit luminance, LONG-packed.<br>**The default** when no mode is given. One of the SIX modes SPECTRO accepts.'
    },
    hsv16: { signature: 'HSV16', description: 'SPECTRO intensity mode: 16-bit HSV, giving phase coloring.<br>One of the SIX modes SPECTRO accepts.' },
    hsv16w: { signature: 'HSV16W', description: 'SPECTRO intensity mode: 16-bit HSV, WORD-packed.<br>One of the SIX modes SPECTRO accepts.' },
    hsv16x: { signature: 'HSV16X', description: 'SPECTRO intensity mode: 16-bit HSV, LONG-packed.<br>One of the SIX modes SPECTRO accepts.' },
    samples: {
      signature: 'SAMPLES n {first last}',
      description:
        'FFT size in points.<br>`n` is clamped to `4`..`2048` and SNAPPED to a power of two -- any in-range value is accepted and rounded, so an exact power of two is not required.<br>Default `512`.<br>Optional `first`/`last` select a displayed bin range over the SNAPPED size: `first` `0`..`n/2-2`, `last` `first+1`..`n/2-1`.'
    },
    depth: { signature: 'DEPTH n', description: 'Number of time-history lines retained -- the spectrogram time depth.<br>Range `1`..`2048`.' },
    mag: { signature: 'MAG n', description: 'Magnitude multiplier of `2^n` -- NOT a direct multiplier.<br>Range `0`..`11`, default `0` (2^0 = x1).' },
    range: { signature: 'RANGE n', description: 'Full-scale magnitude value.<br>Range `1`..`$7FFFFFFF`, default `$7FFFFFFF` (full scale).' },
    rate: {
      signature: 'RATE n',
      description:
        'Samples per display update.<br>Range `1`..`2048`.<br>**Default is `SAMPLES/8`, not 1** -- the default tracks the FFT size, so changing `SAMPLES` silently changes the update rate.'
    },
    trace: {
      signature: 'TRACE n',
      description:
        'Scroll-direction / static control, as a `0`..`15` **bitfield** -- NOT a trace index.<br>Bits 0-2 = scroll direction (0..7), bit 3 = scroll enable. Default `$F` (scrolling, direction 7).<br>**TRACE also decides the AXES.** The width/height swap fires only when `(TRACE AND $4) == 0`, so only traces 0-3 put FREQUENCY on X with time running horizontally. Traces 4-15 -- including the default `$F` -- do NOT swap: TIME is on X and FREQUENCY on Y.'
    },
    dotsize: { signature: 'DOTSIZE x {y}', description: 'Cell size in pixels; each of `x` and `y` is `1`..`16`.<br>Default 1,1.' },
    logscale: { signature: 'LOGSCALE', description: 'Use log-magnitude intensity instead of linear.' }
  };

  private _tableDebugDirectivesSpectroFeed: TDebugDirectiveTable = {
    clear: {
      signature: 'CLEAR',
      description: 'Clear the bitmap AND reset the sample counter, the rate counter, and the trace (scroll) position.<br>Not just the pixels.'
    },
    save: {
      signature: "SAVE {WINDOW} 'filename'",
      description:
        'Write a `.bmp` of the display area -- or of the entire window if `WINDOW` is given -- to `<filename>.bmp`.<br>**The filename is REQUIRED and must be LAST:** a bare `SAVE` writes NOTHING, silently, and any keyword placed after SAVE is consumed and discarded.'
    }
  };

  private _tableDebugDirectivesMidiConfig: TDebugDirectiveTable = {
    size: {
      signature: 'SIZE n',
      description:
        'Key-size scalar for the drawn piano keyboard.<br>Range `1`..`50`, default `4`.<br>**This is NOT a pixel dimension** -- the drawn key size is `8 + n*4` pixels, so `SIZE 4` yields 24-pixel keys, not 4.'
    },
    range: {
      signature: 'RANGE firstKey lastKey',
      description:
        'MIDI note range displayed on the keyboard.<br>Each value `0`..`127`, default `21 108` (the 88-key piano range).<br>`lastKey` is clamped to be `>=` `firstKey`.<br>The display always tracks all 128 key velocities internally; RANGE only limits what is DRAWN.'
    },
    channel: {
      signature: 'CHANNEL n',
      description:
        'MIDI channel to display.<br>Range `0`..`15`, default `0`.<br>**An exact channel filter -- not a mask, and not an all-channels mode.** `CHANNEL 0` shows channel 0 only; there is no value that displays every channel.'
    },
    color: {
      signature: 'COLOR onWhite onBlack',
      description:
        'Lit-key colors for white keys and black keys.<br>Defaults `CYAN` (white keys) and `MAGENTA` (black keys).<br>**COLOR sets only the HUE; the note VELOCITY sets the fill HEIGHT.** There is no velocity color gradient -- the hue is fixed per key type regardless of how hard the note is struck.'
    },
    hidexy: {
      signature: 'HIDEXY',
      description:
        '**Not accepted by MIDI.** Unlike every other DEBUG display type, MIDI rejects `HIDEXY` -- it has no XY/cursor readout to suppress.<br>Documented here so its absence is not mistaken for an oversight.'
    }
  };

  private _tableDebugDirectivesMidiFeed: TDebugDirectiveTable = {
    clear: {
      signature: 'CLEAR',
      description:
        'Clear the keyboard: reset **all 128 key velocities** to 0 and redraw.<br>This releases EVERY key -- including notes outside the displayed `RANGE` and on channels other than the configured `CHANNEL`.'
    },
    save: {
      signature: "SAVE {WINDOW} 'filename'",
      description:
        'Write a `.bmp` of the display area to `<filename>.bmp`.<br>Add the optional `WINDOW` keyword to capture the entire window instead of just the display area.<br>`filename` is REQUIRED. Use SINGLE quotes: a double-quoted argument is silently ignored with no compile error.'
    }
  };

  // BITMAP is the one display type taking BOTH families: packed COLOR modes (how a
  //  sample becomes a color) and sample PACKING modes (how samples are extracted).
  private _tableDebugDirectivesBitmapConfig: TDebugDirectiveTable = {
    ...this._tableDebugColorModes,
    ...this._tableDebugPackedModes,
    size: {
      signature: 'SIZE w h',
      description:
        'Logical bitmap dimensions in PIXELS.<br>`w` and `h` are each `1`..`2048`, default 256x256.<br>Note the lower bound differs from PLOT, whose SIZE starts at 32.<br>This is the pixel canvas, NOT the on-screen client size -- the window is `w*x` by `h*y` after `DOTSIZE` magnification.'
    },
    dotsize: {
      signature: 'DOTSIZE x {y}',
      description:
        'Integer pixel magnification, each `1`..`256` (default 1x1).<br>X and Y magnify INDEPENDENTLY, but `y` is OPTIONAL: omit it and `y` copies `x`, so `DOTSIZE 8` is 8x8, not 8x1.<br>Client size = `w*x` by `h*y`.<br>This is the only scaling available -- there is NO zoom and NO pan.'
    },
    sparse: {
      signature: 'SPARSE color',
      description:
        'Sparse mode: each magnified pixel is drawn as a ROUND DOT on a SOLID BACKGROUND FILL of `color` (named color or RGB24). `-1` turns it off.<br>**It is NOT a grid, border, or outline** -- `color` fills the whole block BEHIND the dot.<br>**Gated on magnification:** sparse rendering requires `DOTSIZE >= 4`. At DOTSIZE 3 or less it silently does not engage.<br>Renders far more slowly than the 1:1 path -- keep the logical canvas small.'
    },
    lutcolors: {
      signature: 'LUTCOLORS c0 .. cN',
      description:
        'Load up to 256 RGB24 palette entries. LUT color modes only.<br>**The LUT is ZERO-INITIALIZED:** until LUTCOLORS loads it, every entry is `$000000`, so a LUT mode with no LUTCOLORS renders a uniformly BLACK picture -- not random garbage, and not an error. Load the palette BEFORE feeding LUT-mode pixel data.<br>CONFIG sense: the initial palette.'
    },
    trace: {
      signature: 'TRACE n',
      description:
        'Scan/scroll control as a `0`..`15` BITFIELD, not an enumeration (default `0`).<br>Bits 0-2 select the scan pattern (0..7); bit 3 enables scroll.<br>The pixel stream order follows the selected scan pattern -- there is no column-major buffer formula. Use `SET` for random access.'
    },
    rate: {
      signature: 'RATE n',
      description:
        'Pixels accepted per display refresh (default `0`).<br>CONFIG sense: `-1` is SUBSTITUTED with `w*h` (refresh once per whole frame), and `0` is substituted with the width (h-scan) or the height (v-scan).<br>**This substitution is create-line behavior ONLY** -- the runtime `RATE` does not do it, and -1/0 there freeze the display.'
    },
    alt: {
      signature: 'ALT',
      description: 'Optional modifier on a packing mode -- bit-reverses each sub-unit on unpack.<br>May be combined with `SIGNED`.'
    },
    signed: {
      signature: 'SIGNED',
      description: 'Optional modifier on a packing mode -- samples are treated as signed.<br>May be combined with `ALT`.'
    },
    update: {
      signature: 'UPDATE',
      description:
        'CONFIG sense: select MANUAL-refresh mode. Output ACCUMULATES off-screen and nothing appears until a runtime `UPDATE` is sent.<br>Once in this mode `SAVE` captures the FRONT buffer -- the frame currently shown, not the one you have been drawing. Send a runtime UPDATE before SAVE.'
    }
  };

  private _tableDebugDirectivesBitmapFeed: TDebugDirectiveTable = {
    lutcolors: {
      signature: 'LUTCOLORS c0 .. cN',
      description: 'RUNTIME sense: replace the palette mid-stream (LUT color modes only).<br>Already-plotted pixels re-map to the new palette.'
    },
    trace: {
      signature: 'TRACE n',
      description:
        'RUNTIME sense: change the scan pattern / scroll bit mid-stream. Same `0`..`15` bitfield as the config form (bits 0-2 = pattern, bit 3 = scroll).<br>**Side effect: it RESETS the pixel position.** Feeding continues from the start of the scan, not from where you were.'
    },
    rate: {
      signature: 'RATE n',
      description:
        'RUNTIME sense: change pixels-per-refresh mid-stream.<br>**TRAP -- the create-line substitution does NOT happen at runtime.** A runtime `RATE -1` (or `RATE 0`) is stored as-is, and the refresh counter fires on an EQUALITY test against an ever-increasing count, so it can never match: auto-refresh FREEZES. Pixels keep arriving and the display silently stops updating -- not an error, and not reported.<br>A runtime RATE with any positive count resumes refreshing.'
    },
    set: {
      signature: 'SET x y',
      description:
        'Random-access pixel position. `x` is `0`..`w-1`, `y` is `0`..`h-1`.<br>**CANCELS scroll** -- after SET, scrolling is off until re-enabled via `TRACE` bit 3.'
    },
    scroll: {
      signature: 'SCROLL x y',
      description:
        'Shift the existing bitmap. `x` ranges `-w`..`w` (positive = right), `y` ranges `-h`..`h` (positive = down).<br>The vacated area is filled with the background color, not left as-is.'
    },
    clear: {
      signature: 'CLEAR',
      description:
        'Fill the bitmap with the background color, **reset the trace position**, and refresh.<br>The refresh is suppressed if the window was created with `UPDATE` (manual-refresh) mode.'
    },
    update: {
      signature: 'UPDATE',
      description:
        'RUNTIME sense: force a canvas refresh.<br>Required in manual-refresh mode (window created with `UPDATE`) -- without it nothing you feed ever becomes visible.<br>Also send it before `SAVE` in that mode, or SAVE files the PREVIOUS frame.'
    },
    save: {
      signature: "SAVE {WINDOW | l t w h} 'filename'",
      description:
        "Write the bitmap to `<filename>.bmp`.<br>**The filename is REQUIRED in every form and must come LAST.** A bare `SAVE` writes NOTHING, silently, and a keyword placed after SAVE is consumed and discarded -- `` `Win SAVE CLEAR `` writes no file AND loses the CLEAR.<br>**Prefer the plain `SAVE 'filename'` form:** it renders from the window's own bitmap, capturing exactly that window -- no chrome, nothing overlapping it.<br>The other two forms capture the SCREEN: `SAVE WINDOW` grabs the window's screen rectangle (frame included, occlusion-vulnerable), and the `l t w h` form grabs an arbitrary SCREEN region. Those are SCREEN coordinates, NOT the window's `POS` coordinate space -- never compute a SAVE region from a window's POS.<br>In `UPDATE` mode SAVE captures the FRONT buffer, the frame currently shown."
    }
  };

  private _tableDebugColorNames: { [Identifier: string]: TDebugDirective } = {
    black: { signature: 'BLACK', description: 'Named color. BLACK and WHITE do NOT take a brightness nibble.' },
    white: { signature: 'WHITE', description: 'Named color. BLACK and WHITE do NOT take a brightness nibble.' },
    orange: { signature: 'ORANGE {brightness}', description: 'Named color, optional brightness nibble 0..15.' },
    blue: { signature: 'BLUE {brightness}', description: 'Named color, optional brightness nibble 0..15.' },
    green: {
      signature: 'GREEN {brightness}',
      description:
        'Named color, optional brightness nibble 0..15.<br>NOTE: the typeable `GREEN` is COMPUTED and resolves to `$09FF09` at its default brightness -- this is NOT the palette green (`$00FF00`) used as a TERM default. There is no typeable `LIME`.'
    },
    cyan: { signature: 'CYAN {brightness}', description: 'Named color, optional brightness nibble 0..15.' },
    red: { signature: 'RED {brightness}', description: 'Named color, optional brightness nibble 0..15.' },
    magenta: { signature: 'MAGENTA {brightness}', description: 'Named color, optional brightness nibble 0..15.' },
    yellow: { signature: 'YELLOW {brightness}', description: 'Named color, optional brightness nibble 0..15.' },
    gray: { signature: 'GRAY {brightness}', description: 'Named color, optional brightness nibble 0..15. `GREY` is accepted too.' },
    grey: { signature: 'GREY {brightness}', description: 'Named color, optional brightness nibble 0..15. `GRAY` is accepted too.' }
  };

  // Per-display-type directive registry. Adding a display type is purely ADDITIVE:
  //  author its config/feed tables above and register them here -- no dispatch change.
  //
  //  MUST be declared AFTER the tables it references: class fields initialize in
  //  declaration order, so an earlier position would capture `undefined`.
  //
  //  All NINE DEBUG display types are populated. The keys must match the lower-cased
  //  names in _tableDebugDisplayTypes -- note `scope_xy` carries its underscore.
  private _debugDirectivesByDisplayType: { [Identifier: string]: TDebugDisplayDirectives } = {
    term: { config: this._tableDebugDirectivesTermConfig, feed: this._tableDebugDirectivesTermFeed },
    plot: { config: this._tableDebugDirectivesPlotConfig, feed: this._tableDebugDirectivesPlotFeed },
    logic: { config: this._tableDebugDirectivesLogicConfig, feed: this._tableDebugDirectivesLogicFeed },
    scope: { config: this._tableDebugDirectivesScopeConfig, feed: this._tableDebugDirectivesScopeFeed },
    scope_xy: { config: this._tableDebugDirectivesScopeXyConfig, feed: this._tableDebugDirectivesScopeXyFeed },
    fft: { config: this._tableDebugDirectivesFftConfig, feed: this._tableDebugDirectivesFftFeed },
    spectro: { config: this._tableDebugDirectivesSpectroConfig, feed: this._tableDebugDirectivesSpectroFeed },
    bitmap: { config: this._tableDebugDirectivesBitmapConfig, feed: this._tableDebugDirectivesBitmapFeed },
    midi: { config: this._tableDebugDirectivesMidiConfig, feed: this._tableDebugDirectivesMidiFeed }
  };

  /**
   * Documentation for a DEBUG display directive or color name, resolved in the context of the
   *  display type and whether we are in a window-creation (config) or window-update (feed) message.
   * @param name - the directive/color word being hovered
   * @param displayTypeName - display type name (ex: 'TERM'); empty when not yet known
   * @param isDeclaration - true when this is a window-CREATION message
   * @returns IBuiltinDescription - found=false when we have nothing for this word
   */
  public docTextForDebugDirective(name: string, displayTypeName: string, isDeclaration: boolean): IBuiltinDescription {
    const nameKey: string = name.toLowerCase();
    const typeKey: string = displayTypeName.toLowerCase();
    const desiredDocText: IBuiltinDescription = { found: false, type: eBuiltInType.Unknown, category: '', description: '', signature: '' };

    // per display-type, per context (config vs feed) -- these win over the shared table
    const typeDirectives: TDebugDisplayDirectives | undefined = this._debugDirectivesByDisplayType[typeKey];
    const typeTable: TDebugDirectiveTable | undefined = typeDirectives ? (isDeclaration ? typeDirectives.config : typeDirectives.feed) : undefined;

    let entry: TDebugDirective | undefined = typeTable ? typeTable[nameKey] : undefined;
    let categoryText: string = '';
    if (entry !== undefined) {
      categoryText = `DEBUG ${displayTypeName.toUpperCase()} ${isDeclaration ? 'config' : 'update'} directive`;
    } else if (nameKey in this._tableDebugDirectivesShared) {
      entry = this._tableDebugDirectivesShared[nameKey];
      categoryText = displayTypeName.length > 0 ? `DEBUG ${displayTypeName.toUpperCase()} directive` : 'DEBUG display directive';
    } else if (nameKey in this._tableDebugColorNames) {
      entry = this._tableDebugColorNames[nameKey];
      categoryText = 'DEBUG display color';
    }

    if (entry !== undefined) {
      desiredDocText.found = true;
      desiredDocText.type = eBuiltInType.BIT_DEBUG_SYMBOL;
      desiredDocText.category = categoryText;
      desiredDocText.signature = entry.signature;
      desiredDocText.description = entry.description;
    }
    this._logMessage(
      `sp2u: - docTextForDebugDirective([${name}], type=[${displayTypeName}], isDecl=${isDeclaration}) -> found=${desiredDocText.found}`
    );
    return desiredDocText;
  }

  public isDebugDisplayType(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const bDisplayTypeStatus: boolean = nameKey in this._tableDebugDisplayTypes;
    return bDisplayTypeStatus;
  }

  private _docTextForSpinBuiltInDebugDisplayType(name: string): IBuiltinDescription {
    const nameKey: string = name.toLowerCase();
    const desiredDocText: IBuiltinDescription = {
      found: false,
      type: eBuiltInType.Unknown,
      category: '',
      description: '',
      signature: ''
    };
    if (nameKey in this._tableDebugDisplayTypes) {
      desiredDocText.found = true;
      desiredDocText.category = 'Debug Display-type';
      desiredDocText.description = this._tableDebugDisplayTypes[nameKey];
    }
    return desiredDocText;
  }

  public isNameWithTypeInstantiation(newParameter: string, displayType: eDebugDisplayType): boolean {
    let nameStatus: boolean = false;
    const bHasPackedData: boolean = this.debugTypeHasPackedData(displayType);
    const bHasColorMode: boolean = this.debugTypeHasColorMode(displayType);
    switch (displayType) {
      case eDebugDisplayType.ddtTerm:
        nameStatus = this.isDebugTermDeclarationParam(newParameter);
        break;
      case eDebugDisplayType.ddtScope:
        nameStatus = this.isDebugScopeDeclarationParam(newParameter);
        break;
      case eDebugDisplayType.ddtScopeXY:
        nameStatus = this.isDebugScopeXYDeclarationParam(newParameter);
        break;
      case eDebugDisplayType.ddtLogic:
        nameStatus = this.isDebugLogicDeclarationParam(newParameter);
        break;
      case eDebugDisplayType.ddtFFT:
        nameStatus = this.isDebugFFTDeclarationParam(newParameter);
        break;
      case eDebugDisplayType.ddtSpectro:
        nameStatus = this.isDebugSpectroDeclarationParam(newParameter);
        // SPECTRO-Instantiation supports a special color mode, check it too
        if (nameStatus == false) {
          nameStatus = this.isDebugSpectroColorMode(newParameter);
        }
        break;
      case eDebugDisplayType.ddtPlot:
        nameStatus = this.isDebugPlotDeclarationParam(newParameter);
        break;
      case eDebugDisplayType.ddtBitmap:
        nameStatus = this.isDebugBitmapDeclarationParam(newParameter);
        if (!nameStatus) {
          nameStatus = this.isDebugBitmapColorMode(newParameter);
        }
        break;
      case eDebugDisplayType.ddtMidi:
        nameStatus = this.isDebugMidiDeclarationParam(newParameter);
        break;
      default:
        break;
    }
    // if we don't have a match yet then check packed data
    if (nameStatus == false && bHasPackedData) {
      nameStatus = this.isDebugPackedDataType(newParameter);
    }
    if (nameStatus == false && bHasColorMode) {
      nameStatus = this.isDebugBitmapColorMode(newParameter);
    }
    return nameStatus;
  }

  public isNameWithTypeFeed(newParameter: string, displayType: eDebugDisplayType): boolean {
    let nameStatus: boolean = false;
    const bHasColorMode: boolean = this.debugTypeHasColorMode(displayType);
    switch (displayType) {
      case eDebugDisplayType.ddtTerm:
        nameStatus = this.isDebugTermFeedParam(newParameter);
        break;
      case eDebugDisplayType.ddtScope:
        nameStatus = this.isDebugScopeFeedParam(newParameter);
        break;
      case eDebugDisplayType.ddtScopeXY:
        nameStatus = this.isDebugScopeXYFeedParam(newParameter);
        break;
      case eDebugDisplayType.ddtLogic:
        nameStatus = this.isDebugLogicFeedParam(newParameter);
        break;
      case eDebugDisplayType.ddtFFT:
        nameStatus = this.isDebugFFTFeedParam(newParameter);
        break;
      case eDebugDisplayType.ddtSpectro:
        nameStatus = this.isDebugSpectroFeedParam(newParameter);
        break;
      case eDebugDisplayType.ddtPlot:
        nameStatus = this.isDebugPlotFeedParam(newParameter);
        break;
      case eDebugDisplayType.ddtBitmap:
        nameStatus = this.isDebugBitmapFeedParam(newParameter);
        break;
      case eDebugDisplayType.ddtMidi:
        nameStatus = this.isDebugMidiFeedParam(newParameter);
        break;
      default:
        break;
    }
    // if we don't have a match yet then check color mode
    if (nameStatus == false && bHasColorMode) {
      nameStatus = this.isDebugBitmapColorMode(newParameter);
    }
    //this._logMessage("  -- _isNameWithTypeFeed(" + newParameter + ", " + displayType + ") = " + nameStatus);
    return nameStatus;
  }

  // each type has decl and feed parameter-name check methods
  // Debug Display: TERM declaration
  public isDebugTermDeclarationParam(name: string): boolean {
    const debugTermDeclTypes: string[] = ['title', 'pos', 'size', 'textsize', 'color', 'backcolor', 'update', 'hidexy'];
    const bTermDeclParamStatus: boolean = debugTermDeclTypes.indexOf(name.toLowerCase()) != -1;
    return bTermDeclParamStatus;
  }

  // Debug Display: TERM feed
  public isDebugTermFeedParam(name: string): boolean {
    const debugTermFeedTypes: string[] = ['clear', 'update', 'save', 'window', 'close', 'backcolor'];
    const bTermFeedParamStatus: boolean = debugTermFeedTypes.indexOf(name.toLowerCase()) != -1;
    return bTermFeedParamStatus;
  }

  // Debug Display: SCOPE declaration
  public isDebugScopeDeclarationParam(name: string): boolean {
    const debugScopeDeclTypes: string[] = ['title', 'pos', 'size', 'samples', 'rate', 'dotsize', 'linesize', 'textsize', 'color', 'hidexy', 'auto'];
    const bScopeDeclParamStatus: boolean = debugScopeDeclTypes.indexOf(name.toLowerCase()) != -1;
    return bScopeDeclParamStatus;
  }

  // Debug Display: SCOPE feed
  public isDebugScopeFeedParam(name: string): boolean {
    const debugScopeFeedTypes: string[] = ['trigger', 'holdoff', 'samples', 'clear', 'save', 'window', 'close', 'auto'];
    const bScopeFeedParamStatus: boolean = debugScopeFeedTypes.indexOf(name.toLowerCase()) != -1;
    return bScopeFeedParamStatus;
  }

  // Debug Display: SCOPE_XY declaration
  public isDebugScopeXYDeclarationParam(name: string): boolean {
    const debugScopeXYDeclTypes: string[] = [
      'title',
      'pos',
      'size',
      'range',
      'samples',
      'rate',
      'dotsize',
      'textsize',
      'color',
      'polar',
      'logscale',
      'hidexy'
    ];
    const bScopeXYDeclParamStatus: boolean = debugScopeXYDeclTypes.indexOf(name.toLowerCase()) != -1;
    return bScopeXYDeclParamStatus;
  }

  // Debug Display: SCOPE_XY feed
  public isDebugScopeXYFeedParam(name: string): boolean {
    const debugScopeXYFeedTypes: string[] = ['clear', 'save', 'window', 'close'];
    const bScopeXYFeedParamStatus: boolean = debugScopeXYFeedTypes.indexOf(name.toLowerCase()) != -1;
    return bScopeXYFeedParamStatus;
  }

  // Debug Display: LOGIC declaration
  public isDebugLogicDeclarationParam(name: string): boolean {
    const debugLogicDeclTypes: string[] = ['title', 'pos', 'samples', 'spacing', 'rate', 'linesize', 'textsize', 'color', 'hidexy'];
    const bLogicDeclParamStatus: boolean = debugLogicDeclTypes.indexOf(name.toLowerCase()) != -1;
    return bLogicDeclParamStatus;
  }

  // Debug Display: LOGIC feed
  public isDebugLogicFeedParam(name: string): boolean {
    const debugLogicFeedTypes: string[] = ['trigger', 'holdoff', 'clear', 'save', 'window', 'close'];
    const bLogicFeedParamStatus: boolean = debugLogicFeedTypes.indexOf(name.toLowerCase()) != -1;
    return bLogicFeedParamStatus;
  }

  // Debug Display: FFT declaration
  public isDebugFFTDeclarationParam(name: string): boolean {
    const debugFFTDeclTypes: string[] = ['title', 'pos', 'size', 'samples', 'rate', 'dotsize', 'linesize', 'textsize', 'color', 'logscale', 'hidexy'];
    const bFFTDeclParamStatus: boolean = debugFFTDeclTypes.indexOf(name.toLowerCase()) != -1;
    return bFFTDeclParamStatus;
  }

  // Debug Display: FFT feed
  public isDebugFFTFeedParam(name: string): boolean {
    const debugFFTFeedTypes: string[] = ['clear', 'save', 'window', 'close'];
    const bFFTFeedParamStatus: boolean = debugFFTFeedTypes.indexOf(name.toLowerCase()) != -1;
    return bFFTFeedParamStatus;
  }

  // Debug Display: SPECTRO declaration
  public isDebugSpectroDeclarationParam(name: string): boolean {
    const debugSpectroDeclTypes: string[] = ['title', 'pos', 'samples', 'depth', 'mag', 'range', 'rate', 'trace', 'dotsize', 'logscale', 'hidexy'];
    const bSpectroDeclParamStatus: boolean = debugSpectroDeclTypes.indexOf(name.toLowerCase()) != -1;
    return bSpectroDeclParamStatus;
  }

  // Debug Display: SPECTRO feed
  public isDebugSpectroFeedParam(name: string): boolean {
    const debugSpectroFeedTypes: string[] = ['clear', 'save', 'window', 'close'];
    const bSpectroFeedParamStatus: boolean = debugSpectroFeedTypes.indexOf(name.toLowerCase()) != -1;
    return bSpectroFeedParamStatus;
  }

  // Debug Display: PLOT declaration
  public isDebugPlotDeclarationParam(name: string): boolean {
    const debugPlotDeclTypes: string[] = ['title', 'pos', 'size', 'dotsize', 'lutcolors', 'backcolor', 'update', 'hidexy'];
    const bPlotDeclParamStatus: boolean = debugPlotDeclTypes.indexOf(name.toLowerCase()) != -1;
    return bPlotDeclParamStatus;
  }

  // Debug Display: PLOT feed
  public isDebugPlotFeedParam(name: string): boolean {
    const debugPlotFeedTypes: string[] = [
      'lutcolors',
      'backcolor',
      'color',
      'opacity',
      'precise',
      'linesize',
      'origin',
      'set',
      'dot',
      'line',
      'circle',
      'oval',
      'box',
      'obox',
      'text',
      'textsize',
      'textstyle',
      'textangle',
      'text',
      'spritedef',
      'sprite',
      'polar',
      'cartesian',
      'update',
      'clear',
      'save',
      'window',
      'close'
    ];
    let bPlotFeedParamStatus: boolean = debugPlotFeedTypes.indexOf(name.toLowerCase()) != -1;
    if (!bPlotFeedParamStatus && this.requestedSpinVersion(50)) {
      // check for new plot() parameters
      const debugPlotFeedTypes_v45: string[] = ['crop', 'layer'];
      bPlotFeedParamStatus = debugPlotFeedTypes_v45.indexOf(name.toLowerCase()) != -1;
    }

    return bPlotFeedParamStatus;
  }

  // Debug Display: BITMAP declaration
  public isDebugBitmapDeclarationParam(name: string): boolean {
    const debugBitmapDeclTypes: string[] = ['title', 'pos', 'size', 'dotsize', 'lutcolors', 'trace', 'rate', 'scroll', 'update', 'hidexy', 'sparse'];
    const bBitmapDeclParamStatus: boolean = debugBitmapDeclTypes.indexOf(name.toLowerCase()) != -1;
    return bBitmapDeclParamStatus;
  }

  // Debug Display: BITMAP feed
  public isDebugBitmapFeedParam(name: string): boolean {
    const debugBitmapFeedTypes: string[] = ['lutcolors', 'trace', 'rate', 'set', 'scroll', 'clear', 'update', 'scroll', 'save', 'window', 'close'];
    const bBitmapFeedParamStatus: boolean = debugBitmapFeedTypes.indexOf(name.toLowerCase()) != -1;
    return bBitmapFeedParamStatus;
  }

  // Debug Display: MIDI declaration
  public isDebugMidiDeclarationParam(name: string): boolean {
    const debugMidiDeclTypes: string[] = ['title', 'pos', 'size', 'range', 'channel', 'color'];
    const bMidiDeclParamStatus: boolean = debugMidiDeclTypes.indexOf(name.toLowerCase()) != -1;
    return bMidiDeclParamStatus;
  }

  // Debug Display: MIDI feed
  public isDebugMidiFeedParam(name: string): boolean {
    const debugMidiFeedTypes: string[] = ['clear', 'save', 'window', 'close'];
    const bMidiFeedParamStatus: boolean = debugMidiFeedTypes.indexOf(name.toLowerCase()) != -1;
    return bMidiFeedParamStatus;
  }

  public debugTypeHasPackedData(displayType: eDebugDisplayType): boolean {
    // return indication if displayType has Packed Data Mode
    let bHasPackedData: boolean = true;
    switch (displayType) {
      case eDebugDisplayType.ddtTerm:
        bHasPackedData = false;
        break;
      case eDebugDisplayType.ddtPlot:
        bHasPackedData = false;
        break;
      case eDebugDisplayType.ddtMidi:
        bHasPackedData = false;
        break;
      default:
        break;
    }
    return bHasPackedData;
  }

  public debugTypeHasColorMode(displayType: eDebugDisplayType): boolean {
    // return indication if displayType has lut1_to_rgb24 Color Mode
    let bHasColorMode: boolean = false;
    switch (displayType) {
      case eDebugDisplayType.ddtBitmap:
        bHasColorMode = true;
        break;
      case eDebugDisplayType.ddtPlot:
        bHasColorMode = true;
        break;
      case eDebugDisplayType.ddtTerm: // ?? demo shipped has this here??? not in DOCs???
        bHasColorMode = true;
        break;
      default:
        break;
    }
    return bHasColorMode;
  }

  // color names for use in debug()
  //   BLACK / WHITE or ORANGE / BLUE / GREEN / CYAN / RED / MAGENTA / YELLOW / GREY|GRAY
  public isDebugColorName(name: string): boolean {
    const debugColorNames: string[] = ['black', 'white', 'orange', 'blue', 'green', 'cyan', 'red', 'magenta', 'yellow', 'grey', 'gray'];
    const bColorNameStatus: boolean = debugColorNames.indexOf(name.toLowerCase()) != -1;
    return bColorNameStatus;
  }

  // packed data forms for use in debug()
  public isDebugPackedDataType(name: string): boolean {
    const debugPackedDataTypes: string[] = [
      'longs_1bit',
      'longs_2bit',
      'longs_4bit',
      'longs_8bit',
      'longs_16bit',
      'words_1bit',
      'words_2bit',
      'words_4bit',
      'words_8bit',
      'bytes_1bit',
      'bytes_2bit',
      'bytes_4bit',
      // optional operators
      'alt',
      'signed'
    ];
    const bPackedDataTypeStatus: boolean = debugPackedDataTypes.indexOf(name.toLowerCase()) != -1;
    return bPackedDataTypeStatus;
  }

  //  Bitmap Color Modes
  public isDebugBitmapColorMode(name: string): boolean {
    const debugBitmapColorModes: string[] = [
      'lut1',
      'lut2',
      'lut4',
      'lut8',
      'luma8',
      'luma8w',
      'luma8x',
      'hsv8',
      'hsv8w',
      'hsv8x',
      'rgbi8',
      'rgbi8w',
      'rgbi8x',
      'rgb8',
      'rgb16',
      'rgb24',
      'hsv16',
      'hsv16w',
      'hsv16x'
    ];
    const bBitmapColorModeStatus: boolean = debugBitmapColorModes.indexOf(name.toLowerCase()) != -1;
    return bBitmapColorModeStatus;
  }

  //  Spectro reduced-set Color Modes
  public isDebugSpectroColorMode(name: string): boolean {
    const debugSpectropColorModes: string[] = ['luma8', 'luma8w', 'luma8x', 'hsv16', 'hsv16w', 'hsv16x'];
    const bSpectroColorModeStatus: boolean = debugSpectropColorModes.indexOf(name.toLowerCase()) != -1;
    return bSpectroColorModeStatus;
  }
}
