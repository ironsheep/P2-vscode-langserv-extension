# V48 Language Reference Additions

This document lists new language features added in PNut v48 that should be added to the Spin2/PASM2 language reference.

---

## Overview

Version 48 is primarily an internal release with no new user-facing language features. Changes are focused on:
- Flash file creation improvements
- External preprocessor symbol support
- Internal code reorganization

---

## External Preprocessor Symbols

### Command-Line Symbol Definition

**Description:**
Preprocessor symbols can now be defined externally before compilation, typically through command-line arguments. This allows the same source code to be compiled with different configurations without modifying the source.

**Usage (conceptual):**
```
pnut -DDEBUG_MODE -DVERSION=2 myprogram.spin2
```

**Behavior:**
- Symbols defined externally behave the same as `#DEFINE` symbols
- External symbols cannot be undefined with `#UNDEF` within the source
- Up to 16 external symbols can be defined
- Symbol names can be up to 31 characters

**Example:**
```spin2
' myprogram.spin2 - compiled with -DDEBUG_MODE

PUB main()
#IFDEF DEBUG_MODE
    debug("Debug mode enabled via command line")
#ENDIF
```

---

## Summary

| Feature | Type | Description |
|---------|------|-------------|
| External preprocessor symbols | Compiler | Define symbols from command line |

**Note:** v48 focuses on compiler infrastructure improvements. The version header was not updated (still shows v47).
