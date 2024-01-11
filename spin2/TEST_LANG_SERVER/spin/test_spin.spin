'' =================================================================================================
''
''   File....... test_spin.spin
''   Purpose.... SPIN File in P1 series of test files used to verify syntax highlighting
''   Authors.... Stephen M Moraco
''               -- Copyright (c) 2022 Iron Sheep Productions, LLC
''               -- see below for terms of use
''   E-mail..... stephen@ironsheep.biz
''   Started.... Nov 2022
''   Updated.... 30 Nov 2022
''
'' =================================================================================================


'' this is our full Spin P1 instruction set


OBJ
{
    FLOAT
    ROUND
    TRUNC
    '}
'{
    mouse   : "USB_Mouse"       ' instantiate "USB_Mouse.spin2" as "mouse"
    v[16]   : "VocalSynth"      ' instantiate an array of 16 objects
    vga     : "tv_vga"
'}
CON
'{
    _clkfreq
    _clkmode
    _free
    _stack
    _xinfreq
    FALSE
    FLOAT
    NEGX
    PI
    PLL1X
    PLL2X
    PLL4X
    PLL8X
    PLL16X
    POSX
    RCFAST
    RCSLOW
    ROUND
    TRUE
    TRUNC
    XINPUT
    xtal1
    xtal2
    xtal3
'}
VAR
'{
    BYTE
    FLOAT
    LONG
    ROUND
    WORD
    TRUNC
'}
DAT
''{
    BYTE
    CNT
    CTRA
    CTRB
    DIRA
    DIRB
    FALSE
    FLOAT
    FRQA
    FRQB
    INA
    INB
    LONG
    NEGX
    OUTA
    OUTB
    PAR
    PHSA
    PHSB
    PI
    PLL1X
    PLL2X
    PLL4X
    PLL8X
    PLL16X
    POSX
    RCFAST
    RCSLOW
    ROUND
    SPR
    TRUE
    TRUNC
    VCFG
    VSCL
    WORD
    XINPUT
    xtal1
    xtal2
    xtal3

chkBffr     long    0[vga.MAX_BUFFER_LEN]
            long    0[vga.MAX_COG_BUFFER_SIZE_IN_LONGS]

'}
PUB null

    '' This is NOT a top level object

PUB allSpinLanguageParts
'{
' core spin verbs
    ABORT
    BYTE
    BYTEFILL()
    BYTEMOVE()
    CASE
    CHIPVER
    CLKFREQ
    CLKMODE
    CLKSET
    CNT
    COGID
    COGINIT()
    COGNEW()
    COGSTOP()
    CONSTANT()
    CTRA
    CTRB
    DIRA
    DIRB
    ELSE
    FALSE
    FLOAT
    FRQA
    FRQB
    IF
    IFNOT
    INA
    INB
    LOCKCLR()
    LOCKNEW()
    LOCKRET()
    LOCKSET()
    LONG
    LONGFILL()
    LONGMOVE()
    LOOKDOWN()
    LOOKDOWNZ()
    LOOKUP()
    LOOKUPZ()
    NEGX
    NEXT
    OUTA
    OUTB
    PAR
    PHSA
    PHSB
    PI
    PLL1X
    PLL2X
    PLL4X
    PLL8X
    PLL16X
    POSX
    QUIT
    RCFAST
    RCSLOW
    REBOOT()
    REPEAT
    RESULT
    RETURN
    ROUND
    SPR
    STRCOMP()
    STRING()
    STRSIZE()
    TRUE
    TRUNC
    VCFG
    VSCL
    WAITCNT()
    WAITPEQ()
    WAITPNE()
    WAITVID()
    WORD
    WORDFILL()
    WORDMOVE()
    XINPUT
    xtal1
    xtal2
    xtal3
'}
PUB allHubVariableNames
'{
    CLKFREQ
    CLKMODE
    CHIPVER
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
'}


PUB allClockVariabless
' value can be set with HUBSET
' - these are the compiled values
' set via CLKSET()
    ' SPIN2 VARIABLES
    clkfreq
    clkmode
    CLKSET
    CHIPVER
    cnt

PUB allSpinConstants
'{
    TRUE
    FALSE
    POSX
    NEGX
    PI
'}

PUB allnamedOperators
'{
    NOT
    AND
    OR

    FLOAT
    ROUND
    TRUNC
'}




PRI allFlowControl
'{
   ABORT
    CASE
    ELSE
    ELSEIF
    ELSEIFNOT
    FROM
    IF
    IFNOT
    NEXT
    OTHER
    QUIT
    REPEAT
    RETURN
    STEP
    TO
    UNTIL
    WHILE
'}


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
