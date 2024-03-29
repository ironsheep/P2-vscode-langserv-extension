'' =================================================================================================
''
''   File....... test_declarations.spin2
''   Purpose.... File series of P1 Spin/Pasm test files used to verify syntax highlighting
''   Authors.... Stephen M Moraco
''               -- Copyright (c) 2022 Iron Sheep Productions, LLC
''               -- see below for terms of use
''   E-mail..... stephen@ironsheep.biz
''   Started.... Dec 2022
''   Updated.... 1 Dec 2022
''
'' =================================================================================================


CON { section comment }

  _clkmode = xtal1 + pll16x
  _xinfreq = 5_000_000

CON EnableFlow = 8
    DisableFlow = 4
    ColorBurstFreq = 3_579_545

    one_hex = $31

    one_binary = %0011_0001

    one_quaternary = %%0030_0130

    PWM_Base = 8

    X = 5, y = -5, z = 1    ' comma separated assignments

    HalfPi = 1.5707963268   ' single precision float values
    QuarPi = HalfPi / 2.0 + pi
    max = posx
    min = negx

    j = ROUND(4000.0 / QuarPi)  ' float to integer

CON { enumerations }
    #0,a,b,c,d
    #1,e,f,g,h
    #-1[-1],m,n,p   ' m=-1, n=-2, p=-3 (start=-1, step=-1)

    #16
    q
    r[0]
    s
    t
    u[2]
    v
    w

CON     e0,e1,e2    ' e0=0, e1=1, e2=2
                    '.. enumeration is reset after each CON


VAR { named }

VAR CogNum  ' the default variable size is LONG.
    CursorMode
    PosnX            ' the first 15 longs have special butecodes for faster/smaller code
    PosnY
    SendPtr

    BYTE    StringChar          ' byte variable
    BYTE    StringBuffer[64]    ' byte variable array (64 bytes)
    BYTE    a,b,c[1000],d       ' command separated declarations

    WORD    CurrentCycle        ' word variable
    WORD    Cycles[200]         ' word variable array (200 words)
    WORD    e,f[5],g,h[10]      ' command separated declarations
    WORD    i[1],j,k,l[92]      ' command separated declarations

    LONG    values              ' long variable
    LONG    values[15]          ' long variable array (15 longs)
    LONG    i[100],j,k,l        ' command separated declarations

    alignw                      ' word-align to hub memory, advances variable pointer  as necessary

    alignl                      ' long-align to hub memory, advances variable pointer  as necessary
    BYTE    Bitmap[640*480]     '.. useful for making long-aligned buffers for FIFO wrapping

OBJ     vga     : "VGA_DRIVER"
        mouse   : "USB_Mouse"
        v[16]   : "VocalSynth"  ' instantiate array of 16 objects

PUB null

    '' This is NOT a top level object

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
