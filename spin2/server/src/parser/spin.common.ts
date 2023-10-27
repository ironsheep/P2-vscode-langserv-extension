"use strict";
// server/src/parser/spin.semantic.findings.ts

export enum eDebugDisplayType {
  Unknown = 0,
  ddtLogic,
  ddtScope,
  ddtScopeXY,
  ddtFFT,
  ddtSpectro,
  ddtPlot,
  ddtTerm,
  ddtBitmap,
  ddtMidi,
}

export enum eBuiltInType {
  Unknown = 0,
  BIT_CONSTANT,
  BIT_DEBUG_INVOKE, // spin2
  BIT_DEBUG_METHOD, // spin2
  BIT_DEBUG_SYMBOL, // spin2
  BIT_LANG_PART,
  BIT_METHOD,
  BIT_METHOD_POINTER, // spin2
  BIT_PASM_DIRECTIVE,
  BIT_SYMBOL,
  BIT_TYPE,
  BIT_VARIABLE,
}

export enum eParseState {
  Unknown = 0,
  inCon,
  inDat,
  inObj,
  inPub,
  inPri,
  inVar,
  inPAsmInline,
  inDatPAsm,
  inMultiLineComment,
  inMultiLineDocComment,
  inNothing,
}

export interface IBuiltinDescription {
  found: boolean;
  type: eBuiltInType; // [variable|method]
  category: string;
  description: string;
  signature: string;
  parameters?: string[];
  returns?: string[];
}
