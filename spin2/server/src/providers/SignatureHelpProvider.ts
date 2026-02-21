'use strict';
// src/providers/SignatureHelpProvider.ts

import * as path from 'path';

import * as lsp from 'vscode-languageserver';
import { Position, Range, ParameterInformation, SignatureInformation, SignatureHelp, MarkupKind } from 'vscode-languageserver-types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Provider } from '.';
import { Context } from '../context';

import { DocumentFindings, ITokenDescription } from '../parser/spin.semantic.findings';
import { IDefinitionInfo, ExtensionUtils, IPairs } from '../parser/spin.extension.utils';
import { GetWordRangeAtPosition, DocumentLineAt, PositionTranslate } from '../parser/lsp.textDocument.utils';
import { Spin2ParseUtils } from '../parser/spin2.utils';
import { Spin1ParseUtils } from '../parser/spin1.utils';
import { IBuiltinDescription, eBuiltInType } from '../parser/spin.common';
import { isSpin1File, fileSpecFromURI } from '../parser/lang.utils';

export default class SignatureHelpProvider implements Provider {
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private bLogStarted: boolean = false;

  private symbolsFound: DocumentFindings = new DocumentFindings(); // this gets replaced
  private parseUtils: Spin1ParseUtils | Spin2ParseUtils = new Spin2ParseUtils();
  private extensionUtils: ExtensionUtils;
  private haveSpin1File: boolean = false;

  constructor(protected readonly ctx: Context) {
    this.extensionUtils = new ExtensionUtils(ctx, this.isDebugLogEnabled);
    if (this.isDebugLogEnabled) {
      this.parseUtils.enableLogging(this.ctx);
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        this._logMessage('Spin signatureHelp log started.');
      } else {
        this._logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }
  }

  async handleGetSignatureHelp({ textDocument, position }: lsp.SignatureHelpParams): Promise<SignatureHelp | null> {
    const docFSpec: string = fileSpecFromURI(textDocument.uri);
    const processed = this.ctx.docsByFSpec.get(docFSpec);
    if (!processed) {
      return null;
    }
    const documentFindings: DocumentFindings | undefined = this.ctx.docsByFSpec.get(docFSpec)?.parseResult;
    if (!documentFindings) {
      return null;
    }
    this.symbolsFound = documentFindings;
    this.symbolsFound.enableLogging(this.ctx, this.isDebugLogEnabled);
    this.haveSpin1File = isSpin1File(docFSpec);
    this.parseUtils = this.haveSpin1File ? new Spin1ParseUtils() : new Spin2ParseUtils();
    this.parseUtils.enableLogging(this.ctx);
    if (!this.haveSpin1File) {
      // forward version so we can use correct built-in tables
      this.parseUtils.setSpinVersion(documentFindings.documentVersion);
    }

    return this.provideSignatureHelp(processed.document, position);
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onSignatureHelp(this.handleGetSignatureHelp.bind(this));
    return {
      signatureHelpProvider: {
        triggerCharacters: ['(', ','],
        retriggerCharacters: ['(', ',']
      }
    };
  }

  /**
   * Write message to debug log (when debug enabled)
   * @param message - text to be written
   * @returns nothing
   */
  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled) {
      //Write to output window.
      this.ctx.logger.log(message);
    }
  }

  public provideSignatureHelp(document: TextDocument, position: Position): Promise<SignatureHelp | null> {
    this._logMessage(`+ Sig: provideSignatureHelp() ENTRY`);

    const theCall = this.walkBackwardsToBeginningOfCall(document, position);
    if (theCall == null) {
      return Promise.resolve(null);
    }
    const callerPos = this.previousTokenPosition(document, theCall.openParen);
    try {
      const defInfo: IDefinitionInfo | null = this.definitionLocation(document, callerPos, theCall.openParen);
      if (defInfo == null) {
        // The definition was not found
        this._logMessage(`+ Sig: defInfo NOT found`);
        return Promise.resolve(null);
      }
      this._logMessage(
        `+ Sig: defInfo.line=[${defInfo.line}], defInfo.doc=[${defInfo.doc}], defInfo.declarationlines=[${defInfo.declarationlines}], defInfo.parameters=[${defInfo.parameters}]`
      );
      if (defInfo.line === callerPos.line) {
        // This must be a function definition
        this._logMessage(`+ Sig: IGNORING function/method definition`);
        return Promise.resolve(null);
      }

      const declarationText: string = (defInfo.declarationlines || []).join(' ').trim();
      this._logMessage(`+ Sig: declarationText=[${declarationText}]`);
      if (!declarationText) {
        this._logMessage(`+ Sig: IGNORING no declarationText`);
        return Promise.resolve(null);
      }

      const signatureHelp: SignatureHelp = {
        activeParameter: 0,
        activeSignature: 0,
        signatures: []
      };

      let sig: string | undefined;
      let si: SignatureInformation | undefined;
      const breakRegEx = /<br>/gi; // we are globally replacing <br> or double-newline markers
      if (defInfo.doc?.includes('Custom Method')) {
        // use this for user(custom) methods
        // Strip annotation prefix from label for cleaner display
        const { annotation, code } = this.splitAnnotationFromLabel(defInfo.declarationlines[0]);
        sig = code;
        let methDescr: string = this._removeCustomMethod(this.getMethodDescriptionFromDoc(defInfo.doc).replace(breakRegEx, '\n\n'));
        if (annotation) {
          methDescr = `*${annotation}*\n\n${methDescr}`;
        }
        si = SignatureInformation.create(sig);
        if (si) {
          si.documentation = { kind: MarkupKind.Markdown, value: methDescr };
          si.parameters = this.getParametersAndReturnTypeFromDoc(defInfo.doc);
        }
      } else if (defInfo.line == -1) {
        // use this for built-in methods
        const langIdString: string = this.haveSpin1File ? 'Spin' : 'Spin2';
        let methDescr: string = this.getMethodDescriptionFromDoc(defInfo.doc).replace(breakRegEx, '\n\n');
        methDescr = `*${langIdString} built-in*\n\n${methDescr}`;
        sig = defInfo.declarationlines[0];
        this._logMessage(`+ Sig: sig=[${sig}], methDescr=[${methDescr}]`);
        si = SignatureInformation.create(sig);
        if (si) {
          si.documentation = { kind: MarkupKind.Markdown, value: methDescr };
          if (defInfo.parameters) {
            si.parameters = this.getParametersAndReturnTypeFromParameterStringAr(defInfo.parameters);
          }
        }
      }
      if (!si || !sig) Promise.resolve(signatureHelp);
      if (si) {
        signatureHelp.signatures.push(si);
        signatureHelp.activeSignature = 0;
        if (si.parameters) {
          this._logMessage(`+ Sig: theCall.commas.length=[${theCall.commas.length}], si.parameters.length=[${si.parameters.length}]`);
          signatureHelp.activeParameter = Math.min(theCall.commas.length, si.parameters.length - 1);
        } else {
          this._logMessage(`+ Sig: theCall.commas.length=[${theCall.commas.length}], NO si.parameters...`);
        }
      }
      return Promise.resolve(signatureHelp);
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  private _removeCustomMethod(lineWNewlines: string): string {
    const lines: string[] = lineWNewlines.split('\n');
    const filtLines: string[] = [];
    for (let index = 0; index < lines.length; index++) {
      const element = lines[index];
      if (!element.includes('Custom Method')) {
        filtLines.push(element);
      }
    }
    return filtLines.join('\n');
  }

  private splitAnnotationFromLabel(label: string): { annotation: string | null; code: string } {
    // Split "(type annotation) code" into separate parts
    // e.g., "(object public method) PUB start(pin, baud)" → { annotation: "object public method", code: "PUB start(pin, baud)" }
    const match = label.match(/^\(([^)]+)\)\s+([\s\S]+)$/);
    if (match) {
      return { annotation: match[1], code: match[2] };
    }
    return { annotation: null, code: label };
  }

  private signatureWithOutLocals(signature: string): string {
    let trimmedSignature: string = signature;
    const localIndicaPosn: number = trimmedSignature.indexOf('|');
    if (localIndicaPosn != -1) {
      trimmedSignature = trimmedSignature.substring(0, localIndicaPosn).replace(/\s+$/, '');
    }
    return trimmedSignature;
  }

  private getParametersAndReturnTypeFromParameterStringAr(paramList: string[] | undefined): ParameterInformation[] {
    // convert list of parameters frombuilt-in description tables to vscode ParameterInformation's
    const parameterDetails: ParameterInformation[] = [];
    if (paramList && paramList.length > 0) {
      for (let paramIdx = 0; paramIdx < paramList.length; paramIdx++) {
        const paramDescr = paramList[paramIdx];
        // SPIN1: cognew and coginit have lines without param - description hyphens, skip them
        if (paramDescr.includes('-')) {
          const lineParts: string[] = paramDescr.split(/[ \t]/).filter(Boolean);
          const paramName: string = lineParts[0];
          this._logMessage(`+ Sig: gpartfpsa paramName=[${paramName}], paramDescr=[${paramDescr}})`);
          const newParamInfo: ParameterInformation = ParameterInformation.create(paramName, paramDescr);
          parameterDetails.push(newParamInfo);
        }
      }
    }
    return parameterDetails;
  }

  private definitionLocation(document: TextDocument, wordPosition: Position, cursorPosition: Position): IDefinitionInfo | null {
    this._logMessage(`+ Sig: definitionLocation() ENTRY`);
    const isPositionInBlockComment: boolean = this.symbolsFound.isLineInBlockComment(wordPosition.line);
    const inPasmCodeStatus: boolean = this.symbolsFound.isLineInPasmCode(wordPosition.line);
    const adjustedPos = this.extensionUtils.adjustWordPosition(document, wordPosition, cursorPosition, isPositionInBlockComment, inPasmCodeStatus);
    if (!adjustedPos[0]) {
      this._logMessage(`+ Sig: definitionLocation() EXIT fail`);
      return null;
    }
    const objectRef = adjustedPos[1];
    const searchWord = adjustedPos[2];
    wordPosition = adjustedPos[3];
    const fileBasename = path.basename(document.uri);
    this._logMessage(
      `+ Sig: searchWord=[${searchWord}], adjPos=(${wordPosition.line},${wordPosition.character}), file=[${fileBasename}], line=[${DocumentLineAt(
        document,
        wordPosition
      )}]`
    );

    this._logMessage(`+ Sig: definitionLocation() EXIT after getting symbol details`);
    return this.getSymbolDetails(document, wordPosition, objectRef, searchWord);
  }

  private getSymbolDetails(document: TextDocument, position: Position, objRef: string, searchWord: string): IDefinitionInfo | null {
    this._logMessage(`+ Sig: getSymbolDetails() searchWord=[${searchWord}]`);
    const defInfo: IDefinitionInfo = {
      file: document.uri,
      line: position.line,
      column: position.character,
      toolUsed: '????',
      declarationlines: [],
      parameters: [],
      returns: [],
      doc: '{huh, I have no clue!}',
      name: path.basename(document.uri)
    };

    let symbolsSet: DocumentFindings = this.symbolsFound;
    let isObjectReference: boolean = false;
    // use object specific symbols if present
    if (objRef.length > 0) {
      if (symbolsSet.isNameSpace(objRef)) {
        const tmpSymbolsSet: DocumentFindings | undefined = symbolsSet.getFindingsForNamespace(objRef);
        if (tmpSymbolsSet) {
          isObjectReference = true;
          symbolsSet = tmpSymbolsSet;
          symbolsSet.enableLogging(this.ctx, this.isDebugLogEnabled);
          this._logMessage(
            `+ Sig: child findings for [${objRef}]: instance=[${symbolsSet.instanceName()}], blockComments=(${symbolsSet.blockCommentCount}), fakeComments=(${symbolsSet.fakeCommentCount})`
          );
        } else {
          this._logMessage(`+ Sig: NO child findings for [${objRef}]`);
        }
      }
    }

    const desiredLinePosition: Position = { line: defInfo.line, character: 0 };
    let sourceLineRaw = DocumentLineAt(document, desiredLinePosition);
    const tmpDeclarationLine: string | undefined = symbolsSet.getDeclarationLine(desiredLinePosition.line);
    if (isObjectReference && tmpDeclarationLine) {
      sourceLineRaw = tmpDeclarationLine;
    }
    const sourceLine = sourceLineRaw.trim();
    let cursorCharPosn = position.character;
    do {
      const char: string = sourceLineRaw.substring(cursorCharPosn, cursorCharPosn);
      if (char == ' ' || char == '\t') {
        break;
      }
      cursorCharPosn--;
    } while (cursorCharPosn > 0);

    const isSignatureLine: boolean = sourceLine.toLowerCase().startsWith('pub') || sourceLine.toLowerCase().startsWith('pri');
    const isPrivate: boolean = sourceLine.toLowerCase().startsWith('pri');
    // spin1 doesn't support debug()
    const isDebugLine: boolean = this.haveSpin1File
      ? false
      : sourceLine.toLowerCase().startsWith('debug(') || sourceLine.toLowerCase().startsWith('debug[');
    this._logMessage(
      `+ Sig: getSymbolDetails() isSignatureLine=(${isSignatureLine}), isDebugLine=(${isDebugLine}), isObjectReference=(${isObjectReference})`
    );

    let bFoundSomething: boolean = false; // we've no answer
    const builtInFindings: IBuiltinDescription = isDebugLine
      ? this.parseUtils.docTextForDebugBuiltIn(searchWord)
      : this.parseUtils.docTextForBuiltIn(searchWord);
    if (!builtInFindings.found) {
      this._logMessage(`+ Sig: built-in=[${searchWord}], NOT found!`);
    } else {
      this._logMessage(`+ Sig: built-in=[${searchWord}], Found!`);
    }
    const bFoundParseToken: boolean = isObjectReference ? symbolsSet.isPublicToken(searchWord) : symbolsSet.isKnownToken(searchWord);
    if (!bFoundParseToken) {
      this._logMessage(`+ Sig: token=[${searchWord}], NOT found!`);
    } else {
      this._logMessage(`+ Sig: token=[${searchWord}], Found!`);
    }
    if (bFoundParseToken && !builtInFindings.found) {
      bFoundSomething = true;
      const tokenFindings: ITokenDescription = isObjectReference
        ? symbolsSet.getPublicTokenWithDescription(searchWord, position.line + 1)
        : symbolsSet.getTokenWithDescription(searchWord, position.line + 1);
      if (tokenFindings.found) {
        this._logMessage(
          `+ Sig: token=[${searchWord}], interpRaw=(${tokenFindings.tokenRawInterp}), scope=[${tokenFindings.scope}], interp=[${tokenFindings.interpretation}], adjName=[${tokenFindings.adjustedName}]`
        );
        this._logMessage(`+ Sig:    file=[${tokenFindings.relatedFilename}], declCmt=(${tokenFindings.declarationComment})]`);
      } else {
        this._logMessage(`+ Sig: get token failed?!!`);
      }
      const nameString: string = tokenFindings.adjustedName;
      const scopeString: string = tokenFindings.scope;
      const typeString: string = tokenFindings.interpretation;

      defInfo.line = tokenFindings.declarationLineIdx; // report not our line but where the method is declared
      const desiredLinePosition: Position = {
        line: tokenFindings.declarationLineIdx,
        character: 0
      };
      const lineText: string | undefined = tokenFindings.declarationLine;
      const declLine = lineText ? lineText : DocumentLineAt(document, desiredLinePosition).trim(); // declaration line
      const nonCommentDecl: string = this.parseUtils.getNonCommentLineRemainder(0, declLine).trim();
      const signatureNoLocals: string = this.signatureWithOutLocals(nonCommentDecl).substring(4);

      //let docRootCommentMD: string = `(*${scopeString}* ${typeString}) **${nameString}**`; // parsedFindings
      let typeInterpWName: string = `(${scopeString} ${typeString}) ${nameString}`; // better formatting of interp
      let typeInterp: string = `(${scopeString} ${typeString})`; // better formatting of interp
      if (scopeString.length == 0) {
        //docRootCommentMD = `(${typeString}) **${nameString}**`;
        typeInterpWName = `(${typeString}) ${nameString}`; // better formatting of interp
        typeInterp = `(${typeString})`;
      }

      // -------------------------------
      // load CODE section of signature help
      //
      if (typeString.includes('method')) {
        if (tokenFindings.scope.includes('object')) {
          const sigPrefix: string = isPrivate ? 'PRI' : 'PUB';
          defInfo.declarationlines = [`(${scopeString} ${typeString}) ${sigPrefix} ${signatureNoLocals}`];
        } else if (isSignatureLine) {
          // for method declaration use declaration line
          defInfo.declarationlines = [nonCommentDecl];
        } else {
          // for method use, replace PUB/PRI with our interp
          const interpDecl = typeInterp + nonCommentDecl.substring(3);
          defInfo.declarationlines = [interpDecl];
        }
      } else if (tokenFindings.isGoodInterp) {
        // else spew good interp details
        defInfo.declarationlines = [typeInterpWName];
      } else {
        // else spew details until we figure out more...
        defInfo.declarationlines = [typeInterpWName, tokenFindings.tokenRawInterp];
      }

      // -------------------------------
      // load MarkDown section
      //
      const mdLines: string[] = [];
      if (typeString.includes('method')) {
        //if (!isSignatureLine) {
        mdLines.push(`Custom Method: User defined<br>`); // this is removed later
        //}
      }
      if (
        (tokenFindings.interpretation.includes('32-bit constant') && !tokenFindings.relatedObjectName) ||
        tokenFindings.interpretation.includes('shared variable') ||
        tokenFindings.interpretation.includes('instance variable') ||
        tokenFindings.interpretation.includes('inline-pasm variable') ||
        tokenFindings.interpretation.includes('enum value')
      ) {
        // if global constant push declaration line, first...
        mdLines.push('Decl: ' + nonCommentDecl + '<br>');
      }
      if (tokenFindings.interpretation.includes('pasm label') && tokenFindings.relatedFilename) {
        mdLines.push('Refers to file: ' + tokenFindings.relatedFilename + '<br>');
      }
      if (tokenFindings.interpretation.includes('named instance') && tokenFindings.relatedFilename) {
        mdLines.push('An instance of: ' + tokenFindings.relatedFilename + '<br>');
      }
      if (tokenFindings.relatedObjectName) {
        mdLines.push('Found in object: ' + tokenFindings.relatedObjectName + '<br>');
      }
      if (tokenFindings.declarationComment) {
        // have object comment
        mdLines.push(tokenFindings.declarationComment);
      } else {
        // no object comment
        if (typeString.includes('method')) {
          // if methods show that we should have doc-comment, except for external object reference were we can't get to doc comments, yet!...
          if (!tokenFindings.relatedObjectName) {
            mdLines.push(`*(no doc-comment provided)*`);
          }
        } else {
          // no doc-comment, not method, do nothing
        }
      }
      if (mdLines.length > 0) {
        defInfo.doc = mdLines.join(' ');
      } else {
        defInfo.doc = undefined;
      }
    } else {
      // -------------------------------
      // no token, let's check for built-in language parts
      if (builtInFindings.found) {
        let bISdebugStatement: boolean = false;
        if (searchWord.toLowerCase() == 'debug' && (sourceLine.toLowerCase().startsWith('debug(') || sourceLine.toLowerCase().startsWith('debug['))) {
          bISdebugStatement = true;
        }
        this._logMessage(`+ Sig: bISdebugStatement=[${bISdebugStatement}], sourceLine=[${sourceLine}]`);
        const mdLines: string[] = [];
        bFoundSomething = true;
        defInfo.declarationlines = [];
        const langIdString: string = this.haveSpin1File ? 'Spin' : 'Spin2';
        this._logMessage(
          `+ Sig: searchWord=[${searchWord}], descr=(${builtInFindings.description}), type=[${langIdString} built-in], cat=[${builtInFindings.category}]`
        );

        const titleText: string | undefined = builtInFindings.category;
        let subTitleText: string | undefined = undefined;
        if (builtInFindings.type == eBuiltInType.BIT_METHOD) {
          defInfo.declarationlines = [builtInFindings.signature];
          subTitleText = `: *${langIdString} built-in*`;
        } else if (this.haveSpin1File == false && builtInFindings.type == eBuiltInType.BIT_DEBUG_METHOD) {
          // we have a Spin2 file with debug() statement
          this._logMessage(`+ Sig: builtInFindings.type=[eBuiltInType.BIT_DEBUG_METHOD]`);
          defInfo.declarationlines = [builtInFindings.signature];
          subTitleText = `: *${langIdString} debug built-in*`;
        }
        if (titleText && subTitleText) {
          if (builtInFindings.type == eBuiltInType.BIT_CONSTANT && bFoundParseToken) {
            const tokenFindings = symbolsSet.getTokenWithDescription(searchWord, position.line + 1);
            if (tokenFindings.found) {
              const desiredLinePosition: Position = {
                line: tokenFindings.declarationLineIdx,
                character: 0
              };
              const lineText: string | undefined = tokenFindings.declarationLine;
              const declLine = lineText ? lineText : DocumentLineAt(document, desiredLinePosition).trim(); // declaration line
              const nonCommentDecl: string = this.parseUtils.getNonCommentLineRemainder(0, declLine).trim();
              mdLines.push('Decl: ' + nonCommentDecl + '<br>');
            }
          }
          mdLines.push(`${titleText}${subTitleText}<br>`);
          mdLines.push('- ' + builtInFindings.description);
        }
        if (mdLines.length > 0) {
          defInfo.doc = mdLines.join(' ');
        } else {
          // if we have title or subTitle but no mdLines then just clear .doc
          if (titleText || subTitleText) {
            defInfo.doc = undefined;
          }
        }
        defInfo.line = -1; // don;t have declaration line# for built-in!
        defInfo.parameters = builtInFindings.parameters; // forward any parameters found...
        defInfo.returns = builtInFindings.returns; // forward any returns found...
      }
    }
    if (bFoundSomething) {
      return defInfo;
    } else {
      return null; // we have no answer!
    }
  }

  // Takes a Go function signature like:
  //     (foo, bar string, baz number) (string, string)
  // and returns an array of parameter strings:
  //     ["foo", "bar string", "baz string"]
  // Takes care of balancing parens so to not get confused by signatures like:
  //     (pattern string, handler func(ResponseWriter, *Request)) {
  private getParametersAndReturnType(signature: string): {
    params: string[];
    returnType: string;
  } {
    const params: string[] = [];
    let parenCount = 0;
    let lastStart = 1;
    for (let i = 1; i < signature.length; i++) {
      switch (signature[i]) {
        case '(':
          parenCount++;
          break;
        case ')':
          parenCount--;
          if (parenCount < 0) {
            if (i > lastStart) {
              params.push(signature.substring(lastStart, i));
            }
            return {
              params,
              returnType: i < signature.length - 1 ? signature.substr(i + 1) : ''
            };
          }
          break;
        case ',':
          if (parenCount === 0) {
            params.push(signature.substring(lastStart, i));
            lastStart = i + 2;
          }
          break;
      }
    }
    return { params: [], returnType: '' };
  }

  private getMethodDescriptionFromDoc(docMD: string | undefined): string {
    let methodDescr: string = '';
    // this isolates mothd description lines and returns them
    // skipping first line, and @param, @returns lines
    if (docMD) {
      const lines = docMD.split('<br>');
      this._logMessage(`+ Sig: gmdfd lines=[${lines}]({${lines.length}})`);
      const descrLines: string[] = [];
      if (lines.length > 0) {
        for (let lnIdx = 1; lnIdx < lines.length; lnIdx++) {
          const sglLine = lines[lnIdx];
          if (sglLine.includes('@param')) {
            continue;
          }
          if (sglLine.includes('@returns')) {
            continue;
          }
          if (sglLine.includes('NOTE: insert comment template')) {
            // specific so we don't filter users comments
            continue;
          }
          descrLines.push(sglLine);
        }
        if (descrLines.length > 0) {
          methodDescr = descrLines.join('<BR>');
        }
      }
    }

    return methodDescr;
  }

  private getParametersAndReturnTypeFromDoc(docMD: string): ParameterInformation[] {
    const parameterDetails: ParameterInformation[] = [];
    // this ignores return type info and just provides deets on param's
    const lines = docMD.split('<br>').filter(Boolean);
    if (lines.length > 0) {
      for (let lnIdx = 0; lnIdx < lines.length; lnIdx++) {
        const sglLine = lines[lnIdx];
        if (sglLine.includes('@param')) {
          const lineParts: string[] = sglLine.split(/[ \t]/).filter(Boolean);
          let paramName: string = lineParts[1];
          this._logMessage(`+ Sig: gpartfd paramName=[${paramName}], lineParts=[${lineParts}]({${lineParts.length}})`);
          const nameStartLocn: number = sglLine.indexOf(paramName);
          if (nameStartLocn != -1) {
            const paramDoc: string = sglLine.substring(nameStartLocn + paramName.length).trim();
            this._logMessage(`+ Sig: gpartfd paramDoc=[${paramDoc}]`);
            paramName = paramName.substring(1, paramName.length - 1);
            const newParamInfo: ParameterInformation = ParameterInformation.create(paramName, `${paramName} ${paramDoc}`);
            parameterDetails.push(newParamInfo);
          }
        }
      }
    }
    return parameterDetails;
  }

  private previousTokenPosition(document: TextDocument, position: Position): Position {
    const origPosition: Position = position;
    while (position.character > 0) {
      const lineText = DocumentLineAt(document, position);
      const wordRange: Range | undefined = GetWordRangeAtPosition(lineText, position);
      if (wordRange) {
        position = wordRange.start;
        break;
      } else {
        position = PositionTranslate(position, 0, -1);
      }
    }
    this._logMessage(`+ Sig: previousTokenPosition([${origPosition.line}, ${origPosition.character}]) => [${position.line}, ${position.character}]`);
    return position;
  }

  /**
   * Goes through the function params' lines and gets the number of commas and the start position of the call.
   */
  private walkBackwardsToBeginningOfCall(document: TextDocument, position: Position): { openParen: Position; commas: Position[] } | null {
    let parenBalance = 0;
    let maxLookupLines = 30;
    const commas = [];

    const lineText = DocumentLineAt(document, position);
    const stringsFound: IPairs[] = this.extensionUtils.getStringPairOffsets(lineText);
    const ticVarsFound: IPairs[] = this.extensionUtils.getPairOffsetsOfTicVarWraps(lineText);

    for (let lineNr = position.line; lineNr >= 0 && maxLookupLines >= 0; lineNr--, maxLookupLines--) {
      const desiredLinePosition: Position = { line: lineNr, character: 0 };
      const line = DocumentLineAt(document, desiredLinePosition);

      // Stop processing if we're inside a comment
      if (this.extensionUtils.isPositionInComment(line, position, stringsFound)) {
        return null;
      }

      // if its current line, get the text until the position given, otherwise get the full line.
      const [currentLine, characterPosition] =
        lineNr === position.line ? [line.substring(0, position.character), position.character] : [line, line.length - 1];

      for (let char = characterPosition; char >= 0; char--) {
        switch (currentLine[char]) {
          case '(':
            parenBalance--;
            if (parenBalance < 0) {
              this._logMessage(`+ Sig: walkBTBOC() = open[line=${lineNr}, char=${char}]`);
              return {
                openParen: { line: lineNr, character: char },
                commas
              };
            }
            break;
          case ')':
            parenBalance++;
            break;
          case ',':
            {
              const commaPos: Position = { line: lineNr, character: char };
              if (parenBalance === 0 && !this.extensionUtils.isPositionInString(line, commaPos, stringsFound, ticVarsFound)) {
                commas.push(commaPos);
              }
            }
            break;
        }
      }
    }
    return null;
  }
}
