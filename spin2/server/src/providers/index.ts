'use strict';
// src/providers/index.ts

import { ClientCapabilities, Connection, ServerCapabilities } from 'vscode-languageserver';
import { Context } from '../context';

//import CompletionProvider from "./CompletionProvider";
import SemanticTokensProvider from './SemanticTokensProvider';
// import ConfiguratonProvider from "./ConfigurationProvider";
import DefinitionProvider from './DefinitionProvider';
// import DocumentFormattingProvider from "./DocumentFormatttingProvider";
import DocumentHighlightProvider from './DocumentHighlightProvider';
import DocumentLinkProvider from './DocumentLinkProvider';
import DocumentSymbolProvider from './DocumentSymbolProvider';
// import FileOperationsProvider from "./FileOperationsProvider";
import FoldingRangeProvider from './FoldingRangeProvider';
import HoverProvider from './HoverProvider';
import ReferencesProvider from './ReferencesProvider';
import RenameProvider from './RenameProvider';
import SignatureHelpProvider from './SignatureHelpProvider';
import TextDocumentSyncProvider from './TextDocumentSyncProvider';
import ObjectDependencyProvider from './ObjectDependencyProvider';
import WorkspaceSymbolProvider from './WorkspaceSymbolProvider';
import TypeDefinitionProvider from './TypeDefinitionProvider';

export interface Provider {
  register(connection: Connection, clientCapabilities: ClientCapabilities): ServerCapabilities;
}
const providers = [
  //CompletionProvider,
  SemanticTokensProvider,
  //   ConfiguratonProvider,
  DefinitionProvider,
  //   DocumentFormattingProvider,
  DocumentHighlightProvider,
  DocumentLinkProvider,
  DocumentSymbolProvider,
  //   FileOperationsProvider,
  FoldingRangeProvider,
  HoverProvider,
  ReferencesProvider,
  RenameProvider,
  SignatureHelpProvider,
  TextDocumentSyncProvider,
  ObjectDependencyProvider,
  WorkspaceSymbolProvider,
  TypeDefinitionProvider
];

export default function registerProviders(
  connection: Connection,
  ctx: Context,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  clientCapabilities: ClientCapabilities
): ServerCapabilities {
  return providers.reduce((acc, P) => {
    const p = new P(ctx);
    const c = p.register(connection);
    return Object.assign(acc, c);
  }, {});
}
