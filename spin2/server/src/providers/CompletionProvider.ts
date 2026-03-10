'use strict';
// src/providers/CompletionProvider.ts

import * as lsp from 'vscode-languageserver';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Provider } from '.';
import { Context } from '../context';

import {
  DocumentFindings,
  RememberedToken,
  RememberedStructure,
  RememberedStructureMember,
  eBLockType
} from '../parser/spin.semantic.findings';
import { DocumentLineAt } from '../parser/lsp.textDocument.utils';
import { Spin2ParseUtils } from '../parser/spin2.utils';
import { Spin1ParseUtils } from '../parser/spin1.utils';
import { eBuiltInType, IBuiltinDescription } from '../parser/spin.common';
import { isSpin1File, fileSpecFromURI } from '../parser/lang.utils';

export default class CompletionProvider implements Provider {
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private bLogStarted: boolean = false;

  private symbolsFound: DocumentFindings = new DocumentFindings(); // this gets replaced
  private parseUtils: Spin1ParseUtils | Spin2ParseUtils = new Spin2ParseUtils();
  private haveSpin1File: boolean = false;

  constructor(protected readonly ctx: Context) {
    if (this.isDebugLogEnabled) {
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        this._logMessage('Spin Completion log started.');
      }
    }
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onCompletion(this.handleCompletion.bind(this));
    connection.onCompletionResolve(this.handleCompletionResolve.bind(this));
    return {
      completionProvider: {
        triggerCharacters: ['.'],
        resolveProvider: true
      }
    };
  }

  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled) {
      this.ctx.logger.log(message);
    }
  }

  async handleCompletion(params: lsp.CompletionParams): Promise<lsp.CompletionItem[]> {
    const docFSpec: string = fileSpecFromURI(params.textDocument.uri);
    const processed = this.ctx.docsByFSpec.get(docFSpec);
    if (!processed) {
      return [];
    }
    const documentFindings: DocumentFindings | undefined = processed.parseResult;
    if (!documentFindings) {
      return [];
    }
    this.symbolsFound = documentFindings;
    this.symbolsFound.enableLogging(this.ctx, this.isDebugLogEnabled);
    this.haveSpin1File = isSpin1File(docFSpec);
    this.parseUtils = this.haveSpin1File ? new Spin1ParseUtils() : new Spin2ParseUtils();
    this.parseUtils.enableLogging(this.ctx);
    if (!this.haveSpin1File) {
      (this.parseUtils as Spin2ParseUtils).setSpinVersion(documentFindings.documentVersion);
    }

    return this._provideCompletions(processed.document, params.position, params.context);
  }

  private _provideCompletions(document: TextDocument, position: lsp.Position, context?: lsp.CompletionContext): lsp.CompletionItem[] {
    const lineText: string = DocumentLineAt(document, position);
    const textBefore: string = lineText.substring(0, position.character);
    const lineIdx: number = position.line;

    // skip if in block comment
    if (this.symbolsFound.isLineInBlockComment(lineIdx)) {
      return [];
    }

    // determine if this is dot-triggered
    const isDotTrigger: boolean =
      context?.triggerKind === lsp.CompletionTriggerKind.TriggerCharacter && context?.triggerCharacter === '.';

    if (isDotTrigger || this._endsWithDot(textBefore)) {
      return this._handleDotCompletion(textBefore, lineIdx);
    }

    return this._handleGeneralCompletion(lineIdx);
  }

  private _endsWithDot(textBefore: string): boolean {
    const trimmed = textBefore.trimEnd();
    return trimmed.endsWith('.');
  }

  // ===================================================================
  // Dot-triggered completion: object.method, struct.field
  // ===================================================================
  private _handleDotCompletion(textBefore: string, lineIdx: number): lsp.CompletionItem[] {
    const items: lsp.CompletionItem[] = [];
    const nameBeforeDot = this._extractNameBeforeDot(textBefore);
    if (!nameBeforeDot || nameBeforeDot.length === 0) {
      return items;
    }
    this._logMessage(`+ Cmp: _handleDotCompletion() nameBeforeDot=[${nameBeforeDot}]`);

    // Case 1: Object instance (namespace) - offer PUB methods + CON constants
    if (this.symbolsFound.isNameSpace(nameBeforeDot)) {
      this._logMessage(`+ Cmp: namespace [${nameBeforeDot}]`);
      const childFindings: DocumentFindings | undefined = this.symbolsFound.getFindingsForNamespace(nameBeforeDot);
      if (childFindings) {
        const entries: [string, RememberedToken][] = childFindings.allGlobalTokenEntries();
        for (const [tokenName, token] of entries) {
          if (token.isPublic()) {
            items.push(this._tokenToCompletionItem(tokenName, token, childFindings));
          }
        }
      }
      return items;
    }

    // Case 2 & 3: Struct instance - try local first, then global
    // Also handles dotted chains like cfg.Servo[0].
    const dottedParts = this._extractDottedParts(textBefore);
    this._logMessage(`+ Cmp: dottedParts=[${dottedParts.join(', ')}]`);

    if (dottedParts.length >= 1) {
      const resolvedStruct = this._resolveStructChain(dottedParts, lineIdx);
      if (resolvedStruct) {
        this._logMessage(`+ Cmp: resolved struct [${resolvedStruct.name}] with ${resolvedStruct.members.length} members`);
        for (const member of resolvedStruct.members) {
          items.push(this._structMemberToCompletionItem(member));
        }
        return items;
      }
    }

    return items;
  }

  private _extractNameBeforeDot(textBefore: string): string {
    // strip trailing dot and optional whitespace
    let text = textBefore.trimEnd();
    if (text.endsWith('.')) {
      text = text.substring(0, text.length - 1).trimEnd();
    }
    // walk backwards skipping index expressions [...]
    let idx = text.length - 1;
    while (idx >= 0 && text.charAt(idx) === ']') {
      // skip back past matching '['
      let depth = 1;
      idx--;
      while (idx >= 0 && depth > 0) {
        if (text.charAt(idx) === ']') depth++;
        else if (text.charAt(idx) === '[') depth--;
        idx--;
      }
    }
    // now extract identifier
    let nameEnd = idx + 1;
    // skip trailing dot if there is one (for nested chains)
    if (idx >= 0 && text.charAt(idx) === '.') {
      idx--;
      nameEnd = idx + 1;
    }
    while (idx >= 0 && /[a-zA-Z0-9_]/.test(text.charAt(idx))) {
      idx--;
    }
    return text.substring(idx + 1, nameEnd);
  }

  private _extractDottedParts(textBefore: string): string[] {
    // extract dotted chain like "cfg.Servo[0]." -> ["cfg", "Servo"]
    let text = textBefore.trimEnd();
    if (text.endsWith('.')) {
      text = text.substring(0, text.length - 1);
    }

    // find the start of the entire chain: walk backwards through identifiers, dots, and brackets
    let idx = text.length - 1;
    while (idx >= 0) {
      const ch = text.charAt(idx);
      if (ch === ']') {
        // skip back past matching '['
        let depth = 1;
        idx--;
        while (idx >= 0 && depth > 0) {
          if (text.charAt(idx) === ']') depth++;
          else if (text.charAt(idx) === '[') depth--;
          idx--;
        }
      } else if (ch === '.' || /[a-zA-Z0-9_]/.test(ch)) {
        idx--;
      } else {
        break;
      }
    }
    const chainText = text.substring(idx + 1);

    // split on dots, strip index expressions from each part
    const rawParts = chainText.split('.');
    const parts: string[] = [];
    for (const raw of rawParts) {
      const bracketIdx = raw.indexOf('[');
      const name = bracketIdx >= 0 ? raw.substring(0, bracketIdx) : raw;
      if (name.length > 0) {
        parts.push(name);
      }
    }
    return parts;
  }

  private _resolveStructChain(parts: string[], lineIdx: number): RememberedStructure | undefined {
    if (parts.length === 0) {
      return undefined;
    }

    const instanceName = parts[0];

    // find the struct type for this instance
    let structTypeName: string | undefined = this.symbolsFound.getTypeForLocalStructureInstance(instanceName, lineIdx);
    if (!structTypeName) {
      structTypeName = this.symbolsFound.getTypeForStructureInstance(instanceName);
    }
    if (!structTypeName) {
      return undefined;
    }
    this._logMessage(`+ Cmp: resolveStructChain() instance=[${instanceName}] type=[${structTypeName}]`);

    // resolve the top-level structure (may be external e.g., "myCfg.DATA_CFGx")
    let currStructure = this._getStructDefn(structTypeName);
    if (!currStructure) {
      return undefined;
    }

    // extract external object namespace for nested lookups
    const objectNamespace: string = structTypeName.includes('.') ? structTypeName.split('.')[0] : '';

    // descend through remaining parts
    for (let i = 1; i < parts.length; i++) {
      const memberName = parts[i];
      const memberInfo = currStructure.memberNamed(memberName);
      if (!memberInfo || !memberInfo.isStructure) {
        return undefined;
      }
      const mbrStructName = memberInfo.structName;
      let nextStruct = this.symbolsFound.getStructure(mbrStructName);
      if (!nextStruct && objectNamespace.length > 0) {
        // nested struct type is in the external object's namespace
        const childFindings = this.symbolsFound.getFindingsForNamespace(objectNamespace);
        if (childFindings) {
          nextStruct = childFindings.getStructure(mbrStructName);
        }
      }
      if (!nextStruct) {
        return undefined;
      }
      currStructure = nextStruct;
    }
    return currStructure;
  }

  private _getStructDefn(structTypeName: string): RememberedStructure | undefined {
    if (structTypeName.includes('.')) {
      const dotIdx = structTypeName.indexOf('.');
      const objName = structTypeName.substring(0, dotIdx);
      const typeName = structTypeName.substring(dotIdx + 1);
      const childFindings = this.symbolsFound.getFindingsForNamespace(objName);
      if (childFindings) {
        return childFindings.getStructure(typeName);
      }
      return undefined;
    }
    return this.symbolsFound.getStructure(structTypeName);
  }

  // ===================================================================
  // General completion: symbols, built-ins, keywords
  // ===================================================================
  private _handleGeneralCompletion(lineIdx: number): lsp.CompletionItem[] {
    const items: lsp.CompletionItem[] = [];
    const blockType: eBLockType = this.symbolsFound.blockTypeForLine(lineIdx);
    const inPasmCode: boolean = this.symbolsFound.isLineInPasmCode(lineIdx);

    // 1. Local variables (if inside a PUB/PRI method)
    if (blockType === eBLockType.isPub || blockType === eBLockType.isPri) {
      const methodName: string | undefined = this.symbolsFound.getMethodNameForLine(lineIdx);
      if (methodName) {
        const localEntries: [string, RememberedToken][] = this.symbolsFound.localTokenEntriesForMethod(methodName);
        for (const [tokenName, token] of localEntries) {
          items.push(this._tokenToCompletionItem(tokenName, token, this.symbolsFound));
        }
        if (inPasmCode) {
          const pasmEntries: [string, RememberedToken][] = this.symbolsFound.localPasmTokenEntriesForMethod(methodName);
          for (const [tokenName, token] of pasmEntries) {
            items.push(this._tokenToCompletionItem(tokenName, token, this.symbolsFound));
          }
        }
      }
    }

    // 2. Global symbols (CON constants, VAR variables, PUB/PRI methods, DAT labels)
    const globalEntries: [string, RememberedToken][] = this.symbolsFound.allGlobalTokenEntries();
    for (const [tokenName, token] of globalEntries) {
      items.push(this._tokenToCompletionItem(tokenName, token, this.symbolsFound));
    }

    // 3. Object instance names (so user can type obj. to trigger dot completion)
    const namespaces: string[] = this.symbolsFound.getNamespaces();
    for (const ns of namespaces) {
      items.push({
        label: ns,
        kind: lsp.CompletionItemKind.Module,
        detail: 'Object instance'
      });
    }

    // 4. Built-in methods, variables, constants
    this._addBuiltInCompletions(items, inPasmCode);

    return items;
  }

  private _addBuiltInCompletions(items: lsp.CompletionItem[], inPasmCode: boolean): void {
    if (this.haveSpin1File) {
      this._addSpin1BuiltInCompletions(items, inPasmCode);
    } else {
      this._addSpin2BuiltInCompletions(items, inPasmCode);
    }
  }

  private _addSpin2BuiltInCompletions(items: lsp.CompletionItem[], inPasmCode: boolean): void {
    const pu = this.parseUtils as Spin2ParseUtils;
    // add built-in methods
    const builtInMethodNames: string[] = [
      'hubset', 'clkset', 'cogspin', 'coginit', 'cogstop', 'cogid', 'cogchk',
      'locknew', 'lockret', 'locktry', 'lockrel', 'lockchk',
      'cogatn', 'pollatn', 'waitatn',
      'pinw', 'pinwrite', 'pinl', 'pinh', 'pint', 'pinf',
      'pinr', 'pinread',
      'pinstart', 'pinclear', 'wrpin', 'wxpin', 'wypin', 'rdpin', 'rqpin', 'akpin',
      'getct', 'pollct', 'waitct', 'waitus', 'waitms', 'getsec', 'getms',
      'call', 'regexec', 'regload',
      'abs', 'encod', 'decod', 'bmask', 'ones', 'sqrt', 'qlog', 'qexp',
      'sar', 'ror', 'rol', 'rev', 'zerox', 'signx',
      'sca', 'scas', 'frac', 'muldiv64',
      'getrnd', 'nan',
      'bytemove', 'bytefill', 'wordmove', 'wordfill', 'longmove', 'longfill',
      'strsize', 'strcomp', 'strcopy', 'string',
      'lookup', 'lookupz', 'lookdown', 'lookdownz',
      'if', 'ifnot', 'elseif', 'elseifnot', 'else',
      'case', 'case_fast', 'other',
      'repeat', 'from', 'to', 'step', 'while', 'until', 'with', 'next', 'quit',
      'abort', 'return', 'send', 'recv',
      'debug',
      'end', 'org', 'orgf', 'orgh', 'fit'
    ];
    for (const name of builtInMethodNames) {
      if (pu.isSpinBuiltinMethod(name) || pu.isSpinReservedWord(name)) {
        const docText: IBuiltinDescription = pu.docTextForBuiltIn(name);
        if (docText.found) {
          items.push(this._builtInToCompletionItem(name, docText));
        }
      }
    }

    // add built-in variables/registers
    const builtInVarNames: string[] = [
      'clkmode', 'clkfreq', 'clkfreq_', 'clkmode_', 'varbase',
      'pr0', 'pr1', 'pr2', 'pr3', 'pr4', 'pr5', 'pr6', 'pr7',
      'ijmp1', 'ijmp2', 'ijmp3', 'iret1', 'iret2', 'iret3',
      'pa', 'pb', 'ptra', 'ptrb',
      'dira', 'dirb', 'outa', 'outb', 'ina', 'inb'
    ];
    for (const name of builtInVarNames) {
      if (pu.isSpinBuiltInVariable(name)) {
        const docText: IBuiltinDescription = pu.docTextForBuiltIn(name);
        if (docText.found) {
          items.push(this._builtInToCompletionItem(name, docText));
        }
      }
    }

    // add block names
    const blockNames: string[] = ['CON', 'OBJ', 'VAR', 'PUB', 'PRI', 'DAT'];
    for (const name of blockNames) {
      items.push({
        label: name,
        kind: lsp.CompletionItemKind.Keyword,
        detail: 'Block declaration'
      });
    }
  }

  private _addSpin1BuiltInCompletions(items: lsp.CompletionItem[], _inPasmCode: boolean): void {
    const pu = this.parseUtils as Spin1ParseUtils;
    // add a curated set of Spin1 built-in names
    const builtInNames: string[] = [
      'cognew', 'cogstop', 'cogid',
      'locknew', 'lockret', 'lockset', 'lockclr',
      'waitcnt', 'waitpeq', 'waitpne', 'waitvid',
      'clkset',
      'chipver', 'reboot',
      'strsize', 'strcomp',
      'bytefill', 'wordfill', 'longfill', 'bytemove', 'wordmove', 'longmove',
      'lookup', 'lookupz', 'lookdown', 'lookdownz',
      'abort', 'return', 'result',
      'if', 'ifnot', 'elseif', 'elseifnot', 'else',
      'case', 'other',
      'repeat', 'from', 'to', 'step', 'while', 'until', 'next', 'quit',
      'string', 'constant',
      'clkmode', 'clkfreq', 'cnt',
      'dira', 'dirb', 'outa', 'outb', 'ina', 'inb',
      'par', 'spr', 'cnt', 'ctra', 'ctrb', 'frqa', 'frqb', 'phsa', 'phsb',
      'vcfg', 'vscl'
    ];
    for (const name of builtInNames) {
      const docText: IBuiltinDescription = pu.docTextForBuiltIn(name);
      if (docText.found) {
        items.push(this._builtInToCompletionItem(name, docText));
      }
    }

    // add block names
    const blockNames: string[] = ['CON', 'OBJ', 'VAR', 'PUB', 'PRI', 'DAT'];
    for (const name of blockNames) {
      items.push({
        label: name,
        kind: lsp.CompletionItemKind.Keyword,
        detail: 'Block declaration'
      });
    }
  }

  // ===================================================================
  // Completion Resolve - lazy documentation loading
  // ===================================================================
  private handleCompletionResolve(item: lsp.CompletionItem): lsp.CompletionItem {
    if (!item.data) {
      return item;
    }
    if (item.data.builtIn && item.data.name) {
      const docText: IBuiltinDescription = this.parseUtils.docTextForBuiltIn(item.data.name);
      if (docText.found) {
        let docString = docText.description.replace(/<br>/g, '\n');
        if (docText.parameters && docText.parameters.length > 0) {
          docString += '\n\n**Parameters:**\n';
          for (const param of docText.parameters) {
            docString += `- ${param}\n`;
          }
        }
        if (docText.returns && docText.returns.length > 0) {
          docString += '\n**Returns:**\n';
          for (const ret of docText.returns) {
            docString += `- ${ret}\n`;
          }
        }
        item.documentation = {
          kind: lsp.MarkupKind.Markdown,
          value: docString
        };
      }
    } else if (item.data.tokenName) {
      const declInfo = this.symbolsFound.globalTokenDeclarationInfo(item.data.tokenName);
      if (declInfo?.comment) {
        item.documentation = {
          kind: lsp.MarkupKind.Markdown,
          value: declInfo.comment
        };
      }
    }
    return item;
  }

  // ===================================================================
  // Helper methods for building CompletionItems
  // ===================================================================
  private _tokenToCompletionItem(tokenName: string, token: RememberedToken, findings: DocumentFindings): lsp.CompletionItem {
    const kind: lsp.CompletionItemKind = this._tokenTypeToCompletionKind(token);
    const item: lsp.CompletionItem = {
      label: tokenName,
      kind: kind,
      data: { tokenName: tokenName }
    };
    const declInfo = findings.globalTokenDeclarationInfo(tokenName);
    if (declInfo?.comment) {
      item.detail = declInfo.comment;
    }
    return item;
  }

  private _tokenTypeToCompletionKind(token: RememberedToken): lsp.CompletionItemKind {
    const tokenType: string = token.type;
    const modifiers: string[] = token.modifiers;
    if (tokenType === 'method') {
      return modifiers.includes('static') ? lsp.CompletionItemKind.Method : lsp.CompletionItemKind.Function;
    } else if (tokenType === 'variable') {
      if (modifiers.includes('readonly')) {
        return lsp.CompletionItemKind.Constant;
      }
      return lsp.CompletionItemKind.Variable;
    } else if (tokenType === 'enumMember') {
      return lsp.CompletionItemKind.EnumMember;
    } else if (tokenType === 'label') {
      return lsp.CompletionItemKind.Reference;
    } else if (tokenType === 'namespace') {
      return lsp.CompletionItemKind.Module;
    }
    return lsp.CompletionItemKind.Text;
  }

  private _structMemberToCompletionItem(member: RememberedStructureMember): lsp.CompletionItem {
    let detail: string = member.typeString;
    if (member.isStructure) {
      detail = `struct ${member.structName}`;
    }
    if (member.instanceCount > 1) {
      detail += `[${member.instanceCount}]`;
    }
    return {
      label: member.name,
      kind: lsp.CompletionItemKind.Field,
      detail: detail
    };
  }

  private _builtInToCompletionItem(name: string, docText: IBuiltinDescription): lsp.CompletionItem {
    let kind: lsp.CompletionItemKind;
    switch (docText.type) {
      case eBuiltInType.BIT_METHOD:
      case eBuiltInType.BIT_METHOD_POINTER:
        kind = lsp.CompletionItemKind.Function;
        break;
      case eBuiltInType.BIT_VARIABLE:
        kind = lsp.CompletionItemKind.Variable;
        break;
      case eBuiltInType.BIT_CONSTANT:
      case eBuiltInType.BIT_SYMBOL:
        kind = lsp.CompletionItemKind.Constant;
        break;
      case eBuiltInType.BIT_LANG_PART:
      case eBuiltInType.BIT_TYPE:
      case eBuiltInType.BIT_PASM_DIRECTIVE:
        kind = lsp.CompletionItemKind.Keyword;
        break;
      case eBuiltInType.BIT_PASM_INSTRUCTION:
        kind = lsp.CompletionItemKind.Operator;
        break;
      default:
        kind = lsp.CompletionItemKind.Text;
        break;
    }
    const item: lsp.CompletionItem = {
      label: docText.signature.length > 0 ? name : name,
      kind: kind,
      detail: `${docText.category} (built-in)`,
      data: { builtIn: true, name: name }
    };
    if (docText.type === eBuiltInType.BIT_METHOD && docText.signature.length > 0) {
      item.detail = docText.signature;
    }
    return item;
  }
}
