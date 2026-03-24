'use strict';
// src/providers/DocumentFormattingProvider.ts

import * as lsp from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Provider } from '.';
import { Context } from '../context';
import { DocumentFindings, IBlockSpan, eBLockType } from '../parser/spin.semantic.findings';
import { fileSpecFromURI } from '../parser/lang.utils';
import { ElasticTabstopConfig, DEFAULT_TABSTOPS, buildRegularTabStops, alignContinuationGroups, splitTrailingComment, padToColumn, isFullLineComment, computeBlockCommentColumn, findCurlyBlockCommentLines } from '../formatter/spin2.formatter.base';
import { formatConBlock } from '../formatter/spin2.formatter.con';
import { formatVarBlock } from '../formatter/spin2.formatter.var';
import { formatObjBlock } from '../formatter/spin2.formatter.obj';
import { formatDatBlock } from '../formatter/spin2.formatter.dat';
import { formatMethodBlock } from '../formatter/spin2.formatter.method';
import { CaseConfig, normalizeMethodBlockCase, normalizeDatBlockCase, normalizeNonCodeBlockCase, normalizeCommentSpacing, extractConConstants } from '../formatter/spin2.formatter.comment';

// Tab characters are always 8 columns wide — this is not configurable.
const TAB_WIDTH = 8;

interface FormatterConfig {
  enable: boolean;
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
  maxConsecutiveBlankLines: number;
  blankLinesBetweenSections: number;
  blankLinesBetweenMethods: number;
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

    const config = await this.getFormatterConfig();
    if (!config.enable) {
      return null;
    }

    const elasticConfig = await this.getElasticTabstopConfig(config);

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

  private async getFormatterConfig(): Promise<FormatterConfig> {
    const raw = await this.ctx.connection.workspace.getConfiguration('spinExtension.formatter');

    return {
      enable: raw?.['enable'] === true,
      trimTrailingWhitespace: raw?.['trimTrailingWhitespace'] !== false,
      insertFinalNewline: raw?.['insertFinalNewline'] !== false,
      maxConsecutiveBlankLines: typeof raw?.['maxConsecutiveBlankLines'] === 'number' ? raw['maxConsecutiveBlankLines'] : 1, // within section bodies only
      blankLinesBetweenSections: typeof raw?.['blankLinesBetweenSections'] === 'number' ? raw['blankLinesBetweenSections'] : 1, // independent of maxConsecutiveBlankLines
      blankLinesBetweenMethods: typeof raw?.['blankLinesBetweenMethods'] === 'number' ? raw['blankLinesBetweenMethods'] : 2, // independent of maxConsecutiveBlankLines
      indentSize: typeof raw?.['indentSize'] === 'number' ? raw['indentSize'] : 2,
      blockNameCase: typeof raw?.['blockNameCase'] === 'string' ? raw['blockNameCase'] : 'uppercase',
      controlFlowCase: typeof raw?.['controlFlowCase'] === 'string' ? raw['controlFlowCase'] : 'preserve',
      methodCase: typeof raw?.['methodCase'] === 'string' ? raw['methodCase'] : 'preserve',
      typeCase: typeof raw?.['typeCase'] === 'string' ? raw['typeCase'] : 'uppercase',
      constantCase: typeof raw?.['constantCase'] === 'string' ? raw['constantCase'] : 'uppercase',
      pasmInstructionCase: typeof raw?.['pasmInstructionCase'] === 'string' ? raw['pasmInstructionCase'] : 'preserve',
      spaceAfterCommentStart: raw?.['spaceAfterCommentStart'] !== false
    };
  }

  private async getElasticTabstopConfig(config: FormatterConfig): Promise<ElasticTabstopConfig> {
    const raw = await this.ctx.connection.workspace.getConfiguration('spinExtension.elasticTabstops');
    const enabled = raw?.['enable'] === true;
    if (!enabled) {
      // Spaces mode: regular grid from indentSize, fixed comment gap
      return { enabled: false, tabStops: buildRegularTabStops(config.indentSize), commentGap: 2 * config.indentSize };
    }
    const choice: string = raw?.['choice'] || 'PropellerTool';
    const blocksRaw = await this.ctx.connection.workspace.getConfiguration(`spinExtension.elasticTabstops.blocks.${choice}`);
    const tabStops: Record<string, number[]> = {};
    for (const section of ['con', 'var', 'obj', 'pub', 'pri', 'dat']) {
      tabStops[section] = blocksRaw?.[section]?.tabStops || DEFAULT_TABSTOPS[section] || [];
    }
    // Elastic mode: use tabstop-snapping for comments (commentGap = 0)
    return { enabled: true, tabStops, commentGap: 0 };
  }

  private formatLines(lines: string[], findings: DocumentFindings, config: FormatterConfig, elasticConfig: ElasticTabstopConfig): string[] {
    let result: string[] = [...lines];

    // Phase 1a: Tab-to-space conversion (tabs are always 8 columns wide)
    result = this.convertTabsToSpaces(result, findings, TAB_WIDTH);

    // Phase 1b: Trailing whitespace trimming
    if (config.trimTrailingWhitespace) {
      result = this.trimTrailingWhitespace(result, findings);
    }

    // Phase 2-4: Section column alignment and method formatting
    // Elastic mode uses profile-defined tabstops; Spaces mode uses a
    // regular grid derived from indentSize.
    this.formatSections(result, findings, config, elasticConfig);

    // Phase 2b: Merge comment columns across consecutive small same-type blocks
    this.mergeSmallBlockComments(result, findings, elasticConfig);

    // Phase 6: Case normalization and comment spacing
    this.formatCaseAndComments(result, findings, config);

    // Phase 5: Align `...` line-continuation markers vertically within groups
    const defaultStops = elasticConfig.tabStops['pub'] || elasticConfig.tabStops['con'] || [];
    alignContinuationGroups(result, elasticConfig.commentGap, defaultStops);

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

    // Phase 7: Tab compression (spaces mode only)
    // Elastic mode uses pure spaces — tab characters would corrupt non-8-aligned columns.
    // Spaces mode compresses runs of spaces with tab characters at 8-column boundaries.
    // Rescan block comment lines from the CURRENT lines — earlier phases may have
    // added/removed lines, shifting indices so the original findings are stale.
    if (!elasticConfig.enabled) {
      const blockCommentLines = findCurlyBlockCommentLines(result, 0, result.length - 1);
      result = this.convertSpacesToTabs(result, blockCommentLines, TAB_WIDTH);
    }

    return result;
  }

  private formatSections(lines: string[], findings: DocumentFindings, config: FormatterConfig, elasticConfig: ElasticTabstopConfig): void {
    const blockSpans: IBlockSpan[] = findings.blockSpans();

    // Method body indent step: in elastic mode, derive from the profile's
    // first PUB tabstop (e.g., IronSheep=4, PropellerTool=2).
    // In spaces mode, use the user's configured indentSize.
    let methodIndent = config.indentSize;
    if (elasticConfig.enabled) {
      const pubStops = elasticConfig.tabStops['pub'] || [];
      if (pubStops.length > 0) {
        methodIndent = pubStops[0];
      }
    }

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
          formatMethodBlock(lines, span.startLineIdx, span.endLineIdx, findings, elasticConfig, methodIndent);
          break;
      }
    }
  }

  /**
   * Post-processing pass: merge trailing comment columns across consecutive
   * same-type blocks when each block is small (under SMALL_BLOCK_THRESHOLD lines).
   * This prevents jagged comment columns when several small CON (or VAR, OBJ, DAT)
   * blocks appear in sequence.
   */
  private mergeSmallBlockComments(lines: string[], findings: DocumentFindings, elasticConfig: ElasticTabstopConfig): void {
    const SMALL_BLOCK_THRESHOLD = 15;
    const blockSpans: IBlockSpan[] = findings.blockSpans();

    // Find runs of consecutive same-type small blocks
    let runStart = 0;
    while (runStart < blockSpans.length) {
      const runType = blockSpans[runStart].blockType;
      const runSize = blockSpans[runStart].endLineIdx - blockSpans[runStart].startLineIdx + 1;

      // Skip PUB/PRI — methods have their own comment alignment
      if (runType === eBLockType.isPub || runType === eBLockType.isPri || runSize > SMALL_BLOCK_THRESHOLD) {
        runStart++;
        continue;
      }

      // Extend the run: consecutive same-type blocks, each under threshold
      let runEnd = runStart;
      while (runEnd + 1 < blockSpans.length &&
             blockSpans[runEnd + 1].blockType === runType &&
             blockSpans[runEnd + 1].endLineIdx - blockSpans[runEnd + 1].startLineIdx + 1 <= SMALL_BLOCK_THRESHOLD) {
        runEnd++;
      }

      // Only merge if there are 2+ blocks in the run
      if (runEnd > runStart) {
        const firstLine = blockSpans[runStart].startLineIdx;
        const lastLine = blockSpans[runEnd].endLineIdx;
        this.unifyCommentColumn(lines, firstLine, lastLine, findings, elasticConfig);
      }

      runStart = runEnd + 1;
    }
  }

  /** Re-align trailing comments across a range of lines to a single column. */
  private unifyCommentColumn(
    lines: string[],
    startLine: number,
    endLine: number,
    findings: DocumentFindings,
    elasticConfig: ElasticTabstopConfig
  ): void {
    const entries: { lineIdx: number; codePart: string; commentPart: string }[] = [];
    const contentEndCols: number[] = [];

    for (let i = startLine; i <= endLine; i++) {
      if (findings.isLineInBlockComment(i)) continue;
      const line = lines[i];
      if (line.trim().length === 0) continue;
      if (isFullLineComment(line)) continue;

      const [codePart, commentPart] = splitTrailingComment(line);
      if (commentPart.length > 0) {
        const trimmedCode = codePart.trimEnd();
        entries.push({ lineIdx: i, codePart: trimmedCode, commentPart });
        contentEndCols.push(trimmedCode.length);
      }
    }

    if (entries.length < 2) return;

    const tabStops = elasticConfig.tabStops['con'] || [];
    const commentCol = computeBlockCommentColumn(contentEndCols, tabStops, elasticConfig.commentGap);

    for (const entry of entries) {
      lines[entry.lineIdx] = padToColumn(entry.codePart, commentCol) + entry.commentPart;
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

  private convertSpacesToTabs(lines: string[], blockCommentLines: Set<number>, tabWidth: number): string[] {
    return lines.map((line, idx) => {
      if (blockCommentLines.has(idx)) {
        return line;
      }
      if (line.indexOf(' ') === -1) {
        return line;
      }
      // Convert all runs of spaces to tabs + remainder spaces, not just leading.
      // Walk the line tracking the column position so tab stops are computed correctly.
      let result = '';
      let i = 0;
      let column = 0;
      while (i < line.length) {
        if (line[i] === ' ') {
          // Collect the full run of consecutive spaces
          const runStart = column;
          let runSpaces = 0;
          while (i < line.length && line[i] === ' ') {
            i++;
            runSpaces++;
          }
          const runEnd = runStart + runSpaces;
          // Replace with tabs that snap to tab-stop boundaries, plus remainder spaces
          let pos = runStart;
          while (pos < runEnd) {
            const nextStop = (Math.floor(pos / tabWidth) + 1) * tabWidth;
            if (nextStop <= runEnd) {
              result += '\t';
              pos = nextStop;
            } else {
              result += ' '.repeat(runEnd - pos);
              pos = runEnd;
            }
          }
          column = runEnd;
        } else {
          result += line[i];
          i++;
          column++;
        }
      }
      return result;
    });
  }
}
