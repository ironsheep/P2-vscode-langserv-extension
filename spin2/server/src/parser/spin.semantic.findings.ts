"use strict";
// server/src/parser/spin.semantic.findings.ts

import { Range, DiagnosticSeverity, SymbolKind, Diagnostic } from "vscode-languageserver-types";
import { displayEnumByTypeName } from "./spin2.utils";
import { eDebugDisplayType } from "./spin.common";
import { Context } from "../context";
import { Position } from "vscode-languageserver-textdocument";
import { PortMessageReader } from "vscode-languageserver/node";

// ============================================================================
//  this file contains objects we use in tracking symbol use and declaration
//
export enum eBLockType {
  Unknown = 0,
  isCon,
  isDat,
  isVar,
  isObj,
  isPub,
  isPri,
}

export enum eSeverity {
  // should match lsp.DiagnosticSeverity
  Unknown = 0,
  Error,
  Warning,
  Information,
  Hint,
}

export enum eDefinitionType {
  // should match lsp.DiagnosticSeverity
  Unknown = 0,
  LocalLabel,
  GlobalLabel,
  NonLabel,
}

// search comment type: non-doc only, doc-only, or mixed
enum eCommentFilter {
  Unknown = 0,
  docCommentOnly,
  nondocCommentOnly,
  allComments,
}

export interface ILocationOfToken {
  uri: string;
  objectName: string;
  position: Position; // if more detail desired in future capture and return token offset into line!
}

export interface IBlockSpan {
  startLineIdx: number;
  endLineIdx: number;
  blockType: eBLockType;
  sequenceNbr: number;
}

export interface IPasmCodeSpan {
  startLineIdx: number;
  endLineIdx: number;
  isInline: boolean;
}

export interface IParsedToken {
  line: number;
  startCharacter: number;
  length: number;
  ptTokenType: string;
  ptTokenModifiers: string[];
}

export interface ITokenDescription {
  found: boolean;
  tokenRawInterp: string;
  isGoodInterp: boolean;
  scope: string;
  interpretation: string;
  adjustedName: string;
  token: RememberedToken | undefined;
  declarationLineIdx: number;
  declarationLine: string | undefined;
  declarationComment: string | undefined;
  signature: string | undefined;
  relatedFilename: string | undefined;
  relatedObjectName: string | undefined;
  relatedMethodName: string | undefined;
}

export interface ITokenInterpretation {
  scope: string;
  interpretation: string;
  name: string;
  isGoodInterp: boolean;
}

export interface IDebugDisplayInfo {
  displayTypeString: string;
  userName: string;
  lineNbr: number;
  eDisplayType: eDebugDisplayType;
}

export interface IMethodSpan {
  startLineNbr: number;
  endLineNbr: number;
}
export interface IObjectReference {
  objectName: string;
  objectFilename: string;
}

// ----------------------------------------------------------------------------
//  Shared Data Storage for what our current document contains
//   CLASS DocumentFindings
export class DocumentFindings {
  private globalTokens;
  private methodLocalTokens;
  private instanceId: string = `ID:${new Date().getTime()}`;
  private declarationInfoByGlobalTokenName;
  private declarationInfoByLocalTokenName;
  private methodLocalPasmTokens;
  private blockComments: RememberedComment[] = [];
  private fakeComments: RememberedComment[] = [];
  private spanInfoByMethodName = new Map<string, IMethodSpan>();
  private currMethodName: string | undefined = undefined;
  private currMethodStartLineNbr: number = 0;
  private objectParseResultByObjectName = new Map<string, DocumentFindings>();
  private diagnosticMessages: DiagnosticReport[] = [];
  private declarationLineCache = new Map<Number, string>();
  private declarationGlobalLabelListCache: number[] = [];
  private declarationLocalLabelLineCache = new Map<string, number[]>(); // line numbers by localLabelName

  // tracking of Spin Code Blocks
  private priorBlockType: eBLockType = eBLockType.Unknown;
  private priorBlockStartLineIdx: number = -1;
  private priorInstanceCount: number = 0;
  private codeBlockSpans: IBlockSpan[] = [];
  // tracking spans of PASM code
  private pasmStartLineIdx: number = -1;
  private pasmCodeSpans: IPasmCodeSpan[] = [];
  private pasmIsInline: boolean = false;

  private findingsLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private bLogStarted: boolean = false;

  // tracking object outline
  private outlineSymbols: OutLineSymbol[] = [];

  private semanticTokens: IParsedToken[] = [];

  // tracking includes
  private objectFilenameByInstanceName = new Map<string, string>();
  private ctx: Context | undefined;
  private docUri: string = "--uri-not-set--";

  public constructor(documentUri: string | undefined = undefined) {
    if (documentUri) {
      this.docUri = documentUri;
    }
    if (this.findingsLogEnabled) {
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        //Create output channel
        this._logMessage("Spin2 SemanticFindings log started.");
      } else {
        this._logMessage("\n\n------------------   NEW FILE ----------------\n\n");
      }
    }

    this._logMessage("* Global, Local, MethodScoped Token repo's ready");
    this.globalTokens = new TokenSet("gloTOK");
    this.methodLocalTokens = new NameScopedTokenSet("methLocTOK");
    this.declarationInfoByGlobalTokenName = new Map<string, RememberedTokenDeclarationInfo>();
    this.declarationInfoByLocalTokenName = new Map<string, RememberedTokenDeclarationInfo>();
    // and for P2
    this.methodLocalPasmTokens = new NameScopedTokenSet("methPasmTOK");
  }

  public get uri(): string {
    // property: URI for doc of these findings
    return this.docUri;
  }

  public setFilename(filespec: string): void {
    // append filespec to our instance number
    const orignalId: string = this.instanceId;
    let priorId: string = this.instanceId;
    if (priorId.includes("-")) {
      const idParts: string[] = priorId.split("-");
      priorId = idParts[0];
    }
    const basename = filespec.split("/").reverse()[0];
    this.instanceId = `${priorId}-${basename}`;
    this._logMessage(`DocumentFindings: [${orignalId}] -> [${this.instanceId}]`);
  }

  public instanceName(): string {
    return this.instanceId;
  }

  //
  // PUBLIC Methods
  //
  public clear(clearIncludesToo: boolean = false) {
    // we're studying a new document forget everything!
    this._logMessage(`  -- FND-clear clearIncludesToo=(${clearIncludesToo})`);
    this.globalTokens.clear();
    this.methodLocalTokens.clear();
    this.methodLocalPasmTokens.clear();
    this.objectFilenameByInstanceName.clear();
    this.declarationLineCache.clear();
    this.declarationLocalLabelLineCache.clear();
    this.declarationGlobalLabelListCache = [];
    this.blockComments = [];
    this.fakeComments = [];
    // clear our method-span pieces
    this.spanInfoByMethodName.clear();
    this.currMethodName = undefined;
    this.currMethodStartLineNbr = 0;
    // clear spin-code-block tracking
    this.priorBlockType = eBLockType.Unknown;
    this.priorBlockStartLineIdx = -1;
    this.priorInstanceCount = 0;
    this.codeBlockSpans = [];
    this.diagnosticMessages = [];
    this.outlineSymbols = [];
    this.semanticTokens = [];
    if (clearIncludesToo) {
      this.objectParseResultByObjectName.clear();
      this._logMessage(`  -- FND-clear REMOVED object includes [${this.instanceName()}]`);
    }
  }

  public enableLogging(ctx: Context, doEnable: boolean = true): void {
    this.findingsLogEnabled = doEnable;
    this.ctx = ctx;
    this.globalTokens.enableLogging(ctx, doEnable);
    this.methodLocalTokens.enableLogging(ctx, doEnable);
    this.methodLocalPasmTokens.enableLogging(ctx, doEnable);
    // since we are already constructed, repeat this....
    if (this.findingsLogEnabled && this.bLogStarted == false) {
      this.bLogStarted = true;
      //Create output channel
      this._logMessage("Spin2 SemanticFindings log started.");
    } else {
      this._logMessage("\n\n------------------   NEW FILE ----------------\n\n");
    }
  }

  public finalize() {
    // end of document reached, do finishing things so data is ready for use

    // (1) let's ensure our list of global labels is in line number order
    this.declarationGlobalLabelListCache = this.declarationGlobalLabelListCache.sort((n1, n2) => n1 - n2);
  }

  // -------------------------------------------------------------------------------------
  //  TRACK Diagnistic Messages found during parse of file
  //
  public allDiagnosticMessages(messageCountMax: number): Diagnostic[] {
    const formattedMessages: Diagnostic[] = [];
    // return a list of the messages we have
    if (messageCountMax > 0) {
      const sortReportsByLineChar = (n1: DiagnosticReport, n2: DiagnosticReport) => {
        if (n1.location().start.line > n2.location().start.line) {
          return 1;
        }

        if (n1.location().start.line < n2.location().start.line) {
          return -1;
        }

        if (n1.location().start.character > n2.location().start.character) {
          return 1;
        }

        if (n1.location().start.character < n2.location().start.character) {
          return -1;
        }

        return 0;
      };

      const sortedReports: DiagnosticReport[] = this.diagnosticMessages.sort(sortReportsByLineChar);
      const reducedReports = this._deDupeReports(sortedReports, messageCountMax); //sortedReports; //
      for (let index = 0; index < reducedReports.length; index++) {
        const report = reducedReports[index];
        const lspDiag: Diagnostic = Diagnostic.create(report.location(), report.message(), report.severity());
        formattedMessages.push(lspDiag);
      }
    }
    this._logMessage(`- allDiagnosticMessages(${messageCountMax}) - returns ${formattedMessages.length} messages`);
    return formattedMessages;
  }

  private _deDupeReports(diagMessages: DiagnosticReport[], messageCountMax: number): DiagnosticReport[] {
    // remove duplicates in report so we still report relevent content
    let reducedSet: DiagnosticReport[] = [];
    let messagesWeveSeen: string[] = [];
    for (let index = 0; index < diagMessages.length; index++) {
      const report = diagMessages[index];
      if (!messagesWeveSeen.includes(report.message())) {
        messagesWeveSeen.push(report.message());
        reducedSet.push(report);
        if (reducedSet.length >= messageCountMax) {
          break;
        }
      }
    }
    return reducedSet;
  }

  public pushDiagnosticMessage(lineIdx: number, startChar: number, endChar: number, severity: eSeverity, message: string): void {
    // record a new diagnostic message
    let severityStr: string = "??severity??";
    if (this.findingsLogEnabled) {
      switch (severity) {
        case eSeverity.Error: {
          severityStr = "ERROR";
          break;
        }
        case eSeverity.Warning: {
          severityStr = "WARNING";
          break;
        }
        case eSeverity.Hint: {
          severityStr = "HINT";
          break;
        }
        case eSeverity.Information: {
          severityStr = "INFORMATION";
          break;
        }
      }
    }
    if (startChar == -1 || endChar == -1) {
      this._logMessage(`ERROR(BAD) DIAGNOSIS SKIPPED - ${severityStr}(${lineIdx + 1})[${startChar} - ${endChar}]: [${message}]`);
    } else {
      const location: Range = Range.create(lineIdx, startChar, lineIdx, endChar);
      const diagnosis: DiagnosticReport = new DiagnosticReport(message, severity, location);
      this.diagnosticMessages.push(diagnosis);
      this._logMessage(`Add DIAGNOSIS - ${severityStr}(${lineIdx + 1})[${startChar}-${endChar}]: [${message}]`);
    }
  }

  // -------------------------------------------------------------------------------------
  //  TRACK Semantic Tokens representing file
  //
  public allSemanticTokens(): IParsedToken[] {
    // return the complete set of Semantic tokens found in our document
    //  and yes, in language server we need to do the sorting before returning these
    //  otherwise some things don't get colored!
    var sortedArray: IParsedToken[] = this.semanticTokens.sort((n1, n2) => {
      if (n1.line > n2.line) {
        return 1;
      }

      if (n1.line < n2.line) {
        return -1;
      }

      if (n1.startCharacter > n2.startCharacter) {
        return 1;
      }

      if (n1.startCharacter < n2.startCharacter) {
        return -1;
      }

      return 0;
    });
    return sortedArray;
  }

  public pushSemanticToken(newToken: IParsedToken) {
    // record a new Semantic token found in this document
    this.semanticTokens.push(newToken);
  }

  // -------------------------------------------------------------------------------------
  //  TRACK namespaces
  //
  public setFindingsForNamespace(namespace: string, symbolsInNamespace: DocumentFindings): void {
    // save parsed findings for this namespace
    const namespaceKey: string = namespace.toLowerCase();
    if (!this.objectParseResultByObjectName.has(namespaceKey)) {
      this.objectParseResultByObjectName.set(namespaceKey, symbolsInNamespace);
      this._logMessage(`* setFindingsForNamespace(${this.instanceName()}) ADD findings for [${namespace}] which is [${symbolsInNamespace.instanceName()}]`);
    } else {
      this._logMessage(`* setFindingsForNamespace(${this.instanceName()}) ERROR: SKIP ADD, duplicate [${namespace}]`);
    }
  }

  public hasIncludes(): boolean {
    // Return T/F where T means there are referenced objects
    const nameSpaces: string[] = Array.from(this.objectParseResultByObjectName.keys());
    return nameSpaces.length > 0 ? true : false;
  }

  public getFindingsForNamespace(namespace: string): DocumentFindings | undefined {
    // return parsed findings if we have them for this namespace
    let symbolsInNamespace: DocumentFindings | undefined = undefined;
    const namespaceKey: string = namespace.toLowerCase();
    if (this.objectParseResultByObjectName.has(namespaceKey)) {
      symbolsInNamespace = this.objectParseResultByObjectName.get(namespaceKey);
      if (symbolsInNamespace) {
        this._logMessage(`* getFindingsForNamespace(${this.instanceName()}) returns [${namespace}]=[${symbolsInNamespace}] which is [${symbolsInNamespace.instanceName()}]`);
      } else {
        this._logMessage(`* getFindingsForNamespace(${this.instanceName()}) ERROR: [-failed-get-] NO findings for [${namespace}]`);
      }
    } else {
      this._logMessage(`* getFindingsForNamespace(${this.instanceName()}) ERROR: [out-of-order request?] NO findings for [${namespace}]`);
    }
    return symbolsInNamespace;
  }

  public getNamespaces(): string[] {
    // return list of object namespaces found in toplevel
    const nameSpaceSet: string[] = Array.from(this.objectParseResultByObjectName.keys());
    return nameSpaceSet;
  }

  public locationsOfToken(tokenName: string, postion: Position): ILocationOfToken[] {
    // NOTE: position is cursor position in doc at location of request
    const desiredLocations: ILocationOfToken[] = [];
    this.appendLocationsOfToken(tokenName, desiredLocations, "top", postion);
    this._logMessage(`  -- locationsOfToken() id=[${this.instanceId}] returns ${desiredLocations.length} tokens`);
    return desiredLocations;
  }

  public appendLocationsOfToken(tokenName: string, locationsSoFar: ILocationOfToken[], objectName: string, postion: Position) {
    // NOTE: position is cursor position in doc at location of request
    //  we use this to determine if request is scoped to a method
    //   if it is, we limit responses to findings within the method
    let referenceDetails: RememberedToken | undefined = undefined;
    const desiredTokenKey: string = tokenName.toLowerCase();
    let findCount: number = 0;
    const isPossibleLocalLabel: boolean = tokenName.startsWith(".") || tokenName.startsWith(":");
    // get global token from this objects
    let tokenPosition: Position = { line: -1, character: -1 };
    if (this.isGlobalToken(tokenName)) {
      referenceDetails = this.getGlobalToken(tokenName);
      if (referenceDetails) {
        if (isPossibleLocalLabel && referenceDetails.type === "label") {
          tokenPosition = this._getBestLocalLabelPostionForPosition(postion, tokenName);
        } else {
          tokenPosition = { line: referenceDetails.lineIndex, character: referenceDetails.charIndex };
        }
        if (tokenPosition.line != -1 && tokenPosition.character != -1) {
          const tokenRef: ILocationOfToken = { uri: this.uri, objectName: objectName, position: tokenPosition };
          locationsSoFar.push(tokenRef);
          findCount++;
        }
        this._logMessage(`  -- appLoc-Token FOUND global token=[${tokenName}]`);
      } else {
        this._logMessage(`  -- appLoc-Token global token=[${tokenName}] has NO lineNbr info!`);
      }
    }
    if (this.isLocalToken(tokenName)) {
      // get local tokens from this object
      const localMethodName: string | undefined = this._getMethodNameForLine(postion.line);
      if (localMethodName) {
        // get local tokens scoped to method
        let referenceDetails: RememberedToken | undefined = this.getLocalTokenForMethod(localMethodName, tokenName);
        if (referenceDetails) {
          this._logMessage(`  -- appLoc-Token FOUND forMethod token=[${tokenName}]`);
        } else {
          referenceDetails = this.getLocalPAsmTokenForMethod(localMethodName, tokenName);
          if (referenceDetails) {
            this._logMessage(`  -- appLoc-Token FOUND PAsmForMethod token=[${tokenName}]`);
          }
        }
        if (referenceDetails) {
          if (isPossibleLocalLabel && referenceDetails.type === "label") {
            tokenPosition = this._getBestLocalLabelPostionForPosition(postion, tokenName);
          } else {
            tokenPosition = { line: referenceDetails.lineIndex, character: referenceDetails.charIndex };
          }
          if (tokenPosition.line != -1 && tokenPosition.character != -1) {
            const tokenRef: ILocationOfToken = { uri: this.uri, objectName: objectName, position: tokenPosition };
            locationsSoFar.push(tokenRef);
            findCount++;
          }
        } else {
          this._logMessage(`  -- appLoc-Token ERROR (PAsm)ForMethod token=[${tokenName}] - NOT found`);
        }
      } else {
        // get all local tokens
        const referenceSet: RememberedToken[] = this.getLocalTokens(tokenName);
        for (let index = 0; index < referenceSet.length; index++) {
          referenceDetails = referenceSet[index];
          if (referenceDetails) {
            const tokenPosition: Position = { line: referenceDetails.lineIndex, character: referenceDetails.charIndex };
            const tokenRef: ILocationOfToken = { uri: this.uri, objectName: objectName, position: tokenPosition };
            locationsSoFar.push(tokenRef);
            findCount++;
            this._logMessage(`  -- appLoc-Token FOUND local token=[${tokenName}]`);
          } else {
            this._logMessage(`  -- appLoc-Token local token=[${tokenName}] has NO lineNbr info!`);
          }
        }
      }
    }
    const referencedObjects: string[] = this.getNamespaces();
    // get global/local tokens from all included objects
    for (let index = 0; index < referencedObjects.length; index++) {
      const nameSpace = referencedObjects[index];
      const symbolsFound: DocumentFindings | undefined = this.getFindingsForNamespace(nameSpace);

      if (symbolsFound) {
        if (this.ctx) {
          symbolsFound.enableLogging(this.ctx, this.findingsLogEnabled);
        }
        symbolsFound.appendLocationsOfToken(tokenName, locationsSoFar, nameSpace, postion);
      }
    }
    this._logMessage(`  -- appendLocationsOfToken() id=[${this.instanceId}] adds ${findCount} tokens`);
  }

  // -------------------------------------------------------------------------------------
  //  TRACK ranges of CON/PUB/PRI/VAR/DAT/OBJ blocks within file
  //
  public recordBlockStart(eCurrBlockType: eBLockType, currLineIdx: number) {
    this._logMessage(`  -- FND-RCD-BLOCK iblockType=[${eCurrBlockType}], span=[${currLineIdx} - ???]`);
    if (currLineIdx == 0 && this.priorBlockType != eBLockType.Unknown) {
      // we are getting a replacement for the default CON start section, use it!
      this.priorBlockType = eCurrBlockType; // override the default with possibly NEW block type
      this.priorBlockStartLineIdx = currLineIdx;
      this.priorInstanceCount = 1;
    } else if (this.priorBlockType == eBLockType.Unknown) {
      // we are starting the first block
      this.priorBlockType = eCurrBlockType;
      this.priorBlockStartLineIdx = currLineIdx;
      this.priorInstanceCount = 1;
    } else {
      // we are starting a later block, lets finish prior then start the new
      const isFirstOfThisType: boolean = this.priorBlockType != eCurrBlockType ? false : true;
      const newBlockSpan: IBlockSpan = {
        blockType: this.priorBlockType,
        sequenceNbr: this.priorInstanceCount,
        startLineIdx: this.priorBlockStartLineIdx,
        endLineIdx: currLineIdx - 1, // ends at prior line
      };
      this.codeBlockSpans.push(newBlockSpan);
      this._logMessage(`  -- FND-RCD-ADD sequenceNbr=[${newBlockSpan.sequenceNbr}], blockType=[${newBlockSpan.blockType}], span=[${newBlockSpan.startLineIdx} - ${newBlockSpan.endLineIdx}]`);
      this.priorInstanceCount = this.priorBlockType == eCurrBlockType ? this.priorInstanceCount + 1 : 1;
      this.priorBlockStartLineIdx = currLineIdx;
      this.priorBlockType = eCurrBlockType;
    }
  }

  public finishFinalBlock(finalLineIdx: number) {
    this._logMessage(`  -- FND-RCD-BLOCK LAST span=[??? - ${finalLineIdx}]`);
    if (this.priorBlockType != eBLockType.Unknown) {
      // we are ending the last block
      const newBlockSpan: IBlockSpan = {
        blockType: this.priorBlockType,
        sequenceNbr: this.priorInstanceCount,
        startLineIdx: this.priorBlockStartLineIdx,
        endLineIdx: finalLineIdx, // ends at the last line of the file
      };
      this._logMessage(`  -- FND-RCD-ADD LAST sequenceNbr=[${newBlockSpan.sequenceNbr}], blockType=[${newBlockSpan.blockType}], span=[${newBlockSpan.startLineIdx} - ${newBlockSpan.endLineIdx}]`);
      this.codeBlockSpans.push(newBlockSpan);
    }
  }

  public blockSpans(): IBlockSpan[] {
    return this.codeBlockSpans;
  }

  public isLineObjDeclaration(lineNumber: number): boolean {
    // return T/F where T means the line is within a span of pasm coce
    const lineIdx: number = lineNumber - 1;
    let inObjDeclStatus: boolean = false;
    for (let index = 0; index < this.codeBlockSpans.length; index++) {
      const possObjSpan: IBlockSpan = this.codeBlockSpans[index];
      if (possObjSpan.blockType == eBLockType.isObj && lineIdx >= possObjSpan.startLineIdx && lineIdx <= possObjSpan.endLineIdx) {
        inObjDeclStatus = true;
        this._logMessage(`  -- FND-OBJ  range=[${possObjSpan.startLineIdx}-${possObjSpan.endLineIdx}] our line is IN OBJ Block`);
        break;
      }
    }
    if (!inObjDeclStatus) {
      this._logMessage(`  -- FND-OBJ  lineIdx=[${lineNumber}] NOT in OBJ Block`);
    }
    return inObjDeclStatus;
  }

  // -------------------------------------------------------------------------------------
  //  TRACK ranges of pasm code within file
  //
  public recordPasmStart(lineIdx: number, isInline: boolean) {
    // record the start lineIndex and type of pasm block
    this.pasmStartLineIdx = lineIdx;
    this.pasmIsInline = isInline;
    this._logMessage(`  -- FND-PASM-NEW START lineIdx=[${lineIdx}], isInline=[${isInline}]`);
  }

  public recordPasmEnd(lineIdx: number) {
    // finish the pasm span record and record it
    if (this.pasmStartLineIdx != -1) {
      const newSpan: IPasmCodeSpan = { startLineIdx: this.pasmStartLineIdx, endLineIdx: lineIdx, isInline: this.pasmIsInline };
      this.pasmCodeSpans.push(newSpan);
      this.pasmStartLineIdx = -1; // used this one!
      this._logMessage(`  -- FND-PASM-ADD RANGE range=[${this.pasmStartLineIdx}-${lineIdx}], isInline=[${this.pasmIsInline}]`);
    } else {
      this._logMessage(`  -- FND-PASM-BAD notSTART lineIdx=[${lineIdx}] end of pasm range without start!`);
    }
  }

  public isLineInPasmCode(lineIndex: number): boolean {
    // return T/F where T means the line is within a span of pasm code
    let inPasmCodeStatus: boolean = false;
    for (let index = 0; index < this.pasmCodeSpans.length; index++) {
      const pasmSpan: IPasmCodeSpan = this.pasmCodeSpans[index];
      if (lineIndex >= pasmSpan.startLineIdx && lineIndex <= pasmSpan.endLineIdx) {
        inPasmCodeStatus = true;
        this._logMessage(`  -- FND-PASM  range=[${pasmSpan.startLineIdx}-${pasmSpan.endLineIdx}], isInline=[${pasmSpan.isInline}] our symbol is IN PASM BLOCK`);
        break;
      }
    }
    if (!inPasmCodeStatus) {
      this._logMessage(`  -- FND-PASM  lineIdx=[${lineIndex}] NOT in PASM Range`);
    }
    return inPasmCodeStatus;
  }

  // -------------------------------------------------------------------------------------
  //  TRACK objects
  //
  public recordObjectImport(name: string, filename: string): void {
    // record use of object namespace
    const objectNameKey: string = name.toLowerCase();
    if (!this.objectFilenameByInstanceName.has(objectNameKey)) {
      this.objectFilenameByInstanceName.set(objectNameKey, filename);
      this._logMessage(`  -- ADD-OBJ  instance=[${name}], filename=[${filename}]`);
    } else {
      this._logMessage(`  -- DUPE-OBJ  SKIPPED  instance=[${name}], filename=[${filename}]`);
    }
  }

  public includeFilenames(): string[] {
    // return the list of filenames of included objects
    let filenames: string[] = [];
    for (const [name, filename] of this.objectFilenameByInstanceName) {
      filenames.push(filename);
    }
    return filenames;
  }

  public includeObjectNamesByFilename(): Map<string, string> {
    // return the full object set: instance names with assoc. file names
    return this.objectFilenameByInstanceName;
  }

  public isNameSpace(possibleNamespace: string): boolean {
    // return T/F where T means we have this name in our list
    const objectNameKey: string = possibleNamespace.toLowerCase();
    const namespaceStatus: boolean = this.objectFilenameByInstanceName.has(objectNameKey);
    this._logMessage(`  -- FND-OBJ nameSpace=[${possibleNamespace}] -> ${namespaceStatus}]`);
    return namespaceStatus;
  }

  // -------------------------------------------------------------------------------------
  //  TRACK single/muli-line comments
  //
  public recordComment(comment: RememberedComment) {
    this.blockComments.push(comment);
  }

  public recordFakeComment(comment: RememberedComment) {
    this.fakeComments.push(comment);
  }

  public isLineInBlockComment(lineNumber: number): boolean {
    let inCommentStatus: boolean = false;
    if (this.blockComments.length > 0) {
      for (let docComment of this.blockComments) {
        if (docComment.includesLine(lineNumber)) {
          inCommentStatus = true;
          break;
        }
      }
    }
    return inCommentStatus;
  }

  public isLineInFakeComment(lineIdx: number): boolean {
    let inCommentStatus: boolean = false;
    if (this.fakeComments.length > 0) {
      for (let fakeComment of this.fakeComments) {
        if (fakeComment.includesLine(lineIdx)) {
          inCommentStatus = true;
          break;
        }
      }
    }
    return inCommentStatus;
  }

  private logBlockComment(comment: RememberedComment) {
    const decription: string[] = comment.desribeComment();
    this._logMessage(`${decription.join("\n")}`);
  }

  public blockCommentMDFromLine(lineIdx: number, eFilter: eCommentFilter): string | undefined {
    let desiredComment: string | undefined = undefined;
    if (this.blockComments.length > 0) {
      for (let blockComment of this.blockComments) {
        // only one will match...
        this.logBlockComment(blockComment);
        if (blockComment.includesLine(lineIdx)) {
          const canUseThisComment: boolean = this._isUsableComment(blockComment.isDocComment, eFilter);
          if (canUseThisComment) {
            desiredComment = blockComment.commentAsMarkDown();
          }
          break; // we found the single match, so stop seraching...
        }
      }
    }
    this._logMessage(`* blockCommentMDFromLine(Ln#${lineIdx + 1}) -> [${desiredComment}]`);
    return desiredComment;
  }

  public fakeCommentMDFromLine(lineIdx: number, eFilter: eCommentFilter): string | undefined {
    let desiredComment: string | undefined = undefined;
    if (this.fakeComments.length > 0) {
      for (let fakeComment of this.fakeComments) {
        if (fakeComment.includesLine(lineIdx)) {
          const canUseThisComment: boolean = this._isUsableComment(fakeComment.isDocComment, eFilter);
          if (canUseThisComment) {
            desiredComment = fakeComment.commentAsMarkDown();
          }
          break;
        }
      }
    }
    return desiredComment;
  }

  private _isUsableComment(bHaveDocComment: boolean, efilter: eCommentFilter): boolean {
    const canUsestatus: boolean =
      (bHaveDocComment && (efilter == eCommentFilter.allComments || efilter == eCommentFilter.docCommentOnly)) ||
      (!bHaveDocComment && (efilter == eCommentFilter.allComments || efilter == eCommentFilter.nondocCommentOnly))
        ? true
        : false;
    return canUsestatus;
  }

  // -------------------------------------------------------------------------------------
  //  TRACK Tokens
  //
  public isKnownToken(tokenName: string): boolean {
    const foundStatus: boolean = this.isGlobalToken(tokenName) || this.isLocalToken(tokenName) || this.hasLocalPasmToken(tokenName) ? true : false;
    return foundStatus;
  }

  public isPublicToken(tokenName: string): boolean {
    let foundStatus: boolean = this.isGlobalToken(tokenName) ? true : false;
    if (foundStatus == true) {
      const referenceDetails: RememberedToken | undefined = this.getGlobalToken(tokenName);
      if (referenceDetails && !referenceDetails.isPublic()) {
        foundStatus = false;
      }
    }
    return foundStatus;
  }

  public getPublicToken(tokenName: string): RememberedToken | undefined {
    // return public token or undefined is not present or token is not public
    let referenceDetails: RememberedToken | undefined = this.getGlobalToken(tokenName);
    this._logMessage(`  -- gPublToken(${tokenName}) -> (${referenceDetails})`);
    if (referenceDetails && !referenceDetails.isPublic()) {
      this._logMessage(`  -- gPublToken() -> NOT public, disqualified! (${referenceDetails})`);
      referenceDetails = undefined;
    }
    return referenceDetails;
  }

  public getDebugTokenWithDescription(tokenName: string): ITokenDescription {
    let findings: ITokenDescription = {
      found: false,
      tokenRawInterp: "",
      isGoodInterp: false,
      token: undefined,
      scope: "",
      interpretation: "",
      adjustedName: tokenName,
      declarationLineIdx: 0,
      declarationLine: undefined,
      declarationComment: undefined,
      signature: undefined,
      relatedFilename: undefined,
      relatedObjectName: undefined,
      relatedMethodName: undefined,
    };
    // do we have a token??
    let declInfo: RememberedTokenDeclarationInfo | undefined = undefined;
    if (this.isKnownDebugDisplay(tokenName)) {
      findings.found = true;
      // Check for debug display type?
      const displayInfo: IDebugDisplayInfo = this.getDebugDisplayInfoForUserName(tokenName);
      if (displayInfo.eDisplayType != eDebugDisplayType.Unknown) {
        // we have a debug display type!
        const fakeCharOffset: number = 0;
        findings.token = new RememberedToken("debugDisplay", displayInfo.lineNbr - 1, fakeCharOffset, [displayInfo.displayTypeString]);
        findings.scope = "Global";
        findings.tokenRawInterp = "Global: " + this._rememberdTokenString(tokenName, findings.token);
        const termType: string = displayInfo.displayTypeString.toUpperCase();
        declInfo = new RememberedTokenDeclarationInfo(displayInfo.lineNbr, `Debug Output: User name for an instance of ${termType}<br>- Write output to the \`${tokenName}\` window`);
      }
    }
    this._fillInFindings(tokenName, findings, declInfo);
    return findings;
  }

  public getPublicTokenWithDescription(tokenName: string, lineNbr: number): ITokenDescription {
    let findings: ITokenDescription = {
      found: false,
      tokenRawInterp: "",
      isGoodInterp: false,
      token: undefined,
      scope: "",
      interpretation: "",
      adjustedName: tokenName,
      declarationLineIdx: 0,
      declarationLine: undefined,
      declarationComment: undefined,
      signature: undefined,
      relatedFilename: undefined,
      relatedObjectName: undefined,
      relatedMethodName: undefined,
    };
    // do we have a token??
    if (this.isPublicToken(tokenName)) {
      findings = this.getTokenWithDescription(tokenName, lineNbr);
    }
    return findings;
  }

  public getTokenWithDescription(tokenName: string, lineNbr: number): ITokenDescription {
    let findings: ITokenDescription = {
      found: false,
      tokenRawInterp: "",
      isGoodInterp: false,
      token: undefined,
      scope: "",
      interpretation: "",
      adjustedName: tokenName,
      declarationLineIdx: 0,
      declarationLine: undefined,
      declarationComment: undefined,
      signature: undefined,
      relatedFilename: undefined,
      relatedObjectName: undefined,
      relatedMethodName: undefined,
    };
    // do we have a token??
    let declInfo: RememberedTokenDeclarationInfo | undefined = undefined;
    const desiredTokenKey = tokenName.toLowerCase();
    if (this.isKnownToken(tokenName)) {
      findings.found = true;
      // Check for Global-tokens?
      findings.token = this.getGlobalToken(tokenName);
      if (findings.token) {
        // we have a GLOBAL token!
        findings.tokenRawInterp = "Global: " + this._rememberdTokenString(tokenName, findings.token);
        findings.scope = "Global";
        // and get additional info for token
        declInfo = this.declarationInfoByGlobalTokenName.get(desiredTokenKey);
      } else {
        // Check for Local-tokens?
        findings.token = this.getLocalTokenForLine(tokenName, lineNbr);
        if (findings.token) {
          // we have a LOCAL token!
          findings.tokenRawInterp = "Local: " + this._rememberdTokenString(tokenName, findings.token);
          findings.scope = "Local";
          // and get additional info for token
          declInfo = this.declarationInfoByLocalTokenName.get(desiredTokenKey);
        } else {
          // Check for Method-Local-tokens?
          findings.token = this.methodLocalPasmTokens.getToken(tokenName);
          findings.relatedMethodName = this.methodLocalPasmTokens.getMethodNameForToken(tokenName);
          if (findings.relatedMethodName) {
            findings.relatedMethodName = findings.relatedMethodName + "()";
          }
          if (findings.token) {
            // we have a LOCAL token!
            findings.tokenRawInterp = "Method-local: " + this._rememberdTokenString(tokenName, findings.token);
            findings.scope = "Local";
            // and get additional info for token
            declInfo = this.declarationInfoByLocalTokenName.get(desiredTokenKey);
          }
        }
      }
    }
    this._fillInFindings(tokenName, findings, declInfo);
    return findings;
  }

  private _locateNonBlankLineAfter(lineIdx: number): number {
    let desiredLineIdx: number = lineIdx;
    if (this.blockComments.length > 0) {
      for (let blockComment of this.blockComments) {
        // only one comment will match... either or both of the line indexes
        if (blockComment.includesLine(lineIdx) || blockComment.includesLine(lineIdx + 1)) {
          desiredLineIdx = blockComment.firstLine;
          break; // we found the single match, so stop seraching...
        }
      }
    }
    this._logMessage(`  -- _locateNonBlankLineAfter(${lineIdx}) -> (${desiredLineIdx})`);
    return desiredLineIdx;
  }

  private _interpretToken(token: RememberedToken, scope: string, name: string, declInfo: RememberedTokenDeclarationInfo | undefined): ITokenInterpretation {
    this._logMessage(`  -- _interpretToken() scope=[${scope}], name=[${name}], line#=[${declInfo?.lineIndex}]` + this._rememberdTokenString(name, token));
    let desiredInterp: ITokenInterpretation = { interpretation: "", scope: scope.toLowerCase(), name: name, isGoodInterp: true };
    desiredInterp.interpretation = "--type??";
    if (token?.type == "variable" && token?.modifiers.includes("readonly") && !declInfo?.isObjectReference) {
      // have non object reference
      desiredInterp.scope = "object public"; // not just global
      desiredInterp.interpretation = "32-bit constant";
    } else if (token?.type == "variable" && token?.modifiers.includes("readonly") && declInfo?.isObjectReference) {
      // have object interface constant
      desiredInterp.scope = "object interface"; // not just global
      desiredInterp.interpretation = "32-bit constant";
    } else if (token?.type == "debugDisplay") {
      desiredInterp.scope = "object"; // ignore for this (or move `object` here?)
      desiredInterp.interpretation = "user debug display";
    } else if (token?.type == "namespace") {
      desiredInterp.scope = "object"; // ignore for this (or move `object` here?)
      desiredInterp.interpretation = "named instance";
    } else if (token?.type == "variable") {
      desiredInterp.interpretation = "variable";
      if (token?.modifiers.includes("pasmInline")) {
        desiredInterp.scope = "method-local"; // ignore for this (or move `object` here?)
        desiredInterp.interpretation = "inline-pasm variable";
      } else if (token?.modifiers.includes("local")) {
        desiredInterp.scope = "method"; // ignore for this (or move `object` here?)
        desiredInterp.interpretation = "local variable";
      } else if (token?.modifiers.includes("instance")) {
        desiredInterp.scope = "object private"; // ignore for this (or move `object` here?)
        desiredInterp.interpretation = "instance " + desiredInterp.interpretation + " -VAR";
      } else {
        desiredInterp.scope = "object private"; // ignore for this (or move `object` here?)
        desiredInterp.interpretation = "shared " + desiredInterp.interpretation + " -DAT";
      }
    } else if (token?.type == "label") {
      if (token?.modifiers.includes("pasmInline")) {
        desiredInterp.scope = "method-local"; // ignore for this (or move `object` here?)
        desiredInterp.interpretation = "inline-pasm label";
      } else {
        desiredInterp.scope = "object private"; // not just global
        if (token?.modifiers.includes("static")) {
          desiredInterp.interpretation = "local pasm label";
        } else {
          desiredInterp.interpretation = "pasm label";
        }
      }
    } else if (token?.type == "returnValue") {
      desiredInterp.scope = "method"; // ignore for this (or method?)
      desiredInterp.interpretation = "return value";
    } else if (token?.type == "parameter") {
      desiredInterp.scope = "method"; // ignore for this (or method?)
      desiredInterp.interpretation = "parameter";
    } else if (token?.type == "enumMember") {
      desiredInterp.interpretation = "enum value";
    } else if (token?.type == "method") {
      desiredInterp.name = name + "()";
      desiredInterp.scope = "object";
      if (token?.modifiers.includes("static")) {
        desiredInterp.interpretation = "private method";
      } else {
        if (declInfo?.isObjectReference) {
          desiredInterp.scope = "object interface"; // not just global
        }
        desiredInterp.interpretation = "public method";
      }
    } else {
      desiredInterp.isGoodInterp = false;
    }
    return desiredInterp;
  }

  private _fillInFindings(tokenName: string, findings: ITokenDescription, declInfo: RememberedTokenDeclarationInfo | undefined) {
    if (findings.token) {
      let details: ITokenInterpretation = this._interpretToken(findings.token, findings.scope, tokenName, declInfo);
      findings.isGoodInterp = details.isGoodInterp;
      findings.interpretation = details.interpretation;
      findings.scope = details.scope;
      findings.adjustedName = details.name;
      const bIsMethod: boolean = findings.token.type == "method";
      if (declInfo) {
        // and decorate with declaration line number
        findings.declarationLineIdx = declInfo.lineIndex;
        findings.declarationLine = this.getDeclarationLine(findings.declarationLineIdx);
        this._logMessage(`  -- FND-xxxTOK lnIdx:${findings.declarationLineIdx} line=[${findings.declarationLine}]`);
        if (!findings.declarationLine) {
          this.TEST_dumpLineCache();
        }
        if (declInfo.reference) {
          if (declInfo.isFilenameReference) {
            findings.relatedFilename = declInfo.reference;
          } else {
            findings.relatedObjectName = declInfo.reference;
          }
        }
        const bIsPublic: boolean = findings.token.modifiers.includes("static") ? false : true;
        if (bIsMethod) {
          const commentType: eCommentFilter = bIsPublic ? eCommentFilter.docCommentOnly : eCommentFilter.nondocCommentOnly;
          const nonBlankLineIdx: number = this._locateNonBlankLineAfter(findings.declarationLineIdx + 1); // +1 is line after signature
          findings.signature = findings.declarationLine;
          findings.declarationComment = this.blockCommentMDFromLine(nonBlankLineIdx, commentType);
          this._logMessage(
            `  -- FND-xxxTOK lnIdx:${findings.declarationLineIdx} findings.signature=[${findings.signature}], findings.declarationComment=[${findings.declarationComment}], declInfo.comment=[${findings.relatedFilename}]`
          );
          // if no block doc comment then we can substitute a preceeding or trailing doc comment for method
          const canUseAlternateComment: boolean = bIsPublic == false || (bIsPublic == true && declInfo.isDocComment) ? true : false;
          if (!findings.declarationComment && canUseAlternateComment && declInfo.comment && declInfo.comment.length > 0) {
            // if we have single line doc comment and can use it, then do so!
            findings.declarationComment = declInfo.comment;
          }
          // NOTE: use fake signature comment instead when there Are params and declInfo doesn't describe them
          const haveDeclParams: boolean = findings.declarationComment && findings.declarationComment?.includes("@param") ? true : false;
          this._logMessage(`  -- FND-xxxTOK haveDeclParams=(${haveDeclParams})`);
          if (!haveDeclParams) {
            let fakeComment: string | undefined = this.fakeCommentMDFromLine(nonBlankLineIdx, commentType);
            if (fakeComment) {
              if (findings.declarationComment) {
                findings.declarationComment = findings.declarationComment + "<br><br>" + fakeComment;
              } else {
                findings.declarationComment = fakeComment;
              }
            }
          }
        } else {
          //  (this is in else so non-methods can get non-doc multiline preceeding blocks!)
          findings.declarationComment = this.blockCommentMDFromLine(findings.declarationLineIdx - 1, eCommentFilter.nondocCommentOnly);
          // if no multi-line comment then ...(but don't use trailing comment when method!)
          if (!findings.declarationComment && declInfo.comment) {
            // if we have single line comment then use it!
            findings.declarationComment = declInfo.comment;
          }
        }
      }
      this._logMessage(
        `  -- FND-xxxTOK line(${findings.declarationLineIdx}) cmt=[${findings.declarationComment}], file=[${findings.relatedFilename}], obj=[${findings.relatedObjectName}]` +
          this._rememberdTokenString(tokenName, findings.token)
      );
    }
  }

  public isGlobalToken(tokenName: string): boolean {
    const foundStatus: boolean = this.globalTokens.hasToken(tokenName);
    this._logMessage(`  -- IS-gloTOK [${tokenName}] says ${foundStatus}`);
    return foundStatus;
  }

  private _getBestLocalLabelPostionForPosition(position: Position, labelTokenName: string): Position {
    // locate range in which we can find a local token def'n
    //  (this is global name above and below currLine)
    const tokenKey: string = labelTokenName.toLowerCase();
    let localLabelPosn: Position = { line: -1, character: -1 };
    let tokenDeclLines: number[] | undefined = this.declarationLocalLabelLineCache.get(tokenKey);
    if (tokenDeclLines) {
      if (tokenDeclLines.length > 1) {
        //this._logMessage(`  -- gBLLPFP local=[${tokenDeclLines}](${tokenDeclLines.length})`);
        const currentLine: number = position.line;
        let lineAbove: number = -1; // toward top of file
        let lineBelow: number = -1; // toward bottom of file
        //this._logMessage(`  -- gBLLPFP global=[${this.declarationGlobalLabelListCache}](${this.declarationGlobalLabelListCache.length})`);
        for (let index = 0; index < this.declarationGlobalLabelListCache.length; index++) {
          const globalLine: number = this.declarationGlobalLabelListCache[index];
          if (globalLine < currentLine) {
            lineAbove = globalLine;
          } else if (globalLine > currentLine) {
            lineBelow = globalLine;
            break; // look no further...
          }
        }
        this._logMessage(`  -- gBLLPFP LOCATE line=(${position.line}), tok=[${labelTokenName}] -> globRng=[abv=${lineAbove} - blw=${lineBelow}]`);

        for (let index = 0; index < tokenDeclLines.length; index++) {
          const declLineIdx: number = tokenDeclLines[index];
          if (lineAbove != -1 && lineBelow != -1) {
            // bounded above and below
            if (declLineIdx > lineAbove && declLineIdx < lineBelow) {
              localLabelPosn = { line: declLineIdx, character: 0 };
              break;
            }
          } else if (lineBelow != -1) {
            // bounded above,  nothing below
            if (declLineIdx < lineBelow) {
              localLabelPosn = { line: declLineIdx, character: 0 };
              break;
            }
          } else {
            // bounded below,  nothing above
            if (declLineIdx > lineAbove) {
              localLabelPosn = { line: declLineIdx, character: 0 };
              break;
            }
          }
        }
      } else {
        localLabelPosn = { line: tokenDeclLines[0], character: 0 };
      }
    } else {
      this._logMessage(`  -- gBLLPFP ERROR no decl lines for tok=[${labelTokenName}]`);
    }
    this._logMessage(`  -- gBLLPFP posn=[${position.line}, ${position.character}], tok=[${labelTokenName}] -> posn=[${localLabelPosn.line}, ${localLabelPosn.character}}]`);

    return localLabelPosn;
  }

  public recordDeclarationLine(line: string, lineNbr: number, declType: eDefinitionType = eDefinitionType.NonLabel) {
    // remember our declaration line for later use
    // (first one in, wins)
    const lineIdx: Number = lineNbr - 1;
    if (!this.declarationLineCache.has(lineIdx)) {
      this.declarationLineCache.set(lineIdx, line);
    }
    if (declType == eDefinitionType.GlobalLabel) {
      // mark a global line position
      if (!this.declarationGlobalLabelListCache.includes(lineNbr)) {
        this.declarationGlobalLabelListCache.push(lineNbr - 1); // we only save lineIdx values
        this._logMessage(`  -- RMBR-gloLblTOK Ln#${lineNbr} ct=${this.declarationGlobalLabelListCache.length}`);
      }
    } else if (declType == eDefinitionType.LocalLabel) {
      // mark one of many local line positions ??
    }
  }

  public getDeclarationLine(lineIdx: number): string | undefined {
    return this.declarationLineCache.get(lineIdx);
  }

  public TEST_dumpLineCache() {
    const lineNbrKeys: Number[] = Array.from(this.declarationLineCache.keys());
    this._logMessage(`  -- FND-LineCache -------------------------`);
    for (let index = 0; index < lineNbrKeys.length; index++) {
      const lineIdx = lineNbrKeys[index];
      const lineText: string | undefined = this.declarationLineCache.get(lineIdx);
      this._logMessage(`  -- FND-LineCache line(${lineIdx}) [${lineText}]`);
    }
    this._logMessage(`  -- FND-LineCache -------------------------`);
    this._logMessage(`  `);
  }

  public setGlobalToken(tokenName: string, token: RememberedToken, declarationComment: string | undefined, reference?: string | undefined): void {
    // FIXME: TODO:  UNDONE - this needs to allow multiple .tokenName's or :tokenName's and keep line numbers for each.
    //   this allows go-to to get to nearest earlier than right-mouse line
    const isLocalLabel: boolean = (tokenName.startsWith(".") || tokenName.startsWith(":")) && token.type === "label";
    if (!this.isGlobalToken(tokenName)) {
      this._logMessage("  -- NEW-gloTOK " + this._rememberdTokenString(tokenName, token) + `, ln#${token.lineIndex + 1}, cmt=[${declarationComment}], ref=[${reference}]`);
      this.globalTokens.setToken(tokenName, token);
      // and remember declataion line# for this token
      const newDescription: RememberedTokenDeclarationInfo = new RememberedTokenDeclarationInfo(token.lineIndex, declarationComment, reference);
      const desiredTokenKey: string = tokenName.toLowerCase();
      this.declarationInfoByGlobalTokenName.set(desiredTokenKey, newDescription);
    }
    // NEW record line numbers for local labels
    if (isLocalLabel) {
      this.trackLocalTokenLineNbr(tokenName, token.lineIndex);
    }
  }

  private trackLocalTokenLineNbr(tokenName: string, lineIndex: number) {
    const tokenNameKey: string = tokenName.toLowerCase();
    if (!this.declarationLocalLabelLineCache.has(tokenNameKey)) {
      // first time seeing this token record its line number
      this.declarationLocalLabelLineCache.set(tokenNameKey, [lineIndex]);
      this._logMessage(`  -- RMBR-lblTOK Ln#${lineIndex + 1} tok=[${tokenName}] ct=1`);
    } else {
      // have seen this token before, record another linenumber for it
      const lineIndexes = this.declarationLocalLabelLineCache.get(tokenNameKey);
      if (lineIndexes && !lineIndexes.includes(lineIndex)) {
        lineIndexes.push(lineIndex);
        this._logMessage(`  -- RMBR-lblTOK Ln#${lineIndex + 1} tok=[${tokenName}] ct=${lineIndexes.length}`);
      }
    }
  }

  public getGlobalToken(tokenName: string): RememberedToken | undefined {
    var desiredToken: RememberedToken | undefined = this.globalTokens.getToken(tokenName);
    if (desiredToken != undefined) {
      // let's never return a declaration modifier! (somehow declaration creeps in to our list!??)
      //let modifiersNoDecl: string[] = this._modifiersWithout(desiredToken.modifiers, "declaration");
      let modifiersNoDecl: string[] = desiredToken.modifiersWithout("declaration");
      desiredToken = new RememberedToken(desiredToken.type, desiredToken.lineIndex, desiredToken.charIndex, modifiersNoDecl);
      this._logMessage("  -- FND-gloTOK " + this._rememberdTokenString(tokenName, desiredToken));
    }
    return desiredToken;
  }

  public getLocalTokens(tokenName: string): RememberedToken[] {
    const desiredTokens: RememberedToken[] = [];
    if (this.isLocalToken(tokenName)) {
      const methodNameKeys: string[] = this.methodLocalTokens.keys();
      for (let index = 0; index < methodNameKeys.length; index++) {
        const methodName = methodNameKeys[index];
        const tokenForMethod: RememberedToken | undefined = this.getLocalTokenForMethod(methodName, tokenName);
        if (tokenForMethod) {
          desiredTokens.push(tokenForMethod);
        }
      }
    }
    return desiredTokens;
  }

  public isLocalToken(tokenName: string): boolean {
    const foundStatus: boolean = this.methodLocalTokens.hasToken(tokenName) || this.methodLocalPasmTokens.hasToken(tokenName);
    this._logMessage(`  -- IS-locTOK [${tokenName}] says ${foundStatus}`);
    return foundStatus;
  }

  public isLocalTokenForMethod(methodName: string, tokenName: string): boolean {
    const foundStatus: boolean = this.methodLocalTokens.hasTokenForMethod(methodName, tokenName);
    return foundStatus;
  }

  public setLocalTokenForMethod(methodName: string, tokenName: string, token: RememberedToken, declarationComment: string | undefined): void {
    if (!this.isLocalTokenForMethod(methodName, tokenName)) {
      this._logMessage(`  -- NEW-locTOK ln#${token.lineIndex + 1} method=[${methodName}], ` + this._rememberdTokenString(tokenName, token) + `, cmt=[${declarationComment}]`);
      this.methodLocalTokens.setTokenForMethod(methodName, tokenName, token);
      // and remember declataion line# for this token
      const desiredTokenKey: string = tokenName.toLowerCase();
      this.declarationInfoByLocalTokenName.set(desiredTokenKey, new RememberedTokenDeclarationInfo(token.lineIndex, declarationComment));
    }
  }

  public getLocalTokenForLine(tokenName: string, lineNbr: number): RememberedToken | undefined {
    let desiredToken: RememberedToken | undefined = undefined;
    this._logMessage(`  -- SRCH-locTOK ln#${lineNbr} tokenName=[${tokenName}]`);
    const methodName: string | undefined = this._getMethodNameForLine(lineNbr);
    if (methodName) {
      desiredToken = this.methodLocalTokens.getTokenForMethod(methodName, tokenName);
      if (desiredToken != undefined) {
        this._logMessage(`  -- FND-locTOK ln#${lineNbr} method=[${methodName}], ` + this._rememberdTokenString(tokenName, desiredToken));
      } else {
        this._logMessage(`  -- FAILED to FND-locTOK ln#${lineNbr} method=[${methodName}], ` + tokenName);
      }
    } else {
      this._logMessage(`  -- FAILED to FND-locTOK no method found for ln#${lineNbr} token=[${tokenName}]`);
    }
    return desiredToken;
  }

  private getLocalTokenForMethod(methodName: string, tokenName: string): RememberedToken | undefined {
    const desiredToken: RememberedToken | undefined = this.methodLocalTokens.getTokenForMethod(methodName, tokenName);
    return desiredToken;
  }

  public startMethod(methodName: string, lineNbr: number): void {
    // starting a new method remember the name and assoc the line number
    if (this.currMethodName) {
      this._logMessage(`  -- FAILED prior close SPAN Ln#${lineNbr} method=[${methodName}],  PRIOR-method=[${this.currMethodName}]`);
    } else {
      this._logMessage(`  -- NEW SPAN Ln#${lineNbr} method=[${methodName}]`);
    }
    this.currMethodName = methodName;
    this.currMethodStartLineNbr = lineNbr;
  }

  public endPossibleMethod(lineNbr: number): void {
    // possibly ending a method if one was started, end it, else ignore this
    if (this.currMethodName) {
      const spanInfo: IMethodSpan = { startLineNbr: this.currMethodStartLineNbr, endLineNbr: lineNbr };
      if (!this.spanInfoByMethodName.has(this.currMethodName)) {
        this.spanInfoByMethodName.set(this.currMethodName, spanInfo);
        this._logMessage(`  -- END-Method SPAN Ln#${lineNbr} method=[${this.currMethodName}], span=[${spanInfo.startLineNbr}, ${spanInfo.endLineNbr}]`);
      } else {
        this._logMessage(`  -- DUPE!! SPAN Ln#${lineNbr} method=[${this.currMethodName}], span=[${spanInfo.startLineNbr}, ${spanInfo.endLineNbr}] IGNORED!`);
      }
    }
    // now clear in progress
    this.currMethodName = undefined;
    this.currMethodStartLineNbr = 0;
  }

  private _getMethodNameForLine(lineNbr: number): string | undefined {
    let desiredMethodName: string | undefined = undefined;
    if (this.spanInfoByMethodName.size > 0) {
      for (const [currMethodName, currSpan] of this.spanInfoByMethodName) {
        //this._logMessage(`  -- locTOK CHK method=[${currMethodName}], span=[${currSpan.startLineNbr}, ${currSpan.endLineNbr}]`);
        if (lineNbr >= currSpan.startLineNbr && lineNbr <= currSpan.endLineNbr) {
          desiredMethodName = currMethodName;
          break;
        }
      }
    }
    this._logMessage(`  -- locTOK _getMethodNameForLine(Ln#${lineNbr}) = method=[${desiredMethodName}]`);
    return desiredMethodName;
  }

  // -------------------------------------------------------------------------
  // method-scoped name token handling...
  public clearLocalPAsmTokensForMethod(methodName: string) {
    // we're studying a new method forget everything local!
    this.methodLocalPasmTokens.clearForMethod(methodName);
  }

  public hasLocalPasmTokenListForMethod(methodName: string): boolean {
    const mapExistsStatus: boolean = this.methodLocalPasmTokens.hasMethod(methodName);
    return mapExistsStatus;
  }

  public hasLocalPasmToken(tokenName: string): boolean {
    let tokenExistsStatus: boolean = this.methodLocalPasmTokens.hasToken(tokenName);
    return tokenExistsStatus;
  }

  public hasLocalPAsmTokenForMethod(methodName: string, tokenName: string): boolean {
    let foundStatus: boolean = this.methodLocalPasmTokens.hasTokenForMethod(methodName, tokenName);
    return foundStatus;
  }

  public setLocalPAsmTokenForMethod(methodName: string, tokenName: string, token: RememberedToken, declarationComment: string | undefined): void {
    // FIXME: TODO:  UNDONE - this needs to allow multiple .tokenName's or :tokenName's and keep line numbers for each.
    //   this allows go-to to get to nearest earlier than right-mouse line
    const isLocalLabel: boolean = (tokenName.startsWith(".") || tokenName.startsWith(":")) && token.type === "label";
    if (this.hasLocalPAsmTokenForMethod(methodName, tokenName)) {
      // locals can appear many times...
      if (!isLocalLabel) {
        // WARNING attempt to set again
        this._logMessage(`  -- ERROR DUPE-lpTOK method=${methodName}: name=${tokenName}`);
      }
    } else {
      // set new one!
      this.methodLocalPasmTokens.setTokenForMethod(methodName, tokenName, token);
      // and remember declataion line# for this token
      const desiredTokenKey: string = tokenName.toLowerCase();
      this.declarationInfoByLocalTokenName.set(desiredTokenKey, new RememberedTokenDeclarationInfo(token.lineIndex, declarationComment));
      const newToken = this.methodLocalPasmTokens.getTokenForMethod(methodName, tokenName);
      if (newToken) {
        this._logMessage("  -- NEW-lpTOK method=" + methodName + ": " + this._rememberdTokenString(tokenName, newToken));
      }
    }
    if (isLocalLabel) {
      // NEW record line numbers for local labels
      this.trackLocalTokenLineNbr(tokenName, token.lineIndex);
    }
  }

  public getLocalPAsmTokenForMethod(methodName: string, tokenName: string): RememberedToken | undefined {
    let desiredToken: RememberedToken | undefined = this.methodLocalPasmTokens.getTokenForMethod(methodName, tokenName);
    if (desiredToken) {
      this._logMessage("  -- FND-lpTOK method=" + methodName + ": " + this._rememberdTokenString(tokenName, desiredToken));
    }
    return desiredToken;
  }

  public getLocalPAsmTokenForLine(lineNbr: number, tokenName: string): RememberedToken | undefined {
    const localMethodName: string | undefined = this._getMethodNameForLine(lineNbr);
    let desiredToken: RememberedToken | undefined = undefined;
    if (localMethodName) {
      desiredToken = this.methodLocalPasmTokens.getTokenForMethod(localMethodName, tokenName);
      if (desiredToken) {
        this._logMessage("  -- GET-lpTOK method=" + localMethodName + ": " + this._rememberdTokenString(tokenName, desiredToken));
      }
    }
    return desiredToken;
  }

  //
  // PRIVATE (Utility) Methods
  //
  private _logMessage(message: string): void {
    if (this.findingsLogEnabled) {
      // Write to output window.
      if (this.ctx) {
        this.ctx.logger.log(message);
      }
    }
  }

  private _rememberdTokenString(tokenName: string, aToken: RememberedToken | undefined): string {
    let desiredInterp: string = " -- token=[len:" + tokenName.length + " [" + tokenName + "](undefined)";
    if (aToken != undefined) {
      desiredInterp = " -- token=[len:" + tokenName.length + " [" + tokenName + "](" + aToken.type + "[" + aToken.modifiers + "])]";
    }
    return desiredInterp;
  }

  // ----------------------------------------------------------------------------
  //  P2 Special handling for Debug() Displays
  //
  // map of debug-display-user-name to:
  //  export interface IDebugDisplayInfo {
  //    displayTypeString: string;
  //    userName: string;
  //    lineNbr: number;
  //    eDisplayType: eDebugDisplayType;
  //  }

  private displayInfoByDebugDisplayName = new Map<string, IDebugDisplayInfo>();

  public getDebugDisplayEnumForType(typeName: string): eDebugDisplayType {
    let desiredType: eDebugDisplayType = eDebugDisplayType.Unknown;
    if (displayEnumByTypeName.has(typeName.toLowerCase())) {
      const possibleType: eDebugDisplayType | undefined = displayEnumByTypeName.get(typeName.toLowerCase());
      desiredType = possibleType || eDebugDisplayType.Unknown;
    }
    this._logMessage("  DDsply getDebugDisplayEnumForType(" + typeName + ") = enum(" + desiredType + "), " + this.getNameForDebugDisplayEnum(desiredType));
    return desiredType;
  }

  public setUserDebugDisplay(typeName: string, userName: string, lineNbr: number): void {
    const nameKey: string = userName.toLowerCase();
    this._logMessage("  DDsply _setUserDebugDisplay(" + typeName + ", " + userName + ", li#" + lineNbr + ")");
    if (!this.isKnownDebugDisplay(userName)) {
      let eType: eDebugDisplayType = this.getDebugDisplayEnumForType(typeName);
      let displayInfo: IDebugDisplayInfo = { displayTypeString: typeName, userName: userName, lineNbr: lineNbr, eDisplayType: eType };
      this.displayInfoByDebugDisplayName.set(nameKey, displayInfo);
      //this._logMessage("  -- DDsply " + userName.toLowerCase() + "=[" + eDisplayType + " : " + typeName.toLowerCase() + "]");
    } else {
      this._logMessage("ERROR: DDsply setUserDebugDisplay() display exists [" + userName + "]");
    }
  }

  public getDebugDisplayEnumForUserName(possibleUserName: string): eDebugDisplayType {
    const nameKey: string = possibleUserName.toLowerCase();
    let desiredEnumValue: eDebugDisplayType = eDebugDisplayType.Unknown;
    if (this.isKnownDebugDisplay(possibleUserName)) {
      const possibleInfo: IDebugDisplayInfo | undefined = this.displayInfoByDebugDisplayName.get(nameKey);
      if (possibleInfo) {
        desiredEnumValue = possibleInfo.eDisplayType;
      }
    }
    return desiredEnumValue;
  }

  public getDebugDisplayInfoForUserName(possibleUserName: string): IDebugDisplayInfo {
    const nameKey: string = possibleUserName.toLowerCase();
    let possibleInfo: IDebugDisplayInfo = { displayTypeString: "", userName: "", lineNbr: 0, eDisplayType: eDebugDisplayType.Unknown };
    if (this.isKnownDebugDisplay(possibleUserName)) {
      const infoFound: IDebugDisplayInfo | undefined = this.displayInfoByDebugDisplayName.get(nameKey);
      if (infoFound) {
        possibleInfo = infoFound;
      }
    }
    return possibleInfo;
  }

  public getNameForDebugDisplayEnum(eDisplayType: eDebugDisplayType): string {
    let desiredName: string = "?no-value-in-map?";
    for (let [idString, eValue] of displayEnumByTypeName.entries()) {
      if (eValue === eDisplayType) {
        desiredName = idString;
        break;
      }
    }
    this._logMessage("  DDsply getNameForDebugDisplayEnum(enum: " + eDisplayType + ") = " + desiredName);
    return desiredName;
  }

  public isKnownDebugDisplay(possibleUserName: string): boolean {
    const nameKey: string = possibleUserName.toLowerCase();
    const foundStatus: boolean = this.displayInfoByDebugDisplayName.has(nameKey);
    this._logMessage("  DDsply _isKnownDebugDisplay(" + possibleUserName + ") = " + foundStatus);
    return foundStatus;
  }

  public clearDebugDisplays() {
    // clear our map of displays found
    this.displayInfoByDebugDisplayName.clear();
  }

  public setOutlineSymbol(newSymbol: OutLineSymbol) {
    this.outlineSymbols.push(newSymbol);
  }

  public getOutlineSymbols(): OutLineSymbol[] {
    return this.outlineSymbols;
  }
}

// ----------------------------------------------------------------------------
//  Global or Local tokens
//   CLASS TokenSet
//
export class TokenSet {
  public constructor(idString: string) {
    //this.bLogEnabled = isLogging;
    //this.outputChannel = logHandle;
    this.id = idString;
    this._logMessage(`* ${this.id} ready`);
  }

  private id: string = "";
  private rememberedTokenByName = new Map<string, RememberedToken>();
  private ctx: Context | undefined = undefined;
  private bLogEnabled: boolean = false;

  public enableLogging(ctx: Context, doEnable: boolean = true): void {
    this.bLogEnabled = doEnable;
    this.ctx = ctx;
  }

  private _logMessage(message: string): void {
    if (this.bLogEnabled) {
      // Write to output window.
      if (this.ctx) {
        this.ctx.connection.console.log(message);
      }
    }
  }

  *[Symbol.iterator]() {
    yield* this.rememberedTokenByName;
  }

  public entries() {
    return Array.from(this.rememberedTokenByName.entries());
  }

  public clear(): void {
    this.rememberedTokenByName.clear();
    this._logMessage(`* ${this.id} clear() now ` + this.length() + " tokens");
  }

  public length(): number {
    // return count of token names in list
    return this.rememberedTokenByName.size;
  }

  public rememberdTokenString(tokenName: string, aToken: RememberedToken | undefined): string {
    let desiredInterp: string = `  -- token=[len:${tokenName.length} [${tokenName}](undefined)`;
    if (aToken != undefined) {
      desiredInterp = `  -- token=[len:${tokenName.length} [${tokenName}](${aToken.type}[${aToken.modifiers}])]`;
    }
    return desiredInterp;
  }

  public hasToken(tokenName: string): boolean {
    let foundStatus: boolean = false;
    const desiredTokenKey: string = tokenName.toLowerCase();
    if (tokenName.length > 0) {
      foundStatus = this.rememberedTokenByName.has(desiredTokenKey);
    }
    if (foundStatus) {
      this._logMessage(`* ${this.id} [${tokenName}] found: ${foundStatus}`);
    }
    return foundStatus;
  }

  public setToken(tokenName: string, token: RememberedToken): void {
    const desiredTokenKey: string = tokenName.toLowerCase();
    if (tokenName.length > 0) {
      if (!this.hasToken(tokenName)) {
        this.rememberedTokenByName.set(desiredTokenKey, token);
        const currCt: number = this.length();
        this._logMessage(`* ${this.id} #${currCt}: ${this.rememberdTokenString(tokenName, token)}`);
      } else {
        this._logMessage(`* ${this.id} DUPE Token, NOT ADDED! ${this.rememberdTokenString(tokenName, token)}`);
      }
    }
  }

  public getToken(tokenName: string): RememberedToken | undefined {
    const desiredTokenKey: string = tokenName.toLowerCase();
    var desiredToken: RememberedToken | undefined = this.rememberedTokenByName.get(desiredTokenKey);
    if (desiredToken != undefined) {
      // let's never return a declaration modifier! (somehow "declaration" creeps in to our list!??)
      //let modifiersNoDecl: string[] = this._modifiersWithout(desiredToken.modifiers, "declaration");
      let modifiersNoDecl: string[] = desiredToken.modifiersWithout("declaration");
      desiredToken = new RememberedToken(desiredToken.type, desiredToken.lineIndex, desiredToken.charIndex, modifiersNoDecl);
    }
    return desiredToken;
  }
}

// ----------------------------------------------------------------------------
//  local tokens within method
//   CLASS NameScopedTokenSet
//
export class NameScopedTokenSet {
  private id: string = "";
  private methodScopedTokenSetByMethodKey = new Map<string, TokenSet>();
  private origMethodNamebyMethodKey = new Map<string, string>();
  private ctx: Context | undefined = undefined;
  private bLogEnabled: boolean = false;

  public constructor(idString: string) {
    //this.bLogEnabled = isLogging;
    //this.outputChannel = logHandle;
    this.id = idString;
    this._logMessage(`* ${this.id} ready`);
  }

  public enableLogging(ctx: Context, doEnable: boolean = true): void {
    this.bLogEnabled = doEnable;
    this.ctx = ctx;
  }

  private _logMessage(message: string): void {
    if (this.bLogEnabled) {
      // Write to output window.
      if (this.ctx) {
        this.ctx.connection.console.log(message);
      }
    }
  }

  *[Symbol.iterator]() {
    yield* this.methodScopedTokenSetByMethodKey;
  }

  public entries() {
    return Array.from(this.methodScopedTokenSetByMethodKey.entries());
  }

  public keys(): string[] {
    return Array.from(this.methodScopedTokenSetByMethodKey.keys());
  }

  public clear(): void {
    this.methodScopedTokenSetByMethodKey.clear();
    this.origMethodNamebyMethodKey.clear();
    this._logMessage(`* ${this.id} clear() now ` + this.length() + " tokens");
  }

  public clearForMethod(methodName: string) {
    const desiredMethodKey = methodName.toLowerCase();
    let methodTokenSet = this._getMapForMethod(desiredMethodKey);
    if (methodTokenSet) {
      methodTokenSet.clear();
      this._logMessage(`* ${this.id} clearForMethod(${desiredMethodKey}) now ` + methodTokenSet.length() + " tokens");
    }
  }

  public length(): number {
    // return count of method names in list
    return this.methodScopedTokenSetByMethodKey.size;
  }

  public hasMethod(methodName: string): boolean {
    let foundStatus: boolean = false;
    if (methodName.length > 0) {
      const desiredMethodKey = methodName.toLowerCase();
      foundStatus = this.methodScopedTokenSetByMethodKey.has(desiredMethodKey);
      //if (foundStatus) {
      //  this._logMessage(`* ${this.id} [` + desiredMethodKey + "] found: " + foundStatus);
      //}
    }
    return foundStatus;
  }

  public hasToken(tokenName: string): boolean {
    const desiredTokenKey = tokenName.toLowerCase();
    let tokenExistsStatus: boolean = false;
    for (const methodKey of this.methodScopedTokenSetByMethodKey.keys()) {
      if (this.hasTokenForMethod(methodKey, desiredTokenKey)) {
        tokenExistsStatus = true;
        break;
      }
    }
    if (tokenExistsStatus) {
      this._logMessage(`* ${this.id} tokenName=[${tokenName}] found: ${tokenExistsStatus}`);
    }
    return tokenExistsStatus;
  }

  public hasTokenForMethod(methodName: string, tokenName: string): boolean {
    let foundStatus: boolean = false;
    const desiredMethodKey = methodName.toLowerCase();
    const desiredTokenKey = tokenName.toLowerCase();
    const methodLocalsTokenSet = this._getMapForMethod(desiredMethodKey);
    if (methodLocalsTokenSet) {
      foundStatus = methodLocalsTokenSet.hasToken(desiredTokenKey);
    }
    if (foundStatus) {
      this._logMessage(`* ${this.id} tokenName=[${tokenName}] in method=[${methodName}] found: ${foundStatus}`);
    }
    return foundStatus;
  }

  public setTokenForMethod(methodName: string, tokenName: string, token: RememberedToken): void {
    let methodTokenSet: TokenSet | undefined = undefined;
    const desiredMethodKey = methodName.toLowerCase();
    const desiredTokenKey = tokenName.toLowerCase();
    if (!this.hasMethod(desiredMethodKey)) {
      methodTokenSet = new TokenSet(`lpTOK-${desiredMethodKey}`);
      this.methodScopedTokenSetByMethodKey.set(desiredMethodKey, methodTokenSet);
      this.origMethodNamebyMethodKey.set(desiredMethodKey, methodName); // preserve original case
    } else {
      methodTokenSet = this._getMapForMethod(desiredMethodKey);
    }
    if (methodTokenSet && methodTokenSet.hasToken(desiredTokenKey)) {
      this._logMessage(`ERROR attempt to redefine ${desiredTokenKey} in method ${desiredMethodKey} as: ` + this._rememberdTokenString(tokenName, token));
    } else {
      if (methodTokenSet) {
        this._logMessage("  -- NEW-lpTOK " + desiredTokenKey + "=[" + token.type + "[" + token.modifiers + "]]");
        methodTokenSet.setToken(desiredTokenKey, token);
      }
    }
  }

  public getToken(tokenName: string): RememberedToken | undefined {
    let desiredToken: RememberedToken | undefined = undefined;
    const desiredTokenKey = tokenName.toLowerCase();
    let tokenExistsStatus: boolean = false;
    for (const methodKey of this.methodScopedTokenSetByMethodKey.keys()) {
      if (this.hasTokenForMethod(methodKey, desiredTokenKey)) {
        desiredToken = this.getTokenForMethod(methodKey, desiredTokenKey);
        break;
      }
    }
    return desiredToken;
  }

  public getMethodNameForToken(tokenName: string): string | undefined {
    const desiredTokenKey = tokenName.toLowerCase();
    let desiredMethodName: string | undefined = undefined;
    for (let methodKey of this.methodScopedTokenSetByMethodKey.keys()) {
      if (this.hasTokenForMethod(methodKey, desiredTokenKey)) {
        desiredMethodName = methodKey;
        if (this.origMethodNamebyMethodKey.has(methodKey)) {
          desiredMethodName = this.origMethodNamebyMethodKey.get(methodKey); // return method name in original case
        }
        break;
      }
    }
    return desiredMethodName;
  }

  public getTokenForMethod(methodName: string, tokenName: string): RememberedToken | undefined {
    let desiredToken: RememberedToken | undefined = undefined;
    const desiredMethodKey: string = methodName.toLowerCase();
    const desiredTokenKey: string = tokenName.toLowerCase();
    if (this.hasMethod(desiredMethodKey)) {
      const methodLocalsTokenSet = this._getMapForMethod(desiredMethodKey);
      if (methodLocalsTokenSet) {
        desiredToken = methodLocalsTokenSet.getToken(desiredTokenKey);
        if (desiredToken) {
          this._logMessage("  -- FND-lpTOK " + this._rememberdTokenString(tokenName, desiredToken));
        }
      } else {
        this._logMessage(`  -- FND - lpTOK gtfm() no such nethodName = [${methodName}]`);
      }
    } else {
      this._logMessage(`  -- FND - lpTOK gtfm() no TokenSet for methodName = [${methodName}]`);
    }
    return desiredToken;
  }

  private _rememberdTokenString(tokenName: string, aToken: RememberedToken | undefined): string {
    let desiredInterp: string = "  -- LP token=[len:" + tokenName.length + " [" + tokenName + "](undefined)";
    if (aToken != undefined) {
      desiredInterp = "  -- LP token=[len:" + tokenName.length + " [" + tokenName + "](" + aToken.type + "[" + aToken.modifiers + "])]";
    }
    return desiredInterp;
  }

  private _getMapForMethod(methodName: string): TokenSet | undefined {
    let desiredTokenSet: TokenSet | undefined = undefined;
    const desiredMethodKey: string = methodName.toLowerCase();
    if (this.methodScopedTokenSetByMethodKey.has(desiredMethodKey)) {
      desiredTokenSet = this.methodScopedTokenSetByMethodKey.get(desiredMethodKey);
    }
    return desiredTokenSet;
  }
}

// ----------------------------------------------------------------------------
//  This is the basic token type we report to VSCode
//   CLASS RememberedToken

export class RememberedToken {
  _type: string;
  _modifiers: string[] = [];
  private _lineIdx: number;
  private _charIdx: number;

  constructor(type: string, lineIdx: number, charIdx: number, modifiers: string[] | undefined) {
    this._type = type;
    this._lineIdx = lineIdx;
    this._charIdx = charIdx;
    if (modifiers != undefined) {
      this._modifiers = modifiers;
    }
  }

  get type(): string {
    return this._type;
  }

  get modifiers(): string[] {
    return this._modifiers;
  }

  get lineIndex(): number {
    return this._lineIdx;
  }

  get charIndex(): number {
    return this._charIdx;
  }

  public isPublic(): boolean {
    // is symbol from CON section or is PUB method?
    let publicStatus: boolean = false;
    if (this._type === "variable" && this._modifiers.includes("readonly")) {
      publicStatus = true;
    } else if (this._type === "enumMember") {
      publicStatus = true;
    } else if (this._type === "method" && !this._modifiers.includes("static")) {
      publicStatus = true;
    }
    return publicStatus;
  }

  // variable modifier fix ups

  public modifiersWith(newModifier: string): string[] {
    // add modification attribute
    var updatedModifiers: string[] = this._modifiers;
    if (!updatedModifiers.includes(newModifier)) {
      updatedModifiers.push(newModifier);
    }
    return updatedModifiers;
  }

  public modifiersWithout(unwantedModifier: string): string[] {
    //  remove modification attribute
    var updatedModifiers: string[] = [];
    for (var idx = 0; idx < this._modifiers.length; idx++) {
      var possModifier: string = this._modifiers[idx];
      if (possModifier !== unwantedModifier) {
        updatedModifiers.push(possModifier);
      }
    }
    return updatedModifiers;
  }
}
// ----------------------------------------------------------------------------
//  This is the structure we use for tracking Declaration Info for a token
//   CLASS RememberedTokenDeclarationInfo
export class RememberedTokenDeclarationInfo {
  private _type: eCommentType = eCommentType.Unknown;
  private _declLineIndex: number;
  private _declcomment: string | undefined = undefined;
  private _reference: string | undefined = undefined;

  constructor(declarationLinIndex: number, declarationComment: string | undefined, reference?: string | undefined) {
    this._declLineIndex = declarationLinIndex;
    if (declarationComment) {
      if (declarationComment.startsWith("''")) {
        this._type = eCommentType.singleLineDocComment;
        this._declcomment = declarationComment.substring(2).trim();
      } else if (declarationComment.startsWith("'")) {
        this._type = eCommentType.singleLineComment;
        this._declcomment = declarationComment.substring(1).trim();
      } else {
        // leaving type as UNKNOWN
        this._declcomment = declarationComment.trim();
      }
    }
    if (typeof reference !== "undefined" && reference != undefined) {
      this._reference = reference;
    }
  }

  get isDocComment(): boolean {
    // Return the array of comment lines for this block
    return this._type == eCommentType.multiLineDocComment || this._type == eCommentType.singleLineDocComment;
  }

  get lineIndex(): number {
    return this._declLineIndex;
  }

  get comment(): string | undefined {
    return this._declcomment;
  }

  get reference(): string | undefined {
    return this._reference;
  }

  get isFilenameReference(): boolean {
    let isFilenameStatus: boolean = false;
    if (this.reference && this._reference?.includes('"')) {
      isFilenameStatus = true;
    }
    return isFilenameStatus;
  }

  get isObjectReference(): boolean {
    let isObjectStatus: boolean = false;
    if (this.reference && !this._reference?.includes('"')) {
      isObjectStatus = true;
    }
    return isObjectStatus;
  }
}

// ----------------------------------------------------------------------------
//  This is the structure we use for tracking multiline comments
//   CLASS RememberedComment
export enum eCommentType {
  Unknown = 0,
  singleLineComment,
  singleLineDocComment,
  multiLineComment,
  multiLineDocComment,
}

export class RememberedComment {
  _type: eCommentType = eCommentType.Unknown;
  _lines: string[] = [];
  _1stLineIdx: number = 0;
  _lastLineIdx: number = 0;
  constructor(type: eCommentType, lineIdx: number, firstLine: string) {
    this._1stLineIdx = lineIdx;
    this._type = type;
    // remove comment from first line
    let trimmedLine: string = firstLine;
    if (this._type == eCommentType.multiLineDocComment) {
      if (trimmedLine.startsWith("{{")) {
        trimmedLine = trimmedLine.substring(2);
      }
    } else if (this._type == eCommentType.multiLineComment) {
      if (trimmedLine.startsWith("{")) {
        trimmedLine = trimmedLine.substring(1);
      }
    }
    if (trimmedLine.length > 0) {
      this._lines = [trimmedLine];
    }
  }

  get lines(): string[] {
    // Return the array of comment lines for this block
    return this._lines;
  }

  get isDocComment(): boolean {
    // Return the array of comment lines for this block
    return this._type == eCommentType.multiLineDocComment || this._type == eCommentType.singleLineDocComment;
  }

  get lineCount(): number {
    // Return the count of comment lines for this block
    return this._lines.length;
  }

  get isBlankLine(): boolean {
    // Return T/F where T means there is no remaining text after begin/end markers are removed
    return this._lines.length == 0 || (this.lines.length == 1 && this._lines[0].length == 0);
  }

  public commentAsMarkDown(): string | undefined {
    // Return the markdown for this block comment
    let linesAsComment: string | undefined = undefined;
    let tempLines: string[] = [];
    // if keywords are found in comment then specially wrap the word following each keyword
    if (this.lineCount > 0) {
      for (let idx = 0; idx < this.lines.length; idx++) {
        const currLine = this.lines[idx];
        const lineParts = currLine.split(" ");
        let findIndex = lineParts.indexOf("@param");
        let nameItem: string | undefined = undefined;
        if (findIndex != -1 && findIndex < lineParts.length - 1) {
          nameItem = lineParts[findIndex + 1];
        } else {
          findIndex = lineParts.indexOf("@returns");
          if (findIndex != -1 && findIndex < lineParts.length - 1) {
            nameItem = lineParts[findIndex + 1];
          } else {
            findIndex = lineParts.indexOf("@local");
            if (findIndex != -1 && findIndex < lineParts.length - 1) {
              nameItem = lineParts[findIndex + 1];
            }
          }
        }
        if (nameItem) {
          // now wrap the name in single back ticks
          const originameItem: string = nameItem;
          nameItem = nameItem.replace("`", "").replace("`", "");
          const finishedLine: string = currLine.replace(originameItem, "`" + nameItem + "`");
          tempLines[idx] = finishedLine;
        } else {
          tempLines[idx] = currLine;
        }
      }
      linesAsComment = tempLines.join("<br>");
    }
    return linesAsComment;
  }

  public get firstLine() {
    return this._1stLineIdx;
  }

  public span(): Range {
    // return the recorded line indexes (start,end) - span of the comment block
    return { start: { line: this._1stLineIdx, character: 0 }, end: { line: this._lastLineIdx, character: 0 } };
  }

  public appendLine(line: string) {
    // just save this line
    this._lines.push(line);
  }

  public appendLastLine(lineIdx: number, line: string) {
    // remove comment from last line then save remainder and line number
    this._lastLineIdx = lineIdx;
    let trimmedLine: string = line;
    let matchLocn: number = 0;
    if (this._type == eCommentType.multiLineDocComment) {
      matchLocn = trimmedLine.indexOf("}}");
      if (matchLocn != -1) {
        if (matchLocn == 0) {
          trimmedLine = trimmedLine.substring(2);
        } else {
          const leftEdge = trimmedLine.substring(0, matchLocn - 1);
          trimmedLine = leftEdge + trimmedLine.substring(matchLocn + 2);
        }
      }
    } else if (this._type == eCommentType.multiLineComment) {
      matchLocn = trimmedLine.indexOf("}");
      if (matchLocn != -1) {
        if (matchLocn == 0) {
          trimmedLine = trimmedLine.substring(2);
        } else {
          const leftEdge = trimmedLine.substring(0, matchLocn - 1);
          trimmedLine = leftEdge + trimmedLine.substring(matchLocn + 2);
        }
      }
    }
    if (trimmedLine.length > 0) {
      this._lines.push(trimmedLine);
    }
    for (let idx = 0; idx < this._lines.length; idx++) {
      let trimmedLine = this._lines[idx].trim();
      if (trimmedLine.startsWith("''")) {
        trimmedLine = trimmedLine.substring(2);
      } else if (trimmedLine.startsWith("'")) {
        trimmedLine = trimmedLine.substring(1);
      }
      this._lines[idx] = trimmedLine;
    }
    this._clearLinesIfAllBlank();
  }

  public closeAsSingleLineBlock(lineIdx: number) {
    // block of single line comments, remove comment-end from the line then save remainder if any
    this._lastLineIdx = lineIdx;
    for (let idx = 0; idx < this._lines.length; idx++) {
      let trimmedLine = this._lines[idx].trim();
      if (trimmedLine.startsWith("''")) {
        trimmedLine = trimmedLine.substring(2);
      } else if (trimmedLine.startsWith("'")) {
        trimmedLine = trimmedLine.substring(1);
      }
      this._lines[idx] = trimmedLine;
    }
    this._clearLinesIfAllBlank();
  }

  public closeAsSingleLine() {
    // only single line, remove comment-end from the line then save remainder if any
    this._lastLineIdx = this._1stLineIdx;
    let trimmedLine: string = this._lines[0];
    let matchLocn: number = 0;
    if (this._type == eCommentType.multiLineDocComment) {
      matchLocn = trimmedLine.indexOf("}}");
      if (matchLocn != -1) {
        if (matchLocn == 0) {
          trimmedLine = trimmedLine.substring(2);
        } else {
          const leftEdge = trimmedLine.substring(0, matchLocn - 1);
          trimmedLine = leftEdge + trimmedLine.substring(matchLocn + 2);
        }
      }
    } else if (this._type == eCommentType.multiLineComment) {
      matchLocn = trimmedLine.indexOf("}");
      if (matchLocn != -1) {
        if (matchLocn == 0) {
          trimmedLine = trimmedLine.substring(2);
        } else {
          const leftEdge = trimmedLine.substring(0, matchLocn - 1);
          trimmedLine = leftEdge + trimmedLine.substring(matchLocn + 2);
        }
      }
    }
    if (trimmedLine.length > 0) {
      this._lines = [trimmedLine];
    } else {
      this._lines = [];
    }
  }

  public includesLine(lineNumber: number): boolean {
    // return T/F where T means the lineNumber is within the comment
    const commentSpan: Range = this.span();
    const inCommentStatus: boolean = lineNumber >= commentSpan.start.line && lineNumber <= commentSpan.end.line;
    return inCommentStatus;
  }

  public spanString(): string {
    const commentSpan: Range = this.span();
    const startLine = commentSpan.start.line + 1;
    const endLine = commentSpan.end.line + 1;
    let typeString: string = "??BlockComment??";
    if (this._type == eCommentType.singleLineComment) {
      typeString = "singleLineCommentBlock";
    } else if (this._type == eCommentType.singleLineDocComment) {
      typeString = "singleLineDocCommentBlock";
    } else if (this._type == eCommentType.multiLineComment) {
      typeString = "multiLineCommentBlock";
    } else if (this._type == eCommentType.multiLineDocComment) {
      typeString = "multiLineDocCommentBlock";
    }
    const lineRef: string = startLine == endLine ? `Ln#${startLine}` : `Ln#${startLine}-${endLine}`;
    const interpString: string = `[${typeString}] ${lineRef}`;
    return interpString;
  }

  public desribeComment(): string[] {
    const decriptionLines: string[] = [];
    decriptionLines.push("-" + this.spanString());
    decriptionLines.push(" /-- --- ---");
    for (let index = 0; index < this._lines.length; index++) {
      const line = this._lines[index];
      decriptionLines.push(line);
    }
    decriptionLines.push(" \\-- --- ---");
    return decriptionLines;
  }

  private _clearLinesIfAllBlank() {
    // emtpy our line aray if it's really nothing worthwhile
    let bHaveNonBlank: boolean = false;
    for (let idx = 0; idx < this._lines.length; idx++) {
      let currLine = this._lines[idx];
      if (currLine.length > 0) {
        bHaveNonBlank = true;
        break;
      }
    }
    if (!bHaveNonBlank) {
      this._lines = [];
    }
  }
}
// ----------------------------------------------------------------------------
//  A symbol to be shown in outline found during parse
//   CLASS OutLineSymbol
//
export class OutLineSymbol {
  private name: string;
  private extraInfo: string;
  symbolKind: SymbolKind;
  codeRange: Range;
  enclosedSymbols: OutLineSymbol[] = [];

  public constructor(label: string, description: string, kind: SymbolKind, location: Range) {
    this.name = label;
    this.extraInfo = description;
    this.symbolKind = kind;
    this.codeRange = location;
  }

  public label(): string {
    return this.name;
  }

  public description(): string {
    return this.extraInfo;
  }

  public kind(): SymbolKind {
    return this.symbolKind;
  }

  public location(): Range {
    return this.codeRange;
  }
  public addChild(descendent: OutLineSymbol) {
    this.enclosedSymbols.push(descendent);
  }

  public children(): OutLineSymbol[] {
    return this.enclosedSymbols;
  }
}

// ----------------------------------------------------------------------------
//  An error found during parse
//   CLASS DiagnosticReport
//
export class DiagnosticReport {
  private messageText: string;
  private symbolKind: DiagnosticSeverity;
  private symbolLocation: Range;

  constructor(message: string, kind: eSeverity, location: Range) {
    this.messageText = message;
    this.symbolLocation = location;
    switch (kind) {
      case eSeverity.Error: {
        this.symbolKind = DiagnosticSeverity.Error;
        break;
      }
      case eSeverity.Warning: {
        this.symbolKind = DiagnosticSeverity.Error;
        break;
      }
      case eSeverity.Hint: {
        this.symbolKind = DiagnosticSeverity.Hint;
        break;
      }
      default: {
        this.symbolKind = DiagnosticSeverity.Information;
        break;
      }
    }
  }
  public location(): Range {
    return this.symbolLocation;
  }

  public message(): string {
    return this.messageText;
  }

  public severity(): DiagnosticSeverity {
    return this.symbolKind;
  }
}
