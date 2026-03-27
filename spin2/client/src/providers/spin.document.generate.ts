/* eslint-disable @typescript-eslint/no-unused-vars */
'use strict';

import * as vscode from 'vscode';
import { EndOfLine } from 'vscode';

import * as fs from 'fs';
import * as path from 'path';
import AdmZip = require('adm-zip');

import { isSpin1Document, isSpin2File, isSpin1File } from '../spin.vscode.utils';
import { SpinCodeUtils, eParseState } from '../spin.code.utils';
import { ObjectTreeProvider, IObjectDependencyNode } from '../spin.object.dependencies';

// --- Interfaces for documented CON block content ---

interface IDocConstant {
  name: string;
  value: string; // raw RHS text: "0", "-1", "$0C", "decod 1"
  trailingComment: string; // from ' comment on same line
  docComment: string[]; // from preceding '' lines
}

interface IDocStructMember {
  type: string; // "BYTE", "WORD", "LONG", or struct name
  name: string;
  arraySize: number; // 0 means not an array
}

interface IDocStructure {
  name: string;
  signature: string; // full STRUCT declaration text
  members: IDocStructMember[];
  sizeBytes: number;
  docComment: string[]; // from preceding '' lines
}

interface IDocConSection {
  heading: string; // from CON line comment
  constants: IDocConstant[];
  structures: IDocStructure[];
}

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

        const outFile = fs.openSync(outFSpec, 'w');

        let shouldEmitTopDocComments: boolean = true;

        let currState: eParseState = eParseState.inCon; // compiler defaults to CON at start!
        let priorState: eParseState = currState;

        let pubsFound: number = 0;
        const pubSignatures: string[] = [];

        let requiredLanguageVersion: number = 0;

        // --- CON documentation collection state ---
        const docConSections: IDocConSection[] = [];
        let currentDocConSection: IDocConSection | undefined = undefined;
        let inConBlock: boolean = true; // compiler defaults to CON at start
        let conBlockPreamble: boolean = true; // scanning preamble of current CON block
        let conBlockIsDocumented: boolean = false;
        let currentConHeading: string = '';
        let pendingDocComment: string[] = [];

        // --- Preprocessor state tracking ---
        const definedSymbols: Set<string> = new Set();
        const referencedSymbols: Set<string> = new Set();
        const preProcDisabledStack: boolean[] = [];
        let preProcLinesDisabled: boolean = false;

        // --- Structure size lookup (for nested structs) ---
        const structSizeMap: Map<string, number> = new Map();

        // --- Enum tracking ---
        let enumValue: number = 0;
        let enumStep: number = 1;
        let enumInProgress: boolean = false;

        //
        // 1st pass: collect top doc comments, PUB signatures, and documented CON block content
        //
        const topDocLines: string[] = [];

        for (let i = 0; i < textEditor.document.lineCount; i++) {
          const line = textEditor.document.lineAt(i);
          const lineNbr = i + 1;
          const trimmedLine = line.text.trim();

          if (bHuntingForVersion && this.spinCodeUtils.containsSpinLanguageSpec(trimmedLine)) {
            bHuntingForVersion = false; // done we found it
            requiredLanguageVersion = this.spinCodeUtils.versionFromSpinLanguageSpec(trimmedLine);
            this.logMessage(`+ (DBG) generateDocument() requiredLanguageVersion=(${requiredLanguageVersion}) at Ln#${lineNbr} [${trimmedLine}]`);
          }

          // --- Handle multi-line comment states ---
          if (currState == eParseState.inMultiLineDocComment) {
            const closingOffset = line.text.indexOf('}}');
            if (closingOffset != -1) {
              currState = priorState;
              if (trimmedLine.length > 2 && shouldEmitTopDocComments) {
                topDocLines.push(trimmedLine);
              }
            } else {
              if (shouldEmitTopDocComments) {
                topDocLines.push(trimmedLine);
              }
            }
            continue;
          } else if (currState == eParseState.inMultiLineComment) {
            const openingOffset = line.text.indexOf('{');
            const closingOffset = line.text.indexOf('}');
            if (openingOffset != -1 && closingOffset != -1 && openingOffset < closingOffset) {
              // nested {cmt} line — do nothing
            } else if (closingOffset != -1) {
              currState = priorState;
            }
            continue;
          }

          // --- Preprocessor directive handling ---
          if (trimmedLine.startsWith('#')) {
            const preProcParts = trimmedLine.split(/[ \t]+/).filter(Boolean);
            const directive = preProcParts[0].toLowerCase();
            const symbol = preProcParts.length > 1 ? preProcParts[1] : '';
            if (directive === '#define' && symbol.length > 0) {
              if (!preProcLinesDisabled) {
                definedSymbols.add(symbol.toUpperCase());
              }
            } else if (directive === '#ifdef' && symbol.length > 0) {
              referencedSymbols.add(symbol.toUpperCase());
              preProcDisabledStack.push(preProcLinesDisabled);
              if (!preProcLinesDisabled) {
                preProcLinesDisabled = !definedSymbols.has(symbol.toUpperCase());
              }
            } else if (directive === '#ifndef' && symbol.length > 0) {
              referencedSymbols.add(symbol.toUpperCase());
              preProcDisabledStack.push(preProcLinesDisabled);
              if (!preProcLinesDisabled) {
                preProcLinesDisabled = definedSymbols.has(symbol.toUpperCase());
              }
            } else if (directive === '#else') {
              if (preProcDisabledStack.length > 0) {
                const parentDisabled = preProcDisabledStack[preProcDisabledStack.length - 1];
                if (!parentDisabled) {
                  preProcLinesDisabled = !preProcLinesDisabled;
                }
              }
            } else if (directive === '#endif') {
              if (preProcDisabledStack.length > 0) {
                preProcLinesDisabled = preProcDisabledStack.pop()!;
              }
            }
            continue; // preprocessor lines are not content
          }

          // skip lines disabled by preprocessor
          if (preProcLinesDisabled) {
            continue;
          }

          // --- Section start detection ---
          const sectionStatus = this.spinCodeUtils.isSectionStartLine(line.text);
          if (sectionStatus.isSectionStart) {
            // finalize any current documented CON section
            if (currentDocConSection && conBlockIsDocumented) {
              const hasContent =
                currentDocConSection.constants.length > 0 ||
                currentDocConSection.structures.length > 0;
              if (hasContent) {
                docConSections.push(currentDocConSection);
              }
            }
            currentDocConSection = undefined;
            conBlockIsDocumented = false;
            conBlockPreamble = false;
            enumInProgress = false;

            currState = sectionStatus.inProgressStatus;
            if (currState === eParseState.inCon) {
              inConBlock = true;
              conBlockPreamble = true;
              pendingDocComment = [];
              currentConHeading = this._extractSectionComment(line.text);
              currentDocConSection = {
                heading: currentConHeading,
                constants: [],
                structures: []
              };
              // detect {Spin2_Doc_CON} on the CON keyword line itself
              if (this.spinCodeUtils.containsDocConDirective(line.text)) {
                conBlockIsDocumented = true;
                this.logMessage(
                  `+ (DBG) generateDocument() ` +
                  `Found {Spin2_Doc_CON} on CON line at Ln#${lineNbr}`
                );
              }
            } else {
              inConBlock = false;
            }
          }

          // --- Handle comment lines ---
          if (trimmedLine.startsWith('{{')) {
            const openingOffset = line.text.indexOf('{{');
            const closingOffset = line.text.indexOf('}}', openingOffset + 2);
            if (closingOffset != -1) {
              // single-line block doc comment — skip
            } else {
              priorState = currState;
              currState = eParseState.inMultiLineDocComment;
              if (trimmedLine.length > 2 && shouldEmitTopDocComments) {
                topDocLines.push(trimmedLine);
              }
            }
            continue;
          } else if (trimmedLine.startsWith('{')) {
            // check for {Spin2_Doc_CON} directive anywhere in CON block
            // (blank lines or comments may precede it)
            if (inConBlock &&
                this.spinCodeUtils.containsDocConDirective(trimmedLine)) {
              conBlockIsDocumented = true;
              this.logMessage(
                `+ (DBG) generateDocument() ` +
                `Found {Spin2_Doc_CON} at Ln#${lineNbr}`
              );
              continue;
            }
            const openingOffset = line.text.indexOf('{');
            const closingOffset = line.text.indexOf('}', openingOffset + 1);
            if (closingOffset == -1) {
              priorState = currState;
              currState = eParseState.inMultiLineComment;
            }
            continue;
          } else if (trimmedLine.startsWith("''")) {
            if (shouldEmitTopDocComments && trimmedLine.length > 2) {
              topDocLines.push(trimmedLine.substring(2));
            }
            continue;
          } else if (trimmedLine.startsWith("'")) {
            // collect non-doc comments within documented CON blocks
            // (convention: constants/enums/structs use ' not '')
            if (inConBlock && conBlockIsDocumented) {
              const cmtText = trimmedLine.substring(1).trim();
              if (cmtText.length > 0) {
                pendingDocComment.push(cmtText);
              }
            }
            continue;
          }

          // --- Non-comment, non-directive line = code ---
          if (sectionStatus.isSectionStart && bHuntingForVersion) {
            this.logMessage(`+ (DBG) generateDocument() STOP HUNT at Ln#${lineNbr} [${trimmedLine}]`);
            bHuntingForVersion = false;
          }

          // if we were in the CON preamble, first code line ends it
          if (inConBlock && conBlockPreamble) {
            conBlockPreamble = false;
          }

          // --- Collect PUB method signatures ---
          if (sectionStatus.isSectionStart && currState == eParseState.inPub) {
            pubsFound++;
            shouldEmitTopDocComments = false;
            const trimmedNonCommentLine = this.getNonCommentLineRemainder(0, trimmedLine);
            pubSignatures.push(trimmedNonCommentLine);
          }

          // --- Collect CON block content for documented sections ---
          if (inConBlock && conBlockIsDocumented &&
              !sectionStatus.isSectionStart &&
              currentDocConSection) {
            if (trimmedLine.length === 0) {
              // blank line resets pending doc comment
              pendingDocComment = [];
              continue;
            }
            const upperLine = trimmedLine.toUpperCase();

            // check for STRUCT declaration
            if (upperLine.startsWith('STRUCT ')) {
              const structInfo = this._parseStructDeclaration(trimmedLine, structSizeMap);
              if (structInfo) {
                structInfo.docComment = pendingDocComment.length > 0 ? [...pendingDocComment] : [];
                currentDocConSection.structures.push(structInfo);
                structSizeMap.set(structInfo.name.toUpperCase(), structInfo.sizeBytes);
                this.logMessage(`+ (DBG) generateDocument() CON struct: ${structInfo.name} (${structInfo.sizeBytes} bytes) at Ln#${lineNbr}`);
              }
              pendingDocComment = [];
              continue;
            }

            // check for enum start: #value or #value[step]
            if (trimmedLine.startsWith('#')) {
              const enumRegEx =
                /^#\s*(-?\d+|\$[0-9a-fA-F_]+)\s*(?:\[\s*(\d+)\s*\])?\s*,?\s*(.*)/;
              const enumMatch = trimmedLine.match(enumRegEx);
              if (enumMatch) {
                enumValue = this._parseNumericValue(enumMatch[1]);
                enumStep = enumMatch[2] ? parseInt(enumMatch[2]) : 1;
                enumInProgress = true;
                // there may be enum names on this same line after the #value,
                const remainder = enumMatch[3];
                if (remainder.length > 0) {
                  const enumResult = this._collectEnumNames(
                    remainder, currentDocConSection,
                    enumValue, enumStep, pendingDocComment
                  );
                  enumValue = enumResult.nextValue;
                  enumStep = enumResult.nextStep;
                  pendingDocComment = [];
                }
              }
              continue;
            }

            // check for constant assignment: NAME = value
            const assignMatch = trimmedLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*)/);
            if (assignMatch) {
              enumInProgress = false; // explicit assignment breaks enum sequence
              const constName = assignMatch[1];
              let valueAndComment = assignMatch[2];
              const trailingComment = this._extractTrailingComment(valueAndComment);
              if (trailingComment !== '') {
                // remove the trailing comment from the value
                const commentStart = valueAndComment.indexOf("'");
                if (commentStart !== -1) {
                  valueAndComment = valueAndComment.substring(0, commentStart).trim();
                }
              }
              currentDocConSection.constants.push({
                name: constName,
                value: valueAndComment.trim(),
                trailingComment: trailingComment,
                docComment: pendingDocComment.length > 0 ? [...pendingDocComment] : []
              });
              pendingDocComment = [];
              this.logMessage(`+ (DBG) generateDocument() CON const: ${constName} = ${valueAndComment.trim()} at Ln#${lineNbr}`);
              continue;
            }

            // check for enum member names (comma-separated, no =)
            if (enumInProgress) {
              const enumResult = this._collectEnumNames(
                trimmedLine, currentDocConSection,
                enumValue, enumStep, pendingDocComment
              );
              enumValue = enumResult.nextValue;
              enumStep = enumResult.nextStep;
              pendingDocComment = [];
            }
          }
        }

        // finalize last documented CON section if any
        if (currentDocConSection && conBlockIsDocumented) {
          const hasContent =
            currentDocConSection.constants.length > 0 ||
            currentDocConSection.structures.length > 0;
          if (hasContent) {
            docConSections.push(currentDocConSection);
          }
        }

        // Separate structures from constant sections for summary output
        const allDocStructures: IDocStructure[] = [];
        for (const section of docConSections) {
          for (const struct of section.structures) {
            allDocStructures.push(struct);
          }
        }

        //
        // EMIT: Write the document
        //

        // --- Top doc comments (file header) ---
        for (const docLine of topDocLines) {
          this._emitWrapped(outFile, docLine, '  ');
        }

        // --- Object Interface header ---
        fs.appendFileSync(outFile, '' + this.endOfLineStr);
        const introText: string = 'Object "' + objectName + '" Interface:';
        fs.appendFileSync(outFile, introText + this.endOfLineStr);
        if (requiredLanguageVersion > 0) {
          const lanVersionText =
            `  (Requires Spin2 Language v${requiredLanguageVersion})`;
          fs.appendFileSync(outFile,
            lanVersionText + this.endOfLineStr);
        }
        // show which external feature flags are active
        // external = referenced in #ifdef/#ifndef
        // active = also locally #define'd (e.g., cascaded)
        if (referencedSymbols.size > 0) {
          const activeFeatures = [...referencedSymbols]
            .filter((s) => definedSymbols.has(s))
            .sort();
          if (activeFeatures.length > 0) {
            const defList = activeFeatures.join(', ');
            this._emitWrapped(outFile,
              `  (Active features: ${defList})`,
              '    ');
          } else {
            fs.appendFileSync(outFile,
              '  (No optional features active)' +
              this.endOfLineStr);
          }
        }
        fs.appendFileSync(outFile, '' + this.endOfLineStr);

        // --- Interface Summary: Public Constants ---
        const hasDocConstants = docConSections.some((s) => s.constants.length > 0);
        if (hasDocConstants) {
          fs.appendFileSync(outFile, this._sectionHeader('Public Constants') + this.endOfLineStr);
          fs.appendFileSync(outFile, '' + this.endOfLineStr);
          const allConstNames: string[] = [];
          for (const section of docConSections) {
            for (const c of section.constants) {
              allConstNames.push(c.name);
            }
          }
          this._emitWrapped(outFile,
            `  ${allConstNames.join(', ')}`, '  ');
          fs.appendFileSync(outFile, '' + this.endOfLineStr);
        }

        // --- Interface Summary: Public Structures ---
        if (allDocStructures.length > 0) {
          fs.appendFileSync(outFile, this._sectionHeader('Public Structures') + this.endOfLineStr);
          fs.appendFileSync(outFile, '' + this.endOfLineStr);
          for (const struct of allDocStructures) {
            fs.appendFileSync(outFile, `  ${struct.signature}` + this.endOfLineStr);
          }
          fs.appendFileSync(outFile, '' + this.endOfLineStr);
        }

        // --- Interface Summary: Public Methods ---
        if (pubSignatures.length > 0) {
          fs.appendFileSync(outFile, this._sectionHeader('Public Methods') + this.endOfLineStr);
          fs.appendFileSync(outFile, '' + this.endOfLineStr);
          for (const sig of pubSignatures) {
            fs.appendFileSync(outFile, sig + this.endOfLineStr);
          }
          fs.appendFileSync(outFile, '' + this.endOfLineStr);
        }

        // --- Constant Details ---
        if (hasDocConstants) {
          fs.appendFileSync(outFile, '' + this.endOfLineStr);
          fs.appendFileSync(outFile, '' + this.endOfLineStr);
          fs.appendFileSync(outFile, this._sectionHeader('Constant Details') + this.endOfLineStr);
          fs.appendFileSync(outFile, '' + this.endOfLineStr);
          for (const section of docConSections) {
            if (section.constants.length > 0) {
              const heading = section.heading.length > 0
                ? this._toTitleCase(section.heading)
                : 'Constants';
              const headingUnderline = '_'.repeat(heading.length);
              fs.appendFileSync(outFile, heading + this.endOfLineStr);
              fs.appendFileSync(outFile, headingUnderline + this.endOfLineStr);
              // compute column widths for alignment
              let maxNameLen = 0;
              let maxValueLen = 0;
              for (const c of section.constants) {
                if (c.name.length > maxNameLen) maxNameLen = c.name.length;
                if (c.value.length > maxValueLen) maxValueLen = c.value.length;
              }
              // compute indent for wrapped comment continuation
              const cmtIndent = ' '.repeat(
                2 + maxNameLen + 3 + maxValueLen + 4
              );
              for (const c of section.constants) {
                // emit any doc comments above this constant
                if (c.docComment.length > 0) {
                  for (const dc of c.docComment) {
                    this._emitWrapped(outFile,
                      `  ${dc}`, '  ');
                  }
                }
                const paddedName = c.name.padEnd(maxNameLen);
                const paddedValue = c.value.padStart(maxValueLen);
                let constLine = `  ${paddedName} = ${paddedValue}`;
                if (c.trailingComment.length > 0) {
                  constLine += `    ${c.trailingComment}`;
                }
                this._emitWrapped(outFile, constLine, cmtIndent);
              }
              fs.appendFileSync(outFile, '' + this.endOfLineStr);
            }
          }
        }

        // --- Structure Details ---
        if (allDocStructures.length > 0) {
          fs.appendFileSync(outFile, '' + this.endOfLineStr);
          fs.appendFileSync(outFile, '' + this.endOfLineStr);
          fs.appendFileSync(outFile, this._sectionHeader('Structure Details') + this.endOfLineStr);
          fs.appendFileSync(outFile, '' + this.endOfLineStr);
          for (const struct of allDocStructures) {
            const sizeText = `${struct.name} (${struct.sizeBytes} bytes)`;
            const headerLine = `STRUCT ${sizeText}`;
            const headingUnderline = '_'.repeat(headerLine.length);
            fs.appendFileSync(outFile, headerLine + this.endOfLineStr);
            fs.appendFileSync(outFile, headingUnderline + this.endOfLineStr);
            if (struct.docComment.length > 0) {
              for (const dc of struct.docComment) {
                this._emitWrapped(outFile, `  ${dc}`, '  ');
              }
              fs.appendFileSync(outFile, '' + this.endOfLineStr);
            }
            fs.appendFileSync(outFile,
              `  STRUCT ${struct.name} Members:` + this.endOfLineStr);
            for (const member of struct.members) {
              const typeStr = member.type.padEnd(6);
              const arrayStr = member.arraySize > 0
                ? `[${member.arraySize}]` : '';
              fs.appendFileSync(outFile,
                `    ${typeStr}${member.name}${arrayStr}` + this.endOfLineStr);
            }
            fs.appendFileSync(outFile, '' + this.endOfLineStr);
          }
        }

        // --- Method Details ---
        if (pubSignatures.length > 0) {
          fs.appendFileSync(outFile, '' + this.endOfLineStr);
          fs.appendFileSync(outFile, '' + this.endOfLineStr);
          fs.appendFileSync(outFile, this._sectionHeader('Method Details') + this.endOfLineStr);
        }

        //
        // 2nd pass: emit PUB methods with doc comments for each (if any)
        //
        currState = eParseState.inCon;
        priorState = currState;
        let pubsSoFar: number = 0;
        let emitPubDocComment: boolean = false;
        let emitTrailingDocComment: boolean = false;
        // reset preprocessor state for 2nd pass
        preProcLinesDisabled = false;
        preProcDisabledStack.length = 0;

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
                this._emitWrapped(outFile,
                  line.text.substring(2).trimEnd(), ' ');
              }
            } else {
              //  if last line has additional text write it!
              if (emitTrailingDocComment || emitPubDocComment) {
                this._emitWrapped(outFile,
                  line.text.trimEnd(), ' ');
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

          // --- Preprocessor directive handling (2nd pass) ---
          if (trimmedLine.startsWith('#')) {
            const preProcParts = trimmedLine.split(/[ \t]+/).filter(Boolean);
            const directive = preProcParts[0].toLowerCase();
            const symbol = preProcParts.length > 1 ? preProcParts[1] : '';
            if (directive === '#ifdef' && symbol.length > 0) {
              preProcDisabledStack.push(preProcLinesDisabled);
              if (!preProcLinesDisabled) {
                preProcLinesDisabled = !definedSymbols.has(symbol.toUpperCase());
              }
            } else if (directive === '#ifndef' && symbol.length > 0) {
              preProcDisabledStack.push(preProcLinesDisabled);
              if (!preProcLinesDisabled) {
                preProcLinesDisabled = definedSymbols.has(symbol.toUpperCase());
              }
            } else if (directive === '#else') {
              if (preProcDisabledStack.length > 0) {
                const parentDisabled = preProcDisabledStack[preProcDisabledStack.length - 1];
                if (!parentDisabled) {
                  preProcLinesDisabled = !preProcLinesDisabled;
                }
              }
            } else if (directive === '#endif') {
              if (preProcDisabledStack.length > 0) {
                preProcLinesDisabled = preProcDisabledStack.pop()!;
              }
            }
            continue;
          }

          // skip lines disabled by preprocessor
          if (preProcLinesDisabled) {
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
                this._emitWrapped(outFile,
                  line.text.trimEnd(), ' ');
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
              this._emitWrapped(outFile,
                trimmedLine.substring(2), ' ');
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
            fs.appendFileSync(outFile, '' + this.endOfLineStr); // blank line
            fs.appendFileSync(outFile, header + this.endOfLineStr); // underscore header line
            fs.appendFileSync(outFile, trimmedNonCommentLine + this.endOfLineStr);
            fs.appendFileSync(outFile, '' + this.endOfLineStr); // blank line
            if (trailingDocComment) {
              fs.appendFileSync(outFile, trailingDocComment + this.endOfLineStr); // underscore header line
            }
            if (pubsSoFar >= pubsFound) {
              emitTrailingDocComment = true;
              emitPubDocComment = false;
            }
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

  // --- Private helpers for CON documentation ---

  private static readonly docConDirectiveInTextRegEx = /\{\s*Spin2_Doc_CON\s*\}/gi;

  private _stripDocConDirective(text: string): string {
    return text.replace(DocGenerator.docConDirectiveInTextRegEx, '').trim();
  }

  private _extractSectionComment(line: string): string {
    // extract comment text from a section line like:
    //   "CON ' error codes" or "CON { Motor Constants }"
    const trimmed = line.trim();
    // try brace comment first: CON { text }
    const braceOpen = trimmed.indexOf('{');
    const braceClose = trimmed.indexOf('}', braceOpen + 1);
    if (braceOpen !== -1 && braceClose !== -1) {
      const inner = trimmed.substring(braceOpen + 1, braceClose).trim();
      // skip if it's a directive like {Spin2_Doc_CON} or {Spin2_v46}
      if (inner.toLowerCase().startsWith('spin2_')) {
        // fall through to try tic comment
      } else {
        return this._stripDocConDirective(inner);
      }
    }
    // try tic comment: CON ' text
    const ticPos = trimmed.indexOf("'");
    if (ticPos !== -1) {
      return this._stripDocConDirective(
        trimmed.substring(ticPos + 1).trim()
      );
    }
    return '';
  }

  private _extractTrailingComment(valueAndRemainder: string): string {
    // extract trailing ' comment from a constant value line
    // be careful not to match ' inside strings
    const noStrings = this.spinCodeUtils.removeDoubleQuotedStrings(
      valueAndRemainder,
      false
    );
    const ticPos = noStrings.indexOf("'");
    if (ticPos !== -1) {
      return this._stripDocConDirective(
        valueAndRemainder.substring(ticPos + 1).trim()
      );
    }
    return '';
  }

  private _parseNumericValue(text: string): number {
    // parse Spin2 numeric literal: decimal, $hex, %binary, %%quad
    const trimmed = text.trim().replace(/_/g, '');
    if (trimmed.startsWith('$')) {
      return parseInt(trimmed.substring(1), 16);
    } else if (trimmed.startsWith('%%')) {
      return parseInt(trimmed.substring(2), 4);
    } else if (trimmed.startsWith('%')) {
      return parseInt(trimmed.substring(1), 2);
    }
    return parseInt(trimmed, 10);
  }

  private _collectEnumNames(
    text: string,
    section: IDocConSection,
    startValue: number,
    step: number,
    pendingDocComment: string[]
  ): { nextValue: number; nextStep: number } {
    // parse comma-separated enum names (may have trailing comment)
    const noComment = this.spinCodeUtils.getNonCommentLineRemainder(0, text);
    const trailingComment = this._extractTrailingComment(text);
    const names = noComment
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('#'));

    let validCount = 0;
    for (let idx = 0; idx < names.length; idx++) {
      const name = names[idx];
      // skip if it looks like a numeric literal (part of #value)
      if (/^[0-9$%]/.test(name)) continue;
      // skip if it has an = (it's an explicit assignment, handled separately)
      if (name.includes('=')) continue;

      const computedValue = startValue + validCount * step;
      section.constants.push({
        name: name,
        value: computedValue.toString(),
        trailingComment: idx === names.length - 1 ? trailingComment : '',
        docComment: validCount === 0 && pendingDocComment.length > 0 ? [...pendingDocComment] : []
      });
      validCount++;
    }

    return { nextValue: startValue + validCount * step, nextStep: step };
  }

  private _parseStructDeclaration(
    line: string,
    structSizeMap: Map<string, number>
  ): IDocStructure | undefined {
    // parse: STRUCT name(members)
    const match = line.match(/^STRUCT\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)/i);
    if (!match) return undefined;

    const name = match[1];
    const memberText = match[2];
    const members: IDocStructMember[] = [];
    let totalSize = 0;

    // split members by comma
    const memberParts = memberText.split(',').map((s) => s.trim());
    for (const part of memberParts) {
      if (part.length === 0) continue;
      const memberInfo = this._parseStructMember(part, structSizeMap);
      if (memberInfo) {
        members.push(memberInfo.member);
        totalSize += memberInfo.size;
      }
    }

    // build signature text from original line (strip trailing comment)
    const sigLine = this.spinCodeUtils.getNonCommentLineRemainder(0, line).trim();

    return {
      name: name,
      signature: sigLine,
      members: members,
      sizeBytes: totalSize,
      docComment: []
    };
  }

  private _parseStructMember(
    memberText: string,
    structSizeMap: Map<string, number>
  ): { member: IDocStructMember; size: number } | undefined {
    // parse a single struct member like "BYTE x", "WORD y[4]", "point a", or "z" (default LONG)
    const trimmed = memberText.trim();
    if (trimmed.length === 0) return undefined;

    const tokens = trimmed.split(/\s+/);
    let typeName: string;
    let memberName: string;

    const typeKeywords = ['BYTE', 'WORD', 'LONG'];
    if (tokens.length >= 2 && typeKeywords.includes(tokens[0].toUpperCase())) {
      typeName = tokens[0].toUpperCase();
      memberName = tokens[1];
    } else if (tokens.length >= 2) {
      // could be nested struct: "point a"
      typeName = tokens[0];
      memberName = tokens[1];
    } else {
      // single name — default LONG
      typeName = 'LONG';
      memberName = tokens[0];
    }

    // check for array: name[count]
    let arraySize = 0;
    const arrayMatch = memberName.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$/);
    if (arrayMatch) {
      memberName = arrayMatch[1];
      arraySize = parseInt(arrayMatch[2]);
    }

    // compute size
    let baseSize: number;
    const upperType = typeName.toUpperCase();
    if (upperType === 'BYTE') {
      baseSize = 1;
    } else if (upperType === 'WORD') {
      baseSize = 2;
    } else if (upperType === 'LONG') {
      baseSize = 4;
    } else {
      // nested struct type — look up
      baseSize = structSizeMap.get(upperType) || 4; // fallback to LONG if unknown
    }

    const totalSize = arraySize > 0 ? baseSize * arraySize : baseSize;

    return {
      member: { type: typeName, name: memberName, arraySize: arraySize },
      size: totalSize
    };
  }

  private _toTitleCase(text: string): string {
    return text.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private static readonly MAX_LINE_WIDTH = 100;

  private _sectionHeader(title: string): string {
    const rule = '─'.repeat(60 - title.length);
    return `── ${title} ${rule}`;
  }

  private _wrapLine(
    text: string,
    indent: string,
    maxWidth: number = DocGenerator.MAX_LINE_WIDTH
  ): string[] {
    // wrap text at word boundaries to fit within maxWidth
    if (text.length <= maxWidth) {
      return [text];
    }
    const lines: string[] = [];
    let remaining = text;
    while (remaining.length > maxWidth) {
      // find last space at or before maxWidth
      let breakAt = remaining.lastIndexOf(' ', maxWidth);
      if (breakAt <= indent.length) {
        // no good break point — find first space after maxWidth
        breakAt = remaining.indexOf(' ', maxWidth);
        if (breakAt === -1) {
          break; // no break possible, emit as-is
        }
      }
      lines.push(remaining.substring(0, breakAt));
      remaining = indent + remaining.substring(breakAt + 1);
    }
    lines.push(remaining);
    return lines;
  }

  private _emitWrapped(
    outFile: number,
    text: string,
    indent: string
  ): void {
    const lines = this._wrapLine(text, indent);
    for (const line of lines) {
      fs.appendFileSync(outFile, line + this.endOfLineStr);
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

  async showDocument(reportFileType: string) {
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

        const outFile = fs.openSync(outFSpec, 'w');

        const rptHoriz: string = '─';

        // add generation here

        // write report title
        const rptTitle: string = 'Parallax Propeller Chip Object Hierarchy';
        fs.appendFileSync(outFile, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        fs.appendFileSync(outFile, `${rptTitle}${this.endOfLineStr}`); // blank line
        fs.appendFileSync(outFile, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        fs.appendFileSync(outFile, `${this.endOfLineStr}`); // blank line
        fs.appendFileSync(outFile, ` Project :  "${objectName}"${this.endOfLineStr}${this.endOfLineStr}`);
        fs.appendFileSync(outFile, `Reported :  ${this.reportDateString()}${this.endOfLineStr}${this.endOfLineStr}`);
        const versionStr: string = this.extensionVersionString();
        fs.appendFileSync(outFile, `    Tool :  VSCode Spin2 Extension ${versionStr} ${this.endOfLineStr}${this.endOfLineStr}`);
        fs.appendFileSync(outFile, `${this.endOfLineStr}`); // blank line

        // Get object tree from ObjectTreeProvider (server-backed)
        const [topFilename, rootNode] = this.objTreeProvider.getObjectHierarchy();
        this.hierarchyFilenameTotal = this.countFiles(rootNode);
        this.hierarchyFilenameCount = 0;
        if (topFilename.length == 0 || !rootNode) {
          fs.appendFileSync(outFile, `NO Dependencies found!${this.endOfLineStr}`); // blank line
        } else {
          this.logMessage(`+ (DBG) generateHierarchyDocument() topFilename=[${topFilename}], children=(${rootNode.children.length})`);
          const depth: number = 0;
          const lastParent: boolean = this.isOnlyParent(rootNode);
          const lastChild = false;
          this.reportDeps(depth, [], rootNode, outFile, lastParent, lastChild);
        }
        fs.appendFileSync(outFile, `${this.endOfLineStr}`); // blank line
        fs.appendFileSync(outFile, `${this.endOfLineStr}`); // blank line
        fs.appendFileSync(outFile, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        fs.appendFileSync(outFile, `Parallax Inc.${this.endOfLineStr}`);
        fs.appendFileSync(outFile, `www.parallax.com${this.endOfLineStr}`);
        fs.appendFileSync(outFile, `support@parallax.com${this.endOfLineStr}${this.endOfLineStr}`);
        fs.appendFileSync(outFile, `VSCode Spin2 Extension by:${this.endOfLineStr}`);
        fs.appendFileSync(outFile, ` Iron Sheep Productions, LLC${this.endOfLineStr}`);
        fs.closeSync(outFile);
      } else {
        this.logMessage(`+ (DBG) generateHierarchyDocument() NOT a spin file! can't generate doc.`);
      }
    } else {
      this.logMessage(`+ (DBG) generateHierarchyDocument() NO active editor.`);
    }
  }

  // ----------------------------------------------------------------------------
  //   Hook GENERATE Project Archive (ZIP)
  //
  public generateProjectArchive(): void {
    const textEditor = vscode.window.activeTextEditor;
    if (textEditor) {
      this.endOfLineStr = '\r\n'; // archives use CRLF for readme

      const currentlyOpenTabfilePath = textEditor.document.uri.fsPath;
      const currentlyOpenTabfolderName = path.dirname(currentlyOpenTabfilePath);
      const currentlyOpenTabfileName = path.basename(currentlyOpenTabfilePath);
      this.logMessage(`+ (DBG) generateProjectArchive() fsPath-(${currentlyOpenTabfilePath})`);
      this.logMessage(`+ (DBG) generateProjectArchive() folder-(${currentlyOpenTabfolderName})`);
      this.logMessage(`+ (DBG) generateProjectArchive() filename-(${currentlyOpenTabfileName})`);
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

        // build archive filename with date/time stamp
        const now = new Date();
        const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
        const timeStr = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
        const zipFilename = `${objectName}-Archive-Date-${dateStr}-Time-${timeStr}.zip`;
        const zipFSpec = path.join(currentlyOpenTabfolderName, zipFilename);
        this.logMessage(`+ (DBG) generateProjectArchive() zipFSpec-(${zipFSpec})`);

        // generate _README_.txt content
        const readmeContent = this._generateArchiveReadme(objectName);

        // collect all source files from the dependency tree (flat, no duplicates)
        const sourceFiles: Map<string, string> = new Map(); // basename -> full path
        sourceFiles.set(currentlyOpenTabfileName, currentlyOpenTabfilePath);
        const [topFilename, rootNode] = this.objTreeProvider.getObjectHierarchy();
        if (rootNode) {
          this._collectSourceFiles(rootNode, sourceFiles);
        }

        // create ZIP archive
        const zip = new AdmZip();
        zip.addFile('_README_.txt', Buffer.from(readmeContent, 'utf-8'));
        for (const [basename, fullPath] of sourceFiles) {
          if (fs.existsSync(fullPath)) {
            zip.addLocalFile(fullPath, '', basename);
            this.logMessage(`+ (DBG) generateProjectArchive() added file: ${basename}`);
          } else {
            this.logMessage(`+ (DBG) generateProjectArchive() MISSING file: ${fullPath}`);
          }
        }
        zip.writeZip(zipFSpec);
        this.logMessage(`+ (DBG) generateProjectArchive() wrote ZIP: ${zipFSpec}`);

        vscode.window.showInformationMessage(`Project archive created: ${zipFilename}`);
      } else {
        this.logMessage(`+ (DBG) generateProjectArchive() NOT a spin file! can't generate archive.`);
      }
    } else {
      this.logMessage(`+ (DBG) generateProjectArchive() NO active editor.`);
    }
  }

  private _generateArchiveReadme(objectName: string): string {
    const eol = this.endOfLineStr;
    const rptHoriz: string = '─';
    const rptTitle: string = 'Parallax Propeller Chip Project Archive';
    const lines: string[] = [];

    lines.push(`${rptHoriz.repeat(rptTitle.length)}`);
    lines.push(`${rptTitle}`);
    lines.push(`${rptHoriz.repeat(rptTitle.length)}`);
    lines.push('');
    lines.push(` Project :  "${objectName}"`);
    lines.push('');
    lines.push(`Archived :  ${this.reportDateString()}`);
    lines.push('');
    const versionStr: string = this.extensionVersionString();
    lines.push(`    Tool :  VSCode Spin2 Extension ${versionStr}`);
    lines.push('');
    lines.push('');

    // get hierarchy and render tree
    const [topFilename, rootNode] = this.objTreeProvider.getObjectHierarchy();
    this.hierarchyFilenameTotal = this.countFiles(rootNode);
    this.hierarchyFilenameCount = 0;
    if (topFilename.length == 0 || !rootNode) {
      lines.push('NO Dependencies found!');
    } else {
      const treeLines: string[] = [];
      const lastParent: boolean = this.isOnlyParent(rootNode);
      this._reportDepsToLines(0, [], rootNode, treeLines, lastParent, false);
      lines.push(...treeLines);
    }
    lines.push('');
    lines.push('');
    lines.push(`${rptHoriz.repeat(20)}`);
    lines.push('Iron Sheep Productions, LLC');
    lines.push('');

    return lines.join(eol) + eol;
  }

  private _reportDepsToLines(
    depth: number,
    nestList: boolean[],
    node: IObjectDependencyNode,
    lines: string[],
    isLastParent: boolean,
    isLastChild: boolean
  ) {
    const baseIndent: number = 12;
    const rptHoriz: string = '─';
    const rptVert: string = '│';
    const rptTeeRight: string = '├';
    const rptElbow: string = '└';
    const haveChildren: boolean = node.children.length > 0 && !node.isCircular && !node.isFileMissing;
    const NoEndBlank: boolean = true;
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
    const vertNestList: boolean[] = haveChildren ? [...nestList, true] : nestList;
    const specialEndBlanking: boolean = isLastChild && !haveChildren ? false : NoEndBlank;
    const prefixFillVert: string = this.fillWithVerts(vertNestList, rptVert, specialEndBlanking);
    let linePrefixSpacer: string = ' '.repeat(baseIndent - 2);
    if (depth == 0) {
      linePrefixSpacer = ' '.repeat(baseIndent - 2) + this.fillWithVerts([true], rptVert, NoEndBlank);
    } else {
      linePrefixSpacer = `${linePrefixSpacer}${prefixFillVert}`;
    }
    // write one or both lines
    lines.push(`${linePrefixFile}${node.fileName}`);
    this.hierarchyFilenameCount++;
    const showLastBlankLine: boolean = this.hierarchyFilenameCount < this.hierarchyFilenameTotal;
    if (showLastBlankLine) {
      lines.push(`${linePrefixSpacer}`);
    }
    // process children of this object
    if (haveChildren) {
      for (let index = 0; index < node.children.length; index++) {
        const childNode = node.children[index];
        const isLastChild: boolean = index == node.children.length - 1;
        const nextIsLastParent = depth == 0 && isLastChild ? true : isLastParent;
        nestList.push(nextIsLastParent ? false : true);
        this._reportDepsToLines(depth + 1, nestList, childNode, lines, nextIsLastParent, isLastChild);
      }
    }
    if (nestList.length > 0) {
      nestList.pop();
    }
  }

  private _collectSourceFiles(node: IObjectDependencyNode, sourceFiles: Map<string, string>): void {
    for (const child of node.children) {
      if (!child.isCircular && !child.isFileMissing && child.fileSpec.length > 0) {
        const basename = path.basename(child.fileSpec);
        if (!sourceFiles.has(basename)) {
          sourceFiles.set(basename, child.fileSpec);
        }
        this._collectSourceFiles(child, sourceFiles);
      }
    }
  }

  private countFiles(rootNode: IObjectDependencyNode | null): number {
    if (!rootNode) return 0;
    let desiredFileCount: number = 1;
    const countChildren = (node: IObjectDependencyNode): void => {
      for (const child of node.children) {
        desiredFileCount++;
        if (!child.isCircular && !child.isFileMissing) {
          countChildren(child);
        }
      }
    };
    countChildren(rootNode);
    this.logMessage(`* countFiles() desiredFileCount=(${desiredFileCount})`);
    return desiredFileCount;
  }

  private isOnlyParent(rootNode: IObjectDependencyNode): boolean {
    let onlyParentStatus: boolean = true;
    this.logMessage(`* isOnlyParent() childrenCt=[${rootNode.children.length}]`);
    for (const child of rootNode.children) {
      if (child.children.length > 0) {
        this.logMessage(`* isOnlyParent() [${child.fileName}] grandChildren=[${child.children.length}]`);
        onlyParentStatus = false;
        break;
      }
    }
    this.logMessage(`* isOnlyParent()=(${onlyParentStatus})`);
    return onlyParentStatus;
  }

  private reportDeps(
    depth: number,
    nestList: boolean[],
    node: IObjectDependencyNode,
    outFile: number,
    isLastParent: boolean,
    isLastChild: boolean
  ) {
    this.logMessage(`+ rD() d=(${depth}), nd=[${nestList}], ilp=(${isLastParent}), ilc=(${isLastChild}), fn=[${node.fileName}]`);
    const baseIndent: number = 12;
    const rptHoriz: string = '─';
    const rptVert: string = '│';
    const rptTeeRight: string = '├';
    const rptElbow: string = '└';
    const haveChildren: boolean = node.children.length > 0 && !node.isCircular && !node.isFileMissing;
    const NoEndBlank: boolean = true;
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
    fs.appendFileSync(outFile, `${linePrefixFile}${node.fileName}${this.endOfLineStr}`); // filename line
    this.hierarchyFilenameCount++;
    // show last line of not last line to be drawn in chart
    //  last line is when we are both at last parent and last child
    const showLastBlankLine: boolean = this.hierarchyFilenameCount < this.hierarchyFilenameTotal;
    this.logMessage(
      `+ rD() showLastBlankLine=(${showLastBlankLine}), count=(${this.hierarchyFilenameCount}), total=(${this.hierarchyFilenameTotal})`
    );
    if (showLastBlankLine) {
      fs.appendFileSync(outFile, `${linePrefixSpacer}${this.endOfLineStr}`); // blank line
    }
    // process children of this object
    if (haveChildren) {
      for (let index = 0; index < node.children.length; index++) {
        const childNode = node.children[index];
        const isLastChild: boolean = index == node.children.length - 1;

        const nextIsLastParent = depth == 0 && isLastChild ? true : isLastParent;
        nestList.push(nextIsLastParent ? false : true);
        this.reportDeps(depth + 1, nestList, childNode, outFile, nextIsLastParent, isLastChild);
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
