# Spin2 Document Formatter — Theory of Operations

This document describes every formatting rule currently implemented in the Spin2 document formatter, extracted from the actual source code (not aspirational). It is organized into three sections:

1. **Universal rules** — applied regardless of tabstop mode
2. **Spaces/tabs-only mode** — when elastic tabstops are disabled
3. **Elastic tabstops mode** — when elastic tabstops are enabled

---

## 1. Universal Rules (Applied Everywhere)

These rules apply regardless of whether elastic tabstops are enabled or disabled.

### 1.1 Activation & Scope

- The formatter only processes `.spin2` files. `.spin` and `.p2asm` are ignored.
- Requires `spinExtension.formatter.enable = true`; returns no edits otherwise.
- Format-on-save is controlled by `spinExtension.formatter.formatOnSave`; handled by a client-side `onWillSaveTextDocument` handler that sends the request directly through the language client (bypasses VSCode's `editor.formatOnSave` dispatch to avoid conflicts with Prettier or other formatters).
- `configurationDefaults` in `package.json` claims `IronSheepProductionsLLC.spin2` as the default formatter for `[spin2]`, `[spin]`, and `[p2asm]` languages, and sets `editor.formatOnSave: false` for all three.

### 1.2 Processing Pipeline

The formatter applies rules in this order:

1. **Tab-to-space conversion** — All tab characters expanded to equivalent spaces (tab-stop-aware using `tabWidth`). This is always done first so all internal alignment math uses spaces.
2. **Trailing whitespace trimming** — `trimEnd()` on all non-block-comment lines (when `trimTrailingWhitespace` is true).
3. **Section column alignment** — Per-section formatters for CON, VAR, OBJ, DAT, PUB/PRI.
4. **Case normalization & comment spacing** — Keyword case, PASM case, space-after-comment-start.
5. **Blank line normalization** — Excess consecutive blank lines removed; section/method boundaries get configured blank-line counts.
6. **Final newline** — File ends with exactly one newline (when `insertFinalNewline` is true).
7. **Spaces-to-tabs conversion** — If `tabsToSpaces` is false, leading spaces are converted back to tabs using `tabWidth`.

### 1.3 Untouchable Content

These are NEVER modified by any formatting rule:

- **Block comments** (`{ }` and `{{ }}`): Once a block comment opens, everything until the matching close is skipped entirely. Interior is user-formatted.
- **Column-0 full-line comments**: Comments starting at column 0 (`'...` or `''...`) are never reformatted. These are file headers, section banners, dividers.
- **Blank lines**: Preserved in place (only excess consecutive blanks are removed).
- **debug() call arguments**: Inside `debug(...)`, keyword case normalization is suppressed because the compiler handles type keywords differently inside debug (case changes to LONG/BYTE/WORD can produce different binaries).
- **Backtick expressions**: Inside backtick display specs (`` `scope ``, `` `bitmap ``), all content is preserved.

### 1.4 Minimum Column Gap

A minimum gap of **2 spaces** is enforced between adjacent columns in all section formatters. When a token is too long and would leave fewer than 2 spaces before the next column position, the formatter skips to the following column position.

### 1.5 Two-Pass Alignment Strategy

All columnar section formatters (CON, VAR, OBJ, DAT, PASM) use the same approach:

1. **Measure pass**: Walk all lines in the alignment scope. Parse each into tokens. Record the maximum width of each column across all lines.
2. **Apply pass**: Compute column positions (using tabstop snapping), then rebuild each line placing tokens at those positions.

This ensures vertical alignment: the "worst-case" (longest) token drives the column position for all lines.

### 1.6 Trailing Comment Alignment

In every section, trailing comments (`' ...`) are vertically aligned within their block:

1. Measure the content-end column for all lines that have trailing comments.
2. If all content fits before the default comment column (second-to-last tabstop, typically col 56), use that.
3. Otherwise, snap to the next tabstop after the longest content line.

### 1.7 Comment Spacing

When `spaceAfterCommentStart` is true (default), ensure a space after `'` or `''`:
- `'text` → `' text`
- `''text` → `'' text`

When the comment is a trailing comment (code precedes it), 2 spaces are placed between the code and the comment marker.

### 1.8 Blank Line Normalization

- `maxConsecutiveBlankLines` (default 1): Excess consecutive blank lines within a block are removed.
- `blankLinesBetweenSections` (default 1): Blank lines between major sections (CON→VAR, VAR→OBJ, etc.).
- `blankLinesBetweenMethods` (default 2): Blank lines between consecutive PUB/PRI methods.

### 1.9 Keyword Case Normalization

- `keywordCase` (default `"lowercase"`): Normalize Spin2 keywords (`repeat`, `if`, `case`, `byte`, `long`, etc.) to lowercase or uppercase. `"preserve"` skips normalization.
- Applied only in PUB/PRI method bodies.
- Skips content inside `debug()` calls and backtick expressions.

### 1.10 PASM Instruction Case Normalization

- `pasmInstructionCase` (default `"preserve"`): Normalize PASM mnemonics (`mov`, `add`, `jmp`, etc.) in DAT sections.
- Applied only in DAT section lines.
- Skips full-line comments and block comment content.

---

## 2. Spaces/Tabs-Only Mode (Elastic Tabstops Disabled)

When `spinExtension.elasticTabstops.enable` is false (or not configured), the formatter uses the **PropellerTool default tabstop arrays** as its alignment grid. These are hardcoded constants:

```
CON: [2, 8, 16, 18, 32, 56, 78, 80]
VAR: [2, 8, 22, 32, 56, 80]
OBJ: [2, 8, 16, 18, 32, 56, 80]
PUB: [2, 4, 6, 8, 10, 12, 14, 16, 32, 56, 80]
PRI: [2, 4, 6, 8, 10, 12, 14, 16, 32, 56, 80]
DAT: [8, 14, 24, 32, 48, 56, 80]
```

**Convention**: The last stop in each array (80) is the line-width boundary. The second-to-last stop is the default trailing comment column.

All section-specific rules below use these default arrays for column snapping.

### 2.1 CON Section Rules

**Two line types: assignments and enums.**

**Assignments** (`NAME = value`):
- Names indented at the first tabstop (col 2).
- `=` signs vertically aligned at a fixed 2-space gap after the longest name (no tabstop snapping). This keeps `=` close to the names regardless of where tabstops fall.
- Values placed exactly 1 space after `=` (at `equalsCol + 2`).
- Trailing comments aligned per block.

**Enum groups** (`#N, MEMBER, MEMBER, ...`):
- Original indentation preserved.
- Whitespace normalized to single space after each comma.
- No column alignment — members flow horizontally.
- Trailing comments aligned to computed comment column.

**Enum detection**: Lines starting with `#`, or lines without `=` that contain comma-separated identifiers.

**Example** (default CON stops `[2, 8, 16, 18, 32, 56, 78, 80]`):
```spin2
CON
  MAX_SERVOS  = 6
  DEFAULT_POS = 1500
  PIN_LED     = 56

  #0, STATE_IDLE, STATE_RUN, STATE_STOP
```

### 2.2 VAR Section Rules

**Lines**: `TYPE name, name[count], ...`

- Types (`BYTE`, `WORD`, `LONG`) indented at the first tabstop (col 2).
- Types are **uppercased** in the output.
- Name column snapped to next tabstop after (indent + longest type width).
- Comma spacing normalized to single space after comma.
- Trailing comments aligned per block.

**Example** (default VAR stops `[2, 8, 22, 32, 56, 80]`):
```spin2
VAR
  LONG  motorPosition, targetPosition
  BYTE  statusFlags[MAX_SERVOS]
  WORD  sensorReading
```

### 2.3 OBJ Section Rules

**Lines**: `name : "filename"`

- Names indented at first tabstop (col 2).
- `:` vertically aligned: snapped to next tabstop after (indent + longest name width).
- Filename snapped to next tabstop after `:`.
- Trailing comments aligned per block.
- Name validation: must match identifier pattern `[A-Z_][A-Z0-9_]*`.

**Example** (default OBJ stops `[2, 8, 16, 18, 32, 56, 80]`):
```spin2
OBJ
  servo   : "servo_driver"
  display : "ssd1306"
```

### 2.4 DAT Section — Data Lines

**Lines**: `label  type  value`

**Label indentation depends on whether the DAT section contains PASM:**

- **Data-only DAT sections** (no ORG regions): Labels are indented to the first tabstop (col 8), like CON/VAR/OBJ names. This gives a consistent visual style across all non-PASM sections.
- **DAT sections containing PASM** (has ORG regions): Labels stay at column 0, even for data lines outside the ORG regions. The entire section follows PASM conventions.

**Column alignment:**
- Type column: snapped to next tabstop after (label indent + longest label width). If no labels exist, uses `tabStops[1]` (col 14).
- Types are **lowercased** in the output.
- Value column: snapped to next tabstop after (type column + max type width).
- Trailing comments aligned per block.
- **Label-only lines** (no type keyword): left untouched.
- **Alignment scope**: All non-ORG data lines in the DAT block share one alignment scope.

**Parsing**: After stripping whitespace, if the first token is NOT a type keyword (`byte`/`word`/`long`), it is treated as a label. Then the type keyword is expected.

**Example — data-only DAT** (default DAT stops `[8, 14, 24, 32, 48, 56, 80]`):
```spin2
DAT
        servoIdx      long    0
        servoOffset   long    1500
        msgLOW        byte    "LO", 0
                      word    @srvoId1
        srvoIdEntCt   byte    (@srvoIdTableEnd-@srvoIdTable) >> 1   ' div by 2
```

**Example — DAT with PASM** (labels at column 0):
```spin2
DAT
servoIdx      long    0
              org
myLabel       mov     x, #5
              end
moreData      long    0
```

### 2.5 DAT Section — PASM Lines (ORG Regions)

**Lines**: `label  condition  mnemonic  operands  effects  comment` (6 columns)

- **Each ORG...END region is an independent alignment scope.** Different ORG regions align independently.
- Labels at column 0.
- Condition column: snapped to next tabstop after longest label. If no labels, uses `tabStops[0]` (col 8).
- Conditions: `if_*` prefixes and `_ret_`.
- Mnemonic column: snapped to next tabstop after (condition column + max condition width). If no conditions, snapped from condition column.
- Operand column: snapped to next tabstop after (mnemonic column + max mnemonic width).
- Operand comma spacing normalized to single space after comma.
- Effects column: snapped to next tabstop after the longest operand end. Effects: `wc`, `wz`, `wcz`.
- Comment column: computed per-block from content end columns.

**Data lines within ORG regions**: Handled as PASM lines (type keyword appears in the mnemonic slot — aligns the same way).

### 2.6 PUB/PRI Method Rules

**Indentation normalization:**
- The formatter detects the current indent step by finding the smallest non-zero indentation difference between adjacent code lines.
- Each line's logical nesting level is computed from its indentation relative to the method body's base indent.
- Indentation is re-expressed as `indentSize × level` (default `indentSize` = 2).
- **Nesting levels are preserved; whitespace amounts are normalized.**
- PUB/PRI declaration line itself is not modified.

**Inline PASM (ORG...END within a method):**
- Content between ORG and END is stripped to column 0.
- Delegated to the DAT formatter for 6-column PASM alignment.
- ORG/END keyword lines remain at the method's indent level.

**Full-line comment alignment (after first code line only):**
- Full-line comments (`' ...`) that appear **after the first code line** in the method body are aligned to the indent of the next code line below them. This keeps commented-out code visually associated with the code around it.
- Comments **before the first code line** are method documentation and are never moved. This includes `''` doc-comment blocks (PUB), `'` description blocks (PRI), local variable descriptions, and any blank lines in the documentation area.
- Column-0 doc comments (`''` starting at column 0) are never moved, even after the first code line.
- Single-`'` comments at column 0 inside the code area ARE moved (these are commented-out code that happens to be flush left).
- If no code line follows (comment at end of method), the comment is left at its current indent.

**Trailing comment alignment:**
- All trailing comments within the method body (excluding inline PASM content) are vertically aligned to a common column, computed from the longest code line.

**What is NOT done:**
- Operator spacing (`spaceAroundOperators`) is declared in config but **not implemented**.
- `spaceAfterComma` is declared in config but **not implemented** for method bodies.
- `spaceInsideParens` is declared in config but **not implemented**.
- Line length enforcement / auto-wrapping with `...` is **not implemented** (Phase 5 deferred).

---

## 3. Elastic Tabstops Mode

When `spinExtension.elasticTabstops.enable` is true, the formatter reads per-section tabstop arrays from the user's configuration:

```
spinExtension.elasticTabstops.blocks.<choice>.<section>.tabStops
```

where `<choice>` is the selected tabstop profile (default `"PropellerTool"`) and `<section>` is `con`, `var`, `obj`, `pub`, `pri`, or `dat`.

If a section's tabstop array is not configured, it falls back to the PropellerTool defaults (same arrays as Section 2).

### 3.1 What Changes

**The alignment algorithm is identical** — all section formatters use `snapToNextTabstop()` the same way. The only difference is **which tabstop array** is used:

| Mode | Tabstop source |
|------|---------------|
| Non-elastic | Hardcoded PropellerTool defaults |
| Elastic | User-configured arrays (with PropellerTool defaults as fallback) |

This means:
- If the user's elastic tabstop arrays match the PropellerTool defaults, the output is **identical** in both modes.
- If the user has customized their tabstop arrays (e.g., wider columns, different comment position), the formatter respects those positions.

### 3.2 What Does NOT Change

**Method indentation** (`indentSize × level`) does **not** use the tabstop array. PUB/PRI nesting levels are always expressed as fixed multiples of `indentSize`, regardless of elastic tabstop mode. The PUB/PRI tabstop array is only used for trailing comment alignment within methods.

### 3.3 Per-Section Tabstop Selection

```typescript
// Elastic enabled: use user config, fall back to defaults
tabStops = elasticConfig.tabStops['con'] || DEFAULT_TABSTOPS.con

// Elastic disabled: always use defaults
tabStops = DEFAULT_TABSTOPS.con
```

This pattern is applied in every section formatter (CON, VAR, OBJ, DAT, PUB/PRI).

### 3.4 Tabstop Array Conventions

- **Last stop** = line-width boundary (e.g., 80). Not a content column.
- **Second-to-last stop** = default trailing comment column for that section.
- Tokens snap to the **next available tabstop** after the previous token ends (+ 2-space minimum gap).
- The formatter does NOT assign fixed semantic roles to tabstop positions. Content drives which positions get used.

---

## Appendix A: Configuration Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `formatter.enable` | boolean | `false` | Master enable/disable |
| `formatter.formatOnSave` | boolean | `false` | Format .spin2 on save (uses our own save handler) |
| `formatter.trimTrailingWhitespace` | boolean | `true` | Remove trailing whitespace |
| `formatter.insertFinalNewline` | boolean | `true` | Ensure file ends with one newline |
| `formatter.maxConsecutiveBlankLines` | number | `1` | Max consecutive blank lines |
| `formatter.blankLinesBetweenSections` | number | `1` | Blanks between sections |
| `formatter.blankLinesBetweenMethods` | number | `2` | Blanks between PUB/PRI |
| `formatter.tabsToSpaces` | boolean | `true` | Convert tabs to spaces |
| `formatter.tabWidth` | number | `8` | Tab character width |
| `formatter.indentSize` | number | `2` | Spaces per indent level (PUB/PRI) |
| `formatter.keywordCase` | enum | `"lowercase"` | Spin2 keyword case |
| `formatter.pasmInstructionCase` | enum | `"preserve"` | PASM mnemonic case |
| `formatter.spaceAfterCommentStart` | boolean | `true` | Space after `'` / `''` |

All settings are prefixed with `spinExtension.` (e.g., `spinExtension.formatter.enable`).

## Appendix B: Settings Declared But Not Implemented

These settings appear in `package.json` but have **no code** backing them:

| Setting | Declared | Status |
|---------|----------|--------|
| `formatter.spaceAroundOperators` | In plan only | Not implemented |
| `formatter.spaceAfterComma` | In plan only | Not implemented |
| `formatter.spaceInsideParens` | In plan only | Not implemented |
| `formatter.maxLineLength` | In plan only | Not implemented (Phase 5 deferred) |
| `formatter.wrapLongLines` | In plan only | Not implemented (Phase 5 deferred) |
| `formatter.constantCase` | In plan only | Not implemented |
| `formatter.enforceConstantNaming` | In plan only | Not implemented |
| `formatter.alignTrailingComments` | In plan only | Trailing comments always align (no toggle) |
| `formatter.trailingCommentColumn` | In plan only | Derived from tabstop array, no override |
| `formatter.normalizeIndentation` | In plan only | Indentation always normalizes (no toggle) |

## Appendix C: Section Formatter File Map

| File | Sections | Columns |
|------|----------|---------|
| `spin2.formatter.base.ts` | Shared utilities | snapToNextTabstop, padToColumn, splitTrailingComment, computeBlockCommentColumn |
| `spin2.formatter.con.ts` | CON | name, =, value, comment |
| `spin2.formatter.var.ts` | VAR | type, names, comment |
| `spin2.formatter.obj.ts` | OBJ | name, :, filename, comment |
| `spin2.formatter.dat.ts` | DAT data + PASM | data: label, type, value, comment; PASM: label, condition, mnemonic, operands, effects, comment |
| `spin2.formatter.method.ts` | PUB/PRI | indentation + trailing comments + inline PASM delegation |
| `spin2.formatter.comment.ts` | All sections | keyword case, PASM case, comment spacing |
| `DocumentFormattingProvider.ts` | Pipeline orchestration | tab conversion, whitespace, blank lines, final newline, section dispatch |

## Appendix D: Known Pitfalls (Lessons Learned)

These bugs were discovered during real-world testing and have regression fixtures to prevent recurrence.

### D.1 Keyword case normalization inside strings (`regr-string-keyword-case`)

`normalizeWordsInCode()` must skip double-quoted string content. `string("NOT found")` contains the word `NOT` which is a Spin2 keyword — lowercasing it to `string("not found")` changes the compiled binary because string content is embedded literally. The fix: track `inString` state in the character-walking loop and mark string regions as preserved.

### D.2 ORG/END boundary lines must participate in indent normalization (`regr-case-org-indent`)

Inline PASM boundary keywords (`org`, `end`) sit at the enclosing Spin2 code's nesting level. If `normalizeIndentation` skips them (treating them like PASM content), they keep their original indent while surrounding code moves. This can make `org` appear at the same indent as `case` match values, confusing the compiler (`OTHER must be last case`). The fix: only skip PASM *content* lines (between org/end), not the org/end keywords themselves.

### D.3 Mixed indent widths in the same file (`regr-mixed-indent-width`)

The original indent normalization used a formula: `level = (indent - baseIndent) / indentStep`. This fails when a file mixes 4-space and 2-space methods — the global `indentStep` is wrong for one or both. The fix: use a **stack-based algorithm** that tracks indent depth changes line-by-line. When indent increases, push; when it decreases, pop to the matching level. This correctly handles any mix of indent widths.

### D.4 `normalizeCommentSpacing` destroys full-line comment indentation

When `splitTrailingComment` splits a full-line comment like `  'text`, it returns `codePart=""` (empty) and `commentPart="'text"`. The comment spacing normalizer then rebuilds as just `normalized` — losing the leading whitespace. The fix: when `codePart` is empty, extract and preserve the original leading whitespace.

### D.5 `normalizeKeywordCase` drops code-to-comment gap

After `splitTrailingComment` separates code and comment, `normalizeKeywordCase` rejoined them as `normalized + commentPart` with no separator. This collapsed aligned trailing comments like `P_HIGH_FLOAT  ' description` into `P_HIGH_FLOAT' description`. The fix: recover the original gap from the line and re-insert it, adjusting for any length change from case normalization.

### D.6 Comment spacing regex splits `''` doc comments

The regex `/^('{1,2})(\S)/` backtracks: it first matches `''`, sees a space (fails `\S`), then matches just `'` and `(\S)` captures the second `'`. Result: `'' text` → `' ' text`. The fix: use `[^'\s]` instead of `\S` to prevent matching another quote character.

### D.8 PASM case normalization must also skip strings (`regr-pasm-case-strings`)

`normalizePasmCase` shares `normalizeWordsInCode()` with `normalizeKeywordCase`. DAT sections can contain `byte "ADD values here",0` where `ADD` is both a PASM mnemonic and literal string text. The string-tracking fix in D.1 covers both callers, but this fixture ensures PASM-specific case normalization is tested independently.

### D.9 CASE_FAST + inline PASM has the same ORG indent issue (`regr-casefast-org-indent`)

`case_fast` has identical block structure to `case`. If `org` doesn't participate in indent normalization (D.2), it can land at the case match level and confuse the compiler. This fixture verifies `case_fast` specifically since it's a separate keyword with the same risk.

### D.10 GOLD files must be compiled with PNut on Windows

The `.bin.GOLD` files checked into the repo must be compiled by PNut (the Windows Propeller 2 compiler), not pnut-ts. The test suite verifies cross-compiler parity (pnut-ts output == PNut output). Using pnut-ts for GOLD files defeats this check. New regression fixtures need Windows-compiled GOLD files before binary parity tests pass.
