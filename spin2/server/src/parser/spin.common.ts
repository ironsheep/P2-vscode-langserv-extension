"use strict";
// server/src/parser/spin.semantic.findings.ts

import { Position } from "vscode-languageserver-types";
import { Context } from "../context";
import { isBuffer } from "util";

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
  const debugStatementOpenStartRegEx = /^debug\s*\(/i; // case-insensative debug() at start of line but allowing whitespace before '('
  return startsWith ? debugStatementOpenStartRegEx.test(line) : debugStatementOpenRegEx.test(line);
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
    //this._logMessage(`  -- CntLn: Clear()`);
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
      this._logMessage(`  -- CntLn: addLine() line=[${nextLine}], lineIdx=(${lineIdx}),  nbrLines=(${this.rawLines.length}), haveAllLines=(${this.haveAllLines})`);
    } else {
      this._logMessage(`  -- CntLn: ERROR addLine() line=[${nextLine}], lineIdx=(${lineIdx}) - attempt add after last line arrived!`);
    }
    if (this.haveAllLines) {
      for (let index = 0; index < this.rawLines.length; index++) {
        const element = this.rawLines[index];
        if (element) {
          this._logMessage(`  -- CntLn: (dbg) Ln#${this.rawLineIdxs[index] + 1}} rawLines[${index}]=[${element}](${element.length})`);
        } else {
          this._logMessage(`  -- CntLn: (dbg) Ln#${this.rawLineIdxs[index] + 1}} rawLines[${index}]=[${element}] UNDEFINED!!!`);
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
    //this._logMessage(`  -- CntLn: Ln#(${desiredLineIdx + 1}) -> line=[${desiredLine}]`);
    return desiredLine;
  }

  public offsetIntoLineForPosition(symbolPosition: Position): number {
    let desiredOffset: number = -1;
    if (symbolPosition.line != -1 && symbolPosition.character != -1) {
      // work our way to the offset
      desiredOffset = 0;
      let bFoundLine: boolean = false;
      let foundLineWhiteSpaceLength: number = 0;
      for (let index = 0; index < this.rawLines.length; index++) {
        const currLine = this.rawLines[index];
        const currIdx = this.rawLineIdxs[index];
        const isLineContinued: boolean = currLine.endsWith("...");
        const currLineLength: number = isLineContinued ? this._lengthWithoutContinuation(currLine) + 1 : currLine.length; // +1 is for concatenating " "
        foundLineWhiteSpaceLength = this._skipWhite(currLine, 0);
        if (currIdx == symbolPosition.line) {
          bFoundLine = true;
          break;
        }
        desiredOffset += currLineLength;
      }
      desiredOffset += symbolPosition.character - foundLineWhiteSpaceLength;
    }
    this._logMessage(`  -- CntLn: offsetIntoLineForPosition([line=(${symbolPosition.line}), char=(${symbolPosition.character})]) -> (${desiredOffset})`);
    if (desiredOffset == -1) {
      this._logMessage(`  -- CntLn:   ERROR bad position given`);
    }
    return desiredOffset;
  }

  public locateSymbol(symbolName: string, offset: number): Position {
    // locate raw line containing symbol (the symbol will NOT span lines)
    let rawIdx: number = 0;
    let remainingOffset: number = offset;
    // subtract earlier line lengths from remainder to locate line our symbol is on
    this._logMessage(`  -- CntLn: locateSymbol([${symbolName}], ofs=(${offset})) - rawLines=(${this.rawLines.length}), Lines=[${this.lineStartIdx + 1}-${this.lineStartIdx + this.rawLines.length}]`);
    for (let index = 0; index < this.rawLines.length; index++) {
      const rawPossContLine: string = this.rawLines[index];
      const isLineContinued: boolean = rawPossContLine.endsWith("...");
      const currLineLength: number = isLineContinued ? this._lengthWithoutContinuation(rawPossContLine) + 1 : rawPossContLine.length;
      //this._logMessage(
      //  `  -- CntLn: locateSymbol() - CHECKING rawIdx=(${rawIdx}), remainingOffset=(${remainingOffset}), currLineLength=(${currLineLength}), isLineContinued=(${isLineContinued}) continuedLine=[${rawPossContLine}](${rawPossContLine.length})`
      //);
      // if our offset is not in this line -or- the remainder of this line is not long enough to contain our symbol
      if (remainingOffset > currLineLength) {
        rawIdx++;
        remainingOffset -= currLineLength + 1;
        //this._logMessage(`  -- CntLn: locateSymbol() - NOT-LINE rawIdx=(${rawIdx}), remainingOffset=(${remainingOffset}), currLineLength=(${currLineLength}), isLineContinued=(${isLineContinued})`);
      } else if (currLineLength - remainingOffset < symbolName.length) {
        rawIdx++;
        remainingOffset = 0;
        //this._logMessage(`  -- CntLn: locateSymbol() - NOT-FIT rawIdx=(${rawIdx}), remainingOffset=(${remainingOffset}), currLineLength=(${currLineLength}), isLineContinued=(${isLineContinued})`);
      } else {
        //this._logMessage(`  -- CntLn: locateSymbol() - THIS-LINE rawIdx=(${rawIdx}), remainingOffset=(${remainingOffset}), currLineLength=(${currLineLength}), isLineContinued=(${isLineContinued})`);
        break; // symbol is in this line
      }
    }

    let desiredLocation: Position = Position.create(this.rawLineIdxs[rawIdx], -1);
    if (rawIdx > this.rawLines.length - 1) {
      this._logMessage(`  -- CntLn: ERROR locateSymbol([${symbolName}], ofs=(${offset})) - math when off of end of lineSet`);
    } else {
      const lineIdx: number = this.rawLineIdxs[rawIdx];
      const searchLine: string = this.rawLines[rawIdx];
      const leadingWhiteLength: number = this._skipWhite(searchLine, 0);
      const symbolOffset: number = this.rawLines[rawIdx].indexOf(symbolName, leadingWhiteLength + remainingOffset);
      //this._logMessage(`  -- CntLn: lineIdx=(${lineIdx}),  leadingWhiteLength=(${leadingWhiteLength}), remainingOffset=(${remainingOffset}), searchLine=[${searchLine}](${searchLine.length})`);
      desiredLocation = Position.create(lineIdx, symbolOffset);
      this._logMessage(`  -- CntLn: locateSymbol([${symbolName}], ofs=(${offset})) -> Posn=[line=(${lineIdx}), char=(${symbolOffset})]`);
      if (symbolOffset != -1) {
        this._logMessage(`     in Ln#${lineIdx + 1} [${this.rawLines[rawIdx] + 1}]`);
      } else {
        this._logMessage(`     ERROR NOT found! [${symbolName}] NOT in line=[${this.rawLines[rawIdx]}] ??`);
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
    let desiredLength: number = line.length;
    if (line.endsWith("...")) {
      const tempLine: string = line.slice(0, -3).trimEnd(); // remove trailing spaces so we only have 1 between ea. after lines joined
      desiredLength = tempLine.trim().length; // and don't count leading white-space
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
