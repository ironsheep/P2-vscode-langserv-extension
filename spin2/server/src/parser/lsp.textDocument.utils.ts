"use strict";
// src/parser/spin2.utils.ts

import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

export function GetWordRangeAtPosition(lineText: string, position: lsp.Position, isSpin1File: boolean = false): lsp.Range {
  // return rage of word found at position
  let startIndex: number = position.character;
  let endIndex: number = position.character;
  const wordEndCharacterSetP1: string = "\"'[]()<> |^&@\t,+-*/\\=";
  const wordEndCharacterSetP2: string = "\"'[]()<> |^&#@\t,+-*/\\=:";
  const checkCharSet: string = isSpin1File ? wordEndCharacterSetP1 : wordEndCharacterSetP2;

  // back up to start of word, mark start
  let bStartFound: boolean = false;
  for (let index = startIndex; index > 0; index--) {
    if (checkCharSet.includes(lineText.charAt(index - 1))) {
      startIndex = index;
      bStartFound = true;
      break;
    }
  }
  if (!bStartFound) {
    startIndex = 0;
  }

  // go forward to end of word, mark end
  let bEndFound: boolean = false;
  for (let index = endIndex; index < lineText.length - 1; index++) {
    if (checkCharSet.includes(lineText.charAt(index + 1))) {
      endIndex = index + 1;
      bEndFound = true;
      break;
    }
  }
  if (!bEndFound) {
    endIndex = lineText.length;
  }

  // returning findings
  let wordRange: lsp.Range = { start: { line: position.line, character: startIndex }, end: { line: position.line, character: endIndex } };
  return wordRange;
}

export function PositionIsEqual(lhPosition: lsp.Position, rhPosition: lsp.Position): boolean {
  // return T/F where T means LHS is equal to RHS
  return lhPosition.line == rhPosition.line && lhPosition.character == rhPosition.character;
}

export function PositionIsAfter(lhPosition: lsp.Position, rhPosition: lsp.Position): boolean {
  // return T/F where T means LHS is after RHS
  return lhPosition.line > rhPosition.line || (lhPosition.line == rhPosition.line && lhPosition.character > rhPosition.character);
}

export function PositionTranslate(position: lsp.Position, lineOffset: number, charOffset: number): lsp.Position {
  // return position adjusted by offsets
  let adjustedPostion: lsp.Position = { line: position.line + lineOffset, character: position.character + charOffset };
  return adjustedPostion;
}

export function DocumentLineAt(document: TextDocument, position: lsp.Position): string {
  // return the full line at given document position
  const desiredLineRange: lsp.Range = { start: { line: position.line, character: 0 }, end: { line: position.line, character: Number.MAX_VALUE } };
  const lineText = document.getText(desiredLineRange);
  return lineText;
}
