' ---------------------------------------------------
' Parameterization Test (Not legal on P1)
'
{
CON		_clkfreq	= 250_000_000	'system clock frequency

OBJ
    child1 : "child" | MULTIPLIER = 3, COUNT = 5        ' override child constants
    child2 : "child"                                    ' no override

PUB Main()
    child1.start(True)
    child2.start(False)

    repeat  ' lock here
}

' ---------------------------------------------------
' OBJ lines w/o spaces (#15)
CON
  _clkmode = xtal1 + pll16x
  _xinfreq = 5_000_000


OBJ

    render : "JETp2compat_rendering"    ' This works!
    render:"JETp2compat_rendering.spin"    ' and our comment (BUG not finding filename correctly!) HUH! Syntax only works!
    ' is a Semantic BUG!!!
