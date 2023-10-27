"use strict";
// src/parser/spin2.utils.ts

import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Context } from "../context";
import { GetWordRangeAtPosition, DocumentLineAt, PositionIsEqual, PositionIsAfter, PositionTranslate } from "./lsp.textDocument.utils";
import { isSpin1File } from "./lang.utils";

export interface IPairs {
  start: number;
  end: number;
}

export interface IDefinitionInfo {
  file?: string;
  line: number;
  column: number;
  doc?: string;
  declarationlines: string[];
  parameters?: string[];
  returns?: string[];
  name?: string;
  toolUsed: string;
}

export interface IDefinitionInput {
  document: TextDocument;
  position: lsp.Position;
  word: string;
  includeDocs: boolean;
}

export class ExtensionUtils {
  private bLogEnabled: boolean = false;
  private ctx: Context;

  private spin1ControlFlowKeywords: string[] = ["if", "ifnot", "elseif", "elseifnot", "else", "while", "repeat", "until", "from", "to", "step", "next", "quit", "case", "other", "abort", "return"];
  private spin2ControlFlowKeywords: string[] = ["if", "ifnot", "elseif", "elseifnot", "else", "case", "case_fast", "repeat", "from", "to", "step", "while", "until", "next", "quit"];

  public constructor(ctx: Context, isLogging: boolean) {
    this.ctx = ctx;
    this.bLogEnabled = isLogging;
    this._logMessage("* Global, Local, MethodScoped Token repo's ready");
  }

  //
  // PUBLIC Methods
  //
  public adjustWordPosition(document: TextDocument, position: lsp.Position, isInBlockComment: boolean, inPasmCodeStatus: boolean): [boolean, string, string, lsp.Position] {
    const lineText = DocumentLineAt(document, position);
    const spin1File: boolean = isSpin1File(document.uri);
    const spinControlFlowKeywords: string[] = spin1File ? this.spin1ControlFlowKeywords : this.spin2ControlFlowKeywords;
    let wordRange: lsp.Range | undefined = GetWordRangeAtPosition(lineText, position);
    if (inPasmCodeStatus) {
      // do fixup for Spin2 pasm local labels
      const P2_LOCAL_LABEL_PREFIX: string = ".";
      const P1_LOCAL_LABEL_PREFIX: string = ":";
      if (wordRange?.start.character > 0 && (lineText.charAt(wordRange.start.character - 1) == P2_LOCAL_LABEL_PREFIX || lineText.charAt(wordRange.start.character - 1) == P1_LOCAL_LABEL_PREFIX)) {
        const newStart: lsp.Position = PositionTranslate(wordRange.start, 0, -1);
        wordRange = { start: { line: newStart.line, character: newStart.character }, end: { line: wordRange?.end.line, character: wordRange?.end.character } };
      }
    }
    const tmpWord: string = wordRange ? document.getText(wordRange) : "";
    let lineParts: string[] = [tmpWord];
    let rangeDots: boolean = false;
    if (tmpWord.includes("..")) {
      lineParts = tmpWord.split("..");
      rangeDots = true;
    } else if (tmpWord.includes(".")) {
      lineParts = tmpWord.split(".");
    }
    let word: string = "";
    let objectRef: string = "";
    switch (lineParts.length) {
      case 0:
        break;
      case 1:
        word = lineParts[0];
        break;
      default:
        if (rangeDots) {
          // use position to determine which word to return
          const secondWordOffset: number = wordRange.start.character + lineParts[0].length + 2;
          word = position.character >= secondWordOffset ? lineParts[1] : lineParts[0];
        } else {
          // one dot or more ... we take only last two items, unless user wants just first word
          word = lineParts[lineParts.length - 1];
          objectRef = lineParts[lineParts.length - 2];
          if (position.character < wordRange.start.character + lineParts[0].length) {
            word = objectRef;
            objectRef = "";
          }
        }
        break;
    }
    //const word: string = lineParts.length == 1 ? lineParts[0] : "";
    //const objectRef: string = "";

    this._logMessage(
      `+ sp2Utils: adjustWordPosition() ENTRY  wordRange=[${wordRange?.start.line}:${wordRange?.start.character}-${wordRange?.end.line}:${wordRange?.end.character}], obj=[${objectRef}], word=[${word}]`
    );
    // TODO: fix this for spin comments vs. // comments

    const stringsFound: IPairs[] = this.getStringPairOffsets(lineText);
    const ticVarsFound: IPairs[] = this.getPairOffsetsOfTicVarWraps(lineText);
    //const stringsFound: IPairs[] = [];
    let isPositionInComment: boolean = this.isPositionInComment(document, position, stringsFound);
    if (!isPositionInComment) {
      isPositionInComment = isInBlockComment;
      this._logMessage(`+ sp2Utils: adjustWordPosition() (post-block): isPositionInComment=${isPositionInComment}`);
    }
    if (!wordRange || this.isPositionInString(document, position, stringsFound, ticVarsFound) || isPositionInComment || word.match(/^\d+.?\d+$/) || spinControlFlowKeywords.indexOf(word) > 0) {
      this._logMessage(`+ sp2Utils: adjustWordPosition() EXIT false`);
      return [false, null!, null!, null!];
    }
    if (PositionIsEqual(position, wordRange.end) && PositionIsAfter(position, wordRange.start)) {
      position = PositionTranslate(position, 0, -1);
    }

    this._logMessage(`+ sp2Utils: adjustWordPosition() EXIT true`);
    return [true, objectRef, word, position];
  }

  public isPositionInString(document: TextDocument, position: lsp.Position, stringsInLine: IPairs[], ticVarsInLine: IPairs[]): boolean {
    let inStringStatus: boolean = false;
    const lineText = DocumentLineAt(document, position);
    let inTicVar: boolean = false;
    if (ticVarsInLine.length > 0) {
      for (let ticVarIdx = 0; ticVarIdx < ticVarsInLine.length; ticVarIdx++) {
        const ticVarSpan = ticVarsInLine[ticVarIdx];
        if (position.character >= ticVarSpan.start && position.character <= ticVarSpan.end) {
          // char is within ticVar so not in string
          inTicVar = true;
          break;
        }
      }
    }
    if (!inTicVar && stringsInLine.length > 0) {
      for (let pairIdx = 0; pairIdx < stringsInLine.length; pairIdx++) {
        const stringSpan = stringsInLine[pairIdx];
        if (position.character >= stringSpan.start && position.character <= stringSpan.end) {
          // char is within string so not in comment
          inStringStatus = true;
          break;
        }
      }
    }

    //this._logMessage(`+ sp2Utils: isPositionInString() = EXIT w/${inStringStatus}`);
    return inStringStatus;
  }

  public isPositionInComment(document: TextDocument, position: lsp.Position, stringsInLine: IPairs[]): boolean {
    let inCommentStatus: boolean = false;
    const lineTextUntrim = DocumentLineAt(document, position);
    const lineText = lineTextUntrim.trim();
    let inString: boolean = false;
    // if entire line is comment
    if (lineText.startsWith("'") || lineText.startsWith("{")) {
      inCommentStatus = true;
    } else {
      // if text is within trailing comment
      let trailingCommentStartSearchPos: number = 0;
      if (stringsInLine.length > 0) {
        // searfch for comment only past all strings
        trailingCommentStartSearchPos = stringsInLine[stringsInLine.length - 1].end + 1;
      }
      let firstTickMatchLocn: number = lineText.indexOf("'", trailingCommentStartSearchPos);
      let firstBraceMatchLocn: number = lineText.indexOf("{", trailingCommentStartSearchPos);
      let firstMatchLocn = firstTickMatchLocn < firstBraceMatchLocn && firstTickMatchLocn != -1 ? firstTickMatchLocn : firstBraceMatchLocn;
      if (firstBraceMatchLocn == -1) {
        firstMatchLocn = firstTickMatchLocn;
      }
      this._logMessage(`+ sp2Utils: isPositionInComment() pos=[${position.character}], tik=[${firstTickMatchLocn}], brc=[${firstBraceMatchLocn}], mtch=[${firstMatchLocn}]`);
      if (firstMatchLocn != -1 && position.character > firstMatchLocn) {
        inCommentStatus = true;
      }
    }
    this._logMessage(`+ sp2Utils: isPositionInComment() = EXIT w/${inCommentStatus}`);
    return inCommentStatus;
  }

  public getStringPairOffsets(line: string): IPairs[] {
    let findings: IPairs[] = this._getPairOffsetsOfChar(line, '"');
    this._showPairsForChar(findings, '"');
    let sglQuoStrPairs: IPairs[] = this._getPairOffsetsOfChar(line, "'");
    if (sglQuoStrPairs.length > 0) {
      // this._logMessage(`+ sp2Utils: _getStringPairOffsets([${line}](${line.length}))`);
      let dblQuotedStrings: IPairs[] = findings;
      if (sglQuoStrPairs.length > 0) {
        for (let sglIdx = 0; sglIdx < sglQuoStrPairs.length; sglIdx++) {
          const currFinding: IPairs = sglQuoStrPairs[sglIdx];
          let bFoundIndblStr: boolean = false;
          if (dblQuotedStrings.length > 0) {
            for (let dblIdx = 0; dblIdx < dblQuotedStrings.length; dblIdx++) {
              const dblQuoteStrPair: IPairs = dblQuotedStrings[dblIdx];
              if (currFinding.start >= dblQuoteStrPair.start && currFinding.start <= dblQuoteStrPair.end) {
                bFoundIndblStr = true;
                break;
              }
              if (currFinding.end >= dblQuoteStrPair.start && currFinding.end <= dblQuoteStrPair.end) {
                bFoundIndblStr = true;
                break;
              }
            }
          }
          if (!bFoundIndblStr) {
            findings.push(currFinding);
            this._showPairsForChar([currFinding], "'");
          }
        }
      }
    }

    //this._logMessage(`+ sp2Utils: _getStringPairOffsets() - found ${findings.length} pair(s)`);
    return findings;
  }

  public getPairOffsetsOfTicVarWraps(line: string): IPairs[] {
    let findings: IPairs[] = [];
    // hunting for "`(variable)" sets
    // return location of each one found
    let endIdx: number = line.length - 3;
    let currTicWrapOffset: number = 0;
    do {
      currTicWrapOffset = line.indexOf("`(", currTicWrapOffset);
      if (currTicWrapOffset == -1) {
        break; // not wrap, stop hunting
      }
      let currTicWrapEndOffset: number = line.indexOf(")", currTicWrapOffset);
      if (currTicWrapEndOffset == -1) {
        break; // not wrap, stop hunting
      }
      const newPair = { start: currTicWrapOffset, end: currTicWrapEndOffset };
      findings.push(newPair);
      currTicWrapOffset = currTicWrapEndOffset + 1;
    } while (currTicWrapOffset < endIdx);
    this._showPairsForChar(findings, "`()");
    return findings;
  }

  //
  // PRIVATE Methods
  //
  private _showPairsForChar(pairsFound: IPairs[], srchChar: string) {
    if (pairsFound.length > 0) {
      for (let pairIdx = 0; pairIdx < pairsFound.length; pairIdx++) {
        const pair: IPairs = pairsFound[pairIdx];
        this._logMessage(`+     --- pair #${pairIdx + 1} string of (${srchChar}) at([${pair.start}, ${pair.end}) `);
      }
    }
  }

  private _getPairOffsetsOfChar(line: string, searchChar: string): IPairs[] {
    let findings: IPairs[] = [];
    let startPos: number = -1;
    let endPos: number = -1;
    let seachOffset: number = 0;
    let endIdx: number = line.length - 2;
    //this._logMessage(`+ --- _getPairOffsetsOfChar([${line}](${line.length}), [${searchChar}])`);
    if (line.length > 0) {
      while (seachOffset < endIdx) {
        startPos = line.indexOf(searchChar, seachOffset);
        if (startPos == -1 || startPos >= endIdx) {
          break;
        }
        endPos = line.indexOf(searchChar, startPos + 1);
        if (endPos == -1) {
          break;
        }
        const newPair = { start: startPos, end: endPos };
        findings.push(newPair);
        if (endPos >= endIdx) {
          break;
        }
        seachOffset = endPos + 1;
        if (line.substring(seachOffset).length < 1) {
          break;
        }
      }
    }
    //this._logMessage(`+ sp2Utils: _getPairOffsetsOfChar(, ) - found ${findings.length} pair(s)`);
    return findings;
  }

  /*
  // place this somewhere useful to get this to run....
    if (this.firstTime) {
      this._testStringMatching();
      this.firstTime = false;
    }
    */
  private _testStringMatching() {
    this._logMessage(`+ _testStringMatching() ENTRY`);
    const test1: string = 'quoted strings "one..." no 2nd';
    const test2: string = 'quoted strings "one..." and 2nd is "two" not at end';
    const test3: string = "quoted strings 'one...' and 2nd is \"two\" and 3rd is 'three'";
    const test4: string = "'one...' and 2nd is 'two' and 3rd is \"two\"";

    this._testAndReportFindings(test1);
    this._testAndReportFindings(test2);
    this._testAndReportFindings(test3);
    this._testAndReportFindings(test4);
    this._logMessage(`+ _testStringMatching() EXIT`);
  }

  private _testAndReportFindings(text: string) {
    let pairs: IPairs[] = this.getStringPairOffsets(text);
    this._logMessage(`+     _testAndReportFindings([${text}](${text.length})) found ${pairs.length} pair(s)`);
    if (pairs.length > 0) {
      for (let pairIdx = 0; pairIdx < pairs.length; pairIdx++) {
        const pair: IPairs = pairs[pairIdx];
        this._logMessage(`+     --- pair #${pairIdx + 1} at([${pair.start}, ${pair.end}) `);
      }
    }
  }

  private _logMessage(message: string): void {
    if (this.bLogEnabled) {
      // Write to output window.
      this.ctx.logger.log(message);
    }
  }
}
