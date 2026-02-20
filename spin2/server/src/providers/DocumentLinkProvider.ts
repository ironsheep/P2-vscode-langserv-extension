'use strict';
// src/providers/DocumentLinkProvider.ts

import * as lsp from 'vscode-languageserver';
import { Provider } from '.';
import { Context } from '../context';
import { DocumentLink } from 'vscode-languageserver-types';
import { DocumentFindings } from '../parser/spin.semantic.findings';
import { fileSpecFromURI } from '../parser/lang.utils';
import { resolveReferencedIncludes } from '../files';
import { IncludeDiscovery } from '../includeDiscovery';
import { pathToFileURL } from 'url';

export default class DocumentLinkProvider implements Provider {
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private includeDiscovery: IncludeDiscovery;

  constructor(protected readonly ctx: Context) {
    this.includeDiscovery = new IncludeDiscovery(ctx);
  }

  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled) {
      this.ctx.logger.log(message);
    }
  }

  async handleDocumentLinks(params: lsp.DocumentLinkParams): Promise<DocumentLink[]> {
    const docFSpec: string = fileSpecFromURI(params.textDocument.uri);
    const processed = this.ctx.docsByFSpec.get(docFSpec);
    if (!processed) {
      return [];
    }
    const documentFindings: DocumentFindings | undefined = processed.parseResult;
    if (!documentFindings) {
      return [];
    }

    const docLinks = documentFindings.getDocumentLinks();
    if (docLinks.length === 0) {
      return [];
    }

    const docFolder = processed.folder;
    const additionalDirs: string[] = this.includeDiscovery.getIncludeDirsForFolder(docFolder);

    this._logMessage(`+ DocLink: ${docLinks.length} links in [${docFSpec}], folder=[${docFolder}], additionalDirs=[${additionalDirs}]`);

    const results: DocumentLink[] = [];
    for (const linkInfo of docLinks) {
      // Resolve the target filename to an absolute path
      const resolvedPaths = resolveReferencedIncludes([linkInfo.targetFilename], docFolder, this.ctx, additionalDirs);
      if (resolvedPaths.length > 0) {
        const targetUri = pathToFileURL(resolvedPaths[0]).toString();
        this._logMessage(`+ DocLink: [${linkInfo.targetFilename}] -> [${targetUri}]`);
        results.push({
          range: {
            start: { line: linkInfo.line, character: linkInfo.startCharacter },
            end: { line: linkInfo.line, character: linkInfo.endCharacter }
          },
          target: targetUri
        });
      } else {
        this._logMessage(`+ DocLink: [${linkInfo.targetFilename}] could not be resolved`);
      }
    }

    this._logMessage(`+ DocLink: returning ${results.length} links`);
    return results;
  }

  register(connection: lsp.Connection) {
    connection.onDocumentLinks(this.handleDocumentLinks.bind(this));
    return {
      documentLinkProvider: { resolveProvider: false }
    };
  }
}
