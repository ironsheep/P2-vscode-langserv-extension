'use strict';
// server/src/test/formatter/formatter.expected-output.test.ts
//
// What the formatter is supposed to produce, phase by phase and setting by setting.
// Binary parity proves formatting did not break a program; it cannot tell whether
// formatting did its job, since a formatter that changes nothing passes it. These tests can.
// Expected text comes from DOCs/plans/SPIN2-FORMATTER-RULES.md, section numbers in the names.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ElasticTabstopConfig } from '../../formatter/spin2.formatter.base';
import { formatSpin2Text, FormatterConfig } from './formatter.test-utils';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

const PROPELLER_TOOL: ElasticTabstopConfig = {
  enabled: true,
  commentGap: 0,
  tabStops: {
    con: [4, 8, 16, 20, 32, 44, 56, 68, 80],
    var: [4, 12, 24, 28, 32, 44, 56, 68, 80],
    obj: [4, 8, 16, 20, 32, 44, 56, 68, 80],
    pub: [4, 8, 12, 16, 20, 24, 28, 32, 56, 80],
    pri: [4, 8, 12, 16, 20, 24, 28, 32, 56, 80],
    dat: [4, 16, 20, 24, 28, 48, 52, 56, 60, 64, 68, 80]
  }
};

/** The text as an editor shows it: tabs replaced by spaces at 8-column stops. */
function visual(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let shown = '';
      for (const ch of line) {
        shown += ch === '\t' ? ' '.repeat(8 - (shown.length % 8)) : ch;
      }
      return shown;
    })
    .join('\n');
}

function shown(source: string, config?: Partial<FormatterConfig>, elastic?: ElasticTabstopConfig): string[] {
  return visual(formatSpin2Text(source, config, elastic)).split('\n');
}

/** Require these lines, in this order and adjacent, somewhere in the formatted text. */
function assertLines(source: string, expected: string[], config?: Partial<FormatterConfig>, elastic?: ElasticTabstopConfig): void {
  const actual = shown(source, config, elastic);
  const start = actual.findIndex((_line, idx) => expected.every((line, offset) => actual[idx + offset] === line));
  assert.ok(start >= 0, `Expected lines not found.\nExpected:\n${expected.join('\n')}\nActual:\n${actual.join('\n')}`);
}

describe('Formatter: expected output', function () {
  describe('tab expansion (1.2)', function () {
    it('expands tabs in code before aligning', function () {
      assertLines('CON\n\tALPHA\t=\t1\n\tBETA_GAMMA = 2\n', ['  ALPHA       = 1', '  BETA_GAMMA  = 2']);
    });

    it('leaves no tab in code in elastic mode', function () {
      const text = formatSpin2Text("PUB main() | a\n\ta :=\t1\t\t' note\n", undefined, PROPELLER_TOOL);
      assert.ok(!text.includes('\t'), JSON.stringify(text));
    });

    it('measures a tab as reaching the next 8-column stop', function () {
      // A tab after 'a' reaches column 8, the same indent as 8 spaces
      assertLines('PUB main() | a\n  repeat\n\ta := 1\n', ['  repeat', '    a := 1']);
    });
  });

  describe('trailing whitespace (1.2)', function () {
    const source = 'PUB main() | a   \n  a := 1   \n';

    it('trims by default', function () {
      assert.deepStrictEqual(formatSpin2Text(source).split('\n').slice(0, 2), ['PUB main() | a', '  a := 1']);
    });

    it('leaves it on method lines when trimTrailingWhitespace is false', function () {
      assert.ok(formatSpin2Text('PUB main() | a\n  a := 1   \n', { trimTrailingWhitespace: false }).includes('  a := 1   \n'));
    });
  });

  describe('CON (2.1)', function () {
    it('aligns = two spaces past the longest name, value one space after', function () {
      assertLines('CON\n  MAX_SERVOS = 6\n      DEFAULT_POS    =    1500\nPIN_LED = 56\n', [
        '  MAX_SERVOS   = 6',
        '  DEFAULT_POS  = 1500',
        '  PIN_LED      = 56'
      ]);
    });

    it('puts one space after each comma in an enum', function () {
      assertLines('CON\n  #0,   STATE_IDLE,STATE_RUN,     STATE_STOP\n', ['  #0, STATE_IDLE, STATE_RUN, STATE_STOP']);
    });

    it('aligns trailing comments 2 x indentSize past the widest content (1.6)', function () {
      assertLines("CON\n  A = 1 ' x\n  LONGER = 22 ' y\n", ["  A       = 1     ' x", "  LONGER  = 22    ' y"]);
    });
  });

  describe('VAR (2.2)', function () {
    it('aligns names on the next stop and spaces commas', function () {
      assertLines('VAR\n      long a,b\n   byte flags[4]\n word w\n', ['  LONG  a, b', '  BYTE  flags[4]', '  WORD  w']);
    });

    it('aligns trailing comments', function () {
      assertLines("VAR\n  LONG a ' x\n  LONG longer_name ' y\n", ["  LONG  a              ' x", "  LONG  longer_name    ' y"]);
    });
  });

  describe('OBJ (2.3)', function () {
    it('aligns the colon on the next stop past the minimum gap, and the filename after it', function () {
      assertLines('OBJ\n servo : "servo_driver"\n      display   :   "ssd1306"\n', ['  servo     : "servo_driver"', '  display   : "ssd1306"']);
    });
  });

  describe('DAT data (2.4)', function () {
    it('indents labels in a data-only section and aligns the columns', function () {
      assertLines('DAT\ns_Help BYTE 13\n BYTE "text", 13\n   BYTE 0\n', ['  s_Help  BYTE  13', '          BYTE  "text", 13', '          BYTE  0']);
    });
  });

  describe('DAT PASM (2.5)', function () {
    it('keeps labels at column 0 and aligns condition, mnemonic and operand columns', function () {
      assertLines('DAT\n  org\nloop mov a, #1\n if_c add a, #2\n  jmp #loop\n', [
        'loop        mov  a, #1',
        '      if_c  add  a, #2',
        '            jmp  #loop'
      ]);
    });

    it('aligns data lines in an ORG region separately from instructions (D.14)', function () {
      assertLines('DAT\n  org\nlabel_name mov a, #1\na long 0\n', ['label_name  mov  a, #1', 'a  LONG  0']);
    });
  });

  describe('PUB/PRI (2.6)', function () {
    const nested = 'PUB main() | a\n      if a\n            a := 1\n      a := 2\n';

    it('re-expresses nesting as indentSize x level', function () {
      assertLines(nested, ['  if a', '    a := 1', '  a := 2']);
    });

    it('honors indentSize', function () {
      assertLines(nested, ['   if a', '      a := 1', '   a := 2'], { indentSize: 3 });
      assertLines(nested, ['    if a', '        a := 1', '    a := 2'], { indentSize: 4 });
      assertLines(nested, ['        if a', '                a := 1', '        a := 2'], { indentSize: 8 });
    });

    it('does not change a declaration line', function () {
      assertLines('PUB  main( a,b )  :  c\n  c := a\n', ['PUB  main( a,b )  :  c']);
    });

    it('moves a full-line comment after the first code line to the next code line', function () {
      assertLines("PUB main() | a\n  a := 1\n' old code\n  a := 2\n", ['  a := 1', "  ' old code", '  a := 2']);
    });

    it('leaves a column-0 doc comment in the code area', function () {
      assertLines("PUB main() | a\n  a := 1\n'' note\n  a := 2\n", ['  a := 1', "'' note", '  a := 2']);
    });

    it('aligns trailing comments in a method', function () {
      assertLines("PUB main() | a\n  a := 1 ' x\n  a := 22222 ' y\n", ["  a := 1        ' x", "  a := 22222    ' y"]);
    });

    it('keeps inline PASM ORG and END at the method indent, with PASM on the default DAT stops', function () {
      assertLines('PUB main() | a\n      org\n loop mov a, #1\n      end\n', ['  org', 'loop          mov       a, #1', '  end']);
    });
  });

  describe('comment merging (1.6a)', function () {
    const source = "CON\n  A = 1 ' x\n\nCON\n  LONGER_NAME = 123 ' y\n";

    it('shares a comment column across consecutive small blocks', function () {
      const lines = shown(source);
      const columns = lines.filter((line) => line.includes("'")).map((line) => line.indexOf("'"));
      assert.strictEqual(columns.length, 2);
      assert.strictEqual(columns[0], columns[1], lines.join('\n'));
    });

    it('keeps a separate column for a block over 15 non-blank lines', function () {
      const manyLines = Array.from({ length: 16 }, (_unused, idx) => `  N${idx} = ${idx}`).join('\n');
      const lines = shown(`CON\n  A = 1 ' x\n${manyLines}\n\nCON\n  LONGER_NAME = 123 ' y\n`);
      const columns = lines.filter((line) => line.includes("'")).map((line) => line.indexOf("'"));
      assert.notStrictEqual(columns[0], columns[1], lines.join('\n'));
    });

    it('does not count blank lines toward the 15', function () {
      const manyLines = Array.from({ length: 5 }, (_unused, idx) => `  N${idx} = ${idx}\n\n\n`).join('');
      const lines = shown(`CON\n  A = 1 ' x\n${manyLines}\nCON\n  LONGER_NAME = 123 ' y\n`);
      const columns = lines.filter((line) => line.includes("'")).map((line) => line.indexOf("'"));
      assert.strictEqual(columns[0], columns[1], lines.join('\n'));
    });
  });

  describe('section keyword comments (1.2)', function () {
    it('puts one space before a comment on a section line', function () {
      assertLines("CON                  ' constants\n  A = 1\n", ["CON ' constants"]);
    });
  });

  describe('comment spacing (1.7)', function () {
    it('leaves column-0 comments as written (1.3)', function () {
      assert.ok(formatSpin2Text("'text\n\n''doc\n\nCON\n  A = 1\n").startsWith("'text\n\n''doc\n"));
    });

    it('adds a space in a group of indented comments', function () {
      assertLines("PUB main() | a\n  a := 1\n  'one\n  'two\n  a := 2\n", ["  ' one", "  ' two"]);
    });

    it('adds a space after the comment start in code', function () {
      assertLines("PUB main() | a\n  a := 1  'note\n  ''doc\n  a := 2\n", ["  a := 1    ' note", "  '' doc"]);
    });

    it('leaves it when spaceAfterCommentStart is false', function () {
      assertLines("PUB main() | a\n  a := 1  'note\n  ''doc\n  a := 2\n", ["  a := 1    'note", "  ''doc"], { spaceAfterCommentStart: false });
    });
  });

  describe('line continuation (1.6b)', function () {
    it('aligns the markers in a group 2 x indentSize past the widest code', function () {
      assertLines('PUB main() | a\n  a := 1 + ...\n       22222 + ...\n       3\n', ['  a := 1 +     ...', '    22222 +    ...']);
    });
  });

  describe('blank lines (1.8)', function () {
    const source = 'CON\n  A = 1\n\n\n\n  B = 2\n\n\n\nVAR\n  LONG c\n\n\n\nPUB one()\n\n\n\nPRI two()\n';

    function text(config?: Partial<FormatterConfig>): string {
      return formatSpin2Text(source, config);
    }

    it('caps blank lines inside a block at maxConsecutiveBlankLines', function () {
      assert.ok(text().includes('A  = 1\n\n  B'), text());
      assert.ok(text({ maxConsecutiveBlankLines: 3 }).includes('A  = 1\n\n\n\n  B'));
      assert.ok(text({ maxConsecutiveBlankLines: 0 }).includes('A  = 1\n  B'));
    });

    it('sets blankLinesBetweenSections', function () {
      assert.ok(/B\s+= 2\n\nVAR/.test(text()), text());
      assert.ok(/B\s+= 2\n\n\n\nVAR/.test(text({ blankLinesBetweenSections: 3 })));
      assert.ok(/B\s+= 2\nVAR/.test(text({ blankLinesBetweenSections: 0 })));
    });

    it('sets blankLinesBetweenMethods', function () {
      assert.ok(text().includes('PUB one()\n\n\nPRI two()'), text());
      assert.ok(text({ blankLinesBetweenMethods: 1 }).includes('PUB one()\n\nPRI two()'));
      assert.ok(text({ blankLinesBetweenMethods: 0 }).includes('PUB one()\nPRI two()'));
    });

    it('separates a method description from its first code line', function () {
      assertLines("PUB main() | a\n'' description\n  a := 1\n", ["'' description", '', '  a := 1']);
    });

    it('removes blank lines between a declaration and its description', function () {
      assertLines("PUB main() | a\n\n\n'' description\n\n  a := 1\n", ['PUB main() | a', "'' description"]);
    });
  });

  describe('final newline (1.2)', function () {
    it('ends with exactly one newline by default', function () {
      assert.strictEqual(formatSpin2Text('CON\n  A = 1'), 'CON\n  A  = 1\n');
      assert.strictEqual(formatSpin2Text('CON\n  A = 1\n\n\n\n'), 'CON\n  A  = 1\n');
    });

    it('adds none when insertFinalNewline is false', function () {
      assert.strictEqual(formatSpin2Text('CON\n  A = 1', { insertFinalNewline: false }), 'CON\n  A  = 1');
    });
  });

  describe('case settings (A)', function () {
    const method = 'PUB main() | a\n  If a\n    WaitMs(1)\n';
    const data = 'CON\n  Limit = 1\n\nVAR\n  Long total\n\nPUB main()\n  total := limit\n\nDAT\n  org\nentry  Mov total2, #1\ntotal2  Long 0\n';

    it('blockNameCase', function () {
      assert.ok(formatSpin2Text('con\n  A = 1\n').startsWith('CON'));
      assert.ok(formatSpin2Text('CON\n  A = 1\n', { blockNameCase: 'lowercase' }).startsWith('con'));
      assert.ok(formatSpin2Text('Con\n  A = 1\n', { blockNameCase: 'preserve' }).startsWith('Con'));
    });

    it('blockNameCase on PUB and DAT sections', function () {
      assert.ok(formatSpin2Text('pub main()\n').startsWith('PUB'));
      assert.ok(formatSpin2Text('dat\n  x long 0\n').startsWith('DAT'));
    });

    it('controlFlowCase', function () {
      assertLines(method, ['  If a'], {});
      assertLines(method, ['  IF a'], { controlFlowCase: 'uppercase' });
      assertLines(method, ['  if a'], { controlFlowCase: 'lowercase' });
    });

    it('methodCase', function () {
      assertLines(method, ['    WaitMs(1)'], {});
      assertLines(method, ['    WAITMS(1)'], { methodCase: 'uppercase' });
      assertLines(method, ['    waitms(1)'], { methodCase: 'lowercase' });
    });

    it('typeCase in VAR and DAT', function () {
      assertLines(data, ['  LONG  total'], {});
      assertLines(data, ['  long  total'], { typeCase: 'lowercase' });
      assertLines(data, ['  Long  total'], { typeCase: 'preserve' });
      assert.ok(formatSpin2Text(data).includes('LONG  0') || /LONG\s+0/.test(formatSpin2Text(data)));
      assert.ok(/long\s+0/.test(formatSpin2Text(data, { typeCase: 'lowercase' })));
    });

    it('typeCase in a method', function () {
      const source = 'PUB main() | a\n  a := Long[0]\n';
      assertLines(source, ['  a := LONG[0]'], {});
      assertLines(source, ['  a := long[0]'], { typeCase: 'lowercase' });
      assertLines(source, ['  a := Long[0]'], { typeCase: 'preserve' });
    });

    it('constantCase in CON and in code', function () {
      assertLines(data, ['  LIMIT  = 1'], {});
      assertLines(data, ['  total := LIMIT'], {});
      assertLines(data, ['  limit  = 1'], { constantCase: 'lowercase' });
      assertLines(data, ['  total := limit'], { constantCase: 'lowercase' });
      assertLines(data, ['  Limit  = 1'], { constantCase: 'preserve' });
      assertLines(data, ['  total := limit'], { constantCase: 'preserve' });
    });

    it('constantCase leaves STRUCT type and member names alone', function () {
      const source = '{Spin2_v45}\nCON\n  STRUCT point(LONG x, LONG y)\n  STRUCT seg(point a, point b)\n\nVAR\n  long z\n';
      for (const config of [{}, { constantCase: 'lowercase' }]) {
        const lines = shown(source, config);
        assert.ok(lines.includes('  STRUCT point(LONG x, LONG y)'), lines.join('\n'));
        assert.ok(lines.includes('  STRUCT seg(point a, point b)'), lines.join('\n'));
        assert.ok(lines.includes('  LONG  z'), lines.join('\n'));
      }
    });

    it('constantCase does not take a preprocessor directive for a constant', function () {
      const source = 'CON\n#ifdef SOME\n  A = 1\n#endif\n\nPUB main() | ifdef\n  ifdef := 1\n';
      assertLines(source, ['  ifdef := 1']);
    });

    it('pasmInstructionCase in DAT and inline PASM', function () {
      assert.ok(/\bMov\b/.test(formatSpin2Text(data)));
      assert.ok(/\bMOV\b/.test(formatSpin2Text(data, { pasmInstructionCase: 'uppercase' })));
      assert.ok(/\bmov\b/.test(formatSpin2Text(data, { pasmInstructionCase: 'lowercase' })));
      const inline = 'PUB main() | a\n  org\n  Mov a, #1\n  end\n';
      assert.ok(/\bMOV\b/.test(formatSpin2Text(inline, { pasmInstructionCase: 'uppercase' })));
    });

    it('never changes case in strings or comments', function () {
      const source = 'CON\n  LIMIT = 1\n\nPUB main() | s\n  s := string("limit long if")  \' limit long if\n';
      const text = formatSpin2Text(source, { controlFlowCase: 'uppercase', constantCase: 'uppercase', typeCase: 'uppercase' });
      assert.ok(text.includes('"limit long if"'), text);
      assert.ok(text.includes("' limit long if"), text);
    });
  });

  describe('untouchable content (1.3)', function () {
    it('leaves a { } block comment alone', function () {
      const block = '{\n   con   long    if\n\t\ttabbed   text   \n}\n';
      assert.ok(formatSpin2Text(`${block}CON\n  A = 1\n`, { blockNameCase: 'uppercase' }).startsWith(block));
    });

    it('leaves preprocessor lines alone', function () {
      assertLines('CON\n  #define   SOME   1\n#ifdef SOME\n  A = 1\n#endif\n', ['  #define   SOME   1', '#ifdef SOME'], {});
    });
  });

  describe('STRUCT and preprocessor source', function () {
    const source = fs.readFileSync(path.join(FIXTURES_DIR, 'regr-struct-preprocessor-mix.spin2'), 'utf-8');

    it('keeps directive lines at column 0 and normalizes the code around them', function () {
      const lines = shown(source);
      for (const directive of ['#define FAST_BLINK', '#ifdef FAST_BLINK', '#else', '#endif']) {
        assert.ok(lines.includes(directive), `${directive} moved:\n${lines.join('\n')}`);
      }
      assert.ok(lines.includes('  repeat 2'), lines.join('\n'));
      assert.ok(lines.includes('    pintoggle(56)'), lines.join('\n'));
    });

    it('keeps each STRUCT definition on its line with its members', function () {
      const lines = shown(source);
      assert.ok(
        lines.some((line) => /STRUCT point\(LONG x, LONG y\)/.test(line)),
        lines.join('\n')
      );
      assert.ok(
        lines.some((line) => /STRUCT line_seg\(point start, point finish, BYTE weight\)/.test(line)),
        lines.join('\n')
      );
    });
  });

  describe('line endings', function () {
    const names = fs.readdirSync(FIXTURES_DIR).filter((fileName) => fileName.endsWith('.spin2'));
    for (const name of names) {
      it(`${name}: CRLF source formats the same as LF source`, function () {
        const text = fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
        assert.strictEqual(formatSpin2Text(text.replace(/\n/g, '\r\n')), formatSpin2Text(text));
      });
    }
  });

  describe('elastic tabstops (3)', function () {
    it('uses no tab characters', function () {
      const source =
        'CON\n  ALPHA = 1  \' note\n\nVAR\n  LONG a\n\nOBJ\n  c : "dummy_child"\n\nPUB main() | b\n  repeat\n    repeat\n      repeat\n        repeat\n          b := 1\n\nDAT\n  x long 0\n';
      const text = formatSpin2Text(source, undefined, PROPELLER_TOOL);
      assert.ok(!text.includes('\t'), JSON.stringify(text));
    });

    it('takes the method indent from the first PUB stop', function () {
      assertLines('PUB main() | a\n  if a\n    a := 1\n', ['    if a', '        a := 1'], undefined, PROPELLER_TOOL);
    });

    it('takes VAR name columns from the profile', function () {
      assertLines('VAR\n  LONG a\n', ['    LONG    a'], undefined, PROPELLER_TOOL);
    });

    it('places trailing comments on the default comment column when content fits', function () {
      const lines = shown("CON\n  A = 1  ' note\n", undefined, PROPELLER_TOOL);
      const line = lines.find((candidate) => candidate.includes("' note"));
      assert.strictEqual(line?.indexOf("'"), 68, lines.join('\n'));
    });

    it('is stable, and differs from spaces mode', function () {
      const source = "CON\n  ALPHA = 1  ' note\n\nPUB main() | a\n  a := 1  ' why\n";
      const once = formatSpin2Text(source, undefined, PROPELLER_TOOL);
      assert.strictEqual(formatSpin2Text(once, undefined, PROPELLER_TOOL), once);
      assert.notStrictEqual(once, formatSpin2Text(source));
    });
  });
});
