"use strict";

import * as vscode from "vscode";
import { EndOfLine } from "vscode";

import * as fs from "fs";
import * as path from "path";

import { isSpin1Document, isSpin2File, isSpin1File } from "../spin.vscode.utils";
import { SpinCodeUtils, eParseState } from "../spin.code.utils";

export class DocGenerator {
  private generatorDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private docGenOutputChannel: vscode.OutputChannel | undefined = undefined;
  private spinCodeUtils: SpinCodeUtils = new SpinCodeUtils();

  constructor() {
    if (this.generatorDebugLogEnabled) {
      if (this.docGenOutputChannel === undefined) {
        //Create output channel
        this.docGenOutputChannel = vscode.window.createOutputChannel("Spin/Spin2 DocGen DEBUG");
        this.logMessage("Spin/Spin2 DocGen log started.");
      } else {
        this.logMessage("\n\n------------------   NEW FILE ----------------\n\n");
      }
    }
  }

  /**
   * write message to formatting log (when log enabled)
   *
   * @param the message to be written
   * @returns nothing
   */
  public logMessage(message: string): void {
    if (this.generatorDebugLogEnabled && this.docGenOutputChannel != undefined) {
      //Write to output window.
      this.docGenOutputChannel.appendLine(message);
    }
  }

  public insertDocComment(document: vscode.TextDocument, selections: readonly vscode.Selection[]): vscode.ProviderResult<vscode.TextEdit[]> {
    return selections
      .map((selection) => {
        let results: vscode.ProviderResult<vscode.TextEdit[]> = [];
        let endOfLineStr: string = document.eol == EndOfLine.CRLF ? "\r\n" : "\n";
        const isSpin1Doc: boolean = isSpin1Document(document);
        this.logMessage(
          `* iDc selection(isSingle-[${selection.isSingleLine}] isSpin1Doc-(${isSpin1Doc}) isEmpty-[${selection.isEmpty}] s,e-[${selection.start.line}:${selection.start.character} - ${selection.end.line}:${selection.end.character}] activ-[${selection.active.character}] anchor-[${selection.anchor.character}])`
        );
        const { firstLine, lastLine, lineCount } = this._lineNumbersFromSelection(document, selection);
        const cursorPos: vscode.Position = new vscode.Position(firstLine + 1, 0);
        let linesToInsert: string[] = [];
        let signatureLine: string = document.lineAt(firstLine).text.trim();
        const linePrefix = signatureLine.length > 3 ? signatureLine.substring(0, 3).toLowerCase() : "";
        const isSignature: boolean = linePrefix.startsWith("pub") || linePrefix.startsWith("pri");
        if (isSignature) {
          linesToInsert = this.generateDocCommentForSignature(signatureLine, isSpin1Doc);
        } else {
          this.logMessage(`* iDc SKIP - NOT on signature line`);
        }

        // insert the lines, if any
        if (linesToInsert.length > 0) {
          for (let line of linesToInsert) {
            results.push(vscode.TextEdit.insert(cursorPos, `${line}` + endOfLineStr));
          }
        }
        return results;
      })
      .reduce((selections, selection) => selections.concat(selection), []);
  }

  private _lineNumbersFromSelection(document: vscode.TextDocument, selection: vscode.Selection): { firstLine: number; lastLine: number; lineCount: number } {
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
      for (var currLineIdx: number = 0; currLineIdx < lines.length; currLineIdx++) {
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
    let desiredDocComment: string[] = [];
    this.logMessage(`* iDc SKIP - generateDocCommentForSignature([${signatureLine}], isSpin1=${isSpin1Method})`);
    const linePrefix = signatureLine.length > 3 ? signatureLine.substring(0, 3).toLowerCase() : "";
    const isSignature: boolean = linePrefix.startsWith("pub") || linePrefix.startsWith("pri");
    const isPRI: boolean = linePrefix.startsWith("pri");
    if (isSignature) {
      const commentPrefix = isPRI ? "'" : "''";
      desiredDocComment.push(commentPrefix + " ..."); // for description
      desiredDocComment.push(commentPrefix + " "); // blank line
      const posOpenParen = signatureLine.indexOf("(");
      const posCloseParen = signatureLine.indexOf(")");
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
        const bHasReturnValues: boolean = signatureLine.includes(":") ? true : false;
        const bHasLocalVariables: boolean = signatureLine.includes("|") ? true : false;
        if (bHasReturnValues) {
          const posStartReturn = signatureLine.indexOf(":") + 1;
          const posEndReturn = bHasLocalVariables ? signatureLine.indexOf("|") - 1 : signatureLine.length;
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
          posTrailingComment = signatureLine.indexOf("{");
        }
        if (bHasLocalVariables) {
          // locals are always non-doc single-line comments
          const posStartLocal = signatureLine.indexOf("|") + 1;
          const posEndLocal = posTrailingComment != -1 ? posTrailingComment : signatureLine.length;
          const localsString: string = signatureLine.substring(posStartLocal, posEndLocal);
          const numberLocals: number = (localsString.match(/,/g) || []).length + 1;
          const localsNames = localsString.split(/[ \t,]/).filter(Boolean);
          this.logMessage(`* gDClocalsString=[${localsString}], localsNames=[${localsNames}]`);
          desiredDocComment.push(""); // empty line so following is not shown in comments for method
          desiredDocComment.push("' Local Variables:"); // blank line
          for (let localIdx = 0; localIdx < numberLocals; localIdx++) {
            desiredDocComment.push("'" + ` @local ${localsNames[localIdx]} - `); // blank line
          }
        }
      } else if (isSpin1Method) {
        // spin1 methods don't need parens when no parameters are specified
        const bHasReturnValues: boolean = signatureLine.includes(":") ? true : false;
        const bHasLocalVariables: boolean = signatureLine.includes("|") ? true : false;
        if (bHasReturnValues) {
          const posStartReturn = signatureLine.indexOf(":") + 1;
          const posEndReturn = bHasLocalVariables ? signatureLine.indexOf("|") - 1 : signatureLine.length;
          const returnsString: string = signatureLine.substring(posStartReturn, posEndReturn);
          // spin1 only allows 1 return variable
          const returnNames = returnsString.split(/[ \t,]/).filter(Boolean);
          this.logMessage(`* gDCreturnsString=[${returnsString}], returnNames=[${returnNames}]`);
          desiredDocComment.push(commentPrefix + ` @returns ${returnNames[0]} - `); // blank line
        }
        let posTrailingComment = signatureLine.indexOf("'");
        if (posTrailingComment == -1) {
          posTrailingComment = signatureLine.indexOf("{");
        }
        if (bHasLocalVariables) {
          // locals are always non-doc single-line comments
          const posStartLocal = signatureLine.indexOf("|") + 1;
          const posEndLocal = posTrailingComment != -1 ? posTrailingComment : signatureLine.length;
          const localsString: string = signatureLine.substring(posStartLocal, posEndLocal);
          const numberLocals: number = (localsString.match(/,/g) || []).length + 1;
          const localsNames = localsString.split(/[ \t,]/).filter(Boolean);
          this.logMessage(`* gDClocalsString=[${localsString}], localsNames=[${localsNames}]`);
          desiredDocComment.push(""); // empty line so following is not shown in comments for method
          desiredDocComment.push("' Local Variables:"); // blank line
          for (let localIdx = 0; localIdx < numberLocals; localIdx++) {
            desiredDocComment.push("'" + ` @local ${localsNames[localIdx]} - `); // blank line
          }
        }
      }
    }
    return desiredDocComment;
  }

  public generateDocument(): void {
    let textEditor = vscode.window.activeTextEditor;
    if (textEditor) {
      let endOfLineStr: string = textEditor.document.eol == EndOfLine.CRLF ? "\r\n" : "\n";

      var currentlyOpenTabfilePath = textEditor.document.uri.fsPath;
      var currentlyOpenTabfolderName = path.dirname(currentlyOpenTabfilePath);
      var currentlyOpenTabfileName = path.basename(currentlyOpenTabfilePath);
      this.logMessage(`+ (DBG) generateDocument() fsPath-(${currentlyOpenTabfilePath})`);
      this.logMessage(`+ (DBG) generateDocument() folder-(${currentlyOpenTabfolderName})`);
      this.logMessage(`+ (DBG) generateDocument() filename-(${currentlyOpenTabfileName})`);
      let isSpinFile: boolean = isSpin2File(currentlyOpenTabfileName);
      let isSpin1: boolean = false;
      let fileType: string = ".spin2";
      if (!isSpinFile) {
        isSpinFile = isSpin1File(currentlyOpenTabfileName);
        if (isSpinFile) {
          isSpin1 = true;
          fileType = ".spin";
        }
      }
      if (isSpinFile) {
        const objectName: string = currentlyOpenTabfileName.replace(fileType, "");
        const docFilename: string = currentlyOpenTabfileName.replace(fileType, ".txt");
        this.logMessage(`+ (DBG) generateDocument() outFn-(${docFilename})`);
        const outFSpec = path.join(currentlyOpenTabfolderName, docFilename);
        this.logMessage(`+ (DBG) generateDocument() outFSpec-(${outFSpec})`);

        let outFile = fs.openSync(outFSpec, "w");

        let shouldEmitTopDocComments: boolean = true;

        let currState: eParseState = eParseState.inCon; // compiler defaults to CON at start!
        let priorState: eParseState = currState;

        let pubsFound: number = 0;
        //
        // 1st pass: emit topfile doc comments then list of pub methods
        //
        for (let i = 0; i < textEditor.document.lineCount; i++) {
          let line = textEditor.document.lineAt(i);
          const trimmedLine = line.text.trim();

          // skip all {{ --- }} multi-line doc comments
          if (currState == eParseState.inMultiLineDocComment) {
            // in multi-line doc-comment, hunt for end '}}' to exit
            let closingOffset = line.text.indexOf("}}");
            if (closingOffset != -1) {
              // have close, comment ended
              currState = priorState;
              //  if last line has additional text write it!
              if (trimmedLine.length > 2 && shouldEmitTopDocComments) {
                fs.appendFileSync(outFile, trimmedLine + endOfLineStr);
              }
            } else {
              //  if last line has additional text write it!
              if (shouldEmitTopDocComments) {
                fs.appendFileSync(outFile, trimmedLine + endOfLineStr);
              }
            }
            continue;
          } else if (currState == eParseState.inMultiLineComment) {
            // skip all { --- } multi-line non-doc comments
            // in multi-line non-doc-comment, hunt for end '}' to exit
            let closingOffset = trimmedLine.indexOf("}");
            if (closingOffset != -1) {
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

          if (trimmedLine.startsWith("{{")) {
            // process multi-line doc comment
            let openingOffset = line.text.indexOf("{{");
            const closingOffset = line.text.indexOf("}}", openingOffset + 2);
            if (closingOffset != -1) {
              // is single line comment, just ignore it
            } else {
              // is open of multiline comment
              priorState = currState;
              currState = eParseState.inMultiLineDocComment;
              //  if first line has additional text write it!
              if (trimmedLine.length > 2 && shouldEmitTopDocComments) {
                fs.appendFileSync(outFile, trimmedLine + endOfLineStr);
              }
            }
            continue;
          } else if (trimmedLine.startsWith("{")) {
            // process possible multi-line non-doc comment
            // do we have a close on this same line?
            let openingOffset = trimmedLine.indexOf("{");
            const closingOffset = trimmedLine.indexOf("}", openingOffset + 1);
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
              fs.appendFileSync(outFile, trimmedLine.substring(2) + endOfLineStr);
            }
          } else if (sectionStatus.isSectionStart && currState == eParseState.inPub) {
            // have public method report it
            pubsFound++;
            if (shouldEmitTopDocComments) {
              fs.appendFileSync(outFile, "" + endOfLineStr); // blank line
              const introText: string = 'Object "' + objectName + '" Interface:';
              fs.appendFileSync(outFile, introText + endOfLineStr);
              fs.appendFileSync(outFile, "" + endOfLineStr); // blank line
            }
            shouldEmitTopDocComments = false; // no more of these!
            // emit new PUB prototype (w/o any trailing comment)
            const trimmedNonCommentLine = this.getNonCommentLineRemainder(0, trimmedLine);
            fs.appendFileSync(outFile, trimmedNonCommentLine + endOfLineStr);
          }
        }
        //
        // 2nd pass: emit list of pub methods with doc comments for each (if any)
        //
        let pubsSoFar: number = 0;
        let emitPubDocComment: boolean = false;
        let emitTrailingDocComment: boolean = false;
        for (let i = 0; i < textEditor.document.lineCount; i++) {
          let line = textEditor.document.lineAt(i);
          const trimmedLine = line.text.trim();

          // skip all {{ --- }} multi-line doc comments
          if (currState == eParseState.inMultiLineDocComment) {
            // in multi-line doc-comment, hunt for end '}}' to exit
            let closingOffset = line.text.indexOf("}}");
            if (closingOffset != -1) {
              // have close, comment ended
              currState = priorState;
              //  if last line has additional text write it!
              if (trimmedLine.length > 2 && (emitTrailingDocComment || emitPubDocComment)) {
                fs.appendFileSync(outFile, line.text.substring(2).trimEnd() + endOfLineStr);
              }
            } else {
              //  if last line has additional text write it!
              if (emitTrailingDocComment || emitPubDocComment) {
                fs.appendFileSync(outFile, line.text.trimEnd() + endOfLineStr);
              }
            }
            continue;
          } else if (currState == eParseState.inMultiLineComment) {
            // in multi-line non-doc-comment, hunt for end '}' to exit
            let closingOffset = trimmedLine.indexOf("}");
            if (closingOffset != -1) {
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
          if (trimmedLine.startsWith("{{")) {
            // process multi-line doc comment
            let openingOffset = line.text.indexOf("{{");
            const closingOffset = line.text.indexOf("}}", openingOffset + 2);
            if (closingOffset != -1) {
              // is single line comment, just ignore it
            } else {
              // is open of multiline comment
              priorState = currState;
              currState = eParseState.inMultiLineDocComment;
              //  if first line has additional text write it!
              if (trimmedLine.length > 2 && (emitTrailingDocComment || emitPubDocComment)) {
                fs.appendFileSync(outFile, line.text.trimEnd() + endOfLineStr);
              }
            }
            continue;
          } else if (trimmedLine.startsWith("{")) {
            // process possible multi-line non-doc comment
            // do we have a close on this same line?
            let openingOffset = trimmedLine.indexOf("{");
            const closingOffset = trimmedLine.indexOf("}", openingOffset + 1);
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
              fs.appendFileSync(outFile, trimmedLine.substring(2) + endOfLineStr);
            }
          } else if (sectionStatus.isSectionStart && currState == eParseState.inPri) {
            emitPubDocComment = false;
          } else if (sectionStatus.isSectionStart && currState == eParseState.inPub) {
            emitPubDocComment = true;
            pubsSoFar++;
            // emit new PUB prototype (w/o any trailing comment, and NO local variables)
            const trailingDocComment: string | undefined = this.getTrailingDocComment(trimmedLine);
            let trimmedNonCommentLine = this.getNonCommentLineRemainder(0, trimmedLine);
            const header: string = "_".repeat(trimmedNonCommentLine.length);
            fs.appendFileSync(outFile, "" + endOfLineStr); // blank line
            fs.appendFileSync(outFile, header + endOfLineStr); // underscore header line
            fs.appendFileSync(outFile, trimmedNonCommentLine + endOfLineStr);
            fs.appendFileSync(outFile, "" + endOfLineStr); // blank line
            if (trailingDocComment) {
              fs.appendFileSync(outFile, trailingDocComment + endOfLineStr); // underscore header line
            }
            if (pubsSoFar >= pubsFound) {
              emitTrailingDocComment = true;
              emitPubDocComment = false;
            }
          } else if (sectionStatus.isSectionStart && currState != eParseState.inPub && emitTrailingDocComment) {
            // emit blank line just before we do final doc comment at end of file
            fs.appendFileSync(outFile, "" + endOfLineStr); // blank line
          }
        }
        fs.closeSync(outFile);
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
    const localSepPosn: number = trimmedNonCommentLine.indexOf("|");
    if (localSepPosn != -1) {
      trimmedNonCommentLine = trimmedNonCommentLine.substring(0, localSepPosn - 1).replace(/\s+$/, "");
    }
    return trimmedNonCommentLine;
  }

  private getTrailingDocComment(line: string): string | undefined {
    // return any trailing doc comment from PUB line
    let docComment: string | undefined = undefined;
    const startDocTicCmt: number = line.indexOf("''");
    const startDocBraceCmt: number = line.indexOf("{{");
    const endDocBraceCmt: number = line.indexOf("}}");
    if (startDocTicCmt != -1) {
      docComment = line.substring(startDocTicCmt + 2).trim();
    } else if (startDocBraceCmt != -1 && endDocBraceCmt != -1) {
      docComment = line.substring(startDocBraceCmt + 2, endDocBraceCmt - 1).trim();
    }
    return docComment;
  }

  async showDocument() {
    let textEditor = vscode.window.activeTextEditor;
    if (textEditor) {
      var currentlyOpenTabfilePath = textEditor.document.uri.fsPath;
      var currentlyOpenTabfolderName = path.dirname(currentlyOpenTabfilePath);
      var currentlyOpenTabfileName = path.basename(currentlyOpenTabfilePath);
      //this.logMessage(`+ (DBG) generateDocument() fsPath-(${currentlyOpenTabfilePath})`);
      //this.logMessage(`+ (DBG) generateDocument() folder-(${currentlyOpenTabfolderName})`);
      //this.logMessage(`+ (DBG) generateDocument() filename-(${currentlyOpenTabfileName})`);
      let isSpinFile: boolean = isSpin2File(currentlyOpenTabfileName);
      let isSpin1: boolean = false;
      let fileType: string = ".spin2";
      if (!isSpinFile) {
        isSpinFile = isSpin1File(currentlyOpenTabfileName);
        if (isSpinFile) {
          isSpin1 = true;
          fileType = ".spin";
        }
      }
      if (isSpinFile) {
        const docFilename: string = currentlyOpenTabfileName.replace(fileType, ".txt");
        //this.logMessage(`+ (DBG) generateDocument() outFn-(${docFilename})`);
        const outFSpec = path.join(currentlyOpenTabfolderName, docFilename);
        //this.logMessage(`+ (DBG) generateDocument() outFSpec-(${outFSpec})`);
        let doc = await vscode.workspace.openTextDocument(outFSpec); // calls back into the provider
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
      }
    }
  }
}
