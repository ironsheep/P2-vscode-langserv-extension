'use strict';
// server/src/test/debug.directive-doctext.test.ts
//
// Regression tests for RAW HTML ENTITIES leaking into rendered hover text.
//
// Hover content is markdown (MarkupKind.Markdown). Inside a markdown CODE SPAN
// entities are NOT decoded -- they are literal text. So doc text written as
//
//     'Default caption is `&lt;name&gt; - &lt;TYPE&gt;`.'
//
// renders to the user as the literal `&lt;name&gt; - &lt;TYPE&gt;`, not `<name> - <TYPE>`.
// Angle brackets inside backticks must be written LITERALLY; the code span is
// what protects them from being parsed as HTML.
//
// The table scan below is the real guard: 3acfec4 populated only the shared and
// TERM directive tables, noting the other 8 display types "drop into the same
// tables and are not yet populated". This test fails the moment any future entry
// reintroduces an entity, in any of the tables.

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
import { Spin2ParseUtils } from '../parser/spin2.utils';
import HoverProvider from '../providers/HoverProvider';

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures');
const FIXTURE = 'debug-directive-doctext.spin2';

// entities that must never appear pre-encoded in doc text
const ENTITY_RE = /&(lt|gt|amp|quot|#\d+);/;

interface IDirectiveEntry {
  signature: string;
  description: string;
}
type TDirectiveTable = Record<string, IDirectiveEntry>;
interface IDisplayDirectiveSets {
  config?: TDirectiveTable;
  feed?: TDirectiveTable;
}

/**
 * Every doc table feeding docTextForDebugDirective(), as [label, table] pairs.
 *
 * The per-type tables are read from the _debugDirectivesByDisplayType REGISTRY
 * rather than a hardcoded list, so each display type added there is scanned
 * automatically -- the guard grows with the content instead of going stale.
 */
function allDirectiveTables(): Array<[string, TDirectiveTable]> {
  const utils = new Spin2ParseUtils();
  // tables are a private implementation detail; reach them deliberately
  const priv = utils as unknown as Record<string, unknown>;

  const shared = priv['_tableDebugDirectivesShared'] as TDirectiveTable | undefined;
  const colors = priv['_tableDebugColorNames'] as TDirectiveTable | undefined;
  const registry = priv['_debugDirectivesByDisplayType'] as Record<string, IDisplayDirectiveSets> | undefined;
  assert.ok(shared, 'expected _tableDebugDirectivesShared -- was it renamed?');
  assert.ok(colors, 'expected _tableDebugColorNames -- was it renamed?');
  assert.ok(registry, 'expected _debugDirectivesByDisplayType -- was it renamed?');

  const tables: Array<[string, TDirectiveTable]> = [
    ['shared', shared],
    ['colorNames', colors]
  ];
  for (const [typeName, sets] of Object.entries(registry)) {
    if (sets.config) {
      tables.push([`${typeName}.config`, sets.config]);
    }
    if (sets.feed) {
      tables.push([`${typeName}.feed`, sets.feed]);
    }
  }
  return tables;
}

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

describe('DEBUG directive doc text (no raw HTML entities)', function () {
  before(function () {
    setupFixture();
  });

  // ---- the guard: scan every table entry ----------------------------------

  allDirectiveTables().forEach(function ([tableName, table]) {
    it(`${tableName} has no pre-encoded HTML entities`, function () {
      const offenders: string[] = [];
      for (const [key, entry] of Object.entries(table)) {
        if (ENTITY_RE.test(entry.description)) {
          offenders.push(`${tableName}.${key}.description: ${entry.description}`);
        }
        if (ENTITY_RE.test(entry.signature)) {
          offenders.push(`${tableName}.${key}.signature: ${entry.signature}`);
        }
      }
      assert.deepStrictEqual(
        offenders,
        [],
        `doc text must use LITERAL angle brackets -- inside a markdown code span an entity renders raw:\n  ${offenders.join('\n  ')}`
      );
    });
  });

  // ---- end-to-end: what the user actually sees ----------------------------

  it('TITLE hover shows literal <name> - <TYPE>, not entities', async function () {
    const text = await hoverTextAt('DEBUG(`TERM Panel TITLE', 'TITLE');
    assert.ok(text.length > 0, 'expected a hover for the TITLE directive, got nothing');
    assert.ok(!ENTITY_RE.test(text), `rendered hover must not contain raw entities, got:\n${text}`);
    assert.ok(text.includes('<name> - <TYPE>'), `expected the literal default-caption text, got:\n${text}`);
  });

  // ---- registry dispatch: the per-type tables are still reachable ---------

  it('resolves a TERM CONFIG directive through the registry (SIZE is in CHARACTERS)', async function () {
    const text = await hoverTextAt('DEBUG(`TERM Panel TITLE', 'SIZE');
    assert.ok(text.length > 0, 'expected a hover for the SIZE config directive, got nothing');
    assert.ok(/CHARACTERS/i.test(text), `expected the TERM CONFIG sense of SIZE, got:\n${text}`);
  });

  it('WINDOW resolves as the SAVE modifier, not nothing', async function () {
    const text = await hoverTextAt('DEBUG(`Panel SAVE WINDOW', 'WINDOW');
    assert.ok(text.length > 0, 'expected a hover for the WINDOW modifier of SAVE, got nothing');
    assert.ok(/modifier of/i.test(text), `expected WINDOW documented as a SAVE modifier, got:\n${text}`);
  });

  it('SAVE hover shows literal <filename>.bmp, not entities', async function () {
    const text = await hoverTextAt('DEBUG(`Panel SAVE', 'SAVE');
    assert.ok(text.length > 0, 'expected a hover for the SAVE directive, got nothing');
    assert.ok(!ENTITY_RE.test(text), `rendered hover must not contain raw entities, got:\n${text}`);
    assert.ok(text.includes('<filename>.bmp'), `expected the literal output-file text, got:\n${text}`);
  });
});
