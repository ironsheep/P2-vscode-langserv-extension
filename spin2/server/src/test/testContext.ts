'use strict';
// server/src/test/testContext.ts
//
// Provides a stub Context for server-side integration tests.
// The mock connection and logger are no-ops so tests can run
// the real parsers without launching VS Code or an LSP connection.

import { Context, ServerBehaviorConfiguration, EditorConfiguration } from '../context';
import { ProcessedDocumentByFSpec, DocumentFindingsByFSpec, TopDocsByFSpec } from '../DocumentProcessor';

// Minimal mock that satisfies the lsp.Connection interface used by our codebase.
// Only connection.console.log/warn/error and connection.sendRequest are called.
function createMockConnection(): any {
  const noOp = () => {};
  return {
    console: {
      log: noOp,
      warn: noOp,
      error: noOp,
      info: noOp
    },
    sendRequest: () => Promise.resolve(),
    sendNotification: noOp,
    onRequest: noOp,
    onNotification: noOp,
    onInitialize: noOp,
    onInitialized: noOp,
    onShutdown: noOp,
    onExit: noOp,
    onDidOpenTextDocument: noOp,
    onDidChangeTextDocument: noOp,
    onDidCloseTextDocument: noOp,
    onDefinition: noOp,
    onReferences: noOp,
    onDocumentHighlight: noOp,
    onDocumentLinks: noOp,
    onWorkspaceSymbol: noOp,
    onRenameRequest: noOp,
    onPrepareRename: noOp,
    onTypeDefinition: noOp,
    listen: noOp
  };
}

function createMockLogger(): any {
  const noOp = () => {};
  return {
    log: noOp,
    warn: noOp,
    error: noOp,
    info: noOp
  };
}

export function createTestContext(overrides?: Partial<Context>): Context {
  const defaults: Context = {
    topDocsByFSpec: new Map() as TopDocsByFSpec,
    docsByFSpec: new Map() as ProcessedDocumentByFSpec,
    findingsByFSpec: new Map() as DocumentFindingsByFSpec,
    workspaceFolders: [],
    language: 'spin2',
    logger: createMockLogger(),
    connection: createMockConnection(),
    parserConfig: new ServerBehaviorConfiguration(),
    editorConfig: new EditorConfiguration()
  };
  return { ...defaults, ...overrides };
}
