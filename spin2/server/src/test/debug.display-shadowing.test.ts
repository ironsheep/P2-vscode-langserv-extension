'use strict';
// server/src/test/debug.display-shadowing.test.ts
//
// Regression tests for DEBUG display-name PRECEDENCE -- the question left open
// by 883a6b7 ("a window name that collides with a Spin2 built-in still resolves
// to the built-in doc in both positions").
//
// The rule is POSITIONAL, and these tests exist to pin that down:
//
//   at the window-name position (first name after the back-tic) -> the WINDOW wins
//   anywhere else on the line                                   -> the built-in /
//                                                                  directive wins
//
// The second half matters as much as the first: a precedence rule written as
// "known display name beats built-in" with no position check silently eats the
// directive hovers added in 3acfec4, because display-name lookup is
// case-insensitive (a window named `Clear` would capture the CLEAR directive).

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
const FIXTURE = 'debug-display-shadowing.spin2';

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

  // HoverProvider.handleGetHover() resolves the document through ctx.docsByFSpec,
  //  keyed by FSPEC (no scheme) -- not by URI.
  ctx.docsByFSpec.set(filePath, new ProcessedDocument(document, findings));
  hoverProvider = new HoverProvider(ctx);
}

/** 0-based index of the single fixture line containing {needle}. */
function lineIndexContaining(needle: string): number {
  const idx = fixtureLines.findIndex((l) => l.includes(needle));
  assert.notStrictEqual(idx, -1, `fixture must contain a line with [${needle}]`);
  return idx;
}

/**
 * Drive the REAL HoverProvider at the first character of {word} on the single
 * fixture line containing {lineNeedle}, and return the rendered hover markdown
 * ('' when hover returns nothing).
 */
async function hoverTextAt(lineNeedle: string, word: string): Promise<string> {
  const lineIdx = lineIndexContaining(lineNeedle);
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

describe('DEBUG display-name shadowing (hover precedence)', function () {
  before(function () {
    setupFixture();
  });

  // ---- window WINS at the window-name position ----------------------------

  it('window named after a built-in resolves to the WINDOW in a declaration', async function () {
    const text = await hoverTextAt('`TERM FIELD SIZE', 'FIELD');
    assert.ok(/instance of TERM/i.test(text), `expected the WINDOW doc for FIELD, got:\n${text}`);
  });

  it('window named after a built-in resolves to the WINDOW in an update message', async function () {
    const text = await hoverTextAt("`FIELD 'val=", 'FIELD');
    assert.ok(/instance of TERM/i.test(text), `expected the WINDOW doc for FIELD, got:\n${text}`);
  });

  it('the window hover NOTES that the name shadows a built-in', async function () {
    const text = await hoverTextAt("`FIELD 'val=", 'FIELD');
    assert.ok(/shadow/i.test(text), `expected a shadowing NOTE in the hover, got:\n${text}`);
  });

  // ---- built-in / directive WINS everywhere else --------------------------

  it("REGRESSION: the CLEAR directive on another window's line is NOT the window named CLEAR", async function () {
    const text = await hoverTextAt('`Panel CLEAR', 'CLEAR');
    assert.ok(text.length > 0, 'expected a hover for the CLEAR directive, got nothing');
    assert.ok(
      !/instance of TERM/i.test(text),
      `CLEAR here is the shared display DIRECTIVE, not the window named CLEAR.\n` +
        `A precedence rule with no position check wrongly returns the window. Got:\n${text}`
    );
  });

  // ---- unaffected baseline ------------------------------------------------

  it('an ordinary window name with no collision still resolves to the window', async function () {
    const text = await hoverTextAt("`Status 'ok'", 'Status');
    assert.ok(/instance of TERM/i.test(text), `expected the WINDOW doc for Status, got:\n${text}`);
  });

  it('an ordinary window name carries NO shadowing note', async function () {
    const text = await hoverTextAt("`Status 'ok'", 'Status');
    assert.ok(!/shadow/i.test(text), `expected NO shadowing note for Status, got:\n${text}`);
  });
});
