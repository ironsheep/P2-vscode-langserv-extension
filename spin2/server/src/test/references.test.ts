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
    // Line 35 (0-indexed) should be inside PUB Main
    // PUB Main is on line 33 (0-indexed), so line 35 should be in Main
    const methodName = findings.getMethodNameForLine(35);
    assert.strictEqual(methodName, 'Main', `Expected method 'Main' at line 35, got '${methodName}'`);
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

  it('should track array VAR declaration (byte buffer[BUFFER_SIZE])', function () {
    const findings = parseFixture('references-basic.spin2');
    const bufferRefs = findings.getReferencesForToken('buffer');
    assert.ok(bufferRefs.length >= 1, `Expected at least 1 reference for buffer, got ${bufferRefs.length}`);
    const declRefs = bufferRefs.filter((r) => r.isDeclaration);
    assert.ok(declRefs.length >= 1, `Expected at least 1 declaration for buffer, got ${declRefs.length}`);
    // Should also have a usage reference from PUB Main: buffer[0] := localVar
    const usageRefs = bufferRefs.filter((r) => !r.isDeclaration);
    assert.ok(usageRefs.length >= 1, `Expected at least 1 usage for buffer, got ${usageRefs.length}`);
    // Declaration should be in global scope
    const globalDeclRefs = declRefs.filter((r) => r.scope === '');
    assert.ok(globalDeclRefs.length >= 1, 'Expected buffer declaration to have global scope');
  });

  it('should track BUFFER_SIZE constant used in VAR array size', function () {
    const findings = parseFixture('references-basic.spin2');
    const bsRefs = findings.getReferencesForToken('BUFFER_SIZE');
    assert.ok(bsRefs.length >= 1, `Expected at least 1 reference for BUFFER_SIZE, got ${bsRefs.length}`);
  });

  it('should track local variable used with @ (address-of) operator', function () {
    const findings = parseFixture('references-basic.spin2');
    // scr is declared as a local in PRI Helper and used as @scr in a method call
    const scrRefs = findings.getReferencesForToken('scr');
    assert.ok(scrRefs.length >= 1, `Expected at least 1 reference for scr, got ${scrRefs.length}`);
    // Should have a declaration reference
    const declRefs = scrRefs.filter((r) => r.isDeclaration);
    assert.ok(declRefs.length >= 1, `Expected at least 1 declaration for scr, got ${declRefs.length}`);
    // Should have a usage reference (from @scr)
    const usageRefs = scrRefs.filter((r) => !r.isDeclaration);
    assert.ok(usageRefs.length >= 1, `Expected at least 1 usage for scr (from @scr), got ${usageRefs.length}`);
    // All scr refs should be scoped to Helper
    const helperRefs = findings.getReferencesForToken('scr', 'Helper');
    assert.ok(helperRefs.length >= 1, `Expected scr refs scoped to Helper, got ${helperRefs.length}`);
  });
});

describe('Integration: cross-object reference recording', function () {
  it('should record fstr0 in reference index for serial.fstr0(...) call', function () {
    const findings = parseFixture('references-crossobj.spin2');
    // fstr0 should be recorded as a reference even though the child object is not available
    const fstr0Refs = findings.getReferencesForToken('fstr0');
    assert.ok(fstr0Refs.length >= 1, `Expected at least 1 reference for fstr0, got ${fstr0Refs.length}`);
  });

  it('should record start in reference index for serial.start(...) call', function () {
    const findings = parseFixture('references-crossobj.spin2');
    const startRefs = findings.getReferencesForToken('start');
    assert.ok(startRefs.length >= 1, `Expected at least 1 reference for start, got ${startRefs.length}`);
  });

  it('should record serial as a reference (namespace instance)', function () {
    const findings = parseFixture('references-crossobj.spin2');
    const serialRefs = findings.getReferencesForToken('serial');
    assert.ok(serialRefs.length >= 1, `Expected at least 1 reference for serial, got ${serialRefs.length}`);
  });

  it('should dump all reference names for debugging', function () {
    const findings = parseFixture('references-crossobj.spin2');
    const refNames = findings.tokenReferenceNames;
    // Log all reference names for debugging
    const refCount = findings.tokenReferenceCount;
    assert.ok(refCount >= 1, `Expected at least 1 token reference, got ${refCount}. Names: [${refNames.join(', ')}]`);
  });

  it('should record fstr0 with correct scope and attributes', function () {
    const findings = parseFixture('references-crossobj.spin2');
    const fstr0Refs = findings.getReferencesForToken('fstr0');
    assert.ok(fstr0Refs.length >= 1, `Expected at least 1 reference for fstr0, got ${fstr0Refs.length}`);
    // Check scope — fstr0 is called inside PUB Main, so should be scoped to Main
    const mainRefs = findings.getReferencesForToken('fstr0', 'Main');
    assert.ok(mainRefs.length >= 1, `Expected fstr0 scoped to Main, got ${mainRefs.length}`);
    // Check that it is NOT a declaration (it's a usage)
    const usageRefs = fstr0Refs.filter((r) => !r.isDeclaration);
    assert.ok(usageRefs.length >= 1, `Expected at least 1 usage ref for fstr0, got ${usageRefs.length}`);
    // Check global scope — fstr0 is NOT globally scoped (it's inside a method)
    const hasGlobalScope = fstr0Refs.some((r) => r.scope === '');
    // This is the KEY insight: fstr0 has NO global scope refs,
    // so ReferencesProvider would route to local search, not global search
    assert.strictEqual(hasGlobalScope, false, 'fstr0 should NOT have global scope references');
  });

  it('should NOT have serial.fstr0 as a compound reference key', function () {
    const findings = parseFixture('references-crossobj.spin2');
    // Verify that the dotted compound name is NOT in the reference index
    // (it would be if auto-extraction incorrectly extracted the full dotted name)
    const compoundRefs = findings.getReferencesForToken('serial.fstr0');
    assert.strictEqual(compoundRefs.length, 0, `serial.fstr0 should NOT be a reference key, but got ${compoundRefs.length} refs`);
    // Also verify hasTokenReferences for the compound name
    assert.strictEqual(findings.hasTokenReferences('serial.fstr0'), false,
      'hasTokenReferences(serial.fstr0) should be false');
  });

  it('should simulate ReferencesProvider cross-object flow correctly', function () {
    // This test simulates exactly what the ReferencesProvider does
    const findings = parseFixture('references-crossobj.spin2');

    // Step 1: Simulate _symbolAtLocation returning objectRef='serial', tokenName='fstr0'
    const objectRef = 'serial';
    const tokenName = 'fstr0';
    const includeDeclaration = true;

    // Step 2: Since objectRef.length > 0, simulate _collectCrossObjectReferences
    // In the live extension, this iterates ctx.docsByFSpec which contains multiple documents.
    // Here we only have one document. Check if fstr0 references exist in it.
    const refs = findings.getReferencesForToken(tokenName);
    assert.ok(refs.length >= 1,
      `_collectCrossObjectReferences should find fstr0 in current document, got ${refs.length} refs`);

    // Step 3: Simulate _addReferencesToResults
    let resultCount = 0;
    for (const ref of refs) {
      if (!includeDeclaration && ref.isDeclaration) {
        continue;
      }
      resultCount++;
    }
    assert.ok(resultCount >= 1,
      `After filtering, should have at least 1 result for fstr0, got ${resultCount}`);
  });
});
