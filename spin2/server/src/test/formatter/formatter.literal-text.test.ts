'use strict';
// server/src/test/formatter/formatter.literal-text.test.ts
//
// Whitespace the formatter must leave alone, in the default spaces mode and in elastic mode:
// text the compiler stores (strings, debug backtick text) and comment text.
// Binary parity for the matching fixtures runs in the binary-parity and safety suites.

import * as assert from 'assert';
import { ElasticTabstopConfig } from '../../formatter/spin2.formatter.base';
import { formatSpin2Text } from './formatter.test-utils';

const ELASTIC: ElasticTabstopConfig = {
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
const MODES: { name: string; elastic?: ElasticTabstopConfig }[] = [{ name: 'spaces' }, { name: 'elastic', elastic: ELASTIC }];

function formattedLineWith(source: string, marker: string, elastic?: ElasticTabstopConfig): string {
  const line = formatSpin2Text(source, undefined, elastic)
    .split('\n')
    .find((candidate) => candidate.includes(marker));
  assert.ok(line !== undefined, `no formatted line contains ${marker}`);
  return line;
}

function assertTextSurvives(source: string, text: string): void {
  for (const mode of MODES) {
    const once = formatSpin2Text(source, undefined, mode.elastic);
    assert.ok(once.includes(text), `${mode.name}: lost ${JSON.stringify(text)} in ${JSON.stringify(once)}`);
    assert.strictEqual(formatSpin2Text(once, undefined, mode.elastic), once, `${mode.name}: not idempotent`);
  }
}

describe('Formatter: tab compression saves space', function () {
  const lineFrom = (source: string, marker: string): string => formattedLineWith(source, marker);

  it('keeps a single space that lands on a tab stop', function () {
    // The space before the 2 sits at column 15 and the 2 lands on the column-16 stop
    assert.strictEqual(lineFrom('PUB main() | i, temp\n  repeat\n    temp := i * 2\n', 'temp :='), '    temp := i * 2');
  });

  it('keeps two spaces when a tab and a space would be the same length', function () {
    // Starting at column 7 the run needs a tab for one space, then one more space
    assert.strictEqual(lineFrom('DAT\n  abcde  LONG    0\n', 'abcde'), '  abcde  LONG  0');
  });

  it('uses a tab where it makes the line shorter', function () {
    const source = 'PUB main() | a\n  repeat\n    repeat\n      repeat\n        repeat\n          a := 1\n';
    assert.strictEqual(lineFrom(source, 'a := 1'), '\t  a := 1');
  });

  it('only writes a tab into a run of whitespace when the run gets shorter', function () {
    const source = "CON\n  ALPHA = 1\n  BETA_GAMMA = 2      ' note\n\nVAR\n  LONG total\n\nPUB main() | i, temp\n  temp := i + 1\n";
    for (const line of formatSpin2Text(source).split('\n')) {
      let column = 0;
      for (const piece of line.match(/[ \t]+|[^ \t]+/g) ?? []) {
        const startColumn = column;
        for (const ch of piece) {
          column = ch === '\t' ? (Math.floor(column / 8) + 1) * 8 : column + 1;
        }
        if (piece.includes('\t')) {
          assert.ok(piece.length < column - startColumn, JSON.stringify(line));
        }
      }
    }
  });
});

describe('Formatter: literal text whitespace', function () {
  describe('strings', function () {
    it('keeps a run of spaces in a string', function () {
      assertTextSurvives('PUB main() | s\n  s := string("abcdef          ghi")\n', '"abcdef          ghi"');
    });

    it('keeps a single space that lands on a tab stop', function () {
      // "abc def" puts the space at column 15 and the next character on the column-16 stop
      assertTextSurvives('PUB main() | s\n  s := string("abc def")\n', '"abc def"');
    });

    it('keeps a literal tab in a string', function () {
      assertTextSurvives('PUB main() | s\n  s := string("one\ttab")\n', '"one\ttab"');
    });

    it('keeps DAT string text', function () {
      assertTextSurvives('DAT\nmsg     byte    "padded          text", 0\n', '"padded          text"');
      assertTextSurvives('DAT\nmsg     byte    "with\ttab", 0\n', '"with\ttab"');
    });

    it('does not take an apostrophe in a string for a comment', function () {
      assertTextSurvives('PUB main() | s\n  s := string("it\'s          here")\n', '"it\'s          here"');
    });

    it('still compresses the indent of a line holding a string', function () {
      const source = 'PUB main() | s\n  repeat\n    repeat\n      repeat\n        repeat\n          s := string("a          b")\n';
      assert.strictEqual(formattedLineWith(source, 'string('), '\t  s := string("a          b")');
    });
  });

  describe('debug backtick text', function () {
    it('keeps spaces in display text', function () {
      assertTextSurvives('PUB main()\n  debug(`scope a pos 100 0 size 800 600 linesize 6)\n', '`scope a pos 100 0 size 800 600 linesize 6)');
    });

    it('keeps a quoted title in display text and finds the comment after it', function () {
      const source = "PUB main()\n  debug(`bitmap f title 'a   title' pos 370 690 trace 2 rgb16)  ' display setup\n";
      assertTextSurvives(source, "`bitmap f title 'a   title' pos 370 690 trace 2 rgb16)");
      assertTextSurvives(source, "' display setup");
    });

    it('keeps a literal tab in display text', function () {
      assertTextSurvives('PUB main() | s\n  debug(`a tab\tinside `(s) more   text)\n', '`a tab\tinside `(s) more   text)');
    });
  });

  describe('debug() expressions', function () {
    it('keeps spaces in an expression, whose source text the compiler stores', function () {
      assertTextSurvives('PUB main() | a, b\n  debug(udec(a          +          b))\n', 'debug(udec(a          +          b))');
    });

    it('keeps a literal tab in an expression', function () {
      assertTextSurvives('PUB main() | a, b\n  debug(udec(a\t+ b))\n', 'debug(udec(a\t+ b))');
    });

    it('keeps spaces in an expression on a continuation line', function () {
      const source = 'PUB main() | a, b\n  debug(udec(a), ...\n              udec(a          +          b))\n';
      assertTextSurvives(source, 'udec(a          +          b))');
    });

    it('recognizes DEBUG in any case and with a mask', function () {
      assertTextSurvives('PUB main() | a, b\n  DEBUG(udec(a          +          b))\n', '(udec(a          +          b))');
      assertTextSurvives('PUB main() | a, b\n  debug[3](udec(a          +          b))\n', '(udec(a          +          b))');
    });

    it('keeps the case of an expression between two strings', function () {
      const source = 'CON\n  LIMIT = 4\n\nPUB main()\n  debug("first ", udec(limit), " then ", udec(limit + 1), " last")\n';
      assertTextSurvives(source, 'debug("first ", udec(limit), " then ", udec(limit + 1), " last")');
    });

    it('keeps the case of an expression on a continuation line', function () {
      const source = 'CON\n  LIMIT = 4\n\nPUB main() | a\n  debug(udec(a), ...\n        udec(limit))\n';
      assertTextSurvives(source, 'udec(limit))');
    });

    it('still normalizes case in code after a debug() call', function () {
      const source = 'CON\n  LIMIT = 4\n\nPUB main() | a\n  debug(udec(limit))\n  a := limit\n';
      assert.ok(formatSpin2Text(source).includes('udec(limit)'));
      assert.strictEqual(formattedLineWith(source, 'a :=').trim(), 'a := LIMIT');
    });

    it('protects nothing past the end of the call', function () {
      const source = 'PUB main() | a, b\n  debug(udec(a))\n  repeat\n    repeat\n      repeat\n        repeat\n          a := b\n';
      assert.strictEqual(formattedLineWith(source, 'a := b'), '\t  a := b');
    });

    it('does not take a method whose name ends in debug for a debug() call', function () {
      const source = 'PUB main() | a, b\n  my_debug(a,                         b)\n\nPRI my_debug(a, b)\n';
      assert.ok(formattedLineWith(source, 'my_debug(a,').includes('\t'));
    });
  });

  describe('comments', function () {
    it('leaves a column-0 doc comment exactly as written', function () {
      for (const text of [
        "''\t\t -- Copyright (c) 2022 Iron Sheep Productions, LLC",
        "''                 -- Copyright (c) 2022 Iron Sheep Productions, LLC"
      ]) {
        for (const mode of MODES) {
          assert.strictEqual(formattedLineWith(`${text}\n\nCON\n  A = 1\n`, 'Copyright', mode.elastic), text, mode.name);
        }
      }
    });

    it('leaves a column-0 plain comment exactly as written', function () {
      for (const text of [
        "'\t\t -- Copyright (c) 2022 Iron Sheep Productions, LLC",
        "'                  -- Copyright (c) 2022 Iron Sheep Productions, LLC"
      ]) {
        for (const mode of MODES) {
          assert.strictEqual(formattedLineWith(`${text}\n\nCON\n  A = 1\n`, 'Copyright', mode.elastic), text, mode.name);
        }
      }
    });

    it('keeps the words of a trailing comment apart with their own spacing', function () {
      const source = "CON\n  A = 1      ' trail with   words and      gaps here that run on\n";
      assertTextSurvives(source, "' trail with   words and      gaps here that run on");
    });

    it('still compresses the gap between code and a trailing comment', function () {
      const source = "PUB main() | value\n  value := 1                        ' note\n";
      const line = formattedLineWith(source, "' note");
      assert.ok(/\S\t+ *' note$/.test(line), JSON.stringify(line));
      assert.strictEqual(formatSpin2Text(formatSpin2Text(source)), formatSpin2Text(source));
    });

    it('is stable across repeated formatting when a comment group holds tabs', function () {
      const source =
        "PUB main() | value\n  ' first\n  '\tcreateFileNew()\tfails if the file already exists.\n  '   <= 8GB:\t8 sectors (4KB clusters)\n  value := 1\n";
      const once = formatSpin2Text(source);
      assert.strictEqual(formatSpin2Text(once), once);
      assert.ok(once.includes("'\tcreateFileNew()\tfails if the file already exists."), once);
    });
  });
});
