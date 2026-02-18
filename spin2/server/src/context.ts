'use strict';
// src/context.ts

import * as lsp from 'vscode-languageserver';
import { ProcessedDocumentByFSpec, DocumentFindingsByFSpec, TopDocsByFSpec } from './DocumentProcessor';

//import Parser from "web-tree-sitter";
//import path from "path";
//import * as path from "path";
// ----------------------------------------------------------------------------
//  client-side configuration details
//   CLASS ServerBehaviorConfiguration
//
// Per-folder include directory entry
export interface ILocalIncludeEntry {
  auto: boolean;
  dirs: string[];
}

// Map of relative folder path -> include entry
export type LocalIncludesByFolder = { [folderPath: string]: ILocalIncludeEntry };

export class ServerBehaviorConfiguration {
  public maxNumberOfReportedIssues: number = -1; // NOT SET
  public highlightFlexspinDirectives: boolean = false;
  public centralLibraryPaths: string[] = [];
  public localIncludes: LocalIncludesByFolder = {};
}

export class EditorConfiguration {
  public tabSize: number = 4;
  public insertSpaces: boolean = true;
}

export interface Context {
  topDocsByFSpec: TopDocsByFSpec;
  docsByFSpec: ProcessedDocumentByFSpec;
  findingsByFSpec: DocumentFindingsByFSpec;
  workspaceFolders: lsp.WorkspaceFolder[];
  language: string;
  logger: lsp.Logger;
  connection: lsp.Connection;
  parserConfig: ServerBehaviorConfiguration;
  editorConfig: EditorConfiguration;
}

const language: string = 'spin2';

export async function createContext(workspaceFolders: lsp.WorkspaceFolder[], logger: lsp.Logger, connection: lsp.Connection): Promise<Context> {
  /*
  if (!language) {
    // Workaround for web-tree-sitter node 18 compatibility issue:
    // https://github.com/tree-sitter/tree-sitter/issues/1765#issuecomment-1271790298
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      delete WebAssembly.instantiateStreaming;
    } catch {
      // ¯\_(ツ)_/¯
	}

    //await Parser.init();
    //language = await Parser.Language.load(path.join(__dirname, "..", "wasm", "tree-sitter-m68k.wasm"));
  }
  */

  return {
    topDocsByFSpec: new Map(),
    docsByFSpec: new Map(),
    findingsByFSpec: new Map(),
    workspaceFolders,
    language,
    logger,
    connection,
    parserConfig: new ServerBehaviorConfiguration(),
    editorConfig: new EditorConfiguration()
  };
}
