'use strict';
// src/providers/ReferencesProvider.ts

import * as lsp from 'vscode-languageserver';
import { Provider } from '.';
import { Context } from '../context';
import { Location } from 'vscode-languageserver-types';
import { DocumentFindings, ITokenReference } from '../parser/spin.semantic.findings';
import { fileSpecFromURI } from '../parser/lang.utils';
import { ExtensionUtils } from '../parser/spin.extension.utils';
import { DocumentLineAt } from '../parser/lsp.textDocument.utils';
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
      // Check if this is a local-scope symbol by examining the current file first
      const currentFileRefs = documentFindings.getReferencesForToken(tokenName);
      const hasGlobalScope = currentFileRefs.some((r) => r.scope === '');

      if (hasGlobalScope) {
        // Global symbol — search all parsed files
        this._collectGlobalReferences(tokenName, includeDeclaration, results);
      } else {
        // Local symbol — search only within current method scope in current file
        const currentMethod = this._getCurrentMethodScope(documentFindings, params.position.line);
        this._collectLocalReferences(processed.document.uri, documentFindings, tokenName, currentMethod, includeDeclaration, results);
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
    for (const [_fSpec, processedDoc] of this.ctx.docsByFSpec) {
      const findings = processedDoc.parseResult;
      if (!findings) {
        continue;
      }
      const refs = findings.getReferencesForToken(tokenName);
      this._addReferencesToResults(processedDoc.document.uri, refs, includeDeclaration, results);
    }
  }

  private _collectLocalReferences(
    uri: string,
    findings: DocumentFindings,
    tokenName: string,
    methodScope: string,
    includeDeclaration: boolean,
    results: Location[]
  ): void {
    // For locals, only search within the same method scope in the current file
    const refs = findings.getReferencesForToken(tokenName, methodScope);
    this._addReferencesToResults(uri, refs, includeDeclaration, results);
  }

  private _collectCrossObjectReferences(
    objectRef: string,
    tokenName: string,
    includeDeclaration: boolean,
    results: Location[]
  ): void {
    // Find the object's document via namespace resolution
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
        if (childUri) {
          this._addReferencesToResults(childUri, childRefs, includeDeclaration, results);
        }
      }

      // Also collect references to the token itself in the parent file
      const refs = findings.getReferencesForToken(tokenName);
      this._addReferencesToResults(processedDoc.document.uri, refs, includeDeclaration, results);
    }
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

  private _getCurrentMethodScope(findings: DocumentFindings, line: number): string {
    // Determine which method the cursor is in by checking method ranges
    // Use the outline symbols to find the enclosing method
    const methodName = findings.getMethodNameForLine(line);
    return methodName || '';
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
    const wordUnderCursor: string = adjustedPos[2];
    if (objectRef === wordUnderCursor) {
      objectRef = '';
    }
    const sourcePosition: lsp.Position = adjustedPos[3];
    this._logMessage(
      `+ Refs: wordUnderCursor=[${wordUnderCursor}], inObjDecl=(${inObjDeclarationStatus}), objectRef=(${objectRef}), pos=(${position.line},${position.character})`
    );
    return {
      position: sourcePosition,
      objectReference: objectRef,
      selectedWord: wordUnderCursor
    };
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
