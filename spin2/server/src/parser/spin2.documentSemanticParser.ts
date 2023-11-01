"use strict";
// src/spin2.documentSemanticParser.ts

import { TextDocument } from "vscode-languageserver-textdocument";
import { Context, ServerBehaviorConfiguration } from "../context";

import { DocumentFindings, RememberedComment, eCommentType, RememberedToken, eBLockType, IParsedToken, eSeverity } from "./spin.semantic.findings";
import { Spin2ParseUtils } from "./spin2.utils";
import { isSpin1File } from "./lang.utils";
import { eParseState, eDebugDisplayType } from "./spin.common";
import { fileInDirExists } from "../files";
import { TypeHierarchyFeature } from "vscode-languageserver/lib/common/typeHierarchy";

// ----------------------------------------------------------------------------
//   Semantic Highlighting Provider
//
const tokenTypes = new Map<string, number>();
const tokenModifiers = new Map<string, number>();

interface IFilteredStrings {
  lineNoQuotes: string;
  lineParts: string[];
}

enum eSpin2Directive {
  Unknown = 0,
  s2dDebugDisplayForLine,
}
interface ISpin2Directive {
  lineNumber: number;
  displayType: string;
  eDisplayType: eDebugDisplayType;
}

// map of display-type to etype'
export class Spin2DocumentSemanticParser {
  private parseUtils = new Spin2ParseUtils();
  //private docGenerator: DocGenerator;

  private bLogStarted: boolean = false;
  // adjust following true/false to show specific parsing debug
  private spin2DebugLogEnabled: boolean = true; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private showSpinCode: boolean = true;
  private showPreProc: boolean = true;
  private showCON: boolean = true;
  private showOBJ: boolean = true;
  private showDAT: boolean = true;
  private showVAR: boolean = true;
  private showDEBUG: boolean = true;
  private showPAsmCode: boolean = true;
  private showState: boolean = true;
  private logTokenDiscover: boolean = true;

  private semanticFindings: DocumentFindings = new DocumentFindings(); // this gets replaced
  private conEnumInProgress: boolean = false;

  // list of directives found in file
  private fileDirectives: ISpin2Directive[] = [];

  private configuration: ServerBehaviorConfiguration;

  private currentMethodName: string = "";
  private currentFilespec: string = "";
  private isSpin1Document: boolean = false;
  private directory: string = "";

  private bRecordTrailingComments: boolean = false; // initially, we don't generate tokens for trailing comments on lines

  public constructor(protected readonly ctx: Context) {
    //this.docGenerator = sharedDocGenerator;
    this.configuration = ctx.parserConfig;
    if (this.spin2DebugLogEnabled) {
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        //Create output channel
        this._logMessage("Spin2 semantic log started.");
      } else {
        this._logMessage("\n\n------------------   NEW FILE ----------------\n\n");
      }
    }
  }

  //async provideDocumentSemanticTokens(document: vscode.TextDocument, cancelToken: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
  // SEE https://www.codota.com/code/javascript/functions/vscode/CancellationToken/isCancellationRequested
  //if (cancelToken) {
  //} // silence our compiler for now... TODO: we should adjust loop so it can break on cancelToken.isCancellationRequested
  public reportDocumentSemanticTokens(document: TextDocument, findings: DocumentFindings, dirSpec: string): void {
    this.semanticFindings = findings;
    this.directory = dirSpec;
    if (this.spin2DebugLogEnabled) {
      this.semanticFindings.enableLogging(this.ctx);
      this.parseUtils.enableLogging(this.ctx);
    }
    this.configuration = this.ctx.parserConfig; // ensure we have latest
    this.isSpin1Document = isSpin1File(document.uri);
    this._logMessage("* Config: highlightFlexspinDirectives: [" + this.configuration.highlightFlexspinDirectives + "]");
    this.currentFilespec = document.uri;
    this._logMessage(`* reportDocumentSemanticTokens(${this.currentFilespec})`);
    this._logMessage(`* ------  into findings=[${findings.instanceName()}]`);

    // retrieve tokens to highlight, post to DocumentFindings
    const allTokens = this._parseText(document.getText());
    allTokens.forEach((token) => {
      this.semanticFindings.pushSemanticToken(token);
    });
  }

  // track comment preceding declaration line
  private priorSingleLineComment: string | undefined = undefined;
  private rightEdgeComment: string | undefined = undefined;

  private _declarationComment(): string | undefined {
    // return the most appropriate comment for declaration
    const desiredComment: string | undefined = this.priorSingleLineComment ? this.priorSingleLineComment : this.rightEdgeComment;
    // and clear them out since we used them
    this.priorSingleLineComment = undefined;
    this.rightEdgeComment = undefined;
    return desiredComment;
  }

  private _parseText(text: string): IParsedToken[] {
    // parse our entire file
    const lines = text.split(/\r\n|\r|\n/);
    let currState: eParseState = eParseState.inCon; // compiler defaults to CON at start
    let priorState: eParseState = currState;
    let prePAsmState: eParseState = currState;

    // track block comments
    let currBlockComment: RememberedComment | undefined = undefined;
    let currSingleLineBlockComment: RememberedComment | undefined = undefined;

    const tokenSet: IParsedToken[] = [];

    // ==============================================================================
    // prepass to find declarations: PRI/PUB method, OBJ names, and VAR/DAT names
    //

    // -------------------- PRE-PARSE just locating symbol names --------------------
    // also track and record block comments (both braces and tic's!)
    // let's also track prior single line and trailing comment on same line
    this._logMessage(`---> Pre SCAN -- `);
    let bBuildingSingleLineCmtBlock: boolean = false;
    let bBuildingSingleLineDocCmtBlock: boolean = false;
    this.semanticFindings.recordBlockStart(eBLockType.isCon, 0); // spin file defaults to CON at 1st line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      const trimmedNonCommentLine: string = trimmedLine.length > 0 ? this.parseUtils.getNonCommentLineRemainder(0, line) : "";
      const offSet: number = trimmedNonCommentLine.length > 0 ? line.indexOf(trimmedNonCommentLine) + 1 : line.indexOf(trimmedLine) + 1;
      const tempComment = line.substring(trimmedNonCommentLine.length + offSet).trim();
      this.rightEdgeComment = tempComment.length > 0 ? tempComment : undefined;
      const sectionStatus = this._isSectionStartLine(line);
      const lineParts: string[] = trimmedNonCommentLine.split(/[ \t]/);

      // special blocks of doc-comment and non-doc comment lines handling
      if (bBuildingSingleLineDocCmtBlock && !trimmedLine.startsWith("''")) {
        // process single line doc-comment
        bBuildingSingleLineDocCmtBlock = false;
        // add record single line comment block if > 1 line and clear
        if (currSingleLineBlockComment) {
          currSingleLineBlockComment.closeAsSingleLineBlock(i - 1);
          // NOTE: single line doc comments can be 1 line long!!! (unlike single line non-doc comments)
          this._logMessage("  -- found comment " + currSingleLineBlockComment.spanString());
          this.semanticFindings.recordComment(currSingleLineBlockComment);
          currSingleLineBlockComment = undefined;
        }
      } else if (bBuildingSingleLineCmtBlock && !trimmedLine.startsWith("'")) {
        // process single line non-doc comment
        bBuildingSingleLineCmtBlock = false;
        // add record single line comment block if > 1 line and clear
        if (currSingleLineBlockComment) {
          // NOTE: single line non-doc comments must be 2 or more lines long!!! (unlike single line doc comments)
          if (currSingleLineBlockComment.lineCount > 1) {
            currSingleLineBlockComment.closeAsSingleLineBlock(i - 1);
            this._logMessage("  -- found comment " + currSingleLineBlockComment.spanString());
            this.semanticFindings.recordComment(currSingleLineBlockComment);
          }
          currSingleLineBlockComment = undefined;
        }
      }

      // now start our processing
      if (currState == eParseState.inMultiLineComment) {
        // in multi-line non-doc-comment, hunt for end '}' to exit
        // ALLOW {...} on same line without closing!
        let nestedOpeningOffset: number = -1;
        let closingOffset: number = -1;
        let currOffset: number = 0;
        let bFoundOpenClosePair: boolean = false;
        do {
          nestedOpeningOffset = trimmedLine.indexOf("{", currOffset);
          if (nestedOpeningOffset != -1) {
            bFoundOpenClosePair = false;
            // we have an opening {
            closingOffset = trimmedLine.indexOf("}", nestedOpeningOffset);
            if (closingOffset != -1) {
              // and we have a closing, ignore this see if we have next
              currOffset = closingOffset + 1;
              bFoundOpenClosePair = true;
            } else {
              currOffset = nestedOpeningOffset + 1;
            }
          }
        } while (nestedOpeningOffset != -1 && bFoundOpenClosePair);
        closingOffset = trimmedLine.indexOf("}", currOffset);
        if (closingOffset != -1) {
          // have close, comment ended
          // end the comment recording
          currBlockComment?.appendLastLine(i, line);
          // record new comment
          if (currBlockComment) {
            this.semanticFindings.recordComment(currBlockComment);
            this._logMessage("  -- found comment " + currBlockComment.spanString());
            currBlockComment = undefined;
          }
          currState = priorState;
        } else {
          // add line to the comment recording
          currBlockComment?.appendLine(line);
        }
        //  DO NOTHING Let Syntax highlighting do this
        continue;
      } else if (currState == eParseState.inMultiLineDocComment) {
        // in multi-line doc-comment, hunt for end '}}' to exit
        let closingOffset = line.indexOf("}}");
        if (closingOffset != -1) {
          // have close, comment ended
          // end the comment recording
          currBlockComment?.appendLastLine(i, line);
          // record new comment
          if (currBlockComment) {
            this.semanticFindings.recordComment(currBlockComment);
            this._logMessage("  -- found comment " + currBlockComment.spanString());
            currBlockComment = undefined;
          }
          currState = priorState;
        } else {
          // add line to the comment recording
          currBlockComment?.appendLine(line);
        }
        //  DO NOTHING Let Syntax highlighting do this
        continue;
      } else if (trimmedLine.length == 0) {
        // a blank line clears pending single line comments
        this.priorSingleLineComment = undefined;
        continue;
      } else if (this.parseUtils.isFlexspinPreprocessorDirective(lineParts[0])) {
        this._getFlexspinPreProcessor_Declaration(0, i + 1, line);
        // a FlexspinPreprocessorDirective line clears pending single line comments
        this.priorSingleLineComment = undefined;
        continue;
      } else if (trimmedLine.startsWith("{{")) {
        // process multi-line doc comment
        let openingOffset = line.indexOf("{{");
        const closingOffset = line.indexOf("}}", openingOffset + 2);
        if (closingOffset != -1) {
          // is single line comment, just ignore it Let Syntax highlighting do this
          // record new single-line comment
          let oneLineComment = new RememberedComment(eCommentType.multiLineDocComment, i, line);
          oneLineComment.closeAsSingleLine();
          if (!oneLineComment.isBlankLine) {
            this.semanticFindings.recordComment(oneLineComment);
            this._logMessage("  -- found comment " + oneLineComment.spanString());
          }
          currBlockComment = undefined; // just making sure...
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineDocComment;
          // start  NEW comment
          currBlockComment = new RememberedComment(eCommentType.multiLineDocComment, i, line);
          //  DO NOTHING Let Syntax highlighting do this
          continue; // only SKIP if we don't have closing marker
        }
      } else if (trimmedLine.startsWith("{")) {
        // process possible multi-line non-doc comment
        // do we have a close on this same line?
        let openingOffset = line.indexOf("{");
        const closingOffset = line.indexOf("}", openingOffset + 1);
        if (closingOffset != -1) {
          // is single line comment, we can have Spin2 Directive in here
          this._getSpin2_Directive(0, i + 1, line);
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineComment;
          // start  NEW comment
          currBlockComment = new RememberedComment(eCommentType.multiLineComment, i, line);
          //  DO NOTHING Let Syntax highlighting do this
          continue; // only SKIP if we don't have closing marker
        }
      } else if (bBuildingSingleLineDocCmtBlock && trimmedLine.startsWith("''")) {
        // process single line doc comment which follows one of same
        // we no longer have a prior single line comment
        this.priorSingleLineComment = undefined;
        // add to existing single line doc-comment block
        currSingleLineBlockComment?.appendLine(line);
        continue;
      } else if (bBuildingSingleLineCmtBlock && trimmedLine.startsWith("'")) {
        // process single line non-doc comment which follows one of same
        // we no longer have a prior single line comment
        this.priorSingleLineComment = undefined;
        // add to existing single line non-doc-comment block
        currSingleLineBlockComment?.appendLine(line);
        continue;
      } else if (trimmedLine.startsWith("''")) {
        // process single line doc comment
        this.priorSingleLineComment = trimmedLine; // record this line
        // create new single line doc-comment block
        bBuildingSingleLineDocCmtBlock = true;
        currSingleLineBlockComment = new RememberedComment(eCommentType.singleLineDocComment, i, line);
        continue;
      } else if (trimmedLine.startsWith("'")) {
        // process single line non-doc comment
        this.priorSingleLineComment = trimmedLine; // record this line
        // create new single line non-doc-comment block
        bBuildingSingleLineCmtBlock = true;
        currSingleLineBlockComment = new RememberedComment(eCommentType.singleLineComment, i, line);
        continue;
      } else if (sectionStatus.isSectionStart) {
        // mark end of method, if we were in a method
        this.semanticFindings.endPossibleMethod(i); // pass prior line number! essentially i+1 (-1)

        currState = sectionStatus.inProgressStatus;
        // record start of next block in code
        //  NOTE: this causes end of prior block to be recorded
        let newBlockType: eBLockType = eBLockType.Unknown;
        if (currState == eParseState.inCon) {
          newBlockType = eBLockType.isCon;
        } else if (currState == eParseState.inDat) {
          newBlockType = eBLockType.isDat;
        } else if (currState == eParseState.inVar) {
          newBlockType = eBLockType.isVar;
        } else if (currState == eParseState.inObj) {
          newBlockType = eBLockType.isObj;
        } else if (currState == eParseState.inPub) {
          newBlockType = eBLockType.isPub;
        } else if (currState == eParseState.inPri) {
          newBlockType = eBLockType.isPri;
        }
        this.semanticFindings.recordBlockStart(newBlockType, i); // start new one which ends prior

        this._logState("- scan Ln#" + (i + 1) + " currState=[" + currState + "]");
        // ID the remainder of the line
        if (currState == eParseState.inPub || currState == eParseState.inPri) {
          // process PUB/PRI method signature
          if (trimmedNonCommentLine.length > 3) {
            this._getPUB_PRI_Name(3, i + 1, line);
            // and record our fake signature for later use by signature help
            const docComment: RememberedComment = this._generateFakeCommentForSignature(0, i + 1, line);
            if (docComment._type != eCommentType.Unknown) {
              this.semanticFindings.recordFakeComment(docComment);
            } else {
              this._logState("- scan Ln#" + (i + 1) + " no FAKE doc comment for this signature");
            }
          }
        } else if (currState == eParseState.inCon) {
          // process a constant line
          if (trimmedNonCommentLine.length > 3) {
            this._getCON_Declaration(3, i + 1, line);
          }
        } else if (currState == eParseState.inDat) {
          // process a class(static) variable line
          if (trimmedNonCommentLine.length > 6 && trimmedNonCommentLine.toUpperCase().includes("ORG")) {
            // ORG, ORGF, ORGH
            const nonStringLine: string = this.parseUtils.removeDoubleQuotedStrings(trimmedNonCommentLine);
            if (nonStringLine.toUpperCase().includes("ORG")) {
              this._logPASM("- (" + (i + 1) + "): pre-scan DAT line trimmedLine=[" + trimmedLine + "] now Dat PASM");
              // record start of PASM code NOT inline
              this.semanticFindings.recordPasmStart(i, false);
              prePAsmState = currState;
              currState = eParseState.inDatPAsm;
              this._getDAT_Declaration(0, i + 1, line); // let's get possible label on this ORG statement
              continue;
            }
          }
          this._getDAT_Declaration(0, i + 1, line);
        } else if (currState == eParseState.inObj) {
          // process an object line
          if (trimmedNonCommentLine.length > 3) {
            this._getOBJ_Declaration(3, i + 1, line);
          }
        } else if (currState == eParseState.inVar) {
          // process a instance-variable line
          if (trimmedNonCommentLine.length > 3) {
            this._getVAR_Declaration(3, i + 1, line);
          }
        }
        // we processed the block declaration line, now wipe out prior comment
        this.priorSingleLineComment = undefined; // clear it out...
        continue;
      } else if (currState == eParseState.inCon) {
        // process a constant line
        if (trimmedLine.length > 0) {
          this._getCON_Declaration(0, i + 1, line);
        }
      } else if (currState == eParseState.inDat) {
        // process a data line
        if (trimmedLine.length > 0) {
          if (trimmedLine.toUpperCase().includes("ORG")) {
            // ORG, ORGF, ORGH
            const nonStringLine: string = this.parseUtils.removeDoubleQuotedStrings(trimmedLine);
            if (nonStringLine.toUpperCase().includes("ORG")) {
              this._logPASM("- (" + (i + 1) + "): pre-scan DAT line trimmedLine=[" + trimmedLine + "] now Dat PASM");
              // record start of PASM code NOT inline
              this.semanticFindings.recordPasmStart(i, false);
              prePAsmState = currState;
              currState = eParseState.inDatPAsm;
              this._getDAT_Declaration(0, i + 1, line); // let's get possible label on this ORG statement
              continue;
            }
          }
          this._getDAT_Declaration(0, i + 1, line); // get label from line in DAT BLOCK
        }
      } else if (currState == eParseState.inVar) {
        // process a variable declaration line
        if (trimmedLine.length > 0) {
          this._getVAR_Declaration(0, i + 1, line);
        }
      } else if (currState == eParseState.inObj) {
        // process an object declaration line
        if (trimmedLine.length > 0) {
          this._getOBJ_Declaration(0, i + 1, line);
        }
      } else if (currState == eParseState.inPAsmInline) {
        // process pasm (assembly) lines
        if (trimmedLine.length > 0) {
          const lineParts: string[] = trimmedLine.split(/[ \t]/);
          if (lineParts.length > 0 && lineParts[0].toUpperCase() == "END") {
            this._logPASM("- (" + (i + 1) + "): pre-scan SPIN PASM line trimmedLine=[" + trimmedLine + "]");
            // record start of PASM code inline
            this.semanticFindings.recordPasmEnd(i);
            currState = prePAsmState;
            this._logState("- scan Ln#" + (i + 1) + " POP currState=[" + currState + "]");
            // and ignore rest of this line
          } else {
            this._getSPIN_PAsmDeclaration(0, i + 1, line);
            // scan SPIN-Inline-PAsm line for debug() display declaration
            this._getDebugDisplay_Declaration(0, i + 1, line);
          }
        }
      } else if (currState == eParseState.inDatPAsm) {
        // process pasm (assembly) lines
        if (trimmedLine.length > 0) {
          const isDebugLine: boolean = trimmedNonCommentLine.toLowerCase().includes("debug(");
          const lineParts: string[] = trimmedLine.split(/[ \t]/);
          if (lineParts.length > 0) {
            if (lineParts[0].toUpperCase() == "FIT") {
              this._logPASM("- (" + (i + 1) + "): pre-scan DAT PASM line trimmedLine=[" + trimmedLine + "]");
              // record start of PASM code NOT inline
              this.semanticFindings.recordPasmEnd(i);
              currState = prePAsmState;
              this._logState("- scan Ln#" + (i + 1) + " POP currState=[" + currState + "]");
              // and ignore rest of this line
            } else {
              this._getDAT_PAsmDeclaration(0, i + 1, line);
              if (isDebugLine) {
                // scan DAT-PAsm line for debug() display declaration
                this._getDebugDisplay_Declaration(0, i + 1, line);
              }
            }
          }
        }
      } else if (currState == eParseState.inPub || currState == eParseState.inPri) {
        // Detect start of INLINE PASM - org detect
        // NOTE: The directives ORGH, ALIGNW, ALIGNL, and FILE are not allowed within in-line PASM code.
        if (trimmedLine.length > 0) {
          const isDebugLine: boolean = trimmedNonCommentLine.toLowerCase().includes("debug(");
          const lineParts: string[] = trimmedLine.split(/[ \t]/);
          if (lineParts.length > 0 && lineParts[0].toUpperCase() == "ORG") {
            // Only ORG, not ORGF or ORGH
            this._logPASM("- (" + (i + 1) + "): pre-scan PUB/PRI line trimmedLine=[" + trimmedLine + "]");
            // record start of PASM code NOT inline
            this.semanticFindings.recordPasmStart(i, true);
            prePAsmState = currState;
            currState = eParseState.inPAsmInline;
            // and ignore rest of this line
          } else {
            if (isDebugLine) {
              // scan SPIN2 line for debug() display declaration
              this._getDebugDisplay_Declaration(0, i + 1, line);
            } else {
              // scan SPIN2 line for object constant or method() uses
              //this._getSpin2ObjectConstantMethodDeclaration(0, i + 1, line);
            }
          }
        }
      }
      // we processed statements in this line, now clear prior comment associated with this line
      this.priorSingleLineComment = undefined; // clear it out...
    }
    this.semanticFindings.endPossibleMethod(lines.length); // report end if last line of file(+1 since method wants line number!)
    this.semanticFindings.finishFinalBlock(lines.length - 1); // mark end of final block in file

    // --------------------         End of PRE-PARSE             --------------------
    this._logMessage("--->             <---");
    this._logMessage("---> Actual SCAN");

    this.bRecordTrailingComments = true; // from here forward generate tokens for trailing comments on lines

    //
    // Final PASS to identify all name references
    //
    currState = eParseState.inCon; // reset for 2nd pass - compiler defaults to CON at start
    priorState = currState; // reset for 2nd pass
    prePAsmState = currState; // same

    // for each line do...
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      const sectionStatus = this._isSectionStartLine(line);
      const lineParts: string[] = trimmedLine.split(/[ \t]/);
      // TODO: UNDONE add filter which corrects for syntax inability to mark 'comments when more than one "'" present on line!
      //if (trimmedLine.length > 2 && trimmedLine.includes("'")) {
      //    const partialTokenSet: IParsedToken[] = this._possiblyMarkBrokenSingleLineComment(i, 0, line);
      //    partialTokenSet.forEach(newToken => {
      //        tokenSet.push(newToken);
      //    });
      //}
      if (currState == eParseState.inMultiLineComment) {
        // in multi-line non-doc-comment, hunt for end '}' to exit
        // ALLOW {...} on same line without closing!
        this._logMessage("    hunt for '}' Ln#" + (i + 1) + " trimmedLine=[" + trimmedLine + "]");
        let nestedOpeningOffset: number = -1;
        let closingOffset: number = -1;
        let currOffset: number = 0;
        let bFoundOpenClosePair: boolean = false;
        let bFoundNestedOpen: boolean = false;
        do {
          nestedOpeningOffset = trimmedLine.indexOf("{", currOffset);
          if (nestedOpeningOffset != -1) {
            bFoundOpenClosePair = false;
            bFoundNestedOpen = true;
            // we have an opening {
            closingOffset = trimmedLine.indexOf("}", nestedOpeningOffset);
            if (closingOffset != -1) {
              // and we have a closing, ignore this see if we have next
              currOffset = closingOffset + 1;
              bFoundOpenClosePair = true;
              this._logMessage("    skip {...} Ln#" + (i + 1) + " nestedOpeningOffset=(" + nestedOpeningOffset + "), closingOffset=(" + closingOffset + ")");
            } else {
              currOffset = nestedOpeningOffset + 1;
            }
          }
        } while (nestedOpeningOffset != -1 && bFoundOpenClosePair);
        closingOffset = trimmedLine.indexOf("}", currOffset);
        if (closingOffset != -1) {
          // have close, comment ended
          this._logMessage("    FOUND '}' Ln#" + (i + 1) + " trimmedLine=[" + trimmedLine + "]");
          currState = priorState;
        }
        continue;
      } else if (currState == eParseState.inMultiLineDocComment) {
        // in multi-line doc-comment, hunt for end '}}' to exit
        let closingOffset = line.indexOf("}}");
        if (closingOffset != -1) {
          // have close, comment ended
          currState = priorState;
        }
        //  DO NOTHING Let Syntax highlighting do this
      } else if (this.parseUtils.isFlexspinPreprocessorDirective(lineParts[0])) {
        const partialTokenSet: IParsedToken[] = this._reportFlexspinPreProcessorLine(i, 0, line);
        partialTokenSet.forEach((newToken) => {
          this._logPreProc("=> PreProc: " + this._tokenString(newToken, line));
          tokenSet.push(newToken);
        });
        continue;
      } else if (sectionStatus.isSectionStart) {
        currState = sectionStatus.inProgressStatus;
        this.conEnumInProgress = false; // tell in CON processor we are not in an enum mulit-line declaration
        this._logState("  -- Ln#" + (i + 1) + " currState=[" + currState + "]");
        // ID the section name
        // DON'T mark the section literal, Syntax highlighting does this well!

        // ID the remainder of the line
        if (currState == eParseState.inPub || currState == eParseState.inPri) {
          // process method signature
          if (line.length > 3) {
            const partialTokenSet: IParsedToken[] = this._reportPUB_PRI_Signature(i, 3, line);
            partialTokenSet.forEach((newToken) => {
              tokenSet.push(newToken);
            });
          }
        } else if (currState == eParseState.inCon) {
          // process a possible constant use on the CON line itself!
          if (line.length > 3) {
            const partialTokenSet: IParsedToken[] = this._reportCON_DeclarationLine(i, 3, line);
            partialTokenSet.forEach((newToken) => {
              this._logCON("=> CON: " + this._tokenString(newToken, line));
              tokenSet.push(newToken);
            });
          } else {
            this.conEnumInProgress = false; // so we can tell in CON processor when to allow isolated names
          }
        } else if (currState == eParseState.inDat) {
          // process a possible constant use on the DAT line itself!
          if (line.length > 3) {
            if (trimmedLine.length > 6) {
              const nonCommentLineRemainder: string = this.parseUtils.getNonCommentLineRemainder(0, trimmedLine);
              let orgStr: string = "ORGH";
              let orgOffset: number = nonCommentLineRemainder.toUpperCase().indexOf(orgStr); // ORGH
              if (orgOffset == -1) {
                orgStr = "ORGF";
                orgOffset = nonCommentLineRemainder.toUpperCase().indexOf(orgStr); // ORGF
                if (orgOffset == -1) {
                  orgStr = "ORG";
                  orgOffset = nonCommentLineRemainder.toUpperCase().indexOf(orgStr); // ORG
                }
              }
              if (orgOffset != -1) {
                // let's double check this is NOT in quoted string
                const nonStringLine: string = this.parseUtils.removeDoubleQuotedStrings(nonCommentLineRemainder);
                orgOffset = nonStringLine.toUpperCase().indexOf(orgStr); // ORG, ORGF, ORGH
              }
              if (orgOffset != -1) {
                this._logPASM("- (" + (i + 1) + "): scan DAT line nonCommentLineRemainder=[" + nonCommentLineRemainder + "]");

                // process remainder of ORG line
                const nonCommentOffset = line.indexOf(nonCommentLineRemainder, 0);
                // lineNumber, currentOffset, line, allowLocalVarStatus, this.showPAsmCode
                const allowLocalVarStatus: boolean = false;
                const NOT_DAT_PASM: boolean = false;
                const partialTokenSet: IParsedToken[] = this._reportDAT_ValueDeclarationCode(i, nonCommentOffset + orgOffset + orgStr.length, line, allowLocalVarStatus, this.showDAT, NOT_DAT_PASM);
                partialTokenSet.forEach((newToken) => {
                  tokenSet.push(newToken);
                });

                prePAsmState = currState;
                currState = eParseState.inDatPAsm;
                // and ignore rest of this line
                continue;
              }
            }
            const partialTokenSet: IParsedToken[] = this._reportDAT_DeclarationLine(i, 3, line);
            partialTokenSet.forEach((newToken) => {
              tokenSet.push(newToken);
            });
          }
        } else if (currState == eParseState.inObj) {
          // process a possible constant use on the CON line itself!
          if (line.length > 3) {
            const partialTokenSet: IParsedToken[] = this._reportOBJ_DeclarationLine(i, 3, line);
            partialTokenSet.forEach((newToken) => {
              this._logOBJ("=> OBJ: " + this._tokenString(newToken, line));
              tokenSet.push(newToken);
            });
          }
        } else if (currState == eParseState.inVar) {
          // process a possible constant use on the CON line itself!
          if (line.length > 3) {
            const partialTokenSet: IParsedToken[] = this._reportVAR_DeclarationLine(i, 3, line);
            partialTokenSet.forEach((newToken) => {
              tokenSet.push(newToken);
            });
          }
        }
      } else if (trimmedLine.startsWith("''")) {
        // process single line doc comment
        //  DO NOTHING Let Syntax highlighting do this
      } else if (trimmedLine.startsWith("'")) {
        // process single line non-doc comment
        //  DO NOTHING Let Syntax highlighting do this
      } else if (trimmedLine.startsWith("{{")) {
        // process multi-line doc comment
        let openingOffset = line.indexOf("{{");
        const closingOffset = line.indexOf("}}", openingOffset + 2);
        if (closingOffset != -1) {
          // is single line comment, just ignore it Let Syntax highlighting do this
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineDocComment;
          //  DO NOTHING Let Syntax highlighting do this
        }
      } else if (trimmedLine.startsWith("{")) {
        // process possible multi-line non-doc comment
        // do we have a close on this same line?
        let openingOffset = line.indexOf("{");
        const closingOffset = line.indexOf("}", openingOffset + 1);
        if (closingOffset != -1) {
          // is single line comment, just ignore it Let Syntax highlighting do this
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineComment;
          //  DO NOTHING Let Syntax highlighting do this
        }
      } else if (currState == eParseState.inCon) {
        // process a line in a constant section
        if (trimmedLine.length > 0) {
          this._logCON("- process CON line(" + (i + 1) + "):  trimmedLine=[" + trimmedLine + "]");
          const partialTokenSet: IParsedToken[] = this._reportCON_DeclarationLine(i, 0, line);
          partialTokenSet.forEach((newToken) => {
            this._logCON("=> CON: " + this._tokenString(newToken, line));
            tokenSet.push(newToken);
          });
        }
      } else if (currState == eParseState.inDat) {
        // process a line in a data section
        if (trimmedLine.length > 0) {
          this._logDAT("- process DAT line(" + (i + 1) + "): trimmedLine=[" + trimmedLine + "]");
          const nonCommentLineRemainder: string = this.parseUtils.getNonCommentLineRemainder(0, trimmedLine);
          let orgStr: string = "ORGH";
          let orgOffset: number = nonCommentLineRemainder.toUpperCase().indexOf(orgStr); // ORGH
          if (orgOffset == -1) {
            orgStr = "ORGF";
            orgOffset = nonCommentLineRemainder.toUpperCase().indexOf(orgStr); // ORGF
            if (orgOffset == -1) {
              orgStr = "ORG";
              orgOffset = nonCommentLineRemainder.toUpperCase().indexOf(orgStr); // ORG
            }
          }
          if (orgOffset != -1) {
            // let's double check this is NOT in quoted string
            const nonStringLine: string = this.parseUtils.removeDoubleQuotedStrings(nonCommentLineRemainder);
            orgOffset = nonStringLine.toUpperCase().indexOf(orgStr); // ORG, ORGF, ORGH
          }
          if (orgOffset != -1) {
            // process ORG line allowing label to be present
            const partialTokenSet: IParsedToken[] = this._reportDAT_DeclarationLine(i, 0, line);
            partialTokenSet.forEach((newToken) => {
              this._logDAT("=> DAT: " + this._tokenString(newToken, line));
              tokenSet.push(newToken);
            });

            prePAsmState = currState;
            currState = eParseState.inDatPAsm;
            // and ignore rest of this line
          } else {
            const partialTokenSet: IParsedToken[] = this._reportDAT_DeclarationLine(i, 0, line);
            partialTokenSet.forEach((newToken) => {
              this._logDAT("=> DAT: " + this._tokenString(newToken, line));
              tokenSet.push(newToken);
            });
          }
        }
      } else if (currState == eParseState.inVar) {
        // process a line in a variable data section
        if (trimmedLine.length > 0) {
          this._logVAR("- process VAR line(" + (i + 1) + "):  trimmedLine=[" + trimmedLine + "]");
          const partialTokenSet: IParsedToken[] = this._reportVAR_DeclarationLine(i, 0, line);
          partialTokenSet.forEach((newToken) => {
            this._logOBJ("=> VAR: " + this._tokenString(newToken, line));
            tokenSet.push(newToken);
          });
        }
      } else if (currState == eParseState.inObj) {
        // process a line in an object section
        if (trimmedLine.length > 0) {
          this._logOBJ("- process OBJ line(" + (i + 1) + "):  trimmedLine=[" + trimmedLine + "]");
          const partialTokenSet: IParsedToken[] = this._reportOBJ_DeclarationLine(i, 0, line);
          partialTokenSet.forEach((newToken) => {
            this._logOBJ("=> OBJ: " + this._tokenString(newToken, line));
            tokenSet.push(newToken);
          });
        }
      } else if (currState == eParseState.inDatPAsm) {
        // process DAT section pasm (assembly) lines
        if (trimmedLine.length > 0) {
          this._logPASM("- process DAT PASM line(" + (i + 1) + "):  trimmedLine=[" + trimmedLine + "]");
          // in DAT sections we end with FIT or just next section
          const partialTokenSet: IParsedToken[] = this._reportDAT_PAsmCode(i, 0, line);
          partialTokenSet.forEach((newToken) => {
            this._logPASM("=> DAT: " + this._tokenString(newToken, line));
            tokenSet.push(newToken);
          });
          const lineParts: string[] = trimmedLine.split(/[ \t]/);
          if (lineParts.length > 0 && lineParts[0].toUpperCase() == "FIT") {
            currState = prePAsmState;
            this._logState("- scan Ln#" + (i + 1) + " POP currState=[" + currState + "]");
            // and ignore rest of this line
          }
        }
      } else if (currState == eParseState.inPAsmInline) {
        // process pasm (assembly) lines
        if (trimmedLine.length > 0) {
          this._logPASM("- process SPIN2 PASM line(" + (i + 1) + "):  trimmedLine=[" + trimmedLine + "]");
          const lineParts: string[] = trimmedLine.split(/[ \t]/);
          if (lineParts.length > 0 && lineParts[0].toUpperCase() == "END") {
            currState = prePAsmState;
            this._logState("- scan Ln#" + (i + 1) + " POP currState=[" + currState + "]");
            // and ignore rest of this line
          } else {
            const partialTokenSet: IParsedToken[] = this._reportSPIN_PAsmCode(i, 0, line);
            partialTokenSet.forEach((newToken) => {
              this._logOBJ("=> inlinePASM: " + this._tokenString(newToken, line));
              tokenSet.push(newToken);
            });
          }
        }
      } else if (currState == eParseState.inPub || currState == eParseState.inPri) {
        // process a method def'n line
        if (trimmedLine.length > 0) {
          this._logSPIN("- process SPIN2 line(" + (i + 1) + "): trimmedLine=[" + trimmedLine + "]");
          const lineParts: string[] = trimmedLine.split(/[ \t]/);
          if (lineParts.length > 0 && lineParts[0].toUpperCase() == "ORG") {
            // Only ORG not ORGF, ORGH
            prePAsmState = currState;
            currState = eParseState.inPAsmInline;
            // and ignore rest of this line
          } else if (trimmedLine.toLowerCase().startsWith("debug(")) {
            const partialTokenSet: IParsedToken[] = this._reportDebugStatement(i, 0, line);
            partialTokenSet.forEach((newToken) => {
              this._logSPIN("=> DEBUG: " + this._tokenString(newToken, line));
              tokenSet.push(newToken);
            });
          } else {
            const partialTokenSet: IParsedToken[] = this._reportSPIN_Code(i, 0, line);
            partialTokenSet.forEach((newToken) => {
              this._logSPIN("=> SPIN: " + this._tokenString(newToken, line));
              tokenSet.push(newToken);
            });
          }
        }
      }
    }
    this._checkTokenSet(tokenSet);
    return tokenSet;
  }

  private _generateFakeCommentForSignature(startingOffset: number, lineNbr: number, line: string): RememberedComment {
    if (startingOffset) {
    } // kill warning
    let desiredComment: RememberedComment = new RememberedComment(eCommentType.Unknown, -1, "");
    const linePrefix: string = line.substring(0, 3).toLowerCase();
    const isSignature: boolean = linePrefix == "pub" || linePrefix == "pri" ? true : false;
    const isPri: boolean = linePrefix == "pri" ? true : false;
    this._logSPIN(" -- gfcfs linePrefix=[" + linePrefix + "](" + linePrefix.length + ")" + `, isSignature=${isSignature},  isPri=${isPri}`);
    if (isSignature) {
      const cmtType: eCommentType = isPri ? eCommentType.multiLineComment : eCommentType.multiLineDocComment;
      let tmpDesiredComment: RememberedComment = new RememberedComment(cmtType, lineNbr, "NOTE: insert comment template by pressing Ctrl+Alt+C on PRI signature line, then fill it in.");
      const signatureComment: string[] = this._generateDocCommentForSignature(line, this.isSpin1Document);
      if (signatureComment && signatureComment.length > 0) {
        let lineCount: number = 1; // count our comment line on creation
        for (let cmtIdx = 0; cmtIdx < signatureComment.length; cmtIdx++) {
          const currCmtLine: string = signatureComment[cmtIdx];
          if (currCmtLine.includes("@param")) {
            tmpDesiredComment.appendLine(currCmtLine + "no parameter comment found");
            lineCount++; // count this line, too
          }
        }
        tmpDesiredComment.closeAsSingleLineBlock(lineNbr + lineCount - 1);
        if (lineCount > 1) {
          desiredComment = tmpDesiredComment; // only return this if we have params!
          this._logSPIN("=> SPIN: generated signature comment: sig=[" + line + "]");
        } else {
          this._logSPIN("=> SPIN: SKIPped generation of signature comment: sig=[" + line + "]");
        }
      }
    }
    return desiredComment;
  }

  private _generateDocCommentForSignature(signatureLine: string, isSpin1Method: boolean): string[] {
    let desiredDocComment: string[] = [];
    this._logMessage(`* iDc SKIP - generateDocCommentForSignature([${signatureLine}], isSpin1=${isSpin1Method})`);
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
          this._logMessage(`* gDCparamString=[${paramString}], paramNames=[${paramNames}]`);
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
          this._logMessage(`* gDCreturnsString=[${returnsString}], returnNames=[${returnNames}]`);
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
          this._logMessage(`* gDClocalsString=[${localsString}], localsNames=[${localsNames}]`);
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
          this._logMessage(`* gDCreturnsString=[${returnsString}], returnNames=[${returnNames}]`);
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
          this._logMessage(`* gDClocalsString=[${localsString}], localsNames=[${localsNames}]`);
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

  private _getSpin2_Directive(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE {-* VSCode-Spin2: nextline debug()-display: bitmap  *-}
    // (only this one so far)
    if (line.toLowerCase().indexOf("{-* vscode-spin2:") != -1) {
      this._logMessage("- _getSpin2_Directive: ofs:" + startingOffset + ", [" + line + "](" + lineNbr + ")");
      // have possible directive
      let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
      // get line parts - we only care about first one
      let lineParts: string[] = line
        .substring(currentOffset)
        .toLowerCase()
        .split(/[ \t,]/)
        .filter((element) => element);
      this._logMessage("  -- lineParts=[" + lineParts + "](" + lineParts.length + ")");
      if (lineParts.length > 4 && lineParts[3] == "debug()-display:") {
        for (let index = 4; index < lineParts.length - 1; index++) {
          const displayType: string = lineParts[index];
          this._recordDisplayTypeForLine(displayType, lineNbr);
        }
      }
    }
  }

  private _getFlexspinPreProcessor_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    if (this.configuration.highlightFlexspinDirectives) {
      let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
      const nonCommentConstantLine = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
      // get line parts - we only care about first one
      const lineParts: string[] = nonCommentConstantLine.split(/[ \t=]/);
      this._logPreProc("  - Ln#" + lineNbr + " GetPreProcDecl lineParts=[" + lineParts + "]");
      const directive: string = lineParts[0];
      const symbolName: string | undefined = lineParts.length > 1 ? lineParts[1] : undefined;
      if (this.parseUtils.isFlexspinPreprocessorDirective(directive)) {
        // check a valid preprocessor line for a declaration
        if (symbolName != undefined && directive.toLowerCase() == "#define") {
          this._logPreProc("  -- new PreProc Symbol=[" + symbolName + "]");
          this.semanticFindings.recordDeclarationLine(line, lineNbr);
          this.semanticFindings.setGlobalToken(symbolName, new RememberedToken("variable", lineNbr - 1, ["readonly"]), this._declarationComment());
        }
      }
    }
  }

  private _getCON_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE    DIGIT_NO_VALUE = -2   ' digit value when NOT [0-9]
    //  -or-   _clkfreq = CLK_FREQ   ' set system clock
    // NEW: multi line enums with no punctuation, ends at blank line (uses this.conEnumInProgress)
    //
    if (line.substr(startingOffset).length > 1) {
      //skip Past Whitespace
      let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
      const nonCommentConstantLine = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
      if (nonCommentConstantLine.length == 0) {
        this.conEnumInProgress = false; // if we have a blank line after removing comment then weve ended the enum set
      } else {
        this._logCON("  - Ln#" + lineNbr + " GetCONDecl nonCommentConstantLine=[" + nonCommentConstantLine + "]");
        const haveEnumDeclaration: boolean = this._isEnumDeclarationLine(lineNbr - 1, 0, nonCommentConstantLine);
        const isAssignment: boolean = nonCommentConstantLine.indexOf("=") != -1;
        if (!haveEnumDeclaration && isAssignment) {
          this.conEnumInProgress = false;
        } else {
          this.conEnumInProgress = this.conEnumInProgress || haveEnumDeclaration;
        }
        if (!haveEnumDeclaration && !this.conEnumInProgress) {
          const containsMultiStatements: boolean = nonCommentConstantLine.indexOf(",") != -1;
          this._logCON("  -- declNotEnum containsMultiStatements=[" + containsMultiStatements + "]");
          let statements: string[] = [nonCommentConstantLine];
          if (containsMultiStatements) {
            statements = nonCommentConstantLine.split(",").filter(Boolean);
          }
          this._logCON(`  -- statements=[${statements}](${statements.length})`);

          for (let index = 0; index < statements.length; index++) {
            const conDeclarationLine: string = statements[index].trim();
            this._logCON("  -- GetCONDecl conDeclarationLine=[" + conDeclarationLine + "]");
            currentOffset = line.indexOf(conDeclarationLine, 0);
            const assignmentOffset: number = conDeclarationLine.indexOf("=");
            if (assignmentOffset != -1) {
              // recognize constant name getting initialized via assignment
              // get line parts - we only care about first one
              const lineParts: string[] = conDeclarationLine.split(/[ \t=]/).filter(Boolean);
              this._logCON("  -- GetCONDecl assign lineParts=[" + lineParts + "](" + lineParts.length + ")");
              const newName = lineParts[0];
              if (newName.charAt(0).match(/[a-zA-Z_]/) && !this.parseUtils.isP1AsmVariable(newName)) {
                this._logCON("  -- GLBL GetCONDecl newName=[" + newName + "]");
                // remember this object name so we can annotate a call to it
                this.semanticFindings.recordDeclarationLine(line, lineNbr);
                this.semanticFindings.setGlobalToken(newName, new RememberedToken("variable", lineNbr - 1, ["readonly"]), this._declarationComment());
              }
            }
          }
        } else {
          // recognize enum values getting initialized
          // FIXME: broken: how to handle enum declaration statements??
          // this works: #0, HV_1, HV_2, HV_3, HV_4, HV_MAX = HV_4
          // this doesn't: #2[3], TV_1 = 4, TV_2 = 2, TV_3 = 5, TV_4 = 7
          const lineParts: string[] = nonCommentConstantLine.split(/[ \t,]/).filter(Boolean);
          this._logCON(`  -- GetCONDecl enumDecl lineParts=[${lineParts}](${lineParts.length})`);
          //this._logCON('  -- lineParts=[' + lineParts + ']');
          for (let index = 0; index < lineParts.length; index++) {
            let enumConstant: string = lineParts[index];
            // use parseUtils.isDebugInvocation to filter out use of debug invocation command from constant def'
            if (this.parseUtils.isDebugInvocation(enumConstant)) {
              continue; // yep this is not a constant
            } else if (this.parseUtils.isP1AsmVariable(enumConstant)) {
              this._logCON(`  -- GLBL PASM1 skipped=[${enumConstant}]`);
              continue; // yep this is not a constant
            } else {
              // our enum name can have a step offset
              if (enumConstant.includes("[")) {
                // it does, isolate name from offset
                const enumNameParts: string[] = enumConstant.split("[");
                enumConstant = enumNameParts[0];
              }
              if (enumConstant.charAt(0).match(/[a-zA-Z_]/)) {
                this._logCON(`  -- C GLBL enumConstant=[${enumConstant}]`);
                this.semanticFindings.recordDeclarationLine(line, lineNbr);
                this.semanticFindings.setGlobalToken(enumConstant, new RememberedToken("enumMember", lineNbr - 1, ["readonly"]), this._declarationComment());
              }
            }
          }
        }
      }
    } else {
      this.conEnumInProgress = false; // if we have a blank line after removing comment then weve ended the enum set
    }
  }

  private _getDAT_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE    bGammaEnable        BYTE   TRUE               ' comment
    //         didShow             byte   FALSE[256]
    //                             byte   FALSE[256]
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const dataDeclNonCommentStr = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    const lineParts: string[] = this.parseUtils.getNonWhiteNOperatorLineParts(dataDeclNonCommentStr);
    this._logDAT("  - Ln#" + lineNbr + " GetDatDecl lineParts=[" + lineParts + "](" + lineParts.length + ")");
    const bHaveDatBlockId: boolean = lineParts[0].toUpperCase() == "DAT";
    const minDecodeCount: number = bHaveDatBlockId ? 2 : 1;
    if (lineParts.length >= minDecodeCount) {
      const baseIndex: number = bHaveDatBlockId ? 1 : 0;
      const nameIndex: number = baseIndex + 0;
      const haveLabel: boolean = lineParts.length > nameIndex ? this.parseUtils.isDatOrPAsmLabel(lineParts[nameIndex]) : false;
      const typeIndex: number = haveLabel ? baseIndex + 1 : baseIndex + 0;
      let dataType: string | undefined = lineParts.length > typeIndex ? lineParts[typeIndex] : undefined;
      if (dataType && !this.parseUtils.isDatNFileStorageType(dataType)) {
        // file, res, long, byte, word
        dataType = undefined;
      }
      const haveStorageType: boolean = dataType ? this.parseUtils.isDatStorageType(dataType) : false;
      const isNamedDataDeclarationLine: boolean = haveLabel && haveStorageType ? true : false;
      const isDataDeclarationLine: boolean = haveStorageType ? true : false;

      const lblFlag: string = haveLabel ? "T" : "F";
      const dataDeclFlag: string = isDataDeclarationLine ? "T" : "F";
      const newName = haveLabel ? lineParts[nameIndex] : "";

      const dataTypeOffset: number = dataType && haveStorageType ? dataDeclNonCommentStr.indexOf(dataType) : 0;
      const valueDeclNonCommentStr: string = dataType && isDataDeclarationLine && dataTypeOffset != -1 ? dataDeclNonCommentStr.substring(dataTypeOffset + dataType.length).trim() : "";
      this._logDAT("   -- GetDatDecl valueDeclNonCommentStr=[" + valueDeclNonCommentStr + "](" + valueDeclNonCommentStr.length + ")");
      const bIsFileLine: boolean = dataType && dataType.toLowerCase() == "file" ? true : false;
      this._logDAT("   -- GetDatDecl newName=[" + newName + "], label=" + lblFlag + ", daDecl=" + dataDeclFlag + ", dataType=[" + dataType + "]");
      if (
        haveLabel &&
        !this.parseUtils.isP2AsmReservedWord(newName) &&
        !this.parseUtils.isSpinBuiltInVariable(newName) &&
        !this.parseUtils.isSpinReservedWord(newName) &&
        !this.parseUtils.isBuiltinStreamerReservedWord(newName) &&
        // add p1asm detect
        !this.parseUtils.isP1AsmInstruction(newName) &&
        !this.parseUtils.isP1AsmVariable(newName) &&
        !this.parseUtils.isP1AsmConditional(newName)
      ) {
        const nameType: string = isNamedDataDeclarationLine ? "variable" : "label"; // XYZZY
        var labelModifiers: string[] = ["declaration"];
        if (!isNamedDataDeclarationLine) {
          // have label...
          if (newName.startsWith(":")) {
            const offset: number = line.indexOf(newName, startingOffset);
            labelModifiers = ["illegalUse", "declaration", "static"];
            this.semanticFindings.pushDiagnosticMessage(lineNbr - 1, offset, offset + newName.length, eSeverity.Error, `P1 pasm local name [${newName}] not supported in P2 pasm`);
          } else if (newName.startsWith(".")) {
            labelModifiers = ["declaration", "static"];
          }
        }
        this._logDAT("   -- GetDatDecl GLBL-newName=[" + newName + "](" + nameType + ")");
        const fileName: string | undefined = bIsFileLine && lineParts.length > 2 ? lineParts[2] : undefined;
        this._ensureDataFileExists(fileName, lineNbr - 1, line, startingOffset);
        this._logDAT("   -- GetDatDecl fileName=[" + fileName + "]");
        this.semanticFindings.recordDeclarationLine(line, lineNbr);
        this.semanticFindings.setGlobalToken(newName, new RememberedToken(nameType, lineNbr - 1, labelModifiers), this._declarationComment(), fileName);
      }
    }
  }

  private _getDAT_PAsmDeclaration(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE    bGammaEnable        BYTE   TRUE               ' comment
    //         didShow             byte   FALSE[256]
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const datPAsmRHSStr = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    const lineParts: string[] = this.parseUtils.getNonWhiteLineParts(datPAsmRHSStr);
    this._logPASM(`  - Ln#${lineNbr} GetDATPAsmDecl lineParts=[${lineParts}](${lineParts.length})`);
    // handle name in 1 column
    let haveLabel: boolean = this.parseUtils.isDatOrPAsmLabel(lineParts[0]);
    const bIsFileLine: boolean = haveLabel && lineParts.length > 1 && lineParts[1].toLowerCase() == "file";
    const isDataDeclarationLine: boolean = lineParts.length > 1 && haveLabel && this.parseUtils.isDatStorageType(lineParts[1]) ? true : false;
    if (haveLabel) {
      const labelName: string = lineParts[0];
      if (
        !this.parseUtils.isP2AsmReservedSymbols(labelName) &&
        !this.parseUtils.isP2AsmInstruction(labelName) &&
        !labelName.toUpperCase().startsWith("IF_") &&
        !labelName.toUpperCase().startsWith("_RET_") &&
        !labelName.startsWith(":")
      ) {
        // org in first column is not label name, nor is if_ conditional
        const labelType: string = isDataDeclarationLine ? "variable" : "label";
        var labelModifiers: string[] = ["declaration"];
        if (!isDataDeclarationLine && labelName.startsWith(".")) {
          labelModifiers = ["declaration", "static"];
        }
        this._logPASM("  -- DAT PASM GLBL labelName=[" + labelName + "(" + labelType + ")]");
        const fileName: string | undefined = bIsFileLine && lineParts.length > 2 ? lineParts[2] : undefined;
        this._logDAT("   -- DAT PASM GLBL fileName=[" + fileName + "]");
        this._ensureDataFileExists(fileName, lineNbr - 1, line, startingOffset);
        this.semanticFindings.recordDeclarationLine(line, lineNbr);
        this.semanticFindings.setGlobalToken(labelName, new RememberedToken(labelType, lineNbr - 1, labelModifiers), this._declarationComment(), fileName);
      }
    }
  }

  private _ensureDataFileExists(fileName: string | undefined, lineIdx: number, line: string, startingOffset: number) {
    if (fileName) {
      const filenameNoQuotes: string = fileName.replace(/\"/g, "");
      const searchFilename: string = `\"${filenameNoQuotes}`;
      const nameOffset: number = line.indexOf(searchFilename, startingOffset);
      const hasPathSep: boolean = filenameNoQuotes.includes("/");
      this._logMessage(`  -- looking for DataFile [${this.directory}/${filenameNoQuotes}]`);
      const logCtx: Context | undefined = this.spin2DebugLogEnabled ? this.ctx : undefined;
      if (hasPathSep) {
        this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + filenameNoQuotes.length, eSeverity.Error, `P2 spin Invalid filename character "/" in [${filenameNoQuotes}]`);
      } else if (!fileInDirExists(this.directory, filenameNoQuotes, logCtx)) {
        this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + fileName.length, eSeverity.Error, `Missing P2 Data file [${fileName}]`);
      }
    }
  }

  private _ensureObjectFileExists(fileName: string | undefined, lineIdx: number, line: string, startingOffset: number) {
    if (fileName) {
      const filenameNoQuotes: string = fileName.replace(/\"/g, "");
      const hasSuffix: boolean = filenameNoQuotes.endsWith(".spin2");
      const hasPathSep: boolean = filenameNoQuotes.includes("/");
      const fileWithExt = `${filenameNoQuotes}.spin2`;
      const nameOffset: number = line.indexOf(filenameNoQuotes, startingOffset);
      const logCtx: Context | undefined = this.spin2DebugLogEnabled ? this.ctx : undefined;
      const checkFilename: string = hasSuffix ? filenameNoQuotes : fileWithExt;
      if (hasPathSep) {
        this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + filenameNoQuotes.length, eSeverity.Error, `P2 spin Invalid filename character "/" in [${filenameNoQuotes}]`);
      } else if (!fileInDirExists(this.directory, checkFilename, logCtx)) {
        this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + filenameNoQuotes.length, eSeverity.Error, `Missing P2 Object file [${filenameNoQuotes}]`);
      }
    }
  }

  private _getOBJ_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // parse P2 spin!
    // HAVE    color           : "isp_hub75_color"
    //  -or-   segments[7]     : "isp_hub75_segment"
    //  -or-   segments[7]     : "isp_hub75_segment" | BUFF_SIZE = 2
    //
    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    const remainingOffset: number = line.indexOf(remainingNonCommentLineStr, startingOffset);
    //this._logOBJ('- RptObjDecl remainingNonCommentLineStr=[' + remainingNonCommentLineStr + ']');
    if (remainingNonCommentLineStr.length > 0 && remainingNonCommentLineStr.includes(":")) {
      // get line parts - we only care about first one
      const overrideParts: string[] = remainingNonCommentLineStr.split("|").filter(Boolean);
      const lineParts: string[] = overrideParts[0].split(":").filter(Boolean);
      this._logOBJ("  -- GLBL GetOBJDecl lineParts=[" + lineParts + "]");
      let instanceNamePart = lineParts[0].trim();
      // if we have instance array declaration, then remove it
      if (instanceNamePart.includes("[")) {
        const nameParts = instanceNamePart.split(/[\[\]]/).filter(Boolean);
        instanceNamePart = nameParts[0];
      }
      this._logOBJ(`  -- GLBL GetOBJDecl newInstanceName=[${instanceNamePart}]`);
      // remember this object name so we can annotate a call to it
      const filenamePart = lineParts[1].trim().replace(/[\"]/g, "");
      this._logOBJ(`  -- GLBL GetOBJDecl newFileName=[${filenamePart}]`);
      this.semanticFindings.recordDeclarationLine(line, lineNbr);
      this.semanticFindings.setGlobalToken(instanceNamePart, new RememberedToken("namespace", lineNbr - 1, []), this._declarationComment(), filenamePart); // pass filename, too
      this.semanticFindings.recordObjectImport(instanceNamePart, filenamePart);
      this._ensureObjectFileExists(filenamePart, lineNbr - 1, line, startingOffset);
    } else if (remainingNonCommentLineStr.length > 0 && !remainingNonCommentLineStr.includes(":")) {
      this.semanticFindings.pushDiagnosticMessage(
        lineNbr - 1,
        remainingOffset,
        remainingOffset + remainingNonCommentLineStr.length,
        eSeverity.Error,
        `Illegal P2 Syntax: Unable to parse object declaration [${remainingNonCommentLineStr}]`
      );
    }
  }

  private _getPUB_PRI_Name(startingOffset: number, lineNbr: number, line: string): void {
    const methodType = line.substr(0, 3).toUpperCase();
    // reset our list of local variables
    const isPrivate: boolean = methodType.indexOf("PRI") != -1;
    //const matchIdx: number = methodType.indexOf("PRI");
    //this._logSPIN("  - Ln#" + lineNbr + " GetMethodDecl methodType=[" + methodType + "], isPrivate(" + isPrivate + ")");

    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this.parseUtils.getNonCommentLineRemainder(0, line);
    const startNameOffset = currentOffset;
    // find open paren
    // find open paren
    currentOffset = remainingNonCommentLineStr.indexOf("(", startNameOffset); // in spin1 ()'s are optional!
    if (currentOffset == -1) {
      currentOffset = remainingNonCommentLineStr.indexOf(":", startNameOffset);
      if (currentOffset == -1) {
        currentOffset = remainingNonCommentLineStr.indexOf("|", startNameOffset);
        if (currentOffset == -1) {
          currentOffset = remainingNonCommentLineStr.indexOf(" ", startNameOffset);
          if (currentOffset == -1) {
            currentOffset = remainingNonCommentLineStr.indexOf("'", startNameOffset);
            // if nothibng found...
            if (currentOffset == -1) {
              currentOffset = remainingNonCommentLineStr.length;
            }
          }
        }
      }
    }

    let nameLength = currentOffset - startNameOffset;
    const methodName = line.substr(startNameOffset, nameLength).trim();
    const nameType: string = isPrivate ? "private" : "public";
    this._logSPIN("  - Ln#" + lineNbr + " _getPUB_PRI_Name() newName=[" + methodName + "](" + nameType + ")");
    this.currentMethodName = methodName; // notify of latest method name so we can track inLine PASM symbols
    // mark start of method - we are learning span of lines this method covers
    let methodExists: boolean = false;
    const referenceDetails: RememberedToken | undefined = this.semanticFindings.getGlobalToken(methodName);
    if (referenceDetails && referenceDetails.type === "method") {
      methodExists = true;
      this._logSPIN(`  -- _getPUB_PRI_Name() ERROR: have dupe method [${methodName}]`);
    }
    if (!methodExists) {
      this.semanticFindings.startMethod(methodName, lineNbr);

      // remember this method name so we can annotate a call to it
      const refModifiers: string[] = isPrivate ? ["static"] : [];
      // record ACTUAL object public/private interface
      this.semanticFindings.recordDeclarationLine(line, lineNbr);
      this.semanticFindings.setGlobalToken(methodName, new RememberedToken("method", lineNbr - 1, refModifiers), this._declarationComment());
      // reset our list of local variables
      this.semanticFindings.clearLocalPAsmTokensForMethod(methodName);
    } else {
      const methodPrefix: string = referenceDetails?.modifiers.includes("static") ? "PRI" : "PUB";
      //const declarationLineIdx;number = referenceDetails.
      this.semanticFindings.pushDiagnosticMessage(
        lineNbr - 1,
        startNameOffset,
        startNameOffset + methodName.length,
        eSeverity.Error,
        `P2 Spin Duplicate method Declaration: found earlier [${methodPrefix} ${methodName}()]`
      );
    }
    this._logSPIN("  -- _getPUB_PRI_Name() exit");
  }

  private _getSPIN_PAsmDeclaration(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE    next8SLine ' or .nextLine in col 0
    //         nPhysLineIdx        long    0
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const inLinePAsmRHSStr = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    const lineParts: string[] = this.parseUtils.getNonWhiteLineParts(inLinePAsmRHSStr);
    //this._logPASM('- GetInLinePAsmDecl lineParts=[' + lineParts + ']');
    // handle name in 1 column
    let haveLabel: boolean = this.parseUtils.isDatOrPAsmLabel(lineParts[0]);
    const isDataDeclarationLine: boolean = lineParts.length > 1 && haveLabel && this.parseUtils.isDatStorageType(lineParts[1]) ? true : false;
    if (haveLabel) {
      const labelName: string = lineParts[0];
      const labelType: string = isDataDeclarationLine ? "variable" : "label";
      var labelModifiers: string[] = [];
      if (!isDataDeclarationLine) {
        labelModifiers = labelName.startsWith(".") ? ["pasmInline", "static"] : ["pasmInline"];
      } else {
        labelModifiers = ["pasmInline"];
      }
      this._logPASM("  -- Inline PASM labelName=[" + labelName + "(" + labelType + ")[" + labelModifiers + "]]");
      this.semanticFindings.setLocalPAsmTokenForMethod(this.currentMethodName, labelName, new RememberedToken(labelType, lineNbr - 1, labelModifiers), this._declarationComment());
    }
  }

  private _getVAR_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE    long    demoPausePeriod   ' comment
    //
    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    //this._logVAR("  - Ln#" + lineNbr + " GetVarDecl remainingNonCommentLineStr=[" + remainingNonCommentLineStr + "]");
    const isMultiDeclaration: boolean = remainingNonCommentLineStr.includes(",");
    let lineParts: string[] = this.parseUtils.getNonWhiteDataInitLineParts(remainingNonCommentLineStr);
    const hasGoodType: boolean = this.parseUtils.isStorageType(lineParts[0]);
    this._logVAR("  - Ln#" + lineNbr + " GetVarDecl lineParts=[" + lineParts + "](" + lineParts.length + ")");
    let nameSet: string[] = [];
    if (hasGoodType && lineParts.length > 1) {
      if (!isMultiDeclaration) {
        // get line parts - we only care about first one after type
        nameSet.push(lineParts[0]);
        nameSet.push(lineParts[1]);
      } else {
        // have multiple declarations separated by commas, we care about all after type
        nameSet = lineParts;
      }
      // remember this object name so we can annotate a call to it
      // NOTE this is an instance-variable!
      for (let index = 1; index < nameSet.length; index++) {
        // remove array suffix and comma delim. from name
        const newName = nameSet[index]; // .replace(/[\[,]/, '');
        if (newName.charAt(0).match(/[a-zA-Z_]/)) {
          this._logVAR("  -- GLBL GetVarDecl newName=[" + newName + "]");
          this.semanticFindings.recordDeclarationLine(line, lineNbr);
          this.semanticFindings.setGlobalToken(newName, new RememberedToken("variable", lineNbr - 1, ["instance"]), this._declarationComment());
        }
      }
    } else if (!hasGoodType && lineParts.length > 0) {
      for (let index = 0; index < lineParts.length; index++) {
        const longVarName = lineParts[index];
        if (longVarName.charAt(0).match(/[a-zA-Z_]/)) {
          this._logVAR("  -- GLBL GetVarDecl newName=[" + longVarName + "]");
          this.semanticFindings.recordDeclarationLine(line, lineNbr);
          this.semanticFindings.setGlobalToken(longVarName, new RememberedToken("variable", lineNbr - 1, ["instance"]), this._declarationComment());
        }
      }
    }
  }

  private _getDebugDisplay_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // locate and collect debug() display user names and types
    //
    // HAVE    debug(`{displayType} {displayName} ......)            ' comment
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const datPAsmStatementStr = this._getDebugStatement(currentOffset, line);
    if (datPAsmStatementStr.length > 0) {
      this._logDEBUG("  -- rptDbg datPAsmStatementStr=[" + datPAsmStatementStr + "]");
      if (datPAsmStatementStr.toLowerCase().startsWith("debug(`")) {
        const lineParts: string[] = this.parseUtils.getDebugNonWhiteLineParts(datPAsmStatementStr);
        this._logDEBUG("  -- gddd lineParts=[" + lineParts + "](" + lineParts.length + ")");
        if (lineParts.length >= 3) {
          const displayType: string = lineParts[1];
          if (displayType.startsWith("`")) {
            const newDisplayType: string = displayType.substring(1, displayType.length);
            //this._logDEBUG('  --- debug(...) newDisplayType=[' + newDisplayType + ']');
            if (this.parseUtils.isDebugDisplayType(newDisplayType)) {
              const newDisplayName: string = lineParts[2];
              //this._logDEBUG('  --- debug(...) newDisplayType=[' + newDisplayType + '], newDisplayName=[' + newDisplayName + ']');
              this.semanticFindings.setUserDebugDisplay(newDisplayType, newDisplayName, lineNbr);
            }
          }
        }
      }
    }
  }

  private _reportFlexspinPreProcessorLine(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];

    const lineNbr: number = lineIdx + 1;
    // skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const nonCommentConstantLine = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    // get line parts - we only care about first one
    const lineParts: string[] = nonCommentConstantLine.split(/[ \t=]/);
    this._logPreProc("  - Ln#" + lineNbr + " reportPreProc lineParts=[" + lineParts + "]");
    const directive: string = lineParts[0];
    const symbolName: string | undefined = lineParts.length > 1 ? lineParts[1] : undefined;

    if (this.configuration.highlightFlexspinDirectives) {
      if (this.parseUtils.isFlexspinPreprocessorDirective(directive)) {
        // record the directive
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: 0,
          length: directive.length,
          ptTokenType: "keyword",
          ptTokenModifiers: ["control", "directive"],
        });
        const hasSymbol: boolean =
          directive.toLowerCase() == "#define" ||
          directive.toLowerCase() == "#ifdef" ||
          directive.toLowerCase() == "#ifndef" ||
          directive.toLowerCase() == "#elseifdef" ||
          directive.toLowerCase() == "#elseifndef";
        if (hasSymbol && symbolName != undefined) {
          const nameOffset = line.indexOf(symbolName, currentOffset);
          this._logPreProc("  -- GLBL symbolName=[" + symbolName + "]");
          let referenceDetails: RememberedToken | undefined = undefined;
          if (this.semanticFindings.isGlobalToken(symbolName)) {
            referenceDetails = this.semanticFindings.getGlobalToken(symbolName);
            this._logPreProc("  --  FOUND preProc global " + this._rememberdTokenString(symbolName, referenceDetails));
          }
          if (referenceDetails != undefined) {
            // record a constant declaration!
            const updatedModificationSet: string[] = directive.toLowerCase() == "#define" ? referenceDetails.modifiersWith("declaration") : referenceDetails.modifiers;
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: symbolName.length,
              ptTokenType: referenceDetails.type,
              ptTokenModifiers: updatedModificationSet,
            });
          } else if (this.parseUtils.isFlexspinReservedWord(symbolName)) {
            // record a constant reference
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: symbolName.length,
              ptTokenType: "variable",
              ptTokenModifiers: ["readonly"],
            });
          } else {
            // record an unknown name
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: symbolName.length,
              ptTokenType: "comment",
              ptTokenModifiers: ["line"],
            });
          }
        }
      }
    } else {
      //  DO NOTHING we don't highlight these (flexspin support not enabled)
      this._recordToken(tokenSet, line, {
        line: lineIdx,
        startCharacter: 0,
        length: lineParts[0].length,
        ptTokenType: "macro",
        ptTokenModifiers: ["directive", "illegalUse"],
      });
      this.semanticFindings.pushDiagnosticMessage(lineIdx, 0, 0 + lineParts[0].length, eSeverity.Error, `P2 Spin - PreProcessor Directive [${lineParts[0]}] not supported!`);
    }

    return tokenSet;
  }

  private _isEnumDeclarationLine(lineIdx: number, startingOffset: number, line: string): boolean {
    // BOTH P1 and P2 determination: if CON line is start enum declaration
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const nonCommentConstantLine = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    let enumDeclStatus: boolean = nonCommentConstantLine.startsWith("#");
    // if not yet sure...
    if (enumDeclStatus == false) {
      // don't know what this line is, yet
      const containsMultiStatements: boolean = nonCommentConstantLine.indexOf(",") != -1;
      let statements: string[] = [nonCommentConstantLine];
      let allStatementAreAssignment: boolean = true;
      if (containsMultiStatements) {
        statements = nonCommentConstantLine.split(",").filter(Boolean);
      }
      // if all statements are assignment then we still don't know if this is enum or list of assignements
      // however, if one has "no assignment" then we DO KNOW that this is an enum start
      for (let index = 0; index < statements.length; index++) {
        const singleStatement = statements[index];
        if (!singleStatement.includes("=")) {
          allStatementAreAssignment = false;
          break;
        }
      }
      if (!allStatementAreAssignment) {
        enumDeclStatus = true;
      }
    }
    this._logCON(`  -- isEnumDeclarationLine() = (${enumDeclStatus}): nonCommentConstantLine=[${nonCommentConstantLine}]`);
    return enumDeclStatus;
  }

  private _reportCON_DeclarationLine(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    // skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const nonCommentConstantLine = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    if (nonCommentConstantLine.length > 0) {
      const haveEnumDeclaration: boolean = this._isEnumDeclarationLine(lineIdx, 0, nonCommentConstantLine);
      const isAssignment: boolean = nonCommentConstantLine.indexOf("=") != -1;
      if (!haveEnumDeclaration && isAssignment) {
        this.conEnumInProgress = false;
      } else {
        this.conEnumInProgress = this.conEnumInProgress || haveEnumDeclaration;
      }
      const containsMultiStatements: boolean = nonCommentConstantLine.indexOf(",") != -1;
      this._logCON("- reportConstant haveEnum=(" + haveEnumDeclaration + "), containsMulti=(" + containsMultiStatements + "), nonCommentConstantLine=[" + nonCommentConstantLine + "]");
      let statements: string[] = [nonCommentConstantLine];
      if (!haveEnumDeclaration && !this.conEnumInProgress) {
        if (containsMultiStatements) {
          statements = nonCommentConstantLine.split(",").filter(Boolean);
        }
        this._logCON(`  -- assignments statements=[${statements}](${statements.length})`);
        for (let index = 0; index < statements.length; index++) {
          const conDeclarationLine: string = statements[index].trim();
          this._logCON("  -- conDeclarationLine=[" + conDeclarationLine + "]");
          currentOffset = line.indexOf(conDeclarationLine, currentOffset);
          // locate key indicators of line style
          const isAssignment: boolean = conDeclarationLine.indexOf("=") != -1;
          if (!isAssignment) {
            if (!this.parseUtils.isDebugInvocation(conDeclarationLine)) {
              this.semanticFindings.pushDiagnosticMessage(
                lineIdx,
                currentOffset,
                currentOffset + conDeclarationLine.length,
                eSeverity.Error,
                `P2 Spin Syntax: Missing '=' part of assignment [${conDeclarationLine}]`
              );
            }
          } else {
            // -------------------------------------------
            // have line assigning value to new constant
            // -------------------------------------------
            // process LHS
            const assignmentParts: string[] = conDeclarationLine.split("=");
            const lhsConstantName = assignmentParts[0].trim();
            const nameOffset = line.indexOf(lhsConstantName, currentOffset);
            this._logCON("  -- GLBL assign lhsConstantName=[" + lhsConstantName + "]");
            let referenceDetails: RememberedToken | undefined = undefined;
            if (this.semanticFindings.isGlobalToken(lhsConstantName)) {
              referenceDetails = this.semanticFindings.getGlobalToken(lhsConstantName);
              this._logCON("  --  FOUND rcdl lhs global " + this._rememberdTokenString(lhsConstantName, referenceDetails));
            }
            if (referenceDetails != undefined) {
              // this is a constant declaration!
              const modifiersWDecl: string[] = referenceDetails.modifiersWith("declaration");
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: lhsConstantName.length,
                ptTokenType: referenceDetails.type,
                ptTokenModifiers: modifiersWDecl,
              });
            } else {
              this._logCON("  --  CON ERROR[CODE] missed recording declaration! name=[" + lhsConstantName + "]");
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: lhsConstantName.length,
                ptTokenType: "variable",
                ptTokenModifiers: ["illegalUse"],
              });
              if (this.parseUtils.isP1AsmVariable(lhsConstantName)) {
                this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + lhsConstantName.length, eSeverity.Error, `P1 pasm variable [${lhsConstantName}] not allowed in P2 spin`);
              } else {
                this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + lhsConstantName.length, eSeverity.Error, `Missing Variable Declaration [${lhsConstantName}]`);
              }
            }
            // remove front LHS of assignment and process remainder
            // process RHS
            const fistEqualOffset: number = conDeclarationLine.indexOf("=");
            const assignmentRHSStr = conDeclarationLine.substring(fistEqualOffset + 1).trim();
            currentOffset = line.indexOf(assignmentRHSStr, fistEqualOffset); // skip to RHS of assignment
            this._logCON("  -- CON assignmentRHSStr=[" + assignmentRHSStr + "]");
            const possNames: string[] = this.parseUtils.getNonWhiteCONLineParts(assignmentRHSStr);
            this._logCON(`  -- possNames=[${possNames}](${possNames.length})`);
            for (let index = 0; index < possNames.length; index++) {
              const possibleName = possNames[index];
              const currPossibleLen = possibleName.length;
              if (possibleName.charAt(0).match(/[a-zA-Z_]/)) {
                // does name contain a namespace reference?
                let possibleNameSet: string[] = [possibleName];
                if (this._isPossibleObjectReference(possibleName)) {
                  const bHaveObjReference = this._reportObjectReference(possibleName, lineIdx, currentOffset, line, tokenSet);
                  if (bHaveObjReference) {
                    currentOffset = currentOffset + possibleName.length;
                    continue;
                  }
                  possibleNameSet = possibleName.split(".");
                }
                this._logCON(`  --  possibleNameSet=[${possibleNameSet}](${possibleNameSet.length})`);
                const namePart: string = possibleNameSet[0];
                const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : possibleNameSet[0] + "." + possibleNameSet[1];
                const nameOffset: number = line.indexOf(searchString, currentOffset); // skip to RHS of assignment
                let referenceDetails: RememberedToken | undefined = undefined;
                this._logCON(`  -- namePart=[${namePart}], ofs=(${nameOffset})`);
                if (this.semanticFindings.isGlobalToken(namePart)) {
                  referenceDetails = this.semanticFindings.getGlobalToken(namePart);
                  this._logCON("  --  FOUND rcds rhs global " + this._rememberdTokenString(namePart, referenceDetails));
                }
                if (referenceDetails != undefined) {
                  // this is a constant reference!
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: namePart.length,
                    ptTokenType: referenceDetails.type,
                    ptTokenModifiers: referenceDetails.modifiers,
                  });
                } else {
                  if (this.parseUtils.isFloatConversion(namePart) && (assignmentRHSStr.indexOf(namePart + "(") == -1 || assignmentRHSStr.indexOf(namePart + "()") != -1)) {
                    this._logCON("  --  CON MISSING parens=[" + namePart + "]");
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: namePart.length,
                      ptTokenType: "method",
                      ptTokenModifiers: ["builtin", "missingDeclaration"],
                    });
                    this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P2 Spin CON missing parens [${namePart}]`);
                  } else if (
                    !this.parseUtils.isSpinReservedWord(namePart) &&
                    !this.parseUtils.isBuiltinStreamerReservedWord(namePart) &&
                    !this.parseUtils.isDebugMethod(namePart) &&
                    !this.parseUtils.isDebugControlSymbol(namePart) &&
                    !this.parseUtils.isUnaryOperator(namePart)
                  ) {
                    this._logCON("  --  CON MISSING name=[" + namePart + "]");
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: namePart.length,
                      ptTokenType: "variable",
                      ptTokenModifiers: ["illegalUse"],
                    });
                    if (this.parseUtils.isP1AsmVariable(namePart)) {
                      this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P1 pasm variable [${namePart}] in not allowed P2 spin`);
                    } else {
                      this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `Missing Constant Declaration [${namePart}]`);
                    }
                  } else {
                    if (
                      !this.parseUtils.isP2AsmReservedWord(namePart) &&
                      !this.parseUtils.isUnaryOperator(namePart) &&
                      !this.parseUtils.isBinaryOperator(namePart) &&
                      !this.parseUtils.isSpinNumericSymbols(namePart)
                    ) {
                      this._logCON("  --  CON MISSING declaration=[" + namePart + "]");
                      this._recordToken(tokenSet, line, {
                        line: lineIdx,
                        startCharacter: nameOffset,
                        length: namePart.length,
                        ptTokenType: "variable",
                        ptTokenModifiers: ["missingDeclaration"],
                      });
                      this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P2 Spin CON missing Declaration [${namePart}]`);
                    }
                  }
                }
                currentOffset = nameOffset + 1; // skip past this name
              }
            }
          }
        }
      } else {
        // -------------------------------------------------
        // have line creating one or more of enum constants
        // -------------------------------------------------
        // recognize enum values getting initialized
        const lineParts: string[] = nonCommentConstantLine.split(",").filter(Boolean);
        this._logCON(`  -- enum lineParts=[${lineParts}](${lineParts.length})`);
        let nameOffset: number = 0;
        let nameLen: number = 0;
        for (let index = 0; index < lineParts.length; index++) {
          let enumConstant = lineParts[index].trim();
          // our enum name can have a step offset: name[step]
          if (enumConstant.includes("[")) {
            // it does, isolate name from offset
            const enumNameParts: string[] = enumConstant.split("[");
            enumConstant = enumNameParts[0];
          }
          nameLen = enumConstant.length;
          if (enumConstant.includes("=")) {
            const enumAssignmentParts: string[] = enumConstant.split("=");
            enumConstant = enumAssignmentParts[0].trim();
            const enumExistingName: string = enumAssignmentParts[1].trim();
            nameLen = enumExistingName.length; // len changed assign again...
            if (enumExistingName.charAt(0).match(/[a-zA-Z_]/)) {
              this._logCON("  -- A GLBL enumExistingName=[" + enumExistingName + "]");
              // our enum name can have a step offset
              nameOffset = line.indexOf(enumExistingName, currentOffset);
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: enumExistingName.length,
                ptTokenType: "enumMember",
                ptTokenModifiers: ["readonly"],
              });
            }
          }
          if (enumConstant.charAt(0).match(/[a-zA-Z_]/) && !this.parseUtils.isDebugInvocation(enumConstant) && !this.parseUtils.isP1AsmVariable(enumConstant)) {
            this._logCON("  -- B GLBL enumConstant=[" + enumConstant + "]");
            // our enum name can have a step offset
            nameOffset = line.indexOf(enumConstant, currentOffset);
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: enumConstant.length,
              ptTokenType: "enumMember",
              ptTokenModifiers: ["declaration", "readonly"],
            });
          } else if (this.parseUtils.isP1AsmVariable(enumConstant)) {
            // our SPIN1 name
            this._logCON("  -- B GLBL bad SPIN1=[" + enumConstant + "]");
            nameOffset = line.indexOf(enumConstant, currentOffset);
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: enumConstant.length,
              ptTokenType: "variable",
              ptTokenModifiers: ["illegalUse"],
            });
            this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + enumConstant.length, eSeverity.Error, `P1 Spin constant [${enumConstant}] not allowed in P2 Spin`);
          }
          currentOffset = nameOffset + nameLen;
        }
      }
    } else {
      this.conEnumInProgress = false; // if we have a blank line after removing comment then weve ended the enum set
    }
    return tokenSet;
  }

  private _reportDAT_DeclarationLine(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const dataDeclNonCommentStr = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    let lineParts: string[] = this.parseUtils.getNonWhiteLineParts(dataDeclNonCommentStr);
    this._logDAT("- rptDataDeclLn lineParts=[" + lineParts + "](" + lineParts.length + ")");
    // remember this object name so we can annotate a call to it
    if (lineParts.length > 1) {
      if (this.parseUtils.isStorageType(lineParts[0]) || lineParts[0].toUpperCase() == "FILE" || lineParts[0].toUpperCase() == "ORG") {
        // if we start with storage type (or FILE, or ORG), not name, process rest of line for symbols
        currentOffset = line.indexOf(lineParts[0], currentOffset);
        const allowLocalVarStatus: boolean = false;
        const NOT_DAT_PASM: boolean = false;
        const partialTokenSet: IParsedToken[] = this._reportDAT_ValueDeclarationCode(lineIdx, currentOffset, line, allowLocalVarStatus, this.showDAT, NOT_DAT_PASM);
        partialTokenSet.forEach((newToken) => {
          tokenSet.push(newToken);
        });
      } else {
        // this is line with name, storageType, and initial value
        this._logDAT("  -- rptDatDecl lineParts=[" + lineParts + "]");
        let newName = lineParts[0];
        const nameOffset: number = line.indexOf(newName, currentOffset);
        let referenceDetails: RememberedToken | undefined = undefined;
        if (this.semanticFindings.isGlobalToken(newName)) {
          referenceDetails = this.semanticFindings.getGlobalToken(newName);
          this._logMessage("  --  FOUND rddl global name=[" + newName + "]");
        }
        if (referenceDetails != undefined) {
          // add back in our declaration flag
          const modifiersWDecl: string[] = referenceDetails.modifiersWith("declaration");
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: newName.length,
            ptTokenType: referenceDetails.type,
            ptTokenModifiers: modifiersWDecl,
          });
        } else if (!this.parseUtils.isP2AsmReservedSymbols(newName) && !this.parseUtils.isP2AsmInstruction(newName)) {
          this._logDAT("  --  DAT rDdl MISSING name=[" + newName + "]");
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: newName.length,
            ptTokenType: "variable",
            ptTokenModifiers: ["missingDeclaration"],
          });
          this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + newName.length, eSeverity.Error, `P2 Spin A missing declaration [${newName}]`);
        }

        // process remainder of line
        currentOffset = line.indexOf(lineParts[1], nameOffset + newName.length);
        const allowLocalVarStatus: boolean = false;
        const NOT_DAT_PASM: boolean = false;
        const partialTokenSet: IParsedToken[] = this._reportDAT_ValueDeclarationCode(lineIdx, currentOffset, line, allowLocalVarStatus, this.showDAT, NOT_DAT_PASM);
        partialTokenSet.forEach((newToken) => {
          tokenSet.push(newToken);
        });
      }
    } else if (lineParts.length == 1) {
      // handle name declaration only line: [name 'comment]
      let newName = lineParts[0];
      if (!this.parseUtils.isAlignType(newName)) {
        let referenceDetails: RememberedToken | undefined = undefined;
        if (this.semanticFindings.isGlobalToken(newName)) {
          referenceDetails = this.semanticFindings.getGlobalToken(newName);
          this._logMessage("  --  FOUND global name=[" + newName + "]");
        }
        if (referenceDetails != undefined) {
          // add back in our declaration flag
          const modifiersWDecl: string[] = referenceDetails.modifiersWith("declaration");
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: currentOffset,
            length: newName.length,
            ptTokenType: referenceDetails.type,
            ptTokenModifiers: modifiersWDecl,
          });
        } else if (this.parseUtils.isP1AsmInstruction(newName) || this.parseUtils.isP1AsmConditional(newName) || this.parseUtils.isP1AsmVariable(newName)) {
          this._logMessage("  --  ERROR p1asm name=[" + newName + "]");
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: currentOffset,
            length: newName.length,
            ptTokenType: "variable",
            ptTokenModifiers: ["illegalUse"],
          });
          this.semanticFindings.pushDiagnosticMessage(lineIdx, currentOffset, currentOffset + newName.length, eSeverity.Error, `P1 pasm name [${newName}] not allowed in P2 Spin`);
        }
      }
    } else {
      this._logDAT("  -- DAT SKIPPED: lineParts=[" + lineParts + "]");
    }
    return tokenSet;
  }

  private _reportDAT_ValueDeclarationCode(lineIdx: number, startingOffset: number, line: string, allowLocal: boolean, showDebug: boolean, isDatPAsm: boolean): IParsedToken[] {
    // process line that starts with storage type (or FILE, or ORG), not name, process rest of line for symbols
    const lineNbr: number = lineIdx + 1;
    const tokenSet: IParsedToken[] = [];
    //this._logMessage(' DBG _reportDAT_ValueDeclarationCode(#' + lineNbr + ', ofs=' + startingOffset + ')');
    this._logDAT("- process ValueDeclaration line(" + lineNbr + "): line=[" + line + "]");

    // process data declaration
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const dataValueInitStr = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    if (dataValueInitStr.length > 1) {
      this._logMessage("  -- reportDataValueInit dataValueInitStr=[" + dataValueInitStr + "]");
      let lineParts: string[] = this.parseUtils.getNonWhiteDataInitLineParts(dataValueInitStr);
      const argumentStartIndex: number = this.parseUtils.isDatStorageType(lineParts[0]) ? 1 : 0;
      this._logMessage("  -- lineParts=[" + lineParts + "]");
      // process remainder of line
      if (lineParts.length < 2) {
        return tokenSet;
      }
      if (lineParts.length > 1) {
        let nameOffset: number = 0;
        let namePart: string = "";
        for (let index = argumentStartIndex; index < lineParts.length; index++) {
          const possibleName = lineParts[index].replace(/[\(\)\@]/, "");
          //if (showDebug) {
          //    this._logMessage('  -- possibleName=[' + possibleName + ']');
          //}
          const currPossibleLen = possibleName.length;
          if (currPossibleLen < 1) {
            continue;
          }
          // the following allows '.' in names but  only when in DAT PASM code, not spin!
          if (possibleName.charAt(0).match(/[a-zA-Z_]/) || (isDatPAsm && possibleName.charAt(0).match(/[a-zA-Z_\.]/))) {
            nameOffset = line.indexOf(possibleName, currentOffset);
            if (showDebug) {
              this._logMessage("  -- possibleName=[" + possibleName + "]");
            }
            // does name contain a namespace reference?
            let possibleNameSet: string[] = [possibleName];
            if (this._isPossibleObjectReference(possibleName)) {
              const bHaveObjReference = this._reportObjectReference(possibleName, lineIdx, nameOffset, line, tokenSet);
              if (bHaveObjReference) {
                currentOffset = nameOffset + possibleName.length;
                continue;
              }
              possibleNameSet = possibleName.split(".");
            }
            if (showDebug) {
              this._logMessage("  --  possibleNameSet=[" + possibleNameSet + "]");
            }
            namePart = possibleNameSet[0];
            const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : possibleNameSet[0] + "." + possibleNameSet[1];
            nameOffset = line.indexOf(searchString, currentOffset);
            let referenceDetails: RememberedToken | undefined = undefined;
            if (allowLocal && this.semanticFindings.isLocalToken(namePart)) {
              referenceDetails = this.semanticFindings.getLocalTokenForLine(namePart, lineNbr);
              if (showDebug) {
                this._logMessage("  --  FOUND local name=[" + namePart + "]");
              }
            } else if (this.semanticFindings.isGlobalToken(namePart)) {
              referenceDetails = this.semanticFindings.getGlobalToken(namePart);
              if (showDebug) {
                this._logMessage("  --  FOUND global name=[" + namePart + "]");
              }
            }
            if (referenceDetails != undefined) {
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: namePart.length,
                ptTokenType: referenceDetails.type,
                ptTokenModifiers: referenceDetails.modifiers,
              });
            } else {
              if (
                !this.parseUtils.isP2AsmReservedWord(namePart) &&
                !this.parseUtils.isP2AsmReservedSymbols(namePart) &&
                !this.parseUtils.isP2AsmInstruction(namePart) &&
                !this.parseUtils.isSpinReservedWord(namePart) &&
                !this.parseUtils.isDatNFileStorageType(namePart) &&
                !this.parseUtils.isBinaryOperator(namePart) &&
                !this.parseUtils.isUnaryOperator(namePart) &&
                !this.parseUtils.isBuiltinStreamerReservedWord(namePart)
              ) {
                if (showDebug) {
                  this._logMessage("  --  DAT rDvdc MISSING name=[" + namePart + "]");
                }
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: currentOffset,
                  length: namePart.length,
                  ptTokenType: "variable",
                  ptTokenModifiers: ["missingDeclaration"],
                });
                this.semanticFindings.pushDiagnosticMessage(lineIdx, currentOffset, currentOffset + namePart.length, eSeverity.Error, `P2 Spin DAT missing declaration [${namePart}]`);
              }
            }
          }
          currentOffset = nameOffset + namePart.length;
        }
      }
    }
    return tokenSet;
  }

  private _reportDAT_PAsmCode(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    // skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const inLinePAsmRHSStr: string = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    const lineParts: string[] = this.parseUtils.getNonWhitePAsmLineParts(inLinePAsmRHSStr);
    currentOffset = line.indexOf(inLinePAsmRHSStr, currentOffset);
    // handle name in 1 column
    const bIsAlsoDebugLine: boolean = inLinePAsmRHSStr.toLowerCase().indexOf("debug(") != -1 ? true : false;
    if (bIsAlsoDebugLine) {
      const partialTokenSet: IParsedToken[] = this._reportDebugStatement(lineIdx, startingOffset, line);
      partialTokenSet.forEach((newToken) => {
        this._logSPIN("=> DATpasm: " + this._tokenString(newToken, line));
        tokenSet.push(newToken);
      });
    }
    // specials for detecting and failing FLexSpin'isms
    //
    //                 if NUMLOCK_DEFAULT_STATE && RPI_KEYBOARD_NUMLOCK_HACK
    //                 alts    hdev_port,#hdev_id
    //                 mov     htmp,0-0
    //                 cmp     htmp, ##$04D9_0006      wz      ' Holtek Pi keyboard vendor/product
    //         if_e    andn    kb_led_states, #LED_NUMLKF
    //                 end
    //
    let bFoundFlexSpin: boolean = false;
    if (lineParts.length > 1 && lineParts[0].toLowerCase() === "if") {
      // fail FlexSpin IF: if NUMLOCK_DEFAULT_STATE && RPI_KEYBOARD_NUMLOCK_HACK
      bFoundFlexSpin = true;
      this.semanticFindings.pushDiagnosticMessage(lineIdx, currentOffset, currentOffset + inLinePAsmRHSStr.length, eSeverity.Error, `FlexSpin if/end not conditional supported in P2 pasm`);
    } else if (lineParts.length > 0 && lineParts[0].toLowerCase() === "end") {
      // fail FlexSpin end:  end
      bFoundFlexSpin = true;
      this.semanticFindings.pushDiagnosticMessage(lineIdx, currentOffset, currentOffset + inLinePAsmRHSStr.length, eSeverity.Error, `FlexSpin if/end not conditional supported in P2 pasm`);
    }
    if (bFoundFlexSpin) {
      this._logPASM(`  --  DAT PAsm ERROR FlexSpin statement=[${inLinePAsmRHSStr}](${inLinePAsmRHSStr.length}), ofs=(${currentOffset})`);
      this._recordToken(tokenSet, line, {
        line: lineIdx,
        startCharacter: currentOffset,
        length: inLinePAsmRHSStr.length,
        ptTokenType: "variable", // mark this offender!
        ptTokenModifiers: ["illegalUse"],
      });
      return tokenSet;
    }
    let haveLabel: boolean = this.parseUtils.isDatOrPAsmLabel(lineParts[0]);
    let nameOffset: number = -1;
    const isDataDeclarationLine: boolean = lineParts.length > 1 && haveLabel && this.parseUtils.isDatStorageType(lineParts[1]) ? true : false;
    this._logPASM(`  -- reportDATPAsmDecl lineParts=[${lineParts}], haveLabel=(${haveLabel}), isDataDeclarationLine=(${isDataDeclarationLine})`);
    // TODO: REWRITE this to handle "non-label" line with unknown op-code!
    if (haveLabel) {
      // process label/variable name - starting in column 0
      const labelName: string = lineParts[0];
      nameOffset = line.indexOf(labelName, currentOffset);
      this._logPASM(`  -- labelName=[${labelName}], ofs=(${nameOffset})`);
      let referenceDetails: RememberedToken | undefined = undefined;
      if (this.semanticFindings.isGlobalToken(labelName)) {
        referenceDetails = this.semanticFindings.getGlobalToken(labelName);
        this._logPASM(`  --  FOUND global name=[${labelName}]`);
      }
      if (referenceDetails != undefined) {
        this._logPASM(`  --  DAT PAsm ${referenceDetails.type}=[${labelName}](${nameOffset + 1})`);
        const modifiersWDecl: string[] = referenceDetails.modifiersWith("declaration");
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: nameOffset,
          length: labelName.length,
          ptTokenType: referenceDetails.type,
          ptTokenModifiers: modifiersWDecl,
        });
        haveLabel = true;
      } else if (labelName.startsWith(":")) {
        // hrmf... no global type???? this should be a label?
        this._logPASM(`  --  DAT PAsm ERROR Spin1 label=[${labelName}](${0 + 1})`);
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: nameOffset,
          length: labelName.length,
          ptTokenType: "variable", // color this offender!
          ptTokenModifiers: ["illegalUse"],
        });
        this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + labelName.length, eSeverity.Error, `P1 pasm local name [${labelName}] not supported in P2 pasm`);
        haveLabel = true;
      } else if (labelName.toLowerCase() != "debug" && bIsAlsoDebugLine) {
        // hrmf... no global type???? this should be a label?
        this._logPASM(`  --  DAT PAsm ERROR NOT A label=[${labelName}](${0 + 1})`);
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: nameOffset,
          length: labelName.length,
          ptTokenType: "variable", // color this offender!
          ptTokenModifiers: ["illegalUse"],
        });
        this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + labelName.length, eSeverity.Error, `Not a legal P2 pasm label [${labelName}]`);
        haveLabel = true;
      } else if (this.parseUtils.isP1AsmInstruction(labelName)) {
        // hrmf... no global type???? this should be a label?
        this._logPASM(`  --  DAT P1asm BAD label=[${labelName}](${0 + 1})`);
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: nameOffset,
          length: labelName.length,
          ptTokenType: "variable", // color this offender!
          ptTokenModifiers: ["illegalUse"],
        });
        this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + labelName.length, eSeverity.Error, "Not a legal P2 pasm label");
        haveLabel = true;
      }
      currentOffset = nameOffset + labelName.length;
    }
    if (!isDataDeclarationLine) {
      // process assembly code
      let argumentOffset = 0;
      if (lineParts.length > 1) {
        let minNonLabelParts: number = 1;
        if (haveLabel) {
          // skip our label
          argumentOffset++;
          minNonLabelParts++;
        }
        this._logPASM(`  -- DAT PASM !dataDecl lineParts=[${lineParts}](${lineParts.length}), argumentOffset=(${argumentOffset}), minNonLabelParts=(${minNonLabelParts})`);
        if (lineParts[argumentOffset].toUpperCase().startsWith("IF_") || lineParts[argumentOffset].toUpperCase().startsWith("_RET_")) {
          // skip our conditional
          argumentOffset++;
          minNonLabelParts++;
        }
        if (lineParts.length > minNonLabelParts) {
          // have at least instruction name
          const likelyInstructionName: string = lineParts[minNonLabelParts - 1];
          nameOffset = line.indexOf(likelyInstructionName, currentOffset);
          this._logPASM(`  -- DAT PASM likelyInstructionName=[${likelyInstructionName}], nameOffset=(${nameOffset})`);
          currentOffset = nameOffset + likelyInstructionName.length; // move past the instruction
          for (let index = minNonLabelParts; index < lineParts.length; index++) {
            let argumentName = lineParts[index].replace(/[@#]/, "");
            if (argumentName.length < 1) {
              // skip empty operand
              continue;
            }
            if (index == lineParts.length - 1 && this.parseUtils.isP2AsmConditional(argumentName)) {
              // conditional flag-set spec.
              this._logPASM("  -- SKIP argumentName=[" + argumentName + "]");
              continue;
            }
            const argHasArrayRereference: boolean = argumentName.includes("[");
            if (argHasArrayRereference) {
              const nameParts: string[] = argumentName.split("[");
              argumentName = nameParts[0];
            }
            if (argumentName.charAt(0).match(/[a-zA-Z_\.\:]/)) {
              // does name contain a namespace reference?
              this._logPASM(`  -- argumentName=[${argumentName}]`);
              let possibleNameSet: string[] = [argumentName];
              if (this._isPossibleObjectReference(argumentName)) {
                // go register object reference!
                const bHaveObjReference = this._reportObjectReference(argumentName, lineIdx, currentOffset, line, tokenSet);
                if (bHaveObjReference) {
                  currentOffset = currentOffset + argumentName.length;
                  continue;
                }
                if (!argumentName.startsWith(".")) {
                  possibleNameSet = argumentName.split(".");
                }
              }
              this._logPASM(`  --  possibleNameSet=[${possibleNameSet}]`);
              const namePart = possibleNameSet[0];
              const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : `${possibleNameSet[0]}.${possibleNameSet[1]}`;
              nameOffset = line.indexOf(searchString, currentOffset);
              this._logPASM(`  --  DAT PAsm searchString=[${searchString}], ofs=(${nameOffset})`);
              let referenceDetails: RememberedToken | undefined = undefined;
              if (this.semanticFindings.isGlobalToken(namePart)) {
                referenceDetails = this.semanticFindings.getGlobalToken(namePart);
                this._logPASM(`  --  FOUND global name=[${namePart}]`);
              }
              if (referenceDetails != undefined) {
                this._logPASM(`  --  DAT PAsm name=[${namePart}](${nameOffset + 1})`);
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: namePart.length,
                  ptTokenType: referenceDetails.type,
                  ptTokenModifiers: referenceDetails.modifiers,
                });
              } else {
                // we use bIsDebugLine in next line so we don't flag debug() arguments!
                if (
                  !this.parseUtils.isP2AsmReservedWord(namePart) &&
                  !this.parseUtils.isP2AsmInstruction(namePart) &&
                  !this.parseUtils.isP2AsmConditional(namePart) &&
                  !this.parseUtils.isBinaryOperator(namePart) &&
                  !this.parseUtils.isBuiltinStreamerReservedWord(namePart) &&
                  !this.parseUtils.isCoginitReservedSymbol(namePart) &&
                  !this.parseUtils.isP2AsmModczOperand(namePart) &&
                  !this.parseUtils.isDebugMethod(namePart) &&
                  !this.parseUtils.isStorageType(namePart) &&
                  !bIsAlsoDebugLine
                ) {
                  this._logPASM("  --  DAT PAsm MISSING name=[" + namePart + "](" + (nameOffset + 1) + ")");
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: namePart.length,
                    ptTokenType: "variable",
                    ptTokenModifiers: ["illegalUse"],
                  });
                  if (namePart.startsWith(":")) {
                    this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P1 pasm local name [${namePart}] not supported in P2 pasm`);
                  } else if (this.parseUtils.isP1AsmVariable(namePart)) {
                    this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P1 pasm variable [${namePart}] not allowed in P2 pasm`);
                  } else {
                    this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `Missing P2 pasm name [${namePart}]`);
                  }
                }
              }
              currentOffset = nameOffset + namePart.length;
            }
          }
          if (this.parseUtils.isP1AsmInstruction(likelyInstructionName)) {
            const nameOffset: number = line.indexOf(likelyInstructionName, 0);
            this._logPASM("  --  DAT A P1asm BAD instru=[" + likelyInstructionName + "](" + (nameOffset + 1) + ")");
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: likelyInstructionName.length,
              ptTokenType: "variable",
              ptTokenModifiers: ["illegalUse"],
            });
            this.semanticFindings.pushDiagnosticMessage(
              lineIdx,
              nameOffset,
              nameOffset + likelyInstructionName.length,
              eSeverity.Error,
              `P1 pasm instruction [${likelyInstructionName}] not allowed in P2 pasm`
            );
          }
        }
      } else if (lineParts.length == 1 && this.parseUtils.isP1AsmInstruction(lineParts[0])) {
        const likelyInstructionName: string = lineParts[0];
        const nameOffset: number = line.indexOf(likelyInstructionName, 0);
        this._logPASM("  --  DAT B P1asm BAD instru=[" + likelyInstructionName + "](" + (nameOffset + 1) + ")");
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: nameOffset,
          length: likelyInstructionName.length,
          ptTokenType: "variable",
          ptTokenModifiers: ["illegalUse"],
        });
        this.semanticFindings.pushDiagnosticMessage(
          lineIdx,
          nameOffset,
          nameOffset + likelyInstructionName.length,
          eSeverity.Error,
          `P1 pasm instruction [${likelyInstructionName}] not allowed in P2 pasm`
        );
      }
    } else {
      // process data declaration
      if (this.parseUtils.isDatStorageType(lineParts[0])) {
        currentOffset = line.indexOf(lineParts[0], currentOffset);
      } else {
        // skip line part 0 length when searching for [1] name
        currentOffset = line.indexOf(lineParts[1], currentOffset + lineParts[0].length);
      }
      const allowLocalVarStatus: boolean = false;
      const IS_DAT_PASM: boolean = true;
      const partialTokenSet: IParsedToken[] = this._reportDAT_ValueDeclarationCode(lineIdx, currentOffset, line, allowLocalVarStatus, this.showPAsmCode, IS_DAT_PASM);
      partialTokenSet.forEach((newToken) => {
        tokenSet.push(newToken);
      });
    }
    return tokenSet;
  }

  private _reportPUB_PRI_Signature(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    const lineNbr: number = lineIdx + 1;
    const methodType = line.substr(0, 3).toUpperCase();
    const isPrivate = methodType.indexOf("PRI") != -1;
    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const spineDeclarationLHSStr = this._getNonCommentLineReturnComment(0, lineIdx, line, tokenSet);
    if (spineDeclarationLHSStr) {
    } // we don't use this string, we called this to record our rhs comment!
    // -----------------------------------
    //   Method Name
    //
    const startNameOffset = currentOffset;
    // find open paren - skipping past method name
    currentOffset = spineDeclarationLHSStr.indexOf("(", startNameOffset); // in spin1 ()'s are optional!
    const openParenOffset: number = currentOffset;
    if (currentOffset == -1) {
      currentOffset = spineDeclarationLHSStr.indexOf(":", startNameOffset);
      if (currentOffset == -1) {
        currentOffset = spineDeclarationLHSStr.indexOf("|", startNameOffset);
        if (currentOffset == -1) {
          currentOffset = spineDeclarationLHSStr.indexOf(" ", startNameOffset);
          if (currentOffset == -1) {
            currentOffset = spineDeclarationLHSStr.indexOf("'", startNameOffset);
            if (currentOffset == -1) {
              currentOffset = spineDeclarationLHSStr.length;
            }
          }
        }
      }
    }
    const methodName: string = line.substr(startNameOffset, currentOffset - startNameOffset).trim();
    const validMethodName: boolean = methodName.charAt(0).match(/[a-zA-Z_]/) != null;
    if (!validMethodName) {
      return tokenSet;
    }

    this.currentMethodName = methodName; // notify of latest method name so we can track inLine PASM symbols
    const spin2MethodName: string = methodName + "(";
    const spin2MethodNameSpace: string = methodName + " (";
    this._logSPIN("-reportPubPriSig: spin2MethodName=[" + spin2MethodName + "], startNameOffset=(" + startNameOffset + ")");
    const bHaveSpin2Method: boolean = line.includes(spin2MethodName) || line.includes(spin2MethodNameSpace);
    if (bHaveSpin2Method) {
      const declModifiers: string[] = isPrivate ? ["declaration", "static"] : ["declaration"];
      this._recordToken(tokenSet, line, {
        line: lineIdx,
        startCharacter: startNameOffset,
        length: methodName.length,
        ptTokenType: "method",
        ptTokenModifiers: declModifiers,
      });
      this._logSPIN("-reportPubPriSig: methodName=[" + methodName + "], startNameOffset=(" + startNameOffset + ")");
    } else {
      // have a P1 style method declaration, flag it!
      const declModifiers: string[] = isPrivate ? ["declaration", "static", "illegalUse"] : ["declaration", "illegalUse"];
      this._recordToken(tokenSet, line, {
        line: lineIdx,
        startCharacter: startNameOffset,
        length: methodName.length,
        ptTokenType: "method",
        ptTokenModifiers: declModifiers,
      });
      const methodPrefix: string = isPrivate ? "PRI" : "PUB";
      this.semanticFindings.pushDiagnosticMessage(
        lineIdx,
        startNameOffset,
        startNameOffset + methodName.length,
        eSeverity.Error,
        `P1 Spin style declaration [${methodPrefix} ${methodName}] (without paren's) not allowed in P2 Spin`
      );
      this._logSPIN("-reportPubPriSig: SPIN1 methodName=[" + methodName + "], startNameOffset=(" + startNameOffset + ")");
    }
    // record definition of method
    // -----------------------------------
    //   Parameters
    //
    // find close paren - so we can study parameters
    let closeParenOffset: number = -1;
    if (bHaveSpin2Method) {
      closeParenOffset = line.indexOf(")", currentOffset);
    }
    if (closeParenOffset != -1 && currentOffset + 1 != closeParenOffset) {
      // we have parameter(s)!
      const parameterStr = line.substr(currentOffset + 1, closeParenOffset - currentOffset - 1).trim();
      let parameterNames: string[] = [];
      if (parameterStr.includes(",")) {
        // we have multiple parameters
        parameterNames = parameterStr.split(",");
      } else {
        // we have one parameter
        parameterNames = [parameterStr];
      }
      for (let index = 0; index < parameterNames.length; index++) {
        const paramNameRaw: string = parameterNames[index].trim();
        let paramName: string = paramNameRaw;
        const hasFlexSpinDefaultValue: boolean = paramName.includes("=");
        const nameOffset = line.indexOf(paramName, currentOffset);
        if (hasFlexSpinDefaultValue) {
          const assignmentParts: string[] = paramName.split("=");
          paramName = assignmentParts[0].trim();
        }
        this._logSPIN(`  -- paramName=[${paramName}], ofs=(${nameOffset})`);
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: nameOffset,
          length: paramName.length,
          ptTokenType: "parameter",
          ptTokenModifiers: ["declaration", "readonly", "local"],
        });
        // remember so we can ID references
        this.semanticFindings.setLocalTokenForMethod(methodName, paramName, new RememberedToken("parameter", lineNbr - 1, ["readonly", "local"]), this._declarationComment()); // TOKEN SET in _report()

        if (hasFlexSpinDefaultValue) {
          this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + paramNameRaw.length, eSeverity.Error, `Parameter default value [${paramNameRaw}] not allowed in P2 Spin`);
        }
        currentOffset = nameOffset + paramName.length;
      }
    }
    // -----------------------------------
    //   Return Variable(s)
    //
    // find return vars
    const returnValueSep = line.indexOf(":", currentOffset);
    const localVarsSep = line.indexOf("|", currentOffset);
    let beginCommentOffset = line.indexOf("'", currentOffset);
    if (beginCommentOffset === -1) {
      beginCommentOffset = line.indexOf("{", currentOffset);
    }
    const nonCommentEOL = beginCommentOffset != -1 ? beginCommentOffset - 1 : line.length - 1;
    const returnVarsEnd = localVarsSep != -1 ? localVarsSep - 1 : nonCommentEOL;
    let returnValueNames: string[] = [];
    if (returnValueSep != -1) {
      // we have return var(s)!
      // we move currentOffset along so we don't falsely find short variable names earlier in string!
      currentOffset = returnValueSep + 1;
      const varNameStr = line.substr(returnValueSep + 1, returnVarsEnd - returnValueSep).trim();
      if (varNameStr.indexOf(",")) {
        // have multiple return value names
        returnValueNames = varNameStr.split(",");
      } else {
        // have a single return value name
        returnValueNames = [varNameStr];
      }
      for (let index = 0; index < returnValueNames.length; index++) {
        const returnValueName = returnValueNames[index].trim();
        const nameOffset = line.indexOf(returnValueName, currentOffset);
        this._logSPIN("  -- returnValueName=[" + returnValueName + "](" + nameOffset + ")");
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: nameOffset,
          length: returnValueName.length,
          ptTokenType: "returnValue",
          ptTokenModifiers: ["declaration", "local"],
        });
        // remember so we can ID references
        this.semanticFindings.setLocalTokenForMethod(methodName, returnValueName, new RememberedToken("returnValue", lineNbr - 1, ["local"]), this._declarationComment()); // TOKEN SET in _report()
        currentOffset = nameOffset + returnValueName.length;
      }
    }
    // -----------------------------------
    //   Local Variable(s)
    //
    // find local vars
    if (localVarsSep != -1) {
      // we have local var(s)!
      const localVarStr = line.substr(localVarsSep + 1, nonCommentEOL - localVarsSep).trim();
      // we move currentOffset along so we don't falsely find short variable names earlier in string!
      currentOffset = localVarsSep + 1;
      let localVarNames: string[] = [];
      if (localVarStr.indexOf(",")) {
        // have multiple return value names
        localVarNames = localVarStr.split(",");
      } else {
        // have a single return value name
        localVarNames = [localVarStr];
      }
      this._logSPIN("  -- localVarNames=[" + localVarNames + "]");
      for (let index = 0; index < localVarNames.length; index++) {
        const localVariableName = localVarNames[index].trim();
        const localVariableOffset = line.indexOf(localVariableName, currentOffset);
        this._logSPIN("  -- processing localVariableName=[" + localVariableName + "]");
        let nameParts: string[] = [];
        if (localVariableName.includes(" ")) {
          // have name with storage and/or alignment operators
          nameParts = localVariableName.split(" ");
        } else {
          // have single name
          nameParts = [localVariableName];
        }
        this._logSPIN("  -- nameParts=[" + nameParts + "]");
        let nameOffset: number = 0;
        for (let index = 0; index < nameParts.length; index++) {
          let localName = nameParts[index];
          // have name similar to scratch[12]?
          if (localName.includes("[") || localName.includes("]")) {
            // yes remove array suffix
            const lineInfo: IFilteredStrings = this._getNonWhiteSpinLineParts(localName);
            let localNameParts: string[] = lineInfo.lineParts;
            this._logSPIN("  -- post[] localNameParts=[" + localNameParts + "]");
            localName = localNameParts[0];
            for (let index = 0; index < localNameParts.length; index++) {
              const namedIndexPart = localNameParts[index];
              nameOffset = line.indexOf(namedIndexPart, currentOffset);
              if (namedIndexPart.charAt(0).match(/[a-zA-Z_]/)) {
                this._logSPIN("  -- checking namedIndexPart=[" + namedIndexPart + "]");
                let referenceDetails: RememberedToken | undefined = undefined;
                if (this.semanticFindings.isLocalToken(namedIndexPart)) {
                  referenceDetails = this.semanticFindings.getLocalTokenForLine(namedIndexPart, lineNbr);
                  this._logSPIN(`  --  FOUND local name=[${namedIndexPart}] found: ${referenceDetails != undefined}`);
                } else if (this.semanticFindings.isGlobalToken(namedIndexPart)) {
                  referenceDetails = this.semanticFindings.getGlobalToken(namedIndexPart);
                  this._logSPIN(`  --  FOUND global name=[${namedIndexPart}] found: ${referenceDetails != undefined}`);
                }
                if (referenceDetails != undefined) {
                  this._logSPIN("  --  lcl-idx variableName=[" + namedIndexPart + "](" + (nameOffset + 1) + ")");
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: namedIndexPart.length,
                    ptTokenType: referenceDetails.type,
                    ptTokenModifiers: referenceDetails.modifiers,
                  });
                } else {
                  if (
                    !this.parseUtils.isSpinReservedWord(namedIndexPart) &&
                    !this.parseUtils.isSpinBuiltinMethod(namedIndexPart) &&
                    !this.parseUtils.isBuiltinStreamerReservedWord(namedIndexPart) &&
                    !this.parseUtils.isDebugMethod(namedIndexPart) &&
                    !this.parseUtils.isDebugControlSymbol(namedIndexPart)
                  ) {
                    // found new local variable name, register it
                    this._logSPIN("  --  SPIN NEW local varname=[" + namedIndexPart + "](" + (nameOffset + 1) + ")");
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: namedIndexPart.length,
                      ptTokenType: "variable",
                      ptTokenModifiers: ["declaration", "local"],
                    });
                    // remember so we can ID references
                    this.semanticFindings.setLocalTokenForMethod(methodName, namedIndexPart, new RememberedToken("variable", lineNbr - 1, ["local"]), this._declarationComment()); // TOKEN SET in _report()
                  }
                }
              }
              currentOffset = nameOffset + namedIndexPart.length;
            }
          } else {
            nameOffset = line.indexOf(localName, localVariableOffset);
            this._logSPIN("  -- localName=[" + localName + "](" + nameOffset + ")");
            if (index == nameParts.length - 1) {
              // have name
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: localName.length,
                ptTokenType: "variable",
                ptTokenModifiers: ["declaration", "local"],
              });
              // remember so we can ID references
              this.semanticFindings.setLocalTokenForMethod(methodName, localName, new RememberedToken("variable", lineNbr - 1, ["local"]), this._declarationComment()); // TOKEN SET in _report()
            } else {
              // have modifier!
              if (this.parseUtils.isStorageType(localName)) {
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: localName.length,
                  ptTokenType: "storageType",
                  ptTokenModifiers: [],
                });
              } else if (this.parseUtils.isAlignType(localName)) {
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: localName.length,
                  ptTokenType: "storageType",
                  ptTokenModifiers: [],
                });
              }
            }
            currentOffset = nameOffset + localName.length;
          }
        }
      }
    }
    return tokenSet;
  }

  private _reportSPIN_Code(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    const lineNbr: number = lineIdx + 1;
    // skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const nonCommentSpinLine = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    const remainingLength: number = nonCommentSpinLine.length;
    this._logCON("- reportSPIN nonCommentSpinLine=[" + nonCommentSpinLine + "] remainingLength=" + remainingLength);
    if (remainingLength > 0) {
      // special early error case
      if (nonCommentSpinLine.toLowerCase().includes("else if")) {
        const nameOffset = line.toLowerCase().indexOf("else if", currentOffset);
        this._logSPIN("  --  Illegal ELSE-IF [" + nonCommentSpinLine + "]");
        const tokenLength: number = "else if".length;
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: nameOffset,
          length: tokenLength,
          ptTokenType: "keyword",
          ptTokenModifiers: ["illegalUse"],
        });
        this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + tokenLength, eSeverity.Error, 'Illegal "else if" form for P2 Spin');
      }

      // FIXME: TODO: unwrap inline method calls withing method calls

      // locate key indicators of line style
      let assignmentOffset: number = nonCommentSpinLine.includes(":=") ? line.indexOf(":=", currentOffset) : -1;
      if (assignmentOffset != -1) {
        // -------------------------------------------
        // have line assigning value to variable(s)
        //  Process LHS side of this assignment
        // -------------------------------------------
        const possibleVariableName = line.substr(currentOffset, assignmentOffset - currentOffset).trim();
        this._logSPIN("  -- LHS: possibleVariableName=[" + possibleVariableName + "]");
        let varNameList: string[] = [possibleVariableName];
        if (possibleVariableName.includes(",")) {
          varNameList = possibleVariableName.split(",");
        }
        if (possibleVariableName.includes(" ")) {
          // force special case range chars to be removed
          //  Ex: RESP_OVER..RESP_NOT_FOUND : error_code.byte[3] := mod
          // change .. to : so it is removed by getNonWhite...
          const filteredLine: string = possibleVariableName.replace("..", ":");
          const lineInfo: IFilteredStrings = this._getNonWhiteSpinLineParts(filteredLine);
          varNameList = lineInfo.lineParts;
        }
        this._logSPIN("  -- LHS: varNameList=[" + varNameList + "]");
        for (let index = 0; index < varNameList.length; index++) {
          const variableName: string = varNameList[index];
          if (variableName.includes("[")) {
            // NOTE this handles code: byte[pColor][2] := {value}
            // NOTE2 this handles code: result.byte[3] := {value}  P2 OBEX: jm_apa102c.spin2 (139)
            // have complex target name, parse in loop
            const variableNameParts: string[] = variableName.split(/[ \t\[\]\/\*\+\-\(\)\<\>]/);
            this._logSPIN("  -- LHS: [] variableNameParts=[" + variableNameParts + "]");
            for (let index = 0; index < variableNameParts.length; index++) {
              let variableNamePart = variableNameParts[index].replace("@", "");
              // secial case handle datar.[i] which leaves var name as 'darar.'
              if (variableNamePart.endsWith(".")) {
                variableNamePart = variableNamePart.substr(0, variableNamePart.length - 1);
              }
              const nameOffset = line.indexOf(variableNamePart, currentOffset);
              if (variableNamePart.charAt(0).match(/[a-zA-Z_]/)) {
                let possibleNameSet: string[] = [variableNamePart];
                if (this._isPossibleObjectReference(variableNamePart)) {
                  // go register object reference!
                  const bHaveObjReference = this._reportObjectReference(variableNamePart, lineIdx, currentOffset, line, tokenSet);
                  if (bHaveObjReference) {
                    currentOffset = currentOffset + variableNamePart.length;
                    continue;
                  }
                }
                if (variableNamePart.includes(".")) {
                  const varNameParts: string[] = variableNamePart.split(".");
                  if (this.parseUtils.isDatStorageType(varNameParts[1])) {
                    variableNamePart = varNameParts[0]; // just use first part of name
                  }
                }
                this._logSPIN("  -- variableNamePart=[" + variableNamePart + "](" + (nameOffset + 1) + ")");
                if (this.parseUtils.isStorageType(variableNamePart)) {
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: variableNamePart.length,
                    ptTokenType: "storageType",
                    ptTokenModifiers: [],
                  });
                } else {
                  let referenceDetails: RememberedToken | undefined = undefined;
                  if (this.semanticFindings.isLocalToken(variableNamePart)) {
                    referenceDetails = this.semanticFindings.getLocalTokenForLine(variableNamePart, lineNbr);
                    this._logSPIN("  --  FOUND local name=[" + variableNamePart + "]");
                  } else if (this.semanticFindings.isGlobalToken(variableNamePart)) {
                    referenceDetails = this.semanticFindings.getGlobalToken(variableNamePart);
                    this._logSPIN("  --  FOUND global name=[" + variableNamePart + "]");
                  }
                  if (referenceDetails != undefined) {
                    const modificationArray: string[] = referenceDetails.modifiersWith("modification");
                    this._logSPIN("  --  SPIN variableName=[" + variableNamePart + "](" + (nameOffset + 1) + ")");
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: variableNamePart.length,
                      ptTokenType: referenceDetails.type,
                      ptTokenModifiers: modificationArray,
                    });
                  } else {
                    if (
                      !this.parseUtils.isSpinReservedWord(variableNamePart) &&
                      !this.parseUtils.isBuiltinStreamerReservedWord(variableNamePart) &&
                      !this.parseUtils.isDebugMethod(variableNamePart) &&
                      !this.parseUtils.isDebugControlSymbol(variableNamePart) &&
                      !this.parseUtils.isSpinBuiltinMethod(variableNamePart)
                    ) {
                      // we don't have name registered so just mark it
                      this._logSPIN("  --  SPIN MISSING varname=[" + variableNamePart + "](" + (nameOffset + 1) + ")");
                      this._recordToken(tokenSet, line, {
                        line: lineIdx,
                        startCharacter: nameOffset,
                        length: variableNamePart.length,
                        ptTokenType: "variable",
                        ptTokenModifiers: ["modification", "missingDeclaration"],
                      });
                      this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + variableNamePart.length, eSeverity.Error, `P2 Spin B missing declaration [${variableNamePart}]`);
                    }
                  }
                }
              }
              currentOffset = nameOffset + variableNamePart.length + 1;
            }
          } else {
            // have simple target name, no []
            let cleanedVariableName: string = variableName.replace(/[ \t\(\)]/, "");
            let nameOffset = line.indexOf(cleanedVariableName, currentOffset);
            if (cleanedVariableName.charAt(0).match(/[a-zA-Z_]/) && !this.parseUtils.isStorageType(cleanedVariableName) && !this.parseUtils.isSpinSpecialMethod(cleanedVariableName)) {
              this._logSPIN("  --  SPIN cleanedVariableName=[" + cleanedVariableName + "], ofs=(" + (nameOffset + 1) + ")");
              // does name contain a namespace reference?
              if (this._isPossibleObjectReference(cleanedVariableName)) {
                let bHaveObjReference: boolean = this._reportObjectReference(cleanedVariableName, lineIdx, startingOffset, line, tokenSet);
                if (!bHaveObjReference) {
                  let varNameParts: string[] = cleanedVariableName.split(".");
                  this._logSPIN("  --  varNameParts=[" + varNameParts + "]");
                  if (varNameParts.length > 1 && this.parseUtils.isDatStorageType(varNameParts[1])) {
                    varNameParts = [varNameParts[0]]; // just use first part of name
                  }
                  let namePart = varNameParts[0];
                  const searchString: string = varNameParts.length == 1 ? varNameParts[0] : varNameParts[0] + "." + varNameParts[1];
                  nameOffset = line.indexOf(searchString, currentOffset);
                  this._logSPIN("  --  SPIN LHS   searchString=[" + searchString + "]");
                  this._logSPIN("  --  SPIN LHS    nameOffset=(" + nameOffset + "), currentOffset=(" + currentOffset + ")");
                  let referenceDetails: RememberedToken | undefined = undefined;
                  if (this.semanticFindings.isLocalToken(namePart)) {
                    referenceDetails = this.semanticFindings.getLocalTokenForLine(namePart, lineNbr);
                    this._logSPIN("  --  FOUND local name=[" + namePart + "]");
                  } else if (this.semanticFindings.isGlobalToken(namePart)) {
                    referenceDetails = this.semanticFindings.getGlobalToken(namePart);
                    this._logSPIN("  --  FOUND global name=[" + namePart + "]");
                    if (referenceDetails != undefined && referenceDetails?.type == "method") {
                      const methodCallNoSpace = `${namePart}(`;
                      const methodCallSpace = `${namePart} (`;
                      const addressOf = `@${namePart}`;
                      // if it's not a legit method call, kill the reference
                      if (!line.includes(methodCallNoSpace) && !line.includes(methodCallSpace) && !searchString.includes(addressOf)) {
                        this._logSPIN(`  --  MISSING parens on method=[${namePart}]`);
                        referenceDetails = undefined;
                      }
                    }
                  }
                  if (referenceDetails != undefined) {
                    this._logSPIN("  --  SPIN RHS name=[" + namePart + "], ofs(" + (nameOffset + 1) + ")");
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: namePart.length,
                      ptTokenType: referenceDetails.type,
                      ptTokenModifiers: referenceDetails.modifiers,
                    });
                  } else {
                    const searchKey: string = namePart.toLowerCase();
                    const isMethodNoParen: boolean = searchKey == "return" || searchKey == "abort";
                    // have unknown name!? is storage type spec?
                    if (this.parseUtils.isStorageType(namePart)) {
                      this._logSPIN("  --  SPIN RHS storageType=[" + namePart + "]");
                      this._recordToken(tokenSet, line, {
                        line: lineIdx,
                        startCharacter: nameOffset,
                        length: namePart.length,
                        ptTokenType: "storageType",
                        ptTokenModifiers: [],
                      });
                    } else if (this.parseUtils.isSpinBuiltinMethod(namePart) && !searchString.includes(namePart + "(") && !this.parseUtils.isSpinNoparenMethod(namePart)) {
                      this._logSPIN("  --  SPIN MISSING PARENS name=[" + namePart + "]");
                      this._recordToken(tokenSet, line, {
                        line: lineIdx,
                        startCharacter: nameOffset,
                        length: namePart.length,
                        ptTokenType: "method",
                        ptTokenModifiers: ["builtin", "missingDeclaration"],
                      });
                      this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P2 Spin missing parens after [${namePart}]`);
                    }
                    // we use bIsDebugLine in next line so we don't flag debug() arguments!
                    else if (
                      !this.parseUtils.isSpinReservedWord(namePart) &&
                      !this.parseUtils.isSpinBuiltinMethod(namePart) &&
                      !this.parseUtils.isBuiltinStreamerReservedWord(namePart) &&
                      !this.parseUtils.isCoginitReservedSymbol(namePart) &&
                      !this.parseUtils.isDebugMethod(namePart) &&
                      !this.parseUtils.isDebugControlSymbol(namePart) &&
                      !this.parseUtils.isDebugInvocation(namePart)
                    ) {
                      // NO DEBUG FOR ELSE, most of spin control elements come through here!
                      //else {
                      //    this._logSPIN('  -- UNKNOWN?? name=[' + namePart + '] - name-get-breakage??');
                      //}
                      this._logSPIN("  --  SPIN MISSING rhs name=[" + namePart + "]");
                      this._recordToken(tokenSet, line, {
                        line: lineIdx,
                        startCharacter: nameOffset,
                        length: namePart.length,
                        ptTokenType: "variable",
                        ptTokenModifiers: ["missingDeclaration"],
                      });
                      this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P2 Spin C missing declaration [${namePart}]`);
                    }
                  }
                  currentOffset = nameOffset + namePart.length + 1;
                }
              } else {
                let referenceDetails: RememberedToken | undefined = undefined;
                nameOffset = line.indexOf(cleanedVariableName, currentOffset);
                const haveGlobalToken: boolean = this.semanticFindings.isGlobalToken(cleanedVariableName);
                if (this.semanticFindings.isLocalToken(cleanedVariableName)) {
                  referenceDetails = this.semanticFindings.getLocalTokenForLine(cleanedVariableName, lineNbr);
                  this._logSPIN(`  --  FOUND local name=[${cleanedVariableName}, referenceDetails=[${referenceDetails}]]`);
                  if (referenceDetails && haveGlobalToken) {
                    this.semanticFindings.pushDiagnosticMessage(
                      lineIdx,
                      nameOffset,
                      nameOffset + cleanedVariableName.length,
                      eSeverity.Information,
                      `P2 Spin local name [${cleanedVariableName}] is hiding global variable of same name`
                    );
                  }
                }
                if (!referenceDetails && haveGlobalToken) {
                  referenceDetails = this.semanticFindings.getGlobalToken(cleanedVariableName);
                  this._logSPIN("  --  FOUND global name=[" + cleanedVariableName + "]");
                }
                if (referenceDetails != undefined) {
                  const modificationArray: string[] = referenceDetails.modifiersWith("modification");
                  this._logSPIN("  -- spin: simple variableName=[" + cleanedVariableName + "], ofs(" + (nameOffset + 1) + ")");
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: cleanedVariableName.length,
                    ptTokenType: referenceDetails.type,
                    ptTokenModifiers: modificationArray,
                  });
                } else if (cleanedVariableName == "_") {
                  this._logSPIN("  --  built-in=[" + cleanedVariableName + "], ofs(" + (nameOffset + 1) + ")");
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: cleanedVariableName.length,
                    ptTokenType: "variable",
                    ptTokenModifiers: ["modification", "defaultLibrary"],
                  });
                } else {
                  // we don't have name registered so just mark it
                  if (
                    !this.parseUtils.isSpinReservedWord(cleanedVariableName) &&
                    !this.parseUtils.isSpinBuiltinMethod(cleanedVariableName) &&
                    !this.parseUtils.isBuiltinStreamerReservedWord(cleanedVariableName) &&
                    !this.parseUtils.isDebugMethod(cleanedVariableName) &&
                    !this.parseUtils.isDebugControlSymbol(cleanedVariableName)
                  ) {
                    this._logSPIN("  --  SPIN MISSING cln name=[" + cleanedVariableName + "], ofs(" + (nameOffset + 1) + ")");
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: cleanedVariableName.length,
                      ptTokenType: "variable",
                      ptTokenModifiers: ["modification", "missingDeclaration"],
                    });
                    this.semanticFindings.pushDiagnosticMessage(
                      lineIdx,
                      nameOffset,
                      nameOffset + cleanedVariableName.length,
                      eSeverity.Error,
                      `P2 Spin D missing declaration [${cleanedVariableName}]`
                    );
                  }
                }
              }
            }
            currentOffset = nameOffset + cleanedVariableName.length + 1;
          }
        }
        currentOffset = assignmentOffset + 2;
      }
      // -------------------------------------------
      // could be line with RHS of assignment or a
      //  line with no assignment (process it)
      // -------------------------------------------
      const assignmentRHSStr: string = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
      currentOffset = line.indexOf(assignmentRHSStr, currentOffset);
      const preCleanAssignmentRHSStr = this.parseUtils.getNonInlineCommentLine(assignmentRHSStr).replace("..", "  ");
      const dotOffset: number = assignmentRHSStr.indexOf(".");
      const spaceOffset: number = assignmentRHSStr.indexOf(" ");
      const tabOffset: number = assignmentRHSStr.indexOf("\t");
      const bracketOffset: number = assignmentRHSStr.indexOf("[");
      const parenOffset: number = assignmentRHSStr.indexOf("(");
      const whiteOffset: number = spaceOffset != -1 ? spaceOffset : tabOffset;
      const hasWhite: boolean = whiteOffset != -1;
      // we have a single element if we have "." with "[" and "[" is before "."
      let singleElement: boolean = dotOffset != -1 && bracketOffset != -1 && dotOffset > bracketOffset ? true : false;
      if (singleElement && hasWhite && parenOffset != -1 && parenOffset > whiteOffset) {
        // if whitespace before paren we have white in statement vs in parameter list
        singleElement = false;
      }
      if (singleElement && hasWhite) {
        // if whitespace without parens we have white in statement
        singleElement = false;
      }
      this._logSPIN(`  -- SPIN assignmentRHSStr=[${assignmentRHSStr}], singleElement=(${singleElement})`);

      // SPECIAL Ex: scroller[scrollerIndex].initialize()
      if (singleElement && this._isPossibleObjectReference(assignmentRHSStr) && assignmentRHSStr.includes("[")) {
        let bHaveObjReference: boolean = this._reportObjectReference(assignmentRHSStr, lineIdx, currentOffset, line, tokenSet);
        if (bHaveObjReference) {
          return tokenSet;
        }
      }
      // special code to handle case range strings:  [e.g., SEG_TOP..SEG_BOTTOM:]
      //const isCaseValue: boolean = assignmentRHSStr.endsWith(':');
      //if (isCaseValue && possNames[0].includes("..")) {
      //    possNames = possNames[0].split("..");
      //}
      const lineInfo: IFilteredStrings = this._getNonWhiteSpinLineParts(preCleanAssignmentRHSStr);
      let possNames: string[] = lineInfo.lineParts;
      const nonStringAssignmentRHSStr: string = lineInfo.lineNoQuotes;
      this._logSPIN("  -- possNames=[" + possNames + "](" + possNames.length + ")");
      const firstName: string = possNames.length > 0 ? possNames[0] : "";
      const bIsDebugLine: boolean = nonStringAssignmentRHSStr.toLowerCase().indexOf("debug(") != -1 ? true : false;
      const assignmentStringOffset = currentOffset;
      this._logSPIN(`  -- assignmentStringOffset=[${assignmentStringOffset}], bIsDebugLine=(${bIsDebugLine})`);
      let offsetInNonStringRHS = 0;
      let currNameLength: number = 0;
      for (let index = 0; index < possNames.length; index++) {
        let possibleName = possNames[index];
        // special code to handle case of var.[bitfield] leaving name a 'var.'
        if (possibleName.endsWith(".")) {
          possibleName = possibleName.substr(0, possibleName.length - 1);
        }
        // special code to handle case of @pasmName leaving name a 'var.'
        //if (possibleName.startsWith("@")) {
        //  possibleName = possibleName.substring(1); // remove leading char
        //}
        let possibleNameSet: string[] = [possibleName];
        let nameOffset: number = 0;
        currNameLength = possibleName.length;
        if (possibleName.charAt(0).match(/[a-zA-Z_]/)) {
          this._logSPIN("  -- possibleName=[" + possibleName + "]");
          // does name contain a namespace reference?
          if (possibleName.includes(".")) {
            possibleNameSet = possibleName.split(".");
            this._logSPIN("  --  possibleNameSet=[" + possibleNameSet + "]");
          }
          const namePart = possibleNameSet[0];
          currNameLength = namePart.length;
          offsetInNonStringRHS = nonStringAssignmentRHSStr.indexOf(possibleName, offsetInNonStringRHS);
          nameOffset = offsetInNonStringRHS + assignmentStringOffset;
          let bHaveObjReference: boolean = this._isPossibleObjectReference(possibleName) ? this._reportObjectReference(possibleName, lineIdx, offsetInNonStringRHS, line, tokenSet) : false;
          if (!bHaveObjReference) {
            const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : possibleNameSet[0] + "." + possibleNameSet[1];
            nameOffset = nonStringAssignmentRHSStr.indexOf(searchString, offsetInNonStringRHS) + assignmentStringOffset; // so we don't match in in strings...
            this._logSPIN(`  --  SPIN RHS  nonStringAssignmentRHSStr=[${nonStringAssignmentRHSStr}]`);
            this._logSPIN(`  --  SPIN RHS   searchString=[${searchString}]`);
            this._logSPIN(`  --  SPIN RHS    nameOffset=(${nameOffset}), offsetInNonStringRHS=(${offsetInNonStringRHS}), currentOffset=(${currentOffset})`);
            let referenceDetails: RememberedToken | undefined = undefined;
            const haveGlobalToken: boolean = this.semanticFindings.isGlobalToken(namePart);
            if (this.semanticFindings.isLocalToken(namePart)) {
              referenceDetails = this.semanticFindings.getLocalTokenForLine(namePart, lineNbr);
              this._logSPIN("  --  FOUND local name=[" + namePart + "]");
              if (referenceDetails && haveGlobalToken) {
                this.semanticFindings.pushDiagnosticMessage(
                  lineIdx,
                  nameOffset,
                  nameOffset + namePart.length,
                  eSeverity.Information,
                  `P2 Spin local name [${namePart}] is hiding global variable of same name`
                );
              }
            }
            if (!referenceDetails && haveGlobalToken) {
              referenceDetails = this.semanticFindings.getGlobalToken(namePart);
              this._logSPIN("  --  FOUND global name=[" + namePart + "]");
              if (referenceDetails != undefined && referenceDetails?.type == "method") {
                const methodCallNoSpace = `${namePart}(`;
                const methodCallSpace = `${namePart} (`;
                const addressOf = `@${namePart}`;
                if (!nonStringAssignmentRHSStr.includes(methodCallNoSpace) && !nonStringAssignmentRHSStr.includes(methodCallSpace) && !nonStringAssignmentRHSStr.includes(addressOf)) {
                  this._logSPIN("  --  MISSING parens on method=[" + namePart + "]");
                  referenceDetails = undefined;
                }
              }
            }
            if (referenceDetails != undefined) {
              this._logSPIN(`  --  SPIN RHS name=[${namePart}](${namePart.length}), ofs=(${nameOffset + 1})`);
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: namePart.length,
                ptTokenType: referenceDetails.type,
                ptTokenModifiers: referenceDetails.modifiers,
              });
            } else {
              if (this.parseUtils.isFloatConversion(namePart) && (nonStringAssignmentRHSStr.indexOf(namePart + "(") == -1 || nonStringAssignmentRHSStr.indexOf(namePart + "()") != -1)) {
                this._logSPIN("  --  SPIN MISSING PARENS name=[" + namePart + "]");
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: namePart.length,
                  ptTokenType: "method",
                  ptTokenModifiers: ["builtin", "missingDeclaration"],
                });
                this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, "P2 Spin missing parens");
              } else if (this.parseUtils.isStorageType(namePart)) {
                // have unknown name!? is storage type spec?
                this._logSPIN("  --  SPIN RHS storageType=[" + namePart + "]");
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: namePart.length,
                  ptTokenType: "storageType",
                  ptTokenModifiers: [],
                });
              } else if (this.parseUtils.isSpinBuiltinMethod(namePart) && !nonStringAssignmentRHSStr.includes(namePart + "(") && !this.parseUtils.isSpinNoparenMethod(namePart)) {
                this._logSPIN("  --  SPIN MISSING PARENS name=[" + namePart + "]");
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: namePart.length,
                  ptTokenType: "method",
                  ptTokenModifiers: ["builtin", "missingDeclaration"],
                });
                this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, "P2 Spin missing parens");
              }
              // we use bIsDebugLine in next line so we don't flag debug() arguments!
              else if (
                !this.parseUtils.isSpinReservedWord(namePart) &&
                !this.parseUtils.isSpinBuiltinMethod(namePart) &&
                !this.parseUtils.isBuiltinStreamerReservedWord(namePart) &&
                !this.parseUtils.isSpinSpecialMethod(namePart) &&
                !this.parseUtils.isCoginitReservedSymbol(namePart) &&
                !this.parseUtils.isDebugMethod(namePart) &&
                !this.parseUtils.isDebugControlSymbol(namePart) &&
                !bIsDebugLine &&
                !this.parseUtils.isDebugInvocation(namePart)
              ) {
                // NO DEBUG FOR ELSE, most of spin control elements come through here!
                //else {
                //    this._logSPIN('  -- UNKNOWN?? name=[' + namePart + '] - name-get-breakage??');
                //}

                this._logSPIN("  --  SPIN MISSING rhs name=[" + namePart + "]");
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: namePart.length,
                  ptTokenType: "variable",
                  ptTokenModifiers: ["missingDeclaration"],
                });
                if (this.parseUtils.isP1SpinMethod(namePart)) {
                  this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P1 Spin method [${namePart}()] not allowed in P2 Spin`);
                } else if (this.parseUtils.isP1AsmVariable(namePart)) {
                  this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P1 Pasm reserved word [${namePart}] not allowed in P2 Spin`);
                } else if (this.parseUtils.isP1SpinVariable(namePart)) {
                  this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P1 Spin variable [${namePart}] not allowed in P2 Spin`);
                } else {
                  this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P2 Spin E missing declaration [${namePart}]`);
                }
              }
              currNameLength = namePart.length;
            }
            if (possibleNameSet.length > 1) {
              // we have .constant namespace suffix
              // determine if this is method has '(' or constant name
              const constantPart: string = possibleNameSet[1];
              currNameLength = constantPart.length;
              if (!this.parseUtils.isStorageType(constantPart)) {
                // FIXME: UNDONE remove when syntax see this correctly
                const nameOffset: number = line.indexOf(constantPart, currentOffset);
                this._logSPIN(`  --  SPIN rhs whatIsThis?=[${constantPart}](${constantPart.length}), ofs=(${nameOffset + 1})`);
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: constantPart.length,
                  ptTokenType: "variable",
                  ptTokenModifiers: ["illegalUse"],
                });
                this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + constantPart.length, eSeverity.Error, `P2 Spin failed to parse line with [${constantPart}]`);
              }
            }
          } else {
            // found object ref. include it in length
            currNameLength = possibleName.length;
          }
        } else if (possibleName.startsWith(".")) {
          const externalMethodName: string = possibleName.replace(".", "");
          currNameLength = externalMethodName.length;
          nameOffset = nonStringAssignmentRHSStr.indexOf(externalMethodName, offsetInNonStringRHS) + currentOffset;
          this._logSPIN(`  --  SPIN rhs externalMethodName=[${externalMethodName}](${externalMethodName.length}), ofs=(${nameOffset + 1})`);
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: externalMethodName.length,
            ptTokenType: "method",
            ptTokenModifiers: [],
          });
        }
        offsetInNonStringRHS += currNameLength + 1;
        currentOffset += currNameLength + 1;
        //this._logSPIN(`  --  SPIN  ADVANCE by name part len - offsetInNonStringRHS: (${priorInNonStringRHS}) -> (${offsetInNonStringRHS}), currentOffset: (${priorOffset}) -> (${currentOffset})`);
      }
    }
    return tokenSet;
  }

  private _reportSPIN_PAsmCode(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    const lineNbr: number = lineIdx + 1;
    // skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const inLinePAsmRHSStr = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    const lineParts: string[] = this.parseUtils.getNonWhitePAsmLineParts(inLinePAsmRHSStr);
    this._logPASM("  -- reportInLinePAsmDecl lineParts=[" + lineParts + "]");
    const bIsAlsoDebugLine: boolean = inLinePAsmRHSStr.toLowerCase().indexOf("debug(") != -1 ? true : false;
    if (bIsAlsoDebugLine) {
      const partialTokenSet: IParsedToken[] = this._reportDebugStatement(lineIdx, startingOffset, line);
      partialTokenSet.forEach((newToken) => {
        this._logSPIN("=> SPINpasm: " + this._tokenString(newToken, line));
        tokenSet.push(newToken);
      });
    }
    // handle name in as first part of line...
    // (process label/variable name (but 'debug' of debug() is NOT a label!))
    let haveLabel: boolean = this.parseUtils.isDatOrPAsmLabel(lineParts[0]) && lineParts[0].toLowerCase() != "debug";
    const isDataDeclarationLine: boolean = lineParts.length > 1 && haveLabel && this.parseUtils.isDatStorageType(lineParts[1]) ? true : false;
    if (haveLabel) {
      const labelName: string = lineParts[0];
      this._logPASM("  -- labelName=[" + labelName + "]");
      const labelType: string = isDataDeclarationLine ? "variable" : "label";
      const nameOffset: number = line.indexOf(labelName, currentOffset);
      var labelModifiers: string[] = ["declaration"];
      if (!isDataDeclarationLine && labelName.startsWith(".")) {
        labelModifiers = ["declaration", "static"];
      }
      this._recordToken(tokenSet, line, {
        line: lineIdx,
        startCharacter: nameOffset,
        length: labelName.length,
        ptTokenType: labelType,
        ptTokenModifiers: labelModifiers,
      });
      haveLabel = true;
    }
    if (bIsAlsoDebugLine) {
      // this line is [{label}] debug() ' comment
      //  no more to do so exit!
      return tokenSet;
    }
    if (!isDataDeclarationLine) {
      // process assembly code
      let argumentOffset = 0;
      if (lineParts.length > 1) {
        let minNonLabelParts: number = 1;
        if (haveLabel) {
          // skip our label
          argumentOffset++;
          minNonLabelParts++;
        }
        if (lineParts[argumentOffset].toUpperCase().startsWith("IF_") || lineParts[argumentOffset].toUpperCase().startsWith("_RET_")) {
          // skip our conditional
          argumentOffset++;
          minNonLabelParts++;
        }
        const possibleDirective: string = lineParts[argumentOffset];
        if (possibleDirective.toUpperCase() == "FILE") {
          // we have illegal so flag it and abort handling rest of line
          this._logPASM("  --  SPIN inlinePAsm ERROR[CODE] illegal directive=[" + possibleDirective + "]");
          const nameOffset: number = line.indexOf(possibleDirective, currentOffset);
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: possibleDirective.length,
            ptTokenType: "variable",
            ptTokenModifiers: ["illegalUse"],
          });
          this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + possibleDirective.length, eSeverity.Error, `Illegal P2 Spin inline-pasm directive [${possibleDirective}]`);
        } else {
          if (lineParts.length > minNonLabelParts) {
            currentOffset = line.indexOf(lineParts[minNonLabelParts - 1], currentOffset) + lineParts[minNonLabelParts - 1].length + 1;
            let nameOffset: number = 0;
            let namePart: string = "";
            for (let index = minNonLabelParts; index < lineParts.length; index++) {
              const argumentName = lineParts[index].replace(/[@#]/, "");
              if (argumentName.length < 1) {
                // skip empty operand
                continue;
              }
              if (index == lineParts.length - 1 && this.parseUtils.isP2AsmConditional(argumentName)) {
                // conditional flag-set spec.
                this._logPASM("  -- SKIP argumentName=[" + argumentName + "]");
                continue;
              }
              const currArgumentLen = argumentName.length;
              if (argumentName.charAt(0).match(/[a-zA-Z_\.]/)) {
                // does name contain a namespace reference?
                this._logPASM("  -- argumentName=[" + argumentName + "]");
                if (this._isPossibleObjectReference(argumentName)) {
                  const bHaveObjReference = this._reportObjectReference(argumentName, lineIdx, currentOffset, line, tokenSet);
                  if (bHaveObjReference) {
                    currentOffset = currentOffset + argumentName.length;
                    continue;
                  }
                }
                let possibleNameSet: string[] = [argumentName];
                if (argumentName.includes(".") && !argumentName.startsWith(".")) {
                  possibleNameSet = argumentName.split(".");
                }
                this._logPASM("  --  possibleNameSet=[" + possibleNameSet + "]");
                namePart = possibleNameSet[0];
                const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : possibleNameSet[0] + "." + possibleNameSet[1];
                nameOffset = line.indexOf(searchString, currentOffset);
                let referenceDetails: RememberedToken | undefined = undefined;
                if (this.semanticFindings.hasLocalPAsmTokenForMethod(this.currentMethodName, namePart)) {
                  referenceDetails = this.semanticFindings.getLocalPAsmTokenForMethod(this.currentMethodName, namePart);
                  this._logPASM("  --  FOUND local PASM name=[" + namePart + "]");
                } else if (this.semanticFindings.isLocalToken(namePart)) {
                  referenceDetails = this.semanticFindings.getLocalTokenForLine(namePart, lineNbr);
                  this._logPASM("  --  FOUND local name=[" + namePart + "]");
                } else if (this.semanticFindings.isGlobalToken(namePart)) {
                  referenceDetails = this.semanticFindings.getGlobalToken(namePart);
                  this._logPASM("  --  FOUND global name=[" + namePart + "]");
                }
                if (referenceDetails != undefined) {
                  this._logPASM("  --  SPIN inlinePASM add name=[" + namePart + "]");
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: namePart.length,
                    ptTokenType: referenceDetails.type,
                    ptTokenModifiers: referenceDetails.modifiers,
                  });
                } else {
                  // we don't have name registered so just mark it
                  if (namePart != ".") {
                    // odd special case!
                    if (
                      !this.parseUtils.isSpinReservedWord(namePart) &&
                      !this.parseUtils.isBuiltinStreamerReservedWord(namePart) &&
                      !this.parseUtils.isDebugMethod(namePart) &&
                      !this.parseUtils.isP2AsmModczOperand(namePart)
                    ) {
                      this._logPASM("  --  SPIN PAsm MISSING name=[" + namePart + "]");
                      this._recordToken(tokenSet, line, {
                        line: lineIdx,
                        startCharacter: nameOffset,
                        length: namePart.length,
                        ptTokenType: "variable",
                        ptTokenModifiers: ["missingDeclaration"],
                      });
                      this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P2 Spin F pasm missing declaration [${namePart}]`);
                    } else if (this.parseUtils.isIllegalInlinePAsmDirective(namePart)) {
                      this._logPASM("  --  SPIN inlinePAsm ERROR[CODE] illegal name=[" + namePart + "]");
                      this._recordToken(tokenSet, line, {
                        line: lineIdx,
                        startCharacter: nameOffset,
                        length: namePart.length,
                        ptTokenType: "variable",
                        ptTokenModifiers: ["illegalUse"],
                      });
                      this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + possibleDirective.length, eSeverity.Error, "Illegal P2 Spin inline-pasm name");
                    }
                  }
                }
              }
              currentOffset = nameOffset + namePart.length;
            }
          }
        }
      } else {
        // have only 1 line part is directive or op-code
        // flag non-opcode or illegal directive
        const nameOrDirective: string = lineParts[0];
        // if this symbol is NOT a global token then it could be bad!
        if (!this.semanticFindings.isKnownToken(nameOrDirective)) {
          if (this.parseUtils.isIllegalInlinePAsmDirective(nameOrDirective) || !this.parseUtils.isP2AsmInstruction(nameOrDirective)) {
            this._logPASM("  --  SPIN inline-PAsm MISSING name=[" + nameOrDirective + "]");
            const nameOffset = line.indexOf(nameOrDirective, currentOffset);
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: nameOrDirective.length,
              ptTokenType: "variable", // color this offender!
              ptTokenModifiers: ["illegalUse"],
            });
            this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + nameOrDirective.length, eSeverity.Error, "Illegal P2 Spin Directive within inline-pasm");
          }
        }
      }
    } else {
      // process data declaration
      if (this.parseUtils.isDatStorageType(lineParts[0])) {
        currentOffset = line.indexOf(lineParts[0], currentOffset);
      } else {
        currentOffset = line.indexOf(lineParts[1], currentOffset);
      }
      const allowLocalVarStatus: boolean = true;
      const NOT_DAT_PASM: boolean = false;
      const partialTokenSet: IParsedToken[] = this._reportDAT_ValueDeclarationCode(lineIdx, currentOffset, line, allowLocalVarStatus, this.showPAsmCode, NOT_DAT_PASM);
      partialTokenSet.forEach((newToken) => {
        tokenSet.push(newToken);
      });
    }
    return tokenSet;
  }

  private _reportOBJ_DeclarationLine(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    this._logOBJ(`- RptObjDecl remainingNonCommentLineStr=[${remainingNonCommentLineStr}], currentOffset=(${currentOffset})`);
    const bHasOverrides: boolean = remainingNonCommentLineStr.includes("|");
    const overrideParts: string[] = remainingNonCommentLineStr.split("|");

    const remainingLength: number = remainingNonCommentLineStr.length;
    const bHasColon: boolean = remainingNonCommentLineStr.includes(":");
    let objectName: string = "";
    if (remainingLength > 0) {
      // get line parts - initially, we only care about first one
      const lineParts: string[] = remainingNonCommentLineStr.split(/[ \t\:\[]/).filter(Boolean);
      this._logOBJ("  --  OBJ lineParts=[" + lineParts + "]");
      objectName = lineParts[0];
      // object name token must be offset into full line for token
      const nameOffset: number = line.indexOf(objectName, currentOffset);
      this._recordToken(tokenSet, line, {
        line: lineIdx,
        startCharacter: nameOffset,
        length: objectName.length,
        ptTokenType: "namespace",
        ptTokenModifiers: ["declaration"],
      });
      const objArrayOpen: number = remainingNonCommentLineStr.indexOf("[");
      if (objArrayOpen != -1) {
        // we have an array of objects, study the index value for possible named reference(s)
        const objArrayClose: number = remainingNonCommentLineStr.indexOf("]");
        if (objArrayClose != -1) {
          const elemCountStr: string = remainingNonCommentLineStr.substr(objArrayOpen + 1, objArrayClose - objArrayOpen - 1);
          // if we have a variable name...
          if (elemCountStr.charAt(0).match(/[a-zA-Z_]/)) {
            let possibleNameSet: string[] = [elemCountStr];
            // is it a namespace reference?
            let bHaveObjReference: boolean = false;
            if (this._isPossibleObjectReference(elemCountStr)) {
              // go register object reference!
              bHaveObjReference = this._reportObjectReference(elemCountStr, lineIdx, startingOffset, line, tokenSet);
              possibleNameSet = elemCountStr.split(".");
            }
            if (!bHaveObjReference) {
              for (let index = 0; index < possibleNameSet.length; index++) {
                const nameReference = possibleNameSet[index];
                if (this.semanticFindings.isGlobalToken(nameReference)) {
                  const referenceDetails: RememberedToken | undefined = this.semanticFindings.getGlobalToken(nameReference);
                  // Token offsets must be line relative so search entire line...
                  const nameOffset = line.indexOf(nameReference, currentOffset);
                  if (referenceDetails != undefined) {
                    //const updatedModificationSet: string[] = this._modifiersWithout(referenceDetails.modifiers, "declaration");
                    this._logOBJ("  --  FOUND global name=[" + nameReference + "]");
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: nameReference.length,
                      ptTokenType: referenceDetails.type,
                      ptTokenModifiers: referenceDetails.modifiers,
                    });
                  }
                } else if (!this.parseUtils.isSpinReservedWord(nameReference) && !this.parseUtils.isBuiltinStreamerReservedWord(nameReference) && !this.parseUtils.isDebugMethod(nameReference)) {
                  // we don't have name registered so just mark it
                  this._logOBJ("  --  OBJ MISSING name=[" + nameReference + "]");
                  const nameOffset = line.indexOf(nameReference, currentOffset);
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: nameReference.length,
                    ptTokenType: "variable",
                    ptTokenModifiers: ["missingDeclaration"],
                  });
                  this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + nameReference.length, eSeverity.Error, `P2 Spin G missing declaration [${nameReference}]`);
                }
              }
            }
          }
        }
      }
      if (bHasOverrides && overrideParts.length > 1) {
        // Ex:     child1 : "child" | MULTIPLIER = 3, COUNT = 5, HAVE_HIDPAD = true        ' override child constants
        //                            ^^^^^^^^^^^^^^^^^^^^^^^^^   (process this part)
        const overrides: string = overrideParts[1].replace(/[ \t]/, "");
        const overideSatements: string[] = overrides.split(",").filter(Boolean);
        this._logOBJ(`  -- OBJ overideSatements=[${overideSatements}](${overideSatements.length})`);
        for (let index = 0; index < overideSatements.length; index++) {
          const statementParts: string[] = overideSatements[index].split("=");
          const overideName: string = statementParts[0].trim();
          const overideValue: string = statementParts[1].trim();
          const lookupName: string = `${objectName}%${overideName}`;
          this._logOBJ(`  -- OBJ overideName=[${overideName}](${overideName.length}), overideValue=[${overideValue}](${overideValue.length})`);
          let nameOffset: number = line.indexOf(overideName, currentOffset);
          let bHaveObjReference: boolean = this._isPossibleObjectReference(lookupName) ? this._reportObjectReference(lookupName, lineIdx, nameOffset, line, tokenSet) : false;
          if (!bHaveObjReference) {
            this._logOBJ("  --  OBJ MISSING name=[" + overideName + "]");
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: overideName.length,
              ptTokenType: "variable",
              ptTokenModifiers: ["missingDeclaration"],
            });
            this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + overideName.length, eSeverity.Error, `P2 Spin H missing declaration [${overideName}]`);
          }
          this._logOBJ(`  -- OBJ CALC currOffset nameOffset=(${nameOffset}) + nameLen=(${overideName.length}) = currentOffset=(${nameOffset + overideName.length})`);
          currentOffset = nameOffset + overideName.length; // move past this name

          // process RHS of assignment (overideValue) too!
          if (overideValue.charAt(0).match(/[a-zA-Z_]/)) {
            // process symbol name
            const nameOffset = line.indexOf(overideValue, currentOffset);
            this._logOBJ(`  -- OBJ overideValue=[${overideValue}], ofs=(${nameOffset})`);
            let referenceDetails: RememberedToken | undefined = undefined;
            if (this.semanticFindings.isGlobalToken(overideValue)) {
              referenceDetails = this.semanticFindings.getGlobalToken(overideValue);
            }
            // Token offsets must be line relative so search entire line...
            if (referenceDetails != undefined) {
              //const updatedModificationSet: string[] = this._modifiersWithout(referenceDetails.modifiers, "declaration");
              this._logOBJ("  --  FOUND global name=[" + overideValue + "]");
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: overideValue.length,
                ptTokenType: referenceDetails.type,
                ptTokenModifiers: referenceDetails.modifiers,
              });
            } else if (this.parseUtils.isP2AsmReservedWord(overideValue)) {
              this._logOBJ("  --  FOUND built-in constant=[" + overideValue + "]");
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: overideValue.length,
                ptTokenType: "variable",
                ptTokenModifiers: ["readonly"],
              });
            } else {
              // if (!this.parseUtils.isP2AsmReservedWord(overideValue)) {
              this._logOBJ("  --  OBJ MISSING RHS name=[" + overideValue + "]");
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: overideValue.length,
                ptTokenType: "variable",
                ptTokenModifiers: ["missingDeclaration"],
              });
              this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + overideValue.length, eSeverity.Error, `P2 Spin I missing declaration [${overideValue}]`);
            }
            currentOffset = nameOffset + overideValue.length;
          }
        }
      }
    }
    return tokenSet;
  }

  private isNumeric(val: any): boolean {
    // REF https://stackoverflow.com/questions/23437476/in-typescript-how-to-check-if-a-string-is-numeric
    let desiredNumericStatus: boolean = false;
    if (val.indexOf("%%") == 0) {
      desiredNumericStatus = true;
    } else if (val.indexOf("%") == 0) {
      desiredNumericStatus = true;
    } else if (val.indexOf("$") == 0) {
      desiredNumericStatus = true;
    } else {
      desiredNumericStatus = !(val instanceof Array) && val - parseFloat(val) + 1 >= 0;
    }
    return desiredNumericStatus;
  }

  private _reportVAR_DeclarationLine(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    if (remainingNonCommentLineStr.length > 0) {
      // get line parts - we only care about first one
      let lineParts: string[] = this.parseUtils.getCommaDelimitedNonWhiteLineParts(remainingNonCommentLineStr);
      this._logVAR("  -- rptVarDecl lineParts=[" + lineParts + "]");
      // remember this object name so we can annotate a call to it
      const isMultiDeclaration: boolean = remainingNonCommentLineStr.includes(",");
      const hasStorageType: boolean = this.parseUtils.isStorageType(lineParts[0]);
      if (lineParts.length > 1) {
        const startIndex: number = hasStorageType ? 1 : 0;
        for (let index = startIndex; index < lineParts.length; index++) {
          let newName = lineParts[index];
          const hasArrayReference: boolean = newName.indexOf("[") != -1;
          if (hasArrayReference) {
            // remove array suffix from name
            if (newName.includes("[")) {
              const nameParts: string[] = newName.split("[");
              newName = nameParts[0];
            }
          }
          // in the following, let's not register a name with a trailing ']' this is part of an array size calculation!
          if (newName.charAt(0).match(/[a-zA-Z_]/) && newName.indexOf("]") == -1) {
            this._logVAR("  -- GLBL ADD rvdl newName=[" + newName + "]");
            const nameOffset: number = line.indexOf(newName, currentOffset);
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: newName.length,
              ptTokenType: "variable",
              ptTokenModifiers: ["declaration", "instance"],
            });
            currentOffset = nameOffset + newName.length;
          }
          if (hasArrayReference) {
            // process name with array length value
            const arrayOpenOffset: number = line.indexOf("[", currentOffset);
            const arrayCloseOffset: number = line.indexOf("]", currentOffset);
            const arrayReference: string = line.substr(arrayOpenOffset + 1, arrayCloseOffset - arrayOpenOffset - 1);
            const arrayReferenceParts: string[] = arrayReference.split(/[ \t\/\*\+\<\>]/);
            this._logVAR("  --  arrayReferenceParts=[" + arrayReferenceParts + "]");
            for (let index = 0; index < arrayReferenceParts.length; index++) {
              const referenceName = arrayReferenceParts[index];
              if (referenceName.charAt(0).match(/[a-zA-Z_]/)) {
                let possibleNameSet: string[] = [];
                // is it a namespace reference?
                if (referenceName.includes(".")) {
                  possibleNameSet = referenceName.split(".");
                } else {
                  possibleNameSet = [referenceName];
                }
                this._logVAR("  --  possibleNameSet=[" + possibleNameSet + "]");
                const namePart = possibleNameSet[0];
                if (this.semanticFindings.isGlobalToken(namePart)) {
                  const referenceDetails: RememberedToken | undefined = this.semanticFindings.getGlobalToken(namePart);
                  const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : possibleNameSet[0] + "." + possibleNameSet[1];
                  const nameOffset = line.indexOf(searchString, currentOffset);
                  if (referenceDetails != undefined) {
                    this._logVAR("  --  FOUND global name=[" + namePart + "]");
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: namePart.length,
                      ptTokenType: referenceDetails.type,
                      ptTokenModifiers: referenceDetails.modifiers,
                    });
                  } else {
                    // we don't have name registered so just mark it
                    if (!this.parseUtils.isSpinReservedWord(namePart) && !this.parseUtils.isBuiltinStreamerReservedWord(namePart) && !this.parseUtils.isDebugMethod(namePart)) {
                      this._logVAR("  --  VAR Add MISSING name=[" + namePart + "]");
                      this._recordToken(tokenSet, line, {
                        line: lineIdx,
                        startCharacter: nameOffset,
                        length: namePart.length,
                        ptTokenType: "variable",
                        ptTokenModifiers: ["missingDeclaration"],
                      });
                      this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P2 Spin I missing declaration [${namePart}]`);
                    }
                  }
                }
                if (possibleNameSet.length > 1) {
                  // we have .constant namespace suffix
                  this._logVAR("  --  VAR Add ReadOnly name=[" + namePart + "]");
                  const constantPart: string = possibleNameSet[1];
                  const nameOffset = line.indexOf(constantPart, currentOffset);
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: constantPart.length,
                    ptTokenType: "variable",
                    ptTokenModifiers: ["readonly"],
                  });
                }
              }
            }
          }
        }
      } else {
        // have single declaration per line
        let newName = lineParts[0];
        if (newName.charAt(0).match(/[a-zA-Z_]/)) {
          this._logVAR("  -- GLBL rvdl2 newName=[" + newName + "]");
          const nameOffset: number = line.indexOf(newName, currentOffset);
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: newName.length,
            ptTokenType: "variable",
            ptTokenModifiers: ["declaration", "instance"],
          });
        }
      }
    }
    return tokenSet;
  }

  private _reportDebugStatement(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    const lineNbr: number = lineIdx + 1;
    // locate and collect debug() display user names and types
    //
    // debug(`{displayName} ... )
    // debug(`zstr_(displayName) lutcolors `uhex_long_array_(image_address, lut_size))
    // debug(`lstr_(displayName, len) lutcolors `uhex_long_array_(image_address, lut_size))
    // debug(``#(letter) lutcolors `uhex_long_array_(image_address, lut_size))
    //
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const debugStatementStr = this._getDebugStatement(currentOffset, line);
    this._logDEBUG(" -- rptDbg debugStatementStr=[" + debugStatementStr + "]");
    if (debugStatementStr.length == 0) {
      return tokenSet;
    }
    // now record the comment if we have one
    const commentRHSStrOffset: number = currentOffset + debugStatementStr.length;
    const commentOffset: number = line.indexOf("'", commentRHSStrOffset);
    if (commentOffset != -1) {
      const newToken: IParsedToken = {
        line: lineIdx,
        startCharacter: commentOffset,
        length: line.length - commentOffset + 1,
        ptTokenType: "comment",
        ptTokenModifiers: ["line"],
      };
      tokenSet.push(newToken);
    }
    this._logDEBUG("-- DEBUG line(" + lineIdx + ") debugStatementStr=[" + debugStatementStr + "]");
    let lineParts: string[] = this.parseUtils.getDebugNonWhiteLineParts(debugStatementStr);
    this._logDEBUG(" -- rptDbg A lineParts=[" + lineParts + "](" + lineParts.length + ")");
    if (lineParts.length > 0 && lineParts[0].toLowerCase() != "debug") {
      //this._logDEBUG(' -- rptDbg first name not debug! (label?) removing! lineParts[0]=[' + lineParts[0] + ']');
      lineParts.shift(); // assume pasm, remove label
    }
    if (lineParts[0].toLowerCase() == "debug") {
      let symbolOffset: number = currentOffset;
      const displayType: string = lineParts.length >= 2 ? lineParts[1] : "";
      if (displayType.startsWith("`")) {
        this._logDEBUG(' -- rptDbg have "debug("` lineParts=[' + lineParts + "]");
        symbolOffset = line.indexOf(displayType, symbolOffset) + 1; // plus 1 to get past back-tic
        const newDisplayType: string = displayType.substring(1, displayType.length);
        let displayTestName: string = lineParts[1] == "`" ? lineParts[1] + lineParts[2] : lineParts[1];
        displayTestName = displayTestName.toLowerCase().replace(/ \t/g, "");
        const isRuntimeNamed: boolean = displayTestName.startsWith("``") || displayTestName.startsWith("`zstr") || displayTestName.startsWith("`lstr");
        this._logDEBUG(" -- rptDbg displayTestName=[" + displayTestName + "], isRuntimeNamed=" + isRuntimeNamed);
        let bHaveInstantiation = this.parseUtils.isDebugDisplayType(newDisplayType) && !isRuntimeNamed;
        if (bHaveInstantiation) {
          this._logDEBUG("  -- rptDbg --- PROCESSING Instantiation");
          // -------------------------------------
          // process Debug() display instantiation
          //   **    debug(`{displayType} {displayName} ......)
          // (0a) register type use
          this._logDEBUG("  -- rptDbg newDisplayType=[" + newDisplayType + "]");
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: symbolOffset,
            length: newDisplayType.length,
            ptTokenType: "displayType",
            ptTokenModifiers: ["reference", "defaultLibrary"],
          });
          // (0b) register userName use
          symbolOffset += displayType.length;
          const newDisplayName: string = lineParts[2];
          symbolOffset = line.indexOf(newDisplayName, symbolOffset);
          this._logDEBUG("  -- rptDbg newDisplayName=[" + newDisplayName + "]");
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: symbolOffset,
            length: newDisplayName.length,
            ptTokenType: "displayName",
            ptTokenModifiers: ["declaration"],
          });
          symbolOffset += newDisplayName.length;
          // (1) highlight parameter names
          let eDisplayType: eDebugDisplayType = this.semanticFindings.getDebugDisplayEnumForType(newDisplayType);
          const firstParamIdx: number = 3; // [0]=debug [1]=`{type}, [2]={userName}
          for (let idx = firstParamIdx; idx < lineParts.length; idx++) {
            const newParameter: string = lineParts[idx];
            symbolOffset = line.indexOf(newParameter, symbolOffset);
            const bIsParameterName: boolean = this.parseUtils.isNameWithTypeInstantiation(newParameter, eDisplayType);
            if (bIsParameterName) {
              this._logDEBUG("  -- rptDbg newParam=[" + newParameter + "]");
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: symbolOffset,
                length: newParameter.length,
                ptTokenType: "setupParameter",
                ptTokenModifiers: ["reference", "defaultLibrary"],
              });
            } else {
              const bIsColorName: boolean = this.parseUtils.isDebugColorName(newParameter);
              if (bIsColorName) {
                this._logDEBUG("  -- rptDbg newColor=[" + newParameter + "]");
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: symbolOffset,
                  length: newParameter.length,
                  ptTokenType: "colorName",
                  ptTokenModifiers: ["reference", "defaultLibrary"],
                });
              } else {
                // unknown parameter, is known symbol?
                let referenceDetails: RememberedToken | undefined = undefined;
                if (this.semanticFindings.hasLocalPAsmTokenForMethod(this.currentMethodName, newParameter)) {
                  referenceDetails = this.semanticFindings.getLocalPAsmTokenForMethod(this.currentMethodName, newParameter);
                  this._logPASM("  --  FOUND local PASM name=[" + newParameter + "]");
                } else if (this.semanticFindings.isLocalToken(newParameter)) {
                  referenceDetails = this.semanticFindings.getLocalTokenForLine(newParameter, lineNbr);
                  this._logPASM("  --  FOUND local name=[" + newParameter + "]");
                } else if (this.semanticFindings.isGlobalToken(newParameter)) {
                  referenceDetails = this.semanticFindings.getGlobalToken(newParameter);
                  this._logPASM("  --  FOUND global name=[" + newParameter + "]");
                }
                if (referenceDetails != undefined) {
                  this._logPASM("  --  SPIN/PAsm add name=[" + newParameter + "]");
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: symbolOffset,
                    length: newParameter.length,
                    ptTokenType: referenceDetails.type,
                    ptTokenModifiers: referenceDetails.modifiers,
                  });
                } else {
                  // handle unknown-name case
                  const paramIsSymbolName: boolean = newParameter.substring(0, 1).match(/[a-zA-Z_]/) ? true : false;
                  if (
                    paramIsSymbolName &&
                    !this.parseUtils.isDebugMethod(newParameter) &&
                    newParameter.indexOf("`") == -1 &&
                    !this.parseUtils.isUnaryOperator(newParameter) &&
                    !this.parseUtils.isBinaryOperator(newParameter) &&
                    !this.parseUtils.isFloatConversion(newParameter) &&
                    !this.parseUtils.isSpinBuiltinMethod(newParameter) &&
                    !this.parseUtils.isBuiltinStreamerReservedWord(newParameter)
                  ) {
                    this._logDEBUG("  -- rptDbg 1 unkParam=[" + newParameter + "]");
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: symbolOffset,
                      length: newParameter.length,
                      ptTokenType: "setupParameter",
                      ptTokenModifiers: ["illegalUse"],
                    });
                    this.semanticFindings.pushDiagnosticMessage(lineIdx, symbolOffset, symbolOffset + newParameter.length, eSeverity.Error, `P2 Spin debug() A unknown name [${newParameter}]`);
                  }
                }
              }
            }
            symbolOffset += newParameter.length;
          }
          // (2) highlight strings
          const tokenStringSet: IParsedToken[] = this._reportDebugStrings(lineIdx, line, debugStatementStr);
          tokenStringSet.forEach((newToken) => {
            tokenSet.push(newToken);
          });
        } else {
          // -------------------------------------
          // process Debug() display feed/instantiation
          //   **    debug(`{(displayName} {displayName} {...}} ......)
          //   **    debug(`zstr_(displayName) lutcolors `uhex_long_array_(image_address, lut_size))
          //   **    debug(`lstr_(displayName, len) lutcolors `uhex_long_array_(image_address, lut_size))
          //   **    debug(``#(letter) lutcolors `uhex_long_array_(image_address, lut_size))
          //  NOTE: 1 or more display names!
          //  FIXME: Chip: how do we validate types when multiple displays! (of diff types)??
          //    Chip: "only types common to all"!
          let displayName: string = newDisplayType;
          let bHaveFeed = this.semanticFindings.isKnownDebugDisplay(displayName);
          if (isRuntimeNamed) {
            bHaveFeed = true;
          }
          // handle 1st display here
          let firstParamIdx: number = 0; // value NOT used
          if (bHaveFeed) {
            this._logDEBUG("  -- rptDbg --- PROCESSING feed");
            if (isRuntimeNamed) {
              firstParamIdx = displayName == "`" || displayName == "``" ? 2 : 1; // [0]=`debug` [1]=`runtimeName, [2]... symbols
            } else {
              firstParamIdx = 1; // [0]=debug [1]=`{userName}[[, {userName}], ...]
              // handle one or more names!
              do {
                // (0) register UserName use
                this._logDEBUG("  -- rptDbg displayName=[" + displayName + "]");
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: symbolOffset,
                  length: displayName.length,
                  ptTokenType: "displayName",
                  ptTokenModifiers: ["reference"],
                });
                symbolOffset += displayName.length + 1;
                if (firstParamIdx < lineParts.length) {
                  firstParamIdx++;
                  displayName = lineParts[firstParamIdx];
                  bHaveFeed = this.semanticFindings.isKnownDebugDisplay(displayName);
                } else {
                  bHaveFeed = false;
                }
              } while (bHaveFeed);
            }
            // (1) highlight parameter names (NOTE: based on first display type, only)
            let eDisplayType: eDebugDisplayType = this.semanticFindings.getDebugDisplayEnumForUserName(newDisplayType);
            if (isRuntimeNamed) {
              // override bad display type with directive if present
              eDisplayType = this._getDisplayTypeForLine(lineNbr);
            }
            let newParameter: string = "";
            for (let idx = firstParamIdx; idx < lineParts.length; idx++) {
              newParameter = lineParts[idx];
              if (newParameter.indexOf("'") != -1 || this.parseUtils.isStorageType(newParameter)) {
                symbolOffset += newParameter.length;
                continue; // skip this name (it's part of a string!)
              } else if (newParameter.indexOf("#") != -1) {
                symbolOffset += newParameter.length;
                continue; // skip this name (it's part of a string!)
              }
              symbolOffset = line.indexOf(newParameter, symbolOffset);
              this._logDEBUG("  -- rptDbg ?check? [" + newParameter + "] symbolOffset=" + symbolOffset);
              let bIsParameterName: boolean = this.parseUtils.isNameWithTypeFeed(newParameter, eDisplayType);
              if (isRuntimeNamed && newParameter.toLowerCase() == "lutcolors") {
                bIsParameterName = true;
              }
              if (bIsParameterName) {
                this._logDEBUG("  -- rptDbg newParam=[" + newParameter + "]");
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: symbolOffset,
                  length: newParameter.length,
                  ptTokenType: "feedParameter",
                  ptTokenModifiers: ["reference", "defaultLibrary"],
                });
              } else {
                const bIsColorName: boolean = this.parseUtils.isDebugColorName(newParameter);
                if (bIsColorName) {
                  this._logDEBUG("  -- rptDbg newColor=[" + newParameter + "]");
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: symbolOffset,
                    length: newParameter.length,
                    ptTokenType: "colorName",
                    ptTokenModifiers: ["reference", "defaultLibrary"],
                  });
                } else {
                  // unknown parameter, is known symbol?
                  let referenceDetails: RememberedToken | undefined = undefined;
                  if (this.semanticFindings.hasLocalPAsmTokenForMethod(this.currentMethodName, newParameter)) {
                    referenceDetails = this.semanticFindings.getLocalPAsmTokenForMethod(this.currentMethodName, newParameter);
                    this._logPASM("  --  FOUND local PASM name=[" + newParameter + "]");
                  } else if (this.semanticFindings.isLocalToken(newParameter)) {
                    referenceDetails = this.semanticFindings.getLocalTokenForLine(newParameter, lineNbr);
                    this._logPASM("  --  FOUND local name=[" + newParameter + "]");
                  } else if (this.semanticFindings.isGlobalToken(newParameter)) {
                    referenceDetails = this.semanticFindings.getGlobalToken(newParameter);
                    this._logPASM("  --  FOUND global name=[" + newParameter + "]");
                  }
                  if (referenceDetails != undefined) {
                    this._logPASM("  --  SPIN PAsm add name=[" + newParameter + "]");
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: symbolOffset, // <-- this offset is bad!
                      length: newParameter.length,
                      ptTokenType: referenceDetails.type,
                      ptTokenModifiers: referenceDetails.modifiers,
                    });
                  } else {
                    // handle unknown-name case
                    const paramIsSymbolName: boolean = newParameter.substring(0, 1).match(/[a-zA-Z_]/) ? true : false;
                    if (
                      paramIsSymbolName &&
                      this.parseUtils.isDebugMethod(newParameter) == false &&
                      newParameter.indexOf("`") == -1 &&
                      !this.parseUtils.isUnaryOperator(newParameter) &&
                      !this.parseUtils.isBinaryOperator(newParameter) &&
                      !this.parseUtils.isFloatConversion(newParameter) &&
                      !this.parseUtils.isSpinBuiltinMethod(newParameter) &&
                      !this.parseUtils.isSpinReservedWord(newParameter) &&
                      !this.parseUtils.isBuiltinStreamerReservedWord(newParameter)
                    ) {
                      this._logDEBUG("  -- rptDbg 2 unkParam=[" + newParameter + "]"); // XYZZY LutColors
                      this._recordToken(tokenSet, line, {
                        line: lineIdx,
                        startCharacter: symbolOffset,
                        length: newParameter.length,
                        ptTokenType: "setupParameter",
                        ptTokenModifiers: ["illegalUse"],
                      });
                      this.semanticFindings.pushDiagnosticMessage(lineIdx, symbolOffset, symbolOffset + newParameter.length, eSeverity.Error, `P2 Spin debug() B unknown name [${newParameter}]`);
                    }
                  }
                }
              }
              symbolOffset += newParameter.length;
            }
            // (2) highlight strings
            this._logDEBUG(`  --  A _reportDebugStrings() Ln#${lineIdx + 1}) debugStatementStr=[${debugStatementStr}]`);
            const tokenStringSet: IParsedToken[] = this._reportDebugStrings(lineIdx, line, debugStatementStr);
            tokenStringSet.forEach((newToken) => {
              tokenSet.push(newToken);
            });
          }
        }
      } else {
        this._logDEBUG("  -- rptDbg --- PROCESSING non-display (other)");
        // -------------------------------------
        // process non-display debug statement
        const firstParamIdx: number = 0; // no prefix to skip
        let symbolOffset: number = currentOffset;
        let newParameter: string = "";
        for (let idx = firstParamIdx; idx < lineParts.length; idx++) {
          newParameter = lineParts[idx];
          const paramIsSymbolName: boolean = newParameter.substring(0, 1).match(/[a-zA-Z_]/) ? true : false;
          if (!paramIsSymbolName) {
            continue;
          }
          if (newParameter.toLowerCase() == "debug" || this.parseUtils.isStorageType(newParameter)) {
            continue;
          }
          symbolOffset = line.indexOf(newParameter, symbolOffset); // walk this past each
          // does name contain a namespace reference?
          let bHaveObjReference: boolean = false;
          if (this._isPossibleObjectReference(newParameter)) {
            // go register object reference!
            bHaveObjReference = this._reportObjectReference(newParameter, lineIdx, startingOffset, line, tokenSet);
          }
          if (!bHaveObjReference) {
            this._logDEBUG("  -- ?check? [" + newParameter + "]");
            if (newParameter.endsWith(".")) {
              newParameter = newParameter.substring(0, newParameter.length - 1);
            }

            let referenceDetails: RememberedToken | undefined = undefined;
            if (this.semanticFindings.hasLocalPAsmTokenForMethod(this.currentMethodName, newParameter)) {
              referenceDetails = this.semanticFindings.getLocalPAsmTokenForMethod(this.currentMethodName, newParameter);
              this._logPASM("  --  FOUND local PASM name=[" + newParameter + "]");
            } else if (this.semanticFindings.isLocalToken(newParameter)) {
              referenceDetails = this.semanticFindings.getLocalTokenForLine(newParameter, lineNbr);
              this._logPASM("  --  FOUND local name=[" + newParameter + "]");
            } else if (this.semanticFindings.isGlobalToken(newParameter)) {
              referenceDetails = this.semanticFindings.getGlobalToken(newParameter);
              this._logPASM("  --  FOUND global name=[" + newParameter + "]");
            }
            if (referenceDetails != undefined) {
              //this._logPASM('  --  Debug() colorize name=[' + newParameter + ']');
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: symbolOffset,
                length: newParameter.length,
                ptTokenType: referenceDetails.type,
                ptTokenModifiers: referenceDetails.modifiers,
              });
            } else {
              // handle unknown-name case
              const paramIsSymbolName: boolean = newParameter.substring(0, 1).match(/[a-zA-Z_]/) ? true : false;
              if (
                paramIsSymbolName &&
                !this.parseUtils.isDebugMethod(newParameter) &&
                !this.parseUtils.isBinaryOperator(newParameter) &&
                !this.parseUtils.isUnaryOperator(newParameter) &&
                !this.parseUtils.isFloatConversion(newParameter) &&
                !this.parseUtils.isSpinBuiltinMethod(newParameter) &&
                !this.parseUtils.isSpinBuiltInVariable(newParameter) &&
                !this.parseUtils.isSpinReservedWord(newParameter)
              ) {
                this._logDEBUG("  -- rptDbg 3 unkParam=[" + newParameter + "]");
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: symbolOffset,
                  length: newParameter.length,
                  ptTokenType: "setupParameter",
                  ptTokenModifiers: ["illegalUse"],
                });
                this.semanticFindings.pushDiagnosticMessage(lineIdx, symbolOffset, symbolOffset + newParameter.length, eSeverity.Error, `P2 Spin debug() C unknown name [${newParameter}]`);
              }
            }
          }
          symbolOffset += newParameter.length;
        }
        // (2) highlight strings
        this._logDEBUG(`  --  B _reportDebugStrings() Ln#${lineIdx + 1}) debugStatementStr=[${debugStatementStr}]`);
        const tokenStringSet: IParsedToken[] = this._reportDebugStrings(lineIdx, line, debugStatementStr);
        tokenStringSet.forEach((newToken) => {
          tokenSet.push(newToken);
        });
      }
    } else {
      this._logDEBUG("ERROR: _reportDebugStatement() line(" + lineIdx + ") line=[" + line + "] no debug()??");
    }
    return tokenSet;
  }

  private _isPossibleObjectReference(possibleRef: string): boolean {
    // could be objectInstance.method or objectInstance#constant or objectInstance.method()
    // but can NOT be ".name"
    // NOTE" '%' is special object constant override mechanism
    // NEW adjust dot check to symbol.symbol
    const dottedSymbolRegex = /[a-zA-Z0-9_]\.[a-zA-Z_]/;
    const hashedSymbolRegex = /[a-zA-Z0-9_]\#[a-zA-Z_]/;
    const hasSymbolDotSymbol: boolean = dottedSymbolRegex.test(possibleRef);
    const hasSymbolHashSymbol: boolean = hashedSymbolRegex.test(possibleRef);
    return !possibleRef.startsWith(".") && (hasSymbolDotSymbol || hasSymbolHashSymbol || possibleRef.includes("%"));
  }

  private _reportObjectReference(dotReference: string, lineIdx: number, startingOffset: number, line: string, tokenSet: IParsedToken[]): boolean {
    // Handle: objInstanceName.constant or objInstanceName.method()
    // NEW handle objInstanceName[index].constant or objInstanceName[index].constant
    // NOTE: we allow old P1 style constant references to get here but are then FAILED
    // NOTE" '%' is special object constant override mechanism to allow this to happen
    this._logMessage(`- reportObjectReference() line(${lineIdx + 1}):[${dotReference}], ofs=(${startingOffset})`);
    const lineNbr: number = lineIdx + 1;
    let possibleNameSet: string[] = [];
    let bGeneratedReference: boolean = false;
    const isP1ObjectConstantRef: boolean = dotReference.includes("#");
    const isP2ObjectOverrideConstantRef: boolean = dotReference.includes("%");
    if ((dotReference.includes(".") || dotReference.includes("#") || dotReference.includes("%")) && !dotReference.includes("..")) {
      this._logMessage(`  --  rObjRef dotReference=[${dotReference}]`);
      const symbolOffset: number = line.indexOf(dotReference, startingOffset); // walk this past each
      possibleNameSet = dotReference.split(/[\.\#\%]/).filter(Boolean);
      let objInstanceName = possibleNameSet[0];
      const dotLHS: string = objInstanceName;
      this._logMessage(`  --  rObjRef possibleNameSet=[${possibleNameSet}](${possibleNameSet.length})`);
      let nameParts: string[] = [objInstanceName];
      let indexNames: string | undefined = undefined;
      if (objInstanceName.includes("[")) {
        nameParts = objInstanceName.split(/[\[\]]/).filter(Boolean);
        objInstanceName = nameParts[0];
        // FIXME: handle nameParts[1] is likely a local file variable
        if (nameParts.length > 1) {
          indexNames = nameParts[1];
        }
      }
      if (indexNames) {
        // handle case: instance[index].reference[()]  - "index" value
        let currentOffset: number = startingOffset;
        const namePart = indexNames;
        let nameOffset = line.indexOf(namePart, startingOffset);
        this._logMessage("  --  rObjRef-Idx searchString=[" + namePart + "]");
        this._logMessage("  --  rObjRef-Idx nameOffset=(" + nameOffset + "), currentOffset=(" + currentOffset + ")");
        let referenceDetails: RememberedToken | undefined = undefined;
        if (this.semanticFindings.isLocalToken(namePart)) {
          referenceDetails = this.semanticFindings.getLocalTokenForLine(namePart, lineNbr);
          this._logMessage("  --  FOUND local name=[" + namePart + "]");
        } else if (this.semanticFindings.isGlobalToken(namePart)) {
          referenceDetails = this.semanticFindings.getGlobalToken(namePart);
          this._logMessage("  --  FOUND global name=[" + namePart + "]");
        }
        if (referenceDetails != undefined) {
          this._logMessage(`  --  rObjRef-Idx name=[${namePart}](${namePart.length}), ofs(${nameOffset})`);
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: namePart.length,
            ptTokenType: referenceDetails.type,
            ptTokenModifiers: referenceDetails.modifiers,
          });
        } else {
          // have unknown name!? what is it?
          this._logSPIN("  --  SPIN Unknown name=[" + namePart + "]");
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: namePart.length,
            ptTokenType: "variable",
            ptTokenModifiers: ["illegalUse"],
          });
          this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P2 Spin failed to parse index value  [${namePart}]`);
        }
      }
      // processed objectInstance name and [indexName], now do ref part
      if (this.semanticFindings.isNameSpace(objInstanceName)) {
        let referenceDetails: RememberedToken | undefined = undefined;
        if (this.semanticFindings.isGlobalToken(objInstanceName)) {
          referenceDetails = this.semanticFindings.getGlobalToken(objInstanceName);
          this._logMessage(`  --  FOUND global name=[${objInstanceName}]`);
        }
        if (referenceDetails != undefined) {
          bGeneratedReference = true;
          // if this is not a local object overrides ref then generate token
          if (!isP2ObjectOverrideConstantRef) {
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: symbolOffset,
              length: objInstanceName.length,
              ptTokenType: referenceDetails.type,
              ptTokenModifiers: referenceDetails.modifiers,
            });
          }
          if (possibleNameSet.length > 1) {
            // we have .constant namespace suffix
            // determine if this is method has '(' or is constant name
            const refParts = possibleNameSet[1].split(/[\(\)]/).filter(Boolean);
            const refPart = refParts[0];
            const referenceOffset = line.indexOf(refPart, symbolOffset + dotLHS.length + 1);
            let isMethod: boolean = false;
            if (line.substr(referenceOffset + refPart.length, 1) == "(") {
              isMethod = true;
            }

            referenceDetails = undefined;
            const nameSpaceFindings: DocumentFindings | undefined = this.semanticFindings.getFindingsForNamespace(objInstanceName);
            if (!isP1ObjectConstantRef && nameSpaceFindings) {
              referenceDetails = nameSpaceFindings.getPublicToken(refPart);
              this._logMessage(`  --  LookedUp Object-global token [${refPart}] got [${referenceDetails}]`);
            }
            if (referenceDetails) {
              const constantPart: string = possibleNameSet[1];
              const tokenTypeID: string = isMethod ? "method" : "variable";
              const tokenModifiers: string[] = isMethod ? [] : ["readonly"];
              this._logMessage("  --  rObjRef rhs constant=[" + constantPart + "](" + (referenceOffset + 1) + ") (" + tokenTypeID + ")");
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: referenceOffset,
                length: refPart.length,
                ptTokenType: tokenTypeID,
                ptTokenModifiers: tokenModifiers,
              });
            } else {
              this._logMessage("  --  rObjRef Error refPart=[" + refPart + "](" + (referenceOffset + 1) + ")");
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: referenceOffset,
                length: refPart.length,
                ptTokenType: "variable",
                ptTokenModifiers: ["illegalUse"],
              });
              if (!isP1ObjectConstantRef) {
                const refType: string = isMethod ? "Method" : "Constant";
                const adjustedName: string = isMethod ? `${refPart}()` : refPart;
                this.semanticFindings.pushDiagnosticMessage(
                  lineIdx,
                  referenceOffset,
                  referenceOffset + refPart.length,
                  eSeverity.Error,
                  `Object ${refType} [${adjustedName}] not found in [${objInstanceName}]`
                );
              } else {
                // have old style P1 Constant ref
                const refType: string = "Constant Reference";
                const adjustedName: string = `#${refPart}`;
                this.semanticFindings.pushDiagnosticMessage(
                  lineIdx,
                  referenceOffset,
                  referenceOffset + refPart.length,
                  eSeverity.Error,
                  `P1 Style ${refType} [${adjustedName}] not allowed in P2 spin`
                );
              }
            }
          }
        }
      } else {
        // now we have a possible objInst.name but let's validate
        //   NAMESPACE NOT FOUND !
        if (possibleNameSet.length > 1) {
          let objInstanceName: string = possibleNameSet[0];
          const referencePart: string = possibleNameSet[1];
          // NO if either side is storage type
          if (this.parseUtils.isStorageType(objInstanceName) || this.parseUtils.isStorageType(referencePart)) {
            bGeneratedReference = false;
          }
          // NO if either side is not legit symbol
          else if (!objInstanceName.charAt(0).match(/[a-zA-Z_]/) || !referencePart.charAt(0).match(/[a-zA-Z_]/)) {
            bGeneratedReference = false;
          } else {
            bGeneratedReference = true;
            const referenceOffset = line.indexOf(referencePart, symbolOffset + objInstanceName.length + 1);
            let isMethod: boolean = false;
            if (line.substr(referenceOffset + referencePart.length, 1) == "(") {
              isMethod = true;
            }
            let nameParts: string[] = [objInstanceName];
            if (objInstanceName.includes("[")) {
              nameParts = objInstanceName.split(/[\[\]]/).filter(Boolean);
              objInstanceName = nameParts[0];

              // FIXME: handle nameParts[1] is likely a local file variable
            }
            this._logDAT("  --  rObjRef MISSING instance declaration=[" + objInstanceName + "]");
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: symbolOffset,
              length: objInstanceName.length,
              ptTokenType: "variable",
              ptTokenModifiers: ["missingDeclaration"],
            });
            this.semanticFindings.pushDiagnosticMessage(
              lineIdx,
              symbolOffset,
              symbolOffset + objInstanceName.length,
              eSeverity.Error,
              `P2 Spin Missing object instance declaration [${objInstanceName}]`
            );
            // and handle refenced object
            this._logMessage("  --  rObjRef Error refPart=[" + referencePart + "](" + (referenceOffset + 1) + ")");
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: referenceOffset,
              length: referencePart.length,
              ptTokenType: "variable",
              ptTokenModifiers: ["illegalUse"],
            });
            if (!isP1ObjectConstantRef) {
              const refType: string = isMethod ? "Method" : "Constant";
              const adjustedName: string = isMethod ? `${referencePart}()` : referencePart;
              this.semanticFindings.pushDiagnosticMessage(
                lineIdx,
                referenceOffset,
                referenceOffset + referencePart.length,
                eSeverity.Error,
                `Object ${refType} [${adjustedName}] not found in missing [${objInstanceName}]`
              );
            } else {
              // have old style P1 Constant ref
              const refType: string = "Constant Reference";
              const adjustedName: string = `#${referencePart}`;
              this.semanticFindings.pushDiagnosticMessage(
                lineIdx,
                referenceOffset,
                referenceOffset + referencePart.length,
                eSeverity.Error,
                `P1 Style ${refType} [${adjustedName}] not allowed in P2 spin`
              );
            }
          }
        }
      }
    }
    this._logMessage(`- reportObjectReference() EXIT returns=(${bGeneratedReference})`);
    return bGeneratedReference;
  }

  private _reportDebugStrings(lineIdx: number, line: string, debugStatementStr: string): IParsedToken[] {
    // debug statements typically have single or double quoted strings.  Let's color either if/when found!
    const tokenSet: IParsedToken[] = [];
    let tokenStringSet: IParsedToken[] = this._reportDebugDblQuoteStrings(lineIdx, line, debugStatementStr);
    tokenStringSet.forEach((newToken) => {
      tokenSet.push(newToken);
    });
    let bNeedSingleQuoteProcessing: boolean = true;
    if (tokenStringSet.length > 0) {
      // see if we have sgl quites outside if dbl-quote strings
      const nonStringLine: string = this.parseUtils.removeDoubleQuotedStrings(debugStatementStr);
      bNeedSingleQuoteProcessing = nonStringLine.indexOf("'") != -1;
    }
    if (bNeedSingleQuoteProcessing) {
      tokenStringSet = this._reportDebugSglQuoteStrings(lineIdx, line, debugStatementStr);
      tokenStringSet.forEach((newToken) => {
        tokenSet.push(newToken);
      });
    }
    return tokenSet;
  }

  private _reportDebugSglQuoteStrings(lineIdx: number, line: string, debugStatementStr: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    // find all strings in debug() statement but for now just do first...
    let currentOffset: number = line.indexOf(debugStatementStr);
    let nextStringOffset: number = 0;
    let nextString: string = "";
    do {
      nextString = this._getSingleQuotedString(nextStringOffset, debugStatementStr);
      if (nextString.length > 0) {
        nextStringOffset = debugStatementStr.indexOf(nextString, nextStringOffset);
        const chrBackTic: string = "`";
        const chrCloseParen: string = ")";
        const bStringContainssBackTic: boolean = nextString.indexOf(chrBackTic) != -1;
        if (bStringContainssBackTic) {
          // add special handling for '`()' this case
          //
          // EX #1: '`{!!}(P_GAIN)'                           - emit two strings, each just a tic
          // EX #2" 'enc=`(encVal), extra'                    - emit two strings
          // EX #3: 'FwdEnc=`{!!}(encVal)'                    - emit two strings, leading and trailing(just a tic)
          // EX #4: 'FwdEnc=`{!!}(encVal), dty=`{!!}(duty)'   - emit three strings: leading, middle, and trailing(just a tic)
          //    where {!!} is optional and is one of [$,%,#]
          //
          // - for each backtic string ends at chrBackTic, record it
          // - skip to close paren (string starts after close paren)
          //this._logMessage('- rdsqs nextString=[' + nextString + '] line=[' + line + ']');
          let searchOffset: number = 0; // value doesn't matter
          let currStrOffset: number = 0; // we start at zero!
          let lineStrOffset: number = line.indexOf(nextString, currentOffset);
          let backTicOffset: number = nextString.indexOf(chrBackTic, searchOffset);
          while (backTicOffset != -1) {
            const currStr = nextString.substring(currStrOffset, backTicOffset);
            //this._logDEBUG('  --  rdsqs currStr=[' + currStr + '](' + lineStrOffset  + ')');
            // record the left edge string
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: lineStrOffset,
              length: currStr.length,
              ptTokenType: "string",
              ptTokenModifiers: ["quoted", "single"],
            });
            currStrOffset += currStr.length;
            lineStrOffset += currStr.length;
            //this._logMessage('  -- currStr=[' + currStr + '] lineStrOffset=[' + lineStrOffset + ']');
            const closeParenOffset: number = nextString.indexOf(chrCloseParen, backTicOffset + 2); // +2 is past open paren
            if (closeParenOffset != -1) {
              const ticParenLen: number = closeParenOffset - backTicOffset + 1;
              //this._logMessage('  --  rdsqs closeParenOffset=[' + closeParenOffset + '], backTicOffset=[' + backTicOffset + '], ticParenLen=[' + ticParenLen + ']');
              backTicOffset = nextString.indexOf(chrBackTic, closeParenOffset);
              lineStrOffset += ticParenLen;
              // if we have another back-tic...
              if (backTicOffset != -1) {
                // had this string to front string processing
                currStrOffset += ticParenLen;
              } else {
                const rightStr = nextString.substring(closeParenOffset + 1, nextString.length);
                //this._logDEBUG('  --  rdsqs rightStr=[' + rightStr + '](' + lineStrOffset + ')');
                // record the right edge string
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: lineStrOffset,
                  length: rightStr.length,
                  ptTokenType: "string",
                  ptTokenModifiers: ["quoted", "single"],
                });
                searchOffset = closeParenOffset + currStr.length + 1;
              }
            } else {
              this._logDEBUG("  --  rdsqs  ERROR missing close paren!");
              break; // no close paren?  get outta here...
            }
          }
        } else {
          const strOffset: number = line.indexOf(nextString, currentOffset);
          //this._logMessage('  -- str=(' + strOffset + ')[' + nextString + ']');
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: strOffset,
            length: nextString.length,
            ptTokenType: "string",
            ptTokenModifiers: ["quoted", "single"],
          });
        }
        currentOffset += nextString.length + 1;
        nextStringOffset += nextString.length + 1;
      }
    } while (nextString.length > 0);

    return tokenSet;
  }

  private _reportDebugDblQuoteStrings(lineIdx: number, line: string, debugStatementStr: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    // find all strings in debug() statement but for now just do first...
    let currentOffset: number = line.indexOf(debugStatementStr);
    let nextStringOffset: number = 0;
    let nextString: string = "";
    do {
      nextString = this._getDoubleQuotedString(nextStringOffset, debugStatementStr);
      if (nextString.length > 0) {
        nextStringOffset = debugStatementStr.indexOf(nextString, nextStringOffset);
        const chrBackTic: string = "`";
        const bStringContainssBackTic: boolean = nextString.indexOf(chrBackTic) != -1;
        if (bStringContainssBackTic) {
          // add special handling for '`()' this case
          //this._logMessage('- BackTic nextString=[' + nextString + '] line=[' + line + ']');
          const chrCloseParen: string = ")";
          let searchOffset: number = 0; // value doesn't matter
          let lineStrOffset: number = line.indexOf(nextString, currentOffset);
          let backTicOffset: number = 0; // value doesn't matter
          while ((backTicOffset = nextString.indexOf(chrBackTic, searchOffset)) != -1) {
            const leftStr = nextString.substring(0, backTicOffset);
            // record the left edge string
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: lineStrOffset,
              length: leftStr.length,
              ptTokenType: "string",
              ptTokenModifiers: ["quoted", "double"],
            });
            //this._logMessage('  -- leftStr=[' + leftStr + '] lineStrOffset=[' + lineStrOffset + ']');
            const closeParenOffset: number = nextString.indexOf(chrCloseParen, backTicOffset);
            //this._logMessage('  -- backTicOffset=[' + backTicOffset + '] closeParenOffset=[' + closeParenOffset + ']');
            if (closeParenOffset != -1) {
              searchOffset = closeParenOffset;
              const nextBackTicOffset: number = nextString.indexOf(chrBackTic, searchOffset);
              const currStrEndOffset: number = nextBackTicOffset != -1 ? nextBackTicOffset - 1 : nextString.length - 1;
              const rightStr = nextString.substring(closeParenOffset + 1, currStrEndOffset + 1);
              let rightStrOffset: number = lineStrOffset + closeParenOffset + 1;
              const leftOffset: number = closeParenOffset + 1;
              //this._logMessage('  -- rightStr=(' + rightStrOffset + ')[' + rightStr + '] leftOffset=[' + leftOffset + '] currStrEndOffset=[' + currStrEndOffset + ']');
              // record the right edge string
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: rightStrOffset,
                length: rightStr.length,
                ptTokenType: "string",
                ptTokenModifiers: ["quoted", "double"],
              });
              searchOffset = closeParenOffset + leftStr.length + 1;
            } else {
              break; // no close paren?  get outta here...
            }
          }
        } else {
          const strOffset: number = line.indexOf(nextString, currentOffset);
          //this._logMessage('  -- str=(' + strOffset + ')[' + nextString + ']');
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: strOffset,
            length: nextString.length,
            ptTokenType: "string",
            ptTokenModifiers: ["quoted", "double"],
          });
        }
        currentOffset += nextString.length + 1;
        nextStringOffset += nextString.length + 1;
      }
    } while (nextString.length > 0);

    return tokenSet;
  }

  private _getDoubleQuotedString(currentOffset: number, searchText: string): string {
    let nextString: string = "";
    const chrDoubleQuote: string = '"';
    const stringStartOffset: number = searchText.indexOf(chrDoubleQuote, currentOffset);
    if (stringStartOffset != -1) {
      this._logDEBUG("  -- _getDoubleQuotedString(" + currentOffset + ", [" + searchText + "])");
      const stringEndOffset: number = searchText.indexOf(chrDoubleQuote, stringStartOffset + 1);
      if (stringEndOffset != -1) {
        nextString = searchText.substring(stringStartOffset, stringEndOffset + 1);
      }
    }
    if (nextString.length > 0) {
      this._logDEBUG("  -- debug() gdqs nextString=[" + nextString + "](" + nextString.length + ")");
    }
    return nextString;
  }

  private _getSingleQuotedString(currentOffset: number, searchText: string): string {
    let nextString: string = "";
    const stringStartOffset: number = searchText.indexOf("'", currentOffset);
    if (stringStartOffset != -1) {
      this._logDEBUG("  -- gsqs(" + currentOffset + ", [" + searchText + "])");
      const stringEndOffset: number = searchText.indexOf("'", stringStartOffset + 1);
      if (stringEndOffset != -1) {
        nextString = searchText.substring(stringStartOffset, stringEndOffset + 1);
      }
    }
    if (nextString.length > 0) {
      this._logDEBUG("  -- debug() gsqs nextString=[" + nextString + "](" + nextString.length + ")");
    }
    return nextString;
  }

  private _recordToken(tokenSet: IParsedToken[], line: string, newToken: IParsedToken) {
    if (newToken.line != -1 && newToken.startCharacter != -1) {
      tokenSet.push(newToken);
    } else {
      const tokenInterp: string = `token(${newToken.line + 1},${newToken.startCharacter})=[len:${newToken.length}](${newToken.ptTokenType}[${newToken.ptTokenModifiers}])]`;
      this._logMessage(`** ERROR: BAD token nextString=[${tokenInterp}]`);
    }
  }

  private _recordDisplayTypeForLine(displayType: string, lineIdx: number): void {
    //this._logMessage('  -- line#' + lineIdx + ', displayType=[' + displayType + ']');
    const newDirective: ISpin2Directive = {
      lineNumber: lineIdx,
      displayType: displayType,
      eDisplayType: this.semanticFindings.getDebugDisplayEnumForType(displayType),
    };
    this._logMessage("=> Add DIRECTIVE: " + this._directiveString(newDirective));
    this.fileDirectives.push(newDirective);
  }

  private _getDisplayTypeForLine(lineNbr: number): eDebugDisplayType {
    let desiredType: eDebugDisplayType = eDebugDisplayType.Unknown;
    let maxLineBefore: number = 0;
    let desiredDirective: ISpin2Directive;
    for (let index = 0; index < this.fileDirectives.length; index++) {
      const currDirective: ISpin2Directive = this.fileDirectives[index];
      this._logMessage("  -- hunt:" + lineNbr + ", ln=" + currDirective.lineNumber + ", typ=" + currDirective.displayType + "(" + currDirective.eDisplayType + ")");
      if (currDirective.lineNumber <= lineNbr) {
        if (currDirective.lineNumber > maxLineBefore) {
          desiredDirective = currDirective;
          desiredType = currDirective.eDisplayType;
          maxLineBefore = currDirective.lineNumber;
        }
      }
    }
    if (desiredType != eDebugDisplayType.Unknown) {
      this._logMessage("  -- directive for line#" + lineNbr + ": " + desiredType);
    }
    return desiredType;
  }

  private _logTokenSet(message: string): void {
    if (this.logTokenDiscover) {
      this._logMessage(message);
    }
  }

  private _logState(message: string): void {
    if (this.showState) {
      this._logMessage(message);
    }
  }

  private _logSPIN(message: string): void {
    if (this.showSpinCode) {
      this._logMessage(message);
    }
  }

  private _logPreProc(message: string): void {
    if (this.showPreProc) {
      this._logMessage(message);
    }
  }

  private _logCON(message: string): void {
    if (this.showCON) {
      this._logMessage(message);
    }
  }

  private _logVAR(message: string): void {
    if (this.showVAR) {
      this._logMessage(message);
    }
  }

  private _logDAT(message: string): void {
    if (this.showDAT) {
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
    if (this.spin2DebugLogEnabled) {
      //Write to output window.
      this.ctx.logger.log(message);
    }
  }

  private _logDEBUG(message: string): void {
    if (this.showDEBUG) {
      this._logMessage(message);
    }
  }

  private _isSectionStartLine(line: string): {
    isSectionStart: boolean;
    inProgressStatus: eParseState;
  } {
    // return T/F where T means our string starts a new section!
    let startStatus: boolean = false;
    let inProgressState: eParseState = eParseState.Unknown;
    if (line.length > 2) {
      const lineParts: string[] = line.split(/[ \t]/);
      if (lineParts.length > 0) {
        const sectionName: string = lineParts[0].toUpperCase();
        startStatus = true;
        if (sectionName === "CON") {
          inProgressState = eParseState.inCon;
        } else if (sectionName === "DAT") {
          inProgressState = eParseState.inDat;
        } else if (sectionName === "OBJ") {
          inProgressState = eParseState.inObj;
        } else if (sectionName === "PUB") {
          inProgressState = eParseState.inPub;
        } else if (sectionName === "PRI") {
          inProgressState = eParseState.inPri;
        } else if (sectionName === "VAR") {
          inProgressState = eParseState.inVar;
        } else {
          startStatus = false;
        }
      }
    }
    if (startStatus) {
      this._logMessage("** isSectStart line=[" + line + "]");
    }
    return {
      isSectionStart: startStatus,
      inProgressStatus: inProgressState,
    };
  }

  private _getDebugStatement(startingOffset: number, line: string): string {
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    let debugNonCommentStr: string = line;
    let openParenOffset: number = line.indexOf("(", currentOffset);
    let closeParenOffset: number = this.parseUtils.indexOfMatchingCloseParen(line, openParenOffset);
    if (line.length - startingOffset > 0 && openParenOffset != -1 && closeParenOffset != -1) {
      // have scope of debug line - remove trailing comment, trim it and return it
      let commentOffset: number = line.indexOf("'", closeParenOffset + 1);
      if (commentOffset != -1) {
        // have trailing comment remove it
        const nonCommentEOL: number = commentOffset != -1 ? commentOffset - 1 : line.length - 1;
        debugNonCommentStr = line.substring(currentOffset, nonCommentEOL).trim();
      } else {
        debugNonCommentStr = line.substring(currentOffset).trim();
      }
    } else if (line.length - startingOffset == 0 || openParenOffset == -1) {
      // if we don't have open paren - erase entire line
      debugNonCommentStr = "";
    }
    //if (line.length != debugNonCommentStr.length) {
    //    this._logMessage('  -- DS line [' + line.substring(startingOffset) + ']');
    //    this._logMessage('  --         [' + debugNonCommentStr + ']');
    //}
    return debugNonCommentStr;
  }

  private _getNonCommentLineReturnComment(startingOffset: number, lineIdx: number, line: string, tokenSet: IParsedToken[]): string {
    // skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const nonCommentLHSStr = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    // now record the comment if we have one
    const commentRHSStrOffset: number = currentOffset + nonCommentLHSStr.length;
    const commentOffset: number = line.indexOf("'", commentRHSStrOffset);
    const bHaveDocComment: boolean = line.indexOf("''", commentOffset) != -1;
    //this._logMessage("  -- gnwclrc commentOffset=(" + commentOffset + "), bHaveDocComment=[" + bHaveDocComment + "], line=[" + line + "]");
    if (commentOffset != -1) {
      if (!bHaveDocComment) {
        const newToken: IParsedToken = {
          line: lineIdx,
          startCharacter: commentOffset,
          length: line.length - commentOffset + 1,
          ptTokenType: "comment",
          ptTokenModifiers: ["line"],
        };
        //this._logMessage("=> CMT: " + this._tokenString(newToken, line));
        tokenSet.push(newToken);
      }
    }
    return nonCommentLHSStr;
  }

  private _getNonWhiteSpinLineParts(line: string): IFilteredStrings {
    //                                     split(/[ \t\-\:\,\+\[\]\@\(\)\!\*\=\<\>\&\|\?\\\~\#\^\/]/);
    // mods to allow returning of objInstanceName#constant  form of names
    const nonEqualsLine: string = this.parseUtils.removeDoubleQuotedStrings(line);
    const lineParts: string[] | null = nonEqualsLine.match(/[^ \t\-\:\,\+\[\]\@\(\)\!\*\=\<\>\&\|\?\\\~\^\/]+/g);
    let reducedLineParts: string[] = [];
    if (lineParts == null) {
      reducedLineParts = [];
    } else {
      for (let index = 0; index < lineParts.length; index++) {
        const name = lineParts[index];
        if (name === "#") {
          continue;
        }
        if (name.startsWith("#")) {
          reducedLineParts.push(name.substring(1)); // remvoe first char
        } else if (name.endsWith("#")) {
          reducedLineParts.push(name.slice(0, -1)); // remove last char
        } else {
          reducedLineParts.push(name);
        }
      }
    }
    return {
      lineNoQuotes: nonEqualsLine,
      lineParts: reducedLineParts,
    };
  }

  private _tokenString(aToken: IParsedToken, line: string): string {
    let varName: string = line.substr(aToken.startCharacter, aToken.length);
    let desiredInterp: string =
      "  -- token=[Ln#" + (aToken.line + 1) + ",ofs:" + aToken.startCharacter + ",len:" + aToken.length + " [" + varName + "](" + aToken.ptTokenType + "[" + aToken.ptTokenModifiers + "])]";
    return desiredInterp;
  }

  private _rememberdTokenString(tokenName: string, aToken: RememberedToken | undefined): string {
    let desiredInterp: string = "  -- token=[len:" + tokenName.length + " [" + tokenName + "](undefined)";
    if (aToken != undefined) {
      desiredInterp = "  -- token=[len:" + tokenName.length + " [" + tokenName + "](" + aToken.type + "[" + aToken.modifiers + "])]";
    }
    return desiredInterp;
  }

  private _checkTokenSet(tokenSet: IParsedToken[]): void {
    this._logMessage("\n---- Checking " + tokenSet.length + " tokens. ----");
    tokenSet.forEach((parsedToken) => {
      if (parsedToken.length == undefined || parsedToken.startCharacter == undefined) {
        this._logMessage("- BAD Token=[" + parsedToken + "]");
      }
    });
    this._logMessage("---- Check DONE ----\n");
  }

  private _directiveString(aDirective: ISpin2Directive): string {
    let desiredInterp: string = "  -- directive=[Ln#" + aDirective.lineNumber + ",typ:" + aDirective.displayType + "[" + aDirective.eDisplayType + "])]";
    return desiredInterp;
  }
}
