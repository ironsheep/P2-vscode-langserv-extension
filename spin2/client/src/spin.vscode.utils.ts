/* eslint-disable @typescript-eslint/no-unused-vars */
'use strict';
import * as fs from 'fs';
import path = require('path');
// src/spin.vscode.utils.ts

import * as vscode from 'vscode';

export function activeFilespec(activeEditor?: vscode.TextEditor): string | undefined {
  let desidredFilespec: string | undefined = undefined;
  const textEditor = activeEditor !== undefined ? activeEditor : vscode.window.activeTextEditor;
  if (textEditor !== undefined) {
    desidredFilespec = textEditor.document.fileName;
  }
  return desidredFilespec;
}

export function activeSpin2Filespec(activeEditor?: vscode.TextEditor): string | undefined {
  let desiredFilespec: string | undefined = activeFilespec(activeEditor);
  if (desiredFilespec !== undefined) {
    desiredFilespec = existingSpin2File(path.basename(desiredFilespec));
  }
  return desiredFilespec;
}

export function existingSpin2File(filename: string): string | undefined {
  let desiredName: string | undefined = filename;
  if (!isSpin2File(desiredName)) {
    desiredName = `${desiredName}.spin2`;
  }
  if (!fs.existsSync(desiredName)) {
    desiredName = undefined;
  }
  return desiredName;
}

function filenameHasExtension(filename: string): boolean {
  const foundExtStatus: boolean = path.extname(filename).length > 0 ? true : false;
  return foundExtStatus;
}

export function activeSpinEditors(): vscode.TextEditor[] {
  const desiredEditors: vscode.TextEditor[] = [];
  const editors = vscode.window.visibleTextEditors!;
  if (editors.length > 0) {
    for (let index = 0; index < editors.length; index++) {
      const currEditor = editors[index];
      if (currEditor.document && isSpinOrPasmDocument(currEditor.document)) {
        desiredEditors.push(currEditor);
      }
    }
  }
  return desiredEditors;
}

export function editorForFilespec(filespec: string): vscode.TextEditor {
  let editorForFile: vscode.TextEditor = vscode.window.activeTextEditor!;
  if (editorForFile && editorForFile.document && editorForFile.document.fileName != filespec) {
    const editors = vscode.window.visibleTextEditors!;
    for (let index = 0; index < editors.length; index++) {
      const currEditor = editors[index];
      if (currEditor.document && currEditor.document.fileName == filespec) {
        editorForFile = currEditor;
        break;
      }
    }
  }
  return editorForFile;
}

export function isCurrentDocumentSpin1(): boolean {
  const editor = vscode?.window.activeTextEditor;
  const document = editor ? editor.document : undefined;
  let spin1DocStatus: boolean = false;
  if (document) {
    spin1DocStatus = isSpin1File(document.fileName);
  }
  return spin1DocStatus;
}

export function isCurrentDocumentSpin2(): boolean {
  const editor = vscode?.window.activeTextEditor;
  const document = editor ? editor.document : undefined;
  let spin2DocStatus: boolean = false;
  if (document) {
    spin2DocStatus = isSpin2File(document.fileName);
  }
  return spin2DocStatus;
}

export function isSpinDocument(document: vscode.TextDocument): boolean {
  let spinDocumentStatus: boolean = false;
  if (document) {
    spinDocumentStatus = isSpinFile(document.fileName);
  }
  return spinDocumentStatus;
}

export function isSpin2Document(document: vscode.TextDocument): boolean {
  let spinDocumentStatus: boolean = false;
  if (document) {
    spinDocumentStatus = isSpin2File(document.fileName);
  }
  return spinDocumentStatus;
}

export function isSpinOrPasmDocument(document: vscode.TextDocument): boolean {
  let spinDocumentStatus: boolean = false;
  if (document) {
    spinDocumentStatus = isSpinOrPasmFile(document.fileName);
  }
  return spinDocumentStatus;
}

export function isSpin1Document(document: vscode.TextDocument): boolean {
  let spinDocumentStatus: boolean = false;
  if (document) {
    spinDocumentStatus = isSpin1File(document.fileName);
  }
  return spinDocumentStatus;
}

export function isSpinOrPasmFile(fileSpec: string): boolean {
  const spinDocumentStatus: boolean = isSpin1File(fileSpec) || isSpin2File(fileSpec) || isPasmFile(fileSpec);
  return spinDocumentStatus;
}

function isPasmFile(fileSpec: string): boolean {
  const spinDocumentStatus: boolean = fileSpec.toLowerCase().endsWith('.p2asm');
  return spinDocumentStatus;
}

export function isSpinFile(fileSpec: string): boolean {
  const spinDocumentStatus: boolean = isSpin1File(fileSpec) || isSpin2File(fileSpec);
  return spinDocumentStatus;
}

export function isSpin1File(fileSpec: string): boolean {
  const spinDocumentStatus: boolean = fileSpec.toLowerCase().endsWith('.spin');
  return spinDocumentStatus;
}
export function isSpin2File(fileSpec: string): boolean {
  const spinDocumentStatus: boolean = fileSpec.toLowerCase().endsWith('.spin2');
  return spinDocumentStatus;
}

function isSpin2ORPasm(fileSpec: string): boolean {
  const spinDocumentStatus: boolean = fileSpec.toLowerCase().endsWith('.spin2') || fileSpec.toLowerCase().endsWith('.p2asm');
  return spinDocumentStatus;
}
