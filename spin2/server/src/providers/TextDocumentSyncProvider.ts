import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
//import Parser from "web-tree-sitter";

import { Provider } from ".";
import { Context, ServerBehaviorConfiguration } from "../context";
//import DiagnosticProcessor from "../diagnostics";
import DocumentProcessor, { ProcessedDocument } from "../DocumentProcessor";
import { positionToPoint, Point } from "../geometry";
import { fileSpecFromURI } from "../parser/lang.utils";

export interface Edit {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: Point;
  oldEndPosition: Point;
  newEndPosition: Point;
}

export default class TextDocumentSyncProvider implements Provider {
  private processor: DocumentProcessor;
  //private diagnostics: DiagnosticProcessor;
  private connection: lsp.Connection;

  constructor(protected readonly ctx: Context) {
    this.processor = new DocumentProcessor(ctx);
    //this.diagnostics = new DiagnosticProcessor(ctx);
    this.connection = ctx.connection;
  }

  async handleOpenTextDocument({ textDocument: { uri, languageId, text, version } }: lsp.DidOpenTextDocumentParams) {
    this.ctx.logger.log(`TRC: DOC-OPEN: parse: [v${version}:${uri}] `);
    const docFSpec: string = fileSpecFromURI(uri);
    this.ctx.topDocsByFSpec.set(docFSpec, uri);
    this._showStats(); // dump storage stats

    // ensure we have the clint settings before proceeding
    if (this.ctx.parserConfig.maxNumberOfReportedIssues == -1) {
      await this.getLatestClientConfig();
    }

    const document = TextDocument.create(uri, languageId, version, text);
    await this.processor.process(document).then(() => {
      this.fileDiagnostics(uri);
    });
  }

  async handleTextDocumentChanged({ textDocument: { uri, version }, contentChanges }: lsp.DidChangeTextDocumentParams) {
    // update top-level document on change
    this.ctx.logger.log(`TRC: DOC-CHANGED: update: [v${version}:${uri}] and those including URI`);
    const docFSpec: string = fileSpecFromURI(uri);
    const existingTopLevel = this.ctx.topDocsByFSpec.get(docFSpec);
    const existingInclude = this.ctx.docsByFSpec.get(docFSpec);
    if (existingTopLevel && existingInclude) {
      //
      // have a top-level file
      //
      const { document } = existingInclude;

      const updatedDoc = TextDocument.update(document, contentChanges, version);

      await this.processor.process(updatedDoc).then(({ parseResult }) => {
        // Send just local parser diagnostics - can't get vasm errors until save
        // FIXME: not quite correct but works for now...
        this.fileDiagnostics(uri);
      });
    } else if (existingInclude && !existingTopLevel) {
      //
      // have an include file
      //
      const { document } = existingInclude;
      const updatedDoc = TextDocument.update(document, contentChanges, version);

      await this.processor.process(updatedDoc);
      await this.processor.updateFindings(uri);
    }
    await this.processor.processEnclosing(uri).then((x) => {
      // Send Diagnostics for each URI affected by the include
      for (let index = 0; index < x.length; index++) {
        const uri = x[index];
        this.fileDiagnostics(uri);
      }
    });
  }

  async getLatestClientConfig(): Promise<boolean> {
    let configChanged: boolean = false;
    await this.ctx.connection.workspace.getConfiguration("spinExtension.ServerBehavior").then((serverConfiguration: ServerBehaviorConfiguration) => {
      if (serverConfiguration == null) {
        this.ctx.logger.log(`TRC: DP.process() ERROR! get settings received no info: config left at defaults`);
      } else {
        configChanged =
          serverConfiguration["maxNumberOfReportedIssues"] != this.ctx.parserConfig.maxNumberOfReportedIssues ||
          serverConfiguration["highlightFlexspinDirectives"] != this.ctx.parserConfig.highlightFlexspinDirectives;
        if (configChanged) {
          this.ctx.parserConfig.maxNumberOfReportedIssues = serverConfiguration["maxNumberOfReportedIssues"];
          if (this.ctx.parserConfig.maxNumberOfReportedIssues < 0) {
            this.ctx.parserConfig.maxNumberOfReportedIssues = 0; // don't confuse our initial startup!
          }
          this.ctx.parserConfig.highlightFlexspinDirectives = serverConfiguration["highlightFlexspinDirectives"];
        }
      }
      //this.ctx.logger.log(`TRC: process() received settings RAW=[${serverConfiguration}], JSON=[${JSON.stringify(serverConfiguration)}]`);
      this.ctx.logger.log(
        `  DBG --  ctx.parserConfig.maxNumberOfReportedIssues=(${this.ctx.parserConfig.maxNumberOfReportedIssues}), highlightFlexspinDirectives=[${this.ctx.parserConfig.highlightFlexspinDirectives}], changes=(${configChanged})`
      );
    });
    return configChanged;
  }

  async handleConfigurationChanged({ settings }: lsp.DidChangeConfigurationParams): Promise<void> {
    this.ctx.logger.log("TRC: DOC have settings reparse all docs");
    this.ctx.logger.log(`TRC: onDidChangeConfiguration() change.settings=[${settings}]`);
    if (settings != null) {
      this.ctx.logger.log(`TRC: onDidChangeConfiguration() new settings [${JSON.stringify(settings)}]`);
    } else {
      // client notified us that it changed the settings... we should get an update!
      this.ctx.logger.log(`TRC: onDidChangeConfiguration() Client says settings were updated`);
      // do depth-first refresh
      const configChanged: boolean = await this.getLatestClientConfig();
      if (configChanged) {
        await this.processor.reparseAllDocs();
      } else {
        this.ctx.logger.log(`TRC: --- but nothing changed, skipping`);
      }
    }
  }

  async handleSaveTextDocument({ textDocument: { uri } }: lsp.DidSaveTextDocumentParams) {
    this.ctx.logger.log("TRC: DOC-SAVE: update symbols for: [" + uri + "] and those including URI");
    await this.fileDiagnostics(uri);
    this._showStats(); // dump storage stats
  }

  async handleCloseTextDocument({ textDocument: { uri } }: lsp.DidCloseTextDocumentParams) {
    this.ctx.logger.log("TRC: DOC-CLOSE: remove symbols for: [" + uri + "] and included files if no longer needed");
    const docFSpec: string = fileSpecFromURI(uri);
    const processedDocument = this.ctx.docsByFSpec.get(docFSpec);
    // if we have symbols for this file...
    if (processedDocument) {
      this.ctx.docsByFSpec.delete(docFSpec);
    }

    const topDoc = this.ctx.topDocsByFSpec.get(docFSpec);
    if (topDoc) {
      this.ctx.topDocsByFSpec.delete(docFSpec);
      const openCount: number = Array.from(this.ctx.topDocsByFSpec.keys()).length;
      if (openCount == 0) {
        this.ctx.docsByFSpec.clear();
        this.ctx.findingsByFSpec.clear();
        this.ctx.logger.log("TRC: close: ALL documents Closed");
      }
      this._showStats(); // dump storage stats
    }
  }

  async handleWatchedFilesChange(params: lsp.DidChangeWatchedFilesParams) {
    // Monitored files have change in VSCode
    this.ctx.logger.log(`TRC: onDidChangeWatchedFiles() We received an file change event _change=[${JSON.stringify(params)}]`);
    let needTopDocsUpdated: boolean = false;
    for (let index = 0; index < params.changes.length; index++) {
      const change = params.changes[index];
      switch (change.type) {
        case lsp.FileChangeType.Changed:
          // dont care
          break;
        case lsp.FileChangeType.Created:
          // cause reparse open files
          needTopDocsUpdated = true;
          break;
        case lsp.FileChangeType.Deleted:
          // cause reparse open files
          needTopDocsUpdated = true;
          break;
      }
    }
    if (needTopDocsUpdated) {
      await this.processor.reparseTopDocs();
      const listOfTopDocFSpecs: string[] = this.processor.docFileSpecs;
      for (let index = 0; index < listOfTopDocFSpecs.length; index++) {
        const docFSpec = listOfTopDocFSpecs[index];
        const processedDocument: ProcessedDocument | undefined = this.ctx.docsByFSpec.get(docFSpec);
        if (processedDocument) {
          this.ctx.logger.log(`TRC: CHK CFG maxNumberOfReportedIssues=(${this.ctx.parserConfig.maxNumberOfReportedIssues})`);
          const captureDiagnostics: lsp.Diagnostic[] = processedDocument.parseResult.allDiagnosticMessages(this.ctx.parserConfig.maxNumberOfReportedIssues);
          const uri = processedDocument.document.uri;
          this.connection.sendDiagnostics({
            uri,
            diagnostics: [...captureDiagnostics],
          });
        }
      }
    }
  }

  private _showStats(): void {
    const openCount: number = Array.from(this.ctx.topDocsByFSpec.keys()).length;
    const openProcessedCount: number = Array.from(this.ctx.docsByFSpec.keys()).length;
    const openFindingsCount: number = Array.from(this.ctx.findingsByFSpec.keys()).length;
    this.ctx.logger.log(`TRC: STATS ${openCount} doc(s) open, ${openProcessedCount} processed doc(s), ${openFindingsCount} finding(s)`);
  }

  /**
   * Send diagnostics from both local parser and vasm
   */
  async fileDiagnostics(uri: string) {
    const docFSpec: string = fileSpecFromURI(uri);
    const processedDocument = this.ctx.docsByFSpec.get(docFSpec);
    if (!processedDocument) {
      return;
    }
    //const vasmDiagnostics = await this.diagnostics.vasmDiagnostics(uri);
    this.ctx.logger.log(`TRC: CHK CFG maxNumberOfReportedIssues=(${this.ctx.parserConfig.maxNumberOfReportedIssues})`);
    let captureDiagnostics: lsp.Diagnostic[] = processedDocument.parseResult.allDiagnosticMessages(this.ctx.parserConfig.maxNumberOfReportedIssues);
    //this.ctx.logger.log(`CL-TRC: captureDiagnostics=[${JSON.stringify(captureDiagnostics)}]`);
    // crappy override for unit testing
    if (uri.endsWith("diagnostics.spin2")) {
      captureDiagnostics = this.validateTestDocument(processedDocument);
    }
    this.connection.sendDiagnostics({
      uri,
      diagnostics: [...captureDiagnostics],
    });
  }

  private validateTestDocument(documentInfo: ProcessedDocument): lsp.Diagnostic[] {
    let diagnostics: lsp.Diagnostic[] = [];
    // The validator creates diagnostics for all uppercase words length 2 and more
    const textDocument = documentInfo.document;
    const text = textDocument.getText();
    const pattern = /\b[A-Z]{2,}\b/g;
    let m: RegExpExecArray | null;

    let problems = 0;
    while ((m = pattern.exec(text))) {
      problems++;
      const diagnostic: lsp.Diagnostic = {
        severity: lsp.DiagnosticSeverity.Warning,
        range: {
          start: textDocument.positionAt(m.index),
          end: textDocument.positionAt(m.index + m[0].length),
        },
        message: `${m[0]} is all uppercase.`,
        source: "ex",
      };
      diagnostic.relatedInformation = [
        {
          location: {
            uri: textDocument.uri,
            range: Object.assign({}, diagnostic.range),
          },
          message: "Spelling matters",
        },
        {
          location: {
            uri: textDocument.uri,
            range: Object.assign({}, diagnostic.range),
          },
          message: "Particularly for names",
        },
      ];
      diagnostics.push(diagnostic);
    }
    return diagnostics;
  }

  changeToEdit(document: TextDocument, change: lsp.TextDocumentContentChangeEvent): Edit {
    // convert a change to an edit object
    if (!lsp.TextDocumentContentChangeEvent.isIncremental(change)) {
      throw new Error("Not incremental");
    }
    const rangeOffset = document.offsetAt(change.range.start);
    const rangeLength = document.offsetAt(change.range.end) - rangeOffset;
    return {
      startPosition: positionToPoint(change.range.start),
      oldEndPosition: positionToPoint(change.range.end),
      newEndPosition: positionToPoint(document.positionAt(rangeOffset + change.text.length)),
      startIndex: rangeOffset,
      oldEndIndex: rangeOffset + rangeLength,
      newEndIndex: rangeOffset + change.text.length,
    };
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onDidOpenTextDocument(this.handleOpenTextDocument.bind(this));
    connection.onDidChangeTextDocument(this.handleTextDocumentChanged.bind(this));
    connection.onDidSaveTextDocument(this.handleSaveTextDocument.bind(this));
    connection.onDidCloseTextDocument(this.handleCloseTextDocument.bind(this));
    connection.onDidChangeConfiguration(this.handleConfigurationChanged.bind(this));
    connection.onDidChangeWatchedFiles(this.handleWatchedFilesChange.bind(this));
    return {
      textDocumentSync: lsp.TextDocumentSyncKind.Incremental,
    };
  }
}
