"use strict";
// src/spin2.documentSemanticParser.ts

import { TextDocument } from "vscode-languageserver-textdocument";
import { Context, ServerBehaviorConfiguration } from "../context";

import { DocumentFindings, RememberedComment, eCommentType, RememberedToken, eBLockType, eSeverity, eDefinitionType } from "./spin.semantic.findings";
import { Spin1ParseUtils } from "./spin1.utils";
import { isSpin1File } from "./lang.utils";
import { eParseState } from "./spin.common";
import { fileInDirExists } from "../files";
import { ExtensionUtils } from "../parser/spin.extension.utils";

// ----------------------------------------------------------------------------
//   Semantic Highlighting Provider
//
interface IParsedToken {
  line: number;
  startCharacter: number;
  length: number;
  ptTokenType: string;
  ptTokenModifiers: string[];
}

interface IFilteredStrings {
  lineNoQuotes: string;
  lineParts: string[];
}

export class Spin1DocumentSemanticParser {
  private parseUtils = new Spin1ParseUtils();
  private extensionUtils: ExtensionUtils;

  private bLogStarted: boolean = false;
  // adjust following true/false to show specific parsing debug
  private spin1DebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
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

  private configuration: ServerBehaviorConfiguration;

  private currentMethodName: string = "";
  private currentFilespec: string = "";

  private isSpin1Document: boolean = false;
  private bRecordTrailingComments: boolean = false; // initially, we don't generate tokens for trailing comments on lines
  private directory: string = "";

  public constructor(protected readonly ctx: Context) {
    this.extensionUtils = new ExtensionUtils(ctx, this.spin1DebugLogEnabled);
    this.configuration = ctx.parserConfig;
    if (this.spin1DebugLogEnabled) {
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        //Create output channel
        this._logMessage("Spin1 semantic log started.");
      } else {
        this._logMessage("\n\n------------------   NEW FILE ----------------\n\n");
      }
    }

    //this.semanticFindings = new DocumentFindings(this.spin1DebugLogEnabled, this.spin1log);
  }

  public docFindings(): DocumentFindings {
    return this.semanticFindings;
  }

  public reportDocumentSemanticTokens(document: TextDocument, findings: DocumentFindings, dirSpec: string): void {
    this.semanticFindings = findings;
    this.directory = dirSpec;
    if (this.spin1DebugLogEnabled) {
      this.semanticFindings.enableLogging(this.ctx);
      this.parseUtils.enableLogging(this.ctx);
    }
    this.configuration = this.ctx.parserConfig; // ensure we have latest
    this.isSpin1Document = isSpin1File(document.uri);
    this._logMessage(`* Config: highlightFlexspinDirectives: [${this.configuration.highlightFlexspinDirectives}]`);
    this.currentFilespec = document.uri;
    this._logMessage(`* reportDocumentSemanticTokens(${this.currentFilespec})`);
    this._logMessage(`* ------  into findings=[${findings.instanceName()}]`);

    // retrieve tokens to highlight, post to DocumentFindings
    const allTokens = this._parseText(document.getText());
    allTokens.forEach((token) => {
      // prevent crash in server and emit debug so we can find problem
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
    // prepass to find PRI/PUB method, OBJ names, and VAR/DAT names
    //

    // -------------------- PRE-PARSE just locating symbol names --------------------
    // also track and record block comments (both braces and tic's!)
    // let's also track prior single line and trailing comment on same line
    this._logMessage("---> Pre SCAN");
    let bBuildingSingleLineCmtBlock: boolean = false;
    let bBuildingSingleLineDocCmtBlock: boolean = false;
    this.semanticFindings.recordBlockStart(eBLockType.isCon, 0); // spin file defaults to CON at 1st line
    for (let i = 0; i < lines.length; i++) {
      const lineNbr = i + 1;
      const line = lines[i];
      const trimmedLine = line.trim();
      const lineWOutInlineComments: string = this.parseUtils.getLineWithoutInlineComments(line);
      const bHaveLineToProcess: boolean = lineWOutInlineComments.length > 0;
      const trimmedNonCommentLine: string = bHaveLineToProcess ? this.parseUtils.getRemainderWOutTrailingTicComment(0, lineWOutInlineComments).trimStart() : "";
      const offSet: number = trimmedNonCommentLine.length > 0 ? line.indexOf(trimmedNonCommentLine) + 1 : line.indexOf(trimmedLine) + 1;
      const tempComment = line.substring(trimmedNonCommentLine.length + offSet).trim();
      this.rightEdgeComment = tempComment.length > 0 ? tempComment : undefined;
      const sectionStatus = this.extensionUtils.isSectionStartLine(line);
      const lineParts: string[] = trimmedNonCommentLine.split(/[ \t]/).filter(Boolean);

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
      if (currState == eParseState.inMultiLineDocComment) {
        // in multi-line doc-comment, hunt for end '}}' to exit
        let closingOffset = lineWOutInlineComments.indexOf("}}");
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
          this._logMessage(`* Ln#${lineNbr} foundMuli end-}} exit MultiLineDocComment`);
        } else {
          // add line to the comment recording
          currBlockComment?.appendLine(line);
        }
        //  DO NOTHING Let Syntax highlighting do this
        continue;
      } else if (currState == eParseState.inMultiLineComment) {
        // in multi-line non-doc-comment, hunt for end '}' to exit
        // ALLOW {...} on same line without closing!
        const closingOffset: number = lineWOutInlineComments.indexOf("}");
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
          this._logMessage(`* Ln#${lineNbr} foundMuli end-} exit MultiLineComment`);
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
      } else if (lineParts.length > 0 && this.parseUtils.isFlexspinPreprocessorDirective(lineParts[0])) {
        this._getPreProcessor_Declaration(0, lineNbr, line);
        // a FlexspinPreprocessorDirective line clears pending single line comments
        this.priorSingleLineComment = undefined;
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
      } else if (trimmedNonCommentLine.startsWith("{{")) {
        // process multi-line doc comment
        let openingOffset = trimmedNonCommentLine.indexOf("{{");
        const closingOffset = trimmedNonCommentLine.indexOf("}}", openingOffset + 2);
        if (closingOffset != -1) {
          // is single line {{comment}}, just ignore it Let Syntax highlighting do this
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
          this._logMessage(`* Ln#${lineNbr} foundMuli srt-{{ starting MultiLineDocComment  line=[${line}](${line.length})`);
          // start  NEW comment
          currBlockComment = new RememberedComment(eCommentType.multiLineDocComment, i, line);
          //  DO NOTHING Let Syntax highlighting do this
          continue; // only SKIP if we don't have closing marker
        }
      } else if (trimmedNonCommentLine.startsWith("{")) {
        // process possible multi-line non-doc comment
        // do we have a close on this same line?
        let openingOffset = trimmedNonCommentLine.indexOf("{");
        const closingOffset = trimmedNonCommentLine.indexOf("}", openingOffset + 1);
        if (closingOffset != -1) {
          // is single line comment...
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineComment;
          this._logMessage(`* Ln#${lineNbr} foundMuli srt-{ starting MultiLineComment`);
          // start  NEW comment
          currBlockComment = new RememberedComment(eCommentType.multiLineComment, i, line);
          //  DO NOTHING Let Syntax highlighting do this
          continue; // only SKIP if we don't have closing marker
        }
      } else if (trimmedNonCommentLine.includes("{{")) {
        // process multi-line doc comment
        let openingOffset = trimmedNonCommentLine.indexOf("{{");
        const closingOffset = trimmedNonCommentLine.indexOf("}}", openingOffset + 2);
        if (closingOffset == -1) {
          // is open of multiline comment without CLOSE
          priorState = currState;
          currState = eParseState.inMultiLineDocComment;
          this._logMessage(`* Ln#${lineNbr} foundMuli mid-{{ starting MultiLineDocComment`);
          // start  NEW comment
          currBlockComment = new RememberedComment(eCommentType.multiLineDocComment, i, line);
          //  DO NOTHING Let Syntax highlighting do this
          continue; // only SKIP if we don't have closing marker
        }
      } else if (trimmedNonCommentLine.includes("{")) {
        /// FIXME: TODO: this needs to be searching in non-string-containing line
        // process possible multi-line non-doc comment
        // do we have a close on this same line?
        let openingOffset = trimmedNonCommentLine.indexOf("{");
        const closingOffset = trimmedNonCommentLine.indexOf("}", openingOffset + 1);
        if (closingOffset == -1) {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineComment;
          this._logMessage(`* Ln#${lineNbr} foundMuli mid-{ starting MultiLineComment`);
          // start  NEW comment
          currBlockComment = new RememberedComment(eCommentType.multiLineComment, i, line);
          // Mark comment line
          //this._recordToken(tokenSet, line, this._generateComentToken(i, openingOffset, line.length - openingOffset, BLOCK_COMMENT, NONDOC_COMMENT, line));
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
      } else if (sectionStatus.isSectionStart) {
        // mark end of method, if we were in a method
        this.semanticFindings.endPossibleMethod(i); // pass prior line number! essentially i+1 (-1)
        currState = sectionStatus.inProgressStatus;

        if (currState == eParseState.inDatPAsm) {
          this.semanticFindings.recordPasmEnd(i - 1);
          currState = prePAsmState;
          this._logState("- scan Ln#" + lineNbr + " POP currState=[" + currState + "]");
        }

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

        this._logState("- scan Ln#" + lineNbr + " currState=[" + currState + "]");
        // ID the remainder of the line
        if (currState == eParseState.inPub || currState == eParseState.inPri) {
          // process PUB/PRI method signature
          if (trimmedNonCommentLine.length > 3) {
            this._getPUB_PRI_Name(3, lineNbr, line);
            // and record our fake signature for later use by signature help
            const docComment: RememberedComment = this._generateFakeCommentForSignature(0, lineNbr, line);
            if (docComment._type != eCommentType.Unknown) {
              this.semanticFindings.recordFakeComment(docComment);
            } else {
              this._logState("- scan Ln#" + lineNbr + " no FAKE doc comment for this signature");
            }
          }
        } else if (currState == eParseState.inCon) {
          // process a constant line
          if (trimmedNonCommentLine.length > 3) {
            this._getCON_Declaration(3, lineNbr, line);
          }
        } else if (currState == eParseState.inDat) {
          // process a class(static) variable line
          if (trimmedNonCommentLine.length > 6 && trimmedNonCommentLine.toUpperCase().includes("ORG")) {
            // ORG, ORGF, ORGH
            // record start of PASM code NOT inline
            this.semanticFindings.recordPasmStart(i, false);
            const nonStringLine: string = this.parseUtils.removeDoubleQuotedStrings(trimmedNonCommentLine);
            if (nonStringLine.toUpperCase().includes("ORG")) {
              this._logPASM("- Ln#" + lineNbr + " pre-scan DAT line trimmedLine=[" + trimmedLine + "] now Dat PASM");
              // record start of PASM code NOT inline
              this.semanticFindings.recordPasmStart(i, false);
              prePAsmState = currState;
              currState = eParseState.inDatPAsm;
              this._getDAT_Declaration(0, lineNbr, line); // let's get possible label on this ORG statement
              continue;
            }
          }
          this._getDAT_Declaration(0, lineNbr, line);
        } else if (currState == eParseState.inObj) {
          // process an object line
          if (trimmedNonCommentLine.length > 3) {
            this._getOBJ_Declaration(3, lineNbr, line);
          }
        } else if (currState == eParseState.inVar) {
          // process a instance-variable line
          if (trimmedNonCommentLine.length > 3) {
            this._getVAR_Declaration(3, lineNbr, line);
          }
        }
        // we processed the block declaration line, now wipe out prior comment
        this.priorSingleLineComment = undefined; // clear it out...
        continue;
      } else if (currState == eParseState.inCon) {
        // process a constant line
        if (bHaveLineToProcess) {
          this._getCON_Declaration(0, lineNbr, line);
        }
      } else if (currState == eParseState.inDat) {
        // process a data line
        if (bHaveLineToProcess) {
          if (trimmedLine.length > 6) {
            if (trimmedLine.toUpperCase().includes("ORG")) {
              // ORG, ORGF, ORGH
              // record start of PASM code NOT inline
              this.semanticFindings.recordPasmStart(i, false);
              const nonStringLine: string = this.parseUtils.removeDoubleQuotedStrings(trimmedLine);
              if (nonStringLine.toUpperCase().includes("ORG")) {
                this._logPASM("- Ln#" + lineNbr + " pre-scan DAT line trimmedLine=[" + trimmedLine + "] now Dat PASM");
                prePAsmState = currState;
                // record start of PASM code NOT inline
                this.semanticFindings.recordPasmStart(i, false);
                currState = eParseState.inDatPAsm;
                this._getDAT_Declaration(0, lineNbr, line); // let's get possible label on this ORG statement
                continue;
              }
            }
          }
          this._getDAT_Declaration(0, lineNbr, line);
        }
      } else if (currState == eParseState.inVar) {
        // process a variable declaration line
        if (bHaveLineToProcess) {
          this._getVAR_Declaration(0, lineNbr, line);
        }
      } else if (currState == eParseState.inObj) {
        // process an object declaration line
        if (bHaveLineToProcess) {
          this._getOBJ_Declaration(0, lineNbr, line);
        }
      } else if (currState == eParseState.inDatPAsm) {
        // process pasm (assembly) lines
        if (bHaveLineToProcess) {
          this._getDAT_PAsmDeclaration(0, lineNbr, line);
        }
      } else if (currState == eParseState.inPub || currState == eParseState.inPri) {
        // scan SPIN2 line for object constant or method() uses
        //this._getSpinObjectConstantMethodDeclaration(0, lineNbr, line);
      }
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
      const lineNbr = i + 1;
      const line = lines[i];
      const trimmedLine = line.trim();
      const lineWOutInlineComments: string = this.parseUtils.getLineWithoutInlineComments(line);
      const bHaveLineToProcess: boolean = lineWOutInlineComments.length > 0;
      const trimmedNonCommentLine: string = bHaveLineToProcess ? this.parseUtils.getRemainderWOutTrailingTicComment(0, lineWOutInlineComments).trimStart() : "";
      const sectionStatus = this.extensionUtils.isSectionStartLine(line);
      const lineParts: string[] = trimmedNonCommentLine.split(/[ \t]/).filter(Boolean);

      if (currState == eParseState.inMultiLineDocComment) {
        // in multi-line doc-comment, hunt for end '}}' to exit
        // ALLOW {cmt}, {{cmt}} on same line without closing!
        let closingOffset = lineWOutInlineComments.indexOf("}}");
        if (closingOffset != -1) {
          // have close, comment ended
          currState = priorState;
          this._logMessage(`* Ln#${lineNbr} foundMuli end-}} exit MultiLineDocComment`);
        } else {
          continue; // only SKIP if we don't have closing marker
        }
        //  DO NOTHING Let Syntax highlighting do this
      } else if (currState == eParseState.inMultiLineComment) {
        // in multi-line non-doc-comment, hunt for end '}' to exit
        // ALLOW {...} on same line without closing!
        this._logMessage("    hunt for '}' Ln#" + lineNbr + " trimmedLine=[" + trimmedLine + "]");
        const closingOffset: number = lineWOutInlineComments.indexOf("}");
        if (closingOffset != -1) {
          // have close, comment ended
          this._logMessage("    FOUND '}' Ln#" + lineNbr + " trimmedLine=[" + trimmedLine + "]");
          currState = priorState;
          this._logMessage(`* Ln#${lineNbr} foundMuli end-} exit MultiLineComment`);
        } else {
          continue; // only SKIP if we don't have closing marker
        }
      } else if (lineParts.length > 0 && this.parseUtils.isFlexspinPreprocessorDirective(lineParts[0])) {
        const partialTokenSet: IParsedToken[] = this._reportFlexspinPreProcessorLine(i, 0, line);
        partialTokenSet.forEach((newToken) => {
          this._logPreProc("=> PreProc: " + this._tokenString(newToken, line));
          tokenSet.push(newToken);
        });
        continue;
      } else if (sectionStatus.isSectionStart) {
        currState = sectionStatus.inProgressStatus;
        this._logState("  -- Ln#" + lineNbr + " currState=[" + currState + "]");
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
          this.conEnumInProgress = false; // so we can tell in CON processor when to allow isolated names
          // process a possible constant use on the CON line itself!
          if (line.length > 3) {
            const partialTokenSet: IParsedToken[] = this._reportCON_DeclarationLine(i, 3, line);
            partialTokenSet.forEach((newToken) => {
              this._logCON("=> CON: " + this._tokenString(newToken, line));
              tokenSet.push(newToken);
            });
          }
        } else if (currState == eParseState.inDat) {
          // process a possible constant use on the CON line itself!
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
                this._logPASM("- Ln#" + lineNbr + " scan DAT line nonCommentLineRemainder=[" + nonCommentLineRemainder + "]");
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
      } else if (trimmedNonCommentLine.startsWith("{{")) {
        // process multi-line doc comment
        let openingOffset = trimmedNonCommentLine.indexOf("{{");
        const closingOffset = trimmedNonCommentLine.indexOf("}}", openingOffset + 2);
        if (closingOffset != -1) {
          // is single-line {{comment}}, just ignore it Let Syntax highlighting do this
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineDocComment;
          this._logMessage(`* Ln#${lineNbr} foundMuli srt-{{ starting MultiLineDocComment`);
          //  DO NOTHING Let Syntax highlighting do this
        }
        continue;
      } else if (trimmedNonCommentLine.startsWith("{")) {
        // process possible multi-line non-doc comment
        // do we have a close on this same line?
        let openingOffset = trimmedNonCommentLine.indexOf("{");
        const closingOffset = trimmedNonCommentLine.indexOf("}", openingOffset + 1);
        if (closingOffset != -1) {
          // is single line {comment}, just ignore it Let Syntax highlighting do this
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineComment;
          this._logMessage(`* Ln#${lineNbr} foundMuli srt-{ starting MultiLineComment`);
          //  DO NOTHING Let Syntax highlighting do this
        }
        continue;
      } else if (trimmedNonCommentLine.includes("{{")) {
        // process multi-line doc comment
        let openingOffset = trimmedNonCommentLine.indexOf("{{");
        const closingOffset = trimmedNonCommentLine.indexOf("}}", openingOffset + 2);
        if (closingOffset != -1) {
          // is single line {{comment}}, just ignore it Let Syntax highlighting do this
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineDocComment;
          this._logMessage(`* Ln#${lineNbr} foundMuli mid-{{ starting MultiLineDocComment`);
          //  DO NOTHING Let Syntax highlighting do this
        }
        // don't continue there might be some text to process before the {{
      } else if (trimmedNonCommentLine.includes("{")) {
        // process possible multi-line non-doc comment
        // do we have a close on this same line?
        let openingOffset = trimmedNonCommentLine.indexOf("{");
        const closingOffset = trimmedNonCommentLine.indexOf("}", openingOffset + 1);
        if (closingOffset != -1) {
          // is single line comment, just ignore it Let Syntax highlighting do this
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineComment;
          this._logMessage(`* Ln#${lineNbr} foundMuli mid-{ starting MultiLineComment`);
          //  DO NOTHING Let Syntax highlighting do this
        }
        // don't continue there might be some text to process before the {{
      } else if (currState == eParseState.inCon) {
        // process a line in a constant section
        if (bHaveLineToProcess) {
          this._logCON("- process CON lineLn#" + lineNbr + "  trimmedLine=[" + trimmedLine + "]");
          const partialTokenSet: IParsedToken[] = this._reportCON_DeclarationLine(i, 0, line);
          partialTokenSet.forEach((newToken) => {
            this._logCON("=> CON: " + this._tokenString(newToken, line));
            tokenSet.push(newToken);
          });
        }
      } else if (currState == eParseState.inDat) {
        // process a line in a data section
        if (bHaveLineToProcess) {
          this._logDAT("- process DAT lineLn#" + lineNbr + " trimmedLine=[" + trimmedLine + "]");
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
              this._logOBJ("=> ORG: " + this._tokenString(newToken, line));
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
        if (bHaveLineToProcess) {
          this._logVAR("- process VAR lineLn#" + lineNbr + "  trimmedLine=[" + trimmedLine + "]");
          const partialTokenSet: IParsedToken[] = this._reportVAR_DeclarationLine(i, 0, line);
          partialTokenSet.forEach((newToken) => {
            this._logVAR("=> VAR: " + this._tokenString(newToken, line));
            tokenSet.push(newToken);
          });
        }
      } else if (currState == eParseState.inObj) {
        // process a line in an object section
        if (bHaveLineToProcess) {
          this._logOBJ("- process OBJ lineLn#" + lineNbr + "  trimmedLine=[" + trimmedLine + "]");
          const partialTokenSet: IParsedToken[] = this._reportOBJ_DeclarationLine(i, 0, line);
          partialTokenSet.forEach((newToken) => {
            this._logOBJ("=> OBJ: " + this._tokenString(newToken, line));
            tokenSet.push(newToken);
          });
        }
      } else if (currState == eParseState.inDatPAsm) {
        // process DAT section pasm (assembly) lines
        if (bHaveLineToProcess) {
          this._logPASM("- process DAT PASM lineLn#" + lineNbr + "  trimmedLine=[" + trimmedLine + "]");
          // in DAT sections we end with FIT or just next section
          const partialTokenSet: IParsedToken[] = this._reportDAT_PAsmCode(i, 0, line);
          partialTokenSet.forEach((newToken) => {
            this._logPASM("=> DAT: " + this._tokenString(newToken, line));
            tokenSet.push(newToken);
          });
        }
      } else if (currState == eParseState.inPub || currState == eParseState.inPri) {
        // process a method def'n line
        if (bHaveLineToProcess) {
          this._logSPIN("- process SPIN2 lineLn#" + lineNbr + " trimmedLine=[" + trimmedLine + "]");
          const lineParts: string[] = trimmedLine.split(/[ \t]/).filter(Boolean);
          const partialTokenSet: IParsedToken[] = this._reportSPIN_Code(i, 0, line);
          partialTokenSet.forEach((newToken) => {
            this._logSPIN("=> SPIN: " + this._tokenString(newToken, line));
            tokenSet.push(newToken);
          });
        }
      }
    }
    this._checkTokenSet(tokenSet);
    return tokenSet;
  }

  private _getPreProcessor_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    if (this.configuration.highlightFlexspinDirectives) {
      let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
      const nonCommentConstantLine = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
      if (nonCommentConstantLine.length > 0) {
        // get line parts - we only care about first one
        const lineParts: string[] = nonCommentConstantLine.split(/[ \t=]/).filter(Boolean);
        this._logPreProc("  - Ln#" + lineNbr + " GetPreProcDecl lineParts=[" + lineParts + "]");
        const directive: string = lineParts[0];
        const symbolName: string | undefined = lineParts.length > 1 ? lineParts[1] : undefined;
        if (this.parseUtils.isFlexspinPreprocessorDirective(directive)) {
          // check a valid preprocessor line for a declaration
          if (symbolName != undefined && directive.toLowerCase() == "#define") {
            this._logPreProc("  -- new PreProc Symbol=[" + symbolName + "]");
            const nameOffset = line.indexOf(symbolName, currentOffset); // FIXME: UNDONE, do we have to dial this in?
            this.semanticFindings.recordDeclarationLine(line, lineNbr);
            this.semanticFindings.setGlobalToken(symbolName, new RememberedToken("variable", lineNbr - 1, nameOffset, ["readonly"]), this._declarationComment());
          }
        }
      }
    }
  }

  private _getCON_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE    DIGIT_NO_VALUE = -2   ' digit value when NOT [0-9]
    //  -or-     _clkmode = xtal1 + pll16x
    // NEW: (huh? works in P1!) multi line enums with no punctuation, ends at blank line (uses this.conEnumInProgress)
    //
    // FIXME: need to handle this: #1, RunTest, RunVerbose, #5, RunBrief, RunFull ' (renum in middle of list)
    // FIXME: and this: #1, RunTest, RunVerbose[3], RunBrief, RunFull   ' (3) is offset to value
    //
    if (line.substr(startingOffset).length > 1) {
      //skip Past Whitespace
      let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
      const nonCommentConstantLine = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
      if (nonCommentConstantLine.length == 0) {
        this.conEnumInProgress = false; // if we have a blank line after removing comment then weve ended the enum set
      } else {
        this._logCON("  - Ln#" + lineNbr + " GetCONDecl nonCommentConstantLine=[" + nonCommentConstantLine + "]");
        const haveEnumDeclaration: boolean = nonCommentConstantLine.trim().startsWith("#");
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
            statements = nonCommentConstantLine.split(",");
          }
          this._logCON("  -- statements=[" + statements + "]");

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
              if (newName.charAt(0).match(/[a-zA-Z_]/)) {
                this._logCON("  -- GLBL GetCONDecl newName=[" + newName + "]");
                // remember this object name so we can annotate a call to it
                const nameOffset = line.indexOf(newName, currentOffset); // FIXME: UNDONE, do we have to dial this in?
                this.semanticFindings.recordDeclarationLine(line, lineNbr);
                this.semanticFindings.setGlobalToken(newName, new RememberedToken("variable", lineNbr - 1, nameOffset, ["readonly"]), this._declarationComment());
              }
            }
          }
        } else {
          // recognize enum values getting initialized
          const lineParts: string[] = nonCommentConstantLine.split(/[ \t,]/).filter(Boolean);
          this._logCON(`  -- GetCONDecl enumDecl lineParts=[${lineParts}](${lineParts.length})`);
          for (let index = 0; index < lineParts.length; index++) {
            let enumConstant: string = lineParts[index];
            // our enum name can have a step offset
            if (enumConstant.includes("[")) {
              // it does, isolate name from offset
              const enumNameParts: string[] = enumConstant.split("[");
              enumConstant = enumNameParts[0];
            }
            if (enumConstant.charAt(0).match(/[a-zA-Z_]/)) {
              this._logCON("  -- GLBL enumConstant=[" + enumConstant + "]");
              const nameOffset = line.indexOf(enumConstant, currentOffset); // FIXME: UNDONE, do we have to dial this in?
              this.semanticFindings.recordDeclarationLine(line, lineNbr);
              this.semanticFindings.setGlobalToken(enumConstant, new RememberedToken("enumMember", lineNbr - 1, nameOffset, ["readonly"]), this._declarationComment());
            }
          }
        }
      }
    } else {
      this.conEnumInProgress = false; // if we have a blank line after moving comment then weve ended the enum set
    }
  }

  private _getDAT_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE    bGammaEnable        BYTE   TRUE               ' comment
    //         didShow             byte   FALSE[256]
    //                             byte   FALSE[256]
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const dataDeclNonCommentStr = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    let lineParts: string[] = this.parseUtils.getNonWhiteLineParts(dataDeclNonCommentStr);
    this._logDAT("- GetDatDecl() lineParts=[" + lineParts + "](" + lineParts.length + ")");
    let isDatDeclLine: boolean = lineParts.length >= 1 && lineParts[0].toUpperCase() == "DAT" ? true : false;
    if ((isDatDeclLine && lineParts.length >= 2) || (!isDatDeclLine && lineParts.length > 0)) {
      // remember this object name so we can annotate a call to it
      const nameIndex: number = isDatDeclLine ? 1 : 0;
      const typeIndex: number = isDatDeclLine ? 2 : 1;
      const maxParts: number = isDatDeclLine ? 3 : 2;
      const possLabel: string | undefined = lineParts.length > nameIndex ? lineParts[nameIndex] : undefined;
      const haveLabel: boolean = possLabel && possLabel.length > 0 ? this.parseUtils.isDatOrPAsmLabel(possLabel) : false;
      //this._logDAT(` -- GetDatDecl point 1: nameIndex=(${nameIndex}), typeIndex=(${typeIndex}), maxParts=(${maxParts})`);
      const dataType: string = lineParts.length > typeIndex ? lineParts[typeIndex] : "";
      //this._logDAT(` -- GetDatDecl point 2: dataType=[${dataType}](${dataType.length})`);
      const haveDataType: boolean = dataType.length > 0 ? true : false; // is RES, BYTE, WORD, LONG
      const haveStorageType: boolean = haveDataType ? this.parseUtils.isDatStorageType(dataType) : false; // is RES, BYTE, WORD, LONG
      //this._logDAT("- GetDatDecl possLabel=[" + possLabel + "], haveLabel=(" + haveLabel + "), dataType=[" + dataType + "], haveStorageType=" + haveStorageType);
      const isNamedDataDeclarationLine: boolean = haveLabel && haveDataType ? true : false;
      //this._logDAT(" -- GetDatDecl point 3");
      const isDataDeclarationLine: boolean = haveStorageType ? true : false;

      const lblFlag: string = haveLabel ? "T" : "F";
      const dataDeclFlag: string = isDataDeclarationLine ? "T" : "F";

      this._logDAT("- GetDatDecl prcss lineParts=[" + lineParts + "](" + lineParts.length + ") label=" + lblFlag + ", daDecl=" + dataDeclFlag);
      if (haveLabel) {
        const newName: string = lineParts.length > nameIndex ? lineParts[nameIndex] : "";
        let nameOffset: number = line.indexOf(newName, currentOffset);
        if (newName.length > 0) {
          const notOKSpin2Word: boolean = this.parseUtils.isSpin2ReservedWords(newName) && !this.parseUtils.isSpin2ButOKReservedWords(newName);
          if (!this.parseUtils.isSpinReservedWord(newName) && !this.parseUtils.isBuiltinReservedWord(newName) && !notOKSpin2Word) {
            const nameType: string = isDataDeclarationLine ? "variable" : "label";
            var labelModifiers: string[] = ["declaration"];
            if (!isDataDeclarationLine) {
              if (newName.startsWith(".")) {
                labelModifiers = ["illegalUse", "declaration", "static"];
                const offset: number = line.indexOf(newName, startingOffset);
                this.semanticFindings.pushDiagnosticMessage(lineNbr - 1, offset, offset + newName.length, eSeverity.Error, `P2 pasm local name [${newName}] not supported in P1 pasm`);
              } else if (newName.startsWith(":")) {
                labelModifiers = ["declaration", "static"];
              }
            }
            this._logDAT("  -- GLBL gddcl newName=[" + newName + "](" + nameType + ")");
            const bIsFileLine: boolean = dataType.length > 0 && dataType.toLowerCase() == "file" ? true : false;
            const fileName: string | undefined = isNamedDataDeclarationLine && bIsFileLine && lineParts.length > maxParts ? lineParts[maxParts] : undefined;
            this._logDAT("  -- GLBL gddcl fileName=[" + fileName + "]");
            this._ensureDataFileExists(fileName, lineNbr - 1, line, startingOffset);
            const nameOffset = line.indexOf(newName, currentOffset); // FIXME: UNDONE, do we have to dial this in?
            // LABEL-TODO add record of global, start or local extra line number
            let declType: eDefinitionType = eDefinitionType.NonLabel;
            if (!isNamedDataDeclarationLine) {
              // we have a label which type is it?
              declType = newName.startsWith(":") ? eDefinitionType.LocalLabel : eDefinitionType.GlobalLabel;
            }
            this.semanticFindings.recordDeclarationLine(line, lineNbr, declType);
            this.semanticFindings.setGlobalToken(newName, new RememberedToken(nameType, lineNbr - 1, nameOffset, labelModifiers), this._declarationComment(), fileName);
          } else if (notOKSpin2Word) {
            this.semanticFindings.pushDiagnosticMessage(lineNbr - 1, nameOffset, nameOffset + newName.length, eSeverity.Information, `Possible use of P2 Spin reserved word [${newName}]`);
          }
        }
      }
      // check for names in value declaration
      const dataTypeOffset: number = haveStorageType ? dataDeclNonCommentStr.indexOf(dataType) : 0;
      const valueDeclNonCommentStr: string = isDataDeclarationLine && dataTypeOffset != -1 ? dataDeclNonCommentStr.substring(dataTypeOffset + dataType.length).trim() : "";
      this._logDAT("   -- GetDatDecl valueDeclNonCommentStr=[" + valueDeclNonCommentStr + "]");
      if (valueDeclNonCommentStr.length > 0) {
        //let possObjRef: string | undefined = haveObjectRef ? lineParts[firstValueIndex] : undefined;
        const bISMethod: boolean = false; // SPIN1 we can't tell if method or constant (so force constant in DAT for now)
        const valueParts: string[] = valueDeclNonCommentStr.split(/[ \t\(\[\]\+\-\*\/]/).filter(Boolean);
        this._logDAT("   -- GetDatDecl valueParts=[" + valueParts + "](" + valueParts.length + ")");
        if (valueParts.length > 1) {
          // for all name parts see if we want to report any to global tables...
          for (let index = 0; index < valueParts.length; index++) {
            const currNamePart = valueParts[index];
            // do we have name not number?
            if (currNamePart.charAt(0).match(/[a-zA-Z_]/)) {
              const haveObjectRef: boolean = currNamePart.indexOf(".") != -1;
              if (haveObjectRef) {
                const objRefParts: string[] = currNamePart.split(".");
                const objName: string = objRefParts[0];
                const objRef: string = objRefParts[1];
                // if both parts are names...
                if (objName.charAt(0).match(/[a-zA-Z_]/) && objRef.charAt(0).match(/[a-zA-Z_]/)) {
                  this._logDAT("   -- GetDatDecl objRefParts=[" + objRefParts + "](" + objRefParts.length + ")");
                  // remember this object name so we can annotate a call to it
                  this._logDAT("   -- GetDatDecl objName=[" + objName + "], objRef=[" + objRef + "]");
                  // record expectation of object public interface
                  this.semanticFindings.recordDeclarationLine(line, lineNbr);
                  const nameOffset = line.indexOf(objRef, currentOffset); // FIXME: UNDONE, do we have to dial this in?
                  if (bISMethod) {
                    this.semanticFindings.setGlobalToken(objRef, new RememberedToken("method", lineNbr - 1, nameOffset, []), this._declarationComment(), objName);
                  } else {
                    this.semanticFindings.setGlobalToken(objRef, new RememberedToken("variable", lineNbr - 1, nameOffset, ["readonly"]), this._declarationComment(), objName);
                  }
                }
              }
            }
          }
        }
      }
    } else {
      this._logDAT("- GetDatDecl SKIP dataDeclNonCommentStr=[" + dataDeclNonCommentStr + "]");
    }
  }

  private _getDAT_PAsmDeclaration(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE    bGammaEnable        BYTE   TRUE               ' comment
    //         didShow             byte   FALSE[256]
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const datPAsmRHSStr = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    if (datPAsmRHSStr.length > 0) {
      const lineParts: string[] = this.parseUtils.getNonWhiteLineParts(datPAsmRHSStr);
      //this._logPASM('- GetDATPAsmDecl lineParts=[' + lineParts + ']');
      // handle name in 1 column
      let haveLabel: boolean = this.parseUtils.isDatOrPAsmLabel(lineParts[0]);
      const isDataDeclarationLine: boolean = lineParts.length > 1 && haveLabel && this.parseUtils.isDatStorageType(lineParts[1]) ? true : false;
      const isFileDeclarationLine: boolean = lineParts.length > 1 && haveLabel && lineParts[1].toLowerCase() == "file" ? true : false;
      if (haveLabel) {
        const labelName: string = lineParts[0];
        if (!this.parseUtils.isP1AsmReservedSymbols(labelName) && !labelName.toUpperCase().startsWith("IF_")) {
          // org in first column is not label name, nor is if_ conditional
          const labelType: string = isDataDeclarationLine ? "variable" : "label";
          var labelModifiers: string[] = ["declaration"];
          if (!isDataDeclarationLine) {
            if (labelName.startsWith(".")) {
              labelModifiers = ["illegalUse", "declaration", "static"];
              const offset: number = line.indexOf(labelName, startingOffset);
              this.semanticFindings.pushDiagnosticMessage(lineNbr - 1, offset, offset + labelName.length, eSeverity.Error, `P2 pasm local name [${labelName}] not supported in P1 pasm`);
            } else if (labelName.startsWith(":")) {
              labelModifiers = ["declaration", "static"];
            }
          }
          this._logPASM("  -- DAT PASM GLBL labelName=[" + labelName + "(" + labelType + ")]");
          const fileName: string | undefined = isFileDeclarationLine && lineParts.length > 2 ? lineParts[2] : undefined;
          this._logPASM("  -- DAT PASM label-ref fileName=[" + fileName + "]");
          this._ensureDataFileExists(fileName, lineNbr - 1, line, startingOffset);
          const nameOffset = line.indexOf(labelName, currentOffset); // FIXME: UNDONE, do we have to dial this in?
          // LABEL-TODO add record of global, start or local extra line number
          let declType: eDefinitionType = eDefinitionType.NonLabel;
          if (!isDataDeclarationLine) {
            // we have a label which type is it?
            declType = labelName.startsWith(":") ? eDefinitionType.LocalLabel : eDefinitionType.GlobalLabel;
          }
          this.semanticFindings.recordDeclarationLine(line, lineNbr, declType);
          this.semanticFindings.setGlobalToken(labelName, new RememberedToken(labelType, lineNbr - 1, nameOffset, labelModifiers), this._declarationComment(), fileName);
        }
      }
    }
  }

  private _ensureDataFileExists(fileName: string | undefined, lineIdx: number, line: string, startingOffset: number) {
    if (fileName) {
      const filenameNoQuotes: string = fileName.replace(/\"/g, "");
      const searchFilename: string = `\"${filenameNoQuotes}`;
      const hasPathSep: boolean = filenameNoQuotes.includes("/");
      const nameOffset: number = line.indexOf(searchFilename, startingOffset);
      const logCtx: Context | undefined = this.spin1DebugLogEnabled ? this.ctx : undefined;
      if (hasPathSep) {
        this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + filenameNoQuotes.length, eSeverity.Error, `P1 spin Invalid filename character "/" in [${filenameNoQuotes}]`);
      } else if (!fileInDirExists(this.directory, filenameNoQuotes, logCtx)) {
        this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + fileName.length, eSeverity.Error, `Missing P1 Data file [${fileName}]`);
      }
    }
  }

  private _ensureObjectFileExists(fileName: string | undefined, lineIdx: number, line: string, startingOffset: number) {
    if (fileName) {
      const filenameNoQuotes: string = fileName.replace(/\"/g, "");
      const hasSuffix: boolean = filenameNoQuotes.endsWith(".spin");
      const hasPathSep: boolean = filenameNoQuotes.includes("/");
      const fileWithExt = `${filenameNoQuotes}.spin`;
      const nameOffset: number = line.indexOf(filenameNoQuotes, startingOffset);
      const logCtx: Context | undefined = this.spin1DebugLogEnabled ? this.ctx : undefined;
      const checkFilename: string = hasSuffix ? filenameNoQuotes : fileWithExt;
      if (hasPathSep) {
        this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + filenameNoQuotes.length, eSeverity.Error, `P1 spin Invalid filename character "/" in [${filenameNoQuotes}]`);
      } else if (!fileInDirExists(this.directory, checkFilename, logCtx)) {
        const displayName: string = hasSuffix ? filenameNoQuotes : `${filenameNoQuotes}.spin`;
        this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + filenameNoQuotes.length, eSeverity.Error, `Missing P1 Object file [${displayName}]`);
      }
    }
  }

  private _getOBJ_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // parse P1 spin!
    // HAVE    color           : "isp_hub75_color"
    //  -or-   segments[7]     : "isp_hub75_segment"
    //
    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    const trimmedNonCommentLineStr: string = remainingNonCommentLineStr.trim();
    const remainingOffset: number = trimmedNonCommentLineStr.length > 0 ? line.indexOf(trimmedNonCommentLineStr, startingOffset) : 0;
    //this._logOBJ('- RptObjDecl remainingNonCommentLineStr=[' + remainingNonCommentLineStr + ']');
    if (trimmedNonCommentLineStr.length > 0 && remainingNonCommentLineStr.includes(":")) {
      // get line parts - we only care about first one
      const lineParts: string[] = remainingNonCommentLineStr.split(":").filter(Boolean);
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
      const nameOffset = line.indexOf(instanceNamePart, currentOffset); // FIXME: UNDONE, do we have to dial this in?
      this.semanticFindings.recordDeclarationLine(line, lineNbr);
      this.semanticFindings.setGlobalToken(instanceNamePart, new RememberedToken("namespace", lineNbr - 1, nameOffset, []), this._declarationComment(), filenamePart); // pass filename, too
      this.semanticFindings.recordObjectImport(instanceNamePart, filenamePart);
      this._ensureObjectFileExists(filenamePart, lineNbr - 1, line, startingOffset);
    } else if (remainingNonCommentLineStr.length > 0 && !remainingNonCommentLineStr.includes(":")) {
      this.semanticFindings.pushDiagnosticMessage(
        lineNbr - 1,
        remainingOffset,
        remainingOffset + remainingNonCommentLineStr.length,
        eSeverity.Error,
        `Illegal P1 Syntax: Unable to parse object declaration [${remainingNonCommentLineStr}]`
      );
    }
  }

  private _getPUB_PRI_Name(startingOffset: number, lineNbr: number, line: string): void {
    const methodType = line.substr(0, 3).toUpperCase();
    // reset our list of local variables
    const isPrivate = methodType.indexOf("PRI") != -1;
    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this.parseUtils.getNonCommentLineRemainder(0, line);
    const startNameOffset = currentOffset;
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
            // if nothing found...
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
    this._logSPIN("  -- GLBL GetMethodDecl newName=[" + methodName + "](" + methodName.length + "), type=[" + methodType + "], currentOffset=[" + currentOffset + "]");

    this.currentMethodName = methodName; // notify of latest method name so we can track inLine PASM symbols
    let methodExists: boolean = false;
    const referenceDetails: RememberedToken | undefined = this.semanticFindings.getGlobalToken(methodName);
    if (referenceDetails && referenceDetails.type === "method") {
      methodExists = true;
      this._logSPIN(`  -- _gPUB_PRI_Name() ERROR: have duplicate method [${methodName}]`);
    }
    if (!methodExists) {
      // mark start of method - we are learning span of lines this method covers
      this.semanticFindings.startMethod(methodName, lineNbr);

      // remember this method name so we can annotate a call to it
      const refModifiers: string[] = isPrivate ? ["static"] : [];
      // record ACTUAL object public/private interface
      // FIXME: post non-blank line after
      const nameOffset = line.indexOf(methodName, currentOffset); // FIXME: UNDONE, do we have to dial this in?
      this.semanticFindings.recordDeclarationLine(line, lineNbr);
      this.semanticFindings.setGlobalToken(methodName, new RememberedToken("method", lineNbr - 1, nameOffset, refModifiers), this._declarationComment());
      // reset our list of local variables
      this.semanticFindings.clearLocalPAsmTokensForMethod(methodName);

      const methodNamewithParens: string = `${methodName}()`;
      const methodNamewithSpaceParens: string = `${methodName} ()`;
      const methodPrefix: string = isPrivate ? "PRI" : "PUB";
      if (line.includes(methodNamewithParens) || line.includes(methodNamewithSpaceParens)) {
        this.semanticFindings.pushDiagnosticMessage(
          lineNbr - 1,
          startNameOffset,
          startNameOffset + methodName.length,
          eSeverity.Error,
          `P1 Spin missing parameter names [${methodPrefix} ${methodName}()]`
        );
      }
    } else {
      //const declarationLineIdx;number = referenceDetails.
      const methodPrefix: string = referenceDetails?.modifiers.includes("static") ? "PRI" : "PUB";
      this.semanticFindings.pushDiagnosticMessage(
        lineNbr - 1,
        startNameOffset,
        startNameOffset + methodName.length,
        eSeverity.Error,
        `P1 Spin Duplicate method Declaration: found earlier [${methodPrefix} ${methodName}]`
      );
    }
    this._logSPIN("  -- _gPUB_PRI_Name() exit");
  }

  private _getVAR_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE    long    demoPausePeriod   ' comment
    //
    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    if (remainingNonCommentLineStr.length > 0) {
      this._logVAR("- GetVarDecl remainingNonCommentLineStr=[" + remainingNonCommentLineStr + "]");
      const isMultiDeclaration: boolean = remainingNonCommentLineStr.includes(",");
      let lineParts: string[] = this.parseUtils.getNonWhiteDataInitLineParts(remainingNonCommentLineStr);
      const hasGoodType: boolean = this.parseUtils.isStorageType(lineParts[0]);
      this._logVAR("  -- lineParts=[" + lineParts + "]");
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
            const nameOffset = line.indexOf(newName, currentOffset); // FIXME: UNDONE, do we have to dial this in?
            this.semanticFindings.recordDeclarationLine(line, lineNbr);
            this.semanticFindings.setGlobalToken(newName, new RememberedToken("variable", lineNbr - 1, nameOffset, ["instance"]), this._declarationComment());
          }
        }
      } else if (!hasGoodType && lineParts.length > 0) {
        for (let index = 0; index < lineParts.length; index++) {
          const longVarName = lineParts[index];
          if (longVarName.charAt(0).match(/[a-zA-Z_]/)) {
            this._logVAR("  -- GLBL GetVarDecl newName=[" + longVarName + "]");
            const nameOffset = line.indexOf(longVarName, currentOffset); // FIXME: UNDONE, do we have to dial this in?
            this.semanticFindings.recordDeclarationLine(line, lineNbr);
            this.semanticFindings.setGlobalToken(longVarName, new RememberedToken("variable", lineNbr - 1, nameOffset, ["instance"]), this._declarationComment());
          }
        }
      }
    }
  }

  private _reportFlexspinPreProcessorLine(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];

    // skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const nonCommentConstantLine = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    if (nonCommentConstantLine.length > 0) {
      // get line parts - we only care about first one
      const lineParts: string[] = nonCommentConstantLine.split(/[ \t=]/).filter(Boolean);
      this._logPreProc("  - Ln#" + lineIdx + " reportPreProc lineParts=[" + lineParts + "]");
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
        this.semanticFindings.pushDiagnosticMessage(lineIdx, 0, 0 + lineParts[0].length, eSeverity.Error, `P1 Spin - PreProcessor Directive [${lineParts[0]}] not supported!`);
      }
    }

    return tokenSet;
  }

  private _reportCON_DeclarationLine(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    // skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const nonCommentConstantLine = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);

    const haveEnumDeclaration: boolean = nonCommentConstantLine.startsWith("#");
    const containsMultiAssignments: boolean = nonCommentConstantLine.indexOf(",") != -1;
    this._logCON("- reportConstant haveEnum=(" + haveEnumDeclaration + "), containsMulti=(" + containsMultiAssignments + "), nonCommentConstantLine=[" + nonCommentConstantLine + "]");
    let statements: string[] = [nonCommentConstantLine];
    if (!haveEnumDeclaration && containsMultiAssignments) {
      statements = nonCommentConstantLine.split(",");
    }
    this._logCON("  -- statements=[" + statements + "]");
    if (nonCommentConstantLine.length > 0) {
      for (let index = 0; index < statements.length; index++) {
        const conDeclarationLine: string = statements[index].trim();
        this._logCON("  -- conDeclarationLine=[" + conDeclarationLine + "]");
        currentOffset = line.indexOf(conDeclarationLine, currentOffset);
        // locate key indicators of line style
        const isAssignment: boolean = conDeclarationLine.indexOf("=") != -1;
        if (isAssignment && !haveEnumDeclaration) {
          // -------------------------------------------
          // have line assigning value to new constant
          // -------------------------------------------
          const assignmentParts: string[] = conDeclarationLine.split("=");
          const lhsConstantName = assignmentParts[0].trim();
          let nameOffset: number = line.indexOf(lhsConstantName, currentOffset);
          this._logCON("  -- GLBL lhsConstantName=[" + lhsConstantName + "]");
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
              ptTokenModifiers: ["readonly", "missingDeclaration"],
            });
            this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + lhsConstantName.length, eSeverity.Error, `Missing Variable Declaration [${lhsConstantName}]`);
          }

          // remove front LHS of assignment and process remainder
          const fistEqualOffset: number = conDeclarationLine.indexOf("=");
          const assignmentRHSStr = conDeclarationLine.substring(fistEqualOffset + 1).trim();
          currentOffset = line.indexOf(assignmentRHSStr); // skip to RHS of assignment
          this._logCON("  -- CON assignmentRHSStr=[" + assignmentRHSStr + "]");
          const possNames: string[] = this.parseUtils.getNonWhiteCONLineParts(assignmentRHSStr);
          this._logCON("  -- possNames=[" + possNames + "]");
          let namePart: string = "";
          for (let index = 0; index < possNames.length; index++) {
            namePart = possNames[index];
            const currPossibleLen = namePart.length;
            nameOffset = line.indexOf(namePart, currentOffset); // skip to RHS of assignment
            if (namePart.charAt(0).match(/[a-zA-Z_]/)) {
              // does name contain a namespace reference?
              if (this._isPossibleObjectReference(namePart)) {
                const bHaveObjReference = this._reportObjectReference(namePart, lineIdx, nameOffset, line, tokenSet);
                if (bHaveObjReference) {
                  currentOffset = nameOffset + namePart.length;
                  continue;
                }
              }
              let refChar: string = "";
              let possibleNameSet: string[] = [namePart];
              if (namePart.includes(".") && !namePart.startsWith(".")) {
                refChar = ".";
                possibleNameSet = namePart.split(".");
                this._logSPIN("  --  . possibleNameSet=[" + possibleNameSet + "]");
              } else if (namePart.includes("#")) {
                refChar = "#";
                possibleNameSet = namePart.split("#");
                this._logSPIN("  --  # possibleNameSet=[" + possibleNameSet + "]");
              }
              namePart = possibleNameSet[0];
              const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : possibleNameSet[0] + refChar + possibleNameSet[1];
              let referenceDetails: RememberedToken | undefined = undefined;
              nameOffset = line.indexOf(searchString, currentOffset);
              this._logCON("  -- namePart=[" + namePart + "], ofs=(" + nameOffset + ")");
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
                if (
                  !this.parseUtils.isSpinReservedWord(namePart) &&
                  !this.parseUtils.isBuiltinReservedWord(namePart) &&
                  !this.parseUtils.isUnaryOperator(namePart) &&
                  !this.parseUtils.isSpinBuiltInConstant(namePart) &&
                  !this.parseUtils.isP1AsmReservedWord(namePart)
                ) {
                  this._logCON("  --  CON MISSING name=[" + namePart + "]");
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: namePart.length,
                    ptTokenType: "variable",
                    ptTokenModifiers: ["readonly", "missingDeclaration"],
                  });
                  this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `Missing Constant Declaration [${namePart}]`);
                }
              }
            }
            currentOffset = nameOffset + namePart.length; // skip past this name
          }
        } else {
          // -------------------------------------------------
          // have line creating one or more of enum constants
          // -------------------------------------------------
          // recognize enum values getting initialized
          const lineParts: string[] = conDeclarationLine.split(",");
          //this._logCON('  -- lineParts=[' + lineParts + ']');
          let nameOffset: number = 0;
          for (let index = 0; index < lineParts.length; index++) {
            let enumConstant = lineParts[index].trim();
            // our enum name can have a step offset: name[step]
            if (enumConstant.includes("[")) {
              // it does, isolate name from offset
              const enumNameParts: string[] = enumConstant.split("[");
              enumConstant = enumNameParts[0];
            }
            if (enumConstant.includes("=")) {
              const enumAssignmentParts: string[] = enumConstant.split("=");
              enumConstant = enumAssignmentParts[0].trim();
              const enumExistingName: string = enumAssignmentParts[1].trim();
              if (enumExistingName.charAt(0).match(/[a-zA-Z_]/)) {
                this._logCON("  -- GLBL enumConstant=[" + enumConstant + "]");
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
            if (enumConstant.charAt(0).match(/[a-zA-Z_]/)) {
              this._logCON("  -- GLBL enumConstant=[" + enumConstant + "]");
              // our enum name can have a step offset
              nameOffset = line.indexOf(enumConstant, currentOffset);
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: enumConstant.length,
                ptTokenType: "enumMember",
                ptTokenModifiers: ["declaration", "readonly"],
              });
            }
            currentOffset = nameOffset + enumConstant.length;
          }
        }
      }
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
    this._logVAR("- rptDataDeclLn lineParts=[" + lineParts + "](" + lineParts.length + ")");
    // remember this object name so we can annotate a call to it
    if (lineParts.length > 0) {
      if (this.parseUtils.isStorageType(lineParts[0]) || lineParts[0].toUpperCase() == "FILE" || lineParts[0].toUpperCase() == "ORG") {
        // if we start with storage type (or FILE, or ORG), not name, process rest of line for symbols
        currentOffset = line.indexOf(lineParts[0], currentOffset);
        const allowLocalVarStatus: boolean = false;
        const NOT_DAT_PASM: boolean = false;
        const partialTokenSet: IParsedToken[] = this._reportDAT_ValueDeclarationCode(lineIdx, startingOffset, line, allowLocalVarStatus, this.showDAT, NOT_DAT_PASM);
        partialTokenSet.forEach((newToken) => {
          tokenSet.push(newToken);
        });
      } else {
        // this is line with name storageType and initial value
        this._logDAT("  -- rptDatDecl lineParts=[" + lineParts + "]");
        let newName = lineParts[0];
        const nameOffset: number = line.indexOf(newName, currentOffset);
        let referenceDetails: RememberedToken | undefined = undefined;
        if (this.semanticFindings.isGlobalToken(newName)) {
          referenceDetails = this.semanticFindings.getGlobalToken(newName);
          this._logMessage(`  --  FOUND rddl global name=[${newName}], referenceDetails=(${referenceDetails})`);
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
        } else if (
          !this.parseUtils.isP1AsmReservedSymbols(newName) &&
          !this.parseUtils.isP1AsmInstruction(newName) &&
          !this.parseUtils.isP1AsmConditional(newName) &&
          !this.parseUtils.isDatStorageType(newName) &&
          !this.parseUtils.isBuiltinReservedWord(newName) &&
          !this.parseUtils.isSpinReservedWord(newName) &&
          !newName.toUpperCase().startsWith("IF_")
        ) {
          this._logDAT("  --  DAT rDdl MISSING name=[" + newName + "]");
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: newName.length,
            ptTokenType: "variable",
            ptTokenModifiers: ["missingDeclaration"],
          });
          this.semanticFindings.pushDiagnosticMessage(lineIdx, currentOffset, currentOffset + newName.length, eSeverity.Error, `P1 Spin DAT missing declaration [${newName}]`);
        }

        // process remainder of line
        currentOffset = line.indexOf(lineParts[1], nameOffset + newName.length);
        const allowLocalVarStatus: boolean = false;
        const NOT_DAT_PASM: boolean = false;
        const partialTokenSet: IParsedToken[] = this._reportDAT_ValueDeclarationCode(lineIdx, startingOffset, line, allowLocalVarStatus, this.showDAT, NOT_DAT_PASM);
        partialTokenSet.forEach((newToken) => {
          tokenSet.push(newToken);
        });
      }
    } else {
      this._logDAT(`  -- DAT SKIPPED: lineParts=[${lineParts}]`);
    }
    return tokenSet;
  }

  private _reportDAT_ValueDeclarationCode(lineIdx: number, startingOffset: number, line: string, allowLocal: boolean, showDebug: boolean, isDatPAsm: boolean): IParsedToken[] {
    // process line that starts with storage type (or FILE, or ORG), not name, process rest of line for symbols
    const tokenSet: IParsedToken[] = [];
    const lineNbr: number = lineIdx + 1;
    //this._logMessage(' DBG _reportDAT_ValueDeclarationCode(#' + lineNumber + ', ofs=' + startingOffset + ')');
    this._logDAT("- process ValueDeclaration lineLn#" + lineNbr + " line=[" + line + "]: startingOffset=(" + startingOffset + ")");

    // process data declaration
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const dataValueInitStr = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    if (dataValueInitStr.length > 0) {
      this._logDAT("  -- reportDataValueInit dataValueInitStr=[" + dataValueInitStr + "]");

      let lineParts: string[] = this.parseUtils.getNonWhiteDataInitLineParts(dataValueInitStr);
      const argumentStartIndex: number = lineParts.length > 0 && this.parseUtils.isDatStorageType(lineParts[0]) ? 1 : 0;
      this._logDAT(`  -- lineParts=[${lineParts}], argumentStartIndex=[${argumentStartIndex}]`);

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
            if (showDebug) {
              this._logDAT("  -- possibleName=[" + possibleName + "]");
            }
            // does name contain a namespace reference?
            nameOffset = line.indexOf(possibleName, currentOffset);
            if (this._isPossibleObjectReference(possibleName)) {
              const bHaveObjReference = this._reportObjectReference(possibleName, lineIdx, nameOffset, line, tokenSet);
              if (bHaveObjReference) {
                currentOffset = nameOffset + possibleName.length;
                continue;
              }
            }
            let refChar: string = "";
            let possibleNameSet: string[] = [possibleName];
            if (possibleName.includes(".") && !namePart.startsWith(".")) {
              refChar = ".";
              possibleNameSet = possibleName.split(".");
              this._logDAT("  --  . possibleNameSet=[" + possibleNameSet + "]");
            } else if (possibleName.includes("#")) {
              refChar = "#";
              possibleNameSet = possibleName.split("#");
              this._logDAT("  --  # possibleNameSet=[" + possibleNameSet + "]");
            }
            namePart = possibleNameSet[0];
            const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : possibleNameSet[0] + refChar + possibleNameSet[1];
            nameOffset = line.indexOf(searchString, currentOffset);
            let referenceDetails: RememberedToken | undefined = undefined;
            if (allowLocal && this.semanticFindings.isLocalToken(namePart)) {
              referenceDetails = this.semanticFindings.getLocalTokenForLine(namePart, lineNbr);
              if (showDebug) {
                this._logDAT("  --  FOUND DAT value local name=[" + namePart + "]");
              }
            } else if (this.semanticFindings.isGlobalToken(namePart)) {
              referenceDetails = this.semanticFindings.getGlobalToken(namePart);
              if (showDebug) {
                this._logDAT("  --  FOUND DAT value global name=[" + namePart + "]");
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
                !this.parseUtils.isP1AsmReservedWord(namePart) &&
                !this.parseUtils.isP1AsmReservedSymbols(namePart) &&
                !this.parseUtils.isP1AsmInstruction(namePart) &&
                !this.parseUtils.isDatNFileStorageType(namePart) &&
                !this.parseUtils.isBinaryOperator(namePart) &&
                !this.parseUtils.isUnaryOperator(namePart) &&
                !this.parseUtils.isBuiltinReservedWord(namePart)
              ) {
                if (showDebug) {
                  this._logDAT("  --  DAT rDvdc MISSING name=[" + namePart + "]");
                }
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: namePart.length,
                  ptTokenType: "variable",
                  ptTokenModifiers: ["missingDeclaration"],
                });
                this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P1 Spin DAT missing declaration [${namePart}]`);
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
    const inLinePAsmRHSStr = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    if (inLinePAsmRHSStr.length > 0) {
      const lineParts: string[] = this.parseUtils.getNonWhitePAsmLineParts(inLinePAsmRHSStr);
      //currentOffset = line.indexOf(inLinePAsmRHSStr, currentOffset);
      this._logPASM("  -- reportDATPAsmDecl lineParts=[" + lineParts + "]");
      // handle name in 1 column
      let haveLabel: boolean = this.parseUtils.isDatOrPAsmLabel(lineParts[0]);

      let isDataDeclarationLine: boolean =
        (lineParts.length > 1 && haveLabel && this.parseUtils.isDatStorageType(lineParts[1])) || (lineParts.length > 0 && !haveLabel && this.parseUtils.isDatStorageType(lineParts[0]));

      // TODO: REWRITE this to handle "non-label" line with unknown op-code!
      if (haveLabel) {
        // YES Label
        // process label/variable name - starting in column 0
        const labelName: string = lineParts[0];
        this._logPASM(`  -- labelName=[${labelName}]`);
        let referenceDetails: RememberedToken | undefined = undefined;
        if (this.semanticFindings.isGlobalToken(labelName)) {
          referenceDetails = this.semanticFindings.getGlobalToken(labelName);
          this._logPASM(`  --  FOUND DATpasm global name=[${labelName}] referenceDetails=(${referenceDetails})`);
        }
        if (referenceDetails != undefined) {
          const nameOffset = line.indexOf(labelName, currentOffset);
          this._logPASM(`  --  DAT PAsm ${referenceDetails.type}=[${labelName}], ofs=(${nameOffset})`);
          const modifiersWDecl: string[] = referenceDetails.modifiersWith("declaration");
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: labelName.length,
            ptTokenType: referenceDetails.type,
            ptTokenModifiers: modifiersWDecl,
          });
          haveLabel = true;
        } else {
          // NO Label
          // hrmf... no global type???? this should be a label?
          this._logPASM("  --  DAT PAsm ERROR NOT A label=[" + labelName + "](" + (0 + 1) + ")");
          const nameOffset = line.indexOf(labelName, currentOffset);
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: labelName.length,
            ptTokenType: "variable", // color this offender!
            ptTokenModifiers: ["illegalUse"],
          });
          this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + labelName.length, eSeverity.Error, `Not a legal P1 pasm label [${labelName}]`);
          haveLabel = true;
        }
      }
      // no label...
      if (!isDataDeclarationLine) {
        // process assembly code - NOT data declaration
        this._logPASM("  -- reportDATPAsmDecl NOT Decl lineParts=[" + lineParts + "]");
        let argumentOffset = 0;
        if (lineParts.length > 1) {
          let minNonLabelParts: number = 1;
          if (haveLabel) {
            // skip our label
            argumentOffset++;
            minNonLabelParts++;
          }
          if (lineParts[argumentOffset].toUpperCase().startsWith("IF_")) {
            // skip our conditional
            argumentOffset++;
            minNonLabelParts++;
          }
          if (lineParts.length > minNonLabelParts) {
            // have at least instruction name
            const likelyInstructionName: string = lineParts[minNonLabelParts - 1];
            currentOffset = line.indexOf(likelyInstructionName, currentOffset);
            this._logPASM("  -- DAT PASM likelyInstructionName=[" + likelyInstructionName + "], currentOffset=(" + currentOffset + ")");
            currentOffset += likelyInstructionName.length + 1;
            let nameOffset: number = 0;
            let namePart: string = "";
            for (let index = minNonLabelParts; index < lineParts.length; index++) {
              namePart = lineParts[index].replace(/[@#]/, "");
              this._logPASM("  -- DAT PASM checking namePart=[" + namePart + "], currentOffset=(" + currentOffset + ")");
              if (namePart.length < 1) {
                // skip empty operand
                continue;
              }
              if (index == lineParts.length - 1 && this.parseUtils.isP1AsmConditional(namePart)) {
                // conditional flag-set spec.
                this._logPASM("  -- SKIP namePart=[" + namePart + "]");
                continue;
              }
              const argHasArrayRereference: boolean = namePart.includes("[");
              if (argHasArrayRereference) {
                const nameParts: string[] = namePart.split("[");
                namePart = nameParts[0];
              }
              if (namePart.charAt(0).match(/[a-zA-Z_\.\:]/)) {
                // does name contain a namespace reference?
                nameOffset = line.indexOf(namePart, currentOffset);
                this._logPASM("  -- namePart=[" + namePart + "]");
                if (this._isPossibleObjectReference(namePart)) {
                  const bHaveObjReference = this._reportObjectReference(namePart, lineIdx, nameOffset, line, tokenSet);
                  if (bHaveObjReference) {
                    currentOffset = nameOffset + namePart.length;
                    continue;
                  }
                }
                let refChar: string = "";
                let possibleNameSet: string[] = [namePart];
                if (namePart.includes(".") && !namePart.startsWith(".")) {
                  refChar = ".";
                  possibleNameSet = namePart.split(".");
                  this._logSPIN("  --  . possibleNameSet=[" + possibleNameSet + "]");
                } else if (namePart.includes("#")) {
                  refChar = "#";
                  possibleNameSet = namePart.split("#");
                  this._logSPIN("  --  # possibleNameSet=[" + possibleNameSet + "]");
                }
                namePart = possibleNameSet[0];
                const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : possibleNameSet[0] + refChar + possibleNameSet[1];
                nameOffset = line.indexOf(searchString, currentOffset);
                this._logPASM("  --  DAT PAsm searchString=[" + searchString + "](" + (nameOffset + 1) + ")");
                let referenceDetails: RememberedToken | undefined = undefined;
                if (this.semanticFindings.isGlobalToken(namePart)) {
                  referenceDetails = this.semanticFindings.getGlobalToken(namePart);
                  this._logPASM("  --  FOUND DATpasm global name=[" + namePart + "]");
                }
                if (referenceDetails != undefined) {
                  this._logPASM("  --  DAT PAsm name=[" + namePart + "](" + (nameOffset + 1) + ")");
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: namePart.length,
                    ptTokenType: referenceDetails.type,
                    ptTokenModifiers: referenceDetails.modifiers,
                  });
                } else {
                  if (
                    !this.parseUtils.isP1AsmReservedWord(namePart) &&
                    !this.parseUtils.isP1AsmInstruction(namePart) &&
                    !this.parseUtils.isP1AsmConditional(namePart) &&
                    !this.parseUtils.isBinaryOperator(namePart) &&
                    !this.parseUtils.isBuiltinReservedWord(namePart)
                  ) {
                    this._logPASM("  --  DAT PAsm MISSING name=[" + namePart + "](" + (nameOffset + 1) + ")");
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: namePart.length,
                      ptTokenType: "variable",
                      ptTokenModifiers: ["readonly", "missingDeclaration"],
                    });
                    this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `Missing P1 pasm name [${namePart}]`);
                  }
                }
              }
              currentOffset = nameOffset + namePart.length;
            }
          }
        } else if (this.parseUtils.isSpin2ReservedWords(lineParts[0]) && !this.parseUtils.isSpin2ButOKReservedWords(lineParts[0])) {
          const namePart: string = lineParts[argumentOffset];
          let nameOffset: number = line.indexOf(namePart, currentOffset);
          this._logPASM("  --  DAT PAsm ILLEGAL use of PAsm2 name=[" + namePart + "], ofs=(" + (nameOffset + 1) + ")");
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: namePart.length,
            ptTokenType: "variable",
            ptTokenModifiers: ["illegalUse"],
          });
          this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P2 pasm local name [${namePart}] not supported in P1 pasm`);
        }
      } else {
        // process data declaration NOT assembly code
        if (this.parseUtils.isDatStorageType(lineParts[0])) {
          currentOffset = line.indexOf(lineParts[0], currentOffset);
        } else {
          // skip line part 0 length when searching for [1] name
          currentOffset = line.indexOf(lineParts[1], currentOffset + lineParts[0].length);
        }
        const allowLocalVarStatus: boolean = false;
        const IS_DAT_PASM: boolean = true;
        const partialTokenSet: IParsedToken[] = this._reportDAT_ValueDeclarationCode(lineIdx, startingOffset, line, allowLocalVarStatus, this.showPAsmCode, IS_DAT_PASM);
        partialTokenSet.forEach((newToken) => {
          tokenSet.push(newToken);
        });
      }
    }

    return tokenSet;
  }

  private _reportPUB_PRI_Signature(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const lineNbr: number = lineIdx + 1;
    const tokenSet: IParsedToken[] = [];
    const methodType: string = line.substr(0, 3).toUpperCase();
    const isPrivate = methodType.indexOf("PRI") != -1;
    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const spineDeclarationLHSStr = this._getNonCommentLineReturnComment(0, lineIdx, line, tokenSet);
    if (spineDeclarationLHSStr) {
    } // we don't use this string, we called this to record our rhs comment!
    // -----------------------------------
    //   Method Name
    //
    const startNameOffset: number = currentOffset;

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
    this.currentMethodName = methodName; // notify of latest method name so we can track inLine PASM symbols
    // record definition of method
    const declModifiers: string[] = isPrivate ? ["declaration", "static"] : ["declaration"];
    this._recordToken(tokenSet, line, {
      line: lineIdx,
      startCharacter: startNameOffset,
      length: methodName.length,
      ptTokenType: "method",
      ptTokenModifiers: declModifiers,
    });
    this._logSPIN("-reportPubPriSig: methodName=[" + methodName + "](" + startNameOffset + ")");
    // -----------------------------------
    //   Parameters
    //
    // find close paren - so we can study parameters
    if (openParenOffset != -1) {
      const closeParenOffset = line.indexOf(")", openParenOffset);
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
          const paramName = parameterNames[index].trim();
          const nameOffset = line.indexOf(paramName, currentOffset);
          this._logSPIN("  -- paramName=[" + paramName + "](" + nameOffset + ")");
          if (this._hidesGlobalVariable(paramName)) {
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: paramName.length,
              ptTokenType: "parameter",
              ptTokenModifiers: ["illegalUse"],
            });
            this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + paramName.length, eSeverity.Error, `P1 Spin parameter [${paramName}] hides global variable of same name`);
          } else {
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: paramName.length,
              ptTokenType: "parameter",
              ptTokenModifiers: ["declaration", "readonly", "local"],
            });
          }
          // remember so we can ID references
          this.semanticFindings.setLocalTokenForMethod(methodName, paramName, new RememberedToken("parameter", lineNbr - 1, nameOffset, ["readonly", "local"]), this._declarationComment()); // TOKEN SET in _report()
          currentOffset = nameOffset + paramName.length;
        }
      }
    }
    // -----------------------------------
    //   Return Variable(s)
    //
    // find return vars
    const returnValueSep: number = line.indexOf(":", currentOffset);
    const localVarsSep: number = line.indexOf("|", currentOffset);
    let beginCommentOffset: number = line.indexOf("'", currentOffset);
    if (beginCommentOffset === -1) {
      beginCommentOffset = line.indexOf("{", currentOffset);
    }
    const nonCommentEOL: number = beginCommentOffset != -1 ? beginCommentOffset - 1 : line.length - 1;
    const returnVarsEnd: number = localVarsSep != -1 ? localVarsSep - 1 : nonCommentEOL;
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
        // check to see if return name is hiding global variable
        if (this._hidesGlobalVariable(returnValueName)) {
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: returnValueName.length,
            ptTokenType: "returnValue",
            ptTokenModifiers: ["illegalUse"],
          });
          this.semanticFindings.pushDiagnosticMessage(
            lineIdx,
            nameOffset,
            nameOffset + returnValueName.length,
            eSeverity.Error,
            `P1 Spin return [${returnValueName}] hides global variable of same name`
          );
        } else {
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: returnValueName.length,
            ptTokenType: "returnValue",
            ptTokenModifiers: ["declaration", "local"],
          });
        }
        // remember so we can ID references
        this.semanticFindings.setLocalTokenForMethod(methodName, returnValueName, new RememberedToken("returnValue", lineNbr - 1, nameOffset, ["local"]), this._declarationComment()); // TOKEN SET in _report()
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
        let nameParts: string[] = [];
        if (localVariableName.includes(" ")) {
          // have name with storage and/or alignment operators
          nameParts = localVariableName.split(" ");
        } else {
          // have single name
          nameParts = [localVariableName];
        }
        this._logSPIN("  -- nameParts=[" + nameParts + "]");
        for (let index = 0; index < nameParts.length; index++) {
          let localName = nameParts[index];
          // have name similar to scratch[12]?
          if (localName.includes("[")) {
            // yes remove array suffix
            const lineInfo: IFilteredStrings = this._getNonWhiteSpinLineParts(localName);
            let localNameParts: string[] = lineInfo.lineParts;
            localName = localNameParts[0];
            for (let index = 1; index < localNameParts.length; index++) {
              const namedIndexPart = localNameParts[index];
              const nameOffset = line.indexOf(namedIndexPart, currentOffset);
              if (namedIndexPart.charAt(0).match(/[a-zA-Z_]/)) {
                let referenceDetails: RememberedToken | undefined = undefined;
                if (this.semanticFindings.isLocalToken(namedIndexPart)) {
                  referenceDetails = this.semanticFindings.getLocalTokenForLine(namedIndexPart, lineNbr);
                  this._logSPIN("  --  FOUND local name=[" + namedIndexPart + "]");
                } else if (this.semanticFindings.isGlobalToken(namedIndexPart)) {
                  referenceDetails = this.semanticFindings.getGlobalToken(namedIndexPart);
                  this._logSPIN("  --  FOUND PUB/PRI global name=[" + namedIndexPart + "]");
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
                  if (!this.parseUtils.isSpinReservedWord(namedIndexPart) && !this.parseUtils.isSpinBuiltinMethod(namedIndexPart) && !this.parseUtils.isBuiltinReservedWord(namedIndexPart)) {
                    // we don't have name registered so just mark it
                    this._logSPIN("  --  SPIN MISSING varname=[" + namedIndexPart + "](" + (nameOffset + 1) + ")");
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: namedIndexPart.length,
                      ptTokenType: "variable",
                      ptTokenModifiers: ["missingDeclaration"],
                    });
                    if (this.parseUtils.isP2SpinMethod(namedIndexPart)) {
                      this.semanticFindings.pushDiagnosticMessage(
                        lineIdx,
                        nameOffset,
                        nameOffset + namedIndexPart.length,
                        eSeverity.Information,
                        `Possible use of P2 Spin reserved word [${namedIndexPart}]`
                      );
                    } else {
                      this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namedIndexPart.length, eSeverity.Error, `P1 Spin A missing declaration [${namedIndexPart}]`);
                    }
                  }
                }
              }
              currentOffset = nameOffset + namedIndexPart.length;
            }
          }
          const nameOffset = line.indexOf(localName, localVariableOffset);
          this._logSPIN("  -- localName=[" + localName + "](" + nameOffset + ")");
          if (index == nameParts.length - 1) {
            // have name
            // check to see if local name is hiding global variable
            if (this._hidesGlobalVariable(localName)) {
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: localName.length,
                ptTokenType: "variable",
                ptTokenModifiers: ["illegalUse"],
              });
              this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + localName.length, eSeverity.Error, `P1 Spin local [${localName}] hides global variable of same name`);
            } else {
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: localName.length,
                ptTokenType: "variable",
                ptTokenModifiers: ["declaration", "local"],
              });
            }
            // remember so we can ID references
            this.semanticFindings.setLocalTokenForMethod(methodName, localName, new RememberedToken("variable", lineNbr - 1, nameOffset, ["local"]), this._declarationComment()); // TOKEN SET in _report()
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
            }
          }
          currentOffset = nameOffset + localName.length;
        }
        currentOffset = localVariableOffset + localVariableName.length;
      }
    }
    return tokenSet;
  }

  private _hidesGlobalVariable(variableName: string): boolean {
    let hideStatus: boolean = false;
    let referenceDetails: RememberedToken | undefined = undefined;
    if (this.semanticFindings.isGlobalToken(variableName)) {
      hideStatus = true;
    }
    return hideStatus;
  }

  private _reportSPIN_Code(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    const lineNbr: number = lineIdx + 1;
    // skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const nonCommentSpinLine = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    const remainingLength: number = nonCommentSpinLine.length;
    this._logCON(`- reportSPIN nonCommentSpinLine=[${nonCommentSpinLine}] remainingLength=${remainingLength}`);
    if (remainingLength > 0) {
      // special early error case
      if (nonCommentSpinLine.toLowerCase().includes("else if")) {
        const nameOffset = line.toLowerCase().indexOf("else if", currentOffset);
        this._logSPIN(`  --  Illegal ELSE-IF [${nonCommentSpinLine}]`);
        const tokenLength: number = "else if".length;
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: nameOffset,
          length: tokenLength,
          ptTokenType: "keyword",
          ptTokenModifiers: ["illegalUse"],
        });
        this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + tokenLength, eSeverity.Error, 'Illegal "else if" form for P1 Spin');
      }
      // locate key indicators of line style
      let assignmentOffset: number = nonCommentSpinLine.includes(":=") ? line.indexOf(":=", currentOffset) : -1;
      if (assignmentOffset != -1) {
        // -------------------------------------------
        // have line assigning value to variable(s)
        //  Process LHS side of this assignment
        // -------------------------------------------
        const possibleVariableName = line.substr(currentOffset, assignmentOffset - currentOffset).trim();
        this._logSPIN(`  -- LHS: possibleVariableName=[${possibleVariableName}]`);
        let varNameList: string[] = [possibleVariableName];
        if (possibleVariableName.includes(",")) {
          varNameList = possibleVariableName.split(",");
        } else if (possibleVariableName.includes(" ") || possibleVariableName.includes("..")) {
          // force special case range chars to be removed
          //  Ex: RESP_OVER..RESP_NOT_FOUND : error_code.byte[3] := mod
          // change .. to : so it is removed by getNonWhite...
          const filteredLine: string = possibleVariableName.replace("..", ":");
          const lineInfo: IFilteredStrings = this._getNonWhiteSpinLineParts(filteredLine);
          varNameList = lineInfo.lineParts;
        } else if (possibleVariableName.includes("(")) {
          const lineInfo: IFilteredStrings = this._getNonWhiteSpinLineParts(possibleVariableName);
          varNameList = lineInfo.lineParts;
        }
        this._logSPIN(`  -- LHS: varNameList=[${varNameList}]`);
        for (let index = 0; index < varNameList.length; index++) {
          let nameOffset: number = currentOffset;
          let variableName: string = varNameList[index];
          const variableNameLen: number = variableName.length;
          if (variableName.includes("[")) {
            // NOTE this handles code: byte[pColor][2] := {value}
            //outa[D7..D4] := %0011               P1 OBEX:LCD SPIN driver - 2x16.spin (315)

            // have complex target name, parse in loop (remove our range specifier '..')
            if (variableName.includes("..")) {
              variableName = variableName.replace("..", " ");
            }
            const variableNameParts: string[] = variableName.split(/[ \t\[\]\/\*\+\-\(\)\<\>]/).filter(Boolean);
            this._logSPIN(`  -- LHS: [] variableNameParts=[${variableNameParts}]`);
            for (let index = 0; index < variableNameParts.length; index++) {
              let variableNamePart = variableNameParts[index].replace("@", "");
              // secial case handle datar.[i] which leaves var name as 'darar.'
              if (variableNamePart.endsWith(".")) {
                variableNamePart = variableNamePart.substr(0, variableNamePart.length - 1);
              }
              nameOffset = line.indexOf(variableNamePart, currentOffset);
              if (variableNamePart.charAt(0).match(/[a-zA-Z_]/)) {
                if (this._isPossibleObjectReference(variableNamePart)) {
                  const bHaveObjReference = this._reportObjectReference(variableNamePart, lineIdx, nameOffset, line, tokenSet);
                  if (bHaveObjReference) {
                    currentOffset = nameOffset + variableNamePart.length + 1;
                    continue;
                  }
                }
                if (variableNamePart.includes(".")) {
                  const varNameParts: string[] = variableNamePart.split(".");
                  if (this.parseUtils.isDatStorageType(varNameParts[1])) {
                    variableNamePart = varNameParts[0]; // just use first part of name
                  }
                }
                this._logSPIN(`  -- variableNamePart=[${variableNamePart}], ofs=(${nameOffset})`);
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
                    this._logSPIN(`  --  FOUND SPIN local name=[${variableNamePart}]`);
                  } else if (this.semanticFindings.isGlobalToken(variableNamePart)) {
                    referenceDetails = this.semanticFindings.getGlobalToken(variableNamePart);
                    this._logSPIN(`  --  FOUND SPIN global name=[${variableNamePart}]`);
                  }
                  if (referenceDetails != undefined) {
                    const modificationArray: string[] = referenceDetails.modifiersWith("modification");
                    this._logSPIN(`  --  SPIN variableName=[${variableNamePart}], ofs=(${nameOffset})`);
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: variableNamePart.length,
                      ptTokenType: referenceDetails.type,
                      ptTokenModifiers: modificationArray,
                    });
                  } else {
                    if (!this.parseUtils.isSpinReservedWord(variableNamePart) && !this.parseUtils.isBuiltinReservedWord(variableNamePart) && !this.parseUtils.isSpinBuiltinMethod(variableNamePart)) {
                      // we don't have name registered so just mark it
                      this._logSPIN(`  --  SPIN MISSING varname=[${variableNamePart}], ofs=(${nameOffset})`);
                      this._recordToken(tokenSet, line, {
                        line: lineIdx,
                        startCharacter: nameOffset,
                        length: variableNamePart.length,
                        ptTokenType: "variable",
                        ptTokenModifiers: ["modification", "missingDeclaration"],
                      });
                      this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + variableNamePart.length, eSeverity.Error, `P1 Spin B missing declaration [${variableNamePart}]`);
                    }
                  }
                }
              }
              currentOffset = nameOffset + 1;
            }
          } else {
            // have simple target name, no []
            let cleanedVariableName: string = variableName.replace(/[ \t\(\)]/, "");
            nameOffset = line.indexOf(cleanedVariableName, currentOffset);
            if (cleanedVariableName.charAt(0).match(/[a-zA-Z_]/) && !this.parseUtils.isStorageType(cleanedVariableName)) {
              this._logSPIN(`  --  SPIN cleanedVariableName=[${cleanedVariableName}], ofs=(${nameOffset})`);
              if (this._isPossibleObjectReference(cleanedVariableName)) {
                const bHaveObjReference = this._reportObjectReference(cleanedVariableName, lineIdx, nameOffset, line, tokenSet);
                if (bHaveObjReference) {
                  currentOffset = nameOffset + cleanedVariableName.length;
                  continue;
                }
              }
              if (cleanedVariableName.includes(".")) {
                const varNameParts: string[] = cleanedVariableName.split(".");
                if (this.parseUtils.isDatStorageType(varNameParts[1])) {
                  cleanedVariableName = varNameParts[0]; // just use first part of name
                }
              }
              let referenceDetails: RememberedToken | undefined = undefined;
              if (this.semanticFindings.isLocalToken(cleanedVariableName)) {
                referenceDetails = this.semanticFindings.getLocalTokenForLine(cleanedVariableName, lineNbr);
                this._logSPIN(`  --  FOUND local name=[${cleanedVariableName}]`);
              } else if (this.semanticFindings.isGlobalToken(cleanedVariableName)) {
                referenceDetails = this.semanticFindings.getGlobalToken(cleanedVariableName);
                this._logSPIN(`  --  FOUND globel name=[${cleanedVariableName}]`);
              }
              if (referenceDetails != undefined) {
                const modificationArray: string[] = referenceDetails.modifiersWith("modification");
                this._logSPIN(`  -- spin: simple variableName=[${cleanedVariableName}], ofs=(${nameOffset})`);
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: cleanedVariableName.length,
                  ptTokenType: referenceDetails.type,
                  ptTokenModifiers: modificationArray,
                });
              } else if (cleanedVariableName == "_") {
                this._logSPIN(`  --  built-in=[${cleanedVariableName}], ofs=(${nameOffset})`);
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
                  !this.parseUtils.isBuiltinReservedWord(cleanedVariableName)
                ) {
                  this._logSPIN(`  --  SPIN MISSING cln name=[${cleanedVariableName}], ofs=(${nameOffset})`);
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: cleanedVariableName.length,
                    ptTokenType: "variable",
                    ptTokenModifiers: ["modification", "missingDeclaration"],
                  });
                  if (this.parseUtils.isP2SpinMethod(cleanedVariableName)) {
                    this.semanticFindings.pushDiagnosticMessage(
                      lineIdx,
                      nameOffset,
                      nameOffset + cleanedVariableName.length,
                      eSeverity.Information,
                      `Possible use of P2 Spin reserved word [${cleanedVariableName}]`
                    );
                  } else {
                    this.semanticFindings.pushDiagnosticMessage(
                      lineIdx,
                      nameOffset,
                      nameOffset + cleanedVariableName.length,
                      eSeverity.Error,
                      `P1 Spin C missing declaration [${cleanedVariableName}]`
                    );
                  }
                }
              }
            }
            currentOffset = nameOffset + 1;
          }
          currentOffset = nameOffset + 1;
        }
      }
      // -------------------------------------------
      // could be line with RHS of assignment or a
      //  line with no assignment (process it)
      // -------------------------------------------
      const rhsOffset: number = assignmentOffset != -1 ? assignmentOffset + 2 : currentOffset;
      const assignmentRHSStr: string = this._getNonCommentLineReturnComment(rhsOffset, lineIdx, line, tokenSet);
      const preCleanAssignmentRHSStr = this.parseUtils.getNonInlineCommentLine(assignmentRHSStr).replace("..", "  ");
      this._logSPIN("  -- SPIN assignmentRHSStr=[" + assignmentRHSStr + "]");
      const lineInfo: IFilteredStrings = this._getNonWhiteSpinLineParts(preCleanAssignmentRHSStr);
      let possNames: string[] = lineInfo.lineParts;
      const nonStringAssignmentRHSStr: string = lineInfo.lineNoQuotes;
      this._logSPIN("  -- possNames=[" + possNames + "]");
      let nameOffset: number = 0;
      let nameLen: number = 0;
      for (let index = 0; index < possNames.length; index++) {
        let possibleName = possNames[index];
        // special code to handle case of var.[bitfield] leaving name a 'var.'
        if (possibleName.endsWith(".")) {
          possibleName = possibleName.substr(0, possibleName.length - 1);
        }
        const currNonStringNameLen: number = possNames[index].length;
        if (possibleName.charAt(0).match(/[a-zA-Z_]/)) {
          this._logSPIN("  -- possibleName=[" + possibleName + "]");
          // EXCEPTION processing for P2 use of inline pasm
          //  in P1 remind us that it's illegal
          if (possibleName.toLowerCase() === "org" || possibleName.toLowerCase() === "org") {
            nameOffset = line.indexOf(possibleName, 0);
            this._logSPIN("  --  SPIN ILLEGAL in-line use name=[" + possibleName + "](" + (nameOffset + 1) + ")");
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: possibleName.length,
              ptTokenType: "built-in",
              ptTokenModifiers: ["illegalUse"],
            });
            this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + possibleName.length, eSeverity.Error, `In-line Pasm not allowed in P1 Spin [${possibleName}]`);
            return tokenSet;
          }

          // does name contain a namespace reference?
          if (this._isPossibleObjectReference(possibleName)) {
            nameOffset = line.indexOf(possibleName, currentOffset);
            const bHaveObjReference = this._reportObjectReference(possibleName, lineIdx, nameOffset, line, tokenSet);
            if (bHaveObjReference) {
              currentOffset = nameOffset + possibleName.length;
              continue;
            }
          }
          let refChar: string = "";
          let possibleNameSet: string[] = [possibleName];
          if (possibleName.includes("#") && !possibleName.startsWith(".")) {
            refChar = ".";
            possibleNameSet = possibleName.split(".");
            this._logSPIN("  --  . possibleNameSet=[" + possibleNameSet + "]");
          } else if (possibleName.includes("#")) {
            refChar = "#";
            possibleNameSet = possibleName.split("#");
            this._logSPIN("  --  # possibleNameSet=[" + possibleNameSet + "]");
          }
          const namePart = possibleNameSet[0];
          const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : possibleNameSet[0] + refChar + possibleNameSet[1];
          nameOffset = line.indexOf(searchString, currentOffset);
          nameLen = namePart.length;
          this._logSPIN("  --  SPIN RHS  nonStringAssignmentRHSStr=[" + nonStringAssignmentRHSStr + "]");
          this._logSPIN("  --  SPIN RHS   searchString=[" + searchString + "], namePart=[" + namePart + "]");
          this._logSPIN("  --  SPIN RHS    nameOffset=(" + nameOffset + "), currentOffset=(" + currentOffset + ")");
          let referenceDetails: RememberedToken | undefined = undefined;
          if (this.semanticFindings.isLocalToken(namePart)) {
            referenceDetails = this.semanticFindings.getLocalTokenForLine(namePart, lineNbr);
            this._logSPIN("  --  FOUND spinRHS local name=[" + namePart + "]");
          } else if (this.semanticFindings.isGlobalToken(namePart)) {
            referenceDetails = this.semanticFindings.getGlobalToken(namePart);
            this._logSPIN("  --  FOUND spinRHS global name=[" + namePart + "]");
          }
          if (referenceDetails != undefined) {
            this._logSPIN("  --  SPIN RHS name=[" + namePart + "](" + (nameOffset + 1) + ")");
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: namePart.length,
              ptTokenType: referenceDetails.type,
              ptTokenModifiers: referenceDetails.modifiers,
            });
          } else {
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
            } else if (this.parseUtils.isSpinBuiltInConstant(namePart)) {
              this._logSPIN("  --  SPIN RHS builtin constant=[" + namePart + "]");
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: namePart.length,
                ptTokenType: "variable",
                ptTokenModifiers: ["readonly", "defaultLibrary"],
              });
            } else if (
              !this.parseUtils.isSpinReservedWord(namePart) &&
              !this.parseUtils.isSpinBuiltinMethod(namePart) &&
              !this.parseUtils.isSpinBuiltInVariable(namePart) &&
              !this.parseUtils.isBuiltinReservedWord(namePart)
            ) {
              this._logSPIN("  --  SPIN MISSING rhs name=[" + namePart + "]");
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: namePart.length,
                ptTokenType: "variable",
                ptTokenModifiers: ["missingDeclaration"],
              });
              if (this.parseUtils.isP2SpinMethod(namePart) || (this.parseUtils.isSpin2ReservedWords(namePart) && !this.parseUtils.isSpin2ButOKReservedWords(namePart))) {
                this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Information, `Possible use of P2 Spin reserved word [${namePart}]`);
              } else {
                this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P1 Spin D missing declaration [${namePart}]`);
              }
            } else {
              this._logSPIN(`  --  SPIN ??? What to do with: rhs name=[${namePart}], ofs=(${nameOffset})`);
            }
          }
        } else if (possibleName.startsWith(".")) {
          const externalMethodName: string = possibleName.replace(".", "");
          nameOffset = line.indexOf(externalMethodName, currentOffset);
          nameLen = externalMethodName.length;
          this._logSPIN("  --  SPIN rhs externalMethodName=[" + externalMethodName + "](" + (nameOffset + 1) + ")");
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: externalMethodName.length,
            ptTokenType: "method",
            ptTokenModifiers: [],
          });
        }
        currentOffset = nameOffset + nameLen + 1;
      }
    }
    return tokenSet;
  }

  private _reportOBJ_DeclarationLine(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    //this._logOBJ('- RptObjDecl remainingNonCommentLineStr=[' + remainingNonCommentLineStr + ']');
    const remainingLength: number = remainingNonCommentLineStr.length;
    if (remainingLength > 0) {
      // get line parts - initially, we only care about first one
      const lineParts: string[] = remainingNonCommentLineStr.split(/[ \t\:\[]/).filter(Boolean);
      this._logOBJ("  --  OBJ lineParts=[" + lineParts + "]");
      const objectName = lineParts[0];
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
            let possibleNameSet: string[] = [];
            const hasOpenParen: boolean = elemCountStr.indexOf("(") != -1; // should never be, but must check
            // is it a namespace reference?
            if (elemCountStr.includes(".")) {
              possibleNameSet = elemCountStr.split(".");
            } else {
              possibleNameSet = [elemCountStr];
            }
            for (let index = 0; index < possibleNameSet.length; index++) {
              const nameReference = possibleNameSet[index];
              if (this.semanticFindings.isGlobalToken(nameReference)) {
                const referenceDetails: RememberedToken | undefined = this.semanticFindings.getGlobalToken(nameReference);
                // Token offsets must be line relative so search entire line...
                const nameOffset = line.indexOf(nameReference, currentOffset);
                if (referenceDetails != undefined) {
                  //const updatedModificationSet: string[] = this._modifiersWithout(referenceDetails.modifiers, "declaration");
                  this._logOBJ("  --  FOUND OBJ global name=[" + nameReference + "]");
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: nameReference.length,
                    ptTokenType: referenceDetails.type,
                    ptTokenModifiers: referenceDetails.modifiers,
                  });
                }
              } else {
                // have possible dotted reference with name in other object. if has to be a constant
                if (!hasOpenParen) {
                  this._logOBJ("  --  OBJ Constant in external object name=[" + nameReference + "]");
                  const nameOffset = line.indexOf(nameReference, currentOffset);
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: nameReference.length,
                    ptTokenType: "variable",
                    ptTokenModifiers: ["readonly"],
                  });
                }
                // we don't have name registered so just mark it
                else if (!this.parseUtils.isSpinReservedWord(nameReference) && !this.parseUtils.isBuiltinReservedWord(nameReference)) {
                  this._logOBJ("  --  OBJ MISSING name=[" + nameReference + "]");
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: nameReference.length,
                    ptTokenType: "variable",
                    ptTokenModifiers: ["missingDeclaration"],
                  });
                  this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + nameReference.length, eSeverity.Error, `P1 Spin E missing declaration [${nameReference}]`);
                }
              }
            }
          }
        }
      }
    }
    return tokenSet;
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
          let nameOffset: number = 0;
          if (hasArrayReference) {
            // remove array suffix from name
            if (newName.includes("[")) {
              const nameParts: string[] = newName.split("[");
              newName = nameParts[0];
            }
          }
          // in the following, let's not register a name with a trailing ']' this is part of an array size calculation!
          if (newName.charAt(0).match(/[a-zA-Z_]/) && newName.indexOf("]") == -1) {
            nameOffset = line.indexOf(newName, currentOffset);
            let referenceDetails: RememberedToken | undefined = undefined;
            if (this.semanticFindings.isGlobalToken(newName)) {
              referenceDetails = this.semanticFindings.getGlobalToken(newName);
              this._logMessage(`  --  rObjRef FOUND global name=[${newName}]`);
            } else {
              this._logMessage(`  --  rObjRef MISSING global name=[${newName}]`);
            }
            if (referenceDetails != undefined) {
              this._logVAR("  -- GLBL found rvdl newName=[" + newName + "]");
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: newName.length,
                ptTokenType: "variable",
                ptTokenModifiers: ["declaration", "instance"],
              });
            } else {
              this._logVAR("  --  VAR Add MISSING name=[" + newName + "]");
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: newName.length,
                ptTokenType: "variable",
                ptTokenModifiers: ["missingDeclaration"],
              });
              this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + newName.length, eSeverity.Error, `P1 Spin F missing declaration [${newName}]`);
            }
            currentOffset = nameOffset + newName.length;
          }
          if (hasArrayReference) {
            // process name with array length value
            const arrayOpenOffset: number = line.indexOf("[", currentOffset);
            const arrayCloseOffset: number = line.indexOf("]", currentOffset);
            const arrayReference: string = line.substr(arrayOpenOffset + 1, arrayCloseOffset - arrayOpenOffset - 1);
            const arrayReferenceParts: string[] = arrayReference.split(/[ \t\/\*\+\<\>]/).filter(Boolean);
            this._logVAR(`  --  arrayReferenceParts=[${arrayReferenceParts}}](${arrayReferenceParts.length})`);
            let nameOffset: number = 0;
            let namePart: string = "";
            for (let index = 0; index < arrayReferenceParts.length; index++) {
              namePart = arrayReferenceParts[index];
              if (namePart.charAt(0).match(/[a-zA-Z_]/)) {
                nameOffset = line.indexOf(namePart, currentOffset);
                if (this._isPossibleObjectReference(namePart)) {
                  const bHaveObjReference = this._reportObjectReference(namePart, lineIdx, nameOffset, line, tokenSet);
                  if (bHaveObjReference) {
                    currentOffset = nameOffset + namePart.length;
                    continue;
                  }
                }
                let possibleNameSet: string[] = [namePart];
                this._logVAR("  --  possibleNameSet=[" + possibleNameSet + "](" + possibleNameSet.length + ")");
                namePart = possibleNameSet[0];
                if (this.semanticFindings.isGlobalToken(namePart)) {
                  const referenceDetails: RememberedToken | undefined = this.semanticFindings.getGlobalToken(namePart);
                  const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : possibleNameSet[0] + "#" + possibleNameSet[1];
                  nameOffset = line.indexOf(searchString, currentOffset);
                  if (referenceDetails != undefined) {
                    this._logVAR("  --  FOUND VAR global name=[" + namePart + "]");
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: namePart.length,
                      ptTokenType: referenceDetails.type,
                      ptTokenModifiers: referenceDetails.modifiers,
                    });
                  } else {
                    // we don't have name registered so just mark it
                    if (!this.parseUtils.isSpinReservedWord(namePart) && !this.parseUtils.isBuiltinReservedWord(namePart)) {
                      this._logVAR("  --  VAR Add MISSING name=[" + namePart + "]");
                      this._recordToken(tokenSet, line, {
                        line: lineIdx,
                        startCharacter: nameOffset,
                        length: namePart.length,
                        ptTokenType: "variable",
                        ptTokenModifiers: ["missingDeclaration"],
                      });
                      this.semanticFindings.pushDiagnosticMessage(lineIdx, nameOffset, nameOffset + namePart.length, eSeverity.Error, `P1 Spin G missing declaration [${namePart}]`);
                    }
                  }
                }
              }
              currentOffset = nameOffset + namePart.length;
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

  private _isPossibleObjectReference(possibleRef: string): boolean {
    // could be objectInstance.method or objectInstance#constant or objectInstance.method()
    // but can NOT be ".name"
    const dottedSymbolRegex = /[a-zA-Z0-9_]\.[a-zA-Z_]/;
    const hashedSymbolRegex = /[a-zA-Z0-9_]\#[a-zA-Z_]/;
    const hasSymbolDotSymbol: boolean = dottedSymbolRegex.test(possibleRef);
    const hasSymbolHashSymbol: boolean = hashedSymbolRegex.test(possibleRef);
    return !possibleRef.startsWith(".") && (hasSymbolDotSymbol || hasSymbolHashSymbol);
  }

  private _reportObjectReference(dotReference: string, lineIdx: number, startingOffset: number, line: string, tokenSet: IParsedToken[]): boolean {
    // Handle: instanceName#constant or instanceName.method() or instanceName.method     ' (no params)
    // NEW we validate the object is #constant or .method !!!
    this._logMessage(`- reportObjectReference() line(${lineIdx + 1}):[${dotReference}], ofs=(${startingOffset})`);
    let possibleNameSet: string[] = [];
    let bGeneratedReference: boolean = false;
    const isObjectConstantRef: boolean = dotReference.includes("#");
    if (dotReference.includes(".") || isObjectConstantRef) {
      const symbolOffset: number = line.indexOf(dotReference, startingOffset); // walk this past each
      possibleNameSet = dotReference.split(/[\.#]/).filter(Boolean);
      this._logMessage(`  --  rObjRef possibleNameSet=[${possibleNameSet}](${possibleNameSet.length})`);
      const objInstanceName = possibleNameSet[0];
      if (this.semanticFindings.isNameSpace(objInstanceName)) {
        let referenceDetails: RememberedToken | undefined = undefined;
        if (this.semanticFindings.isGlobalToken(objInstanceName)) {
          referenceDetails = this.semanticFindings.getGlobalToken(objInstanceName);
          this._logMessage(`  --  rObjRef FOUND global name=[${objInstanceName}]`);
        } else {
          this._logMessage(`  --  rObjRef MISSING global name=[${objInstanceName}]`);
        }
        if (referenceDetails != undefined) {
          //this._logPASM('  --  Debug() colorize name=[' + newParameter + ']');
          bGeneratedReference = true;
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: symbolOffset,
            length: objInstanceName.length,
            ptTokenType: referenceDetails.type,
            ptTokenModifiers: referenceDetails.modifiers,
          });
          if (possibleNameSet.length > 1) {
            // we have .constant namespace suffix
            // determine if this is method has '(' or constant name
            const objReferencedName = possibleNameSet[1];
            const referenceOffset = line.indexOf(objReferencedName, symbolOffset + objInstanceName.length);
            let isMethod: boolean = !isObjectConstantRef;

            referenceDetails = undefined;
            const extObjFindings: DocumentFindings | undefined = this.semanticFindings.getFindingsForNamespace(objInstanceName);
            if (extObjFindings) {
              referenceDetails = extObjFindings.getPublicToken(objReferencedName);
              this._logMessage(`  --  LookedUp Object-global token [${objReferencedName}] got [${referenceDetails}]`);
            }
            if (referenceDetails != undefined) {
              // have matching external reference, now validate it
              const tokenTypeID: string = isMethod ? "method" : "variable";
              let referenceTypeID: string = referenceDetails.type;
              if (referenceTypeID === "enumMember") {
                referenceTypeID = "variable";
              }
              const tokenModifiers: string[] = isMethod ? [] : ["readonly"];
              const haveExpectedType: boolean = referenceTypeID === tokenTypeID;
              if (haveExpectedType) {
                this._logMessage(`  --  rObjRef rhs constant=[${objReferencedName}], ofs=(${referenceOffset}) (${tokenTypeID})`);
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: referenceOffset,
                  length: objReferencedName.length,
                  ptTokenType: tokenTypeID,
                  ptTokenModifiers: tokenModifiers,
                });
              } else {
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: referenceOffset,
                  length: objReferencedName.length,
                  ptTokenType: tokenTypeID,
                  ptTokenModifiers: ["illegalUse"],
                });
                const expectedType: string = isMethod ? "METHOD Name" : "Constant Name";
                const recievedType: string = isMethod ? "Constant Name" : "METHOD Name";
                const joinString: string = isMethod ? "." : "#";
                this.semanticFindings.pushDiagnosticMessage(
                  lineIdx,
                  referenceOffset,
                  referenceOffset + objReferencedName.length,
                  eSeverity.Error,
                  `BAD P1 Object reference (using "${joinString}"): Expected [${objInstanceName}${joinString}${objReferencedName}] to be a ${expectedType} not a ${recievedType}`
                );
              }
            } else {
              this._logMessage(`  --  rObjRef Error refPart=[${objReferencedName}], ofs=(${referenceOffset})`);
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: referenceOffset,
                length: objReferencedName.length,
                ptTokenType: "variable",
                ptTokenModifiers: ["illegalUse"],
              });
              const refType: string = isMethod ? "Method" : "Constant";
              const adjustedName: string = isMethod ? `${objReferencedName}()` : objReferencedName;
              this.semanticFindings.pushDiagnosticMessage(
                lineIdx,
                referenceOffset,
                referenceOffset + objReferencedName.length,
                eSeverity.Error,
                `Object ${refType} [${adjustedName}] not found in [${objInstanceName}]`
              );
            }
          }
        }
      } else {
        // now we have a possible objInst.name but let's validate
        //   NAMESPACE NOT FOUND !
        this._logMessage(`  --  rObjRef Unknown instance name [${possibleNameSet[0]}]: possibleNameSet=[${possibleNameSet}]`);
        if (possibleNameSet.length > 1) {
          const objInstanceName: string = possibleNameSet[0];
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
            if (!isObjectConstantRef && line.substr(referenceOffset + referencePart.length, 1) == "(") {
              isMethod = true;
            }
            this._logMessage("  --  rObjRef MISSING instance declaration=[" + objInstanceName + "]");
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
              `P1 Spin Missing object instance declaration [${objInstanceName}]`
            );
            this._logMessage("  --  rObjRef Error refPart=[" + referencePart + "](" + (referenceOffset + 1) + ")");
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: referenceOffset,
              length: referencePart.length,
              ptTokenType: "variable",
              ptTokenModifiers: ["illegalUse"],
            });
            const refType: string = isMethod ? "Method" : "Constant";
            const adjustedName: string = isMethod ? `${referencePart}()` : referencePart;
            this.semanticFindings.pushDiagnosticMessage(
              lineIdx,
              referenceOffset,
              referenceOffset + referencePart.length,
              eSeverity.Error,
              `Object ${refType} [${adjustedName}] not found in missing [${objInstanceName}]`
            );
          }
        }
      }
    }
    this._logMessage(`  -- reportObjectReference() EXIT returns=(${bGeneratedReference})`);
    this._logMessage(`  --`);
    return bGeneratedReference;
  }

  private _recordToken(tokenSet: IParsedToken[], line: string, newToken: IParsedToken) {
    if (newToken.line != -1 && newToken.startCharacter != -1) {
      tokenSet.push(newToken);
    } else {
      const tokenInterp: string = `token(${newToken.line + 1},${newToken.startCharacter})=[len:${newToken.length}](${newToken.ptTokenType}[${newToken.ptTokenModifiers}])]`;
      this._logMessage(`** ERROR: BAD token nextString=[${tokenInterp}]`);
    }
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

  private _getSingleQuotedString(currentOffset: number, searchText: string): string {
    let nextString: string = "";
    const stringStartOffset: number = searchText.indexOf("'", currentOffset);
    if (stringStartOffset != -1) {
      this._logDEBUG("  -- _getSingleQuotedString(" + currentOffset + ", [" + searchText + "])");
      const stringEndOffset: number = searchText.indexOf("'", stringStartOffset + 1);
      if (stringEndOffset != -1) {
        nextString = searchText.substring(stringStartOffset, stringEndOffset + 1);
      }
    }
    if (nextString.length > 0) {
      this._logDEBUG("  -- gsqs nextString=[" + nextString + "](" + nextString.length + ")");
    }
    return nextString;
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
      this._logDEBUG("  -- gdqs nextString=[" + nextString + "](" + nextString.length + ")");
    }
    return nextString;
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
    if (this.spin1DebugLogEnabled) {
      //Write to output window.
      this.ctx.logger.log(message);
    }
  }

  private _logDEBUG(message: string): void {
    if (this.showDEBUG) {
      this._logMessage(message);
    }
  }

  private _getNonWhiteSpinLineParts(line: string): IFilteredStrings {
    //                                     split(/[ \t\-\:\,\+\[\]\@\(\)\!\*\=\<\>\&\|\?\\\~\#\^\/]/);
    const nonEqualsLine: string = this.parseUtils.removeDoubleQuotedStrings(line);
    const lineParts: string[] | null = nonEqualsLine.match(/[^ \t\-\:\,\+\[\]\@\(\)\!\*\=\<\>\&\|\?\\\~\^\/\}]+/g);
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

  private _getNonCommentLineReturnComment(startingOffset: number, lineIdx: number, line: string, tokenSet: IParsedToken[]): string {
    // skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    this._logMessage(`  -- Ln#${lineIdx + 1} gNCL-RC startingOffset=(${startingOffset}), line=[${line}](${line.length})`);
    const nonCommentStr = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    // now record the comment if we have one
    if (line.length != nonCommentStr.length) {
      this._logMessage(`  -- gNCL-RC nonCommentStr=[${nonCommentStr}](${nonCommentStr.length})`);
      const filtLine: string = line.replace(line.substring(0, nonCommentStr.length), nonCommentStr);
      this._logMessage(`  -- gNCL-RC filtLine=[${filtLine}](${filtLine.length})`);
      const commentRHSStrOffset: number = nonCommentStr.length;
      const commentOffset: number = this.parseUtils.getTrailingCommentOffset(commentRHSStrOffset, line);
      const bHaveBlockComment: boolean = filtLine.indexOf("{", commentOffset) != -1 || filtLine.indexOf("}", commentOffset) != -1;
      const bHaveDocComment: boolean = filtLine.indexOf("''", commentOffset) != -1 || filtLine.indexOf("{{", commentOffset) != -1 || filtLine.indexOf("}}", commentOffset) != -1;
      this._logMessage(`  -- gNCL-RC commentOffset=(${commentOffset}), bHvBlockComment=(${bHaveBlockComment}), bHvDocComment=(${bHaveDocComment}), filtLine=[${filtLine}](${filtLine.length})`);
      if (commentOffset != -1) {
        const newToken: IParsedToken | undefined = this._generateComentToken(lineIdx, commentOffset, line.length - commentOffset + 1, bHaveBlockComment, bHaveDocComment, line);
        if (newToken) {
          //this._logMessage("=> CMT: " + this._tokenString(newToken, line));
          tokenSet.push(newToken);
          //const comment: string = line.substring(commentOffset);
          //this._logMessage(`  -- Ln#${lineIdx + 1} gNCL-RC Recorded Comment [${comment}](${comment.length}) (${newToken.ptTokenType}[${newToken.ptTokenModifiers}])`);
        }
      }
    }
    this._logMessage(`  -- gNCL-RC nonCommentStr=[${nonCommentStr}](${nonCommentStr.length})`);
    return nonCommentStr;
  }

  private _generateComentToken(lineIdx: number, startIdx: number, commentLength: number, bHaveBlockComment: boolean, bHaveDocComment: boolean, line: string): IParsedToken | undefined {
    //this._logMessage("  -- gNCL-RC commentOffset=(" + commentOffset + "), bHaveDocComment=[" + bHaveDocComment + "], line=[" + line + "]");
    let desiredToken: IParsedToken | undefined = undefined;
    if (line.length > 0) {
      //const commentDocModifiers: string[] = bHaveBlockComment ? ["block", "documentation"] : ["line", "documentation"]; // A NO
      const commentDocModifiers: string[] = bHaveBlockComment ? ["documentation", "block"] : ["documentation", "line"]; // B NO
      const commentModifiers: string[] = bHaveBlockComment ? ["block"] : ["line"];
      desiredToken = {
        line: lineIdx,
        startCharacter: startIdx,
        length: commentLength,
        ptTokenType: "comment",
        ptTokenModifiers: bHaveDocComment ? commentDocModifiers : commentModifiers,
      };
      const comment: string = line.substring(startIdx, startIdx + commentLength);
      this._logMessage(`  -- Ln#${lineIdx + 1} genCT Recorded Comment [${comment}](${comment.length}) (${desiredToken.ptTokenType}[${desiredToken.ptTokenModifiers}])`);
    }
    return desiredToken;
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
}
