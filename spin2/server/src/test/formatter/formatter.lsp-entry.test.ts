'use strict';
// server/src/test/formatter/formatter.lsp-entry.test.ts
//
// The language server's way into the formatter: which requests it answers, the settings it
// reads from the client, and the edit it sends back. Other formatter tests start past this
// point, at formatLines().

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import DocumentFormattingProvider from '../../providers/DocumentFormattingProvider';
import { DocumentFindings } from '../../parser/spin.semantic.findings';
import { Spin2DocumentSymbolParser } from '../../parser/spin2.documentSymbolParser';
import { Spin2DocumentSemanticParser } from '../../parser/spin2.documentSemanticParser';
import { Context } from '../../context';
import { createTestContext } from '../testContext';
import { DEFAULT_FORMATTER_CONFIG } from './formatter.test-utils';

const URI = 'file:///formatter-test/source.spin2';
const REQUEST_OPTIONS: lsp.FormattingOptions = { tabSize: 8, insertSpaces: true };

type Settings = Record<string, unknown>;

function contextWith(sections: Record<string, Settings>): Context {
  const ctx = createTestContext();
  (ctx.connection as unknown as { workspace: unknown }).workspace = {
    getConfiguration: (section: string) => Promise.resolve(sections[section])
  };
  return ctx;
}

function openDocument(ctx: Context, text: string, uri: string = URI): void {
  const document = TextDocument.create(uri, 'spin2', 0, text);
  const findings = new DocumentFindings(uri);
  findings.setFilename(uri);
  new Spin2DocumentSymbolParser(ctx).reportDocumentSymbols(document, findings);
  new Spin2DocumentSemanticParser(ctx).reportDocumentSemanticTokens(document, findings, '/formatter-test');
  (ctx.docsByFSpec as Map<string, unknown>).set(uri.replace('file://', ''), { document, parseResult: findings });
}

type FormatHandler = (params: lsp.DocumentFormattingParams) => Promise<lsp.TextEdit[] | null>;

function requestFormat(ctx: Context, uri: string = URI): Promise<lsp.TextEdit[] | null> {
  let handler: FormatHandler | undefined;
  const connection = { onDocumentFormatting: (registered: FormatHandler) => (handler = registered) };
  new DocumentFormattingProvider(ctx).register(connection as unknown as lsp.Connection);
  assert.ok(handler, 'provider registered no formatting handler');
  return handler({ textDocument: { uri }, options: REQUEST_OPTIONS });
}

function editedText(edits: lsp.TextEdit[] | null): string {
  assert.ok(edits, 'expected edits');
  assert.strictEqual(edits.length, 1);
  return edits[0].newText;
}

describe('Formatter: language server entry', function () {
  const UNFORMATTED = 'con\n      A = 1\n';

  it('advertises document formatting', function () {
    const connection = { onDocumentFormatting: () => {} };
    const capabilities = new DocumentFormattingProvider(createTestContext()).register(connection as unknown as lsp.Connection);
    assert.strictEqual(capabilities.documentFormattingProvider, true);
  });

  it('does nothing when the formatter is not enabled, the default', async function () {
    for (const formatter of [{}, { enable: false }]) {
      const ctx = contextWith({ 'spinExtension.formatter': formatter });
      openDocument(ctx, UNFORMATTED);
      assert.strictEqual(await requestFormat(ctx), null);
    }
  });

  it('only formats .spin2 files', async function () {
    for (const extension of ['spin', 'p2asm']) {
      const uri = `file:///formatter-test/source.${extension}`;
      const ctx = contextWith({ 'spinExtension.formatter': { enable: true } });
      openDocument(ctx, UNFORMATTED, uri);
      assert.strictEqual(await requestFormat(ctx, uri), null, extension);
    }
  });

  it('does nothing for a document the server has not parsed', async function () {
    const ctx = contextWith({ 'spinExtension.formatter': { enable: true } });
    assert.strictEqual(await requestFormat(ctx), null);
  });

  it('returns no edits when the document is already formatted', async function () {
    const ctx = contextWith({ 'spinExtension.formatter': { enable: true } });
    openDocument(ctx, 'CON\n  A  = 1\n');
    assert.strictEqual(await requestFormat(ctx), null);
  });

  it('replaces the whole document with the formatted text', async function () {
    const ctx = contextWith({ 'spinExtension.formatter': { enable: true } });
    openDocument(ctx, UNFORMATTED);
    const edits = await requestFormat(ctx);
    assert.strictEqual(editedText(edits), 'CON\n  A  = 1\n');
    assert.deepStrictEqual(edits?.[0].range, lsp.Range.create(0, 0, 3, 0));
  });

  it('reads the formatter settings from the client', async function () {
    const ctx = contextWith({ 'spinExtension.formatter': { enable: true, indentSize: 4, blockNameCase: 'lowercase' } });
    openDocument(ctx, 'CON\n  A = 1\n\nPUB main() | b\n  if b\n    b := 1\n');
    const text = editedText(await requestFormat(ctx));
    assert.ok(text.startsWith('con\n'), text);
    assert.ok(text.includes('pub main() | b\n    if b\n'), text);
  });

  it('applies the same defaults as the test suite when the client sends no settings', async function () {
    const provider = new DocumentFormattingProvider(contextWith({ 'spinExtension.formatter': { enable: true } }));
    const read = (provider as unknown as { getFormatterConfig(): Promise<unknown> }).getFormatterConfig();
    assert.deepStrictEqual(await read, DEFAULT_FORMATTER_CONFIG);
  });

  it('uses spaces mode when elastic tabstops are off', async function () {
    const ctx = contextWith({ 'spinExtension.formatter': { enable: true }, 'spinExtension.elasticTabstops': { enable: false } });
    openDocument(ctx, 'PUB main() | a\n  repeat\n    repeat\n      repeat\n        repeat\n          a := 1\n');
    assert.ok(editedText(await requestFormat(ctx)).includes('\t  a := 1'));
  });

  it('reads the elastic profile the client selected', async function () {
    const ctx = contextWith({
      'spinExtension.formatter': { enable: true },
      'spinExtension.elasticTabstops': { enable: true, choice: 'Custom' },
      'spinExtension.elasticTabstops.blocks.Custom': { pub: { tabStops: [6, 12, 18, 80] } }
    });
    openDocument(ctx, 'PUB main() | a\n  if a\n    a := 1\n');
    const text = editedText(await requestFormat(ctx));
    assert.ok(text.includes('\n      if a\n            a := 1'), text);
    assert.ok(!text.includes('\t'), text);
  });

  it('writes LF line endings for a CRLF document', async function () {
    const ctx = contextWith({ 'spinExtension.formatter': { enable: true } });
    openDocument(ctx, 'con\r\n      A = 1\r\n');
    assert.strictEqual(editedText(await requestFormat(ctx)), 'CON\n  A  = 1\n');
  });
});
