/* eslint-disable @typescript-eslint/no-unused-vars */
'use strict';

import * as vscode from 'vscode';
import { EndOfLine } from 'vscode';

import * as fs from 'fs';
import * as path from 'path';

import { isSpin1Document, isSpin2File, isSpin1File } from '../spin.vscode.utils';
import { SpinCodeUtils, eParseState } from '../spin.code.utils';
import { ObjectTreeProvider, SpinDependency } from '../spin.object.dependencies';

export class DocGenerator {
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private debugOutputChannel: vscode.OutputChannel | undefined = undefined;
  private spinCodeUtils: SpinCodeUtils = new SpinCodeUtils();
  private objTreeProvider: ObjectTreeProvider;
  private endOfLineStr: string = '\r\n';
  private hierarchyFilenameTotal: number = 0;
  private hierarchyFilenameCount: number = 0;

  constructor(objectTreeProvider: ObjectTreeProvider) {
    this.objTreeProvider = objectTreeProvider;
    if (this.isDebugLogEnabled) {
      if (this.debugOutputChannel === undefined) {
        //Create output channel
        this.debugOutputChannel = vscode.window.createOutputChannel('Spin/Spin2 DocGen DEBUG');
        this.logMessage('Spin/Spin2 DocGen log started.');
      } else {
        this.logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }
  }

  // ----------------------------------------------------------------------------
  //   Hook GENERATE PUB/PRI doc comment
  //
  public insertDocComment(document: vscode.TextDocument, selections: readonly vscode.Selection[]): vscode.ProviderResult<vscode.TextEdit[]> {
    return selections
      .map((selection) => {
        const results: vscode.ProviderResult<vscode.TextEdit[]> = [];
        this.endOfLineStr = document.eol == EndOfLine.CRLF ? '\r\n' : '\n';
        const isSpin1Doc: boolean = isSpin1Document(document);
        this.logMessage(
          `* iDc selection(isSingle-[${selection.isSingleLine}] isSpin1Doc-(${isSpin1Doc}) isEmpty-[${selection.isEmpty}] s,e-[${selection.start.line}:${selection.start.character} - ${selection.end.line}:${selection.end.character}] activ-[${selection.active.character}] anchor-[${selection.anchor.character}])`
        );
        const { firstLine, lastLine, lineCount } = this._lineNumbersFromSelection(document, selection);
        const cursorPos: vscode.Position = new vscode.Position(firstLine + 1, 0);
        let linesToInsert: string[] = [];
        const signatureLine: string = document.lineAt(firstLine).text.trim();
        const linePrefix = signatureLine.length > 3 ? signatureLine.substring(0, 3).toLowerCase() : '';
        const isSignature: boolean = linePrefix.startsWith('pub') || linePrefix.startsWith('pri');
        if (isSignature) {
          linesToInsert = this.generateDocCommentForSignature(signatureLine, isSpin1Doc);
        } else {
          this.logMessage(`* iDc SKIP - NOT on signature line`);
        }

        // insert the lines, if any
        if (linesToInsert.length > 0) {
          for (const line of linesToInsert) {
            results.push(vscode.TextEdit.insert(cursorPos, `${line}` + this.endOfLineStr));
          }
        }
        return results;
      })
      .reduce((selections, selection) => selections.concat(selection), []);
  }

  private _lineNumbersFromSelection(
    document: vscode.TextDocument,
    selection: vscode.Selection
  ): { firstLine: number; lastLine: number; lineCount: number } {
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

  public generateDocCommentForSignature(signatureLine: string, isSpin1Method: boolean): string[] {
    const desiredDocComment: string[] = [];
    this.logMessage(`* iDc SKIP - generateDocCommentForSignature([${signatureLine}], isSpin1=${isSpin1Method})`);
    const linePrefix = signatureLine.length > 3 ? signatureLine.substring(0, 3).toLowerCase() : '';
    const isSignature: boolean = linePrefix.startsWith('pub') || linePrefix.startsWith('pri');
    const isPRI: boolean = linePrefix.startsWith('pri');
    if (isSignature) {
      const commentPrefix = isPRI ? "'" : "''";
      desiredDocComment.push(commentPrefix + ' ...'); // for description
      desiredDocComment.push(commentPrefix + ' '); // blank line
      const posOpenParen = signatureLine.indexOf('(');
      const posCloseParen = signatureLine.indexOf(')');
      // if we have name() it's spin1 or spin2
      if (posOpenParen != -1 && posCloseParen != -1) {
        const bHasParameters: boolean = posCloseParen - posOpenParen > 1 ? true : false;
        if (bHasParameters) {
          const paramString: string = signatureLine.substring(posOpenParen + 1, posCloseParen);
          const numberParameters: number = (paramString.match(/,/g) || []).length + 1;
          const paramNames = paramString.split(/[ \t,]/).filter(Boolean);
          this.logMessage(`* gDCparamString=[${paramString}], paramNames=[${paramNames}]`);
          for (let paramIdx = 0; paramIdx < numberParameters; paramIdx++) {
            desiredDocComment.push(commentPrefix + ` @param ${paramNames[paramIdx]} - `); // blank line
          }
        }
        const bHasReturnValues: boolean = signatureLine.includes(':') ? true : false;
        const bHasLocalVariables: boolean = signatureLine.includes('|') ? true : false;
        if (bHasReturnValues) {
          const posStartReturn = signatureLine.indexOf(':') + 1;
          const posEndReturn = bHasLocalVariables ? signatureLine.indexOf('|') - 1 : signatureLine.length;
          const returnsString: string = signatureLine.substring(posStartReturn, posEndReturn);
          const numberReturns: number = (returnsString.match(/,/g) || []).length + 1;
          const returnNames = returnsString.split(/[ \t,]/).filter(Boolean);
          this.logMessage(`* gDCreturnsString=[${returnsString}], returnNames=[${returnNames}]`);
          for (let retValIdx = 0; retValIdx < numberReturns; retValIdx++) {
            desiredDocComment.push(commentPrefix + ` @returns ${returnNames[retValIdx]} - `); // blank line
          }
        }
        let posTrailingComment = signatureLine.indexOf("'");
        if (posTrailingComment == -1) {
          posTrailingComment = signatureLine.indexOf('{');
        }
        if (bHasLocalVariables) {
          // locals are always non-doc single-line comments
          const posStartLocal = signatureLine.indexOf('|') + 1;
          const posEndLocal = posTrailingComment != -1 ? posTrailingComment : signatureLine.length;
          const localsString: string = signatureLine.substring(posStartLocal, posEndLocal);
          const numberLocals: number = (localsString.match(/,/g) || []).length + 1;
          const localsNames = localsString.split(/[ \t,]/).filter(Boolean);
          this.logMessage(`* gDClocalsString=[${localsString}], localsNames=[${localsNames}]`);
          desiredDocComment.push(''); // empty line so following is not shown in comments for method
          desiredDocComment.push("' Local Variables:"); // blank line
          for (let localIdx = 0; localIdx < numberLocals; localIdx++) {
            desiredDocComment.push("'" + ` @local ${localsNames[localIdx]} - `); // blank line
          }
        }
      } else if (isSpin1Method) {
        // spin1 methods don't need parens when no parameters are specified
        const bHasReturnValues: boolean = signatureLine.includes(':') ? true : false;
        const bHasLocalVariables: boolean = signatureLine.includes('|') ? true : false;
        if (bHasReturnValues) {
          const posStartReturn = signatureLine.indexOf(':') + 1;
          const posEndReturn = bHasLocalVariables ? signatureLine.indexOf('|') - 1 : signatureLine.length;
          const returnsString: string = signatureLine.substring(posStartReturn, posEndReturn);
          // spin1 only allows 1 return variable
          const returnNames = returnsString.split(/[ \t,]/).filter(Boolean);
          this.logMessage(`* gDCreturnsString=[${returnsString}], returnNames=[${returnNames}]`);
          desiredDocComment.push(commentPrefix + ` @returns ${returnNames[0]} - `); // blank line
        }
        let posTrailingComment = signatureLine.indexOf("'");
        if (posTrailingComment == -1) {
          posTrailingComment = signatureLine.indexOf('{');
        }
        if (bHasLocalVariables) {
          // locals are always non-doc single-line comments
          const posStartLocal = signatureLine.indexOf('|') + 1;
          const posEndLocal = posTrailingComment != -1 ? posTrailingComment : signatureLine.length;
          const localsString: string = signatureLine.substring(posStartLocal, posEndLocal);
          const numberLocals: number = (localsString.match(/,/g) || []).length + 1;
          const localsNames = localsString.split(/[ \t,]/).filter(Boolean);
          this.logMessage(`* gDClocalsString=[${localsString}], localsNames=[${localsNames}]`);
          desiredDocComment.push(''); // empty line so following is not shown in comments for method
          desiredDocComment.push("' Local Variables:"); // blank line
          for (let localIdx = 0; localIdx < numberLocals; localIdx++) {
            desiredDocComment.push("'" + ` @local ${localsNames[localIdx]} - `); // blank line
          }
        }
      }
    }
    return desiredDocComment;
  }

  // ----------------------------------------------------------------------------
  //   Hook GENERATE Object Public Interface Document
  //
  public generateDocument(): void {
    const textEditor = vscode.window.activeTextEditor;
    if (textEditor) {
      this.endOfLineStr = textEditor.document.eol == EndOfLine.CRLF ? '\r\n' : '\n';
      let bHuntingForVersion: boolean = true; // initially we re hunting for a {Spin2_v##} spec in file-top comments

      const currentlyOpenTabfilePath = textEditor.document.uri.fsPath;
      const currentlyOpenTabfolderName = path.dirname(currentlyOpenTabfilePath);
      const currentlyOpenTabfileName = path.basename(currentlyOpenTabfilePath);
      this.logMessage(`+ (DBG) generateDocument() fsPath-(${currentlyOpenTabfilePath})`);
      this.logMessage(`+ (DBG) generateDocument() folder-(${currentlyOpenTabfolderName})`);
      this.logMessage(`+ (DBG) generateDocument() filename-(${currentlyOpenTabfileName})`);
      let isSpinFile: boolean = isSpin2File(currentlyOpenTabfileName);
      let isSpin1: boolean = false;
      let fileType: string = '.spin2';
      if (!isSpinFile) {
        isSpinFile = isSpin1File(currentlyOpenTabfileName);
        if (isSpinFile) {
          isSpin1 = true;
          fileType = '.spin';
        }
      }
      if (isSpinFile) {
        const objectName: string = currentlyOpenTabfileName.replace(fileType, '');
        const docFilename: string = currentlyOpenTabfileName.replace(fileType, '.txt');
        this.logMessage(`+ (DBG) generateDocument() outFn-(${docFilename})`);
        const outFSpec = path.join(currentlyOpenTabfolderName, docFilename);
        this.logMessage(`+ (DBG) generateDocument() outFSpec-(${outFSpec})`);

        const docFileID = fs.openSync(outFSpec, 'w');

        let shouldEmitTopDocComments: boolean = true;

        let currState: eParseState = eParseState.inCon; // compiler defaults to CON at start!
        let priorState: eParseState = currState;

        let pubsFound: number = 0;

        let requiredLanguageVersion: number = 0;
        //
        // 1st pass: emit topfile doc comments then list of pub methods
        //
        for (let i = 0; i < textEditor.document.lineCount; i++) {
          const line = textEditor.document.lineAt(i);
          const lineNbr = i + 1;
          const trimmedLine = line.text.trim();

          if (bHuntingForVersion && this.spinCodeUtils.containsSpinLanguageSpec(trimmedLine)) {
            bHuntingForVersion = false; // done we found it
            requiredLanguageVersion = this.spinCodeUtils.versionFromSpinLanguageSpec(trimmedLine);
            this.logMessage(`+ (DBG) generateDocument() requiredLanguageVersion=(${requiredLanguageVersion}) at Ln#${lineNbr} [${trimmedLine}]`);
          }

          if (currState == eParseState.inMultiLineDocComment) {
            // skip all {{ --- }} multi-line doc comments
            // in multi-line doc-comment, hunt for end '}}' to exit
            const closingOffset = line.text.indexOf('}}');
            if (closingOffset != -1) {
              // have close, comment ended
              currState = priorState;
              //  if last line has additional text write it!
              if (trimmedLine.length > 2 && shouldEmitTopDocComments) {
                fs.appendFileSync(docFileID, trimmedLine + this.endOfLineStr);
              }
            } else {
              //  if last line has additional text write it!
              if (shouldEmitTopDocComments) {
                fs.appendFileSync(docFileID, trimmedLine + this.endOfLineStr);
              }
            }
            continue;
          } else if (currState == eParseState.inMultiLineComment) {
            // skip all { --- } multi-line non-doc comments
            // in multi-line non-doc-comment, hunt for end '}' to exit
            const openingOffset = line.text.indexOf('{');
            const closingOffset = line.text.indexOf('}');
            if (openingOffset != -1 && closingOffset != -1 && openingOffset < closingOffset) {
              // do nothing with NESTED {cmt} lines
            } else if (closingOffset != -1) {
              // have close, comment ended
              currState = priorState;
            }
            //  DO NOTHING
            continue;
          }

          const sectionStatus = this.spinCodeUtils.isSectionStartLine(line.text);
          if (sectionStatus.isSectionStart) {
            currState = sectionStatus.inProgressStatus;
          }

          if (trimmedLine.startsWith('{{')) {
            // process multi-line doc comment
            const openingOffset = line.text.indexOf('{{');
            const closingOffset = line.text.indexOf('}}', openingOffset + 2);
            if (closingOffset != -1) {
              // is single line comment, just ignore it
            } else {
              // is open of multiline comment
              priorState = currState;
              currState = eParseState.inMultiLineDocComment;
              //  if first line has additional text write it!
              if (trimmedLine.length > 2 && shouldEmitTopDocComments) {
                fs.appendFileSync(docFileID, trimmedLine + this.endOfLineStr);
              }
            }
            continue;
          } else if (trimmedLine.startsWith('{')) {
            // process possible multi-line non-doc comment
            // do we have a close on this same line?
            const openingOffset = line.text.indexOf('{');
            const closingOffset = line.text.indexOf('}', openingOffset + 1);
            if (closingOffset == -1) {
              // is open of multiline comment
              priorState = currState;
              currState = eParseState.inMultiLineComment;
              //  DO NOTHING
            }
            continue;
          } else if (trimmedLine.startsWith("''")) {
            // process single-line doc comment
            if (trimmedLine.length > 2 && shouldEmitTopDocComments) {
              // emit comment without leading ''
              fs.appendFileSync(docFileID, trimmedLine.substring(2) + this.endOfLineStr);
            }
            continue;
          }

          if (sectionStatus.isSectionStart && bHuntingForVersion) {
            this.logMessage(`+ (DBG) generateDocument() STOP HUNT at Ln#${lineNbr} [${trimmedLine}]`);
            bHuntingForVersion = false; // done, we passed the file-top comments. we can no longer search
          }

          if (sectionStatus.isSectionStart && currState == eParseState.inPub) {
            // have public method report it
            pubsFound++;
            if (shouldEmitTopDocComments) {
              this.logMessage(`+ (DBG) generateDocument() EMIT object header`);
              fs.appendFileSync(docFileID, '' + this.endOfLineStr); // blank line
              const introText: string = 'Object "' + objectName + '" Interface:';
              fs.appendFileSync(docFileID, introText + this.endOfLineStr);
              if (requiredLanguageVersion > 0) {
                const lanVersionText: string = `  (Requires Spin2 Language v${requiredLanguageVersion})`;
                fs.appendFileSync(docFileID, lanVersionText + this.endOfLineStr);
              }
              fs.appendFileSync(docFileID, '' + this.endOfLineStr); // blank line
            }
            shouldEmitTopDocComments = false; // no more of these!
            // emit new PUB prototype (w/o any trailing comment)
            const trimmedNonCommentLine = this.getNonCommentLineRemainder(0, trimmedLine);
            fs.appendFileSync(docFileID, trimmedNonCommentLine + this.endOfLineStr);
          }
        }
        //
        // 2nd pass: emit list of pub methods with doc comments for each (if any)
        //
        let pubsSoFar: number = 0;
        let emitPubDocComment: boolean = false;
        let emitTrailingDocComment: boolean = false;
        for (let i = 0; i < textEditor.document.lineCount; i++) {
          const line = textEditor.document.lineAt(i);
          const trimmedLine = line.text.trim();

          // skip all {{ --- }} multi-line doc comments
          if (currState == eParseState.inMultiLineDocComment) {
            // in multi-line doc-comment, hunt for end '}}' to exit
            const closingOffset = line.text.indexOf('}}');
            if (closingOffset != -1) {
              // have close, comment ended
              currState = priorState;
              //  if last line has additional text write it!
              if (trimmedLine.length > 2 && (emitTrailingDocComment || emitPubDocComment)) {
                fs.appendFileSync(docFileID, line.text.substring(2).trimEnd() + this.endOfLineStr);
              }
            } else {
              //  if last line has additional text write it!
              if (emitTrailingDocComment || emitPubDocComment) {
                fs.appendFileSync(docFileID, line.text.trimEnd() + this.endOfLineStr);
              }
            }
            continue;
          } else if (currState == eParseState.inMultiLineComment) {
            // in multi-line non-doc-comment, hunt for end '}' to exit
            const openingOffset = line.text.indexOf('{');
            const closingOffset = line.text.indexOf('}');
            if (openingOffset != -1 && closingOffset != -1 && openingOffset < closingOffset) {
              // do nothing with NESTED {cmt} lines
            } else if (closingOffset != -1) {
              // have close, comment ended
              currState = priorState;
            }
            //  DO NOTHING
            continue;
          }

          const sectionStatus = this.spinCodeUtils.isSectionStartLine(line.text);
          if (sectionStatus.isSectionStart) {
            currState = sectionStatus.inProgressStatus;
          }
          if (trimmedLine.startsWith('{{')) {
            // process multi-line doc comment
            const openingOffset = line.text.indexOf('{{');
            const closingOffset = line.text.indexOf('}}', openingOffset + 2);
            if (closingOffset != -1) {
              // is single line comment, just ignore it
            } else {
              // is open of multiline comment
              priorState = currState;
              currState = eParseState.inMultiLineDocComment;
              //  if first line has additional text write it!
              if (trimmedLine.length > 2 && (emitTrailingDocComment || emitPubDocComment)) {
                fs.appendFileSync(docFileID, line.text.trimEnd() + this.endOfLineStr);
              }
            }
            continue;
          } else if (trimmedLine.startsWith('{')) {
            // process possible multi-line non-doc comment
            // do we have a close on this same line?
            const openingOffset = line.text.indexOf('{');
            const closingOffset = line.text.indexOf('}', openingOffset + 1);
            if (closingOffset == -1) {
              // is open of multiline comment
              priorState = currState;
              currState = eParseState.inMultiLineComment;
              //  DO NOTHING
              continue;
            }
          } else if (trimmedLine.startsWith("''")) {
            // process single-line doc comment
            if (trimmedLine.length > 2 && (emitTrailingDocComment || emitPubDocComment)) {
              // emit comment without leading ''
              fs.appendFileSync(docFileID, trimmedLine.substring(2) + this.endOfLineStr);
            }
          } else if (sectionStatus.isSectionStart && currState == eParseState.inPri) {
            emitPubDocComment = false;
          } else if (sectionStatus.isSectionStart && currState == eParseState.inPub) {
            emitPubDocComment = true;
            pubsSoFar++;
            // emit new PUB prototype (w/o any trailing comment, and NO local variables)
            const trailingDocComment: string | undefined = this.getTrailingDocComment(trimmedLine);
            const trimmedNonCommentLine = this.getNonCommentLineRemainder(0, trimmedLine);
            const header: string = '_'.repeat(trimmedNonCommentLine.length);
            fs.appendFileSync(docFileID, '' + this.endOfLineStr); // blank line
            fs.appendFileSync(docFileID, header + this.endOfLineStr); // underscore header line
            fs.appendFileSync(docFileID, trimmedNonCommentLine + this.endOfLineStr);
            fs.appendFileSync(docFileID, '' + this.endOfLineStr); // blank line
            if (trailingDocComment) {
              fs.appendFileSync(docFileID, trailingDocComment + this.endOfLineStr); // underscore header line
            }
            if (pubsSoFar >= pubsFound) {
              emitTrailingDocComment = true;
              emitPubDocComment = false;
            }
          } else if (sectionStatus.isSectionStart && currState != eParseState.inPub && emitTrailingDocComment) {
            // emit blank line just before we do final doc comment at end of file
            fs.appendFileSync(docFileID, '' + this.endOfLineStr); // blank line
          }
        }
        fs.closeSync(docFileID);
      } else {
        this.logMessage(`+ (DBG) generateDocument() NOT a spin file! can't generate doc.`);
      }
    } else {
      this.logMessage(`+ (DBG) generateDocument() NO active editor.`);
    }
  }

  private getNonCommentLineRemainder(offset: number, line: string): string {
    // remove comment and then local variables
    let trimmedNonCommentLine = this.spinCodeUtils.getNonCommentLineRemainder(offset, line);
    const localSepPosn: number = trimmedNonCommentLine.indexOf('|');
    if (localSepPosn != -1) {
      trimmedNonCommentLine = trimmedNonCommentLine.substring(0, localSepPosn - 1).replace(/\s+$/, '');
    }
    return trimmedNonCommentLine;
  }

  private getTrailingDocComment(line: string): string | undefined {
    // return any trailing doc comment from PUB line
    let docComment: string | undefined = undefined;
    const startDocTicCmt: number = line.indexOf("''");
    const startDocBraceCmt: number = line.indexOf('{{');
    const endDocBraceCmt: number = line.indexOf('}}');
    if (startDocTicCmt != -1) {
      docComment = line.substring(startDocTicCmt + 2).trim();
    } else if (startDocBraceCmt != -1 && endDocBraceCmt != -1) {
      docComment = line.substring(startDocBraceCmt + 2, endDocBraceCmt - 1).trim();
    }
    return docComment;
  }

  public async showDocument(reportFileType: string) {
    const textEditor = vscode.window.activeTextEditor;
    if (textEditor) {
      const currentlyOpenTabfilePath = textEditor.document.uri.fsPath;
      const currentlyOpenTabfolderName = path.dirname(currentlyOpenTabfilePath);
      const currentlyOpenTabfileName = path.basename(currentlyOpenTabfilePath);
      //this.logMessage(`+ (DBG) generateDocument() fsPath-(${currentlyOpenTabfilePath})`);
      //this.logMessage(`+ (DBG) generateDocument() folder-(${currentlyOpenTabfolderName})`);
      //this.logMessage(`+ (DBG) generateDocument() filename-(${currentlyOpenTabfileName})`);
      let isSpinFile: boolean = isSpin2File(currentlyOpenTabfileName);
      let isSpin1: boolean = false;
      let fileType: string = '.spin2';
      if (!isSpinFile) {
        isSpinFile = isSpin1File(currentlyOpenTabfileName);
        if (isSpinFile) {
          isSpin1 = true;
          fileType = '.spin';
        }
      }
      if (isSpinFile) {
        const docFilename: string = currentlyOpenTabfileName.replace(fileType, reportFileType);
        //this.logMessage(`+ (DBG) generateDocument() outFn-(${docFilename})`);
        const outFSpec = path.join(currentlyOpenTabfolderName, docFilename);
        //this.logMessage(`+ (DBG) generateDocument() outFSpec-(${outFSpec})`);
        const doc = await vscode.workspace.openTextDocument(outFSpec); // calls back into the provider
        await vscode.window.showTextDocument(doc, {
          preview: false,
          viewColumn: vscode.ViewColumn.Beside
        });
      }
    }
  }

  // ----------------------------------------------------------------------------
  //   Hook GENERATE Object Hierarchy Document
  //
  public generateHierarchyDocument(): void {
    const textEditor = vscode.window.activeTextEditor;
    if (textEditor) {
      this.endOfLineStr = textEditor.document.eol == EndOfLine.CRLF ? '\r\n' : '\n';
      const bHuntingForVersion: boolean = true; // initially we re hunting for a {Spin2_v##} spec in file-top comments

      const currentlyOpenTabfilePath = textEditor.document.uri.fsPath;
      const currentlyOpenTabfolderName = path.dirname(currentlyOpenTabfilePath);
      const currentlyOpenTabfileName = path.basename(currentlyOpenTabfilePath);
      this.logMessage(`+ (DBG) generateHierarchyDocument() fsPath-(${currentlyOpenTabfilePath})`);
      this.logMessage(`+ (DBG) generateHierarchyDocument() folder-(${currentlyOpenTabfolderName})`);
      this.logMessage(`+ (DBG) generateHierarchyDocument() filename-(${currentlyOpenTabfileName})`);
      let isSpinFile: boolean = isSpin2File(currentlyOpenTabfileName);
      let isSpin1: boolean = false;
      let fileType: string = '.spin2';
      if (!isSpinFile) {
        isSpinFile = isSpin1File(currentlyOpenTabfileName);
        if (isSpinFile) {
          isSpin1 = true;
          fileType = '.spin';
        }
      }
      if (isSpinFile) {
        const objectName: string = currentlyOpenTabfileName.replace(fileType, '');
        const docFilename: string = currentlyOpenTabfileName.replace(fileType, '.readme.txt');
        this.logMessage(`+ (DBG) generateHierarchyDocument() outFn-(${docFilename})`);
        const outFSpec = path.join(currentlyOpenTabfolderName, docFilename);
        this.logMessage(`+ (DBG) generateHierarchyDocument() outFSpec-(${outFSpec})`);

        const docFileID = fs.openSync(outFSpec, 'w');

        const rptHoriz: string = '─';

        // add generation here

        // write report title
        const rptTitle: string = 'Parallax Propeller Chip Object Hierarchy';
        fs.appendFileSync(docFileID, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        fs.appendFileSync(docFileID, `${rptTitle}${this.endOfLineStr}`); // blank line
        fs.appendFileSync(docFileID, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        fs.appendFileSync(docFileID, `${this.endOfLineStr}`); // blank line
        fs.appendFileSync(docFileID, ` Project :  "${objectName}"${this.endOfLineStr}${this.endOfLineStr}`);
        fs.appendFileSync(docFileID, `Reported :  ${this.reportDateString()}${this.endOfLineStr}${this.endOfLineStr}`);
        const versionStr: string = this.extensionVersionString();
        fs.appendFileSync(docFileID, `    Tool :  VSCode Spin2 Extension ${versionStr} ${this.endOfLineStr}${this.endOfLineStr}`);
        fs.appendFileSync(docFileID, `${this.endOfLineStr}`); // blank line

        // Get object tree from ObjectTreeProvider (may have to add supporting code therein)
        // then report on object tree obtained
        const [topFilename, depMap] = this.objTreeProvider.getObjectHierarchy();
        this.hierarchyFilenameTotal = this.countFiles(topFilename, depMap);
        this.hierarchyFilenameCount = 0;
        if (topFilename.length == 0 || depMap.size == 0) {
          fs.appendFileSync(docFileID, `NO Dependencies found!${this.endOfLineStr}`); // blank line
        } else {
          this.logMessage(`+ (DBG) generateHierarchyDocument() topFilename=[${topFilename}], deps=(${depMap.size})`);
          const depth: number = 0;
          const topChildren = depMap.get(topFilename);
          const lastParent: boolean = this.isOnlyParent(topFilename, depMap);
          const lastChild = false;
          this.reportDeps(depth, [], topFilename, depMap, docFileID, lastParent, lastChild);
        }
        fs.appendFileSync(docFileID, `${this.endOfLineStr}`); // blank line
        fs.appendFileSync(docFileID, `${this.endOfLineStr}`); // blank line
        fs.appendFileSync(docFileID, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        fs.appendFileSync(docFileID, `Parallax Inc.${this.endOfLineStr}`);
        fs.appendFileSync(docFileID, `www.parallax.com${this.endOfLineStr}`);
        fs.appendFileSync(docFileID, `support@parallax.com${this.endOfLineStr}${this.endOfLineStr}`);
        fs.appendFileSync(docFileID, `VSCode Spin2 Extension by:${this.endOfLineStr}`);
        fs.appendFileSync(docFileID, ` Iron Sheep Productions, LLC${this.endOfLineStr}`);
        fs.closeSync(docFileID);
      } else {
        this.logMessage(`+ (DBG) generateHierarchyDocument() NOT a spin file! can't generate doc.`);
      }
    } else {
      this.logMessage(`+ (DBG) generateHierarchyDocument() NO active editor.`);
    }
  }

  private countFiles(topFilename: string, deps: Map<string, SpinDependency>): number {
    let desiredFileCount: number = topFilename && topFilename.length > 0 ? 1 : 0;
    const topDep: SpinDependency | undefined = deps.get(topFilename);
    if (topDep !== undefined) {
      desiredFileCount += topDep.children.length;
      let currChildren: string[] = topDep.children.map((child) => child.name);
      while (currChildren.length > 0) {
        const childrenThisPass: string[] = currChildren;
        currChildren = [];
        for (let index = 0; index < childrenThisPass.length; index++) {
          const childName = childrenThisPass[index];
          const childDep: SpinDependency | undefined = deps.get(childName);
          if (childDep.hasChildren) {
            desiredFileCount += childDep.children.length;
            const grandChildrenName: string[] = childDep.children.map((grandChild) => grandChild.name);
            currChildren.push(...grandChildrenName);
          }
        }
      }
    }
    this.logMessage(`* countFiles() desiredFileCount=(${desiredFileCount})`);
    return desiredFileCount;
  }

  private isOnlyParent(topFilename: string, depMap: Map<string, SpinDependency>): boolean {
    let onlyParentStatus: boolean = true;
    if (depMap.has(topFilename)) {
      const fileWithchildren: SpinDependency = depMap.get(topFilename);
      if (fileWithchildren !== undefined) {
        this.logMessage(`* isOnlyParent() childrenCt=[${fileWithchildren.children.length}]`);
        for (let index = 0; index < fileWithchildren.children.length; index++) {
          const child = fileWithchildren.children[index];
          const grandChildWithChildren = depMap.get(child.name);
          if (grandChildWithChildren !== undefined && grandChildWithChildren.children.length > 0) {
            this.logMessage(`* isOnlyParent() [${child.name}] grandChildren=[${grandChildWithChildren.children.length}]`);
            onlyParentStatus = false;
            break;
          }
        }
      }
    }
    this.logMessage(`* isOnlyParent()=(${onlyParentStatus})`);
    return onlyParentStatus;
  }

  private reportDeps(
    depth: number,
    nestList: boolean[],
    filename: string,
    depMap: Map<string, SpinDependency>,
    fileID: number,
    isLastParent: boolean,
    isLastChild: boolean
  ) {
    this.logMessage(`+ rD() d=(${depth}), nd=[${nestList}], ilp=(${isLastParent}), ilc=(${isLastChild}), fn=[${filename}]`);
    const baseIndent: number = 12;
    const rptHoriz: string = '─';
    const rptVert: string = '│';
    const rptTeeRight: string = '├';
    const rptElbow: string = '└';
    const childWithChildren: SpinDependency | undefined = depMap.get(filename);
    const haveChildren: boolean = childWithChildren !== undefined && childWithChildren.children.length > 0;
    const NoEndBlank: boolean = true;
    const AllowEndBlank: boolean = false;
    // file line prefix
    const fileEndChar: string = isLastChild ? rptElbow : rptTeeRight;
    const prefixFillTee: string = this.fillWithVerts(nestList, fileEndChar, NoEndBlank);
    let linePrefixFile: string = ' '.repeat(baseIndent - 2);
    if (depth == 0) {
      linePrefixFile = `${linePrefixFile}  `;
    } else {
      linePrefixFile = `${linePrefixFile}${prefixFillTee}${rptHoriz}${rptHoriz}`;
    }
    // blank line prefix
    if (nestList.length > 1) {
      nestList[depth - 1] = isLastChild ? false : true;
    }
    const vertNestList: boolean[] = haveChildren ? [...nestList, true] : nestList; // create copy and add true if children
    const specialEndBlanking: boolean = isLastChild && !haveChildren ? false : NoEndBlank;
    const prefixFillVert: string = this.fillWithVerts(vertNestList, rptVert, specialEndBlanking);
    let linePrefixSpacer: string = ' '.repeat(baseIndent - 2);
    if (depth == 0) {
      linePrefixSpacer = ' '.repeat(baseIndent - 2) + this.fillWithVerts([true], rptVert, NoEndBlank);
    } else {
      linePrefixSpacer = `${linePrefixSpacer}${prefixFillVert}`;
    }
    // write one or both lines
    fs.appendFileSync(fileID, `${linePrefixFile}${filename}${this.endOfLineStr}`); // filename line
    this.hierarchyFilenameCount++;
    // show last line of not last line to be drawn in chart
    //  last line is when we are both at last parent and last child
    const showLastBlankLine: boolean = this.hierarchyFilenameCount < this.hierarchyFilenameTotal;
    this.logMessage(
      `+ rD() showLastBlankLine=(${showLastBlankLine}), count=(${this.hierarchyFilenameCount}), total=(${this.hierarchyFilenameTotal})`
    );
    if (showLastBlankLine) {
      fs.appendFileSync(fileID, `${linePrefixSpacer}${this.endOfLineStr}`); // blank line
    }
    // process children of this object
    if (haveChildren) {
      for (let index = 0; index < childWithChildren.children.length; index++) {
        const childDep = childWithChildren.children[index];
        const isLastChild: boolean = index == childWithChildren.children.length - 1;

        const nextIsLastParent = depth == 0 && isLastChild ? true : isLastParent;
        nestList.push(nextIsLastParent ? false : true);
        this.reportDeps(depth + 1, nestList, childDep.name, depMap, fileID, nextIsLastParent, isLastChild);
      }
    }
    if (nestList.length > 0) {
      nestList.pop();
    }
  }

  private fillWithVerts(nestList: boolean[], lastVert: string, noEndBlank: boolean): string {
    const rptVert: string = '│';
    const isBlankLineGen: boolean = lastVert == rptVert;
    let prefixFill: string = '';
    if (nestList.length > 0) {
      //this.logMessage(`+ fwV() nestList=[${nestList}], lastVert=(${lastVert})`);
      for (let index = 0; index < nestList.length; index++) {
        const isLastChild = index == nestList.length - 1;
        let showSymbol = nestList[index];
        if (isBlankLineGen) {
          if (isLastChild && !noEndBlank && nestList.length > 2) {
            showSymbol = false;
          }
        } else {
          showSymbol = isLastChild ? true : showSymbol;
        }

        const vertSym: string = isLastChild ? lastVert : rptVert;
        const fillSegment = showSymbol ? `    ${vertSym}` : `     `;
        prefixFill = `${prefixFill}${fillSegment}`;
      }
    }
    this.logMessage(`+ fwV()=[${prefixFill}], nestList=[${nestList}], lastVert=(${lastVert}), noEndBlank=(${noEndBlank})`);
    return prefixFill;
  }

  private extensionVersionString(): string {
    // return the version string of this extension
    const extension = vscode.extensions.getExtension('IronSheepProductionsLLC.spin2');
    let version: string = extension?.packageJSON.version;
    if (version === undefined) {
      version = '?.?.?';
    }
    return `v${version}`; // the version of the extension
  }

  private reportDateString(): string {
    const date = new Date();
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: true
    };

    const formattedDate = new Intl.DateTimeFormat('en-US', options).format(date);
    return formattedDate; // Prints: "Saturday, January 13, 2024 at 6:50:29 PM"
  }

  /**
   * write message to formatting log (when log enabled)
   *
   * @param the message to be written
   * @returns nothing
   */
  public logMessage(message: string): void {
    if (this.isDebugLogEnabled && this.debugOutputChannel !== undefined) {
      //Write to output window.
      this.debugOutputChannel.appendLine(message);
    }
  }
}
