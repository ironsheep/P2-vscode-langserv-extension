"use strict";
// src/providers/CompletionProvider.ts

//       A DEMO Completion Provider!

import * as lsp from "vscode-languageserver";
import { CompletionItemKind } from "vscode-languageserver/node";

//import { promises as fsp } from "fs";
//import { relative } from "path";
//import { fileURLToPath } from "url";
import { Provider } from ".";
import { Context } from "../context";

export default class CompletionProvider implements Provider {
  //private namedRegs: lsp.CompletionItem[];

  constructor(protected readonly ctx: Context) {
    /*
		this.namedRegs = syntax.registerNames.map((label) => ({
		  label,
		  detail: registerDocs[label],
		  kind: lsp.CompletionItemKind.Keyword,
		}));
		*/
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onCompletion(this.handleCompletion.bind(this));
    connection.onCompletionResolve(this.handleCompletionResolve.bind(this));
    return {
      completionProvider: {
        triggerCharacters: ["."],
        resolveProvider: true,
      },
    };
  }

  async handleCompletion({ position, textDocument }: lsp.CompletionParams): Promise<lsp.CompletionItem[]> {
    // The pass parameter contains the position of the text document in
    // which code complete got requested. For the example we ignore this
    // info and always provide the same completion items.
    return [
      {
        label: "TypeScript",
        kind: CompletionItemKind.Text,
        data: 1,
      },
      {
        label: "JavaScript",
        kind: CompletionItemKind.Text,
        data: 2,
      },
    ];
  }

  private handleCompletionResolve(item: lsp.CompletionItem) {
    if (item.data === 1) {
      item.detail = "TypeScript details";
      item.documentation = "TypeScript documentation";
    } else if (item.data === 2) {
      item.detail = "JavaScript details";
      item.documentation = "JavaScript documentation";
    }
    return item;
  }
}
