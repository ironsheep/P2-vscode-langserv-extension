'use strict';
// src/providers/TypeDefinitionProvider.ts

import * as lsp from 'vscode-languageserver';
import { Provider } from '.';
import { Context } from '../context';
import { Location } from 'vscode-languageserver-types';
import { DocumentFindings } from '../parser/spin.semantic.findings';
import { fileSpecFromURI, isSpin1File } from '../parser/lang.utils';
import { ExtensionUtils } from '../parser/spin.extension.utils';
import { DocumentLineAt } from '../parser/lsp.textDocument.utils';

export default class TypeDefinitionProvider implements Provider {
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

  async handleTypeDefinition(params: lsp.TypeDefinitionParams): Promise<Location | null> {
    const docFSpec: string = fileSpecFromURI(params.textDocument.uri);
    const processed = this.ctx.docsByFSpec.get(docFSpec);
    if (!processed) {
      return null;
    }

    // Spin2 only — STRUCT is not supported in Spin1
    if (isSpin1File(processed.document.uri)) {
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
      return null;
    }

    const wordUnderCursor: string = adjustedPos[2];
    this._logMessage(`+ TypeDef: wordUnderCursor=[${wordUnderCursor}]`);

    // Check if cursor is on a struct instance — try global first, then local
    let structTypeName: string | undefined = documentFindings.getTypeForStructureInstance(wordUnderCursor);
    if (!structTypeName) {
      structTypeName = documentFindings.getTypeForLocalStructureInstance(wordUnderCursor, params.position.line);
    }

    if (!structTypeName) {
      this._logMessage(`+ TypeDef: [${wordUnderCursor}] is not a struct instance`);
      return null;
    }

    this._logMessage(`+ TypeDef: structTypeName=[${structTypeName}]`);

    // Handle cross-object struct types (e.g., "object.struct_t")
    if (structTypeName.includes('.')) {
      return this._resolveExternalStructType(structTypeName, documentFindings);
    }

    // Resolve local struct definition
    const structDef = documentFindings.getStructure(structTypeName);
    if (!structDef) {
      this._logMessage(`+ TypeDef: struct definition for [${structTypeName}] not found`);
      return null;
    }

    return {
      uri: processed.document.uri,
      range: {
        start: { line: structDef.lineIndex, character: structDef.charOffset },
        end: { line: structDef.lineIndex, character: structDef.charOffset + structTypeName.length }
      }
    };
  }

  register(connection: lsp.Connection) {
    connection.onTypeDefinition(this.handleTypeDefinition.bind(this));
    return {
      typeDefinitionProvider: true
    };
  }

  private _resolveExternalStructType(qualifiedName: string, currentFindings: DocumentFindings): Location | null {
    const parts = qualifiedName.split('.');
    if (parts.length !== 2) {
      return null;
    }
    const objectName = parts[0];
    const structName = parts[1];

    const childFindings = currentFindings.getFindingsForNamespace(objectName);
    if (!childFindings) {
      this._logMessage(`+ TypeDef: no findings for namespace [${objectName}]`);
      return null;
    }

    const structDef = childFindings.getStructure(structName);
    if (!structDef) {
      this._logMessage(`+ TypeDef: struct [${structName}] not found in [${objectName}]`);
      return null;
    }

    const childUri = childFindings.uri;
    if (!childUri) {
      return null;
    }

    return {
      uri: childUri,
      range: {
        start: { line: structDef.lineIndex, character: structDef.charOffset },
        end: { line: structDef.lineIndex, character: structDef.charOffset + structName.length }
      }
    };
  }
}
