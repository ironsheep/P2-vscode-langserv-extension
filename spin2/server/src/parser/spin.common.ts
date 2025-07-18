'use strict';
// server/src/parser/spin.semantic.findings.ts

import { Position } from 'vscode-languageserver-types';
import { Context } from '../context';
//import { timeStamp } from 'console';
//import { listenerCount } from "process";

export enum eDebugDisplayType {
  Unknown = 0,
  ddtLogic,
  ddtScope,
  ddtScopeXY,
  ddtFFT,
  ddtSpectro,
  ddtPlot,
  ddtTerm,
  ddtBitmap,
  ddtMidi
}

export enum eBuiltInType {
  Unknown = 0,
  BIT_CONSTANT,
  BIT_DEBUG_INVOKE, // spin2
  BIT_DEBUG_METHOD, // spin2
  BIT_DEBUG_SYMBOL, // spin2
  BIT_LANG_PART,
  BIT_METHOD,
  BIT_METHOD_POINTER, // spin2
  BIT_PASM_DIRECTIVE,
  BIT_SYMBOL,
  BIT_TYPE,
  BIT_VARIABLE
}

export enum eParseState {
  Unknown = 0,
  inCon,
  inDat,
  inObj,
  inPub,
  inPri,
  inVar,
  inPAsmInline,
  inDatPAsm,
  inMultiLineComment,
  inMultiLineDocComment,
  inFakeLineContinuation,
  inNothing
}

export enum eControlFlowType {
  Unknown = 0,
  inCase,
  inCaseFast,
  inRepeat,
  inIf
}

export interface ICurrControlStatement {
  startLineIdx: number;
  startLineCharOffset: number;
  type: eControlFlowType; // [variable|method]
}

export interface ICurrControlSpan {
  startLineIdx: number;
  endLineIdx: number;
}

export interface IBuiltinDescription {
  found: boolean;
  type: eBuiltInType; // [variable|method]
  category: string;
  description: string;
  signature: string;
  parameters?: string[];
  returns?: string[];
}

export function haveDebugLine(line: string, startsWith: boolean = false, ctx: Context | undefined = undefined): boolean {
  const debugStatementOpenRegEx = /debug\s*(\[[a-zA-Z0-9_]+\])?\(/i; // case-insensative debug() but allowing whitespace before '('
  const debugStatementOpenStartRegEx = /^\s*debug\s*(\[[a-zA-Z0-9_]+\])?\(/i; // case-insensative debug() at start of line but allowing whitespace before '('
  const startStatus: boolean = startsWith ? debugStatementOpenStartRegEx.test(line) : debugStatementOpenRegEx.test(line);
  _logMessage(`spCom: haveDebugLine([${line}]) -> (${startStatus})`, ctx);
  return startStatus;
}

export function isMethodCall(line: string, ctx: Context | undefined = undefined): boolean {
  const methodOpenRegEx = /^\s*\(/; // match zero or more whitespace before '(' from left edge of string
  const foundMethodCallStatus: boolean = methodOpenRegEx.test(line);
  _logMessage(`spCom: isMethodCall([${line}]) -> (${foundMethodCallStatus})`, ctx);

  return foundMethodCallStatus;
}

export function isMaskedDebugMethodCall(line: string, ctx: Context | undefined = undefined): boolean {
  const methodOpenRegEx = /^\[[0-9]+\]\s*\(/; // match indexvalue before zero or more whitespace before '(' from left edge of string
  const foundMethodCallStatus: boolean = methodOpenRegEx.test(line);
  _logMessage(`spCom: isMaskedDebugMethodCall([${line}]) -> (${foundMethodCallStatus})`, ctx);

  return foundMethodCallStatus;
}

export function isMethodCallEmptyParens(line: string): boolean {
  const methodOpenRegEx = /^\s*\(\)/; // match zero or more whitespace before '()' from left edge of string
  return methodOpenRegEx.test(line);
}

export function containsSpinLanguageSpec(line: string, ctx: Context | undefined = undefined): boolean {
  // return T/F where T means {Spin2_v##} was found in given string
  const languageVersionRegEx = /\{Spin2_v/i; // our version specification (just look for left edge)
  const findStatus: boolean = languageVersionRegEx.test(line);
  _logMessage(`* containsSpinLanguageSpec() -> (${findStatus})`, ctx);
  return findStatus;
}

function _logMessage(message: string, ctx: Context | undefined): void {
  //Write to output window.
  if (ctx) {
    ctx.logger.log(message);
  }
}

export function versionFromSpinLanguageSpec(line: string, ctx: Context | undefined = undefined): number {
  // return T/F where T means {Spin2_v##} was found in given string
  let decodedVersion: number = 0; // return no version by default
  const languageVersionRegEx = /\{Spin2_v[0-9][0-9]\}/i; // our version specification - well formatted 0-99
  const languageVersionThousandsRegEx = /\{Spin2_v[0-9][0-9][0-9]\}/i; // our version specification - well formatted 0-999
  const is2digit: boolean = languageVersionRegEx.test(line);
  const is3digit: boolean = languageVersionThousandsRegEx.test(line);
  // if have fully formatted version
  if (is2digit || is3digit) {
    if (containsSpinLanguageSpec(line)) {
      const matchText: string = '{Spin2_v'.toLowerCase();
      const verOffset: number = line.toLowerCase().indexOf(matchText);
      //_logMessage(`  -- VFSLS() is2digit=(${is2digit}), is3digit(${is3digit}), verOffset=(${verOffset})`, ctx);
      if (verOffset != -1) {
        if (is3digit) {
          const hundreds: number = parseInt(line.charAt(verOffset + matchText.length));
          const tens: number = parseInt(line.charAt(verOffset + matchText.length + 1));
          const ones: number = parseInt(line.charAt(verOffset + matchText.length + 2));
          decodedVersion = hundreds * 100 + tens * 10 + ones;
        } else {
          //_logMessage(
          //    `  -- VFSLS() PARSE tens=(${line.charAt(verOffset + matchText.length)}), ones=(${line.charAt(verOffset + matchText.length + 1)})`,
          //    ctx
          //);
          const tens: number = parseInt(line.charAt(verOffset + matchText.length));
          const ones: number = parseInt(line.charAt(verOffset + matchText.length + 1));
          decodedVersion = tens * 10 + ones;
          //_logMessage(`  -- VFSLS() parsing tens=(${tens}), ones=(${ones}) -> (${decodedVersion})`, ctx);
        }
      }
      // special: disallow unreleased versions:
      // - 41 is base version so say 0
      // - 42 was not released so say zero
      // - 40 or less is also 0
      if (decodedVersion < 43) {
        _logMessage(`  -- VFSLS() Replace unsupported (${decodedVersion}) with (0)!`, ctx);
        decodedVersion = 0;
      }
    }
  }
  _logMessage(`  -- Returning language spec of (${decodedVersion}) for [${line}]`, ctx);
  return decodedVersion;
}

export class SpinControlFlowTracker {
  private flowStatementStack: ICurrControlStatement[] = []; // nested statement tracking
  private flowLogEnabled: boolean = false;
  private ctx: Context | undefined = undefined;

  constructor() {}

  public enableLogging(ctx: Context, doEnable: boolean = true): void {
    this.flowLogEnabled = doEnable;
    this.ctx = ctx;
  }

  private _logMessage(message: string): void {
    if (this.flowLogEnabled) {
      //Write to output window.
      if (this.ctx) {
        this.ctx.logger.log(message);
      }
    }
  }

  public reset() {
    this.flowStatementStack = [];
  }

  public startControlFlow(name: string, startLineCharOffset: number, startLineIdx: number) {
    // record start of possible nest flow control statements
    this._logMessage(`- SFlowCtrl: start([${name}], ofs=${startLineCharOffset}, Ln#${startLineIdx + 1})`);
    const flowItem: ICurrControlStatement = {
      startLineIdx: startLineIdx,
      startLineCharOffset: startLineCharOffset,
      type: this.typeForControlFlowName(name)
    };
    this.flowStatementStack.push(flowItem);
  }

  public isControlFlow(possibleName: string): boolean {
    // return T/F where T means {possibleName} is start of spin control-flow statement
    const possibleNesting: boolean = this.typeForControlFlowName(possibleName) != eControlFlowType.Unknown;
    return possibleNesting;
  }

  public finishControlFlow(endLineIdx: number): ICurrControlSpan[] {
    const closedFlowSpans: ICurrControlSpan[] = [];
    this._logMessage(`- SFlowCtrl: finish(Ln#${endLineIdx + 1})`);
    if (this.flowStatementStack.length > 0) {
      do {
        const currStatement: ICurrControlStatement = this.flowStatementStack[this.flowStatementStack.length - 1];
        const newClosedSpan: ICurrControlSpan = {
          startLineIdx: currStatement.startLineIdx,
          endLineIdx: endLineIdx
        };
        closedFlowSpans.push(newClosedSpan);
        this.flowStatementStack.pop();
      } while (this.flowStatementStack.length > 0);
    }
    return closedFlowSpans;
  }

  public endControlFlow(possibleName: string, endLineCharOffset: number, endLineIdx: number): ICurrControlSpan[] {
    // record end of possible flow control statement, reporting any flows which this completess
    const closedFlowSpans: ICurrControlSpan[] = [];
    const possibleNesting: boolean = this.isControlFlow(possibleName);
    this._logMessage(`- SFlowCtrl: end([${possibleName}], ofs=${endLineCharOffset}, Ln#${endLineIdx + 1}) - possibleNesting=${possibleNesting}`);
    if (this.flowStatementStack.length > 0) {
      do {
        let endThisNesting: boolean = false;
        const currStatement: ICurrControlStatement = this.flowStatementStack[this.flowStatementStack.length - 1];
        const delayClose: boolean = this.delayClose(possibleName, currStatement.type);
        // did this statment-indent-level end a flow control statement?
        if (currStatement.startLineCharOffset < endLineCharOffset) {
          // indented even further, no this does not end this one
          break; // nope, abort
        } else if (currStatement.startLineCharOffset == endLineCharOffset) {
          // line is at same indent level we are not nesting another flow-control, yes, this ENDs it
          endThisNesting = delayClose ? false : true;
        } else {
          // line is indented less than control, this does END it!
          endThisNesting = delayClose ? false : true;
        }
        if (endThisNesting) {
          const newClosedSpan: ICurrControlSpan = {
            startLineIdx: currStatement.startLineIdx,
            endLineIdx: endLineIdx - 1
          };
          this._logMessage(`- SFlowCtrl:  - close [Ln#${newClosedSpan.startLineIdx + 1} - ${newClosedSpan.endLineIdx + 1}]`);
          closedFlowSpans.push(newClosedSpan);
          this.flowStatementStack.pop();
        } else {
          break;
        }
      } while (this.flowStatementStack.length > 0);
    }
    if (possibleNesting) {
      // no prior control flow checks in progres, just start this new one
      this.startControlFlow(possibleName, endLineCharOffset, endLineIdx);
    }
    return closedFlowSpans;
  }

  private delayClose(name: string, type: eControlFlowType): boolean {
    let shouldDelay: boolean = false;
    if (type == eControlFlowType.inRepeat) {
      if (name.toLowerCase() === 'while') {
        shouldDelay = true;
      } else if (name.toLowerCase() === 'until') {
        shouldDelay = true;
      }
    }
    return shouldDelay;
  }

  private typeForControlFlowName(name: string): eControlFlowType {
    let desiredType: eControlFlowType = eControlFlowType.Unknown;
    if (name.toLowerCase() === 'if') {
      desiredType = eControlFlowType.inIf;
    } else if (name.toLowerCase() === 'ifnot') {
      desiredType = eControlFlowType.inIf;
    } else if (name.toLowerCase() === 'elseif') {
      desiredType = eControlFlowType.inIf;
    } else if (name.toLowerCase() === 'else') {
      desiredType = eControlFlowType.inIf;
    } else if (name.toLowerCase() === 'elseifnot') {
      desiredType = eControlFlowType.inIf;
    } else if (name.toLowerCase() === 'repeat') {
      desiredType = eControlFlowType.inRepeat;
    } else if (name.toLowerCase() === 'case') {
      desiredType = eControlFlowType.inCase;
    } else if (name.toLowerCase() === 'case_fast') {
      desiredType = eControlFlowType.inCaseFast;
    }
    return desiredType;
  }
}

export class ContinuedLines {
  private rawLines: string[] = [];
  private rawNoDoubleQuoteLines: string[] = [];
  private rawLineIdxs: number[] = [];
  private singleLine: string = '';
  private haveAllLines: boolean = false;
  private isActive: boolean = false;
  private linesLogEnabled: boolean = false;
  private ctx: Context | undefined = undefined;

  constructor() {}

  public enableLogging(ctx: Context, doEnable: boolean = true): void {
    this.linesLogEnabled = doEnable;
    this.ctx = ctx;
  }

  public clear() {
    //this._logMessage(`    --- ContLn: Clear()`);
    this.rawLineIdxs = [];
    this.rawLines = [];
    this.rawNoDoubleQuoteLines = [];
    this.singleLine = '';
    this.haveAllLines = false;
    this.isActive = false;
  }

  public addLine(nextLine: string, lineIdx: number) {
    if (this.haveAllLines == false) {
      this.rawLines.push(nextLine);
      this.rawLineIdxs.push(lineIdx);
      if (nextLine.split('"').length >= 3) {
        this.rawNoDoubleQuoteLines.push(this.removeDoubleQuotedStrings(nextLine));
      } else {
        this.rawNoDoubleQuoteLines.push(nextLine);
      }
      if (!this.isActive) {
        this.isActive = true;
      }
      if (!nextLine.endsWith('...')) {
        this.haveAllLines = true;
        this._finishLine();
      }
      //this._logMessage(`    --- ContLn: addLine() line=[${nextLine}], lineIdx=(${lineIdx}),  nbrLines=(${this.rawLines.length}), haveAllLines=(${this.haveAllLines})`);
    } else {
      this._logMessage(`    --- ContLn: ERROR addLine() line=[${nextLine}], lineIdx=(${lineIdx}) - attempt add after last line arrived!`);
    }
    if (this.haveAllLines) {
      for (let index = 0; index < this.rawLines.length; index++) {
        const element = this.rawLines[index];
        if (element !== undefined) {
          this._logMessage(`    --- ContLn: (dbg) Ln#${this.rawLineIdxs[index] + 1}} rawLines[${index}]=[${element}](${element.length})`);
        } else {
          this._logMessage(`    --- ContLn: (dbg) Ln#${this.rawLineIdxs[index] + 1}} rawLines[${index}]=[{UNDEFINED}] UNDEFINED!!!`);
        }
      }
    }
  }

  public get isLoading(): boolean {
    // return T/F where T means we don't yet have last line
    const loadingStatus: boolean = this.isActive && !this.haveAllLines;
    return loadingStatus;
  }

  public get isEmpty(): boolean {
    // return T/F where T means we don't yet have the first line
    const emptyStatus: boolean = this.rawLines.length == 0;
    return emptyStatus;
  }

  public get numberLines(): number {
    // return number of lines in multi-line set
    return this.rawLines.length;
  }

  public get hasAllLines(): boolean {
    // return T/F where T means we have all continued lines plus last line, ready for processing
    const allLinesStatus: boolean = this.haveAllLines;
    return allLinesStatus;
  }

  public get lineStartIdx(): number {
    // return index of first line in multi-line set
    return this.rawLineIdxs.length > 0 ? this.rawLineIdxs[0] : -1;
  }

  public get line(): string {
    // return all lines concatenated so we can parse it
    return this.singleLine;
  }

  public lineAt(desiredLineIdx: number): string {
    // return all lines concatenated so we can parse it
    let desiredLine: string = '{-CntLn-lineAt-ERROR-}';
    for (let index = 0; index < this.rawLineIdxs.length; index++) {
      const currlineIdx = this.rawLineIdxs[index];
      if (currlineIdx == desiredLineIdx) {
        desiredLine = this.rawLines[index];
        break;
      }
    }
    //this._logMessage(`    --- ContLn: Ln#(${desiredLineIdx + 1}) -> line=[${desiredLine}]`);
    return desiredLine;
  }

  public offsetIntoLineForPosition(symbolPosition: Position): number {
    let desiredOffset: number = -1;
    if (symbolPosition.line != -1 && symbolPosition.character != -1) {
      // work our way to the offset
      desiredOffset = 0;
      let foundLineWhiteSpaceLength: number = 0;
      let foundIndex: number = 0;
      for (let index = 0; index < this.rawLines.length; index++) {
        const currLine = this.rawLines[index];
        const currIdx = this.rawLineIdxs[index];
        const isLineContinued: boolean = currLine.endsWith('...');
        foundLineWhiteSpaceLength = this._skipWhite(currLine, 0);
        const currLineLength: number = isLineContinued ? this._lengthWithoutContinuation(currLine) + 1 : currLine.trim().length; // +1 is for concatenating " "
        // if the first line, don't take out the leading whitespace
        const accumLength = index == 0 ? foundLineWhiteSpaceLength + currLineLength : currLineLength;
        //this._logMessage(
        ///  `    --- ContLn:   currLnLen=(${foundLineWhiteSpaceLength})+(${currLineLength})=(${
        //    foundLineWhiteSpaceLength + currLineLength
        //  }), foundLineWhiteSpaceLength=(${foundLineWhiteSpaceLength}), desiredOffset=(${desiredOffset}), isLineCont=(${isLineContinued})`
        //);
        if (currIdx == symbolPosition.line) {
          foundIndex = index;
          break;
        }
        desiredOffset += accumLength;
      }
      desiredOffset += foundIndex == 0 ? symbolPosition.character : symbolPosition.character - foundLineWhiteSpaceLength;
    }
    this._logMessage(
      `    --- ContLn: offsetIntoLineForPosition([line=(${symbolPosition.line}), char=(${symbolPosition.character})]) -> (${desiredOffset})`
    );
    if (desiredOffset == -1) {
      this._logMessage(`    --- ContLn:   ERROR bad position given`);
    }
    return desiredOffset;
  }

  public locateSymbol(symbolName: string, offset: number): Position {
    // locate raw line containing symbol (the symbol will NOT span lines)
    let rawIdx: number = 0;
    let remainingOffset: number = offset;
    // subtract earlier line lengths from remainder to locate line our symbol is on
    this._logMessage(
      `    --- ContLn: ENTRY locateSymbol([${symbolName}], srtOfs=(${offset})) - rawLines=(${this.rawLines.length}), Ln#${this.lineStartIdx + 1}-${
        this.lineStartIdx + this.rawLines.length
      }`
    );
    for (let index = 0; index < this.rawLines.length; index++) {
      const rawPossContLine: string = this.rawLines[index];
      const isLineContinued: boolean = rawPossContLine.endsWith('...');
      const currLineLength: number = isLineContinued ? this._lengthWithoutContinuation(rawPossContLine) + 1 : rawPossContLine.trim().length;
      const foundLineWhiteSpaceLength = this._skipWhite(rawPossContLine, 0);
      // if the first line, don't take out the leading whitespace
      const accumLength = index == 0 ? foundLineWhiteSpaceLength + currLineLength : currLineLength;
      const trimmedLineContentOnly: string = isLineContinued ? rawPossContLine.slice(0, -3).trimEnd() : rawPossContLine.trimEnd();
      const remainingString: string =
        index == 0 ? trimmedLineContentOnly.substring(remainingOffset) : trimmedLineContentOnly.trimStart().substring(remainingOffset);
      /*
      this._logMessage(
        `    --- ContLn: ls() - PREP rawIdx=(${rawIdx}), remOffset=(${remainingOffset}), currLnLen=(${currLineLength}), isLineCont=(${isLineContinued})`
      );
      this._logMessage(`    --- ContLn: ls() - PREP   continuedLine=[${rawPossContLine}](${rawPossContLine.length})`);
      this._logMessage(`    --- ContLn: ls() - PREP   remainingString=[${remainingString}](${remainingString.length})`);
      //*/
      // if our offset is not in this line -or- the remainder of this line is not long enough to contain our symbol
      if (remainingOffset >= accumLength) {
        // not in this line... go to next...
        rawIdx++;
        /*
        this._logMessage(
          `    --- ContLn: ls() - NOT-LINE (remOffset=(${remainingOffset}) >= accumLength=(${accumLength})) rawIdx=(${rawIdx}), remOffset=(${remainingOffset - accumLength}), isLineCont=(${isLineContinued})`
        );
        //*/
        remainingOffset -= accumLength;
      } else if (remainingString.length < symbolName.length || remainingString.toUpperCase().indexOf(symbolName.toUpperCase()) == -1) {
        // if not found in remainder of line... go to next
        rawIdx++;
        remainingOffset = 0;
        /*/
        this._logMessage(
          `    --- ContLn: ls() - NOT-LINE rawIdx=(${rawIdx}), remOffset=(${remainingOffset}), currLnLen=(${currLineLength}), isLineCont=(${isLineContinued}) line=[${this.rawLines[rawIdx]}]`
        );
        //*/
      } else {
        // must be in this line!
        /*/
        this._logMessage(
          `    --- ContLn: ls() - THIS-LINE rawIdx=(${rawIdx}), remOffset=(${remainingOffset}), currLnLen=(${currLineLength}), isLineCont=(${isLineContinued}) line=[${this.rawLines[rawIdx]}]`
        );
        //*/
        break; // symbol is in this line
      }
    }

    let desiredLocation: Position = Position.create(this.rawLineIdxs[rawIdx], -1);
    if (rawIdx > this.rawLines.length - 1) {
      this._logMessage(`    --- ContLn: ERROR locateSymbol([${symbolName}], ofs=(${offset})) - math when off of end of lineSet`);
    } else {
      const lineIdx: number = this.rawLineIdxs[rawIdx];
      const searchLine: string = symbolName.includes('"') ? this.rawLines[rawIdx] : this.rawNoDoubleQuoteLines[rawIdx];
      const leadingWhiteLength: number = rawIdx > 0 ? this._skipWhite(searchLine, 0) : 0;
      // NEVER look within double-quoted strings
      const symbolOffset: number = searchLine.toUpperCase().indexOf(symbolName.toUpperCase(), leadingWhiteLength + remainingOffset);
      /*/
      this._logMessage(
        `    --- ContLn: lineIdx=(${lineIdx}),  leadingWhiteLength=(${leadingWhiteLength}), remOffset=(${remainingOffset}), searchLine=[${searchLine}](${searchLine.length})`
      );
      //*/
      desiredLocation = Position.create(lineIdx, symbolOffset);
      //this._logMessage(`    --- ContLn: locateSymbol() -> Posn=[line=(${lineIdx}), char=(${symbolOffset})]`);
      if (symbolOffset != -1) {
        this._logMessage(`    --- ContLn:    Found [${symbolName}] IN Ln#${lineIdx + 1} [${searchLine}](${searchLine.length})`);
      } else {
        this._logMessage(`    --- ERROR NOT found! ?? [${symbolName}] NOT in line=[${searchLine}] ??`);
      }
    }
    return desiredLocation;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public removeDoubleQuotedStrings(line: string, showDebug: boolean = true): string {
    //this.logMessage('- RQS line [' + line + ']');
    let trimmedLine: string = line;
    //this.logMessage('- RQS line [' + line + ']');
    const doubleQuote: string = '"';
    let quoteStartOffset: number = 0; // value doesn't matter
    //let didRemove: boolean = false;
    while ((quoteStartOffset = trimmedLine.indexOf(doubleQuote)) != -1) {
      const quoteEndOffset: number = trimmedLine.indexOf(doubleQuote, quoteStartOffset + 1);
      //this.logMessage('  -- quoteStartOffset=[' + quoteStartOffset + '] quoteEndOffset=[' + quoteEndOffset + ']');
      if (quoteEndOffset != -1) {
        const badElement = trimmedLine.substr(quoteStartOffset, quoteEndOffset - quoteStartOffset + 1);
        //this.logMessage('  -- badElement=[' + badElement + ']');
        trimmedLine = trimmedLine.replace(badElement, '#'.repeat(badElement.length));
        //didRemove = showDebug ? true : false;
        //this.logMessage('-         post[' + trimmedLine + ']');
      } else {
        break; // we don't handle a single double-quote
      }
    }

    //if (didRemove) {
    //    this.logMessage('  -- RQS line [' + line + ']');
    //    this.logMessage('  --          [' + trimmedLine + ']');
    //}

    return trimmedLine;
  }

  private _skipWhite(line: string, currentOffset: number): number {
    let firstNonWhiteIndex: number = currentOffset;
    for (let index = currentOffset; index < line.length; index++) {
      if (line.substr(index, 1) != ' ' && line.substr(index, 1) != '\t') {
        firstNonWhiteIndex = index;
        break;
      }
    }
    return firstNonWhiteIndex;
  }

  private _lengthWithoutContinuation(line: string): number {
    // remove leading white-space and trailing spaces so we only have 1 between ea. after lines joined
    let desiredLength: number = line.trim().length;
    if (line.endsWith('...')) {
      const tempLine: string = line.slice(0, -3);
      desiredLength = tempLine.trim().length;
    }
    return desiredLength;
  }

  private _finishLine() {
    const nonContinusedStrings: string[] = [];
    for (let index = 0; index < this.rawLines.length; index++) {
      const continuedLine: string = this.rawLines[index];
      if (continuedLine.endsWith('...')) {
        if (index == 0) {
          // first line, we don't left-trim
          nonContinusedStrings.push(continuedLine.slice(0, -3).trimEnd()); // removing "..." as we go
        } else {
          // remaining lines, we left and right trim
          nonContinusedStrings.push(continuedLine.slice(0, -3).trim()); // removing "..." as we go
        }
      } else {
        // this is last or only line
        if (index == 0) {
          // only line we don't left-trim
          nonContinusedStrings.push(continuedLine.trimEnd());
        } else {
          // last-line, we left and right trim
          nonContinusedStrings.push(continuedLine.trim());
        }
      }
    }
    this.singleLine = nonContinusedStrings.join(' ');
  }

  private _logMessage(message: string): void {
    if (this.linesLogEnabled) {
      //Write to output window.
      if (this.ctx) {
        this.ctx.logger.log(message);
      }
    }
  }
}
