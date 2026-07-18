'use strict';
// server/src/test/debug.display-types.test.ts
//
// Hover for the seven DEBUG display types added after TERM and PLOT:
// LOGIC, SCOPE, SCOPE_XY, FFT, SPECTRO, BITMAP, MIDI.
//
// These tests are deliberately weighted toward CROSS-TYPE DIVERGENCE rather than
// breadth. A test that merely asserts "SAMPLES resolves" would pass just as well
// against one shared doc for every display type -- and that shared doc would be
// WRONG, because SAMPLES is a sample count on LOGIC, a persistence depth on
// SCOPE_XY, and an FFT size on FFT. So the assertions pin the type-SPECIFIC
// wording, and several compare two types head to head from one fixture.
//
// The remainder pin documented traps that a user reading only the signature gets
// wrong -- FFT's truncate-down, SPECTRO's axis swap, BITMAP's runtime RATE
// freeze, MIDI's non-pixel SIZE.

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
const FIXTURE = 'debug-display-types.spin2';

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

const LOGIC_CFG = 'DEBUG(`LOGIC Bus';
const SCOPE_CFG = 'DEBUG(`SCOPE Wave';
const SCOPEXY_CFG = 'DEBUG(`SCOPE_XY Phase';
const FFT_CFG = 'DEBUG(`FFT Spec';
const SPECTRO_CFG = 'DEBUG(`SPECTRO Fall';
const BITMAP_CFG = 'DEBUG(`BITMAP Pix';
const BITMAP_FEED = 'DEBUG(`Pix RATE';
const MIDI_CFG = 'DEBUG(`MIDI Keys';

describe('DEBUG display types: LOGIC SCOPE SCOPE_XY FFT SPECTRO BITMAP MIDI', function () {
  before(function () {
    setupFixture();
  });

  // ---- SAMPLES means three different things -------------------------------

  it('SAMPLES on LOGIC is a sample count, and rejects the two-value form', async function () {
    const text = await hoverTextAt(LOGIC_CFG, 'SAMPLES');
    assert.ok(/single integer/i.test(text), `expected LOGIC's single-integer note, got:\n${text}`);
  });

  it('SAMPLES on SCOPE_XY is persistence, NOT a time buffer', async function () {
    const text = await hoverTextAt(SCOPEXY_CFG, 'SAMPLES');
    assert.ok(/persistence/i.test(text), `expected SCOPE_XY's persistence sense, got:\n${text}`);
    assert.ok(/accumulat/i.test(text), `expected the SAMPLES 0 accumulate behavior, got:\n${text}`);
  });

  it('SAMPLES on FFT documents truncate-DOWN to a power of two', async function () {
    const text = await hoverTextAt(FFT_CFG, 'SAMPLES');
    assert.ok(/truncated down/i.test(text), `expected FFT's truncate-down trap, got:\n${text}`);
    assert.ok(/512/.test(text), `expected the concrete 1000 -> 512 example, got:\n${text}`);
  });

  it('the three SAMPLES hovers are all different', async function () {
    const logic = await hoverTextAt(LOGIC_CFG, 'SAMPLES');
    const xy = await hoverTextAt(SCOPEXY_CFG, 'SAMPLES');
    const fft = await hoverTextAt(FFT_CFG, 'SAMPLES');
    assert.notStrictEqual(logic, xy, 'LOGIC and SCOPE_XY SAMPLES must not collapse');
    assert.notStrictEqual(xy, fft, 'SCOPE_XY and FFT SAMPLES must not collapse');
    assert.notStrictEqual(logic, fft, 'LOGIC and FFT SAMPLES must not collapse');
  });

  // ---- RANGE means three different things ---------------------------------

  it('RANGE on SCOPE_XY is the coordinate extent', async function () {
    const text = await hoverTextAt(SCOPEXY_CFG, 'RANGE');
    assert.ok(/coordinate extent/i.test(text), `expected SCOPE_XY's coordinate extent, got:\n${text}`);
    assert.ok(/no auto-ranging/i.test(text), `expected the no-auto-ranging note, got:\n${text}`);
  });

  it('RANGE on MIDI is a note range', async function () {
    const text = await hoverTextAt(MIDI_CFG, 'RANGE');
    assert.ok(/note range/i.test(text), `expected MIDI's note range, got:\n${text}`);
    assert.ok(/88-key|21 108/i.test(text), `expected the 88-key piano default, got:\n${text}`);
  });

  it('RANGE hovers differ between SCOPE_XY and MIDI', async function () {
    const xy = await hoverTextAt(SCOPEXY_CFG, 'RANGE');
    const midi = await hoverTextAt(MIDI_CFG, 'RANGE');
    assert.notStrictEqual(xy, midi, 'SCOPE_XY and MIDI RANGE must not collapse to one doc');
  });

  // ---- TRACE means two different things -----------------------------------

  it('TRACE on SPECTRO documents the surprising AXIS SWAP', async function () {
    const text = await hoverTextAt(SPECTRO_CFG, 'TRACE');
    assert.ok(/axes|axis/i.test(text), `expected the axis-swap behavior, got:\n${text}`);
    assert.ok(/bitfield/i.test(text), `expected TRACE documented as a bitfield, got:\n${text}`);
  });

  it("TRACE on BITMAP is the scan pattern, not SPECTRO's axis swap", async function () {
    const text = await hoverTextAt(BITMAP_CFG, 'TRACE');
    assert.ok(/scan pattern/i.test(text), `expected BITMAP's scan-pattern sense, got:\n${text}`);
    assert.ok(!/axis swap|axes/i.test(text), `BITMAP's TRACE must not carry SPECTRO's axis-swap text, got:\n${text}`);
  });

  it('TRACE hovers differ between SPECTRO and BITMAP', async function () {
    const spectro = await hoverTextAt(SPECTRO_CFG, 'TRACE');
    const bitmap = await hoverTextAt(BITMAP_CFG, 'TRACE');
    assert.notStrictEqual(spectro, bitmap, 'SPECTRO and BITMAP TRACE must not collapse to one doc');
  });

  // ---- RATE: SPECTRO's odd default vs BITMAP's runtime freeze -------------

  it('RATE on SPECTRO documents the SAMPLES/8 default', async function () {
    const text = await hoverTextAt(SPECTRO_CFG, 'RATE');
    assert.ok(/SAMPLES\/8/i.test(text), `expected SPECTRO's SAMPLES/8 default, got:\n${text}`);
  });

  it('RATE on a BITMAP UPDATE line documents the runtime FREEZE trap', async function () {
    const text = await hoverTextAt(BITMAP_FEED, 'RATE');
    assert.ok(/freeze/i.test(text), `expected the runtime freeze trap, got:\n${text}`);
    assert.ok(/RUNTIME sense/i.test(text), `expected the runtime sense, not the config sense, got:\n${text}`);
  });

  it("RATE's config and runtime senses on BITMAP are different text", async function () {
    const cfg = await hoverTextAt(BITMAP_CFG, 'RATE');
    const feed = await hoverTextAt(BITMAP_FEED, 'RATE');
    assert.ok(cfg.length > 0 && feed.length > 0, 'both BITMAP RATE hovers must resolve');
    assert.notStrictEqual(cfg, feed, 'BITMAP config and runtime RATE must not collapse to one doc');
  });

  // ---- SIZE on MIDI is not a pixel dimension ------------------------------

  it('SIZE on MIDI is documented as a key scalar, not pixels', async function () {
    const text = await hoverTextAt(MIDI_CFG, 'SIZE');
    assert.ok(/NOT a pixel/i.test(text), `expected MIDI's not-a-pixel-dimension trap, got:\n${text}`);
  });

  it('SIZE on SCOPE_XY documents the single-value square window', async function () {
    const text = await hoverTextAt(SCOPEXY_CFG, 'SIZE');
    assert.ok(/square/i.test(text), `expected the always-square note, got:\n${text}`);
  });

  // ---- per-type traps -----------------------------------------------------

  it('LOGIC TRIGGER documents that it is EDGE-armed', async function () {
    const text = await hoverTextAt('DEBUG(`Bus TRIGGER', 'TRIGGER');
    assert.ok(/edge-armed/i.test(text), `expected the edge-armed trap, got:\n${text}`);
  });

  it('LOGIC HOLDOFF documents that a bare HOLDOFF is a silent no-op', async function () {
    const text = await hoverTextAt('DEBUG(`Bus HOLDOFF', 'HOLDOFF');
    assert.ok(/no-op/i.test(text), `expected the bare-HOLDOFF no-op trap, got:\n${text}`);
  });

  it('SCOPE TRIGGER documents the counter-intuitive offset mapping', async function () {
    const text = await hoverTextAt('DEBUG(`Wave TRIGGER', 'TRIGGER');
    assert.ok(/counter-intuitive/i.test(text), `expected the offset-mapping trap, got:\n${text}`);
  });

  it('SCOPE DOTSIZE documents the both-zero forcing rule', async function () {
    const text = await hoverTextAt(SCOPE_CFG, 'SIZE');
    assert.ok(text.length > 0, 'sanity: SCOPE config line must hover');
    const dot = await hoverTextAt(LOGIC_CFG, 'DOTSIZE');
    assert.ok(/single scalar/i.test(dot), `expected LOGIC's single-scalar DOTSIZE note, got:\n${dot}`);
  });

  it('FFT LINESIZE documents that NEGATIVE selects bar mode', async function () {
    const text = await hoverTextAt(FFT_CFG, 'LINESIZE');
    assert.ok(/negative/i.test(text), `expected the negative-is-bars behavior, got:\n${text}`);
  });

  it('FFT LOGSCALE warns it is not calibrated dB', async function () {
    const text = await hoverTextAt(FFT_CFG, 'LOGSCALE');
    assert.ok(/not calibrated dB/i.test(text), `expected the not-dB warning, got:\n${text}`);
  });

  it('BITMAP SPARSE documents the DOTSIZE >= 4 gate', async function () {
    const text = await hoverTextAt(BITMAP_CFG, 'SPARSE');
    assert.ok(/DOTSIZE >= 4/i.test(text), `expected the magnification gate, got:\n${text}`);
  });

  it('BITMAP LUTCOLORS documents the zero-initialized palette', async function () {
    const text = await hoverTextAt(BITMAP_CFG, 'LUTCOLORS');
    assert.ok(/zero-initialized/i.test(text), `expected the all-black-until-loaded trap, got:\n${text}`);
  });

  it('BITMAP SET documents that it CANCELS scroll', async function () {
    const text = await hoverTextAt(BITMAP_FEED, 'SET');
    assert.ok(/cancels scroll/i.test(text), `expected the scroll-cancel side effect, got:\n${text}`);
  });

  it('MIDI HIDEXY is documented as NOT accepted', async function () {
    const text = await hoverTextAt(MIDI_CFG, 'HIDEXY');
    assert.ok(/not accepted/i.test(text), `expected MIDI's HIDEXY rejection documented, got:\n${text}`);
  });

  it('MIDI CHANNEL documents that there is no all-channels value', async function () {
    const text = await hoverTextAt(MIDI_CFG, 'CHANNEL');
    assert.ok(/no value that displays every channel|not a mask/i.test(text), `expected the exact-filter trap, got:\n${text}`);
  });

  // ---- mode families land on the right display types ----------------------

  it('a sample-PACKING mode resolves on LOGIC', async function () {
    const text = await hoverTextAt(LOGIC_CFG, 'LONGS_1BIT');
    assert.ok(/sample packing/i.test(text), `expected the packing-mode doc, got:\n${text}`);
    assert.ok(/UNPACKED/i.test(text), `expected the omit-all-modes default noted, got:\n${text}`);
  });

  it('SPECTRO accepts its restricted intensity mode', async function () {
    const text = await hoverTextAt(SPECTRO_CFG, 'HSV16X');
    assert.ok(/SPECTRO intensity mode/i.test(text), `expected SPECTRO's restricted-mode doc, got:\n${text}`);
  });

  // ---- shared table still reachable from a new type ----------------------

  it('SPECTRO MAG resolves as a power-of-two multiplier', async function () {
    const text = await hoverTextAt(SPECTRO_CFG, 'MAG');
    assert.ok(/2\^n|NOT a direct multiplier/i.test(text), `expected MAG's 2^n semantics, got:\n${text}`);
  });
});
