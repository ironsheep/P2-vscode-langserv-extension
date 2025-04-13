/* eslint-disable @typescript-eslint/no-unused-vars */
'use strict';

// https://typescript.hotexamples.com/examples/vscode/window/createTextEditorDecorationType/typescript-window-createtexteditordecorationtype-method-examples.html

import * as vscode from 'vscode';
import { EndOfLine } from 'vscode';

import { getMode, eEditMode, modeName } from './spin.editMode.mode';
import { tabConfiguration, reloadTabConfiguration } from './spin.tabFormatter.configuration';

// ----------------------------------------------------------------------------
//  this file contains routines for tabbing the code: ==> or <==

/**
 *
 */
export interface Block {
  tabStops: number[];
}

/**
 *
 */
export interface Blocks {
  con: Block;
  var: Block;
  obj: Block;
  pub: Block;
  pri: Block;
  dat: Block;

  [block: string]: Block;
}

/**
 *
 */
// ----------------------------------------------------------------------------
//  This is the object that does our tab formatting
//   CLASS Formatter
export class Formatter {
  private rawElasticTabstopsConfiguration: vscode.WorkspaceConfiguration;
  private config = tabConfiguration;

  private tabset: string = this.config.tabSet;
  //readonly selectedSet: string = this.tabset == "PropellerTool" ? "default" : this.tabset;

  //readonly tabsSelection: string = `blocks.${this.selectedSet}`;
  private blocks = this.config.blocks;
  //readonly blocksConfig = this.config.inspect<Blocks>("blocks");

  private tabSize = this.config.tabSize;
  //readonly useTabStops = this.config.get<number>("editor.useTabStops");

  private enable = this.config.enable;
  //readonly timeout = this.config.get<number>("timeout");
  //readonly maxLineCount = this.config.get<number>("maxLineCount");
  //readonly maxLineLength = this.config.get<number>("maxLineLength");

  readonly blockIdentifierREgEx1 = /^(?<block>^(con|var|obj|pub|pri|dat))[\s{']/i;
  readonly blockIdentifierREgEx2 = /^(?<block>^(con|var|obj|pub|pri|dat))$/i;
  readonly orgIdentifierREgEx1 = /^(?<org>\s*(org|orgf|orgh|asm))\s+/i;
  readonly orgIdentifierREgEx2 = /^(?<org>\s*(org|orgf|orgh|asm))$/i;
  readonly endIdentifierREgEx1 = /^(?<end>\s*(end|endasm))\s+/i;
  readonly endIdentifierREgEx2 = /^(?<end>\s*(end|endasm))$/i;

  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private debugOutputChannel: vscode.OutputChannel | undefined = undefined;

  private finalTabSelection: vscode.Selection;
  private bFinalTabSelectionValid: boolean = false;
  private finalUntabSelection: vscode.Selection;
  private bFinalUntabSelectionValid: boolean = false;

  //export const configuration = loadConfiguration();

  constructor() {
    if (this.isDebugLogEnabled) {
      if (this.debugOutputChannel === undefined) {
        //Create output channel
        this.debugOutputChannel = vscode.window.createOutputChannel('Spin/Spin2 Format DEBUG');
        this.logMessage('Spin/Spin2 Tab Format log started.');
      } else {
        this.logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }

      this.rawElasticTabstopsConfiguration = vscode.workspace.getConfiguration('spinExtension.elasticTabstops');
      this.logMessage(`- (DBG) rawElasticTabstopsConfiguration=[${JSON.stringify(this.rawElasticTabstopsConfiguration)}]`);
    }

    //const jsonConfig: string = JSON.stringify(this.config, null, 4);
    //this.logMessage(`+ (DBG) config=(${jsonConfig})`);
    //const jsonBlocks: string = JSON.stringify(this.blocks, null, 4);
    //this.logMessage(`+ (DBG) blocks=(${jsonBlocks})`);
    const startPos: vscode.Position = new vscode.Position(0, 0);
    this.finalTabSelection = new vscode.Selection(startPos, startPos);
    this.finalUntabSelection = new vscode.Selection(startPos, startPos);
  }

  // Editor Tab Size - "editor.tabSize"
  // Editor Completion - "editor.tabCompletion": "on",
  // Editor Use Tab Stops - "editor.useTabStops": false
  // Editor Sticky Tab Stops - "editor.stickyTabStops": true
  // Editor Insert Spaces - "editor.insertSpaces": false,
  // Editor Detect Indentation "editor.detectIndentation": false

  /**
   * write message to formatting log (when log enabled)
   *
   * @param message to be written
   * @returns nothing
   */
  public logMessage(message: string): void {
    if (this.isDebugLogEnabled && this.debugOutputChannel !== undefined) {
      //Write to output window.
      this.debugOutputChannel.appendLine(message);
    }
  }

  /**
   * Return T/F where T means the formatter should be enabled
   * @returns T/F
   */
  isEnabled(): boolean {
    const bEnableStatus: boolean = this.enable ? true : false;
    return bEnableStatus;
  }

  updateTabConfiguration() {
    this.logMessage(`+ (DBG) updateTabConfiguration()`);
    if (reloadTabConfiguration()) {
      this.logMessage(`+ (DBG) updateTabConfiguration()  DID reload!`);
      this.config = tabConfiguration;

      this.tabset = this.config.tabSet;

      this.blocks = this.config.blocks;

      this.tabSize = this.config.tabSize;

      this.enable = this.config.enable;
    }
    this.logMessage(`+ (DBG) tabConfiguration=[${JSON.stringify(this.config)}]`);
  }

  /**
   * get the previous tab stop
   * @param blockName
   * @param character
   * @returns
   */
  getPreviousTabStop(blockName: string, character: number): number {
    if (!blockName) {
      blockName = 'con';
    }
    const block = this.blocks[blockName.toLowerCase()];

    const stops = block.tabStops ?? [this.tabSize];
    const tabStops = stops?.sort((a, b) => {
      return a - b;
    });

    let index: number;
    while ((index = tabStops?.findIndex((element) => element > character)) === -1) {
      const lastTabStop = tabStops[tabStops.length - 1];
      const lastTabStop2 = tabStops[tabStops.length - 2];
      const lengthTabStop = lastTabStop - lastTabStop2;
      tabStops.push(lastTabStop + lengthTabStop);
    }
    //this.logMessage(`+ (DBG) tabStops-[${tabStops}]`);
    let prevTabStop: number = tabStops[index - 1] ?? 0;
    if (prevTabStop == character) {
      prevTabStop = tabStops[index - 2] ?? 0;
    }
    this.logMessage(`+ (DBG) getPreviousTabStop(${blockName}) startFm-(${character}) -> TabStop-(${prevTabStop})`);
    return prevTabStop;
  }

  /**
   * get the current tab stop
   * @param blockName
   * @param character
   * @returns
   */
  getCurrentTabStop(blockName: string, character: number): number {
    if (!blockName) {
      blockName = 'con';
    }
    const block = this.blocks[blockName.toLowerCase()];

    const stops = block.tabStops ?? [this.tabSize];
    const tabStops = stops?.sort((a, b) => {
      return a - b;
    });

    let index: number;
    while ((index = tabStops?.findIndex((element) => element > character)) === -1) {
      const lastTabStop = tabStops[tabStops.length - 1];
      const lastTabStop2 = tabStops[tabStops.length - 2];
      const lengthTabStop = lastTabStop - lastTabStop2;
      tabStops.push(lastTabStop + lengthTabStop);
    }
    //this.logMessage(`+ (DBG) tabStops-[${tabStops}]`);
    const currTabStop: number = tabStops[index - 1] ?? 0;
    this.logMessage(`+ (DBG) getCurrentTabStop(${blockName}) startFm-(${character}) -> TabStop-(${currTabStop})`);
    return currTabStop;
  }

  /**
   * get the next tab stop
   * @param blockName
   * @param character
   * @returns
   */
  getNextTabStop(blockName: string, character: number): number {
    if (!blockName) {
      blockName = 'con';
    }
    const block = this.blocks[blockName.toLowerCase()];

    const stops = block.tabStops ?? [this.tabSize];
    const tabStops = stops?.sort((a, b) => {
      return a - b;
    });

    let index: number;
    while ((index = tabStops?.findIndex((element) => element > character)) === -1) {
      const lastTabStop = tabStops[tabStops.length - 1];
      const lastTabStop2 = tabStops[tabStops.length - 2];
      const lengthTabStop = lastTabStop - lastTabStop2;
      tabStops.push(lastTabStop + lengthTabStop);
    }
    //this.logMessage(`+ (DBG) tabStops-[${tabStops}]`);

    const nextRtTabStop = tabStops[index];
    //this.logMessage(`+ (DBG) getNextTabStop(${blockName}) startFm-(${character}) -> TabStop-(${nextRtTabStop})`);
    return nextRtTabStop;
  }

  /**
   * get the name of the current block/section
   *
   * @param document
   * @param selection
   * @returns
   */
  getBlockName(document: vscode.TextDocument, selection: vscode.Selection): string {
    // searching towards top of document looking for enclosing block identifier

    // NEW for PUB/PRI - lets detect ORG and ORGF (asm for FlexSpin) being present
    // also detect END (endasm for FlexSpin)
    //  on way to finding PUB or PRI.
    //  if we find one of the ORGs and NOT END then we return DAT so as to use
    //   DAT tabs in the PUB section for inline PASM
    let blockName: string = '';
    let bBelowOrg: boolean = false;
    let bAboveEnd: boolean = true;
    let matchOrg: RegExpMatchArray | null = null;
    let matchEnd: RegExpMatchArray | null = null;
    const bottomLine: number = selection.end.line;
    let lineWithMatch: number = -1;
    for (let lineIndex = selection.anchor.line; lineIndex >= 0; lineIndex--) {
      const line = document.lineAt(lineIndex);
      if (line.text.length < 3) {
        continue;
      }
      //this.logMessage(`  -- line=[${line.text}]`);

      if (matchOrg == null) {
        matchOrg = line.text.toLowerCase().match(this.orgIdentifierREgEx1);
        if (!matchOrg) {
          matchOrg = line.text.toLowerCase().match(this.orgIdentifierREgEx2);
        }
        if (matchOrg) {
          bBelowOrg = true;
          // if we are sitting on the ORG line we need to be in PUB/PRI tabs
          if (lineIndex == bottomLine) {
            bBelowOrg = false;
          }
        }
        this.logMessage(`   -- Ln#${lineIndex + 1} matchOrg-[${matchOrg}]`);
      }

      if (matchEnd == null) {
        matchEnd = line.text.toLowerCase().match(this.endIdentifierREgEx1);
        if (!matchEnd) {
          matchEnd = line.text.toLowerCase().match(this.endIdentifierREgEx2);
        }
        if (matchEnd) {
          bAboveEnd = false;
        }
        this.logMessage(`   -- Ln#${lineIndex + 1} matchEnd-[${matchEnd}]`);
      }

      let match = line.text.toLowerCase().match(this.blockIdentifierREgEx1);
      if (!match) {
        match = line.text.toLowerCase().match(this.blockIdentifierREgEx2);
      }
      this.logMessage(`   -- Ln#${lineIndex + 1} matchBlock-[${match}]`);

      if (match) {
        this.logMessage(`   -- match-[${match}](${match.length}), bBelowOrg=[${bBelowOrg}], bAboveEnd=[${bAboveEnd}]`);
        for (let index = 0; index < match.length; index++) {
          const element = match[index];
          this.logMessage(`   -- item-${index + 1} element=[${element}]`);
        }
        blockName = match.groups?.block ?? '';
        if (blockName.length > 0) {
          if (bBelowOrg && bAboveEnd && (blockName.toUpperCase() == 'PUB' || blockName.toUpperCase() == 'PRI')) {
            blockName = 'dat';
          }
        }
        lineWithMatch = lineIndex;
        break;
      }
    }
    blockName = blockName.toUpperCase();
    this.logMessage(
      `getBlockName() s,e-[${lineWithMatch},${selection.start.character} - ${selection.end.line},${selection.end.character}] BLOK-[${blockName}]`
    );
    return blockName;
  }

  countWhiteSpace(textString: string, offset: number): number {
    let nbrWhiteSpaceChars: number = 0;
    if (offset < 0) {
      offset = 0;
    }
    for (let idx: number = offset; idx < textString.length; idx++) {
      if (this.isCharWhiteAt(textString, idx)) {
        break;
      }
      nbrWhiteSpaceChars++;
    }
    return nbrWhiteSpaceChars;
  }

  countLeftWhiteSpace(textString: string, offset: number): number {
    let nbrWhiteSpaceChars: number = 0;
    if (offset < 0) {
      offset = 0;
    }
    if (offset > 1) {
      for (let idx: number = offset - 1; idx >= 0; idx--) {
        if (!this.isCharWhiteAt(textString, idx)) {
          if (nbrWhiteSpaceChars > 0) {
            nbrWhiteSpaceChars--;
          }
          break;
        }
        nbrWhiteSpaceChars++;
      }
    }
    return nbrWhiteSpaceChars;
  }

  isCharWhiteAt(text: string, index: number): boolean {
    let isCharWhiteAtStatus: boolean = false;
    if (text.charAt(index) == ' ' || text.charAt(index) == '\t') {
      isCharWhiteAtStatus = true;
    }
    //this.logMessage(` - isCharWhiteAt() char-[${text.charAt(index)}](${index}) is white?: [${isCharWhiteAtStatus}]`);
    return isCharWhiteAtStatus;
  }

  isTextAllWhite(text: string): { bNotAllWhite: boolean; nonWhiteIndex: number } {
    let bNotAllWhite: boolean = false;
    let nonWhiteIndex: number = 0;
    for (nonWhiteIndex = 0; nonWhiteIndex < text.length; nonWhiteIndex++) {
      const bThisIsWhite: boolean = this.isCharWhiteAt(text, nonWhiteIndex);
      if (bThisIsWhite == false) {
        bNotAllWhite = true;
        break; // have our answer, abort
      }
    }
    return { bNotAllWhite, nonWhiteIndex };
  }

  locateDoubleWhiteLeftEdge(currLineText: string, cursorPos: vscode.Position): vscode.Position {
    // for Align Mode we need to manipulate the extra space at right edge of text being moved
    // this extra space is defined as two or more spaces. So find the location of two spaces to
    // right of the given position
    let leftMostDoubleWhitePos: vscode.Position = cursorPos.with(0, 0);
    for (let idx: number = cursorPos.character; idx < currLineText.length - 1; idx++) {
      if (this.isCharWhiteAt(currLineText, idx) == true && this.isCharWhiteAt(currLineText, idx + 1) == true) {
        leftMostDoubleWhitePos = cursorPos.with(cursorPos.line, idx);
        break;
      }
    }
    this.logMessage(
      ` - (DBG) locateDoubleWhiteLeftEdge() txt-[${currLineText}](${currLineText.length}) cursor-[${cursorPos.line}:${cursorPos.character}] => dblWhtPos=[${leftMostDoubleWhitePos.line}:${leftMostDoubleWhitePos.character}]`
    );
    return leftMostDoubleWhitePos;
  }

  countOfWhiteChars(currLineText: string, cursorPos: vscode.Position): number {
    // for Align Mode we are going to add or remove spaces in the extra space
    //  area right of the cursor postion, let's count how many spaces we have there
    let nbrWhiteChars: number = 0;
    for (let idx: number = cursorPos.character; idx < currLineText.length; idx++) {
      if (this.isCharWhiteAt(currLineText, idx) == false) {
        break;
      }
      nbrWhiteChars++;
    }
    this.logMessage(
      ` - (DBG) countOfWhiteChars() txt-[${currLineText}](${currLineText.length}) cursor-[${cursorPos.line}:${cursorPos.character}] => whiteLength is (${nbrWhiteChars}) spaces`
    );
    return nbrWhiteChars;
  }

  locateLeftTextEdge(currLineText: string, cursorPos: vscode.Position): vscode.Position {
    // now adjust cursor: if at white, skip to next rightmost non-white, if at non-white, skip to left edge of non-white
    //  or put another way skip to left most char of text (if in text find left edge, if not in text find first text to right)
    //this.logMessage(` - locateLeftTextEdge() txt-[${currLineText}](${currLineText.length}) cursor-[${cursorPos.line}:${cursorPos.character}])`);
    //const searchArea: string = currLineText.substring(cursorPos.character);
    //this.logMessage(`   -- searching-[${searchArea}](${searchArea.length}) [0-${searchArea.length - 1}])`);
    let leftMostNonWhitePos: vscode.Position = cursorPos;
    if (this.isCharWhiteAt(currLineText, cursorPos.character)) {
      // at whitespace, look right to next non-whitespace...
      let bFoundNonWhite = false;
      for (let idx: number = cursorPos.character + 1; idx < currLineText.length; idx++) {
        if (this.isCharWhiteAt(currLineText, idx) == false) {
          leftMostNonWhitePos = cursorPos.with(cursorPos.line, idx);
          bFoundNonWhite = true;
          break;
        }
      }
      //this.logMessage(`---- endSrchRt-[${leftMostNonWhitePos.line}:${leftMostNonWhitePos.character}], bFoundNonWhite=(${bFoundNonWhite})`);
      // if we didnt find any NON-white in this search, just return location of char after selection
      if (!bFoundNonWhite) {
        leftMostNonWhitePos = cursorPos.with(cursorPos.line, currLineText.length);
      }
    } else {
      // at non-whitespace, look left to next whitespace then back one...
      let bFoundWhite = false;
      for (let idx: number = cursorPos.character - 1; idx >= 0; idx--) {
        if (this.isCharWhiteAt(currLineText, idx)) {
          leftMostNonWhitePos = cursorPos.with(cursorPos.line, idx + 1);
          bFoundWhite = true;
          break;
        }
      }
      //this.logMessage(`---- endSrchLt-[${leftMostNonWhitePos.line}:${leftMostNonWhitePos.character}], bFoundWhite=(${bFoundWhite})`);
      // if we didnt find any NON-white in this search, just return location start of line
      if (!bFoundWhite) {
        leftMostNonWhitePos = cursorPos.with(cursorPos.line, 0);
      }
    }
    this.logMessage(`---- ltEdge-[${leftMostNonWhitePos.line}:${leftMostNonWhitePos.character}])`);
    return leftMostNonWhitePos;
  }

  getNonwiteFromSelectedText(selectedText: string): string {
    // there is non-white text in (selectedText}, return it and everything else to the right of it
    let nonWhiteRightEdge: string = '';
    if (!this.isCharWhiteAt(selectedText, 0)) {
      const startPos: vscode.Position = new vscode.Position(0, 0);
      const nonWhiteCharPos = this.locateLeftTextEdge(selectedText, startPos);
      if (nonWhiteCharPos.character < selectedText.length) {
        nonWhiteRightEdge = selectedText.substring(nonWhiteCharPos.character);
      }
    } else {
      nonWhiteRightEdge = selectedText;
    }
    return nonWhiteRightEdge;
  }

  lineNumbersFromSelection(document: vscode.TextDocument, selection: vscode.Selection): { firstLine: number; lastLine: number; lineCount: number } {
    let lineCount: number = 0;
    let firstLine: number = 0;
    let lastLine: number = 0;
    // what kind of section do we have?
    if (selection.isEmpty) {
      // empty, just a cursor location
      firstLine = selection.start.line;
      lastLine = selection.end.line;
      lineCount = lastLine - firstLine + 1;
    } else {
      // non-empty then let's figure out which lines could change
      const allSelectedText: string = document.getText(selection);
      const lines: string[] = allSelectedText.split(/\r?\n/);
      lineCount = lines.length;
      firstLine = selection.start.line;
      lastLine = selection.end.line;
      //this.logMessage(` - (DBG) ${lineCount} lines: fm,to=[${firstLine}, ${lastLine}], allSelectedText=[${allSelectedText}](${allSelectedText.length}), lines=[${lines}](${lines.length})`);
      for (let currLineIdx: number = 0; currLineIdx < lines.length; currLineIdx++) {
        if (lines[currLineIdx].length == 0) {
          if (currLineIdx == lines.length - 1) {
            lastLine--;
            lineCount--;
          }
        }
      }
      if (firstLine > lastLine && lineCount == 0) {
        // have odd selection case, let's override it!
        // (selection contained just a newline!)
        firstLine--;
        lastLine = firstLine;
        lineCount = 1;
      }
    }

    return { firstLine, lastLine, lineCount };
  }

  calculateLeftEdge(document: vscode.TextDocument, firstLine: number, lastLine: number): number {
    // return column-number of left-most non-white character in set of lines
    let leftMostNonWhiteColumn: number = 999999;
    for (let currLine: number = firstLine; currLine <= lastLine; currLine++) {
      const currLineText: string = document.lineAt(currLine).text;
      // if empty line, don't count this when locating left edge
      if (currLineText.length > 0) {
        const cursorPos: vscode.Position = new vscode.Position(currLine, 0);
        const nonWhitePos: vscode.Position = this.locateLeftTextEdge(currLineText, cursorPos);
        if (nonWhitePos.character < leftMostNonWhiteColumn) {
          leftMostNonWhiteColumn = nonWhitePos.character;
        }
      }
    }
    if (leftMostNonWhiteColumn == 999999) {
      // if no elgible lines found, then just return left edge
      leftMostNonWhiteColumn = 0;
    }
    return leftMostNonWhiteColumn;
  }

  calculateRightEdge(document: vscode.TextDocument, firstLine: number, lastLine: number): number {
    // return column-number of right-most non-white left-edge character in set of lines
    let rightMostNonWhiteColumn: number = 0;
    for (let currLine: number = firstLine; currLine <= lastLine; currLine++) {
      const currLineText: string = document.lineAt(currLine).text;
      // if empty line, don't count this when locating left edge
      if (currLineText.length > 0) {
        const cursorPos: vscode.Position = new vscode.Position(currLine, 0);
        const nonWhitePos: vscode.Position = this.locateLeftTextEdge(currLineText, cursorPos);
        if (nonWhitePos.character > rightMostNonWhiteColumn) {
          rightMostNonWhiteColumn = nonWhitePos.character;
        }
      }
    }
    return rightMostNonWhiteColumn;
  }

  /**
   * insert comment showing tab stops
   *
   * @param document A text document.
   * @return A list of text edit objects.
   */
  insertTabStopsComment(document: vscode.TextDocument, selections: readonly vscode.Selection[]): vscode.ProviderResult<vscode.TextEdit[]> {
    return selections
      .map((selection) => {
        const results: vscode.ProviderResult<vscode.TextEdit[]> = [];
        const block = this.getBlockName(document, selection);
        this.logMessage(
          `* iCm enabled=[${this.enable}], selection(isSingle-[${selection.isSingleLine}] BLOK-[${block}] isEmpty-[${selection.isEmpty}] s,e-[${selection.start.line}:${selection.start.character} - ${selection.end.line}:${selection.end.character}] activ-[${selection.active.character}] anchor-[${selection.anchor.character}])`
        );
        // if tabbing is not enabled, just return after doing nothing
        if (this.enable == false) {
          return results;
        }
        const { firstLine, lastLine, lineCount } = this.lineNumbersFromSelection(document, selection);
        const cursorPos: vscode.Position = new vscode.Position(firstLine, 0);
        let charactersToInsert: string = "'";
        let priorTabstop: number = 0;
        let currTabstop: number = 0;
        let tabNumber: number = 1;
        do {
          currTabstop = this.getNextTabStop(block, currTabstop);
          const distance: number = currTabstop - priorTabstop - 1;
          const horizStr: string = '-'.repeat(distance);
          priorTabstop = currTabstop;
          charactersToInsert = `${charactersToInsert}${horizStr}+`;
          //this.logMessage(` --tab#${tabNumber}  curr=(${currTabstop}) dist=(${distance})`);
          tabNumber++;
        } while (charactersToInsert.length < 80);

        const endOfLineStr: string = document.eol == EndOfLine.CRLF ? '\r\n' : '\n';
        // insert a "template tab-column comment line" above the line upon which our cursor sits
        results.push(vscode.TextEdit.insert(cursorPos, `${charactersToInsert}${endOfLineStr}`));

        return results;
      })
      .reduce((selections, selection) => selections.concat(selection), []);
  }

  leftOfCursor(cursor: vscode.Position): vscode.Position {
    // return cursor position adjusted left 1 char if cursor was not already at left edge
    let adjustedPosition: vscode.Position = cursor;
    if (cursor.character > 0) {
      adjustedPosition = cursor.with(cursor.line, cursor.character - 1);
    }
    return adjustedPosition;
  }

  /**
   * a TAB key was pressed where should the cusor be placed?
   *
   * @param none
   * @return A Selection indicating where to plave the cusor after tabbing.
   */
  indentEndingSelection(): [vscode.Selection, boolean] {
    return [this.finalTabSelection, this.bFinalTabSelectionValid];
  }

  /**
   * indent one tab stop
   *
   * @param document A text document.
   * @return A list of text edit objects.
   */
  indentTabStop(document: vscode.TextDocument, editor: vscode.TextEditor): vscode.ProviderResult<vscode.TextEdit[]> {
    const selections: readonly vscode.Selection[] = editor.selections;
    //const finalSelections: vscode.Selection[] = [];
    this.bFinalTabSelectionValid = false;
    let selectionsProcessed: number = 0;
    const editResult: vscode.ProviderResult<vscode.TextEdit[]> = selections
      .map((selection) => {
        const results: vscode.ProviderResult<vscode.TextEdit[]> = [];
        const block = this.getBlockName(document, selection);
        this.logMessage(
          `* inD enabled=[${this.enable}], selection(isSingle-[${selection.isSingleLine}] BLOK-[${block}] isEmpty-[${selection.isEmpty}] s,e-[${selection.start.line}:${selection.start.character} - ${selection.end.line}:${selection.end.character}] activ-[${selection.active.character}] anchor-[${selection.anchor.character}])`
        );
        // if tabbing is not enabled, just return after doing nothing
        if (this.enable == false) {
          return results;
        }
        selectionsProcessed += 1;
        // re SELECTION - {start} and {end} are actual bounds, {active} is where cursor is! (could be left or right end of selection)
        //  if selection was created dragging from right to left cursor is at left end,
        //  if selection was created dragging from left to right cursor is at right end.

        //  if no selection, just cursor - skip whitespace to right - treat chars to right
        //  if selection is single line:
        //     then if first char is whitespace - then hunt for text-edge to right
        //          else (first char is non-white) - then hunt for text-edge to left

        // if selection left char is white get tab from left edge of selection
        // else get tab from left edge of text
        const { firstLine, lastLine, lineCount } = this.lineNumbersFromSelection(document, selection);
        const bWholeLines: boolean = firstLine != lastLine;

        // this will be used to find our tab column in multi-line case
        if (bWholeLines) {
          this.logMessage(` - (DBG) ${lineCount} lines: fm,to=[${firstLine}, ${lastLine}]`);
        }

        // set initial position (where cursor actually is)
        let initialCursorPos: vscode.Position = selection.active;
        let cursorPos: vscode.Position = initialCursorPos;
        // if we have multi-line selection reset cursor to first char of all lines
        if (bWholeLines) {
          initialCursorPos = cursorPos.with(cursorPos.line, 0);
        }
        this.logMessage(
          ` - (DBG)BLOK-[${block}], wholeLines=(${bWholeLines}), lines fm,to=[${firstLine}, ${lastLine}], cursor-[${cursorPos.line}:${cursorPos.character}]`
        );

        for (let currLine: number = firstLine; currLine <= lastLine; currLine++) {
          // now use selection to skip whitespace to right of cursor
          cursorPos = cursorPos.with(currLine, initialCursorPos.character);

          // grab the text of the current selected line
          const currLineText: string = document.lineAt(currLine).text;

          let selectedText: string = ''; // non-empty if we have text within the selection

          // if we found text to adjust...
          if (currLineText.length > 0 || bWholeLines) {
            // now adjust cursor: if at white, skip to next rightmost non-white, if at non-white, skip to left edge of non-white
            //  or put another way skip to left most char of text (if in text find left edge, if not in text find first text to right)
            let textLeftEdgePos: vscode.Position = cursorPos; // value NOT used!
            // CLASSIFY our selection so we know where to place cursor
            if (selection.isEmpty) {
              // have insert point
              //  (will never happen in multi-line case)
              // if we are pointing to white space, move to left edge of text (to right of position)
              if (this.isCharWhiteAt(currLineText, cursorPos.character)) {
                cursorPos = this.locateLeftTextEdge(currLineText, cursorPos);
                textLeftEdgePos = cursorPos;
              }
            } else if (selection.isSingleLine) {
              // have true single line selection
              //  (will never happen in multi-line case)
              selectedText = document.getText(selection);

              // move to left edge of text (to left -OR- right of position)
              const selectionLeftEdgePos: vscode.Position = cursorPos.with(selection.start);
              cursorPos = this.locateLeftTextEdge(currLineText, selectionLeftEdgePos);
              textLeftEdgePos = cursorPos;

              if (textLeftEdgePos.character >= selection.start.character && textLeftEdgePos.character <= selection.end.character) {
                // if left edge of text is within selection...
                // we are possibly replacing some white... we need tab stop to right of "left edge of selection" move cursor to left edge
                cursorPos = cursorPos.with(selection.start);
              } else if (textLeftEdgePos.character < selection.start.character) {
                //  left edge of text is left of selection
                // leave CURSOR at left edge of text
              } else {
                //  left edge of text is right of selection
                cursorPos = cursorPos.with(selection.start);
              }
            } else {
              // have FAKE single line selection (treat as entire line selection)
              // -OR- have single line of multiple line selection
              textLeftEdgePos = this.locateLeftTextEdge(currLineText, cursorPos);
              cursorPos = textLeftEdgePos;
            }

            // lastly move non-white chars from cusor to next tabstop to right
            const nextTabstop: number = this.getNextTabStop(block, cursorPos.character);
            this.logMessage(
              ` - line#${currLine} cursor-[${cursorPos.line}:${cursorPos.character}], leftEdge=[${textLeftEdgePos.line}:${textLeftEdgePos.character}], nextTabstop=[${nextTabstop}], selectedText-[${selectedText}], text-[${currLineText}]`
            );

            let nbrSpacesToRemove: number = 0; // if non zero these will be removed from selection start
            let nbrSpacesToInsert: number = 0;
            if (selection.isEmpty) {
              // have insert point
              // SPACEct = dist from text to desired tab
              nbrSpacesToInsert = nextTabstop - textLeftEdgePos.character;
            } else if (selection.isSingleLine) {
              // have true single line selection
              //  (will never happen in multi-line case)
              if (textLeftEdgePos.character > selection.end.character) {
                // CASE: textEdge is right of selection
                // case (5):  (tabstop - leftEdge) + plus leftEdgeSelectionWhite (all of white)
                // we are possibly removeing or possibly adding to get to tab location
                if (textLeftEdgePos.character == nextTabstop) {
                  // already at proper location
                  // no deletes or adds
                } else if (textLeftEdgePos.character < nextTabstop) {
                  // need to move text right
                  // add only
                  nbrSpacesToInsert = nextTabstop - textLeftEdgePos.character;
                  // INSERT-POINT is textLeftEdgePos
                } else {
                  // need to move text left
                  nbrSpacesToRemove = textLeftEdgePos.character - nextTabstop;
                  // DELETE-POINT is textLeftEdgePos - nbrSpacesToRemove
                }
              } else if (textLeftEdgePos.character > selection.start.character) {
                // CASE: textEdge is within selection
                // case 1: (tabstop - leftEdge) + plus leftEdgeSelectionWhite
                // case 4:  (tabstop - leftEdge) + plus leftEdgeSelectionWhite
                // -- we have white at left edge of selection!
                if (textLeftEdgePos.character < nextTabstop) {
                  // need to move text right
                  // add only
                  nbrSpacesToInsert = nextTabstop - textLeftEdgePos.character;
                  // INSERT-POINT is textLeftEdgePos
                } else {
                  // need to move text left
                  nbrSpacesToRemove = textLeftEdgePos.character - nextTabstop;
                  // DELETE-POINT is textLeftEdgePos - nbrSpacesToRemove
                }
              } else {
                // CASE: textEdge is left of selection
                // case 2: tabstop - leftEdge
                // case 3: tabstop - leftedge
                // case 6: tabstop - leftedge
                // left edge is left of selection
                // SPACEct = dist from text to desired tab
                nbrSpacesToInsert = nextTabstop - textLeftEdgePos.character;
              }
            } else {
              // have FAKE single line selection (treat as entire line selection)
              // -OR- have single line of multiple line selection
              // SPACEct = dist from text to desired tab
              nbrSpacesToInsert = nextTabstop - textLeftEdgePos.character;
            }
            this.logMessage(`    line#${currLine} Decision: nbrSpacesToInsert=(${nbrSpacesToInsert}), nbrSpacesToRemove=(${nbrSpacesToRemove})`);

            // SPECIAL case, if empty line then insert spaces all the way to the tabstop!
            if (bWholeLines && currLineText.length == 0) {
              nbrSpacesToInsert = nextTabstop;
            }
            this.logMessage(
              ` - line#${currLine} finding: BLOK-[${block}], cursor-[${cursorPos.line}:${cursorPos.character}], next TabStop is TAB-(${nextTabstop}), nbrSpacesToRemove=(${nbrSpacesToRemove}), nbrSpacesToInsert=(${nbrSpacesToInsert})`
            );

            // optionally remove spaces, then optionally add spaces
            if (nbrSpacesToRemove > 0) {
              const deleteStartPos: vscode.Position = selection.start;
              const deleteEndPos: vscode.Position = deleteStartPos.with(deleteStartPos.line, deleteStartPos.character + nbrSpacesToRemove);
              const deleteRange: vscode.Range = new vscode.Range(deleteStartPos, deleteEndPos);
              this.logMessage(
                `    line#${currLine} pushed DELETE ${deleteRange.end.character - deleteRange.start.character} spaces at [${deleteStartPos.line}:${
                  deleteStartPos.character
                }-${deleteEndPos.character}]`
              );
              results.push(vscode.TextEdit.delete(deleteRange));
              cursorPos = cursorPos.with(textLeftEdgePos.line, textLeftEdgePos.character - nbrSpacesToRemove);
              this.logMessage(`    line#${currLine} > after-DELETE cursor-[${cursorPos.line}:${cursorPos.character}]`);
              // since we are single line we could have putback text to put it back in if we need!
              // if we are in align mode, let's count this change
              if (getMode(editor) == eEditMode.ALIGN) {
                // see if we have double-white-space to manipulate...
                const doubleWhitePos: vscode.Position = this.locateDoubleWhiteLeftEdge(currLineText, textLeftEdgePos);
                if (doubleWhitePos.line != 0 && doubleWhitePos.character != 0) {
                  // yes we do!
                  // insert length of spaces we removed but at this doubleWhite location
                  const charactersToInsert: string = ' '.repeat(deleteRange.end.character - deleteRange.start.character);
                  this.logMessage(
                    `    line#${currLine} pushed AlignMode INSERT ${charactersToInsert.length} spaces before [${doubleWhitePos.line}:${doubleWhitePos.character}]`
                  );
                  results.push(vscode.TextEdit.insert(doubleWhitePos, charactersToInsert));
                }
              }
            }
            if (nbrSpacesToInsert > 0) {
              // insert spaces to left of cursor
              const charactersToInsert: string = ' '.repeat(nbrSpacesToInsert);
              results.push(vscode.TextEdit.insert(cursorPos, charactersToInsert));
              this.logMessage(`    line#${currLine} pushed INSERT ${charactersToInsert.length} spaces at [${cursorPos.line}:${cursorPos.character}]`);
              //cursorPos = cursorPos.with(currLine, cursorPos.character + nbrSpacesToInsert);
              //this.logMessage(` - line#${currLine} afterINSERT cursor-[${cursorPos.line}:${cursorPos.character}]`);
              // if we are in align mode, let's count this change
              if (getMode(editor) == eEditMode.ALIGN) {
                // see if we have double-white-space to manipulate...
                const doubleWhitePos: vscode.Position = this.locateDoubleWhiteLeftEdge(currLineText, textLeftEdgePos);
                if (doubleWhitePos.line != 0 && doubleWhitePos.character != 0) {
                  // yes we do!
                  // delete length of spaces we inserted but from this doubleWhite location
                  const doubleWhiteLength: number = this.countOfWhiteChars(currLineText, doubleWhitePos) - 1;
                  const deleteLength: number = doubleWhiteLength < nbrSpacesToInsert ? doubleWhiteLength : nbrSpacesToInsert;
                  const deleteStartPos: vscode.Position = doubleWhitePos;
                  const deleteEndPos: vscode.Position = deleteStartPos.with(deleteStartPos.line, deleteStartPos.character + deleteLength);
                  const deleteRange: vscode.Range = new vscode.Range(deleteStartPos, deleteEndPos);
                  this.logMessage(
                    `    line#${currLine} pushed AlignMode DELETE ${deleteRange.end.character - deleteRange.start.character} spaces at [${
                      deleteRange.start.line
                    }:${deleteRange.start.character}-${deleteRange.end.character}]`
                  );
                  results.push(vscode.TextEdit.delete(deleteRange));
                }
              }
            }
            // ------------ FAILED EXPERIMENT to relocate cursor after edits ---------------------
            // now place our cursor at desired location
            // HUH this aint working!!!
            if (!bWholeLines) {
              this.finalTabSelection = new vscode.Selection(textLeftEdgePos, textLeftEdgePos);
              this.bFinalTabSelectionValid = true;
              this.logMessage(
                ` - line#${currLine} end CURSOR, sel=[${this.finalTabSelection.anchor.line}:${this.finalTabSelection.anchor.character}, ${this.finalTabSelection.active.line}:${this.finalTabSelection.active.character}]`
              );
            }
            // ------------------------------------------------------------------------------------
          } else {
            // have insert point, insert spaces to left of cursor
            cursorPos = cursorPos.with(cursorPos.line, 0);
            const nextTabstop: number = this.getNextTabStop(block, cursorPos.character);
            const charactersToInsert: string = ' '.repeat(nextTabstop);
            this.logMessage(
              `    line#${currLine} pushed blank-line INSERT ${charactersToInsert.length} spaces before [${cursorPos.line}:${cursorPos.character}]`
            );
            results.push(vscode.TextEdit.insert(this.leftOfCursor(cursorPos), charactersToInsert));
            // NOTE: nothing to do for Align Mode in this empty-line case!
          }
        }
        if (selectionsProcessed > 1) {
          // do NOT allow cursor to be set when multiple lines
          this.bFinalTabSelectionValid = false;
        }

        return results;
      })
      .reduce((selections, selection) => selections.concat(selection), []);
    //editor.selections = finalSelections;
    return editResult;
  }

  /**
   * a TAB key was pressed where should the cusor be placed?
   *
   * @param none
   * @return A Selection indicating where to plave the cusor after tabbing.
   */
  outdentEndingSelection(): [vscode.Selection, boolean] {
    return [this.finalUntabSelection, this.bFinalUntabSelectionValid];
  }

  /**
   * outdent one tab stop
   *
   * @param document A text document.
   * @return A list of text edit objects.
   */
  outdentTabStop(document: vscode.TextDocument, editor: vscode.TextEditor): vscode.ProviderResult<vscode.TextEdit[]> {
    const selections: readonly vscode.Selection[] = editor.selections;
    this.bFinalUntabSelectionValid = false;
    let selectionsProcessed: number = 0;
    return selections
      .map((selection) => {
        const results: vscode.ProviderResult<vscode.TextEdit[]> = [];
        const block = this.getBlockName(document, selection);
        this.logMessage(
          `* outD enabled=[${this.enable}], selection(isSingle-[${selection.isSingleLine}] BLOK-[${block}] isEmpty-[${selection.isEmpty}] s,e-[${selection.start.line}:${selection.start.character} - ${selection.end.line}:${selection.end.character}] activ-[${selection.active.character}] anchor-[${selection.anchor.character}])`
        );
        // if tabbing is not enabled, just return after doing nothing
        if (this.enable == false) {
          return results;
        }

        selectionsProcessed += 1;

        //  if no selection, just cursor - skip whitespace to right - treat chars to left
        //  if selection is single line then cursor is at front of selection - skip whitespace to right - treat chars to left

        // SPECIAL: multiLine lineA and lineA+1 both at char pos 0 is really single line selection of lineA
        //   CURSOR POS is always .anchor! if SPECIAL case anchor is conveniently ZERO already!
        // COLUMN MODE is really multiple single-line selections!
        const { firstLine, lastLine, lineCount } = this.lineNumbersFromSelection(document, selection);
        const bWholeLines: boolean = firstLine != lastLine;

        // this will be used to find our new tab column in multi-line case
        this.logMessage(` - (DBG) ${lineCount} lines: fm,to=[${firstLine}, ${lastLine}], bWholeLines=(${bWholeLines})`);

        // set initial position to right edge of selection
        const initialCursorPos: vscode.Position = selection.end;
        let cursorPos: vscode.Position = initialCursorPos;
        // if we have multi-line selection reset cursor to first char of all lines
        if (bWholeLines) {
          cursorPos = cursorPos.with(cursorPos.line, 0);
        }
        this.logMessage(
          ` - finding: BLOK-[${block}], wholeLines=(${bWholeLines}), lines fm,to=[${firstLine}, ${lastLine}], cursor-[${cursorPos.line}:${cursorPos.character}]`
        );

        for (let currLine: number = firstLine; currLine <= lastLine; currLine++) {
          // now use selection to skip whitespace to right of cursor
          cursorPos = cursorPos.with(currLine, initialCursorPos.character);

          // grab the text of the current selected line
          const currLineText: string = document.lineAt(currLine).text;

          // if we found text to adjust...
          if (currLineText.length > 0 || bWholeLines) {
            // now adjust cursor: if at white, skip to next rightmost non-white, if at non-white, skip to left edge of non-white
            //  or put another way skip to left most char of text (if in text find left edge, if not in text find first text to right)
            if (selection.isEmpty) {
              // have insert point
              // if we are pointing to white space, move to left edge of text (to right of position)
              cursorPos = this.locateLeftTextEdge(currLineText, cursorPos);
            } else if (selection.isSingleLine) {
              // have true single line selection
              // move to left edge of text (to left -OR- right of position)
              const selectionLeftEdgePos: vscode.Position = cursorPos.with(cursorPos.line, selection.start.character);
              cursorPos = this.locateLeftTextEdge(currLineText, selectionLeftEdgePos);
            } else {
              // have FAKE single line selection
              // -OR- have single line of multiple line selection
              cursorPos = this.locateLeftTextEdge(currLineText, cursorPos);
            }

            this.logMessage(` - line#${currLine} ltEdge-[${cursorPos.line}:${cursorPos.character}], text-[${currLineText}]`);

            // we'd like to outdent to prev tab-stop but let's only go as far a to leave 1 space before prior text
            const nextTabStopToLeft: number = this.getPreviousTabStop(block, cursorPos.character);
            const whiteSpaceToLeftCt: number = this.countLeftWhiteSpace(currLineText, cursorPos.character);
            let nbrCharsToDelete: number = cursorPos.character - nextTabStopToLeft;
            this.logMessage(
              ` - line#${currLine} tabStop=(${nextTabStopToLeft}), spacesToLeft=(${whiteSpaceToLeftCt}), nbrCharsToDelete=(${nbrCharsToDelete})`
            );
            if (nbrCharsToDelete > whiteSpaceToLeftCt) {
              nbrCharsToDelete = whiteSpaceToLeftCt;
            }
            const deleteStart: vscode.Position = cursorPos.with(cursorPos.line, cursorPos.character - nbrCharsToDelete);
            const deleteEnd: vscode.Position = deleteStart.with(deleteStart.line, deleteStart.character + nbrCharsToDelete);
            const range = selection.with({ start: deleteStart, end: deleteEnd });
            this.logMessage(
              `    line#${currLine} pushed DELETE spaces [${range.start.line}:${range.start.character} - ${range.end.line}:${range.end.character}], tabStop: ${nextTabStopToLeft})`
            );
            results.push(vscode.TextEdit.delete(range));
            // if we are in align mode, let's count this change
            const currMode: eEditMode = getMode(editor);
            const currModeName: string = modeName(currMode);
            this.logMessage(`    Editor Mode = [${currModeName}]`);

            if (!bWholeLines) {
              this.bFinalUntabSelectionValid = true;
              this.finalUntabSelection = new vscode.Selection(deleteStart, deleteStart);
            }

            if (currMode == eEditMode.ALIGN) {
              // see if we have double-white-space to manipulate...
              const doubleWhitePos: vscode.Position = this.locateDoubleWhiteLeftEdge(currLineText, deleteEnd);
              if (doubleWhitePos.line != 0 && doubleWhitePos.character != 0) {
                // yes we do!
                // insert length of spaces we removed but at this doubleWhite location
                const charactersToInsert: string = ' '.repeat(range.end.character - range.start.character);
                this.logMessage(
                  `    line#${currLine} pushed AlignMode INSERT ${charactersToInsert.length} spaces before [${doubleWhitePos.line}:${doubleWhitePos.character}]`
                );
                results.push(vscode.TextEdit.insert(doubleWhitePos, charactersToInsert));
              }
            }
          } else {
            // Empty selection, nothing to do here!
          }
        }
        if (selectionsProcessed > 1) {
          // do NOT allow cursor to be set when multiple lines
          this.bFinalUntabSelectionValid = false;
        }
        return results;
      })
      .reduce((selections, selection) => selections.concat(selection), []);
  }

  readonly alignWordExpr = /([^ ]+ ?)*[^ ]+/;

  /**
   * align before type
   *
   * @param editor The current editor window.
   * @return Nothing.
   */
  alignBeforeType(editor: vscode.TextEditor, text: string, undoStop: boolean) {
    // skip overtype behavior when enter is pressed
    if (text === '\r' || text === '\n' || text === '\r\n') {
      vscode.commands.executeCommand('default:type', { text: text });
      return;
    }
    if (getMode(editor) != eEditMode.ALIGN) {
      this.logMessage(`* alnBT ABORT, not in Align mode`);
      return; // bail if not in Align Mode!
    }
    if (text.indexOf(' ') !== -1) undoStop = true;

    editor
      .edit(
        (edit) => {
          editor.selections = editor.selections.map((selection) => {
            this.logMessage(
              `* alnBT enabled=[${this.enable}], text=[${text}], selection(isSingle-[${selection.isSingleLine}] isEmpty-[${selection.isEmpty}] s,e-[${selection.start.line}:${selection.start.character} - ${selection.end.line}:${selection.end.character}] activ-[${selection.active.character}] anchor-[${selection.anchor.character}])`
            );
            const cursorPosition = selection.start;
            const lineEndPosition = editor.document.lineAt(cursorPosition).range.end;
            const typeSel = selection;

            // handle alignment
            if (typeSel.isSingleLine) {
              const typeSize: number = editor.document.offsetAt(typeSel.end) - editor.document.offsetAt(typeSel.start);
              if (typeSize > 1) undoStop = true;
              if (typeSize != text.length) {
                const spaceDiff: number = text.length - typeSize;
                let currWord: vscode.Range | undefined = editor.document.getWordRangeAtPosition(typeSel.end, this.alignWordExpr);
                if (!currWord) currWord = editor.document.getWordRangeAtPosition(typeSel.end.translate(0, +1), this.alignWordExpr);
                let spacesAfter: vscode.Range | undefined = undefined;
                if (currWord && !currWord.end.isEqual(lineEndPosition)) {
                  spacesAfter = editor.document.getWordRangeAtPosition(currWord.end, / {2,}/);
                } else if (!typeSel.end.isEqual(lineEndPosition)) {
                  if (editor.document.getText(new vscode.Range(typeSel.end, typeSel.end.translate(0, +2))) === '  ') {
                    spacesAfter = editor.document.getWordRangeAtPosition(typeSel.end, / {2,}/);
                  }
                }
                if (spacesAfter && typeSize < text.length) {
                  // remove spaces if possible
                  const spaceCount: number = editor.document.offsetAt(spacesAfter.end) - editor.document.offsetAt(spacesAfter.start);
                  edit.delete(new vscode.Range(spacesAfter.end.translate(0, -Math.min(spaceDiff, spaceCount - 1)), spacesAfter.end));
                } else if (spacesAfter && typeSize > text.length) {
                  // Add spaces
                  edit.insert(spacesAfter.end, ' '.repeat(typeSize - text.length));
                }
              }
            } else {
              undoStop = true;
            }
            if (typeSel.isEmpty) {
              edit.insert(typeSel.end, text);
            } else {
              edit.replace(typeSel, text);
            }
            return new vscode.Selection(typeSel.end, typeSel.end);
          });
        },
        { undoStopAfter: undoStop, undoStopBefore: false }
      )
      .then(() => {});
  }

  /**
   * align delete (left or right)
   *
   * @param isRight T/F where T means is Delete-right
   * @return Nothing
   */
  alignDelete(editor: vscode.TextEditor, isRight: boolean) {
    if (getMode(editor) != eEditMode.ALIGN) {
      this.logMessage(`* alnDEL ABORT, not in Align mode`);
      return; // bail if not in Align Mode!
    }
    editor.edit((edit) => {
      editor.selections = editor.selections.map((selection) => {
        this.logMessage(
          `* alnDEL enabled=[${this.enable}], isRight=[${isRight}], selection(isSingle-[${selection.isSingleLine}] isEmpty-[${selection.isEmpty}] s,e-[${selection.start.line}:${selection.start.character} - ${selection.end.line}:${selection.end.character}] activ-[${selection.active.character}] anchor-[${selection.anchor.character}])`
        );

        // TEST CASES
        //   delete left at head of line removes line-end of prior line
        //   delete right at end of line removes line end of this line
        //   insert point in work
        //   insert point in spaces
        //   selection within single line

        const { firstLine, lastLine, lineCount } = this.lineNumbersFromSelection(editor.document, selection);
        const bWholeLines: boolean = firstLine != lastLine;
        this.logMessage(`  -- firstLine=[${firstLine}], lastLine=[${lastLine}], lineCount-[${lineCount}]`);
        const lastLineText: string = editor.document.lineAt(lastLine).text;
        this.logMessage(`  -- last line of sel. preDEL=[${lastLineText}](${lastLineText.length})`);

        let range: vscode.Range = selection;
        let cursorRange: vscode.Range = range;
        if (selection.isSingleLine && !selection.isEmpty) {
          // if we have part of a line then place cursor at start of delete
          cursorRange = range.with(range.start, range.start);
        } else if (bWholeLines) {
          // if we have multi-line then place cursor at start of delete
          cursorRange = range.with(range.start, range.start);
        }
        let rngLen: number = range.end.character - range.start.character;
        // if selection spans multiple lines we don't insert anything after delete
        let bNoInsert: boolean = bWholeLines ? true : false;
        if (selection.isEmpty) {
          rngLen = 1; // all of the following are 1 char long (even tho' some are len-ends)
          // are we deleting left from start of line?
          if (selection.end.character == 0 && !isRight) {
            // YES, remove line end from prior line
            const priorLine: number = lastLine > 0 ? lastLine - 1 : lastLine;
            const priorLineText: string = editor.document.lineAt(priorLine).text;
            const priorLineLast: vscode.Position = range.end.with(priorLine, priorLineText.length);
            range = range.with(priorLineLast, range.end);
            bNoInsert = true;
            // cursor range is good
          }
          // are we deleting right from end of line?
          else if (selection.end.character == lastLineText.length && isRight) {
            // YES, remove line end from this line
            const endPlusOne: vscode.Position = range.end.with(range.end.line + 1, 0);
            range = range.with(range.start, endPlusOne);
            bNoInsert = true;
            // cursor range is good
          } else {
            // then simply delete 1 char left or right
            if (isRight) {
              // from right
              const endPlusOne: vscode.Position = range.end.with(range.end.line, range.end.character + 1);
              range = range.with(range.start, endPlusOne);
            } else {
              // from left
              const endMinusOne: vscode.Position = range.end.with(range.end.line, range.end.character - 1);
              range = range.with(endMinusOne, range.end);
            }
          }
        }

        this.logMessage(`*  DELETE  range=[${range.start.line}:${range.start.character} - ${range.end.line}:${range.end.character}](${rngLen})`);
        edit.delete(range);

        if (!bNoInsert) {
          // grab the text of the current selected line
          const currLineText: string = editor.document.lineAt(lastLine).text;
          // now use selection to skip whitespace to right of cursor
          const cursorPos: vscode.Position = selection.end;
          const replaceLen: number = rngLen;

          const textLeftEdge: vscode.Position = this.locateLeftTextEdge(currLineText, cursorPos);
          const doubleWhitePos: vscode.Position = this.locateDoubleWhiteLeftEdge(currLineText, textLeftEdge);
          this.logMessage(`  -- postDEL=[${currLineText}](${currLineText.length})`);

          if (doubleWhitePos.line != 0 && doubleWhitePos.character != 0) {
            this.logMessage(`*  INSERT  ' '(${replaceLen}) at=[${doubleWhitePos.line}:${doubleWhitePos.character}]`);
            edit.insert(doubleWhitePos, ' '.repeat(replaceLen));
          }
        }
        this.logMessage(
          `*  CURSOR  range=[${cursorRange.start.line}:${cursorRange.start.character} - ${cursorRange.end.line}:${cursorRange.end.character}](${rngLen})`
        );
        return new vscode.Selection(cursorRange.start, cursorRange.start);
      });
    });
  }
}
