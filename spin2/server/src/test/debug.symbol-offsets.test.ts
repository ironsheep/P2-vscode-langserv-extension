'use strict';
// server/src/test/debug.symbol-offsets.test.ts
//
// Regression tests for a recurring bug class: the parser tokenizes a DEBUG()
// statement correctly, but then locates the token at the WRONG offset. Three
// variants have been fixed:
//
//   1. the search line was not string-masked, so a lookup landed on a word that
//      was only part of the DEBUG display text        (spin.common locateSymbol)
//   2. the scan offset was not advanced past a recognized parameter, so a later
//      name matched a SUBSTRING of an earlier word    (COLOR inside BACKCOLOR)
//   3. ...or re-matched the FIRST occurrence of a repeated word (WHITE, WHITE)
//
// These assert exact character offsets, because the symptom is invisible to a
// pass/fail on token COUNT -- the token is emitted, just in the wrong place.

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createTestContext } from './testContext';
import { DocumentFindings } from '../parser/spin.semantic.findings';
import { Spin2DocumentSymbolParser } from '../parser/spin2.documentSymbolParser';
import { Spin2DocumentSemanticParser } from '../parser/spin2.documentSemanticParser';

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures');
const FIXTURE = 'debug-symbol-offsets.spin2';

interface ITokenLite {
  line: number;
  startCharacter: number;
  length: number;
  ptTokenType: string;
  text: string;
}

let fixtureLines: string[] = [];
let tokens: ITokenLite[] = [];

function parseFixture(): void {
  const filePath = path.join(FIXTURES_DIR, FIXTURE);
  const content = fs.readFileSync(filePath, 'utf-8');
  fixtureLines = content.split(/\r?\n/);
  const document = TextDocument.create(`file://${filePath}`, 'spin2', 0, content);

  const ctx = createTestContext();
  const findings = new DocumentFindings(document.uri);
  findings.setFilename(document.uri);

  new Spin2DocumentSymbolParser(ctx).reportDocumentSymbols(document, findings);
  new Spin2DocumentSemanticParser(ctx).reportDocumentSemanticTokens(document, findings, path.dirname(document.uri));

  tokens = findings.allSemanticTokens().map((t) => ({
    line: t.line,
    startCharacter: t.startCharacter,
    length: t.length,
    ptTokenType: t.ptTokenType,
    text: (fixtureLines[t.line] ?? '').substr(t.startCharacter, t.length)
  }));
}

/** 0-based index of the single fixture line containing {needle}. */
function lineIndexContaining(needle: string): number {
  const idx = fixtureLines.findIndex((l) => l.includes(needle));
  assert.notStrictEqual(idx, -1, `fixture must contain a line with [${needle}]`);
  return idx;
}

function tokensOnLine(lineIdx: number): ITokenLite[] {
  return tokens.filter((t) => t.line === lineIdx).sort((a, b) => a.startCharacter - b.startCharacter);
}

/**
 * Assert a token of {type} exists at the EXACT offset of the {occurrence}-th
 * (1-based) occurrence of {word} on the line -- and that it covers that word.
 */
function assertTokenAtOccurrence(lineIdx: number, word: string, occurrence: number, type: string): void {
  const lineText = fixtureLines[lineIdx];
  let expectedOffset = -1;
  let from = 0;
  for (let n = 0; n < occurrence; n++) {
    expectedOffset = lineText.indexOf(word, from);
    assert.notStrictEqual(expectedOffset, -1, `fixture line must have ${occurrence} occurrence(s) of [${word}]`);
    from = expectedOffset + word.length;
  }
  const match = tokensOnLine(lineIdx).find((t) => t.startCharacter === expectedOffset && t.ptTokenType === type);
  assert.ok(
    match,
    `expected a '${type}' token for occurrence #${occurrence} of [${word}] at offset ${expectedOffset}\n` +
      `  line   : ${lineText}\n` +
      `  tokens : ${JSON.stringify(tokensOnLine(lineIdx).map((t) => `${t.ptTokenType}@${t.startCharacter}[${t.text}]`))}`
  );
  assert.strictEqual(match.text, word, `token at ${expectedOffset} should cover [${word}]`);
}

/** Assert NO token starts inside the half-open span [start, end). */
function assertNoTokenInSpan(lineIdx: number, start: number, end: number, why: string): void {
  const inside = tokensOnLine(lineIdx).filter((t) => t.startCharacter >= start && t.startCharacter < end);
  assert.deepStrictEqual(
    inside.map((t) => `${t.ptTokenType}@${t.startCharacter}[${t.text}]`),
    [],
    `${why}\n  line: ${fixtureLines[lineIdx]}`
  );
}

describe('DEBUG() symbol offsets (regression)', function () {
  before(function () {
    parseFixture();
  });

  it('parses the fixture and produces tokens', function () {
    assert.ok(tokens.length > 0, 'fixture should produce semantic tokens');
  });

  describe('lookup must not land inside DEBUG display text', function () {
    it("resolves [reading] to the `() substitution, not the word 'Reading:' in the message", function () {
      const lineIdx = lineIndexContaining("'Reading: ");
      const lineText = fixtureLines[lineIdx];
      const msgWordOffset = lineText.indexOf('Reading:');
      const realVarOffset = lineText.indexOf('(reading)') + 1;
      assert.notStrictEqual(msgWordOffset, -1);
      assert.ok(realVarOffset < lineText.length && msgWordOffset < realVarOffset, 'message word must precede the variable');

      // the variable token must sit on the substitution...
      const atVar = tokensOnLine(lineIdx).find((t) => t.startCharacter === realVarOffset);
      assert.ok(atVar, `expected a token at the [reading] substitution (offset ${realVarOffset})`);
      assert.strictEqual(atVar.text, 'reading');
      assert.notStrictEqual(atVar.ptTokenType, 'string', '[reading] must be a variable, not string content');

      // ...and the message word must be covered by a string token, never a variable
      const atMsg = tokensOnLine(lineIdx).find((t) => t.startCharacter === msgWordOffset);
      assert.ok(
        atMsg === undefined || atMsg.ptTokenType === 'string',
        `the word 'Reading:' at offset ${msgWordOffset} must not carry a non-string token, got ${atMsg?.ptTokenType}`
      );
    });

    it("resolves [temp] to the `() substitution, not 'Temp' inside the word 'Temperature'", function () {
      const lineIdx = lineIndexContaining("'Temperature: ");
      const lineText = fixtureLines[lineIdx];
      const insideWordOffset = lineText.indexOf('Temperature');
      const realVarOffset = lineText.indexOf('(temp)') + 1;

      const atVar = tokensOnLine(lineIdx).find((t) => t.startCharacter === realVarOffset);
      assert.ok(atVar, `expected a token at the [temp] substitution (offset ${realVarOffset}), not inside 'Temperature'`);
      assert.strictEqual(atVar.text, 'temp');
      assert.notStrictEqual(atVar.ptTokenType, 'string');

      const atWord = tokensOnLine(lineIdx).find((t) => t.startCharacter === insideWordOffset);
      assert.ok(
        atWord === undefined || atWord.ptTokenType === 'string',
        `'Temperature' at offset ${insideWordOffset} must not carry a non-string token, got ${atWord?.ptTokenType}`
      );
    });

    it('resolves both substitutions in a two-substitution string', function () {
      const lineIdx = lineIndexContaining('FwdEnc=');
      const lineText = fixtureLines[lineIdx];
      for (const name of ['encVal', 'duty']) {
        const varOffset = lineText.indexOf(`(${name})`) + 1;
        const atVar = tokensOnLine(lineIdx).find((t) => t.startCharacter === varOffset);
        assert.ok(atVar, `expected a token at the [${name}] substitution (offset ${varOffset})`);
        assert.strictEqual(atVar.text, name);
      }
    });
  });

  describe('scan offset must advance past each recognized parameter', function () {
    it('resolves COLOR to its own position, not the tail of the earlier BACKCOLOR', function () {
      const lineIdx = lineIndexContaining('BACKCOLOR WHITE COLOR');
      const lineText = fixtureLines[lineIdx];
      const backColorOffset = lineText.indexOf('BACKCOLOR');
      const realColorOffset = lineText.indexOf(' COLOR ') + 1;

      assertTokenAtOccurrence(lineIdx, 'BACKCOLOR', 1, 'setupParameter');
      assertTokenAtOccurrence(lineIdx, 'COLOR', 2, 'setupParameter'); // #1 is inside BACKCOLOR

      const colorTokens = tokensOnLine(lineIdx).filter((t) => t.text === 'COLOR');
      assert.deepStrictEqual(
        colorTokens.map((t) => t.startCharacter),
        [realColorOffset],
        `exactly one COLOR token, at ${realColorOffset} -- not inside BACKCOLOR at ${backColorOffset + 4}`
      );
    });

    it('gives every repeated WHITE its own token at its own offset', function () {
      const lineIdx = lineIndexContaining('BACKCOLOR WHITE COLOR');
      const lineText = fixtureLines[lineIdx];

      const expected: number[] = [];
      for (let at = lineText.indexOf('WHITE'); at !== -1; at = lineText.indexOf('WHITE', at + 5)) {
        expected.push(at);
      }
      assert.strictEqual(expected.length, 5, 'fixture line should carry 5 WHITE keywords');

      const actual = tokensOnLine(lineIdx)
        .filter((t) => t.text === 'WHITE')
        .map((t) => t.startCharacter);
      assert.deepStrictEqual(actual, expected, 'each WHITE must be tokenized at its own offset, none collapsing onto the first');
    });

    it('tokenizes every color name on the line', function () {
      const lineIdx = lineIndexContaining('BACKCOLOR WHITE COLOR');
      for (const [word, occurrence] of [
        ['BLACK', 1],
        ['BLUE', 1],
        ['GREEN', 1],
        ['RED', 1]
      ] as [string, number][]) {
        assertTokenAtOccurrence(lineIdx, word, occurrence, 'colorName');
      }
    });

    it('leaves no token inside the SIZE numeric arguments', function () {
      const lineIdx = lineIndexContaining('BACKCOLOR WHITE COLOR');
      const lineText = fixtureLines[lineIdx];
      const sizeAt = lineText.indexOf('SIZE');
      assertTokenAtOccurrence(lineIdx, 'SIZE', 1, 'setupParameter');
      // the two numbers after SIZE should be 'number' tokens, nothing else
      const nums = tokensOnLine(lineIdx).filter((t) => t.startCharacter > sizeAt && t.startCharacter < lineText.indexOf('BACKCOLOR'));
      for (const t of nums) {
        assert.strictEqual(t.ptTokenType, 'number', `expected only number tokens between SIZE and BACKCOLOR, got ${t.ptTokenType}[${t.text}]`);
      }
      void assertNoTokenInSpan; // helper kept for future span assertions
    });
  });
});
