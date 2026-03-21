# Spin2 Formatter — User Guide

The Spin2 Formatter automatically formats your `.spin2` source files: normalizing indentation, aligning columns, adjusting keyword case, and cleaning up whitespace. It is designed to produce clean, readable code that compiles to the exact same binary as the original — formatting never changes what your code does.

---

## Getting Started

### Finding the Formatter Settings

All formatter settings are in the VSCode Settings UI:

1. Open Settings: **File > Preferences > Settings** (or `Ctrl+,` / `Cmd+,`)
2. In the search bar, type **"Spin2 Formatter"**
3. All formatter options appear in the **Spin2 Document Formatter** section

### Enabling the Formatter

The formatter is **disabled by default**. To enable it:

1. Open Settings and search for **"Spin2 Formatter"**
2. Check the box for **Enable** — *"Enable the Spin2 document formatter"*

### Format on Save

To automatically format every time you save a `.spin2` file:

1. Check the box for **Format On Save** — *"Automatically format Spin2 documents when saving"*

Both **Enable** and **Format On Save** must be checked for auto-formatting to work.

### Manual Formatting

With the formatter enabled, you can format manually:
- **Keyboard**: `Shift+Alt+F` (Windows/Linux) or `Shift+Option+F` (Mac)
- **Command Palette**: `Format Document`
- **Right-click**: `Format Document` from the context menu

### Status Bar Indicator

When a `.spin2` file is open, the status bar shows the active whitespace mode:

- **"Spin2 Spaces: 2"** — using 2-space indentation
- **"Spin2 Tabs: 8"** — using tab characters (width 8)
- **"Spin2 Prop Tool"** — using PropellerTool elastic tabstops
- **"Spin2 IronSheep"** — using IronSheep elastic tabstops

Click the indicator to switch between spaces, tabs, or any elastic tabstop profile from a single menu. You can also change the indent size and tab width from this menu.

---

## Settings Reference

All settings are in the **Spin2 Document Formatter** section of the Settings UI. Search for **"Spin2 Formatter"** to find them.

### Whitespace & Tabs

| Setting | Default | Description |
|---------|---------|-------------|
| **Tabs To Spaces** | checked | Convert tab characters to spaces. Uncheck to keep tab characters in the output. |
| **Tab Width** | `8` | Width of a tab character for conversion and alignment calculations. |
| **Trim Trailing Whitespace** | checked | Remove trailing spaces and tabs from all lines (except inside block comments). |
| **Insert Final Newline** | checked | Ensure the file ends with exactly one newline character. |

### Indentation

| Setting | Default | Options |
|---------|---------|---------|
| **Indent Size** | `2` | `2`, `4`, or `8` |

This controls the number of spaces per indent level inside PUB and PRI method bodies. Code nesting is preserved; only the width of each level changes.

**With indent size 2** (default):
```spin2
PUB main() | i
  repeat i from 0 to 9
    if i > 5
      debug("big")
```

**With indent size 4:**
```spin2
PUB main() | i
    repeat i from 0 to 9
        if i > 5
            debug("big")
```

### Blank Lines

| Setting | Default | Description |
|---------|---------|-------------|
| **Max Consecutive Blank Lines** | `1` | Maximum blank lines allowed in a row. Excess blanks are removed. |
| **Blank Lines Between Sections** | `1` | Blank lines between major sections (CON, VAR, OBJ, DAT, PUB, PRI). |
| **Blank Lines Between Methods** | `2` | Blank lines between consecutive PUB/PRI methods. |

### Comments

| Setting | Default | Description |
|---------|---------|-------------|
| **Space After Comment Start** | checked | Insert a space after `'` or `''` in comments. |

When enabled:
- `'text` becomes `' text`
- `''text` becomes `'' text`
- Trailing comments get exactly 2 spaces between code and the `'` marker

---

## Keyword Case Normalization

The formatter provides **six independent case controls**. Each appears as a dropdown in the Settings UI with three options:

| Dropdown Value | Effect |
|----------------|--------|
| **uppercase** | Force to UPPERCASE |
| **lowercase** | Force to lowercase |
| **preserve** | Leave as-is (no changes) |

### Block Name Case

**Setting**: **Block Name Case** (default: `uppercase`)

Controls the case of section keywords: CON, VAR, OBJ, DAT, PUB, PRI.

```spin2
' With "uppercase" (default):     ' With "lowercase":
CON                                con
VAR                                var
PUB main()                        pub main()
```

### Control Flow Case

**Setting**: **Control Flow Case** (default: `lowercase`)

Controls keywords used for program flow in PUB/PRI methods:

`if`, `ifnot`, `elseif`, `elseifnot`, `else`, `case`, `case_fast`, `other`, `repeat`, `from`, `to`, `step`, `while`, `until`, `with`, `next`, `quit`, `return`, `abort`

```spin2
' With "lowercase" (default):     ' With "uppercase":
  repeat i from 0 to 9              REPEAT i FROM 0 TO 9
    if i > 5                           IF i > 5
      quit                              QUIT
```

### Method & Built-in Case

**Setting**: **Method Case** (default: `lowercase`)

Controls built-in methods and constants:

- **Methods**: `cogspin`, `coginit`, `cogstop`, `cogid`, `pinwrite`, `pinread`, `pinlow`, `pinhigh`, `pinfloat`, `pintoggle`, `locknew`, `lockret`, `locktry`, `lockrel`, `debug`, `send`, `recv`, `waitct`, `pollct`, `getct`, `wrpin`, `wxpin`, `wypin`, `rdpin`, `rqpin`, `akpin`, and many more
- **Constants**: `true`, `false`, `clkfreq`, `clkmode`, `pi`, `negx`, `posx`

```spin2
' With "lowercase" (default):     ' With "uppercase":
  pinwrite(PIN, 1)                   PINWRITE(PIN, 1)
  if x == true                       if x == TRUE
  debug("value: ", udec(x))          DEBUG("value: ", udec(x))
```

### Type Case

**Setting**: **Type Case** (default: `lowercase`)

Controls type keywords: `byte`, `word`, `long`, `struct`, `union`

These appear in VAR blocks, DAT blocks, and method bodies:

```spin2
' With "lowercase" (default):     ' With "uppercase":
VAR                                VAR
  long  position                     LONG  position
  byte  flags[8]                     BYTE  flags[8]
```

### User-Defined Constant Case

**Setting**: **Constant Case** (default: `preserve`)

Controls the case of user-defined constant names from CON sections. The formatter collects all constant names you define in CON blocks and normalizes their case everywhere they appear.

```spin2
' With "preserve" (default):      ' With "uppercase":
CON                                CON
  Max_Servos = 6                     MAX_SERVOS = 6

PUB main()                        PUB main()
  if count > Max_Servos              if count > MAX_SERVOS
```

### PASM Instruction Case

**Setting**: **Pasm Instruction Case** (default: `preserve`)

Controls PASM assembly instruction mnemonics in DAT sections and inline PASM:

`mov`, `add`, `sub`, `jmp`, `call`, `ret`, `org`, `end`, `wrlong`, `rdlong`, and all other P2 PASM instructions.

```spin2
' With "preserve" (default):      ' With "uppercase":
DAT                                DAT
              org                               ORG
myLabel       mov     x, #5       myLabel       MOV     x, #5
              add     x, y                      ADD     x, y
              end                               END
```

### Recommended Case Configurations

**Traditional Spin2 style** (matches Propeller Tool conventions):
- Block Name Case: `uppercase`
- Control Flow Case: `lowercase`
- Method Case: `lowercase`
- Type Case: `lowercase`
- Constant Case: `preserve`
- Pasm Instruction Case: `preserve`

**All uppercase:**
Set all six dropdowns to `uppercase`.

**Hands-off** (only do whitespace/alignment, don't change any case):
Set all six dropdowns to `preserve`.

---

## What the Formatter Does (Section by Section)

### CON Sections — Constant Alignment

The formatter aligns constant assignments vertically:

```spin2
' Before:                          ' After:
CON                                CON
  MAX_SERVOS=6                       MAX_SERVOS  = 6
  DEFAULT_POS =   1500               DEFAULT_POS = 1500
  PIN_LED= 56                        PIN_LED     = 56
```

- Names are indented consistently
- `=` signs are vertically aligned
- Values are placed immediately after `=`
- Interspersed comments align to the same indent as the constants

Enum groups (lines using `#`) are normalized to single-space-after-comma:

```spin2
CON
  #0, STATE_IDLE, STATE_RUN, STATE_STOP
```

### VAR Sections — Type and Name Alignment

```spin2
' Before:                          ' After:
VAR                                VAR
  LONG position                      LONG  position
  BYTE flags[ 8 ]                    BYTE  flags[8]
  WORD reading                       WORD  reading
```

- Types aligned at a consistent column
- Names aligned at a consistent column
- Comma spacing normalized

### OBJ Sections — Object Reference Alignment

```spin2
' Before:                          ' After:
OBJ                                OBJ
  servo:"servo_driver"               servo       : "servo_driver"
  display : "ssd1306"                display     : "ssd1306"
  segments[7] : "segment_drv"       segments[7] : "segment_drv"
```

- Object names aligned (including array declarations like `segments[7]`)
- Colons vertically aligned
- Filenames aligned

### DAT Sections — Data and PASM Alignment

**Data-only DAT sections** indent labels:

```spin2
DAT
        servoIdx      long    0
        servoOffset   long    1500
        msgLOW        byte    "LO", 0
```

**DAT sections with PASM** use column 0 for labels and align all 6 PASM columns (label, condition, mnemonic, operands, effects, comment) independently within each ORG...END region. Data declarations and PASM instructions have **separate column alignment** — long data label names don't push instruction mnemonics wider:

```spin2
DAT
              org
' data declarations align independently
maskQtrRowsModulus      long    0
redBitRGB1Value         long    $01
' instructions use their own columns
              mov       pa, #1           ' load immediate
              if_z      jmp       #done  ' branch if zero
done          ret                        ' return
              end
```

### PUB/PRI Methods — Indentation Normalization

The formatter detects your code's nesting structure and re-expresses it using the configured indent size:

```spin2
' Before (messy, inconsistent):    ' After (indentSize: 2):
PUB main() | i                     PUB main() | i
      repeat i from 0 to 9          repeat i from 0 to 9
          if i > 5                     if i > 5
             debug("big")               debug("big")
          else                         else
             debug("small")              debug("small")
```

Inline PASM blocks (ORG...END within methods) are formatted using DAT/PASM alignment rules.

### Trailing Comments

In all sections, trailing comments are vertically aligned within their block:

```spin2
CON
  MAX_SPEED   = 100                          ' maximum motor speed
  MIN_SPEED   = 10                           ' minimum motor speed
  ACCEL_RATE  = 5                            ' acceleration step
```

---

## What the Formatter Never Changes

The formatter is careful to preserve certain content exactly as-is:

1. **Block comments** (`{ }` and `{{ }}`): Everything inside block comments is untouched — including `'` comment lines within `{ }` blocks. Use block comments for ASCII art, tables, commented-out code, or any content that relies on exact spacing.

2. **Column-0 comments**: Comments that start at column 0 (`'...` or `''...`) are never moved. These are typically file headers, section banners, and dividers.

3. **String literals**: Content inside `"..."` is never modified. Keyword case normalization skips string content to avoid changing compiled output.

4. **debug() arguments**: Content inside `debug(...)` calls is not case-normalized. The Spin2 compiler treats type keywords inside debug differently, so changing case there can change behavior.

5. **Backtick expressions**: Debug display widget specifications (`` `scope ``, `` `bitmap ``, etc.) are preserved as-is.

6. **Preprocessor directives**: Lines starting with `#define`, `#ifdef`, `#ifndef`, `#else`, `#endif`, `#include`, `#undef`, `#pragma`, `#error`, or `#warn` are left completely untouched — no indentation, no case changes, no alignment.

---

## Elastic Tabstops Integration

If you have elastic tabstops enabled (check **Enable** under the **Spin2 Elastic Tabstops** section in Settings), the formatter uses your custom tabstop positions instead of the built-in defaults. This lets you control exactly where columns align in each section.

The formatter reads tabstop arrays from your selected profile (PropellerTool, IronSheep, or User1). If a section doesn't have a custom tabstop array, it falls back to the PropellerTool defaults.

The status bar indicator shows the active profile name — **"Spin2 Prop Tool"**, **"Spin2 IronSheep"**, or **"Spin2 User1"** — instead of a generic label. Click it to switch between spaces, tabs, or any elastic tabstop profile from a single menu.

**Note**: Method indentation (indent size x nesting level) is not affected by elastic tabstops. Elastic tabstops only affect column alignment in CON, VAR, OBJ, DAT, and trailing comment positioning in PUB/PRI.

---

## Tips

- **Start with defaults**: Enable the formatter with default settings first. Adjust individual settings as you discover preferences.
- **Use format-on-save**: Once you're comfortable with the formatter's output, enable Format On Save to keep code consistent without thinking about it.
- **Block comments for art**: If you have carefully formatted tables, diagrams, or ASCII art, wrap them in `{ }` block comments to protect them from reformatting.
- **Preserve mode**: Set all six case dropdowns to `preserve` if you only want whitespace/alignment formatting without any keyword case changes.
- **The formatter is safe**: Formatting never changes what your code compiles to. The formatter is tested by compiling before and after formatting and verifying the binary output is identical.

---

## Appendix: JSON Settings Reference

For users who prefer editing `settings.json` directly (open via Command Palette: `Ctrl+Shift+P` > **"Preferences: Open User Settings (JSON)"**), here are all formatter settings with their default values:

```json
{
  "spinExtension.formatter.enable": false,
  "spinExtension.formatter.formatOnSave": false,
  "spinExtension.formatter.trimTrailingWhitespace": true,
  "spinExtension.formatter.insertFinalNewline": true,
  "spinExtension.formatter.maxConsecutiveBlankLines": 1,
  "spinExtension.formatter.blankLinesBetweenSections": 1,
  "spinExtension.formatter.blankLinesBetweenMethods": 2,
  "spinExtension.formatter.tabsToSpaces": true,
  "spinExtension.formatter.tabWidth": 8,
  "spinExtension.formatter.indentSize": 2,
  "spinExtension.formatter.blockNameCase": "uppercase",
  "spinExtension.formatter.controlFlowCase": "lowercase",
  "spinExtension.formatter.methodCase": "lowercase",
  "spinExtension.formatter.typeCase": "lowercase",
  "spinExtension.formatter.constantCase": "preserve",
  "spinExtension.formatter.pasmInstructionCase": "preserve",
  "spinExtension.formatter.spaceAfterCommentStart": true
}
```

You only need to include settings where you want a non-default value. For example, to enable the formatter with 4-space indentation and uppercase control flow:

```json
{
  "spinExtension.formatter.enable": true,
  "spinExtension.formatter.formatOnSave": true,
  "spinExtension.formatter.indentSize": 4,
  "spinExtension.formatter.controlFlowCase": "uppercase"
}
```
