'use strict';
// src/parser/spin1.documentSymbolParser.ts

import * as lsp from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Spin1ParseUtils } from './spin1.utils';
import { OutLineSymbol, DocumentFindings } from './spin.semantic.findings';
import { Context } from '../context';
import { eParseState } from './spin.common';
import { ExtensionUtils } from '../parser/spin.extension.utils';

// ----------------------------------------------------------------------------
//   OUTLINE Provider
//
//   process given Spin1 document generating OutLineSymbols and recording them in
//    the DocumentFindings object assiciated with this file
//
export class Spin1DocumentSymbolParser {
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private bLogStarted: boolean = false;
  private extensionUtils: ExtensionUtils;

  private parseUtils: Spin1ParseUtils = new Spin1ParseUtils();
  private containerDocSymbol: OutLineSymbol | undefined = undefined;
  private symbolsFound: DocumentFindings | undefined = undefined;

  public constructor(protected readonly ctx: Context) {
    this.extensionUtils = new ExtensionUtils(ctx, this.isDebugLogEnabled);
    if (this.isDebugLogEnabled) {
      this.parseUtils.enableLogging(this.ctx);
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        //Create output channel
        this._logMessage('Spin1 Outline log started.');
      } else {
        this._logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }
  }

  public reportDocumentSymbols(document: TextDocument, findings: DocumentFindings): void {
    let currState: eParseState = eParseState.inCon; // compiler defaults to CON at start!
    let priorState: eParseState = currState;
    let prePasmState: eParseState = currState;
    this.symbolsFound = findings;
    if (this.isDebugLogEnabled) {
      this.symbolsFound.enableLogging(this.ctx);
    }

    for (let i = 0; i < document.lineCount; i++) {
      const desiredLineRange: lsp.Range = {
        start: { line: i, character: 0 },
        end: { line: i, character: Number.MAX_VALUE }
      };
      //let line = document.lineAt(i);
      const line = document.getText(desiredLineRange).replace(/\s+$/, '');
      const lineRange: lsp.Range = {
        start: { line: i, character: 0 },
        end: { line: i, character: line.length - 1 }
      };
      const trimmedLine = line.trim();
      let nonCommentLine = this.parseUtils.getRemainderWOutTrailingTicComment(0, line);
      if (nonCommentLine.length == 0) {
        nonCommentLine = trimmedLine; // all comment, but parser has to see it!
      }

      let linePrefix: string = line;
      let lineHasComment: boolean = false;
      let commentOffset: number = 0;
      let commentLength: number = 0;

      if (nonCommentLine.trim().length == 0 && !trimmedLine.startsWith("'")) {
        // skip only white-space lines
        continue;
      }

      const sectionStatus = this.extensionUtils.isSectionStartLine(line);
      if (sectionStatus.isSectionStart) {
        nonCommentLine = nonCommentLine.substring(3);
      }

      // skip all {{ --- }} multi-line doc comments
      if (currState == eParseState.inMultiLineDocComment) {
        // in multi-line doc-comment, hunt for end '}}' to exit
        const openingOffset = nonCommentLine.indexOf('{{');
        const searchOffset: number = openingOffset != -1 ? openingOffset + 2 : 0;
        const closingOffset = nonCommentLine.indexOf('}}', searchOffset);
        const haveInlineCmt: boolean = openingOffset != -1 && closingOffset != -1 && openingOffset < closingOffset;
        if (!haveInlineCmt && closingOffset != -1) {
          // have close, comment ended
          currState = priorState;
        }
        //  no more processing for this line
        continue;
      } else if (currState == eParseState.inMultiLineComment) {
        // in multi-line non-doc-comment, hunt for end '}' to exit
        const openingOffset = nonCommentLine.indexOf('{');
        const closingOffset = nonCommentLine.indexOf('}', openingOffset + 1);
        const haveInlineCmt: boolean = openingOffset != -1 && closingOffset != -1 && openingOffset < closingOffset;
        if (!haveInlineCmt && closingOffset != -1) {
          // have close, comment ended
          currState = priorState;
        }
        //  no more processing for this line
        const cmtState: string = currState != eParseState.inMultiLineComment ? 'LAST ' : '';
        this._logMessage(`* SKIP ${cmtState}BlockCmt Ln#${i + 1} nonCommentLine=[${nonCommentLine}]`);
        continue;
      } else if (nonCommentLine.startsWith("''")) {
        //  no more processing for this line
        continue;
      } else if (nonCommentLine.startsWith("'")) {
        //  no more processing for this line
        continue;
      } else if (nonCommentLine.trim().startsWith('{{')) {
        // process multi-line doc comment
        const openingOffset = nonCommentLine.indexOf('{{');
        const searchOffset: number = openingOffset != -1 ? openingOffset + 2 : 0;
        const closingOffset = nonCommentLine.indexOf('}}', searchOffset);
        if (closingOffset != -1) {
          // is single line comment, just ignore it
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineDocComment;
          //  no more processing for this line
        }
        continue;
      } else if (nonCommentLine.trim().startsWith('{')) {
        // process possible multi-line non-doc comment
        // do we have a close on this same line?
        const openingOffset = nonCommentLine.indexOf('{');
        const closingOffset = nonCommentLine.indexOf('}', openingOffset + 1);
        if (closingOffset == -1) {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineComment;
          //  no more processing for this line
          this._logMessage(`* SKIP BlockCmt Ln#${i + 1} nonCommentLine=[${nonCommentLine}]`);
          continue;
        }
      }

      if (sectionStatus.isSectionStart) {
        currState = sectionStatus.inProgressStatus;
      }

      if (line.length > 2) {
        const lineParts: string[] = linePrefix.split(/[ \t{']/).filter(Boolean);
        linePrefix = lineParts.length > 0 ? lineParts[0].toUpperCase() : '';
        // the only form of comment we care about here is block comment after section name (e.g., "CON { text }")
        //  NEW and let's add the use of ' comment too
        const openBraceOffset: number = line.indexOf('{');
        const singleQuoteOffset: number = line.indexOf("'");
        if (openBraceOffset != -1) {
          commentOffset = openBraceOffset;
          const closeBraceOffset: number = line.indexOf('}', openBraceOffset + 1);
          if (closeBraceOffset != -1) {
            lineHasComment = true;
            commentLength = closeBraceOffset - openBraceOffset + 1;
          }
        } else if (singleQuoteOffset != -1) {
          commentOffset = singleQuoteOffset;
          lineHasComment = true;
          commentLength = line.length - singleQuoteOffset + 1;
        }
      }

      if (sectionStatus.isSectionStart) {
        if (linePrefix == 'CON' || linePrefix == 'DAT' || linePrefix == 'VAR' || linePrefix == 'OBJ') {
          // start CON/VAR/OBJ/DAT
          const sectionComment = lineHasComment ? line.substr(commentOffset, commentLength) : '';
          let blockSymbolKind: lsp.SymbolKind = lsp.SymbolKind.Variable;
          if (linePrefix == 'CON') {
            blockSymbolKind = lsp.SymbolKind.Method;
          } else if (linePrefix == 'DAT') {
            blockSymbolKind = lsp.SymbolKind.EnumMember;
          } else if (linePrefix == 'OBJ') {
            blockSymbolKind = lsp.SymbolKind.Class;
          }
          const blockSymbol: OutLineSymbol = new OutLineSymbol(linePrefix + ' ' + sectionComment, '', blockSymbolKind, lineRange);
          this.setContainerSymbol(blockSymbol);
          // HANDLE label declaration on DAT line!
          if (linePrefix == 'DAT') {
            const lineParts: string[] = nonCommentLine.split(/[ \t]/).filter(Boolean);
            let posssibleLabel: string | undefined = undefined;
            if (lineParts.length >= 2) {
              // possibly have label, report it if we do
              posssibleLabel = lineParts[1];
              if (
                posssibleLabel.toUpperCase().startsWith('ORG') ||
                this.parseUtils.isP1AsmEffect(posssibleLabel) ||
                this.parseUtils.isP1AsmInstruction(posssibleLabel) ||
                this.parseUtils.isP1AsmReservedSymbols(posssibleLabel)
              ) {
                posssibleLabel = undefined; // Nope!
              } else if (lineParts.length >= 3 && this.parseUtils.isDatNFileStorageType(lineParts[2])) {
                posssibleLabel = undefined; // Nope!
              }
              if (posssibleLabel) {
                //const labelSymbol: OutLineSymbol = new OutLineSymbol(lineParts[1], '', lsp.SymbolKind.Constant, lineRange);
                const labelSymbol: OutLineSymbol = new OutLineSymbol(lineParts[1], '', lsp.SymbolKind.String, lineRange);
                if (this.containerDocSymbol) {
                  this.containerDocSymbol.addChild(labelSymbol);
                }
              }
            }
          }
        } else if (linePrefix == 'PUB' || linePrefix == 'PRI') {
          // start PUB/PRI
          //let methodScope: string = 'Public';
          //if (line.startsWith('PRI')) {
          //  methodScope = 'Private';
          //}
          let methodName: string = line.substr(3).trim();
          if (methodName.includes("'")) {
            // remove tic-single-line-comment
            const lineParts: string[] = methodName.split("'");
            methodName = lineParts[0].trim();
          }
          if (methodName.includes('{')) {
            // remove brace-wrapped-comment
            const lineParts: string[] = methodName.split('{');
            methodName = lineParts[0].trim();
          }
          if (methodName.includes('|')) {
            // remove local vars
            const lineParts: string[] = methodName.split('|');
            methodName = lineParts[0].trim();
          }

          // NOTE this changed to METHOD when we added global labels which are to be Functions!
          const methodSymbolKind: lsp.SymbolKind = linePrefix == 'PUB' ? lsp.SymbolKind.Method : lsp.SymbolKind.Field;
          const methodSymbol: OutLineSymbol = new OutLineSymbol(linePrefix + ' ' + methodName, '', methodSymbolKind, lineRange);
          this.setContainerSymbol(methodSymbol);
        }
      } else {
        let global_label: string | undefined = undefined;
        if (nonCommentLine.length > 0) {
          //this._logMessage("  * [" + currState + "] Ln#" + (i + 1) + " nonCommentLine=[" + nonCommentLine + "]");
          // NOT a section start
          if (currState == eParseState.inDatPAsm) {
            // process pasm (assembly) lines
            if (trimmedLine.length > 0) {
              // didn't leave this state check for new global label
              global_label = this._getDAT_PasmDeclaration(0, line); // let's get possible label on this ORG statement
            }
          } else if (currState == eParseState.inDat) {
            this._logMessage('    scan inDat Ln#' + (i + 1) + ' nonCommentLine=[' + nonCommentLine + ']');
            if (nonCommentLine.length > 6 && nonCommentLine.toUpperCase().includes('ORG')) {
              // ORG, ORGF, ORGH
              const nonStringLine: string = this.parseUtils.removeDoubleQuotedStrings(nonCommentLine);
              if (nonStringLine.toUpperCase().includes('ORG')) {
                this._logMessage('  - pre-scan DAT line trimmedLine=[' + trimmedLine + '] now Dat PASM');
                prePasmState = currState;
                currState = eParseState.inDatPAsm;
                this._logMessage('    scan START DATPasm Ln#' + (i + 1) + ' PUSH currState=[' + prePasmState + ']');
                // and ignore rest of this line
                global_label = this._getDAT_PasmDeclaration(0, line); // let's get possible label on this ORG statement
              }
            } else {
              global_label = this._getDAT_Declaration(0, line);
            }
          }
          if (global_label) {
            // was Variable: sorta OK (image good, color bad)
            // was Constant: sorta OK (image good, color bad)   SAME
            //const labelSymbol: OutLineSymbol = new OutLineSymbol(global_label, '', lsp.SymbolKind.Constant, lineRange);
            const labelSymbol: OutLineSymbol = new OutLineSymbol(global_label, '', lsp.SymbolKind.String, lineRange);
            if (this.containerDocSymbol) {
              this.containerDocSymbol.addChild(labelSymbol);
            } else {
              this.symbolsFound.setOutlineSymbol(labelSymbol);
            }
          }
        }
      }
    }
    // if we have one last unpushed, push it
    if (this.containerDocSymbol) {
      this.symbolsFound.setOutlineSymbol(this.containerDocSymbol);
      this.containerDocSymbol = undefined;
    }
  }

  private setContainerSymbol(newSymbol: OutLineSymbol): void {
    // report symbol, possible container symbol, then start a new container
    if (this.containerDocSymbol && this.symbolsFound) {
      // WARNING this.symbolsFound by compiler could be undefined - but ats runtime is always set up by calling routine! (so we can wrap this safely without further care)
      this.symbolsFound.setOutlineSymbol(this.containerDocSymbol);
    }
    this.containerDocSymbol = newSymbol;
  }

  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled) {
      //Write to output window.
      this.ctx.logger.log(message);
    }
  }

  private _getDAT_Declaration(startingOffset: number, line: string): string | undefined {
    // HAVE    bGammaEnable        BYTE   TRUE               ' comment
    //         didShow             byte   FALSE[256]
    //                             byte   FALSE[256]
    let newGlobalLabel: string | undefined = undefined;
    const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const dataDeclNonCommentStr = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    const lineParts: string[] = this.parseUtils.getNonWhiteNParenLineParts(dataDeclNonCommentStr);
    this._logMessage(`- Oln GetDatDecl lineParts=[${lineParts}](${lineParts.length})`);
    const haveMoreThanDat: boolean = lineParts.length > 1 && lineParts[0].toUpperCase() == 'DAT';
    if (haveMoreThanDat || (lineParts.length > 0 && lineParts[0].toUpperCase() != 'DAT')) {
      // remember this object name so we can annotate a call to it
      let nameIndex: number = 0;
      let typeIndex: number = 1;
      let maxParts: number = 2;
      if (lineParts[0].toUpperCase() == 'DAT') {
        nameIndex = 1;
        typeIndex = 2;
        maxParts = 3;
      }
      const haveLabel: boolean = this.parseUtils.isDatOrPAsmLabel(lineParts[nameIndex]);
      const isDataDeclarationLine: boolean =
        lineParts.length > maxParts - 1 && haveLabel && this.parseUtils.isDatStorageType(lineParts[typeIndex]) ? true : false;
      const lblFlag: string = haveLabel ? 'T' : 'F';
      const dataDeclFlag: string = isDataDeclarationLine ? 'T' : 'F';
      this._logMessage('- Oln GetDatDecl lineParts=[' + lineParts + '](' + lineParts.length + ') label=' + lblFlag + ', daDecl=' + dataDeclFlag);
      if (haveLabel) {
        const newName = lineParts[nameIndex];
        if (
          !newName.toLowerCase().startsWith('debug') &&
          !this.parseUtils.isP1AsmReservedWord(newName) &&
          !this.parseUtils.isSpinReservedWord(newName) &&
          !this.parseUtils.isSpinBuiltInVariable(newName) &&
          !this.parseUtils.isBuiltinReservedWord(newName)
        ) {
          if (!isDataDeclarationLine && !newName.startsWith('.') && !newName.startsWith(':') && !newName.includes('#')) {
            newGlobalLabel = newName;
            this._logMessage('  -- Oln GLBL gddcl newName=[' + newGlobalLabel + ']');
          }
        }
      }
    }
    return newGlobalLabel;
  }

  private _getDAT_PasmDeclaration(startingOffset: number, line: string): string | undefined {
    // HAVE    bGammaEnable        BYTE   TRUE               ' comment
    //         didShow             byte   FALSE[256]
    let newGlobalLabel: string | undefined = undefined;
    const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const datPasmRHSStr = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    if (datPasmRHSStr.length > 0) {
      const lineParts: string[] = this.parseUtils.getNonWhiteNParenLineParts(datPasmRHSStr);
      this._logMessage('- Oln GetPasmDatDecl lineParts=[' + lineParts + '](' + lineParts.length + ')');
      // handle name in 1 column
      const haveLabel: boolean = this.parseUtils.isDatOrPAsmLabel(lineParts[0]);
      const isDataDeclarationLine: boolean = lineParts.length > 1 && haveLabel && this.parseUtils.isDatStorageType(lineParts[1]) ? true : false;
      if (haveLabel && !isDataDeclarationLine && !lineParts[0].startsWith('.') && !lineParts[0].startsWith(':') && !lineParts[0].includes('#')) {
        const labelName: string = lineParts[0];
        if (
          !this.parseUtils.isP1AsmReservedSymbols(labelName) &&
          !labelName.toUpperCase().startsWith('IF_') &&
          !labelName.toUpperCase().startsWith('_RET_') &&
          !labelName.toUpperCase().startsWith('DEBUG')
        ) {
          // org in first column is not label name, nor is if_ conditional
          newGlobalLabel = labelName;
          this._logMessage('  -- DAT Oln PASM GLBL newGlobalLabel=[' + newGlobalLabel + ']');
        }
      }
    }
    return newGlobalLabel;
  }
}
