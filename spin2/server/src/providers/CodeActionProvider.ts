'use strict';
// src/providers/CodeActionProvider.ts

import * as lsp from 'vscode-languageserver';
import { Provider } from '.';
import { Context } from '../context';
import { fileSpecFromURI } from '../parser/lang.utils';
import { DocumentFindings, eBLockType } from '../parser/spin.semantic.findings';

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

    // only process .spin2 and .spin files
    if (!uri.endsWith('.spin2') && !uri.endsWith('.spin')) {
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

      const unusedGlobalMatch = /^(VAR variable|DAT variable) '([^']+)' is declared but never used$/.exec(diag.message);
      if (unusedGlobalMatch) {
        this._createRemoveUnusedGlobalAction(actions, uri, diag, unusedGlobalMatch[1], unusedGlobalMatch[2], lines);
        continue;
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
    const v45Keywords = ['struct', 'sizeof', 'ones', 'field'];
    const v47Keywords = ['taskhlt', 'pr0', 'pr1', 'pr2', 'pr3', 'pr4', 'pr5', 'pr6', 'pr7'];
    const v50Keywords = ['ditto'];
    const v51Keywords = ['zerox', 'signx', 'sca', 'scas', 'frac'];
    const v52Keywords = ['regload', 'regexec'];
    const v53Keywords = ['offsetof'];

    if (v44Keywords.includes(nameLC)) return 44;
    if (v45Keywords.includes(nameLC)) return 45;
    if (v47Keywords.includes(nameLC)) return 47;
    if (v50Keywords.includes(nameLC)) return 50;
    if (v51Keywords.includes(nameLC)) return 51;
    if (v52Keywords.includes(nameLC)) return 52;
    if (v53Keywords.includes(nameLC)) return 53;
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

    // Check if the variable is referenced in commented-out code within the method body.
    // If so, offer "comment out" (wrap in { }) as the preferred fix instead of removal.
    const usedInComments = this._isSymbolInMethodComments(symbolName, lineIdx, lines);

    if (usedInComments) {
      // Build a "comment out" version: wrap the target item in { } in-place
      const commentOutLine = this._buildCommentOutLine(items, targetIdx, prefix, suffix, isReturnValue, commentPart);
      if (commentOutLine !== null) {
        const kindLabel = isReturnValue ? 'return value' : 'local variable';
        this._logMessage(`CodeAction: offering comment-out of unused ${kindLabel} '${symbolName}' (found in method comments)`);
        actions.push({
          title: `Comment out unused ${kindLabel} '${symbolName}'`,
          kind: lsp.CodeActionKind.QuickFix,
          diagnostics: [diag],
          isPreferred: true,
          edit: {
            changes: {
              [uri]: [lsp.TextEdit.replace(
                lsp.Range.create(lineIdx, 0, lineIdx, line.length),
                commentOutLine
              )]
            }
          }
        });
      }
    }

    // Always offer the "remove" action (preferred only when not used in comments)
    // Each variable has its own type prefix (no inheritance across commas).
    // Removing a typed item does not affect the type of remaining items.
    const removeItems = [...items];
    removeItems.splice(targetIdx, 1);

    // Rebuild the line
    let newLine: string;
    if (removeItems.length === 0) {
      // Section is now empty — remove the delimiter too
      newLine = prefix.trimEnd();
      if (suffix.length > 0) {
        newLine += suffix;
      }
    } else {
      const delim = isReturnValue ? ':' : '|';
      newLine = prefix.trimEnd() + ' ' + delim + ' ' + removeItems.join(', ');
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
      isPreferred: !usedInComments,
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

  private _buildCommentOutLine(
    items: string[],
    targetIdx: number,
    prefix: string,
    suffix: string,
    isReturnValue: boolean,
    commentPart: string
  ): string | null {
    // Wrap the target item (and its comma) in { } block comment
    const commentedItems: string[] = items.map((item, idx) => {
      if (idx === targetIdx) {
        // If target is the last item, no trailing comma inside the comment
        if (idx === items.length - 1) {
          return `{ ${item} }`;
        }
        // Otherwise include the trailing comma inside the comment
        return `{ ${item}, }`;
      }
      return item;
    });

    // If the commented item included its trailing comma, remove the comma
    // that would otherwise appear between the commented block and the next item
    const delim = isReturnValue ? ':' : '|';
    let newLine = prefix.trimEnd() + ' ' + delim + ' ' + commentedItems.join(', ');

    // Clean up double commas: "{ item, }, nextItem" → "{ item, } nextItem"
    newLine = newLine.replace(/\},\s*/g, '} ');

    if (suffix.length > 0) {
      newLine += suffix;
    }

    // Re-add end-of-line comment if present
    if (commentPart.length > 0) {
      newLine = newLine.trimEnd() + '  ' + commentPart.trimStart();
    }

    return newLine;
  }

  private _isSymbolInMethodComments(symbolName: string, declLineIdx: number, lines: string[]): boolean {
    // Find the method body range: from the declaration line to the next PUB/PRI/CON/VAR/OBJ/DAT or end of file
    const methodEndIdx = this._findMethodEnd(declLineIdx, lines);
    const wordRe = new RegExp(`\\b${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);

    for (let i = declLineIdx + 1; i <= methodEndIdx; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();

      // Only check full-line comments (entire line is commented-out code)
      if (!trimmed.startsWith("'")) continue;

      // Strip the leading comment marker(s) to get the "commented-out code"
      let uncommented = trimmed.replace(/^'{1,2}\s?/, '');

      // The commented-out code line may itself have a trailing comment.
      // Only search the code portion, not the trailing comment.
      // e.g., "' result := doStuff()  ' save myVar for later"
      //   → uncommented = "result := doStuff()  ' save myVar for later"
      //   → codePortion = "result := doStuff()"   (we search only this part)
      const trailingCommentIdx = uncommented.indexOf("'");
      if (trailingCommentIdx >= 0) {
        uncommented = uncommented.substring(0, trailingCommentIdx);
      }

      if (wordRe.test(uncommented)) {
        this._logMessage(`CodeAction: found '${symbolName}' in commented-out code at line ${i + 1}`);
        return true;
      }
    }
    return false;
  }

  private _findMethodEnd(declLineIdx: number, lines: string[]): number {
    const sectionRe = /^(pub|pri|con|var|obj|dat)\b/i;
    for (let i = declLineIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (sectionRe.test(trimmed)) {
        return i - 1;
      }
    }
    return lines.length - 1;
  }

  private _createRemoveUnusedGlobalAction(
    actions: lsp.CodeAction[],
    uri: string,
    diag: lsp.Diagnostic,
    symbolKind: string,
    symbolName: string,
    lines: string[]
  ): void {
    const lineIdx = diag.range.start.line;
    const line = lines[lineIdx];
    const isDatVariable = symbolKind === 'DAT variable';

    if (isDatVariable) {
      // DAT variables are one-per-line: delete entire line
      this._logMessage(`CodeAction: offering removal of unused DAT variable '${symbolName}'`);
      actions.push({
        title: `Remove unused DAT variable '${symbolName}'`,
        kind: lsp.CodeActionKind.QuickFix,
        diagnostics: [diag],
        isPreferred: true,
        edit: {
          changes: {
            [uri]: [lsp.TextEdit.replace(
              lsp.Range.create(lineIdx, 0, lineIdx + 1, 0),
              ''
            )]
          }
        }
      });
      return;
    }

    // VAR variable removal
    // Split line into code and end-of-line comment parts
    const commentIdx = line.indexOf("'");
    const codePart = (commentIdx >= 0 ? line.substring(0, commentIdx) : line).trimEnd();
    const commentPart = commentIdx >= 0 ? line.substring(commentIdx) : '';

    // Parse comma-separated declarations on the line
    // Format: {INDENT}{TYPE} name1, name2, TYPE2 name3, ...
    // The leading indentation before the first type/name is preserved
    const codeTrimmed = codePart.trimStart();
    const indent = codePart.substring(0, codePart.length - codeTrimmed.length);

    // Split by commas into segments, preserving position info
    const segments = codeTrimmed.split(/\s*,\s*/);

    // Parse each segment into {type, name} where type may be empty (inherited)
    interface VarSegment {
      type: string;
      name: string;
      raw: string;
    }
    const parsed: VarSegment[] = [];
    for (const seg of segments) {
      const trimmed = seg.trim();
      if (trimmed.length === 0) continue;
      // Check if segment has a type prefix (whitespace between type and name)
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        // has type + name (possibly with [array])
        parsed.push({ type: parts[0], name: parts.slice(1).join(' '), raw: trimmed });
      } else {
        // name only (inherits type from previous)
        parsed.push({ type: '', name: parts[0], raw: trimmed });
      }
    }

    // Find the target variable (strip array brackets for matching)
    const targetIdx = parsed.findIndex(p => {
      const baseName = p.name.replace(/\[.*\]$/, '');
      return baseName.toLowerCase() === symbolName.toLowerCase();
    });
    if (targetIdx < 0) {
      this._logMessage(`CodeAction: couldn't find VAR '${symbolName}' in segments [${parsed.map(p => p.raw).join(', ')}]`);
      return;
    }

    if (parsed.length === 1) {
      // Only variable on the line — delete entire line
      this._logMessage(`CodeAction: offering removal of unused VAR variable '${symbolName}' (delete line)`);
      actions.push({
        title: `Remove unused VAR variable '${symbolName}'`,
        kind: lsp.CodeActionKind.QuickFix,
        diagnostics: [diag],
        isPreferred: true,
        edit: {
          changes: {
            [uri]: [lsp.TextEdit.replace(
              lsp.Range.create(lineIdx, 0, lineIdx + 1, 0),
              ''
            )]
          }
        }
      });
      return;
    }

    // Multiple variables — remove target from comma list
    // If target has a type prefix and next segment has no type, transfer the type
    const target = parsed[targetIdx];
    if (target.type.length > 0 && targetIdx + 1 < parsed.length && parsed[targetIdx + 1].type.length === 0) {
      parsed[targetIdx + 1].type = target.type;
    }
    parsed.splice(targetIdx, 1);

    // Rebuild the line
    const rebuiltSegments = parsed.map(p => p.type.length > 0 ? `${p.type}  ${p.name}` : p.name);
    let newLine = indent + rebuiltSegments.join(', ');
    if (commentPart.length > 0) {
      newLine = newLine.trimEnd() + '  ' + commentPart.trimStart();
    }

    this._logMessage(`CodeAction: offering removal of unused VAR variable '${symbolName}'`);
    actions.push({
      title: `Remove unused VAR variable '${symbolName}'`,
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
