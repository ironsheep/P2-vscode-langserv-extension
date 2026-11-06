'use strict';
// server/src/test/con-enum-offsets.test.ts
//
// A CON enum constant whose name also appears inside an earlier name on the same line
// must be remembered at its own offset: in "LONG_B, B" the B is at 10, not 7 inside
// LONG_B. Global tokens are first-write-wins and the object scan runs first, so a wrong
// offset there also overrides the correct one the Spin2 parser computes later.
//
// Highlighting is painted separately and stays correct, which is what hid this. These
// tests assert the REMEMBERED offset, using the same parse order as DocumentProcessor.

import * as assert from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createTestContext } from './testContext';
import { DocumentFindings } from '../parser/spin.semantic.findings';
import { Spin2ObjectReferenceParser } from '../parser/spin.objectReferenceParser';
import { Spin2DocumentSymbolParser } from '../parser/spin2.documentSymbolParser';
import { Spin2DocumentSemanticParser } from '../parser/spin2.documentSemanticParser';
import { Spin1DocumentSymbolParser } from '../parser/spin1.documentSymbolParser';
import { Spin1DocumentSemanticParser } from '../parser/spin1.documentSemanticParser';

const SOURCE_LINES = [
  'CON', //
  '  LONG_B, B',
  '  #1, LONG_A, A',
  '  #1, CC[2], C',
  '  FIRST, FIR, ST',
  '  REPEAT_ME, OTHER',
  '  ALONE',
  '  XAB = 2, AB = 2',
  '  #1, DD[D1], D1 ',
  '',
  'PUB main() | x',
  '  x := B + A + C + FIR + ST + OTHER + ALONE + LONG_B + LONG_A + CC + FIRST + REPEAT_ME + XAB + AB + DD + D1',
  ''
];
const CON_LINE_COUNT = 8;

const NAMES = ['LONG_B', 'B', 'LONG_A', 'A', 'CC', 'C', 'FIRST', 'FIR', 'ST', 'REPEAT_ME', 'OTHER', 'ALONE', 'XAB', 'AB', 'DD'];

function expectedPosition(name: string): { line: number; character: number } {
  const pattern = new RegExp(`\\b${name}\\b`);
  for (let line = 1; line <= CON_LINE_COUNT; line++) {
    const match = pattern.exec(SOURCE_LINES[line]);
    if (match) {
      return { line, character: match.index };
    }
  }
  throw new Error(`[${name}] is not declared in the source`);
}

function parseInRealOrder(language: 'spin' | 'spin2'): DocumentFindings {
  const uri = `file:///tmp/con-enum-offsets.${language}`;
  const document = TextDocument.create(uri, language, 0, SOURCE_LINES.join('\n'));
  const ctx = createTestContext();
  const findings = new DocumentFindings(document.uri);
  findings.setFilename(document.uri);

  new Spin2ObjectReferenceParser(ctx).locateReferencedObjects(document, findings);
  if (language === 'spin2') {
    new Spin2DocumentSymbolParser(ctx).reportDocumentSymbols(document, findings);
    new Spin2DocumentSemanticParser(ctx).reportDocumentSemanticTokens(document, findings, '/tmp');
  } else {
    new Spin1DocumentSymbolParser(ctx).reportDocumentSymbols(document, findings);
    new Spin1DocumentSemanticParser(ctx).reportDocumentSemanticTokens(document, findings, '/tmp');
  }
  return findings;
}

(['spin2', 'spin'] as const).forEach((language) => {
  describe(`CON enum constant offsets (${language})`, function () {
    let findings: DocumentFindings;

    before(function () {
      findings = parseInRealOrder(language);
    });

    NAMES.forEach((name) => {
      it(`remembers ${name} at its own position`, function () {
        const token = findings.getGlobalToken(name);
        assert.ok(token, `expected a global token for ${name}`);
        assert.deepStrictEqual({ line: token.lineIndex, character: token.charIndex }, expectedPosition(name));
      });
    });
  });
});
