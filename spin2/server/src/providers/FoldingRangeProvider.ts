import * as lsp from 'vscode-languageserver';
import { Provider } from '.';
import { Context } from '../context';
import { ExtensionUtils } from '../parser/spin.extension.utils';
import { fileSpecFromURI } from '../parser/lang.utils';
import { DocumentFindings, IFoldSpan, eFoldSpanType } from '../parser/spin.semantic.findings';

export default class FoldingRangeProvider implements Provider {
  private foldingLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private bLogStarted: boolean = false;
  private extensionUtils: ExtensionUtils;

  constructor(protected readonly ctx: Context) {
    this.extensionUtils = new ExtensionUtils(ctx, this.foldingLogEnabled);
    if (this.foldingLogEnabled) {
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        this._logMessage('Spin Folding log started.');
      } else {
        this._logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }
  }
  /**
   * Write message to debug log (when debug enabled)
   * @param message - text to be written
   * @returns nothing
   */
  private _logMessage(message: string): void {
    if (this.foldingLogEnabled) {
      //Write to output window.
      this.ctx.logger.log(message);
    }
  }

  async onFoldingRanges({ textDocument }: lsp.FoldingRangeParams): Promise<lsp.FoldingRange[]> {
    const docFSpec: string = fileSpecFromURI(textDocument.uri);
    const processed = this.ctx.docsByFSpec.get(docFSpec);
    if (!processed) {
      return [];
    }

    const documentFindings: DocumentFindings | undefined = this.ctx.docsByFSpec.get(docFSpec)?.parseResult;
    if (!documentFindings) {
      return []; // empty case
    }
    const symbolsFound: DocumentFindings = documentFindings;
    symbolsFound.enableLogging(this.ctx, this.foldingLogEnabled);

    const foldSpans: IFoldSpan[] = symbolsFound.allFoldSpans();

    const folds: lsp.FoldingRange[] = [];
    for (let index = 0; index < foldSpans.length; index++) {
      const foldingCodeSpan = foldSpans[index];
      const spanType: string | undefined = foldingCodeSpan.type == eFoldSpanType.Comment ? 'comment' : undefined;
      const newRange: lsp.FoldingRange = lsp.FoldingRange.create(
        foldingCodeSpan.foldstart.line,
        foldingCodeSpan.foldEnd.line,
        foldingCodeSpan.foldstart.character,
        foldingCodeSpan.foldEnd.character,
        spanType
      );
      folds.push(newRange);
    }

    return folds;
  }

  register(connection: lsp.Connection) {
    connection.onFoldingRanges(this.onFoldingRanges.bind(this));
    return {
      foldingRangeProvider: true
    };
  }
}
