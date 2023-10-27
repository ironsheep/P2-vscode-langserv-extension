"use strict";
// src/server.ts

/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  InitializeResult,
  ServerCapabilities,
  FileChangeType,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import registerProviders from "./providers";
import { createContext } from "./context";

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize(async (params: InitializeParams) => {
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);
  hasWorkspaceFolderCapability = !!(capabilities.workspace && !!capabilities.workspace.workspaceFolders);
  hasDiagnosticRelatedInformationCapability = !!(capabilities.textDocument && capabilities.textDocument.publishDiagnostics && capabilities.textDocument.publishDiagnostics.relatedInformation);

  const ctx = await createContext(params.workspaceFolders ?? [], connection.console, connection);

  const registrations: ServerCapabilities = registerProviders(connection, ctx, params.capabilities);
  const result: InitializeResult = {
    capabilities: registrations,
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  connection.console.log(`CL-TRC: onInitialize() Workspace folders [${JSON.stringify(params.workspaceFolders)}]`);
  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log(`CL-TRC: onInitialized() Workspace folder change event [${_event}] received.`);
    });
  }
});

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VSCode
  connection.console.log(`CL-TRC: onDidChangeWatchedFiles() We received an file change event _change=[${JSON.stringify(_change)}]`);
  for (let index = 0; index < _change.changes.length; index++) {
    const change = _change.changes[index];
    switch (change.type) {
      case FileChangeType.Changed:
        // dont care
        break;
      case FileChangeType.Created:
        // casue eparse open files
        break;
      case FileChangeType.Deleted:
        // cause reparse open files
        break;
    }
  }
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
