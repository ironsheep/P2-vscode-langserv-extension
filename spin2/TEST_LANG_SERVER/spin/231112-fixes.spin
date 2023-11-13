' --------------------------------------------------------------------------------------------------
DAT '' some lookup tables and strings

leveltimetbl word

VAR

long state_timer, game_timer

OBJ

sdda: "hexagon_sdda.spin"


PRI update() | i,j,tmp,tmp2,snes,sectorchange_flag,oldsector,clip_angle,huetmp,lkey,rkey,snes_trigger

      if leveltimetbl.word[tmp] == game_timer
        sdda.play_sfx(constant(sdda#SFX_LINE-1)+tmp)

' --------------------------------------------------------------------------------------------------
' more .word parsing issues

VAR
  long  par_tail        'key buffer tail        read/write      (19 contiguous longs)
  long  par_head        'key buffer head        read-only
  long  par_keys[8]     'key buffer (16 words)  read-only       (also used to pass initial parameters)

PUB key : keycode

'' Get key (never waits)
'' returns key (0 if buffer empty)

  if par_tail <> par_head
    keycode := par_keys.word[par_tail]
    par_tail := ++par_tail & $F
