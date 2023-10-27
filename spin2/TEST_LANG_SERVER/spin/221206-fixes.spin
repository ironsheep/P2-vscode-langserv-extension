' -----------------------------------------------------------------
DAT {  class varaibles }
        long                1e+38, 1e+37, 1e+36, 1e+35, 1e+34, 1e+33, 1e+32, 1e+31
        long  1e+30, 1e+29, 1e+28, 1e+27, 1e+26, 1e+25, 1e+24, 1e+23, 1e+22, 1e+21
        long  1e+20, 1e+19, 1e+18, 1e+17, 1e+16, 1e+15, 1e+14, 1e+13, 1e+12, 1e+11

' -----------------------------------------------------------------
CON _clkfreq = 297_000_000
OBJ vga : "VGA_640x480_text_80x40"
VAR time, i

DAT myVar long 1
DAT init_asm
              org
              ' Get pin assignments and use to create
              ' masks for setting those pins.
              call      #read_args
              add ma_mtmp3,ma_adpcm_bufferbase


DAT read_args
              org
              mov       arg1_, par
              add       arg1_, #(1*4)

arg1_   res   1
ma_mtmp3      res 1
ma_mtmp1      res 1
ma_adpcm_bufferbase long @adpcm_buffers

adpcm_buffers
' -----------------------------------------------------------------
