'use strict';
// client/src/test/docgen.utils.test.ts
//
// Unit tests for {Spin2_Doc_CON} directive detection and doc generation utilities.
// Runs standalone via: npm run test:docgen (mocha + ts-node, no VSCode host)

import * as assert from 'assert';
import { SpinCodeUtils } from '../spin.code.utils';

const codeUtils = new SpinCodeUtils();

// ---------------------------------------------------------------------------
//  {Spin2_Doc_CON} Directive Detection
// ---------------------------------------------------------------------------
describe('{Spin2_Doc_CON} Directive Detection', function () {
  it('should detect standard directive', function () {
    assert.strictEqual(codeUtils.containsDocConDirective('{Spin2_Doc_CON}'), true);
  });

  it('should detect directive with surrounding spaces', function () {
    assert.strictEqual(codeUtils.containsDocConDirective('{ Spin2_Doc_CON }'), true);
  });

  it('should detect directive case-insensitively', function () {
    assert.strictEqual(codeUtils.containsDocConDirective('{spin2_doc_con}'), true);
    assert.strictEqual(codeUtils.containsDocConDirective('{SPIN2_DOC_CON}'), true);
    assert.strictEqual(codeUtils.containsDocConDirective('{Spin2_doc_CON}'), true);
  });

  it('should detect directive with leading whitespace (indented)', function () {
    assert.strictEqual(codeUtils.containsDocConDirective('  {Spin2_Doc_CON}'), true);
    assert.strictEqual(codeUtils.containsDocConDirective('\t{Spin2_Doc_CON}'), true);
  });

  it('should not detect partial matches', function () {
    assert.strictEqual(codeUtils.containsDocConDirective('{Spin2_Doc}'), false);
    assert.strictEqual(codeUtils.containsDocConDirective('{Doc_CON}'), false);
    assert.strictEqual(codeUtils.containsDocConDirective('Spin2_Doc_CON'), false);
  });

  it('should not detect directive in regular comments', function () {
    assert.strictEqual(codeUtils.containsDocConDirective("' Spin2_Doc_CON"), false);
  });

  it('should not detect version directive as doc directive', function () {
    assert.strictEqual(codeUtils.containsDocConDirective('{Spin2_v46}'), false);
  });

  it('should detect directive with extra internal whitespace', function () {
    assert.strictEqual(codeUtils.containsDocConDirective('{  Spin2_Doc_CON  }'), true);
  });

  it('should not match empty braces', function () {
    assert.strictEqual(codeUtils.containsDocConDirective('{}'), false);
    assert.strictEqual(codeUtils.containsDocConDirective('{ }'), false);
  });
});

// ---------------------------------------------------------------------------
//  Section Comment Extraction (via isSectionStartLine)
// ---------------------------------------------------------------------------
describe('Section Start Detection', function () {
  it('should detect CON section start', function () {
    const result = codeUtils.isSectionStartLine("CON ' error codes");
    assert.strictEqual(result.isSectionStart, true);
  });

  it('should detect CON with brace comment', function () {
    const result = codeUtils.isSectionStartLine('CON { Motor Constants }');
    assert.strictEqual(result.isSectionStart, true);
  });

  it('should detect bare CON', function () {
    const result = codeUtils.isSectionStartLine('CON');
    assert.strictEqual(result.isSectionStart, true);
  });

  it('should detect PUB section start', function () {
    const result = codeUtils.isSectionStartLine('PUB start() : result');
    assert.strictEqual(result.isSectionStart, true);
  });

  it('should not detect CONSTANT as section start', function () {
    const result = codeUtils.isSectionStartLine('  CONSTANT_NAME = 5');
    assert.strictEqual(result.isSectionStart, false);
  });
});

// ---------------------------------------------------------------------------
//  Language Spec Detection (sanity check - not new code but related)
// ---------------------------------------------------------------------------
describe('Language Spec Detection', function () {
  it('should detect Spin2 version spec', function () {
    assert.strictEqual(codeUtils.containsSpinLanguageSpec('{Spin2_v46}'), true);
  });

  it('should not confuse doc directive with version spec', function () {
    assert.strictEqual(codeUtils.containsSpinLanguageSpec('{Spin2_Doc_CON}'), false);
  });
});

// ---------------------------------------------------------------------------
//  Preprocessor Directive Detection (uses existing utility)
// ---------------------------------------------------------------------------
describe('Preprocessor Directive Detection', function () {
  it('should detect #define', function () {
    assert.strictEqual(codeUtils.isFlexspinPreprocessorDirective('#define'), true);
  });

  it('should detect #ifdef', function () {
    assert.strictEqual(codeUtils.isFlexspinPreprocessorDirective('#ifdef'), true);
  });

  it('should detect #endif', function () {
    assert.strictEqual(codeUtils.isFlexspinPreprocessorDirective('#endif'), true);
  });

  it('should detect #ifndef', function () {
    assert.strictEqual(codeUtils.isFlexspinPreprocessorDirective('#ifndef'), true);
  });

  it('should detect #else', function () {
    assert.strictEqual(codeUtils.isFlexspinPreprocessorDirective('#else'), true);
  });
});

// ---------------------------------------------------------------------------
//  getNonCommentLineRemainder
// ---------------------------------------------------------------------------
describe('getNonCommentLineRemainder', function () {
  it('should strip trailing tic comment', function () {
    const result = codeUtils.getNonCommentLineRemainder(0, "SUCCESS = 0  ' Operation OK");
    assert.strictEqual(result.trim(), 'SUCCESS = 0');
  });

  it('should return full line with no comment', function () {
    const result = codeUtils.getNonCommentLineRemainder(0, 'SUCCESS = 0');
    assert.strictEqual(result.trim(), 'SUCCESS = 0');
  });

  it('should handle empty line', function () {
    const result = codeUtils.getNonCommentLineRemainder(0, '');
    assert.strictEqual(result, '');
  });
});
