'use strict';
// server/src/parser/spin2.pasm2.utils.ts
// PASM2 instruction documentation for hover help
// Data sourced from P2KB (Propeller 2 Knowledge Base)

import { eBuiltInType, IBuiltinDescription } from './spin.common';

// [category, syntax, description, C flag effect, Z flag effect, timing cycles]
type TPasm2InstructionDoc = readonly [string, string, string, string, string, string];

export class Pasm2DocUtils {
  // ---- PASM2 INSTRUCTION TABLE ----
  // All ~362 instructions in one flat table, keyed by lowercase name
  private readonly _instructionTable: { [key: string]: TPasm2InstructionDoc } = {
    // ── Math and Logic ──
    abs: ['Math and Logic', 'ABS D,{#}S {WC,WZ,WCZ}', 'Get absolute value of S into D', 'S[31]', 'Result == 0', '2'],
    add: ['Math and Logic', 'ADD D,{#}S {WC,WZ,WCZ}', 'Add S into D', 'Unsigned carry', 'Result == 0', '2'],
    adds: ['Math and Logic', 'ADDS D,{#}S {WC,WZ,WCZ}', 'Add S into D, signed', 'Signed overflow', 'Result == 0', '2'],
    addsx: ['Math and Logic', 'ADDSX D,{#}S {WC,WZ,WCZ}', 'Add (S + C) into D, signed and extended', 'Signed overflow', 'Z AND (Result == 0)', '2'],
    addx: ['Math and Logic', 'ADDX D,{#}S {WC,WZ,WCZ}', 'Add (S + C) into D, extended', 'Unsigned carry', 'Z AND (Result == 0)', '2'],
    and: ['Math and Logic', 'AND D,{#}S {WC,WZ,WCZ}', 'Bitwise AND S into D', 'Parity of result', 'Result == 0', '2'],
    andn: ['Math and Logic', 'ANDN D,{#}S {WC,WZ,WCZ}', 'Bitwise AND !S into D', 'Parity of result', 'Result == 0', '2'],
    bitc: ['Math and Logic', 'BITC D,{#}S', 'Set bit S[4:0] of D to C', '', '', '2'],
    bith: ['Math and Logic', 'BITH D,{#}S', 'Set bit S[4:0] of D to 1', '', '', '2'],
    bitl: ['Math and Logic', 'BITL D,{#}S', 'Set bit S[4:0] of D to 0', '', '', '2'],
    bitnc: ['Math and Logic', 'BITNC D,{#}S', 'Set bit S[4:0] of D to !C', '', '', '2'],
    bitnot: ['Math and Logic', 'BITNOT D,{#}S', 'Toggle bit S[4:0] of D', '', '', '2'],
    bitnz: ['Math and Logic', 'BITNZ D,{#}S', 'Set bit S[4:0] of D to !Z', '', '', '2'],
    bitrnd: ['Math and Logic', 'BITRND D,{#}S', 'Set bit S[4:0] of D to random', '', '', '2'],
    bitz: ['Math and Logic', 'BITZ D,{#}S', 'Set bit S[4:0] of D to Z', '', '', '2'],
    bmask: ['Math and Logic', 'BMASK D,{#}S {WC,WZ,WCZ}', 'Make bit mask from S[4:0] into D', 'S[4:0] == 0', 'Result == 0', '2'],
    cmp: ['Math and Logic', 'CMP D,{#}S {WC,WZ,WCZ}', 'Compare D to S, unsigned', 'Unsigned D < S', 'D == S', '2'],
    cmpm: ['Math and Logic', 'CMPM D,{#}S {WC,WZ,WCZ}', 'Compare D to mid-value of S for magnitude', 'ABS(D) > S', 'ABS(D) == 0', '2'],
    cmpr: ['Math and Logic', 'CMPR D,{#}S {WC,WZ,WCZ}', 'Compare D to S, signed, relative to mid', 'D >= S', 'D == S', '2'],
    cmps: ['Math and Logic', 'CMPS D,{#}S {WC,WZ,WCZ}', 'Compare D to S, signed', 'Signed D < S', 'D == S', '2'],
    cmpsub: ['Math and Logic', 'CMPSUB D,{#}S {WC,WZ,WCZ}', 'Compare D to S, subtract S if D >= S', 'Unsigned D >= S', 'Result == 0', '2'],
    cmpsx: ['Math and Logic', 'CMPSX D,{#}S {WC,WZ,WCZ}', 'Compare D to (S + C), signed and extended', 'Signed D < (S+C)', 'Z AND (D == S+C)', '2'],
    cmpx: ['Math and Logic', 'CMPX D,{#}S {WC,WZ,WCZ}', 'Compare D to (S + C), extended', 'Unsigned D < (S+C)', 'Z AND (D == S+C)', '2'],
    crcbit: ['Math and Logic', 'CRCBIT D,{#}S', 'Feed CRC with one bit of D through polynomial S', '', '', '2'],
    crcnib: ['Math and Logic', 'CRCNIB D,{#}S', 'Feed CRC with four bits of D through polynomial S', '', '', '2'],
    decmod: ['Math and Logic', 'DECMOD D,{#}S {WC,WZ,WCZ}', 'Decrement D, wrap to S on underflow', 'Wrapped', 'Result == 0', '2'],
    decod: ['Math and Logic', 'DECOD D,{#}S {WC,WZ,WCZ}', 'Decode S[4:0] into single-bit D', 'S[4:0] == 0', 'Result == 0', '2'],
    encod: ['Math and Logic', 'ENCOD D,{#}S {WC,WZ,WCZ}', 'Encode MSB of S into D (0..31)', 'S == 0', 'Result == 0', '2'],
    fge: ['Math and Logic', 'FGE D,{#}S {WC,WZ,WCZ}', 'Force D >= S, unsigned', 'D < S (was forced)', 'Result == 0', '2'],
    fges: ['Math and Logic', 'FGES D,{#}S {WC,WZ,WCZ}', 'Force D >= S, signed', 'D < S (was forced)', 'Result == 0', '2'],
    fle: ['Math and Logic', 'FLE D,{#}S {WC,WZ,WCZ}', 'Force D <= S, unsigned', 'D > S (was forced)', 'Result == 0', '2'],
    fles: ['Math and Logic', 'FLES D,{#}S {WC,WZ,WCZ}', 'Force D <= S, signed', 'D > S (was forced)', 'Result == 0', '2'],
    getbyte: ['Math and Logic', 'GETBYTE D,{#}S,#N', 'Get byte N of S into D[7:0]', '', '', '2'],
    getnib: ['Math and Logic', 'GETNIB D,{#}S,#N', 'Get nibble N of S into D[3:0]', '', '', '2'],
    getword: ['Math and Logic', 'GETWORD D,{#}S,#N', 'Get word N of S into D[15:0]', '', '', '2'],
    incmod: ['Math and Logic', 'INCMOD D,{#}S {WC,WZ,WCZ}', 'Increment D, wrap to 0 on overflow past S', 'Wrapped', 'Result == 0', '2'],
    loc: ['Math and Logic', 'LOC D,#\\A', 'Set D to absolute or relative address A', '', '', '2'],
    mergeb: ['Math and Logic', 'MERGEB D', 'Merge even/odd bits of D', '', '', '2'],
    mergew: ['Math and Logic', 'MERGEW D', 'Merge even/odd words of D', '', '', '2'],
    modc: ['Math and Logic', 'MODC c {WC}', 'Modify C flag according to modifier', 'Per modifier', '', '2'],
    modcz: ['Math and Logic', 'MODCZ c,z {WC,WZ,WCZ}', 'Modify C and Z flags according to modifiers', 'Per C modifier', 'Per Z modifier', '2'],
    modz: ['Math and Logic', 'MODZ z {WZ}', 'Modify Z flag according to modifier', '', 'Per modifier', '2'],
    mov: ['Math and Logic', 'MOV D,{#}S {WC,WZ,WCZ}', 'Set D to S', 'S[31]', 'Result == 0', '2'],
    movbyts: ['Math and Logic', 'MOVBYTS D,{#}S', 'Move bytes within D, selected by S nibbles', '', '', '2'],
    mul: ['Math and Logic', 'MUL D,{#}S {WZ}', 'Multiply D by S, unsigned, return lower 32 bits', '', 'Result == 0', '2'],
    muls: ['Math and Logic', 'MULS D,{#}S {WZ}', 'Multiply D by S, signed, return lower 32 bits', '', 'Result == 0', '2'],
    muxc: ['Math and Logic', 'MUXC D,{#}S {WC,WZ,WCZ}', 'Mux C into D bits selected by S', 'Parity of result', 'Result == 0', '2'],
    muxnc: ['Math and Logic', 'MUXNC D,{#}S {WC,WZ,WCZ}', 'Mux !C into D bits selected by S', 'Parity of result', 'Result == 0', '2'],
    muxnibs: ['Math and Logic', 'MUXNIBS D,{#}S', 'Move nibbles from S to D, selected by nibbles of Q', '', '', '2'],
    muxnits: ['Math and Logic', 'MUXNITS D,{#}S', 'Move bit pairs from S to D, selected by bit pairs of Q', '', '', '2'],
    muxnz: ['Math and Logic', 'MUXNZ D,{#}S {WC,WZ,WCZ}', 'Mux !Z into D bits selected by S', 'Parity of result', 'Result == 0', '2'],
    muxq: ['Math and Logic', 'MUXQ D,{#}S', 'Move bytes from S to D, selected by bytes of Q', '', '', '2'],
    muxz: ['Math and Logic', 'MUXZ D,{#}S {WC,WZ,WCZ}', 'Mux Z into D bits selected by S', 'Parity of result', 'Result == 0', '2'],
    neg: ['Math and Logic', 'NEG D,{#}S {WC,WZ,WCZ}', 'Negate S into D', 'S[31]', 'Result == 0', '2'],
    negc: ['Math and Logic', 'NEGC D,{#}S {WC,WZ,WCZ}', 'Negate S into D if C is set', 'S[31]', 'Result == 0', '2'],
    negnc: ['Math and Logic', 'NEGNC D,{#}S {WC,WZ,WCZ}', 'Negate S into D if C is clear', 'S[31]', 'Result == 0', '2'],
    negnz: ['Math and Logic', 'NEGNZ D,{#}S {WC,WZ,WCZ}', 'Negate S into D if Z is clear', 'S[31]', 'Result == 0', '2'],
    negz: ['Math and Logic', 'NEGZ D,{#}S {WC,WZ,WCZ}', 'Negate S into D if Z is set', 'S[31]', 'Result == 0', '2'],
    not: ['Math and Logic', 'NOT D,{#}S {WC,WZ,WCZ}', 'Bitwise NOT of S into D', 'Parity of result', 'Result == 0', '2'],
    ones: ['Math and Logic', 'ONES D,{#}S {WC,WZ,WCZ}', 'Count ones in S into D', 'LSB of count', 'Result == 0', '2'],
    or: ['Math and Logic', 'OR D,{#}S {WC,WZ,WCZ}', 'Bitwise OR S into D', 'Parity of result', 'Result == 0', '2'],
    rcl: ['Math and Logic', 'RCL D,{#}S {WC,WZ,WCZ}', 'Rotate C left into D by S[4:0] places', 'D[31] before shift', 'Result == 0', '2'],
    rcr: ['Math and Logic', 'RCR D,{#}S {WC,WZ,WCZ}', 'Rotate C right into D by S[4:0] places', 'D[0] before shift', 'Result == 0', '2'],
    rczl: ['Math and Logic', 'RCZL D,{#}S {WC,WZ,WCZ}', 'Rotate C and Z left into D by 2×S[3:0] places', 'MSB shifted out', 'Next bit shifted out', '2'],
    rczr: ['Math and Logic', 'RCZR D,{#}S {WC,WZ,WCZ}', 'Rotate C and Z right into D by 2×S[3:0] places', 'LSB shifted out', 'Next bit shifted out', '2'],
    rev: ['Math and Logic', 'REV D {WC,WZ,WCZ}', 'Reverse all bits in D', 'D[0] (becomes MSB)', 'Result == 0', '2'],
    rgbexp: ['Math and Logic', 'RGBEXP D {WC,WZ,WCZ}', 'Expand 8:8:8 RGB in D to 8:8:8:8 via LUT', '', '', '2'],
    rgbsqz: ['Math and Logic', 'RGBSQZ D {WC,WZ,WCZ}', 'Squeeze 8:8:8:8 color in D to 8:8:8 via LUT', '', '', '2'],
    rol: ['Math and Logic', 'ROL D,{#}S {WC,WZ,WCZ}', 'Rotate D left by S[4:0] places', 'D[31] before shift', 'Result == 0', '2'],
    rolbyte: ['Math and Logic', 'ROLBYTE D,{#}S,#N', 'Rotate D left by 8 and set byte 0 to S byte N', '', '', '2'],
    rolnib: ['Math and Logic', 'ROLNIB D,{#}S,#N', 'Rotate D left by 4 and set nibble 0 to S nibble N', '', '', '2'],
    rolword: ['Math and Logic', 'ROLWORD D,{#}S,#N', 'Rotate D left by 16 and set word 0 to S word N', '', '', '2'],
    ror: ['Math and Logic', 'ROR D,{#}S {WC,WZ,WCZ}', 'Rotate D right by S[4:0] places', 'D[0] before shift', 'Result == 0', '2'],
    sal: ['Math and Logic', 'SAL D,{#}S {WC,WZ,WCZ}', 'Shift D left arithmetically by S[4:0] places', 'D[31] before shift', 'Result == 0', '2'],
    sar: ['Math and Logic', 'SAR D,{#}S {WC,WZ,WCZ}', 'Shift D right arithmetically by S[4:0] places', 'D[0] before shift', 'Result == 0', '2'],
    sca: ['Math and Logic', 'SCA D,{#}S {WC,WZ,WCZ}', 'Scale unsigned D by unsigned S, return upper 32 bits', 'MSB of lower result', 'Result == 0', '2'],
    scas: ['Math and Logic', 'SCAS D,{#}S {WC,WZ,WCZ}', 'Scale signed D by signed S, return upper 32 bits', 'MSB of lower result', 'Result == 0', '2'],
    setbyte: ['Math and Logic', 'SETBYTE D,{#}S,#N', 'Set byte N of D to S[7:0]', '', '', '2'],
    setd: ['Math and Logic', 'SETD D,{#}S', 'Set D field of D to S[8:0]', '', '', '2'],
    setnib: ['Math and Logic', 'SETNIB D,{#}S,#N', 'Set nibble N of D to S[3:0]', '', '', '2'],
    setr: ['Math and Logic', 'SETR D,{#}S', 'Set R field of D to S[8:0]', '', '', '2'],
    sets: ['Math and Logic', 'SETS D,{#}S', 'Set S field of D to S[8:0]', '', '', '2'],
    setword: ['Math and Logic', 'SETWORD D,{#}S,#N', 'Set word N of D to S[15:0]', '', '', '2'],
    seussf: ['Math and Logic', 'SEUSSF D {WC,WZ,WCZ}', 'Squeeze D forward using Dr. Seuss method', '', 'Result == 0', '2'],
    seussr: ['Math and Logic', 'SEUSSR D {WC,WZ,WCZ}', 'Squeeze D reverse using Dr. Seuss method', '', 'Result == 0', '2'],
    shl: ['Math and Logic', 'SHL D,{#}S {WC,WZ,WCZ}', 'Shift D left by S[4:0] places', 'D[31] before shift', 'Result == 0', '2'],
    shr: ['Math and Logic', 'SHR D,{#}S {WC,WZ,WCZ}', 'Shift D right by S[4:0] places', 'D[0] before shift', 'Result == 0', '2'],
    signx: ['Math and Logic', 'SIGNX D,{#}S {WC,WZ,WCZ}', 'Sign-extend D from bit S[4:0]', 'D[S]', 'Result == 0', '2'],
    splitb: ['Math and Logic', 'SPLITB D', 'Split even/odd bits of D', '', '', '2'],
    splitw: ['Math and Logic', 'SPLITW D', 'Split even/odd words of D', '', '', '2'],
    sub: ['Math and Logic', 'SUB D,{#}S {WC,WZ,WCZ}', 'Subtract S from D', 'Unsigned borrow', 'Result == 0', '2'],
    subr: ['Math and Logic', 'SUBR D,{#}S {WC,WZ,WCZ}', 'Subtract D from S into D', 'Unsigned borrow', 'Result == 0', '2'],
    subs: ['Math and Logic', 'SUBS D,{#}S {WC,WZ,WCZ}', 'Subtract S from D, signed', 'Signed overflow', 'Result == 0', '2'],
    subsx: ['Math and Logic', 'SUBSX D,{#}S {WC,WZ,WCZ}', 'Subtract (S + C) from D, signed and extended', 'Signed overflow', 'Z AND (Result == 0)', '2'],
    subx: ['Math and Logic', 'SUBX D,{#}S {WC,WZ,WCZ}', 'Subtract (S + C) from D, extended', 'Unsigned borrow', 'Z AND (Result == 0)', '2'],
    sumc: ['Math and Logic', 'SUMC D,{#}S {WC,WZ,WCZ}', 'Sum S into D, conditionally negate by C', 'Signed overflow', 'Result == 0', '2'],
    sumnc: ['Math and Logic', 'SUMNC D,{#}S {WC,WZ,WCZ}', 'Sum S into D, conditionally negate by !C', 'Signed overflow', 'Result == 0', '2'],
    sumnz: ['Math and Logic', 'SUMNZ D,{#}S {WC,WZ,WCZ}', 'Sum S into D, conditionally negate by !Z', 'Signed overflow', 'Result == 0', '2'],
    sumz: ['Math and Logic', 'SUMZ D,{#}S {WC,WZ,WCZ}', 'Sum S into D, conditionally negate by Z', 'Signed overflow', 'Result == 0', '2'],
    test: ['Math and Logic', 'TEST D,{#}S {WC,WZ,WCZ}', 'Bitwise AND of D and S, don\'t write result', 'Parity of result', 'Result == 0', '2'],
    testb: ['Math and Logic', 'TESTB D,{#}S WC/WZ', 'Test bit S[4:0] of D into C or Z', 'D[S[4:0]]', 'D[S[4:0]]', '2'],
    testbn: ['Math and Logic', 'TESTBN D,{#}S WC/WZ', 'Test bit S[4:0] of D, inverted, into C or Z', '!D[S[4:0]]', '!D[S[4:0]]', '2'],
    testn: ['Math and Logic', 'TESTN D,{#}S {WC,WZ,WCZ}', 'Bitwise AND of D and !S, don\'t write result', 'Parity of result', 'Result == 0', '2'],
    wrc: ['Math and Logic', 'WRC D', 'Write C flag to D (0 or 1)', '', '', '2'],
    wrnc: ['Math and Logic', 'WRNC D', 'Write !C flag to D (0 or 1)', '', '', '2'],
    wrnz: ['Math and Logic', 'WRNZ D', 'Write !Z flag to D (0 or 1)', '', '', '2'],
    wrz: ['Math and Logic', 'WRZ D', 'Write Z flag to D (0 or 1)', '', '', '2'],
    xor: ['Math and Logic', 'XOR D,{#}S {WC,WZ,WCZ}', 'Bitwise XOR S into D', 'Parity of result', 'Result == 0', '2'],
    xoro32: ['Math and Logic', 'XORO32 D {WC,WZ,WCZ}', 'XOR bits of D with 32-bit XOROSHIRO128** PRNG', '', 'Result == 0', '2'],
    zerox: ['Math and Logic', 'ZEROX D,{#}S {WC,WZ,WCZ}', 'Zero-extend D above bit S[4:0]', 'D[S]', 'Result == 0', '2'],

    // ── Branch and Control ──
    call: ['Branch', 'CALL D {WC,WZ,WCZ}', 'Push {C, Z, return} and jump to D', 'Set to 0', 'Set to 0', '4'],
    calla: ['Branch', 'CALLA D {WC,WZ,WCZ}', 'Push {C, Z, return} to PTRA and jump to D', 'Set to 0', 'Set to 0', '4'],
    callb: ['Branch', 'CALLB D {WC,WZ,WCZ}', 'Push {C, Z, return} to PTRB and jump to D', 'Set to 0', 'Set to 0', '4'],
    calld: ['Branch', 'CALLD D,{#}S', 'Save {C, Z, return} into D and jump to S', '', '', '4'],
    callpa: ['Branch', 'CALLPA {#}D,{#}S', 'Move D into PA then CALL S', '', '', '4'],
    callpb: ['Branch', 'CALLPB {#}D,{#}S', 'Move D into PB then CALL S', '', '', '4'],
    djf: ['Branch', 'DJF D,{#}S', 'Decrement D and jump to S if result is $FFFF_FFFF', '', '', '4/2'],
    djnf: ['Branch', 'DJNF D,{#}S', 'Decrement D and jump to S if result is not $FFFF_FFFF', '', '', '4/2'],
    djnz: ['Branch', 'DJNZ D,{#}S', 'Decrement D and jump to S if result is not zero', '', '', '4/2'],
    djz: ['Branch', 'DJZ D,{#}S', 'Decrement D and jump to S if result is zero', '', '', '4/2'],
    execf: ['Branch', 'EXECF D', 'Execute hub long at D from FIFO', '', '', '4'],
    ijnz: ['Branch', 'IJNZ D,{#}S', 'Increment D and jump to S if result is not zero', '', '', '4/2'],
    ijz: ['Branch', 'IJZ D,{#}S', 'Increment D and jump to S if result is zero', '', '', '4/2'],
    jmp: ['Branch', 'JMP {#}D', 'Jump to D', '', '', '4'],
    jmprel: ['Branch', 'JMPREL {#}D', 'Jump to relative address D', '', '', '4'],
    rep: ['Branch', 'REP {#}D,{#}S', 'Repeat block of D instructions, S times', '', '', '2'],
    resi0: ['Branch', 'RESI0', 'Resume from INT0 ISR, restoring flags', '', '', '4'],
    resi1: ['Branch', 'RESI1', 'Resume from INT1 ISR, restoring flags', '', '', '4'],
    resi2: ['Branch', 'RESI2', 'Resume from INT2 ISR, restoring flags', '', '', '4'],
    resi3: ['Branch', 'RESI3', 'Resume from INT3 ISR, restoring flags', '', '', '4'],
    ret: ['Branch', 'RET {WC,WZ,WCZ}', 'Pop {C, Z, return} and return', 'Restored from stack', 'Restored from stack', '4'],
    reta: ['Branch', 'RETA {WC,WZ,WCZ}', 'Pop {C, Z, return} from PTRA and return', 'Restored from stack', 'Restored from stack', '4'],
    retb: ['Branch', 'RETB {WC,WZ,WCZ}', 'Pop {C, Z, return} from PTRB and return', 'Restored from stack', 'Restored from stack', '4'],
    reti0: ['Branch', 'RETI0', 'Return from INT0 ISR, restoring flags', 'Restored', 'Restored', '4'],
    reti1: ['Branch', 'RETI1', 'Return from INT1 ISR, restoring flags', 'Restored', 'Restored', '4'],
    reti2: ['Branch', 'RETI2', 'Return from INT2 ISR, restoring flags', 'Restored', 'Restored', '4'],
    reti3: ['Branch', 'RETI3', 'Return from INT3 ISR, restoring flags', 'Restored', 'Restored', '4'],
    skip: ['Branch', 'SKIP {#}D', 'Skip next 1..32 instructions per D bits', '', '', '2'],
    skipf: ['Branch', 'SKIPF {#}D', 'Skip and cancel next 1..32 instructions per D bits', '', '', '2'],
    tjf: ['Branch', 'TJF D,{#}S', 'Test D and jump to S if all bits zero ($FFFF_FFFF check variant)', '', '', '4/2'],
    tjnf: ['Branch', 'TJNF D,{#}S', 'Test D and jump to S if not all bits set', '', '', '4/2'],
    tjns: ['Branch', 'TJNS D,{#}S', 'Test D and jump to S if not signed (D[31]=0)', '', '', '4/2'],
    tjnz: ['Branch', 'TJNZ D,{#}S', 'Test D and jump to S if not zero', '', '', '4/2'],
    tjs: ['Branch', 'TJS D,{#}S', 'Test D and jump to S if signed (D[31]=1)', '', '', '4/2'],
    tjv: ['Branch', 'TJV D,{#}S', 'Test D and jump to S if signed overflow', '', '', '4/2'],
    tjz: ['Branch', 'TJZ D,{#}S', 'Test D and jump to S if zero', '', '', '4/2'],

    // ── Pin Control ──
    dirc: ['Pin', 'DIRC {#}D', 'Set pin D direction to C', '', '', '2'],
    dirh: ['Pin', 'DIRH {#}D', 'Set pin D direction to output (high)', '', '', '2'],
    dirl: ['Pin', 'DIRL {#}D', 'Set pin D direction to input (low)', '', '', '2'],
    dirnc: ['Pin', 'DIRNC {#}D', 'Set pin D direction to !C', '', '', '2'],
    dirnot: ['Pin', 'DIRNOT {#}D', 'Toggle pin D direction', '', '', '2'],
    dirnz: ['Pin', 'DIRNZ {#}D', 'Set pin D direction to !Z', '', '', '2'],
    dirrnd: ['Pin', 'DIRRND {#}D', 'Set pin D direction to random', '', '', '2'],
    dirz: ['Pin', 'DIRZ {#}D', 'Set pin D direction to Z', '', '', '2'],
    drvc: ['Pin', 'DRVC {#}D', 'Drive pin D with C', '', '', '2'],
    drvh: ['Pin', 'DRVH {#}D', 'Drive pin D high', '', '', '2'],
    drvl: ['Pin', 'DRVL {#}D', 'Drive pin D low', '', '', '2'],
    drvnc: ['Pin', 'DRVNC {#}D', 'Drive pin D with !C', '', '', '2'],
    drvnot: ['Pin', 'DRVNOT {#}D', 'Toggle pin D output', '', '', '2'],
    drvnz: ['Pin', 'DRVNZ {#}D', 'Drive pin D with !Z', '', '', '2'],
    drvrnd: ['Pin', 'DRVRND {#}D', 'Drive pin D with random', '', '', '2'],
    drvz: ['Pin', 'DRVZ {#}D', 'Drive pin D with Z', '', '', '2'],
    fltc: ['Pin', 'FLTC {#}D', 'Float pin D if C is set', '', '', '2'],
    flth: ['Pin', 'FLTH {#}D', 'Float pin D high (pull-up)', '', '', '2'],
    fltl: ['Pin', 'FLTL {#}D', 'Float pin D low (pull-down)', '', '', '2'],
    fltnc: ['Pin', 'FLTNC {#}D', 'Float pin D if !C', '', '', '2'],
    fltnot: ['Pin', 'FLTNOT {#}D', 'Toggle pin D float state', '', '', '2'],
    fltnz: ['Pin', 'FLTNZ {#}D', 'Float pin D if !Z', '', '', '2'],
    fltrnd: ['Pin', 'FLTRND {#}D', 'Float pin D randomly', '', '', '2'],
    fltz: ['Pin', 'FLTZ {#}D', 'Float pin D if Z', '', '', '2'],
    outc: ['Pin', 'OUTC {#}D', 'Set pin D output to C', '', '', '2'],
    outh: ['Pin', 'OUTH {#}D', 'Set pin D output high', '', '', '2'],
    outl: ['Pin', 'OUTL {#}D', 'Set pin D output low', '', '', '2'],
    outnc: ['Pin', 'OUTNC {#}D', 'Set pin D output to !C', '', '', '2'],
    outnot: ['Pin', 'OUTNOT {#}D', 'Toggle pin D output state', '', '', '2'],
    outnz: ['Pin', 'OUTNZ {#}D', 'Set pin D output to !Z', '', '', '2'],
    outrnd: ['Pin', 'OUTRND {#}D', 'Set pin D output to random', '', '', '2'],
    outz: ['Pin', 'OUTZ {#}D', 'Set pin D output to Z', '', '', '2'],
    testp: ['Pin', 'TESTP {#}D WC/WZ', 'Test pin D state into C or Z', 'IN[D[5:0]]', 'IN[D[5:0]]', '2'],
    testpn: ['Pin', 'TESTPN {#}D WC/WZ', 'Test pin D state, inverted, into C or Z', '!IN[D[5:0]]', '!IN[D[5:0]]', '2'],

    // ── Event System ──
    addct1: ['Event', 'ADDCT1 D,{#}S', 'Add S to D and set CT1 event target', '', '', '2'],
    addct2: ['Event', 'ADDCT2 D,{#}S', 'Add S to D and set CT2 event target', '', '', '2'],
    addct3: ['Event', 'ADDCT3 D,{#}S', 'Add S to D and set CT3 event target', '', '', '2'],
    cogatn: ['Event', 'COGATN {#}D', 'Strobe attention signal to cog(s) per D mask', '', '', '2'],
    jatn: ['Event', 'JATN {#}S', 'Jump to S if ATN event is active', '', '', '4/2'],
    jct1: ['Event', 'JCT1 {#}S', 'Jump to S if CT1 event is active', '', '', '4/2'],
    jct2: ['Event', 'JCT2 {#}S', 'Jump to S if CT2 event is active', '', '', '4/2'],
    jct3: ['Event', 'JCT3 {#}S', 'Jump to S if CT3 event is active', '', '', '4/2'],
    jfbw: ['Event', 'JFBW {#}S', 'Jump to S if hub FIFO byte written', '', '', '4/2'],
    jint: ['Event', 'JINT {#}S', 'Jump to S if INT event is active', '', '', '4/2'],
    jnatn: ['Event', 'JNATN {#}S', 'Jump to S if ATN event is not active', '', '', '4/2'],
    jnct1: ['Event', 'JNCT1 {#}S', 'Jump to S if CT1 event is not active', '', '', '4/2'],
    jnct2: ['Event', 'JNCT2 {#}S', 'Jump to S if CT2 event is not active', '', '', '4/2'],
    jnct3: ['Event', 'JNCT3 {#}S', 'Jump to S if CT3 event is not active', '', '', '4/2'],
    jnfbw: ['Event', 'JNFBW {#}S', 'Jump to S if hub FIFO byte not written', '', '', '4/2'],
    jnint: ['Event', 'JNINT {#}S', 'Jump to S if INT event is not active', '', '', '4/2'],
    jnpat: ['Event', 'JNPAT {#}S', 'Jump to S if pattern match is not active', '', '', '4/2'],
    jnqmt: ['Event', 'JNQMT {#}S', 'Jump to S if CORDIC result not ready', '', '', '4/2'],
    jnse1: ['Event', 'JNSE1 {#}S', 'Jump to S if SE1 event is not active', '', '', '4/2'],
    jnse2: ['Event', 'JNSE2 {#}S', 'Jump to S if SE2 event is not active', '', '', '4/2'],
    jnse3: ['Event', 'JNSE3 {#}S', 'Jump to S if SE3 event is not active', '', '', '4/2'],
    jnse4: ['Event', 'JNSE4 {#}S', 'Jump to S if SE4 event is not active', '', '', '4/2'],
    jnxfi: ['Event', 'JNXFI {#}S', 'Jump to S if streamer not finished', '', '', '4/2'],
    jnxmt: ['Event', 'JNXMT {#}S', 'Jump to S if streamer not empty', '', '', '4/2'],
    jnxrl: ['Event', 'JNXRL {#}S', 'Jump to S if streamer not read last LUT', '', '', '4/2'],
    jnxro: ['Event', 'JNXRO {#}S', 'Jump to S if streamer NCO not rolled over', '', '', '4/2'],
    jpat: ['Event', 'JPAT {#}S', 'Jump to S if pattern match is active', '', '', '4/2'],
    jqmt: ['Event', 'JQMT {#}S', 'Jump to S if CORDIC result is ready', '', '', '4/2'],
    jse1: ['Event', 'JSE1 {#}S', 'Jump to S if SE1 event is active', '', '', '4/2'],
    jse2: ['Event', 'JSE2 {#}S', 'Jump to S if SE2 event is active', '', '', '4/2'],
    jse3: ['Event', 'JSE3 {#}S', 'Jump to S if SE3 event is active', '', '', '4/2'],
    jse4: ['Event', 'JSE4 {#}S', 'Jump to S if SE4 event is active', '', '', '4/2'],
    jxfi: ['Event', 'JXFI {#}S', 'Jump to S if streamer finished', '', '', '4/2'],
    jxmt: ['Event', 'JXMT {#}S', 'Jump to S if streamer empty', '', '', '4/2'],
    jxrl: ['Event', 'JXRL {#}S', 'Jump to S if streamer read last LUT', '', '', '4/2'],
    jxro: ['Event', 'JXRO {#}S', 'Jump to S if streamer NCO rolled over', '', '', '4/2'],
    pollatn: ['Event', 'POLLATN WC/WZ', 'Poll ATN event into C or Z, clear event', 'ATN active', 'ATN active', '2'],
    pollct1: ['Event', 'POLLCT1 WC/WZ', 'Poll CT1 event into C or Z, clear event', 'CT1 active', 'CT1 active', '2'],
    pollct2: ['Event', 'POLLCT2 WC/WZ', 'Poll CT2 event into C or Z, clear event', 'CT2 active', 'CT2 active', '2'],
    pollct3: ['Event', 'POLLCT3 WC/WZ', 'Poll CT3 event into C or Z, clear event', 'CT3 active', 'CT3 active', '2'],
    pollfbw: ['Event', 'POLLFBW WC/WZ', 'Poll FIFO-byte-written event into C or Z', 'FBW active', 'FBW active', '2'],
    pollint: ['Event', 'POLLINT WC/WZ', 'Poll INT event into C or Z, clear event', 'INT active', 'INT active', '2'],
    pollpat: ['Event', 'POLLPAT WC/WZ', 'Poll pattern match event into C or Z', 'PAT active', 'PAT active', '2'],
    pollqmt: ['Event', 'POLLQMT WC/WZ', 'Poll CORDIC-result-ready event into C or Z', 'QMT active', 'QMT active', '2'],
    pollse1: ['Event', 'POLLSE1 WC/WZ', 'Poll SE1 event into C or Z, clear event', 'SE1 active', 'SE1 active', '2'],
    pollse2: ['Event', 'POLLSE2 WC/WZ', 'Poll SE2 event into C or Z, clear event', 'SE2 active', 'SE2 active', '2'],
    pollse3: ['Event', 'POLLSE3 WC/WZ', 'Poll SE3 event into C or Z, clear event', 'SE3 active', 'SE3 active', '2'],
    pollse4: ['Event', 'POLLSE4 WC/WZ', 'Poll SE4 event into C or Z, clear event', 'SE4 active', 'SE4 active', '2'],
    pollxfi: ['Event', 'POLLXFI WC/WZ', 'Poll streamer-finished event into C or Z', 'XFI active', 'XFI active', '2'],
    pollxmt: ['Event', 'POLLXMT WC/WZ', 'Poll streamer-empty event into C or Z', 'XMT active', 'XMT active', '2'],
    pollxrl: ['Event', 'POLLXRL WC/WZ', 'Poll streamer-read-last-LUT event into C or Z', 'XRL active', 'XRL active', '2'],
    pollxro: ['Event', 'POLLXRO WC/WZ', 'Poll streamer-NCO-rollover event into C or Z', 'XRO active', 'XRO active', '2'],
    setpat: ['Event', 'SETPAT {#}D,{#}S', 'Set pin pattern match: mask=D, match=S', '', '', '2'],
    setse1: ['Event', 'SETSE1 {#}D', 'Set SE1 event configuration to D', '', '', '2'],
    setse2: ['Event', 'SETSE2 {#}D', 'Set SE2 event configuration to D', '', '', '2'],
    setse3: ['Event', 'SETSE3 {#}D', 'Set SE3 event configuration to D', '', '', '2'],
    setse4: ['Event', 'SETSE4 {#}D', 'Set SE4 event configuration to D', '', '', '2'],
    waitatn: ['Event', 'WAITATN', 'Wait for ATN event, clear event', '', '', '2+'],
    waitct1: ['Event', 'WAITCT1', 'Wait for CT1 event, clear event', '', '', '2+'],
    waitct2: ['Event', 'WAITCT2', 'Wait for CT2 event, clear event', '', '', '2+'],
    waitct3: ['Event', 'WAITCT3', 'Wait for CT3 event, clear event', '', '', '2+'],
    waitfbw: ['Event', 'WAITFBW', 'Wait for hub FIFO byte written', '', '', '2+'],
    waitint: ['Event', 'WAITINT', 'Wait for INT event, clear event', '', '', '2+'],
    waitpat: ['Event', 'WAITPAT', 'Wait for pattern match event', '', '', '2+'],
    waitse1: ['Event', 'WAITSE1', 'Wait for SE1 event, clear event', '', '', '2+'],
    waitse2: ['Event', 'WAITSE2', 'Wait for SE2 event, clear event', '', '', '2+'],
    waitse3: ['Event', 'WAITSE3', 'Wait for SE3 event, clear event', '', '', '2+'],
    waitse4: ['Event', 'WAITSE4', 'Wait for SE4 event, clear event', '', '', '2+'],
    waitxfi: ['Event', 'WAITXFI', 'Wait for streamer finished event', '', '', '2+'],
    waitxmt: ['Event', 'WAITXMT', 'Wait for streamer empty event', '', '', '2+'],
    waitxrl: ['Event', 'WAITXRL', 'Wait for streamer read last LUT event', '', '', '2+'],
    waitxro: ['Event', 'WAITXRO', 'Wait for streamer NCO rollover event', '', '', '2+'],

    // ── Hub Control ──
    cogid: ['Hub Control', 'COGID D {WC}', 'Get current cog ID into D', 'Set if last cog', '', '2'],
    coginit: ['Hub Control', 'COGINIT {#}D,{#}S {WC}', 'Start or restart cog D with code at S', 'Set if no free cog', '', '2'],
    cogstop: ['Hub Control', 'COGSTOP {#}D', 'Stop cog D', '', '', '2'],
    hubset: ['Hub Control', 'HUBSET {#}D', 'Set hub configuration to D', '', '', '2'],
    locknew: ['Hub Control', 'LOCKNEW D {WC}', 'Get new lock into D', 'Set if no free lock', '', '2'],
    lockrel: ['Hub Control', 'LOCKREL {#}D {WC}', 'Release lock D', 'Lock state before release', '', '2'],
    lockret: ['Hub Control', 'LOCKRET {#}D {WC}', 'Return lock D for reallocation', 'Lock state before return', '', '2'],
    locktry: ['Hub Control', 'LOCKTRY {#}D {WC}', 'Try to lock D, set C if successful', 'Set if locked', '', '2'],

    // ── Hub FIFO ──
    fblock: ['Hub FIFO', 'FBLOCK {#}D,{#}S', 'Set hub FIFO block: address=D, count=S', '', '', '2'],
    getptr: ['Hub FIFO', 'GETPTR D', 'Get hub FIFO read pointer into D', '', '', '2'],
    rdfast: ['Hub FIFO', 'RDFAST {#}D,{#}S', 'Start FIFO read: count=D, address=S', '', '', '2'],
    rfbyte: ['Hub FIFO', 'RFBYTE D {WC,WZ,WCZ}', 'Read FIFO byte into D[7:0]', 'MSB of byte', 'Result == 0', '2+'],
    rflong: ['Hub FIFO', 'RFLONG D {WC,WZ,WCZ}', 'Read FIFO long into D', 'MSB of long', 'Result == 0', '2+'],
    rfvar: ['Hub FIFO', 'RFVAR D {WC,WZ,WCZ}', 'Read FIFO variable-length field (1-4 bytes) into D', 'More bytes follow', 'Result == 0', '2+'],
    rfvars: ['Hub FIFO', 'RFVARS D {WC,WZ,WCZ}', 'Read FIFO signed variable-length field into D', 'More bytes follow', 'Result == 0', '2+'],
    rfword: ['Hub FIFO', 'RFWORD D {WC,WZ,WCZ}', 'Read FIFO word into D[15:0]', 'MSB of word', 'Result == 0', '2+'],
    wfbyte: ['Hub FIFO', 'WFBYTE {#}D', 'Write byte D[7:0] to FIFO', '', '', '2+'],
    wflong: ['Hub FIFO', 'WFLONG {#}D', 'Write long D to FIFO', '', '', '2+'],
    wfword: ['Hub FIFO', 'WFWORD {#}D', 'Write word D[15:0] to FIFO', '', '', '2+'],
    wrfast: ['Hub FIFO', 'WRFAST {#}D,{#}S', 'Start FIFO write: count=D, address=S', '', '', '2'],

    // ── Hub RAM ──
    popa: ['Hub RAM', 'POPA D {WC,WZ,WCZ}', 'Pop long from PTRA stack into D', 'MSB of long', 'Result == 0', '2'],
    popb: ['Hub RAM', 'POPB D {WC,WZ,WCZ}', 'Pop long from PTRB stack into D', 'MSB of long', 'Result == 0', '2'],
    pusha: ['Hub RAM', 'PUSHA {#}D', 'Push D onto PTRA stack', '', '', '2'],
    pushb: ['Hub RAM', 'PUSHB {#}D', 'Push D onto PTRB stack', '', '', '2'],
    rdbyte: ['Hub RAM', 'RDBYTE D,{#}S/P {WC}', 'Read byte from hub address S into D', 'MSB of byte', '', '9..22'],
    rdlong: ['Hub RAM', 'RDLONG D,{#}S/P {WC}', 'Read long from hub address S into D', 'MSB of long', '', '9..22'],
    rdword: ['Hub RAM', 'RDWORD D,{#}S/P {WC}', 'Read word from hub address S into D', 'MSB of word', '', '9..22'],
    wmlong: ['Hub RAM', 'WMLONG {#}D,{#}S/P', 'Write D to hub long address S, masked by Q', '', '', '2'],
    wrbyte: ['Hub RAM', 'WRBYTE {#}D,{#}S/P', 'Write byte D[7:0] to hub address S', '', '', '2..16'],
    wrlong: ['Hub RAM', 'WRLONG {#}D,{#}S/P', 'Write long D to hub address S', '', '', '2..16'],
    wrword: ['Hub RAM', 'WRWORD {#}D,{#}S/P', 'Write word D[15:0] to hub address S', '', '', '2..16'],

    // ── CORDIC Solver ──
    getqx: ['CORDIC', 'GETQX D {WC,WZ,WCZ}', 'Get CORDIC result X into D', 'Set if CORDIC not ready', 'Result == 0', '2'],
    getqy: ['CORDIC', 'GETQY D {WC,WZ,WCZ}', 'Get CORDIC result Y into D', 'Set if CORDIC not ready', 'Result == 0', '2'],
    qdiv: ['CORDIC', 'QDIV {#}D,{#}S', 'Queue unsigned division: D / S', '', '', '2'],
    qexp: ['CORDIC', 'QEXP {#}D', 'Queue base-2 exponential of D', '', '', '2'],
    qfrac: ['CORDIC', 'QFRAC {#}D,{#}S', 'Queue unsigned fraction: D / S with 32-bit result', '', '', '2'],
    qlog: ['CORDIC', 'QLOG {#}D', 'Queue base-2 logarithm of D', '', '', '2'],
    qmul: ['CORDIC', 'QMUL {#}D,{#}S', 'Queue unsigned multiply: D × S producing 64-bit result', '', '', '2'],
    qrotate: ['CORDIC', 'QROTATE {#}D,{#}S', 'Queue rotate vector D by angle S', '', '', '2'],
    qsqrt: ['CORDIC', 'QSQRT {#}D,{#}S', 'Queue square root of {D, S} 64-bit value', '', '', '2'],
    qvector: ['CORDIC', 'QVECTOR {#}D,{#}S', 'Queue vector length and angle from D,S', '', '', '2'],

    // ── Smart Pin ──
    akpin: ['Smart Pin', 'AKPIN {#}D', 'Acknowledge smart pin D, clear IN flag', '', '', '2'],
    getscp: ['Smart Pin', 'GETSCP D', 'Get scope value of smart pin into D', '', '', '2'],
    rdpin: ['Smart Pin', 'RDPIN D,{#}S {WC}', 'Read smart pin S result into D, acknowledge pin', 'IN flag state', '', '2'],
    rqpin: ['Smart Pin', 'RQPIN D,{#}S {WC}', 'Read smart pin S result into D, no acknowledge', 'IN flag state', '', '2'],
    setdacs: ['Smart Pin', 'SETDACS {#}D', 'Set DAC mode and value for all smart pins', '', '', '2'],
    setscp: ['Smart Pin', 'SETSCP {#}D', 'Set scope mode for smart pins', '', '', '2'],
    wrpin: ['Smart Pin', 'WRPIN {#}D,{#}S', 'Set mode of smart pin S to D', '', '', '2'],
    wxpin: ['Smart Pin', 'WXPIN {#}D,{#}S', 'Set X parameter of smart pin S to D', '', '', '2'],
    wypin: ['Smart Pin', 'WYPIN {#}D,{#}S', 'Set Y parameter of smart pin S to D', '', '', '2'],

    // ── Register Indirection ──
    altb: ['Register Indirection', 'ALTB D,{#}S', 'Alter both D and S fields of next instruction', '', '', '2'],
    altd: ['Register Indirection', 'ALTD D,{#}S', 'Alter D field of next instruction to (S + D) & $1FF', '', '', '2'],
    altgb: ['Register Indirection', 'ALTGB D,{#}S', 'Alter next GETBYTE/ROLBYTE instruction', '', '', '2'],
    altgn: ['Register Indirection', 'ALTGN D,{#}S', 'Alter next GETNIB/ROLNIB instruction', '', '', '2'],
    altgw: ['Register Indirection', 'ALTGW D,{#}S', 'Alter next GETWORD/ROLWORD instruction', '', '', '2'],
    alti: ['Register Indirection', 'ALTI D,{#}S', 'Alter D, S, and R fields of next instruction', '', '', '2'],
    altr: ['Register Indirection', 'ALTR D,{#}S', 'Alter Result register address of next instruction', '', '', '2'],
    alts: ['Register Indirection', 'ALTS D,{#}S', 'Alter S field of next instruction to (S + D) & $1FF', '', '', '2'],
    altsb: ['Register Indirection', 'ALTSB D,{#}S', 'Alter next SETBYTE instruction', '', '', '2'],
    altsn: ['Register Indirection', 'ALTSN D,{#}S', 'Alter next SETNIB instruction', '', '', '2'],
    altsw: ['Register Indirection', 'ALTSW D,{#}S', 'Alter next SETWORD instruction', '', '', '2'],

    // ── Interrupt ──
    allowi: ['Interrupt', 'ALLOWI', 'Allow interrupts', '', '', '2'],
    brk: ['Interrupt', 'BRK {#}D', 'Break (debug) with code D', '', '', '2'],
    cogbrk: ['Interrupt', 'COGBRK {#}D {WC}', 'Issue debug break to cog D', 'Set if cog D in debug', '', '2'],
    getbrk: ['Interrupt', 'GETBRK D WC/WZ', 'Get debug break status into D/C/Z', 'Break status', 'Break status', '2'],
    nixint1: ['Interrupt', 'NIXINT1', 'Clear INT1 interrupt request', '', '', '2'],
    nixint2: ['Interrupt', 'NIXINT2', 'Clear INT2 interrupt request', '', '', '2'],
    nixint3: ['Interrupt', 'NIXINT3', 'Clear INT3 interrupt request', '', '', '2'],
    setint1: ['Interrupt', 'SETINT1 {#}D', 'Set INT1 interrupt source to D', '', '', '2'],
    setint2: ['Interrupt', 'SETINT2 {#}D', 'Set INT2 interrupt source to D', '', '', '2'],
    setint3: ['Interrupt', 'SETINT3 {#}D', 'Set INT3 interrupt source to D', '', '', '2'],
    stalli: ['Interrupt', 'STALLI', 'Stall (disable) interrupts', '', '', '2'],
    trgint1: ['Interrupt', 'TRGINT1', 'Trigger INT1 interrupt', '', '', '2'],
    trgint2: ['Interrupt', 'TRGINT2', 'Trigger INT2 interrupt', '', '', '2'],
    trgint3: ['Interrupt', 'TRGINT3', 'Trigger INT3 interrupt', '', '', '2'],

    // ── Lookup Table ──
    rdlut: ['Lookup Table', 'RDLUT D,{#}S/P {WC}', 'Read LUT at address S into D', 'MSB of long', '', '2'],
    setluts: ['Lookup Table', 'SETLUTS {#}D', 'Set LUT sharing mode to D', '', '', '2'],
    wrlut: ['Lookup Table', 'WRLUT {#}D,{#}S/P', 'Write D to LUT at address S', '', '', '2'],

    // ── Streamer ──
    getxacc: ['Streamer', 'GETXACC D', 'Get streamer accumulator into D', '', '', '2'],
    setxfrq: ['Streamer', 'SETXFRQ {#}D', 'Set streamer NCO frequency to D', '', '', '2'],
    xcont: ['Streamer', 'XCONT {#}D,{#}S', 'Continue streamer with new parameters', '', '', '2'],
    xinit: ['Streamer', 'XINIT {#}D,{#}S', 'Issue streamer command, zero phase', '', '', '2'],
    xstop: ['Streamer', 'XSTOP', 'Stop streamer immediately', '', '', '2'],
    xzero: ['Streamer', 'XZERO {#}D,{#}S', 'Issue streamer command with zero data', '', '', '2'],

    // ── Pixel Mixer ──
    addpix: ['Pixel', 'ADDPIX D', 'Add pixel D to accumulator', '', '', '2'],
    blnpix: ['Pixel', 'BLNPIX D', 'Blend pixel D with accumulator', '', '', '2'],
    mixpix: ['Pixel', 'MIXPIX D', 'Mix pixel D with accumulator using blend mode', '', '', '2'],
    mulpix: ['Pixel', 'MULPIX D', 'Multiply pixel D with accumulator', '', '', '2'],
    setpiv: ['Pixel', 'SETPIV {#}D', 'Set pixel blending pivot value to D', '', '', '2'],
    setpix: ['Pixel', 'SETPIX {#}D', 'Set pixel accumulator to D', '', '', '2'],

    // ── Colorspace Converter ──
    setcfrq: ['Colorspace', 'SETCFRQ {#}D', 'Set colorspace converter frequency to D', '', '', '2'],
    setci: ['Colorspace', 'SETCI {#}D', 'Set colorspace converter I offset to D', '', '', '2'],
    setcmod: ['Colorspace', 'SETCMOD {#}D', 'Set colorspace converter mode to D', '', '', '2'],
    setcq: ['Colorspace', 'SETCQ {#}D', 'Set colorspace converter Q offset to D', '', '', '2'],
    setcy: ['Colorspace', 'SETCY {#}D', 'Set colorspace converter Y offset to D', '', '', '2'],

    // ── Miscellaneous ──
    asmclk: ['Miscellaneous', 'ASMCLK', 'Set clock mode from _CLKFREQ and _XTLFREQ/_XINFREQ', '', '', '2'],
    augd: ['Miscellaneous', 'AUGD {#}D', 'Augment next instruction D field with 23-bit immediate', '', '', '2'],
    augs: ['Miscellaneous', 'AUGS {#}S', 'Augment next instruction S field with 23-bit immediate', '', '', '2'],
    getct: ['Miscellaneous', 'GETCT D {WC}', 'Get system counter into D', 'LSB of counter', '', '2'],
    getrnd: ['Miscellaneous', 'GETRND D {WC,WZ,WCZ}', 'Get random number into D', 'Random bit', 'Result == 0', '2'],
    nop: ['Miscellaneous', 'NOP', 'No operation, elapse two cycles', '', '', '2'],
    pop: ['Miscellaneous', 'POP D {WC,WZ,WCZ}', 'Pop D from internal stack', 'D[31]', 'Result == 0', '2'],
    push: ['Miscellaneous', 'PUSH {#}D', 'Push D onto internal stack', '', '', '2'],
    setq: ['Miscellaneous', 'SETQ {#}D', 'Set Q register for next instruction', '', '', '2'],
    setq2: ['Miscellaneous', 'SETQ2 {#}D', 'Set Q register for block transfer', '', '', '2'],
    waitx: ['Miscellaneous', 'WAITX {#}D {WC,WZ,WCZ}', 'Wait 2+D clock cycles, or 2+(D AND RND) with WC/WZ/WCZ', 'Set to 0', 'Set to 0', '2+D']
  };

  // ---- CONDITIONAL EXECUTION TABLE ----
  // All 16 P2 condition codes (4-bit EEEE encoding)
  // Key: lowercase primary name, Value: [description, condition, aliases[]]
  private readonly _conditionalTable: { [key: string]: readonly [string, string, string[]] } = {
    _ret_: ['Always execute + return after', 'Always (+ return)', []],
    if_nc_and_nz: ['Execute if C=0 AND Z=0', 'C=0 AND Z=0', ['if_nz_and_nc', 'if_a', 'if_gt']],
    if_nc_and_z: ['Execute if C=0 AND Z=1', 'C=0 AND Z=1', ['if_z_and_nc']],
    if_nc: ['Execute if C=0', 'C=0', ['if_ae', 'if_ge']],
    if_c_and_nz: ['Execute if C=1 AND Z=0', 'C=1 AND Z=0', ['if_nz_and_c']],
    if_nz: ['Execute if Z=0', 'Z=0', ['if_ne']],
    if_c_ne_z: ['Execute if C and Z differ', 'C != Z', ['if_diff']],
    if_nc_or_nz: ['Execute if C=0 OR Z=0', 'C=0 OR Z=0', ['if_nz_or_nc']],
    if_c_and_z: ['Execute if C=1 AND Z=1', 'C=1 AND Z=1', ['if_z_and_c']],
    if_c_eq_z: ['Execute if C and Z are same', 'C == Z', ['if_same']],
    if_z: ['Execute if Z=1', 'Z=1', ['if_e']],
    if_nc_or_z: ['Execute if C=0 OR Z=1', 'C=0 OR Z=1', ['if_z_or_nc', 'if_be', 'if_le']],
    if_c: ['Execute if C=1', 'C=1', ['if_b', 'if_lt']],
    if_c_or_nz: ['Execute if C=1 OR Z=0', 'C=1 OR Z=0', ['if_nz_or_c']],
    if_c_or_z: ['Execute if C=1 OR Z=1', 'C=1 OR Z=1', ['if_z_or_c']],
    if_always: ['Always execute (default)', 'Always', []]
  };

  // Alias map: alias -> primary conditional name
  private readonly _conditionalAliases: { [key: string]: string } = {};

  // ---- INSTRUCTION EFFECTS TABLE ----
  private readonly _effectTable: { [key: string]: string } = {
    wc: 'Write C flag from instruction result',
    wz: 'Write Z flag from instruction result',
    wcz: 'Write both C and Z flags from instruction result',
    andc: 'AND C flag with instruction C result',
    andz: 'AND Z flag with instruction Z result',
    orc: 'OR C flag with instruction C result',
    orz: 'OR Z flag with instruction Z result',
    xorc: 'XOR C flag with instruction C result',
    xorz: 'XOR Z flag with instruction Z result'
  };

  // ---- MODCZ OPERANDS TABLE ----
  // Used with MODC, MODZ, MODCZ instructions
  private readonly _modczTable: { [key: string]: readonly [string, string] } = {
    // [bits, description]
    _clr: ['%0000', 'Clear flag (always 0)'],
    _nc_and_nz: ['%0001', 'C=0 AND Z=0'],
    _nz_and_nc: ['%0001', 'Z=0 AND C=0'],
    _gt: ['%0001', 'Greater than (unsigned)'],
    _nc_and_z: ['%0010', 'C=0 AND Z=1'],
    _z_and_nc: ['%0010', 'Z=1 AND C=0'],
    _nc: ['%0011', 'C=0'],
    _ge: ['%0011', 'Greater or equal (unsigned)'],
    _c_and_nz: ['%0100', 'C=1 AND Z=0'],
    _nz_and_c: ['%0100', 'Z=0 AND C=1'],
    _nz: ['%0101', 'Z=0 (not zero)'],
    _ne: ['%0101', 'Not equal'],
    _c_ne_z: ['%0110', 'C != Z'],
    _diff: ['%0110', 'C and Z differ'],
    _nc_or_nz: ['%0111', 'C=0 OR Z=0'],
    _nz_or_nc: ['%0111', 'Z=0 OR C=0'],
    _c_and_z: ['%1000', 'C=1 AND Z=1'],
    _z_and_c: ['%1000', 'Z=1 AND C=1'],
    _c_eq_z: ['%1001', 'C == Z'],
    _same: ['%1001', 'C and Z same'],
    _z: ['%1010', 'Z=1 (zero)'],
    _e: ['%1010', 'Equal'],
    _nc_or_z: ['%1011', 'C=0 OR Z=1'],
    _z_or_nc: ['%1011', 'Z=1 OR C=0'],
    _be: ['%1011', 'Below or equal (unsigned)'],
    _le: ['%1011', 'Less or equal (signed)'],
    _c: ['%1100', 'C=1'],
    _lt: ['%1100', 'Less than (unsigned)'],
    _c_or_nz: ['%1101', 'C=1 OR Z=0'],
    _nz_or_c: ['%1101', 'Z=0 OR C=1'],
    _c_or_z: ['%1110', 'C=1 OR Z=1'],
    _z_or_c: ['%1110', 'Z=1 OR C=1'],
    _set: ['%1111', 'Set flag (always 1)']
  };

  // ---- STREAMER CONSTANTS TABLE ----
  private readonly _streamerConstantTable: { [key: string]: string } = {
    // Immediate to LUT modes
    x_imm_32x1_lut: '32x1-bit immediate to LUT to pins',
    x_imm_16x2_lut: '16x2-bit immediate to LUT to pins',
    x_imm_8x4_lut: '8x4-bit immediate to LUT to pins',
    x_imm_4x8_lut: '4x8-bit immediate to LUT to pins',
    // Immediate to direct modes
    x_imm_32x1_1dac1: '32x1-bit immediate to 1 pin',
    x_imm_16x2_2dac1: '16x2-bit immediate to 2 pins',
    x_imm_16x2_1dac2: '16x2-bit immediate to 1 pin, 2-bit DAC',
    x_imm_8x4_4dac1: '8x4-bit immediate to 4 pins',
    x_imm_8x4_2dac2: '8x4-bit immediate to 2 pins, 2-bit DAC',
    x_imm_8x4_1dac4: '8x4-bit immediate to 1 pin, 4-bit DAC',
    x_imm_4x8_4dac2: '4x8-bit immediate to 4 pins, 2-bit DAC',
    x_imm_4x8_2dac4: '4x8-bit immediate to 2 pins, 4-bit DAC',
    x_imm_4x8_1dac8: '4x8-bit immediate to 1 pin, 8-bit DAC',
    x_imm_2x16_4dac4: '2x16-bit immediate to 4 pins, 4-bit DAC',
    x_imm_2x16_2dac8: '2x16-bit immediate to 2 pins, 8-bit DAC',
    x_imm_1x32_4dac8: '1x32-bit immediate to 4 pins, 8-bit DAC',
    // RFLONG to LUT modes
    x_rflong_32x1_lut: 'RFLONG to 32x1-bit LUT to pins',
    x_rflong_16x2_lut: 'RFLONG to 16x2-bit LUT to pins',
    x_rflong_8x4_lut: 'RFLONG to 8x4-bit LUT to pins',
    x_rflong_4x8_lut: 'RFLONG to 4x8-bit LUT to pins',
    // RFBYTE/RFWORD/RFLONG to direct modes
    x_rfbyte_1p_1dac1: 'RFBYTE to 1 pin',
    x_rfbyte_2p_2dac1: 'RFBYTE to 2 pins',
    x_rfbyte_2p_1dac2: 'RFBYTE to 1 pin, 2-bit DAC',
    x_rfbyte_4p_4dac1: 'RFBYTE to 4 pins',
    x_rfbyte_4p_2dac2: 'RFBYTE to 2 pins, 2-bit DAC',
    x_rfbyte_4p_1dac4: 'RFBYTE to 1 pin, 4-bit DAC',
    x_rfbyte_8p_4dac2: 'RFBYTE to 4 pins, 2-bit DAC',
    x_rfbyte_8p_2dac4: 'RFBYTE to 2 pins, 4-bit DAC',
    x_rfbyte_8p_1dac8: 'RFBYTE to 1 pin, 8-bit DAC',
    x_rfword_16p_4dac4: 'RFWORD to 4 pins, 4-bit DAC',
    x_rfword_16p_2dac8: 'RFWORD to 2 pins, 8-bit DAC',
    x_rflong_32p_4dac8: 'RFLONG to 4 pins, 8-bit DAC',
    // RGB video modes
    x_rfbyte_luma8: 'RFBYTE to 8-bit luminance',
    x_rfbyte_rgbi8: 'RFBYTE to RGBI 2:2:2:2',
    x_rfbyte_rgb8: 'RFBYTE to RGB 3:3:2',
    x_rfword_rgb16: 'RFWORD to RGB 5:6:5',
    x_rflong_rgb24: 'RFLONG to RGB 8:8:8',
    // Capture (WRFAST) modes
    x_1p_1dac1_wfbyte: '1 pin capture to WFBYTE',
    x_2p_2dac1_wfbyte: '2 pins capture to WFBYTE',
    x_2p_1dac2_wfbyte: '1 pin, 2-bit DAC capture to WFBYTE',
    x_4p_4dac1_wfbyte: '4 pins capture to WFBYTE',
    x_4p_2dac2_wfbyte: '2 pins, 2-bit DAC capture to WFBYTE',
    x_4p_1dac4_wfbyte: '1 pin, 4-bit DAC capture to WFBYTE',
    x_8p_4dac2_wfbyte: '4 pins, 2-bit DAC capture to WFBYTE',
    x_8p_2dac4_wfbyte: '2 pins, 4-bit DAC capture to WFBYTE',
    x_8p_1dac8_wfbyte: '1 pin, 8-bit DAC capture to WFBYTE',
    x_16p_4dac4_wfword: '4 pins, 4-bit DAC capture to WFWORD',
    x_16p_2dac8_wfword: '2 pins, 8-bit DAC capture to WFWORD',
    x_32p_4dac8_wflong: '4 pins, 8-bit DAC capture to WFLONG',
    // ADC modes
    x_1adc8_0p_1dac8_wfbyte: '1 ADC channel capture to WFBYTE',
    x_1adc8_8p_2dac8_wfword: '1 ADC + 8 pins capture to WFWORD',
    x_2adc8_0p_2dac8_wfword: '2 ADC channels capture to WFWORD',
    x_2adc8_16p_4dac8_wflong: '2 ADC + 16 pins capture to WFLONG',
    x_4adc8_0p_4dac8_wflong: '4 ADC channels capture to WFLONG',
    // DDS/Goertzel modes
    x_dds_goertzel_sinc1: 'DDS + Goertzel with SINC1 filter',
    x_dds_goertzel_sinc2: 'DDS + Goertzel with SINC2 filter',
    // Control symbols
    x_pins_off: 'Disable pin output',
    x_pins_on: 'Enable pin output',
    x_write_off: 'Disable WRFAST writing',
    x_write_on: 'Enable WRFAST writing',
    x_alt_off: 'LSB first bit order (default)',
    x_alt_on: 'MSB first bit order',
    // DAC routing
    x_dacs_off: 'No DAC override',
    x_dacs_0_0_0_0: 'X0 on all DAC channels',
    x_dacs_x_x_0_0: 'X0 on DAC channels 0,1',
    x_dacs_0_0_x_x: 'X0 on DAC channels 2,3',
    x_dacs_x_x_x_0: 'X0 on DAC channel 0',
    x_dacs_x_x_0_x: 'X0 on DAC channel 1',
    x_dacs_x_0_x_x: 'X0 on DAC channel 2',
    x_dacs_0_x_x_x: 'X0 on DAC channel 3',
    x_dacs_0n0_0n0: 'Differential X0/!X0 on all channels',
    x_dacs_x_x_0n0: 'Differential on channels 0,1',
    x_dacs_0n0_x_x: 'Differential on channels 2,3',
    x_dacs_1_0_1_0: 'Stereo X1,X0 pairs',
    x_dacs_x_x_1_0: 'Stereo on channels 0,1',
    x_dacs_1_0_x_x: 'Stereo on channels 2,3',
    x_dacs_1n1_0n0: 'Differential stereo',
    x_dacs_3_2_1_0: 'All 4 independent DAC channels'
  };

  constructor() {
    // Build alias -> primary map for conditionals
    for (const [primary, entry] of Object.entries(this._conditionalTable)) {
      const aliases = entry[2];
      for (const alias of aliases) {
        this._conditionalAliases[alias] = primary;
      }
    }
  }

  // ---- PUBLIC LOOKUP METHODS ----

  public docTextForPasm2Instruction(name: string): IBuiltinDescription {
    const nameKey = name.toLowerCase();
    const entry = this._instructionTable[nameKey];
    if (entry) {
      return {
        found: true,
        type: eBuiltInType.BIT_PASM_INSTRUCTION,
        category: entry[0],
        description: entry[2],
        signature: entry[1],
        flagC: entry[3] || undefined,
        flagZ: entry[4] || undefined,
        timing: entry[5] || undefined
      };
    }
    return this._emptyResult();
  }

  public docTextForPasm2Conditional(name: string): IBuiltinDescription {
    const nameKey = name.toLowerCase();
    let primaryKey = nameKey;
    // Check if this is an alias
    if (nameKey in this._conditionalAliases) {
      primaryKey = this._conditionalAliases[nameKey];
    }
    const entry = this._conditionalTable[primaryKey];
    if (entry) {
      // Collect all aliases for display
      const allAliases: string[] = [...entry[2]];
      // If accessed via alias, also show the primary
      if (nameKey !== primaryKey) {
        allAliases.unshift(primaryKey.toUpperCase());
        // Remove the one that matches the search
        const idx = allAliases.findIndex((a) => a.toLowerCase() === nameKey);
        if (idx >= 0) allAliases.splice(idx, 1);
      }
      return {
        found: true,
        type: eBuiltInType.BIT_PASM_CONDITIONAL,
        category: 'Conditional Execution',
        description: entry[0],
        signature: name.toUpperCase(),
        aliases: allAliases.length > 0 ? allAliases.map((a) => a.toUpperCase()) : undefined
      };
    }
    return this._emptyResult();
  }

  public docTextForPasm2Effect(name: string): IBuiltinDescription {
    const nameKey = name.toLowerCase();
    const descr = this._effectTable[nameKey];
    if (descr) {
      return {
        found: true,
        type: eBuiltInType.BIT_PASM_EFFECT,
        category: 'Instruction Effect',
        description: descr,
        signature: name.toUpperCase()
      };
    }
    return this._emptyResult();
  }

  public docTextForModczOperand(name: string): IBuiltinDescription {
    const nameKey = name.toLowerCase();
    const entry = this._modczTable[nameKey];
    if (entry) {
      return {
        found: true,
        type: eBuiltInType.BIT_CONSTANT,
        category: 'MODCZ Operand',
        description: `${entry[1]}<br>Value: ${entry[0]}`,
        signature: name.toUpperCase()
      };
    }
    return this._emptyResult();
  }

  public docTextForStreamerConstant(name: string): IBuiltinDescription {
    const nameKey = name.toLowerCase();
    const descr = this._streamerConstantTable[nameKey];
    if (descr) {
      return {
        found: true,
        type: eBuiltInType.BIT_CONSTANT,
        category: 'Streamer Mode Configuration',
        description: descr,
        signature: name.toUpperCase()
      };
    }
    return this._emptyResult();
  }

  private _emptyResult(): IBuiltinDescription {
    return {
      found: false,
      type: eBuiltInType.Unknown,
      category: '',
      description: '',
      signature: ''
    };
  }
}
