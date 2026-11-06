'use strict';
// server/src/test/fvar-rfvar.test.ts
//
// Variable-length data: the RFVAR/RFVARS instructions and the FVAR/FVARS DAT overrides.
//
// Flags and clocks are checked against P2KB (p2kbPasm2Rfvar, p2kbPasm2Rfvars, p2kbPasm2Fvar):
//   RFVAR  C = always 0, RFVARS C = MSB of the value, both Z = (result == 0), both 2 clocks.
// The binary test needs pnut-ts 1.55.10 or later, as older compilers reject every
//   non-negative FVARS value. On an older compiler it fails rather than skips.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { DiagnosticSeverity, Position } from 'vscode-languageserver-types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createTestContext } from './testContext';
import { assertFormattingPreservesBinary, formatSpin2Text } from './formatter/formatter.test-utils';
import { DocumentFindings } from '../parser/spin.semantic.findings';
import { ProcessedDocument } from '../DocumentProcessor';
import { Spin2DocumentSymbolParser } from '../parser/spin2.documentSymbolParser';
import { Spin2DocumentSemanticParser } from '../parser/spin2.documentSemanticParser';
import { Spin2ParseUtils } from '../parser/spin2.utils';
import HoverProvider from '../providers/HoverProvider';

const FIXTURE_PATH = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'fvar-rfvar.spin2');

describe('FVAR/FVARS and RFVAR/RFVARS', function () {
  let content = '';
  let fixtureLines: string[] = [];
  let docUri = '';
  let findings: DocumentFindings;
  let hoverProvider: HoverProvider;

  before(function () {
    content = fs.readFileSync(FIXTURE_PATH, 'utf-8');
    fixtureLines = content.split(/\r?\n/);
    docUri = `file://${FIXTURE_PATH}`;
    const document = TextDocument.create(docUri, 'spin2', 0, content);

    const ctx = createTestContext();
    findings = new DocumentFindings(document.uri);
    findings.setFilename(document.uri);
    new Spin2DocumentSymbolParser(ctx).reportDocumentSymbols(document, findings);
    new Spin2DocumentSemanticParser(ctx).reportDocumentSemanticTokens(document, findings, path.dirname(document.uri));
    ctx.docsByFSpec.set(FIXTURE_PATH, new ProcessedDocument(document, findings));
    hoverProvider = new HoverProvider(ctx);
  });

  /** Drive the REAL HoverProvider at the first char of {word} on the line holding {lineNeedle}. */
  async function hoverTextAt(lineNeedle: string, word: string): Promise<string> {
    const lineIdx = fixtureLines.findIndex((l) => l.includes(lineNeedle));
    assert.notStrictEqual(lineIdx, -1, `fixture must contain a line with [${lineNeedle}]`);
    const charIdx = fixtureLines[lineIdx].indexOf(word);
    assert.notStrictEqual(charIdx, -1, `line [${lineNeedle}] must contain [${word}]`);
    const hover = await hoverProvider.handleGetHover({
      textDocument: { uri: docUri },
      position: Position.create(lineIdx, charIdx)
    });
    if (hover === null) {
      return '';
    }
    return (hover.contents as { kind: string; value: string }).value ?? '';
  }

  describe('hover', function () {
    it('RFVAR says C is always 0 and takes 2 clocks', async function () {
      const text = await hoverTextAt('rfvar   first', 'rfvar');
      assert.ok(text.includes('**C flag:** Always cleared to 0'), `got:\n${text}`);
      assert.ok(text.includes('**Timing:** 2 clocks'), `got:\n${text}`);
      assert.ok(!text.includes('More bytes follow'), `stale C flag text, got:\n${text}`);
    });

    it('RFVARS says C is the sign of the result and takes 2 clocks', async function () {
      const text = await hoverTextAt('rfvars  second', 'rfvars');
      assert.ok(text.includes('**C flag:** MSB of result'), `got:\n${text}`);
      assert.ok(text.includes('**Timing:** 2 clocks'), `got:\n${text}`);
      assert.ok(text.includes('-$1000_0000..$0FFF_FFFF'), `expected the signed range, got:\n${text}`);
    });

    it('FVAR on a DAT line gives the range and names RFVAR', async function () {
      const text = await hoverTextAt('table   byte', 'FVAR');
      assert.ok(text.includes('0..$1FFF_FFFF'), `got:\n${text}`);
      assert.ok(text.includes('RFVAR'), `got:\n${text}`);
    });

    it('FVARS on a DAT line gives the range and names RFVARS', async function () {
      const text = await hoverTextAt('dlt     byte', 'FVARS');
      assert.ok(text.includes('-$1000_0000..$0FFF_FFFF'), `got:\n${text}`);
      assert.ok(text.includes('RFVARS'), `got:\n${text}`);
    });
  });

  describe('built-in tables', function () {
    ['rfbyte', 'rfword', 'rflong', 'rfvar', 'rfvars'].forEach((name) => {
      it(`${name} takes 2 clocks`, function () {
        assert.strictEqual(new Spin2ParseUtils().docTextForBuiltIn(name).timing, '2');
      });
    });

    ['fvar', 'FVAR', 'fvars', 'FVARS'].forEach((name) => {
      it(`${name} is documented but is not a storage type`, function () {
        const utils = new Spin2ParseUtils();
        assert.ok(utils.docTextForBuiltIn(name).found, 'expected hover text');
        assert.strictEqual(utils.isStorageType(name), false);
        assert.strictEqual(utils.isDatStorageType(name), false);
      });
    });
  });

  describe('parsing', function () {
    it('reports no errors', function () {
      const errors = findings.allDiagnosticMessages(100).filter((d) => d.severity === DiagnosticSeverity.Error);
      assert.deepStrictEqual(
        errors.map((d) => `L${d.range.start.line + 1}: ${d.message}`),
        []
      );
    });

    it('resolves a constant used as an FVAR operand to its real offset', function () {
      const lineIdx = fixtureLines.findIndex((l) => l.startsWith('named'));
      const line = fixtureLines[lineIdx];
      const offsets = findings
        .allSemanticTokens()
        .filter((t) => t.line === lineIdx && line.substr(t.startCharacter, t.length) === 'someValue')
        .map((t) => t.startCharacter)
        .sort((a, b) => a - b);
      assert.deepStrictEqual(offsets, [line.indexOf('someValue'), line.lastIndexOf('someValue')]);
    });
  });

  describe('formatter keyword case', function () {
    const source = 'PUB main()\n\nDAT\ntable   Byte    fVar 300, FvArS -3, fvarsNotAKeyword\n';

    it('follows typeCase uppercase, like BYTE', function () {
      const out = formatSpin2Text(source, { typeCase: 'uppercase' });
      assert.ok(/BYTE\s+FVAR 300, FVARS -3, fvarsNotAKeyword/.test(out), `got:\n${out}`);
    });

    it('follows typeCase lowercase, like BYTE', function () {
      const out = formatSpin2Text(source, { typeCase: 'lowercase' });
      assert.ok(/byte\s+fvar 300, fvars -3, fvarsNotAKeyword/.test(out), `got:\n${out}`);
    });

    it('is left as typed under typeCase preserve', function () {
      const out = formatSpin2Text(source, { typeCase: 'preserve' });
      assert.ok(out.includes('fVar 300, FvArS -3, fvarsNotAKeyword'), `got:\n${out}`);
    });
  });

  describe('formatting', function () {
    it('keeps the compiled binary and is idempotent', function () {
      const once = formatSpin2Text(content);
      assert.strictEqual(formatSpin2Text(once), once, 'formatter should be idempotent');
      const fixture = { name: 'fvar-rfvar', spin2Path: FIXTURE_PATH };
      assertFormattingPreservesBinary(fixture, once, 'Formatted FVAR fixture');
    });
  });
});
