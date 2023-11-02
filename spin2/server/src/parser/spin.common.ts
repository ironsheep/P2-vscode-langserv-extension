"use strict";
// server/src/parser/spin.semantic.findings.ts

import { Position } from "vscode-languageserver-types";

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

export class continuedLines {
  startLineIdx: number;
  rawLines: string[];
  singleLine: string = "";
  haveAllLines: boolean = false;

  constructor(initialLine: string, lineIdx: number) {
    this.rawLines = [initialLine];
    this.startLineIdx = lineIdx;
    if (!initialLine.endsWith("...")) {
      this.haveAllLines = true;
      this._finishLine();
    }
  }

  public addLine(nextLine: string) {
    if (this.haveAllLines == false) {
      this.rawLines.push(nextLine);
      if (!nextLine.endsWith("...")) {
        this.haveAllLines = true;
        this._finishLine();
      }
    }
  }

  public get line(): string {
    return this.singleLine;
  }

  private _finishLine() {
    const nonContinusedStrings: string[] = [];
    for (let index = 0; index < this.rawLines.length; index++) {
      const continuedLine: string = this.rawLines[index];
      nonContinusedStrings.push(continuedLine.slice(0, -3)); // removing "..." as we go
    }
    this.singleLine = nonContinusedStrings.join(" ");
  }

  public locateSymbol(symbolName: string, offset: number): Position {
    // locate raw line containing symbol (it will NOT span lines)
    let rawIdx: number = 0;
    let remainingOffset: number = offset;
    for (let index = 0; index < this.rawLines.length; index++) {
      const continuedLine: string = this.rawLines[index];
      if (remainingOffset > continuedLine.length - 3) {
        rawIdx++;
        remainingOffset -= continuedLine.length - 3;
      } else {
        break; // symbol is in this line
      }
    }
    const symbolOffset: number = this.rawLines[rawIdx].indexOf(symbolName);
    const lineIdx: number = symbolOffset != -1 ? this.startLineIdx + rawIdx : -1;
    const desiredLocation: Position = Position.create(lineIdx, symbolOffset);
    return desiredLocation;
  }
}
