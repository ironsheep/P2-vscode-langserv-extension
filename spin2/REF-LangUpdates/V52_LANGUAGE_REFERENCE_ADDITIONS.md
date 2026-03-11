# PNut v52 Language Reference Additions

This document lists all new language features in v52 that need to be added to the P2KB language reference (currently at v51a).

---

## New Spin2 Methods/Functions

### MOVBYTS(value, order)

**Category:** Byte Manipulation
**Returns:** Long

Rearranges the bytes of a 32-bit value according to the specified order pattern.

**Syntax:**
```spin2
result := MOVBYTS(value, order)
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| value | Long | 32-bit value whose bytes will be rearranged |
| order | Long | Quaternary pattern specifying byte arrangement |

**Order Pattern:**
The order uses quaternary (base-4) notation where each digit (0-3) specifies which source byte goes to that destination position:
- Byte 0 = bits 7:0 (lowest)
- Byte 1 = bits 15:8
- Byte 2 = bits 23:16
- Byte 3 = bits 31:24 (highest)

**Common Patterns:**
| Pattern | Effect | Example ($12_34_56_78) |
|---------|--------|------------------------|
| %%0123 | Reverse byte order | $78_56_34_12 |
| %%3210 | Identity (no change) | $12_34_56_78 |
| %%0000 | Broadcast byte 0 | $78_78_78_78 |
| %%3333 | Broadcast byte 3 | $12_12_12_12 |
| %%1032 | Swap adjacent pairs | $34_12_78_56 |
| %%0321 | Rotate right 1 byte | $78_12_34_56 |
| %%2103 | Rotate left 1 byte | $34_56_78_12 |

**Example:**
```spin2
value := $12_34_56_78
result := MOVBYTS(value, %%0123)    ' result = $78_56_34_12
result := MOVBYTS(value, %%0000)    ' result = $78_78_78_78
```

**Notes:**
- This function uses the PASM2 `MOVBYTS` instruction internally
- MOVBYTS is now available as both a PASM2 instruction AND a Spin2 function
- Equivalent to: `MOVBYTS D, S` in PASM2

**Bytecode:** `bc_movbyts` ($E4)

---

### ENDIANL(value)

**Category:** Byte Manipulation
**Returns:** Long

Reverses the byte order of a 32-bit long (big-endian to little-endian conversion or vice versa).

**Syntax:**
```spin2
result := ENDIANL(value)
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| value | Long | 32-bit value to byte-swap |

**Example:**
```spin2
value := $12_34_56_78
result := ENDIANL(value)    ' result = $78_56_34_12

' Double application returns original
result := ENDIANL(ENDIANL(value))    ' result = $12_34_56_78
```

**Notes:**
- Equivalent to `MOVBYTS(value, %%0123)`
- Implemented using the PASM2 `MOVBYTS` instruction with pattern %%0123
- Useful for converting between big-endian and little-endian formats

**Bytecode:** `bc_endianl` ($E6)

---

### ENDIANW(value)

**Category:** Byte Manipulation
**Returns:** Long

Reverses the byte order of the lower 16 bits (word) of a value. Upper 16 bits are cleared.

**Syntax:**
```spin2
result := ENDIANW(value)
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| value | Long | Value containing word to byte-swap in lower 16 bits |

**Example:**
```spin2
value := $00_00_12_34
result := ENDIANW(value)    ' result = $00_00_34_12

value := $AA_BB_12_34
result := ENDIANW(value)    ' result = $00_00_34_12 (upper bits cleared)
```

**Notes:**
- Only the lower 16 bits are processed
- Upper 16 bits of result are always zero
- Implemented by shifting word to upper half, then using MOVBYTS %%0123

**Bytecode:** `bc_endianw` ($E8)

---

## Enhanced Spin2 Statements

### NEXT {level}

**Category:** Flow Control

Continues execution at the next iteration of a REPEAT loop. The optional level parameter specifies which nested loop to continue.

**Syntax:**
```spin2
NEXT              ' Continue innermost loop (same as NEXT 1)
NEXT level        ' Continue the Nth outer loop
```

**Parameters:**
| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| level | Integer | 1-16 | Which loop level to continue (1 = innermost) |

**Example:**
```spin2
repeat a from 1 to 10
    repeat b from 1 to 10
        repeat c from 1 to 10
            if some_condition
                next        ' Continue innermost (c) loop
            if other_condition
                next 2      ' Continue middle (b) loop
            if third_condition
                next 3      ' Continue outermost (a) loop
```

**Stack Behavior:**
When using `NEXT level` with level > 1, all intermediate loops are exited and their stack frames are properly cleaned up before continuing the target loop.

**Notes:**
- Level 1 is equivalent to plain `NEXT`
- Maximum level is 16
- Error if level exceeds actual nesting depth

---

### QUIT {level}

**Category:** Flow Control

Exits one or more REPEAT loops. The optional level parameter specifies how many nested loops to exit.

**Syntax:**
```spin2
QUIT              ' Exit innermost loop (same as QUIT 1)
QUIT level        ' Exit N loops
```

**Parameters:**
| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| level | Integer | 1-16 | How many loops to exit (1 = innermost only) |

**Example:**
```spin2
repeat a from 1 to 10
    repeat b from 1 to 10
        repeat c from 1 to 10
            if found_it
                quit 3      ' Exit all three loops
            if skip_row
                quit 2      ' Exit c and b loops, continue with next a
```

**Notes:**
- Level 1 is equivalent to plain `QUIT`
- Maximum level is 16
- Error if level exceeds actual nesting depth

---

## New Spin2 Constants

### DEBUG_END_SESSION

**Category:** Debug Constants
**Value:** 27

A predefined constant that, when sent via DEBUG(), cleanly terminates the debug session.

**Syntax:**
```spin2
DEBUG(DEBUG_END_SESSION)
' or equivalently:
DEBUG(27)
```

**Example:**
```spin2
PUB main()
    DEBUG("Starting program...")

    ' ... program code ...

    DEBUG("Closing debug session")
    DEBUG(DEBUG_END_SESSION)    ' Closes debug window
```

**Notes:**
- When the debug display receives character code 27, it:
  - Sets DebugActive to False
  - Closes the debug window
  - Ends the session cleanly
- Useful for programmatic control of debug sessions
- Can be used in CON blocks: `MY_CONST = DEBUG_END_SESSION`

---

## PASM2 Changes

### MOVBYTS (Updated)

**Note:** MOVBYTS already exists as a PASM2 instruction. In v52, it is also available as a Spin2 function (see above). The PASM2 instruction behavior is unchanged.

No new PASM2 instructions were added in v52.

---

## Summary Table

| Type | Name | Description |
|------|------|-------------|
| Spin2 Function | `MOVBYTS(value, order)` | Rearrange bytes by pattern |
| Spin2 Function | `ENDIANL(value)` | 32-bit byte-order swap |
| Spin2 Function | `ENDIANW(value)` | 16-bit byte-order swap |
| Spin2 Statement | `NEXT level` | Continue Nth outer loop |
| Spin2 Statement | `QUIT level` | Exit N loops |
| Spin2 Constant | `DEBUG_END_SESSION` | Value 27, ends debug session |

---

## Bytecode Reference

| Bytecode | Value | Function |
|----------|-------|----------|
| `bc_movbyts` | $E4 | MOVBYTS(long, pattern) |
| `bc_endianl` | $E6 | ENDIANL(long) |
| `bc_endianw` | $E8 | ENDIANW(word) |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v52 | October 2025 | Added MOVBYTS(), ENDIANL(), ENDIANW(), NEXT/QUIT level, DEBUG_END_SESSION |
| v51a | July 2025 | Previous release |
