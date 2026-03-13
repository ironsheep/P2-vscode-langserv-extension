'use strict';
// server/src/test/unused-globals.test.ts
//
// Server-side unit tests for unused VAR/DAT variable detection.

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { createTestContext } from './testContext';
import { DocumentFindings, RememberedToken } from '../parser/spin.semantic.findings';
import { Spin2DocumentSymbolParser } from '../parser/spin2.documentSymbolParser';
import { Spin2DocumentSemanticParser } from '../parser/spin2.documentSemanticParser';
import { ServerBehaviorConfiguration } from '../context';

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures');

function loadFixture(filename: string): TextDocument {
  const filePath = path.join(FIXTURES_DIR, filename);
  const content = fs.readFileSync(filePath, 'utf-8');
  const uri = `file://${filePath}`;
  return TextDocument.create(uri, 'spin2', 0, content);
}

function parseFixture(filename: string, reportUnused: boolean = true): DocumentFindings {
  const config = new ServerBehaviorConfiguration();
  config.reportUnusedVariables = reportUnused;
  const ctx = createTestContext({ parserConfig: config });
  const document = loadFixture(filename);
  const findings = new DocumentFindings(document.uri);
  findings.setFilename(document.uri);

  const symbolParser = new Spin2DocumentSymbolParser(ctx);
  symbolParser.reportDocumentSymbols(document, findings);

  const semanticParser = new Spin2DocumentSemanticParser(ctx);
  semanticParser.reportDocumentSemanticTokens(document, findings, path.dirname(document.uri));

  return findings;
}

function getDiagnosticMessages(findings: DocumentFindings): Diagnostic[] {
  return findings.allDiagnosticMessages(200);
}

function findWarning(diags: Diagnostic[], pattern: RegExp): Diagnostic | undefined {
  // use case-insensitive matching since token names are stored lowercase in TokenSet
  return diags.find((d) => d.severity === DiagnosticSeverity.Warning && pattern.test(d.message));
}

function findWarningCI(diags: Diagnostic[], namePattern: string): Diagnostic | undefined {
  const re = new RegExp(namePattern, 'i');
  return diags.find((d) => d.severity === DiagnosticSeverity.Warning && re.test(d.message));
}

// ============================================================================
//  Tests for unused VAR variable detection
// ============================================================================

describe('Unused global variable detection: VAR variables', function () {
  it('should NOT warn for VAR variable used in a method', function () {
    const findings = parseFixture('unused-globals.spin2');
    const diags = getDiagnosticMessages(findings);
    const warning = findWarningCI(diags, "VAR variable 'usedVar'");
    assert.strictEqual(warning, undefined, 'usedVar is used and should not be flagged');
  });

  it('should warn for VAR variable never used', function () {
    const findings = parseFixture('unused-globals.spin2');
    const diags = getDiagnosticMessages(findings);
    const warning = findWarningCI(diags, "VAR variable 'unusedVar'");
    assert.ok(warning, 'unusedVar should be flagged as unused');
    assert.strictEqual(warning.severity, DiagnosticSeverity.Warning);
  });

  it('should warn for unused VAR array', function () {
    const findings = parseFixture('unused-globals.spin2');
    const diags = getDiagnosticMessages(findings);
    const warning = findWarningCI(diags, "VAR variable 'unusedArray'");
    assert.ok(warning, 'unusedArray should be flagged as unused');
  });

  it('should warn for unused variable in multi-name VAR line', function () {
    const findings = parseFixture('unused-globals.spin2');
    const diags = getDiagnosticMessages(findings);
    const warning = findWarningCI(diags, "VAR variable 'unusedB'");
    assert.ok(warning, 'unusedB should be flagged as unused');
  });

  it('should NOT warn for used variables in multi-name VAR line', function () {
    const findings = parseFixture('unused-globals.spin2');
    const diags = getDiagnosticMessages(findings);
    const warningA = findWarningCI(diags, "VAR variable 'a' ");
    const warningC = findWarningCI(diags, "VAR variable 'c' ");
    assert.strictEqual(warningA, undefined, 'a is used and should not be flagged');
    assert.strictEqual(warningC, undefined, 'c is used and should not be flagged');
  });
});

// ============================================================================
//  Tests for unused DAT variable detection
// ============================================================================

describe('Unused global variable detection: DAT variables', function () {
  it('should NOT warn for DAT variable used in a method', function () {
    const findings = parseFixture('unused-globals.spin2');
    const diags = getDiagnosticMessages(findings);
    const warning = findWarningCI(diags, "DAT variable 'datUsed'");
    assert.strictEqual(warning, undefined, 'datUsed is used and should not be flagged');
  });

  it('should warn for DAT variable never used', function () {
    const findings = parseFixture('unused-globals.spin2');
    const diags = getDiagnosticMessages(findings);
    const warning = findWarningCI(diags, "DAT variable 'datUnused'");
    assert.ok(warning, 'datUnused should be flagged as unused');
  });

  it('should NOT warn for DAT code labels', function () {
    const findings = parseFixture('unused-globals.spin2');
    const diags = getDiagnosticMessages(findings);
    const warning = findWarningCI(diags, "datLabel");
    assert.strictEqual(warning, undefined, 'DAT code labels should never be flagged');
  });
});

// ============================================================================
//  Tests for CON constant exclusion
// ============================================================================

describe('Unused global variable detection: CON exclusion', function () {
  it('should NOT warn for CON constants (even if unused)', function () {
    const findings = parseFixture('unused-globals.spin2');
    const diags = getDiagnosticMessages(findings);
    // MAX_COUNT is used, but verify CON constants never get "VAR variable" or "DAT variable" labels
    const conWarning = diags.find(
      (d) => d.severity === DiagnosticSeverity.Warning && /MAX_COUNT/.test(d.message) && /variable/.test(d.message)
    );
    assert.strictEqual(conWarning, undefined, 'CON constants should never be flagged as unused variables');
  });
});

// ============================================================================
//  Tests for reportUnusedVariables setting
// ============================================================================

describe('Unused global variable detection: setting toggle', function () {
  it('should suppress all warnings when reportUnusedVariables is false', function () {
    const findings = parseFixture('unused-globals.spin2', false);
    const diags = getDiagnosticMessages(findings);
    const unusedVarWarnings = diags.filter(
      (d) => d.severity === DiagnosticSeverity.Warning && /is declared but never used/.test(d.message)
    );
    assert.strictEqual(unusedVarWarnings.length, 0, 'No unused warnings should appear when setting is off');
  });
});

// ============================================================================
//  Tests for globalTokenEntries() accessor
// ============================================================================

describe('DocumentFindings: globalTokenEntries()', function () {
  it('should return only this file global tokens (not included)', function () {
    const findings = parseFixture('unused-globals.spin2');
    const entries: [string, RememberedToken][] = findings.globalTokenEntries();
    assert.ok(entries.length > 0, `Expected global tokens, got ${entries.length}`);
    const names = entries.map(([name]) => name);
    assert.ok(names.includes('usedVar'), 'Should include usedVar');
    assert.ok(names.includes('unusedVar'), 'Should include unusedVar');
  });

  it('should include DAT variables and labels', function () {
    const findings = parseFixture('unused-globals.spin2');
    const entries: [string, RememberedToken][] = findings.globalTokenEntries();
    const names = entries.map(([name]) => name);
    assert.ok(names.includes('datUsed'), 'Should include datUsed');
    assert.ok(names.includes('datUnused'), 'Should include datUnused');
    assert.ok(names.includes('datLabel'), 'Should include datLabel');
  });

  it('should distinguish VAR from DAT tokens by modifiers', function () {
    const findings = parseFixture('unused-globals.spin2');
    const entries: [string, RememberedToken][] = findings.globalTokenEntries();
    const entryMap = new Map(entries);

    const usedVar = entryMap.get('usedVar');
    assert.ok(usedVar, 'usedVar should exist');
    assert.ok(usedVar.modifiers.includes('instance'), 'VAR variable should have instance modifier');

    const datUsed = entryMap.get('datUsed');
    assert.ok(datUsed, 'datUsed should exist');
    assert.ok(datUsed.modifiers.includes('declaration'), 'DAT variable should have declaration modifier');
    assert.strictEqual(datUsed.type, 'variable', 'DAT variable should have type variable');

    const datLabel = entryMap.get('datLabel');
    assert.ok(datLabel, 'datLabel should exist');
    assert.strictEqual(datLabel.type, 'label', 'DAT label should have type label');
  });
});
