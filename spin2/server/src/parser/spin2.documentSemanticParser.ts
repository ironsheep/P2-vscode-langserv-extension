'use strict';
// src/spin2.documentSemanticParser.ts

import { Range, TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver-types';
import { Context, ServerBehaviorConfiguration, EditorConfiguration } from '../context';

import {
  DocumentFindings,
  RememberedComment,
  eCommentType,
  RememberedToken,
  eBLockType,
  IParsedToken,
  eSeverity,
  eDefinitionType,
  ePreprocessState,
  IStructMember,
  RememberedStructure
} from './spin.semantic.findings';
import { Spin2ParseUtils } from './spin2.utils';
import { isSpin1File } from './lang.utils';
import {
  eParseState,
  eDebugDisplayType,
  ContinuedLines,
  haveDebugLine,
  SpinControlFlowTracker,
  ICurrControlSpan,
  isMethodCall,
  containsSpinLanguageSpec,
  versionFromSpinLanguageSpec,
  isMethodCallEmptyParens
} from './spin.common';
import { fileInDirExists } from '../files';
import { ExtensionUtils } from '../parser/spin.extension.utils';

// ----------------------------------------------------------------------------
//   Semantic Highlighting Provider
//
//const tokenTypes = new Map<string, number>();
//const tokenModifiers = new Map<string, number>();

interface IFilteredStrings {
  lineNoQuotes: string;
  lineParts: string[];
}

/*
enum eSpin2Directive {
  Unknown = 0,
  s2dDebugDisplayForLine
}
*/
interface ISpin2Directive {
  lineNumber: number;
  displayType: string;
  eDisplayType: eDebugDisplayType;
}

// map of display-type to etype'
export class Spin2DocumentSemanticParser {
  private parseUtils = new Spin2ParseUtils();
  private spinControlFlowTracker = new SpinControlFlowTracker();
  private extensionUtils: ExtensionUtils;

  private bLogStarted: boolean = false;
  // adjust following true/false to show specific parsing debug
  private isDebugLogEnabled: boolean = true; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
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
  private editorConfiguration: EditorConfiguration;

  private currentMethodName: string = '';
  private currentFilespec: string = '';
  private isSpin1Document: boolean = false;
  private directory: string = '';
  private desiredDocVersion: number = 0;

  private bRecordTrailingComments: boolean = false; // initially, we don't generate tokens for trailing comments on lines
  private bHuntingForVersion: boolean = true; // initially we re hunting for a {Spin2_v##} spec in file-top comments

  public constructor(protected readonly ctx: Context) {
    this.extensionUtils = new ExtensionUtils(ctx, this.isDebugLogEnabled);
    this.configuration = ctx.parserConfig;
    this.editorConfiguration = ctx.editorConfig;
    if (this.isDebugLogEnabled) {
      this.parseUtils.enableLogging(this.ctx);
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        //Create output channel
        this._logMessage('Spin2 semantic log started.');
      } else {
        this._logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }
  }

  get docVersion(): number {
    this._logMessage(`* docVersion() -> (${this.desiredDocVersion})`);
    return this.desiredDocVersion;
  }

  //async provideDocumentSemanticTokens(document: vscode.TextDocument, cancelToken: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
  // SEE https://www.codota.com/code/javascript/functions/vscode/CancellationToken/isCancellationRequested
  //if (cancelToken) {
  //} // silence our compiler for now... TODO: we should adjust loop so it can break on cancelToken.isCancellationRequested
  public reportDocumentSemanticTokens(document: TextDocument, findings: DocumentFindings, dirSpec: string): void {
    this.semanticFindings = findings;
    this.directory = dirSpec;
    const startingLangVersion: number = this.parseUtils.selectedSpinVersion();
    if (this.isDebugLogEnabled) {
      this.semanticFindings.enableLogging(this.ctx);
      this.parseUtils.enableLogging(this.ctx);
      this.spinControlFlowTracker.enableLogging(this.ctx);
    }
    this.configuration = this.ctx.parserConfig; // ensure we have latest
    this.isSpin1Document = isSpin1File(document.uri);
    this._logMessage(`* Config: highlightFlexspinDirectives: [${this.configuration.highlightFlexspinDirectives}]`);
    this.currentFilespec = document.uri;
    this._logMessage(`* reportDocumentSemanticTokens(${this.currentFilespec})`);
    this._logMessage(`* ------  into findings=[${findings.instanceName()}]`);

    // retrieve tokens to highlight, post to DocumentFindings
    let allTokens = this._parseText(document.getText());
    findings.documentVersion = this.desiredDocVersion;
    const endingLangVersion: number = this.parseUtils.selectedSpinVersion();
    if (startingLangVersion != endingLangVersion) {
      this._logMessage(`* Spin2 LANG VERSION chg [${startingLangVersion} -> ${endingLangVersion}]`);
    } else {
      this._logMessage(`* Spin2 LANG VERSION [${startingLangVersion}]`);
    }
    allTokens = this._checkTokenSet(allTokens, document.getText());
    this.semanticFindings.clearSemanticTokens();
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
    let pendingState: eParseState = eParseState.Unknown;
    let prePAsmState: eParseState = currState;

    // track block comments
    let currBlockComment: RememberedComment | undefined = undefined;
    let currSingleLineBlockComment: RememberedComment | undefined = undefined;
    const continuedLineSet: ContinuedLines = new ContinuedLines();
    const tokenSet: IParsedToken[] = [];

    // ==============================================================================
    // prepass to find declarations: PRI/PUB method, OBJ names, and VAR/DAT names
    //
    if (this.isDebugLogEnabled) {
      continuedLineSet.enableLogging(this.ctx);
    }

    // -------- PRE-PARSE just locating symbol names, spin folding info -----------
    // also track and record block comments (both braces and tic's!)
    // let's also track prior single line and trailing comment on same line
    this._logMessage('--->             <---');
    this._logMessage('---> Get Declarations -- ');
    const startingLangVersion: number = this.parseUtils.selectedSpinVersion();
    this.parseUtils.setSpinVersion(0); // PRESET no override language version until we find one!
    this.bHuntingForVersion = true; // PRESET we start hunting from top of file
    let bBuildingSingleLineCmtBlock: boolean = false;
    let bBuildingSingleLineDocCmtBlock: boolean = false;
    this.spinControlFlowTracker.reset();
    this.semanticFindings.recordBlockStart(eBLockType.isCon, 0); // spin file defaults to CON at 1st line
    const DOC_COMMENT = true;
    const NONDOC_COMMENT = false;
    const BLOCK_COMMENT = true;
    const LINE_COMMENT = false;
    //const LINE_COMMENT = false;
    //let blocksFoundCount: number = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineNbr: number = i + 1;
      const line: string = lines[i];
      const trimmedLine: string = line.trim();
      const bHaveEmptyLine: boolean = trimmedLine.length == 0;
      const isDebugLine: boolean = !bHaveEmptyLine ? haveDebugLine(line) : false;

      // Nnew PNut/Propeller Tool directive support: {Spin2_v##}
      if (!bHaveEmptyLine && this.bHuntingForVersion && containsSpinLanguageSpec(trimmedLine, this.ctx)) {
        //this._logMessage(`  -- POSSIBLE spec: stopping HUNT Ln#${lineNbr}=[${trimmedLine}]`);
        this.bHuntingForVersion = false; // done we found it
        const newLangVersion: number = versionFromSpinLanguageSpec(trimmedLine, this.ctx);
        if (newLangVersion != startingLangVersion || newLangVersion != this.parseUtils.selectedSpinVersion()) {
          this.desiredDocVersion = newLangVersion;
          // forward version so we can use correct built-in tables
          this.parseUtils.setSpinVersion(newLangVersion);
          this._logMessage(`  -- found Spin2 NEW LANG VERSION (${newLangVersion}), stopping HUNT Ln#${lineNbr}=[${trimmedLine}]`);
        } else {
          this._logMessage(`  -- found Spin2 SAME LANG VERSION (${newLangVersion}), stopping HUNT Ln#${lineNbr}=[${trimmedLine}]`);
        }
      }

      let nonCommentLine: string;
      if (isDebugLine) {
        nonCommentLine = !bHaveEmptyLine ? this._getDebugNonCommentLine(0, this.parseUtils.getLineWithoutInlineComments(line)) : '';
      } else {
        nonCommentLine = !bHaveEmptyLine
          ? this.parseUtils.getRemainderWOutTrailingComment(0, this.parseUtils.getLineWithoutInlineComments(line))
          : '';
      }
      //this._logMessage(`  -- pre-scan Ln#${lineNbr} CHK0 isDbg(${isDebugLine}), nonCommentLine=[${nonCommentLine}](${nonCommentLine.length})`);
      let bHaveLineToProcess: boolean = nonCommentLine.trim().length > 0;
      let trimmedNonCommentLine: string = bHaveLineToProcess ? nonCommentLine.trimStart() : '';
      //this._logMessage(`  -- pre-scan Ln#${lineNbr} CHK1 nonCommentLine=[${nonCommentLine}](${nonCommentLine.length})`);
      const offSet: number = trimmedNonCommentLine.length > 0 ? line.indexOf(trimmedNonCommentLine) + 1 : line.indexOf(trimmedLine) + 1;
      const tempComment: string = line.substring(trimmedNonCommentLine.length + offSet).trim();
      this.rightEdgeComment = tempComment.length > 0 ? tempComment : '';
      const sectionStatus = this.extensionUtils.isSectionStartLine(line);
      if (sectionStatus.isSectionStart) {
        trimmedNonCommentLine = trimmedNonCommentLine.substring(3).trimStart();
        this._logMessage(
          `  -- pre-scan Ln#${lineNbr} sectionStatus=[${eParseState[sectionStatus.inProgressStatus]}] isSectionStart=(${sectionStatus.isSectionStart})`
        );
      }
      const singleLineParts: string[] = trimmedNonCommentLine.split(/[ \t]/).filter(Boolean);
      let nonStringLine: string = this.parseUtils.removeQuotedStrings(nonCommentLine);
      let trimmedNonStringLine: string = nonStringLine.trim();
      let nonStringLineUpCase: string = nonStringLine.toUpperCase();
      const isCodePresent: boolean = trimmedNonCommentLine.length > 0;
      let isLineContinued: boolean = isCodePresent ? trimmedNonCommentLine.endsWith('...') : false;
      if (isLineContinued) {
        bHaveLineToProcess = false;
      }
      /*
		  this._logMessage(
			`  -- pre-scan Ln#${lineNbr} CHK3 line2Proc=(${bHaveLineToProcess}), continued=(${isLineContinued}), nonStringLine=[${nonStringLine}](${nonStringLine.length})`
		  );
		  //*/
      // NOTE: comment mid-line set a pending state so next line uses the new state
      // special blocks of doc-comment and non-doc comment lines handling
      // if we have comment in progress but not another comment line, close comment being built!
      if (bBuildingSingleLineDocCmtBlock && !trimmedNonStringLine.startsWith("''")) {
        // process single line doc-comment
        bBuildingSingleLineDocCmtBlock = false;
        // add record single line comment block if > 1 line and clear
        if (currSingleLineBlockComment) {
          currSingleLineBlockComment.closeAsSingleLineBlock(i - 1);
          // NOTE: single line doc comments can be 1 line long!!! (unlike single line non-doc comments)
          this._logMessage(`  -- pre-scan found comment ${currSingleLineBlockComment.spanString()}`);
          this.semanticFindings.recordComment(currSingleLineBlockComment);
          currSingleLineBlockComment = undefined;
        }
      } else if (bBuildingSingleLineCmtBlock && !trimmedNonStringLine.startsWith("'")) {
        // process single line non-doc comment
        bBuildingSingleLineCmtBlock = false;
        // add record single line comment block if > 1 line and clear
        if (currSingleLineBlockComment) {
          // NOTE: single line non-doc comments must be 2 or more lines long!!! (unlike single line doc comments)
          if (currSingleLineBlockComment.lineCount > 1) {
            currSingleLineBlockComment.closeAsSingleLineBlock(i - 1);
            this._logMessage(`  -- pre-scan found comment ${currSingleLineBlockComment.spanString()}`);
            this.semanticFindings.recordComment(currSingleLineBlockComment);
          }
          currSingleLineBlockComment = undefined;
        }
      }
      /*
      this._logMessage(`  -- pre-scan Ln#${lineNbr} CHK4                   line=[${line}](${line.length})`);
      if (line.trim().length > 0) {
        this._logMessage(`  -- pre-scan Ln#${lineNbr} CHK4  this.rightEdgeComment=[${this.rightEdgeComment}](${this.rightEdgeComment.length})`);
        this._logMessage(`  -- pre-scan Ln#${lineNbr} CHK4  trimmedNonCommentLine=[${trimmedNonCommentLine}](${trimmedNonCommentLine.length})`);
        this._logMessage(`  -- pre-scan Ln#${lineNbr} CHK4   trimmedNonStringLine=[${trimmedNonStringLine}](${trimmedNonStringLine.length})`);
        this._logMessage(`  -- pre-scan Ln#${lineNbr} CHK4         nonCommentLine=[${nonCommentLine}](${nonCommentLine.length})`);
        this._logMessage(`  -- pre-scan Ln#${lineNbr} CHK4          nonStringLine=[${nonStringLine}](${nonStringLine.length})`);
        this._logMessage(`  -- pre-scan Ln#${lineNbr} CHK4    nonStringLineUpCase=[${nonStringLineUpCase}](${nonStringLineUpCase.length})`);
      }
      //*/

      // if we have line continuation and right-edge comment, then we need to record the right-edge comment
      if (isLineContinued && this.rightEdgeComment.length > 0) {
        const commentPosn: number = line.indexOf(this.rightEdgeComment);
        this._recordToken(
          tokenSet,
          line,
          this._generateComentToken(i, commentPosn, this.rightEdgeComment.length, LINE_COMMENT, NONDOC_COMMENT, line)
        );
      }

      // now start our processing
      if (
        currState != eParseState.inFakeLineContinuation &&
        trimmedNonCommentLine.endsWith('{') &&
        !trimmedNonCommentLine.startsWith('{') &&
        !trimmedNonCommentLine.endsWith('{{') &&
        trimmedNonCommentLine.length > 1
      ) {
        // TODO: the second if clause confuses me... why did I do this?
        // starting fake line continuation
        //  - replace '{' with '...'
        trimmedNonCommentLine = trimmedNonCommentLine.substring(0, trimmedNonCommentLine.length - 1) + ' ...';
        trimmedNonStringLine = trimmedNonStringLine.substring(0, trimmedNonStringLine.length - 1) + ' ...';
        nonStringLine = nonStringLine.substring(0, nonStringLine.length - 1) + ' ...';
        nonStringLineUpCase = nonStringLineUpCase.substring(0, nonStringLineUpCase.length - 1) + ' ...';
        nonCommentLine = nonCommentLine.substring(0, nonCommentLine.length - 1) + ' ...';
        isLineContinued = true;
        bHaveLineToProcess = false;

        // is open of multiline comment
        priorState = currState;
        currState = eParseState.inFakeLineContinuation;
        this._logMessage(
          `* pre-scan Ln#${lineNbr} foundMuli EOL srt-{ starting FakeLineContinuation, nonStringLine=[${nonStringLine}](${nonStringLine.length})`
        );
      } else if (currState == eParseState.inFakeLineContinuation) {
        // continuing fake line continuation
        //  - replace '{' with '...'
        //  - and replace leading '}' with ' '
        const moreContinuation: boolean = trimmedNonCommentLine.startsWith('}');
        if (moreContinuation) {
          trimmedNonCommentLine = trimmedNonCommentLine.replace('}', ' ');
          trimmedNonStringLine = trimmedNonStringLine.replace('}', ' ');
          nonStringLine = nonStringLine.replace('}', ' ');
          nonStringLineUpCase = nonStringLineUpCase.replace('}', ' ');
          nonCommentLine = nonCommentLine.replace('}', ' ');
        }
        const stillContinuation: boolean = trimmedNonCommentLine.endsWith('{');
        if (stillContinuation) {
          trimmedNonCommentLine = trimmedNonCommentLine.substring(0, trimmedNonCommentLine.length - 1) + ' ...';
          trimmedNonStringLine = trimmedNonStringLine.substring(0, trimmedNonStringLine.length - 1) + ' ...';
          nonStringLine = nonStringLine.substring(0, nonStringLine.length - 1) + ' ...';
          nonStringLineUpCase = nonStringLineUpCase.substring(0, nonStringLineUpCase.length - 1) + ' ...';
          nonCommentLine = nonCommentLine.substring(0, nonCommentLine.length - 1) + ' ...';
          isLineContinued = true;
        } else {
          isLineContinued = false;
          this._logMessage(
            `* pre-scan Ln#${lineNbr} foundMuli EOL end-} enidng FakeLineContinuation, nonStringLine=[${nonStringLine}](${nonStringLine.length})`
          );
          currState = priorState;
        }
        bHaveLineToProcess = false;
        /*
		** This is how we handle continuations lines like:
		** --------------------------------------------------------
		Mario0 byte {
		}$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,{
		}$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,{
		}$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
		** --------------------------------------------------------
		**
		** --------------------------------------------------------
		MarioColors long {
		}%00000000_00000000_00000000_00000000,{  $7fff	'any bit 31..24 set means transparent
		}%11111111_11111000_11111000_11111000,{  $7fff
		}%11111111_11111000_11111000_11111000,{  $7fff
		}%11111111_11111000_11111000_11111000,{  $7fff
		}%11111111_11111000_11011000_10011000,{  $7f73
		}%11111111_11010000_00000000_00100000,{  $6804  12->32
		}%11111111_00100000_00100000_00100000  ' $1084  13->33 'address=51
		** --------------------------------------------------------
		**
		*/
      } else if (currState == eParseState.inMultiLineDocComment) {
        // in multi-line doc-comment, hunt for end '} }' to exit
        const closingOffset: number = nonStringLine.indexOf('}}');
        let commentLen: number = line.length;
        if (closingOffset != -1) {
          commentLen = closingOffset + 2;
          // have close, comment ended
          // end the comment recording
          currBlockComment?.appendLastLine(i, line);
          // record new comment
          if (currBlockComment) {
            this._logMessage(`  -- pre-scan found comment ${currBlockComment.spanString()}`);
            this.semanticFindings.recordComment(currBlockComment);
            currBlockComment = undefined;
          }
          currState = priorState;
          this._logMessage(
            `* pre-scan Ln#${lineNbr} foundMuli end-}} exit MultiLineDocComment, nonStringLine=[${nonStringLine}](${nonStringLine.length})`
          );
          // if closing but not at start of line
          if (closingOffset > 0) {
            // Mark comment line
            this._recordToken(tokenSet, line, this._generateComentToken(i, 0, commentLen, BLOCK_COMMENT, DOC_COMMENT, line));
          }
          // if NO more code on line after close then skip line
          const tempLine: string = nonCommentLine.substring(closingOffset + 1).trim();
          if (tempLine.length == 0) {
            this._logMessage(`* pre-scan SKIP MultiLineDocComment Ln#${i + 1} nonCommentLine=[${nonCommentLine}]`);
            continue;
          }
          this._logMessage(`* pre-scan continue with MultiLineDocComment Ln#${i + 1} nonCommentLine=[${nonCommentLine}]`);
        } else {
          // add line to the comment recording
          currBlockComment?.appendLine(line);
          // if not closing
          this._recordToken(tokenSet, line, this._generateComentToken(i, 0, commentLen, BLOCK_COMMENT, DOC_COMMENT, line));
          this._logMessage(`* pre-scan SKIP MultiLineDocComment Ln#${i + 1} nonCommentLine=[${nonCommentLine}]`);
          continue; // nothing more to do with this line, skip to next
        }
        //  fall THRU let rest of line be processed
      } else if (currState == eParseState.inMultiLineComment) {
        // in multi-line non-doc-comment, hunt for end '}' to exit
        // ALLOW {...} on same line without closing!
        let closingMultiline: boolean = nonStringLine.includes('}');
        if (!closingMultiline) {
          // SPECIAL for '} case of closing multi-line comment
          if (/^'\s*}/.test(trimmedLine)) {
            closingMultiline = true;
          }
        }
        //const [closingMultiline, closingOffset] = this.extensionUtils.haveUnmatchedCloseOnLine(nonStringLine, '}');
        if (closingMultiline) {
          // have close, comment ended
          // end the comment recording
          currBlockComment?.appendLastLine(i, line);
          // record new comment
          if (currBlockComment) {
            this._logMessage(`  -- found comment ${currBlockComment.spanString()}`);
            this.semanticFindings.recordComment(currBlockComment);
            currBlockComment = undefined;
          }
          currState = priorState;
          this._logMessage(
            `* pre-scan Ln#${lineNbr} foundMuli end-} exit MultiLineComment, nonStringLine=[${nonStringLine}](${nonStringLine.length})`
          );
          // if NO more code on line after close then skip line
          const closingOffset: number = nonCommentLine.indexOf('}');
          const tempLine: string = nonCommentLine.substring(closingOffset + 1).trim();
          if (tempLine.length == 0) {
            this._logMessage(`* pre-scan SKIP MultiLineComment Ln#${i + 1} nonCommentLine=[${nonCommentLine}]`);
            continue;
          }
        } else {
          // add line to the comment recording
          currBlockComment?.appendLine(line);
          continue; // nothing more to do with this line, skip to next
        }
      } else if (nonCommentLine.length == 0) {
        // a blank line clears pending single line comments
        this.priorSingleLineComment = undefined;
        //this._logMessage(`* SKIP blank line pre-scan Ln#${lineNbr} nonCommentLine=[${nonCommentLine}]`);
        continue;
      } else if (trimmedNonStringLine.startsWith("''")) {
        if (bBuildingSingleLineDocCmtBlock) {
          // process single line doc comment which follows one of same
          // we no longer have a prior single line comment
          this.priorSingleLineComment = undefined;
          // add to existing single line doc-comment block
          if (currSingleLineBlockComment != undefined) {
            currSingleLineBlockComment.appendLine(line);
          }
        } else {
          // process a first single line doc comment
          this.priorSingleLineComment = trimmedLine; // record this line
          // create new single line doc-comment block
          bBuildingSingleLineDocCmtBlock = true;
          currSingleLineBlockComment = new RememberedComment(eCommentType.singleLineDocComment, i, line);
        }
        continue;
      } else if (trimmedLine.startsWith("'")) {
        if (bBuildingSingleLineCmtBlock) {
          // process single line non-doc comment which follows one of same
          // we no longer have a prior single line comment
          this.priorSingleLineComment = undefined;
          // add to existing single line non-doc-comment block
          if (currSingleLineBlockComment != undefined) {
            currSingleLineBlockComment.appendLine(line);
          }
        } else {
          // process a first single line non-doc comment
          this.priorSingleLineComment = trimmedLine; // record this line
          // create new single line non-doc-comment block
          bBuildingSingleLineCmtBlock = true;
          currSingleLineBlockComment = new RememberedComment(eCommentType.singleLineComment, i, line);
        }
        continue;
      } else if (trimmedNonStringLine.startsWith('{{')) {
        // TODO: the second if clause confuses me... why did I do this?
        // process multi-line doc comment
        const openingOffset = nonStringLine.indexOf('{{');
        const closingOffset = openingOffset != -1 ? nonStringLine.indexOf('}}', openingOffset + 2) : -1;
        if (closingOffset != -1) {
          // is single line comment, just ignore it Let Syntax highlighting do this
          // record new single-line comment
          const oneLineComment = new RememberedComment(eCommentType.multiLineDocComment, i, line);
          oneLineComment.closeAsSingleLine();
          if (!oneLineComment.isBlankLine) {
            this._logMessage(`  -- pre-scan found comment ${oneLineComment.spanString()}`);
            this.semanticFindings.recordComment(oneLineComment);
          }
          currBlockComment = undefined; // just making sure...
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineDocComment;
          this._logMessage(
            `* pre-scan Ln#${lineNbr} foundMuli srt-{{ starting MultiLineDocComment, nonStringLine=[${nonStringLine}](${nonStringLine.length})`
          );
          // start  NEW comment
          currBlockComment = new RememberedComment(eCommentType.multiLineDocComment, i, line);
          //  DO NOTHING Let Syntax highlighting do this
          continue; // only SKIP if we DON't have closing marker and comment is only thing on line
        }
      } else if (trimmedNonStringLine.startsWith('{')) {
        // TODO: the second if clause confuses me... why did I do this?
        // process possible multi-line non-doc comment
        // do we have a close on this same line?
        const openingOffset = nonStringLine.indexOf('{');
        const closingOffset = openingOffset != -1 ? nonStringLine.indexOf('}', openingOffset + 1) : -1;
        if (closingOffset != -1) {
          // is single line comment, we can have Spin2 Directive in here
          this._getSpin2_Directive(0, lineNbr, line);
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineComment;
          this._logMessage(
            `* pre-scan Ln#${lineNbr} foundMuli srt-{ starting MultiLineComment, nonStringLine=[${nonStringLine}](${nonStringLine.length})`
          );
          // start  NEW comment
          currBlockComment = new RememberedComment(eCommentType.multiLineComment, i, line);
          // Mark comment line
          this._recordToken(tokenSet, line, this._generateComentToken(i, 0, line.length, BLOCK_COMMENT, NONDOC_COMMENT, line));
          //  DO NOTHING Let Syntax highlighting do this
          continue; // only SKIP if we don't have closing marker
        }
      } else if (nonStringLine.includes('{{')) {
        // process multi-line doc comment which doesn't start at beginning of line
        const openingOffset = nonStringLine.indexOf('{{');
        const closingOffset = openingOffset != -1 ? nonStringLine.indexOf('}}', openingOffset + 2) : -1;
        // if we only have open...
        if (closingOffset == -1) {
          // is open of multiline comment without CLOSE
          priorState = currState;
          pendingState = eParseState.inMultiLineDocComment;
          this._logMessage(`* pre-scan Ln#${lineNbr} priorState=[${eParseState[priorState]}] pendingState=[${eParseState[pendingState]}]`);
          this._logMessage(
            `* pre-scan Ln#${lineNbr} foundMuli mid-{{ starting MultiLineDocComment, nonCommentLine=[${nonCommentLine}](${nonCommentLine.length})`
          );
          // start  NEW comment
          currBlockComment = new RememberedComment(eCommentType.multiLineDocComment, i, line.substring(openingOffset));
          // Mark comment line
          this._recordToken(
            tokenSet,
            line,
            this._generateComentToken(i, openingOffset, line.length - openingOffset, BLOCK_COMMENT, DOC_COMMENT, line)
          );
          if (nonCommentLine.endsWith('{{')) {
            // we have open at end of line, nothing more to do
            continue;
          }
          //  DO NOTHING Let Syntax highlighting do this
        }
      } else if (nonStringLine.includes('{') && !nonStringLine.includes('{{')) {
        // process possible multi-line non-doc comment which doesn't start at beginning of line
        // do we have a close on this same line?
        const openingOffset = nonStringLine.indexOf('{');
        const closingOffset = openingOffset != -1 ? nonStringLine.indexOf('}', openingOffset + 1) : -1;
        if (closingOffset == -1) {
          // is open of multiline comment (with NO closing)
          priorState = currState;
          pendingState = eParseState.inMultiLineComment;
          this._logMessage(`* pre-scan Ln#${lineNbr} priorState=[${eParseState[priorState]}] pendingState=[${eParseState[pendingState]}]`);
          this._logMessage(
            `* pre-scan Ln#${lineNbr} foundMuli mid-{ starting MultiLineComment nonStringLine=[${nonStringLine}](${nonStringLine.length})`
          );
          // start  NEW comment
          currBlockComment = new RememberedComment(eCommentType.multiLineComment, i, line);
          //  DO NOTHING Let Syntax highlighting do this
          //continue; // DON'T SKIP, process rest of line
        }
      } else if (singleLineParts.length > 0 && this.parseUtils.isPNutPreprocessorDirective(singleLineParts[0])) {
        this._getPNutPreProcessor_Declaration(0, lineNbr, line);
        // a FlexspinPreprocessorDirective line clears pending single line comments
        this.priorSingleLineComment = undefined;
        continue; // only SKIP if we have FlexSpin directive
      } else if (singleLineParts.length > 0 && this.parseUtils.isFlexspinPreprocessorDirective(singleLineParts[0])) {
        this._getFlexspinPreProcessor_Declaration(0, lineNbr, line);
        // a FlexspinPreprocessorDirective line clears pending single line comments
        this.priorSingleLineComment = undefined;
        continue; // only SKIP if we have FlexSpin directive
      }

      this._logMessage(`  -- pre-scan Ln#${lineNbr} proceed with line, nonCommentLine=[${nonCommentLine}](${nonCommentLine.length})`);

      // -------------------------------------------------------------------
      // handle wrap-up before we do continued-line gathering
      //
      if (sectionStatus.isSectionStart) {
        // mark end of method, if we were in a method
        this.semanticFindings.endPossibleMethod(i); // pass prior line number! essentially i+1 (-1)

        if (currState == eParseState.inDatPAsm) {
          this.semanticFindings.recordPasmEnd(i - 1);
          currState = prePAsmState;
          this._logState(`- pre-scan Ln#${lineNbr} POP currState=[${eParseState[currState]}]`);
        }

        if (currState == eParseState.inPub || currState == eParseState.inPri) {
          // mark end of code fold, if we were in a method
          const spanSet: ICurrControlSpan[] = this.spinControlFlowTracker.finishControlFlow(i - 1); // pass prior line number! essentially i+1 (-1)
          if (spanSet.length > 0) {
            for (let index = 0; index < spanSet.length; index++) {
              const flowSpan: ICurrControlSpan = spanSet[index];
              this.semanticFindings.recordSpinFlowControlSpan(flowSpan.startLineIdx, flowSpan.endLineIdx);
            }
          }
        }

        currState = sectionStatus.inProgressStatus;
        // record start of next block in code
        //  NOTE: this causes end of prior block to be recorded
        let newBlockType: eBLockType = eBLockType.Unknown;
        switch (currState) {
          case eParseState.inCon:
            newBlockType = eBLockType.isCon;
            break;
          case eParseState.inDat:
            newBlockType = eBLockType.isDat;
            break;
          case eParseState.inVar:
            newBlockType = eBLockType.isVar;
            break;
          case eParseState.inObj:
            newBlockType = eBLockType.isObj;
            break;
          case eParseState.inPub:
            newBlockType = eBLockType.isPub;
            break;
          case eParseState.inPri:
            newBlockType = eBLockType.isPri;
            break;
        }

        const stopVersionHunt: boolean = newBlockType != eBLockType.Unknown ? true : false;
        if (this.bHuntingForVersion && stopVersionHunt) {
          // we are in a new block (sectionStart) if 2nd or later block then we stop our search
          this.bHuntingForVersion = false; // done, we passed the file-top comments. we can no longer search
          const newLangVersion: number = this.parseUtils.selectedSpinVersion();
          this._logMessage(`  -- pre-scan code block! stopping HUNT LANG VERSION=(${newLangVersion}), Ln#${lineNbr}=[${trimmedLine}]`);
        }

        this.semanticFindings.recordBlockStart(newBlockType, i); // start new one which ends prior
        this._logState(`- pre-scan Ln#${lineNbr} currState=[${eParseState[currState]}]`);
      }

      // -------------------------------------------------------------------
      // ----- gather our multi-line set if line is continued
      // -------------------------------------------------------------------
      //
      //this._logMessage(`  -- pre-scan Ln#${lineNbr} CHK5 currState=[${eParseState[currState]}]`);
      let continuedSectionStatus = {
        isSectionStart: false,
        inProgressStatus: eParseState.Unknown
      };
      if (isLineContinued || (continuedLineSet.isLoading && isCodePresent)) {
        //const lineOffset: number = line.indexOf(trimmedNonCommentLine);
        this._logMessage(`- pre-scan Ln#${lineNbr} [${eParseState[currState]}] stuffing ncl=[${nonCommentLine}](${nonCommentLine.length})`);
        continuedLineSet.addLine(nonCommentLine, i);
        if (!continuedLineSet.hasAllLines) {
          continue; // need to gather next line too
        }
        // now determine if this continued line set is a section start
        continuedSectionStatus = this.extensionUtils.isSectionStartLine(continuedLineSet.line);
      }

      // NOTE: we are only here if continuedLineSet has all lines
      const bHaveLineSetToProcess: boolean = !continuedLineSet.isEmpty;

      // only non-continued lines follow this path (start-section)... continued lines follow the non-section-start path
      if (sectionStatus.isSectionStart) {
        // ID the remainder of the line
        if (currState == eParseState.inPub || currState == eParseState.inPri) {
          // process PUB/PRI method signature (which is NOT a continued line-set)
          if (trimmedNonCommentLine.length > 3) {
            this._getPUB_PRI_Name(3, lineNbr, line);
            // and record our fake signature for later use by signature help
            const docComment: RememberedComment = this._generateFakeCommentForSignature(0, lineNbr, line);
            if (docComment.type != eCommentType.Unknown) {
              this.semanticFindings.recordFakeComment(docComment);
            } else {
              this._logState('- pre-scan Ln#' + lineNbr + ' no FAKE doc comment for this signature');
            }
          }
        } else if (currState == eParseState.inCon) {
          // process a constant line
          if (isCodePresent) {
            this._logCON(`- pre-scan CON (SGL-onCONline) Ln#${lineNbr} trimmedLine=[${trimmedNonCommentLine}](${trimmedNonCommentLine.length})`);
            continuedLineSet.clear();
            continuedLineSet.addLine(nonCommentLine, lineNbr - 1);
            this._getCON_DeclarationMultiLine(3, continuedLineSet);
            continuedLineSet.clear();
          } else {
            this._logMessage(`- pre-scan CON (SGL-onCONline) SKIP Ln#${lineNbr} nonCommentLine=[${nonCommentLine}](${nonCommentLine.length})`);
          }
        } else if (currState == eParseState.inDat) {
          // process a class(static) variable line - section start
          this._logPASM(`- pre-scan DAT SECTION Ln#${lineNbr} trimmedLine=[${trimmedLine}](${trimmedLine.length})`);
          const lineNumber: number = bHaveLineSetToProcess ? continuedLineSet.lineStartIdx + 1 : lineNbr;
          const lineToProcess: string = bHaveLineSetToProcess ? continuedLineSet.line : nonCommentLine;
          const bLineReadyToProcess: boolean = bHaveLineSetToProcess || bHaveLineToProcess;
          const nonStringLine: string = this.parseUtils.removeQuotedStrings(lineToProcess);
          const bHaveOrg: boolean = nonStringLine.toUpperCase().includes('ORG');
          // the following 2 was 6 but skipping orgh statements???
          if (bLineReadyToProcess && lineToProcess.length > 2) {
            // ORG, ORGF, ORGH
            this._logPASM(`- pre-scan Ln#${lineNbr} DAT lineToProcess=[${lineToProcess}], nonStringLine=[${nonStringLine}]`);
            if (bHaveOrg) {
              this._logPASM(`- pre-scan Ln#${lineNbr} DAT PAsm line nonStringLine=[${nonStringLine}] now DAT PAsm`);
              // record start of PASM code NOT inline
              this.semanticFindings.recordPasmStart(lineNumber - 1, false); // false = NOT inline
              prePAsmState = currState;
              currState = eParseState.inDatPAsm;
            }
            this._getDAT_Declaration(0, lineNumber, lineToProcess); // SECTION start - get label from line / or ORG in DAT BLOCK
            if (bHaveOrg) {
              continue;
            }
          }
        } else if (currState == eParseState.inObj) {
          // process an "OBJ started" object line (which could be a continued line-set)
          const nonCommentLength: number = bHaveLineSetToProcess ? continuedLineSet.line.length : trimmedNonCommentLine.length;
          const lineToParse: string = bHaveLineSetToProcess ? continuedLineSet.line : nonCommentLine;
          const lineNumber: number = bHaveLineSetToProcess ? continuedLineSet.lineStartIdx + 1 : lineNbr;
          this._logState(`- pre-scan Ln#${lineNumber} OBJ line=[${lineToParse}](${nonCommentLength})`);
          if (nonCommentLength > 3) {
            this._getOBJ_Declaration(3, lineNumber, lineToParse);
          }
        } else if (currState == eParseState.inVar) {
          // process a instance-variable line
          if (isCodePresent) {
            this._getVAR_Declaration(3, lineNbr, nonCommentLine);
          }
        }
        // we processed the block declaration line, now wipe out prior comment
        this.priorSingleLineComment = undefined; // clear it out...
        continue;
      }

      //
      // -------------------------------------------------------------------
      //   Below here we process continued lines and non-section start lines
      // -------------------------------------------------------------------
      //this._logPASM(`- NON SECTION START Pass1 Ln#${lineNbr} trimmedLine=[${trimmedLine}](${trimmedLine.length})`);
      //this._logPASM(`  --   bHaveLineSetToProcess=(${bHaveLineSetToProcess})`);

      if (currState == eParseState.inCon) {
        //const nonCommentLength: number = bHaveLineSetToProcess ? continuedLineSet.line.length : trimmedNonCommentLine.length;
        // process a constant non-continued line
        if (bHaveLineSetToProcess) {
          this._logCON(`- pre-scan CON (cont.) Ln#${lineNbr} trimmedLine=[${continuedLineSet.line}](${continuedLineSet.line.length})`);
          const lineOffset: number = continuedSectionStatus.isSectionStart ? 3 : 0;
          this._getCON_DeclarationMultiLine(lineOffset, continuedLineSet);
        } else if (bHaveLineToProcess) {
          this._logCON(`- pre-scan WOW!!! CON (SGL) Ln#${lineNbr} trimmedLine=[${line}](${line.length})`);
          continuedLineSet.clear();
          continuedLineSet.addLine(nonCommentLine, lineNbr - 1);
          this._getCON_DeclarationMultiLine(0, continuedLineSet);
          continuedLineSet.clear();
        }
      } else if (currState == eParseState.inDat) {
        // process a class(static) variable line - NOT section start
        this._logPASM(`- pre-scan DAT non-SECTION Ln#${lineNbr} trimmedLine=[${trimmedLine}](${trimmedLine.length})`);
        const lineNumber: number = bHaveLineSetToProcess ? continuedLineSet.lineStartIdx + 1 : lineNbr;
        const lineToProcess: string = bHaveLineSetToProcess ? continuedLineSet.line : nonCommentLine;
        const bLineReadyToProcess: boolean = bHaveLineSetToProcess || bHaveLineToProcess;
        const nonStringLine: string = this.parseUtils.removeQuotedStrings(lineToProcess);
        const bHaveOrg: boolean = nonStringLine.toUpperCase().includes('ORG');
        if (bLineReadyToProcess) {
          // ORG, ORGF, ORGH
          this._logPASM(`- pre-scan Ln#${lineNbr} DAT trimmedNonCommentLine=[${continuedLineSet.line}], nonStringLine=[${nonStringLine}]`);
          if (bHaveOrg) {
            this._logPASM(`- pre-scan Ln#${lineNbr} DAT PAsm line trimmedLine=[${trimmedLine}]`);
            // record start of PASM code NOT inline
            this.semanticFindings.recordPasmStart(lineNumber - 1, false); // false = NOT inline
            prePAsmState = currState;
            currState = eParseState.inDatPAsm;
          }
          this._getDAT_Declaration(0, lineNumber, lineToProcess); // get label from line / or ORG in DAT BLOCK
          if (bHaveOrg) {
            continue;
          }
        }
      } else if (currState == eParseState.inVar) {
        // process a variable declaration line
        if (bHaveLineToProcess) {
          this._getVAR_Declaration(0, lineNbr, nonCommentLine);
        }
      } else if (currState == eParseState.inObj) {
        // process an object line (which could be a continued line-set, which does NOT start on an OBJ line)
        const nonCommentLength: number = bHaveLineSetToProcess ? continuedLineSet.line.length : trimmedNonCommentLine.length;
        const lineToParse: string = bHaveLineSetToProcess ? continuedLineSet.line : nonCommentLine;
        const lineNumber: number = bHaveLineSetToProcess ? continuedLineSet.lineStartIdx + 1 : lineNbr;
        this._logState(`- pre-scan Ln#${lineNumber} OBJ line=[${lineToParse}](${nonCommentLength})`);
        if (nonCommentLength > 0) {
          this._getOBJ_Declaration(0, lineNumber, lineToParse);
        }
      } else if (currState == eParseState.inPAsmInline) {
        // process pasm (assembly) lines
        if (bHaveLineToProcess) {
          const linePartsUpCase: string[] = nonStringLineUpCase.split(/[ \t]/).filter(Boolean);
          this._logPASM(
            `- pre-scan Ln#${lineNbr} InLinePasm line lineParts=[${linePartsUpCase}](${linePartsUpCase.length}), nonStringLineUpCase=[${nonStringLineUpCase}]`
          );
          if (linePartsUpCase.length > 0 && (linePartsUpCase[0] == 'END' || linePartsUpCase[0] == 'ENDASM')) {
            // record start of PASM code inline
            this._logPASM(`- pre-scan Ln#${lineNbr} PUB/PRI InLinePasm END trimmedLine=[${trimmedLine}]`);
            this.semanticFindings.recordPasmEnd(i);
            currState = prePAsmState;
            this._logState(`- pre-scan Ln#${lineNbr} POP currState=[${eParseState[currState]}]`);
            // and ignore rest of this line
          } else {
            this._getSPIN_PAsmDeclaration(0, lineNbr, nonCommentLine);
            // pre-scan SPIN-Inline-PAsm line for debug() display declaration
            this._getDebugDisplay_Declaration(0, lineNbr, nonCommentLine);
          }
        }
      } else if (currState == eParseState.inDatPAsm) {
        // process pasm (assembly) lines
        if (bHaveLineToProcess) {
          this._logPASM(`- pre-scan DAT PAsm Ln#${lineNbr} trimmedLine=[${trimmedLine}](${trimmedLine.length})`);
          // the following 2 was 6 but skipping orgh statements???
          if (trimmedNonCommentLine.length > 2 && nonStringLineUpCase.includes('ORG')) {
            // ORG, ORGF, ORGH
            this._logPASM(`- pre-scan Ln#${lineNbr} DATpasm trimmedNonCommentLine=[${trimmedNonCommentLine}], nonStringLine=[${nonStringLine}]`);
            if (nonStringLineUpCase.includes('ORG')) {
              this._logPASM(`- pre-scan Ln#${lineNbr} DATpasm START nonStringLine=[${nonStringLine}]`);
              // record start of PASM code NOT inline
              this.semanticFindings.recordPasmStart(i, false); // false = NOT inline
              this._getDAT_PAsmDeclaration(0, lineNbr, line); // let's get possible label on this ORG statement
              continue;
            }
          }
          this._getDAT_PAsmDeclaration(0, lineNbr, nonCommentLine);
          if (isDebugLine) {
            // pre-scan DAT-PAsm line for debug() display declaration
            this._getDebugDisplay_Declaration(0, lineNbr, nonCommentLine);
          }
        }
      } else if (currState == eParseState.inPub || currState == eParseState.inPri) {
        // NOTE: The directives ORGH, ALIGNW, ALIGNL, and FILE are not allowed within in-line PASM code.
        if (bHaveLineSetToProcess && continuedSectionStatus.isSectionStart) {
          // process PUB/PRI method signature (which is a continued line-set)
          this._getPUB_PRI_Name(3, continuedLineSet.lineStartIdx + 1, continuedLineSet.line);
        } else {
          // NOT a PUB/PRI line...
          // Detect start of INLINE PASM - org detect
          const trimmedLineToParse: string = bHaveLineSetToProcess ? continuedLineSet.line : trimmedNonCommentLine;
          const sectionStart: boolean = bHaveLineSetToProcess ? continuedSectionStatus.isSectionStart : sectionStatus.isSectionStart;
          const lineParts: string[] = bHaveLineSetToProcess
            ? continuedLineSet.line.toUpperCase().split(/[ \t]/).filter(Boolean)
            : nonStringLineUpCase.split(/[ \t]/).filter(Boolean);
          if (lineParts.length > 0 && (lineParts[0] == 'ORG' || lineParts[0] == 'ORGH' || lineParts[0] == 'ASM')) {
            // Only ORG, ORGH, not ORGF
            this._logPASM(`- pre-scan Ln#${lineNbr} PUB/PRI InLinePasm START trimmedLine=[${trimmedLineToParse}]`);
            // record start of PASM code NOT inline
            this.semanticFindings.recordPasmStart(i, true); // true = IS inline
            prePAsmState = currState;
            currState = eParseState.inPAsmInline;
            // and ignore rest of this line
          } else {
            if (isDebugLine) {
              // pre-scan SPIN2 line for debug() display declaration
              // TODO: need to fix this? was non-trimmed line being passed (was line)
              this._getDebugDisplay_Declaration(0, lineNbr, trimmedLineToParse);
            } else {
              // pre-scan SPIN2 line for object constant or method() uses
              //this._getSpin2ObjectConstantMethodDeclaration(0, lineNbr, line);
            }
          }
          if (lineParts.length > 0 && !sectionStart) {
            // handle spin control flow detection
            const charsIndent: number = this.parseUtils.charsInsetCount(line, this.editorConfiguration.tabSize);
            const spanSet: ICurrControlSpan[] = this.spinControlFlowTracker.endControlFlow(lineParts[0], charsIndent, i);
            if (spanSet.length > 0) {
              for (let index = 0; index < spanSet.length; index++) {
                const flowSpan: ICurrControlSpan = spanSet[index];
                this.semanticFindings.recordSpinFlowControlSpan(flowSpan.startLineIdx, flowSpan.endLineIdx);
              }
            }
          }
        }
      }

      // we processed statements in this line, now clear prior comment associated with this line
      this.priorSingleLineComment = undefined; // clear it out...
      continuedLineSet.clear(); // end of processing this multi-line set
      if (pendingState != eParseState.Unknown) {
        this._logState(`- pre-scan Ln#${lineNbr} DELAYED currState [${eParseState[currState]}] -> [${eParseState[pendingState]}]`);
        currState = pendingState;
        // only once...
        pendingState = eParseState.Unknown;
      }
    }

    // mark end of code fold, if we had started one
    const spanSet: ICurrControlSpan[] = this.spinControlFlowTracker.finishControlFlow(lines.length - 1); // pass last line index!
    if (spanSet.length > 0) {
      for (let index = 0; index < spanSet.length; index++) {
        const flowSpan: ICurrControlSpan = spanSet[index];
        this.semanticFindings.recordSpinFlowControlSpan(flowSpan.startLineIdx, flowSpan.endLineIdx);
      }
    }
    this.semanticFindings.endPossibleMethod(lines.length); // report end if last line of file(+1 since method wants line number!)
    this.semanticFindings.finishFinalBlock(lines.length - 1); // mark end of final block in file
    this.semanticFindings.finalize();

    // -------------------------------------------------------------------
    // ----------------------      Actual SCAN      ----------------------
    //
    this._logMessage('--->             <---');
    this._logMessage('---> Actual Highlighting <---');

    this.bRecordTrailingComments = true; // from here forward generate tokens for trailing comments on lines

    //
    // Final PASS to identify all name references
    //
    currState = eParseState.inCon; // reset for 2nd pass - compiler defaults to CON at start
    priorState = currState; // reset for 2nd pass
    prePAsmState = currState; // same

    // for each line do...
    let escapedStringTokenSet: IParsedToken[] = [];
    for (let i = 0; i < lines.length; i++) {
      const lineNbr: number = i + 1;
      const line = lines[i];
      const trimmedLine = line.trim();
      const bHaveEmptyLine: boolean = trimmedLine.length == 0;
      const isDebugLine: boolean = !bHaveEmptyLine ? haveDebugLine(line) : false;

      let nonCommentLine: string;
      if (isDebugLine) {
        nonCommentLine = !bHaveEmptyLine ? this._getDebugNonCommentLine(0, this.parseUtils.getLineWithoutInlineComments(line)) : '';
      } else {
        nonCommentLine = !bHaveEmptyLine
          ? this.parseUtils.getRemainderWOutTrailingComment(0, this.parseUtils.getLineWithoutInlineComments(line))
          : '';
      }
      let bHaveLineToProcess: boolean = nonCommentLine.trim().length > 0;
      //this._logMessage(`  -- colorize Ln#${lineNbr} CHK0 isDbg(${isDebugLine}), nonCommentLine=[${nonCommentLine}](${nonCommentLine.length})`);
      const trailingComment: string = nonCommentLine.substring(nonCommentLine.length).trim();
      let trimmedNonCommentLine: string = bHaveLineToProcess ? nonCommentLine.trimStart() : '';
      //this._logMessage(`  -- colorize Ln#${lineNbr} CHK1 nonCommentLine=[${nonCommentLine}](${nonCommentLine.length})`);
      const sectionStatus = this.extensionUtils.isSectionStartLine(line);
      if (sectionStatus.isSectionStart) {
        trimmedNonCommentLine = trimmedNonCommentLine.substring(3).trimStart();
        this._logMessage(
          `  -- colorize Ln#${lineNbr} sectionStatus=[${eParseState[sectionStatus.inProgressStatus]}] isSectionStart=(${sectionStatus.isSectionStart})`
        );
      }
      let nonStringLine: string = this.parseUtils.removeQuotedStrings(trimmedNonCommentLine);
      let trimmedNonStringLine: string = nonStringLine.trim();
      let nonStringLineUpCase: string = nonStringLine.toUpperCase();
      const isCodePresent: boolean = trimmedNonCommentLine.length > 0;
      let isLineContinued: boolean = isCodePresent ? trimmedNonCommentLine.endsWith('...') : false;
      if (isLineContinued) {
        bHaveLineToProcess = false;
      }
      /*
      this._logMessage(
        `  -- colorize Ln#${lineNbr} CHK3 line2Proc=(${bHaveLineToProcess}), continued=(${isLineContinued}), nonStringLine=[${nonStringLine}](${nonStringLine.length})`
	  );
	  //*/
      const singleLineParts: string[] = trimmedNonCommentLine.split(/[ \t]/).filter(Boolean);

      // if we have new escaped string, highlight the sequences
      const escapedStringOffset: number = nonCommentLine.indexOf('@\\"');
      if (escapedStringOffset != -1) {
        escapedStringTokenSet = this._reportEscapedString(i, escapedStringOffset, nonCommentLine);
      }

      // now start our processing
      if (
        currState != eParseState.inFakeLineContinuation &&
        trimmedNonCommentLine.endsWith('{') &&
        !trimmedNonCommentLine.startsWith('{') &&
        !trimmedNonCommentLine.endsWith('{{') &&
        trimmedNonCommentLine.length > 1
      ) {
        // TODO: the second if clause confuses me... why did I do this?
        // starting fake line continuation
        //  - replace '{' with '...'
        trimmedNonCommentLine = trimmedNonCommentLine.substring(0, trimmedNonCommentLine.length - 1) + ' ...';
        trimmedNonStringLine = trimmedNonStringLine.substring(0, trimmedNonStringLine.length - 1) + ' ...';
        nonStringLine = nonStringLine.substring(0, nonStringLine.length - 1) + ' ...';
        nonStringLineUpCase = nonStringLineUpCase.substring(0, nonStringLineUpCase.length - 1) + ' ...';
        nonCommentLine = nonCommentLine.substring(0, nonCommentLine.length - 1) + ' ...';
        isLineContinued = true;
        bHaveLineToProcess = false;

        // is open of multiline comment
        priorState = currState;
        currState = eParseState.inFakeLineContinuation;
        this._logMessage(
          `* pre-scan Ln#${lineNbr} foundMuli EOL srt-{ starting FakeLineContinuation, nonStringLine=[${nonStringLine}](${nonStringLine.length})`
        );
      } else if (currState == eParseState.inFakeLineContinuation) {
        // continuing fake line continuation
        //  - replace '{' with '...'
        //  - and replace leading '}' with ' '
        const moreContinuation: boolean = trimmedNonCommentLine.startsWith('}');
        if (moreContinuation) {
          trimmedNonCommentLine = trimmedNonCommentLine.replace('}', ' ');
          trimmedNonStringLine = trimmedNonStringLine.replace('}', ' ');
          nonStringLine = nonStringLine.replace('}', ' ');
          nonStringLineUpCase = nonStringLineUpCase.replace('}', ' ');
          nonCommentLine = nonCommentLine.replace('}', ' ');
        }
        const stillContinuation: boolean = trimmedNonCommentLine.endsWith('{');
        if (stillContinuation) {
          trimmedNonCommentLine = trimmedNonCommentLine.substring(0, trimmedNonCommentLine.length - 1) + ' ...';
          trimmedNonStringLine = trimmedNonStringLine.substring(0, trimmedNonStringLine.length - 1) + ' ...';
          nonStringLine = nonStringLine.substring(0, nonStringLine.length - 1) + ' ...';
          nonStringLineUpCase = nonStringLineUpCase.substring(0, nonStringLineUpCase.length - 1) + ' ...';
          nonCommentLine = nonCommentLine.substring(0, nonCommentLine.length - 1) + ' ...';
          isLineContinued = true;
        } else {
          isLineContinued = false;
          this._logMessage(
            `* pre-scan Ln#${lineNbr} foundMuli EOL end-} enidng FakeLineContinuation, nonStringLine=[${nonStringLine}](${nonStringLine.length})`
          );
          currState = priorState;
        }
        bHaveLineToProcess = false;
        /*
		** This is how we handle continuations lines like:
		** --------------------------------------------------------
		Mario0 byte {
		}$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,{
		}$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,{
		}$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
		** --------------------------------------------------------
		**
		** --------------------------------------------------------
		MarioColors long {
		}%00000000_00000000_00000000_00000000,{  $7fff	'any bit 31..24 set means transparent
		}%11111111_11111000_11111000_11111000,{  $7fff
		}%11111111_11111000_11111000_11111000,{  $7fff
		}%11111111_11111000_11111000_11111000,{  $7fff
		}%11111111_11111000_11011000_10011000,{  $7f73
		}%11111111_11010000_00000000_00100000,{  $6804  12->32
		}%11111111_00100000_00100000_00100000  ' $1084  13->33 'address=51
		** --------------------------------------------------------
		**
		*/
      } else if (currState == eParseState.inMultiLineDocComment) {
        // in multi-line doc-comment, hunt for end '} }' to exit
        // ALLOW {cmt}, {{cmt}} on same line without closing!
        const closingOffset: number = nonStringLine.indexOf('}}');
        if (closingOffset != -1) {
          // have close, comment ended
          currState = priorState;
          this._logMessage(
            `* colorize Ln#${lineNbr} foundMuli end-}} exit MultiLineDocComment, nonStringLine=[${nonStringLine}](${nonStringLine.length})`
          );
          // if NO more code on line after close then skip line
          const tempLine: string = trimmedNonCommentLine.substring(closingOffset + 2).trim();
          //if (tempLine.length == 0 || trimmedNonCommentLine === '}}') {
          if (tempLine.length == 0) {
            this._logMessage(`* SKIP MultiLineComment Ln#${i + 1} nonCommentLine=[${nonCommentLine}]`);
            continue;
          }
          //  DO NOTHING Let Syntax highlighting handle rest of non-comment part of line
          this._logMessage(`* Ln#${lineNbr} ass2 foundMuli end-}} exit MultiLineDocComment, tempLine=[${tempLine}](${tempLine.length})`);
        } else {
          //this._logMessage(`* Ln#${lineNbr} SKIP in MultiLineDocComment`);
          continue; // only SKIP if we don't have closing marker
        }
      } else if (currState == eParseState.inMultiLineComment) {
        // in multi-line non-doc-comment, hunt for end '}' to exit
        // ALLOW {cmt}, {{cmt}} on same line without closing!
        let closingOffset: number = nonStringLine.indexOf('}');
        if (closingOffset == -1) {
          // SPECIAL for '} case of closing multi-line comment
          if (/^'\s*}/.test(trimmedLine)) {
            closingOffset = trimmedLine.indexOf('}', trimmedLine.indexOf("'"));
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        //const [closingMultiline, closingOffset] = this.extensionUtils.haveUnmatchedCloseOnLine(nonStringLine, '}');
        if (closingOffset != -1) {
          // have close, comment ended
          currState = priorState;
          this._logMessage(
            `* colorize Ln#${lineNbr} foundMuli end-} exit MultiLineComment, nonStringLine=[${nonStringLine}](${nonStringLine.length})`
          );
          // if NO more code on line after close then skip line
          const tempLine: string = nonCommentLine.substring(closingOffset + 1).trim();
          if (tempLine.length == 0) {
            this._logMessage(`* colorize SKIP MultiLineComment Ln#${i + 1} nonCommentLine=[${nonCommentLine}]`);
            continue;
          }
        } else {
          //this._logMessage(`* Ln#${lineNbr} SKIP in MultiLineDocComment`);
          continue; // only SKIP if we don't have closing marker
        }
        //  DO NOTHING Let Syntax highlighting do this
      } else if (singleLineParts.length > 0 && this.parseUtils.isPNutPreprocessorDirective(singleLineParts[0])) {
        const partialTokenSet: IParsedToken[] = this._reportPNutPreProcessorLine(i, 0, line);
        this._reportNonDupeTokens(partialTokenSet, '=> PreProc: ', line, tokenSet);
        continue; // only SKIP if we have FlexSpin directive
      } else if (singleLineParts.length > 0 && this.parseUtils.isFlexspinPreprocessorDirective(singleLineParts[0])) {
        const partialTokenSet: IParsedToken[] = this._reportFlexspinPreProcessorLine(i, 0, line);
        this._reportNonDupeTokens(partialTokenSet, '=> PreProc: ', line, tokenSet);
        continue; // only SKIP if we have FlexSpin directive
      }

      this._logMessage(`  -- colorize Ln#${lineNbr} proceed with line, nonCommentLine=[${nonCommentLine}](${nonCommentLine.length})`);

      if (sectionStatus.isSectionStart) {
        if (currState == eParseState.inDatPAsm) {
          // BEFORE STATE CHANGE:
          //    end datPasm at next section start
          currState = prePAsmState;
          this._logState(`- colorize Ln#${lineNbr} POP currState=[${currState}]`);
        }
        currState = sectionStatus.inProgressStatus;
        this.conEnumInProgress = false; // tell in CON processor we are not in an enum mulit-line declaration
        this._logState(`  -- Ln#${lineNbr} currState=[${currState}]`);
        // ID the section name
        // DON'T mark the section literal, Syntax highlighting does this well!
      }

      // -------------------------------------------------------------------
      // ----- gather our multi-line set if line is continued
      //         OR in SPIN code
      // -------------------------------------------------------------------
      //
      //this._logMessage(`  -- colorize Ln#${lineNbr} CHK5 currState=[${eParseState[currState]}]`);
      let continuedSectionStatus = {
        isSectionStart: false,
        inProgressStatus: eParseState.Unknown
      };
      if (isLineContinued || (continuedLineSet.isLoading && isCodePresent)) {
        //const lineOffset: number = line.indexOf(trimmedNonCommentLine);
        //this._logMessage(`- colorize Ln#${lineNbr} [${eParseState[currState]}] stuffing ncl=[]${nonCommentLine}](${nonCommentLine.length})`);
        continuedLineSet.addLine(nonCommentLine, i);
        if (!continuedLineSet.hasAllLines) {
          //this._logState(`  -- colorize Ln#${lineNbr} CONT-LINE-BUILDER SKIP [${lineWithLeadingSpaces}]`);
          continue; // need to gather next line too
        }
        // now determine if this continued line set is a section start
        continuedSectionStatus = this.extensionUtils.isSectionStartLine(continuedLineSet.line);
        this.semanticFindings.recordContinuedLineBlock(
          continuedLineSet.lineStartIdx,
          continuedLineSet.lineStartIdx + continuedLineSet.numberLines - 1
        );
      }
      // NOTE: we are only here if continuedLineSet has all lines
      const bHaveLineSetToProcess: boolean = !continuedLineSet.isEmpty;

      if (trimmedLine.startsWith("''")) {
        // process single line doc comment
        //  DO NOTHING Let Syntax highlighting do this
      } else if (trimmedLine.startsWith("'")) {
        // process single line non-doc comment
        //  DO NOTHING Let Syntax highlighting do this
        continue;
      } else if (trimmedNonStringLine.startsWith('{{')) {
        // process multi-line doc comment
        const openingOffset = nonStringLine.indexOf('{{');
        const closingOffset = openingOffset != -1 ? nonStringLine.indexOf('}}', openingOffset + 2) : -1;
        if (closingOffset != -1) {
          // is single line comment, just ignore it Let Syntax highlighting do this
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineDocComment;
          this._logMessage(
            `* Ln#${lineNbr} pass 2 foundMuli srt-{{ starting MultiLineDocComment, nonStringLine=[${nonStringLine}](${nonStringLine.length})`
          );
          //  DO NOTHING Let Syntax highlighting do this
        }
        continue;
      } else if (trimmedNonStringLine.startsWith('{')) {
        // process possible multi-line non-doc comment
        // do we have a close on this same line?
        const openingOffset = nonStringLine.indexOf('{');
        const closingOffset = openingOffset != -1 ? nonStringLine.indexOf('}', openingOffset + 1) : -1;
        if (closingOffset != -1) {
          // is single line comment, just ignore it Let Syntax highlighting do this
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineComment;
          this._logMessage(
            `* colorize Ln#${lineNbr} foundMuli srt-{ starting MultiLineComment, nonStringLine=[${nonStringLine}](${nonStringLine.length})`
          );
          //  DO NOTHING Let Syntax highlighting do this
        }
        continue;
      } else if (nonStringLine.includes('{{')) {
        // process multi-line doc comment
        const openingOffset = nonStringLine.indexOf('{{');
        const closingOffset = openingOffset != -1 ? nonStringLine.indexOf('}}', openingOffset + 2) : -1;
        if (closingOffset != -1) {
          // is single line comment, just ignore it Let Syntax highlighting do this
        } else {
          // is open of multiline comment
          priorState = currState;
          pendingState = eParseState.inMultiLineDocComment;
          this._logMessage(`* Ln#${lineNbr} priorState=[${eParseState[priorState]}] pendingState=[${eParseState[pendingState]}]`);
          this._logMessage(
            `* colorize Ln#${lineNbr} foundMuli mid-{{ starting MultiLineDocComment, nonCommentLine=[${nonCommentLine}](${nonCommentLine.length})`
          );
          if (nonCommentLine.endsWith('{{')) {
            // we have open at end of line, nothing more to do
            continue;
          }
          //  DO NOTHING Let Syntax highlighting do this
        }
        // don't continue there might be some text to process before the {{
      } else if (nonStringLine.includes('{') && !nonStringLine.includes('{{')) {
        // process possible multi-line non-doc comment
        // do we have a close on this same line?
        const openingOffset = nonStringLine.indexOf('{');
        const closingOffset = openingOffset != -1 ? nonStringLine.indexOf('}', openingOffset + 1) : -1;
        if (closingOffset != -1) {
          // is single line comment, just ignore it Let Syntax highlighting do this
        } else {
          // is open of multiline comment
          priorState = currState;
          pendingState = eParseState.inMultiLineComment;
          this._logMessage(`* Ln#${lineNbr} priorState=[${eParseState[priorState]}] pendingState=[${eParseState[pendingState]}]`);
          this._logMessage(`* Ln#${lineNbr} foundMuli mid-{ starting MultiLineComment nonStringLine=[${nonStringLine}](${nonStringLine.length})`);
          //  DO NOTHING Let Syntax highlighting do this
        }
        // don't continue there might be some text to process before the {
      }

      if (sectionStatus.isSectionStart) {
        // ID the remainder of the line - single, non-continued line only
        if (currState == eParseState.inPub || currState == eParseState.inPri) {
          // process possibly Muli-LINE method signature
          let partialTokenSet: IParsedToken[] = [];
          if (trimmedLine.length > 3 && !isLineContinued) {
            this._logSPIN(`- colorize PUB_PRI (SGL-onC PUB_PRIline) Ln#${lineNbr} trimmedLine=[${line}](${line.length})`);
            continuedLineSet.clear();
            continuedLineSet.addLine(nonCommentLine, lineNbr - 1);
            partialTokenSet = this._reportPUB_PRI_SignatureMultiLine(3, continuedLineSet);
            continuedLineSet.clear();
            if (trailingComment.length > 0) {
              this._reportTrailingComment(lineNbr - 1, line, trailingComment, tokenSet);
            }
          }

          this._reportNonDupeTokens(partialTokenSet, '=> PUB/PRI: ', line, tokenSet);
        } else if (currState == eParseState.inCon) {
          // process possibly Muli-LINE constant declarations on the CON line itself!
          let partialTokenSet: IParsedToken[] = [];
          if (trimmedLine.length > 3) {
            this._logCON(`- colorize CON (SGL-onCONline) Ln#${lineNbr} trimmedLine=[${line}](${line.length})`);
            continuedLineSet.clear();
            continuedLineSet.addLine(nonCommentLine, lineNbr - 1);
            partialTokenSet = this._reportCON_DeclarationMultiLine(3, continuedLineSet);
            continuedLineSet.clear();
            if (trailingComment.length > 0) {
              this._reportTrailingComment(lineNbr - 1, line, trailingComment, tokenSet);
            }
          } else {
            this.conEnumInProgress = false; // so we can tell in CON processor when to allow isolated names
          }
          this._reportNonDupeTokens(partialTokenSet, '=> CON: ', line, tokenSet);
        } else if (currState == eParseState.inDat) {
          // process a possible constant use on the DAT line itself!
          const lineNumber: number = bHaveLineSetToProcess ? continuedLineSet.lineStartIdx + 1 : lineNbr;
          const lineToProcess: string = bHaveLineSetToProcess ? continuedLineSet.line : nonCommentLine;
          const bLineReadyToProcess: boolean = bHaveLineSetToProcess || bHaveLineToProcess;
          //const nonStringLine: string = this.parseUtils.removeQuotedStrings(lineToProcess);
          if (bLineReadyToProcess && lineToProcess.length > 3) {
            if (lineToProcess.length > 6) {
              const [orgOffset, orgStr, nonCommentLine] = this.orgOffsetInline(lineToProcess);
              if (orgOffset != -1) {
                // process remainder of ORG line
                const nonCommentOffset = line.indexOf(nonCommentLine, 0);
                // lineNumber, currentOffset, line, allowLocalVarStatus, this.showPAsmCode
                const allowLocalVarStatus: boolean = false;
                const NOT_DAT_PASM: boolean = false;
                this._logDAT(`- colorize DAT SECTION Ln#${lineNumber} nonCommentLine=[${nonCommentLine}](${nonCommentLine.length})`);
                const partialTokenSet: IParsedToken[] = this._reportDAT_ValueDeclarationCode(
                  i,
                  nonCommentOffset + orgOffset + orgStr.length,
                  line,
                  allowLocalVarStatus,
                  this.showDAT,
                  NOT_DAT_PASM
                );
                this._reportNonDupeTokens(partialTokenSet, '=> DAT: ', lineToProcess, tokenSet);

                prePAsmState = currState;
                currState = eParseState.inDatPAsm;
                // and ignore rest of this line
                continue;
              }
            }
            this._logDAT(`- colorize DAT SECTION Ln#${lineNumber} lineToProcess=[${lineToProcess}](${lineToProcess.length})`);
            const partialTokenSet: IParsedToken[] = this._reportDAT_DeclarationLine(lineNumber - 1, 3, lineToProcess);
            this._reportNonDupeTokens(partialTokenSet, '=> DAT: ', line, tokenSet);
          }
        } else if (currState == eParseState.inObj) {
          // process a possible object overrides on the OBJ line itself!
          let partialTokenSet: IParsedToken[] = [];
          if (line.length > 3) {
            this._logCON(`- colorize CON (SGL-onCONline) Ln#${lineNbr} trimmedLine=[${line}](${line.length})`);
            continuedLineSet.clear();
            continuedLineSet.addLine(nonCommentLine, lineNbr - 1);
            partialTokenSet = this._reportOBJ_DeclarationLineMultiLine(3, continuedLineSet);
            continuedLineSet.clear();
            this._reportNonDupeTokens(partialTokenSet, '=> OBJ: ', line, tokenSet);
          }
        } else if (currState == eParseState.inVar) {
          // process a possible constant use on the CON line itself!
          if (line.length > 3) {
            this._logPASM(`- colorize VAR Ln#${lineNbr}  trimmedLine=[${trimmedLine}](${trimmedLine.length})`);
            const partialTokenSet: IParsedToken[] = this._reportVAR_DeclarationLine(i, 3, line);
            this._reportNonDupeTokens(partialTokenSet, '=> VAR: ', line, tokenSet);
          }
        }
        continue;
      }

      // NOT in section start...
      //this._logPASM(`- NON SECTION START Pass2 Ln#${lineNbr} trimmedLine=[${trimmedLine}](${trimmedLine.length})`);

      if (currState == eParseState.inCon) {
        // process a line in a constant section
        let partialTokenSet: IParsedToken[] = [];
        if (bHaveLineSetToProcess) {
          this._logCON(`- colorize CON (cont.) Ln#${lineNbr} trimmedLine=[${continuedLineSet.line}](${continuedLineSet.line.length})`);
          const lineOffset: number = continuedSectionStatus.isSectionStart ? 3 : 0;
          partialTokenSet = this._reportCON_DeclarationMultiLine(lineOffset, continuedLineSet);
        } else if (bHaveLineToProcess) {
          this._logCON(`- colorize CON (SGL) Ln#${lineNbr} trimmedLine=[${line}](${line.length})`);
          continuedLineSet.clear();
          continuedLineSet.addLine(nonCommentLine, lineNbr - 1);
          partialTokenSet = this._reportCON_DeclarationMultiLine(0, continuedLineSet);
          continuedLineSet.clear();
        }
        if (trailingComment.length > 0) {
          this._reportTrailingComment(lineNbr - 1, line, trailingComment, tokenSet);
        }
        this._reportNonDupeTokens(partialTokenSet, '=> CON: ', line, tokenSet);
      } else if (currState == eParseState.inDat) {
        // process a line in a data section (not on DAT line)
        const lineNumber: number = bHaveLineSetToProcess ? continuedLineSet.lineStartIdx + 1 : lineNbr;
        const lineToProcess: string = bHaveLineSetToProcess ? continuedLineSet.line : nonCommentLine;
        const bLineReadyToProcess: boolean = bHaveLineSetToProcess || bHaveLineToProcess;
        //const nonStringLine: string = this.parseUtils.removeQuotedStrings(lineToProcess);
        if (bLineReadyToProcess) {
          this._logPASM(`- colorize DAT Ln#${lineNumber}  lineToProcess=[${lineToProcess}](${lineToProcess.length})`);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const [orgOffset, orgStr, nonCommentLine] = this.orgOffsetInline(lineToProcess);
          // process ORG line allowing label to be present
          const partialTokenSet: IParsedToken[] = this._reportDAT_DeclarationLine(lineNumber - 1, 0, lineToProcess);
          this._reportNonDupeTokens(partialTokenSet, '=> DAT: ', lineToProcess, tokenSet);
          // if ORG present switch to in-line PAsm
          if (orgOffset != -1) {
            prePAsmState = currState;
            currState = eParseState.inDatPAsm;
            // and ignore rest of this line
          }
        }
      } else if (currState == eParseState.inVar) {
        // process a line in a variable data section
        if (bHaveLineToProcess) {
          this._logVAR('- colorize VAR Ln#' + lineNbr + '  trimmedLine=[' + trimmedLine + ']');
          const partialTokenSet: IParsedToken[] = this._reportVAR_DeclarationLine(i, 0, line);
          this._reportNonDupeTokens(partialTokenSet, '=> VAR: ', line, tokenSet);
        }
      } else if (currState == eParseState.inObj) {
        // process a line in an object section
        let partialTokenSet: IParsedToken[] = [];
        if (bHaveLineSetToProcess) {
          // process decl on OBJ line and not on OBJ line
          const lineOffset: number = continuedSectionStatus.isSectionStart ? 3 : 0;
          this._logOBJ(`- colorize OBJ Ln#${continuedLineSet.lineStartIdx + 1} line=[${continuedLineSet.line}](${continuedLineSet.line.length})`);
          partialTokenSet = this._reportOBJ_DeclarationLineMultiLine(lineOffset, continuedLineSet);
        } else if (bHaveLineToProcess) {
          // this is/is NOT on OBJ line
          this._logOBJ(`-  colorize WOW!!! OBJ Ln#${lineNbr} line=[${line}](${line.length})`);
          continuedLineSet.clear();
          continuedLineSet.addLine(nonCommentLine, lineNbr - 1);
          partialTokenSet = this._reportOBJ_DeclarationLineMultiLine(0, continuedLineSet);
          continuedLineSet.clear();
        }
        this._reportNonDupeTokens(partialTokenSet, '=> OBJ: ', line, tokenSet);
      } else if (currState == eParseState.inDatPAsm) {
        // process DAT section pasm (assembly) lines
        if (bHaveLineToProcess) {
          this._logPASM(`- colorize DAT PAsm Ln#${lineNbr} trimmedNonCommentLine=[${trimmedNonCommentLine}](${trimmedNonCommentLine.length})`);
          // in DAT sections we end with next section
          const partialTokenSet: IParsedToken[] = this._reportDAT_PAsmCode(i, 0, line);
          this._reportNonDupeTokens(partialTokenSet, '=> DAT: ', line, tokenSet);
        }
      } else if (currState == eParseState.inPAsmInline) {
        // process pasm (assembly) lines
        if (bHaveLineToProcess) {
          const lineParts: string[] = nonStringLineUpCase.split(/[ \t]/).filter(Boolean);
          this._logPASM(
            `- Ln#${lineNbr} SPIN2 InLinePasm line lineParts=[${lineParts}](${lineParts.length}), trimmedNonCommentLine=[${trimmedNonCommentLine}]`
          );
          if (lineParts.length > 0 && (lineParts[0] == 'ENDASM' || lineParts[0] == 'END')) {
            currState = prePAsmState;
            this._logPASM(`- colorize Ln#${lineNbr} PUB/PRI InLinePasm END trimmedNonCommentLine=[${trimmedNonCommentLine}]`);
            this._logState(`- colorize Ln#${lineNbr} POP currState=[${eParseState[currState]}]`);
            if (lineParts[0] == 'ENDASM' && !this.configuration.highlightFlexspinDirectives) {
              // report this unsupported line (FlexSpin)
              const nameOffset: number = line.indexOf(lineParts[0]);
              this._recordToken(tokenSet, line, {
                line: lineNbr - 1,
                startCharacter: nameOffset,
                length: lineParts[0].length,
                ptTokenType: 'macro',
                ptTokenModifiers: ['directive', 'illegalUse']
              });
              this.semanticFindings.pushDiagnosticMessage(
                lineNbr - 1,
                nameOffset,
                nameOffset + lineParts[0].length,
                eSeverity.Error,
                `P2 Spin - FlexSpin PreProcessor Directive [${lineParts[0]}] not supported!`
              );
            } else if (lineParts[0] == 'END') {
              // color our 'ditto end' token
              const nameOffset: number = line.indexOf(lineParts[0]);
              this._logPASM('  -- rptSPINPAsm() add name=[' + lineParts[1] + ']');
              this._recordToken(tokenSet, line, {
                line: lineNbr - 1,
                startCharacter: nameOffset,
                length: lineParts[0].length,
                ptTokenType: 'directive',
                ptTokenModifiers: []
              });
            }
            // and ignore rest of this line
          } else {
            // process pasm code
            const partialTokenSet: IParsedToken[] = this._reportSPIN_PAsmCode(i, 0, line);
            this._reportNonDupeTokens(partialTokenSet, '=> inlinePASM: ', line, tokenSet);
          }
        }
      } else if (currState == eParseState.inPub || currState == eParseState.inPri) {
        // process a MULTI-LINE signature! if present
        if (bHaveLineSetToProcess && continuedSectionStatus.isSectionStart) {
          // just finished sucking in the multi-line signature, so process it...
          this._logSPIN(`- colorize Ln#${lineNbr} PUB/PRI SPIN MultiLine=[${continuedLineSet.line}]`);
          let partialTokenSet: IParsedToken[] = [];
          partialTokenSet = this._reportPUB_PRI_SignatureMultiLine(3, continuedLineSet);
          this._reportNonDupeTokens(partialTokenSet, '=> PUB/PRI: ', line, tokenSet);
        } else if (bHaveLineSetToProcess) {
          // process MULTI-LINE spin statement NOT PUB/PRI line!
          this._logSPIN(`- Ln#${lineNbr} PUB/PRI SPIN MultiLine=[${continuedLineSet.line}]`);
          const lineParts: string[] = continuedLineSet.line.toUpperCase().split(/[ \t]/).filter(Boolean);
          if (lineParts.length > 0 && (lineParts[0] == 'ORG' || lineParts[0] == 'ORGH' || lineParts[0] == 'ASM')) {
            this._logPASM(`- Ln#${lineNbr} PUB/PRI InLinePasm START MultiLine=[${continuedLineSet.line}]`);
            // Only ORG, ORGH, not ORGF,
            prePAsmState = currState;
            currState = eParseState.inPAsmInline;
            // even tho' we are processsing it as if we know it we still flag it is FrexSpin NOT Enabled
            if (lineParts[0] == 'ASM' && !this.configuration.highlightFlexspinDirectives) {
              // report this unsupported line (FlexSpin)
              const symbolPosition: Position = continuedLineSet.locateSymbol(lineParts[0], 0);
              //const nameOffset = continuedLineSet.offsetIntoLineForPosition(symbolPosition);
              this._recordToken(tokenSet, continuedLineSet.lineAt(symbolPosition.line), {
                line: symbolPosition.line,
                startCharacter: symbolPosition.character,
                length: lineParts[0].length,
                ptTokenType: 'macro',
                ptTokenModifiers: ['directive', 'illegalUse']
              });
              this.semanticFindings.pushDiagnosticMessage(
                symbolPosition.line,
                symbolPosition.character,
                symbolPosition.character + lineParts[0].length,
                eSeverity.Error,
                `P2 Spin - FlexSpin PreProcessor Directive [${lineParts[0]}] not supported!`
              );
            }
            // and ignore rest of this line
          } else if (haveDebugLine(continuedLineSet.line, true)) {
            this._logSPIN(`- colorize Ln#${lineNbr} PUB/PRI SPIN Debug MultiLine=[${continuedLineSet.line}]`);
            const partialTokenSet: IParsedToken[] = this._reportDebugStatementMultiLine(0, continuedLineSet);
            if (escapedStringTokenSet.length > 0) {
              partialTokenSet.push(...escapedStringTokenSet);
              escapedStringTokenSet = []; // should be processed, empty it
            }
            this._reportNonDupeTokens(partialTokenSet, '=> DEBUG: ', line, tokenSet);
          } else {
            this._logSPIN(`- colorize Ln#${lineNbr} PUB/PRI SPIN MultiLine=[${continuedLineSet.line}]`);
            const partialTokenSet: IParsedToken[] = this._reportSPIN_CodeMultiLine(0, continuedLineSet);
            this._reportNonDupeTokens(partialTokenSet, '=> SPIN: ', line, tokenSet);
          }
        } else if (bHaveLineToProcess) {
          // process a method def'n line
          this._logSPIN(`- colorize WOW!!!  Ln#${lineNbr} PUB/PRI SPIN sgl trimmedLine=[${trimmedLine}]`);
          const lineParts: string[] = nonStringLineUpCase.split(/[ \t]/).filter(Boolean);
          if (lineParts.length > 0 && (lineParts[0] == 'ORG' || lineParts[0] == 'ORGH' || lineParts[0] == 'ASM')) {
            // Only ORG, ORGH, not ORGF
            this._logPASM(`- Ln#${lineNbr} PUB/PRI  InLinePasm START line trimmedLine=[${trimmedLine}]`);
            prePAsmState = currState;
            currState = eParseState.inPAsmInline;
            // even tho' we are processsing it as if we know it we still flag it is FrexSpin NOT Enabled
            if (lineParts[0] == 'ASM' && !this.configuration.highlightFlexspinDirectives) {
              // report this unsupported line (FlexSpin)
              const nameOffset: number = line.indexOf(lineParts[0]);
              this._recordToken(tokenSet, line, {
                line: lineNbr - 1,
                startCharacter: nameOffset,
                length: lineParts[0].length,
                ptTokenType: 'macro',
                ptTokenModifiers: ['directive', 'illegalUse']
              });
              this.semanticFindings.pushDiagnosticMessage(
                lineNbr - 1,
                nameOffset,
                nameOffset + lineParts[0].length,
                eSeverity.Error,
                `P2 Spin - FlexSpin PreProcessor Directive [${lineParts[0]}] not supported!`
              );
            }
            // and ignore rest of this line
          } else if (isDebugLine) {
            this._logOBJ(`- colorize DEBUG Ln#${lineNbr} line=[${line}](${line.length})`);
            continuedLineSet.clear();
            continuedLineSet.addLine(nonCommentLine, lineNbr - 1);
            const partialTokenSet: IParsedToken[] = this._reportDebugStatementMultiLine(0, continuedLineSet);
            continuedLineSet.clear();
            if (trailingComment.length > 0) {
              this._reportTrailingComment(lineNbr - 1, line, trailingComment, tokenSet);
            }
            if (escapedStringTokenSet.length > 0) {
              partialTokenSet.push(...escapedStringTokenSet);
              escapedStringTokenSet = []; // should be processed, empty it
            }
            this._reportNonDupeTokens(partialTokenSet, '=> DEBUG: ', line, tokenSet);
          } else {
            this._logSPIN(`- colorize SPIN Ln#${lineNbr} line=[${line}](${line.length})`);
            continuedLineSet.clear();
            continuedLineSet.addLine(nonCommentLine, lineNbr - 1);
            if (continuedLineSet.hasAllLines) {
              const partialTokenSet: IParsedToken[] = this._reportSPIN_CodeMultiLine(0, continuedLineSet);
              continuedLineSet.clear();
              //const partialTokenSet: IParsedToken[] = this._reportSPIN_Code(i, 0, line);
              this._reportNonDupeTokens(partialTokenSet, '=> SPIN: ', line, tokenSet);
            }
            if (trailingComment.length > 0) {
              this._reportTrailingComment(lineNbr - 1, line, trailingComment, tokenSet);
            }
          }
        }
      }
      continuedLineSet.clear(); // end of processing this multi-line set
      if (pendingState != eParseState.Unknown) {
        this._logState(`- colorize Ln#${lineNbr} DELAYED currState [${eParseState[currState]}] -> [${eParseState[pendingState]}]`);
        currState = pendingState;
        // only once...
        pendingState = eParseState.Unknown;
      }
    }
    return tokenSet;
  }

  private orgOffsetInline(line: string): [number, string, string] {
    const nonCommentLineRemainder: string = this.parseUtils.getNonCommentLineRemainder(0, line);
    // let's double check this is NOT in quoted string
    const noStringLine: string = this.parseUtils.removeDoubleQuotedStrings(nonCommentLineRemainder).toUpperCase();
    let orgStr: string = 'ORGH';
    let orgOffset: number = noStringLine.indexOf(orgStr); // ORGH
    if (orgOffset == -1) {
      orgStr = 'ORGF';
      orgOffset = noStringLine.indexOf(orgStr); // ORGF
      if (orgOffset == -1) {
        orgStr = 'ORG';
        orgOffset = noStringLine.indexOf(orgStr); // ORG
      }
    }
    return [orgOffset, orgStr, nonCommentLineRemainder];
  }

  private _generateFakeCommentForSignature(startingOffset: number, lineNbr: number, line: string): RememberedComment {
    let desiredComment: RememberedComment = new RememberedComment(eCommentType.Unknown, -1, '');
    const linePrefix: string = line.substring(0, 3).toLowerCase();
    const isSignature: boolean = linePrefix == 'pub' || linePrefix == 'pri' ? true : false;
    const isPri: boolean = linePrefix == 'pri' ? true : false;
    this._logSPIN(' -- gfcfs linePrefix=[' + linePrefix + '](' + linePrefix.length + ')' + `, isSignature=${isSignature},  isPri=${isPri}`);
    if (isSignature) {
      const cmtType: eCommentType = isPri ? eCommentType.multiLineComment : eCommentType.multiLineDocComment;
      const tmpDesiredComment: RememberedComment = new RememberedComment(
        cmtType,
        lineNbr,
        'NOTE: insert comment template by pressing Ctrl+Alt+C on PRI signature line, then fill it in.'
      );
      const signatureComment: string[] = this._generateDocCommentForSignature(line, this.isSpin1Document);
      if (signatureComment && signatureComment.length > 0) {
        let lineCount: number = 1; // count our comment line on creation
        for (let cmtIdx = 0; cmtIdx < signatureComment.length; cmtIdx++) {
          const currCmtLine: string = signatureComment[cmtIdx];
          if (currCmtLine.includes('@param')) {
            tmpDesiredComment.appendLine(currCmtLine + 'no parameter comment found');
            lineCount++; // count this line, too
          }
        }
        tmpDesiredComment.closeAsSingleLineBlock(lineNbr + lineCount - 1); // FIXME: lineNbr - 1?
        if (lineCount > 1) {
          desiredComment = tmpDesiredComment; // only return this if we have params!
          this._logSPIN('=> SPIN: generated signature comment: sig=[' + line + ']');
        } else {
          this._logSPIN('=> SPIN: SKIPped generation of signature comment: sig=[' + line + ']');
        }
      }
    }
    return desiredComment;
  }

  private _generateDocCommentForSignature(signatureLine: string, isSpin1Method: boolean): string[] {
    const desiredDocComment: string[] = [];
    this._logMessage(`* iDc SKIP - generateDocCommentForSignature([${signatureLine}], isSpin1=${isSpin1Method})`);
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
          this._logMessage(`* gDCparamString=[${paramString}], paramNames=[${paramNames}]`);
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
          this._logMessage(`* gDCreturnsString=[${returnsString}], returnNames=[${returnNames}]`);
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
          this._logMessage(`* gDClocalsString=[${localsString}], localsNames=[${localsNames}]`);
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
          this._logMessage(`* gDCreturnsString=[${returnsString}], returnNames=[${returnNames}]`);
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
          this._logMessage(`* gDClocalsString=[${localsString}], localsNames=[${localsNames}]`);
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

  private _getSpin2_Directive(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE {-* VSCode-Spin2: nextline debug()-display: bitmap  *-}
    // (only this one so far)
    if (line.toLowerCase().indexOf('{-* vscode-spin2:') != -1) {
      this._logMessage('- _getSpin2_Directive: ofs:' + startingOffset + ', [' + line + '](' + line.length + ')');
      // have possible directive
      const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
      // get line parts - we only care about first one
      const lineParts: string[] = line
        .substring(currentOffset)
        .toLowerCase()
        .split(/[ \t,]/)
        .filter((element) => element);
      this._logMessage('  -- lineParts=[' + lineParts + '](' + lineParts.length + ')');
      if (lineParts.length > 4 && lineParts[3] == 'debug()-display:') {
        for (let index = 4; index < lineParts.length - 1; index++) {
          const displayType: string = lineParts[index];
          this._recordDisplayTypeForLine(displayType, lineNbr);
        }
      }
    }
  }

  private _getPNutPreProcessor_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const nonCommentConstantLine = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    if (nonCommentConstantLine.length > 0) {
      // get line parts - we only care about first one
      const lineParts: string[] = nonCommentConstantLine.split(/[ \t=]/).filter(Boolean);
      const directive: string = lineParts[0].toLowerCase();
      const symbolName: string | undefined = lineParts.length > 1 ? lineParts[1] : undefined;
      if (this.parseUtils.isFlexspinPreprocessorDirective(directive)) {
        // check a valid preprocessor line for a declaration
        if (symbolName !== undefined && directive == '#define') {
          this._logPreProc('  -- new PreProc Symbol=[' + symbolName + ']');
          this.semanticFindings.preProcRecordConditionalSymbol(symbolName, line, lineNbr);
          this.semanticFindings.recordDeclarationLine(line, lineNbr);
          this.semanticFindings.setGlobalToken(symbolName, new RememberedToken('variable', lineNbr - 1, 0, ['readonly']), this._declarationComment());
        } else {
          // handle non-define directives
          let directiveType: ePreprocessState = ePreprocessState.PPS_Unknown;
          if (directive === '#ifdef') {
            directiveType = ePreprocessState.PPS_IFDEF;
          } else if (directive === '#ifndef') {
            directiveType = ePreprocessState.PPS_IFNDEF;
          } else if (directive === '#else') {
            directiveType = ePreprocessState.PPS_ELSE;
          } else if (directive === '#elseifdef') {
            directiveType = ePreprocessState.PPS_ELSEIFDEF;
          } else if (directive === '#endif') {
            directiveType = ePreprocessState.PPS_ENDIF;
          }

          const symbolToPass: string = symbolName === undefined ? '' : symbolName;
          if (directiveType != ePreprocessState.PPS_Unknown) {
            this.semanticFindings.preProcRecordConditionChange(directiveType, symbolToPass, line, lineNbr);
          }
        }
      }
    }
  }

  private _getFlexspinPreProcessor_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    if (this.configuration.highlightFlexspinDirectives) {
      const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
      const nonCommentConstantLine = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
      if (nonCommentConstantLine.length > 0) {
        // get line parts - we only care about first one
        const lineParts: string[] = nonCommentConstantLine.split(/[ \t=]/).filter(Boolean);
        this._logPreProc('  - Ln#' + lineNbr + ' GetPreProcDecl lineParts=[' + lineParts + ']');
        const directive: string = lineParts[0].toLowerCase();
        const symbolName: string | undefined = lineParts.length > 1 ? lineParts[1] : undefined;
        if (this.parseUtils.isFlexspinPreprocessorDirective(directive)) {
          // check a valid preprocessor line for a declaration
          if (symbolName !== undefined && directive == '#define') {
            this._logPreProc('  -- new PreProc Symbol=[' + symbolName + ']');
            this.semanticFindings.preProcRecordConditionalSymbol(symbolName, line, lineNbr);
            this.semanticFindings.recordDeclarationLine(line, lineNbr);
            this.semanticFindings.setGlobalToken(
              symbolName,
              new RememberedToken('variable', lineNbr - 1, 0, ['readonly']),
              this._declarationComment()
            );
          } else {
            // handle non-define directives
            let directiveType: ePreprocessState = ePreprocessState.PPS_Unknown;
            if (directive === '#ifdef') {
              directiveType = ePreprocessState.PPS_IFDEF;
            } else if (directive === '#ifndef') {
              directiveType = ePreprocessState.PPS_IFNDEF;
            } else if (directive === '#else') {
              directiveType = ePreprocessState.PPS_ELSE;
            } else if (directive === '#elseifdef') {
              directiveType = ePreprocessState.PPS_ELSEIFDEF;
            } else if (directive === '#endif') {
              directiveType = ePreprocessState.PPS_ENDIF;
            }

            const symbolToPass: string = symbolName === undefined ? '' : symbolName;
            if (directiveType != ePreprocessState.PPS_Unknown) {
              this.semanticFindings.preProcRecordConditionChange(directiveType, symbolToPass, line, lineNbr);
            }
          }
        }
      }
    }
  }

  private _getCON_DeclarationMultiLine(startingOffset: number, multiLineSet: ContinuedLines): void {
    // HAVE    DIGIT_NO_VALUE = -2   ' digit value when NOT [0-9]
    //  -or-   _clkfreq = CLK_FREQ   ' set system clock
    // NEW: multi line enums with no punctuation, ends at blank line (uses this.conEnumInProgress)
    //
    let currSingleLineOffset: number = this.parseUtils.skipWhite(multiLineSet.line, startingOffset);

    this._logCON(
      `  - Ln#${multiLineSet.lineStartIdx + 1} GetCDLMulti() ENTRY startingOffset=(${startingOffset}), line=[${multiLineSet.line}](${
        multiLineSet.line.length
      })`
    );
    if (multiLineSet.line.substring(currSingleLineOffset).length > 1) {
      //skip Past Whitespace
      //let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
      const nonCommentConstantLine = this.parseUtils.getNonCommentLineRemainder(currSingleLineOffset, multiLineSet.line);
      if (nonCommentConstantLine.length == 0) {
        this.conEnumInProgress = false; // if we have a blank line after removing comment then weve ended the enum set
      } else {
        this._logCON(`  -- GetCDLMulti() nonCommentConstantLine=[${nonCommentConstantLine}](${nonCommentConstantLine.length})`);
        const haveEnumDeclaration: boolean = this._isEnumDeclarationMultiLine(multiLineSet.lineStartIdx, 0, nonCommentConstantLine);
        const isAssignment: boolean = nonCommentConstantLine.indexOf('=') != -1;
        //const isStructDecl: boolean = this.parseUtils.requestedSpinVersion(45) && nonCommentConstantLine.toUpperCase().indexOf('STRUCT') != -1;
        if (!haveEnumDeclaration && isAssignment) {
          this.conEnumInProgress = false;
        } else {
          this.conEnumInProgress = this.conEnumInProgress || haveEnumDeclaration;
        }
        this._logCON(`  -- GetCDLMulti() conEnumInProgress=(${this.conEnumInProgress}), haveEnumDeclaration=(${haveEnumDeclaration})`);
        if (!haveEnumDeclaration && !this.conEnumInProgress) {
          const statements: string[] = this.splitLinesWithPossibleStruct(nonCommentConstantLine);
          const containsMultiStatements: boolean = statements.length > 1 ? true : false;
          this._logCON(`  -- GetCDLMulti() multiStatements=(${containsMultiStatements}), statements=[${statements}](${statements.length})`);

          for (let index = 0; index < statements.length; index++) {
            const conDeclarationLine: string = statements[index].trim();
            this._logCON(`  -- GetCDLMulti() conDeclarationLine=[${conDeclarationLine}][${index}]`);
            currSingleLineOffset = multiLineSet.line.indexOf(conDeclarationLine, 0);
            const isAssignment: boolean = conDeclarationLine.indexOf('=') != -1;
            const isStructDecl: boolean = this.parseUtils.requestedSpinVersion(45) && nonCommentConstantLine.toUpperCase().indexOf('STRUCT') != -1;
            if (isAssignment && !isStructDecl) {
              // recognize constant name getting initialized via assignment
              // get line parts - we only care about first one
              const lineParts: string[] = conDeclarationLine.split(/[ \t=]/).filter(Boolean);
              this._logCON(`  -- GetCDLMulti() SPLIT lineParts=[${lineParts}](${lineParts.length})`);
              const newName = lineParts[0];
              if (newName !== undefined && this.parseUtils.isValidSpinSymbolName(newName) && !this.parseUtils.isP1AsmVariable(newName)) {
                // if this line is NOT disabled, record new global (or error with DUPLICATE)
                const lineIsDisabled: boolean = this.semanticFindings.preProcIsLineDisabled(multiLineSet.lineStartIdx);
                this._logCON(`  -- GetCDLMulti() newName=[${newName}], lineIsDisabled=(${lineIsDisabled})`);
                // remember this object name so we can annotate a call to it
                //const nameOffset = line.indexOf(newName, currSingleLineOffset); // FIXME: UNDONE, do we have to dial this in?
                const symbolPosition: Position = multiLineSet.locateSymbol(newName, currSingleLineOffset);
                //const nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
                //const nameOffset: number = multiLineSet.offsetIntoLineForPosition(symbolPosition);
                if (!lineIsDisabled) {
                  // remember this object name so we can annotate a call to it
                  const referenceDetails: RememberedToken | undefined = this.semanticFindings.getGlobalToken(newName);
                  if (referenceDetails !== undefined) {
                    this.semanticFindings.pushDiagnosticMessage(
                      symbolPosition.line,
                      symbolPosition.character,
                      symbolPosition.character + newName.length,
                      eSeverity.Error,
                      `P2 Spin Duplicate constant name [${newName}], already declared`
                    );
                  } else {
                    this.semanticFindings.recordDeclarationLine(multiLineSet.lineAt(symbolPosition.line), symbolPosition.line + 1);
                    this.semanticFindings.setGlobalToken(
                      newName,
                      new RememberedToken('variable', symbolPosition.line, symbolPosition.character, ['readonly']),
                      this._declarationComment()
                    );
                  }
                  this.semanticFindings.recordDeclarationLine(multiLineSet.lineAt(symbolPosition.line), symbolPosition.line);
                  this.semanticFindings.setGlobalToken(
                    newName,
                    new RememberedToken('variable', symbolPosition.line + 1, symbolPosition.character, ['readonly']),
                    this._declarationComment()
                  );
                } else {
                  const token = new RememberedToken('variable', symbolPosition.line, symbolPosition.character, ['readonly']);
                  this._declarationComment();
                  this._logMessage(
                    `* SKIP token setGLobal for disabled ln#(${symbolPosition.line + 1}) token=[${this._rememberdTokenString(newName, token)}]`
                  );
                }
              }
            } else if (isStructDecl) {
              // if v45 or later then we could have a struct declaration
              // recognize structure getting delcared
              //  Ex1: STRUCT point(x,y)
              //    this declares a structure 'point' with 2 members LONG x and LONG y
              //  Ex2: STRUCT line(point a, point b)
              //    this declares a structure 'line' with 2 members POINT a and POINT b, each of which have 2 members LONG x and LONG y
              //
              // structure declaration  structName (member1, member2,...) where
              // //      memberN is optional {type} followed by name with optional [number of instances]
              const structDeclaration = this.parseStructDeclaration(conDeclarationLine);
              if (!structDeclaration.isValidStatus) {
                this._logCON(`  -- GetCDLMulti() ERROR unknown=[${conDeclarationLine}]`);
              } else {
                const structName: string = structDeclaration.structName;
                let symbolPosition: Position = multiLineSet.locateSymbol(structName, currSingleLineOffset);
                //let nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
                this._logCON(`  -- GetCDLMulti() newName=[${structName}], isAssignment=(${isAssignment}), lineIsDisabled=(???)`);
                //this._logCON(`  -- GetCONDecl() structDeclaration=[${JSON.stringify(structDeclaration, null, 2)}]`);
                let structure = new RememberedStructure(structName, symbolPosition.line, symbolPosition.character, structDeclaration.members);
                const newStructName: string = structure.name;
                let isTypeFromChildObject: boolean = false;
                let objectRefName: string = '';
                if (isAssignment && structure.isStructureReference) {
                  // if reference to a structure, then get the structure being referenced to be recorded
                  const refName: string = structure.structureReferenceName;
                  if (refName.includes('.')) {
                    const refStructure = this._getStructureFromObjectReference(refName);
                    if (refStructure !== undefined) {
                      structure = refStructure;
                      structure.setName(newStructName); // set to new instance name
                      isTypeFromChildObject = true;
                      objectRefName = refName;
                    }
                  } else if (this.semanticFindings.isStructure(refName)) {
                    const tmpStructure = this.semanticFindings.getStructure(refName);
                    if (tmpStructure !== undefined) {
                      structure = tmpStructure;
                      structure.setName(newStructName); // set to new instance name
                    }
                  }
                }
                this._logCON(`  -- GetCDLMulti() struct is now [${structure.toString()}]`);
                symbolPosition = multiLineSet.locateSymbol(structName, currSingleLineOffset);
                //nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
                // Handle duplicate structure names
                // remember this object name so we can annotate a call to it
                const referenceDetails: RememberedToken | undefined = this.semanticFindings.getGlobalToken(structName);
                if (referenceDetails !== undefined) {
                  this.semanticFindings.pushDiagnosticMessage(
                    symbolPosition.line,
                    symbolPosition.character,
                    symbolPosition.character + structName.length,
                    eSeverity.Error,
                    `P2 Spin Duplicate structure name [${structName}], already declared`
                  );
                } else {
                  // FIXME: UNDONE, ensure structure containing other structures, has other structures recorded before use!
                  this.semanticFindings.recordStructureDefn(structure);
                  this.semanticFindings.recordDeclarationLine(multiLineSet.lineAt(symbolPosition.line), symbolPosition.line + 1);
                  this.semanticFindings.setGlobalToken(
                    structName,
                    new RememberedToken('variable', symbolPosition.line, symbolPosition.character, ['readonly']),
                    this._declarationComment()
                  );
                  // if we reference a structure from another object, then we need to remember it too
                  if (isTypeFromChildObject) {
                    structure.setName(objectRefName); // set to new instance name
                    this.semanticFindings.recordStructureDefn(structure);
                    this.semanticFindings.setGlobalToken(
                      objectRefName,
                      new RememberedToken('variable', symbolPosition.line, symbolPosition.character, ['readonly']),
                      this._declarationComment()
                    );
                  }
                }
              }
            }
          }
        } else {
          // recognize enum values getting initialized
          // FIXME: broken: how to handle enum declaration statements??
          // this works: #0, HV_1, HV_2, HV_3, HV_4, HV_MAX = HV_4
          // this doesn't: #2[3], TV_1 = 4, TV_2 = 2, TV_3 = 5, TV_4 = 7
          const lineParts: string[] = nonCommentConstantLine.split(/[ \t,]/).filter(Boolean);
          this._logCON(`  -- GetCDLMulti() enumDecl lineParts=[${lineParts}](${lineParts.length})`);
          //this._logCON('  -- lineParts=[' + lineParts + ']');
          let nameOffset: number = 0;
          for (let index = 0; index < lineParts.length; index++) {
            let enumConstant: string = lineParts[index];
            // use parseUtils.isDebugInvocation to filter out use of debug invocation command from constant def'
            if (this.parseUtils.isDebugInvocation(enumConstant)) {
              continue; // yep this is not a constant
            } else if (this.parseUtils.isP1AsmVariable(enumConstant)) {
              this._logCON(`  -- GetCDLMulti() PASM1 skipped=[${enumConstant}]`);
              continue; // yep this is not a constant
            } else {
              // our enum name can have a step offset
              if (enumConstant.includes('[')) {
                // it does, isolate name from offset
                const enumNameParts: string[] = enumConstant.split('[');
                enumConstant = enumNameParts[0];
              }
              if (this.parseUtils.isValidSpinSymbolName(enumConstant)) {
                this._logCON(`  -- C GetCDLMulti() enumConstant=[${enumConstant}]`);
                //const nameOffset = line.indexOf(enumConstant, currSingleLineOffset); // FIXME: UNDONE, do we have to dial this in?
                const symbolPosition: Position = multiLineSet.locateSymbol(enumConstant, currSingleLineOffset);
                nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
                this.semanticFindings.recordDeclarationLine(multiLineSet.lineAt(symbolPosition.line), symbolPosition.line + 1);
                this.semanticFindings.setGlobalToken(
                  enumConstant,
                  new RememberedToken('enumMember', symbolPosition.line, symbolPosition.character, ['readonly']),
                  this._declarationComment()
                );
              }
            }
            currSingleLineOffset = nameOffset + enumConstant.length;
          }
        }
      }
    } else {
      this.conEnumInProgress = false; // if we have a blank line after removing comment then weve ended the enum set
    }
  }

  private splitLinesWithPossibleStruct(line: string): string[] {
    let desiredSepLines: string[] = line.split(',').filter(Boolean);
    // if this version support structures then we need to split out the struct declarations into separate lines
    if (this.parseUtils.requestedSpinVersion(45)) {
      const lineParts: string[] = line.toUpperCase().split(/[ \t]/).filter(Boolean);
      if (lineParts.length > 0 && lineParts.includes('STRUCT')) {
        // have structures in this version
        // break out these declarations as lines not parts of strctures
        // Ex: STRUCT point(x,y), STRUCT line(point a, point b), TYPE = 7
        desiredSepLines = [];
        let currentPart = '';
        let parenthesesCount = 0;

        for (const char of line) {
          if (char === ',' && parenthesesCount === 0) {
            desiredSepLines.push(currentPart.trim());
            currentPart = '';
          } else {
            if (char === '(') parenthesesCount++;
            if (char === ')') parenthesesCount--;
            currentPart += char;
          }
        }

        if (currentPart) {
          desiredSepLines.push(currentPart.trim());
        }
      }
    }
    return desiredSepLines;
  }

  private _getDAT_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE    bGammaEnable        BYTE   TRUE               ' comment
    //         didShow             byte   FALSE[256]
    //                             byte   FALSE[256]
    const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const dataDeclNonCommentStr = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    const lineParts: string[] = this.parseUtils.getNonWhiteNOperatorLineParts(dataDeclNonCommentStr);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const bIsDebugLine: boolean = haveDebugLine(dataDeclNonCommentStr);
    this._logDAT(`  - Ln#${lineNbr} GetDatDecl lineParts=[${lineParts}](${lineParts.length})`);
    const bHaveDatBlockId: boolean = lineParts.length > 0 && lineParts[0].toUpperCase() == 'DAT';
    const minDecodeCount: number = bHaveDatBlockId ? 2 : 1;
    if (lineParts.length >= minDecodeCount) {
      const baseIndex: number = bHaveDatBlockId ? 1 : 0;
      const nameIndex: number = baseIndex + 0;
      const haveLabel: boolean = lineParts.length > nameIndex ? this.parseUtils.isDatOrPAsmLabel(lineParts[nameIndex]) : false;
      const typeIndex: number = haveLabel ? baseIndex + 1 : baseIndex + 0;
      let dataType: string | undefined = lineParts.length > typeIndex ? lineParts[typeIndex] : undefined;
      if (dataType && !this.parseUtils.isDatNFileStorageType(dataType) && !this.isStorageType(dataType)) {
        // file, res, long, byte, word
        dataType = undefined;
      }
      const haveStorageType: boolean = dataType ? this.isStorageType(dataType) : false;
      const isNamedDataDeclarationLine: boolean = haveLabel && haveStorageType ? true : false;
      const isDataDeclarationLine: boolean = haveStorageType ? true : false;

      const lblFlag: string = haveLabel ? 'T' : 'F';
      const dataDeclFlag: string = isDataDeclarationLine ? 'T' : 'F';
      const newName = haveLabel && !lineParts[nameIndex].toLowerCase().startsWith('debug') ? lineParts[nameIndex] : '';

      const dataTypeOffset: number = dataType && haveStorageType ? dataDeclNonCommentStr.indexOf(dataType) : 0;
      const valueDeclNonCommentStr: string =
        dataType && isDataDeclarationLine && dataTypeOffset != -1 ? dataDeclNonCommentStr.substring(dataTypeOffset + dataType.length).trim() : '';
      this._logDAT(`   -- GetDatDecl valueDeclNonCommentStr=[${valueDeclNonCommentStr}](${valueDeclNonCommentStr.length})`);
      const bIsFileLine: boolean = dataType && dataType.toLowerCase() == 'file' ? true : false;
      this._logDAT(`   -- GetDatDecl newName=[${newName}], label=${lblFlag}, daDecl=${dataDeclFlag}, dataType=[${dataType}]`);

      if (
        haveLabel &&
        !this.parseUtils.isP2AsmReservedWord(newName) &&
        !this.parseUtils.isSpinBuiltInVariable(newName) &&
        !this.parseUtils.isSpinReservedWord(newName) &&
        !this.parseUtils.isBuiltinStreamerReservedWord(newName) &&
        // add p1asm detect
        !this.parseUtils.isP1AsmInstruction(newName) &&
        !this.parseUtils.isP1AsmVariable(newName) &&
        !this.parseUtils.isBadP1AsmEffectOrConditional(newName)
      ) {
        const nameType: string = isNamedDataDeclarationLine ? 'variable' : 'label';
        let labelModifiers: string[] = ['declaration'];
        if (!isNamedDataDeclarationLine) {
          // have label...
          /*
          if (newName.startsWith(':')) {
            const offset: number = line.indexOf(newName, startingOffset);
            labelModifiers = ['illegalUse', 'declaration', 'static'];
            this.semanticFindings.pushDiagnosticMessage(
              lineNbr - 1,
              offset,
              offset + newName.length,
              eSeverity.Error,
              `P1 pasm local name [${newName}] not supported in P2 pasm`
            );
          }*/
          // .name and :name are now both static labels
          if (newName.startsWith('.') || newName.startsWith(':')) {
            labelModifiers = ['declaration', 'static'];
          }
        }
        this._logDAT('   -- GetDatDecl GLBL-newName=[' + newName + '](' + nameType + ')');
        const fileName: string | undefined = bIsFileLine && lineParts.length > 2 ? lineParts[2] : undefined;
        this._ensureDataFileExists(fileName, lineNbr - 1, line, startingOffset);
        this._logDAT('   -- GetDatDecl fileName=[' + fileName + ']');
        const nameOffset = line.indexOf(newName, currentOffset); // FIXME: UNDONE, do we have to dial this in?
        // LABEL-TODO add record of global, start or local extra line number
        let declType: eDefinitionType = eDefinitionType.NonLabel;
        if (!isNamedDataDeclarationLine) {
          // we have a label which type is it?
          declType = newName.startsWith('.') ? eDefinitionType.LocalLabel : eDefinitionType.GlobalLabel;
        }
        this.semanticFindings.recordDeclarationLine(line, lineNbr, declType);
        this.semanticFindings.setGlobalToken(
          newName,
          new RememberedToken(nameType, lineNbr - 1, nameOffset, labelModifiers),
          this._declarationComment(),
          fileName
        );
      }
    }
  }

  private _getDAT_PAsmDeclaration(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE    bGammaEnable        BYTE   TRUE               ' comment
    //         didShow             byte   FALSE[256]
    const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const datPAsmRHSStr = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    if (datPAsmRHSStr.length > 0) {
      const lineParts: string[] = this.parseUtils.getNonWhiteLineParts(datPAsmRHSStr);
      this._logPASM(`  - Ln#${lineNbr} GetDATPAsmDecl lineParts=[${lineParts}](${lineParts.length})`);
      // handle name in 1 column
      const haveLabel: boolean = this.parseUtils.isDatOrPAsmLabel(lineParts[0]);
      const bIsFileLine: boolean = haveLabel && lineParts.length > 1 && lineParts[1].toLowerCase() == 'file';
      const isDataDeclarationLine: boolean = lineParts.length > 1 && haveLabel && this.parseUtils.isDatStorageType(lineParts[1]) ? true : false;
      if (haveLabel) {
        const labelName: string = lineParts[0];
        if (
          !this.parseUtils.isP2AsmReservedSymbols(labelName) &&
          !this.parseUtils.isP2AsmInstruction(labelName) &&
          !labelName.toUpperCase().startsWith('IF_') &&
          !labelName.toUpperCase().startsWith('_RET_')
        ) {
          // org in first column is not label name, nor is if_ conditional
          const labelType: string = isDataDeclarationLine ? 'variable' : 'label';
          let labelModifiers: string[] = ['declaration'];
          if (!isDataDeclarationLine && (labelName.startsWith('.') || labelName.startsWith(':'))) {
            labelModifiers = ['declaration', 'static'];
          }
          if (labelName.toUpperCase() == 'DITTO') {
            this._logPASM(`  -- gDatMAsm() Ignoring reserved word [${labelName}(${labelType})]`);
          } else {
            this._logPASM(`  -- gDatMAsm() GLBL labelName=[${labelName}(${labelType})]`);
            const fileName: string | undefined = bIsFileLine && lineParts.length > 2 ? lineParts[2] : undefined;
            if (fileName) {
              this._logDAT(`   -- gDatMAsm() GLBL fileName=[${fileName}]`);
              this._ensureDataFileExists(fileName, lineNbr - 1, line, startingOffset);
            }
            const nameOffset = line.indexOf(labelName, 0); // FIXME: UNDONE, do we have to dial this in?
            // LABEL-TODO add record of global, start or local extra line number
            let declType: eDefinitionType = eDefinitionType.NonLabel;
            if (!isDataDeclarationLine) {
              // we have a label which type is it?
              declType = labelName.startsWith('.') ? eDefinitionType.LocalLabel : eDefinitionType.GlobalLabel;
            }
            this.semanticFindings.recordDeclarationLine(line, lineNbr, declType);
            this.semanticFindings.setGlobalToken(
              labelName,
              new RememberedToken(labelType, lineNbr - 1, nameOffset, labelModifiers),
              this._declarationComment(),
              fileName
            );
          }
        }
      }
    }
  }

  private _ensureDataFileExists(fileName: string | undefined, lineIdx: number, line: string, startingOffset: number) {
    if (fileName) {
      const filenameNoQuotes: string = fileName.replace(/"/g, '');
      const searchFilename: string = `"${filenameNoQuotes}`;
      const nameOffset: number = line.indexOf(searchFilename, startingOffset);
      const hasPathSep: boolean = filenameNoQuotes.includes('/');
      this._logMessage(`  -- looking for DataFile [${this.directory}/${filenameNoQuotes}]`);
      const logCtx: Context | undefined = this.isDebugLogEnabled ? this.ctx : undefined;
      if (hasPathSep) {
        this.semanticFindings.pushDiagnosticMessage(
          lineIdx,
          nameOffset,
          nameOffset + filenameNoQuotes.length,
          eSeverity.Error,
          `P2 spin Invalid filename character "/" in [${filenameNoQuotes}]`
        );
      } else if (!fileInDirExists(this.directory, filenameNoQuotes, logCtx)) {
        this.semanticFindings.pushDiagnosticMessage(
          lineIdx,
          nameOffset,
          nameOffset + fileName.length,
          eSeverity.Error,
          `Missing P2 Data file [${fileName}]`
        );
      }
    }
  }

  private _ensureObjectFileExists(fileName: string | undefined, lineIdx: number, line: string, startingOffset: number) {
    if (fileName) {
      const filenameNoQuotes: string = fileName.replace(/"/g, '');
      const hasSuffix: boolean = filenameNoQuotes.endsWith('.spin2');
      const hasPathSep: boolean = filenameNoQuotes.includes('/');
      const fileWithExt = `${filenameNoQuotes}.spin2`;
      const nameOffset: number = line.indexOf(filenameNoQuotes, startingOffset);
      const logCtx: Context | undefined = this.isDebugLogEnabled ? this.ctx : undefined;
      const checkFilename: string = hasSuffix ? filenameNoQuotes : fileWithExt;
      if (hasPathSep) {
        this.semanticFindings.pushDiagnosticMessage(
          lineIdx,
          nameOffset,
          nameOffset + filenameNoQuotes.length,
          eSeverity.Error,
          `P2 spin Invalid filename character "/" in [${filenameNoQuotes}]`
        );
      } else if (!fileInDirExists(this.directory, checkFilename, logCtx)) {
        const displayName: string = hasSuffix ? filenameNoQuotes : `${filenameNoQuotes}.spin2`;
        this.semanticFindings.pushDiagnosticMessage(
          lineIdx,
          nameOffset,
          nameOffset + filenameNoQuotes.length,
          eSeverity.Error,
          `Missing P2 Object file [${displayName}]`
        );
      }
    }
  }

  private _getOBJ_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    //
    // Record Object Instance declarations
    //
    // parse P2 spin!
    // HAVE    color           : "isp_hub75_color"
    //  -or-   segments[7]     : "isp_hub75_segment"
    //  -or-   segments[7]     : "isp_hub75_segment" | BUFF_SIZE = 2
    //
    //skip Past Whitespace
    const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    //const remainingOffset: number = line.indexOf(remainingNonCommentLineStr, startingOffset);
    this._logOBJ(`- Ln#${lineNbr} GetOBJDecl remainingNonCommentLineStr=[${remainingNonCommentLineStr}]`);
    let badObjectLine: boolean = false;
    if (remainingNonCommentLineStr.length >= 5) {
      // c:"x" is minimm object decl len=5!
      if (remainingNonCommentLineStr.includes(':') && remainingNonCommentLineStr.includes('"') && !remainingNonCommentLineStr.endsWith(':')) {
        // get line parts - we only care about first one
        const overrideParts: string[] = remainingNonCommentLineStr.split('|').filter(Boolean);
        const lineParts: string[] = overrideParts[0].split(':').filter(Boolean);
        this._logOBJ(`  -- GLBL GetOBJDecl lineParts=[${lineParts}]${lineParts.length}`);
        if (lineParts.length < 2) {
          badObjectLine = true;
        } else {
          let instanceNamePart = lineParts[0].trim();
          // if we have instance array declaration, then remove it
          if (instanceNamePart.includes('[')) {
            const nameParts = instanceNamePart.split(/[[\]]/).filter(Boolean);
            instanceNamePart = nameParts[0];
          }
          this._logOBJ(`  -- GLBL GetOBJDecl newInstanceName=[${instanceNamePart}]`);
          // remember this object name so we can annotate a call to it
          const filenamePart = lineParts.length > 1 ? lineParts[1].trim().replace(/["]/g, '') : '--error-no-name-parsed--';
          this._logOBJ(`  -- GLBL GetOBJDecl newFileName=[${filenamePart}]`);
          this.semanticFindings.recordDeclarationLine(line, lineNbr);
          const nameOffset = line.indexOf(instanceNamePart, currentOffset); // FIXME: UNDONE, do we have to dial this in?
          this.semanticFindings.setGlobalToken(
            instanceNamePart,
            new RememberedToken('namespace', lineNbr - 1, nameOffset, []),
            this._declarationComment(),
            filenamePart
          ); // pass filename, too
          this.semanticFindings.recordObjectImport(instanceNamePart, filenamePart);
          this._ensureObjectFileExists(filenamePart, lineNbr - 1, line, startingOffset);
        }
      } else {
        badObjectLine = true;
      }
    } else if (remainingNonCommentLineStr.length > 0) {
      badObjectLine = true;
    }
    if (badObjectLine) {
      this.semanticFindings.pushDiagnosticMessage(
        lineNbr - 1,
        currentOffset,
        currentOffset + remainingNonCommentLineStr.length,
        eSeverity.Error,
        `Illegal P2 Syntax: Unable to parse object declaration [${remainingNonCommentLineStr}]`
      );
    }
  }

  private _getPUB_PRI_Name(startingOffset: number, lineNbr: number, line: string): void {
    const methodType = line.substr(0, 3).toUpperCase();
    // reset our list of local variables
    const isPrivate: boolean = methodType.indexOf('PRI') != -1;
    //const matchIdx: number = methodType.indexOf("PRI");
    //this._logSPIN("  - Ln#" + lineNbr + " GetMethodDecl methodType=[" + methodType + "], isPrivate(" + isPrivate + ")");

    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this.parseUtils.getNonCommentLineRemainder(0, line);
    const startNameOffset = currentOffset;
    // find open paren
    // find open paren
    currentOffset = remainingNonCommentLineStr.indexOf('(', startNameOffset); // in spin1 ()'s are optional!
    if (currentOffset == -1) {
      currentOffset = remainingNonCommentLineStr.indexOf(':', startNameOffset);
      if (currentOffset == -1) {
        currentOffset = remainingNonCommentLineStr.indexOf('|', startNameOffset);
        if (currentOffset == -1) {
          currentOffset = remainingNonCommentLineStr.indexOf(' ', startNameOffset);
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

    const nameLength = currentOffset - startNameOffset;
    const methodName = line.substr(startNameOffset, nameLength).trim();
    const nameType: string = isPrivate ? 'private' : 'public';
    this._logSPIN('- Ln#' + lineNbr + ' _gPUB_PRI_Name() newName=[' + methodName + '](' + nameType + ')');
    this.currentMethodName = methodName; // notify of latest method name so we can track inLine PASM symbols
    // mark start of method - we are learning span of lines this method covers
    let methodExists: boolean = false;
    const referenceDetails: RememberedToken | undefined = this.semanticFindings.getGlobalToken(methodName);
    if (referenceDetails && referenceDetails.type === 'method') {
      methodExists = true;
      this._logSPIN(`  -- _gPUB_PRI_Name() ERROR: have duplicate method [${methodName}]`);
    }
    if (!methodExists) {
      this.semanticFindings.startMethod(methodName, lineNbr);

      // remember this method name so we can annotate a call to it
      const refModifiers: string[] = isPrivate ? ['static'] : [];
      // record ACTUAL object public/private interface
      const nameOffset = line.indexOf(methodName, currentOffset); // FIXME: UNDONE, do we have to dial this in?
      this.semanticFindings.recordDeclarationLine(line, lineNbr);
      this.semanticFindings.setGlobalToken(
        methodName,
        new RememberedToken('method', lineNbr - 1, nameOffset, refModifiers),
        this._declarationComment()
      );
      // reset our list of local variables
      this.semanticFindings.clearLocalPAsmTokensForMethod(methodName);
    } else {
      const methodPrefix: string = referenceDetails?.modifiers.includes('static') ? 'PRI' : 'PUB';
      //const declarationLineIdx;number = referenceDetails.
      this.semanticFindings.pushDiagnosticMessage(
        lineNbr - 1,
        startNameOffset,
        startNameOffset + methodName.length,
        eSeverity.Error,
        `P2 Spin Duplicate method Declaration: found earlier [${methodPrefix} ${methodName}()]`
      );
    }
    this._logSPIN('  -- _gPUB_PRI_Name() exit');
  }

  private _getSPIN_PAsmDeclaration(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE    next8SLine ' or .nextLine in col 0
    //         nPhysLineIdx        long    0
    const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    this._logPASM(
      `- Ln#${lineNbr} gSpinInLinePAsmDecl startingOffset=(${startingOffset}), currentOffset=(${currentOffset}), line=[${line}](${line.length})`
    );
    // get line parts - we only care about first one
    const inLinePAsmRHSStr = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    if (inLinePAsmRHSStr.length > 0) {
      const lineParts: string[] = this.parseUtils.getNonWhiteLineParts(inLinePAsmRHSStr);
      this._logPASM(`  -- gSpinInLinePAsmDecl lineParts=[${lineParts}](${lineParts.length})`);
      // handle name in 1 column
      const haveLabel: boolean = this.parseUtils.isDatOrPAsmLabel(lineParts[0]);
      const isDebug: boolean = lineParts[0].toLowerCase().startsWith('debug');
      const isDataDeclarationLine: boolean = lineParts.length > 1 && haveLabel && this.parseUtils.isDatStorageType(lineParts[1]) ? true : false;
      if (haveLabel && !isDebug) {
        const labelName: string = lineParts[0];
        const labelType: string = isDataDeclarationLine ? 'variable' : 'label';
        let labelModifiers: string[] = [];
        if (!isDataDeclarationLine) {
          labelModifiers = labelName.startsWith('.') || labelName.startsWith(':') ? ['pasmInline', 'static'] : ['pasmInline'];
        } else {
          labelModifiers = ['pasmInline'];
        }
        this._logPASM('  -- rptSPINPAsm() labelName=[' + labelName + '(' + labelType + ')[' + labelModifiers + ']]');
        const nameOffset = line.indexOf(this.currentMethodName, currentOffset); // FIXME: UNDONE, do we have to dial this in?
        // LABEL-TODO add record of global, start or local extra line number
        let declType: eDefinitionType = eDefinitionType.NonLabel;
        if (!isDataDeclarationLine) {
          // we have a label which type is it?
          declType = labelName.startsWith('.') ? eDefinitionType.LocalLabel : eDefinitionType.GlobalLabel;
        }
        if (!this.semanticFindings.hasLocalPAsmTokenForMethod(this.currentMethodName, labelName)) {
          this._logPASM(`  -- rptSPINPAsm() NEW pasm token=[${labelName}], within method=[${this.currentMethodName}]]`);
          this.semanticFindings.recordDeclarationLine(line, lineNbr, declType);
          this.semanticFindings.setLocalPAsmTokenForMethod(
            this.currentMethodName,
            labelName,
            new RememberedToken(labelType, lineNbr - 1, nameOffset, labelModifiers),
            this._declarationComment()
          );
        } else {
          // report duplicate symbol
          this._logPASM(`  -- rptSPINPAsm() ERROR pasm token=[${labelName}], within method=[${this.currentMethodName}]] already exists!`);
          const nameOffset = line.indexOf(labelName, currentOffset); // FIXME: UNDONE, do we have to dial this in?
          this.semanticFindings.pushDiagnosticMessage(
            lineNbr - 1,
            nameOffset,
            nameOffset + labelName.length,
            eSeverity.Error,
            `P2 Spin Duplicate symbol Declaration: found earlier [${this.currentMethodName} ${labelName}()]`
          );
        }
      }
    }
  }

  private _getVAR_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    //
    // Record Instance Variable declarations
    //
    // VAR Variable declaration
    //    {{^}BYTE|{^}WORD|{^}LONG|{^}StructName} VarName{[ArraySize]} {, VarName{[ArraySize]} {, ...}
    //
    //    BYTE a,b,c, WORD d, LONG e 'Multiple types can be declared on the same line.
    //
    //    ALIGNW|ALIGNL 'word|long-align to hub memory, advances variable pointer as necessary
    //
    // skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this.parseUtils.getNonCommentLineRemainder(currentOffset, line).trim();
    if (remainingNonCommentLineStr.length > 0) {
      this._logVAR(`- Ln#${lineNbr} GetVarDecl remainingNonCommentLineStr=[${remainingNonCommentLineStr}](${remainingNonCommentLineStr.length})`);
      const isMultiDeclaration: boolean = remainingNonCommentLineStr.includes(',');
      let declStatements: string[] = [remainingNonCommentLineStr];
      if (isMultiDeclaration) {
        // we have multiple declarations split into separate lines
        // Ex: VAR a, b, c, d, e
        declStatements = remainingNonCommentLineStr.split(/\s*,\s*/).filter(Boolean);
      }
      this._logSPIN(`  -- GetVarDecl declStatements=[${declStatements}](${declStatements.length})`);
      for (let index = 0; index < declStatements.length; index++) {
        // Ea. Statement: {{^}BYTE|{^}WORD|{^}LONG|{^}StructName} VarName{[ArraySize]}
        // Ea. Statement: -or- ALIGNW|ALIGNL
        const varDeclStatement: string = declStatements[index];
        currentOffset = line.indexOf(varDeclStatement, currentOffset);
        this._logSPIN(`  -- GetVarDecl declaration=[${varDeclStatement}](${varDeclStatement.length}), ofs=(${currentOffset})`);
        let typeName: string = '';
        let varName: string = varDeclStatement;
        let indexStatement: string = '';
        let isPtr: boolean = false;
        if (varName.includes('[')) {
          const varParts: string[] = varDeclStatement.split(/[[\]]/).filter(Boolean);
          if (varParts.length > 1) {
            varName = varParts[0];
            indexStatement = varParts[1];
          }
        }
        if (varName.includes(' ')) {
          const varParts: string[] = varDeclStatement.split(/\s+/).filter(Boolean);
          this._logVAR(`  -- GetVarDecl varParts=[${varParts}](${varParts.length})`);
          if (varParts.length > 1) {
            typeName = varParts[0];
            varName = varParts[1];
            isPtr = typeName.charAt(0) === '^'; // remember we have pointer
            typeName = isPtr ? typeName.substring(1) : typeName; // remove ptr indicator
          }
          this._logVAR(
            `  -- GetVarDecl isPtr=(${isPtr}) type=[${varParts}](${varParts.length}), name=[${varName}](${varName.length}), index=[${indexStatement}](${indexStatement.length})`
          );
        }
        if ((typeName.length == 0 && varName.toLowerCase() == 'alignl') || varName.toLowerCase() == 'alignw') {
          typeName = varName;
          varName = '';
        }
        // if name is array we only report name part
        if (varName.length > 0 && varName.includes('[')) {
          const tempParts: string[] = varName.split(/[[\]]/).filter(Boolean);
          this._logVAR(`  -- GetVarDecl adjust VarName:[${varName}] -> [${tempParts[0]}]`);
          varName = tempParts[0];
        }
        this._logVAR(`  -- GetVarDecl processing type=[${typeName}](${typeName.length}), isPtr=(${isPtr}) name=[${varName}](${varName.length})`);

        // if type, flag if not B/W/L align type or structure type
        if (typeName.length > 0) {
          if (!this.isStorageType(typeName) && !this.parseUtils.isAlignType(typeName)) {
            const nameOffset = line.indexOf(typeName, currentOffset); // FIXME: UNDONE, do we have to dial this in?
            this.semanticFindings.pushDiagnosticMessage(
              lineNbr - 1,
              nameOffset,
              nameOffset + typeName.length,
              eSeverity.Error,
              `P2 Spin BAD Storage/Align Type [${typeName}]`
            );
          }
        }
        const isStructureType: boolean = typeName.length > 0 ? this.semanticFindings.isStructure(typeName) : false;
        if (this.parseUtils.isValidSpinSymbolName(varName)) {
          this._logVAR(`  -- GetVarDecl  newName=[${varName}]`);
          const nameOffset = line.indexOf(varName, currentOffset); // FIXME: UNDONE, do we have to dial this in?
          // ensure we are not already defined
          const referenceDetails: RememberedToken | undefined = this.semanticFindings.getGlobalToken(varName);
          if (referenceDetails !== undefined) {
            this.semanticFindings.pushDiagnosticMessage(
              lineNbr - 1,
              nameOffset,
              nameOffset + varName.length,
              eSeverity.Error,
              `P2 Spin Duplicate name [${varName}], global variable/constant already exists`
            );
          } else {
            // no, then record new variable name
            this.semanticFindings.recordDeclarationLine(line, lineNbr);
            this.semanticFindings.setGlobalToken(
              varName,
              new RememberedToken('variable', lineNbr - 1, nameOffset, ['instance']),
              this._declarationComment()
            );
            if (isStructureType) {
              // if is structure, then record instance of structure
              this.semanticFindings.recordStructureInstance(typeName, varName); // VAR
            }
          }
        }
      }
    }
  }

  private _getDebugDisplay_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // locate and collect debug() display user names and types
    //
    // HAVE    debug(`{displayType} {displayName} ......)            ' comment
    const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const debugStatementStr = line.substring(currentOffset).trim();
    if (debugStatementStr.length > 0 && debugStatementStr.toLowerCase().includes('debug')) {
      this._logDEBUG(`  -- gddd debugStatementStr=[${debugStatementStr}]`);
      const openParenOffset: number = debugStatementStr.indexOf('(');
      if (openParenOffset != -1) {
        const lineParts: string[] = this.parseUtils.getDebugNonWhiteLineParts(debugStatementStr);
        this._logDEBUG(`  -- gddd lineParts=[${lineParts}](${lineParts.length})`);
        let haveBitfieldIndex: boolean = false;
        // see if we have bitnumber index field
        haveBitfieldIndex = debugStatementStr.substring(0, openParenOffset + 1).includes('[');
        if (haveBitfieldIndex) {
          // let's just skip past the index for this routine
          lineParts.splice(1, 1); // Removes the element at index 1
          this._logDEBUG(` -- gddd removed bitfield lineParts=[${lineParts}](${lineParts.length})`);
        }
        if (lineParts.length >= 3) {
          const displayType: string = lineParts[1];
          if (displayType.startsWith('`')) {
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

  private _reportPNutPreProcessorLine(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];

    const lineNbr: number = lineIdx + 1;
    // skip Past Whitespace
    const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const nonCommentConstantLine = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    if (nonCommentConstantLine.length > 0) {
      // get line parts - we only care about first one
      const lineParts: string[] = nonCommentConstantLine.split(/[ \t=]/).filter(Boolean);
      this._logPreProc(`  - Ln#${lineNbr} pnut reportPreProc lineParts=[${lineParts}]`);
      const directive: string = lineParts[0];
      const symbolName: string | undefined = lineParts.length > 1 ? lineParts[1] : undefined;

      if (this.parseUtils.isPNutPreprocessorDirective(directive)) {
        // record the directive
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: 0,
          length: directive.length,
          ptTokenType: 'keyword',
          ptTokenModifiers: ['control', 'directive']
        });
        const lineHasSymbol: boolean =
          directive.toLowerCase() == '#define' ||
          directive.toLowerCase() == '#ifdef' ||
          directive.toLowerCase() == '#undef' ||
          directive.toLowerCase() == '#ifndef' ||
          directive.toLowerCase() == '#elseifdef' ||
          directive.toLowerCase() == '#elseifndef';
        if (lineHasSymbol && symbolName !== undefined) {
          const nameOffset = line.indexOf(symbolName, currentOffset);
          this._logPreProc(`  -- GLBL symbolName=[${symbolName}]`);
          let referenceDetails: RememberedToken | undefined = undefined;
          if (this.semanticFindings.isGlobalToken(symbolName)) {
            referenceDetails = this.semanticFindings.getGlobalToken(symbolName);
            this._logPreProc('  --  FOUND preProc global ' + this._rememberdTokenString(symbolName, referenceDetails));
          }
          if (referenceDetails !== undefined) {
            // record a constant declaration!
            const updatedModificationSet: string[] =
              directive.toLowerCase() == '#define' ? referenceDetails.modifiersWith('declaration') : referenceDetails.modifiers;
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: symbolName.length,
              ptTokenType: referenceDetails.type,
              ptTokenModifiers: updatedModificationSet
            });
          } else if (this.semanticFindings.isPreProcSymbolDefined(symbolName)) {
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: symbolName.length,
              ptTokenType: 'variable',
              ptTokenModifiers: ['readonly']
            });
          } else {
            // record an unknown name
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: symbolName.length,
              ptTokenType: 'variable', //'comment',
              ptTokenModifiers: ['disabled'] // ['line']
            });
          }
        }
      }
    }

    return tokenSet;
  }

  private _reportFlexspinPreProcessorLine(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];

    const lineNbr: number = lineIdx + 1;
    // skip Past Whitespace
    const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const nonCommentConstantLine = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    if (nonCommentConstantLine.length > 0) {
      // get line parts - we only care about first one
      const lineParts: string[] = nonCommentConstantLine.split(/[ \t=]/).filter(Boolean);
      this._logPreProc(`  - Ln#${lineNbr} flexspin reportPreProc lineParts=[${lineParts}]`);
      const directive: string = lineParts[0];
      const symbolName: string | undefined = lineParts.length > 1 ? lineParts[1] : undefined;

      if (this.configuration.highlightFlexspinDirectives) {
        if (this.parseUtils.isFlexspinPreprocessorDirective(directive)) {
          // record the directive
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: 0,
            length: directive.length,
            ptTokenType: 'keyword',
            ptTokenModifiers: ['control', 'directive']
          });
          const lineHasSymbol: boolean =
            directive.toLowerCase() == '#define' ||
            directive.toLowerCase() == '#ifdef' ||
            directive.toLowerCase() == '#undef' ||
            directive.toLowerCase() == '#ifndef' ||
            directive.toLowerCase() == '#elseifdef' ||
            directive.toLowerCase() == '#elseifndef';
          if (lineHasSymbol && symbolName !== undefined) {
            const nameOffset = line.indexOf(symbolName, currentOffset);
            this._logPreProc(`  -- GLBL symbolName=[${symbolName}]`);
            let referenceDetails: RememberedToken | undefined = undefined;
            if (this.semanticFindings.isGlobalToken(symbolName)) {
              referenceDetails = this.semanticFindings.getGlobalToken(symbolName);
              this._logPreProc('  --  FOUND preProc global ' + this._rememberdTokenString(symbolName, referenceDetails));
            }
            if (referenceDetails !== undefined) {
              // record a constant declaration!
              const updatedModificationSet: string[] =
                directive.toLowerCase() == '#define' ? referenceDetails.modifiersWith('declaration') : referenceDetails.modifiers;
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: symbolName.length,
                ptTokenType: referenceDetails.type,
                ptTokenModifiers: updatedModificationSet
              });
            } else if (this.semanticFindings.isPreProcSymbolDefined(symbolName)) {
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: symbolName.length,
                ptTokenType: 'variable',
                ptTokenModifiers: ['readonly']
              });
            } else if (this.parseUtils.isFlexspinReservedWord(symbolName)) {
              // record a constant reference
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: symbolName.length,
                ptTokenType: 'variable',
                ptTokenModifiers: ['readonly']
              });
            } else {
              // record an unknown name
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: symbolName.length,
                ptTokenType: 'variable', //'comment',
                ptTokenModifiers: ['disabled'] // ['line']
              });
            }
          }
          const lineHasFilename: boolean = directive.toLowerCase() == '#include';
          if (lineHasFilename) {
            const openQuoteOffset: number = line.indexOf('"');
            if (openQuoteOffset != -1) {
              const closeQuoteOffset: number = line.indexOf('"', openQuoteOffset + 1);
              if (closeQuoteOffset != -1) {
                const symbolLength = closeQuoteOffset - openQuoteOffset + 1;
                // record an filename
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: openQuoteOffset,
                  length: symbolLength,
                  ptTokenType: 'filename',
                  ptTokenModifiers: []
                });
                this._logPreProc(`  -- filename=[${line.substring(openQuoteOffset, closeQuoteOffset + 1)}]`);
              }
            }
          }
        }
      } else {
        //  DO NOTHING we don't highlight these (flexspin support not enabled)
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: 0,
          length: lineParts[0].length,
          ptTokenType: 'macro',
          ptTokenModifiers: ['directive', 'illegalUse']
        });
        this.semanticFindings.pushDiagnosticMessage(
          lineIdx,
          0,
          0 + lineParts[0].length,
          eSeverity.Error,
          `P2 Spin - FlexSpin PreProcessor Directive [${lineParts[0]}] not supported!`
        );
      }
    }

    return tokenSet;
  }

  private _reportCON_DeclarationMultiLine(startingOffset: number, multiLineSet: ContinuedLines): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    // skip Past Whitespace
    let currSingleLineOffset: number = this.parseUtils.skipWhite(multiLineSet.line, startingOffset);
    this._logCON(
      `  - Ln#${multiLineSet.lineStartIdx + 1} rptCDLMulti() ENTRY startingOffset=(${startingOffset}), line=[${multiLineSet.line}](${
        multiLineSet.line.length
      })`
    );
    const nonCommentConstantLine = multiLineSet.line.substring(currSingleLineOffset).trimEnd();
    if (nonCommentConstantLine.length > 0) {
      const haveEnumDeclaration: boolean = this._isEnumDeclarationMultiLine(multiLineSet.lineStartIdx, 0, nonCommentConstantLine);
      const isAssignment: boolean = nonCommentConstantLine.indexOf('=') != -1;
      //const isStructDecl: boolean = this.parseUtils.requestedSpinVersion(45) && nonCommentConstantLine.toUpperCase().indexOf('STRUCT') != -1;
      if (!haveEnumDeclaration && isAssignment) {
        this.conEnumInProgress = false;
      } else {
        this.conEnumInProgress = this.conEnumInProgress || haveEnumDeclaration;
      }
      const statements: string[] = this.splitLinesWithPossibleStruct(nonCommentConstantLine);
      const containsMultiStatements: boolean = statements.length > 1;
      this._logCON(
        `- Ln#${
          multiLineSet.lineStartIdx + 1
        } rptCDLMulti() haveEnum=(${haveEnumDeclaration}), containsMulti=(${containsMultiStatements}), nonCommentConstantLine=[${nonCommentConstantLine}], statements=[${statements}](${
          statements.length
        }`
      );
      if (!haveEnumDeclaration && !this.conEnumInProgress) {
        this._logCON(`  -- rptCDLMulti() assignments Multi statements=[${statements}](${statements.length})`);
        for (let index = 0; index < statements.length; index++) {
          const conDeclarationLine: string = statements[index].trim();
          this._logCON(`  -- rptCDLMulti()  conDeclarationLine=[${conDeclarationLine}][${index}]`);
          //currSingleLineOffset = line.indexOf(conDeclarationLine, currSingleLineOffset);
          // locate key indicators of line style
          const isAssignment: boolean = conDeclarationLine.indexOf('=') != -1;
          const isStructDecl: boolean = this.parseUtils.requestedSpinVersion(45) && conDeclarationLine.toUpperCase().indexOf('STRUCT') != -1;
          if (!isAssignment && !isStructDecl) {
            const symbolPosition: Position = multiLineSet.locateSymbol(conDeclarationLine, currSingleLineOffset);
            if (!this.parseUtils.isDebugInvocation(conDeclarationLine)) {
              this.semanticFindings.pushDiagnosticMessage(
                symbolPosition.line,
                symbolPosition.character,
                symbolPosition.character + conDeclarationLine.length,
                eSeverity.Error,
                `P2 Spin Syntax: Missing '=' part of assignment [${conDeclarationLine}]`
              );
            }
          } else if (isAssignment && isStructDecl) {
            this._logCON(`  -- rptCDLMulti() struct conAssignLine=[${conDeclarationLine}][${index}]`);
            const structDeclaration = this.parseStructDeclaration(conDeclarationLine);
            const statementPosition: Position = multiLineSet.locateSymbol(conDeclarationLine, 0);
            if (structDeclaration.isValidStatus) {
              // color 'STRUCT' keyword
              // this is a constant declaration!
              const structKeyWord: string = 'STRUCT';
              const structPosition: Position = multiLineSet.locateSymbol(structKeyWord, multiLineSet.offsetIntoLineForPosition(statementPosition));
              let lineIdx: number = structPosition.line;
              let nameOffset: number = structPosition.character;
              this._logMessage(`  -- rptCDLMulti() ${structKeyWord}, ofs=(${nameOffset})`);
              this._recordToken(tokenSet, multiLineSet.lineAt(structPosition.line), {
                line: lineIdx,
                startCharacter: nameOffset,
                length: structKeyWord.length,
                ptTokenType: 'keyword',
                ptTokenModifiers: []
              });
              // color struct Name
              const symbolName: string = structDeclaration.structName;
              let symbolPosition: Position = multiLineSet.locateSymbol(symbolName, currSingleLineOffset);
              lineIdx = symbolPosition.line;
              nameOffset = symbolPosition.character;
              this._logMessage(`  -- rptCDLMulti() structName=[${structDeclaration.structName}], ofs=(${nameOffset})`);
              this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                line: lineIdx,
                startCharacter: nameOffset,
                length: symbolName.length,
                ptTokenType: 'storageType',
                ptTokenModifiers: ['readonly', 'declaration']
              });
              // color name at RHS of assignment
              const rhsName: string = structDeclaration.members[0].name;
              symbolPosition = multiLineSet.locateSymbol(rhsName, nameOffset + symbolName.length);
              lineIdx = symbolPosition.line;
              nameOffset = symbolPosition.character;
              this._logSPIN(`  -- rptCDLMulti() checking rhsName=[${rhsName}]`);
              if (this._isPossibleObjectReference(rhsName)) {
                // go register object reference!
                const bHaveObjReference = this._reportObjectReference(
                  rhsName,
                  lineIdx,
                  nameOffset,
                  multiLineSet.lineAt(symbolPosition.line),
                  tokenSet
                );
                if (bHaveObjReference) {
                  // would have adjusted currentOffset here....
                  continue;
                }
              }
              let referenceDetails: RememberedToken | undefined = undefined;
              if (this.semanticFindings.isLocalToken(rhsName)) {
                referenceDetails = this.semanticFindings.getLocalTokenForLine(rhsName, lineIdx + 1);
                this._logSPIN(`  --  FOUND local name=[${rhsName}] found: ${referenceDetails !== undefined}`);
              } else if (this.semanticFindings.isGlobalToken(rhsName)) {
                referenceDetails = this.semanticFindings.getGlobalToken(rhsName);
                this._logSPIN(`  --  FOUND global name=[${rhsName}] found: ${referenceDetails !== undefined}`);
              }
              if (referenceDetails !== undefined) {
                this._logSPIN(`  --  rptCDLMulti() lcl-idx rhsName=[${rhsName}], ofs=(${nameOffset})`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: rhsName.length,
                  ptTokenType: referenceDetails.type,
                  ptTokenModifiers: referenceDetails.modifiers
                });
              }
            }
          } else if (isStructDecl) {
            this._logCON(`  -- rptCDLMulti() struct Line=[${conDeclarationLine}][${index}]`);
            const structDeclaration = this.parseStructDeclaration(conDeclarationLine);
            const statementPosition: Position = multiLineSet.locateSymbol(conDeclarationLine, 0);
            if (structDeclaration.isValidStatus) {
              // color 'STRUCT' keyword
              // this is a constant declaration!
              const structKeyWord: string = 'STRUCT';
              const structPosition: Position = multiLineSet.locateSymbol(structKeyWord, multiLineSet.offsetIntoLineForPosition(statementPosition));
              let lineIdx: number = structPosition.line;
              let nameOffset: number = structPosition.character;
              this._logMessage(`  -- rptCDLMulti() ${structKeyWord}, ofs=(${nameOffset})`);
              this._recordToken(tokenSet, multiLineSet.lineAt(structPosition.line), {
                line: lineIdx,
                startCharacter: nameOffset,
                length: structKeyWord.length,
                ptTokenType: 'keyword',
                ptTokenModifiers: []
              });
              // color struct Name
              const symbolName: string = structDeclaration.structName;
              let symbolPosition: Position = multiLineSet.locateSymbol(
                symbolName,
                multiLineSet.offsetIntoLineForPosition(structPosition) + structKeyWord.length
              );
              lineIdx = symbolPosition.line;
              nameOffset = symbolPosition.character;
              this._logMessage(`  -- rptCDLMulti() structName=[${symbolName}], ofs=(${nameOffset})`);
              this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                line: lineIdx,
                startCharacter: nameOffset,
                length: symbolName.length,
                ptTokenType: 'storageType',
                ptTokenModifiers: ['readonly', 'declaration']
              });
              // for each member...
              let currPartOffset: number = multiLineSet.offsetIntoLineForPosition(symbolPosition) + symbolName.length;
              for (let index = 0; index < structDeclaration.members.length; index++) {
                const member = structDeclaration.members[index];
                //   color member type
                const typeStr: string = member.type;
                const arraySize: string | number = member.arraySize === undefined ? 1 : member.arraySize;
                const haveIndexName: boolean = typeof arraySize === 'number' ? false : true;
                const indexName: string = typeof arraySize === 'string' ? arraySize : '';
                switch (member.type.toLocaleLowerCase()) {
                  case 'long':
                  case 'byte':
                  case 'word':
                    break;
                  default:
                    break;
                }
                symbolPosition = multiLineSet.locateSymbol(typeStr, currPartOffset);
                lineIdx = symbolPosition.line;
                nameOffset = symbolPosition.character;
                this._logMessage(`  -- rptCDLMulti() memberType=[${typeStr}], ofs=(${nameOffset})`);
                if (nameOffset != -1) {
                  // OPTIONALLY color member type
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: typeStr.length,
                    ptTokenType: 'storageType',
                    ptTokenModifiers: []
                  });
                  currPartOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition) + typeStr.length;
                }
                //   color member name
                const memberName: string = member.name;
                symbolPosition = multiLineSet.locateSymbol(memberName, currPartOffset);
                lineIdx = symbolPosition.line;
                nameOffset = symbolPosition.character;
                this._logMessage(`  -- rptCDLMulti() memberName=[${memberName}], ofs=(${nameOffset})`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: memberName.length,
                  ptTokenType: 'variable',
                  ptTokenModifiers: ['readonly', 'declaration']
                });
                currPartOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition) + memberName.length;
                // OPTIONALLY color index name
                if (haveIndexName) {
                  // XYZZY lookup and color named index
                  symbolPosition = multiLineSet.locateSymbol(indexName, currPartOffset);
                  lineIdx = symbolPosition.line;
                  nameOffset = symbolPosition.character;
                  this._logMessage(`  -- rptCDLMulti() memberName=[${indexName}], ofs=(${nameOffset})`);
                  let referenceDetails: RememberedToken | undefined = undefined;
                  if (this.semanticFindings.isGlobalToken(indexName)) {
                    referenceDetails = this.semanticFindings.getGlobalToken(indexName);
                    this._logCON(`  --  FOUND rcdl lhs global ${this._rememberdTokenString(indexName, referenceDetails)}`);
                  }
                  if (referenceDetails !== undefined) {
                    // this is a constant declaration!
                    const modifiersWDecl: string[] = referenceDetails.modifiersWithout('declaration');
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: indexName.length,
                      ptTokenType: referenceDetails.type,
                      ptTokenModifiers: modifiersWDecl
                    });
                  } else {
                    this._logCON('  --  CON ERROR[CODE] missed recording declaration! name=[' + indexName + ']');
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: indexName.length,
                      ptTokenType: 'variable',
                      ptTokenModifiers: ['illegalUse']
                    });
                  }
                }
              }
            }
          } else {
            // -------------------------------------------
            // have line assigning value to new constant
            // -------------------------------------------
            // process LHS
            const assignmentParts: string[] = conDeclarationLine.split('=');
            const lhsConstantName = assignmentParts[0].trim();
            const statementPosition: Position = multiLineSet.locateSymbol(conDeclarationLine, 0);
            //const nameOffset = line.indexOf(lhsConstantName, currSingleLineOffset);
            const symbolPosition: Position = multiLineSet.locateSymbol(lhsConstantName, multiLineSet.offsetIntoLineForPosition(statementPosition));
            //const nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
            this._logCON(`  -- rptCDLMulti() assign lhsConstantName=[${lhsConstantName}]`);
            let referenceDetails: RememberedToken | undefined = undefined;
            if (this.semanticFindings.isGlobalToken(lhsConstantName)) {
              referenceDetails = this.semanticFindings.getGlobalToken(lhsConstantName);
              this._logCON(`  --  FOUND rcdl lhs global ${this._rememberdTokenString(lhsConstantName, referenceDetails)}`);
            }
            if (referenceDetails !== undefined) {
              // this is a constant declaration!
              const modifiersWDecl: string[] = referenceDetails.modifiersWith('declaration');
              this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                line: symbolPosition.line,
                startCharacter: symbolPosition.character,
                length: lhsConstantName.length,
                ptTokenType: referenceDetails.type,
                ptTokenModifiers: modifiersWDecl
              });
            } else {
              this._logCON('  --  CON ERROR[CODE] missed recording declaration! name=[' + lhsConstantName + ']');
              this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                line: symbolPosition.line,
                startCharacter: symbolPosition.character,
                length: lhsConstantName.length,
                ptTokenType: 'variable',
                ptTokenModifiers: ['illegalUse']
              });
              if (this.parseUtils.isP1AsmVariable(lhsConstantName)) {
                this.semanticFindings.pushDiagnosticMessage(
                  symbolPosition.line,
                  symbolPosition.character,
                  symbolPosition.character + lhsConstantName.length,
                  eSeverity.Error,
                  `P1 pasm variable [${lhsConstantName}] not allowed in P2 spin`
                );
              } else {
                this.semanticFindings.pushDiagnosticMessage(
                  symbolPosition.line,
                  symbolPosition.character,
                  symbolPosition.character + lhsConstantName.length,
                  eSeverity.Error,
                  `Missing Variable Declaration [${lhsConstantName}]`
                );
              }
            }
            // remove front LHS of assignment and process remainder
            // process RHS
            const fistEqualOffset: number = conDeclarationLine.indexOf('=');
            const assignmentRHSStr = conDeclarationLine.substring(fistEqualOffset + 1).trim();
            currSingleLineOffset = multiLineSet.line.indexOf(assignmentRHSStr, fistEqualOffset); // skip to RHS of assignment
            this._logCON(`  -- rptCDLMulti() assignmentRHSStr=[${assignmentRHSStr}], ofs=(${currSingleLineOffset})`);
            const KEEP_PACKED_CONSTANTS: boolean = true;
            const possNames: string[] = this.parseUtils.getNonWhiteCONLineParts(assignmentRHSStr, KEEP_PACKED_CONSTANTS);
            this._logCON(`  -- rptCDLMulti() possNames=[${possNames}](${possNames.length})`);
            for (let index = 0; index < possNames.length; index++) {
              const possibleName = possNames[index];
              const [paramIsNumber, paramIsSymbolName] = this.parseUtils.isValidSpinConstantOrSpinSymbol(possibleName);
              this._logCON(`  -- rptCDLMulti() name=[${possibleName}], paramIsNumber=(${paramIsNumber})`);
              if (paramIsNumber) {
                const symbolPosition: Position = multiLineSet.locateSymbol(possibleName, currSingleLineOffset);
                const nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
                this._logCON(`  -- rptCDLMulti() index is Number=[${possibleName}]`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: possibleName.length,
                  ptTokenType: 'number',
                  ptTokenModifiers: []
                });
                currSingleLineOffset = nameOffset + possibleName.length;
                continue;
              } else if (paramIsSymbolName) {
                // does name contain a namespace reference?
                //let nameOffset: number = line.indexOf(possibleName, currSingleLineOffset);
                let symbolPosition: Position = multiLineSet.locateSymbol(possibleName, currSingleLineOffset);
                let nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
                let possibleNameSet: string[] = [possibleName];
                if (this._isPossibleObjectReference(possibleName)) {
                  const bHaveObjReference = this._reportObjectReference(
                    possibleName,
                    symbolPosition.line,
                    symbolPosition.character,
                    multiLineSet.lineAt(symbolPosition.line),
                    tokenSet
                  );
                  if (bHaveObjReference) {
                    currSingleLineOffset = nameOffset + possibleName.length;
                    continue;
                  }
                  possibleNameSet = possibleName.split('.');
                }
                this._logCON(`  --  possibleNameSet=[${possibleNameSet}](${possibleNameSet.length})`);
                const namePart: string = possibleNameSet[0];
                const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : `${possibleNameSet[0]}.${possibleNameSet[1]}`;
                symbolPosition = multiLineSet.locateSymbol(searchString, currSingleLineOffset);
                nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
                let referenceDetails: RememberedToken | undefined = undefined;
                this._logCON(`  -- namePart=[${namePart}], ofs=(${nameOffset})`);
                // register constants in CON are new...  highlight them if new version
                if (this.parseUtils.isSpinRegister(namePart)) {
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: symbolPosition.line,
                    startCharacter: symbolPosition.character,
                    length: namePart.length,
                    ptTokenType: 'variable',
                    ptTokenModifiers: ['readonly']
                  });
                  continue;
                }
                if (this.parseUtils.isUnaryOperator(namePart) || this.parseUtils.isBinaryOperator(namePart)) {
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: symbolPosition.line,
                    startCharacter: nameOffset,
                    length: namePart.length,
                    ptTokenType: 'operator', // method is blue?!, function is yellow?!
                    ptTokenModifiers: ['builtin']
                  });
                  continue;
                }
                if (this.semanticFindings.isGlobalToken(namePart)) {
                  referenceDetails = this.semanticFindings.getGlobalToken(namePart);
                  this._logCON(`  --  FOUND rcds rhs global ${this._rememberdTokenString(namePart, referenceDetails)}`);
                }
                if (referenceDetails !== undefined) {
                  // this is a constant reference!
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: symbolPosition.line,
                    startCharacter: symbolPosition.character,
                    length: namePart.length,
                    ptTokenType: referenceDetails.type,
                    ptTokenModifiers: referenceDetails.modifiers
                  });
                } else {
                  const methodFollowString: string = multiLineSet.lineAt(symbolPosition.line).substring(symbolPosition.character + namePart.length);
                  this._logSPIN(`  --  CON func Paren chk nm=[${namePart}] methodFollowString=[${methodFollowString}](${methodFollowString.length})`);
                  if (this.parseUtils.isFloatConversion(namePart) && !isMethodCall(methodFollowString)) {
                    this._logCON(`  --  CON MISSING parens=[${namePart}]`);
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: namePart.length,
                      ptTokenType: 'method',
                      ptTokenModifiers: ['builtin', 'missingDeclaration']
                    });
                    this.semanticFindings.pushDiagnosticMessage(
                      symbolPosition.line,
                      symbolPosition.character,
                      symbolPosition.character + namePart.length,
                      eSeverity.Error,
                      `P2 Spin CON missing parens [${namePart}]`
                    );
                  } else if (this.parseUtils.isFloatConversion(namePart) && isMethodCallEmptyParens(methodFollowString)) {
                    this._logCON(`  --  CON EMPTY parens=[${namePart}]`);
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: namePart.length,
                      ptTokenType: 'method',
                      ptTokenModifiers: ['builtin', 'missingDeclaration']
                    });
                    this.semanticFindings.pushDiagnosticMessage(
                      symbolPosition.line,
                      symbolPosition.character,
                      symbolPosition.character + namePart.length,
                      eSeverity.Error,
                      `P2 Spin CON function w/empty parens [${namePart}]`
                    );
                  } else if (
                    !this.parseUtils.isSpinReservedWord(namePart) &&
                    !this.parseUtils.isBuiltinStreamerReservedWord(namePart) &&
                    !this.parseUtils.isDebugMethod(namePart) &&
                    !this.parseUtils.isDebugControlSymbol(namePart) &&
                    !this.parseUtils.isUnaryOperator(namePart)
                  ) {
                    this._logCON('  --  CON MISSING name=[' + namePart + ']');
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: namePart.length,
                      ptTokenType: 'variable',
                      ptTokenModifiers: ['illegalUse']
                    });
                    if (this.parseUtils.isP1AsmVariable(namePart)) {
                      this.semanticFindings.pushDiagnosticMessage(
                        symbolPosition.line,
                        symbolPosition.character,
                        symbolPosition.character + namePart.length,
                        eSeverity.Error,
                        `P1 pasm variable [${namePart}] in not allowed P2 spin`
                      );
                    } else {
                      this.semanticFindings.pushDiagnosticMessage(
                        symbolPosition.line,
                        symbolPosition.character,
                        symbolPosition.character + namePart.length,
                        eSeverity.Error,
                        `Missing Constant Declaration [${namePart}]`
                      );
                    }
                  } else {
                    if (
                      !this.parseUtils.isP2AsmReservedWord(namePart) &&
                      !this.parseUtils.isBuiltInSmartPinReservedWord(namePart) &&
                      !this.parseUtils.isBuiltinStreamerReservedWord(namePart) &&
                      !this.parseUtils.isUnaryOperator(namePart) &&
                      !this.parseUtils.isBinaryOperator(namePart) &&
                      !this.parseUtils.isSpinNumericSymbols(namePart)
                    ) {
                      this._logCON('  --  CON MISSING declaration=[' + namePart + ']');
                      this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                        line: symbolPosition.line,
                        startCharacter: symbolPosition.character,
                        length: namePart.length,
                        ptTokenType: 'variable',
                        ptTokenModifiers: ['missingDeclaration']
                      });
                      this.semanticFindings.pushDiagnosticMessage(
                        symbolPosition.line,
                        symbolPosition.character,
                        symbolPosition.character + namePart.length,
                        eSeverity.Error,
                        `P2 Spin mCON missing Declaration [${namePart}]`
                      );
                    }
                  }
                }
                currSingleLineOffset = nameOffset + namePart.length; // skip past this name
              }
            }
          }
        }
      } else {
        // -------------------------------------------------
        // have line creating one or more of enum constants
        // -------------------------------------------------
        // recognize enum values getting initialized
        const lineParts: string[] = nonCommentConstantLine.split(/[,#[\]]/).filter(Boolean);
        this._logCON(`  -- enum lineParts=[${lineParts}](${lineParts.length})`);
        let nameOffset: number = 0;
        let nameLen: number = 0;
        for (let index = 0; index < lineParts.length; index++) {
          let enumConstant = lineParts[index].trim();
          // our enum name can have a step offset: name[step]
          if (enumConstant.includes('[')) {
            // it does, isolate name from offset
            const enumNameParts: string[] = enumConstant.split('[');
            enumConstant = enumNameParts[0];
          }
          nameLen = enumConstant.length;
          if (enumConstant.includes('=')) {
            // process LHS of '='
            const enumAssignmentParts: string[] = enumConstant.split('=');
            enumConstant = enumAssignmentParts[1].trim();
            const enumExistingName: string = enumAssignmentParts[0].trim();
            nameLen = enumExistingName.length; // len changed assign again...
            this._logCON(`  -- A GLBLMulti enumExistingName=[${enumExistingName}], enumConstant=[${enumConstant}]`);
            if (this.parseUtils.isValidSpinSymbolName(enumExistingName)) {
              // our enum name can have a step offset
              //nameOffset = line.indexOf(enumExistingName, currSingleLineOffset);
              const symbolPosition: Position = multiLineSet.locateSymbol(enumExistingName, currSingleLineOffset);
              nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
              this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                line: symbolPosition.line,
                startCharacter: nameOffset,
                length: enumExistingName.length,
                ptTokenType: 'enumMember',
                ptTokenModifiers: ['readonly']
              });
            }
            currSingleLineOffset = nameOffset + enumExistingName.length;
          }
          if (this.parseUtils.isValidSpinSymbolName(enumConstant)) {
            const symbolPosition: Position = multiLineSet.locateSymbol(enumConstant, currSingleLineOffset);
            nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
            if (!this.parseUtils.isDebugInvocation(enumConstant) && !this.parseUtils.isP1AsmVariable(enumConstant)) {
              this._logCON('  -- B GLBLMulti enumConstant=[' + enumConstant + ']');
              // our enum name can have a step offset
              //nameOffset = line.indexOf(enumConstant, currSingleLineOffset);
              this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                line: symbolPosition.line,
                startCharacter: symbolPosition.character,
                length: enumConstant.length,
                ptTokenType: 'enumMember',
                ptTokenModifiers: ['declaration', 'readonly']
              });
            } else if (this.parseUtils.isP1AsmVariable(enumConstant)) {
              // our SPIN1 name
              this._logCON('  -- B GLBL bad SPIN1=[' + enumConstant + ']');
              //nameOffset = line.indexOf(enumConstant, currSingleLineOffset);
              this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                line: symbolPosition.line,
                startCharacter: symbolPosition.character,
                length: enumConstant.length,
                ptTokenType: 'variable',
                ptTokenModifiers: ['illegalUse']
              });
              this.semanticFindings.pushDiagnosticMessage(
                symbolPosition.line,
                symbolPosition.character,
                symbolPosition.character + enumConstant.length,
                eSeverity.Error,
                `P1 Spin constant [${enumConstant}] not allowed in P2 Spin`
              );
            }
            currSingleLineOffset = nameOffset + nameLen;
          } else {
            currSingleLineOffset + nameLen; // skip over things like "#0 enum start"
          }
        }
      }
    } else {
      this.conEnumInProgress = false; // if we have a blank line after removing comment then weve ended the enum set
    }
    return tokenSet;
  }

  private _isEnumDeclarationSingleLine(lineIdx: number, startingOffset: number, line: string): boolean {
    return this._isEnumDeclarationMultiLine(lineIdx, startingOffset, line, true);
  }

  private _isEnumDeclarationMultiLine(lineIdx: number, startingOffset: number, line: string, singleLine: boolean = false): boolean {
    // BOTH P1 and P2 determination: if CON line is start enum declaration
    const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const nonCommentConstantLine = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    let enumDeclStatus: boolean = nonCommentConstantLine.trim().startsWith('#');
    const isStructDecl: boolean = nonCommentConstantLine.trim().toUpperCase().includes('STRUCT');
    const isPreprocessorStatement: boolean = this.parseUtils.lineStartsWithFlexspinPreprocessorDirective(nonCommentConstantLine);
    this._logMessage(
      `- Ln#${lineIdx} _isEnumDeclMultiLine() enumDecl=(${enumDeclStatus}), isPreproc=(${isPreprocessorStatement}), isStructDecl=(${isStructDecl}), nonCommentConstantLine=[${nonCommentConstantLine}]`
    );
    if (isPreprocessorStatement) {
      enumDeclStatus = false;
    }
    // if not yet sure...
    if (isPreprocessorStatement == false && enumDeclStatus == false && singleLine == false && isStructDecl == false) {
      // don't know what this line is, yet
      const statements: string[] = this.splitLinesWithPossibleStruct(nonCommentConstantLine);
      let allStatementAreAssignment: boolean = true;
      // if all statements are assignment then we still don't know if this is enum or list of assignements
      // however, if one has "no assignment" then we DO KNOW that this is an enum start
      for (let index = 0; index < statements.length; index++) {
        const singleStatement = statements[index];
        if (!singleStatement.includes('=')) {
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

  private parseStructDeclaration(structLine: string): { isValidStatus: boolean; structName: string; members: IStructMember[] } {
    const structRegex = /STRUCT\s+(\w+)\s*\(([^)]+)\)/i; // Matches STRUCT name(member1, member2, ...)
    const structAsgnRegex = /STRUCT\s+(\w+)\s*=\s*(\w+)/i; // Matches STRUCT name = structName
    const reducedWhiteSpace: string = structLine.replace(/\s+/g, ' ').trim(); // Remove extra whitespace
    const match = reducedWhiteSpace.match(structRegex);
    const assignMatch = reducedWhiteSpace.match(structAsgnRegex);
    let isValidStatus: boolean = false;
    let structName: string = ''; // The name of the structure
    let members: IStructMember[] = []; // The raw members string (e.g., "LONG x, LONG y[10]")

    if (match) {
      isValidStatus = true;
      structName = match[1]; // The name of the structure
      const membersRaw = match[2]; // The raw members string (e.g., "LONG x, LONG y[10]")
      //this._logMessage(` -- ParsStruDecl() nm=[${structName}], mbrsRaw=[${membersRaw}] match=[${match}](${match.length})`);

      // Split members and parse each one
      members = membersRaw.split(',').map((member) => {
        const memberParts = member.trim().match(/(?:(\w+)\s+)?(\w+)(?:\[(\w+)\])?/); // Matches {type} name [arraySize]
        if (!memberParts) {
          this._logMessage(`Invalid member declaration: ${member}`);
          return { name: '', type: '', arraySize: 0 }; // Invalid member, return EMPTY
        }
        //this._logMessage(` -- ParsStruDecl() memberParts=[${memberParts}](${memberParts.length})`);

        const [, type = 'LONG', name, arraySize] = memberParts; // Default type is LONG if not specified
        return {
          name,
          type,
          arraySize: /^-?\d+(\.\d+)?$/.test(arraySize) ? parseInt(arraySize, 10) : arraySize // Default array size is 1 if not specified
        };
      });
    } else if (assignMatch) {
      const lineParts: string[] = structLine.split(/[ \t=]/).filter(Boolean);
      this._logMessage(` -- ParsStruDecl() ASSIGNMENT lineParts=[${lineParts}](${lineParts.length})`);
      // Handle the case where the struct is assigned to another struct
      isValidStatus = true;
      structName = assignMatch[1]; // The name of the structure
      const memberName = lineParts.length > 2 ? lineParts[2] : assignMatch[2]; // The name of the structure
      // NOTE: FIXME: for now the following works but if we fall back to using assignMatch[2] it won't return names with '.'s in them!
      this._logMessage(` -- ParsStruDecl() nm=[${structName}], memberName=[${memberName}] match=[${assignMatch}](${assignMatch.length})`);
      members = [{ name: memberName, type: 'STRUCT', arraySize: 1 }]; // Assign the struct to another struct
    }
    this._logMessage(` -- ParsStruDecl() results isValid=(${isValidStatus}), name=[${structName}] ${JSON.stringify(members, null, 2)}`);
    return { isValidStatus, structName, members };
  }

  private _reportDAT_DeclarationLine(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const dataDeclNonCommentStr = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    const lineParts: string[] = this.parseUtils.getNonWhiteLineParts(dataDeclNonCommentStr);
    const bIsAlsoDebugLine: boolean = haveDebugLine(dataDeclNonCommentStr);
    const IN_PASM: boolean = true;
    this._logDAT(`- Ln#${lineIdx + 1} rDatDecl() lineParts=[${lineParts}](${lineParts.length})`);
    // remember this object name so we can annotate a call to it
    if (lineParts.length > 1) {
      // line starts with [storage type | FILE | ORG]
      if (this.isStorageType(lineParts[0]) || lineParts[0].toUpperCase() == 'FILE' || lineParts[0].toUpperCase() == 'ORG') {
        // if we start with storage type (or FILE, or ORG), not name, process rest of line for symbols
        currentOffset = line.indexOf(lineParts[0], currentOffset);
        const allowLocalVarStatus: boolean = false;
        const NOT_DAT_PASM: boolean = false;
        const partialTokenSet: IParsedToken[] = this._reportDAT_ValueDeclarationCode(
          lineIdx,
          startingOffset,
          line,
          allowLocalVarStatus,
          this.showDAT,
          NOT_DAT_PASM
        );
        this._reportNonDupeTokens(partialTokenSet, '=> DATvalue: ', line, tokenSet);
      } else {
        // this is line with name, storageType, and initial value  XYZZY DITTO
        this._logDAT(`  -- rDatDecl() lineParts=[${lineParts}](${lineParts.length})`);
        const newName = lineParts[0];
        const nameOffset: number = line.indexOf(newName, currentOffset);
        let referenceDetails: RememberedToken | undefined = undefined;
        if (this.semanticFindings.isGlobalToken(newName)) {
          referenceDetails = this.semanticFindings.getGlobalToken(newName);
          this._logMessage('  --  FOUND rddl global name=[' + newName + ']');
        }
        if (referenceDetails !== undefined) {
          // highlight label declaration
          const modifiersWDecl: string[] = referenceDetails.modifiersWith('declaration'); // add back in our declaration flag
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: newName.length,
            ptTokenType: referenceDetails.type,
            ptTokenModifiers: modifiersWDecl
          });
          if (bIsAlsoDebugLine) {
            // have label colored, no go process debug if present
            const continuedLineSet: ContinuedLines = new ContinuedLines();
            const nonCommentDebugLine = this._getDebugNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
            this._logDAT(`  -- rDatDecl() CALL out to rdsm() to process nonCommentDebugLine=[${nonCommentDebugLine}](${nonCommentDebugLine.length})`);
            continuedLineSet.addLine(nonCommentDebugLine, lineIdx);
            const partialTokenSet: IParsedToken[] = this._reportDebugStatementMultiLine(startingOffset, continuedLineSet, IN_PASM);
            this._reportNonDupeTokens(partialTokenSet, '=> DAT: ', line, tokenSet);
            return tokenSet;
          }
        } else if (bIsAlsoDebugLine) {
          // didn't start with label so we need to process debug line
          const continuedLineSet: ContinuedLines = new ContinuedLines();
          const nonCommentDebugLine = this._getDebugNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
          this._logDAT(`  -- rDatDecl() CALL out to rdsm() to process nonCommentDebugLine=[${nonCommentDebugLine}](${nonCommentDebugLine.length})`);
          continuedLineSet.addLine(nonCommentDebugLine, lineIdx);
          const partialTokenSet: IParsedToken[] = this._reportDebugStatementMultiLine(startingOffset, continuedLineSet, IN_PASM);
          this._reportNonDupeTokens(partialTokenSet, '=> DAT: ', line, tokenSet);
          return tokenSet;
        } else if (newName.toUpperCase() == 'DITTO') {
          // if version 50 color DITTO
          this._logPASM('  --  DAT DITTO directive=[' + newName + ']');
          let nameOffset: number = line.indexOf(newName, currentOffset);
          if (this.parseUtils.requestedSpinVersion(50)) {
            // color our 'ditto' token
            this._logPASM('  --  DAT highlight directive=[' + newName + ']');
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: newName.length,
              ptTokenType: 'directive',
              ptTokenModifiers: []
            });
            if (lineParts[1].toUpperCase() == 'END') {
              // color our 'ditto end' token
              nameOffset = line.indexOf(lineParts[1], nameOffset + newName.length);
              this._logPASM('  --  DAT add name=[' + lineParts[1] + ']');
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: lineParts[1].length,
                ptTokenType: 'directive',
                ptTokenModifiers: []
              });
            }
          } else {
            // if NOT version 50  DITTO and DITTO END are illegal
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: newName.length,
              ptTokenType: 'variable',
              ptTokenModifiers: ['illegalUse']
            });
            this.semanticFindings.pushDiagnosticMessage(
              lineIdx,
              nameOffset,
              nameOffset + newName.length,
              eSeverity.Error,
              `Illegal P2 DAT PAsm directive [${newName}]`
            );
            if (lineParts[1].toUpperCase() == 'END') {
              // color our 'ditto end' token
              nameOffset = line.indexOf(lineParts[1], nameOffset + newName.length);
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: lineParts[1].length,
                ptTokenType: 'variable',
                ptTokenModifiers: ['illegalUse']
              });
            }
          }
        } else if (!this.parseUtils.isP2AsmReservedSymbols(newName) && !this.parseUtils.isP2AsmInstruction(newName)) {
          this._logDAT('  --  DAT rDdl MISSING name=[' + newName + ']');
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: newName.length,
            ptTokenType: 'variable',
            ptTokenModifiers: ['missingDeclaration']
          });
          this.semanticFindings.pushDiagnosticMessage(
            lineIdx,
            nameOffset,
            nameOffset + newName.length,
            eSeverity.Error,
            `P2 Spin DAT missing declaration [${newName}]`
          );
        }

        // process remainder of line
        currentOffset = line.indexOf(lineParts[1], nameOffset + newName.length);
        const allowLocalVarStatus: boolean = false;
        const NOT_DAT_PASM: boolean = false;
        const partialTokenSet: IParsedToken[] = this._reportDAT_ValueDeclarationCode(
          lineIdx,
          startingOffset,
          line,
          allowLocalVarStatus,
          this.showDAT,
          NOT_DAT_PASM
        );
        this._reportNonDupeTokens(partialTokenSet, '=> DATvalue: ', line, tokenSet);
      }
    } else if (bIsAlsoDebugLine) {
      // if this is a debug line, we need to process it elsewhere
      const continuedLineSet: ContinuedLines = new ContinuedLines();
      const nonCommentDebugLine = this._getDebugNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
      this._logDAT(`  -- rDatDecl() CALL out to rdsm() to process nonCommentDebugLine=[${nonCommentDebugLine}](${nonCommentDebugLine.length})`);
      continuedLineSet.addLine(nonCommentDebugLine, lineIdx);
      const partialTokenSet: IParsedToken[] = this._reportDebugStatementMultiLine(startingOffset, continuedLineSet, IN_PASM);
      this._reportNonDupeTokens(partialTokenSet, '=> DAT: ', line, tokenSet);
      return tokenSet;
    } else if (lineParts.length == 1) {
      // handle name declaration only line: [name 'comment]
      const newName = lineParts[0];
      if (!this.parseUtils.isAlignType(newName)) {
        let referenceDetails: RememberedToken | undefined = undefined;
        if (this.semanticFindings.isGlobalToken(newName)) {
          referenceDetails = this.semanticFindings.getGlobalToken(newName);
          this._logMessage('  --  FOUND global name=[' + newName + ']');
        }
        if (referenceDetails !== undefined) {
          // add back in our declaration flag
          const modifiersWDecl: string[] = referenceDetails.modifiersWith('declaration');
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: currentOffset,
            length: newName.length,
            ptTokenType: referenceDetails.type,
            ptTokenModifiers: modifiersWDecl
          });
        } else if (
          this.parseUtils.isP1AsmInstruction(newName) ||
          this.parseUtils.isBadP1AsmEffectOrConditional(newName) ||
          this.parseUtils.isP1AsmVariable(newName)
        ) {
          this._logMessage('  --  ERROR p1asm name=[' + newName + ']');
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: currentOffset,
            length: newName.length,
            ptTokenType: 'variable',
            ptTokenModifiers: ['illegalUse']
          });
          this.semanticFindings.pushDiagnosticMessage(
            lineIdx,
            currentOffset,
            currentOffset + newName.length,
            eSeverity.Error,
            `P1 pasm name [${newName}] not allowed in P2 Spin`
          );
        }
      }
    } else {
      this._logDAT('  -- DAT SKIPPED: lineParts=[' + lineParts + ']');
    }
    return tokenSet;
  }

  private _reportDAT_ValueDeclarationCode(
    lineIdx: number,
    startingOffset: number,
    line: string,
    allowLocal: boolean,
    showDebug: boolean,
    isDatPAsm: boolean
  ): IParsedToken[] {
    // process line that starts with possible name then storage type (or FILE, or ORG), if not name, process rest of line for symbols
    const lineNbr: number = lineIdx + 1;
    const tokenSet: IParsedToken[] = [];
    //this._logMessage(' DBG _rDAT_ValueDeclarationCode(#' + lineNbr + ', ofs=' + startingOffset + ')');
    this._logDAT(` - Ln#${lineNbr}: rDvdc() allowLocal=(${allowLocal}), startingOffset=(${startingOffset}),  line=[${line}]`);

    // process data declaration
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const dataValueInitStr: string = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    if (dataValueInitStr.length > 0) {
      this._logDAT(`  -- rDvdc() dataValueInitStr=[${dataValueInitStr}](${dataValueInitStr.length}), currentOffset=(${currentOffset})`);
      const KEEP_PACKED_CONSTANTS: boolean = true;
      const lineParts: string[] = this.parseUtils.getNonWhiteDataInitLineParts(dataValueInitStr, KEEP_PACKED_CONSTANTS);
      let haveStorageType: boolean = false;
      this._logDAT(`  -- rDvdc() lineParts=[${lineParts}](${lineParts.length})`);
      // process remainder of line
      if (lineParts.length < 2) {
        return tokenSet;
      }
      if (lineParts.length > 1) {
        let nameOffset: number = 0;
        let namePart: string = '';
        let namePartLength: number = 0;
        this._logDAT(`  -- rDvdc() loop start currentOffset=(${currentOffset})`);
        const labelName: string = lineParts[0].trim();
        for (let index = 0; index < lineParts.length; index++) {
          const possibleName = lineParts[index].replace(/[()@]/, '');
          const possibleNameLength = possibleName.length;
          //if (showDebug) {
          //    this._logMessage('  -- possibleName=[' + possibleName + ']');
          //}
          if (possibleNameLength < 1) {
            continue;
          }
          if (!haveStorageType && this.parseUtils.isDatStorageType(possibleName)) {
            haveStorageType = true; // only skip 1st storage type, more is error
            this._logDAT(`  -- rDvdc() skipping past storage type currentOffset=(${currentOffset}) -> (${currentOffset + possibleNameLength})`);
            currentOffset += possibleNameLength;
            continue;
          }
          const [paramIsNumber, paramIsSymbolName] = this.parseUtils.isValidSpinConstantOrSpinSymbol(possibleName);
          this._logDAT(`  -- rDvdc() name=[${possibleName}], paramIsNumber=(${paramIsNumber})`);
          if (paramIsNumber) {
            nameOffset = line.indexOf(possibleName, currentOffset);
            this._logDAT(`  -- rDvdc() index is Number=[${possibleName}]`);
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: possibleName.length,
              ptTokenType: 'number',
              ptTokenModifiers: []
            });
            currentOffset = nameOffset + possibleName.length;
            continue;
          } else if (paramIsSymbolName || (isDatPAsm && this.parseUtils.isValidDatPAsmSymbolName(possibleName))) {
            // the following allows '.' in names but  only when in DAT PAsm code, not spin!
            nameOffset = line.indexOf(possibleName, currentOffset);
            this._logMessage(`  -- rDvdc() possibleName=[${possibleName}], ofs=(${nameOffset}), currentOffset=(${currentOffset})`);
            // does name contain a namespace reference?
            let possibleNameSet: string[] = [possibleName];
            if (this._isPossibleObjectReference(possibleName)) {
              const bHaveObjReference = this._reportObjectReference(possibleName, lineIdx, nameOffset, line, tokenSet);
              if (bHaveObjReference) {
                this._logMessage(`  -- rDvdc() skipping past objRef currentOffset=(${currentOffset}) -> (${nameOffset + possibleNameLength})`);
                currentOffset = nameOffset + possibleNameLength;
                continue;
              }
            } else if (this.semanticFindings.isStructure(possibleName)) {
              // highlight structure name
              this._logMessage(`  -- rDvdc() structure [${possibleName}] named=[${labelName}]`);
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: possibleName.length,
                ptTokenType: 'storageType',
                ptTokenModifiers: []
              });
              currentOffset = nameOffset + possibleName.length;
              // if is structure record instance of structure
              if (this.semanticFindings.isStructure(possibleName)) {
                this.semanticFindings.recordStructureInstance(possibleName, labelName); // DAT
              }
              continue;
            } else if (this.parseUtils.isVersionAddedMethod(possibleName)) {
              this._logMessage(`  -- rDvdc() searchString=[${possibleName}], ofs=(${nameOffset}), currentOffset=(${currentOffset})`);
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: possibleName.length,
                ptTokenType: 'operator', // method is blue?!, function is yellow?!
                ptTokenModifiers: ['builtin']
              });
              currentOffset = nameOffset + possibleName.length;
              continue;
            }

            if (possibleName.includes('.') && !possibleName.startsWith('.')) {
              possibleNameSet = possibleName.split('.');
            }
            if (showDebug) {
              this._logMessage(`  -- rDvdc()  possibleNameSet=[${possibleNameSet}](${possibleNameSet.length})`);
            }
            namePart = possibleNameSet[0];
            namePartLength = namePart.length;
            const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : `${possibleNameSet[0]}.${possibleNameSet[1]}`;
            nameOffset = line.indexOf(searchString, currentOffset);
            this._logMessage(`  -- rDvdc() searchString=[${searchString}], ofs=(${nameOffset}), currentOffset=(${currentOffset})`);
            if (this.parseUtils.isUnaryOperator(namePart) || this.parseUtils.isBinaryOperator(namePart)) {
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: namePart.length,
                ptTokenType: 'operator', // method is blue?!, function is yellow?!
                ptTokenModifiers: ['builtin']
              });
              currentOffset = nameOffset + namePart.length;
              continue;
            }
            let referenceDetails: RememberedToken | undefined = undefined;
            if (allowLocal) {
              referenceDetails = this.semanticFindings.getLocalTokenForLine(namePart, lineNbr);
              if (showDebug && referenceDetails) {
                this._logMessage(`  --  FOUND local name=[${namePart}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
              }
              if (!referenceDetails) {
                referenceDetails = this.semanticFindings.getLocalPAsmTokenForLine(lineNbr, namePart);
                if (showDebug && referenceDetails) {
                  this._logMessage(`  --  FOUND local pasm name=[${namePart}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
                }
              }
            }
            if (!referenceDetails) {
              referenceDetails = this.semanticFindings.getGlobalToken(namePart);
              if (showDebug && referenceDetails) {
                this._logMessage(`  --  FOUND global name=[${namePart}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
              }
            }
            if (referenceDetails !== undefined) {
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: namePartLength,
                ptTokenType: referenceDetails.type,
                ptTokenModifiers: referenceDetails.modifiers
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
                !this.parseUtils.isSpinPAsmLangDirective(namePart) &&
                !this.parseUtils.isBuiltinStreamerReservedWord(namePart)
              ) {
                if (showDebug) {
                  this._logMessage('  --  rDvdc() MISSING name=[' + namePart + ']');
                }
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: namePartLength,
                  ptTokenType: 'variable',
                  ptTokenModifiers: ['missingDeclaration']
                });
                this.semanticFindings.pushDiagnosticMessage(
                  lineIdx,
                  nameOffset,
                  nameOffset + namePartLength,
                  eSeverity.Error,
                  `P2 Spin rDvdc() missing declaration [${namePart}]`
                );
              }
            }
            this._logMessage(`  -- rDvdc() loop-bottom currentOffset=(${currentOffset}) -> (${nameOffset + namePartLength})`);
            currentOffset = nameOffset + namePartLength;
          }
        }
      }
    }
    return tokenSet;
  }

  private _reportDAT_PAsmCode(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    // skip Past Whitespace
    this._logPASM(`- Ln#${lineIdx + 1} rDatPAsm() line=[${line}](${line.length})`);
    const IN_PASM: boolean = true;
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    // get line parts - we only care about first one
    const inLinePAsmRHSStr: string = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    if (inLinePAsmRHSStr.length > 0) {
      const lineParts: string[] = this.parseUtils.getNonWhitePAsmLineParts(inLinePAsmRHSStr);
      this._logPASM(
        `  --  rDatPAsm() lineParts=[${lineParts}](${lineParts.length}), inLinePAsmRHSStr=[${inLinePAsmRHSStr}](${inLinePAsmRHSStr.length})`
      );
      currentOffset = line.indexOf(inLinePAsmRHSStr.trim(), currentOffset);
      // handle name in 1 column
      const bIsAlsoDebugLine: boolean = haveDebugLine(inLinePAsmRHSStr);
      // specials for detecting and failing FLexSpin'isms
      //
      //                 if NUMLOCK_DEFAULT_STATE && RPI_KEYBOARD_NUMLOCK_HACK
      //                 alts    hdev_port,#hdev_id
      //                 mov     htmp,0-0
      //                 cmp     htmp, ##$04D9_0006      wz      ' Holtek Pi keyboard vendor/product
      //                 else
      //         if_e    andn    kb_led_states, #LED_NUMLKF
      //                 end
      //
      const checkWord: string | undefined = lineParts.length > 0 ? lineParts[0].toLowerCase() : undefined;
      if (checkWord && !this.configuration.highlightFlexspinDirectives && (checkWord === 'if' || checkWord === 'else' || checkWord === 'end')) {
        // fail FlexSpin IF: if NUMLOCK_DEFAULT_STATE && RPI_KEYBOARD_NUMLOCK_HACK
        // fail FlexSpin else:  else
        // fail FlexSpin end:  end
        this._logPASM(`  --  rDatPAsm() ERROR FlexSpin statement=[${inLinePAsmRHSStr}](${inLinePAsmRHSStr.length}), ofs=(${currentOffset})`);
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: currentOffset,
          length: inLinePAsmRHSStr.length,
          ptTokenType: 'variable', // mark this offender!
          ptTokenModifiers: ['illegalUse']
        });
        this.semanticFindings.pushDiagnosticMessage(
          lineIdx,
          currentOffset,
          currentOffset + inLinePAsmRHSStr.length,
          eSeverity.Error,
          `FlexSpin if/else/end not conditional supported in P2 pasm`
        );
        return tokenSet;
      }
      let haveLabel: boolean = lineParts.length > 0 && this.parseUtils.isDatOrPAsmLabel(lineParts[0]);
      let nameOffset: number = -1;
      const isDataDeclarationLine: boolean = lineParts.length > 1 && haveLabel && this.parseUtils.isDatStorageType(lineParts[1]) ? true : false;
      this._logPASM(`  -- rDatPAsm() lineParts=[${lineParts}], haveLabel=(${haveLabel}), isDataDeclarationLine=(${isDataDeclarationLine})`);
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
        if (referenceDetails !== undefined) {
          this._logPASM(`  --  rDatPAsm() ${referenceDetails.type}=[${labelName}](${nameOffset})`);
          const modifiersWDecl: string[] = referenceDetails.modifiersWith('declaration');
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: labelName.length,
            ptTokenType: referenceDetails.type,
            ptTokenModifiers: modifiersWDecl
          });
          haveLabel = true;
        } else if (labelName.toUpperCase() == 'DITTO') {
          // if NOT version 50 color DITTO as bad
          if (!this.parseUtils.requestedSpinVersion(50)) {
            // if NOT version 50  DITTO and DITTO END are illegal
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: labelName.length,
              ptTokenType: 'variable',
              ptTokenModifiers: ['illegalUse']
            });
            this.semanticFindings.pushDiagnosticMessage(
              lineIdx,
              nameOffset,
              nameOffset + labelName.length,
              eSeverity.Error,
              `Illegal P2 DAT PAsm directive [${labelName}] for version < 50`
            );
            if (lineParts.length > 1) {
              // mrk our END as bad, too
              const argument: string = lineParts[1];
              nameOffset = line.indexOf(argument, currentOffset + labelName.length);
              if (argument.toUpperCase() == 'END') {
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: labelName.length,
                  ptTokenType: 'variable',
                  ptTokenModifiers: ['illegalUse']
                });
              }
            }
            haveLabel = true;
          }
        } else if (labelName.toLowerCase() != 'debug' && bIsAlsoDebugLine) {
          // hrmf... no global type???? this should be a label?
          this._logPASM(`  --  rDatPAsm() ERROR NOT A label=[${labelName}](${0 + 1})`);
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: labelName.length,
            ptTokenType: 'variable', // color this offender!
            ptTokenModifiers: ['illegalUse']
          });
          this.semanticFindings.pushDiagnosticMessage(
            lineIdx,
            nameOffset,
            nameOffset + labelName.length,
            eSeverity.Error,
            `Not a legal P2 pasm label [${labelName}]`
          );
          haveLabel = true;
        } else if (this.parseUtils.isP1AsmInstruction(labelName)) {
          // hrmf... no global type???? this should be a label?
          this._logPASM(`  --  DAT P1asm BAD label=[${labelName}](${0 + 1})`);
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: labelName.length,
            ptTokenType: 'variable', // color this offender!
            ptTokenModifiers: ['illegalUse']
          });
          this.semanticFindings.pushDiagnosticMessage(
            lineIdx,
            nameOffset,
            nameOffset + labelName.length,
            eSeverity.Error,
            'Not a legal P2 pasm label'
          );
          haveLabel = true;
        }
        currentOffset = nameOffset + labelName.length;
      }
      // late return allowing labe to be colored before exit
      if (bIsAlsoDebugLine) {
        const continuedLineSet: ContinuedLines = new ContinuedLines();
        const nonCommentDebugLine = this._getDebugNonCommentLineReturnComment(0, lineIdx, line, tokenSet);
        this._logSPIN(`  -- rDatPAsm() process inLinePAsmRHSStr=[${inLinePAsmRHSStr}](${inLinePAsmRHSStr.length})`);
        this._logSPIN(`  -- rDatPAsm() process nonCommentDebugLine=[${nonCommentDebugLine}](${nonCommentDebugLine.length})`);
        continuedLineSet.addLine(nonCommentDebugLine, lineIdx);
        const partialTokenSet: IParsedToken[] = this._reportDebugStatementMultiLine(startingOffset, continuedLineSet, IN_PASM);
        this._reportNonDupeTokens(partialTokenSet, '=> DATpasm: ', line, tokenSet);
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
          this._logPASM(
            `  -- rDatPAsm() !dataDecl lineParts=[${lineParts}](${lineParts.length}), argumentOffset=(${argumentOffset}), minNonLabelParts=(${minNonLabelParts})`
          );
          if (lineParts[argumentOffset].toUpperCase().startsWith('IF_') || lineParts[argumentOffset].toUpperCase().startsWith('_RET_')) {
            // skip our conditional
            argumentOffset++;
            minNonLabelParts++;
          }
          if (lineParts.length > minNonLabelParts) {
            // have at least instruction name
            const likelyInstructionName: string = lineParts[minNonLabelParts - 1];
            nameOffset = line.indexOf(likelyInstructionName, currentOffset);
            this._logPASM(`  -- rDatPAsm() likelyInstructionName=[${likelyInstructionName}], nameOffset=(${nameOffset})`);
            let bIsDittoLine: boolean = false;
            if (likelyInstructionName.toUpperCase() === 'DITTO') {
              // if version 50 color DITTO
              if (this.parseUtils.requestedSpinVersion(50)) {
                bIsDittoLine = true;
                // ditto start: highlight 'DITTO' token, then let argument be processed below
                // ditto end: highlight both 'DITTO' and  'END' tokens then continue
                this._logPASM(`  --  rDatPAsm() directive=[${likelyInstructionName}], ofs=(${nameOffset})`);
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: likelyInstructionName.length,
                  ptTokenType: 'directive',
                  ptTokenModifiers: []
                });
              } else {
                // if NOT version 50  DITTO and DITTO END are illegal
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: likelyInstructionName.length,
                  ptTokenType: 'variable',
                  ptTokenModifiers: ['illegalUse']
                });
                this.semanticFindings.pushDiagnosticMessage(
                  lineIdx,
                  nameOffset,
                  nameOffset + likelyInstructionName.length,
                  eSeverity.Error,
                  `Illegal P2 DAT PAsm directive [${likelyInstructionName}] for version < 50`
                );
              }
            }
            currentOffset = nameOffset + likelyInstructionName.length; // move past the instruction
            for (let index = minNonLabelParts; index < lineParts.length; index++) {
              let argumentName = lineParts[index].replace(/[@#]/, '');
              if (argumentName.length < 1 || argumentName === ':') {
                // skip empty operand or ":" left by splitter
                continue;
              }
              if (index == lineParts.length - 1 && this.parseUtils.isP2AsmEffect(argumentName)) {
                // conditional flag-set spec.
                this._logPASM('  -- SKIP argumentName=[' + argumentName + ']');
                continue;
              }
              if (argumentName.toLowerCase() === 'end') {
                // ditto end: highlight both 'DITTO' and  'END' tokens then continue
                // if version 50 color DITTO
                nameOffset = line.indexOf(argumentName, currentOffset);
                if (this.parseUtils.requestedSpinVersion(50) && bIsDittoLine) {
                  this._logPASM(`  --  rDatPAsm() directive=[${argumentName}], ofs=(${nameOffset})`);
                  // color our 'ditto end' token
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: argumentName.length,
                    ptTokenType: 'directive',
                    ptTokenModifiers: []
                  });
                } else {
                  // if NOT version 50  DITTO and DITTO END are illegal
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: lineParts[1].length,
                    ptTokenType: 'variable',
                    ptTokenModifiers: ['illegalUse']
                  });
                }
                continue;
              }
              const argHasArrayRereference: boolean = argumentName.includes('[');
              if (argHasArrayRereference) {
                const nameParts: string[] = argumentName.split('[');
                argumentName = nameParts[0];
              }
              if (argumentName.charAt(0).match(/[a-zA-Z_.:]/)) {
                // does name contain a namespace reference?
                this._logPASM(`  -- rDatPAsm() argumentName=[${argumentName}]`);
                let possibleNameSet: string[] = [argumentName];
                if (
                  !argumentName.startsWith('.') &&
                  !argumentName.startsWith(':') &&
                  argumentName.includes('.') &&
                  this._isPossibleObjectReference(argumentName)
                ) {
                  // go register object reference!
                  const bHaveObjReference = this._reportObjectReference(argumentName, lineIdx, currentOffset, line, tokenSet);
                  if (bHaveObjReference) {
                    currentOffset = currentOffset + argumentName.length;
                    continue;
                  }
                  possibleNameSet = argumentName.split('.');
                }
                this._logPASM(`  -- rDatPAsm() possibleNameSet=[${possibleNameSet}]`);
                const namePart = possibleNameSet[0];
                const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : `${possibleNameSet[0]}.${possibleNameSet[1]}`;
                nameOffset = line.indexOf(searchString, currentOffset);
                this._logPASM(`  --  rDatPAsm() searchString=[${searchString}], ofs=(${nameOffset})`);
                let referenceDetails: RememberedToken | undefined = undefined;
                if (this.semanticFindings.isGlobalToken(namePart)) {
                  referenceDetails = this.semanticFindings.getGlobalToken(namePart);
                  this._logPASM(`  --  FOUND global name=[${namePart}]`);
                }
                if (referenceDetails !== undefined) {
                  this._logPASM(`  --  rDatPAsm() name=[${namePart}](${nameOffset})`);
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: namePart.length,
                    ptTokenType: referenceDetails.type,
                    ptTokenModifiers: referenceDetails.modifiers
                  });
                } else if (this.parseUtils.isVersionAddedMethod(namePart)) {
                  this._logMessage(`  -- rDatPAsm()  ver added method=[${namePart}], ofs=(${nameOffset})`);
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: namePart.length,
                    ptTokenType: 'operator', // method is blue?!, function is yellow?!
                    ptTokenModifiers: ['builtin']
                  });
                } else {
                  // we use bIsDebugLine in next line so we don't flag debug() arguments!
                  if (
                    !this.parseUtils.isP2AsmReservedWord(namePart) &&
                    !this.parseUtils.isP2AsmInstruction(namePart) &&
                    !this.parseUtils.isP2AsmEffect(namePart) &&
                    !this.parseUtils.isBinaryOperator(namePart) &&
                    !this.parseUtils.isBuiltinStreamerReservedWord(namePart) &&
                    !this.parseUtils.isCoginitReservedSymbol(namePart) &&
                    !this.parseUtils.isTaskReservedSymbol(namePart) &&
                    !this.parseUtils.isP2AsmModczOperand(namePart) &&
                    !this.parseUtils.isDebugMethod(namePart) &&
                    !this.isStorageType(namePart) &&
                    !bIsAlsoDebugLine
                  ) {
                    this._logPASM('  --  rDatPAsm() MISSING name=[' + namePart + '], ofs=(' + nameOffset + ')');
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: namePart.length,
                      ptTokenType: 'variable',
                      ptTokenModifiers: ['illegalUse']
                    });
                    /*
                    if (namePart.startsWith(':')) {
                      this.semanticFindings.pushDiagnosticMessage(
                        lineIdx,
                        nameOffset,
                        nameOffset + namePart.length,
                        eSeverity.Error,
                        `P1 pasm local name [${namePart}] not supported in P2 pasm`
                      );
                  } else if (this.parseUtils.isP1AsmVariable(namePart)) {
                      */
                    if (this.parseUtils.isP1AsmVariable(namePart)) {
                      this.semanticFindings.pushDiagnosticMessage(
                        lineIdx,
                        nameOffset,
                        nameOffset + namePart.length,
                        eSeverity.Error,
                        `P1 pasm variable [${namePart}] not allowed in P2 pasm`
                      );
                    } else {
                      this.semanticFindings.pushDiagnosticMessage(
                        lineIdx,
                        nameOffset,
                        nameOffset + namePart.length,
                        eSeverity.Error,
                        `Missing P2 pasm name [${namePart}]`
                      );
                    }
                  }
                }
                currentOffset = nameOffset + namePart.length;
              }
            }
            if (this.parseUtils.isP1AsmInstruction(likelyInstructionName)) {
              const nameOffset: number = line.indexOf(likelyInstructionName, 0);
              this._logPASM('  --  DAT A P1asm BAD instru=[' + likelyInstructionName + '], ofs=(' + nameOffset + ')');
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: likelyInstructionName.length,
                ptTokenType: 'variable',
                ptTokenModifiers: ['illegalUse']
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
          this._logPASM('  --  DAT B P1asm BAD instru=[' + likelyInstructionName + '], ofs=(' + nameOffset + ')');
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: likelyInstructionName.length,
            ptTokenType: 'variable',
            ptTokenModifiers: ['illegalUse']
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
        const partialTokenSet: IParsedToken[] = this._reportDAT_ValueDeclarationCode(
          lineIdx,
          startingOffset,
          line,
          allowLocalVarStatus,
          this.showPAsmCode,
          IS_DAT_PASM
        );
        this._reportNonDupeTokens(partialTokenSet, '=> DATvalue: ', line, tokenSet);
      }
    }
    return tokenSet;
  }

  private _reportPUB_PRI_SignatureMultiLine(startingOffset: number, multiLineSet: ContinuedLines): IParsedToken[] {
    // PUB PRI method signature
    //
    // PUB|PRI MethodName({{^BYTE|^WORD|^LONG|^StructName} Parameter{, ...}})
    //    thru v44  {{BYTE|WORD|LONG} Parameter{, ...}}
    //     v45      {{BYTE|WORD|LONG|StructName} Parameter{, ...}}
    //     v49      {{^BYTE|^WORD|^LONG|^StructName} Parameter{, ...}}
    //   {: {^BYTE|^WORD|^LONG|^StructName} Result{, ...}}
    //    thru v44  {{BYTE|WORD|LONG} Result{, ...}}
    //     v45      {{BYTE|WORD|LONG|StructName} Result{, ...}}
    //     v49      {{^BYTE|^WORD|^LONG|^StructName} Result{, ...}}
    //   {| {ALIGNW|ALIGNL} {{^}BYTE|{^}WORD|{^}LONG|{^}StructName} LocalVar{[ArraySize]}{, ...}}
    //      thru v44   {ALIGNW|ALIGNL} {{{BYTE|WORD|LONG} LocalVar[arraySize]}{, ...}}
    //  v45 thru v48   {ALIGNW|ALIGNL} {BYTE|WORD|LONG|StructName} LocalVar[arraySize]}{, ...}}
    //           v49   {ALIGNW|ALIGNL} {{{^}BYTE|{^}WORD|{^}LONG|{^}StructName} LocalVar[arraySize]}{, ...}}
    //
    const tokenSet: IParsedToken[] = [];
    let currSingleLineOffset: number = this.parseUtils.skipWhite(multiLineSet.line, startingOffset);
    // FIXME: TODO: UNDONE - maybe we need to highlight comments which are NOT captured yet in multi-line set
    const remainingNonCommentLineStr: string = multiLineSet.line;
    const methodType = remainingNonCommentLineStr.substr(0, 3).toUpperCase();
    const isPrivate = methodType.indexOf('PRI') != -1;
    this._logSPIN(
      `- Ln#${
        multiLineSet.lineStartIdx + 1
      } rptPubPriSig() currSingleLineOffset=(${currSingleLineOffset}), methodType=[${methodType}], isPrivate=(${isPrivate}), remainingNonCommentLineStr=[${remainingNonCommentLineStr}]`
    );

    // -----------------------------------
    //   Method Name
    //
    const startNameOffset = currSingleLineOffset;
    // find open paren - skipping past method name
    const returnValueSep = remainingNonCommentLineStr.indexOf(':', currSingleLineOffset);
    const localVarsSep = remainingNonCommentLineStr.indexOf('|', returnValueSep != -1 ? returnValueSep : currSingleLineOffset);
    const openParenOffset = remainingNonCommentLineStr.indexOf('(', startNameOffset); // in spin1 ()'s are optional!
    const closeParenOffset = openParenOffset != -1 ? remainingNonCommentLineStr.indexOf(')', openParenOffset) : -1;
    currSingleLineOffset = openParenOffset;
    if (currSingleLineOffset == -1) {
      currSingleLineOffset = returnValueSep; // ":"
      if (currSingleLineOffset == -1) {
        currSingleLineOffset = localVarsSep; // "|"
        if (currSingleLineOffset == -1) {
          currSingleLineOffset = remainingNonCommentLineStr.indexOf(' ', startNameOffset);
          if (currSingleLineOffset == -1) {
            currSingleLineOffset = remainingNonCommentLineStr.indexOf("'", startNameOffset);
            if (currSingleLineOffset == -1) {
              currSingleLineOffset = remainingNonCommentLineStr.length;
            }
          }
        }
      }
    }
    const methodName: string = remainingNonCommentLineStr.substr(startNameOffset, currSingleLineOffset - startNameOffset).trim();
    const validMethodName: boolean = this.parseUtils.isValidSpinSymbolName(methodName);
    //this._logSPIN(`  -- rptPubPriSig() possibleMethodName=[${methodName}](${methodName.length}),isValid=(${validMethodName})`);
    if (!validMethodName) {
      return tokenSet;
    }
    currSingleLineOffset = startingOffset; // reset to beginnning of line
    this.currentMethodName = methodName; // notify of latest method name so we can track inLine PASM symbols

    const methodFollowString: string = remainingNonCommentLineStr.substring(startNameOffset + methodName.length);
    this._logSPIN(`  -- rptPubPriSig() methodFollowString=[${methodFollowString}](${methodFollowString.length})`);
    const bHaveSpin2Method: boolean = isMethodCall(methodFollowString);
    let symbolPosition: Position = multiLineSet.locateSymbol(methodName, currSingleLineOffset);
    let nameOffset: number = multiLineSet.offsetIntoLineForPosition(symbolPosition);
    this._logSPIN(`  -- rptPubPriSig() methodName=[${methodName}], startNameOffset=(${startNameOffset}), bHaveSpin2Method=(${bHaveSpin2Method})`);
    if (bHaveSpin2Method) {
      const declModifiers: string[] = isPrivate ? ['declaration', 'static'] : ['declaration'];
      this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
        line: symbolPosition.line,
        startCharacter: symbolPosition.character,
        length: methodName.length,
        ptTokenType: 'method',
        ptTokenModifiers: declModifiers
      });
    } else {
      // have a P1 style method declaration, flag it!
      const declModifiers: string[] = isPrivate ? ['declaration', 'static', 'illegalUse'] : ['declaration', 'illegalUse'];
      symbolPosition = multiLineSet.locateSymbol(methodName, currSingleLineOffset);
      nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
      this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
        line: symbolPosition.line,
        startCharacter: symbolPosition.character,
        length: methodName.length,
        ptTokenType: 'method',
        ptTokenModifiers: declModifiers
      });
      const methodPrefix: string = isPrivate ? 'PRI' : 'PUB';
      this.semanticFindings.pushDiagnosticMessage(
        symbolPosition.line,
        symbolPosition.character,
        symbolPosition.character + methodName.length,
        eSeverity.Error,
        `P1 Spin style declaration [${methodPrefix} ${methodName}] (without paren's) not allowed in P2 Spin`
      );
      this._logSPIN(`  -- rptPubPriSig() SPIN1 methodName=[${methodName}], startNameOffset=(${startNameOffset})`);
    }

    currSingleLineOffset = nameOffset + methodName.length;

    // -----------------------------------
    // record definition of method
    // -----------------------------------
    //
    // find close paren - so we can study parameters
    if (bHaveSpin2Method) {
      if (closeParenOffset != -1 && currSingleLineOffset + 1 != closeParenOffset) {
        //
        //   Parameter Variable(s)
        //    thru v44  {{BYTE|WORD|LONG} Parameter{, ...}}
        //     v45      {{BYTE|WORD|LONG|StructName} Parameter{, ...}}
        //     v49      {{^BYTE|^WORD|^LONG|^StructName} Parameter{, ...}}
        //
        const parameterStr = remainingNonCommentLineStr.substring(openParenOffset + 1, closeParenOffset).trim();
        const parameterStringPosition: Position = multiLineSet.locateSymbol(parameterStr, 0);
        //this._logSPIN(`  -- rptPubPriSig() parameterStr=[${parameterStr}](${parameterStr.length}), ofs=(${parameterStringPosition})`);
        let parameterNames: string[] = [];
        if (parameterStr.includes(',')) {
          // we have multiple parameters (recognize pointers!)
          parameterNames = parameterStr.split(/\s*,\s*/).filter(Boolean);
        } else {
          // we have one parameter
          parameterNames = [parameterStr];
        }
        const paramStartOffset: number = multiLineSet.offsetIntoLineForPosition(parameterStringPosition);
        this._logSPIN(`  -- rptPubPriSig() ----- parameterNames=[${parameterNames}](${parameterNames.length}), ofs=(${paramStartOffset})`);

        for (let index = 0; index < parameterNames.length; index++) {
          const paramNameRaw: string = parameterNames[index].trim();
          symbolPosition = multiLineSet.locateSymbol(paramNameRaw, currSingleLineOffset);
          const paramBaseOffset: number = multiLineSet.offsetIntoLineForPosition(symbolPosition);
          let nameOffset: number = multiLineSet.offsetIntoLineForPosition(symbolPosition);
          let paramName: string = paramNameRaw;
          const hasFlexSpinDefaultValue: boolean = paramName.includes('=');
          if (hasFlexSpinDefaultValue) {
            const assignmentParts: string[] = paramName.split('=');
            paramName = assignmentParts[0].trim();
          }
          let typeName: string = '';
          let structureType: string = '';
          let isPtr: boolean = false; // remember we have pointer
          // if we have structures we can have a structure name as a parameter type
          if (this.parseUtils.requestedSpinVersion(45)) {
            if (paramName.includes(' ')) {
              const nameParts: string[] = paramName.split(' ');
              if (nameParts.length > 1) {
                typeName = nameParts[0];
                paramName = nameParts[1];
                isPtr = typeName.charAt(0) === '^'; // remember we have pointer
                typeName = isPtr ? typeName.substring(1) : typeName; // remove ptr indicator
              }
            }
            this._logSPIN(
              `  -- rptPubPriSig() parameter typeName=[${typeName}](${typeName.length}), isPtr=(${isPtr}), paramNm=[${paramName}](${paramName.length}) : param[${index + 1} of ${parameterNames.length}]`
            );
            // if we have a structure typename color it!
            if (typeName.length > 0) {
              symbolPosition = multiLineSet.locateSymbol(typeName, paramBaseOffset);
              nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
              // at v49, we allow object.structure and object.structure pointer reference!
              const allowedObjRef: boolean = this.parseUtils.requestedSpinVersion(49);
              this._logSPIN(`  -- rptPubPriSig() parameter typeName=[${typeName}], ofs=(${nameOffset})`);
              let foundObjectRef: boolean = false;
              if (allowedObjRef && this._isPossibleObjectReference(typeName)) {
                // go register object TYPE-ONLY reference!
                foundObjectRef = this._reportObjectReference(
                  typeName,
                  symbolPosition.line,
                  symbolPosition.character,
                  multiLineSet.lineAt(symbolPosition.line),
                  tokenSet,
                  true
                );
                structureType = typeName;
              }
              if (!foundObjectRef) {
                // this should be structure or B/W/L type
                // at v45, we allow structure and structure pointer reference!
                const allowedStructRef: boolean = this.parseUtils.requestedSpinVersion(45) || allowedObjRef;
                const allowedPtrRef: boolean = this.parseUtils.requestedSpinVersion(45);
                // FIXME: UNDONE XYZZY alow structure as param if ptr (v49) or size <= 16 (v45)
                // if Structure or type name, color it!
                if (
                  (allowedStructRef && this.semanticFindings.isStructure(typeName)) ||
                  (this.parseUtils.isStorageType(typeName) && !isPtr) ||
                  allowedPtrRef
                ) {
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: symbolPosition.line,
                    startCharacter: symbolPosition.character,
                    length: typeName.length,
                    ptTokenType: 'storageType',
                    ptTokenModifiers: []
                  });
                  structureType = typeName;
                } else if (!this.parseUtils.isStorageType(typeName)) {
                  // bad type name, show error
                  const adjNameOffset = isPtr ? nameOffset - 1 : nameOffset;
                  const adjNameLength = isPtr ? typeName.length + 1 : typeName.length;
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: symbolPosition.line,
                    startCharacter: adjNameOffset,
                    length: adjNameLength,
                    ptTokenType: 'parameter',
                    ptTokenModifiers: ['illegalUse']
                  });
                  let errorMsg = `P2 Spin parameter type [${typeName}] Bad storage Type (not BYTE, WORD, LONG)`;
                  if (this.parseUtils.requestedSpinVersion(49)) {
                    errorMsg = `P2 Spin parameter type [${typeName}] Bad storage Type (not {^}BYTE, {^}WORD, {^}LONG, or ^structure)`;
                  }
                  this.semanticFindings.pushDiagnosticMessage(
                    symbolPosition.line,
                    adjNameOffset,
                    adjNameOffset + adjNameLength,
                    eSeverity.Error,
                    errorMsg
                  );
                }
              }
            }
          }
          // now color parameter variable name!
          symbolPosition = multiLineSet.locateSymbol(paramName, paramBaseOffset);
          nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
          this._logSPIN(`  -- rptPubPriSig() paramName=[${paramName}], ofs=(${nameOffset})`);
          // check to see if param name is hiding global variable
          if (this._hidesGlobalVariable(paramName)) {
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: symbolPosition.character,
              length: paramName.length,
              ptTokenType: 'parameter',
              ptTokenModifiers: ['illegalUse']
            });
            this.semanticFindings.pushDiagnosticMessage(
              symbolPosition.line,
              symbolPosition.character,
              symbolPosition.character + paramName.length,
              eSeverity.Error,
              `P2 Spin parameter [${paramName}] hides global variable of same name`
            );
          } else {
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: symbolPosition.character,
              length: paramName.length,
              ptTokenType: 'parameter',
              ptTokenModifiers: ['declaration', 'readonly', 'local']
            });
          }
          // if variable is a structure instance, say so
          if (structureType.length > 0) {
            // FIXME: should this be method scoped structure instance?
            this.semanticFindings.recordStructureInstance(structureType, paramName); // PUB/PRI
          }
          // remember so we can ID references
          this.semanticFindings.setLocalTokenForMethod(
            methodName,
            paramName,
            new RememberedToken('parameter', symbolPosition.line, symbolPosition.character, ['readonly', 'local']),
            this._declarationComment()
          ); // TOKEN SET in _rpt()

          if (hasFlexSpinDefaultValue) {
            this.semanticFindings.pushDiagnosticMessage(
              symbolPosition.line,
              symbolPosition.character,
              symbolPosition.character + paramNameRaw.length,
              eSeverity.Error,
              `Parameter default value [${paramNameRaw}] not allowed in P2 Spin`
            );
          }
          currSingleLineOffset = nameOffset + paramName.length;
        }
      }
      // -----------------------------------
      //   Return Variable(s)
      //    thru v44  {{BYTE|WORD|LONG} Result{, ...}}
      //     v45      {{BYTE|WORD|LONG|StructName} Result{, ...}}
      //     v49      {{^BYTE|^WORD|^LONG|^StructName} Result{, ...}}
      //
      // find return vars
      const returnVarsEnd = localVarsSep != -1 ? localVarsSep : remainingNonCommentLineStr.length;
      if (returnValueSep != -1) {
        // we have return var(s)!
        const varNamesStr = remainingNonCommentLineStr.substring(returnValueSep + 1, returnVarsEnd).trim();
        const varNamesPosition: Position = multiLineSet.locateSymbol(varNamesStr, currSingleLineOffset);
        const varNamesBaseOffset: number = multiLineSet.offsetIntoLineForPosition(varNamesPosition);
        this._logSPIN(`  -- rptPubPriSig()  ----- retNamesStr=[${varNamesStr}](${varNamesStr.length}), ofs=(${varNamesBaseOffset})`);
        // possibly have a single return value name
        let returnValueNames: string[] = [varNamesStr];
        if (varNamesStr.indexOf(',')) {
          // have multiple return value names
          returnValueNames = varNamesStr.split(/\s*,\s*/).filter(Boolean);
        }
        let varNameOffset: number = varNamesBaseOffset;
        this._logSPIN(`  -- rptPubPriSig() returnVarNamesAr=[${returnValueNames}](${returnValueNames.length}), ofs=(${varNameOffset})`);
        for (let index = 0; index < returnValueNames.length; index++) {
          let returnValueName = returnValueNames[index].trim();
          let symbolPosition: Position = multiLineSet.locateSymbol(returnValueName, varNameOffset);
          let nameOffset: number = multiLineSet.offsetIntoLineForPosition(symbolPosition);
          let typeName: string = '';
          let structureType: string = '';
          let isPtr: boolean = false;
          // if we have structures we can have a structure name as a parameter type
          if (returnValueName.includes(' ')) {
            const nameParts: string[] = returnValueName.split(' ');
            if (nameParts.length > 1) {
              typeName = nameParts[0];
              returnValueName = nameParts[1];
              isPtr = typeName.charAt(0) === '^'; // remember we have pointer
              typeName = isPtr ? typeName.substring(1) : typeName; // remove ptr indicator
            }
          }
          this._logSPIN(
            `  -- rptPubPriSig() returnVar typeName=[${typeName}](${typeName.length}), isPtr=(${isPtr}), retNm=[${returnValueName}](${returnValueName.length}) : retVar[${index + 1} of ${returnValueNames.length}]`
          );
          // if we have a structure typename color it!
          if (typeName.length > 0) {
            let foundObjectRef: boolean = false;
            symbolPosition = multiLineSet.locateSymbol(typeName, varNameOffset);
            nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
            // at v49, we allow object.structure and object.structure pointer reference!
            const allowedObjRef: boolean = this.parseUtils.requestedSpinVersion(49);
            this._logSPIN(`  -- rptPubPriSig() retVal typeName=[${typeName}], ofs=(${nameOffset})`);
            if (this._isPossibleObjectReference(typeName) && allowedObjRef) {
              // have structure pointer type
              // go register object TYPE-ONLY reference!
              foundObjectRef = this._reportObjectReference(
                typeName,
                symbolPosition.line,
                nameOffset,
                multiLineSet.lineAt(symbolPosition.line),
                tokenSet,
                true
              );
              if (foundObjectRef) {
                varNameOffset += typeName.length;
                structureType = typeName;
              }
            }
            if (!foundObjectRef) {
              // this should be structure or B/W/L type
              // at v45, we allow structure and structure pointer reference!
              const allowedStructRef: boolean = this.parseUtils.requestedSpinVersion(45) || allowedObjRef;
              const allowedPtrRef: boolean = this.parseUtils.requestedSpinVersion(45);
              // FIXME: UNDONE XYZZY alow structure as param if ptr (v49) or size <= 16 (v45)
              // if Structure or type name, color it!
              if (
                (this.semanticFindings.isStructure(typeName) && allowedStructRef) ||
                (this.parseUtils.isStorageType(typeName) && !isPtr) ||
                allowedPtrRef
              ) {
                // have structure pointer type
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: typeName.length,
                  ptTokenType: 'storageType',
                  ptTokenModifiers: []
                });
                varNameOffset += typeName.length;
                structureType = typeName;
              } else if (!this.parseUtils.isStorageType(typeName)) {
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: typeName.length,
                  ptTokenType: 'parameter',
                  ptTokenModifiers: ['illegalUse']
                });
                let errorMsg = `P2 Spin return-value type [${typeName}] Bad storage Type (not BYTE, WORD, LONG)`;
                if (this.parseUtils.requestedSpinVersion(49)) {
                  errorMsg = `P2 Spin return-value type [${typeName}] Bad storage Type (not {^}BYTE, {^}WORD, {^}LONG, or ^structure)`;
                }
                this.semanticFindings.pushDiagnosticMessage(
                  symbolPosition.line,
                  symbolPosition.character,
                  symbolPosition.character + typeName.length,
                  eSeverity.Error,
                  errorMsg
                );
              }
            }
          }
          // check to see if return name is hiding global variable
          symbolPosition = multiLineSet.locateSymbol(returnValueName, varNameOffset);
          nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
          if (this._hidesGlobalVariable(returnValueName)) {
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: symbolPosition.character,
              length: returnValueName.length,
              ptTokenType: 'returnValue',
              ptTokenModifiers: ['illegalUse']
            });
            this.semanticFindings.pushDiagnosticMessage(
              symbolPosition.line,
              symbolPosition.character,
              symbolPosition.character + returnValueName.length,
              eSeverity.Error,
              `P2 Spin return variable [${returnValueName}] hides global variable of same name`
            );
          } else {
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: symbolPosition.character,
              length: returnValueName.length,
              ptTokenType: 'returnValue',
              ptTokenModifiers: ['declaration', 'local']
            });
          }
          if (structureType.length > 0) {
            // remember this retVal is a structure instance
            this.semanticFindings.recordStructureInstance(structureType, returnValueName); // PUB/PRI
          }
          // remember so we can ID references
          this.semanticFindings.setLocalTokenForMethod(
            methodName,
            returnValueName,
            new RememberedToken('returnValue', symbolPosition.line, symbolPosition.character, ['local']),
            this._declarationComment()
          ); // TOKEN SET in _rpt()

          varNameOffset = nameOffset + returnValueName.length;
        }
      }
      currSingleLineOffset = nameOffset; // move partially ahead?
      // -----------------------------------
      //   Local Variable(s)
      //        thru v44   {ALIGNW|ALIGNL} {{{BYTE|WORD|LONG} LocalVar[arraySize]}{, ...}}
      //    v45 thru v48   {ALIGNW|ALIGNL} {BYTE|WORD|LONG|StructName} LocalVar[arraySize]}{, ...}}
      //             v49   {ALIGNW|ALIGNL} {{{^}BYTE|{^}WORD|{^}LONG|{^}StructName} LocalVar[arraySize]}{, ...}}
      //
      // find local vars
      if (localVarsSep != -1) {
        // we have local var(s)!
        //this._logSPIN(`  -- Multi remainingNonCommentLineStr=[${remainingNonCommentLineStr}](${remainingNonCommentLineStr.length})`);
        const localVarStr = remainingNonCommentLineStr.substring(localVarsSep + 1).trim();
        //this._logSPIN(
        //  `  -- rptPubPriSig() VarsSep=(${localVarsSep}), nonCommentEOL=(${nonCommentEOL}), localVarStr=[${localVarStr}](${localVarStr.length})`
        //);
        // we move currSingleLineOffset along so we don't falsely find short variable names earlier in string!
        currSingleLineOffset = localVarsSep;
        let localVarNames: string[] = [localVarStr];
        if (localVarStr.indexOf(',')) {
          // have multiple local var value names
          localVarNames = localVarStr.split(/\s*,\s*/).filter(Boolean);
        }
        this._logSPIN(`  -- rptPubPriSig() ----- LclVarNames=[${localVarNames}](${localVarNames.length})`);
        for (let index = 0; index < localVarNames.length; index++) {
          let localVariableName = localVarNames[index];
          const isPtr: boolean = localVariableName.charAt(0) === '^'; // remember we have pointer
          localVariableName = isPtr ? localVariableName.substring(1) : localVariableName; // remove ptr indicator
          const varNamePosition: Position = multiLineSet.locateSymbol(localVariableName, currSingleLineOffset);
          const varNameOffsetBase = multiLineSet.offsetIntoLineForPosition(varNamePosition);
          //const localVariableOffset = remainingNonCommentLineStr.indexOf(localVariableName, currSingleLineOffset);
          this._logSPIN(
            `  -- rptPubPriSig() localVar VarName=[${localVariableName}] isPtr=(${isPtr}), lclVar[${index + 1} of ${localVarNames.length}]`
          );
          let nameParts: string[] = [localVariableName];
          let possAlignType: string = '';
          let possStorageType: string = '';
          let possLocalVarName: string = '';
          const extraParts: string[] = [];
          if (localVariableName.includes(' ') || localVariableName.includes('\t') || localVariableName.includes('[')) {
            // have name with storage and/or alignment operators
            nameParts = localVariableName.split(/[ \t[\]]/).filter(Boolean);
            this._logSPIN(`  -- rptPubPriSig() split nameParts=[${nameParts}](${nameParts.length})`);
            for (let index = 0; index < nameParts.length; index++) {
              const element = nameParts[index];
              if (possAlignType.length == 0 && this.parseUtils.isAlignType(element)) {
                possAlignType = element;
                continue;
              }
              if ((possStorageType.length == 0 && this.parseUtils.isStorageType(element)) || this.semanticFindings.isStructure(element)) {
                possStorageType = element;
                continue;
              }
              if (possLocalVarName.length == 0 && this.parseUtils.isValidSpinSymbolName(element)) {
                possLocalVarName = element;
                continue;
              }
              if (this.parseUtils.isValidSpinSymbolName(element) || this.parseUtils.isValidSpinNumericConstant(element)) {
                extraParts.push(element);
              }
            }
          } else {
            this._logSPIN(`  -- rptPubPriSig() non-split nameParts=[${nameParts}](${nameParts.length})`);
            possLocalVarName = nameParts[0];
          }
          this._logSPIN(
            `  -- rptPubPriSig() localVar typeName=[${possAlignType}](${possAlignType.length}), isPtr=(${isPtr}), lclNm=[${possLocalVarName}](${possLocalVarName.length}) : lclVar[${index + 1} of ${localVarNames.length}]`
          );
          this._logSPIN(`  -- rptPubPriSig() extraParts=[${extraParts}](${extraParts.length})`);
          let symbolPosition: Position = Position.create(-1, -1);

          // ---------------------------
          // handle align value
          //
          if (possAlignType.length > 0) {
            symbolPosition = multiLineSet.locateSymbol(possAlignType, varNameOffsetBase);
            nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
            this._logMessage(`  -- checking Align type=[${possAlignType}], ofs=(${nameOffset})`);
            if (this.parseUtils.isAlignType(possAlignType)) {
              this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                line: symbolPosition.line,
                startCharacter: symbolPosition.character,
                length: possAlignType.length,
                ptTokenType: 'storageType',
                ptTokenModifiers: []
              });
            } else {
              this._logMessage(`  -- have illegal Align type! localName=[${possAlignType}], ofs=(${nameOffset})`);
              this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                line: symbolPosition.line,
                startCharacter: symbolPosition.character,
                length: possAlignType.length,
                ptTokenType: 'variable',
                ptTokenModifiers: ['illegalUse']
              });
              this.semanticFindings.pushDiagnosticMessage(
                symbolPosition.line,
                symbolPosition.character,
                symbolPosition.character + possAlignType.length,
                eSeverity.Error,
                `P2 Spin align [${possAlignType}] BAD must be one of [alignw|alignl]`
              );
            }
          }
          //
          // handle storage type
          //
          let structureType: string = '';
          if (possStorageType.length > 0) {
            let foundObjectRef: boolean = false;
            symbolPosition = multiLineSet.locateSymbol(possStorageType, varNameOffsetBase);
            nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
            this._logMessage(`  -- have Storage type! localName=[${possStorageType}], ofs=(${nameOffset})`);
            // at v49, we allow object.structure and object.structure pointer reference!
            const allowedObjRef: boolean = this.parseUtils.requestedSpinVersion(49);
            //  NOTE: the following "",true);"" changes _rptObjectReference() to ONLY report object.type references!
            if (this._isPossibleObjectReference(possStorageType) && allowedObjRef) {
              // go register object TYPE-ONLY reference!
              foundObjectRef = this._reportObjectReference(
                possStorageType,
                symbolPosition.line,
                symbolPosition.character,
                multiLineSet.lineAt(symbolPosition.line),
                tokenSet,
                true
              );
              if (foundObjectRef) {
                structureType = possStorageType;
              }
            }
            if (!foundObjectRef) {
              // have struct or BWL modifier!
              // at v45, we allow structure and structure pointer reference!
              const allowedStructRef: boolean = this.parseUtils.requestedSpinVersion(45) || allowedObjRef;
              const allowedPtrRef: boolean = this.parseUtils.requestedSpinVersion(45);
              // FIXME: UNDONE XYZZY alow structure as param if ptr (v49) or size <= 16 (v45)
              // if Structure or type name, color it!
              if (
                (this.semanticFindings.isStructure(possStorageType) && allowedStructRef) ||
                (this.parseUtils.isStorageType(possStorageType) && !isPtr) ||
                allowedPtrRef
              ) {
                this._logMessage(`  -- have Storage type! localName=[${possStorageType}], ofs=(${nameOffset})`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: possStorageType.length,
                  ptTokenType: 'storageType',
                  ptTokenModifiers: []
                });
                nameOffset += possStorageType.length;
                if (allowedStructRef && this.semanticFindings.isStructure(possStorageType)) {
                  // at v45, we allow structures as types for local vars!
                  structureType = possStorageType;
                }
              } else if (!this.parseUtils.isStorageType(possStorageType) && !this.parseUtils.isAlignType(possStorageType)) {
                this._logMessage(`  -- have unknown Storage type! localName=[${possStorageType}], ofs=(${nameOffset})`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: possStorageType.length,
                  ptTokenType: 'parameter',
                  ptTokenModifiers: ['illegalUse']
                });
                let errorMsg = `P2 Spin local var align/storage [${possStorageType}] Bad Type (not ALIGNW, ALIGNL, BYTE, WORD, or LONG)`;
                if (this.parseUtils.requestedSpinVersion(49)) {
                  errorMsg = `P2 Spin local var align/storage [${possStorageType}] Bad Type (not {^}BYTE, {^}WORD, {^}LONG, or {^}structure)`;
                } else if (this.parseUtils.requestedSpinVersion(45)) {
                  errorMsg = `P2 Spin local var align/storage [${possStorageType}] Bad Type (not ALIGNW, ALIGNL, BYTE, WORD, LONG, or structure)`;
                }
                this.semanticFindings.pushDiagnosticMessage(
                  symbolPosition.line,
                  symbolPosition.character,
                  symbolPosition.character + possStorageType.length,
                  eSeverity.Error,
                  errorMsg
                );
              }
            }
          }
          //
          // handle local variable
          //
          symbolPosition = multiLineSet.locateSymbol(possLocalVarName, varNameOffsetBase);
          nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
          this._logSPIN(`  -- localName=[${possLocalVarName}], ofs=(${nameOffset})`);
          // have name
          // check to see if local name is hiding global variable
          if (this._hidesGlobalVariable(possLocalVarName)) {
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: symbolPosition.character,
              length: possLocalVarName.length,
              ptTokenType: 'variable',
              ptTokenModifiers: ['illegalUse']
            });
            this.semanticFindings.pushDiagnosticMessage(
              symbolPosition.line,
              symbolPosition.character,
              symbolPosition.character + possLocalVarName.length,
              eSeverity.Error,
              `P2 Spin local [${possLocalVarName}] hides global variable of same name`
            );
          } else {
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: symbolPosition.character,
              length: possLocalVarName.length,
              ptTokenType: 'variable',
              ptTokenModifiers: ['declaration', 'local']
            });
          }
          if (structureType.length > 0) {
            // remember that this variable is a structure instance
            this.semanticFindings.recordStructureInstance(structureType, possLocalVarName); // PUB/PRI
          }
          // remember so we can ID references
          this.semanticFindings.setLocalTokenForMethod(
            methodName,
            possLocalVarName,
            new RememberedToken('variable', symbolPosition.line, symbolPosition.character, ['local']),
            this._declarationComment()
          ); // TOKEN SET in _rpt()

          // have name similar to scratch[12]?
          //
          // handle index value, first
          //
          if (extraParts.length > 0) {
            // yes remove array suffix
            const lineInfo: IFilteredStrings = this._getNonWhiteSpinLineParts(extraParts.join(' '));
            const localNameParts: string[] = lineInfo.lineParts;
            this._logSPIN(`  -- rptPubPriSig() post[] localNameWithIndexParts=[${localNameParts}]`);
            possLocalVarName = localNameParts[0];
            for (let index = 1; index < localNameParts.length; index++) {
              const namedIndexPart = localNameParts[index];
              symbolPosition = multiLineSet.locateSymbol(namedIndexPart, varNameOffsetBase);
              nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
              if (this.parseUtils.isValidSpinSymbolName(namedIndexPart)) {
                this._logSPIN(`  -- rptPubPriSig() checking namedIndexPart=[${namedIndexPart}]`);
                if (this._isPossibleObjectReference(namedIndexPart)) {
                  // go register object reference!
                  const bHaveObjReference: boolean = this._reportObjectReference(
                    namedIndexPart,
                    symbolPosition.line,
                    symbolPosition.character,
                    multiLineSet.lineAt(symbolPosition.line),
                    tokenSet
                  );
                  if (bHaveObjReference) {
                    continue;
                  }
                }
                let referenceDetails: RememberedToken | undefined = undefined;
                if (this.semanticFindings.isLocalToken(namedIndexPart)) {
                  referenceDetails = this.semanticFindings.getLocalTokenForLine(namedIndexPart, symbolPosition.line + 1);
                  this._logSPIN(`  --  FOUND local name=[${namedIndexPart}] found: ${referenceDetails !== undefined}`);
                } else if (this.semanticFindings.isGlobalToken(namedIndexPart)) {
                  referenceDetails = this.semanticFindings.getGlobalToken(namedIndexPart);
                  this._logSPIN(`  --  FOUND global name=[${namedIndexPart}] found: ${referenceDetails !== undefined}`);
                }
                if (referenceDetails !== undefined) {
                  this._logSPIN('  --  lcl-idx variableName=[' + namedIndexPart + '], ofs=(' + nameOffset + ')');
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: symbolPosition.line,
                    startCharacter: symbolPosition.character,
                    length: namedIndexPart.length,
                    ptTokenType: referenceDetails.type,
                    ptTokenModifiers: referenceDetails.modifiers
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
                    this._logSPIN(`  -- rptPubPriSig() NEW local varname=[${namedIndexPart}], ofs=(${nameOffset})`);
                    // check to see if local name is hiding global variable
                    if (this._hidesGlobalVariable(namedIndexPart)) {
                      this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                        line: symbolPosition.line,
                        startCharacter: symbolPosition.character,
                        length: namedIndexPart.length,
                        ptTokenType: 'variable',
                        ptTokenModifiers: ['illegalUse']
                      });
                      this.semanticFindings.pushDiagnosticMessage(
                        symbolPosition.line,
                        symbolPosition.character,
                        symbolPosition.character + namedIndexPart.length,
                        eSeverity.Error,
                        `P2 Spin local [${namedIndexPart}] hides global variable of same name`
                      );
                    } else {
                      // here with undefined index variable
                      this._logSPIN(`  --  PUB/PRI ERROR[CODE] unknown named index=[${namedIndexPart}]`);
                      this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                        line: symbolPosition.line,
                        startCharacter: symbolPosition.character,
                        length: namedIndexPart.length,
                        ptTokenType: 'variable',
                        ptTokenModifiers: ['illegalUse']
                      });
                      this.semanticFindings.pushDiagnosticMessage(
                        symbolPosition.line,
                        symbolPosition.character,
                        symbolPosition.character + namedIndexPart.length,
                        eSeverity.Error,
                        `P2 Spin local variable [${namedIndexPart}] index name unknown!`
                      );
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    return tokenSet;
  }

  private _hidesGlobalVariable(variableName: string): boolean {
    let hideStatus: boolean = false;
    //const referenceDetails: RememberedToken | undefined = undefined;
    if (this.semanticFindings.isGlobalToken(variableName)) {
      hideStatus = true;
    }
    return hideStatus;
  }

  private _reportSPIN_CodeMultiLine(startingOffset: number, multiLineSet: ContinuedLines): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    // skip Past Whitespace
    let currSingleLineOffset: number = this.parseUtils.skipWhite(multiLineSet.line, startingOffset);
    const nonCommentSpinLine = multiLineSet.line.substring(currSingleLineOffset);
    this._logSPIN(`- Ln#${multiLineSet.lineStartIdx + 1} rptSPIN() nonCommentSpinLine=[${nonCommentSpinLine}](${nonCommentSpinLine.length})`);
    if (nonCommentSpinLine.length > 0) {
      // special early error case
      let symbolPosition: Position = multiLineSet.locateSymbol('else if', currSingleLineOffset);
      let nameOffset: number = 0; // dummy, used later
      if (symbolPosition.character != -1) {
        this._logSPIN(`  --  Illegal ELSE-IF [${nonCommentSpinLine}]`);
        const tokenLength: number = 'else if'.length;
        this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
          line: symbolPosition.line,
          startCharacter: symbolPosition.character,
          length: tokenLength,
          ptTokenType: 'keyword',
          ptTokenModifiers: ['illegalUse']
        });
        this.semanticFindings.pushDiagnosticMessage(
          symbolPosition.line,
          symbolPosition.character,
          symbolPosition.character + tokenLength,
          eSeverity.Error,
          'Illegal "else if" form for P2 Spin'
        );
      }

      // FIXME: TODO: unwrap inline method calls within method calls
      // locate method(param1, param2, ...)
      const spinStatements: string[] = [];
      for (let index = 0; index < spinStatements.length; index++) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const element = spinStatements[index];
      }

      // locate key indicators of line style
      const assignmentCount: number = multiLineSet.line.split(':=').length - 1;
      const assignmentOffset: number = assignmentCount == 1 ? multiLineSet.line.indexOf(':=', currSingleLineOffset) : -1;
      if (assignmentOffset != -1) {
        // -------------------------------------------
        // have line assigning value to variable(s)
        //  Process LHS side of this assignment
        // -------------------------------------------
        const possibleVariableName = multiLineSet.line.substring(0, assignmentOffset).trim();
        this._logSPIN(`  -- rptSPIN() LHS: possibleVariableName=[${possibleVariableName}](${possibleVariableName.length})`);
        let varNameList: string[] = [possibleVariableName];
        if (possibleVariableName.includes(',')) {
          varNameList = possibleVariableName.split(',');
        }
        if (possibleVariableName.includes(' ')) {
          // force special case range chars to be removed
          //  Ex: RESP_OVER..RESP_NOT_FOUND : error_code.byte[3] := mod
          // change .. to : so it is removed by getNonWhite...
          const filteredLine: string = possibleVariableName.replace('..', ':');
          const lineInfo: IFilteredStrings = this._getNonWhiteSpinLineParts(filteredLine);
          varNameList = lineInfo.lineParts;
        }
        // FIXME: TODO: needs code to process index suff here..
        /*
        if (possibleVariableName.includes('[')) {
          // if variable contains index / index expression...
          const leftEdge: number = possibleVariableName.indexOf('[');
          const rightEdge: number = possibleVariableName.indexOf(']');
          if (leftEdge != -1 && rightEdge != -1 && leftEdge < rightEdge) {
            //
          }
        }*/
        this._logSPIN(`  -- rptSPIN() LHS: varNameList=[${varNameList.join(', ')}](${varNameList.length})`);
        for (let index = 0; index < varNameList.length; index++) {
          const variableName: string = varNameList[index];
          const haveIgnoreBuiltInSymbol: boolean = variableName === '_';
          if (!haveIgnoreBuiltInSymbol) {
            symbolPosition = multiLineSet.locateSymbol(variableName, currSingleLineOffset);
            nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
            this._logSPIN(`  -- rptSPIN() process variableName=[${variableName}](${variableName.length}), ofs=(${nameOffset})`);
          }
          // Ex: m.cmds[motor].cmd[m.head[motor]]  is varNameList.length == 1
          if (!haveIgnoreBuiltInSymbol && this._isPossibleStructureReference(variableName)) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [bHaveStructReference, refString] = this._reportStructureReference(
              variableName,
              symbolPosition.line,
              symbolPosition.character,
              multiLineSet.lineAt(symbolPosition.line),
              tokenSet
            );
            if (bHaveStructReference) {
              if (variableName !== refString) {
                this._logSPIN(
                  `  -- rptSPIN() A ERROR?! [${refString}](${refString.length}) is only part of [${variableName}](${variableName.length}), how to handle the rest?`
                );
              }
              currSingleLineOffset = nameOffset + refString.length;
              continue;
            }
          }
          if (variableName.includes('[')) {
            //
            //  Variable has array reference
            //
            // NOTE this handles code: byte[pColor][2] := {value}
            // NOTE2 this handles code: result.byte[3] := {value}  P2 OBEX: jm_apa102c.spin2 (139)
            // have complex target name, parse in loop
            const variableNameParts: string[] = variableName.split(/[ \t[\]/*+\-()<>]/).filter(Boolean);
            this._logSPIN(`  -- rptSPIN() LHS: is [] variableNameParts=[${variableNameParts.join(', ')}](${variableNameParts.length})`);
            for (let index = 0; index < variableNameParts.length; index++) {
              let variableNamePart = variableNameParts[index].replace('@', '');
              // secial case handle datar.[i] which leaves var name as 'darar.'
              if (variableNamePart.endsWith('.')) {
                variableNamePart = variableNamePart.substr(0, variableNamePart.length - 1);
              }
              if (this.parseUtils.isValidSpinSymbolName(variableNamePart)) {
                //const nameOffset = line.indexOf(variableNamePart, currSingleLineOffset);
                symbolPosition = multiLineSet.locateSymbol(variableNamePart, currSingleLineOffset);
                nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
                if (this._isPossibleObjectReference(variableNamePart)) {
                  // go register object reference!
                  const bHaveObjReference: boolean = this._reportObjectReference(
                    variableNamePart,
                    symbolPosition.line,
                    symbolPosition.character,
                    multiLineSet.lineAt(symbolPosition.line),
                    tokenSet
                  );
                  if (bHaveObjReference) {
                    currSingleLineOffset = nameOffset + variableNamePart.length;
                    continue;
                  }
                } else if (this._isPossibleStructureReference(variableNamePart)) {
                  const [bHaveStructReference, refString] = this._reportStructureReference(
                    variableNamePart,
                    symbolPosition.line,
                    symbolPosition.character,
                    multiLineSet.lineAt(symbolPosition.line),
                    tokenSet
                  );
                  if (bHaveStructReference) {
                    if (variableNamePart !== refString) {
                      this._logSPIN(
                        `  -- rptSPIN() B ERROR?! [${refString}](${refString.length}) is only part of [${variableNamePart}](${variableNamePart.length}), how to handle the rest?`
                      );
                    }
                    currSingleLineOffset = nameOffset + refString.length;
                    continue;
                  }
                }
                if (variableNamePart.includes('.')) {
                  const varNameParts: string[] = variableNamePart.split('.');
                  if (this.parseUtils.isDatStorageType(varNameParts[1])) {
                    variableNamePart = varNameParts[0]; // just use first part of name
                  }
                }
                this._logSPIN(`  -- rptSPIN() variableNamePart=[${variableNamePart}], ofs=(${nameOffset})`);
                if (this.isStorageType(variableNamePart)) {
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: symbolPosition.line,
                    startCharacter: symbolPosition.character,
                    length: variableNamePart.length,
                    ptTokenType: 'storageType',
                    ptTokenModifiers: []
                  });
                } else {
                  let referenceDetails: RememberedToken | undefined = undefined;
                  if (this.semanticFindings.isLocalToken(variableNamePart)) {
                    referenceDetails = this.semanticFindings.getLocalTokenForLine(variableNamePart, symbolPosition.line + 1);
                    this._logSPIN(`  --  FOUND local name=[${variableNamePart}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
                  } else if (this.semanticFindings.isGlobalToken(variableNamePart)) {
                    referenceDetails = this.semanticFindings.getGlobalToken(variableNamePart);
                    this._logSPIN(`  --  FOUND global name=[${variableNamePart}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
                  }
                  if (referenceDetails !== undefined) {
                    const modificationArray: string[] = referenceDetails.modifiersWith('modification');
                    this._logSPIN(`  -- rptSPIN() variableName=[${variableNamePart}], ofs=(${nameOffset})`);
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: variableNamePart.length,
                      ptTokenType: referenceDetails.type,
                      ptTokenModifiers: modificationArray
                    });
                  } else if (variableNamePart == '_') {
                    this._logSPIN(`  --  built-in=[${variableNamePart}], ofs=(${nameOffset})`);
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: variableNamePart.length,
                      ptTokenType: 'variable',
                      ptTokenModifiers: ['modification', 'defaultLibrary']
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
                      this._logSPIN(`  -- rptSPIN() MISSING varname=[${variableNamePart}], ofs=(${nameOffset})`);
                      this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                        line: symbolPosition.line,
                        startCharacter: nameOffset,
                        length: variableNamePart.length,
                        ptTokenType: 'variable',
                        ptTokenModifiers: ['modification', 'missingDeclaration']
                      });
                      this.semanticFindings.pushDiagnosticMessage(
                        symbolPosition.line,
                        symbolPosition.character,
                        symbolPosition.character + variableNamePart.length,
                        eSeverity.Error,
                        `P2 Spin mB missing declaration [${variableNamePart}]`
                      );
                    }
                  }
                }
              }
              currSingleLineOffset = nameOffset + variableNamePart.length + 1;
            }
          } else {
            //
            //  Variable without array reference
            //
            // have simple target name, no []
            const cleanedVariableName: string = variableName.replace(/[ \t()]/, '');
            //let nameOffset = line.indexOf(cleanedVariableName, currSingleLineOffset);
            const haveIgnoreBuiltInSymbol: boolean = cleanedVariableName === '_';
            if (!haveIgnoreBuiltInSymbol) {
              symbolPosition = multiLineSet.locateSymbol(cleanedVariableName, currSingleLineOffset);
              nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
              this._logSPIN(
                `  -- rptSPIN() LHS: not [] cleanedVariableName=[${cleanedVariableName}](${cleanedVariableName.length}), ofs=(${nameOffset})`
              );
            }
            // NOTE: skip special '_' skip-return value symbol?
            // do we have a symbol name?
            if (
              !haveIgnoreBuiltInSymbol &&
              this.parseUtils.isValidSpinSymbolName(cleanedVariableName) &&
              !this.parseUtils.isStorageType(cleanedVariableName) &&
              !this.parseUtils.isSpinSpecialMethod(cleanedVariableName)
            ) {
              this._logSPIN(`  -- rptSPIN()  symbol name=[${cleanedVariableName}](${cleanedVariableName.length}), ofs=(${nameOffset})`);
              // have structure type?
              if (this.semanticFindings.isStructure(cleanedVariableName)) {
                this._logSPIN(`  -- rptSPIN() STRUCT storageType=[${cleanedVariableName}]`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: cleanedVariableName.length,
                  ptTokenType: 'storageType',
                  ptTokenModifiers: []
                });
                currSingleLineOffset = nameOffset + cleanedVariableName.length;
              }
              // does name contain a namespace reference?
              let bHaveObjReference: boolean = false;
              let bHaveStructureReference: boolean = false;
              if (cleanedVariableName.includes('.')) {
                if (this._isPossibleObjectReference(cleanedVariableName)) {
                  bHaveObjReference = this._reportObjectReference(
                    cleanedVariableName,
                    symbolPosition.line,
                    symbolPosition.character,
                    multiLineSet.lineAt(symbolPosition.line),
                    tokenSet
                  );
                  if (bHaveObjReference) {
                    currSingleLineOffset = nameOffset + cleanedVariableName.length;
                  }
                } else if (this._isPossibleStructureReference(cleanedVariableName)) {
                  const [bHaveStructReference, refString] = this._reportStructureReference(
                    cleanedVariableName,
                    symbolPosition.line,
                    symbolPosition.character,
                    multiLineSet.lineAt(symbolPosition.line),
                    tokenSet
                  );
                  if (bHaveStructReference) {
                    bHaveStructureReference = true;
                    if (cleanedVariableName !== refString) {
                      this._logSPIN(
                        `  -- rptSPIN() C ERROR?! [${refString}](${refString.length}) is only part of [${cleanedVariableName}](${cleanedVariableName.length}), how to handle the rest?`
                      );
                    }
                    currSingleLineOffset = nameOffset + refString.length;
                  }
                }
              }
              if (!bHaveObjReference && !bHaveStructureReference) {
                let varNameParts: string[] = cleanedVariableName.split('.');
                this._logSPIN(`  --  varNameParts=[${varNameParts}]`);
                if (varNameParts.length > 1 && this.parseUtils.isDatStorageType(varNameParts[1])) {
                  varNameParts = [varNameParts[0]]; // just use first part of name
                }
                const namePart = varNameParts[0];
                const searchString: string = varNameParts.length == 1 ? varNameParts[0] : varNameParts[0] + '.' + varNameParts[1];
                //nameOffset = line.indexOf(searchString, currSingleLineOffset);
                symbolPosition = multiLineSet.locateSymbol(searchString, currSingleLineOffset);
                nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
                this._logSPIN(`  -- rptSPIN() LHS   searchString=[${searchString}]`);
                this._logSPIN(`  -- rptSPIN() LHS    nameOffset=(${nameOffset}), currSingleLineOffset=(${currSingleLineOffset})`);
                let referenceDetails: RememberedToken | undefined = undefined;
                if (this.semanticFindings.isLocalToken(namePart)) {
                  referenceDetails = this.semanticFindings.getLocalTokenForLine(namePart, symbolPosition.line + 1);
                  this._logSPIN(`  --  FOUND local name=[${namePart}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
                } else if (this.semanticFindings.isGlobalToken(namePart)) {
                  referenceDetails = this.semanticFindings.getGlobalToken(namePart);
                  this._logSPIN(`  --  FOUND global name=[${namePart}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
                  if (referenceDetails !== undefined && referenceDetails?.type == 'method') {
                    const addressOf = `@${namePart}`;
                    // if it's not a legit method call, kill the reference
                    //const searchSpace: string = multiLineSet.line.substring(nameOffset);
                    const methodFollowString: string = multiLineSet.line.substring(nameOffset + namePart.length);
                    this._logSPIN(`  -- rptSPIN()-A methodFollowString=[${methodFollowString}](${methodFollowString.length})`);
                    if (!isMethodCall(methodFollowString) && !searchString.includes(addressOf)) {
                      this._logSPIN(`  --  MISSING parens on method=[${namePart}]`);
                      referenceDetails = undefined;
                    }
                  }
                }
                if (referenceDetails !== undefined) {
                  this._logSPIN(`  -- rptSPIN() LHS name=[${namePart}](${namePart.length}), ofs=(${nameOffset})`);
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: symbolPosition.line,
                    startCharacter: symbolPosition.character,
                    length: namePart.length,
                    ptTokenType: referenceDetails.type,
                    ptTokenModifiers: referenceDetails.modifiers
                  });
                  currSingleLineOffset = nameOffset + namePart.length;
                } else {
                  //const searchKey: string = namePart.toLowerCase();
                  //const isMethodNoParen: boolean = searchKey == 'return' || searchKey == 'abort';
                  // have unknown name!? is storage type spec?
                  if (this.isStorageType(namePart)) {
                    this._logSPIN(`  -- rptSPIN() LHS storageType=[${namePart}]`);
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: namePart.length,
                      ptTokenType: 'storageType',
                      ptTokenModifiers: []
                    });
                  } else if (
                    this.parseUtils.isSpinBuiltinMethod(namePart) &&
                    !searchString.includes(namePart + '(') &&
                    !this.parseUtils.isSpinNoparenMethod(namePart)
                  ) {
                    // FIXME: TODO: replaces name-concat with regEX search past whitespace for '('
                    this._logSPIN(`  -- rptSPIN() MISSING PARENS name=[${namePart}]`);
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: namePart.length,
                      ptTokenType: 'method',
                      ptTokenModifiers: ['builtin', 'missingDeclaration']
                    });
                    this.semanticFindings.pushDiagnosticMessage(
                      symbolPosition.line,
                      symbolPosition.character,
                      symbolPosition.character + namePart.length,
                      eSeverity.Error,
                      `P2 Spin missing parens after [${namePart}]`
                    );
                  }
                  // we use bIsDebugLine in next line so we don't flag debug() arguments!
                  else if (
                    !this.parseUtils.isSpinReservedWord(namePart) &&
                    !this.parseUtils.isSpinBuiltinMethod(namePart) &&
                    !this.parseUtils.isBuiltinStreamerReservedWord(namePart) &&
                    !this.parseUtils.isCoginitReservedSymbol(namePart) &&
                    !this.parseUtils.isTaskReservedSymbol(namePart) &&
                    !this.parseUtils.isDebugMethod(namePart) &&
                    !this.parseUtils.isDebugControlSymbol(namePart) &&
                    !this.parseUtils.isDebugInvocation(namePart)
                  ) {
                    // NO DEBUG FOR ELSE, most of spin control elements come through here!
                    //else {
                    //    this._logSPIN('  -- UNKNOWN?? name=[' + namePart + '] - name-get-breakage??');
                    //}
                    this._logSPIN(`  -- rptSPIN() MISSING rhs name=[${namePart}]`);
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: nameOffset,
                      length: namePart.length,
                      ptTokenType: 'variable',
                      ptTokenModifiers: ['missingDeclaration']
                    });
                    this.semanticFindings.pushDiagnosticMessage(
                      symbolPosition.line,
                      symbolPosition.character,
                      symbolPosition.character + namePart.length,
                      eSeverity.Error,
                      `P2 Spin mC missing declaration [${namePart}]`
                    );
                  }
                  currSingleLineOffset = nameOffset + namePart.length;
                }
              } else {
                /*
                let referenceDetails: RememberedToken | undefined = undefined;
                //nameOffset = line.indexOf(cleanedVariableName, currSingleLineOffset);
                symbolPosition = multiLineSet.locateSymbol(cleanedVariableName, currSingleLineOffset);
                nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
                // handle "got." form of name...
                cleanedVariableName = cleanedVariableName.endsWith('.') ? cleanedVariableName.slice(0, -1) : cleanedVariableName;
                if (this.semanticFindings.isLocalToken(cleanedVariableName)) {
                  referenceDetails = this.semanticFindings.getLocalTokenForLine(cleanedVariableName, symbolPosition.line + 1);
                  this._logSPIN(`  --  FOUND local name=[${cleanedVariableName}, referenceDetails=[${referenceDetails}]]`);
                }
                if (!referenceDetails && this.semanticFindings.isGlobalToken(cleanedVariableName)) {
                  referenceDetails = this.semanticFindings.getGlobalToken(cleanedVariableName);
                  this._logSPIN(`  --  FOUND global name=[${cleanedVariableName}, referenceDetails=[${referenceDetails}]]`);
                }
                if (referenceDetails !== undefined) {
                  const modificationArray: string[] = referenceDetails.modifiersWith('modification');
                  this._logSPIN(`  -- spin: Multi simple variableName=[${cleanedVariableName}], ofs=(${nameOffset})`);
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: symbolPosition.line,
                    startCharacter: symbolPosition.character,
                    length: cleanedVariableName.length,
                    ptTokenType: referenceDetails.type,
                    ptTokenModifiers: modificationArray
                  });
                } else if (cleanedVariableName == '_') {
                  this._logSPIN(`  --  built-in=[${cleanedVariableName}], ofs=(${nameOffset})`);
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: symbolPosition.line,
                    startCharacter: symbolPosition.character,
                    length: cleanedVariableName.length,
                    ptTokenType: 'variable',
                    ptTokenModifiers: ['modification', 'defaultLibrary']
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
                    this._logSPIN(`  -- rptSPIN() MISSING cln name=[${cleanedVariableName}], ofs=(${nameOffset})`);
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: cleanedVariableName.length,
                      ptTokenType: 'variable',
                      ptTokenModifiers: ['modification', 'missingDeclaration']
                    });
                    this.semanticFindings.pushDiagnosticMessage(
                      symbolPosition.line,
                      symbolPosition.character,
                      symbolPosition.character + cleanedVariableName.length,
                      eSeverity.Error,
                      `P2 Spin mD missing declaration [${cleanedVariableName}]`
                    );
                  }
                }
                //*/
              }
            }
            //currSingleLineOffset = nameOffset + cleanedVariableName.length + 1;
          }
        }
        currSingleLineOffset = assignmentOffset + 2;
      }
      // -------------------------------------------
      // could be line with RHS of assignment or a
      //  line with no assignment (process it)
      // -------------------------------------------
      const lineType: string = assignmentOffset != -1 ? 'RHS' : 'non-assign';
      this._logSPIN(`  -- rptSPIN() LineEnd ${lineType} line=[${multiLineSet.line}](${multiLineSet.line.length}), ofs=(${currSingleLineOffset})`);
      // BUGFIX Handle line with empty after ':=' assignment operator

      let assignmentRHSStr: string = currSingleLineOffset < multiLineSet.line.length - 1 ? multiLineSet.line.substring(currSingleLineOffset) : '';
      let preCleanAssignmentRHSStr = assignmentRHSStr.length > 0 ? this.parseUtils.getNonInlineCommentLine(assignmentRHSStr).replace('..', '  ') : '';

      if (assignmentRHSStr.length == 0) {
        return tokenSet; // XYZZY 002
      }
      const dotOffset: number = assignmentRHSStr.indexOf('.');
      const spaceOffset: number = assignmentRHSStr.indexOf(' ');
      const tabOffset: number = assignmentRHSStr.indexOf('\t');
      // return lowest bracket offset, if it's not -1 we have a bracket pair
      const ltBbracketOffset: number = assignmentRHSStr.indexOf('[');
      const rtBbracketOffset: number = assignmentRHSStr.indexOf(']');
      const havePossIndex: boolean = ltBbracketOffset != -1 && rtBbracketOffset != -1 && ltBbracketOffset < rtBbracketOffset;
      // return T/F where T means there are parens
      const ltParenOffset: number = assignmentRHSStr.indexOf('(');
      const rtParenOffset: number = assignmentRHSStr.indexOf(')');
      const haveParens: boolean = ltParenOffset != -1 || rtParenOffset != -1;
      // return offset to first non-white space or -1 if none
      const whiteOffset: number = spaceOffset > tabOffset ? spaceOffset : tabOffset;
      const hasWhite: boolean = whiteOffset != -1;
      // we have a single element if we have "." with "[" and "[" is before "."
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const indexExpression: string = havePossIndex ? this._getIndexExpression(assignmentRHSStr.substring(ltBbracketOffset)) : ''; // dont' include the []
      //const indexHasWHiteSpace: boolean = indexExpression.indexOf(' ') != -1 || indexExpression.indexOf('\t') != -1;
      //const indexedObjectRef: boolean = dotOffset != -1 && havePossIndex ? true : false;
      let singleElement: boolean = dotOffset != -1 && ltBbracketOffset != -1 && dotOffset > ltBbracketOffset ? true : false;
      if (singleElement && hasWhite && ltParenOffset != -1 && ltParenOffset > whiteOffset) {
        // if whitespace before paren we have white in statement vs in parameter list
        singleElement = false;
      }
      if (singleElement && hasWhite && !haveParens) {
        // if whitespace without parens we have white in statement
        singleElement = false;
      }
      this._logSPIN(
        `  -- rptSPIN() assignmentRHSStr=[${assignmentRHSStr}](${assignmentRHSStr.length}), singleElement=(${singleElement}), ofs=(${currSingleLineOffset})`
      );
      // Ex: m.head[motor].[encod cmdcount - 1..0]++  // this is structure with trailing bitfield index
      symbolPosition = multiLineSet.locateSymbol(assignmentRHSStr, currSingleLineOffset);
      nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
      currSingleLineOffset = nameOffset;
      const KEEP_PACKED_CONSTANTS: boolean = true;
      const lineInfo: IFilteredStrings = this._getNonWhiteSpinLinePartsNonArray(preCleanAssignmentRHSStr, KEEP_PACKED_CONSTANTS);
      const possNames: string[] = lineInfo.lineParts;
      let symbolName: string = '';
      const nonStringAssignmentRHSStr: string = lineInfo.lineNoQuotes;
      if (possNames.length == 0) {
        this._logSPIN(`  -- rptSPIN() ERROR! =[${possNames}](${possNames.length})`);
      } else {
        this._logSPIN(`  -- rptSPIN() possNames=[${possNames}](${possNames.length})`);
        symbolName = possNames[0];
      }
      // SPECIAL case: handle case statements of value:instruction
      symbolPosition = multiLineSet.locateSymbol(symbolName, currSingleLineOffset);
      nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);

      let bFoundStructureRef: boolean = this._isPossibleStructureReference(symbolName);
      let bFoundObjRef: boolean = false;
      if (bFoundStructureRef) {
        const [bHaveStructReference, refString] = this._reportStructureReference(
          symbolName,
          symbolPosition.line,
          symbolPosition.character,
          multiLineSet.lineAt(symbolPosition.line),
          tokenSet
        );
        bFoundStructureRef = bHaveStructReference;
        if (bHaveStructReference) {
          // TODO: remove structure part from remainder of line and process the remainder
          if (assignmentRHSStr !== refString) {
            assignmentRHSStr = assignmentRHSStr.replace(`${refString}.`, '');
            preCleanAssignmentRHSStr = preCleanAssignmentRHSStr.replace(`${refString}.`, ''); // this gets used after the following object test
            this._logSPIN(
              `  -- rptSPIN() reduced assignmentRHSStr=[${assignmentRHSStr}](${assignmentRHSStr.length}), singleElement=(${singleElement})`
            );
          }
        }
      }
      // SPECIAL Ex: digits[(numberDigits - 1) - digitIdx].setValue(digitValue)
      // SPECIAL Ex: scroller[scrollerIndex].initialize()
      if (!bFoundStructureRef && this._isPossibleObjectReference(symbolName)) {
        const bHaveObjReference: boolean = this._reportObjectReference(
          symbolName,
          symbolPosition.line,
          symbolPosition.character,
          multiLineSet.lineAt(symbolPosition.line),
          tokenSet
        );
        if (bHaveObjReference) {
          bFoundObjRef = true;
        }
      }
      // special code to handle case range strings:  [e.g., SEG_TOP..SEG_BOTTOM:]
      //const isCaseValue: boolean = assignmentRHSStr.endsWith(':');
      //if (isCaseValue && possNames[0].includes("..")) {
      //    possNames = possNames[0].split("..");
      //}

      this._logSPIN(`  -- rptSPIN() possNames=[${possNames}](${possNames.length})`);
      const bIsDebugLine: boolean = haveDebugLine(nonStringAssignmentRHSStr);
      const assignmentStringOffset = currSingleLineOffset;
      this._logSPIN(`  -- rptSPIN() assignmentStringOffset=[${assignmentStringOffset}], bIsDebugLine=(${bIsDebugLine})`);
      let offsetInNonStringRHS = 0;
      let currNameLength: number = 0;
      this._logSPIN(
        `  -- rptSPIN() Multi upper loop start possNames=[${possNames.join(', ')}](${possNames.length}), currSingleLineOffset=(${currSingleLineOffset})`
      );
      for (let index = 0; index < possNames.length; index++) {
        let possibleName = possNames[index];
        symbolPosition = multiLineSet.locateSymbol(possibleName, currSingleLineOffset);
        nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
        // special code to handle case of var.[bitfield] leaving name a 'var.'
        if (possibleName.endsWith('.')) {
          possibleName = possibleName.substr(0, possibleName.length - 1);
        }
        this._logSPIN(
          `  -- rptSPIN() upper raw name=[${possibleName}](${possibleName.length}), ofs=(${nameOffset}) [${index + 1} of ${possNames.length}]`
        );
        // special code to handle case of @pasmName leaving name a 'var.'
        //if (possibleName.startsWith("@")) {
        //  possibleName = possibleName.substring(1); // remove leading char
        //}
        currNameLength = possibleName.length;
        const [paramIsNumber, paramIsSymbolName] = this.parseUtils.isValidSpinConstantOrSpinSymbol(possibleName);
        this._logSPIN(`  -- rptSPIN() name=[${possibleName}], paramIsNumber=(${paramIsNumber}), paramIsSymbolName=(${paramIsSymbolName})`);
        if (paramIsNumber) {
          this._logSPIN(`  -- rptSPIN() index is Number=[${possibleName}]`);
          this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
            line: symbolPosition.line,
            startCharacter: symbolPosition.character,
            length: possibleName.length,
            ptTokenType: 'number',
            ptTokenModifiers: []
          });
          currSingleLineOffset = nameOffset + possibleName.length;
          continue;
        } else if (paramIsSymbolName) {
          this._logSPIN(`  -- Spinm possibleName=[${possibleName}]`);
          offsetInNonStringRHS = nonStringAssignmentRHSStr.indexOf(possibleName, offsetInNonStringRHS);
          //nameOffset = offsetInNonStringRHS + assignmentStringOffset;
          let bHaveObjReference: boolean = false;
          let bHaveStructReference: boolean = false;
          if (possibleName.includes('.')) {
            if (this._isPossibleObjectReference(possibleName)) {
              bHaveObjReference = this._reportObjectReference(
                possibleName,
                symbolPosition.line,
                symbolPosition.character,
                multiLineSet.lineAt(symbolPosition.line),
                tokenSet
              );
            } else if (this._isPossibleStructureReference(possibleName)) {
              // might have STRUCT reference
              const [bIsStructReference, refString] = this._reportStructureReference(
                possibleName,
                symbolPosition.line,
                symbolPosition.character,
                multiLineSet.lineAt(symbolPosition.line),
                tokenSet
              );
              if (bIsStructReference) {
                bHaveStructReference = true;
                // TODO: remove structure part from remainder of line and process the remainder
                if (possibleName !== refString) {
                  this._logSPIN(
                    `  -- rptSPIN() E ERROR?! [${refString}](${refString.length}) is only part of [${possibleName}](${possibleName.length}), how to handle the rest?`
                  );
                }
              }
            }
          }
          if (!bHaveObjReference && !bHaveStructReference) {
            // does name contain a dotted reference?
            const isBitSubscript: boolean = possibleName.includes('.[');
            let isTypeOverride: boolean = false; // name.SpecialType
            let isIndexOverride: boolean = false; // SpecialType[name]
            let possibleNameSet: string[] = [possibleName];
            this._logSPIN(
              `  -- rptSPIN() possibleName=[${possibleName}](${possibleName.length}), possibleNameSet=[${possibleNameSet}](${possibleNameSet.length})`
            );
            if (possibleName.includes('.') || possibleName.includes('[')) {
              const complexSymbolPosition = multiLineSet.locateSymbol(possibleName, currSingleLineOffset);
              // set starting offset from here...
              currSingleLineOffset = multiLineSet.offsetIntoLineForPosition(complexSymbolPosition);
              possibleNameSet = possibleName.split(/[.[\]]/).filter(Boolean);
              const origNameSet = possibleNameSet;
              this._logSPIN(
                `  -- rptSPIN() origNameSet=[${origNameSet}](${origNameSet.length}) -> possibleNameSet=[${possibleNameSet}](${possibleNameSet.length})`
              );
              let typeSearchString: string = `${possibleNameSet[0]}.${possibleNameSet[1]}`;
              const overridePosition = multiLineSet.locateSymbol(typeSearchString, currSingleLineOffset);
              isTypeOverride = overridePosition.character != -1;
              this._logSPIN(`  -- rptSPIN() type HUNT='${typeSearchString}'(${typeSearchString.length}) -> (${isTypeOverride})`);
              typeSearchString = `${possibleNameSet[0]}[`;
              if (possibleNameSet[0] !== undefined && this.parseUtils.isSpecialIndexType(possibleNameSet[0])) {
                const indexPosition = multiLineSet.locateSymbol(typeSearchString, currSingleLineOffset);
                isIndexOverride = indexPosition.character != -1;
              }
              this._logSPIN(`  -- rptSPIN() index HUNT='${typeSearchString}'(${typeSearchString.length}) -> (${isIndexOverride})`);
            }
            const searchString: string =
              possibleNameSet.length == 1 || isBitSubscript ? possibleNameSet[0] : `${possibleNameSet[0]}.${possibleNameSet[1]}`;
            //nameOffset = nonStringAssignmentRHSStr.indexOf(searchString, offsetInNonStringRHS) + assignmentStringOffset; // so we don't match in in strings...
            this._logSPIN(`  -- rptSPIN() RHS  nonStringAssignmentRHSStr=[${nonStringAssignmentRHSStr}]`);
            this._logSPIN(
              `  -- rptSPIN() RHS   searchString=[${searchString}], isTypeOverride=(${isTypeOverride}), isIndexOverride=(${isIndexOverride})`
            );
            this._logSPIN(
              `  -- rptSPIN() RHS    nameOffset=(${nameOffset}), offsetInNonStringRHS=(${offsetInNonStringRHS}), currSingleLineOffset=(${currSingleLineOffset})`
            );
            const openParenLocation: number = nonStringAssignmentRHSStr.indexOf('(');
            const bNameIsPossibleMethodCall: boolean = openParenLocation != -1;
            const methodFollowString: string = bNameIsPossibleMethodCall ? nonStringAssignmentRHSStr.substring(openParenLocation) : '';

            this._logSPIN(
              `  -- rptSPIN() Multi lower loop start possNames=[${possNames.join(', ')}](${possNames.length}), currSingleLineOffset=(${currSingleLineOffset})`
            );
            for (let index = 0; index < possibleNameSet.length; index++) {
              const namePart = possibleNameSet[index];
              this._logSPIN(
                `  -- rptSPIN() lower raw name=[${namePart}](${namePart.length}), ofs=(${nameOffset}) [${index + 1} of ${possibleNameSet.length}]`
              );
              if (!this.parseUtils.isValidSpinSymbolName(namePart)) {
                nameOffset += namePart.length;
                continue;
              }
              symbolPosition = multiLineSet.locateSymbol(namePart, currSingleLineOffset);
              nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
              currNameLength = namePart.length;

              // if special type then override with special type
              if (this.parseUtils.isSpecialIndexType(namePart) && (isIndexOverride || isTypeOverride)) {
                // have a 'reg' of reg[cog-address][index].[bitfield]
                // have a 'byte' of byte[hub-address][index].[bitfield]
                // have a 'word' of word[hub-address][index].[bitfield]
                // have a 'long' of long[hub-address][index].[bitfield]
                this._logSPIN(`  -- rptSPIN() indexType=[${namePart}], ofs=(${nameOffset})`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: nameOffset,
                  length: namePart.length,
                  ptTokenType: 'operator', // method is blue?!, function is yellow?!
                  ptTokenModifiers: ['builtin']
                });
                currSingleLineOffset = nameOffset + namePart.length;
                continue;
              }
              // if new  debug method in later version then highlight it
              if (this.parseUtils.isNewlyAddedDebugSymbol(namePart)) {
                this._logSPIN(`  -- rptSPIN() new DEBUG name=[${namePart}](${namePart.length}), ofs=(${nameOffset})`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: namePart.length,
                  ptTokenType: 'debug',
                  ptTokenModifiers: ['function']
                });
                nameOffset += namePart.length;
                continue;
              }
              let referenceDetails: RememberedToken | undefined = undefined;
              if (this.semanticFindings.isLocalToken(namePart)) {
                referenceDetails = this.semanticFindings.getLocalTokenForLine(namePart, symbolPosition.line + 1);
                this._logSPIN(`  --  FOUND Local name=[${namePart}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
              }
              if (!referenceDetails && this.semanticFindings.isGlobalToken(namePart)) {
                referenceDetails = this.semanticFindings.getGlobalToken(namePart);
                this._logSPIN(`  --  FOUND Global name=[${namePart}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
                if (referenceDetails !== undefined && referenceDetails.type == 'method') {
                  const addressOf = `@${namePart}`;
                  this._logSPIN(`  -- rptSPIN()-B methodFollowString=[${methodFollowString}](${methodFollowString.length})`);
                  if (!isMethodCall(methodFollowString) && !nonStringAssignmentRHSStr.includes(addressOf)) {
                    this._logSPIN(`  --  MISSING parens on method=[${namePart}]`);
                    referenceDetails = undefined;
                  }
                }
              }
              if (referenceDetails !== undefined) {
                this._logSPIN(`  -- rptSPIN() Bm RHS name=[${namePart}](${namePart.length}), ofs=(${nameOffset})`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: namePart.length,
                  ptTokenType: referenceDetails.type,
                  ptTokenModifiers: referenceDetails.modifiers
                });
              } else {
                if (this.parseUtils.isTaskReservedSymbol(namePart) || this.parseUtils.isTaskReservedRegisterName(namePart)) {
                  this._logSPIN(`  --  override with constant coloring name=[${namePart}](${namePart.length}), ofs=(${nameOffset})`);
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: symbolPosition.line,
                    startCharacter: symbolPosition.character,
                    length: namePart.length,
                    ptTokenType: 'variable',
                    ptTokenModifiers: ['declaration', 'readonly']
                  });
                } else {
                  const methodFollowString: string = multiLineSet.lineAt(symbolPosition.line).substring(nameOffset + namePart.length);
                  this._logSPIN(`  -- rptSPIN()-C methodFollowString=[${methodFollowString}](${methodFollowString.length})`);
                  if (this.parseUtils.isSpinBuiltinMethod(namePart) && isMethodCall(methodFollowString)) {
                    this._logSPIN(`  --  override with method coloring name=[${namePart}](${namePart.length}), ofs=(${nameOffset})`);
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: namePart.length,
                      ptTokenType: 'function', // method is blue?!, function is yellow?!, operator is violet?!
                      ptTokenModifiers: ['support']
                    });
                  } else if (
                    this.parseUtils.isFloatConversion(namePart) &&
                    (nonStringAssignmentRHSStr.indexOf(namePart + '(') == -1 || nonStringAssignmentRHSStr.indexOf(namePart + '()') != -1)
                  ) {
                    // FIXME: TODO: replaces name-concat with regEX search past whitespace for '('  (ABOVE LINEs)
                    this._logSPIN(`  -- rptSPIN() MISSING PARENS name=[${namePart}]`);
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: namePart.length,
                      ptTokenType: 'method',
                      ptTokenModifiers: ['builtin', 'missingDeclaration']
                    });
                    this.semanticFindings.pushDiagnosticMessage(
                      symbolPosition.line,
                      symbolPosition.character,
                      symbolPosition.character + namePart.length,
                      eSeverity.Error,
                      'P2 Spin missing parens'
                    );
                  } else if (this.isStorageType(namePart) && !isMethodCall(methodFollowString)) {
                    // have unknown name!? is storage type spec?
                    this._logSPIN(`  -- rptSPIN() RHS storageType=[${namePart}]`);
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: namePart.length,
                      ptTokenType: 'storageType',
                      ptTokenModifiers: []
                    });
                  } else if (
                    this.parseUtils.isSpinBuiltinMethod(namePart) &&
                    !nonStringAssignmentRHSStr.includes(namePart + '(') &&
                    !this.parseUtils.isSpinNoparenMethod(namePart)
                  ) {
                    // FIXME: TODO: replaces name-concat with regEX search past whitespace for '('
                    this._logSPIN(`  -- rptSPIN() MISSING PARENS name=[${namePart}]`);
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: namePart.length,
                      ptTokenType: 'method',
                      ptTokenModifiers: ['builtin', 'missingDeclaration']
                    });
                    this.semanticFindings.pushDiagnosticMessage(
                      symbolPosition.line,
                      symbolPosition.character,
                      symbolPosition.character + namePart.length,
                      eSeverity.Error,
                      'P2 Spin missing parens'
                    );
                  }
                  // we use bIsDebugLine in next line so we don't flag debug() arguments!
                  else if (
                    !this.parseUtils.isSpinReservedWord(namePart) &&
                    !this.parseUtils.isSpinBuiltinMethod(namePart) &&
                    !this.parseUtils.isBuiltinStreamerReservedWord(namePart) &&
                    !this.parseUtils.isSpinSpecialMethod(namePart) &&
                    !this.parseUtils.isCoginitReservedSymbol(namePart) &&
                    !this.parseUtils.isTaskReservedSymbol(namePart) &&
                    !this.parseUtils.isDebugMethod(namePart) &&
                    !this.parseUtils.isDebugControlSymbol(namePart) &&
                    !bIsDebugLine &&
                    !this.parseUtils.isDebugInvocation(namePart)
                  ) {
                    // NO DEBUG FOR ELSE, most of spin control elements come through here!
                    //else {
                    //    this._logSPIN('  -- UNKNOWN?? name=[' + namePart + '] - name-get-breakage??');
                    //}

                    this._logSPIN(`  -- rptSPIN() MISSING rhs name=[${namePart}]`);
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: namePart.length,
                      ptTokenType: 'variable',
                      ptTokenModifiers: ['missingDeclaration']
                    });
                    if (this.parseUtils.isP1SpinMethod(namePart)) {
                      this.semanticFindings.pushDiagnosticMessage(
                        symbolPosition.line,
                        symbolPosition.character,
                        symbolPosition.character + namePart.length,
                        eSeverity.Error,
                        `P1 Spin method [${namePart}()] not allowed in P2 Spin`
                      );
                    } else if (this.parseUtils.isP1AsmVariable(namePart)) {
                      this.semanticFindings.pushDiagnosticMessage(
                        symbolPosition.line,
                        symbolPosition.character,
                        symbolPosition.character + namePart.length,
                        eSeverity.Error,
                        `P1 Pasm reserved word [${namePart}] not allowed in P2 Spin`
                      );
                    } else if (this.parseUtils.isP1SpinVariable(namePart)) {
                      this.semanticFindings.pushDiagnosticMessage(
                        symbolPosition.line,
                        symbolPosition.character,
                        symbolPosition.character + namePart.length,
                        eSeverity.Error,
                        `P1 Spin variable [${namePart}] not allowed in P2 Spin`
                      );
                    } else {
                      this.semanticFindings.pushDiagnosticMessage(
                        symbolPosition.line,
                        symbolPosition.character,
                        symbolPosition.character + namePart.length,
                        eSeverity.Error,
                        `P2 Spin mE missing declaration [${namePart}]`
                      );
                    }
                  }
                  currNameLength = namePart.length;
                }
              }
            }
          } else {
            // found object ref. include it in length
            currNameLength = possibleName.length;
          }
        } else if (possibleName.startsWith('.')) {
          const externalMethodName: string = possibleName.replace('.', '');
          currNameLength = externalMethodName.length;
          //nameOffset = nonStringAssignmentRHSStr.indexOf(externalMethodName, offsetInNonStringRHS) + currSingleLineOffset;
          symbolPosition = multiLineSet.locateSymbol(externalMethodName, currSingleLineOffset);
          nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
          this._logSPIN(`  -- rptSPIN() rhs externalMethodName=[${externalMethodName}](${externalMethodName.length}), ofs=(${nameOffset})`);
          this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
            line: symbolPosition.line,
            startCharacter: symbolPosition.character,
            length: externalMethodName.length,
            ptTokenType: 'method',
            ptTokenModifiers: []
          });
        }
        offsetInNonStringRHS += currNameLength + 1;
        currSingleLineOffset = nameOffset > 0 ? nameOffset + currNameLength : currSingleLineOffset + currNameLength;
        this._logSPIN(
          `  -- rptSPIN() Multi loop currSingleLineOffset=(${currSingleLineOffset}) <-- nameOffset=(${nameOffset}), currNameLength=(${currNameLength})`
        );
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
    this._logPASM(`- Ln#${lineIdx + 1} process rptSPINPAsm() inLinePAsmRHSStr=[${inLinePAsmRHSStr}](${inLinePAsmRHSStr.length})`);
    if (inLinePAsmRHSStr.length > 0) {
      const lineParts: string[] = this.parseUtils.getNonWhitePAsmLineParts(inLinePAsmRHSStr);
      this._logPASM(`  -- rptSPINPAsm() lineParts=[${lineParts}](${lineParts.length})`);
      const bIsAlsoDebugLine: boolean = haveDebugLine(inLinePAsmRHSStr);
      if (bIsAlsoDebugLine) {
        const continuedLineSet: ContinuedLines = new ContinuedLines();
        const nonCommentDebugLine = this._getDebugNonCommentLineReturnComment(0, lineIdx, line, tokenSet);
        this._logPASM(`- rptSPINPAsm() nonCommentDebugLine=[${nonCommentDebugLine}](${nonCommentDebugLine.length})`);
        continuedLineSet.addLine(nonCommentDebugLine, lineIdx);
        const IN_PASM: boolean = true;
        const partialTokenSet: IParsedToken[] = this._reportDebugStatementMultiLine(startingOffset, continuedLineSet, IN_PASM);
        this._reportNonDupeTokens(partialTokenSet, '=> SPINpasm: ', line, tokenSet);
      }
      // handle name in as first part of line...
      // (process label/variable name (but 'debug' of debug() is NOT a label!))
      let haveLabel: boolean = this.parseUtils.isDatOrPAsmLabel(lineParts[0]) && lineParts[0].toLowerCase() != 'debug';
      const isDataDeclarationLine: boolean = lineParts.length > 1 && haveLabel && this.parseUtils.isDatStorageType(lineParts[1]) ? true : false;
      if (haveLabel) {
        const labelName: string = lineParts[0];
        this._logPASM('  -- rptSPINPAsm() labelName=[' + labelName + ']');
        const labelType: string = isDataDeclarationLine ? 'variable' : 'label';
        const nameOffset: number = line.indexOf(labelName, currentOffset);
        let labelModifiers: string[] = ['declaration'];
        if (!isDataDeclarationLine && (labelName.startsWith('.') || labelName.startsWith(':'))) {
          labelModifiers = ['declaration', 'static'];
        }
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: nameOffset,
          length: labelName.length,
          ptTokenType: labelType,
          ptTokenModifiers: labelModifiers
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
          if (lineParts[argumentOffset].toUpperCase().startsWith('IF_') || lineParts[argumentOffset].toUpperCase().startsWith('_RET_')) {
            // skip our conditional
            argumentOffset++;
            minNonLabelParts++;
          }
          const possibleDirective: string = lineParts[argumentOffset];
          if (possibleDirective.toUpperCase() == 'FILE') {
            // we have illegal so flag it and abort handling rest of line
            this._logPASM('  -- rptSPINPAsm() ERROR[CODE] illegal directive=[' + possibleDirective + ']');
            const nameOffset: number = line.indexOf(possibleDirective, currentOffset);
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: possibleDirective.length,
              ptTokenType: 'variable',
              ptTokenModifiers: ['illegalUse']
            });
            this.semanticFindings.pushDiagnosticMessage(
              lineIdx,
              nameOffset,
              nameOffset + possibleDirective.length,
              eSeverity.Error,
              `Illegal P2 Spin inline-pasm directive [${possibleDirective}]`
            );
          } else if (possibleDirective.toUpperCase() == 'DITTO') {
            // if version 50 color DITTO
            this._logPASM('  -- rptSPINPAsm() DITTO directive=[' + possibleDirective + ']');
            let nameOffset: number = line.indexOf(possibleDirective, currentOffset);
            if (this.parseUtils.requestedSpinVersion(50)) {
              // color our 'ditto' token
              this._logPASM('  -- rptSPINPAsm() add name=[' + possibleDirective + ']');
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: possibleDirective.length,
                ptTokenType: 'directive',
                ptTokenModifiers: []
              });
              if (lineParts[1].toUpperCase() == 'END') {
                // color our 'ditto end' token
                nameOffset = line.indexOf(lineParts[1], nameOffset + possibleDirective.length);
                this._logPASM('  -- rptSPINPAsm() add name=[' + lineParts[1] + ']');
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: lineParts[1].length,
                  ptTokenType: 'directive',
                  ptTokenModifiers: []
                });
              }
            } else {
              // if NOT version 50  DITTO and DITTO END are illegal
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: possibleDirective.length,
                ptTokenType: 'variable',
                ptTokenModifiers: ['illegalUse']
              });
              this.semanticFindings.pushDiagnosticMessage(
                lineIdx,
                nameOffset,
                nameOffset + possibleDirective.length,
                eSeverity.Error,
                `Illegal P2 Spin inline-pasm directive [${possibleDirective}]`
              );
              if (lineParts[1].toUpperCase() == 'END') {
                // color our 'ditto end' token
                nameOffset = line.indexOf(lineParts[1], nameOffset + possibleDirective.length);
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: lineParts[1].length,
                  ptTokenType: 'variable',
                  ptTokenModifiers: ['illegalUse']
                });
              }
            }
          } else {
            if (lineParts.length > minNonLabelParts) {
              currentOffset = line.indexOf(lineParts[minNonLabelParts - 1], currentOffset) + lineParts[minNonLabelParts - 1].length + 1;
              let nameOffset: number = 0;
              let namePart: string = '';
              for (let index = minNonLabelParts; index < lineParts.length; index++) {
                const argumentName = lineParts[index].replace(/[@#]/, '');
                if (argumentName.length < 1) {
                  // skip empty operand
                  continue;
                }
                if (index == lineParts.length - 1 && this.parseUtils.isP2AsmEffect(argumentName)) {
                  // conditional flag-set spec.
                  this._logPASM('  -- rptSPINPAsm()SKIP argumentName=[' + argumentName + ']');
                  continue;
                }
                //const currArgumentLen = argumentName.length;
                if (argumentName.charAt(0).match(/[a-zA-Z_.]/)) {
                  // is name an illegal function for inline pasm data declaration?

                  if (argumentName.toLocaleLowerCase() == 'nan') {
                    nameOffset = line.indexOf(argumentName, currentOffset);
                    this._logPASM('  -- rptSPINPAsm() name=[' + argumentName + ']');
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: argumentName.length,
                      ptTokenType: 'variable',
                      ptTokenModifiers: ['missingDeclaration']
                    });
                    this.semanticFindings.pushDiagnosticMessage(
                      lineIdx,
                      nameOffset,
                      nameOffset + argumentName.length,
                      eSeverity.Error,
                      `P2 Spin Math Method [${argumentName}] now allowed here`
                    );
                    currentOffset = currentOffset + argumentName.length;
                    continue;
                  }
                  // does name contain a namespace reference?
                  this._logPASM(`  -- rptSPINPAsm() argumentName=[${argumentName}]`);
                  if (this._isPossibleObjectReference(argumentName)) {
                    const bHaveObjReference = this._reportObjectReference(argumentName, lineIdx, currentOffset, line, tokenSet);
                    if (bHaveObjReference) {
                      currentOffset = currentOffset + argumentName.length;
                      continue;
                    }
                  }
                  let possibleNameSet: string[] = [argumentName];
                  if (argumentName.includes('.') && !argumentName.startsWith('.')) {
                    possibleNameSet = argumentName.split('.');
                  }
                  this._logPASM('  -- rptSPINPAsm() possibleNameSet=[' + possibleNameSet + ']');
                  namePart = possibleNameSet[0];
                  const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : `${possibleNameSet[0]}.${possibleNameSet[1]}`;
                  nameOffset = line.indexOf(searchString, currentOffset);
                  let referenceDetails: RememberedToken | undefined = undefined;
                  if (this.semanticFindings.hasLocalPAsmTokenForMethod(this.currentMethodName, namePart)) {
                    referenceDetails = this.semanticFindings.getLocalPAsmTokenForMethod(this.currentMethodName, namePart);
                    this._logPASM('  --  FOUND local PASM name=[' + namePart + ']');
                  } else if (this.semanticFindings.isLocalToken(namePart)) {
                    referenceDetails = this.semanticFindings.getLocalTokenForLine(namePart, lineNbr);
                    this._logPASM('  --  FOUND local name=[' + namePart + ']');
                  } else if (this.semanticFindings.isGlobalToken(namePart)) {
                    referenceDetails = this.semanticFindings.getGlobalToken(namePart);
                    this._logPASM('  --  FOUND global name=[' + namePart + ']');
                  }
                  if (referenceDetails !== undefined) {
                    this._logPASM('  -- rptSPINPAsm() add name=[' + namePart + ']');
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: namePart.length,
                      ptTokenType: referenceDetails.type,
                      ptTokenModifiers: referenceDetails.modifiers
                    });
                  } else {
                    // we don't have name registered so just mark it
                    if (namePart != '.') {
                      // odd special case!
                      if (
                        !this.parseUtils.isSpinReservedWord(namePart) &&
                        !this.parseUtils.isBuiltinStreamerReservedWord(namePart) &&
                        !this.parseUtils.isDebugMethod(namePart) &&
                        !this.parseUtils.isP2AsmModczOperand(namePart)
                      ) {
                        this._logPASM('  -- rptSPINPAsm() PAsm MISSING name=[' + namePart + ']');
                        this._recordToken(tokenSet, line, {
                          line: lineIdx,
                          startCharacter: nameOffset,
                          length: namePart.length,
                          ptTokenType: 'variable',
                          ptTokenModifiers: ['missingDeclaration']
                        });
                        this.semanticFindings.pushDiagnosticMessage(
                          lineIdx,
                          nameOffset,
                          nameOffset + namePart.length,
                          eSeverity.Error,
                          `P2 Spin pasm missing declaration [${namePart}]`
                        );
                      } else if (this.parseUtils.isIllegalInlinePAsmDirective(namePart)) {
                        this._logPASM('  -- rptSPINPAsm() ERROR[CODE] illegal name=[' + namePart + ']');
                        this._recordToken(tokenSet, line, {
                          line: lineIdx,
                          startCharacter: nameOffset,
                          length: namePart.length,
                          ptTokenType: 'variable',
                          ptTokenModifiers: ['illegalUse']
                        });
                        this.semanticFindings.pushDiagnosticMessage(
                          lineIdx,
                          nameOffset,
                          nameOffset + possibleDirective.length,
                          eSeverity.Error,
                          'Illegal P2 Spin inline-pasm name'
                        );
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
              this._logPASM('  -- rptSPINPAsm() inline-PAsm MISSING name=[' + nameOrDirective + ']');
              const nameOffset = line.indexOf(nameOrDirective, currentOffset);
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: nameOrDirective.length,
                ptTokenType: 'variable', // color this offender!
                ptTokenModifiers: ['illegalUse']
              });
              this.semanticFindings.pushDiagnosticMessage(
                lineIdx,
                nameOffset,
                nameOffset + nameOrDirective.length,
                eSeverity.Error,
                'Illegal P2 Spin Directive within inline-pasm'
              );
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
        const partialTokenSet: IParsedToken[] = this._reportDAT_ValueDeclarationCode(
          lineIdx,
          startingOffset,
          line,
          allowLocalVarStatus,
          this.showPAsmCode,
          NOT_DAT_PASM
        );
        this._reportNonDupeTokens(partialTokenSet, '=> DATvalue: ', line, tokenSet);
      }
    }
    return tokenSet;
  }

  private _reportOBJ_DeclarationLineMultiLine(startingOffset: number, multiLineSet: ContinuedLines): IParsedToken[] {
    //
    // Colorize Object Instance declarations
    //
    const tokenSet: IParsedToken[] = [];
    //skip Past Whitespace
    let currSingleLineOffset: number = this.parseUtils.skipWhite(multiLineSet.line, startingOffset);
    // FIXME: TODO: UNDONE - maybe we need to highlight comments which are NOT captured yet in multi-line set
    const remainingNonCommentLineStr: string = multiLineSet.line;
    this._logOBJ(`- RptObjDecl remainingNonCommentLineStr=[${remainingNonCommentLineStr}], currSingleLineOffset=(${currSingleLineOffset})`);
    const bHasOverrides: boolean = remainingNonCommentLineStr.includes('|');
    const overrideParts: string[] = remainingNonCommentLineStr.split('|');

    const remainingLength: number = remainingNonCommentLineStr.length;
    //const bHasColon: boolean = remainingNonCommentLineStr.includes(':');
    let objectName: string = '';
    if (remainingLength > 0) {
      // get line parts - initially, we only care about first one
      const lineParts: string[] = remainingNonCommentLineStr.split(/[ \t:[]/).filter(Boolean);
      this._logOBJ(`  --  OBJ lineParts=[${lineParts.join(', ')}](${lineParts.length})`);
      objectName = lineParts[0];
      // object name token must be offset into full line for token
      //const nameOffset: number = line.indexOf(objectName, currSingleLineOffset);
      const symbolPosition: Position = multiLineSet.locateSymbol(objectName, currSingleLineOffset);
      this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
        line: symbolPosition.line,
        startCharacter: symbolPosition.character,
        length: objectName.length,
        ptTokenType: 'namespace',
        ptTokenModifiers: ['declaration']
      });
      const objArrayOpen: number = remainingNonCommentLineStr.indexOf('[');
      if (objArrayOpen != -1) {
        // we have an array of objects, study the index value for possible named reference(s)
        const objArrayClose: number = remainingNonCommentLineStr.indexOf(']');
        if (objArrayClose != -1) {
          const elemCountStr: string = remainingNonCommentLineStr.substr(objArrayOpen + 1, objArrayClose - objArrayOpen - 1);
          // if we have a variable name...
          if (this.parseUtils.isValidSpinSymbolName(elemCountStr)) {
            let possibleNameSet: string[] = [elemCountStr];
            // is it a namespace reference?
            let bHaveObjReference: boolean = false;
            if (this._isPossibleObjectReference(elemCountStr)) {
              // go register object reference!
              const symbolPosition: Position = multiLineSet.locateSymbol(elemCountStr, currSingleLineOffset);
              bHaveObjReference = this._reportObjectReference(
                elemCountStr,
                symbolPosition.line,
                symbolPosition.character,
                multiLineSet.lineAt(symbolPosition.line),
                tokenSet
              );
              possibleNameSet = elemCountStr.split('.');
            }
            if (!bHaveObjReference) {
              for (let index = 0; index < possibleNameSet.length; index++) {
                const nameReference = possibleNameSet[index];
                const symbolPosition: Position = multiLineSet.locateSymbol(nameReference, currSingleLineOffset);
                if (this.semanticFindings.isGlobalToken(nameReference)) {
                  const referenceDetails: RememberedToken | undefined = this.semanticFindings.getGlobalToken(nameReference);
                  // Token offsets must be line relative so search entire line...
                  if (referenceDetails !== undefined) {
                    //const updatedModificationSet: string[] = this._modifiersWithout(referenceDetails.modifiers, "declaration");
                    this._logOBJ('  --  FOUND global name=[' + nameReference + ']');
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: nameReference.length,
                      ptTokenType: referenceDetails.type,
                      ptTokenModifiers: referenceDetails.modifiers
                    });
                  }
                } else if (
                  !this.parseUtils.isSpinReservedWord(nameReference) &&
                  !this.parseUtils.isBuiltinStreamerReservedWord(nameReference) &&
                  !this.parseUtils.isDebugMethod(nameReference)
                ) {
                  // we don't have name registered so just mark it
                  this._logOBJ('  --  OBJ MISSING name=[' + nameReference + ']');
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: symbolPosition.line,
                    startCharacter: symbolPosition.character,
                    length: nameReference.length,
                    ptTokenType: 'variable',
                    ptTokenModifiers: ['missingDeclaration']
                  });
                  this.semanticFindings.pushDiagnosticMessage(
                    symbolPosition.line,
                    symbolPosition.character,
                    symbolPosition.character + nameReference.length,
                    eSeverity.Error,
                    `P2 Spin OBJ mA  issing declaration [${nameReference}]`
                  );
                }
              }
            }
          }
        }
      }
      if (bHasOverrides && overrideParts.length > 1) {
        // Ex:     child1 : "child" | MULTIPLIER = 3, COUNT = 5, HAVE_HIDPAD = true        ' override child constants
        //                            ^^^^^^^^^^^^^^^^^^^^^^^^^   (process this part)
        const overrides: string = overrideParts[1].replace(/[ \t]/, '');
        const overideSatements: string[] = overrides.split(',').filter(Boolean);
        const firstStatement: string = overideSatements[0].trim();
        let symbolPosition: Position = multiLineSet.locateSymbol(firstStatement, currSingleLineOffset);
        currSingleLineOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
        this._logOBJ(`  -- OBJ overideStatements=[${overideSatements}](${overideSatements.length})`);
        for (let index = 0; index < overideSatements.length; index++) {
          const statement: string = overideSatements[index].trim();
          symbolPosition = multiLineSet.locateSymbol(statement, currSingleLineOffset);
          const nameOffset: number = multiLineSet.offsetIntoLineForPosition(symbolPosition);
          const statementParts: string[] = overideSatements[index].split('=');
          const overideName: string = statementParts[0].trim();
          const overideValue: string = statementParts.length > 1 ? statementParts[1].trim() : '';
          if (overideName === '...') {
            continue; // skip line continuation marker  FIXME: not needed any more?!!!
          }
          const lookupName: string = `${objectName}%${overideName}`;
          this._logOBJ(`  -- OBJ overideName=[${overideName}](${overideName.length}), overideValue=[${overideValue}](${overideValue.length})`);
          const bHaveObjReference: boolean = this._isPossibleObjectReference(lookupName)
            ? this._reportObjectReference(
                lookupName,
                symbolPosition.line,
                symbolPosition.character,
                multiLineSet.lineAt(symbolPosition.line),
                tokenSet
              )
            : false;
          if (!bHaveObjReference) {
            this._logOBJ(`  --  OBJ MISSING name=[${overideName}]`);
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: symbolPosition.character,
              length: overideName.length,
              ptTokenType: 'variable',
              ptTokenModifiers: ['missingDeclaration']
            });
            this.semanticFindings.pushDiagnosticMessage(
              symbolPosition.line,
              symbolPosition.character,
              symbolPosition.character + overideName.length,
              eSeverity.Error,
              `P2 Spin OBJ mB missing declaration [${overideName}]`
            );
          }
          this._logOBJ(
            `  -- OBJ CALC currOffset nameOffset=(${nameOffset}) + nameLen=(${overideName.length}) = currSingleLineOffset=(${
              nameOffset + overideName.length
            })`
          );
          currSingleLineOffset = nameOffset + overideName.length; // move past this name

          // process RHS of assignment (overideValue) too!
          if (this.parseUtils.isValidSpinSymbolName(overideValue)) {
            // process symbol name
            const symbolPosition: Position = multiLineSet.locateSymbol(overideValue, currSingleLineOffset);
            const nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
            this._logOBJ(`  -- OBJ overideValue=[${overideValue}], ofs=(${nameOffset})`);
            const bHaveObjReference: boolean = this._isPossibleObjectReference(overideValue)
              ? this._reportObjectReference(
                  overideValue,
                  symbolPosition.line,
                  symbolPosition.character,
                  multiLineSet.lineAt(symbolPosition.line),
                  tokenSet
                )
              : false;
            if (!bHaveObjReference) {
              let referenceDetails: RememberedToken | undefined = undefined;
              if (this.semanticFindings.isGlobalToken(overideValue)) {
                referenceDetails = this.semanticFindings.getGlobalToken(overideValue);
              }
              // Token offsets must be line relative so search entire line...
              if (referenceDetails !== undefined) {
                //const updatedModificationSet: string[] = this._modifiersWithout(referenceDetails.modifiers, "declaration");
                this._logOBJ('  --  FOUND global name=[' + overideValue + ']');
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: overideValue.length,
                  ptTokenType: referenceDetails.type,
                  ptTokenModifiers: referenceDetails.modifiers
                });
              } else if (this.parseUtils.isP2AsmReservedWord(overideValue)) {
                this._logOBJ('  --  FOUND built-in constant=[' + overideValue + ']');
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: overideValue.length,
                  ptTokenType: 'variable',
                  ptTokenModifiers: ['readonly']
                });
              } else {
                // if (!this.parseUtils.isP2AsmReservedWord(overideValue)) {
                this._logOBJ('  --  OBJ MISSING RHS name=[' + overideValue + ']');
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: overideValue.length,
                  ptTokenType: 'variable',
                  ptTokenModifiers: ['missingDeclaration']
                });
                this.semanticFindings.pushDiagnosticMessage(
                  symbolPosition.line,
                  symbolPosition.character,
                  symbolPosition.character + overideValue.length,
                  eSeverity.Error,
                  `P2 Spin OBJ mC missing declaration [${overideValue}]`
                );
              }
            }
            currSingleLineOffset = nameOffset + overideValue.length;
          }
        }
      }
    }
    return tokenSet;
  }

  private _reportVAR_DeclarationLine(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    //
    // Colorize Instance Variable declarations
    //
    // VAR Variable declaration
    //    {{^}BYTE|{^}WORD|{^}LONG|{^}StructName} VarName{[ArraySize]} {, VarName{[ArraySize]} {, ...}
    //
    //    BYTE a,b,c, WORD d, LONG e 'Multiple types can be declared on the same line.
    //
    //    ALIGNW|ALIGNL 'word|long-align to hub memory, advances variable pointer as necessary
    //
    const tokenSet: IParsedToken[] = [];
    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this._getNonCommentLineReturnComment(currentOffset, lineIdx, line, tokenSet);
    if (remainingNonCommentLineStr.length > 0) {
      // get line parts - we only care about first one
      const varStatements: string[] = this.parseUtils.getCommaDelimitedLineParts(remainingNonCommentLineStr.trim());
      this._logVAR(`  -- rptVarDecl varStatements=[${varStatements}](${varStatements.length})`);
      // remember this object name so we can annotate a call to it
      //const hasStorageType: boolean = this.isStorageType(lineParts[0]);
      if (varStatements.length > 0) {
        //const startIndex: number = hasStorageType ? 1 : 0;
        for (let index = 0; index < varStatements.length; index++) {
          const varDeclStatement: string = varStatements[index];
          const statementOffset: number = line.indexOf(varDeclStatement, currentOffset);
          let newName: string = varDeclStatement;
          let newType: string = '';
          let indexStatement: string = '';
          let isPtr: boolean = false;
          if (newName.includes('[')) {
            const varParts: string[] = varDeclStatement.split(/[[\]]/).filter(Boolean);
            this._logVAR(`  -- GetVarDecl varParts=[${varParts}](${varParts.length})`);
            if (varParts.length > 1) {
              newName = varParts[0];
              indexStatement = varParts[1];
            }
          }
          if (newName.includes(' ')) {
            const declParts: string[] = varDeclStatement.split(/\s+/).filter(Boolean);
            this._logVAR(`  -- GetVarDecl declParts=[${declParts}](${declParts.length})`);
            if (declParts.length > 1) {
              newType = declParts[0];
              newName = declParts[1];
              isPtr = newType.charAt(0) === '^'; // remember we have pointer
              newType = isPtr ? newType.substring(1) : newType; // remove ptr indicator
            }
            this._logVAR(
              `  -- GetVarDecl isPtr=(${isPtr}) type=[${declParts}](${declParts.length}), name=[${newName}](${newName.length}), index=[${indexStatement}](${indexStatement.length})`
            );
          }
          if ((newType.length == 0 && newName.toLowerCase() == 'alignl') || newName.toLowerCase() == 'alignw') {
            newType = newName;
            newName = '';
          }
          const adjNameParts: string[] = [newType, newName, indexStatement];
          const nameOffset: number = line.indexOf(newName, statementOffset);
          this._logVAR(`  -- rptVarDecl varDecl=[${varDeclStatement}] ofs=(${nameOffset}), nmParts=[${adjNameParts}](${adjNameParts.length})`);
          // highlight optional type
          currentOffset = statementOffset;
          if (newType.length > 0) {
            // highlight a VAR type use
            const isStorageType: boolean = this.isStorageType(newType);
            const nameOffset: number = line.indexOf(newType, statementOffset);
            this._logVAR(`  -- GLBL ADD storageType=[${newType}], ofs=(${nameOffset}), isStorageType=(${isStorageType})`);
            // don't color our align types, they already are...
            if (!this.parseUtils.isAlignType(newType)) {
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: newType.length,
                ptTokenType: 'storageType',
                ptTokenModifiers: []
              });
            }
            currentOffset = nameOffset + newType.length;
          }
          // highlight symbol name
          if (this.parseUtils.isValidSpinSymbolName(newName)) {
            // in the following, let's not register a name with a trailing ']' this is part of an array size calculation!
            const nameOffset: number = line.indexOf(newName, currentOffset);
            this._logVAR(`  -- GLBL ADD rvdl newName=[${newName}], ofs=(${nameOffset})`);
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: newName.length,
              ptTokenType: 'variable',
              ptTokenModifiers: ['declaration', 'instance']
            });
            currentOffset = nameOffset + newName.length;
          }
          if (indexStatement.length > 0) {
            // process name with array length value
            const arrayReferenceParts: string[] = indexStatement.split(/[ \t/*+<>]/);
            this._logVAR(`  --  arrayReferenceParts=[${arrayReferenceParts}](${arrayReferenceParts.length})`);
            for (let index = 0; index < arrayReferenceParts.length; index++) {
              const referenceName = arrayReferenceParts[index];
              if (this.parseUtils.isValidSpinSymbolName(referenceName)) {
                let possibleNameSet: string[] = [];
                // is it a namespace reference?
                if (referenceName.includes('.')) {
                  possibleNameSet = referenceName.split('.');
                } else {
                  possibleNameSet = [referenceName];
                }
                this._logVAR('  --  possibleNameSet=[' + possibleNameSet + ']');
                const namePart = possibleNameSet[0];
                if (this.semanticFindings.isGlobalToken(namePart)) {
                  const referenceDetails: RememberedToken | undefined = this.semanticFindings.getGlobalToken(namePart);
                  const searchString: string = possibleNameSet.length == 1 ? possibleNameSet[0] : `${possibleNameSet[0]}.${possibleNameSet[1]}`;
                  const nameOffset = line.indexOf(searchString, currentOffset);
                  if (referenceDetails !== undefined) {
                    this._logVAR('  --  FOUND global name=[' + namePart + ']');
                    this._recordToken(tokenSet, line, {
                      line: lineIdx,
                      startCharacter: nameOffset,
                      length: namePart.length,
                      ptTokenType: referenceDetails.type,
                      ptTokenModifiers: referenceDetails.modifiers
                    });
                  } else {
                    // we don't have name registered so just mark it
                    if (
                      !this.parseUtils.isSpinReservedWord(namePart) &&
                      !this.parseUtils.isBuiltinStreamerReservedWord(namePart) &&
                      !this.parseUtils.isDebugMethod(namePart)
                    ) {
                      this._logVAR('  --  VAR Add MISSING name=[' + namePart + ']');
                      this._recordToken(tokenSet, line, {
                        line: lineIdx,
                        startCharacter: nameOffset,
                        length: namePart.length,
                        ptTokenType: 'variable',
                        ptTokenModifiers: ['missingDeclaration']
                      });
                      this.semanticFindings.pushDiagnosticMessage(
                        lineIdx,
                        nameOffset,
                        nameOffset + namePart.length,
                        eSeverity.Error,
                        `P2 Spin VAR A missing declaration [${namePart}]`
                      );
                    }
                  }
                }
                if (possibleNameSet.length > 1) {
                  // we have .constant namespace suffix
                  this._logVAR('  --  VAR Add ReadOnly name=[' + namePart + ']');
                  const constantPart: string = possibleNameSet[1];
                  const nameOffset = line.indexOf(constantPart, currentOffset);
                  this._recordToken(tokenSet, line, {
                    line: lineIdx,
                    startCharacter: nameOffset,
                    length: constantPart.length,
                    ptTokenType: 'variable',
                    ptTokenModifiers: ['readonly']
                  });
                }
              }
            }
          }
        }
      } else {
        /*
        // NEW: update to handle multiple declaration on a single line
        this._logVAR(`  -- GLBL rvdl2 SPLIT lineParts=[${lineParts.join(',')}](${lineParts.length})`);
        let nameSet: string[] = [lineParts[0]];
        if (lineParts[0].includes('[')) {
          nameSet = lineParts[0].split(/[[\]}]/).filter(Boolean);
        }
        let newName: string = nameSet[0];
        let typeName: string = '';
        if (newName.includes(' ')) {
          nameSet = lineParts[0].split(/ \t/).filter(Boolean);
          if (nameSet.length > 1) {
            typeName = nameSet[0];
            newName = nameSet[1];
          }
        }
        this._logVAR(`  -- GLBL rvdl2 SPLIT2 typeName=[${typeName}], newName=[${newName}`);
        if (typeName.length > 0 && this.isStorageType(typeName)) {
          const nameOffset: number = line.indexOf(typeName, currentOffset);
          this._logMessage(`  -- have Storage type! typeName=[${typeName}], ofs=(${nameOffset})`);
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: typeName.length,
            ptTokenType: 'storageType',
            ptTokenModifiers: []
          });
          if (this.parseUtils.requestedSpinVersion(45) && this.semanticFindings.isStructure(typeName)) {
            // at v45, we allow structures as types for local vars!
            this.semanticFindings.recordStructureInstance(typeName, newName); // VAR
          }
        }
        if (newName !== undefined && this.parseUtils.isValidSpinSymbolName(newName)) {
          this._logVAR(`  -- GLBL rvdl2 newName=[${newName}]`);
          const nameOffset: number = line.indexOf(newName, currentOffset);
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: nameOffset,
            length: newName.length,
            ptTokenType: 'variable',
            ptTokenModifiers: ['declaration', 'instance']
          });
        }
        if (nameSet.length > 1) {
          // process remaining names is it only one size constant?
          newName = nameSet[1];
          this._logVAR(`  -- GLBL rvdl2 remaining newName=[${newName}]`);
          if (this.semanticFindings.isGlobalToken(newName)) {
            const referenceDetails: RememberedToken | undefined = this.semanticFindings.getGlobalToken(newName);
            const searchString: string = newName;
            const nameOffset = line.indexOf(searchString, currentOffset);
            if (referenceDetails !== undefined) {
              this._logVAR('  --  FOUND global name=[' + newName + ']');
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: newName.length,
                ptTokenType: referenceDetails.type,
                ptTokenModifiers: referenceDetails.modifiers
              });
            } else {
              // we don't have name registered so just mark it
              if (
                !this.parseUtils.isSpinReservedWord(newName) &&
                !this.parseUtils.isBuiltinStreamerReservedWord(newName) &&
                !this.parseUtils.isDebugMethod(newName)
              ) {
                this._logVAR('  --  VAR Add MISSING name=[' + newName + ']');
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: nameOffset,
                  length: newName.length,
                  ptTokenType: 'variable',
                  ptTokenModifiers: ['missingDeclaration']
                });
                this.semanticFindings.pushDiagnosticMessage(
                  lineIdx,
                  nameOffset,
                  nameOffset + newName.length,
                  eSeverity.Error,
                  `P2 Spin VAR B missing declaration [${newName}]`
                );
              }
            }
          }
        }*/
      }
    }
    return tokenSet;
  }

  private _locateEndOfDebugStatement(line: string, startingOffset: number): number {
    let desiredPosition: number = -1;
    const debugPosn = line.toUpperCase().indexOf('DEBUG', startingOffset);
    // BUGFIX: let's do right thing when we have a line continuation sequence
    const ellipsisPosn = line.indexOf('...', startingOffset);
    if (line.length > 0 && ellipsisPosn != -1) {
      desiredPosition = ellipsisPosn + 2; // Return the position of last char of ellipsis
    } else if (line.length > 0 && debugPosn != -1) {
      const openParenOffset: number = line.indexOf('(', debugPosn);
      if (openParenOffset != -1) {
        let nestingLevel = 1; // Start with 1 since we found an open parenthesis
        let closeParenOffset = openParenOffset;

        while (nestingLevel > 0) {
          const nextOpenParen = line.indexOf('(', closeParenOffset + 1);
          const nextCloseParen = line.indexOf(')', closeParenOffset + 1);

          if (nextCloseParen === -1) {
            // No more closing parentheses, exit the loop
            break;
          }

          if (nextOpenParen !== -1 && nextOpenParen < nextCloseParen) {
            // Found another open parenthesis before the next close parenthesis
            nestingLevel++;
            closeParenOffset = nextOpenParen;
          } else {
            // Found a close parenthesis
            nestingLevel--;
            closeParenOffset = nextCloseParen;
          }
        }
        if (nestingLevel == 0) {
          desiredPosition = closeParenOffset + 1;
        }
      }
    }
    return desiredPosition;
  }

  private _reportDebugStatementMultiLine(startingOffset: number, multiLineSet: ContinuedLines, inPasm: boolean = false): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    // locate and collect debug() display user names and types
    //
    // debug(`{displayName} ... )
    // debug(`zstr_(displayName) lutcolors `uhex_long_array_(image_address, lut_size))
    // debug(`lstr_(displayName, len) lutcolors `uhex_long_array_(image_address, lut_size))
    // debug(``#(letter) lutcolors `uhex_long_array_(image_address, lut_size))
    // v46: add support for new debug[n](...) syntax
    //   debug[...](`{displayName} ... )
    //   debug[...](`zstr_(displayName) lutcolors `uhex_long_array_(image_address, lut_size))
    //   debug[...](`lstr_(displayName, len) lutcolors `uhex_long_array_(image_address, lut_size))
    //   debug[...](``#(letter) lutcolors `uhex_long_array_(image_address, lut_size))
    //
    // if no text on line, just return
    if (multiLineSet.line.substring(startingOffset).trim().length == 0) {
      return tokenSet;
    }
    let currSingleLineOffset: number = this.parseUtils.skipWhite(multiLineSet.line, startingOffset);
    const debugStatementStr: string = multiLineSet.line.substring(currSingleLineOffset).trimEnd();
    this._logDEBUG(`- Ln#${multiLineSet.lineStartIdx + 1} rDbgStM() debugStatementStr=[${debugStatementStr}]`);
    this._logMessage(`  -- rDbgStM() startingOffset=(${startingOffset}), currSingleLineOffset=(${currSingleLineOffset})`);
    const openParenOffset: number = debugStatementStr.indexOf('(');
    let haveBitfieldIndex: boolean = false;
    let bitfieldIndexValue: string = '';
    if (openParenOffset != -1) {
      // see if we have bitnumber index field
      haveBitfieldIndex = debugStatementStr.substring(0, openParenOffset + 1).includes('[');
    }

    const lineParts: string[] = this.parseUtils.getDebugNonWhiteLineParts(debugStatementStr);
    this._logDEBUG(`  -- rDbgStM() AM lineParts=[${lineParts.join(', ')}](${lineParts.length})`);
    if (lineParts.length > 0 && lineParts[0].toLowerCase() != 'debug') {
      //this._logDEBUG(' -- rDbgStM() first name not debug! (label?) removing! lineParts[0]=[' + lineParts[0] + ']');
      lineParts.shift(); // assume pasm, remove label - NOTE: assume these are colored by SYNTAX coloring
    }
    if (lineParts.length > 0 && lineParts[0].toLowerCase() == 'debug') {
      if (haveBitfieldIndex) {
        //this._logDEBUG(' -- rDbgStM() first name not debug! (label?) removing! lineParts[0]=[' + lineParts[0] + ']');
        // FIXME: UNDONE - need to highlight the bitfield index if non-numeric (and allowed to be non-numeric)
        bitfieldIndexValue = lineParts[1];
        lineParts.splice(1, 1); // Removes the element at index 1
        this._logDEBUG(`  -- rDbgStM() removed bitfield? (or conditional?) lineParts=[${lineParts}](${lineParts.length})`);
      }
      // -------------------------------------
      // process Debug statement identifier
      const symbolPosition: Position = multiLineSet.locateSymbol(lineParts[0], currSingleLineOffset);
      const nameOffset: number = multiLineSet.offsetIntoLineForPosition(symbolPosition);
      this._logDEBUG(`  -- rDbgStM() debug=[${lineParts[0]}]`);
      this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
        line: symbolPosition.line,
        startCharacter: symbolPosition.character,
        length: lineParts[0].length,
        ptTokenType: 'debug',
        ptTokenModifiers: ['function']
      });
      currSingleLineOffset = nameOffset + lineParts[0].length;

      if (bitfieldIndexValue.length > 0) {
        const symbolPosition: Position = multiLineSet.locateSymbol(bitfieldIndexValue, currSingleLineOffset);
        const nameOffset: number = multiLineSet.offsetIntoLineForPosition(symbolPosition);
        this._logDEBUG(`  -- rDbgStM() bitfieldIndexValue=[${bitfieldIndexValue}]`);
        const [paramIsNumber, paramIsSymbolName] = this.parseUtils.isValidSpinConstantOrSpinSymbol(bitfieldIndexValue, inPasm);
        if (paramIsNumber) {
          this._logDEBUG(`  -- rDbgStM() index is Number=[${bitfieldIndexValue}]`);
          this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
            line: symbolPosition.line,
            startCharacter: symbolPosition.character,
            length: bitfieldIndexValue.length,
            ptTokenType: 'number',
            ptTokenModifiers: []
          });
        } else if (paramIsSymbolName) {
          // handle named index value here
          let referenceDetails: RememberedToken | undefined = undefined;
          if (this.semanticFindings.isGlobalToken(bitfieldIndexValue)) {
            referenceDetails = this.semanticFindings.getGlobalToken(bitfieldIndexValue);
            this._logDEBUG(`  --  FOUND global name=[${bitfieldIndexValue}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
          }
          if (referenceDetails !== undefined && paramIsSymbolName) {
            this._logDEBUG(`  --  SPIN/PAsm add name=[${bitfieldIndexValue}]`);
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: symbolPosition.character,
              length: bitfieldIndexValue.length,
              ptTokenType: referenceDetails.type,
              ptTokenModifiers: referenceDetails.modifiers
            });
          } else {
            // handle unknown-name case -OR- invalid sybol name
            this._logDEBUG(`  -- SPIN/PAsm  unknown index=[${bitfieldIndexValue}]`);
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: symbolPosition.character,
              length: bitfieldIndexValue.length,
              ptTokenType: 'setupParameter',
              ptTokenModifiers: ['illegalUse']
            });
            this.semanticFindings.pushDiagnosticMessage(
              symbolPosition.line,
              symbolPosition.character,
              symbolPosition.character + bitfieldIndexValue.length,
              eSeverity.Error,
              `P2 Spin BitNumber unknown name [${bitfieldIndexValue}]`
            );
          }
        }
        currSingleLineOffset = nameOffset + bitfieldIndexValue.length;
      }

      //let symbolOffset: number = currSingleLineOffset;
      const displayType: string = lineParts.length >= 2 ? lineParts[1] : '';
      this._logDEBUG(`  -- rDbgStM() possible displayType=[${displayType}](${displayType.length}), lineParts=[${lineParts}](${lineParts.length})`);
      if (displayType.startsWith('`')) {
        this._logDEBUG(`  -- rDbgStM() have "debug("\` lineParts=[${lineParts}](${lineParts.length})`);
        //symbolOffset = line.indexOf(displayType, symbolOffset) + 1; // plus 1 to get past back-tic
        const newDisplayType: string = displayType.substring(1, displayType.length);
        let displayTestName: string = lineParts[1] == '`' ? lineParts[1] + lineParts[2] : lineParts[1];
        displayTestName = displayTestName.toLowerCase().replace(/ \t/g, '');
        const isRuntimeNamed: boolean =
          displayTestName.startsWith('``') || displayTestName.startsWith('`zstr') || displayTestName.startsWith('`lstr');
        this._logDEBUG(`  -- rDbgStM() displayTestName=[${displayTestName}], isRuntimeNamed=${isRuntimeNamed}`);
        const bHaveInstantiation = this.parseUtils.isDebugDisplayType(newDisplayType) && !isRuntimeNamed;
        if (bHaveInstantiation) {
          this._logDEBUG(`  -- rDbgStM() --- PROCESSING Display Instantiation`);
          // -------------------------------------
          // process Debug() display instantiation
          //   **    debug(`{displayType} {displayName} ......)
          // (0a) register type use
          let symbolPosition: Position = multiLineSet.locateSymbol(newDisplayType, currSingleLineOffset);
          let nameOffset: number = multiLineSet.offsetIntoLineForPosition(symbolPosition);
          this._logDEBUG(`  -- rDbgStM() newDisplayType=[${newDisplayType}]`);
          this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
            line: symbolPosition.line,
            startCharacter: symbolPosition.character,
            length: newDisplayType.length,
            ptTokenType: 'displayType',
            ptTokenModifiers: ['reference', 'defaultLibrary']
          });
          currSingleLineOffset = nameOffset + newDisplayType.length;
          // (0b) register userName use
          const newDisplayName: string = lineParts[2];
          symbolPosition = multiLineSet.locateSymbol(newDisplayName, currSingleLineOffset);
          nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
          this._logDEBUG(`  -- rDbgStM() newDisplayName=[${newDisplayName}]`);
          this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
            line: symbolPosition.line,
            startCharacter: symbolPosition.character,
            length: newDisplayName.length,
            ptTokenType: 'displayName',
            ptTokenModifiers: ['declaration']
          });
          currSingleLineOffset = nameOffset + newDisplayName.length;
          // (1) highlight parameter names
          const eDisplayType: eDebugDisplayType = this.semanticFindings.getDebugDisplayEnumForType(newDisplayType);
          const firstParamIdx: number = 3; // [0]=debug [1]=`{type}, [2]={userName}
          for (let idx = firstParamIdx; idx < lineParts.length; idx++) {
            const newParameter: string = lineParts[idx];
            symbolPosition = multiLineSet.locateSymbol(newParameter, currSingleLineOffset);
            nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
            if (this.parseUtils.isValidSpinNumericConstant(newParameter)) {
              this._logDEBUG(`  -- rDbgStM() param Number=[${newParameter}]`);
              this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                line: symbolPosition.line,
                startCharacter: symbolPosition.character,
                length: newParameter.length,
                ptTokenType: 'number',
                ptTokenModifiers: []
              });
              currSingleLineOffset = nameOffset + newParameter.length;
              continue;
            }
            const bIsParameterName: boolean = this.parseUtils.isNameWithTypeInstantiation(newParameter, eDisplayType);
            if (bIsParameterName) {
              this._logDEBUG(`  -- rDbgStM() mA newParam=[${newParameter}]`);
              this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                line: symbolPosition.line,
                startCharacter: symbolPosition.character,
                length: newParameter.length,
                ptTokenType: 'setupParameter',
                ptTokenModifiers: ['reference', 'defaultLibrary']
              });
            } else {
              const bIsColorName: boolean = this.parseUtils.isDebugColorName(newParameter);
              if (bIsColorName) {
                this._logDEBUG(`  -- rDbgStM() newColor=[${newParameter}]`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: newParameter.length,
                  ptTokenType: 'colorName',
                  ptTokenModifiers: ['reference', 'defaultLibrary']
                });
              } else {
                // unknown parameter, is known symbol?
                let referenceDetails: RememberedToken | undefined = undefined;
                if (this.semanticFindings.hasLocalPAsmTokenForMethod(this.currentMethodName, newParameter)) {
                  referenceDetails = this.semanticFindings.getLocalPAsmTokenForMethod(this.currentMethodName, newParameter);
                  this._logPASM(`  --  FOUND local PASM name=[${newParameter}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
                } else if (this.semanticFindings.isLocalToken(newParameter)) {
                  referenceDetails = this.semanticFindings.getLocalTokenForLine(newParameter, symbolPosition.line + 1);
                  this._logPASM(`  --  FOUND local name=[${newParameter}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
                } else if (this.semanticFindings.isGlobalToken(newParameter)) {
                  referenceDetails = this.semanticFindings.getGlobalToken(newParameter);
                  this._logPASM(`  --  FOUND global name=[${newParameter}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
                }
                if (referenceDetails !== undefined) {
                  this._logPASM(`  --  SPIN/PAsm add name=[${newParameter}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: symbolPosition.line,
                    startCharacter: symbolPosition.character,
                    length: newParameter.length,
                    ptTokenType: referenceDetails.type,
                    ptTokenModifiers: referenceDetails.modifiers
                  });
                } else {
                  // handle unknown-name case
                  const paramIsSymbolName: boolean = this.parseUtils.isValidSpinSymbolName(newParameter) ? true : false;
                  if (
                    paramIsSymbolName &&
                    !this.parseUtils.isDebugMethod(newParameter) &&
                    newParameter.indexOf('`') == -1 &&
                    !this.parseUtils.isUnaryOperator(newParameter) &&
                    !this.parseUtils.isBinaryOperator(newParameter) &&
                    !this.parseUtils.isFloatConversion(newParameter) &&
                    !this.parseUtils.isSpinBuiltinMethod(newParameter) &&
                    !this.parseUtils.isDebugBitmapColorMode(newParameter) &&
                    !this.parseUtils.isBuiltinStreamerReservedWord(newParameter)
                  ) {
                    this._logDEBUG('  -- rDbgStM() 1 unkParam=[${newParameter}]');
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: newParameter.length,
                      ptTokenType: 'setupParameter',
                      ptTokenModifiers: ['illegalUse']
                    });
                    this.semanticFindings.pushDiagnosticMessage(
                      symbolPosition.line,
                      symbolPosition.character,
                      symbolPosition.character + newParameter.length,
                      eSeverity.Error,
                      `P2 Spin debug() mA unknown name [${newParameter}]`
                    );
                  }
                }
              }
            }
            currSingleLineOffset = nameOffset + newParameter.length;
          }
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
            this._logDEBUG(`  -- rDbgStM() --- PROCESSING feed`);
            let currLineNbr: number = 0;
            if (isRuntimeNamed) {
              firstParamIdx = displayName == '`' || displayName == '``' ? 2 : 1; // [0]=`debug` [1]=`runtimeName, [2]... symbols
            } else {
              firstParamIdx = 1; // [0]=debug [1]=`{userName}[[, {userName}], ...]
              // handle one or more names!
              do {
                // (0) register UserName use
                this._logDEBUG(`  -- rDbgStM() displayName=[${displayName}]`);
                const symbolPosition: Position = multiLineSet.locateSymbol(displayName, currSingleLineOffset);
                const nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
                currLineNbr = symbolPosition.line + 1;
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: displayName.length,
                  ptTokenType: 'displayName',
                  ptTokenModifiers: ['reference']
                });
                currSingleLineOffset = nameOffset + displayName.length;
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
              eDisplayType = this._getDisplayTypeForLine(currLineNbr);
            }
            let newParameter: string = '';
            let symbolPosition: Position = Position.create(-1, -1);
            let nameOffset: number = 0;
            //let isBackTicMode: boolean = false;
            const parameterParts: string = lineParts.slice(firstParamIdx).join(', ');
            this._logDEBUG(`  -- rDbgStM() param lineParts=[${parameterParts}](${lineParts.length - firstParamIdx})`);
            for (let idx = firstParamIdx; idx < lineParts.length; idx++) {
              newParameter = lineParts[idx];
              // Ex: debug(``udec(i * j)) -- the udec arrives as ``uudec, remove prefix
              newParameter = newParameter.startsWith('``') ? newParameter.substring(2) : newParameter;
              this._logDEBUG(`  -- rDbgStM() rawParameter=[${newParameter}](${newParameter.length})`);
              if (newParameter.indexOf("'") != -1) {
                currSingleLineOffset += newParameter.length;
                continue; // skip this name (it's part of a string!)
              } else if (newParameter.indexOf('#') != -1) {
                currSingleLineOffset += newParameter.length;
                continue; // skip this name (it's part of a string!)
              }
              if (newParameter === '`') {
                continue; // skip this it was left in list (oops) - FIXME: TODO maybe filter list better?
              } else if (newParameter.startsWith('`')) {
                //isBackTicMode = true;
                newParameter = newParameter.substring(1);
              }
              //symbolOffset = line.indexOf(newParameter, symbolOffset);
              symbolPosition = multiLineSet.locateSymbol(newParameter, currSingleLineOffset);
              nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
              this._logDEBUG(`  -- rDbgStM() process parameter=[${newParameter}](${newParameter.length}), ofs=(${nameOffset})`);
              if (this.parseUtils.isStorageType(newParameter)) {
                this._logDEBUG(`  -- rDbgStM() storage type=[${newParameter}]`);
                // have a 'byte' of byte[i+0]
                // have a 'word' of word[i+0]
                // have a 'long' of long[i+0]
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: newParameter.length,
                  ptTokenType: 'operator', // method is blue?!, function is yellow?!
                  ptTokenModifiers: ['builtin']
                });
                currSingleLineOffset = nameOffset + newParameter.length;
                continue;
              }
              // handle dotted reference
              if (newParameter.includes('.')) {
                let bFoundObjRef: boolean = false;
                if (this._isPossibleObjectReference(newParameter)) {
                  // go register object reference!
                  const bHaveObjReference: boolean = this._reportObjectReference(
                    newParameter,
                    symbolPosition.line,
                    symbolPosition.character,
                    multiLineSet.lineAt(symbolPosition.line),
                    tokenSet
                  );
                  if (bHaveObjReference) {
                    bFoundObjRef = true;
                    currSingleLineOffset = nameOffset + newParameter.length;
                    continue;
                  }
                }
                if (!bFoundObjRef && this._isPossibleStructureReference(newParameter)) {
                  const [bHaveStructReference, refString] = this._reportStructureReference(
                    newParameter,
                    symbolPosition.line,
                    symbolPosition.character,
                    multiLineSet.lineAt(symbolPosition.line),
                    tokenSet
                  );
                  if (bHaveStructReference) {
                    if (newParameter !== refString) {
                      this._logSPIN(
                        `  -- rDbgStM() F ERROR?! [${refString}](${refString.length}) is only part of [${newParameter}](${newParameter.length}), how to handle the rest?`
                      );
                    }
                    currSingleLineOffset = nameOffset + refString.length;
                    continue;
                  }
                }
              } else if (this.parseUtils.isValidSpinNumericConstant(newParameter)) {
                this._logDEBUG(`  -- rDbgStM() constant=[${newParameter}]`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: newParameter.length,
                  ptTokenType: 'number',
                  ptTokenModifiers: []
                });
                currSingleLineOffset = nameOffset + newParameter.length;
                continue;
              } else if (this.parseUtils.isDebugMethod(newParameter)) {
                // handle debug functions
                this._logDEBUG(`  -- rDbgStM() debug function=[${newParameter}]`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: newParameter.length,
                  ptTokenType: 'debug',
                  ptTokenModifiers: ['function']
                });
                currSingleLineOffset = nameOffset + newParameter.length;
                continue;
              } else if (this.parseUtils.isSpinBuiltinMethod(newParameter)) {
                // XYZZY here method coloring
                // FIXME: TODO: replaces name-concat with regEX search past whitespace for '('
                this._logSPIN(`  -- rDbgStM() built-in method=[${newParameter}]`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: newParameter.length,
                  ptTokenType: 'function', // method is blue?!, function is yellow?!, operator is violet?!
                  ptTokenModifiers: ['builtin']
                });
              } else if (this.parseUtils.isSpinBuiltInVariable(newParameter)) {
                // XYZZY here constant coloring
                this._logDEBUG(`  -- rDbgStM() register=[${newParameter}]`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: newParameter.length,
                  ptTokenType: 'variable',
                  ptTokenModifiers: ['readonly']
                });
                currSingleLineOffset = nameOffset + newParameter.length;
                continue;
              } else if (
                this.parseUtils.isUnaryOperator(newParameter) ||
                this.parseUtils.isBinaryOperator(newParameter) ||
                this.parseUtils.isFloatConversion(newParameter)
              ) {
                // XYZZY here constant coloring
                this._logDEBUG(`  -- rDbgStM() unary/binary=[${newParameter}]`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: newParameter.length,
                  ptTokenType: 'operator', // method is blue?!, function is yellow?!, operator is violet?!
                  ptTokenModifiers: ['builtin']
                });
                currSingleLineOffset = nameOffset + newParameter.length;
                continue;
              }
              this._logDEBUG(`  -- rDbgStM() ?check? newParameter=[${newParameter}](${newParameter.length}), ofs=(${nameOffset})`);
              let bIsParameterName: boolean = this.parseUtils.isNameWithTypeFeed(newParameter, eDisplayType);
              if (isRuntimeNamed && newParameter.toLowerCase() == 'lutcolors') {
                bIsParameterName = true;
              }
              if (bIsParameterName) {
                this._logDEBUG(`  -- rDbgStM() mB newParam=[${newParameter}]`);
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: newParameter.length,
                  ptTokenType: 'feedParameter',
                  ptTokenModifiers: ['reference', 'defaultLibrary']
                });
              } else {
                const bIsColorName: boolean = this.parseUtils.isDebugColorName(newParameter);
                if (bIsColorName) {
                  this._logDEBUG(`  -- rDbgStM() newColor=[${newParameter}]`);
                  this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                    line: symbolPosition.line,
                    startCharacter: symbolPosition.character,
                    length: newParameter.length,
                    ptTokenType: 'colorName',
                    ptTokenModifiers: ['reference', 'defaultLibrary']
                  });
                } else {
                  // unknown parameter, is known symbol?
                  let referenceDetails: RememberedToken | undefined = undefined;
                  if (this.semanticFindings.hasLocalPAsmTokenForMethod(this.currentMethodName, newParameter)) {
                    referenceDetails = this.semanticFindings.getLocalPAsmTokenForMethod(this.currentMethodName, newParameter);
                    this._logDEBUG(`  --  FOUND local PASM name=[${newParameter}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
                  } else if (this.semanticFindings.isLocalToken(newParameter)) {
                    referenceDetails = this.semanticFindings.getLocalTokenForLine(newParameter, symbolPosition.line + 1);
                    this._logDEBUG(`  --  FOUND local name=[${newParameter}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
                  } else if (this.semanticFindings.isGlobalToken(newParameter)) {
                    referenceDetails = this.semanticFindings.getGlobalToken(newParameter);
                    this._logDEBUG(`  --  FOUND global name=[${newParameter}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
                  }
                  if (referenceDetails !== undefined) {
                    this._logDEBUG(`  -- rDbgStM() debug newParameter=[${newParameter}]`);
                    this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                      line: symbolPosition.line,
                      startCharacter: symbolPosition.character,
                      length: newParameter.length,
                      ptTokenType: referenceDetails.type,
                      ptTokenModifiers: referenceDetails.modifiers
                    });
                  } else {
                    // handle unknown-name case
                    const paramIsSymbolName: boolean = this.parseUtils.isValidSpinSymbolName(newParameter) ? true : false;
                    if (
                      paramIsSymbolName &&
                      this.parseUtils.isDebugMethod(newParameter) == false &&
                      newParameter.indexOf('`') == -1 &&
                      !this.parseUtils.isUnaryOperator(newParameter) &&
                      !this.parseUtils.isBinaryOperator(newParameter) &&
                      !this.parseUtils.isFloatConversion(newParameter) &&
                      !this.parseUtils.isSpinBuiltinMethod(newParameter) &&
                      !this.parseUtils.isSpinReservedWord(newParameter) &&
                      !this.parseUtils.isBuiltinStreamerReservedWord(newParameter)
                    ) {
                      this._logDEBUG('  -- rDbgStM() 2 unkParam=[${newParameter}]'); // XYZZY LutColors
                      this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                        line: symbolPosition.line,
                        startCharacter: symbolPosition.character,
                        length: newParameter.length,
                        ptTokenType: 'setupParameter',
                        ptTokenModifiers: ['illegalUse']
                      });
                      this.semanticFindings.pushDiagnosticMessage(
                        symbolPosition.line,
                        symbolPosition.character,
                        symbolPosition.character + newParameter.length,
                        eSeverity.Error,
                        `P2 Spin debug() mB unknown name [${newParameter}]`
                      );
                    }
                  }
                }
              }
              currSingleLineOffset = nameOffset + newParameter.length;
            }
          }
        }
      } else {
        this._logDEBUG(`  -- rDbgStM() --- PROCESSING non-display (other) currSingleLineOffset=(${currSingleLineOffset})`);
        // -------------------------------------
        // process non-display debug statement
        // BUGFIX: clean up array references in lineParts
        const hasArrayRefs = lineParts.some((str) => str.startsWith('['));
        let adjLineParts: string[] = lineParts;
        if (hasArrayRefs) {
          adjLineParts = [];
          // Remove array references from lineParts
          for (let index = 0; index < lineParts.length; index++) {
            const element = lineParts[index];
            if (element.startsWith('[')) {
              const newParts: string[] = element.split(/[[\]]/).filter(Boolean);
              adjLineParts.push(...newParts);
            } else {
              adjLineParts.push(element);
            }
          }
          this._logMessage(`  -- rDbgStM() - lineParts=[${lineParts}](${lineParts.length})`);
          this._logMessage(`         is nowlineParts=[${adjLineParts}](${adjLineParts.length})`);
        }
        const firstParamIdx: number = adjLineParts.length > 1 && adjLineParts[0].toLowerCase().includes('debug') ? 1 : 0; // no prefix to skip
        let newParameter: string = '';
        let symbolPosition: Position = Position.create(-1, -1);
        let nameOffset: number = 0;
        for (let idx = firstParamIdx; idx < adjLineParts.length; idx++) {
          newParameter = adjLineParts[idx];
          if (inPasm) {
            //  if PASM then
            //  DO NOT strip the ':' as this a local PASM label
          } else {
            // if SPIN then
            //  SPECIAL for method return value names: Ex: ':typeName'
            if (newParameter.startsWith(':')) {
              newParameter = newParameter.substring(1);
            }
          }
          const [paramIsNumber, paramIsSymbolName] = this.parseUtils.isValidSpinConstantOrSpinSymbol(newParameter, inPasm);
          if (paramIsNumber) {
            symbolPosition = multiLineSet.locateSymbol(newParameter, currSingleLineOffset);
            nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
            this._logDEBUG(`  -- rDbgStM() Number=[${newParameter}]`);
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: symbolPosition.character,
              length: newParameter.length,
              ptTokenType: 'number',
              ptTokenModifiers: []
            });
            currSingleLineOffset += newParameter.length;
            continue;
          }
          if (!paramIsSymbolName) {
            this._logSPIN(`  -- rDbgStM() SKIP not-sym name=[${newParameter}](${newParameter.length})`);
            currSingleLineOffset += newParameter.length;
            continue;
          }
          if (newParameter.toLowerCase() == 'debug') {
            currSingleLineOffset += newParameter.length;
            this._logSPIN(`  -- rDbgStM() SKIP debug name=[${newParameter}](${newParameter.length})`);
            continue;
          }
          //symbolOffset = line.indexOf(newParameter, symbolOffset); // walk this past each
          symbolPosition = multiLineSet.locateSymbol(newParameter, currSingleLineOffset);
          nameOffset = multiLineSet.offsetIntoLineForPosition(symbolPosition);
          this._logDEBUG(
            `  --  rDbgStM() handle SYMBOL=[${newParameter}], currSingleLineOfs=(${currSingleLineOffset}), posn=[${symbolPosition.line}, ${symbolPosition.character}], nameOfs=(${nameOffset})`
          );
          // if new  debug method in later version then highlight it
          if (this.parseUtils.isDebugMethod(newParameter) || this.parseUtils.isNewlyAddedDebugSymbol(newParameter)) {
            this._logSPIN(`  -- rDbgStM() (possibly) new DEBUG name=[${newParameter}](${newParameter.length}), ofs=(${nameOffset})`);
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: symbolPosition.character,
              length: newParameter.length,
              ptTokenType: 'debug',
              ptTokenModifiers: ['function']
            });
            currSingleLineOffset = nameOffset + newParameter.length;
            continue;
          }
          // if unary operator then highlight it
          if (
            this.parseUtils.isUnaryOperator(newParameter) ||
            this.parseUtils.isBinaryOperator(newParameter) ||
            this.parseUtils.isFloatConversion(newParameter)
          ) {
            this._logSPIN(
              `  -- rDbgStM() (possibly) Unary/Binary Op/Float Conversion name=[${newParameter}](${newParameter.length}), ofs=(${nameOffset})`
            );
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: symbolPosition.character,
              length: newParameter.length,
              ptTokenType: 'operator', // method is blue?!, function is yellow?!, operator is violet?!
              ptTokenModifiers: ['builtin']
            });
            currSingleLineOffset = nameOffset + newParameter.length;
            continue;
          }
          // do we have version added method? then highlight as method
          if (this.parseUtils.isVersionAddedMethod(newParameter)) {
            this._logDEBUG(`  -- rDbgStM() newVersionAddedMethod=[${newParameter}]`);
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: symbolPosition.character,
              length: newParameter.length,
              ptTokenType: 'function', // method is blue?!, function is yellow?!, operator is purple?!
              ptTokenModifiers: ['builtin']
            });
            currSingleLineOffset = nameOffset + newParameter.length;
            continue;
          }
          // have a B/W/L storage type?
          if (this.parseUtils.isStorageType(newParameter)) {
            this._logMessage(`  -- rDbgStM() type=[${newParameter}], ofs=(${nameOffset})`);
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: nameOffset,
              length: newParameter.length,
              ptTokenType: 'storageType',
              ptTokenModifiers: ['readonly']
            });
            currSingleLineOffset = nameOffset + newParameter.length;
            continue;
          }
          const specialIndexTypeAccessRegEx = new RegExp(`${newParameter}\\s*\\[`);
          const bFoundAccessType: boolean = multiLineSet.line.slice(nameOffset).match(specialIndexTypeAccessRegEx) != null;
          if (bFoundAccessType && this.parseUtils.isSpecialIndexType(newParameter)) {
            // have a 'reg' of reg[cog-address][index].[bitfield]
            // have a 'byte' of byte[hub-address][index].[bitfield]
            // have a 'word' of word[hub-address][index].[bitfield]
            // have a 'long' of long[hub-address][index].[bitfield]
            this._logMessage(`  -- rDbgStM() register=[${newParameter}], ofs=(${nameOffset})`);
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: nameOffset,
              length: newParameter.length,
              ptTokenType: 'operator', // method is blue?!, function is yellow?!
              ptTokenModifiers: ['builtin']
            });
            currSingleLineOffset = nameOffset + newParameter.length;
            continue;
          }
          // is spin builtin method?
          if (this.parseUtils.isSpinBuiltinMethod(newParameter)) {
            this._logMessage(`  -- rDbgStM() type=[${newParameter}], ofs=(${nameOffset})`);
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: nameOffset,
              length: newParameter.length,
              ptTokenType: 'function', // method is blue?!, function is yellow?!, operator is violet?!
              ptTokenModifiers: ['builtin']
            });
            currSingleLineOffset = nameOffset + newParameter.length;
            continue;
          }
          // does name contain a namespace reference?
          let bHaveObjReference: boolean = false;
          let bHaveStructReference: boolean = false;
          let bHaveStruct: boolean = false;
          if (this._isPossibleObjectReference(newParameter)) {
            // go register object reference!
            bHaveObjReference = this._reportObjectReference(
              newParameter,
              symbolPosition.line,
              symbolPosition.character,
              multiLineSet.lineAt(symbolPosition.line),
              tokenSet
            );
          }
          if (!bHaveObjReference && this._isPossibleStructureReference(newParameter)) {
            const [bFoundStructReference, refString] = this._reportStructureReference(
              newParameter,
              symbolPosition.line,
              symbolPosition.character,
              multiLineSet.lineAt(symbolPosition.line),
              tokenSet
            );
            if (bFoundStructReference) {
              bHaveStructReference = true;
              if (newParameter !== refString) {
                this._logSPIN(
                  `  -- rDbgStM() B ERROR?! [${refString}](${refString.length}) is only part of [${newParameter}](${newParameter.length}), how to handle the rest?`
                );
              }
              currSingleLineOffset = nameOffset + refString.length;
              continue;
            }
          }
          if (!bHaveStructReference && this.semanticFindings.isStructure(newParameter)) {
            bHaveStruct = true;
            this._logMessage(`  --  structTypeName=[${newParameter}], ofs=(${symbolPosition.character})`);
            // this is a structure type use!
            this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
              line: symbolPosition.line,
              startCharacter: symbolPosition.character,
              length: newParameter.length,
              ptTokenType: 'storageType',
              ptTokenModifiers: []
            });
          }
          if (!bHaveObjReference && !bHaveStructReference && !bHaveStruct) {
            this._logDEBUG(`  -- Multi ?check? [${newParameter}]`);
            if (newParameter.endsWith('.')) {
              newParameter = newParameter.slice(0, -1);
            }

            let referenceDetails: RememberedToken | undefined = undefined;
            if (this.semanticFindings.hasLocalPAsmTokenForMethod(this.currentMethodName, newParameter)) {
              referenceDetails = this.semanticFindings.getLocalPAsmTokenForMethod(this.currentMethodName, newParameter);
              this._logDEBUG(`  --  FOUND local PASM name=[${newParameter}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
            } else if (this.semanticFindings.isLocalToken(newParameter)) {
              referenceDetails = this.semanticFindings.getLocalTokenForLine(newParameter, symbolPosition.line + 1);
              this._logDEBUG(`  --  FOUND local name=[${newParameter}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
            } else if (this.semanticFindings.isGlobalToken(newParameter)) {
              referenceDetails = this.semanticFindings.getGlobalToken(newParameter);
              this._logDEBUG(`  --  FOUND global name=[${newParameter}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`);
            }
            if (referenceDetails !== undefined) {
              //this._logPASM('  --  Debug() Multi colorize name=[' + newParameter + ']');
              this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                line: symbolPosition.line,
                startCharacter: symbolPosition.character,
                length: newParameter.length,
                ptTokenType: referenceDetails.type,
                ptTokenModifiers: referenceDetails.modifiers
              });
            } else if (this.parseUtils.isUnaryOperator(newParameter) || this.parseUtils.isBinaryOperator(newParameter)) {
              this._logPASM(`  --  Debug() version added operator=[${newParameter}]`);
              this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                line: symbolPosition.line,
                startCharacter: symbolPosition.character,
                length: newParameter.length,
                ptTokenType: 'operator', // method is blue?!, function is yellow?!
                ptTokenModifiers: ['builtin']
              });
            } else {
              // handle unknown-name case
              const paramIsSymbolName: boolean = this.parseUtils.isValidSpinSymbolName(newParameter) ? true : false;
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
                this._logDEBUG('  -- rDbgStM() 3 unkParam=[${newParameter}]');
                this._recordToken(tokenSet, multiLineSet.lineAt(symbolPosition.line), {
                  line: symbolPosition.line,
                  startCharacter: symbolPosition.character,
                  length: newParameter.length,
                  ptTokenType: 'setupParameter',
                  ptTokenModifiers: ['illegalUse']
                });
                this.semanticFindings.pushDiagnosticMessage(
                  symbolPosition.line,
                  symbolPosition.character,
                  symbolPosition.character + newParameter.length,
                  eSeverity.Error,
                  `P2 Spin debug() mC unknown name [${newParameter}]`
                );
              }
            }
          }
          currSingleLineOffset = nameOffset + newParameter.length;
        }
      }
      // (2) highlight strings
      this._logDEBUG(`  --  CM _rptDebugStrings() Ln#${multiLineSet.lineStartIdx + 1}) debugStatementStr=[${debugStatementStr}]`);
      const tokenStringSet: IParsedToken[] = this._reportDebugStringsMultiLine(startingOffset, multiLineSet);
      tokenStringSet.forEach((newToken) => {
        tokenSet.push(newToken);
      });
    } else {
      this._logDEBUG(`ERROR: _rptDebugStatementMulti() Ln#${multiLineSet.lineStartIdx + 1} line=[${multiLineSet.line}] no debug()??`);
    }
    return tokenSet;
  }

  private isStorageType(possibleType: string): boolean {
    return this.parseUtils.isStorageType(possibleType) || this.semanticFindings.isStructure(possibleType);
  }

  private _isPossibleStructureReference(possibleRef: string): boolean {
    const dottedSymbolRegex = /[a-zA-Z0-9_]\.[a-zA-Z_]/; // sym.sym
    const dottedIndexedSymbolRegex = /\]\.[a-zA-Z_]/; // indexExpre].sym
    const hasSymbolDotSymbol: boolean = dottedSymbolRegex.test(possibleRef);
    const hasSymbolDotIndexedSymbol: boolean = dottedIndexedSymbolRegex.test(possibleRef);
    const nameParts: string[] = possibleRef.split(/[.[\]]/).filter(Boolean);
    this._logMessage(
      `  --  isStruRef() hasDot=(${hasSymbolDotSymbol}), hasIndex=(${hasSymbolDotIndexedSymbol}), nameParts=[${nameParts}](${nameParts.length})`
    );
    const isStructureRef: boolean = nameParts.length > 0 && this.semanticFindings.isStructureInstance(nameParts[0]);
    const refFoundStatus: boolean = isStructureRef && !possibleRef.startsWith('.') && (hasSymbolDotIndexedSymbol || hasSymbolDotSymbol);
    this._logMessage(
      `  --  isStruRef() structRef=[${possibleRef}], isStructRef=(${isStructureRef}), hasSymbolDotSymbol=(${hasSymbolDotSymbol}), hasSymbolDotIndexedSymbol=(${hasSymbolDotIndexedSymbol}) -> (${refFoundStatus})`
    );
    return refFoundStatus;
  }

  private _getStructureDescentParts(dotRef: string): string[] {
    const desiredStrings: string[] = [];
    // Ex: m.cmds[motor].cmd[m.head[motor]]
    //   returns [m, cmds[motor], cmd[m.head[motor]]
    // locates strings separated by '.' but not '.' within brackets
    // Regular expression to match strings separated by '.' but not '.' within brackets
    const regex = /(?:[^[\].]+|\[[^\]]*\])+/g; // ?? omits the final ']'!!!
    //const regex = /(?:[^[\].]+|\[[^\]]*\])/g;  // bad
    //const regex = /[^[\].]+|\[[^[\]]*\]/g; // bad

    // Match the dotRef string using the regex
    const matches = dotRef.match(regex);

    if (matches) {
      for (const match of matches) {
        // Add each match to the result array
        // but first, Check if the match has an imbalanced count of '[' and ']'
        const leftBracketCount = (match.match(/\[/g) || []).length;
        const rightBracketCount = (match.match(/\]/g) || []).length;

        let desiredMatch: string = match;
        if (leftBracketCount > rightBracketCount) {
          // Append a final ']' to balance the brackets due to regex(above) limitation/artifact
          desiredMatch = `${desiredMatch}]`;
        }
        // now do NOT push [value] as these are bitfield index exressions
        if (!desiredMatch.startsWith('[')) {
          desiredStrings.push(desiredMatch);
        }
      }
    }
    this._logSPIN(`  --  getStruDesceParts([${dotRef}]) -> [${desiredStrings.join(', ')}](${desiredStrings.length})`);
    return desiredStrings;
  }

  private _isPossibleObjectReference(possibleRef: string): boolean {
    // could be objectInstance.method or objectInstance#constant or objectInstance.method()
    // but can NOT be ".name"
    // NOTE" '%' is special object constant override mechanism
    // NEW adjust dot check to symbol.symbol
    // BUG missed an object REF of form:
    //  digits[(numberDigits - 1) - digitIdx].setValue(digitValue)
    // NEW Don't mistake structure instance name for object reference
    const dottedSymbolRegex = /[a-zA-Z0-9_]\.[a-zA-Z_]/; // sym.sym
    const dottedIndexedSymbolRegex = /\]\.[a-zA-Z_]/; // indexExpre].sym
    const hashedSymbolRegex = /[a-zA-Z0-9_]#[a-zA-Z_]/; // sym#sym
    const percentSymbolRegex = /[a-zA-Z0-9_]%[a-zA-Z_]/; // sym%sym
    const hasSymbolDotSymbol: boolean = dottedSymbolRegex.test(possibleRef);
    const hasSymbolHashSymbol: boolean = hashedSymbolRegex.test(possibleRef);
    const hasPercentHashSymbol: boolean = percentSymbolRegex.test(possibleRef);
    const hasSymbolDotIndexedSymbol: boolean = dottedIndexedSymbolRegex.test(possibleRef);
    const possibleRefLC: string = possibleRef.toLowerCase();
    const isPartialVariableAccess: boolean = possibleRefLC.includes('.byte[') || possibleRefLC.includes('.word[') || possibleRefLC.includes('.long[');
    this._logMessage(
      `  --  isObjRef() hasSymbolDotSymbol=(${hasSymbolDotSymbol}),  hasSymbolHashSymbol=(${hasSymbolHashSymbol}) hasPercentHashSymbol=(${hasPercentHashSymbol}) hasSymbolDotIndexedSymbol=(${hasSymbolDotIndexedSymbol})`
    );
    let nameParts: string[] = [possibleRef];
    if (possibleRef.includes('.')) {
      nameParts = possibleRef.split(/[.]/).filter(Boolean);
    }
    const structInstanceName: string = nameParts[0];
    const isStructureRef: boolean =
      structInstanceName !== undefined && this.parseUtils.requestedSpinVersion(45)
        ? this.semanticFindings.isStructureInstance(structInstanceName)
        : false;
    if (structInstanceName === undefined) {
      this._logMessage(
        `  --  isObjRef() ERROR structInstanceName=[{undefined}], possibleRef=[${possibleRef}], nameParts=[${nameParts}](${nameParts.length})`
      );
    }
    this._logMessage(`  --  isObjRef() isStructureRef=(${isStructureRef}), nameParts=[${nameParts}](${nameParts.length}) `);
    const refFoundStatus: boolean =
      !isStructureRef &&
      !possibleRef.startsWith('.') &&
      !isPartialVariableAccess &&
      (hasSymbolDotIndexedSymbol || hasSymbolDotSymbol || hasSymbolHashSymbol || hasPercentHashSymbol);
    this._logMessage(`  --  isObjRef() possibleRef=[${possibleRef}] -> (${refFoundStatus})`);
    return refFoundStatus;
  }

  private _getStructureFromObjectReference(dotRef: string): RememberedStructure | undefined {
    let structureFindings: RememberedStructure | undefined = undefined;
    const possibleNameSet: string[] = dotRef.trimStart().split(/[.#%]/).filter(Boolean);
    if (possibleNameSet.length > 1) {
      const objInstanceName = possibleNameSet[0];
      const structName = possibleNameSet[1];
      this._logMessage(`  --  gsfObjRef possibleNameSet=[${possibleNameSet}](${possibleNameSet.length})`);
      if (this.semanticFindings.isNameSpace(objInstanceName)) {
        const nameSpaceFindings: DocumentFindings | undefined = this.semanticFindings.getFindingsForNamespace(objInstanceName);
        if (nameSpaceFindings !== undefined && nameSpaceFindings.isStructure(structName)) {
          structureFindings = nameSpaceFindings.getStructure(structName);
        }
      }
    }
    return structureFindings;
  }

  private _reportObjectReference(
    dotRef: string,
    lineIdx: number,
    initialOffset: number,
    line: string,
    tokenSet: IParsedToken[],
    onlyStructRefs: boolean = false
  ): boolean {
    // Handle: objInstanceName.constant or objInstanceName.method()
    // NEW handle objInstanceName[index].constant or objInstanceName[index].constant
    // NOTE: we allow old P1 style constant references to get here but are then FAILED
    // NOTE" '%' is special object constant override mechanism to allow this to happen
    // NOTE BUG: not handled:
    //   digits[(numberDigits - 1) - digitIdx].setValue(digitValue)
    let bGeneratedReference: boolean = false;
    if (line !== undefined && line.length > 0) {
      const lineLength: number = line.length;
      const matchOffset: number = line.indexOf(dotRef, initialOffset);
      this._logMessage(
        `- rptObjectReference() ln#${lineIdx + 1}: dotRef=[${dotRef}], ofs(s/m)=(${initialOffset}/${matchOffset}), line=[${line}](${lineLength})`
      );
      const lineNbr: number = lineIdx + 1;
      let possibleNameSet: string[] = [];
      const isP1ObjectConstantRef: boolean = dotRef.includes('#');
      const isP2ObjectOverrideConstantRef: boolean = dotRef.includes('%');
      if ((dotRef.includes('.') || isP1ObjectConstantRef || isP2ObjectOverrideConstantRef) && !dotRef.includes('..')) {
        const symbolOffset: number = line.indexOf(dotRef.trimStart(), initialOffset); // walk this past each
        possibleNameSet = dotRef.trimStart().split(/[.#%]/).filter(Boolean);
        let objInstanceName = possibleNameSet[0];
        this._logMessage(`  --  rObjRef possibleNameSet=[${possibleNameSet}](${possibleNameSet.length})`);
        let nameParts: string[] = [objInstanceName];
        const indexNames: string[] = [];
        let objectRefContainsIndex: boolean = false;
        // if we have arrayed object instances...
        let indexesOffset: number = -1;
        let bIsStructureInstance: boolean = false;
        if (objInstanceName.includes('[')) {
          // remove parens, brackets, and math ops
          const leftBracketOffset: number = line.indexOf('[', symbolOffset);
          indexesOffset = leftBracketOffset + 1;
          nameParts = objInstanceName.split(/[ ()*+\-/[\]]/).filter(Boolean);
          objInstanceName = nameParts[0]; // collect the object instance name
          this._logMessage(`  --  rObjRef-Idx nameParts=[${nameParts}]`);
          // FIXME: handle nameParts[1] is likely a local file variable
          if (nameParts.length > 1) {
            for (let index = 1; index < nameParts.length; index++) {
              const indexName = nameParts[index];
              if (this.parseUtils.isValidSpinSymbolName(indexName)) {
                indexNames.push(indexName);
              }
            }
          }
          if (this.semanticFindings.isStructureInstance(objInstanceName)) {
            this._logMessage(`  --  rObjRef instanceName=[${objInstanceName}] is a STRUCT instance, NOT object!`);
            bIsStructureInstance = true;
          }
          objectRefContainsIndex = indexNames.length > 0 ? true : false;

          if (!bIsStructureInstance && objectRefContainsIndex) {
            // handle case: instance[index].reference[()]  - "index" value
            // now too handle case: digits[(numberDigits - 1) - digitIdx].setValue(digitValue)
            this.reportsSymbolsForSet('index value', indexesOffset, indexNames, line, lineNbr, tokenSet, lineIdx);
          }
        }
        // processed objectInstance[index] (indexes now marked)
        // now do objectInstance.constant or objectInstance.method() reference
        if (!bIsStructureInstance && this.semanticFindings.isNameSpace(objInstanceName)) {
          let referenceDetails: RememberedToken | undefined = undefined;
          if (this.semanticFindings.isGlobalToken(objInstanceName)) {
            referenceDetails = this.semanticFindings.getGlobalToken(objInstanceName);
            this._logMessage(`  --  FOUND global name=[${objInstanceName}]`);
          }
          if (referenceDetails !== undefined) {
            // SPECIAL: of we can only return a structure reference then hold off on marking we found a reference
            bGeneratedReference = onlyStructRefs ? false : true;
            // if this is not a local object overrides ref then generate token
            if (!isP2ObjectOverrideConstantRef) {
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: symbolOffset,
                length: objInstanceName.length,
                ptTokenType: referenceDetails.type,
                ptTokenModifiers: referenceDetails.modifiers
              });
            }
            if (possibleNameSet.length > 1) {
              // we have .constant namespace suffix
              // determine if this is method has '(' or is constant name
              // we need to allow objInstance.CONSTANT and fail objectInstance[index].CONSTANT
              // XYZZY NEW if onlyStructRefs: need to fail objInstance.CONSTANT too
              const refParts: string[] = possibleNameSet[1].split(/[ ()*+,\-/[\]]/).filter(Boolean);
              const parameters: string[] = [];
              this._logMessage(`  -- possibleNameSet[1]=[${possibleNameSet[1]}] split into refParts=[${refParts}](${refParts.length})`);
              const refPart = refParts[0];
              //const rhsOffset = line.indexOf(possibleNameSet[1], initialOffset);
              const referenceOffset = line.indexOf(refPart, initialOffset);
              //const addressOf = `@${refPart}`;
              // if it "could" be a method
              let isMethod: boolean = line.substring(matchOffset).includes('(') ? true : false;
              if (isMethod) {
                // ok, now let's be really sure!
                const methodFollowString: string = line.substring(matchOffset + dotRef.length);
                this._logSPIN(`  --  ObjRef func Paren chk methodFollowString=[${methodFollowString}](${methodFollowString.length})`);
                isMethod = isMethodCall(methodFollowString);
              }
              if (isMethod && refParts.length > 1) {
                // assign all but the first value which is the method name
                for (let index = 1; index < refParts.length; index++) {
                  const parameterName = refParts[index];
                  if (this.parseUtils.isValidSpinSymbolName(parameterName)) {
                    parameters.push(parameterName);
                  }
                }
              }
              referenceDetails = undefined; // preset to we didn't find a ref...
              const nameSpaceFindings: DocumentFindings | undefined = this.semanticFindings.getFindingsForNamespace(objInstanceName);
              if (!isP1ObjectConstantRef && nameSpaceFindings !== undefined) {
                referenceDetails = nameSpaceFindings.getPublicToken(refPart);
                this._logMessage(`  --  LookedUp Object-global token [${refPart}] got [${referenceDetails}]`);
                // NOTE: in @instance[index].method the normal parenthesis are missing...
                //  if the lookup sees that it's a method let's override the failed hunt for (...)
                if (referenceDetails?._type == 'method') {
                  isMethod = true;
                  this._logMessage(`  --  rObjRef OVERRIDE isMethod (object lookup says it is!)`);
                }
              }
              const isStructure: boolean =
                nameSpaceFindings !== undefined && this.parseUtils.requestedSpinVersion(45) ? nameSpaceFindings.isStructure(refPart) : false;
              this._logMessage(
                `  --  rObjRef isMethod=(${isMethod}), isStructure=(${isStructure}), isP1ObjectConstRef=(${isP1ObjectConstantRef}), objectRefHasIndex=(${objectRefContainsIndex})`
              );

              // XYZZY NEW if onlyStructRefs: need to fail objInstance.method() !!!
              if (referenceDetails && !isStructure && !onlyStructRefs && (isMethod || (!isMethod && !objectRefContainsIndex))) {
                // we need to allow objInstance.CONSTANT and fail objectInstance[index].CONSTANT
                const constantPart: string = possibleNameSet[1];
                //const constantOffset: number = line.indexOf(constantPart, matchOffset + possibleNameSet[0].length);
                const tokenModifiers: string[] = isMethod ? [] : ['readonly'];
                this._logMessage(`  --  rObjRef rhs constant=[${constantPart}], ofs=(${referenceOffset + 1}) (${referenceDetails.type})`);
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: referenceOffset,
                  length: refPart.length,
                  ptTokenType: referenceDetails.type,
                  ptTokenModifiers: tokenModifiers
                });
              } else if (isStructure) {
                bGeneratedReference = true; // need this iff we are only looking for structure references
                const structurePart: string = possibleNameSet[1];
                const structureOffset: number = line.indexOf(structurePart, matchOffset + possibleNameSet[0].length);
                this._logMessage(`  --  rObjRef rhs struct=[${structurePart}], ofs=(${structureOffset})`);
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: structureOffset,
                  length: structurePart.length,
                  ptTokenType: 'storageType',
                  ptTokenModifiers: ['readonly']
                });
              } else {
                this._logMessage(`  --  rObjRef Error refPart=[${refPart}](${referenceOffset + 1})`);
                this._recordToken(tokenSet, line, {
                  line: lineIdx,
                  startCharacter: referenceOffset,
                  length: refPart.length,
                  ptTokenType: 'variable',
                  ptTokenModifiers: ['illegalUse']
                });
                if (!isMethod && objectRefContainsIndex) {
                  const refType: string = 'Constant';
                  const adjustedName: string = refPart;
                  this.semanticFindings.pushDiagnosticMessage(
                    lineIdx,
                    referenceOffset,
                    referenceOffset + refPart.length,
                    eSeverity.Error,
                    `P2 Spin Object ${refType} form "${objInstanceName}[...].${adjustedName}" not allowed, (use "${objInstanceName}.${adjustedName}" instead)`
                  );
                } else if (!isP1ObjectConstantRef) {
                  const refType: string = isMethod ? 'Method' : 'Constant';
                  const adjustedName: string = isMethod ? `${refPart}()` : refPart;
                  this.semanticFindings.pushDiagnosticMessage(
                    lineIdx,
                    referenceOffset,
                    referenceOffset + refPart.length,
                    eSeverity.Error,
                    `P2 Spin Object ${refType} [${adjustedName}] not found in [${objInstanceName}]`
                  );
                } else {
                  // have old style P1 Constant ref
                  const refType: string = 'Constant Reference';
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
              // now handle any parameters
              if (isMethod && parameters.length > 0) {
                this.reportsSymbolsForSet('parameter value', referenceOffset + refPart.length, parameters, line, lineNbr, tokenSet, lineIdx);
              }
            }
          }
        } else {
          // now we have a possible objInst.name but let's validate
          this._logMessage(`  --  rObjRef no NAMESPACE possibleNameSet=[${possibleNameSet}](${possibleNameSet.length})`);
          //   NAMESPACE NOT FOUND !
          if (!bIsStructureInstance && possibleNameSet.length > 1) {
            let objInstanceName: string = possibleNameSet[0];
            const referencePart: string = possibleNameSet[1];
            // NO if either side is storage type
            if (this.isStorageType(objInstanceName) || this.isStorageType(referencePart)) {
              bGeneratedReference = false;
            }
            // NO if either side is not legit symbol
            else if (!this.parseUtils.isValidSpinSymbolName(objInstanceName) || !this.parseUtils.isValidSpinSymbolName(referencePart)) {
              bGeneratedReference = false;
            } else {
              bGeneratedReference = true;
              const referenceOffset = line.indexOf(referencePart, symbolOffset + objInstanceName.length + 1);
              let isMethod: boolean = false;
              if (line.substr(referenceOffset + referencePart.length, 1) == '(') {
                isMethod = true;
              }
              let nameParts: string[] = [objInstanceName];
              if (objInstanceName.includes('[')) {
                nameParts = objInstanceName.split(/[[\]]/).filter(Boolean);
                objInstanceName = nameParts[0];

                // FIXME: handle nameParts[1] is likely a local file variable
              }
              this._logMessage(`  --  rObjRef MISSING instance declaration=[${objInstanceName}]`);
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: symbolOffset,
                length: objInstanceName.length,
                ptTokenType: 'variable',
                ptTokenModifiers: ['missingDeclaration']
              });
              this.semanticFindings.pushDiagnosticMessage(
                lineIdx,
                symbolOffset,
                symbolOffset + objInstanceName.length,
                eSeverity.Error,
                `P2 Spin Missing object instance declaration [${objInstanceName}]`
              );
              // and handle refenced object
              this._logMessage('  --  rObjRef Error refPart=[' + referencePart + '](' + (referenceOffset + 1) + ')');
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: referenceOffset,
                length: referencePart.length,
                ptTokenType: 'variable',
                ptTokenModifiers: ['illegalUse']
              });
              if (!isP1ObjectConstantRef) {
                const refType: string = isMethod ? 'Method' : 'Constant';
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
                const refType: string = 'Constant Reference';
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
    }
    this._logMessage(`- rptObjectReference() EXIT returns=(${bGeneratedReference})`);
    return bGeneratedReference;
  }

  private reportsSymbolsForSet(
    parseType: string,
    initialOffset: number,
    nameSet: string[],
    line: string,
    lineNbr: number,
    tokenSet: IParsedToken[],
    lineIdx: number
  ) {
    this._logMessage(`  --  rObjRef-Set initialOffset=(${initialOffset}), nameSet=[${nameSet}]`);
    const currentOffset: number = initialOffset;
    for (let index = 0; index < nameSet.length; index++) {
      const namePart = nameSet[index];
      const nameOffset = line.indexOf(namePart, initialOffset);
      this._logMessage(`  --  rObjRef-Set searchString=[${namePart}]`);
      this._logMessage(`  --  rObjRef-Set nameOffset=(${nameOffset}), currentOffset=(${currentOffset})`);
      let referenceDetails: RememberedToken | undefined = undefined;
      if (this.semanticFindings.isLocalToken(namePart)) {
        referenceDetails = this.semanticFindings.getLocalTokenForLine(namePart, lineNbr);
        this._logMessage(`  --  FOUND local name=[${namePart}]`);
      } else if (this.semanticFindings.isGlobalToken(namePart)) {
        referenceDetails = this.semanticFindings.getGlobalToken(namePart);
        this._logMessage(`  --  FOUND global name=[${namePart}]`);
      }
      if (referenceDetails !== undefined) {
        this._logMessage(`  --  rObjRef-Set name=[${namePart}](${namePart.length}), ofs(${nameOffset})`);
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: nameOffset,
          length: namePart.length,
          ptTokenType: referenceDetails.type,
          ptTokenModifiers: referenceDetails.modifiers
        });
      } else {
        // have unknown name!? what is it?
        this._logSPIN(`  -- rObjRef-Set Unknown name=[${namePart}]`);
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: nameOffset,
          length: namePart.length,
          ptTokenType: 'variable',
          ptTokenModifiers: ['illegalUse']
        });
        this.semanticFindings.pushDiagnosticMessage(
          lineIdx,
          nameOffset,
          nameOffset + namePart.length,
          eSeverity.Error,
          `P2 Spin failed to parse ${parseType} [${namePart}]`
        );
      }
    }
  }

  private _reportSPIN_IndexExpression(possIndex: string, lineIdx: number, startingOffset: number, line: string, tokenSet: IParsedToken[]): number {
    const nameOffset: number = startingOffset;
    if (possIndex.length > 0) {
      //const lineNbr: number = lineIdx + 1;
      // FIXME: UNDONE XYZZY the following needs to pass an entire expression | constant | symbol
      let nameOffset: number = line.indexOf(possIndex, startingOffset);
      const lineInfo: IFilteredStrings = this._getNonWhiteSpinLinePartsNonArray(possIndex);
      const expressionParts: string[] = lineInfo.lineParts.filter(Boolean);
      for (let index = 0; index < expressionParts.length; index++) {
        const indexValue: string = expressionParts[index];
        if (indexValue.length > 0) {
          // handle named index value, constant, strcture or object reference
          // handle structure or object instance names
          if (indexValue.includes('.')) {
            let bHaveObjReference: boolean = this._isPossibleObjectReference(indexValue);
            if (bHaveObjReference) {
              bHaveObjReference = this._reportObjectReference(indexValue, lineIdx, nameOffset, line, tokenSet);
              if (bHaveObjReference) {
                continue;
              }
            }
            const bFoundStructureRef: boolean = this._isPossibleStructureReference(indexValue);
            if (bFoundStructureRef) {
              const [bHaveStructReference, refString] = this._reportStructureReference(indexValue, lineIdx, nameOffset, line, tokenSet);
              if (bHaveStructReference) {
                // TODO: remove structure part from remainder of line and process the remainder
                if (indexValue !== refString) {
                  this._logSPIN(
                    `  -- rptSIdxExp(  ERROR?! [${refString}](${refString.length}) is only part of [${indexValue}](${indexValue.length}), how to handle the rest?`
                  );
                }
                continue;
              }
            }
          }
          // resume with plain named index value, constant
          // colorize index value if non-constant, or constant
          this._logDEBUG(`  -- rptSIdxExp() index=[${indexValue}](${indexValue.length}), ofs=(${nameOffset})`);
          const paramIsNumber: boolean = this.parseUtils.isValidSpinNumericConstant(indexValue);
          if (paramIsNumber) {
            this._logDEBUG(`  -- rptSIdxExp() index is Number=[${indexValue}]`);
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: nameOffset,
              length: indexValue.length,
              ptTokenType: 'number',
              ptTokenModifiers: []
            });
            nameOffset += indexValue.length;
          } else {
            let referenceDetails: RememberedToken | undefined = undefined;
            const paramIsSymbolName: boolean = this.parseUtils.isValidSpinSymbolName(indexValue);
            if (paramIsSymbolName) {
              if (this.semanticFindings.isLocalToken(indexValue)) {
                referenceDetails = this.semanticFindings.getLocalTokenForLine(indexValue, lineIdx + 1);
                this._logMessage(`  --  rptSIdxExp() FOUND local name=[${indexValue}]`);
              } else if (this.semanticFindings.isGlobalToken(indexValue)) {
                referenceDetails = this.semanticFindings.getGlobalToken(indexValue);
                this._logDEBUG(
                  `  --  rptSIdxExp() FOUND global name=[${indexValue}], referenceDetails=(${JSON.stringify(referenceDetails, null, 2)})`
                );
              }
            }
            if (referenceDetails !== undefined && paramIsSymbolName) {
              this._logDEBUG(`  --  rptSIdxExp() index is symbol=[${indexValue}]`);
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: indexValue.length,
                ptTokenType: referenceDetails.type,
                ptTokenModifiers: referenceDetails.modifiers
              });
              nameOffset += indexValue.length;
            } else {
              // handle unknown-name case -OR- invalid sybol name
              this._logDEBUG(`  -- rptSIdxExp() index is unknown=[${indexValue}]`);
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: indexValue.length,
                ptTokenType: 'setupParameter',
                ptTokenModifiers: ['illegalUse']
              });
              this.semanticFindings.pushDiagnosticMessage(
                lineIdx,
                nameOffset,
                nameOffset + indexValue.length,
                eSeverity.Error,
                `P2 Spin struct index unknown name [${indexValue}]`
              );
              nameOffset += indexValue.length;
            }
          }
        }
      }
    }
    return nameOffset;
  }

  private _reportStructureReference(
    dotRef: string,
    lineIdx: number,
    startingOffset: number,
    line: string,
    tokenSet: IParsedToken[]
  ): [boolean, string] {
    let bGeneratedReference: boolean = false;
    // many forms of structure references
    //  Ex: a.n[3]
    //  Ex: a.n[1].[31]
    //  Ex: b.n[0].[0]
    let usedRefPart: string = '';
    const lineLength: number = line ? line.length : -1;
    const matchOffset: number = line.indexOf(dotRef);
    this._logMessage(
      `- ln#${lineIdx + 1}: rptStruRef() dotRef=[${dotRef}], ofs(s/m)=(${startingOffset}/${matchOffset}), line=[${line}](${lineLength})`
    );
    let structRefParts: string[] = [];
    if (dotRef.includes('.')) {
      let nameOffset: number = line.indexOf(dotRef.trimStart(), startingOffset); // walk this past each
      structRefParts = this._getStructureDescentParts(dotRef);
      usedRefPart = structRefParts.join('.');
      this._logMessage(`  --  rptStruRef() structRefParts=[${structRefParts}](${structRefParts.length}), usedRefPart=[${usedRefPart}]`);
      let structInstanceName = structRefParts[0];
      let instanceIndex: string = '';
      if (structInstanceName.includes('[') && structInstanceName.includes(']')) {
        // yes remove array suffix
        instanceIndex = this._getIndexExpression(structInstanceName);
        structInstanceName = structInstanceName.replace(`[${instanceIndex}]`, '');
        this._logSPIN(`  -- rptStruRef() hold index value highlight memberName=[${structInstanceName}] [ [${instanceIndex}] ]`);
      }

      if (structInstanceName === undefined) {
        this._logMessage(
          `  --  isObjRef() ERROR structInstanceName=[{undefined}], dotRef=[${dotRef}], structRefParts=[${structRefParts}](${structRefParts.length})`
        );
      }
      const isStructureRef: boolean = structInstanceName !== undefined ? this.semanticFindings.isStructureInstance(structInstanceName) : false;
      bGeneratedReference = isStructureRef; // for now...
      const memberNameSet = structRefParts.length > 1 ? structRefParts.slice(1) : structRefParts;
      this._logMessage(
        `  --  rptStruRef() STRUCT [${structInstanceName}] isRef=(${isStructureRef}) memberNameSet=[${memberNameSet}](${memberNameSet.length})`
      );

      // report structure instance name
      let referenceDetails: RememberedToken | undefined = undefined;
      if (this.semanticFindings.isLocalToken(structInstanceName)) {
        referenceDetails = this.semanticFindings.getLocalTokenForLine(structInstanceName, lineIdx + 1);
        this._logMessage(`  --  FOUND local name=[${structInstanceName}] found: ${referenceDetails !== undefined}`);
      } else if (this.semanticFindings.isGlobalToken(structInstanceName)) {
        referenceDetails = this.semanticFindings.getGlobalToken(structInstanceName);
        this._logMessage(`  --  FOUND global name=[${structInstanceName}] found: ${referenceDetails !== undefined}`);
      }
      if (referenceDetails !== undefined) {
        this._logMessage(`  --  structInstanceName=[${structInstanceName}], ofs=(${nameOffset})`);
        // this is a structure instance declaration!
        this._recordToken(tokenSet, line, {
          line: lineIdx,
          startCharacter: nameOffset,
          length: structInstanceName.length,
          ptTokenType: referenceDetails.type,
          ptTokenModifiers: referenceDetails.modifiers
        });
        nameOffset += structInstanceName.length;
      }
      // report instance index value
      if (instanceIndex.length > 0) {
        this._logMessage(`  --  rptStruRef() instanceIndex=[${instanceIndex}](${instanceIndex.length}), ofs=(${nameOffset})`);
        nameOffset = this._reportSPIN_IndexExpression(instanceIndex, lineIdx, nameOffset, line, tokenSet);
      }
      // remember initial offset for structure member names
      const memberNameBaseOffset: number = nameOffset;
      for (let index = 0; index < memberNameSet.length; index++) {
        const structureMember = memberNameSet[index];
        nameOffset = line.indexOf(structureMember, memberNameBaseOffset); // walk this past each name we use
        this._logMessage(
          `  --  rptStruRef() Descent [${structInstanceName}] mbr=[${structureMember}], ofs=(${nameOffset}) at depth=[${index + 1} of ${memberNameSet.length + 1}]`
        );
        // now report descent into structure members
        const structureType: string | undefined = this.semanticFindings.getTypeForStructureInstance(structInstanceName);
        if (structureType === undefined) {
          this._logSPIN(`  --  rptStruRef() ERROR: no structure TYPE for [${structInstanceName}]`);
        } else {
          const topStructure: RememberedStructure | undefined = this.semanticFindings.getStructure(structureType);
          if (topStructure === undefined) {
            this._logSPIN(`  --  rptStruRef() ERROR: no structure INFO for [${structInstanceName}]`);
          } else {
            this._logSPIN(`  --  rptStruRef() TOP is [${topStructure.toString()}]`);
            let currStructure: RememberedStructure = topStructure;
            for (let index = 0; index < memberNameSet.length; index++) {
              // record member name coloring
              let memberName: string = memberNameSet[index];
              nameOffset = line.indexOf(memberName, nameOffset); // walk this past each name we use
              this._logSPIN(`  -- rptStruRef() evaluate memberName=[${memberName}](${memberName.length}), ofs=(${nameOffset})`);
              if (memberName.startsWith('[') && memberName.endsWith(']')) {
                // this is likely a bitfield access, ignore it
                this._logSPIN(`   --- rptStruRef() SKIP bitnbr?`);
                continue;
              }
              let indexValue: string = '';
              if (memberName.includes('[') && memberName.includes(']')) {
                // yes remove array suffix
                indexValue = this._getIndexExpression(memberName);
                memberName = memberName.replace(`[${indexValue}]`, '');
                this._logSPIN(`  -- rptStruRef() hold index value highlight memberName=[${memberName}] [ [${indexValue}] ]`);
              }
              let mbrTokenType = referenceDetails !== undefined ? referenceDetails.type : '';
              let mbrTokenModifiers = referenceDetails !== undefined ? referenceDetails.modifiers : [];
              const hasMemberName: boolean = currStructure.hasMemberNamed(memberName);
              if (!hasMemberName) {
                mbrTokenType = 'variable';
                mbrTokenModifiers = ['illegalUse'];
              }
              this._logMessage(
                `  --  rptStruRef() memberName=[${memberName}](${memberName.length}), ofs=(${nameOffset}) of [${currStructure.name}], isPresent=(${hasMemberName}) - [${mbrTokenType}][${mbrTokenModifiers}]`
              );
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: nameOffset,
                length: memberName.length,
                ptTokenType: mbrTokenType,
                ptTokenModifiers: mbrTokenModifiers
              });
              // skip to next member name
              nameOffset += memberName.length;
              if (indexValue.length > 0) {
                nameOffset = this._reportSPIN_IndexExpression(indexValue, lineIdx, nameOffset, line, tokenSet);
              }
              // descend into structure if member is structure
              if (currStructure.memberNamed(memberName)?.isStructure) {
                const currMemberInfo = currStructure.memberNamed(memberName);
                if (currMemberInfo !== undefined) {
                  this._logSPIN(
                    `  -- rptStruRef() descend into memberName=[${memberName}] currMemberInfo=[${JSON.stringify(currMemberInfo, null, 2)}]`
                  );
                  const mbrStructName: string = currMemberInfo.structName;
                  const tmpStructure = this.semanticFindings.getStructure(mbrStructName);
                  if (tmpStructure !== undefined) {
                    currStructure = tmpStructure;
                  } else {
                    this._logMessage(`  --  rptStruRef() ERROR: no member structure info for [${memberName}]`);
                  }
                }
              }
            }
          }
        }
      }
    }

    return [bGeneratedReference, usedRefPart];
  }

  private _reportDebugStringsMultiLine(startingOffset: number, multiLineSet: ContinuedLines): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    //this._logDEBUG(`- Ln#${multiLineSet.lineStartIdx + 1} rptDbgStrMulti() line=[${multiLineSet.line}], lns=(${multiLineSet.numberLines})`);
    for (let index = 0; index < multiLineSet.numberLines; index++) {
      const desiredLine: number = multiLineSet.lineStartIdx + index;
      const lnOffset: number = index == 0 ? startingOffset : 0;
      const line = multiLineSet.lineAt(desiredLine).substring(lnOffset);
      //this._logDEBUG(`- Ln#${multiLineSet.lineStartIdx + 1} scanning rptDbgStrMulti() line=[${line}][${index}]`);
      const tokenStringSet: IParsedToken[] = this._reportDebugStrings(multiLineSet.lineStartIdx + index, line, line.trim());
      if (tokenStringSet.length > 0) {
        for (let index = 0; index < tokenStringSet.length; index++) {
          const token = tokenStringSet[index];
          tokenSet.push(token);
        }
      }
    }
    return tokenSet;
  }

  private _reportDebugStrings(lineIdx: number, line: string, debugStatementStr: string): IParsedToken[] {
    // debug statements typically have single or double quoted strings.  Let's color either if/when found!
    const tokenSet: IParsedToken[] = [];
    this._logDEBUG(`- Ln#${lineIdx + 1} rptDbgStrs() line=[${line}](${line.length})`);
    let nonDoubleQuoteStringLine: string = line;
    const bNeedDoubleQuoteProcessing: boolean = line.indexOf('"') != -1;
    if (bNeedDoubleQuoteProcessing) {
      const tokenStringSet: IParsedToken[] = this._reportDebugDblQuoteStrings(lineIdx, line, debugStatementStr);
      tokenStringSet.forEach((newToken) => {
        tokenSet.push(newToken);
      });
      nonDoubleQuoteStringLine = this.parseUtils.removeDoubleQuotedStrings(debugStatementStr);
    }
    const bNeedSingleQuoteProcessing: boolean = nonDoubleQuoteStringLine.indexOf("'") != -1;
    if (bNeedSingleQuoteProcessing) {
      const tokenStringSet: IParsedToken[] = this._reportDebugSglQuoteStrings(lineIdx, line, debugStatementStr);
      tokenStringSet.forEach((newToken) => {
        tokenSet.push(newToken);
      });
    }
    return tokenSet;
  }

  private _reportDebugSglQuoteStrings(lineIdx: number, line: string, debugStatementStr: string): IParsedToken[] {
    const tokenSet: IParsedToken[] = [];
    //this._logDEBUG(`- Ln#${lineIdx + 1} rptDbgSQStrs() line=[${line}](${line.length})`);
    // find all strings in debug() statement but for now just do first...
    let currentOffset: number = line.indexOf(debugStatementStr);
    let nextStringOffset: number = 0;
    let nextString: string = '';
    do {
      nextString = this._getSingleQuotedString(nextStringOffset, debugStatementStr);
      if (nextString.length > 0) {
        nextStringOffset = debugStatementStr.indexOf(nextString, nextStringOffset);
        const chrBackTic: string = '`';
        const chrCloseParen: string = ')';
        const bStringContainsBackTic: boolean = nextString.indexOf(chrBackTic) != -1;
        if (bStringContainsBackTic) {
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
              ptTokenType: 'string',
              ptTokenModifiers: ['quoted', 'single']
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
                  ptTokenType: 'string',
                  ptTokenModifiers: ['quoted', 'single']
                });
                searchOffset = closeParenOffset + currStr.length + 1;
              }
            } else {
              this._logDEBUG('  --  rdsqs  ERROR missing close paren!');
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
            ptTokenType: 'string',
            ptTokenModifiers: ['quoted', 'single']
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
    this._logDEBUG(`- Ln#${lineIdx + 1} rptDbgDQStrs() line=[${line}](${line.length})`);
    // find all strings in debug() statement but for now just do first...
    let currentOffset: number = line.indexOf(debugStatementStr);
    let nextStringOffset: number = 0;
    let nextString: string = '';
    do {
      // locates left-most double-quoted string in debugStatement
      nextString = this._getDoubleQuotedString(nextStringOffset, debugStatementStr);
      this._logMessage(`  -- rptDbgDQStrs() found str=[${nextString}](${nextString.length})`);
      if (nextString.length > 0) {
        nextStringOffset = line.indexOf(nextString, nextStringOffset);
        const chrBackTicFunction: string = '`(';
        const chrBackTic: string = '`';
        const bStringContainsBackTic: boolean = nextString.indexOf(chrBackTicFunction) != -1;
        if (bStringContainsBackTic) {
          // add special handling for '`()' this case
          //this._logMessage('- BackTic nextString=[' + nextString + '] line=[' + line + ']');
          const chrCloseParen: string = ')';
          let searchOffset: number = 0; // value doesn't matter
          const lineStrOffset: number = line.indexOf(nextString, currentOffset);
          let backTicOffset: number = 0; // value doesn't matter
          while ((backTicOffset = nextString.indexOf(chrBackTic, searchOffset)) != -1) {
            const leftStr = nextString.substring(0, backTicOffset);
            // record the left edge string
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: lineStrOffset,
              length: leftStr.length,
              ptTokenType: 'string',
              ptTokenModifiers: ['quoted', 'double']
            });
            //this._logMessage('  -- leftStr=[' + leftStr + '] lineStrOffset=[' + lineStrOffset + ']');
            const closeParenOffset: number = nextString.indexOf(chrCloseParen, backTicOffset);
            //this._logMessage('  -- backTicOffset=[' + backTicOffset + '] closeParenOffset=[' + closeParenOffset + ']');
            if (closeParenOffset != -1) {
              searchOffset = closeParenOffset;
              const nextBackTicOffset: number = nextString.indexOf(chrBackTic, searchOffset);
              const currStrEndOffset: number = nextBackTicOffset != -1 ? nextBackTicOffset - 1 : nextString.length - 1;
              const rightStr = nextString.substring(closeParenOffset + 1, currStrEndOffset + 1);
              const rightStrOffset: number = lineStrOffset + closeParenOffset + 1;
              //const leftOffset: number = closeParenOffset + 1;
              //this._logMessage('  -- rightStr=(' + rightStrOffset + ')[' + rightStr + '] leftOffset=[' + leftOffset + '] currStrEndOffset=[' + currStrEndOffset + ']');
              // record the right edge string
              this._recordToken(tokenSet, line, {
                line: lineIdx,
                startCharacter: rightStrOffset,
                length: rightStr.length,
                ptTokenType: 'string',
                ptTokenModifiers: ['quoted', 'double']
              });
              searchOffset = closeParenOffset + leftStr.length + 1;
            } else {
              break; // no close paren?  get outta here...
            }
          }
        } else {
          // NO ` (backtic) in string...
          const strOffset: number = line.indexOf(nextString, currentOffset);
          this._logMessage(`  -- rptDbgDQStrs() rpt str=[${nextString}](${nextString.length}), ofs=(${strOffset})`);
          this._recordToken(tokenSet, line, {
            line: lineIdx,
            startCharacter: strOffset,
            length: nextString.length,
            ptTokenType: 'string',
            ptTokenModifiers: ['quoted', 'double']
          });
        }
        currentOffset += nextString.length;
        nextStringOffset += nextString.length;
      }
    } while (nextString.length > 0);

    return tokenSet;
  }

  private _getIndexExpression(line: string): string {
    let expressionString: string = '';
    // locate text between the first '[' and the next ']', can include nested brackets
    //  do not return the outer brackets
    const leftBracketOffset: number = line.indexOf('[');
    if (leftBracketOffset !== -1) {
      let nestingLevel = 0;
      for (let i = leftBracketOffset; i < line.length; i++) {
        if (line[i] === '[') {
          // Found the nesting bracket
          nestingLevel++;
        } else if (line[i] === ']') {
          nestingLevel--;
          if (nestingLevel === 0) {
            // Found the matching closing bracket
            expressionString = line.substring(leftBracketOffset + 1, i);
            break; // ignore any remaining text in line
          }
        }
      }
    }
    this._logSPIN(`  --  getIdxExpr([${line}]) -> exStr=[${expressionString}]`);
    return expressionString;
  }

  private _getIndexExpressionOLD(line: string): string {
    let expressionString: string = '';
    // locate text between the first '[' and the next ']', can include nested brackets
    const leftBracketOffset: number = line.indexOf('[');
    if (leftBracketOffset != -1) {
      const rightBracketOffset: number = line.indexOf(']', leftBracketOffset + 1);
      if (rightBracketOffset != -1) {
        //this._logSPIN(`  --  getIdxExprOld([${line}]) -> lbOffset=(${leftBracketOffset}), rbOffset=(${rightBracketOffset})`);
        const tmpExpressionString: string = line.substring(leftBracketOffset + 1, rightBracketOffset);
        if (tmpExpressionString.length > 0 && tmpExpressionString.indexOf('[') == -1) {
          expressionString = tmpExpressionString;
        }
      }
    }
    this._logSPIN(`  --  getIdxExprOld([${line}]) -> exStr=[${expressionString}]`);
    return expressionString;
  }

  private _getDoubleQuotedString(currentOffset: number, searchText: string): string {
    let nextString: string = '';
    const stringStartOffset: number = searchText.indexOf('"', currentOffset);
    if (stringStartOffset != -1) {
      //this._logDEBUG('  -- gdqs(' + currentOffset + ', [' + searchText + '])');
      const stringEndOffset: number = searchText.indexOf('"', stringStartOffset + 1);
      if (stringEndOffset != -1) {
        nextString = searchText.substring(stringStartOffset, stringEndOffset + 1);
      }
    }
    if (nextString.length > 0) {
      this._logDEBUG(`  -- gdqs() -> [${nextString}](${nextString.length})`);
    }
    return nextString;
  }

  private _getSingleQuotedString(currentOffset: number, searchText: string): string {
    let nextString: string = '';
    const stringStartOffset: number = searchText.indexOf("'", currentOffset);
    if (stringStartOffset != -1) {
      //this._logDEBUG('  -- gsqs(' + currentOffset + ', [' + searchText + '])');
      const stringEndOffset: number = searchText.indexOf("'", stringStartOffset + 1);
      if (stringEndOffset != -1) {
        nextString = searchText.substring(stringStartOffset, stringEndOffset + 1);
      }
    }
    if (nextString.length > 0) {
      this._logDEBUG(`  -- gsqs() -> ['${nextString}](${nextString.length})`);
    }
    return nextString;
  }

  private _recordToken(tokenSet: IParsedToken[], line: string | null, newToken: IParsedToken | undefined) {
    if (newToken) {
      if (newToken.line != -1 && newToken.startCharacter != -1) {
        tokenSet.push(newToken);
      } else {
        const tokenInterp: string = `token(${newToken.line + 1},${newToken.startCharacter})=[len:${newToken.length}](${newToken.ptTokenType}[${
          newToken.ptTokenModifiers
        }])]`;
        this._logMessage(`** ERROR: BAD token nextString=[${tokenInterp}]`);
      }
    }
  }

  private _recordDisplayTypeForLine(displayType: string, lineIdx: number): void {
    //this._logMessage('  -- line#' + lineIdx + ', displayType=[' + displayType + ']');
    const newDirective: ISpin2Directive = {
      lineNumber: lineIdx,
      displayType: displayType,
      eDisplayType: this.semanticFindings.getDebugDisplayEnumForType(displayType)
    };
    this._logMessage('=> Add DIRECTIVE: ' + this._directiveString(newDirective));
    this.fileDirectives.push(newDirective);
  }

  private _getDisplayTypeForLine(lineNbr: number): eDebugDisplayType {
    let desiredType: eDebugDisplayType = eDebugDisplayType.Unknown;
    let maxLineBefore: number = 0;
    //let desiredDirective: ISpin2Directive;
    for (let index = 0; index < this.fileDirectives.length; index++) {
      const currDirective: ISpin2Directive = this.fileDirectives[index];
      this._logMessage(
        '  -- hunt Ln#' + lineNbr + ', ln=' + currDirective.lineNumber + ', typ=' + currDirective.displayType + '(' + currDirective.eDisplayType + ')'
      );
      if (currDirective.lineNumber <= lineNbr) {
        if (currDirective.lineNumber > maxLineBefore) {
          //desiredDirective = currDirective;
          desiredType = currDirective.eDisplayType;
          maxLineBefore = currDirective.lineNumber;
        }
      }
    }
    if (desiredType != eDebugDisplayType.Unknown) {
      this._logMessage('  -- directive for Ln#' + lineNbr + ': ' + desiredType);
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
    if (this.isDebugLogEnabled) {
      //Write to output window.
      this.ctx.logger.log(message);
    }
  }

  private _logDEBUG(message: string): void {
    if (this.showDEBUG) {
      this._logMessage(message);
    }
  }

  private _getDebugNonCommentLine(startingOffset: number, line: string): string {
    //this._logMessage(` -- gDbgNCL() line=[${line}](${line.length})`);
    const debugNoDlbQuotes: string = this.parseUtils.removeDoubleQuotedStrings(line);
    //this._logMessage(` -- gDbgNCL() debugNoDlbQuotes=[${debugNoDlbQuotes}](${debugNoDlbQuotes.length})`);
    const debugNoStrings: string = ''.padEnd(startingOffset, ' ') + this.parseUtils.removeDebugSingleQuotedStrings(debugNoDlbQuotes);
    //this._logMessage(` -- gDbgNCL() debugNoStrings=[${debugNoStrings}](${debugNoStrings.length})`);
    const endOfDebugStatement: number = this._locateEndOfDebugStatement(debugNoStrings, 0);
    const nonCommentStr: string = line.substring(0, endOfDebugStatement + 1).trimEnd();
    //this._logMessage(` -- gDbgNCL() endOfDebugStatement=(${endOfDebugStatement}), nonCommentStr=[${nonCommentStr}](${nonCommentStr.length})`);
    //if (nonCommentStr.length > 0) {
    //  this._logMessage(`  -- gDNCL()) nonCommentStr=[${nonCommentStr}](${nonCommentStr.length})`);
    //}
    return nonCommentStr;
  }

  private _getDebugNonCommentLineReturnComment(startingOffset: number, lineIdx: number, line: string, tokenSet: IParsedToken[]): string {
    //this._logMessage(` -- gDbgNCL-RC() line=[${line}](${line.length})`);
    const debugNoDlbQuotes: string = this.parseUtils.removeDoubleQuotedStrings(line);
    const debugNoStrings: string = ''.padEnd(startingOffset, ' ') + this.parseUtils.removeDebugSingleQuotedStrings(debugNoDlbQuotes);
    const endOfDebugStatement: number = this._locateEndOfDebugStatement(debugNoStrings, 0);
    const nonCommentStr: string = line.substring(0, endOfDebugStatement + 1).trimEnd();
    //this._logMessage(` -- gDbgNCL-RC() debugNoStrings=[${debugNoStrings}](${debugNoStrings.length}), endOfDebugStatement=(${endOfDebugStatement})`);
    // now record the comment if we have one
    if (line.length != nonCommentStr.length) {
      //this._logMessage(`  -- gNCL-RC()nonCommentStr=[${nonCommentStr}](${nonCommentStr.length})`);
      const commentRHSStrOffset: number = nonCommentStr.length;
      const commentOffset: number = this.parseUtils.getTrailingCommentOffset(commentRHSStrOffset, line);
      const bHaveBlockComment: boolean = debugNoStrings.indexOf('{', commentOffset) != -1 || debugNoStrings.indexOf('}', commentOffset) != -1;
      const bHaveDocComment: boolean =
        debugNoStrings.indexOf("''", commentOffset) != -1 ||
        debugNoStrings.indexOf('{{', commentOffset) != -1 ||
        debugNoStrings.indexOf('}}', commentOffset) != -1;
      //this._logMessage(
      //  `  -- gNCL-RC()commentOffset=(${commentOffset}), bHvBlockComment=(${bHaveBlockComment}), bHvDocComment=(${bHaveDocComment}), debugNoStrings=[${debugNoStrings}](${debugNoStrings.length})`
      //);
      if (commentOffset != -1) {
        const commentStr = line.substring(commentOffset);
        if (commentStr.length > 0) {
          this._logMessage(`  -- Ln#${lineIdx + 1} gDNCL-RC commentStr=[${commentStr}](${commentStr.length})`);
          const newToken: IParsedToken | undefined = this._generateComentToken(
            lineIdx,
            commentOffset,
            commentStr.length,
            bHaveBlockComment,
            bHaveDocComment,
            line
          );
          if (newToken) {
            tokenSet.push(newToken);
            this._logMessage(`  -- Ln#${lineIdx + 1} gDNCL-RC Recorded Comment [${JSON.stringify(newToken)}]`);
          }
        }
      }
    }
    //if (nonCommentStr.length > 0) {
    //  this._logMessage(`  -- gDNCL-RC nonCommentStr=[${nonCommentStr}](${nonCommentStr.length})`);
    //}
    return nonCommentStr;
  }

  private _reportEscapedString(lineIdx: number, startingOffset: number, line: string): IParsedToken[] {
    // debug statements typically have single or double quoted strings.  Let's color either if/when found!
    const tokenSet: IParsedToken[] = [];
    this._logDEBUG(`- Ln#${lineIdx + 1} rptEscStr() line=[${line}](${line.length}), ofs=(${startingOffset})`);
    if (this.parseUtils.requestedSpinVersion(50)) {
      const workString: string = line.toLowerCase();

      let bInString: boolean = false;
      let bInEscape: boolean = false;

      for (let chrIdx = startingOffset + 2; chrIdx < workString.length; chrIdx++) {
        const char = workString.charAt(chrIdx).toLowerCase();
        if (bInString && char === '"') {
          bInString = false;
          break;
        }
        if (!bInString && !bInEscape && char === '"') {
          bInString = true;
          continue;
        }
        if (bInString && !bInEscape && char === '\\') {
          bInEscape = true;
          continue;
        }
        if (bInEscape) {
          /*
           * \a = 7, alarm bell
           * \b = 8, backspace
           * \t = 9, tab
           * \n = 10, new line
           * \f = 12, form feed
           * \r = 13, carriage return
           * \\ = 92,
           * \x01 to \xFF = $01 to $FF
           *  Unknown sequences are just passed verbatim (i.e. \d = "\d").
           */
          let bValidSequence: boolean = true;
          let sequenceLength: number = 2;
          switch (char) {
            case 'a':
              break;
            case 'b':
              break;
            case 't':
              break;
            case 'n':
              break;
            case 'f':
              break;
            case 'r':
              break;
            case 'x':
              sequenceLength = 4;
              break;
            case '\\':
              break;

            default:
              bValidSequence = false;
              break;
          }

          if (bValidSequence) {
            this._recordToken(tokenSet, line, {
              line: lineIdx,
              startCharacter: chrIdx - 1,
              length: sequenceLength,
              ptTokenType: 'operator', // method is blue?!, function is yellow?!, operator is violet?! (debug function, not enough color)
              ptTokenModifiers: ['builtin']
            });
          }
          chrIdx += sequenceLength - 2; // -2 because only \xFF needs more chars
          bInEscape = false;
        }
      }
    } else {
      // not yet v50!
      const startStrOffset: number = startingOffset;
      const endStrOffset: number = line.indexOf('"', startStrOffset + 3);
      const sequenceLength: number = endStrOffset != -1 ? endStrOffset - startStrOffset + 1 : 3;
      this._recordToken(tokenSet, line, {
        line: lineIdx,
        startCharacter: startStrOffset,
        length: sequenceLength,
        ptTokenType: 'variable', // method is blue?!, function is yellow?!, operator is violet?! (debug function, not enough color)
        ptTokenModifiers: ['illegalUse']
      });
      this.semanticFindings.pushDiagnosticMessage(
        lineIdx,
        startStrOffset,
        startStrOffset + sequenceLength,
        eSeverity.Error,
        `P2 escaped strings [@\\"..."] require {Spin2_v50} or later.`
      );
    }
    return tokenSet;
  }

  private _reportTrailingComment(lineIdx: number, line: string, comment: string, tokenSet: IParsedToken[]): void {
    const commentOffset: number = line.indexOf(comment);
    if (commentOffset != -1) {
      const bHaveBlockComment: boolean = comment.startsWith('{');
      const bHaveDocComment: boolean = comment.startsWith("''") || comment.startsWith('{{');
      const newToken: IParsedToken | undefined = this._generateComentToken(
        lineIdx,
        commentOffset,
        comment.length,
        bHaveBlockComment,
        bHaveDocComment,
        line
      );
      if (newToken) {
        tokenSet.push(newToken);
        this._logMessage(`  -- Ln#${lineIdx + 1} gDNCL-RC Recorded Comment [${JSON.stringify(newToken)}]`);
      }
    }
  }

  private _getNonCommentLineReturnComment(startingOffset: number, lineIdx: number, line: string, tokenSet: IParsedToken[]): string {
    // skip Past Whitespace
    const currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    this._logMessage(`  -- Ln#${lineIdx + 1} gNCL-RC()startingOffset=(${startingOffset}), line=[${line}](${line.length})`);
    const nonCommentStr: string = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    // now record the comment if we have one
    if (line.length != nonCommentStr.length) {
      this._logMessage(`  -- gNCL-RC()nonCommentStr=[${nonCommentStr}](${nonCommentStr.length})`);
      const filtLine: string = line.replace(line.substring(0, nonCommentStr.length), nonCommentStr);
      this._logMessage(`  -- gNCL-RC()filtLine=[${filtLine}](${filtLine.length})`);
      const commentRHSStrOffset: number = nonCommentStr.length;
      const commentOffset: number = this.parseUtils.getTrailingCommentOffset(commentRHSStrOffset, line);
      const bHaveBlockComment: boolean = filtLine.indexOf('{', commentOffset) != -1 || filtLine.indexOf('}', commentOffset) != -1;
      const bHaveDocComment: boolean =
        filtLine.indexOf("''", commentOffset) != -1 || filtLine.indexOf('{{', commentOffset) != -1 || filtLine.indexOf('}}', commentOffset) != -1;
      this._logMessage(
        `  -- gNCL-RC()commentOffset=(${commentOffset}), bHvBlockComment=(${bHaveBlockComment}), bHvDocComment=(${bHaveDocComment}), filtLine=[${filtLine}](${filtLine.length})`
      );
      if (commentOffset != -1) {
        const newToken: IParsedToken | undefined = this._generateComentToken(
          lineIdx,
          commentOffset,
          line.length - commentOffset + 1,
          bHaveBlockComment,
          bHaveDocComment,
          line
        );
        if (newToken) {
          //this._logMessage("=> CMT: " + this._tokenString(newToken, line));
          tokenSet.push(newToken);
          //const comment: string = line.substring(commentOffset);
          //this._logMessage(`  -- Ln#${lineIdx + 1} gNCL-RC()Recorded Comment [${comment}](${comment.length}) (${newToken.ptTokenType}[${newToken.ptTokenModifiers}])`);
        }
      }
    }
    this._logMessage(`  -- gNCL-RC()nonCommentStr=[${nonCommentStr}](${nonCommentStr.length})`);
    return nonCommentStr;
  }

  private _generateComentToken(
    lineIdx: number,
    startIdx: number,
    commentLength: number,
    bHaveBlockComment: boolean,
    bHaveDocComment: boolean,
    line: string
  ): IParsedToken | undefined {
    this._logMessage(`  -- gNCL-RC()startIdx=(${startIdx}), bHaveDocComment=[${bHaveDocComment}], line=[${line}]`);
    let desiredToken: IParsedToken | undefined = undefined;
    if (line.length > 0) {
      //const commentDocModifiers: string[] = bHaveBlockComment ? ["block", "documentation"] : ["line", "documentation"]; // A NO
      const commentDocModifiers: string[] = bHaveBlockComment ? ['documentation', 'block'] : ['documentation', 'line']; // B NO
      const commentModifiers: string[] = bHaveBlockComment ? ['block'] : ['line'];
      desiredToken = {
        line: lineIdx,
        startCharacter: startIdx,
        length: commentLength,
        ptTokenType: 'comment',
        ptTokenModifiers: bHaveDocComment ? commentDocModifiers : commentModifiers
      };
      const comment: string = line.substring(startIdx, startIdx + commentLength);
      this._logMessage(
        `  -- Ln#${lineIdx + 1} genCT Recorded Comment [${comment}](${comment.length}) (${desiredToken.ptTokenType}[${
          desiredToken.ptTokenModifiers
        }])`
      );
    }
    return desiredToken;
  }

  private _getNonWhiteSpinLinePartsWithIndexValues(line: string): IFilteredStrings {
    //                                     split(/[ \t\-\:\,\+\@\(\)\!\*\=\<\>\&\|\?\\\~\#\^\/]/);
    // mods to allow returning of objInstanceName#constant  form of names AND var[x] form of names
    const nonEqualsLine: string = this.parseUtils.removeDoubleQuotedStrings(line);
    const lineParts: string[] | null = nonEqualsLine.match(/[^ \t\-:,+@()!*=<>&|?\\~^/]+/g);
    let reducedLineParts: string[] = [];
    if (lineParts == null) {
      reducedLineParts = [];
    } else {
      for (let index = 0; index < lineParts.length; index++) {
        const name = lineParts[index];
        if (name === '#') {
          continue;
        }
        if (name.startsWith('#')) {
          reducedLineParts.push(name.substring(1)); // remvoe first char
        } else if (name.endsWith('#')) {
          reducedLineParts.push(name.slice(0, -1)); // remove last char
        } else {
          reducedLineParts.push(name);
        }
      }
    }
    return {
      lineNoQuotes: nonEqualsLine,
      lineParts: reducedLineParts
    };
  }

  private _getNonWhiteSpinLineParts(line: string): IFilteredStrings {
    //                                     split(/[ \t\-\:\,\+\[\]\@\(\)\!\*\=\<\>\&\|\?\\\~\#\^\/]/);
    // mods to allow returning of objInstanceName#constant  form of names
    const nonEqualsLine: string = this.parseUtils.removeDoubleQuotedStrings(line);
    const lineParts: string[] | null = nonEqualsLine.match(/[^ \t\-:,+[\]@()!*=<>&|?\\~^/]+/g);
    let reducedLineParts: string[] = [];
    if (lineParts == null) {
      reducedLineParts = [];
    } else {
      for (let index = 0; index < lineParts.length; index++) {
        const name = lineParts[index];
        if (name === '#') {
          continue;
        }
        if (name.startsWith('#')) {
          reducedLineParts.push(name.substring(1)); // remvoe first char
        } else if (name.endsWith('#')) {
          reducedLineParts.push(name.slice(0, -1)); // remove last char
        } else {
          reducedLineParts.push(name);
        }
      }
    }
    return {
      lineNoQuotes: nonEqualsLine,
      lineParts: reducedLineParts
    };
  }

  private _getNonWhiteSpinLinePartsNonArray(line: string, preservePacked: boolean = false): IFilteredStrings {
    //                                     split(/[ \t\-\:\,\+\[\]\@\(\)\!\*\=\<\>\&\|\?\\\~\#\^\/]/);
    // mods to allow returning of objInstanceName#constant  form of names
    // SPECIAL form:
    //  don't initially remove [...] square brackets or periods
    //  in second pass, if item dosn't have period but does have [...] then split a [] and push parts
    //
    const nonEqualsLine: string = this.parseUtils.removeDoubleQuotedStrings(line, preservePacked);
    // first split
    let lineParts: string[] | null = nonEqualsLine.match(/[^ \t\-:,+@()!*=<>&|?\\~^/]+/g);
    if (lineParts == null) {
      lineParts = [];
    }
    this._logMessage(`  -- gnwsplna line=[${nonEqualsLine}](${nonEqualsLine.length})`);
    this._logMessage(`   --- gnwsplna lineParts=[${lineParts}](${lineParts.length})`);
    let reducedLineParts: string[] = [];
    if (lineParts == null) {
      reducedLineParts = [];
    } else {
      for (let index = 0; index < lineParts.length; index++) {
        const name = lineParts[index];
        if (name === '#' || name === '[') {
          continue;
        }
        // handle bitfield indexes
        if (name.includes('.[')) {
          const nameParts: string[] = name.split('.[');
          reducedLineParts.push(nameParts[0]);
          const remainingParts: string[] = nameParts[1].split(/[[\]]/).filter(Boolean);
          reducedLineParts.push(...remainingParts); // push all parts without brackets
          continue;
        }

        let tempName: string = name;
        if (/^#+$/.test(name)) {
          // don't touch this ('###...###') all # signs
        } else if (name.startsWith('#')) {
          tempName = name.substring(1); // remvoe first char
        } else if (name.endsWith('#')) {
          tempName = name.slice(0, -1); // remove last char
        }
        // 2nd split
        if (!tempName.includes('.') && /[[]|[\]]/.test(tempName)) {
          const moreParts: string[] = tempName.split(/[[\]]/).filter(Boolean);
          this._logMessage(`   --- gnwsplna tempName=[${tempName}] -> moreParts=[${moreParts}](${moreParts.length})`);
          if (moreParts.length > 0) {
            reducedLineParts.push(...moreParts);
          }
        } else {
          if (/^#+$/.test(tempName) == false) {
            reducedLineParts.push(tempName);
          }
        }
      }
    }
    this._logMessage(`   --- gnwsplna reducedLineParts=[${reducedLineParts}](${reducedLineParts.length})`);
    // sigh... these were missed:
    //  handle case1: LONG[pValues][serialQueue.ENT_PARM2_IDX] where this is one single name
    //  handle case2: LONG [pValues][serialQueue.ENT_PARM2_IDX] where this is one single name
    if (/\]\s*\[/.test(line)) {
      const srcStrings: string[] = reducedLineParts;
      reducedLineParts = [];
      for (let index = 0; index < srcStrings.length; index++) {
        const currString = srcStrings[index];
        if (/[[]|[\]]/.test(currString)) {
          const moreParts: string[] = currString.split(/[[\]]/).filter(Boolean);
          if (moreParts.length > 0) {
            reducedLineParts.push(...moreParts);
          }
        } else {
          reducedLineParts.push(currString);
        }
      }
    }
    if (
      reducedLineParts[0] !== undefined &&
      this.parseUtils.isSpecialIndexType(reducedLineParts[0]) &&
      nonEqualsLine.includes(`${reducedLineParts[0]}[`)
    ) {
      const tmpLineParts: string[] = [reducedLineParts[0]];
      for (let index = 1; index < reducedLineParts.length; index++) {
        const element = reducedLineParts[index];
        tmpLineParts.push(`[${element}]`);
      }
      reducedLineParts = [tmpLineParts.join('')];
      this._logMessage(`   --- gnwsplna um... reducedLineParts=[${reducedLineParts}](${reducedLineParts.length})`);
    }
    return {
      lineNoQuotes: nonEqualsLine,
      lineParts: reducedLineParts
    };
  }

  private _reportNonDupeTokens(partialTokenSet: IParsedToken[], typeStr: string, line: string, tokenSet: IParsedToken[]) {
    if (partialTokenSet.length > 0) {
      // first sort them
      // FIXME: replace overlap with rewitting them to not overlap!
      partialTokenSet = this._mergeIntoNonOverlappingTokens(partialTokenSet, line);
      // now report them
      partialTokenSet.forEach((newToken) => {
        if (this._tokenExists(newToken, tokenSet)) {
          this._logMessage(` ${typeStr} SKIPPING DUPE ${this._tokenString(newToken, line)}`);
        } else {
          this._logMessage(` ${typeStr} ${this._tokenString(newToken, line)}`);
          tokenSet.push(newToken);
        }
      });
    }
  }

  private _mergeIntoNonOverlappingTokens(tokenSet: IParsedToken[], line: string): IParsedToken[] {
    if (tokenSet.length <= 1) {
      return tokenSet;
    }

    // Sort tokens by line and startCharacter
    tokenSet.sort((a, b) => {
      if (a.line !== b.line) {
        return a.line - b.line;
      }
      return a.startCharacter - b.startCharacter;
    });

    const mergedTokens: IParsedToken[] = [];

    for (let i = 0; i < tokenSet.length; i++) {
      const currentToken = tokenSet[i];

      // Check for overlaps with the next token
      while (i + 1 < tokenSet.length) {
        const nextToken = tokenSet[i + 1];

        if (currentToken.line !== nextToken.line || currentToken.startCharacter + currentToken.length <= nextToken.startCharacter) {
          // No overlap, break out of the loop
          // diff line -OR-
          //    xxxxxxxxxxxxxxx
          //                      yyy
          this._logMessage(`  -- CASE:   ---- BREAK ---- no overlap`);
          break; // emit lhs(currentToken)
        }

        // Handle overlap cases
        if (currentToken.startCharacter === nextToken.startCharacter) {
          // tokens start at the same position
          if (currentToken.length <= nextToken.length) {
            this._logMessage(`  -- CASE:   ---- BREAK ---- rhs equal to or longer than rhs(${this._tokenString(nextToken, line)})`);
            // Current token is fully overlapped, discard it
            //    xxxxxxxxxxxxxxx
            //    yyyyyyyyyyyyyyy
            // -OR-
            //    xxxxxxxxxxxxxxx
            //    yyyyyyyyyyyyyyyyyyyy
            currentToken.length = 0; // so we don't emit it
            break; // done, but don't emit lhs(currentToken)
          } else {
            // Shorten current token and keep processing
            //    xxxxxxxxxxxxxxx
            //    yyyyyyyy
            // Emit nextToken and shorten currentToken
            mergedTokens.push(nextToken); // Add nextToken to the merged list
            currentToken.startCharacter = nextToken.startCharacter + nextToken.length; // Adjust startCharacter of currentToken
            currentToken.length -= nextToken.length; // Shorten currentToken
            this._logMessage(
              `  -- CASE: rhs shorter than rhs(${this._tokenString(nextToken, line)}), shortened lhs(${this._tokenString(currentToken, line)})`
            );
            tokenSet.splice(i + 1, 1); // Remove nextToken from the tokenSet
          }
        } else if (currentToken.startCharacter + currentToken.length <= nextToken.startCharacter + nextToken.length) {
          // Next token is fully overlapped, shorten current token
          //    xxxxxxxxxxxxxxx
          //          yyyyyyyyy
          // -OR-
          //    xxxxxxxxxxxxxxx
          //         yyyyyyyyyyyyyy
          currentToken.length = nextToken.startCharacter - currentToken.startCharacter;
          this._logMessage(
            `  -- CASE:  ---- BREAK ---- rhs(${this._tokenString(nextToken, line)}) overlaps right edge of lhs, shortened lhs(${this._tokenString(currentToken, line)})`
          );
          break; // done, and emit lhs(currentToken)
        } else {
          // Partial overlap, split current token
          //    xxxxxxxxxxxxxxx
          //      yyyyyy
          const newToken: IParsedToken = {
            line: currentToken.line,
            startCharacter: currentToken.startCharacter,
            length: nextToken.startCharacter - currentToken.startCharacter,
            ptTokenType: currentToken.ptTokenType,
            ptTokenModifiers: currentToken.ptTokenModifiers
          };
          mergedTokens.push(newToken); // New nextToken to the merged list
          this._logMessage(
            `  -- CASE: new(${this._tokenString(newToken, line)}), rhs(${this._tokenString(nextToken, line)}) overlaps middle of lhs, shortened lhs`
          );
          mergedTokens.push(nextToken); // Add nextToken to the merged list
          // move the current offset to after this token
          currentToken.startCharacter = nextToken.startCharacter + nextToken.length;
          currentToken.length -= newToken.length + nextToken.length;
          tokenSet.splice(i + 1, 1); // Remove nextToken from the tokenSet
        }
      }

      // Add the current token to the merged list
      if (currentToken.length > 0) {
        this._logMessage(`  --    emit lhs(${this._tokenString(currentToken, line)})`);
        mergedTokens.push(currentToken);
      } else {
        this._logMessage(`  --    SKIP lhs(${this._tokenString(currentToken, line)})`);
      }
    }

    return mergedTokens;
  }

  private _tokenExists(newToken: IParsedToken, tokenSet: IParsedToken[]): boolean {
    let dupeTokenStatus: boolean = false;
    for (let index = 0; index < tokenSet.length; index++) {
      const existingToken = tokenSet[index];
      if (existingToken.line == newToken.line && existingToken.startCharacter == newToken.startCharacter) {
        dupeTokenStatus = true;
        break; // outta here we have our answer
      }
    }
    return dupeTokenStatus;
  }

  private _tokenString(aToken: IParsedToken, line: string): string {
    const varName: string = line.substr(aToken.startCharacter, aToken.length);
    const desiredInterp: string =
      '  -- token=[Ln#' +
      (aToken.line + 1) +
      ',ofs:' +
      aToken.startCharacter +
      ',len:' +
      aToken.length +
      ' [' +
      varName +
      '](' +
      aToken.ptTokenType +
      '[' +
      aToken.ptTokenModifiers +
      '])]';
    return desiredInterp;
  }

  private _rememberdTokenString(tokenName: string, aToken: RememberedToken | undefined): string {
    let desiredInterp: string = '  -- token=[len:' + tokenName.length + ' [' + tokenName + '](undefined)';
    if (aToken !== undefined) {
      desiredInterp = '  -- token=[len:' + tokenName.length + ' [' + tokenName + '](' + aToken.type + '[' + aToken.modifiers + '])]';
    }
    return desiredInterp;
  }

  private _checkTokenSetOLD(tokenSet: IParsedToken[]): void {
    this._logMessage('\n---- Checking ' + tokenSet.length + ' tokens. ----');
    tokenSet.forEach((parsedToken) => {
      if (parsedToken.length === undefined || parsedToken.startCharacter === undefined) {
        this._logMessage('- BAD Token=[' + parsedToken + ']');
      }
    });
    this._logMessage('---- Check DONE ----\n');
  }

  private _checkTokenSet(tokenSet: IParsedToken[], text: string): IParsedToken[] {
    // Sort tokens by lineNumber and startCharacter
    const lines = text.split(/\r\n|\r|\n/);

    // sort the tokens
    tokenSet.sort((a, b) => {
      if (a.line === b.line) {
        return a.startCharacter - b.startCharacter;
      }
      return a.line - b.line;
    });
    let removedTokens: number = 0;
    const filteredTokenSet: IParsedToken[] = [];
    this._logMessage(`\n---- Checking ${tokenSet.length} tokens. ----`);
    tokenSet.forEach((parsedToken) => {
      // if badly created token, don't submit it!
      if (parsedToken.length === undefined || parsedToken.startCharacter === undefined) {
        this._logMessage(`- BAD Token=[${parsedToken}]`);
      } else {
        // NEW remove tokens for disabled lines
        if (!this.semanticFindings.preProcIsLineDisabled(parsedToken.line + 1)) {
          filteredTokenSet.push(parsedToken);
        } else {
          if (removedTokens < 10) {
            this._logMessage(`* RMV #${removedTokens + 1}, token=<${this.stringForToken(parsedToken)}>`);
          }
          removedTokens++;
        }
      }
    });

    // NEW add disabled-line tokens
    let addedTokens: number = 0;
    const disabledLineRanges: Range[] = this.semanticFindings.preProcDisabledRanges();
    this._logMessage(`  -- disabledLineRanges=[${JSON.stringify(disabledLineRanges, null, 2)}](${disabledLineRanges.length})`);
    for (const disabledRange of disabledLineRanges) {
      for (let lineNbr = disabledRange.start.line; lineNbr <= disabledRange.end.line; lineNbr++) {
        const line: string = lines[lineNbr - 1];
        if (line === undefined) {
          this._logMessage(`ERROR: [CODE] BAD Range<(${disabledRange.start.line}, 0) - (${disabledRange.end.line}, 0)>`);
        } else {
          const newToken: IParsedToken = {
            line: lineNbr - 1,
            startCharacter: 0,
            length: line.length,
            ptTokenType: 'string',
            ptTokenModifiers: ['disabled']
          };
          filteredTokenSet.push(newToken);
          if (addedTokens < 10) {
            this._logMessage(`* ADD #${addedTokens + 1}, token=<${this.stringForToken(newToken)}>`);
          }
          addedTokens++;
        }
      }
    }
    // reSort the tokens
    filteredTokenSet.sort((a, b) => {
      if (a.line === b.line) {
        return a.startCharacter - b.startCharacter;
      }
      return a.line - b.line;
    });
    let checkNbr: number = 1;
    filteredTokenSet.forEach((parsedToken) => {
      if (parsedToken.line >= 2854 && parsedToken.line <= 2861) {
        this._logMessage(`* CHK #${checkNbr}, token=<${this.stringForToken(parsedToken)}>`);
        checkNbr++;
      }
    });
    this._logMessage(`---- Check DONE ---- countNow=(${tokenSet.length}), removed=(${removedTokens}), added=(${addedTokens})\n`);
    return filteredTokenSet;
  }

  private stringForToken(token: IParsedToken): string {
    const lenStr: string = token.length == Number.MAX_VALUE ? '{MAX}' : `${token.length - 1}`;
    return `TOK: Ln#${token.line}(${token.startCharacter}-${lenStr}) [${token.ptTokenType}], [${token.ptTokenModifiers}]`;
  }

  private _directiveString(aDirective: ISpin2Directive): string {
    const desiredInterp: string =
      '  -- directive=[Ln#' + aDirective.lineNumber + ',typ:' + aDirective.displayType + '[' + aDirective.eDisplayType + '])]';
    return desiredInterp;
  }
}
