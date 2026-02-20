'use strict';
// server/src/test/references.test.ts
//
// Server-side integration tests for the token reference index.
// These tests parse real .spin2 fixture files through the actual parsers,
// then assert against the populated DocumentFindings.

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createTestContext } from './testContext';
import { DocumentFindings, ITokenReference, IDocumentLinkInfo } from '../parser/spin.semantic.findings';
import { Spin2DocumentSymbolParser } from '../parser/spin2.documentSymbolParser';
import { Spin2DocumentSemanticParser } from '../parser/spin2.documentSemanticParser';

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures');

function loadFixture(filename: string): TextDocument {
  const filePath = path.join(FIXTURES_DIR, filename);
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

describe('Server-side test infrastructure', function () {
  it('should load a fixture file', function () {
    const doc = loadFixture('references-basic.spin2');
    assert.ok(doc, 'Document should be created');
    assert.ok(doc.getText().length > 0, 'Document should have content');
  });

  it('should create a test context', function () {
    const ctx = createTestContext();
    assert.ok(ctx, 'Context should be created');
    assert.ok(ctx.parserConfig, 'Parser config should exist');
    assert.ok(ctx.editorConfig, 'Editor config should exist');
  });

  it('should parse a fixture file without errors', function () {
    const findings = parseFixture('references-basic.spin2');
    assert.ok(findings, 'Findings should be created');
  });

  it('should populate reference index when parsing', function () {
    const findings = parseFixture('references-basic.spin2');
    // After parsing, the reference index should have entries
    assert.ok(findings.tokenReferenceCount > 0, `Expected token references to be populated, got ${findings.tokenReferenceCount}`);
    // Verify some known symbols are tracked
    const refNames = findings.tokenReferenceNames;
    assert.ok(refNames.length > 0, 'Expected at least some token reference names');
  });

  it('should find references for known symbols', function () {
    const findings = parseFixture('references-basic.spin2');
    // MAX_SENSORS is declared in CON and used in PUB Main and PRI Helper
    const maxSensorRefs = findings.getReferencesForToken('MAX_SENSORS');
    assert.ok(maxSensorRefs.length >= 1, `Expected at least 1 reference for MAX_SENSORS, got ${maxSensorRefs.length}`);
    // Check that at least one is a declaration
    const declRefs = maxSensorRefs.filter((r) => r.isDeclaration);
    assert.ok(declRefs.length >= 1, 'Expected at least one declaration reference for MAX_SENSORS');
  });

  it('should find references for variable symbols', function () {
    const findings = parseFixture('references-basic.spin2');
    // sensorValue is declared in VAR and used in PUB Main and PRI Helper
    const sensorRefs = findings.getReferencesForToken('sensorValue');
    assert.ok(sensorRefs.length >= 1, `Expected at least 1 reference for sensorValue, got ${sensorRefs.length}`);
  });

  it('should find method declarations', function () {
    const findings = parseFixture('references-basic.spin2');
    // Main is declared as PUB Main()
    const mainRefs = findings.getReferencesForToken('Main');
    assert.ok(mainRefs.length >= 1, `Expected at least 1 reference for Main, got ${mainRefs.length}`);
    const declRefs = mainRefs.filter((r) => r.isDeclaration);
    assert.ok(declRefs.length >= 1, 'Expected at least one declaration for Main');
  });
});

describe('DocumentFindings reference index API (unit tests)', function () {
  it('should record and retrieve references by name', function () {
    const findings = new DocumentFindings('file:///test.spin2');

    findings.recordTokenReference('myVar', {
      line: 5, startCharacter: 2, length: 5, isDeclaration: true, scope: ''
    });
    findings.recordTokenReference('myVar', {
      line: 10, startCharacter: 8, length: 5, isDeclaration: false, scope: ''
    });

    const refs = findings.getReferencesForToken('myVar');
    assert.strictEqual(refs.length, 2);
    assert.strictEqual(refs[0].isDeclaration, true);
    assert.strictEqual(refs[0].line, 5);
    assert.strictEqual(refs[1].isDeclaration, false);
    assert.strictEqual(refs[1].line, 10);
  });

  it('should perform case-insensitive lookup', function () {
    const findings = new DocumentFindings('file:///test.spin2');

    findings.recordTokenReference('MyVar', {
      line: 5, startCharacter: 2, length: 5, isDeclaration: true, scope: ''
    });

    assert.strictEqual(findings.getReferencesForToken('myvar').length, 1);
    assert.strictEqual(findings.getReferencesForToken('MYVAR').length, 1);
    assert.strictEqual(findings.getReferencesForToken('MyVar').length, 1);
  });

  it('should filter by scope when scope is provided', function () {
    const findings = new DocumentFindings('file:///test.spin2');

    findings.recordTokenReference('localVar', {
      line: 10, startCharacter: 4, length: 8, isDeclaration: true, scope: 'MethodA'
    });
    findings.recordTokenReference('localVar', {
      line: 15, startCharacter: 4, length: 8, isDeclaration: false, scope: 'MethodA'
    });
    findings.recordTokenReference('localVar', {
      line: 25, startCharacter: 4, length: 8, isDeclaration: true, scope: 'MethodB'
    });

    const allRefs = findings.getReferencesForToken('localVar');
    assert.strictEqual(allRefs.length, 3);

    const methodARefs = findings.getReferencesForToken('localVar', 'MethodA');
    assert.strictEqual(methodARefs.length, 2);

    const methodBRefs = findings.getReferencesForToken('localVar', 'MethodB');
    assert.strictEqual(methodBRefs.length, 1);
  });

  it('should return empty array for unknown token names', function () {
    const findings = new DocumentFindings('file:///test.spin2');
    const refs = findings.getReferencesForToken('nonExistentToken');
    assert.strictEqual(refs.length, 0);
  });

  it('should track reference count correctly', function () {
    const findings = new DocumentFindings('file:///test.spin2');

    findings.recordTokenReference('varA', {
      line: 1, startCharacter: 0, length: 4, isDeclaration: true, scope: ''
    });
    findings.recordTokenReference('varB', {
      line: 2, startCharacter: 0, length: 4, isDeclaration: true, scope: ''
    });

    assert.strictEqual(findings.tokenReferenceCount, 2);
    assert.ok(findings.hasTokenReferences('varA'));
    assert.ok(findings.hasTokenReferences('varB'));
    assert.ok(!findings.hasTokenReferences('varC'));
  });

  it('should clear references on clear()', function () {
    const findings = new DocumentFindings('file:///test.spin2');

    findings.recordTokenReference('myVar', {
      line: 5, startCharacter: 2, length: 5, isDeclaration: true, scope: ''
    });

    assert.strictEqual(findings.tokenReferenceCount, 1);
    findings.clear();
    assert.strictEqual(findings.tokenReferenceCount, 0);
    assert.strictEqual(findings.getReferencesForToken('myVar').length, 0);
  });

  it('should ignore empty token names', function () {
    const findings = new DocumentFindings('file:///test.spin2');

    findings.recordTokenReference('', {
      line: 5, startCharacter: 2, length: 0, isDeclaration: false, scope: ''
    });

    assert.strictEqual(findings.tokenReferenceCount, 0);
  });
});

describe('Document link tracking (unit tests)', function () {
  it('should record and retrieve document links', function () {
    const findings = new DocumentFindings('file:///test.spin2');

    findings.recordDocumentLink({
      line: 5, startCharacter: 15, endCharacter: 30,
      targetFilename: 'child_object', isInclude: false
    });
    findings.recordDocumentLink({
      line: 8, startCharacter: 10, endCharacter: 25,
      targetFilename: 'utility.spin2', isInclude: true
    });

    const links = findings.getDocumentLinks();
    assert.strictEqual(links.length, 2);
    assert.strictEqual(links[0].targetFilename, 'child_object');
    assert.strictEqual(links[0].isInclude, false);
    assert.strictEqual(links[1].targetFilename, 'utility.spin2');
    assert.strictEqual(links[1].isInclude, true);
  });

  it('should clear document links on clear()', function () {
    const findings = new DocumentFindings('file:///test.spin2');

    findings.recordDocumentLink({
      line: 5, startCharacter: 15, endCharacter: 30,
      targetFilename: 'child_object', isInclude: false
    });

    assert.strictEqual(findings.getDocumentLinks().length, 1);
    findings.clear();
    assert.strictEqual(findings.getDocumentLinks().length, 0);
  });
});

describe('Integration: reference scoping and declaration flags', function () {
  it('should mark CON declarations correctly', function () {
    const findings = parseFixture('references-basic.spin2');
    const maxRefs = findings.getReferencesForToken('MAX_SENSORS');
    const declRefs = maxRefs.filter((r) => r.isDeclaration);
    const usageRefs = maxRefs.filter((r) => !r.isDeclaration);
    assert.ok(declRefs.length >= 1, 'Should have at least 1 declaration for MAX_SENSORS');
    assert.ok(usageRefs.length >= 1, 'Should have at least 1 usage for MAX_SENSORS');
  });

  it('should track DAT global labels', function () {
    const findings = parseFixture('references-basic.spin2');
    // char8_loop is a DAT global label
    const datRefs = findings.getReferencesForToken('char8_loop');
    assert.ok(datRefs.length >= 1, `Expected at least 1 reference for DAT label char8_loop, got ${datRefs.length}`);
  });

  it('should track method scope for local variables', function () {
    const findings = parseFixture('references-basic.spin2');
    // localVar is declared in PUB Main as a local
    const localRefs = findings.getReferencesForToken('localVar');
    assert.ok(localRefs.length >= 1, 'localVar should have references');
    // All localVar refs should be scoped to Main
    const mainRefs = findings.getReferencesForToken('localVar', 'Main');
    assert.ok(mainRefs.length >= 1, 'localVar should have references in Main scope');
  });

  it('should provide getMethodNameForLine', function () {
    const findings = parseFixture('references-basic.spin2');
    // Line 33 (0-indexed) should be inside PUB Main
    // PUB Main is on line 31 (0-indexed), so line 33 should be in Main
    const methodName = findings.getMethodNameForLine(33);
    assert.strictEqual(methodName, 'Main', `Expected method 'Main' at line 33, got '${methodName}'`);
  });

  it('should find Helper method references', function () {
    const findings = parseFixture('references-basic.spin2');
    const helperRefs = findings.getReferencesForToken('Helper');
    assert.ok(helperRefs.length >= 1, `Expected at least 1 reference for Helper, got ${helperRefs.length}`);
    // Should have a declaration
    const declRefs = helperRefs.filter((r) => r.isDeclaration);
    assert.ok(declRefs.length >= 1, 'Expected at least one declaration for Helper');
  });

  it('should track LED_PIN constant', function () {
    const findings = parseFixture('references-basic.spin2');
    const ledRefs = findings.getReferencesForToken('LED_PIN');
    assert.ok(ledRefs.length >= 1, `Expected at least 1 reference for LED_PIN, got ${ledRefs.length}`);
    const declRefs = ledRefs.filter((r) => r.isDeclaration);
    assert.ok(declRefs.length >= 1, 'Expected declaration for LED_PIN');
  });
});
