'' =================================================================================================
''
''   File....... test-pasm.spin
''   Purpose.... PASM File in P1 series of test files used to verify syntax highlighting
''   Authors.... Stephen M Moraco
''               -- Copyright (c) 2022 Iron Sheep Productions, LLC
''               -- see below for terms of use
''   E-mail..... stephen@ironsheep.biz
''   Started.... Nov 2022
''   Updated.... 30 Nov 2022
''
'' =================================================================================================

'' this is our full PASM (P1) instruction set

PUB null() : nRet

    '' This is NOT a top level object
CON
                _clkfreq
                _clkmode
                _free
                _stack
                _xinfreq
                xtal1
                xtal2
                xtal3
                RCFAST
                RCSLOW
                PLL1X
                PLL2X
                PLL4X
                PLL8X
                PLL16X

    _clkmode        = xtal1 + pll16x
    _xinfreq        = 5_000_000
    _free           = 1_024
    _STACK          = 3000

DAT

name            BYTE    0[23]

                ' P1 Constants
                TRUE
                FALSE
                POSX
                NEGX
                PI

                ' P1 Directives
                ORG
                FIT
                ' P1 storage Types
                RES
                BYTE
                WORD
                LONG

                ' P1 registers
                DIRA
                DIRB
                INA
                INB
                OUTA
                OUTB
                CNT
                CTRA
                CTRB
                FRQA
                FRQB
                PHSA
                PHSB
                VCFG
                VSCL
                PAR
                SPR

                ' P1 instructions (alpahbetical)
                ABS
                ABSNEG
                ADD
                ADDABS
                ADDS
                ADDSX
                ADDX
                AND
                ANDN
                CALL
                CLKSET
                CMP
                CMPS
                CMPSUB
                CMPSX
                CMPX
                COGID
                COGINIT
                COGSTOP
                DJNZ
                HUBOP
                JMP
                JMPRET
                LOCKCLR
                LOCKNEW
                LOCKRET
                LOCKSET
                MAX
                MAXS
                MIN
                MINS
                MOV
                MOVD
                MOVI
                MOVS
                MUXC
                MUXNC
                MUXNZ
                MUXZ
                NEG
                NEGC
                NEGNC
                NEGNZ
                NEGZ
                NOP
                OR
                RCL
                RCR
                RDBYTE
                RDLONG
                RDWORD
                RET
                REV
                ROL
                ROR
                SAR
                SHL
                SHR
                SUB
                SUBABS
                SUBS
                SUBSX
                SUBX
                SUMC
                SUMNC
                SUMNZ
                SUMZ
                TEST
                TESTN
                TJNZ
                TJZ
                WAITCNT
                WAITPEQ
                WAITPNE
                WAITVID
                WRBYTE
                WRLONG
                WRWORD
                XOR

    ' P1-Effects - flag write controls
    WC
    WZ
    NR
    WR

    ' P1 instruction conditionals
    IF_ALWAYS
    IF_NEVER
    IF_E
    IF_NE
    IF_A
    IF_B
    IF_AE
    IF_BE
    IF_C
    IF_NC
    IF_Z
    IF_NZ
    IF_C_EQ_Z
    IF_C_NE_Z
    IF_C_AND_Z
    IF_C_AND_NZ
    IF_NC_AND_Z
    IF_NC_AND_NZ
    IF_C_OR_Z
    IF_C_OR_NZ
    IF_NC_OR_Z
    IF_NC_OR_NZ

    IF_Z_EQ_C
    IF_Z_NE_C
    IF_Z_AND_C
    IF_Z_AND_NC
    IF_NZ_AND_C
    IF_NZ_AND_NC
    IF_Z_OR_C
    IF_Z_OR_NC
    IF_NZ_OR_C
    IF_NZ_OR_NC


                FIT

DAT { P1 instructions by group }

                ORG

                CLKSET      ' Configuration

                COGID       ' COG Control
                COGINIT     ' COG Control
                COGSTOP     ' COG Control

                LOCKCLR     ' Process Control
                LOCKNEW     ' Process Control
                LOCKRET     ' Process Control
                LOCKSET     ' Process Control
                WAITCNT     ' Process Control
                WAITPEQ     ' Process Control
                WAITPNE     ' Process Control
                WAITVID     ' Process Control

                CALL        ' flow control
                DJNZ        ' flow control
                JMP         ' flow control
                JMPRET      ' flow control
                RET         ' flow control
                TJNZ        ' flow control
                TJZ         ' flow control

                RDBYTE      ' Main Memory Access
                RDLONG      ' Main Memory Access
                RDWORD      ' Main Memory Access
                WRBYTE      ' Main Memory Access
                WRLONG      ' Main Memory Access
                WRWORD      ' Main Memory Access

                ABS         ' Common Operations
                ABSNEG      ' Common Operations
                ADD         ' Common Operations
                ADDABS      ' Common Operations
                ADDS        ' Common Operations
                ADDSX       ' Common Operations
                ADDX        ' Common Operations
                AND         ' Common Operations
                ANDN        ' Common Operations
                CMP         ' Common Operations
                CMPS        ' Common Operations
                CMPSUB      ' Common Operations
                CMPSX       ' Common Operations
                CMPX        ' Common Operations
                HUBOP       ' Common Operations
                MAX         ' Common Operations
                MAXS        ' Common Operations
                MIN         ' Common Operations
                MINS        ' Common Operations
                MOV         ' Common Operations
                MOVD        ' Common Operations
                MOVI      ' Common Operations
                MOVS      ' Common Operations
                MUXC      ' Common Operations
                MUXNC      ' Common Operations
                MUXNZ      ' Common Operations
                MUXZ      ' Common Operations
                NEG      ' Common Operations
                NEGC      ' Common Operations
                NEGNC      ' Common Operations
                NEGNZ      ' Common Operations
                NEGZ      ' Common Operations
                NOP      ' Common Operations
                OR      ' Common Operations
                RCL      ' Common Operations
                RCR      ' Common Operations
                REV      ' Common Operations
                ROL      ' Common Operations
                ROR      ' Common Operations
                SAR      ' Common Operations
                SHL      ' Common Operations
                SHR      ' Common Operations
                SUB      ' Common Operations
                SUBABS      ' Common Operations
                SUBS      ' Common Operations
                SUBSX      ' Common Operations
                SUBX      ' Common Operations
                SUMC      ' Common Operations
                SUMNC      ' Common Operations
                SUMNZ      ' Common Operations
                SUMZ      ' Common Operations
                TEST        ' Common Operations
                TESTN       ' Common Operations
                XOR         ' Common Operations

    FIT


CON { license }

{{


 -------------------------------------------------------------------------------------------------
  MIT License

  Copyright (c) 2022 Iron Sheep Productions, LLC

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
 =================================================================================================
}}
