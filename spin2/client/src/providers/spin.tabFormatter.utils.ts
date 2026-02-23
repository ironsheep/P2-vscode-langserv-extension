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
