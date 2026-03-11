# PNut v50 Language Reference Additions

This document lists all new language features in v50 that need to be added to the language reference (from v49).

---

## New Spin2 Syntax

### Escape Character Strings (@\")

**Category:** String Literals

A new string syntax that supports escape character sequences.

**Syntax:**
```spin2
str := @\"string with \n escape \t characters"
```

**Escape Sequences:**

| Escape | Value | Description |
|--------|-------|-------------|
| `\a` | 7 | Alarm bell (BEL) |
| `\b` | 8 | Backspace (BS) |
| `\t` | 9 | Horizontal tab (HT) |
| `\n` | 10 | New line / line feed (LF) |
| `\f` | 12 | Form feed (FF) |
| `\r` | 13 | Carriage return (CR) |
| `\\` | 92 | Backslash |
| `\"` | 34 | Double quote |
| `\x01` to `\xFF` | 1-255 | Hexadecimal character code |

**Example:**
```spin2
' Standard string (no escapes)
str1 := @"Hello World"

' Escape string with newline and tab
str2 := @\"Line 1\nLine 2\tTabbed"

' Escape string with hex character
str3 := @\"Value: \x41"     ' \x41 = 'A'

' Escape string with quotes inside
str4 := @\"She said \"Hello\""
```

**Notes:**
- The `@\"` prefix indicates an escape-enabled string
- Standard `@"..."` strings do not process escapes
- `\x00` is not allowed (would terminate the string)
- Unknown escape sequences pass the backslash through literally

**Error Messages:**
- `Expected a string character` - Unterminated escape sequence
- `Invalid escape character` - Unknown escape sequence

---

## New PASM2 Features

### Conditional DEBUG

**Category:** Debug Instructions

DEBUG instructions can now be preceded by execution conditions.

**Syntax:**
```spin2
DAT
        org

        IF_C  DEBUG("Carry is set")
        IF_NC DEBUG("Carry is clear")
        IF_Z  DEBUG("Zero flag set")
```

**Implementation:**
When a condition other than `_RET_` or unconditional is present, the compiler generates:
```
IF_<opposite> SKIP #1
BRK ...
```

**Example:**
```spin2
DAT
        org

        test    value, #$FF     wz
        IF_Z    DEBUG("Value is zero")
        IF_NZ   DEBUG("Value is non-zero")

        add     x, #1           wc
        IF_C    DEBUG("Overflow occurred")
```

**Notes:**
- In v49, conditions before DEBUG were an error
- `_RET_` before DEBUG is allowed (no SKIP generated)
- The condition is inverted in the SKIP instruction

---

### DITTO Directive

**Category:** Assembly Directives

Repeats a block of code or data a specified number of times, with access to the current iteration index.

**Syntax:**
```spin2
DAT
        DITTO count
        ' ... code/data to repeat ...
        DITTO END
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| count | Integer | Number of repetitions (>= 0) |

**Special Symbol:**
| Symbol | Description |
|--------|-------------|
| `$$` | Current DITTO index (0 to count-1) |

**Example:**
```spin2
DAT
        org

' Generate a lookup table with 8 entries
        DITTO 8
        long    $$ * 100        ' 0, 100, 200, 300, 400, 500, 600, 700
        DITTO END

' Generate instruction sequence
        DITTO 4
        mov     reg + $$, #0    ' Clear reg+0, reg+1, reg+2, reg+3
        DITTO END

' Zero count generates no code
        DITTO 0
        long    $DEADBEEF       ' This is skipped entirely
        DITTO END
```

**Restrictions:**
- `ORG` is not allowed inside a DITTO block
- `ORGH` is not allowed inside a DITTO block
- DITTO blocks cannot be nested (use multiple sequential DITTOs)
- `$$` is only valid inside a DITTO block

**Error Messages:**
- `DITTO count must be a positive integer or zero`
- `"$$" (DITTO index) is only allowed within a DITTO block, inside a DAT block`
- `Expected DITTO END`
- `ORG not allowed within a DITTO block`
- `ORGH not allowed within a DITTO block`

---

### ORGH Inline Assembly

**Category:** Inline Assembly

Hub-execute inline assembly can now be used within Spin2 methods using ORGH.

**Syntax:**
```spin2
PUB method()
    ORGH
        ' Hub-execute PASM2 code
    END
```

**Example:**
```spin2
PUB fast_copy(src, dst, count) | i
    ORGH
        mov     ptrb, dst
        mov     ptra, src
        rep     @.end, count
        rdlong  i, ptra++
        wrlong  i, ptrb++
.end
    END
```

**Comparison with ORG:**
| Feature | ORG | ORGH |
|---------|-----|------|
| Execution | Cog RAM | Hub RAM |
| Code loading | Copied to cog registers | Executed in place |
| Size limit | $11F longs | $FFFF longs |
| Speed | Fastest | Slightly slower |

**Notes:**
- ORGH inline uses hub-exec mode
- Maximum size is $FFFF longs (including added RET)
- A RET instruction is automatically added
- Local variables (first 16) are saved/restored

**Bytecode:** `bc_orgh` ($D6 in v50, reorganized in v51a)

**Error Messages:**
- `ORGH inline block exceeds $FFFF longs (including the added RET instruction)`
- `ORG/ORGH inline block is empty`

---

### Register Constants in CON Blocks

**Category:** Constants

Register names (INA, INB, OUTA, OUTB, DIRA, DIRB, etc.) can now be used as constant values in CON blocks.

**Syntax:**
```spin2
CON
    MY_INA = INA        ' Gets the register address value
    MY_OUTA = OUTA
```

**Example:**
```spin2
CON
    INPUT_REG = INA
    OUTPUT_REG = OUTA
    DIRECTION_REG = DIRA

PUB setup()
    ' Use constants for indirect register access
    reg[INPUT_REG] := something
```

**Notes:**
- Only valid inside CON blocks
- Returns the register's address/index value
- Useful for indirect register addressing

---

## New DEBUG Display Features

### PLOT LAYER Command

**Category:** DEBUG PLOT Display

Loads a bitmap file into one of 8 layer buffers for later use.

**Syntax:**
```spin2
DEBUG(`PLOT LAYER layer 'filename.bmp')
```

**Parameters:**
| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| layer | Integer | 1-8 | Layer buffer number |
| filename | String | - | Path to BMP file |

**Example:**
```spin2
DEBUG(`PLOT LAYER 1 'background.bmp')
DEBUG(`PLOT LAYER 2 'sprites.bmp')
```

---

### PLOT CROP Command

**Category:** DEBUG PLOT Display

Copies a rectangular region from a layer bitmap to the plot display.

**Syntax:**
```spin2
DEBUG(`PLOT CROP layer AUTO x y)
DEBUG(`PLOT CROP layer left top width height)
DEBUG(`PLOT CROP layer left top width height x y)
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| layer | Integer (1-8) | Source layer buffer |
| AUTO | Keyword | Use full layer size |
| left, top | Integer | Source coordinates |
| width, height | Integer | Region size |
| x, y | Integer | Destination coordinates |

**Example:**
```spin2
' Copy entire layer 1 to position (0,0)
DEBUG(`PLOT LAYER 1 'bg.bmp')
DEBUG(`PLOT CROP 1 AUTO 0 0)

' Copy region from layer 2 to position (100, 50)
DEBUG(`PLOT CROP 2 0 0 32 32 100 50)
```

---

## Summary Table

| Type | Name | Description |
|------|------|-------------|
| Spin2 Syntax | `@\"...\"` | Escape character strings |
| PASM2 | Conditional DEBUG | IF_C DEBUG(...) |
| PASM2 Directive | `DITTO count` | Repeat block with $$ index |
| PASM2 Directive | `DITTO END` | End repeat block |
| PASM2 Symbol | `$$` | DITTO iteration index |
| Spin2 | ORGH inline | Hub-execute inline assembly |
| CON | Register constants | INA, OUTA, etc. in CON |
| DEBUG | PLOT LAYER | Load bitmap layers |
| DEBUG | PLOT CROP | Copy layer regions |

---

## Bytecode Reference

| Bytecode | Value | Function |
|----------|-------|----------|
| `bc_org` | $5E | ORG inline assembly (renamed from bc_inline) |
| `bc_orgh` | $D6 | ORGH inline assembly |
| `bc_task_return` | $D4 | Task return (renamed from bc_top_return) |

---

## Token Reference

| Token | Description |
|-------|-------------|
| `type_dollar2` | The `$$` DITTO index token |
| `dir_ditto` | DITTO directive |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v50 | February 2025 | Added escape strings, conditional DEBUG, DITTO, ORGH inline, register constants, PLOT LAYER/CROP |
| v49 | February 2025 | Previous release |
