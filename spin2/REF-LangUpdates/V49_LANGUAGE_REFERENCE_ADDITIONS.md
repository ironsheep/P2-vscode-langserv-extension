# V49 Language Reference Additions

This document lists new language features added in PNut v49 that should be added to the Spin2/PASM2 language reference.

---

## Overview

Version 49 primarily improves compiler limits and internal handling. The main user-facing enhancement is the ability to export and import structures between objects.

---

## Structure Export/Import

### Exporting Structures

**Description:**
Structures defined in CON blocks are now automatically exported and can be used by parent objects.

**Example - Child Object (sensor.spin2):**
```spin2
CON
    STRUCT reading_t(timestamp: LONG, value: LONG, status: BYTE)
    STRUCT sensor_config_t(rate: WORD, flags: BYTE, channel: BYTE)

VAR
    reading_t     last_reading
    sensor_config_t config

PUB get_reading() : reading_t result
    result := last_reading

PUB get_config() : sensor_config_t result
    result := config
```

**Example - Parent Object (main.spin2):**
```spin2
OBJ
    sens : "sensor"

VAR
    sens.reading_t       my_reading      ' Use structure from sensor object
    sens.sensor_config_t my_config

PUB main()
    my_reading := sens.get_reading()
    my_config := sens.get_config()

    debug("Value: ", sdec(my_reading.value))
    debug("Status: ", uhex(my_reading.status))
```

---

### Using Object Structures

**Syntax:**
```spin2
object_name.structure_name variable_name
```

**Description:**
Access structure types defined in child objects using dot notation.

**Valid in:**
- VAR block declarations
- Local variable declarations
- Method parameters and return types

**Example:**
```spin2
OBJ
    gfx : "graphics"

VAR
    gfx.point_t   cursor_pos
    gfx.rect_t    window_bounds[10]

PUB draw_at(gfx.point_t pos)
    ' Use structure from graphics object
```

---

## Compiler Limit Increases

### File Limit

| Version | Limit | Description |
|---------|-------|-------------|
| v48 | 32 | Maximum unique files |
| v49 | 255 | Maximum unique files |

This allows larger projects with more object files.

### Info Limit

| Version | Limit | Description |
|---------|-------|-------------|
| v48 | 1000 | IDE info entries |
| v49 | 2000 | IDE info entries |

More info entries for IDE integration (syntax highlighting, symbol info, etc.).

---

## Summary Table

| Feature | Type | Description |
|---------|------|-------------|
| Structure export | Language | Export structures from objects |
| Structure import | Language | Import structures from child objects |
| object.struct_t syntax | Syntax | Reference exported structures |
| 255 file limit | Compiler | Support larger projects |
| 2000 info entries | Compiler | Better IDE integration |

---

## Implementation Notes

When using exported structures:
1. The child object must be compiled first
2. The structure definition is included in the object file
3. Parent objects can reference the structure by name
4. Structure layout (size, alignment) is preserved exactly

**Error Messages:**
- `'Expected an existing STRUCT name'` - when referencing undefined structure
- `'Object index is not allowed before constants and structures'` - when trying to index object before accessing structure
