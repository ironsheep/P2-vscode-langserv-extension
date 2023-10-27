"use strict";
// server/src/parser/lang.utils.ts

export function isSpinOrPasmFile(fileSpec: string): boolean {
  let spinDocumentStatus: boolean = isSpin1File(fileSpec) || isSpin2File(fileSpec) || isPasmFile(fileSpec);
  return spinDocumentStatus;
}

function isPasmFile(fileSpec: string): boolean {
  let spinDocumentStatus: boolean = fileSpec.toLowerCase().endsWith(".p2asm");
  return spinDocumentStatus;
}

export function isSpinFile(fileSpec: string): boolean {
  let spinDocumentStatus: boolean = isSpin1File(fileSpec) || isSpin2File(fileSpec);
  return spinDocumentStatus;
}

export function isSpin1File(fileSpec: string): boolean {
  let spinDocumentStatus: boolean = fileSpec.toLowerCase().endsWith(".spin");
  return spinDocumentStatus;
}
export function isSpin2File(fileSpec: string): boolean {
  let spinDocumentStatus: boolean = isSpin2ORPasm(fileSpec);
  return spinDocumentStatus;
}

function isSpin2ORPasm(fileSpec: string): boolean {
  let spinDocumentStatus: boolean = fileSpec.toLowerCase().endsWith(".spin2") || fileSpec.toLowerCase().endsWith(".p2asm");
  return spinDocumentStatus;
}

export function fileSpecFromURI(docUri: string): string {
  const spaceRegEx = /\%20/g; // we are globally replacing %20 markers
  const fileRegEx = /^file:\/\//i; // remove leading "file://", case-insensative
  return docUri.replace(fileRegEx, "").replace(spaceRegEx, " ");
}
