'use strict';
// src/providers/DocumentHighlightProvider.ts

import * as lsp from 'vscode-languageserver';
import { Provider } from '.';
import { Context } from '../context';
import { DocumentHighlight, DocumentHighlightKind } from 'vscode-languageserver-types';
import { DocumentFindings } from '../parser/spin.semantic.findings';
import { fileSpecFromURI } from '../parser/lang.utils';
import { ExtensionUtils } from '../parser/spin.extension.utils';
import { DocumentLineAt } from '../parser/lsp.textDocument.utils';
import { FindingsAtPostion } from './DefinitionProvider';

export default class DocumentHighlightProvider implements Provider {
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private bLogStarted: boolean = false;
  private extensionUtils: ExtensionUtils;

  constructor(protected readonly ctx: Context) {
    this.extensionUtils = new ExtensionUtils(ctx, this.isDebugLogEnabled);
    if (this.isDebugLogEnabled) {
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        this._logMessage('Spin DocumentHighlight log started.');
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

  async handleDocumentHighlight(params: lsp.DocumentHighlightParams): Promise<DocumentHighlight[]> {
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
    this._logMessage(`+ Highlight: tokenName=[${tokenName}]`);

    // Get all references for this token in the current file only
    const refs = documentFindings.getReferencesForToken(tokenName);
    const highlights: DocumentHighlight[] = [];

    for (const ref of refs) {
      highlights.push({
        range: {
          start: { line: ref.line, character: ref.startCharacter },
          end: { line: ref.line, character: ref.startCharacter + ref.length }
        },
        kind: DocumentHighlightKind.Text
      });
    }

    this._logMessage(`+ Highlight: returning ${highlights.length} highlights`);
    return highlights;
  }

  register(connection: lsp.Connection) {
    connection.onDocumentHighlight(this.handleDocumentHighlight.bind(this));
    return {
      documentHighlightProvider: true
    };
  }

  private _symbolAtLocation(
    document: lsp.TextDocument,
    position: lsp.Position,
    symbolsFound: DocumentFindings
  ): FindingsAtPostion | undefined {
    const isPositionInBlockComment: boolean = symbolsFound.isLineInBlockComment(position.line);
    const inPasmCodeStatus: boolean = symbolsFound.isLineInPasmCode(position.line);
    const adjustedPos = this.extensionUtils.adjustWordPosition(document, position, position, isPositionInBlockComment, inPasmCodeStatus);
    if (!adjustedPos[0]) {
      return undefined;
    }
    const wordUnderCursor: string = adjustedPos[2];
    const sourcePosition: lsp.Position = adjustedPos[3];
    return {
      position: sourcePosition,
      objectReference: '',
      selectedWord: wordUnderCursor
    };
  }
}
