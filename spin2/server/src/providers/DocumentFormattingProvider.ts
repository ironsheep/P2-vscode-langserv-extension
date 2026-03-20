'use strict';
// src/providers/DocumentFormattingProvider.ts

import * as lsp from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Provider } from '.';
import { Context } from '../context';
import { DocumentFindings, IBlockSpan, eBLockType } from '../parser/spin.semantic.findings';
import { fileSpecFromURI } from '../parser/lang.utils';
import { ElasticTabstopConfig, DEFAULT_TABSTOPS } from '../formatter/spin2.formatter.base';
import { formatConBlock } from '../formatter/spin2.formatter.con';
import { formatVarBlock } from '../formatter/spin2.formatter.var';
import { formatObjBlock } from '../formatter/spin2.formatter.obj';
import { formatDatBlock } from '../formatter/spin2.formatter.dat';
import { formatMethodBlock } from '../formatter/spin2.formatter.method';
import { CaseConfig, normalizeMethodBlockCase, normalizeDatBlockCase, normalizeNonCodeBlockCase, normalizeCommentSpacing, extractConConstants } from '../formatter/spin2.formatter.comment';

interface FormatterConfig {
  enable: boolean;
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
  maxConsecutiveBlankLines: number;
  blankLinesBetweenSections: number;
  blankLinesBetweenMethods: number;
  tabsToSpaces: boolean;
  tabWidth: number;
  indentSize: number;
  blockNameCase: string;
  controlFlowCase: string;
  methodCase: string;
  typeCase: string;
  constantCase: string;
  pasmInstructionCase: string;
  spaceAfterCommentStart: boolean;
}

export default class DocumentFormattingProvider implements Provider {
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit

  constructor(protected readonly ctx: Context) {}

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onDocumentFormatting(this.handleFormatDocument.bind(this));
    return {
      documentFormattingProvider: true
    };
  }

  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled) {
      this.ctx.logger.log(message);
    }
  }

  private async handleFormatDocument(params: lsp.DocumentFormattingParams): Promise<lsp.TextEdit[] | null> {
    const docFSpec: string = fileSpecFromURI(params.textDocument.uri);

    // only format .spin2 files
    if (!docFSpec.toLowerCase().endsWith('.spin2')) {
      return null;
    }

    const processed = this.ctx.docsByFSpec.get(docFSpec);
    if (!processed) {
      return null;
    }

    const findings: DocumentFindings | undefined = processed.parseResult;
    if (!findings) {
      return null;
    }

    const config = await this.getFormatterConfig(params.options);
    if (!config.enable) {
      return null;
    }

    const elasticConfig = await this.getElasticTabstopConfig();

    this._logMessage(`Formatter: formatting ${docFSpec}`);

    const document: TextDocument = processed.document;
    const originalText: string = document.getText();
    const originalLines: string[] = originalText.split(/\r?\n/);

    const formattedLines = this.formatLines(originalLines, findings, config, elasticConfig);
    const formattedText = formattedLines.join('\n');

    if (formattedText === originalText) {
      this._logMessage('Formatter: no changes needed');
      return null;
    }

    this._logMessage(`Formatter: returning edits for ${docFSpec}`);
    const fullRange = lsp.Range.create(0, 0, document.lineCount, 0);
    return [lsp.TextEdit.replace(fullRange, formattedText)];
  }

  private async getFormatterConfig(editorOptions?: lsp.FormattingOptions): Promise<FormatterConfig> {
    const raw = await this.ctx.connection.workspace.getConfiguration('spinExtension.formatter');

    // Use VSCode's built-in editor settings as fallback defaults when our extension
    // settings are not explicitly configured.  editorOptions comes from the LSP
    // DocumentFormattingParams and reflects the editor's tabSize and insertSpaces.
    const editorTabSize = editorOptions?.tabSize;
    const editorInsertSpaces = editorOptions?.insertSpaces;

    return {
      enable: raw?.['enable'] === true,
      trimTrailingWhitespace: raw?.['trimTrailingWhitespace'] !== false,
      insertFinalNewline: raw?.['insertFinalNewline'] !== false,
      maxConsecutiveBlankLines: typeof raw?.['maxConsecutiveBlankLines'] === 'number' ? raw['maxConsecutiveBlankLines'] : 1,
      blankLinesBetweenSections: typeof raw?.['blankLinesBetweenSections'] === 'number' ? raw['blankLinesBetweenSections'] : 1,
      blankLinesBetweenMethods: typeof raw?.['blankLinesBetweenMethods'] === 'number' ? raw['blankLinesBetweenMethods'] : 2,
      tabsToSpaces: typeof raw?.['tabsToSpaces'] === 'boolean' ? raw['tabsToSpaces'] : (editorInsertSpaces !== undefined ? editorInsertSpaces : true),
      tabWidth: typeof raw?.['tabWidth'] === 'number' ? raw['tabWidth'] : (editorTabSize !== undefined ? editorTabSize : 8),
      indentSize: typeof raw?.['indentSize'] === 'number' ? raw['indentSize'] : 2,
      blockNameCase: typeof raw?.['blockNameCase'] === 'string' ? raw['blockNameCase'] : 'uppercase',
      controlFlowCase: typeof raw?.['controlFlowCase'] === 'string' ? raw['controlFlowCase'] : 'lowercase',
      methodCase: typeof raw?.['methodCase'] === 'string' ? raw['methodCase'] : 'lowercase',
      typeCase: typeof raw?.['typeCase'] === 'string' ? raw['typeCase'] : 'lowercase',
      constantCase: typeof raw?.['constantCase'] === 'string' ? raw['constantCase'] : 'preserve',
      pasmInstructionCase: typeof raw?.['pasmInstructionCase'] === 'string' ? raw['pasmInstructionCase'] : 'preserve',
      spaceAfterCommentStart: raw?.['spaceAfterCommentStart'] !== false
    };
  }

  private async getElasticTabstopConfig(): Promise<ElasticTabstopConfig> {
    const raw = await this.ctx.connection.workspace.getConfiguration('spinExtension.elasticTabstops');
    const enabled = raw?.['enable'] === true;
    if (!enabled) {
      return { enabled: false, tabStops: DEFAULT_TABSTOPS };
    }
    const choice: string = raw?.['choice'] || 'PropellerTool';
    const blocksRaw = await this.ctx.connection.workspace.getConfiguration(`spinExtension.elasticTabstops.blocks.${choice}`);
    const tabStops: Record<string, number[]> = {};
    for (const section of ['con', 'var', 'obj', 'pub', 'pri', 'dat']) {
      tabStops[section] = blocksRaw?.[section]?.tabStops || DEFAULT_TABSTOPS[section] || [];
    }
    return { enabled: true, tabStops };
  }

  private formatLines(lines: string[], findings: DocumentFindings, config: FormatterConfig, elasticConfig: ElasticTabstopConfig): string[] {
    let result: string[] = [...lines];

    // Phase 1a: Tab-to-space conversion (always convert tabs to spaces for internal processing)
    result = this.convertTabsToSpaces(result, findings, config.tabWidth);

    // Phase 1b: Trailing whitespace trimming
    if (config.trimTrailingWhitespace) {
      result = this.trimTrailingWhitespace(result, findings);
    }

    // Phase 2-4: Section column alignment and method formatting
    this.formatSections(result, findings, config, elasticConfig);

    // Phase 6: Case normalization and comment spacing
    this.formatCaseAndComments(result, findings, config);

    // Phase 1c: Blank line normalization (after section formatting to preserve line indices)
    result = this.normalizeBlankLines(result, findings, config);

    // Phase 1e: Ensure blank line between method documentation and first code line
    result = this.ensureBlankBeforeMethodCode(result);

    // Phase 1f: Remove blank lines between PUB/PRI declaration and its documentation
    result = this.removeBlankAfterMethodDecl(result);

    // Phase 1d: Final newline
    if (config.insertFinalNewline) {
      result = this.ensureFinalNewline(result);
    }

    // Phase 7: Enforce tab/space preference
    // All internal formatting uses spaces for consistent alignment math.
    // As the final step, convert to the user's preferred whitespace style.
    if (!config.tabsToSpaces) {
      result = this.convertSpacesToTabs(result, findings, config.tabWidth);
    }

    return result;
  }

  private formatSections(lines: string[], findings: DocumentFindings, config: FormatterConfig, elasticConfig: ElasticTabstopConfig): void {
    const blockSpans: IBlockSpan[] = findings.blockSpans();
    for (const span of blockSpans) {
      switch (span.blockType) {
        case eBLockType.isCon:
          formatConBlock(lines, span.startLineIdx, span.endLineIdx, findings, elasticConfig);
          break;
        case eBLockType.isVar:
          formatVarBlock(lines, span.startLineIdx, span.endLineIdx, findings, elasticConfig);
          break;
        case eBLockType.isObj:
          formatObjBlock(lines, span.startLineIdx, span.endLineIdx, findings, elasticConfig);
          break;
        case eBLockType.isDat:
          formatDatBlock(lines, span.startLineIdx, span.endLineIdx, findings, elasticConfig);
          break;
        case eBLockType.isPub:
        case eBLockType.isPri:
          formatMethodBlock(lines, span.startLineIdx, span.endLineIdx, findings, elasticConfig, config.indentSize);
          break;
      }
    }
  }

  private formatCaseAndComments(lines: string[], findings: DocumentFindings, config: FormatterConfig): void {
    const blockSpans: IBlockSpan[] = findings.blockSpans();
    const caseConfig: CaseConfig = {
      blockNameCase: config.blockNameCase,
      controlFlowCase: config.controlFlowCase,
      methodCase: config.methodCase,
      typeCase: config.typeCase,
      constantCase: config.constantCase,
      pasmInstructionCase: config.pasmInstructionCase
    };

    // Extract CON constants for constantCase normalization
    const conConstants = extractConConstants(lines, blockSpans);

    for (const span of blockSpans) {
      if (span.blockType === eBLockType.isPub || span.blockType === eBLockType.isPri) {
        normalizeMethodBlockCase(lines, span.startLineIdx, span.endLineIdx, findings, caseConfig, conConstants);
      } else if (span.blockType === eBLockType.isDat) {
        normalizeDatBlockCase(lines, span.startLineIdx, span.endLineIdx, findings, caseConfig, conConstants);
      } else {
        normalizeNonCodeBlockCase(lines, span.startLineIdx, span.endLineIdx, findings, caseConfig, conConstants);
      }
    }
    // Comment spacing across entire file
    normalizeCommentSpacing(lines, 0, lines.length - 1, findings, config.spaceAfterCommentStart);
  }

  private convertTabsToSpaces(lines: string[], findings: DocumentFindings, tabWidth: number): string[] {
    return lines.map((line, idx) => {
      if (findings.isLineInBlockComment(idx)) {
        return line;
      }
      if (line.indexOf('\t') === -1) {
        return line;
      }
      // tab-stop-aware expansion
      let result = '';
      let column = 0;
      for (const ch of line) {
        if (ch === '\t') {
          const spaces = tabWidth - (column % tabWidth);
          result += ' '.repeat(spaces);
          column += spaces;
        } else {
          result += ch;
          column++;
        }
      }
      return result;
    });
  }

  private trimTrailingWhitespace(lines: string[], findings: DocumentFindings): string[] {
    return lines.map((line, idx) => {
      if (findings.isLineInBlockComment(idx)) {
        return line;
      }
      return line.trimEnd();
    });
  }

  private normalizeBlankLines(lines: string[], findings: DocumentFindings, config: FormatterConfig): string[] {
    const blockSpans: IBlockSpan[] = findings.blockSpans();
    const result: string[] = [];
    let consecutiveBlanks = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isBlank = line.trim().length === 0;
      const inBlockComment = findings.isLineInBlockComment(i);

      if (inBlockComment) {
        // never touch block comment content
        consecutiveBlanks = 0;
        result.push(line);
        continue;
      }

      if (isBlank) {
        consecutiveBlanks++;
        // check if this blank line is in a gap between sections
        const desiredBlanks = this.getDesiredBlanksAt(i, blockSpans, config);
        if (desiredBlanks !== undefined) {
          // section/method boundary — handled by the boundary insertion below
          // skip this blank, we'll insert the right number when we hit the next section
          continue;
        }
        // regular blank line inside a block
        if (consecutiveBlanks <= config.maxConsecutiveBlankLines) {
          result.push(line);
        }
        // else: excess blank, drop it
      } else {
        // non-blank line
        if (consecutiveBlanks > 0) {
          // we just finished a run of blanks; check if this line starts a new section/method
          const boundaryBlanks = this.getDesiredBlanksBeforeLine(i, blockSpans, config);
          if (boundaryBlanks !== undefined) {
            // remove any blanks we already added for this gap, replace with correct count
            while (result.length > 0 && result[result.length - 1].trim().length === 0) {
              result.pop();
            }
            for (let b = 0; b < boundaryBlanks; b++) {
              result.push('');
            }
          }
        }
        consecutiveBlanks = 0;
        result.push(line);
      }
    }

    return result;
  }

  private ensureBlankBeforeMethodCode(lines: string[]): string[] {
    // For each PUB/PRI method that has documentation between the declaration
    // and the first code line, ensure a blank line separates them.
    const methodRe = /^(pub|pri)\b/i;
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      result.push(lines[i]);

      if (!methodRe.test(lines[i].trimStart())) continue;

      // Found a PUB/PRI declaration.  Scan forward for the first code line.
      let hasDoc = false;
      let firstCodeIdx = -1;
      for (let j = i + 1; j < lines.length; j++) {
        const trimmed = lines[j].trimStart();
        if (trimmed.length === 0) continue; // blank line
        if (trimmed.startsWith("'") || trimmed.startsWith('{')) {
          hasDoc = true;
          continue; // comment (doc or otherwise)
        }
        if (methodRe.test(trimmed)) break; // hit next method without finding code
        firstCodeIdx = j;
        break;
      }

      if (!hasDoc || firstCodeIdx < 0) continue; // no doc, or no code — skip

      // Check if there's already a blank line before the first code line
      if (firstCodeIdx > 0 && lines[firstCodeIdx - 1].trim().length === 0) continue;

      // Push lines up to (but not including) the first code line, then insert blank
      for (let j = i + 1; j < firstCodeIdx; j++) {
        result.push(lines[j]);
      }
      result.push(''); // the blank separator
      // Continue the main loop from the first code line
      i = firstCodeIdx - 1; // -1 because the for loop will i++
    }

    return result;
  }

  private removeBlankAfterMethodDecl(lines: string[]): string[] {
    // Remove blank lines between a PUB/PRI declaration and its documentation.
    // The declaration and doc comments should be visually connected.
    const methodRe = /^(pub|pri)\b/i;
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      result.push(lines[i]);

      if (!methodRe.test(lines[i].trimStart())) continue;

      // Skip blank lines immediately after the declaration
      let j = i + 1;
      while (j < lines.length && lines[j].trim().length === 0) {
        j++;
      }

      // If the next non-blank line is a comment (method documentation), drop the blanks
      if (j < lines.length && j > i + 1) {
        const nextTrimmed = lines[j].trimStart();
        if (nextTrimmed.startsWith("'") || nextTrimmed.startsWith('{')) {
          // Skip the blank lines — continue from the first comment
          i = j - 1; // -1 because the for loop will i++
        }
      }
    }

    return result;
  }

  private getDesiredBlanksAt(_lineIdx: number, _blockSpans: IBlockSpan[], _config: FormatterConfig): number | undefined {
    // Check if this blank line is between two block spans.
    // We use getDesiredBlanksBeforeLine instead when we encounter the non-blank line.
    return undefined;
  }

  private getDesiredBlanksBeforeLine(lineIdx: number, blockSpans: IBlockSpan[], config: FormatterConfig): number | undefined {
    // Is this line the start of a block span?
    for (let i = 0; i < blockSpans.length; i++) {
      const span = blockSpans[i];
      if (span.startLineIdx === lineIdx && i > 0) {
        const prevSpan = blockSpans[i - 1];
        const isMethodTransition =
          (prevSpan.blockType === eBLockType.isPub || prevSpan.blockType === eBLockType.isPri) &&
          (span.blockType === eBLockType.isPub || span.blockType === eBLockType.isPri);
        if (isMethodTransition) {
          return config.blankLinesBetweenMethods;
        }
        return config.blankLinesBetweenSections;
      }
    }
    return undefined;
  }

  private ensureFinalNewline(lines: string[]): string[] {
    if (lines.length === 0) {
      return [''];
    }
    // remove trailing empty lines beyond one
    while (lines.length > 1 && lines[lines.length - 1].trim().length === 0) {
      lines.pop();
    }
    // ensure the last entry causes a trailing newline when joined with \n
    if (lines[lines.length - 1].length > 0) {
      lines.push('');
    }
    return lines;
  }

  private convertSpacesToTabs(lines: string[], findings: DocumentFindings, tabWidth: number): string[] {
    return lines.map((line, idx) => {
      if (findings.isLineInBlockComment(idx)) {
        return line;
      }
      // Count leading spaces
      let leadingSpaces = 0;
      while (leadingSpaces < line.length && line[leadingSpaces] === ' ') {
        leadingSpaces++;
      }
      if (leadingSpaces === 0) {
        return line;
      }
      // Convert: every tabWidth spaces → one tab, remainder stays as spaces
      const tabs = Math.floor(leadingSpaces / tabWidth);
      const remainingSpaces = leadingSpaces % tabWidth;
      return '\t'.repeat(tabs) + ' '.repeat(remainingSpaces) + line.substring(leadingSpaces);
    });
  }
}
