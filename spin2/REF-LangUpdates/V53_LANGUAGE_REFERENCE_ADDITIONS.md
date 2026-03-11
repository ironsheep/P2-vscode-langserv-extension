# PNut v53 Language Reference Additions

This document lists all new language features in v53 that need to be added to the language reference (from v52a).

---

## New Spin2 Functions

### OFFSETOF(struct.member)

**Category:** Structure Introspection
**Returns:** Long (compile-time constant)

Returns the byte offset of a member within a structure definition. Navigates nested structures and supports constant array indexing at each level. Evaluated entirely at compile time — generates no runtime bytecode.

**Syntax:**
```spin2
result := OFFSETOF(struct_name)
result := OFFSETOF(struct_name.member)
result := OFFSETOF(struct_name[index].member)
result := OFFSETOF(struct_name.substruct.member)
```

**Full Syntax Form:**
```
OFFSETOF( struct_name{[constant_index]}{.member{[constant_index]}{.member{[constant_index]}...}} )
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| struct_name | STRUCT name | A previously defined structure type |
| member | Identifier | A member name within the structure |
| constant_index | Integer constant | Optional array index at any level |

**Example:**
```spin2
STRUCT point(LONG x, LONG y)
STRUCT line(point start, point finish)
STRUCT triangle(line sides[3])

PUB example() | ofs
  ' Simple member offsets
  ofs := OFFSETOF(point.x)               ' 0
  ofs := OFFSETOF(point.y)               ' 4

  ' Nested structure member offsets
  ofs := OFFSETOF(line.start)            ' 0
  ofs := OFFSETOF(line.finish)           ' 8
  ofs := OFFSETOF(line.finish.x)         ' 8
  ofs := OFFSETOF(line.finish.y)         ' 12

  ' Array-indexed access
  ofs := OFFSETOF(triangle.sides[0])     ' 0
  ofs := OFFSETOF(triangle.sides[1])     ' 16
  ofs := OFFSETOF(triangle.sides[2])     ' 32
  ofs := OFFSETOF(triangle.sides[2].finish.y)  ' 44

  ' Struct without member returns 0 (offset of start)
  ofs := OFFSETOF(point)                 ' 0
```

**Relationship to SIZEOF:**
| Function | Returns | Example with `point(LONG x, LONG y)` |
|----------|---------|---------------------------------------|
| `SIZEOF(point)` | Total size in bytes | 8 |
| `OFFSETOF(point)` | 0 (offset of start) | 0 |
| `OFFSETOF(point.x)` | Byte offset of member `x` | 0 |
| `OFFSETOF(point.y)` | Byte offset of member `y` | 4 |

**Block Restrictions:**
- Allowed in: DAT, VAR, PUB, PRI blocks
- **Not** allowed in: CON, OBJ blocks (same restrictions as SIZEOF)

**Member Types and Sizes:**
| Member Type | Size (bytes) |
|-------------|-------------|
| BYTE | 1 |
| WORD | 2 |
| LONG | 4 |
| nested STRUCT | SIZEOF(nested_struct) |

**Errors:**
| Error | Condition |
|-------|-----------|
| `OFFSETOF() is only allowed in DAT, VAR, PUB, and PRI blocks` | Used in CON or OBJ block |
| `Expected an existing STRUCT name` | First element is not a defined struct |
| `Expected a structure member name` | Member name after dot not recognized |
| `Structure does not contain this name` | Named member doesn't exist in the struct |
| `Indexed structures cannot exceed $FFFF bytes in size` | Struct too large for indexing |
| `Structure index must be from 0 to $FFFF` | Index value out of range |
| `Structure exceeds hub range of $FFFFF` | Computed offset exceeds address space |

**Notes:**
- Compile-time only — the result is a constant integer pushed onto the stack
- No new bytecodes; emits standard constant-push bytecodes
- Particularly useful for low-level buffer manipulation, binary protocol parsing, and interop with C-style data layouts
- Requires `{Spin2_v53}` version directive

---

## Summary Table

| Type | Name | Description |
|------|------|-------------|
| Spin2 Function | `OFFSETOF(struct.member)` | Compile-time byte offset of struct member |

---

## Bytecode Reference

No new bytecodes. OFFSETOF resolves entirely at compile time and emits standard constant-push bytecodes (`bc_con_rflong`, `bc_con_rfbyte`, etc.) depending on the offset value.

---

## Version Directive Requirements

| Feature | Requires Directive? | Notes |
|---------|-------------------|-------|
| `OFFSETOF(struct.member)` | `{Spin2_v53}` | Level 53 symbol |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v53 | March 2026 | Added OFFSETOF() |
| v52a | October 2025 | Previous release |
