'use strict';
// src/parser/spin.extension.utils.ts

import * as lsp from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Context } from '../context';
import { GetWordRangeAtPosition, DocumentLineAt, PositionIsEqual, PositionIsAfter, PositionTranslate } from './lsp.textDocument.utils';
import { isSpin1File } from './lang.utils';
import { eParseState } from './spin.common';

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
    'case',
    'case_fast',
    'repeat',
    'with',
    'from',
    'to',
    'step',
    'while',
    'until',
    'next',
    'quit'
  ];

  public constructor(ctx: Context, isLogging: boolean) {
    this.ctx = ctx;
    this.bLogEnabled = isLogging;
    this._logMessage("* Global, Local, MethodScoped Token repo's ready");
  }

  //
  // PUBLIC Methods
  //
  public isSectionStartLine(line: string): {
    isSectionStart: boolean;
    inProgressStatus: eParseState;
  } {
    // return T/F where T means our string starts a new section!
    let startStatus: boolean = false;
    let inProgressState: eParseState = eParseState.Unknown;
    if (line.length > 2) {
      const sectionName: string = line.substring(0, 3).toUpperCase();
      const nextChar: string = line.length > 3 ? line.substring(3, 4) : ' ';
      if (nextChar.charAt(0).match(/[ \t'{]/)) {
        startStatus = true;
        if (sectionName === 'CON') {
          inProgressState = eParseState.inCon;
        } else if (sectionName === 'DAT') {
          inProgressState = eParseState.inDat;
        } else if (sectionName === 'OBJ') {
          inProgressState = eParseState.inObj;
        } else if (sectionName === 'PUB') {
          inProgressState = eParseState.inPub;
        } else if (sectionName === 'PRI') {
          inProgressState = eParseState.inPri;
        } else if (sectionName === 'VAR') {
          inProgressState = eParseState.inVar;
        } else {
          startStatus = false;
        }
      }
    }
    if (startStatus) {
      this._logMessage(`** isSectStart extUt line=[${line}]`);
    }
    return {
      isSectionStart: startStatus,
      inProgressStatus: inProgressState
    };
  }

  public adjustWordPosition(
    document: TextDocument,
    wordPosition: lsp.Position,
    cursorPosition: lsp.Position,
    isInBlockComment: boolean,
    inPasmCodeStatus: boolean
  ): [boolean, string, string, lsp.Position, lsp.Position] {
    const lineText = DocumentLineAt(document, wordPosition).trimEnd();
    const P2_LOCAL_LABEL_PREFIX: string = '.';
    const P1_LOCAL_LABEL_PREFIX: string = ':';
    const spin1File: boolean = isSpin1File(document.uri);
    const localPasmLablePrefix: string = spin1File ? P1_LOCAL_LABEL_PREFIX : P2_LOCAL_LABEL_PREFIX;
    const spinControlFlowKeywords: string[] = spin1File ? this.spin1ControlFlowKeywords : this.spin2ControlFlowKeywords;
    let wordRange: lsp.Range | undefined = GetWordRangeAtPosition(lineText, wordPosition, spin1File);
    if (inPasmCodeStatus) {
      // do fixup for Spin2 pasm local labels
      if (wordRange?.start.character > 0 && lineText.charAt(wordRange.start.character - 1) == localPasmLablePrefix) {
        const newStart: lsp.Position = PositionTranslate(wordRange.start, 0, -1);
        wordRange = {
          start: { line: newStart.line, character: newStart.character },
          end: { line: wordRange?.end.line, character: wordRange?.end.character }
        };
      }
    }
    const tmpWord: string = wordRange ? document.getText(wordRange) : ''; // trim() shouldn't be needed!!!
    this._logMessage(
      `+ sp2Utils: adjustWordPosition([${wordPosition.line},${wordPosition.character}]) orig tmpWord=[${tmpWord}](${tmpWord.length}), isInBlockComment=(${isInBlockComment})`
    );
    let lineParts: string[] = [tmpWord];
    let rangeDots: boolean = false;
    if (!tmpWord.charAt(0).match(/[a-zA-Z_]/) && !tmpWord.startsWith(localPasmLablePrefix)) {
      lineParts = [];
    } else {
      if (tmpWord.includes('..')) {
        lineParts = tmpWord.split('..');
        rangeDots = true;
      } else if (tmpWord.includes('.') && !tmpWord.startsWith('.')) {
        lineParts = tmpWord.split('.');
      } else if (tmpWord.includes(',')) {
        lineParts = tmpWord.split(',');
      } else if (spin1File) {
        if (tmpWord.includes('#')) {
          lineParts = tmpWord.split('#'); // in spin1 this is an object constant reference
        }
      } else {
        if (tmpWord.startsWith('#')) {
          lineParts = [tmpWord.substring(1)]; // remove leading "#"
        }
      }
    }

    // bazarre fixup of trailing whitespace
    if (lineParts.length > 0 && (lineParts[0].endsWith(' ') || lineParts[0].endsWith('\t'))) {
      lineParts[0] = lineParts[0].trimEnd();
    }

    this._logMessage(`+ sp2Utils: adjustWordPosition()  tmpWord=[${tmpWord}](${tmpWord.length}), lineParts=[${lineParts}](${lineParts.length})`);
    let word: string = '';
    let objectRef: string = '';
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
          word = cursorPosition.character >= secondWordOffset ? lineParts[1] : lineParts[0];
        } else {
          // one dot or more ... we take only last two items, unless user wants just first word
          word = lineParts[lineParts.length - 1];
          objectRef = lineParts[lineParts.length - 2];
          this._logMessage(
            `+ sp2Utils: adjustWordPosition() cursor=(${cursorPosition.character}), start=(${wordRange.start.character}), obj=[${objectRef}](${objectRef.length}), word=[${word}]`
          );
          // if our cursor is in the object name part then return object name as our word
          if (cursorPosition.character < wordRange.start.character + objectRef.length + 1) {
            word = objectRef;
            objectRef = '';
          }
          this._logMessage(`+ sp2Utils: adjustWordPosition() obj=[${objectRef}], word=[${word}]`);
        }
        break;
    }
    this._logMessage(
      `+ sp2Utils: adjustWordPosition() wordRange=[${wordRange?.start.line}:${wordRange?.start.character}-${wordRange?.end.line}:${wordRange?.end.character}], obj=[${objectRef}], word=[${word}]`
    );
    // TODO: fix this for spin comments vs. // comments

    const stringsFound: IPairs[] = this.getStringPairOffsets(lineText);
    const ticVarsFound: IPairs[] = this.getPairOffsetsOfTicVarWraps(lineText);
    //const stringsFound: IPairs[] = [];
    let bPositionInComment: boolean = this.isPositionInComment(lineText, wordPosition, stringsFound);
    if (!bPositionInComment) {
      bPositionInComment = isInBlockComment;
      this._logMessage(`+ sp2Utils: adjustWordPosition() (post-block): bPositionInComment=${bPositionInComment}`);
    }
    if (
      !wordRange ||
      this.isPositionInString(lineText, wordPosition, stringsFound, ticVarsFound) ||
      bPositionInComment ||
      word.match(/^\d+.?\d+$/) ||
      spinControlFlowKeywords.indexOf(word) > 0
    ) {
      this._logMessage(`+ sp2Utils: adjustWordPosition() EXIT false`);
      return [false, null!, null!, null!, null!];
    }
    if (PositionIsEqual(wordPosition, wordRange.end) && PositionIsAfter(wordPosition, wordRange.start)) {
      wordPosition = PositionTranslate(wordPosition, 0, -1);
    }

    this._logMessage(`+ sp2Utils: adjustWordPosition() EXIT true`);
    return [true, objectRef, word, wordPosition, wordRange.start];
  }

  public isPositionInString(lineText: string, position: lsp.Position, stringsInLine: IPairs[], ticVarsInLine: IPairs[]): boolean {
    let inStringStatus: boolean = false;
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

    this._logMessage(`+ sp2Utils: isPositionInString() = EXIT w/${inStringStatus}`);
    return inStringStatus;
  }

  public isPositionInComment(lineText: string, position: lsp.Position, stringsInLine: IPairs[]): boolean {
    let inCommentStatus: boolean = false;
    //const inString: boolean = false;
    // if entire line is comment
    this._logMessage(`+ sp2Utils: isPositionInComment() lineText=[${lineText}](${lineText.length})`);
    if (lineText.startsWith("'") || lineText.startsWith('{')) {
      inCommentStatus = true;
    } else {
      // if text is within trailing comment
      let trailingCommentStartSearchPos: number = 0;
      if (stringsInLine.length > 0) {
        // searfch for comment only past all strings
        trailingCommentStartSearchPos = stringsInLine[stringsInLine.length - 1].end + 1;
      }
      const firstTickMatchLocn: number = lineText.indexOf("'", trailingCommentStartSearchPos);
      const firstBraceMatchLocn: number = lineText.indexOf('{', trailingCommentStartSearchPos);
      let firstMatchLocn = firstTickMatchLocn < firstBraceMatchLocn && firstTickMatchLocn != -1 ? firstTickMatchLocn : firstBraceMatchLocn;
      if (firstBraceMatchLocn == -1) {
        firstMatchLocn = firstTickMatchLocn;
      }
      this._logMessage(
        `+ sp2Utils: isPositionInComment() pos=[${position.character}], tik=[${firstTickMatchLocn}], brc=[${firstBraceMatchLocn}], mtch=[${firstMatchLocn}]`
      );
      if (firstMatchLocn != -1 && position.character > firstMatchLocn) {
        inCommentStatus = true;
      }
    }
    this._logMessage(`+ sp2Utils: isPositionInComment() = EXIT w/${inCommentStatus}`);
    return inCommentStatus;
  }

  public haveUnmatchedCloseOnLine(line: string, searchChar: string): [boolean, number] {
    let unmatchedCloseStatus: boolean = true;
    let matchOffset: number = 0;
    let nestLevel: number = 0;
    const closeString: string = searchChar;
    const openString: string = searchChar == '}' ? '{' : '{{';
    const matchLen: number = searchChar.length;
    // FIXME: this should remove strings before searching
    let openPosition: number = line.indexOf(searchChar);
    if (openPosition != -1) {
      if (line.indexOf(`"${searchChar}`, openPosition - 1) != -1) {
        openPosition = -1; // don't count this as a match
      }
    }
    if (openPosition != -1 && line.length >= searchChar.length) {
      for (let offset = 0; offset < line.length; offset++) {
        const matchString = line.substring(offset, offset + matchLen);
        if (matchString == openString) {
          nestLevel++;
        } else if (matchString == closeString) {
          matchOffset = offset;
          nestLevel--;
        }
      }
      unmatchedCloseStatus = nestLevel == -1 ? true : false;
    }
    this._logMessage(
      `  -- SymParse _havUnmatchCloseOnLine('${searchChar}') isClosed=(${unmatchedCloseStatus}), ofs=(${matchOffset}) line=[${line}](${line.length})`
    );
    return [unmatchedCloseStatus, matchOffset];
  }

  public getStringPairOffsets(line: string): IPairs[] {
    const findings: IPairs[] = this._getPairOffsetsOfChar(line, '"');
    this._showPairsForChar(findings, '"');
    const sglQuoStrPairs: IPairs[] = this._getPairOffsetsOfChar(line, "'");
    if (sglQuoStrPairs.length > 0) {
      // this._logMessage(`+ sp2Utils: _getStringPairOffsets([${line}](${line.length}))`);
      const dblQuotedStrings: IPairs[] = findings;
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

    this._logMessage(`+ sp2Utils: _getStringPairOffsets() - found ${findings.length} pair(s)`);
    return findings;
  }

  public getPairOffsetsOfTicVarWraps(line: string): IPairs[] {
    const findings: IPairs[] = [];
    // hunting for "`(variable)" sets
    // return location of each one found
    const endIdx: number = line.length - 3;
    let currTicWrapOffset: number = 0;
    do {
      currTicWrapOffset = line.indexOf('`(', currTicWrapOffset);
      if (currTicWrapOffset == -1) {
        break; // not wrap, stop hunting
      }
      const currTicWrapEndOffset: number = line.indexOf(')', currTicWrapOffset);
      if (currTicWrapEndOffset == -1) {
        break; // not wrap, stop hunting
      }
      const newPair = { start: currTicWrapOffset, end: currTicWrapEndOffset };
      findings.push(newPair);
      currTicWrapOffset = currTicWrapEndOffset + 1;
    } while (currTicWrapOffset < endIdx);
    this._showPairsForChar(findings, '`()');
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
    const findings: IPairs[] = [];
    let startPos: number = -1;
    let endPos: number = -1;
    let seachOffset: number = 0;
    const endIdx: number = line.length - 2;
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
    const pairs: IPairs[] = this.getStringPairOffsets(text);
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
