'use strict';
// src/extensions.ts

import * as lsp from 'vscode-languageserver';
import { Provider } from '.';
import { Context } from '../context';
import { DocumentFindings, IParsedToken } from '../parser/spin.semantic.findings';
import { fileSpecFromURI } from '../parser/lang.utils';

export default class SemanticTokensProvider implements Provider {
  private tokenTypes = new Map<string, number>();
  private tokenModifiers = new Map<string, number>();

  private tokenTypesLegend = [
    'comment',
    'debug', // with 'function' modifier
    'directive',
    'string',
    'keyword',
    'number',
    'regexp',
    'operator',
    'namespace',
    'type',
    'struct',
    'class',
    'interface',
    'enum',
    'typeParameter',
    'function',
    'method',
    'macro',
    'variable',
    'parameter',
    'property',
    'label',
    'enumMember',
    'event',
    'returnValue',
    'storageType',
    'colorName',
    'displayType',
    'displayName',
    'setupParameter',
    'feedParameter',
    'filename'
  ];

  private tokenModifiersLegend = [
    'declaration',
    'disabled',
    'documentation',
    'readonly',
    'function',
    'static',
    'abstract',
    'deprecated',
    'modification',
    'async',
    'definition',
    'defaultLibrary',
    'local',
    'pasmInline',
    'instance',
    'missingDeclaration',
    'illegalUse'
  ];

  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private bLogStarted: boolean = false;

  //private namedRegs: lsp.CompletionItem[];
  constructor(protected readonly ctx: Context) {
    /*
		this.namedRegs = syntax.registerNames.map((label) => ({
		  label,
		  detail: registerDocs[label],
		  kind: lsp.CompletionItemKind.Keyword,
		}));
		*/
    this.tokenTypesLegend.forEach((tokenType, index) => this.tokenTypes.set(tokenType, index));
    this.tokenModifiersLegend.forEach((tokenModifier, index) => this.tokenModifiers.set(tokenModifier, index));
    if (this.isDebugLogEnabled) {
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        //Create output channel
        this._logMessage('Spin2 Tokens log started.');
      } else {
        this._logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }
  }

  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled) {
      //Write to output window.
      this.ctx.logger.log(message);
    }
  }

  private Spin2Legend(): lsp.SemanticTokensLegend {
    return { tokenTypes: this.tokenTypesLegend, tokenModifiers: this.tokenModifiersLegend };
  }

  private handleGetSemanticTokensFull(params: lsp.SemanticTokensParams): lsp.SemanticTokens {
    const fileSpec: string = fileSpecFromURI(params.textDocument.uri);
    const documentFindings: DocumentFindings | undefined = this.ctx.docsByFSpec.get(fileSpec)?.parseResult;
    if (!documentFindings) {
      return { data: [] }; // empty case
    }

    // retrieve tokens to highlight
    const allTokens: IParsedToken[] = documentFindings.allSemanticTokens();
    const builder = new lsp.SemanticTokensBuilder();
    let tokenIdx: number = 0;
    allTokens.forEach((token) => {
      this._logMessage(`Token ${this._tokenString(tokenIdx++, token)}`);
      builder.push(
        token.line,
        token.startCharacter,
        token.length,
        this._encodeTokenType(token.ptTokenType),
        this._encodeTokenModifiers(token.ptTokenModifiers)
      );
    });
    // return them to client
    return builder.build();

    //return { data: [] };
  }

  private _tokenString(tokenIdx: number, aToken: IParsedToken): string {
    let desiredInterp: string = `  -- UNDEFINED! token(??,??)=[idx:${tokenIdx}][len:??](undefined)`;
    if (aToken !== undefined) {
      desiredInterp = `  -- token(${aToken.line + 1},${aToken.startCharacter})=[idx:${tokenIdx}][len:${aToken.length}](${aToken.ptTokenType}[${
        aToken.ptTokenModifiers
      }])]`;
    }
    return desiredInterp;
  }

  private _encodeTokenType(tokenType: string): number {
    if (this.tokenTypes.has(tokenType)) {
      return this.tokenTypes.get(tokenType)!;
    } else if (tokenType === 'notInLegend') {
      return this.tokenTypes.size + 2;
    }
    return 0;
  }

  private _encodeTokenModifiers(strTokenModifiers: string[]): number {
    let result = 0;
    for (let i = 0; i < strTokenModifiers.length; i++) {
      const tokenModifier = strTokenModifiers[i];
      if (this.tokenModifiers.has(tokenModifier)) {
        result = result | (1 << this.tokenModifiers.get(tokenModifier)!);
      } else if (tokenModifier === 'notInLegend') {
        result = result | (1 << (this.tokenModifiers.size + 2));
      }
    }
    return result;
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onRequest('textDocument/semanticTokens/full', this.handleGetSemanticTokensFull.bind(this));
    return {
      semanticTokensProvider: {
        full: {
          delta: false
        },
        legend: this.Spin2Legend()
      }
    };
  }
}
