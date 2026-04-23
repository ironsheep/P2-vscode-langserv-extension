# PNut v54 Language Reference Additions

This document lists all new language features in v54 that need to be added to the language reference (from v53).

**Compiler header date:** 2026/04/22
**`spin2_version` constant:** 54 (was 53 in v53)
**Interpreter, debug units, ReadMe.txt:** byte-identical to v53

---

## Enhanced STRUCT Declarations

### Named Bitfields on BYTE/WORD/LONG Members

**Category:** Structure Definition
**Applies to:** `BYTE`, `WORD`, `LONG` members of a `STRUCT`

A STRUCT member of type `BYTE`, `WORD`, or `LONG` may carry one or more named bitfields. Each bitfield is introduced by a dot, specifies either a single bit or an inclusive bit range, and is referenced at use-site with the syntax `struct_var.member.bitfield`.

**Syntax:**
```spin2
STRUCT struct_name({BYTE|WORD|LONG} member_name{[count]}{.bitfield_name[bit_or_range]}...)
STRUCT struct_name({BYTE|WORD|LONG} member_name{[count]}{.bitfield_name[bit_or_range]}..., ...)
```

**Bitfield specification forms:**
| Form | Meaning |
|------|---------|
| `[N]` | Single-bit bitfield at bit N |
| `[upper..lower]` | Multi-bit bitfield spanning bits `upper` down to `lower` inclusive |

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `member_name` | Identifier | The parent byte/word/long member name |
| `bitfield_name` | Identifier | The bitfield's name, scoped to the struct |
| `N`, `upper`, `lower` | Integer constant | Bit positions, 0-based. Must fit the member type (0..7 for BYTE, 0..15 for WORD, 0..31 for LONG) |

**Member-type boundaries:**
| Member Type | Valid Bit Range |
|-------------|-----------------|
| `BYTE` | 0..7 |
| `WORD` | 0..15 |
| `LONG` | 0..31 |

**Example:**
```spin2
STRUCT pin_state_t(LONG flags.input[0].output[1].drive[3..2].value[31..24])

VAR
    pin_state_t pin

PUB demo() | snapshot
    pin.flags.input  := 1              ' set bit 0
    pin.flags.output := 0              ' clear bit 1
    pin.flags.drive  := %10            ' set bits 3..2 to %10
    pin.flags.value  := $FF            ' set bits 31..24 to $FF

    IF pin.flags.input AND NOT pin.flags.output
        snapshot := pin.flags.value    ' read bits 31..24

    pin.flags := 0                     ' whole-long assignment still works
```

**Notes:**
- Multiple bitfields chain on one member: `LONG flags.a[0].b[1].c[7..4]`.
- A single member may mix single-bit and multi-bit bitfields.
- Bitfields may overlap (no disjointness check).
- Bitfields can only be declared on `BYTE`, `WORD`, or `LONG` members. Applying `.bitfield[...]` to a `STRUCT` member is an error.
- Whole-member assignment (`pin.flags := value`) and whole-struct assignment (`pin := other_pin`) continue to work unchanged.
- Bitfield access is a `setup_bfield` style access — it can be read, written, or used as the target of `:=`, `++`, `--`, and compound-assign operators (same semantics as plain variable bitfields in earlier versions).

**Errors:**
| Error | Condition |
|-------|-----------|
| `Bitfields are only allowed for BYTE/WORD/LONG members` | `.bitfield[...]` applied to a STRUCT-typed member |
| `Bit number exceeds BYTE/WORD/LONG boundary` | Single bit >= 8/16/32, or upper bit of range >= boundary |
| `Lower bit number cannot exceed upper bit number` | `lower > upper` in `[upper..lower]` |

**No new bytecodes** — uses existing `bc_setup_bfield_0_31` (for bits 0..31) and `bc_setup_bfield_rfvar` (for spans > 1 bit).

---

### Nameless Single BYTE/WORD/LONG Struct Member

**Category:** Structure Definition

A STRUCT may be declared with exactly one unnamed `BYTE`, `WORD`, or `LONG` member as its sole content. This lets the struct name itself refer to the backing value, and is primarily useful as a container for named bitfields.

**Syntax:**
```spin2
STRUCT struct_name({BYTE|WORD|LONG}{.bitfield_name[bit_or_range]}...)
```

**Constraints:**
- Must be the **first and only** member.
- Type must be `BYTE`, `WORD`, or `LONG` — not `STRUCT`.
- No instance-count `[N]` is permitted on a nameless member.
- Bitfield chains are fully supported.

**Example:**
```spin2
STRUCT io_t(LONG.ready[0].error[1].mode[3..2].counter[31..8])

VAR
    io_t  io

PUB demo()
    io.ready   := 1             ' direct bitfield access (no intermediate member name)
    io.mode    := %10
    io.counter := 100_000

    IF io.error
        io := 0                 ' whole-struct assignment
```

**Contrast with named member:**
```spin2
STRUCT named_t(LONG flags.ready[0])         ' access:  named_var.flags.ready
STRUCT nameless_t(LONG.ready[0])            ' access:  nameless_var.ready
```

**Notes:**
- Useful for hardware register wrappers, packed status words, and C-style bit-field types where only one backing long is needed.
- `SIZEOF(io_t)` returns the size of the member type (4 for LONG, 2 for WORD, 1 for BYTE).
- `OFFSETOF(io_t.ready)` returns 0 (nameless member occupies offset 0 of the struct).

---

## New Spin2 Functions

None. v54 adds no new Spin2 functions.

---

## New Spin2 Constants

None.

---

## New Spin2 Operators

None.

---

## New PASM2 Instructions

None.

---

## New DEBUG Display Features

None.

---

## Summary Table

| Type | Name | Description |
|------|------|-------------|
| Spin2 STRUCT syntax | `.bitfield_name[N]` after BYTE/WORD/LONG member | Single-bit named bitfield on a struct member |
| Spin2 STRUCT syntax | `.bitfield_name[upper..lower]` after BYTE/WORD/LONG member | Multi-bit named bitfield on a struct member |
| Spin2 STRUCT syntax | Nameless single BYTE/WORD/LONG member | Struct with one unnamed member, accessed by struct name |

---

## Bytecode Reference

No new bytecodes. Struct bitfield access reuses the existing bitfield-setup bytecodes introduced for plain variable bitfields:

| Bytecode | Used For |
|----------|----------|
| `bc_setup_bfield_0_31 + N` | Single-bit bitfield at bit N (0..31) |
| `bc_setup_bfield_rfvar` | Multi-bit bitfield (`rfvar` encodes the bit descriptor) |

---

## Version Directive Requirements

| Feature | Requires Directive? | Notes |
|---------|--------------------|-------|
| Named bitfields on STRUCT members | **Not enforced by PNut v54.** | `spin2_version` is 54, so `{Spin2_v54}` is a legal directive, but no `level54_symbols` table was added — the new STRUCT syntax parses unconditionally. Authors should include `{Spin2_v54}` as a declaration of intent. |
| Nameless single BYTE/WORD/LONG member | **Not enforced by PNut v54.** | Same as above. |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v54 | April 2026 | Struct bitfields (single-bit and ranged), nameless single BYTE/WORD/LONG struct members |
| v53 | March 2026 | Added OFFSETOF() |
| v52a | October 2025 | Previous release (MOVBYTS, ENDIAN, NEXT/QUIT level, DEBUG_END_SESSION) |
