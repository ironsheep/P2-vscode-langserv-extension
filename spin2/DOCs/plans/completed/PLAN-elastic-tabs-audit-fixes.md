# Elastic Tabstops & Edit Mode — Audit Fix Plan

## Context

A comprehensive audit of the elastic tabstops system (`spin.tabFormatter.ts`) and the insert/overtype/align mode system (`spin.editMode.behavior.ts`, `spin.editMode.mode.ts`, `extension.ts`) identified 15 findings. Of these, 9 require code changes (6 bug fixes + 3 clarifying comments) and 6 require no action.

A Phase 0 extraction step creates a testable pure-logic module so that the bug fixes in Fixes 1, 4, and 12 have automated regression tests.

## Files to Modify

| File | Changes |
|------|---------|
| `client/src/providers/spin.tabFormatter.utils.ts` | **NEW** — Phase 0: Pure logic functions extracted from Formatter |
| `client/src/providers/spin.tabFormatter.ts` | Phase 0 delegation + Findings 1, 2, 3, 4, 6, 8, 9, 12 |
| `client/src/providers/spin.editMode.behavior.ts` | Finding 7 |
| `client/src/extension.ts` | Findings 11, 13 |
| `client/src/test/tabFormatter.utils.test.ts` | **NEW** — Phase 0: Unit tests for extracted functions |
| `package.json` | Phase 0: Add `test:tabutils` script |

---

## Phase 0: Extract Pure Logic + Unit Tests

### Problem

The `Formatter` class in `spin.tabFormatter.ts` imports `vscode` at the top level and uses `vscode.workspace.getConfiguration()` in its constructor. This makes it impossible to instantiate or test any of its methods outside the VSCode extension host — even pure string/number functions like `countLeftWhiteSpace("  hello", 5)`.

### Solution

Extract all pure-logic methods (no vscode dependency) into a new file `spin.tabFormatter.utils.ts` with **zero imports from `vscode`**. The `Formatter` class keeps its methods as thin wrappers that convert `vscode.Position` ↔ character numbers and delegate to the utils.

This enables standalone Mocha tests via `ts-node` — the same pattern used by `npm run test:grammar` and `npm run test:server`.

### New File: `client/src/providers/spin.tabFormatter.utils.ts`

```typescript
'use strict';
// spin.tabFormatter.utils.ts
//
// Pure utility functions for elastic tabstop formatting.
// NO vscode imports — fully testable standalone via Mocha + ts-node.

/** Check if character at index is a space or tab. */
export function isCharWhite(text: string, index: number): boolean {
  const ch = text.charAt(index);
  return ch === ' ' || ch === '\t';
}

/** Check if entire string is whitespace. Returns first non-white index. */
export function isTextAllWhite(text: string): { bNotAllWhite: boolean; nonWhiteIndex: number } {
  for (let i = 0; i < text.length; i++) {
    if (!isCharWhite(text, i)) {
      return { bNotAllWhite: true, nonWhiteIndex: i };
    }
  }
  return { bNotAllWhite: false, nonWhiteIndex: text.length };
}

/**
 * Count deletable whitespace to the left of `offset`.
 * Returns the number of spaces that can be removed while preserving
 * at least 1 separator space before any preceding non-white text.
 * (i.e., total left whitespace minus 1 when non-white text is present.)
 */
export function countDeletableLeftWhiteSpace(textString: string, offset: number): number {
  if (offset < 0) {
    offset = 0;
  }
  let count = 0;
  if (offset > 0) {
    for (let idx = offset - 1; idx >= 0; idx--) {
      if (!isCharWhite(textString, idx)) {
        // Keep 1 space as separator before prior text
        if (count > 0) {
          count--;
        }
        break;
      }
      count++;
    }
  }
  return count;
}

/** Count consecutive whitespace characters starting at `startChar`. */
export function countWhiteCharsFrom(text: string, startChar: number): number {
  let count = 0;
  for (let idx = startChar; idx < text.length; idx++) {
    if (!isCharWhite(text, idx)) {
      break;
    }
    count++;
  }
  return count;
}

/**
 * Find the character index of the first double-whitespace (2+ consecutive spaces)
 * at or after `startChar`. Returns `undefined` if not found.
 */
export function findDoubleWhiteLeftEdge(text: string, startChar: number): number | undefined {
  for (let idx = startChar; idx < text.length - 1; idx++) {
    if (isCharWhite(text, idx) && isCharWhite(text, idx + 1)) {
      return idx;
    }
  }
  return undefined;
}

/**
 * Find the left edge of the text block at or near `startChar`.
 * If `startChar` is on whitespace, scans right to find the first non-white character.
 * If `startChar` is on non-whitespace, scans left to find the start of the text run.
 * Returns the character index of the left text edge.
 */
export function findLeftTextEdge(text: string, startChar: number): number {
  if (startChar >= text.length) {
    return text.length;
  }
  if (isCharWhite(text, startChar)) {
    // At whitespace — scan right for first non-white
    for (let idx = startChar + 1; idx < text.length; idx++) {
      if (!isCharWhite(text, idx)) {
        return idx;
      }
    }
    // No non-white found to the right
    return text.length;
  } else {
    // At non-whitespace — scan left for edge
    for (let idx = startChar - 1; idx >= 0; idx--) {
      if (isCharWhite(text, idx)) {
        return idx + 1;
      }
    }
    // No whitespace found — text starts at column 0
    return 0;
  }
}

/**
 * Find the next tab stop to the right of `character`.
 * `tabStops` is the sorted array of defined tab stop columns.
 * `tabSize` is the fallback increment when extending beyond defined stops.
 * Includes a safety cap to prevent infinite loops on degenerate input.
 */
export function findNextTabStop(tabStops: number[], tabSize: number, character: number): number {
  // Work on a copy so we don't mutate the caller's array
  const stops = [...tabStops].sort((a, b) => a - b);
  let index: number;
  let safetyLimit = 200;
  while ((index = stops.findIndex((element) => element > character)) === -1 && --safetyLimit > 0) {
    const lastStop = stops[stops.length - 1];
    if (stops.length < 2) {
      stops.push(lastStop + (tabSize || 2));
    } else {
      const secondLast = stops[stops.length - 2];
      const increment = lastStop - secondLast;
      stops.push(lastStop + (increment || tabSize || 2));
    }
  }
  return safetyLimit > 0 ? stops[index] : character + (tabSize || 2);
}

/**
 * Find the previous tab stop to the left of `character`.
 * Same parameters as findNextTabStop.
 */
export function findPreviousTabStop(tabStops: number[], tabSize: number, character: number): number {
  const stops = [...tabStops].sort((a, b) => a - b);
  let index: number;
  let safetyLimit = 200;
  while ((index = stops.findIndex((element) => element > character)) === -1 && --safetyLimit > 0) {
    const lastStop = stops[stops.length - 1];
    if (stops.length < 2) {
      stops.push(lastStop + (tabSize || 2));
    } else {
      const secondLast = stops[stops.length - 2];
      const increment = lastStop - secondLast;
      stops.push(lastStop + (increment || tabSize || 2));
    }
  }
  if (safetyLimit <= 0) {
    return 0;
  }
  let prevStop = stops[index - 1] ?? 0;
  if (prevStop === character) {
    prevStop = stops[index - 2] ?? 0;
  }
  return prevStop;
}
```

### Changes to `spin.tabFormatter.ts`

Add import at the top (after existing imports):
```typescript
import {
  isCharWhite,
  isTextAllWhite as isTextAllWhiteUtil,
  countDeletableLeftWhiteSpace as countDeletableLeftWhiteSpaceUtil,
  countWhiteCharsFrom,
  findDoubleWhiteLeftEdge,
  findLeftTextEdge,
  findNextTabStop,
  findPreviousTabStop
} from './spin.tabFormatter.utils';
```

Each existing method becomes a thin wrapper. The method signatures on the `Formatter` class stay the same so all call sites in `indentTabStop`, `outdentTabStop`, `alignBeforeType`, and `alignDelete` are unchanged. Only the method **bodies** change.

Examples of the delegation pattern:

```typescript
isCharWhiteAt(text: string, index: number): boolean {
  return isCharWhite(text, index);
}

isTextAllWhite(text: string): { bNotAllWhite: boolean; nonWhiteIndex: number } {
  return isTextAllWhiteUtil(text);
}

countDeletableLeftWhiteSpace(textString: string, offset: number): number {
  return countDeletableLeftWhiteSpaceUtil(textString, offset);
}

countOfWhiteChars(currLineText: string, cursorPos: vscode.Position): number {
  const result = countWhiteCharsFrom(currLineText, cursorPos.character);
  this.logMessage(
    ` - (DBG) countOfWhiteChars() ... => whiteLength is (${result}) spaces`
  );
  return result;
}

locateDoubleWhiteLeftEdge(currLineText: string, cursorPos: vscode.Position): vscode.Position | undefined {
  const charIdx = findDoubleWhiteLeftEdge(currLineText, cursorPos.character);
  this.logMessage(
    ` - (DBG) locateDoubleWhiteLeftEdge() ... => ${charIdx !== undefined ? `dblWhtPos=[${cursorPos.line}:${charIdx}]` : 'NOT FOUND'}`
  );
  if (charIdx === undefined) return undefined;
  return cursorPos.with(cursorPos.line, charIdx);
}

locateLeftTextEdge(currLineText: string, cursorPos: vscode.Position): vscode.Position {
  const charIdx = findLeftTextEdge(currLineText, cursorPos.character);
  this.logMessage(`---- ltEdge-[${cursorPos.line}:${charIdx}])`);
  return cursorPos.with(cursorPos.line, charIdx);
}

getPreviousTabStop(blockName: string, character: number): number {
  if (!blockName) blockName = 'con';
  const block = this.blocks[blockName.toLowerCase()];
  if (!block) {
    this.logMessage(`+ (WARN) getPreviousTabStop: Block '${blockName}' not found, using 'con' defaults`);
    return this.getPreviousTabStop('con', character);
  }
  const stops = block.tabStops ?? [this.tabSize];
  const result = findPreviousTabStop(stops, this.tabSize, character);
  this.logMessage(`+ (DBG) getPreviousTabStop(${blockName}) startFm-(${character}) -> TabStop-(${result})`);
  return result;
}

getNextTabStop(blockName: string, character: number): number {
  if (!blockName) blockName = 'con';
  const block = this.blocks[blockName.toLowerCase()];
  if (!block) {
    this.logMessage(`+ (WARN) getNextTabStop: Block '${blockName}' not found, using 'con' defaults`);
    return this.getNextTabStop('con', character);
  }
  const stops = block.tabStops ?? [this.tabSize];
  const result = findNextTabStop(stops, this.tabSize, character);
  return result;
}
```

**Key point:** The wrapper methods preserve the exact same public API (same parameter types, same return types) so all existing call sites within `indentTabStop()`, `outdentTabStop()`, `alignBeforeType()`, and `alignDelete()` remain unchanged. The `vscode.Position` ↔ `number` conversion happens exclusively in the wrappers.

### New File: `client/src/test/tabFormatter.utils.test.ts`

```typescript
'use strict';
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
    assert.strictEqual(isCharWhite('', 0), false);
  });
});

describe('isTextAllWhite', function () {
  it('should return false for all-space string', function () {
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
  });
});

describe('countDeletableLeftWhiteSpace', function () {
  it('should return 0 when offset is 0', function () {
    assert.strictEqual(countDeletableLeftWhiteSpace('  hello', 0), 0);
  });
  it('should return 0 when offset is 1 with text at column 0', function () {
    // 'h ' — offset 1, char[0] is 'h' (non-white), so 0 white chars
    assert.strictEqual(countDeletableLeftWhiteSpace('h ', 1), 0);
  });
  it('should return 0 when offset is 1 with space at column 0 (keeps 1 separator)', function () {
    // ' h' — offset 1, char[0] is ' ', count=1, but no non-white hit → all white to left
    // Loop: idx=0 is white → count=1, loop ends (idx < 0) → returns 1
    assert.strictEqual(countDeletableLeftWhiteSpace(' h', 1), 1);
  });
  it('should return whitespace-minus-1 when non-white text precedes', function () {
    // 'abc   X' — offset 6, chars[5,4,3] are spaces (count=3), char[2] is 'c' → count-1 = 2
    assert.strictEqual(countDeletableLeftWhiteSpace('abc   X', 6), 2);
  });
  it('should return full count when only whitespace to left (no non-white)', function () {
    // '     X' — offset 5, all 5 chars to left are spaces, loop ends without hitting non-white
    assert.strictEqual(countDeletableLeftWhiteSpace('     X', 5), 5);
  });
  it('should handle negative offset gracefully', function () {
    assert.strictEqual(countDeletableLeftWhiteSpace('hello', -3), 0);
  });
  it('should fix the offset=1 bug (was returning 0, now works)', function () {
    // '  hello' — offset 1, char[0] is space → count=1, loop ends → returns 1
    // OLD BUG: offset > 1 guard skipped this case entirely, returned 0
    assert.strictEqual(countDeletableLeftWhiteSpace('  hello', 1), 1);
  });
});

describe('countWhiteCharsFrom', function () {
  it('should count spaces from start position', function () {
    assert.strictEqual(countWhiteCharsFrom('   abc', 0), 3);
  });
  it('should return 0 when starting on non-white', function () {
    assert.strictEqual(countWhiteCharsFrom('abc  ', 0), 0);
  });
  it('should count from middle of string', function () {
    assert.strictEqual(countWhiteCharsFrom('abc  def', 3), 2);
  });
  it('should handle tabs', function () {
    assert.strictEqual(countWhiteCharsFrom('\t\tabc', 0), 2);
  });
});

describe('findDoubleWhiteLeftEdge', function () {
  it('should find double space', function () {
    assert.strictEqual(findDoubleWhiteLeftEdge('abc  def', 0), 3);
  });
  it('should return undefined when no double-white exists', function () {
    assert.strictEqual(findDoubleWhiteLeftEdge('a b c d', 0), undefined);
  });
  it('should search from startChar', function () {
    assert.strictEqual(findDoubleWhiteLeftEdge('  abc  def', 3), 5);
  });
  it('should find double-white at position 0', function () {
    // This is the case the old sentinel-based code got wrong
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
});

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
  it('should handle cursor at start of word after whitespace', function () {
    assert.strictEqual(findLeftTextEdge('   hello', 3), 3);
  });
});

describe('findNextTabStop', function () {
  it('should find next stop in simple array', function () {
    assert.strictEqual(findNextTabStop([4, 8, 12], 4, 0), 4);
    assert.strictEqual(findNextTabStop([4, 8, 12], 4, 4), 8);
    assert.strictEqual(findNextTabStop([4, 8, 12], 4, 5), 8);
  });
  it('should extend beyond defined stops', function () {
    // Past 12, increment is 12-8=4, so next is 16
    assert.strictEqual(findNextTabStop([4, 8, 12], 4, 12), 16);
    assert.strictEqual(findNextTabStop([4, 8, 12], 4, 15), 16);
    assert.strictEqual(findNextTabStop([4, 8, 12], 4, 16), 20);
  });
  it('should use tabSize for single-stop array', function () {
    assert.strictEqual(findNextTabStop([8], 4, 8), 12);
    assert.strictEqual(findNextTabStop([8], 4, 12), 16);
  });
  it('should handle unsorted input', function () {
    assert.strictEqual(findNextTabStop([12, 4, 8], 4, 0), 4);
  });
  it('should not loop forever on zero tabSize (safety cap)', function () {
    // Degenerate case: single stop and tabSize=0 — would infinite-loop without safety cap
    // With safety cap, should return a fallback value
    const result = findNextTabStop([0], 0, 0);
    assert.ok(typeof result === 'number', 'Should return a number');
  });
});

describe('findPreviousTabStop', function () {
  it('should find previous stop in simple array', function () {
    assert.strictEqual(findPreviousTabStop([4, 8, 12], 4, 5), 4);
    assert.strictEqual(findPreviousTabStop([4, 8, 12], 4, 8), 4);
    assert.strictEqual(findPreviousTabStop([4, 8, 12], 4, 12), 8);
  });
  it('should return 0 when at or before first stop', function () {
    assert.strictEqual(findPreviousTabStop([4, 8, 12], 4, 3), 0);
    assert.strictEqual(findPreviousTabStop([4, 8, 12], 4, 4), 0);
  });
  it('should extend beyond defined stops', function () {
    // Past 12, increment is 4, so stops extend to 16, 20, ...
    // Previous to 15 → 12
    assert.strictEqual(findPreviousTabStop([4, 8, 12], 4, 15), 12);
    // Previous to 16 → 12
    assert.strictEqual(findPreviousTabStop([4, 8, 12], 4, 16), 12);
  });
  it('should not loop forever on zero tabSize (safety cap)', function () {
    const result = findPreviousTabStop([0], 0, 5);
    assert.ok(typeof result === 'number', 'Should return a number');
  });
});
```

### New npm Script

Add to `package.json` scripts:
```json
"test:tabutils": "mocha --require ts-node/register client/src/test/tabFormatter.utils.test.ts --timeout 10000"
```

This runs instantly (~200ms) with no VSCode extension host needed.

### What This Tests

The test suite provides regression coverage for the three methods being fixed:

| Fix | Tested Function | Key Test Cases |
|-----|----------------|----------------|
| Fix 1 | `countDeletableLeftWhiteSpace` | offset=0, offset=1 (was broken), separator preservation, negative offset, all-white left |
| Fix 4 | `findDoubleWhiteLeftEdge` | returns `undefined` not found, double-white at position 0 (was broken by sentinel), normal cases |
| Fix 12 | `findNextTabStop`, `findPreviousTabStop` | normal stops, extension beyond defined stops, unsorted input, zero tabSize (safety cap) |

Plus general coverage of `isCharWhite`, `isTextAllWhite`, `countWhiteCharsFrom`, and `findLeftTextEdge` to ensure the extraction didn't break any logic.

---

## Fix 1: `countLeftWhiteSpace()` off-by-one guard (Finding 1)

**File:** `spin.tabFormatter.ts` lines 375-392

**Problem:** The guard `if (offset > 1)` skips the check when `offset == 1`, meaning text at column 1 cannot be outdented to column 0. Should be `offset > 0`.

The `-1` decrement inside the loop (lines 383-384) is intentional — the comment at line 997 says *"let's only go as far as to leave 1 space before prior text"*. The method returns deletable whitespace (total minus 1 separator space). The name doesn't convey this.

**Changes:**

1. Rename `countLeftWhiteSpace` → `countDeletableLeftWhiteSpace` (method definition + the one call site at line 999)
2. Change guard from `offset > 1` to `offset > 0`
3. Add a comment explaining the `-1` behavior

**Before:**
```typescript
countLeftWhiteSpace(textString: string, offset: number): number {
    let nbrWhiteSpaceChars: number = 0;
    if (offset < 0) {
      offset = 0;
    }
    if (offset > 1) {
      for (let idx: number = offset - 1; idx >= 0; idx--) {
        if (!this.isCharWhiteAt(textString, idx)) {
          if (nbrWhiteSpaceChars > 0) {
            nbrWhiteSpaceChars--;
          }
          break;
        }
        nbrWhiteSpaceChars++;
      }
    }
    return nbrWhiteSpaceChars;
  }
```

**After:**
```typescript
// Returns the number of whitespace characters to the left of offset that
// can be safely deleted while preserving at least 1 separator space before
// any preceding non-white text. (i.e., total left whitespace minus 1.)
countDeletableLeftWhiteSpace(textString: string, offset: number): number {
    let nbrWhiteSpaceChars: number = 0;
    if (offset < 0) {
      offset = 0;
    }
    if (offset > 0) {
      for (let idx: number = offset - 1; idx >= 0; idx--) {
        if (!this.isCharWhiteAt(textString, idx)) {
          // Keep 1 space as separator before prior text
          if (nbrWhiteSpaceChars > 0) {
            nbrWhiteSpaceChars--;
          }
          break;
        }
        nbrWhiteSpaceChars++;
      }
    }
    return nbrWhiteSpaceChars;
  }
```

**Call site (line 999):**
```typescript
// Before:
const whiteSpaceToLeftCt: number = this.countLeftWhiteSpace(currLineText, cursorPos.character);
// After:
const whiteSpaceToLeftCt: number = this.countDeletableLeftWhiteSpace(currLineText, cursorPos.character);
```

---

## Fix 2: Delete dead `countWhiteSpace()` method (Finding 2)

**File:** `spin.tabFormatter.ts` lines 361-373

**Problem:** Method name says "count white space" but it actually counts non-white characters. No callers exist anywhere in the codebase.

**Change:** Delete the entire method (lines 361-373).

---

## Fix 3: Delete dead `getCurrentTabStop()` method (Finding 3)

**File:** `spin.tabFormatter.ts` lines 198-232

**Problem:** No callers exist. Only `getNextTabStop` and `getPreviousTabStop` are used.

**Change:** Delete the entire method (lines 198-232).

---

## Fix 4: `locateDoubleWhiteLeftEdge()` ambiguous sentinel (Finding 4)

**File:** `spin.tabFormatter.ts`

**Problem:** Returns `Position(0, 0)` as a "not found" sentinel. This overlaps with a valid position (double-white starting at character 0 on line 0). Callers use inconsistent checks (`line != 0 && character != 0` vs `character > 0`).

**Change:** Return `vscode.Position | undefined`. Return `undefined` when no double-white found. Update all 4 call sites.

**Method (line 416):**

Before:
```typescript
locateDoubleWhiteLeftEdge(currLineText: string, cursorPos: vscode.Position): vscode.Position {
    let leftMostDoubleWhitePos: vscode.Position = cursorPos.with(0, 0);
    for (let idx: number = cursorPos.character; idx < currLineText.length - 1; idx++) {
      if (this.isCharWhiteAt(currLineText, idx) == true && this.isCharWhiteAt(currLineText, idx + 1) == true) {
        leftMostDoubleWhitePos = cursorPos.with(cursorPos.line, idx);
        break;
      }
    }
    ...
    return leftMostDoubleWhitePos;
  }
```

After:
```typescript
locateDoubleWhiteLeftEdge(currLineText: string, cursorPos: vscode.Position): vscode.Position | undefined {
    for (let idx: number = cursorPos.character; idx < currLineText.length - 1; idx++) {
      if (this.isCharWhiteAt(currLineText, idx) == true && this.isCharWhiteAt(currLineText, idx + 1) == true) {
        this.logMessage(
          ` - (DBG) locateDoubleWhiteLeftEdge() txt-[${currLineText}](${currLineText.length}) cursor-[${cursorPos.line}:${cursorPos.character}] => dblWhtPos=[${cursorPos.line}:${idx}]`
        );
        return cursorPos.with(cursorPos.line, idx);
      }
    }
    this.logMessage(
      ` - (DBG) locateDoubleWhiteLeftEdge() txt-[${currLineText}](${currLineText.length}) cursor-[${cursorPos.line}:${cursorPos.character}] => NOT FOUND`
    );
    return undefined;
  }
```

**Call site 1 — indentTabStop, align-mode delete compensation (line ~837):**

Before:
```typescript
const doubleWhitePos: vscode.Position = this.locateDoubleWhiteLeftEdge(currLineText, textLeftEdgePos);
if (doubleWhitePos.character > 0 && doubleWhitePos.character < currLineText.length) {
```

After:
```typescript
const doubleWhitePos = this.locateDoubleWhiteLeftEdge(currLineText, textLeftEdgePos);
if (doubleWhitePos !== undefined && doubleWhitePos.character < currLineText.length) {
```

**Call site 2 — indentTabStop, align-mode insert compensation (line ~859):**

Before:
```typescript
const doubleWhitePos: vscode.Position = this.locateDoubleWhiteLeftEdge(currLineText, textLeftEdgePos);
if (doubleWhitePos.character > 0 && doubleWhitePos.character < currLineText.length) {
```

After:
```typescript
const doubleWhitePos = this.locateDoubleWhiteLeftEdge(currLineText, textLeftEdgePos);
if (doubleWhitePos !== undefined && doubleWhitePos.character < currLineText.length) {
```

**Call site 3 — outdentTabStop, align-mode compensation (line ~1026):**

Before:
```typescript
const doubleWhitePos: vscode.Position = this.locateDoubleWhiteLeftEdge(currLineText, deleteEnd);
if (doubleWhitePos.line != 0 && doubleWhitePos.character != 0) {
```

After:
```typescript
const doubleWhitePos = this.locateDoubleWhiteLeftEdge(currLineText, deleteEnd);
if (doubleWhitePos !== undefined) {
```

**Call site 4 — alignDelete, compensating insert (line ~1208):**

Before:
```typescript
const doubleWhitePos: vscode.Position = this.locateDoubleWhiteLeftEdge(currLineText, textLeftEdge);
if (doubleWhitePos.line != 0 && doubleWhitePos.character != 0) {
```

After:
```typescript
const doubleWhitePos = this.locateDoubleWhiteLeftEdge(currLineText, textLeftEdge);
if (doubleWhitePos !== undefined) {
```

---

## Fix 5: No change (Finding 5)

Align space removal capped at `spaceCount - 1` is intentional — preserves at least 1 column separator space.

---

## Fix 6: Add comment to `alignBeforeType()` cursor return (Finding 6)

**File:** `spin.tabFormatter.ts` line 1114

**Problem:** The returned selection uses the pre-edit position, which looks wrong but works because VSCode's selection tracking adjusts positions after the batch edit completes.

**Change:** Add clarifying comment.

```typescript
// VSCode adjusts this selection by the edit deltas after the callback returns,
// so using the pre-edit position is correct here.
return new vscode.Selection(typeSel.end, typeSel.end);
```

---

## Fix 7: Add comment to overtype EOL insert (Finding 7)

**File:** `spin.editMode.behavior.ts` line 47-48

**Problem:** Returning the original selection after `edit.insert()` looks like a bug but works because VSCode adjusts selections by insert deltas.

**Change:** Add clarifying comment.

```typescript
} else {
  edit.insert(cursorPosition, text);
  // VSCode adjusts cursor position forward by the insert length automatically
  return selection;
}
```

---

## Fix 8: Remove empty `.then(() => {})` (Finding 8)

**File:** `spin.tabFormatter.ts` line 1119

**Problem:** Empty promise handler does nothing. Misleading — suggests there should be post-edit logic.

**Change:** Remove `.then(() => {})`.

Before:
```typescript
      )
      .then(() => {});
  }
```

After:
```typescript
      );
  }
```

---

## Fix 9: Add batch-edit semantics comment to `alignDelete()` (Finding 9)

**File:** `spin.tabFormatter.ts` lines 1198-1214

**Problem:** Code reads `editor.document.lineAt()` after calling `edit.delete()` in the same `editor.edit()` callback. Looks like it reads stale data, but is correct because VSCode's batch-edit model applies all edits atomically against the original document state.

**Change:** Add clarifying comment.

```typescript
edit.delete(range);

if (!bNoInsert) {
  // NOTE: Inside editor.edit(), all edits are applied atomically against the
  // original document state. Reading editor.document here returns the pre-edit
  // text, and the insert position is relative to that same pre-edit baseline.
  // This is correct — both the delete and insert will be applied together.
  const currLineText: string = editor.document.lineAt(lastLine).text;
```

---

## Fix 10: No change (Finding 10)

Multi-cursor indent/outdent disabling cursor repositioning is a reasonable trade-off for a niche case.

---

## Fix 11: Disable OVERTYPE/ALIGN when type override fails (Finding 11)

**File:** `extension.ts`

**Problem:** When another extension (e.g., Vim) owns the `type` command, the catch at line 196 fires but OVERTYPE/ALIGN modes remain available. The status bar shows "Overtype" but typing goes through VSCode's default handler — confusing UX.

**Change:** Add a module-level flag. When the catch fires, set the flag. In mode toggle, skip non-INSERT modes when the flag is true.

Add near the top of extension.ts (module scope):
```typescript
let typeOverrideAvailable: boolean = true;
```

In the catch block (line 196):
```typescript
} catch (err) {
  typeOverrideAvailable = false;
  logExtensionMessage(`WARN: Could not register type/paste overrides (another extension may own them): ${err}`);
  console.warn('Spin2 Extension: type/paste command registration failed:', err);
}
```

In the `toggleCommand` handler (wherever `toggleMode` is called), add a guard:
```typescript
// If type override registration failed, only INSERT mode is functional
if (!typeOverrideAvailable) {
  logExtensionMessage('CMD: toggle skipped — type command override not available');
  return;
}
```

And same for `toggleCommand2State`.

---

## Fix 12: Safety cap on tab stop extension loops (Finding 12)

**File:** `spin.tabFormatter.ts`

**Problem:** If `tabSize` is 0 or the last two tab stops are identical, the while loop in `getPreviousTabStop`, `getNextTabStop` (and the now-deleted `getCurrentTabStop`) would loop forever, pushing the same value.

**Change:** Add a safety counter to both remaining methods.

In `getPreviousTabStop` (line 172) and `getNextTabStop` (line 259):

Before:
```typescript
while ((index = tabStops.findIndex((element) => element > character)) === -1) {
```

After:
```typescript
let safetyLimit = 200;
while ((index = tabStops.findIndex((element) => element > character)) === -1 && --safetyLimit > 0) {
```

200 iterations is far beyond any realistic tab stop count (would cover columns 0–10,000+ even with tabSize=2).

---

## Fix 13: Decouple overtype mode from `isEnabled()` gate (Finding 13)

**File:** `extension.ts` line 2280-2289

**Problem:** Both OVERTYPE and ALIGN require `tabFormatter.isEnabled()` to be true. Overtype mode (replace char under cursor) is conceptually independent of elastic tabstops. If a user disables elastic tabs but sets OVERTYPE mode, typing falls through to `default:type` while the status bar still shows "Overtype".

ALIGN mode genuinely needs elastic tabstops for its compensating-space logic, so it stays gated.

**Change in `typeCommand()`:**

Before:
```typescript
const editMode = getMode(editor);
if (tabFormatter.isEnabled() && editMode == eEditMode.OVERTYPE) {
  logExtensionMessage('CMD: OVERTYPE type');
  overtypeBeforeType(editor, args.text, false);
} else if (tabFormatter.isEnabled() && editMode == eEditMode.ALIGN) {
  tabFormatter.alignBeforeType(editor, args.text, false);
} else {
  vscode.commands.executeCommand('default:type', args);
}
```

After:
```typescript
const editMode = getMode(editor);
if (editMode == eEditMode.OVERTYPE) {
  logExtensionMessage('CMD: OVERTYPE type');
  overtypeBeforeType(editor, args.text, false);
} else if (tabFormatter.isEnabled() && editMode == eEditMode.ALIGN) {
  tabFormatter.alignBeforeType(editor, args.text, false);
} else {
  vscode.commands.executeCommand('default:type', args);
}
```

**No change needed for `pasteCommand()`** — it already checks overtype without `isEnabled()` (line 2327).

**No change needed for `deleteLeftCommand()` / `deleteRightCommand()`** — these only intercept ALIGN mode, which correctly requires `isEnabled()`.

---

## Fix 14: No change (Finding 14)

Delete-left/right not intercepted in overtype mode is standard overtype behavior.

---

## Fix 15: No change (Finding 15)

Configuration reload works correctly. The `defaultCursorStyle` getter auto-refreshes; other styles are properly copied in `reloadEditModeConfiguration()`.

---

## Implementation Order

1. **Phase 0** — Extract pure logic into `spin.tabFormatter.utils.ts`, write unit tests, verify `npm run test:tabutils` passes
2. **Fix 2** — Delete `countWhiteSpace()` (dead code removal, zero risk)
3. **Fix 3** — Delete `getCurrentTabStop()` (dead code removal, zero risk)
4. **Fix 1** — Now a no-op in `spin.tabFormatter.ts` — the fix is already in the extracted `countDeletableLeftWhiteSpace()`. Just update the Formatter wrapper to use the new name.
5. **Fix 4** — `locateDoubleWhiteLeftEdge()` now delegates to `findDoubleWhiteLeftEdge()` which returns `number | undefined`. Update the 4 call sites.
6. **Fix 12** — Now a no-op in `spin.tabFormatter.ts` — the safety cap is already in the extracted `findNextTabStop()` and `findPreviousTabStop()`.
7. **Fix 8** — Remove `.then(() => {})` (cosmetic, zero risk)
8. **Fix 13** — Decouple overtype from `isEnabled()` (low risk — single condition change)
9. **Fix 11** — Type override failure flag (low risk — additive, only activates when catch fires)
10. **Fixes 6, 7, 9** — Add clarifying comments (zero risk)
11. **Verify** — Run `npm run compile` and `npm run test:tabutils` to confirm everything builds and tests pass

Note: Fixes 1, 4, and 12 are effectively implemented during Phase 0 — the extracted functions already contain the corrected logic. The Formatter wrappers just need to delegate to them.

## Testing

### Automated (Phase 0)

Run `npm run test:tabutils` — exercises all extracted pure-logic functions:
- `countDeletableLeftWhiteSpace`: offset=0, offset=1 (the off-by-one fix), separator preservation, all-white-left, negative offset
- `findDoubleWhiteLeftEdge`: undefined for not-found, double-white at position 0 (the sentinel fix), normal cases, edge cases
- `findNextTabStop` / `findPreviousTabStop`: normal stops, extension beyond defined stops, unsorted input, zero-tabSize safety cap
- `isCharWhite`, `isTextAllWhite`, `countWhiteCharsFrom`, `findLeftTextEdge`: baseline correctness after extraction

### Manual

- **Indent/Outdent:** Test in all 6 section types (CON, VAR, OBJ, PUB, PRI, DAT). Verify text at column 1 can now outdent to column 0. Verify multi-line indent/outdent still works.
- **Align mode:** Test type, delete-left, delete-right, paste in align mode. Verify compensating spaces are correctly added/removed. Test on line 0 of the file to verify the sentinel fix.
- **Overtype mode:** Disable elastic tabstops, set mode to OVERTYPE, verify typing still replaces characters. Re-enable elastic tabstops, verify overtype still works.
- **Mode toggle:** Simulate `type` override failure (temporarily throw in registration), verify mode toggle stays on INSERT.
- **Tab stop safety:** No practical test needed — the safety cap only fires on degenerate configuration. Covered by automated tests.
