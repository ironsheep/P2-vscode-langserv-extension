'use strict';
// src/DocumentSymbolProvider.ts

import * as lsp from 'vscode-languageserver/node';
import { Provider } from '.';
import { Context } from '../context';
import { DocumentFindings, OutLineSymbol } from '../parser/spin.semantic.findings';
import { fileSpecFromURI } from '../parser/lang.utils';

export default class DocumentSymbolProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  async handleGetDocumentSymbols({ textDocument }: lsp.DocumentSymbolParams): Promise<lsp.DocumentSymbol[]> {
    const docFSpec: string = fileSpecFromURI(textDocument.uri);
    const documentFindings: DocumentFindings | undefined = this.ctx.docsByFSpec.get(docFSpec)?.parseResult;
    if (!documentFindings) {
      return [];
    }

    const results: lsp.DocumentSymbol[] = [];

    // get outline symbols from findiings
    //  format them as DocumentSymbols keeping the children hierarchy and return the new set to caller
    const outlineSymbols: OutLineSymbol[] = documentFindings.getOutlineSymbols();
    if (outlineSymbols.length > 0) {
      for (let symblIdx = 0; symblIdx < outlineSymbols.length; symblIdx++) {
        const currSymbol = outlineSymbols[symblIdx];
        const newLspSymbol: lsp.DocumentSymbol = {
          name: currSymbol.label,
          detail: currSymbol.description,
          kind: currSymbol.kind(),
          range: currSymbol.location(),
          selectionRange: currSymbol.location()
        };

        const childOutlineSymbols: OutLineSymbol[] = currSymbol.children();
        if (childOutlineSymbols.length > 0) {
          for (let childSymblIdx = 0; childSymblIdx < childOutlineSymbols.length; childSymblIdx++) {
            const currChildSymbol = childOutlineSymbols[childSymblIdx];
            const newChildLspSymbol: lsp.DocumentSymbol = {
              name: currChildSymbol.label,
              detail: currChildSymbol.description,
              kind: currChildSymbol.kind(),
              range: currChildSymbol.location(),
              selectionRange: currChildSymbol.location()
            };
            if (newLspSymbol.children == undefined) {
              newLspSymbol.children = [];
            }
            newLspSymbol.children.push(newChildLspSymbol);
          }
        }
        results.push(newLspSymbol);
      }
    }

    return results;
  }

  register(connection: lsp.Connection) {
    connection.onDocumentSymbol(this.handleGetDocumentSymbols.bind(this));
    return {
      documentSymbolProvider: true
    };
  }
}
