# PNut v52a Language Reference Additions

This document lists all new language features in v52a that need to be added to the language reference (from v51a).

---

## New Spin2 Functions

### MOVBYTS(value, order)

**Category:** Byte Manipulation
**Returns:** Long

Reorders the four bytes within a 32-bit long value according to a base-4 pattern. Each digit in the pattern selects which source byte occupies that position in the result.

**Syntax:**
```spin2
result := MOVBYTS(value, order)
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| value | Long | 32-bit value whose bytes will be reordered |
| order | Long | Base-4 pattern (%%DDDD) specifying byte placement |

**Pattern Digits:**
| Digit | Selects |
|-------|---------|
| 0 | Byte 0 (bits 7:0) |
| 1 | Byte 1 (bits 15:8) |
| 2 | Byte 2 (bits 23:16) |
| 3 | Byte 3 (bits 31:24) |

**Example:**
```spin2
value := $44_33_22_11

result := MOVBYTS(value, %%0123)    ' reverse → $11_22_33_44
result := MOVBYTS(value, %%3210)    ' identity → $44_33_22_11
result := MOVBYTS(value, %%0000)    ' broadcast byte 0 → $11_11_11_11
result := MOVBYTS(value, %%1111)    ' broadcast byte 1 → $22_22_22_22
result := MOVBYTS(value, %%3300)    ' swap pairs → $44_44_11_11
```

**Notes:**
- Maps directly to the P2 `MOVBYTS` hardware instruction
- Also available as a PASM2 instruction: `MOVBYTS D, S/#`
- Does NOT require a version directive — available in all Spin2 versions

**Bytecode:** `bc_movbyts` ($E4)

---

### ENDIANL(value)

**Category:** Byte Manipulation
**Returns:** Long

Reverses the byte order of a 32-bit long value. Converts between big-endian and little-endian representation.

**Syntax:**
```spin2
result := ENDIANL(value)
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| value | Long | 32-bit value to byte-reverse |

**Example:**
```spin2
value := $AA_BB_CC_DD
result := ENDIANL(value)    ' result = $DD_CC_BB_AA

' Practical use: convert network byte order to P2 byte order
ip_addr := $C0_A8_01_01           ' 192.168.1.1 in big-endian
native := ENDIANL(ip_addr)        ' $01_01_A8_C0 in little-endian
```

**Notes:**
- Equivalent to `MOVBYTS(value, %%0123)`
- Applying ENDIANL twice returns the original value
- Requires `{Spin2_v52}` version directive

**Bytecode:** `bc_endianl` ($E6)

---

### ENDIANW(value)

**Category:** Byte Manipulation
**Returns:** Long

Reverses the byte order within the lower 16-bit word of a value. The upper 16 bits of the result are zero.

**Syntax:**
```spin2
result := ENDIANW(value)
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| value | Long | Value whose lower 16-bit word will be byte-swapped |

**Example:**
```spin2
value := $00_00_AA_BB
result := ENDIANW(value)    ' result = $00_00_BB_AA

' Practical use: swap bytes of a 16-bit sensor reading
raw := $00_00_12_34
swapped := ENDIANW(raw)     ' swapped = $00_00_34_12
```

**Notes:**
- Only operates on the lower 16 bits; upper 16 bits are cleared
- Internally: shifts value left 16 bits, then applies `MOVBYTS D, #%%0123`
- Requires `{Spin2_v52}` version directive

**Bytecode:** `bc_endianw` ($E8)

---

## New Spin2 Constants

### DEBUG_END_SESSION

**Category:** Debug Control
**Type:** Integer constant
**Value:** 27

A constant that, when output via a DEBUG statement, causes the debug host to terminate the debug session and close the debug window.

**Syntax:**
```spin2
DEBUG(DEBUG_END_SESSION)
```

**Example:**
```spin2
CON
  _clkfreq = 200_000_000

PUB main() | i
  REPEAT i FROM 0 TO 99
    DEBUG(UDEC(i))
  DEBUG(DEBUG_END_SESSION)    ' close debug window when done
```

**Notes:**
- Value 27 (ESC) is recognized by the debug host as session termination
- The debug window closes and `DebugActive` is set to False
- Requires `{Spin2_v52}` version directive

---

## Enhanced Spin2 Statements

### NEXT level

**Category:** Loop Control
**Existing:** `NEXT` (continue innermost REPEAT)
**New:** `NEXT level` (skip past inner REPEAT blocks, continue an outer one)

Skips past `level` inner REPEAT blocks and continues the next outer REPEAT. Without a level parameter, behaves as before (continues the innermost loop). `NEXT N` requires at least N+1 nested REPEAT blocks.

**Syntax:**
```spin2
NEXT              ' continue innermost REPEAT (unchanged, needs 1 REPEAT)
NEXT level        ' skip past level inner REPEATs, continue next outer (new)
```

**Parameters:**
| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| level | Integer | 1..15 | Number of inner REPEAT blocks to skip past (requires level+1 nesting) |

**Example:**
```spin2
PUB main() | x, y, z
  REPEAT x FROM 0 TO 9                 ' outermost
    REPEAT y FROM 0 TO 9               ' middle
      REPEAT z FROM 0 TO 9             ' innermost
        IF (z == 5)
          NEXT                          ' continue z loop (innermost)
        IF (y == 3) AND (z == 0)
          NEXT 1                        ' skip z loop, continue y loop
        IF (x == 7) AND (y == 0)
          NEXT 2                        ' skip z+y loops, continue x loop
```

**Notes:**
- `NEXT` (no parameter) continues the innermost REPEAT (requires 1 nesting level)
- `NEXT 1` skips past 1 inner REPEAT and continues the next outer one (requires 2 nesting levels)
- `NEXT 2` skips past 2 inner REPEATs (requires 3 nesting levels), etc.
- The compiler correctly handles intermediate CASE, REPEAT-VAR, and REPEAT-COUNT blocks when popping the stack
- Raises error if not sufficiently nested within REPEAT blocks

**Errors:**
| Error | Condition |
|-------|-----------|
| `NEXT/QUIT level must be from 1 to 15` | Level out of range |
| `NEXT/QUIT is not sufficiently nested within REPEAT block(s)` | Not enough enclosing REPEATs |

---

### QUIT level

**Category:** Loop Control
**Existing:** `QUIT` (exit innermost REPEAT)
**New:** `QUIT level` (skip past inner REPEAT blocks, exit an outer one)

Skips past `level` inner REPEAT blocks and exits the next outer REPEAT. Without a level parameter, behaves as before (exits the innermost loop). `QUIT N` requires at least N+1 nested REPEAT blocks.

**Syntax:**
```spin2
QUIT              ' exit innermost REPEAT (unchanged, needs 1 REPEAT)
QUIT level        ' skip past level inner REPEATs, exit next outer (new)
```

**Parameters:**
| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| level | Integer | 1..15 | Number of inner REPEAT blocks to skip past (requires level+1 nesting) |

**Example:**
```spin2
PUB main() | x, y
  REPEAT x FROM 0 TO 99                ' outer loop
    REPEAT y FROM 0 TO 99              ' inner loop
      IF (x * 100 + y == 5000)
        QUIT 1                          ' skip inner, exit outer (both loops end)
      process(x, y)
  ' Execution continues here after QUIT 1
```

**Notes:**
- `QUIT` (no parameter) exits the innermost REPEAT (requires 1 nesting level)
- `QUIT 1` skips past 1 inner REPEAT and exits the next outer one, effectively ending 2 loops (requires 2 nesting levels)
- `QUIT 2` skips past 2 inner REPEATs, effectively ending 3 loops (requires 3 nesting levels), etc.
- The compiler correctly pops stack values for intermediate loop constructs
- Raises error if not sufficiently nested within REPEAT blocks

**Errors:**
| Error | Condition |
|-------|-----------|
| `NEXT/QUIT level must be from 1 to 15` | Level out of range |
| `NEXT/QUIT is not sufficiently nested within REPEAT block(s)` | Not enough enclosing REPEATs |

---

## Summary Table

| Type | Name | Description |
|------|------|-------------|
| Spin2 Function | `MOVBYTS(value, order)` | Byte reordering (4-digit base-4 pattern) |
| Spin2 Function | `ENDIANL(value)` | 32-bit endian byte swap |
| Spin2 Function | `ENDIANW(value)` | 16-bit word endian byte swap |
| Spin2 Constant | `DEBUG_END_SESSION` | Terminates debug session (value 27) |
| Spin2 Statement | `NEXT level` | Skip past N inner REPEATs, continue next outer |
| Spin2 Statement | `QUIT level` | Skip past N inner REPEATs, exit next outer |

---

## Bytecode Reference

| Bytecode | Value | Function |
|----------|-------|----------|
| `bc_movbyts` | $E4 | MOVBYTS(long, pattern) |
| `bc_endianl` | $E6 | ENDIANL(long) |
| `bc_endianw` | $E8 | ENDIANW(word) |

Note: NEXT/QUIT level does not introduce new bytecodes — it uses the existing `bc_jmp`, `bc_jnz`, `bc_pop`, and `bc_pop_rfvar` bytecodes with different pop counts and branch targets.

---

## Version Directive Requirements

| Feature | Requires Directive? | Notes |
|---------|-------------------|-------|
| `MOVBYTS(value, order)` | No | In base symbol table (was already PASM2 instruction) |
| `ENDIANL(value)` | `{Spin2_v52}` | Level 52 symbol |
| `ENDIANW(value)` | `{Spin2_v52}` | Level 52 symbol |
| `DEBUG_END_SESSION` | `{Spin2_v52}` | Level 52 symbol |
| `NEXT level` | No | Syntax extension, not gated by version |
| `QUIT level` | No | Syntax extension, not gated by version |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v52a | October 2025 | Added MOVBYTS(), ENDIANL(), ENDIANW(), DEBUG_END_SESSION, NEXT/QUIT level |
| v51a | April 2025 | Previous release |
