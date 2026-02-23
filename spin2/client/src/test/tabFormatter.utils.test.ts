'use strict';
// client/src/test/tabFormatter.utils.test.ts
//
// Unit tests for the pure-logic elastic tabstop utility functions.
// Runs standalone via: npm run test:tabutils (mocha + ts-node, no VSCode host)

import * as assert from 'assert';
import {
  isCharWhite,
  isTextAllWhite,
  countDeletableLeftWhiteSpace,
  countWhiteCharsFrom,
  findDoubleWhiteLeftEdge,
  findLeftTextEdge,
  findNextTabStop,
  findPreviousTabStop
} from '../providers/spin.tabFormatter.utils';

// ---------------------------------------------------------------------------
//  isCharWhite
// ---------------------------------------------------------------------------
describe('isCharWhite', function () {
  it('should return true for space', function () {
    assert.strictEqual(isCharWhite('a b', 1), true);
  });
  it('should return true for tab', function () {
    assert.strictEqual(isCharWhite('a\tb', 1), true);
  });
  it('should return false for letter', function () {
    assert.strictEqual(isCharWhite('abc', 1), false);
  });
  it('should return false for empty string at index 0', function () {
    // charAt returns '' for out-of-range, which is neither space nor tab
    assert.strictEqual(isCharWhite('', 0), false);
  });
  it('should return false for digit', function () {
    assert.strictEqual(isCharWhite('a1b', 1), false);
  });
});

// ---------------------------------------------------------------------------
//  isTextAllWhite
// ---------------------------------------------------------------------------
describe('isTextAllWhite', function () {
  it('should return bNotAllWhite=false for all-space string', function () {
    const result = isTextAllWhite('   ');
    assert.strictEqual(result.bNotAllWhite, false);
  });
  it('should detect non-white with correct index', function () {
    const result = isTextAllWhite('  x ');
    assert.strictEqual(result.bNotAllWhite, true);
    assert.strictEqual(result.nonWhiteIndex, 2);
  });
  it('should handle empty string', function () {
    const result = isTextAllWhite('');
    assert.strictEqual(result.bNotAllWhite, false);
    assert.strictEqual(result.nonWhiteIndex, 0);
  });
  it('should detect non-white at position 0', function () {
    const result = isTextAllWhite('hello');
    assert.strictEqual(result.bNotAllWhite, true);
    assert.strictEqual(result.nonWhiteIndex, 0);
  });
  it('should handle tabs as whitespace', function () {
    const result = isTextAllWhite('\t\t');
    assert.strictEqual(result.bNotAllWhite, false);
  });
});

// ---------------------------------------------------------------------------
//  countDeletableLeftWhiteSpace  (Fix 1 — off-by-one regression tests)
// ---------------------------------------------------------------------------
describe('countDeletableLeftWhiteSpace', function () {
  it('should return 0 when offset is 0', function () {
    assert.strictEqual(countDeletableLeftWhiteSpace('  hello', 0), 0);
  });

  it('should return 0 when offset is 1 with non-white at column 0', function () {
    // 'h ' — char[0]='h' (non-white), count=0 after loop
    assert.strictEqual(countDeletableLeftWhiteSpace('h ', 1), 0);
  });

  it('should return 1 when offset is 1 with space at column 0 (all white to left)', function () {
    // ' h' — char[0]=' ', count=1, loop ends (idx<0) → no non-white found → returns 1
    assert.strictEqual(countDeletableLeftWhiteSpace(' h', 1), 1);
  });

  it('should return whitespace-minus-1 when non-white text precedes', function () {
    // 'abc   X' — offset 6: chars[5,4,3]=' ' (count=3), char[2]='c' → count-1=2
    assert.strictEqual(countDeletableLeftWhiteSpace('abc   X', 6), 2);
  });

  it('should return full count when only whitespace to left (no preceding text)', function () {
    // '     X' — offset 5: all 5 chars are spaces, loop ends → count=5
    assert.strictEqual(countDeletableLeftWhiteSpace('     X', 5), 5);
  });

  it('should handle negative offset gracefully', function () {
    assert.strictEqual(countDeletableLeftWhiteSpace('hello', -3), 0);
  });

  it('FIX REGRESSION: offset=1 with all-white to left should work (was broken by > 1 guard)', function () {
    // '  hello' — offset 1: char[0]=' ', count=1, loop ends → returns 1
    // OLD BUG: guard was offset > 1, so offset=1 returned 0
    assert.strictEqual(countDeletableLeftWhiteSpace('  hello', 1), 1);
  });

  it('should return 0 when single non-white char at offset 1', function () {
    // 'ab' — offset 1: char[0]='a' (non-white), count=0 → returns 0
    assert.strictEqual(countDeletableLeftWhiteSpace('ab', 1), 0);
  });

  it('should preserve 1 space separator with 2 spaces before text', function () {
    // 'x  y' — offset 3: char[2]=' '(count=1), char[1]=' '(count=2), char[0]='x'(non-white) → count-1=1
    assert.strictEqual(countDeletableLeftWhiteSpace('x  y', 3), 1);
  });

  it('should return 0 when single space before text', function () {
    // 'x y' — offset 2: char[1]=' '(count=1), char[0]='x'(non-white) → count-1=0
    assert.strictEqual(countDeletableLeftWhiteSpace('x y', 2), 0);
  });
});

// ---------------------------------------------------------------------------
//  countWhiteCharsFrom
// ---------------------------------------------------------------------------
describe('countWhiteCharsFrom', function () {
  it('should count leading spaces', function () {
    assert.strictEqual(countWhiteCharsFrom('   abc', 0), 3);
  });
  it('should return 0 when starting on non-white', function () {
    assert.strictEqual(countWhiteCharsFrom('abc  ', 0), 0);
  });
  it('should count from middle of string', function () {
    assert.strictEqual(countWhiteCharsFrom('abc  def', 3), 2);
  });
  it('should count tabs', function () {
    assert.strictEqual(countWhiteCharsFrom('\t\tabc', 0), 2);
  });
  it('should return 0 for empty string', function () {
    assert.strictEqual(countWhiteCharsFrom('', 0), 0);
  });
  it('should count to end of string if all white', function () {
    assert.strictEqual(countWhiteCharsFrom('abc   ', 3), 3);
  });
});

// ---------------------------------------------------------------------------
//  findDoubleWhiteLeftEdge  (Fix 4 — sentinel regression tests)
// ---------------------------------------------------------------------------
describe('findDoubleWhiteLeftEdge', function () {
  it('should find double space in middle of text', function () {
    assert.strictEqual(findDoubleWhiteLeftEdge('abc  def', 0), 3);
  });

  it('should return undefined when no double-white exists', function () {
    assert.strictEqual(findDoubleWhiteLeftEdge('a b c d', 0), undefined);
  });

  it('should search from startChar', function () {
    assert.strictEqual(findDoubleWhiteLeftEdge('  abc  def', 3), 5);
  });

  it('FIX REGRESSION: should find double-white at position 0', function () {
    // OLD BUG: returned Position(0,0) as sentinel, which was indistinguishable from a real match at char 0
    assert.strictEqual(findDoubleWhiteLeftEdge('  abc', 0), 0);
  });

  it('should handle single-char string', function () {
    assert.strictEqual(findDoubleWhiteLeftEdge('a', 0), undefined);
  });

  it('should handle empty string', function () {
    assert.strictEqual(findDoubleWhiteLeftEdge('', 0), undefined);
  });

  it('should find double-white at end of string', function () {
    assert.strictEqual(findDoubleWhiteLeftEdge('abc  ', 0), 3);
  });

  it('should find tabs as double-white', function () {
    assert.strictEqual(findDoubleWhiteLeftEdge('abc\t\tdef', 0), 3);
  });

  it('should find mixed space+tab as double-white', function () {
    assert.strictEqual(findDoubleWhiteLeftEdge('abc \tdef', 0), 3);
  });

  it('should skip single spaces', function () {
    assert.strictEqual(findDoubleWhiteLeftEdge('a b c  d', 0), 5);
  });
});

// ---------------------------------------------------------------------------
//  findLeftTextEdge
// ---------------------------------------------------------------------------
describe('findLeftTextEdge', function () {
  it('should skip whitespace rightward to find text', function () {
    assert.strictEqual(findLeftTextEdge('   hello', 0), 3);
  });
  it('should scan left from non-white to find edge', function () {
    assert.strictEqual(findLeftTextEdge('   hello', 5), 3);
  });
  it('should return 0 when text starts at column 0', function () {
    assert.strictEqual(findLeftTextEdge('hello   ', 2), 0);
  });
  it('should return text.length when all white to right', function () {
    assert.strictEqual(findLeftTextEdge('   ', 0), 3);
  });
  it('should return startChar when at start of word after whitespace', function () {
    // startChar=3 is 'h' (non-white), scan left: char[2]=' ' → return 3
    assert.strictEqual(findLeftTextEdge('   hello', 3), 3);
  });
  it('should handle startChar at end of string', function () {
    assert.strictEqual(findLeftTextEdge('abc', 3), 3);
  });
  it('should handle empty string', function () {
    assert.strictEqual(findLeftTextEdge('', 0), 0);
  });
});

// ---------------------------------------------------------------------------
//  findNextTabStop  (Fix 12 — safety cap regression tests)
// ---------------------------------------------------------------------------
describe('findNextTabStop', function () {
  it('should find next stop in simple array', function () {
    assert.strictEqual(findNextTabStop([4, 8, 12], 4, 0), 4);
    assert.strictEqual(findNextTabStop([4, 8, 12], 4, 4), 8);
    assert.strictEqual(findNextTabStop([4, 8, 12], 4, 5), 8);
    assert.strictEqual(findNextTabStop([4, 8, 12], 4, 11), 12);
  });

  it('should extend beyond defined stops using last increment', function () {
    // Stops: [4, 8, 12], increment = 12-8 = 4 → next after 12 is 16
    assert.strictEqual(findNextTabStop([4, 8, 12], 4, 12), 16);
    assert.strictEqual(findNextTabStop([4, 8, 12], 4, 15), 16);
    assert.strictEqual(findNextTabStop([4, 8, 12], 4, 16), 20);
  });

  it('should use tabSize for single-stop array extension', function () {
    assert.strictEqual(findNextTabStop([8], 4, 8), 12);
    assert.strictEqual(findNextTabStop([8], 4, 12), 16);
  });

  it('should handle unsorted input', function () {
    assert.strictEqual(findNextTabStop([12, 4, 8], 4, 0), 4);
  });

  it('FIX REGRESSION: should not loop forever on zero tabSize (safety cap)', function () {
    const result = findNextTabStop([0], 0, 0);
    assert.ok(typeof result === 'number', 'Should return a number');
    assert.ok(result > 0, 'Should return a positive fallback value');
  });

  it('should not mutate the input array', function () {
    const stops = [4, 8, 12];
    findNextTabStop(stops, 4, 20);
    assert.strictEqual(stops.length, 3, 'Original array should not be modified');
  });

  it('should handle typical Spin2 DAT tab stops', function () {
    // Typical DAT: [0, 8, 16, 18, 24, 32, 40, 48, 56]
    const datStops = [0, 8, 16, 18, 24, 32, 40, 48, 56];
    assert.strictEqual(findNextTabStop(datStops, 2, 0), 8);
    assert.strictEqual(findNextTabStop(datStops, 2, 16), 18);
    assert.strictEqual(findNextTabStop(datStops, 2, 17), 18);
  });
});

// ---------------------------------------------------------------------------
//  findPreviousTabStop  (Fix 12 — safety cap regression tests)
// ---------------------------------------------------------------------------
describe('findPreviousTabStop', function () {
  it('should find previous stop in simple array', function () {
    assert.strictEqual(findPreviousTabStop([4, 8, 12], 4, 5), 4);
    assert.strictEqual(findPreviousTabStop([4, 8, 12], 4, 12), 8);
  });

  it('should return 0 when at or before first stop', function () {
    assert.strictEqual(findPreviousTabStop([4, 8, 12], 4, 3), 0);
    assert.strictEqual(findPreviousTabStop([4, 8, 12], 4, 4), 0);
  });

  it('should skip current position when exactly on a stop', function () {
    // At position 8: first stop > 8 is 12, index=2, stops[1]=8 === character → falls to stops[0]=4
    assert.strictEqual(findPreviousTabStop([4, 8, 12], 4, 8), 4);
  });

  it('should extend beyond defined stops', function () {
    // Past 12: increment=4, extension to 16, 20...
    // Previous to 15: first stop > 15 is 16, index for 16, stops[index-1]=12
    assert.strictEqual(findPreviousTabStop([4, 8, 12], 4, 15), 12);
  });

  it('FIX REGRESSION: should not loop forever on zero tabSize (safety cap)', function () {
    const result = findPreviousTabStop([0], 0, 5);
    assert.ok(typeof result === 'number', 'Should return a number');
  });

  it('should not mutate the input array', function () {
    const stops = [4, 8, 12];
    findPreviousTabStop(stops, 4, 20);
    assert.strictEqual(stops.length, 3, 'Original array should not be modified');
  });
});
