# V46 Language Reference Additions

This document lists new language features added in PNut v46 that should be added to the Spin2/PASM2 language reference.

---

## New Spin2 Keywords

### STRUCT

**Category:** Data Type Declaration

**Syntax:**
```spin2
CON
    STRUCT name(member: TYPE, member: TYPE, ...)
```

**Description:**
Defines a named data structure with typed members. Structures can be used in VAR blocks, as local variables, and in DAT blocks (ORGH mode only).

**Members Types:**
- `BYTE` - 8-bit value
- `WORD` - 16-bit value
- `LONG` - 32-bit value
- Other structure names (nested structures)

**Example:**
```spin2
CON
    STRUCT point_t(x: LONG, y: LONG, z: LONG)
    STRUCT rect_t(topLeft: point_t, bottomRight: point_t)

VAR
    point_t  position
    rect_t   bounds[10]

PUB main() | point_t local_pt
    position.x := 100
    position.y := 200
    local_pt := position    ' structure copy
```

---

### SIZEOF

**Category:** Operator

**Syntax:**
```spin2
SIZEOF structure_name
```

**Description:**
Returns the size in bytes of a structure definition.

**Example:**
```spin2
CON
    STRUCT point_t(x: LONG, y: LONG, z: LONG)

PUB main() | size
    size := SIZEOF point_t   ' returns 12
```

---

## New Spin2 Operators

### :=: (Swap)

**Category:** Assignment Operator

**Syntax:**
```spin2
variable1 :=: variable2
```

**Description:**
Exchanges the values of two variables atomically.

**Example:**
```spin2
VAR
    long a, b

PUB main()
    a := 10
    b := 20
    a :=: b         ' now a=20, b=10
```

---

## New Spin2 Methods

### BYTESWAP

**Category:** Memory Operation

**Syntax:**
```spin2
BYTESWAP(adra, adrb, cnt)
```

**Parameters:**
- `adra` - First memory address
- `adrb` - Second memory address
- `cnt` - Number of bytes to swap

**Description:**
Swaps `cnt` bytes between memory at `adra` and memory at `adrb`.

**Example:**
```spin2
VAR
    byte array1[10], array2[10]

PUB main()
    BYTEFILL(@array1, $AA, 10)
    BYTEFILL(@array2, $55, 10)
    BYTESWAP(@array1, @array2, 10)
    ' now array1 = $55, array2 = $AA
```

---

### BYTECOMP

**Category:** Memory Operation

**Syntax:**
```spin2
result := BYTECOMP(adra, adrb, cnt)
```

**Parameters:**
- `adra` - First memory address
- `adrb` - Second memory address
- `cnt` - Number of bytes to compare

**Returns:**
- `-1` if memory at adra < memory at adrb
- `0` if memory regions are equal
- `+1` if memory at adra > memory at adrb

**Description:**
Compares `cnt` bytes between two memory regions.

**Example:**
```spin2
VAR
    byte str1[10], str2[10]

PUB main() | result
    BYTEMOVE(@str1, @"Hello", 6)
    BYTEMOVE(@str2, @"Hello", 6)
    result := BYTECOMP(@str1, @str2, 6)  ' returns 0
```

---

### WORDSWAP

**Category:** Memory Operation

**Syntax:**
```spin2
WORDSWAP(adra, adrb, cnt)
```

**Parameters:**
- `adra` - First memory address (word-aligned)
- `adrb` - Second memory address (word-aligned)
- `cnt` - Number of words to swap

**Description:**
Swaps `cnt` words between memory at `adra` and memory at `adrb`.

---

### WORDCOMP

**Category:** Memory Operation

**Syntax:**
```spin2
result := WORDCOMP(adra, adrb, cnt)
```

**Parameters:**
- `adra` - First memory address (word-aligned)
- `adrb` - Second memory address (word-aligned)
- `cnt` - Number of words to compare

**Returns:**
- `-1` if memory at adra < memory at adrb
- `0` if memory regions are equal
- `+1` if memory at adra > memory at adrb

**Description:**
Compares `cnt` words between two memory regions.

---

### LONGSWAP

**Category:** Memory Operation

**Syntax:**
```spin2
LONGSWAP(adra, adrb, cnt)
```

**Parameters:**
- `adra` - First memory address (long-aligned)
- `adrb` - Second memory address (long-aligned)
- `cnt` - Number of longs to swap

**Description:**
Swaps `cnt` longs between memory at `adra` and memory at `adrb`.

---

### LONGCOMP

**Category:** Memory Operation

**Syntax:**
```spin2
result := LONGCOMP(adra, adrb, cnt)
```

**Parameters:**
- `adra` - First memory address (long-aligned)
- `adrb` - Second memory address (long-aligned)
- `cnt` - Number of longs to compare

**Returns:**
- `-1` if memory at adra < memory at adrb
- `0` if memory regions are equal
- `+1` if memory at adra > memory at adrb

**Description:**
Compares `cnt` longs between two memory regions.

---

## New CON Constants

### DEBUG_MASK

**Category:** Debug Control

**Syntax:**
```spin2
CON
    DEBUG_MASK = %00000000_00000000_00000000_xxxxxxxx
```

**Description:**
When defined, enables selective DEBUG output. Each bit corresponds to a DEBUG channel (0-31). DEBUG statements with a channel index are only compiled if the corresponding bit is set.

**Usage:**
```spin2
CON
    DEBUG_MASK = %00000011   ' Enable channels 0 and 1

PUB main()
    DEBUG[0]("Channel 0")    ' Compiled
    DEBUG[1]("Channel 1")    ' Compiled
    DEBUG[2]("Channel 2")    ' NOT compiled
```

**Notes:**
- The DEBUG_MASK symbol must be defined for DEBUG[n] syntax to work
- Channel numbers must be 0-31
- Without DEBUG_MASK, use plain DEBUG("message") syntax

---

## Pointer Types

### Overview

v46 adds pointer types for structures and basic types:

**Declaration:**
```spin2
VAR
    ^BYTE  byte_ptr      ' pointer to byte
    ^WORD  word_ptr      ' pointer to word
    ^LONG  long_ptr      ' pointer to long
    ^point_t struct_ptr  ' pointer to structure
```

**Usage:**
```spin2
PUB main() | ^LONG ptr, value
    ptr := @some_variable
    value := ptr^        ' dereference pointer
    ptr^++               ' increment via pointer
```

---

## Summary Table

| Feature | Type | Description |
|---------|------|-------------|
| STRUCT | Keyword | Define data structures |
| SIZEOF | Operator | Get structure size |
| :=: | Operator | Swap variable values |
| BYTESWAP | Method | Swap byte arrays |
| BYTECOMP | Method | Compare byte arrays |
| WORDSWAP | Method | Swap word arrays |
| WORDCOMP | Method | Compare word arrays |
| LONGSWAP | Method | Swap long arrays |
| LONGCOMP | Method | Compare long arrays |
| DEBUG_MASK | Constant | Selective DEBUG channels |
| ^TYPE | Syntax | Pointer types |
