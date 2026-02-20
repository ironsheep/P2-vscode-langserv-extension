'use strict';
// src/providers/WorkspaceSymbolProvider.ts

import * as lsp from 'vscode-languageserver';
import { Provider } from '.';
import { Context } from '../context';
import { SymbolInformation, SymbolKind } from 'vscode-languageserver-types';
import { DocumentFindings } from '../parser/spin.semantic.findings';
import * as path from 'path';

export default class WorkspaceSymbolProvider implements Provider {
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit

  constructor(protected readonly ctx: Context) {}

  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled) {
      this.ctx.logger.log(message);
    }
  }

  async handleWorkspaceSymbol(params: lsp.WorkspaceSymbolParams): Promise<SymbolInformation[]> {
    const query = params.query.toLowerCase();
    const results: SymbolInformation[] = [];

    this._logMessage(`+ WkSym: query=[${query}]`);

    for (const [_fSpec, processedDoc] of this.ctx.docsByFSpec) {
      const findings: DocumentFindings | undefined = processedDoc.parseResult;
      if (!findings) {
        continue;
      }
      const fileBasename = path.basename(processedDoc.document.uri);
      const docUri = processedDoc.document.uri;

      // Iterate all token names in the reference index
      const tokenNames = findings.tokenReferenceNames;
      for (const tokenNameKey of tokenNames) {
        // Get the declaration references for this token (global scope only)
        const refs = findings.getReferencesForToken(tokenNameKey);
        const declRef = refs.find((r) => r.isDeclaration && r.scope === '');
        if (!declRef) {
          continue; // skip non-global or non-declaration tokens
        }

        // Get the original-case name from the reference (tokenNameKey is lowercase)
        // Use the global token to get the semantic type for SymbolKind mapping
        const globalToken = findings.getGlobalToken(tokenNameKey);
        const tokenType = globalToken ? globalToken.type : 'variable';

        // Filter by query string (case-insensitive substring match)
        if (query.length > 0 && !tokenNameKey.includes(query)) {
          continue;
        }

        const symbolKind = this._mapTokenTypeToSymbolKind(tokenType);

        results.push({
          name: tokenNameKey, // lowercase key from reference index
          kind: symbolKind,
          location: {
            uri: docUri,
            range: {
              start: { line: declRef.line, character: declRef.startCharacter },
              end: { line: declRef.line, character: declRef.startCharacter + declRef.length }
            }
          },
          containerName: fileBasename
        });
      }
    }

    this._logMessage(`+ WkSym: returning ${results.length} symbols`);
    return results;
  }

  register(connection: lsp.Connection) {
    connection.onWorkspaceSymbol(this.handleWorkspaceSymbol.bind(this));
    return {
      workspaceSymbolProvider: true
    };
  }

  private _mapTokenTypeToSymbolKind(tokenType: string): SymbolKind {
    switch (tokenType) {
      case 'method':
        return SymbolKind.Method;
      case 'function':
        return SymbolKind.Function;
      case 'variable':
        return SymbolKind.Variable;
      case 'enumMember':
        return SymbolKind.EnumMember;
      case 'enum':
        return SymbolKind.Enum;
      case 'label':
        return SymbolKind.Field;
      case 'struct':
        return SymbolKind.Struct;
      case 'type':
        return SymbolKind.TypeParameter;
      case 'namespace':
        return SymbolKind.Namespace;
      case 'class':
        return SymbolKind.Class;
      case 'property':
        return SymbolKind.Property;
      default:
        return SymbolKind.Variable;
    }
  }
}
