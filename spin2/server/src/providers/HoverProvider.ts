'use strict';
// src/providers/HoverProvider.ts

import * as path from 'path';

import * as lsp from 'vscode-languageserver';
import { Position, Hover, MarkupKind } from 'vscode-languageserver-types';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Provider } from '.';
import { Context } from '../context';

import { DocumentFindings, ITokenDescription, RememberedStructure, RememberedStructureMember } from '../parser/spin.semantic.findings';
import { IDefinitionInfo, ExtensionUtils } from '../parser/spin.extension.utils';
import { DocumentLineAt } from '../parser/lsp.textDocument.utils';
import { Spin2ParseUtils, eSearchFilterType } from '../parser/spin2.utils';
import { Spin1ParseUtils } from '../parser/spin1.utils';
import { eBuiltInType, isMaskedDebugMethodCall, isMethodCall } from '../parser/spin.common';
import { isSpin1File, fileSpecFromURI } from '../parser/lang.utils';

export default class HoverProvider implements Provider {
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
        this._logMessage('Spin Hover log started.');
      } else {
        this._logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }
  }

  async handleGetHover({ textDocument, position }: lsp.HoverParams): Promise<Hover | null> {
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

    return this.provideHover(processed.document, position);
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onHover(this.handleGetHover.bind(this));
    return {
      hoverProvider: true
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

  /**
   *
   * @param document
   * @param position
   * @param token
   * @returns Hover | null
   */
  public provideHover(document: TextDocument, position: Position): Thenable<Hover | null> {
    this._logMessage(`+ Hvr: provideHover() ENTRY`);
    this._logMessage(`+ Hvr: provideHover() EXIT after providing def'location`);
    return this.definitionLocation(document, position).then(
      (IDefinitionInfo) => {
        if (IDefinitionInfo == null) {
          this._logMessage(`+ Hvr: provideHover() EXIT no info`);
          return null;
        }

        const lines = IDefinitionInfo.declarationlines.filter((line) => line !== '').map((line) => line.replace(/\t/g, '    '));
        const text = lines.join('\n').replace(/\n+$/, '');

        const hoverTexts: string[] = [];
        const breakRegEx = /<br>/gi; // we are globally replacing <br> or <BR> markers

        const langId = this.haveSpin1File ? 'spin' : 'spin2';

        // Type annotation rendered as italic markdown above the code block
        if (IDefinitionInfo.toolUsed) {
          hoverTexts.push(`*${IDefinitionInfo.toolUsed}*`);
        }
        hoverTexts.push(this.codeBlock(text, langId));
        if (IDefinitionInfo.doc != null) {
          // SIGH: Markdown renders line breaks when there are two or more of them.
          // so replace <br/> with two newLines!
          hoverTexts.push(IDefinitionInfo.doc.replace(breakRegEx, '\n\n'));
        }

        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: hoverTexts.join('\n')
          }
        };
      },
      () => {
        this._logMessage(`+ Hvr: provideHover() EXIT null`);
        return null;
      }
    );
  }

  /**
   * Wraps text in a markdown code fence with syntax highlighting
   * @param text - The code to display
   * @param codeType - Language identifier ('spin' for Spin1 or 'spin2' for Spin2)
   * @returns Markdown-formatted code block
   */
  private codeBlock(text: string, codeType: string): string {
    return `\`\`\`${codeType}\n${text}\n\`\`\``;
  }

  private definitionLocation(document: TextDocument, position: Position): Promise<IDefinitionInfo | null> {
    this._logMessage(`+ Hvr: definitionLocation() ENTRY`);
    const isPositionInBlockComment: boolean = this.symbolsFound.isLineInBlockComment(position.line);
    const inPasmCodeStatus: boolean = this.symbolsFound.isLineInPasmCode(position.line);
    const inObjDeclarationStatus: boolean = this.symbolsFound.isLineObjDeclaration(position.line);
    // NOTE: document and cursor position are the same for now
    const adjustedPos = this.extensionUtils.adjustWordPosition(document, position, position, isPositionInBlockComment, inPasmCodeStatus);
    if (!adjustedPos[0]) {
      this._logMessage(`+ Hvr: definitionLocation() EXIT fail`);
      return Promise.resolve(null);
    }
    this._logMessage(
      `+ Hvr: adjustWordPosition -> [0]bool=(${adjustedPos[0]}), [1]string=[${adjustedPos[1]}], [2]string=[${adjustedPos[2]}], [3]adjposn=[${adjustedPos[3].line}:${adjustedPos[3].character}], [3]wordSrt=[${adjustedPos[4].line}:${adjustedPos[4].character}]`
    );
    const wordStart: Position = adjustedPos[4];
    const declarationLine: string = DocumentLineAt(document, position).trimEnd();
    let objectRef = inObjDeclarationStatus ? this._objectNameFromDeclaration(declarationLine) : adjustedPos[1];

    let hoverSource: string = adjustedPos[2];
    if (objectRef === hoverSource) {
      objectRef = '';
    }
    // Handle array-indexed struct access like FG1[i].B where [i] breaks the dotted name detection.
    // GetWordRangeAtPosition includes '.' in the word (not a word boundary), so hoverSource becomes '.B'
    // and wordStart points to the dot. Strip the leading dot and extract the struct instance name.
    if (objectRef.length === 0 && hoverSource.startsWith('.')) {
      const extractedRef = this._extractInstanceBeforeDot(declarationLine, wordStart.character);
      if (extractedRef) {
        objectRef = extractedRef;
        hoverSource = hoverSource.substring(1);
      }
    }
    // Detect compound PASM directives: "ditto end" — redirect "end" to show "ditto" hover
    if (hoverSource.toLowerCase() === 'end' && /\bditto\s+end\b/i.test(declarationLine)) {
      hoverSource = 'ditto';
    }
    const sourcePosition: Position = adjustedPos[3];
    const fileBasename = path.basename(document.uri);
    // Account for objectRef prefix (e.g., "display." in "display.setColoredTextAtLnCol")
    // wordStart points to beginning of full dotted word, but hoverSource is only the part after the dot
    const objRefPrefixLen: number = objectRef.length > 0 ? objectRef.length + 1 : 0; // +1 for the dot
    const methodFollowString: string = declarationLine.substring(wordStart.character + objRefPrefixLen + hoverSource.length);
    const bMethodCall: boolean = isMethodCall(methodFollowString, this.ctx);
    const bMaskedMethodCall: boolean = isMaskedDebugMethodCall(methodFollowString, this.ctx);
    this._logMessage(`+ Hvr: methodFollowString=[${methodFollowString}](${methodFollowString.length})`);

    this._logMessage(
      `+ Hvr: hoverSource=[${hoverSource}], isMethod=(${bMethodCall}), inObjDecl=(${inObjDeclarationStatus}), adjPos=(${position.line},${position.character}), file=[${fileBasename}], line=[${declarationLine}]`
    );

    this._logMessage(`+ Hvr: definitionLocation() EXIT after getting symbol details`);
    return this.getSymbolDetails(document, sourcePosition, objectRef, hoverSource, bMethodCall, bMaskedMethodCall, inPasmCodeStatus);
  }

  private _objectNameFromDeclaration(line: string): string {
    let desiredString: string = '';
    // parse object declaration forms:
    // ex:  child1 : "dummy_child" | MULTIplIER = 3, CoUNT = 5
    //      child1[4] : "dummy_child" | MULTIplIER = 3, CoUNT = 5
    //      child1[child.MAX_CT] : "dummy_child" | MULTIplIER = 3, CoUNT = 5
    if (line.includes(':')) {
      let lineParts: string[] = line.split(':');
      //this._logMessage(`+ Hvr: _getObjName() :-split lineParts=[${lineParts}](${lineParts.length})`);
      if (lineParts.length >= 2) {
        const instanceName = lineParts[0].trim();
        if (instanceName.includes('[')) {
          lineParts = instanceName.split('[');
          //this._logMessage(`+ Hvr: _getObjName() [-split lineParts=[${lineParts}](${lineParts.length})`);
          if (lineParts.length >= 2) {
            desiredString = lineParts[0].trim();
          }
        } else {
          desiredString = instanceName;
        }
      }
    }
    //this._logMessage(`+ Hvr: _getObjName([${line}]) returns [${desiredString}]`);

    return desiredString;
  }

  private getSignatureWithoutLocals(line: string): string {
    let desiredLinePortion: string = line;
    // strip off locals
    const localOffset: number = line.indexOf('|');
    if (localOffset != -1) {
      desiredLinePortion = line.substring(0, localOffset).trim();
    }
    // upper case the pub/pri
    if (desiredLinePortion.startsWith('pub ')) {
      desiredLinePortion = desiredLinePortion.replace('pub ', 'PUB ');
    } else if (desiredLinePortion.startsWith('pri ')) {
      desiredLinePortion = desiredLinePortion.replace('pri ', 'PRI ');
    }
    return desiredLinePortion;
  }

  private getSymbolDetails(
    document: TextDocument,
    position: Position,
    objRef: string,
    searchWord: string,
    isMethodCall: boolean,
    isMaskedMethodCall: boolean,
    inPasmCode: boolean = false
  ): Promise<IDefinitionInfo | null> {
    return new Promise((resolve, reject) => {
      const defInfo: IDefinitionInfo = {
        file: document.uri,
        line: position.line,
        column: position.character,
        toolUsed: '',
        declarationlines: [],
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
              `+ Hvr: child findings for [${objRef}]: instance=[${symbolsSet.instanceName()}], blockComments=(${symbolsSet.blockCommentCount}), fakeComments=(${symbolsSet.fakeCommentCount})`
            );
          } else {
            this._logMessage(`+ Hvr: NO child findings for [${objRef}]`);
          }
        }
        // If objRef is not a namespace, check if it's a struct instance — show struct member hover
        if (!isObjectReference) {
          const structHover = this._resolveStructMemberHover(document, objRef, searchWord, position, defInfo);
          if (structHover) {
            return resolve(structHover);
          }
        }
      }

      let sourceLineRaw = DocumentLineAt(document, position);
      const tmpDeclarationLine: string | undefined = symbolsSet.getDeclarationLine(position.line);
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
      // ensure we don't recognize debug() in spin1 files!
      const isDebugLine: boolean = this.haveSpin1File
        ? false
        : sourceLine.toLowerCase().startsWith('debug(') || sourceLine.toLowerCase().startsWith('debug[');

      let bFoundSomething: boolean = false; // we've no answer
      let filterType: eSearchFilterType = isMethodCall ? eSearchFilterType.FT_METHOD : eSearchFilterType.FT_NOT_METHOD;
      if (isMaskedMethodCall) {
        filterType = eSearchFilterType.FT_METHOD_MASK;
      }
      const builtInFindings = isDebugLine
        ? this.parseUtils.docTextForDebugBuiltIn(searchWord, filterType)
        : this.parseUtils instanceof Spin2ParseUtils
          ? (this.parseUtils as Spin2ParseUtils).docTextForBuiltIn(searchWord, filterType, inPasmCode)
          : this.parseUtils.docTextForBuiltIn(searchWord);
      if (!builtInFindings.found) {
        this._logMessage(`+ Hvr: built-in=[${searchWord}], NOT found!`);
      } else {
        this._logMessage(`+ Hvr: built-in=[${searchWord}], Found!`);
      }
      const bFoundParseToken: boolean = isObjectReference ? symbolsSet.isPublicToken(searchWord) : symbolsSet.isKnownToken(searchWord);
      if (!bFoundParseToken) {
        this._logMessage(`+ Hvr: token=[${searchWord}], NOT found!`);
      } else {
        this._logMessage(`+ Hvr: token=[${searchWord}], Found!`);
      }
      let bFoundDebugToken: boolean = false;
      if (isDebugLine) {
        bFoundDebugToken = symbolsSet.isKnownDebugDisplay(searchWord);
        if (!bFoundDebugToken) {
          this._logMessage(`+ Hvr: debug token=[${searchWord}], NOT found!`);
        } else {
          this._logMessage(`+ Hvr: debug token=[${searchWord}], Found!`);
        }
      }
      if ((bFoundParseToken || bFoundDebugToken) && !builtInFindings.found) {
        bFoundSomething = true;
        let tokenFindings: ITokenDescription = isObjectReference
          ? symbolsSet.getPublicTokenWithDescription(searchWord, position.line + 1)
          : symbolsSet.getTokenWithDescription(searchWord, position.line + 1);
        if (bFoundDebugToken) {
          tokenFindings = symbolsSet.getDebugTokenWithDescription(searchWord);
        }
        if (tokenFindings.found) {
          this._logMessage(
            `+ Hvr: token=[${searchWord}], interpRaw=(${tokenFindings.tokenRawInterp}), scope=[${tokenFindings.scope}], interp=[${tokenFindings.interpretation}], adjName=[${tokenFindings.adjustedName}]`
          );
          this._logMessage(
            `+ Hvr:    file=[${tokenFindings.relatedFilename}], declCmt=[${tokenFindings.declarationComment}], declLine=[${tokenFindings.declarationLine}], sig=[${tokenFindings.signature}]`
          );
        } else {
          this._logMessage(`+ Hvr: get token failed?!!`);
        }
        const nameString: string = tokenFindings.adjustedName;
        const scopeString: string = tokenFindings.scope;
        const typeString: string = tokenFindings.interpretation;

        //let docRootCommentMD: string = `(*${scopeString}* ${typeString}) **${nameString}**`; // parsedFindings
        let typeInterpWName: string = `(${scopeString} ${typeString}) ${nameString}`; // better formatting of interp
        let typeInterp: string = `(${scopeString} ${typeString})`; // better formatting of interp
        if (scopeString.length == 0) {
          //docRootCommentMD = `(${typeString}) **${nameString}**`;
          typeInterpWName = `(${typeString}) ${nameString}`; // better formatting of interp
          typeInterp = `(${typeString})`;
        }
        const desiredLine: Position = Position.create(tokenFindings.declarationLineIdx, 0);
        const lineText: string | undefined = tokenFindings.declarationLine;
        const declLine: string = lineText ? lineText : DocumentLineAt(document, desiredLine).trim(); // declaration line
        const nonCommentDecl: string = this.parseUtils.getNonCommentLineRemainder(0, declLine).trim();

        // -------------------------------
        // load CODE section of hover
        // Annotation goes in toolUsed (rendered as italic markdown above code block)
        // Only valid Spin2 code goes in declarationlines (rendered in syntax-highlighted code block)
        //
        const isMethod: boolean = typeString.includes('method');
        if (isMethod) {
          tokenFindings.signature = this.getSignatureWithoutLocals(nonCommentDecl);
          if (tokenFindings.scope.includes('object')) {
            defInfo.toolUsed = `${scopeString} ${typeString}`;
            defInfo.declarationlines = [tokenFindings.signature];
          } else if (isSignatureLine) {
            // for method declaration use declaration line (already valid Spin2)
            defInfo.declarationlines = [sourceLine];
          } else {
            // for method use, show clean signature with PUB/PRI for syntax highlighting
            defInfo.toolUsed = scopeString ? `${scopeString} ${typeString}` : typeString;
            defInfo.declarationlines = [tokenFindings.signature];
          }
        } else if (tokenFindings.isGoodInterp) {
          // good interp details: annotation separate from name
          defInfo.toolUsed = scopeString ? `${scopeString} ${typeString}` : typeString;
          defInfo.declarationlines = [nameString];
        } else {
          // fallback: annotation separate from name + raw interp
          defInfo.toolUsed = scopeString ? `${scopeString} ${typeString}` : typeString;
          defInfo.declarationlines = [nameString, tokenFindings.tokenRawInterp];
        }

        // -------------------------------
        // load MarkDown section
        //
        const mdLines: string[] = [];
        if (isMethod) {
          //if (!isSignatureLine) {
          // TODO: remove NOT USING THIS  mdLines.push(`Custom Method: User defined<br>`);
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
        // Method-local tokens (locals, params, returns) inherit the method's doc-comment
        // in _fillInFindings — suppress it here since the comment describes the method, not the variable
        const isMethodLocalToken = typeString === 'local variable' || typeString === 'parameter' || typeString === 'return value';
        if (tokenFindings.declarationComment && !isMethodLocalToken) {
          // have object comment
          if (isMethod) {
            mdLines.push('- ' + tokenFindings.declarationComment);
          } else {
            mdLines.push(tokenFindings.declarationComment);
          }
        } else {
          // no object comment
          if (isMethod) {
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

        // Augment hover with type info for variables/parameters/return values
        if (!isMethod && !isObjectReference) {
          const varType = this._extractTypeFromDeclLine(nonCommentDecl, searchWord);
          const structTypeInfo = this._getStructTypeForToken(searchWord, position, symbolsSet);

          if (structTypeInfo) {
            // Struct instance — show type (with ^ if pointer) and struct definition
            const displayType = varType && varType.startsWith('^') ? `^${structTypeInfo.typeName}` : structTypeInfo.typeName;
            if (defInfo.declarationlines.length > 0 && defInfo.declarationlines[0] === nameString) {
              defInfo.declarationlines = [`${displayType} ${nameString}`];
            }
            const structDeclText = this._formatStructForHover(structTypeInfo.structDefn);
            if (defInfo.doc) {
              defInfo.doc += '<br>' + structDeclText;
            } else {
              defInfo.doc = structDeclText;
            }
          } else {
            // Non-struct: show explicit type, or LONG for untyped locals/params/returns
            const isDefaultLongType = typeString === 'local variable' || typeString === 'parameter' || typeString === 'return value';
            const displayType = varType ? varType : isDefaultLongType ? 'LONG' : undefined;
            if (displayType && defInfo.declarationlines.length > 0 && defInfo.declarationlines[0] === nameString) {
              defInfo.declarationlines = [`${displayType} ${nameString}`];
            }
          }
        }
      } else {
        // -------------------------------
        // no token, let's check for built-in language parts
        if (builtInFindings.found) {
          let bISdebugStatement: boolean = false;
          const bHaveParams = builtInFindings.parameters && builtInFindings.parameters.length > 0 ? true : false;
          const bHaveReturns = builtInFindings.returns && builtInFindings.returns.length > 0 ? true : false;
          // ensure we don't recognize debug() in spin1 files!
          if (
            this.haveSpin1File == false &&
            searchWord.toLowerCase() == 'debug' &&
            (sourceLine.toLowerCase().startsWith('debug(') || sourceLine.toLowerCase().startsWith('debug['))
          ) {
            bISdebugStatement = true;
          }
          this._logMessage(`+ Hvr: bISdebugStatement=[${bISdebugStatement}], sourceLine=[${sourceLine}]`);
          let mdLines: string[] = [];
          bFoundSomething = true;
          defInfo.declarationlines = [];
          const langIdString: string = this.haveSpin1File ? 'Spin' : 'Spin2';
          this._logMessage(
            `+ Hvr: searchWord=[${searchWord}], descr=(${builtInFindings.description}), type=[${langIdString} built-in], cat=[${builtInFindings.category}]`
          );

          let titleText: string | undefined = builtInFindings.category;
          let subTitleText: string | undefined = undefined;
          if (builtInFindings.type == eBuiltInType.BIT_VARIABLE) {
            defInfo.toolUsed = 'variable';
            defInfo.declarationlines = [searchWord];
            // in one case, we are doubling "variable", remove one...
            if (titleText && titleText.includes('Spin Variable')) {
              titleText = 'Spin';
            }
            subTitleText = ` variable: *${langIdString} built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_SYMBOL) {
            defInfo.toolUsed = 'symbol';
            defInfo.declarationlines = [searchWord];
            subTitleText = ` symbol: *${langIdString} built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_CONSTANT) {
            defInfo.toolUsed = 'constant 32-bit';
            defInfo.declarationlines = [searchWord];
            subTitleText = ` constant: *${langIdString} built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_METHOD_POINTER) {
            defInfo.toolUsed = 'built-in method pointer';
            defInfo.declarationlines = [builtInFindings.signature];
            subTitleText = `: *${langIdString} built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_METHOD) {
            defInfo.toolUsed = 'built-in method';
            defInfo.declarationlines = [builtInFindings.signature];
            subTitleText = `: *${langIdString} built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_LANG_PART) {
            defInfo.toolUsed = `${langIdString} language`;
            defInfo.declarationlines = [searchWord];
            subTitleText = `: *${langIdString} built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_PASM_DIRECTIVE) {
            defInfo.toolUsed = 'built-in directive';
            defInfo.declarationlines = [builtInFindings.signature];
            subTitleText = `: *${langIdString} built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_PASM_INSTRUCTION) {
            defInfo.toolUsed = `PASM2 instruction (${builtInFindings.category})`;
            defInfo.declarationlines = [builtInFindings.signature];
            // Build rich description with flag and timing info
            let instrDescr = '- ' + builtInFindings.description;
            if (builtInFindings.flagC) {
              instrDescr += `<br><br>**C flag:** ${builtInFindings.flagC}`;
            }
            if (builtInFindings.flagZ) {
              instrDescr += builtInFindings.flagC ? `<br>**Z flag:** ${builtInFindings.flagZ}` : `<br><br>**Z flag:** ${builtInFindings.flagZ}`;
            }
            if (builtInFindings.timing) {
              instrDescr += `<br>**Timing:** ${builtInFindings.timing} clocks`;
            }
            defInfo.doc = `${builtInFindings.category}: *PASM2 instruction*<br>${instrDescr}`;
            mdLines = [];
            titleText = undefined;
            subTitleText = undefined;
          } else if (builtInFindings.type == eBuiltInType.BIT_PASM_CONDITIONAL) {
            defInfo.toolUsed = 'PASM2 conditional';
            defInfo.declarationlines = [builtInFindings.signature];
            let condDescr = '- ' + builtInFindings.description;
            if (builtInFindings.aliases && builtInFindings.aliases.length > 0) {
              condDescr += `<br><br>**Aliases:** ${builtInFindings.aliases.join(', ')}`;
            }
            defInfo.doc = `Conditional Execution: *PASM2*<br>${condDescr}`;
            mdLines = [];
            titleText = undefined;
            subTitleText = undefined;
          } else if (builtInFindings.type == eBuiltInType.BIT_PASM_EFFECT) {
            defInfo.toolUsed = 'PASM2 instruction effect';
            defInfo.declarationlines = [builtInFindings.signature];
            defInfo.doc = `Instruction Effect: *PASM2*<br>- ${builtInFindings.description}`;
            mdLines = [];
            titleText = undefined;
            subTitleText = undefined;
          } else if (this.haveSpin1File == false && builtInFindings.type == eBuiltInType.BIT_DEBUG_SYMBOL) {
            this._logMessage(`+ Hvr: builtInFindings.type=[eBuiltInType.BIT_DEBUG_SYMBOL]`);
            if (bISdebugStatement) {
              defInfo.toolUsed = 'DEBUG method';
              defInfo.declarationlines = [builtInFindings.signature];
              defInfo.doc = ''.concat(`${builtInFindings.category}: *${langIdString} debug built-in*<br>`, '- ' + builtInFindings.description);
              // deselect lines into mdLines mech...
              mdLines = [];
              titleText = undefined;
              subTitleText = undefined;
            } else {
              defInfo.toolUsed = 'DEBUG symbol';
              defInfo.declarationlines = [searchWord];
              subTitleText = `: *${langIdString} debug built-in*`;
            }
          } else if (this.haveSpin1File == false && builtInFindings.type == eBuiltInType.BIT_DEBUG_METHOD) {
            this._logMessage(`+ Hvr: builtInFindings.type=[eBuiltInType.BIT_DEBUG_METHOD]`);
            defInfo.toolUsed = 'DEBUG method';
            defInfo.declarationlines = [builtInFindings.signature];
            subTitleText = `: *${langIdString} debug built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_TYPE) {
            defInfo.toolUsed = `${langIdString} Storage`;
            defInfo.declarationlines = [searchWord];
            subTitleText = `: *${langIdString} built-in*`;
          }
          if (titleText && subTitleText) {
            if (builtInFindings.type == eBuiltInType.BIT_CONSTANT && bFoundParseToken) {
              const tokenFindings = symbolsSet.getTokenWithDescription(searchWord, position.line + 1);
              if (tokenFindings.found) {
                const desiredLine: Position = Position.create(tokenFindings.declarationLineIdx, 0);
                const lineText: string | undefined = tokenFindings.declarationLine;
                const declLine = lineText ? lineText : DocumentLineAt(document, desiredLine).trim(); // declaration line
                const nonCommentDecl: string = this.parseUtils.getNonCommentLineRemainder(0, declLine).trim();
                mdLines.push('Decl: ' + nonCommentDecl + '<br>');
              }
            }
            mdLines.push(`${titleText}${subTitleText}<br>`);
            mdLines.push('- ' + builtInFindings.description);
          }
          if (bHaveParams || bHaveReturns) {
            mdLines.push('<br><br>'); // blank line
          }
          if (bHaveParams && builtInFindings.parameters) {
            for (let parmIdx = 0; parmIdx < builtInFindings.parameters.length; parmIdx++) {
              const paramDescr = builtInFindings.parameters[parmIdx];
              const lineParts: string[] = paramDescr.split(' - ');
              const valueName: string = lineParts[0].replace('`', '').replace('`', '');
              if (lineParts.length >= 2) {
                mdLines.push('@param `' + valueName + '` - ' + paramDescr.substring(lineParts[0].length + 3) + '<br>'); // formatted parameter description
              } else {
                // special handling when we have non-param lines, too
                // FIXME: TODO: is this spin1 only?? (came from spin1 hover in orig code)
                mdLines.push(paramDescr + '<br>'); // formatted parameter description
              }
            }
          }
          if (bHaveReturns && builtInFindings.returns) {
            for (let parmIdx = 0; parmIdx < builtInFindings.returns.length; parmIdx++) {
              const returnsDescr = builtInFindings.returns[parmIdx];
              const lineParts: string[] = returnsDescr.split(' - ');
              const valueName: string = lineParts[0].replace('`', '').replace('`', '');
              if (lineParts.length >= 2) {
                mdLines.push('@returns `' + valueName + '` - ' + returnsDescr.substring(lineParts[0].length + 3) + '<br>'); // formatted parameter description
              }
            }
          }
          if (mdLines.length > 0) {
            defInfo.doc = mdLines.join(' ');
          } else {
            // if we have title or subTitle but no mdLines then just clear .doc
            if (titleText || subTitleText) {
              defInfo.doc = undefined;
            }
          }
        }
      }
      if (bFoundSomething) {
        return resolve(defInfo);
      } else {
        return reject(null); // we have no answer!
      }
    });
  }

  private _resolveStructMemberHover(
    document: TextDocument,
    objRef: string,
    searchWord: string,
    position: Position,
    defInfo: IDefinitionInfo
  ): IDefinitionInfo | undefined {
    const symbolsFound = this.symbolsFound;

    let targetStructDefn: RememberedStructure | undefined;
    let targetMember: RememberedStructureMember | undefined;

    // Try direct single-level: objRef is a struct instance variable, searchWord is its member
    let structTypeName = symbolsFound.getTypeForLocalStructureInstance(objRef, position.line);
    if (!structTypeName) {
      structTypeName = symbolsFound.getTypeForStructureInstance(objRef);
    }

    if (structTypeName) {
      const structDefn = this._getStructDefn(structTypeName, symbolsFound);
      if (structDefn) {
        const member = structDefn.memberNamed(searchWord);
        if (member) {
          targetStructDefn = structDefn;
          targetMember = member;
        }
      }
    }

    // If direct didn't work, objRef may be a struct member not a variable — walk the chain
    if (!targetStructDefn || !targetMember) {
      const lineText = DocumentLineAt(document, position).trimEnd();
      const dottedPath = this._extractDottedPath(lineText, position.character);
      if (!dottedPath || dottedPath.length < 2) {
        return undefined;
      }

      this._logMessage(`+ Hvr: _resolveStructMemberHover() walking chain: [${dottedPath.join('.')}], target=[${searchWord}]`);

      const rootName = dottedPath[0];
      let rootType = symbolsFound.getTypeForLocalStructureInstance(rootName, position.line);
      if (!rootType) {
        rootType = symbolsFound.getTypeForStructureInstance(rootName);
      }
      if (!rootType) {
        return undefined;
      }

      let currentStructDefn = this._getStructDefn(rootType, symbolsFound);
      if (!currentStructDefn) {
        return undefined;
      }

      for (let i = 1; i < dottedPath.length; i++) {
        const segmentName = dottedPath[i];
        const member = currentStructDefn.memberNamed(segmentName);
        if (!member) {
          return undefined;
        }

        if (segmentName.toLowerCase() === searchWord.toLowerCase()) {
          targetStructDefn = currentStructDefn;
          targetMember = member;
          break;
        }

        if (!member.isStructure) {
          return undefined;
        }

        currentStructDefn = this._getStructDefn(member.structName, symbolsFound);
        if (!currentStructDefn) {
          return undefined;
        }
      }
    }

    if (!targetStructDefn || !targetMember) {
      return undefined;
    }

    // Build hover info
    defInfo.toolUsed = 'struct member';
    defInfo.declarationlines = [this._formatStructForHover(targetStructDefn)];

    // Build member description
    let typeDesc: string;
    if (targetMember.isStructure) {
      typeDesc = `struct ${targetMember.structName}`;
    } else {
      const typeMap: Record<string, string> = { MT_Byte: 'BYTE', MT_Word: 'WORD', MT_Long: 'LONG', MT_Unknown: 'unknown' };
      typeDesc = typeMap[targetMember.typeString] || targetMember.typeString;
    }

    let memberDesc = `Member \`${targetMember.name}\` of struct \`${targetStructDefn.name}\` — type: ${typeDesc}`;
    if (targetMember.instanceCount > 1) {
      memberDesc += `[${targetMember.instanceCount}]`;
    }
    defInfo.doc = memberDesc;

    this._logMessage(`+ Hvr: _resolveStructMemberHover() found member [${targetMember.name}] in struct [${targetStructDefn.name}]`);
    return defInfo;
  }

  private _extractTypeFromDeclLine(declLine: string, varName: string): string | undefined {
    // Search the declaration line for a type annotation preceding the variable name.
    // Matches: ^structName varName, structName varName, ^BYTE varName, BYTE varName, etc.
    // Does NOT match when varName appears without a type prefix (default LONG).
    const escapedName = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const typePattern = new RegExp(`(\\^?[a-zA-Z_]\\w*(?:\\.[a-zA-Z_]\\w*)?)\\s+${escapedName}(?=[\\s,\\[\\])|]|$)`, 'i');
    const match = declLine.match(typePattern);
    if (match) {
      const typeName = match[1];
      // Filter out keywords that aren't types (PUB, PRI, etc.)
      const nonTypeKeywords = ['pub', 'pri', 'con', 'var', 'dat', 'obj', 'alignw', 'alignl'];
      if (nonTypeKeywords.includes(typeName.toLowerCase())) {
        return undefined;
      }
      this._logMessage(`+ Hvr: _extractTypeFromDeclLine() found type=[${typeName}] for var=[${varName}]`);
      return typeName;
    }
    return undefined;
  }

  private _getStructTypeForToken(
    tokenName: string,
    position: Position,
    symbolsSet: DocumentFindings
  ): { typeName: string; structDefn: RememberedStructure } | undefined {
    // Check if this token is a struct instance (local first, then global)
    let structTypeName = symbolsSet.getTypeForLocalStructureInstance(tokenName, position.line);
    if (!structTypeName) {
      structTypeName = symbolsSet.getTypeForStructureInstance(tokenName);
    }
    if (!structTypeName) {
      return undefined;
    }

    const structDefn = this._getStructDefn(structTypeName, symbolsSet);
    if (!structDefn) {
      return undefined;
    }

    this._logMessage(`+ Hvr: _getStructTypeForToken() [${tokenName}] is struct type [${structTypeName}]`);
    return { typeName: structTypeName, structDefn };
  }

  private _formatStructForHover(structDefn: RememberedStructure): string {
    // toString() returns debug format like "STRUCT point (MT_Long x, MT_Long y)"
    // Clean up to Spin2 syntax like "STRUCT point(x, y)"
    let result = structDefn.toString();
    result = result.replace(/MT_Long /g, '');
    result = result.replace(/MT_Byte /g, 'BYTE ');
    result = result.replace(/MT_Word /g, 'WORD ');
    result = result.replace(/MT_Structure\((\w+)\) /g, '$1 ');
    result = result.replace(' (', '(');
    return result;
  }

  private _getStructDefn(structTypeName: string, symbolsFound: DocumentFindings): RememberedStructure | undefined {
    let structDefn = symbolsFound.getStructure(structTypeName);
    if (!structDefn && structTypeName.includes('.')) {
      const dotIdx = structTypeName.indexOf('.');
      const objName = structTypeName.substring(0, dotIdx);
      const typeName = structTypeName.substring(dotIdx + 1);
      const childFindings = symbolsFound.getFindingsForNamespace(objName);
      if (childFindings) {
        structDefn = childFindings.getStructure(typeName);
      }
    }
    return structDefn;
  }

  private _extractInstanceBeforeDot(lineText: string, wordStartChar: number): string | undefined {
    // Look for '.' at or immediately before the word start position
    // Handle patterns like: FG1[i].B  or  arr[x][y].field
    // Note: GetWordRangeAtPosition includes '.' in the word, so wordStartChar often points to the dot itself
    let pos: number;
    if (lineText.charAt(wordStartChar) === '.') {
      // Dot is at wordStart (included in word by GetWordRangeAtPosition)
      pos = wordStartChar - 1;
    } else if (wordStartChar > 0 && lineText.charAt(wordStartChar - 1) === '.') {
      // Dot is immediately before wordStart
      pos = wordStartChar - 2;
    } else {
      return undefined;
    }

    // Skip past any closing bracket expressions: ]...[
    while (pos >= 0 && lineText.charAt(pos) === ']') {
      let depth = 1;
      pos--;
      while (pos >= 0 && depth > 0) {
        if (lineText.charAt(pos) === ']') depth++;
        else if (lineText.charAt(pos) === '[') depth--;
        pos--;
      }
    }

    // Now extract the identifier before the brackets/dot
    const wordChars = /[a-zA-Z0-9_]/;
    const end = pos + 1;
    while (pos >= 0 && wordChars.test(lineText.charAt(pos))) {
      pos--;
    }
    const instanceName = lineText.substring(pos + 1, end);
    this._logMessage(`+ Hvr: _extractInstanceBeforeDot() line=[${lineText}], wordStart=${wordStartChar} -> instance=[${instanceName}]`);
    return instanceName.length > 0 ? instanceName : undefined;
  }

  private _extractDottedPath(lineText: string, cursorChar: number): string[] | undefined {
    // Extract the full dotted expression from the line, skipping over bracket expressions
    // e.g., "FG1[i].B[1]" → ['FG1', 'B'], "root[i].mid[j].field" → ['root', 'mid', 'field']
    const wordChars = /[a-zA-Z0-9_]/;

    let start = cursorChar;
    while (start > 0) {
      const ch = lineText.charAt(start - 1);
      if (wordChars.test(ch) || ch === '.') {
        start--;
      } else if (ch === ']') {
        // Skip over bracket expression: ]...[
        start--;
        let depth = 1;
        while (start > 0 && depth > 0) {
          start--;
          if (lineText.charAt(start) === ']') depth++;
          else if (lineText.charAt(start) === '[') depth--;
        }
      } else {
        break;
      }
    }

    let end = cursorChar;
    while (end < lineText.length) {
      const ch = lineText.charAt(end);
      if (wordChars.test(ch) || ch === '.') {
        end++;
      } else if (ch === '[') {
        // Skip over bracket expression: [...]
        end++;
        let depth = 1;
        while (end < lineText.length && depth > 0) {
          if (lineText.charAt(end) === '[') depth++;
          else if (lineText.charAt(end) === ']') depth--;
          end++;
        }
      } else {
        break;
      }
    }

    const fullExpr = lineText.substring(start, end);
    if (!fullExpr.includes('.')) {
      return undefined;
    }

    // Strip bracket expressions before splitting on dots
    const stripped = fullExpr.replace(/\[[^\]]*\]/g, '');
    const parts = stripped.split('.').filter((p) => p.length > 0);
    this._logMessage(`+ Hvr: _extractDottedPath() expr=[${fullExpr}], parts=[${parts.join(', ')}]`);
    return parts.length >= 2 ? parts : undefined;
  }
}
