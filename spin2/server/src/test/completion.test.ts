'use strict';
// server/src/test/completion.test.ts
//
// Server-side unit tests for the CompletionProvider and its supporting
// data model additions (allGlobalTokenEntries, blockTypeForLine,
// localTokenEntriesForMethod, struct members accessor, etc.)

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createTestContext } from './testContext';
import {
  DocumentFindings,
  RememberedToken,
  RememberedStructure,
  RememberedStructureMember,
  eBLockType,
  RememberedTokenDeclarationInfo
} from '../parser/spin.semantic.findings';
import { Spin2DocumentSymbolParser } from '../parser/spin2.documentSymbolParser';
import { Spin2DocumentSemanticParser } from '../parser/spin2.documentSemanticParser';
import { Spin2ParseUtils } from '../parser/spin2.utils';

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

// ============================================================================
//  Tests for new data model accessors (DocumentFindings additions)
// ============================================================================

describe('DocumentFindings: allGlobalTokenEntries()', function () {
  it('should return global tokens from parsed fixture', function () {
    const findings = parseFixture('completion-basic.spin2');
    const entries: [string, RememberedToken][] = findings.allGlobalTokenEntries();
    assert.ok(entries.length > 0, `Expected global tokens, got ${entries.length}`);
    // Should include CON constants, VAR variables, and PUB/PRI methods
    const names: string[] = entries.map(([name]) => name);
    assert.ok(names.includes('MAX_COUNT'), `Expected 'MAX_COUNT' in global tokens, got: [${names.join(', ')}]`);
    assert.ok(names.includes('LED_PIN'), `Expected 'LED_PIN' in global tokens`);
    assert.ok(names.includes('sensorValue'), `Expected 'sensorValue' in global tokens`);
  });

  it('should include method names as global tokens', function () {
    const findings = parseFixture('completion-basic.spin2');
    const entries: [string, RememberedToken][] = findings.allGlobalTokenEntries();
    const names: string[] = entries.map(([name]) => name);
    assert.ok(names.includes('Main'), `Expected 'Main' method in global tokens`);
    assert.ok(names.includes('Helper'), `Expected 'Helper' method in global tokens`);
  });

  it('should return tokens with correct types', function () {
    const findings = parseFixture('completion-basic.spin2');
    const entries: [string, RememberedToken][] = findings.allGlobalTokenEntries();
    const entryMap = new Map(entries);

    const maxCount = entryMap.get('MAX_COUNT');
    assert.ok(maxCount, 'MAX_COUNT should exist');
    // CON constants are 'variable' with 'readonly' modifier
    assert.strictEqual(maxCount.type, 'variable', 'MAX_COUNT should be type variable');
    assert.ok(maxCount.modifiers.includes('readonly'), 'MAX_COUNT should have readonly modifier');

    const mainMethod = entryMap.get('Main');
    assert.ok(mainMethod, 'Main should exist');
    assert.strictEqual(mainMethod.type, 'method', 'Main should be type method');
  });
});

describe('DocumentFindings: globalTokenDeclarationInfo()', function () {
  it('should return declaration info for known tokens', function () {
    const findings = parseFixture('completion-basic.spin2');
    const declInfo = findings.globalTokenDeclarationInfo('max_count');
    assert.ok(declInfo !== undefined, 'Declaration info should exist for max_count');
  });

  it('should return undefined for unknown tokens', function () {
    const findings = parseFixture('completion-basic.spin2');
    const declInfo = findings.globalTokenDeclarationInfo('nonexistent_token_xyz');
    assert.strictEqual(declInfo, undefined, 'Should return undefined for unknown token');
  });
});

describe('DocumentFindings: blockTypeForLine()', function () {
  // completion-basic.spin2 layout (0-indexed):
  //  line 0: {spin2_v52}
  //  line 4: CON
  //  line 6:   MAX_COUNT = 10
  //  line 16: VAR
  //  line 18:   LONG sensorValue
  //  line 28: PUB Main() | localVar, i
  //  line 39: PRI Helper(value) : result

  it('should identify CON block lines', function () {
    const findings = parseFixture('completion-basic.spin2');
    const blockType = findings.blockTypeForLine(6);
    assert.strictEqual(blockType, eBLockType.isCon, `Expected isCon at line 6, got ${eBLockType[blockType]}`);
  });

  it('should identify VAR block lines', function () {
    const findings = parseFixture('completion-basic.spin2');
    const blockType = findings.blockTypeForLine(18);
    assert.strictEqual(blockType, eBLockType.isVar, `Expected isVar at line 18, got ${eBLockType[blockType]}`);
  });

  it('should identify PUB block lines', function () {
    const findings = parseFixture('completion-basic.spin2');
    const blockType = findings.blockTypeForLine(30);
    assert.strictEqual(blockType, eBLockType.isPub, `Expected isPub at line 30, got ${eBLockType[blockType]}`);
  });

  it('should identify PRI block lines', function () {
    const findings = parseFixture('completion-basic.spin2');
    const blockType = findings.blockTypeForLine(40);
    assert.strictEqual(blockType, eBLockType.isPri, `Expected isPri at line 40, got ${eBLockType[blockType]}`);
  });
});

describe('DocumentFindings: localTokenEntriesForMethod()', function () {
  it('should return local tokens for Main method', function () {
    const findings = parseFixture('completion-basic.spin2');
    const localEntries: [string, RememberedToken][] = findings.localTokenEntriesForMethod('Main');
    assert.ok(localEntries.length > 0, `Expected local tokens for Main, got ${localEntries.length}`);
    const names: string[] = localEntries.map(([name]) => name);
    assert.ok(names.includes('localVar'), `Expected 'localVar' in Main locals, got: [${names.join(', ')}]`);
    assert.ok(names.includes('i'), `Expected 'i' in Main locals`);
  });

  it('should return local tokens for Helper method', function () {
    const findings = parseFixture('completion-basic.spin2');
    const localEntries: [string, RememberedToken][] = findings.localTokenEntriesForMethod('Helper');
    assert.ok(localEntries.length > 0, `Expected local tokens for Helper, got ${localEntries.length}`);
    const names: string[] = localEntries.map(([name]) => name);
    assert.ok(names.includes('value'), `Expected 'value' in Helper locals, got: [${names.join(', ')}]`);
    assert.ok(names.includes('result'), `Expected 'result' in Helper locals`);
  });

  it('should return empty array for unknown method', function () {
    const findings = parseFixture('completion-basic.spin2');
    const localEntries: [string, RememberedToken][] = findings.localTokenEntriesForMethod('NonexistentMethod');
    assert.strictEqual(localEntries.length, 0, 'Should return empty for unknown method');
  });
});

// ============================================================================
//  Tests for structure-related accessors
// ============================================================================

describe('RememberedStructure: members accessor', function () {
  it('should return members for a parsed structure', function () {
    const findings = parseFixture('completion-basic.spin2');
    const myPointStruct = findings.getStructure('MY_POINT');
    assert.ok(myPointStruct, 'MY_POINT structure should exist (requires {spin2_v52} directive)');
    const members: RememberedStructureMember[] = myPointStruct.members;
    assert.ok(members.length > 0, `Expected members in MY_POINT, got ${members.length}`);
    const memberNames: string[] = members.map((m) => m.name);
    assert.ok(memberNames.includes('x'), `Expected 'x' in MY_POINT members, got: [${memberNames.join(', ')}]`);
    assert.ok(memberNames.includes('y'), `Expected 'y' in MY_POINT members`);
    assert.ok(memberNames.includes('z'), `Expected 'z' in MY_POINT members`);
  });

  it('should return nested structure members for MY_LINE', function () {
    const findings = parseFixture('completion-basic.spin2');
    const myLineStruct = findings.getStructure('MY_LINE');
    assert.ok(myLineStruct, 'MY_LINE structure should exist');
    const members: RememberedStructureMember[] = myLineStruct.members;
    assert.strictEqual(members.length, 2, `Expected 2 members in MY_LINE, got ${members.length}`);
    const startPt = members.find((m) => m.name === 'start_pt');
    assert.ok(startPt, 'start_pt member should exist');
    assert.ok(startPt.isStructure, 'start_pt should be a structure type');
    assert.strictEqual(startPt.structName, 'MY_POINT', 'start_pt should reference MY_POINT');
  });

  it('should resolve struct instance types', function () {
    const findings = parseFixture('completion-basic.spin2');
    const structType = findings.getTypeForStructureInstance('myLine');
    assert.ok(structType, `Expected struct type for myLine, got undefined`);
    assert.strictEqual(structType.toUpperCase(), 'MY_LINE', `Expected MY_LINE type for myLine, got ${structType}`);
  });

  it('should support descending into nested struct members', function () {
    const findings = parseFixture('completion-basic.spin2');
    // Simulate dot-chain: myLine.start_pt. -> should resolve to MY_POINT
    const myLineStruct = findings.getStructure('MY_LINE');
    assert.ok(myLineStruct, 'MY_LINE should exist');
    const startPtMember = myLineStruct.memberNamed('start_pt');
    assert.ok(startPtMember, 'start_pt member should exist');
    assert.ok(startPtMember.isStructure, 'start_pt should be a structure');
    const nestedStruct = findings.getStructure(startPtMember.structName);
    assert.ok(nestedStruct, `Nested struct ${startPtMember.structName} should be resolvable`);
    assert.ok(nestedStruct.hasMemberNamed('x'), 'Nested struct should have member x');
    assert.ok(nestedStruct.hasMemberNamed('y'), 'Nested struct should have member y');
    assert.ok(nestedStruct.hasMemberNamed('z'), 'Nested struct should have member z');
  });
});

// ============================================================================
//  PNut v54: STRUCT bitfields — named and nameless forms
// ============================================================================

describe('RememberedStructure: v54 named bitfields on BYTE/WORD/LONG members', function () {
  it('should parse a LONG member with a chain of single-bit and range bitfields', function () {
    const findings = parseFixture('completion-bitfields.spin2');
    const pinState = findings.getStructure('PIN_STATE_T');
    assert.ok(pinState, 'PIN_STATE_T structure should exist with {Spin2_v54}');
    const members = pinState.members;
    assert.strictEqual(members.length, 1, `Expected 1 member in PIN_STATE_T, got ${members.length}`);
    const flags = members[0];
    assert.strictEqual(flags.name, 'flags', `Expected member name 'flags', got '${flags.name}'`);
    assert.strictEqual(flags.isNameless, false, 'flags should not be nameless');
    assert.ok(flags.hasBitfields, 'flags should carry bitfields');
    assert.strictEqual(flags.bitfields.length, 4, `Expected 4 bitfields, got ${flags.bitfields.length}`);
  });

  it('should capture correct bit ranges for each bitfield', function () {
    const findings = parseFixture('completion-bitfields.spin2');
    const pinState = findings.getStructure('PIN_STATE_T');
    assert.ok(pinState);
    const flags = pinState.members[0];
    const input = flags.getBitfield('input');
    assert.ok(input, 'input bitfield should exist');
    assert.strictEqual(input.lowBit, 0);
    assert.strictEqual(input.highBit, 0);

    const drive = flags.getBitfield('drive');
    assert.ok(drive, 'drive bitfield should exist');
    assert.strictEqual(drive.lowBit, 2);
    assert.strictEqual(drive.highBit, 3);

    const value = flags.getBitfield('value');
    assert.ok(value, 'value bitfield should exist');
    assert.strictEqual(value.lowBit, 24);
    assert.strictEqual(value.highBit, 31);
  });

  it('should answer hasBitfieldNamed case-insensitively', function () {
    const findings = parseFixture('completion-bitfields.spin2');
    const pinState = findings.getStructure('PIN_STATE_T');
    assert.ok(pinState);
    const flags = pinState.members[0];
    assert.ok(flags.hasBitfieldNamed('input'));
    assert.ok(flags.hasBitfieldNamed('INPUT'));
    assert.ok(!flags.hasBitfieldNamed('nonesuch'));
  });
});

describe('RememberedStructure: v54 nameless sole BYTE/WORD/LONG member', function () {
  it('should flag a nameless member and expose it via namelessMember', function () {
    const findings = parseFixture('completion-bitfields.spin2');
    const ioStruct = findings.getStructure('IO_T');
    assert.ok(ioStruct, 'IO_T structure should exist');
    assert.strictEqual(ioStruct.isNameless, true, 'IO_T should be isNameless');
    const sole = ioStruct.namelessMember;
    assert.ok(sole, 'namelessMember should be defined');
    assert.strictEqual(sole.isNameless, true);
    assert.strictEqual(sole.typeString, 'MT_Long');
  });

  it("should expose the sole member's bitfields via struct-level helper", function () {
    const findings = parseFixture('completion-bitfields.spin2');
    const ioStruct = findings.getStructure('IO_T');
    assert.ok(ioStruct);
    assert.ok(ioStruct.hasBitfieldNamed('ready'), 'IO_T should report ready as a bitfield');
    assert.ok(ioStruct.hasBitfieldNamed('counter'), 'IO_T should report counter as a bitfield');
    const sole = ioStruct.namelessMember;
    assert.ok(sole, 'namelessMember should be defined');
    const counter = sole.getBitfield('counter');
    assert.ok(counter);
    assert.strictEqual(counter.lowBit, 8);
    assert.strictEqual(counter.highBit, 31);
  });

  it('should bind io.ready as a bitfield reference on the struct instance', function () {
    const findings = parseFixture('completion-bitfields.spin2');
    const ioInstanceType = findings.getTypeForStructureInstance('io');
    assert.ok(ioInstanceType, 'io instance should be known');
    assert.strictEqual(ioInstanceType.toUpperCase(), 'IO_T');
  });
});

describe('v54 bitfield tokens: independence of coloring at use site vs. member', function () {
  it('should emit the bitfield modifier on a use-site bitfield token', function () {
    const findings = parseFixture('completion-bitfields.spin2');
    const tokens = findings.allSemanticTokens();
    // In PUB Main, "pin.flags.input" resolves to three segments: instance, member, bitfield.
    // The bitfield segment should carry the 'bitfield' modifier so themes can target it
    // without affecting regular struct-member tokens.
    const bitfieldTokens = tokens.filter(
      (t) => t.ptTokenType === 'variable' && t.ptTokenModifiers.includes('bitfield') && !t.ptTokenModifiers.includes('declaration')
    );
    assert.ok(bitfieldTokens.length > 0, 'Expected at least one use-site token carrying the bitfield modifier');
  });

  it('should emit the bitfield modifier (plus declaration) on decl-site bitfield names', function () {
    const findings = parseFixture('completion-bitfields.spin2');
    const tokens = findings.allSemanticTokens();
    const declBitfields = tokens.filter(
      (t) => t.ptTokenType === 'variable' && t.ptTokenModifiers.includes('bitfield') && t.ptTokenModifiers.includes('declaration')
    );
    assert.ok(declBitfields.length > 0, 'Expected at least one decl-site bitfield token with bitfield+declaration modifiers');
  });

  it('should not mark regular (non-bitfield) struct members with the bitfield modifier', function () {
    const findings = parseFixture('completion-basic.spin2');
    const tokens = findings.allSemanticTokens();
    const strayBitfield = tokens.filter((t) => t.ptTokenModifiers.includes('bitfield'));
    assert.strictEqual(strayBitfield.length, 0, 'Plain struct members (no bitfields) must not carry the bitfield modifier');
  });
});

// ============================================================================
//  Tests for built-in method lookup (Spin2ParseUtils)
// ============================================================================

describe('Spin2ParseUtils: built-in lookups for completion', function () {
  let parseUtils: Spin2ParseUtils;

  before(function () {
    parseUtils = new Spin2ParseUtils();
    const ctx = createTestContext();
    parseUtils.enableLogging(ctx, false);
  });

  it('should recognize built-in methods', function () {
    assert.ok(parseUtils.isSpinBuiltinMethod('pinw'), 'pinw should be a built-in method');
    assert.ok(parseUtils.isSpinBuiltinMethod('hubset'), 'hubset should be a built-in method');
    assert.ok(parseUtils.isSpinBuiltinMethod('cogspin'), 'cogspin should be a built-in method');
    assert.ok(parseUtils.isSpinBuiltinMethod('strsize'), 'strsize should be a built-in method');
  });

  it('should recognize built-in variables', function () {
    assert.ok(parseUtils.isSpinBuiltInVariable('clkfreq'), 'clkfreq should be a built-in variable');
    assert.ok(parseUtils.isSpinBuiltInVariable('clkmode'), 'clkmode should be a built-in variable');
    assert.ok(parseUtils.isSpinBuiltInVariable('dira'), 'dira should be a built-in variable');
  });

  it('should return documentation for built-in methods', function () {
    const doc = parseUtils.docTextForBuiltIn('pinw');
    assert.ok(doc.found, 'pinw documentation should be found');
    assert.ok(doc.signature.length > 0, 'pinw should have a signature');
    assert.ok(doc.description.length > 0, 'pinw should have a description');
  });

  it('should return documentation for built-in variables', function () {
    const doc = parseUtils.docTextForBuiltIn('clkfreq');
    assert.ok(doc.found, 'clkfreq documentation should be found');
    assert.ok(doc.description.length > 0, 'clkfreq should have a description');
  });

  it('should return not-found for unknown names', function () {
    const doc = parseUtils.docTextForBuiltIn('totally_not_a_builtin');
    assert.strictEqual(doc.found, false, 'Unknown name should not be found');
  });
});

// ============================================================================
//  Tests for getNamespaces() (object instance enumeration)
// ============================================================================

describe('DocumentFindings: getNamespaces()', function () {
  it('should return empty array for fixture without objects', function () {
    const findings = parseFixture('completion-basic.spin2');
    const namespaces = findings.getNamespaces();
    assert.ok(Array.isArray(namespaces), 'Should return an array');
    // completion-basic.spin2 has no real external objects
    assert.strictEqual(namespaces.length, 0, 'Should have no namespaces in single-file fixture');
  });
});

// ============================================================================
//  Tests for localPasmTokenEntriesForMethod()
// ============================================================================

describe('DocumentFindings: localPasmTokenEntriesForMethod()', function () {
  it('should return empty for methods without inline PASM', function () {
    const findings = parseFixture('completion-basic.spin2');
    const entries = findings.localPasmTokenEntriesForMethod('Main');
    assert.ok(Array.isArray(entries), 'Should return an array');
    assert.strictEqual(entries.length, 0, 'Main has no inline PASM, should be empty');
  });
});

// ============================================================================
//  Tests for getMethodNameForLine()
// ============================================================================

describe('DocumentFindings: getMethodNameForLine()', function () {
  it('should return Main for lines inside PUB Main', function () {
    const findings = parseFixture('completion-basic.spin2');
    // PUB Main() is at line 28 (0-indexed), body at 29+
    const methodName = findings.getMethodNameForLine(30);
    assert.strictEqual(methodName, 'Main', `Expected Main at line 30, got ${methodName}`);
  });

  it('should return Helper for lines inside PRI Helper', function () {
    const findings = parseFixture('completion-basic.spin2');
    // PRI Helper is at line 39, body at 40+
    const methodName = findings.getMethodNameForLine(40);
    assert.strictEqual(methodName, 'Helper', `Expected Helper at line 40, got ${methodName}`);
  });

  it('should return undefined for lines outside methods', function () {
    const findings = parseFixture('completion-basic.spin2');
    // CON section lines should not be inside any method
    const methodName = findings.getMethodNameForLine(6);
    assert.strictEqual(methodName, undefined, `Expected undefined at line 6 (CON), got ${methodName}`);
  });
});
