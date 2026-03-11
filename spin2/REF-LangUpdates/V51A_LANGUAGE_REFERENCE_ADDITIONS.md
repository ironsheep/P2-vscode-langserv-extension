# PNut v51a Language Reference Additions

This document lists all new language features in v51a that need to be added to the language reference (from v50).

---

## New Spin2 Functions

### LOG2(value)

**Category:** Floating-Point Math
**Returns:** Float

Computes the base-2 logarithm of a floating-point value.

**Syntax:**
```spin2
result := LOG2(float_value)
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| float_value | Float | Positive floating-point number |

**Example:**
```spin2
x := 8.0
result := LOG2(x)    ' result = 3.0 (since 2^3 = 8)

result := LOG2(1.0)  ' result = 0.0
result := LOG2(2.0)  ' result = 1.0
```

**Notes:**
- Returns NaN if input is negative or zero
- Uses CORDIC `QLOG` instruction internally

**Bytecode:** `bc_log2` ($C8)

---

### LOG10(value)

**Category:** Floating-Point Math
**Returns:** Float

Computes the base-10 (common) logarithm of a floating-point value.

**Syntax:**
```spin2
result := LOG10(float_value)
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| float_value | Float | Positive floating-point number |

**Example:**
```spin2
x := 100.0
result := LOG10(x)    ' result = 2.0 (since 10^2 = 100)

result := LOG10(1.0)   ' result = 0.0
result := LOG10(10.0)  ' result = 1.0
result := LOG10(1000.0) ' result = 3.0
```

**Notes:**
- Returns NaN if input is negative or zero
- Computed as LOG2(x) * log10(2)

**Bytecode:** `bc_log10` ($CA)

---

### LOG(value)

**Category:** Floating-Point Math
**Returns:** Float

Computes the natural logarithm (base e) of a floating-point value.

**Syntax:**
```spin2
result := LOG(float_value)
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| float_value | Float | Positive floating-point number |

**Example:**
```spin2
e := 2.718281828
result := LOG(e)      ' result ≈ 1.0

result := LOG(1.0)    ' result = 0.0
result := LOG(2.0)    ' result ≈ 0.693147
```

**Notes:**
- Returns NaN if input is negative or zero
- Computed as LOG2(x) * ln(2)

**Bytecode:** `bc_log` ($CC)

---

### EXP2(value)

**Category:** Floating-Point Math
**Returns:** Float

Computes 2 raised to the power of the floating-point value.

**Syntax:**
```spin2
result := EXP2(float_value)
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| float_value | Float | Exponent value |

**Example:**
```spin2
result := EXP2(3.0)    ' result = 8.0 (2^3)
result := EXP2(0.0)    ' result = 1.0 (2^0)
result := EXP2(-1.0)   ' result = 0.5 (2^-1)
result := EXP2(0.5)    ' result ≈ 1.414 (√2)
```

**Notes:**
- Uses CORDIC `QEXP` instruction internally
- Returns NaN for extreme exponents

**Bytecode:** `bc_exp2` ($CE)

---

### EXP10(value)

**Category:** Floating-Point Math
**Returns:** Float

Computes 10 raised to the power of the floating-point value.

**Syntax:**
```spin2
result := EXP10(float_value)
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| float_value | Float | Exponent value |

**Example:**
```spin2
result := EXP10(2.0)    ' result = 100.0 (10^2)
result := EXP10(0.0)    ' result = 1.0 (10^0)
result := EXP10(-1.0)   ' result = 0.1 (10^-1)
result := EXP10(0.5)    ' result ≈ 3.162 (√10)
```

**Notes:**
- Computed as EXP2(x / log10(2))
- Returns NaN for extreme exponents

**Bytecode:** `bc_exp10` ($D0)

---

### EXP(value)

**Category:** Floating-Point Math
**Returns:** Float

Computes e (Euler's number ≈ 2.71828) raised to the power of the floating-point value.

**Syntax:**
```spin2
result := EXP(float_value)
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| float_value | Float | Exponent value |

**Example:**
```spin2
result := EXP(1.0)     ' result ≈ 2.71828 (e^1 = e)
result := EXP(0.0)     ' result = 1.0 (e^0)
result := EXP(-1.0)    ' result ≈ 0.36788 (1/e)
result := EXP(2.0)     ' result ≈ 7.389 (e^2)
```

**Notes:**
- Computed as EXP2(x / ln(2))
- Returns NaN for extreme exponents

**Bytecode:** `bc_exp` ($D2)

---

## New Spin2 Operators

### POW (Binary Operator)

**Category:** Floating-Point Math
**Precedence:** 6 (same as +, -)
**Returns:** Float

Computes the first operand raised to the power of the second operand.

**Syntax:**
```spin2
result := base POW exponent
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| base | Float | Base value |
| exponent | Float | Exponent value |

**Example:**
```spin2
result := 2.0 POW 3.0      ' result = 8.0
result := 10.0 POW 2.0     ' result = 100.0
result := 2.0 POW 0.5      ' result ≈ 1.414 (√2)
result := 2.0 POW -1.0     ' result = 0.5
```

**Notes:**
- Computed as EXP2(exponent * LOG2(base))
- Returns NaN if base is negative (except for integer exponents)
- Left-associative

**Bytecode:** `bc_pow` ($C6)

---

## Enhanced Spin2 Behavior

### SIZEOF() Restrictions

In v51a, the `SIZEOF()` operator is now restricted to specific block types:

**Allowed in:**
- DAT blocks
- VAR blocks
- PUB methods
- PRI methods

**Not allowed in:**
- CON blocks (causes compile error)
- OBJ blocks (causes compile error)

**Error Message:**
`SIZEOF() is only allowed in DAT, VAR, PUB, and PRI blocks`

---

## Compiler Limits Changed

| Limit | v50 Value | v51a Value | Notes |
|-------|-----------|------------|-------|
| `struct_def_limit` | $8000 (32KB) | $20000 (128KB) | Structure definition buffer |

---

## Summary Table

| Type | Name | Description |
|------|------|-------------|
| Spin2 Function | `LOG2(value)` | Base-2 logarithm |
| Spin2 Function | `LOG10(value)` | Base-10 logarithm |
| Spin2 Function | `LOG(value)` | Natural logarithm |
| Spin2 Function | `EXP2(value)` | 2^x |
| Spin2 Function | `EXP10(value)` | 10^x |
| Spin2 Function | `EXP(value)` | e^x |
| Spin2 Operator | `POW` | x^y (binary) |

---

## Bytecode Reference

| Bytecode | Value | Function |
|----------|-------|----------|
| `bc_pow` | $C6 | POW operator |
| `bc_log2` | $C8 | LOG2(float) |
| `bc_log10` | $CA | LOG10(float) |
| `bc_log` | $CC | LOG(float) |
| `bc_exp2` | $CE | EXP2(float) |
| `bc_exp10` | $D0 | EXP10(float) |
| `bc_exp` | $D2 | EXP(float) |

---

## Operator Precedence Table (Updated)

| Level | Operators |
|-------|-----------|
| 0 | `!`, `-`, `ABS`, `FABS`, `ENCOD`, `DECOD`, `BMASK`, `ONES`, `SQRT`, `FSQRT`, `QLOG`, `QEXP`, **`LOG2`**, **`LOG10`**, **`LOG`**, **`EXP2`**, **`EXP10`**, **`EXP`** |
| 1 | `>>`, `<<`, `SAR`, `ROR`, `ROL`, `REV`, `ZEROX`, `SIGNX` |
| 2 | `&` |
| 3 | `^` |
| 4 | `\|` |
| 5 | `*`, `/.`, `/`, `+/`, `//`, `SCA`, `SCAS`, `FRAC` |
| 6 | `+`, `+.`, `-`, `-.`, **`POW`** |
| 7 | `#>`, `<#` |
| 8 | `ADDBITS`, `ADDPINS` |
| 9 | `<`, `+<`, `<=`, `+<=`, `==`, `<>`, `>=`, `+>=`, `>`, `+>`, `<=>` |
| 10 | `!!`, `NOT` |
| 11 | `&&`, `AND` |
| 12 | `\|\|`, `^^`, `OR`, `XOR` |
| 13 | `..` |
| 14 | `:`, `? :` |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v51a | July 2025 | Added LOG2, LOG10, LOG, EXP2, EXP10, EXP, POW; SIZEOF() restrictions |
| v50 | February 2025 | Previous release |
