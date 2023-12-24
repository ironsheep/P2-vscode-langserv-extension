"use strict";
// server/src/parser/spin.semantic.findings.ts

import { Position } from "vscode-languageserver-types";
import { Context } from "../context";
import { timeStamp } from "console";
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
  ddtMidi,
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
  BIT_VARIABLE,
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
  inNothing,
}

export enum eControlFlowType {
  Unknown = 0,
  inCase,
  inCaseFast,
  inRepeat,
  inIf,
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

export function haveDebugLine(line: string, startsWith: boolean = false): boolean {
  const debugStatementOpenRegEx = /debug\s*\(/i; // case-insensative debug() but allowing whitespace before '('
  const debugStatementOpenStartRegEx = /^\s*debug\s*\(/i; // case-insensative debug() at start of line but allowing whitespace before '('
  return startsWith ? debugStatementOpenStartRegEx.test(line) : debugStatementOpenRegEx.test(line);
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
    const flowItem: ICurrControlStatement = { startLineIdx: startLineIdx, startLineCharOffset: startLineCharOffset, type: this.typeForControlFlowName(name) };
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
        const newClosedSpan: ICurrControlSpan = { startLineIdx: currStatement.startLineIdx, endLineIdx: endLineIdx };
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
          const newClosedSpan: ICurrControlSpan = { startLineIdx: currStatement.startLineIdx, endLineIdx: endLineIdx - 1 };
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
      if (name.toLowerCase() === "while") {
        shouldDelay = true;
      } else if (name.toLowerCase() === "until") {
        shouldDelay = true;
      }
    }
    return shouldDelay;
  }

  private typeForControlFlowName(name: string): eControlFlowType {
    let desiredType: eControlFlowType = eControlFlowType.Unknown;
    if (name.toLowerCase() === "if") {
      desiredType = eControlFlowType.inIf;
    } else if (name.toLowerCase() === "ifnot") {
      desiredType = eControlFlowType.inIf;
    } else if (name.toLowerCase() === "elseif") {
      desiredType = eControlFlowType.inIf;
    } else if (name.toLowerCase() === "else") {
      desiredType = eControlFlowType.inIf;
    } else if (name.toLowerCase() === "elseifnot") {
      desiredType = eControlFlowType.inIf;
    } else if (name.toLowerCase() === "repeat") {
      desiredType = eControlFlowType.inRepeat;
    } else if (name.toLowerCase() === "case") {
      desiredType = eControlFlowType.inCase;
    } else if (name.toLowerCase() === "case_fast") {
      desiredType = eControlFlowType.inCaseFast;
    }
    return desiredType;
  }
}

export class ContinuedLines {
  private rawLines: string[] = [];
  private rawLineIdxs: number[] = [];
  private singleLine: string = "";
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
    this.singleLine = "";
    this.haveAllLines = false;
    this.isActive = false;
  }

  public addLine(nextLine: string, lineIdx: number) {
    if (this.haveAllLines == false) {
      this.rawLines.push(nextLine);
      this.rawLineIdxs.push(lineIdx);
      if (!this.isActive) {
        this.isActive = true;
      }
      if (!nextLine.endsWith("...")) {
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
        if (element) {
          this._logMessage(`    --- ContLn: (dbg) Ln#${this.rawLineIdxs[index] + 1}} rawLines[${index}]=[${element}](${element.length})`);
        } else {
          this._logMessage(`    --- ContLn: (dbg) Ln#${this.rawLineIdxs[index] + 1}} rawLines[${index}]=[${element}] UNDEFINED!!!`);
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
    let desiredLine: string = "{-CntLn-lineAt-ERROR-}";
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
      let bFoundLine: boolean = false;
      let foundLineWhiteSpaceLength: number = 0;
      let foundIndex: number = 0;
      for (let index = 0; index < this.rawLines.length; index++) {
        const currLine = this.rawLines[index];
        const currIdx = this.rawLineIdxs[index];
        const isLineContinued: boolean = currLine.endsWith("...");
        foundLineWhiteSpaceLength = this._skipWhite(currLine, 0);
        const currLineLength: number = isLineContinued ? this._lengthWithoutContinuation(currLine) + 1 : currLine.trim().length; // +1 is for concatenating " "
        // if the first line, don't take out the leading whitespace
        const accumLength = index == 0 ? foundLineWhiteSpaceLength + currLineLength : currLineLength;
        this._logMessage(
          `    --- ContLn:   currLineLength=(${foundLineWhiteSpaceLength})+(${currLineLength})=(${
            foundLineWhiteSpaceLength + currLineLength
          }), foundLineWhiteSpaceLength=(${foundLineWhiteSpaceLength}), desiredOffset=(${desiredOffset}), isLineContinued=(${isLineContinued})`
        );
        if (currIdx == symbolPosition.line) {
          bFoundLine = true;
          foundIndex = index;
          break;
        }
        desiredOffset += accumLength;
      }
      desiredOffset += foundIndex == 0 ? symbolPosition.character : symbolPosition.character - foundLineWhiteSpaceLength;
    }
    this._logMessage(`    --- ContLn: offsetIntoLineForPosition([line=(${symbolPosition.line}), char=(${symbolPosition.character})]) -> (${desiredOffset})`);
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
      `    --- ContLn: ENTRY locateSymbol([${symbolName}], srtOfs=(${offset})) - rawLines=(${this.rawLines.length}), Ln#${this.lineStartIdx + 1}-${this.lineStartIdx + this.rawLines.length}`
    );
    for (let index = 0; index < this.rawLines.length; index++) {
      const rawPossContLine: string = this.rawLines[index];
      const isLineContinued: boolean = rawPossContLine.endsWith("...");
      const currLineLength: number = isLineContinued ? this._lengthWithoutContinuation(rawPossContLine) + 1 : rawPossContLine.trim().length;
      const foundLineWhiteSpaceLength = this._skipWhite(rawPossContLine, 0);
      // if the first line, don't take out the leading whitespace
      const accumLength = index == 0 ? foundLineWhiteSpaceLength + currLineLength : currLineLength;
      const trimmedLineContentOnly: string = isLineContinued ? rawPossContLine.slice(0, -3).trimEnd() : rawPossContLine.trimEnd();
      const remainingString: string = index == 0 ? trimmedLineContentOnly.substring(remainingOffset) : trimmedLineContentOnly.trimStart().substring(remainingOffset);
      /*
      this._logMessage(`    --- ContLn: ls()           - CHECKING rawIdx=(${rawIdx}), remainingOffset=(${remainingOffset}), currLineLength=(${currLineLength}), isLineContinued=(${isLineContinued})`);
      this._logMessage(`    --- ContLn: ls()           - CHECKING   continuedLine=[${rawPossContLine}](${rawPossContLine.length})`);
      this._logMessage(`    --- ContLn: ls()           - CHECKING   remainingString=[${remainingString}](${remainingString.length})`);
      //*/
      // if our offset is not in this line -or- the remainder of this line is not long enough to contain our symbol
      if (remainingOffset >= accumLength) {
        // not in this line... go to next...
        rawIdx++;
        remainingOffset -= accumLength;
        //this._logMessage(
        //  `    --- ContLn: ls()           - NOT-LINE rawIdx=(${rawIdx}), remainingOffset=(${remainingOffset}), currLineLength=(${currLineLength}), isLineContinued=(${isLineContinued})`
        //);
      } else if (remainingString.length < symbolName.length || remainingString.indexOf(symbolName) == -1) {
        // if not found in remainder of line... go to next
        rawIdx++;
        remainingOffset = 0;
      } else {
        // must be in this line!
        this._logMessage(
          `    --- ContLn:   locateSymbol() - THIS-LINE rawIdx=(${rawIdx}), remainingOffset=(${remainingOffset}), currLineLength=(${currLineLength}), isLineContinued=(${isLineContinued})`
        );
        break; // symbol is in this line
      }
    }

    let desiredLocation: Position = Position.create(this.rawLineIdxs[rawIdx], -1);
    if (rawIdx > this.rawLines.length - 1) {
      this._logMessage(`    --- ContLn: ERROR locateSymbol([${symbolName}], ofs=(${offset})) - math when off of end of lineSet`);
    } else {
      const lineIdx: number = this.rawLineIdxs[rawIdx];
      const searchLine: string = this.rawLines[rawIdx];
      const leadingWhiteLength: number = rawIdx > 0 ? this._skipWhite(searchLine, 0) : 0;
      const symbolOffset: number = this.rawLines[rawIdx].indexOf(symbolName, leadingWhiteLength + remainingOffset);
      //this._logMessage(`    --- ContLn: lineIdx=(${lineIdx}),  leadingWhiteLength=(${leadingWhiteLength}), remainingOffset=(${remainingOffset}), searchLine=[${searchLine}](${searchLine.length})`);
      desiredLocation = Position.create(lineIdx, symbolOffset);
      //this._logMessage(`    --- ContLn: locateSymbol() -> Posn=[line=(${lineIdx}), char=(${symbolOffset})]`);
      if (symbolOffset != -1) {
        this._logMessage(`    --- ContLn:    Found [${symbolName}] IN Ln#${lineIdx + 1} [${this.rawLines[rawIdx]}](${this.rawLines[rawIdx].length})`);
      } else {
        this._logMessage(`    --- ERROR NOT found! ?? [${symbolName}] NOT in line=[${this.rawLines[rawIdx]}] ??`);
      }
    }
    return desiredLocation;
  }

  private _skipWhite(line: string, currentOffset: number): number {
    let firstNonWhiteIndex: number = currentOffset;
    for (let index = currentOffset; index < line.length; index++) {
      if (line.substr(index, 1) != " " && line.substr(index, 1) != "\t") {
        firstNonWhiteIndex = index;
        break;
      }
    }
    return firstNonWhiteIndex;
  }

  private _lengthWithoutContinuation(line: string): number {
    // remove leading white-space and trailing spaces so we only have 1 between ea. after lines joined
    let desiredLength: number = line.trim().length;
    if (line.endsWith("...")) {
      const tempLine: string = line.slice(0, -3);
      desiredLength = tempLine.trim().length;
    }
    return desiredLength;
  }

  private _finishLine() {
    const nonContinusedStrings: string[] = [];
    for (let index = 0; index < this.rawLines.length; index++) {
      const continuedLine: string = this.rawLines[index];
      if (continuedLine.endsWith("...")) {
        if (index == 0) {
          // first line we don't left-trim
          nonContinusedStrings.push(continuedLine.slice(0, -3).trimEnd()); // removing "..." as we go
        } else {
          // remaining lines we left and right trim
          nonContinusedStrings.push(continuedLine.slice(0, -3).trim()); // removing "..." as we go
        }
      } else {
        // last line we left and right trim
        nonContinusedStrings.push(continuedLine.trim());
      }
    }
    this.singleLine = nonContinusedStrings.join(" ");
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
