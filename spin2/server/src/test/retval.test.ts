'use strict';
// server/src/test/retval.test.ts
//
// Test that PRI method return values are correctly recognized
// and do NOT generate "missing declaration" diagnostics.
// Regression test for: haveDebugLine() falsely matching method names
// containing "debug" (e.g., setPageShowingDebug), which caused the
// debug comment stripping to remove ": returnValue" from signatures.

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createTestContext } from './testContext';
import { DocumentFindings } from '../parser/spin.semantic.findings';
import { Spin2DocumentSymbolParser } from '../parser/spin2.documentSymbolParser';
import { Spin2DocumentSemanticParser } from '../parser/spin2.documentSemanticParser';

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures');
const TEST_LANG_DIR = path.join(__dirname, '..', '..', '..', 'TEST_LANG_SERVER', 'spin2');

function loadFixture(filename: string): TextDocument {
  const filePath = path.join(FIXTURES_DIR, filename);
  const content = fs.readFileSync(filePath, 'utf-8');
  const uri = `file://${filePath}`;
  return TextDocument.create(uri, 'spin2', 0, content);
}

function loadTestFile(filename: string): TextDocument {
  const filePath = path.join(TEST_LANG_DIR, filename);
  const content = fs.readFileSync(filePath, 'utf-8');
  const uri = `file://${filePath}`;
  return TextDocument.create(uri, 'spin2', 0, content);
}

function parseFixture(filename: string): DocumentFindings {
  const ctx = createTestContext();
  const document = loadFixture(filename);
  const findings = new DocumentFindings(document.uri);
  findings.setFilename(document.uri);

  const symbolParser = new Spin2DocumentSymbolParser(ctx);
  symbolParser.reportDocumentSymbols(document, findings);

  const semanticParser = new Spin2DocumentSemanticParser(ctx);
  semanticParser.reportDocumentSemanticTokens(document, findings, path.dirname(document.uri));

  return findings;
}

function parseTestFile(filename: string): DocumentFindings {
  const ctx = createTestContext();
  const document = loadTestFile(filename);
  const findings = new DocumentFindings(document.uri);
  findings.setFilename(document.uri);

  const symbolParser = new Spin2DocumentSymbolParser(ctx);
  symbolParser.reportDocumentSymbols(document, findings);

  const semanticParser = new Spin2DocumentSemanticParser(ctx);
  semanticParser.reportDocumentSemanticTokens(document, findings, path.dirname(document.uri));

  return findings;
}

describe('PRI method return value recognition', function () {
  it('should not produce "missing declaration" for return value in assignment', function () {
    const findings = parseFixture('retval-check.spin2');

    const isLocal = findings.isLocalToken('bDidSucceed');
    assert.ok(isLocal, 'bDidSucceed should be recognized as a local token');
  });

  it('should not produce "missing declaration" for second PRI return value', function () {
    const findings = parseFixture('retval-check.spin2');

    const isLocal = findings.isLocalToken('result');
    assert.ok(isLocal, 'result should be recognized as a local token');
  });

  it('should have correct method spans', function () {
    const findings = parseFixture('retval-check.spin2');

    const methodName = findings.getMethodNameForLine(10);
    assert.strictEqual(methodName, 'doWork', `Expected method 'doWork' at line 10, got '${methodName}'`);
  });

  it('should find local token for return value within method body', function () {
    const findings = parseFixture('retval-check.spin2');

    const token = findings.getLocalTokenForLine('bDidSucceed', 10);
    assert.ok(token, 'Should find local token bDidSucceed at line 10');
    assert.strictEqual(token?.type, 'returnValue', `Expected type returnValue, got ${token?.type}`);
  });
});

describe('Regression: method names containing "debug" (ret_val_check.spin2)', function () {
  it('should register bDidSucceed for PRI setPageShowingDebug', function () {
    const findings = parseTestFile('ret_val_check.spin2');

    // PRI setPageShowingDebug(...) : bDidSucceed  (line 250)
    // The method name contains "debug" which previously caused haveDebugLine()
    // to falsely match, stripping ": bDidSucceed" from the signature
    const isForMethod = findings.isLocalTokenForMethod('setPageShowingDebug', 'bDidSucceed');
    assert.ok(isForMethod, 'bDidSucceed should be registered for setPageShowingDebug');
  });

  it('should register pageIdx for PRI getPageShowingDebug', function () {
    const findings = parseTestFile('ret_val_check.spin2');

    // PRI getPageShowingDebug(bShowDebug) : pageIdx  (line 271)
    const isForMethod = findings.isLocalTokenForMethod('getPageShowingDebug', 'pageIdx');
    assert.ok(isForMethod, 'pageIdx should be registered for getPageShowingDebug');
  });

  it('should find bDidSucceed at line 263 inside setPageShowingDebug', function () {
    const findings = parseTestFile('ret_val_check.spin2');

    // Line 263: bDidSucceed := waitForAck(pageDrawTimeout)
    const methodName = findings.getMethodNameForLine(263);
    assert.strictEqual(methodName, 'setPageShowingDebug', `Expected setPageShowingDebug at line 263, got ${methodName}`);

    const token = findings.getLocalTokenForLine('bDidSucceed', 263);
    assert.ok(token, 'Should find local token bDidSucceed at line 263');
    assert.strictEqual(token?.type, 'returnValue', `Expected type returnValue, got ${token?.type}`);
  });

  it('should find pageIdx at line 280 inside getPageShowingDebug', function () {
    const findings = parseTestFile('ret_val_check.spin2');

    // Line 280: pageIdx := read_response()
    const methodName = findings.getMethodNameForLine(280);
    assert.strictEqual(methodName, 'getPageShowingDebug', `Expected getPageShowingDebug at line 280, got ${methodName}`);

    const token = findings.getLocalTokenForLine('pageIdx', 280);
    assert.ok(token, 'Should find local token pageIdx at line 280');
    assert.strictEqual(token?.type, 'returnValue', `Expected type returnValue, got ${token?.type}`);
  });
});

describe('Regression: block comment closing brace in CON section (ret_val_check.spin2)', function () {
  it('should not produce "Missing \'=\' part of assignment [}]" diagnostic', function () {
    const findings = parseTestFile('ret_val_check.spin2');

    // Line 1156 is a closing "}" of a multi-line block comment in a CON section.
    // Previously, Pass 2 used closingOffset from the trimmed nonStringLine but
    // applied it to the untrimmed nonCommentLine, causing it to think there was
    // code after the "}" and fall through to CON processing which generated this error.
    const diagnostics = findings.allDiagnosticMessages(100);
    const braceAssignmentErrors = diagnostics.filter((d) => d.message.includes("Missing '=' part of assignment [}]"));
    assert.strictEqual(braceAssignmentErrors.length, 0, `Should not have "Missing '=' part of assignment [}]" error but found ${braceAssignmentErrors.length}`);
  });
});
