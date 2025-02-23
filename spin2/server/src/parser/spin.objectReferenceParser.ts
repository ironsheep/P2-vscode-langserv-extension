'use strict';
// server/src/parser/spin.objectReferenceParser.ts

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Context, ServerBehaviorConfiguration } from '../context';

//import { semanticConfiguration, reloadSemanticConfiguration } from "./spin2.extension.configuration";
import { DocumentFindings, RememberedToken } from './spin.semantic.findings';
import { Spin2ParseUtils } from './spin2.utils';
import { isSpin1File } from './lang.utils';
import { eParseState } from './spin.common';
import { ExtensionUtils } from '../parser/spin.extension.utils';
import path = require('path');

// ----------------------------------------------------------------------------
//   Semantic Highlighting Provider
//
//const tokenTypes = new Map<string, number>();
//const tokenModifiers = new Map<string, number>();

interface IParsedToken {
  line: number;
  startCharacter: number;
  length: number;
  ptTokenType: string;
  ptTokenModifiers: string[];
}

export class Spin2ObjectReferenceParser {
  private parseUtils = new Spin2ParseUtils();
  private extensionUtils: ExtensionUtils;

  private bLogStarted: boolean = false;
  // adjust following true/false to show specific parsing debug
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private showCON: boolean = true;
  private showOBJ: boolean = true;
  private showPAsmCode: boolean = true;
  private showState: boolean = true;
  private logTokenDiscover: boolean = true;
  private semanticFindings: DocumentFindings = new DocumentFindings(); // this gets replaced
  private currentFilespec: string = '';
  private isSpin1Document: boolean = false;
  private includingDocumentFilename: string = '';
  private configuration: ServerBehaviorConfiguration;

  public constructor(protected readonly ctx: Context) {
    this.extensionUtils = new ExtensionUtils(ctx, this.isDebugLogEnabled);
    this.configuration = this.ctx.parserConfig; // ensure we have latest
    if (this.isDebugLogEnabled) {
      this.parseUtils.enableLogging(this.ctx);
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        //Create output channel
        this._logMessage('Spin2 Object log started.');
      } else {
        this._logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }

    //this.semanticFindings = new DocumentFindings(this.isDebugLogEnabled, this.spin1log);
  }

  public docFindings(): DocumentFindings {
    return this.semanticFindings;
  }

  public locateReferencedObjects(document: TextDocument, findings: DocumentFindings): void {
    this.semanticFindings = findings;
    if (this.isDebugLogEnabled) {
      this.semanticFindings.enableLogging(this.ctx);
    }
    this.isSpin1Document = isSpin1File(document.uri);
    this.currentFilespec = document.uri;
    this.includingDocumentFilename = path.basename(this.currentFilespec);
    this._logMessage(`* locateReferencedObjects(${this.currentFilespec})`);
    this._parseText(document.getText());
  }

  private _parseText(text: string): IParsedToken[] {
    // parse our entire file
    // if user has enabled flexspin then we hunt for #includes, too!
    this._logMessage(`++ SORP maxNumberOfReportedIssues=(${this.ctx.parserConfig.maxNumberOfReportedIssues})`);
    this._logMessage(`++ SORP highlightFlexspinDirectives=(${this.ctx.parserConfig.highlightFlexspinDirectives})`);
    if (this.ctx.parserConfig.maxNumberOfReportedIssues == -1) {
      this._logMessage('++ SORP WARNING: client configurataion NOT yet available...');
    }
    const lines = text.split(/\r\n|\r|\n/);
    let currState: eParseState = eParseState.inCon; // compiler defaults to CON at start
    let priorState: eParseState = currState;
    //const prePAsmState: eParseState = currState;

    // track block comments
    //const currBlockComment: RememberedComment | undefined = undefined;
    //const currSingleLineBlockComment: RememberedComment | undefined = undefined;

    const tokenSet: IParsedToken[] = [];

    // ==============================================================================
    // prepass to find PRI/PUB method, OBJ names, and VAR/DAT names
    //

    // -------------------- PRE-PARSE just locating symbol names --------------------
    // also track and record block comments (both braces and tic's!)
    // let's also track prior single line and trailing comment on same line
    this._logMessage('---> Pre SCAN');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      const trimmedNonCommentLine = this.parseUtils.getNonCommentLineRemainder(0, line);
      //const offSet: number = trimmedNonCommentLine.length > 0 ? line.indexOf(trimmedNonCommentLine) + 1 : line.indexOf(trimmedLine) + 1;
      //const tempComment = line.substring(trimmedNonCommentLine.length + offSet).trim();
      const sectionStatus = this.extensionUtils.isSectionStartLine(line);
      //const lineParts: string[] = trimmedNonCommentLine.split(/[ \t]/).filter(Boolean);

      // now start our processing
      if (currState == eParseState.inMultiLineComment) {
        // in multi-line non-doc-comment, hunt for end '}' to exit
        // ALLOW {...} on same line without closing!
        let nestedOpeningOffset: number = -1;
        let closingOffset: number = -1;
        let currOffset: number = 0;
        let bFoundOpenClosePair: boolean = false;
        do {
          nestedOpeningOffset = trimmedLine.indexOf('{', currOffset);
          if (nestedOpeningOffset != -1) {
            bFoundOpenClosePair = false;
            // we have an opening {
            closingOffset = trimmedLine.indexOf('}', nestedOpeningOffset);
            if (closingOffset != -1) {
              // and we have a closing, ignore this see if we have next
              currOffset = closingOffset + 1;
              bFoundOpenClosePair = true;
            } else {
              currOffset = nestedOpeningOffset + 1;
            }
          }
        } while (nestedOpeningOffset != -1 && bFoundOpenClosePair);
        closingOffset = trimmedLine.indexOf('}', currOffset);
        if (closingOffset != -1) {
          // have close, comment ended
          currState = priorState;
        }
        //  DO NOTHING Let Syntax highlighting do this
        continue;
      } else if (currState == eParseState.inMultiLineDocComment) {
        // in multi-line doc-comment, hunt for end '}}' to exit
        const closingOffset = line.indexOf('}}');
        if (closingOffset != -1) {
          // have close, comment ended
          currState = priorState;
        }
        //  DO NOTHING Let Syntax highlighting do this
        continue;
      } else if (trimmedLine.length == 0) {
        // a blank line clears pending single line comments
        continue;
      } else if (trimmedLine.startsWith('{{')) {
        // process multi-line doc comment
        const openingOffset = line.indexOf('{{');
        const closingOffset = line.indexOf('}}', openingOffset + 2);
        if (closingOffset != -1) {
          // is single line comment, just ignore it Let Syntax highlighting do this
          // record new single-line comment
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineDocComment;
          //  DO NOTHING Let Syntax highlighting do this
        }
        continue;
      } else if (trimmedLine.startsWith('{')) {
        // process possible multi-line non-doc comment
        // do we have a close on this same line?
        const openingOffset = line.indexOf('{');
        const closingOffset = line.indexOf('}', openingOffset + 1);
        if (closingOffset != -1) {
          // is single line comment...
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineComment;
          //  DO NOTHING Let Syntax highlighting do this
        }
        continue;
      } else if (trimmedLine.startsWith("''")) {
        continue;
      } else if (trimmedLine.startsWith("'")) {
        // process single line non-doc comment
        continue;
      } else if (trimmedLine.startsWith('#include') && this.ctx.parserConfig.highlightFlexspinDirectives == true) {
        // user has enabled FLexspin so let's handle #includes, too
        // Ex: #include "config.spin2"
        const lineParts: string[] = trimmedLine.split('"').filter(Boolean);
        this._logMessage(`- scan Ln#${i + 1} #include lineParts=[${lineParts}](${lineParts.length})`);
        // lineParts should now be ["#include ", "config.spin2"]
        if (lineParts.length >= 2) {
          const filename: string = lineParts[1];
          this._logMessage(`  -- ADD file [${filename}] included by [${this.includingDocumentFilename}]`);
          this.semanticFindings.recordIncludeByWhom(this.includingDocumentFilename, filename);
        } else {
          this._logMessage(`ERROR: bad parse of #include Ln#${i + 1} [${trimmedLine}]`);
        }
      } else if (sectionStatus.isSectionStart) {
        // mark end of method, if we were in a method
        currState = sectionStatus.inProgressStatus;

        // record start of next block in code
        //this._logState("- scan Ln#" + (i + 1) + " currState=[" + currState + "]");
        // ID the remainder of the line
        if (currState == eParseState.inPub || currState == eParseState.inPri) {
          // process PUB/PRI method signature
        } else if (currState == eParseState.inCon) {
          // process a constant line
          this._logState('- scan Ln#' + (i + 1) + ' currState=[' + currState + ']');
          if (trimmedNonCommentLine.length > 3) {
            this._getCON_Declaration(3, i + 1, line);
          }
        } else if (currState == eParseState.inDat) {
          // process a class(static) variable line
        } else if (currState == eParseState.inObj) {
          // process an object line
          this._logState('- scan Ln#' + (i + 1) + ' currState=[' + currState + ']');
          if (trimmedNonCommentLine.length > 3) {
            this._getOBJ_Declaration(3, i + 1, line);
          }
        } else if (currState == eParseState.inVar) {
          // process a instance-variable line
        }
        continue;
      } else if (currState == eParseState.inCon) {
        // process a constant line
        if (trimmedLine.length > 0) {
          this._getCON_Declaration(0, i + 1, line);
        }
      } else if (currState == eParseState.inDat) {
        // process a data line
      } else if (currState == eParseState.inVar) {
        // process a variable declaration line
      } else if (currState == eParseState.inObj) {
        // process an object declaration line
        if (trimmedLine.length > 0) {
          this._getOBJ_Declaration(0, i + 1, line);
        }
      } else if (currState == eParseState.inDatPAsm) {
        // process pasm (assembly) lines
      } else if (currState == eParseState.inPub || currState == eParseState.inPri) {
        // scan SPIN2 line for object constant or method() uses
      }
    }

    // --------------------         End of PRE-PARSE             --------------------
    this._logMessage('---- Object Reference Parse DONE ----\n');
    return tokenSet;
  }

  private _getCON_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE    DIGIT_NO_VALUE = -2   ' digit value when NOT [0-9]
    //  -or-     _clkmode = xtal1 + pll16x
    //
    const isPreprocessorStatement: boolean = this.parseUtils.lineStartsWithFlexspinPreprocessorDirective(line);
    if (isPreprocessorStatement == false && line.substr(startingOffset).length > 1) {
      //skip Past Whitespace
      let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
      const nonCommentConstantLine = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
      this._logCON(`  - Ln#${lineNbr} SORP GetCONDecl nonCommentConstantLine=[${nonCommentConstantLine}]`);

      const haveEnumDeclaration: boolean = nonCommentConstantLine.startsWith('#');
      const containsMultiAssignments: boolean = nonCommentConstantLine.indexOf(',') != -1;
      let statements: string[] = [nonCommentConstantLine];
      if (!haveEnumDeclaration && containsMultiAssignments) {
        statements = nonCommentConstantLine.split(',');
      }
      this._logCON('  -- statements=[' + statements + ']');
      for (let index = 0; index < statements.length; index++) {
        const conDeclarationLine: string = statements[index].trim();
        this._logCON('  -- conDeclarationLine=[' + conDeclarationLine + ']');
        currentOffset = line.indexOf(conDeclarationLine, currentOffset);
        const assignmentOffset: number = conDeclarationLine.indexOf('=');
        if (assignmentOffset != -1) {
          // recognize constant name getting initialized via assignment
          // get line parts - we only care about first one
          const lineParts: string[] = line
            .substring(currentOffset)
            .split(/[ \t=]/)
            .filter(Boolean);
          this._logCON(`  -- GLBL GetCONDecl SPLIT lineParts=[${lineParts.join(',')}](${lineParts.length})`);
          const newName = lineParts[0];
          if (newName !== undefined && newName.charAt(0).match(/[a-zA-Z_]/)) {
            this._logCON(`  -- GLBL GetCONDecl newName=[${newName}]`);
            // remember this object name so we can annotate a call to it
          }
          const containsObjectReferences: boolean = nonCommentConstantLine.indexOf('.') != -1;
          if (containsObjectReferences) {
            const assignmentRHS = nonCommentConstantLine.substring(assignmentOffset + 1).trim();
            this._logCON('  -- GLBL GetCONDecl assignmentRHS=[' + assignmentRHS + ']');
            const lineParts: string[] = assignmentRHS.split(/[ \t]/).filter(Boolean);
            this._logCON('  -- GLBL GetCONDecl lineParts=[' + lineParts + ']');
            for (let partIdx = 0; partIdx < lineParts.length; partIdx++) {
              const nameForEval: string = lineParts[partIdx];
              if (nameForEval.includes('.')) {
                // SPIN1 have object.constant reference
                const refParts: string[] = nameForEval.split('.');
                if (refParts.length == 2) {
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  const objName = refParts[0];
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  const childConstantName = refParts[1];
                }
              }
            }
          }
        } else {
          // recognize enum values getting initialized
          const lineParts: string[] = conDeclarationLine.split(/[ \t,]/).filter(Boolean);
          //this._logCON('  -- lineParts=[' + lineParts + ']');
          for (let index = 0; index < lineParts.length; index++) {
            let enumConstant: string = lineParts[index];
            // our enum name can have a step offset
            if (enumConstant.includes('[')) {
              // it does, isolate name from offset
              const enumNameParts: string[] = enumConstant.split('[');
              enumConstant = enumNameParts[0];
            }
            if (enumConstant.charAt(0).match(/[a-zA-Z_]/)) {
              this._logCON('  -- GLBL enumConstant=[' + enumConstant + ']');
              const nameOffset = line.indexOf(enumConstant, currentOffset); // FIXME: UNDONE, do we have to dial this in?
              this.semanticFindings.setGlobalToken(enumConstant, new RememberedToken('enumMember', lineNbr - 1, nameOffset, ['readonly']), undefined);
            }
          }
        }
      }
    }
  }

  private _getOBJ_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // parse P1 and P2 spin!
    // HAVE    color           : "isp_hub75_color"
    //  -or-   segments[7]     : "isp_hub75_segment"
    //  -or-   segments[7]     : "isp_hub75_segment" | BUFF_SIZE = 2
    //
    //skip Past Whitespace
    const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    //this._logOBJ('- RptObjDecl remainingNonCommentLineStr=[' + remainingNonCommentLineStr + ']');
    if (remainingNonCommentLineStr.length > 5 && remainingNonCommentLineStr.includes(':') && remainingNonCommentLineStr.includes('"')) {
      // get line parts - we only care about first one
      const overrideParts: string[] = remainingNonCommentLineStr.split('|').filter(Boolean);
      const lineParts: string[] = overrideParts[0].split(':').filter(Boolean);
      this._logOBJ('  -- SORP GLBL GetOBJDecl lineParts=[' + lineParts + ']');
      let instanceNamePart = lineParts[0].trim();
      // if we have instance array declaration, then remove it
      if (instanceNamePart.includes('[')) {
        const nameParts = instanceNamePart.split(/[[\]]/).filter(Boolean);
        instanceNamePart = nameParts[0];
      }
      this._logOBJ(`  -- GLBL GetOBJDecl newInstanceName=[${instanceNamePart}]`);
      // remember this object name so we can annotate a call to it
      const filenamePart = lineParts.length > 1 ? lineParts[1].trim().replace(/["]/g, '') : '';
      this._logOBJ(`  -- GLBL GetOBJDecl newFileName=[${filenamePart}]`);
      if (filenamePart.length > 0) {
        this.semanticFindings.recordObjectImport(instanceNamePart, filenamePart);
      }
    }
  }

  private _logState(message: string): void {
    if (this.showState) {
      this._logMessage(message);
    }
  }

  private _logCON(message: string): void {
    if (this.showCON) {
      this._logMessage(message);
    }
  }

  private _logOBJ(message: string): void {
    if (this.showOBJ) {
      this._logMessage(message);
    }
  }

  private _logPASM(message: string): void {
    if (this.showPAsmCode) {
      this._logMessage(message);
    }
  }

  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled) {
      //Write to output window.
      this.ctx.logger.log(message);
    }
  }
}
