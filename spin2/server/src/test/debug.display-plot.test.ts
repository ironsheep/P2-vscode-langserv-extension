'use strict';
// server/src/test/debug.display-plot.test.ts
//
// PLOT display-type directive hover.
//
// PLOT is the second type populated in the per-display-type registry, and the
// one that proves the registry earns its keep: the SAME directive word carries a
// DIFFERENT meaning on PLOT than on TERM. The central test here is that SIZE
// resolves to PIXELS on PLOT and CHARACTERS on TERM, from one fixture.
//
// The rest pin the documented TRAPS, which are the reason these hovers exist at
// all -- a user who reads only the signature will get each of them wrong:
//   OPACITY   wraps mod 256, so 256 -> 0 = fully transparent
//   CARTESIAN defaults to origin BOTTOM-LEFT / y-UP, not the screen convention
//   PRECISE   is a TOGGLE that starts OFF, not a set-on directive
//   TEXTSTYLE weight bits do not render as a weight progression
//   OBOX      is ROUNDED, not merely outlined

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver-types';
import { createTestContext } from './testContext';
import { DocumentFindings } from '../parser/spin.semantic.findings';
import { ProcessedDocument } from '../DocumentProcessor';
import { Spin2DocumentSymbolParser } from '../parser/spin2.documentSymbolParser';
import { Spin2DocumentSemanticParser } from '../parser/spin2.documentSemanticParser';
import HoverProvider from '../providers/HoverProvider';

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures');
const FIXTURE = 'debug-display-plot.spin2';

let fixtureLines: string[] = [];
let hoverProvider: HoverProvider;
let docUri: string = '';

function setupFixture(): void {
  const filePath = path.join(FIXTURES_DIR, FIXTURE);
  const content = fs.readFileSync(filePath, 'utf-8');
  fixtureLines = content.split(/\r?\n/);
  docUri = `file://${filePath}`;
  const document = TextDocument.create(docUri, 'spin2', 0, content);

  const ctx = createTestContext();
  const findings = new DocumentFindings(document.uri);
  findings.setFilename(document.uri);

  new Spin2DocumentSymbolParser(ctx).reportDocumentSymbols(document, findings);
  new Spin2DocumentSemanticParser(ctx).reportDocumentSemanticTokens(document, findings, path.dirname(document.uri));

  ctx.docsByFSpec.set(filePath, new ProcessedDocument(document, findings));
  hoverProvider = new HoverProvider(ctx);
}

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
  const contents = hover.contents as { kind: string; value: string };
  return contents.value ?? '';
}

const PLOT_CONFIG = 'DEBUG(`PLOT Canvas POS';
const TERM_CONFIG = 'DEBUG(`TERM Panel SIZE';

describe('PLOT display directives (hover)', function () {
  before(function () {
    setupFixture();
  });

  // ---- the point of the registry: same word, different display type -------

  it('SIZE on PLOT is documented in PIXELS', async function () {
    const text = await hoverTextAt(PLOT_CONFIG, 'SIZE');
    assert.ok(/PIXELS/i.test(text), `expected the PLOT sense of SIZE (pixels), got:\n${text}`);
  });

  it('SIZE on TERM is still documented in CHARACTERS', async function () {
    const text = await hoverTextAt(TERM_CONFIG, 'SIZE');
    assert.ok(/CHARACTERS/i.test(text), `expected the TERM sense of SIZE (characters), got:\n${text}`);
  });

  it('the two SIZE hovers are not the same text', async function () {
    const plotText = await hoverTextAt(PLOT_CONFIG, 'SIZE');
    const termText = await hoverTextAt(TERM_CONFIG, 'SIZE');
    assert.notStrictEqual(plotText, termText, 'PLOT and TERM must not collapse to one shared SIZE doc');
  });

  // ---- config-phase directives --------------------------------------------

  it('DOTSIZE resolves and notes the PC_MOUSE coupling', async function () {
    const text = await hoverTextAt(PLOT_CONFIG, 'DOTSIZE');
    assert.ok(text.length > 0, 'expected a hover for DOTSIZE, got nothing');
    assert.ok(/PC_MOUSE/i.test(text), `DOTSIZE also divides reported mouse coords -- expected that noted, got:\n${text}`);
  });

  // ---- update-phase directives --------------------------------------------

  it('LINESIZE resolves on a PLOT update line', async function () {
    const text = await hoverTextAt('DEBUG(`Canvas SET', 'LINESIZE');
    assert.ok(text.length > 0, 'expected a hover for LINESIZE, got nothing');
  });

  it('OPACITY documents the mod-256 WRAP trap', async function () {
    const text = await hoverTextAt('DEBUG(`Canvas COLOR', 'OPACITY');
    assert.ok(text.length > 0, 'expected a hover for OPACITY, got nothing');
    assert.ok(/wrap/i.test(text), `expected the wrap trap documented, got:\n${text}`);
    assert.ok(/transparent/i.test(text), `expected the 256 -> 0 fully-transparent consequence, got:\n${text}`);
  });

  it('CARTESIAN documents the BOTTOM-LEFT / y-up default', async function () {
    const text = await hoverTextAt('DEBUG(`Canvas CARTESIAN', 'CARTESIAN');
    assert.ok(text.length > 0, 'expected a hover for CARTESIAN, got nothing');
    assert.ok(/BOTTOM-LEFT/i.test(text), `expected the default orientation documented, got:\n${text}`);
  });

  it('PRECISE is documented as a TOGGLE that starts off', async function () {
    const text = await hoverTextAt('DEBUG(`Canvas CARTESIAN', 'PRECISE');
    assert.ok(text.length > 0, 'expected a hover for PRECISE, got nothing');
    assert.ok(/toggle/i.test(text), `expected PRECISE documented as a toggle, got:\n${text}`);
  });

  it('OBOX is documented as ROUNDED, not merely outlined', async function () {
    const text = await hoverTextAt('DEBUG(`Canvas OBOX', 'OBOX');
    assert.ok(text.length > 0, 'expected a hover for OBOX, got nothing');
    assert.ok(/rounded/i.test(text), `expected OBOX documented as rounded, got:\n${text}`);
  });

  it('TEXTSTYLE documents that the weight bits do not bolden', async function () {
    const text = await hoverTextAt('DEBUG(`Canvas RGB24', 'TEXTSTYLE');
    assert.ok(text.length > 0, 'expected a hover for TEXTSTYLE, got nothing');
    assert.ok(/weight/i.test(text), `expected the weight-field trap documented, got:\n${text}`);
  });

  it('SPRITEDEF documents that colors are read until end of message', async function () {
    const text = await hoverTextAt('DEBUG(`Canvas SPRITEDEF', 'SPRITEDEF');
    assert.ok(text.length > 0, 'expected a hover for SPRITEDEF, got nothing');
    assert.ok(/until the message/i.test(text), `expected the palette-length caveat documented, got:\n${text}`);
  });

  // ---- color modes resolve in BOTH phases ---------------------------------

  it('a color mode resolves on a PLOT update line', async function () {
    const text = await hoverTextAt('DEBUG(`Canvas RGB24', 'RGB24');
    assert.ok(text.length > 0, 'expected a hover for the RGB24 color mode, got nothing');
    assert.ok(/color mode/i.test(text), `expected RGB24 documented as a color mode, got:\n${text}`);
  });

  // ---- PLOT's own SAVE, distinct from TERM's ------------------------------

  it("PLOT's SAVE documents the desktop-region form TERM lacks", async function () {
    const text = await hoverTextAt('DEBUG(`Canvas SAVE', 'SAVE');
    assert.ok(text.length > 0, 'expected a hover for SAVE, got nothing');
    assert.ok(/desktop region/i.test(text), `expected PLOT's l t w h desktop-region form documented, got:\n${text}`);
  });

  // ---- shared directives still fall through on PLOT -----------------------

  it('POS falls through to the shared table on PLOT', async function () {
    const text = await hoverTextAt(PLOT_CONFIG, 'POS');
    assert.ok(text.length > 0, 'expected a hover for POS, got nothing');
    assert.ok(/screen offset/i.test(text), `expected the shared POS doc, got:\n${text}`);
  });

  it('CLOSE falls through to the shared table on PLOT', async function () {
    const text = await hoverTextAt('DEBUG(`Canvas CLOSE', 'CLOSE');
    assert.ok(text.length > 0, 'expected a hover for CLOSE, got nothing');
    assert.ok(/display slots/i.test(text), `expected the shared CLOSE doc, got:\n${text}`);
  });
});
