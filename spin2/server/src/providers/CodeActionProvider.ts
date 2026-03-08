'use strict';
// src/providers/CodeActionProvider.ts

import * as lsp from 'vscode-languageserver';
import { Provider } from '.';
import { Context } from '../context';
import { fileSpecFromURI } from '../parser/lang.utils';

export default class CodeActionProvider implements Provider {
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit

  constructor(protected readonly ctx: Context) {}

  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled) {
      this.ctx.logger.log(message);
    }
  }

  register(connection: lsp.Connection) {
    connection.onCodeAction(this.handleCodeAction.bind(this));
    return {
      codeActionProvider: {
        codeActionKinds: [lsp.CodeActionKind.QuickFix]
      }
    };
  }

  private async handleCodeAction(params: lsp.CodeActionParams): Promise<lsp.CodeAction[]> {
    const actions: lsp.CodeAction[] = [];
    const uri = params.textDocument.uri;
    const docFSpec = fileSpecFromURI(uri);
    const processedDocument = this.ctx.docsByFSpec.get(docFSpec);
    if (!processedDocument) {
      return actions;
    }

    // only process .spin2 files
    if (!uri.endsWith('.spin2')) {
      return actions;
    }

    this._logMessage(`CodeAction: called with ${params.context.diagnostics.length} diag(s) for ${docFSpec}`);

    const documentText = processedDocument.document.getText();
    const lines = documentText.split(/\r?\n/);

    // find existing {Spin2_v##} directive and its location
    const existingDirective = this._findExistingDirective(lines);

    // get the highest required version from ALL parsed diagnostics (including hints not in the request)
    const allDiags = processedDocument.parseResult.allDiagnosticMessages(200);
    let highestRequiredVersion = 0;
    for (const d of allDiags) {
      // check for version hint diagnostics by code or message pattern
      if (d.code === 'spin2-needs-version' && d.data) {
        const data = d.data as { requiredVersion: number };
        if (data.requiredVersion > highestRequiredVersion) {
          highestRequiredVersion = data.requiredVersion;
        }
      } else {
        const hintMatch = /requires \{Spin2_v(\d{2,3})\}/.exec(d.message);
        if (hintMatch) {
          const v = parseInt(hintMatch[1], 10);
          if (v > highestRequiredVersion) {
            highestRequiredVersion = v;
          }
        }
      }
    }
    this._logMessage(`CodeAction: highest required version from findings: v${highestRequiredVersion}`);

    // track which version fixes we've already added (one action per version per request)
    const versionsOffered: Set<number> = new Set();

    for (const diag of params.context.diagnostics) {
      this._logMessage(`CodeAction: diag code=[${diag.code}], severity=${diag.severity}, msg=[${diag.message}]`);

      // === Unused symbol removal actions ===
      const unusedMatch = /^(Return value|Local variable) '([^']+)' is declared but never used$/.exec(diag.message);
      if (unusedMatch) {
        this._createRemoveUnusedAction(actions, uri, diag, unusedMatch[1], unusedMatch[2], lines);
        continue; // unused diagnostics don't need version actions
      }

      // === Version directive actions ===
      let requiredVersion = this._getRequiredVersion(diag);
      // if heuristic suggests a lower version than what the findings say, use the findings version
      if (highestRequiredVersion > requiredVersion) {
        requiredVersion = highestRequiredVersion;
      }
      if (requiredVersion === 0 || versionsOffered.has(requiredVersion)) {
        continue;
      }
      versionsOffered.add(requiredVersion);

      this._logMessage(`CodeAction: offering fix for v${requiredVersion}`);
      this._createVersionAction(actions, uri, diag, requiredVersion, existingDirective, lines);
    }

    this._logMessage(`CodeAction: returning ${actions.length} action(s)`);
    return actions;
  }

  private _getRequiredVersion(diag: lsp.Diagnostic): number {
    // Method 1: check diagnostic code field (from _emitVersionHintDiagnostic)
    if (diag.code === 'spin2-needs-version' && diag.data) {
      const data = diag.data as { requiredVersion: number };
      if (data.requiredVersion) {
        return data.requiredVersion;
      }
    }

    // Method 2: extract version from hint message text
    // matches: "P2 Spin ... requires {Spin2_v44} or later directive in this file"
    const hintMatch = /requires \{Spin2_v(\d{2,3})\}/.exec(diag.message);
    if (hintMatch) {
      return parseInt(hintMatch[1], 10);
    }

    // Method 3: analyze error messages for version-gated patterns
    // "P2 Spin ... missing declaration [symbolName]"
    const missingDeclMatch = /P2 Spin .* missing declaration \[([^\]]+)\]/.exec(diag.message);
    if (missingDeclMatch) {
      const symbolName = missingDeclMatch[1];
      // dotted name without version directive → likely structure reference needing v44
      if (symbolName.includes('.')) {
        return 44;
      }
      // check for known version-gated keywords
      const keywordVersion = this._versionForKeyword(symbolName);
      if (keywordVersion > 0) {
        return keywordVersion;
      }
    }

    // "P2 Spin ... Bad storage Type" or "Bad Type" — could be a structure type needing v45+
    if (/Bad (?:storage )?Type/i.test(diag.message)) {
      // check if the type name contains a dot (external object structure → needs v49)
      const typeMatch = /\[([^\]]+)\] Bad/i.exec(diag.message);
      if (typeMatch && typeMatch[1].includes('.')) {
        return 49;
      }
      return 45;
    }

    return 0;
  }

  private _versionForKeyword(name: string): number {
    // simplified lookup for common version-gated keywords
    const nameLC = name.toLowerCase();
    const v44Keywords = ['lstring', 'lstring.'];
    const v45Keywords = ['struct', 'union', 'sizeof', 'valueof', 'ones', 'field'];
    const v47Keywords = ['taskreg', 'pr0', 'pr1', 'pr2', 'pr3', 'pr4', 'pr5', 'pr6', 'pr7'];
    const v50Keywords = ['ditto', 'asmclk', 'setclk', 'getclk'];
    const v51Keywords = ['zerox', 'signx', 'sca', 'scas', 'frac'];
    const v52Keywords = ['regload', 'regexec'];

    if (v44Keywords.includes(nameLC)) return 44;
    if (v45Keywords.includes(nameLC)) return 45;
    if (v47Keywords.includes(nameLC)) return 47;
    if (v50Keywords.includes(nameLC)) return 50;
    if (v51Keywords.includes(nameLC)) return 51;
    if (v52Keywords.includes(nameLC)) return 52;
    return 0;
  }

  private _createVersionAction(
    actions: lsp.CodeAction[],
    uri: string,
    diag: lsp.Diagnostic,
    requiredVersion: number,
    existingDirective: { version: number; range: lsp.Range; lineIndex: number } | undefined,
    lines: string[]
  ): void {
    const directiveText = `{Spin2_v${requiredVersion}}`;

    if (existingDirective) {
      // only offer update if required version is higher
      if (requiredVersion > existingDirective.version) {
        actions.push({
          title: `Update version directive to ${directiveText}`,
          kind: lsp.CodeActionKind.QuickFix,
          diagnostics: [diag],
          isPreferred: true,
          edit: {
            changes: {
              [uri]: [lsp.TextEdit.replace(existingDirective.range, directiveText)]
            }
          }
        });
      } else {
        this._logMessage(`CodeAction: v${requiredVersion} already covered by existing {Spin2_v${existingDirective.version}} — no action needed`);
      }
    } else {
      // insert new directive as last comment line before code
      const insertLine = this._findInsertionLine(lines);
      this._logMessage(`CodeAction: inserting ${directiveText} at line ${insertLine}`);
      actions.push({
        title: `Add ${directiveText} directive`,
        kind: lsp.CodeActionKind.QuickFix,
        diagnostics: [diag],
        isPreferred: true,
        edit: {
          changes: {
            [uri]: [
              lsp.TextEdit.insert(
                lsp.Position.create(insertLine, 0),
                `${directiveText}\n\n`
              )
            ]
          }
        }
      });
    }
  }

  private _createRemoveUnusedAction(
    actions: lsp.CodeAction[],
    uri: string,
    diag: lsp.Diagnostic,
    symbolKind: string,
    symbolName: string,
    lines: string[]
  ): void {
    const lineIdx = diag.range.start.line;
    const line = lines[lineIdx];
    const isReturnValue = symbolKind === 'Return value';

    // Split line into code and end-of-line comment parts
    const commentIdx = line.indexOf("'");
    const codePart = (commentIdx >= 0 ? line.substring(0, commentIdx) : line).trimEnd();
    const commentPart = commentIdx >= 0 ? line.substring(commentIdx) : '';

    // Find section delimiters (: for returns, | for locals) in the code portion
    const colonIdx = codePart.indexOf(':');
    const pipeIdx = codePart.indexOf('|');

    let prefix: string;
    let sectionText: string;
    let suffix: string;

    if (isReturnValue) {
      if (colonIdx < 0) return;
      prefix = codePart.substring(0, colonIdx);
      if (pipeIdx > colonIdx) {
        sectionText = codePart.substring(colonIdx + 1, pipeIdx).trim();
        suffix = ' ' + codePart.substring(pipeIdx).trim();
      } else {
        sectionText = codePart.substring(colonIdx + 1).trim();
        suffix = '';
      }
    } else {
      if (pipeIdx < 0) return;
      prefix = codePart.substring(0, pipeIdx);
      sectionText = codePart.substring(pipeIdx + 1).trim();
      suffix = '';
    }

    // Parse comma-separated items
    const items = sectionText.split(',').map(s => s.trim()).filter(s => s.length > 0);

    // Find the item containing our symbol (last word, strip array brackets)
    const targetIdx = items.findIndex(item => {
      const words = item.trim().split(/\s+/);
      const lastWord = words[words.length - 1];
      return lastWord.replace(/\[.*\]$/, '') === symbolName;
    });
    if (targetIdx < 0) {
      this._logMessage(`CodeAction: couldn't find '${symbolName}' in section items [${items.join(', ')}]`);
      return;
    }

    // Each variable has its own type prefix (no inheritance across commas).
    // Removing a typed item does not affect the type of remaining items.
    items.splice(targetIdx, 1);

    // Rebuild the line
    let newLine: string;
    if (items.length === 0) {
      // Section is now empty — remove the delimiter too
      newLine = prefix.trimEnd();
      if (suffix.length > 0) {
        newLine += suffix;
      }
    } else {
      const delim = isReturnValue ? ':' : '|';
      newLine = prefix.trimEnd() + ' ' + delim + ' ' + items.join(', ');
      if (suffix.length > 0) {
        newLine += suffix;
      }
    }

    // Re-add end-of-line comment if present
    if (commentPart.length > 0) {
      newLine = newLine.trimEnd() + '  ' + commentPart.trimStart();
    }

    const kindLabel = isReturnValue ? 'return value' : 'local variable';
    this._logMessage(`CodeAction: offering removal of unused ${kindLabel} '${symbolName}'`);
    actions.push({
      title: `Remove unused ${kindLabel} '${symbolName}'`,
      kind: lsp.CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [lsp.TextEdit.replace(
            lsp.Range.create(lineIdx, 0, lineIdx, line.length),
            newLine
          )]
        }
      }
    });
  }

  private _findExistingDirective(lines: string[]): { version: number; range: lsp.Range; lineIndex: number } | undefined {
    // search for existing {Spin2_v##} directive in file-top comments
    const directiveRegex = /\{Spin2_v(\d{2,3})\}/i;
    for (let i = 0; i < lines.length; i++) {
      const match = directiveRegex.exec(lines[i]);
      if (match) {
        const version = parseInt(match[1], 10);
        const startChar = match.index;
        const endChar = startChar + match[0].length;
        return {
          version,
          range: lsp.Range.create(i, startChar, i, endChar),
          lineIndex: i
        };
      }
      // stop searching once we hit actual code (section keywords)
      const trimmed = lines[i].trim().toUpperCase();
      if (/^(CON|VAR|OBJ|DAT|PUB|PRI)\b/.test(trimmed)) {
        break;
      }
    }
    return undefined;
  }

  private _findInsertionLine(lines: string[]): number {
    // find the line immediately after the last actual comment line before code starts
    // blank lines between comments and code should stay below the directive
    let lastCommentLine = 0;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // section keywords mark start of code
      if (/^(CON|VAR|OBJ|DAT|PUB|PRI)\b/i.test(trimmed)) {
        return lastCommentLine;
      }
      // only advance past actual comment lines, NOT blank lines
      if (trimmed.startsWith("'") || trimmed.startsWith('{') || trimmed.startsWith("''")) {
        lastCommentLine = i + 1;
      }
    }
    // if no code sections found, insert after last comment
    return lastCommentLine;
  }
}
