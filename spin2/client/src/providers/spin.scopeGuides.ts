'use strict';
// client/src/providers/spin.scopeGuides.ts
//
// Scope nesting guides for PUB/PRI method bodies.
// Renders color-coded vertical lines at indent columns to show nesting depth.
// Active scope (containing the cursor) is rendered at higher opacity.

import * as vscode from 'vscode';
import * as path from 'path';
import { SpinCodeUtils, eParseState } from '../spin.code.utils';
import { isSpinFile } from '../spin.vscode.utils';

const MAX_LEVELS = 6;

// Keywords that continue a compound statement (if/else, case/other, repeat/until).
// A line at the guide column starting with one of these does NOT break the scope group.
const CONTINUATION_KW_RE = /^(else|elseif|elseifnot|other|until|while)\b/i;

interface ScopeInfo {
  depth: number; // 1-based nesting depth
  startLine: number; // first line of scope body (the line after the control statement)
  endLine: number; // last line of scope body (before dedent)
  indentColumn: number; // column where the guide renders
}

interface CachedScopes {
  version: number;
  scopes: ScopeInfo[];
}

export class ScopeGuidesProvider {
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private debugOutputChannel: vscode.OutputChannel | undefined = undefined;

  // Single decoration type — all styling is per-decoration via renderOptions.before
  private guideDecorationType: vscode.TextEditorDecorationType | undefined;
  private enabled: boolean = false;

  private cacheByFilespec = new Map<string, CachedScopes>();
  private lastCursorLine: number = -1;

  private codeUtils: SpinCodeUtils = new SpinCodeUtils();

  private updateTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly DEBOUNCE_MS = 150;

  constructor() {
    this.createDecorationTypes();
    this.reloadConfiguration();
  }

  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled) {
      if (this.debugOutputChannel === undefined) {
        this.debugOutputChannel = vscode.window.createOutputChannel('Spin2 Scope Guides DEBUG');
      }
      this.debugOutputChannel.appendLine(message);
    }
  }

  // ---------------------------------------------------------------------------
  //  Decoration types
  // ---------------------------------------------------------------------------

  private createDecorationTypes(): void {
    this.disposeDecorationTypes();
    // Single type — no inherent styling. All visuals come from per-decoration renderOptions.before
    this.guideDecorationType = vscode.window.createTextEditorDecorationType({});
  }

  private disposeDecorationTypes(): void {
    if (this.guideDecorationType) this.guideDecorationType.dispose();
    this.guideDecorationType = undefined;
  }

  // ---------------------------------------------------------------------------
  //  Configuration
  // ---------------------------------------------------------------------------

  public reloadConfiguration(): void {
    const config = vscode.workspace.getConfiguration('spinExtension.scopeGuides');
    const wasEnabled = this.enabled;
    this.enabled = config.get<boolean>('enable', false);
    this._logMessage(`reloadConfiguration: enabled=${this.enabled}`);

    if (wasEnabled && !this.enabled) {
      // Turned off — clear all decorations
      for (const editor of vscode.window.visibleTextEditors) {
        this.clearDecorations(editor);
      }
      this.cacheByFilespec.clear();
    }
  }

  // ---------------------------------------------------------------------------
  //  Public API (called from extension.ts event handlers)
  // ---------------------------------------------------------------------------

  /** Document content changed — debounced reparse + redecorate. */
  public documentChanged(editor: vscode.TextEditor): void {
    if (!this.enabled) return;
    if (!isSpinFile(editor.document.fileName)) return;

    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      this.invalidateCache(editor.document.fileName);
      this.updateDecorations(editor);
    }, this.DEBOUNCE_MS);
  }

  /** Active editor changed — apply decorations immediately. */
  public activeEditorChanged(editor: vscode.TextEditor | undefined): void {
    if (!this.enabled || !editor) return;
    if (!isSpinFile(editor.document.fileName)) return;
    this.lastCursorLine = -1; // force active scope recomputation
    this.updateDecorations(editor);
  }

  /** Cursor moved — lightweight active scope update (no reparse). */
  public cursorChanged(editor: vscode.TextEditor, line: number): void {
    if (!this.enabled) return;
    if (!isSpinFile(editor.document.fileName)) return;
    if (line === this.lastCursorLine) return;
    this.lastCursorLine = line;
    this.updateDecorations(editor);
  }

  /** Visible range changed (scroll) — reapply decorations for new viewport. */
  public visibleRangeChanged(editor: vscode.TextEditor): void {
    if (!this.enabled) return;
    if (!isSpinFile(editor.document.fileName)) return;
    this.updateDecorations(editor);
  }

  /** File closed — clean up cache. */
  public closedFile(fileSpec: string): void {
    this.cacheByFilespec.delete(fileSpec);
  }

  /** All files closed. */
  public closedAllFiles(): void {
    this.cacheByFilespec.clear();
  }

  public dispose(): void {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.disposeDecorationTypes();
    this.cacheByFilespec.clear();
  }

  // ---------------------------------------------------------------------------
  //  Core logic
  // ---------------------------------------------------------------------------

  private updateDecorations(editor: vscode.TextEditor): void {
    if (!this.enabled) return;

    const doc = editor.document;
    const tabSize = 8; // tab width is always 8
    const scopes = this.getScopes(doc);

    if (scopes.length === 0) {
      this.clearDecorations(editor);
      return;
    }

    // Determine visible line range
    const visibleRanges = editor.visibleRanges;
    let visStart = 0;
    let visEnd = doc.lineCount - 1;
    if (visibleRanges.length > 0) {
      visStart = visibleRanges[0].start.line;
      visEnd = visibleRanges[visibleRanges.length - 1].end.line;
    }

    // Find active scope (innermost containing cursor)
    const cursorLine = editor.selection.active.line;
    let activeScope: ScopeInfo | undefined;
    for (const scope of scopes) {
      if (cursorLine >= scope.startLine && cursorLine <= scope.endLine) {
        if (!activeScope || scope.depth > activeScope.depth) {
          activeScope = scope;
        }
      }
    }

    // Build a single decorations array.
    // For each guide position, find the character that contains the visual column
    // and place the decoration there. For blank lines, use a before pseudo-element
    // with position:absolute to avoid pushing text.
    const allDecos: vscode.DecorationOptions[] = [];

    for (const scope of scopes) {
      // Skip column 0 — no guide at method-body base level
      if (scope.indentColumn === 0) continue;

      const levelIdx = (scope.depth - 1) % MAX_LEVELS;
      const isActive = activeScope !== undefined &&
        scope.startLine === activeScope.startLine &&
        scope.endLine === activeScope.endLine &&
        scope.depth === activeScope.depth;
      const colorId = `spin2.scopeGuide.${isActive ? 'activeLevel' : 'level'}${levelIdx + 1}`;

      for (let line = scope.startLine; line <= scope.endLine; line++) {
        if (line < visStart || line > visEnd) continue;

        const docLine = doc.lineAt(line);
        const lineText = docLine.text;

        // Only render on lines indented DEEPER than the guide column.
        // Lines at the guide column are scope boundaries (if/else/repeat)
        // and should NOT have the guide. Blank lines always get the guide.
        if (lineText.trim().length > 0) {
          const lineInd = this.computeIndent(lineText, tabSize);
          if (lineInd <= scope.indentColumn) continue;
        }
        const isLastLine = line === scope.endLine;
        const borderHide = !isLastLine
          ? 'border-top: none; border-right: none; border-bottom: none'
          : 'border-top: none; border-right: none';

        // Find the character at or containing the visual column
        const mapping = this.findCharAtVisualCol(lineText, scope.indentColumn, tabSize);

        if (mapping.charIdx >= 0 && mapping.offset === 0) {
          // Exact character match — simple border decoration
          const pos = new vscode.Position(line, mapping.charIdx);
          allDecos.push({
            range: new vscode.Range(pos, pos),
            renderOptions: {
              before: {
                contentText: '',
                border: '1px solid',
                borderColor: new vscode.ThemeColor(colorId),
                textDecoration: `none; ${borderHide}`
              }
            }
          });
        } else if (mapping.charIdx >= 0 && mapping.offset > 0) {
          // Visual column falls inside a tab — place at tab char with margin offset
          const pos = new vscode.Position(line, mapping.charIdx);
          allDecos.push({
            range: new vscode.Range(pos, pos),
            renderOptions: {
              before: {
                contentText: '',
                margin: `0 0 0 ${mapping.offset}ch`,
                border: '1px solid',
                borderColor: new vscode.ThemeColor(colorId),
                textDecoration: `none; ${borderHide}`
              }
            }
          });
        } else {
          // Past end of line (blank or short) — use absolute positioning
          const pos = new vscode.Position(line, Math.max(0, lineText.length));
          const remainingCols = scope.indentColumn - mapping.visualColAtEnd;
          allDecos.push({
            range: new vscode.Range(pos, pos),
            renderOptions: {
              before: {
                contentText: '',
                margin: `0 0 0 ${remainingCols}ch`,
                border: '1px solid',
                borderColor: new vscode.ThemeColor(colorId),
                textDecoration: `none; ${borderHide}`
              }
            }
          });
        }
      }
    }

    if (this.guideDecorationType) {
      editor.setDecorations(this.guideDecorationType, allDecos);
    }
  }

  private clearDecorations(editor: vscode.TextEditor): void {
    if (this.guideDecorationType) editor.setDecorations(this.guideDecorationType, []);
  }

  // ---------------------------------------------------------------------------
  //  Scope parsing
  // ---------------------------------------------------------------------------

  private getScopes(doc: vscode.TextDocument): ScopeInfo[] {
    const fileSpec = doc.fileName;
    const cached = this.cacheByFilespec.get(fileSpec);
    if (cached && cached.version === doc.version) {
      return cached.scopes;
    }
    const scopes = this.parseMethodScopes(doc);
    this.cacheByFilespec.set(fileSpec, { version: doc.version, scopes });
    return scopes;
  }

  private invalidateCache(fileSpec: string): void {
    this.cacheByFilespec.delete(fileSpec);
  }

  private parseMethodScopes(doc: vscode.TextDocument): ScopeInfo[] {
    const scopes: ScopeInfo[] = [];
    // Tab width fixed at 8 for tab expansion in computeIndent
    const tabWidth = 8;
    // Determine indent step from the active mode:
    // - Elastic: first PUB/PRI tab stop from the elastic profile
    // - Spaces: indentSize from formatter settings
    const elasticConfig = vscode.workspace.getConfiguration('spinExtension.elasticTabstops');
    const elasticEnabled = elasticConfig.get<boolean>('enable', false);
    let indentSize: number;
    if (elasticEnabled) {
      const choice = elasticConfig.get<string>('choice', 'PropellerTool');
      const profileStops = vscode.workspace.getConfiguration(`spinExtension.elasticTabstops.blocks.${choice}.pub`);
      const tabStops = profileStops.get<number[]>('tabStops');
      indentSize = tabStops && tabStops.length > 0 ? tabStops[0] : 4;
    } else {
      indentSize = vscode.workspace.getConfiguration('spinExtension.formatter').get<number>('indentSize', 2);
    }

    // Find PUB/PRI method body ranges
    const methodBodies = this.findMethodBodies(doc);

    for (const body of methodBodies) {
      this.parseBodyScopes(doc, body.startLine, body.endLine, tabWidth, indentSize, scopes);
    }

    this._logMessage(`parseMethodScopes: ${scopes.length} scopes in ${path.basename(doc.fileName)}`);
    return scopes;
  }

  private findMethodBodies(doc: vscode.TextDocument): { startLine: number; endLine: number }[] {
    const bodies: { startLine: number; endLine: number }[] = [];
    let inMethod = false;
    let methodBodyStart = -1;

    for (let i = 0; i < doc.lineCount; i++) {
      const line = doc.lineAt(i).text;
      const sectionInfo = this.codeUtils.isSectionStartLine(line);

      if (sectionInfo.isSectionStart) {
        // Close previous method body
        if (inMethod && methodBodyStart >= 0) {
          bodies.push({ startLine: methodBodyStart, endLine: i - 1 });
        }

        if (sectionInfo.inProgressStatus === eParseState.inPub || sectionInfo.inProgressStatus === eParseState.inPri) {
          // Start of PUB/PRI — body begins on next line
          inMethod = true;
          methodBodyStart = i + 1;
        } else {
          inMethod = false;
          methodBodyStart = -1;
        }
      }
    }

    // Close last method body at end of file
    if (inMethod && methodBodyStart >= 0) {
      bodies.push({ startLine: methodBodyStart, endLine: doc.lineCount - 1 });
    }

    return bodies;
  }

  private parseBodyScopes(
    doc: vscode.TextDocument,
    startLine: number,
    endLine: number,
    tabWidth: number,
    indentSize: number,
    scopes: ScopeInfo[]
  ): void {
    // Build a per-line indent map for code lines.
    // Skip block comments and inline PASM from indent analysis.
    // Blank lines get indent -1 (they inherit scope from surrounding code).
    const lineIndent: number[] = new Array(endLine - startLine + 1).fill(-1);
    let inInlinePasm = false;
    let blockCommentDepth = 0;

    for (let i = startLine; i <= endLine; i++) {
      const text = doc.lineAt(i).text;
      const trimmed = text.trimStart();
      const idx = i - startLine;

      if (trimmed.length === 0) { lineIndent[idx] = -1; continue; }

      // Track block comment depth
      const depthAtLineStart = blockCommentDepth;
      let inString = false;
      for (let ci = 0; ci < trimmed.length; ci++) {
        const ch = trimmed[ci];
        if (blockCommentDepth === 0 && ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (blockCommentDepth === 0 && ch === "'") break;
        if (ch === '{') blockCommentDepth++;
        else if (ch === '}' && blockCommentDepth > 0) blockCommentDepth--;
      }
      if (depthAtLineStart > 0) { lineIndent[idx] = -1; continue; }
      if (trimmed.startsWith('{') || trimmed.startsWith('}')) { lineIndent[idx] = -1; continue; }

      // Inline PASM
      if (/^org\b/i.test(trimmed) || /^orgh\b/i.test(trimmed) || /^orgf\b/i.test(trimmed)) {
        inInlinePasm = true; lineIndent[idx] = -1; continue;
      }
      if (inInlinePasm && /^end\b/i.test(trimmed)) {
        inInlinePasm = false; lineIndent[idx] = -1; continue;
      }
      if (inInlinePasm) { lineIndent[idx] = -1; continue; }

      lineIndent[idx] = this.computeIndent(text, tabWidth);
    }

    // Base indent = indentSize from user settings. This is the PUB/PRI body's
    // first indent level (e.g., 2 or 4). Deriving from content is fragile —
    // doc comments or misindented lines can be at a different level.
    const baseIndent = indentSize;
    if (baseIndent <= 0) return;

    // Collect unique indent levels deeper than base
    const indentLevels = new Set<number>();
    for (const indent of lineIndent) {
      if (indent > baseIndent) indentLevels.add(indent);
    }

    // For each indent level, find contiguous groups of deep lines.
    // A group spans from the first line at indent >= level to the last,
    // continuing through:
    //   - blank/comment lines (indent -1)
    //   - continuation keywords (else, elseif, until, etc.) at the guide column
    // But splitting at:
    //   - non-continuation lines at indent <= guideColumn (new statements)
    const sortedLevels = [...indentLevels].sort((a, b) => a - b);

    for (const level of sortedLevels) {
      const guideColumn = level - baseIndent;
      if (guideColumn <= 0) continue;

      let groupFirstDeep = -1;
      let groupLastDeep = -1;

      const emitGroup = () => {
        if (groupFirstDeep >= 0 && groupLastDeep >= groupFirstDeep) {
          const depth = Math.max(1, Math.round(guideColumn / baseIndent));
          scopes.push({
            depth,
            startLine: startLine + groupFirstDeep,
            endLine: startLine + groupLastDeep,
            indentColumn: guideColumn
          });
        }
        groupFirstDeep = -1;
        groupLastDeep = -1;
      };

      for (let idx = 0; idx < lineIndent.length; idx++) {
        const indent = lineIndent[idx];

        if (indent >= level) {
          // Deep line — extend or start group
          if (groupFirstDeep === -1) groupFirstDeep = idx;
          groupLastDeep = idx;
        } else if (indent === -1) {
          // Blank/comment line — gap, keep going if inside a group
        } else if (indent <= guideColumn + baseIndent && indent > guideColumn) {
          // Line at intermediate indent (between guide col and target level) — gap
        } else if (indent <= guideColumn) {
          // Line at or below guide column — check if it's a continuation keyword
          if (groupFirstDeep >= 0) {
            const lineText = doc.lineAt(startLine + idx).text.trimStart();
            if (CONTINUATION_KW_RE.test(lineText)) {
              // Continuation (else, until, etc.) — keep the group open
            } else {
              // Non-continuation at guide column — close group, new statement
              emitGroup();
            }
          }
        }
      }
      emitGroup();
    }
  }

  /**
   * Find the character index and offset for a visual column in a line.
   * Returns:
   *  - charIdx >= 0, offset === 0: exact character at that visual column
   *  - charIdx >= 0, offset > 0: visual column falls inside a tab at charIdx, offset ch into it
   *  - charIdx === -1: visual column is past end of line; visualColAtEnd = last visual col
   */
  private findCharAtVisualCol(lineText: string, visualCol: number, tabSize: number): { charIdx: number; offset: number; visualColAtEnd: number } {
    let col = 0;
    for (let i = 0; i < lineText.length; i++) {
      if (col === visualCol) return { charIdx: i, offset: 0, visualColAtEnd: col };
      if (lineText[i] === '\t') {
        const nextTabStop = col + tabSize - (col % tabSize);
        if (visualCol < nextTabStop) {
          // Visual column falls inside this tab character
          return { charIdx: i, offset: visualCol - col, visualColAtEnd: col };
        }
        col = nextTabStop;
      } else {
        col++;
      }
    }
    // Past end of line
    return { charIdx: -1, offset: 0, visualColAtEnd: col };
  }

  private computeIndent(line: string, tabSize: number): number {
    let col = 0;
    for (const ch of line) {
      if (ch === ' ') {
        col++;
      } else if (ch === '\t') {
        col += tabSize - (col % tabSize);
      } else {
        break;
      }
    }
    return col;
  }

}
