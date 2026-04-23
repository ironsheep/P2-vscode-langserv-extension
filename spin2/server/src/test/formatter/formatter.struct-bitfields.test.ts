'use strict';
// server/src/test/formatter/formatter.struct-bitfields.test.ts
//
// PNut v54 STRUCT bitfield-range canonicalization tests.
//   - [ upper .. lower ]  →  [upper..lower]  inside STRUCT decls and their
//     continuation lines.
//   - Named and nameless sole-member forms.
//   - Idempotency: format(format(x)) == format(x).

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { formatSpin2Text } from './formatter.test-utils';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

describe('Formatter: v54 STRUCT bitfield canonicalization', function () {
  it('collapses spaces inside [upper..lower] range brackets on STRUCT decl', function () {
    const src = '{Spin2_v54}\nCON\n  STRUCT PIN_STATE_T(LONG flags.input[0].output[1].drive[ 3 .. 2 ].value[31..24])\n';
    const out = formatSpin2Text(src);
    assert.ok(out.includes('.drive[3..2]'), `Expected .drive[3..2] after format, got:\n${out}`);
    assert.ok(!out.includes('[ 3 .. 2 ]'), `Expected space-stripped range, got:\n${out}`);
  });

  it('collapses spaces inside [upper..lower] on continuation lines', function () {
    const src =
      '{Spin2_v54}\nCON\n  STRUCT PIN_STATE_T(LONG flags.input[0].output[1].drive[3..2], ...\n                    LONG more.field[ 31 .. 16 ])\n';
    const out = formatSpin2Text(src);
    assert.ok(out.includes('.field[31..16]'), `Expected continuation-line range collapsed, got:\n${out}`);
  });

  it('leaves single-bit [N] and array [count] brackets alone', function () {
    const src = '{Spin2_v54}\nCON\n  STRUCT IO_T(LONG.ready[0].error[1])\nVAR\n  BYTE buf[128]\n';
    const out = formatSpin2Text(src);
    assert.ok(out.includes('.ready[0]'), `Single-bit .ready[0] should be preserved, got:\n${out}`);
    assert.ok(out.includes('buf[128]'), `Array count [128] should be preserved, got:\n${out}`);
  });

  it('is idempotent on the v54 bitfield fixture', function () {
    const fixturePath = path.join(FIXTURES_DIR, 'struct-bitfields-v54.spin2');
    const src = fs.readFileSync(fixturePath, 'utf-8');
    const pass1 = formatSpin2Text(src);
    const pass2 = formatSpin2Text(pass1);
    assert.strictEqual(pass2, pass1, 'Formatter should be idempotent on v54 STRUCT bitfields fixture');
  });
});
