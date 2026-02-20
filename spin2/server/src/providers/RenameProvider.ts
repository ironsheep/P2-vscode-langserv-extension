'use strict';
// src/providers/RenameProvider.ts

import * as lsp from 'vscode-languageserver';
import { Provider } from '.';
import { Context } from '../context';
import { Location, WorkspaceEdit, TextEdit } from 'vscode-languageserver-types';
import { DocumentFindings, ITokenReference } from '../parser/spin.semantic.findings';
import { fileSpecFromURI, isSpin1File } from '../parser/lang.utils';
import { ExtensionUtils } from '../parser/spin.extension.utils';
import { DocumentLineAt } from '../parser/lsp.textDocument.utils';
import { FindingsAtPostion } from './DefinitionProvider';
import * as path from 'path';

export default class RenameProvider implements Provider {
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private extensionUtils: ExtensionUtils;

  constructor(protected readonly ctx: Context) {
    this.extensionUtils = new ExtensionUtils(ctx, this.isDebugLogEnabled);
  }

  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled) {
      this.ctx.logger.log(message);
    }
  }

  async handlePrepareRename(params: lsp.PrepareRenameParams): Promise<lsp.Range | null> {
    const docFSpec: string = fileSpecFromURI(params.textDocument.uri);
    const processed = this.ctx.docsByFSpec.get(docFSpec);
    if (!processed) {
      return null;
    }
    const documentFindings: DocumentFindings | undefined = processed.parseResult;
    if (!documentFindings) {
      return null;
    }
    documentFindings.enableLogging(this.ctx, this.isDebugLogEnabled);

    const isPositionInBlockComment: boolean = documentFindings.isLineInBlockComment(params.position.line);
    const inPasmCodeStatus: boolean = documentFindings.isLineInPasmCode(params.position.line);
    const adjustedPos = this.extensionUtils.adjustWordPosition(
      processed.document,
      params.position,
      params.position,
      isPositionInBlockComment,
      inPasmCodeStatus
    );
    if (!adjustedPos[0]) {
      return null; // in comment, string, number, or keyword
    }

    const wordUnderCursor: string = adjustedPos[2];

    // Reject PASM local labels (start with . or :) — not safe to rename
    if (wordUnderCursor.startsWith('.') || wordUnderCursor.startsWith(':')) {
      return null;
    }

    // Reject if we have no references for this token (e.g., built-in names)
    if (!documentFindings.hasTokenReferences(wordUnderCursor)) {
      return null;
    }

    // Find the reference at cursor position to get its range
    const refs = documentFindings.getReferencesForToken(wordUnderCursor);
    const cursorRef = refs.find(
      (r) =>
        r.line === params.position.line &&
        r.startCharacter <= params.position.character &&
        r.startCharacter + r.length >= params.position.character
    );
    if (cursorRef) {
      return {
        start: { line: cursorRef.line, character: cursorRef.startCharacter },
        end: { line: cursorRef.line, character: cursorRef.startCharacter + cursorRef.length }
      };
    }

    // Fallback: return a reasonable range
    return {
      start: { line: params.position.line, character: params.position.character - wordUnderCursor.length },
      end: { line: params.position.line, character: params.position.character }
    };
  }

  async handleRename(params: lsp.RenameParams): Promise<WorkspaceEdit | null> {
    const docFSpec: string = fileSpecFromURI(params.textDocument.uri);
    const processed = this.ctx.docsByFSpec.get(docFSpec);
    if (!processed) {
      return null;
    }
    const documentFindings: DocumentFindings | undefined = processed.parseResult;
    if (!documentFindings) {
      return null;
    }
    documentFindings.enableLogging(this.ctx, this.isDebugLogEnabled);

    const symbolIdent: FindingsAtPostion | undefined = this._symbolAtLocation(processed.document, params.position, documentFindings);
    if (!symbolIdent) {
      return null;
    }

    const tokenName = symbolIdent.selectedWord;
    const newName = params.newName;

    this._logMessage(`+ Rename: tokenName=[${tokenName}] -> newName=[${newName}]`);

    // Check if this is a local-scope symbol
    const currentFileRefs = documentFindings.getReferencesForToken(tokenName);
    const hasGlobalScope = currentFileRefs.some((r) => r.scope === '');

    const changes: { [uri: string]: TextEdit[] } = {};

    if (hasGlobalScope) {
      // Global symbol — rename across all qualifying files
      for (const [fSpec, processedDoc] of this.ctx.docsByFSpec) {
        const findings = processedDoc.parseResult;
        if (!findings) {
          continue;
        }

        // Ownership filtering
        if (!this._isOwnedFile(fSpec)) {
          this._logMessage(`+ Rename: skipping [${fSpec}] (not owned)`);
          continue;
        }

        const refs = findings.getReferencesForToken(tokenName);
        if (refs.length > 0) {
          const edits: TextEdit[] = refs.map((ref) => ({
            range: {
              start: { line: ref.line, character: ref.startCharacter },
              end: { line: ref.line, character: ref.startCharacter + ref.length }
            },
            newText: newName
          }));
          changes[processedDoc.document.uri] = edits;
        }
      }
    } else {
      // Local symbol — rename only within the same method scope in current file
      const currentMethod = documentFindings.getMethodNameForLine(params.position.line) || '';
      const refs = documentFindings.getReferencesForToken(tokenName, currentMethod);
      if (refs.length > 0) {
        const edits: TextEdit[] = refs.map((ref) => ({
          range: {
            start: { line: ref.line, character: ref.startCharacter },
            end: { line: ref.line, character: ref.startCharacter + ref.length }
          },
          newText: newName
        }));
        changes[processed.document.uri] = edits;
      }
    }

    this._logMessage(`+ Rename: ${Object.keys(changes).length} files affected`);
    return { changes };
  }

  register(connection: lsp.Connection) {
    connection.onPrepareRename(this.handlePrepareRename.bind(this));
    connection.onRenameRequest(this.handleRename.bind(this));
    return {
      renameProvider: { prepareProvider: true }
    };
  }

  private _isOwnedFile(fSpec: string): boolean {
    const basename = path.basename(fSpec);

    // Exclude files in central library paths
    for (const libPath of this.ctx.parserConfig.centralLibraryPaths) {
      if (fSpec.startsWith(libPath)) {
        this._logMessage(`+ Rename: [${basename}] excluded (in central library)`);
        return false;
      }
    }

    // If author file prefix is set, exclude files with a different prefix
    const authorPrefix = this.ctx.parserConfig.authorFilePrefix;
    if (authorPrefix.length > 0) {
      // Files that have an underscore-based prefix pattern but don't match ours
      const underscoreIdx = basename.indexOf('_');
      if (underscoreIdx > 0) {
        const filePrefix = basename.substring(0, underscoreIdx + 1);
        if (filePrefix.toLowerCase() !== authorPrefix.toLowerCase()) {
          this._logMessage(`+ Rename: [${basename}] excluded (different author prefix: ${filePrefix} vs ${authorPrefix})`);
          return false;
        }
      }
    }

    return true;
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
    // Reject PASM local labels
    if (wordUnderCursor.startsWith('.') || wordUnderCursor.startsWith(':')) {
      return undefined;
    }
    const sourcePosition: lsp.Position = adjustedPos[3];
    return {
      position: sourcePosition,
      objectReference: adjustedPos[1],
      selectedWord: wordUnderCursor
    };
  }
}
