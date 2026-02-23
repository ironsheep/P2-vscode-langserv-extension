'use strict';
// src/providers/ReferencesProvider.ts

import * as lsp from 'vscode-languageserver';
import { Provider } from '.';
import { Context } from '../context';
import { Location } from 'vscode-languageserver-types';
import { DocumentFindings, ITokenReference } from '../parser/spin.semantic.findings';
import { fileSpecFromURI, isSpin1File } from '../parser/lang.utils';
import { ExtensionUtils } from '../parser/spin.extension.utils';
import { DocumentLineAt, GetWordRangeAtPosition } from '../parser/lsp.textDocument.utils';
import { FindingsAtPostion } from './DefinitionProvider';

export default class ReferencesProvider implements Provider {
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private bLogStarted: boolean = false;
  private extensionUtils: ExtensionUtils;

  constructor(protected readonly ctx: Context) {
    this.extensionUtils = new ExtensionUtils(ctx, this.isDebugLogEnabled);
    if (this.isDebugLogEnabled) {
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        this._logMessage('Spin References log started.');
      } else {
        this._logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }
  }

  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled) {
      this.ctx.logger.log(message);
    }
  }

  async handleReferences(params: lsp.ReferenceParams): Promise<Location[]> {
    const docFSpec: string = fileSpecFromURI(params.textDocument.uri);
    const processed = this.ctx.docsByFSpec.get(docFSpec);
    if (!processed) {
      return [];
    }
    const documentFindings: DocumentFindings | undefined = processed.parseResult;
    if (!documentFindings) {
      return [];
    }
    documentFindings.enableLogging(this.ctx, this.isDebugLogEnabled);

    const symbolIdent: FindingsAtPostion | undefined = this._symbolAtLocation(processed.document, params.position, documentFindings);
    if (!symbolIdent) {
      return [];
    }

    const tokenName = symbolIdent.selectedWord;
    const objectRef = symbolIdent.objectReference;
    const includeDeclaration = params.context.includeDeclaration;

    this._logMessage(`+ Refs: tokenName=[${tokenName}], objectRef=[${objectRef}], includeDecl=(${includeDeclaration})`);

    const results: Location[] = [];

    if (objectRef.length > 0) {
      // Cross-object reference: object.method or object#constant
      this._collectCrossObjectReferences(objectRef, tokenName, includeDeclaration, results);
    } else {
      // Determine scope by checking the specific reference under the cursor
      const currentFileRefs = documentFindings.getReferencesForToken(tokenName);
      const cursorRef = this._findReferenceAtPosition(currentFileRefs, params.position);

      if (cursorRef && cursorRef.scope !== '') {
        // Cursor is on a local-scoped symbol (parameter, local var, return value)
        // Collect ALL references with this name across ALL methods in this file
        this._collectAllLocalReferences(processed.document.uri, documentFindings, tokenName, includeDeclaration, results);
      } else {
        // Cursor is on a global-scoped reference OR no specific ref found — search globally across all files
        this._collectGlobalReferences(tokenName, includeDeclaration, results);
      }
    }

    this._logMessage(`+ Refs: returning ${results.length} locations`);
    return results;
  }

  register(connection: lsp.Connection) {
    connection.onReferences(this.handleReferences.bind(this));
    return {
      referencesProvider: true
    };
  }

  private _collectGlobalReferences(tokenName: string, includeDeclaration: boolean, results: Location[]): void {
    // Search all parsed documents for this global symbol
    this._logMessage(`+ Refs: global: tokenName=[${tokenName}], docCount=(${this.ctx.docsByFSpec.size})`);
    for (const [_fSpec, processedDoc] of this.ctx.docsByFSpec) {
      const findings = processedDoc.parseResult;
      if (!findings) {
        continue;
      }
      const refs = findings.getReferencesForToken(tokenName);
      this._logMessage(`+ Refs: global: refs for [${tokenName}] in [${_fSpec}] = (${refs.length})`);
      this._addReferencesToResults(processedDoc.document.uri, refs, includeDeclaration, results);
    }
  }

  private _collectAllLocalReferences(
    uri: string,
    findings: DocumentFindings,
    tokenName: string,
    includeDeclaration: boolean,
    results: Location[]
  ): void {
    // For local symbols, collect ALL references with this name across ALL methods in this file
    // This finds all same-named parameters, local vars, and return values across all methods
    const refs = findings.getReferencesForToken(tokenName);
    // Filter to only local-scoped refs (exclude any global refs with same name)
    const localRefs = refs.filter((r) => r.scope !== '');
    this._logMessage(`+ Refs: allLocal: tokenName=[${tokenName}], totalRefs=(${refs.length}), localRefs=(${localRefs.length})`);
    this._addReferencesToResults(uri, localRefs, includeDeclaration, results);
  }

  private _findReferenceAtPosition(refs: ITokenReference[], position: lsp.Position): ITokenReference | undefined {
    return refs.find(
      (r) => r.line === position.line && position.character >= r.startCharacter && position.character < r.startCharacter + r.length
    );
  }

  private _collectCrossObjectReferences(
    objectRef: string,
    tokenName: string,
    includeDeclaration: boolean,
    results: Location[]
  ): void {
    // Find the object's document via namespace resolution
    this._logMessage(`+ Refs: crossObj: objectRef=[${objectRef}], tokenName=[${tokenName}], docCount=(${this.ctx.docsByFSpec.size})`);
    for (const [_fSpec, processedDoc] of this.ctx.docsByFSpec) {
      const findings = processedDoc.parseResult;
      if (!findings) {
        continue;
      }
      // Check if this document has the object as a namespace
      const childFindings = findings.getFindingsForNamespace(objectRef);
      if (childFindings) {
        const childRefs = childFindings.getReferencesForToken(tokenName);
        const childUri = childFindings.uri;
        this._logMessage(`+ Refs: crossObj: childFindings for [${objectRef}], childRefs=(${childRefs.length}), childUri=[${childUri}]`);
        if (childUri) {
          this._addReferencesToResults(childUri, childRefs, includeDeclaration, results);
        }
      }

      // Also collect references to the token itself in the parent file
      const refs = findings.getReferencesForToken(tokenName);
      this._logMessage(`+ Refs: crossObj: ownRefs for [${tokenName}] in [${_fSpec}] = (${refs.length})`);
      this._addReferencesToResults(processedDoc.document.uri, refs, includeDeclaration, results);
    }
    this._logMessage(`+ Refs: crossObj: total results=(${results.length})`);
  }

  private _addReferencesToResults(uri: string, refs: ITokenReference[], includeDeclaration: boolean, results: Location[]): void {
    for (const ref of refs) {
      if (!includeDeclaration && ref.isDeclaration) {
        continue;
      }
      results.push({
        uri,
        range: {
          start: { line: ref.line, character: ref.startCharacter },
          end: { line: ref.line, character: ref.startCharacter + ref.length }
        }
      });
    }
  }

  private _symbolAtLocation(
    document: lsp.TextDocument,
    position: lsp.Position,
    symbolsFound: DocumentFindings
  ): FindingsAtPostion | undefined {
    this._logMessage(`+ Refs: symbolAtLocation() ENTRY`);
    const isPositionInBlockComment: boolean = symbolsFound.isLineInBlockComment(position.line);
    const inPasmCodeStatus: boolean = symbolsFound.isLineInPasmCode(position.line);
    const inObjDeclarationStatus: boolean = symbolsFound.isLineObjDeclaration(position.line);
    const adjustedPos = this.extensionUtils.adjustWordPosition(document, position, position, isPositionInBlockComment, inPasmCodeStatus);
    if (!adjustedPos[0]) {
      this._logMessage(`+ Refs: symbolAtLocation() EXIT fail`);
      return undefined;
    }
    const declarationLine: string = DocumentLineAt(document, position).trimEnd();
    let objectRef = inObjDeclarationStatus ? this._objectNameFromDeclaration(declarationLine) : adjustedPos[1];
    let wordUnderCursor: string = adjustedPos[2];
    if (objectRef === wordUnderCursor) {
      objectRef = '';
    }
    const sourcePosition: lsp.Position = adjustedPos[3];

    // Check if the cursor is on a dotted name that is recorded as a full compound reference
    // (e.g., external object types like "sd.cid_t" in VAR/DAT declarations).
    // adjustWordPosition splits dotted names into objectRef + word, but for compound type
    // references the full name is what's stored in the reference index.
    const fullDottedWord = this._getFullDottedWordAtPosition(declarationLine, position, isSpin1File(document.uri));
    if (fullDottedWord && fullDottedWord.includes('.') && !fullDottedWord.startsWith('.') && symbolsFound.hasTokenReferences(fullDottedWord)) {
      this._logMessage(
        `+ Refs: dotted reference found: fullWord=[${fullDottedWord}], overriding split word=[${wordUnderCursor}], objectRef=[${objectRef}]`
      );
      wordUnderCursor = fullDottedWord;
      objectRef = '';
    }

    this._logMessage(
      `+ Refs: wordUnderCursor=[${wordUnderCursor}], inObjDecl=(${inObjDeclarationStatus}), objectRef=(${objectRef}), pos=(${position.line},${position.character})`
    );
    return {
      position: sourcePosition,
      objectReference: objectRef,
      selectedWord: wordUnderCursor
    };
  }

  private _getFullDottedWordAtPosition(lineText: string, position: lsp.Position, spin1File: boolean): string | undefined {
    // Re-extract the full word at position (including dots) before adjustWordPosition splits it.
    const wordRange = GetWordRangeAtPosition(lineText, position, spin1File);
    return lineText.substring(wordRange.start.character, wordRange.end.character);
  }

  private _objectNameFromDeclaration(line: string): string {
    let desiredString: string = '';
    if (line.includes(':')) {
      let lineParts: string[] = line.split(':');
      if (lineParts.length >= 2) {
        const instanceName = lineParts[0].trim();
        if (instanceName.includes('[')) {
          lineParts = instanceName.split('[');
          if (lineParts.length >= 2) {
            desiredString = lineParts[0].trim();
          }
        } else {
          desiredString = instanceName;
        }
      }
    }
    return desiredString;
  }
}
