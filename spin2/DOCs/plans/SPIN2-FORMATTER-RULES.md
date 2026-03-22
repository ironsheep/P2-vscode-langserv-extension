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

1. **Tab-to-space conversion** — All tab characters expanded to equivalent spaces (tab width is fixed at 8). This is always done first so all internal alignment math uses spaces.
2. **Trailing whitespace trimming** — `trimEnd()` on all non-block-comment lines (when `trimTrailingWhitespace` is true).
3. **Section column alignment** — Per-section formatters for CON, VAR, OBJ, DAT, PUB/PRI. In non-elastic mode, uses content-driven column layout with `indentSize` gaps. In elastic mode, uses profile-defined tabstop arrays.
4. **Small-block comment merging** — Consecutive same-type blocks under 15 lines share a unified trailing comment column, preventing jagged comments across small blocks.
5. **Case normalization & comment spacing** — Keyword case, PASM case, space-after-comment-start.
6. **Line-continuation alignment** — `...` markers within consecutive continuation groups are vertically aligned.
7. **Blank line normalization** — Excess consecutive blank lines removed; section/method boundaries get configured blank-line counts.
8. **Final newline** — File ends with exactly one newline (when `insertFinalNewline` is true).
9. **Tab compression** (non-elastic only) — Runs of spaces are compressed with tab characters at 8-column boundaries. Elastic mode uses pure spaces (no tabs) to preserve non-8-aligned column positions.

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

**Non-elastic mode** (content-driven):
1. Measure the content-end column for all lines with trailing comments.
2. Place comments at `maxContentEnd + 2×indentSize`, with a floor of 2 spaces.

**Elastic mode** (tabstop-snapped):
1. Measure the content-end column for all lines with trailing comments.
2. If all content fits before the default comment column (second-to-last tabstop, typically col 56), use that.
3. Otherwise, snap to the next tabstop after the longest content line.

### 1.6a Small-Block Comment Merging

When consecutive same-type blocks (e.g., CON, CON, CON) each have fewer than 15 lines, their trailing comment columns are unified across the entire run. This prevents jagged comment alignment across small blocks. Large blocks (15+ lines) keep independent comment columns. PUB/PRI blocks are excluded (they have their own method-level comment alignment).

### 1.6b Line-Continuation Alignment

Groups of consecutive lines ending with `...` (line-continuation markers) are vertically aligned within each group:

1. Identify the group: consecutive lines whose code (before any trailing comment) ends with ` ...`.
2. Split each line into: code before `...`, and `... [comment]`.
3. Align `...` at `maxCodeWidth + 2×indentSize` (non-elastic) or snapped to the next tabstop (elastic).
4. The floor is 2 spaces (MIN_COLUMN_GAP).

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

## 2. Spaces Mode (Elastic Tabstops Disabled)

When `spinExtension.elasticTabstops.enable` is false (or not configured), the formatter uses **content-driven column alignment** with `indentSize`-based gaps.

**Tab model**: Tab characters are always 8 columns wide (fixed, not configurable). In spaces mode, the formatter aligns using spaces internally, then compresses runs of spaces with tab characters at 8-column boundaries. Elastic mode uses pure spaces (no tab characters).

**Column grid**: A regular grid derived from `indentSize` (e.g., with `indentSize=2`: `[2, 4, 6, 8, 10, ...]`). This grid is used for initial column snapping in CON/VAR/OBJ sections.

**Content-driven gaps**: For PASM and DAT data columns, column positions are computed dynamically from actual content widths with 1×`indentSize` gaps between columns and 2×`indentSize` before trailing comments.

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

- **Data-only DAT sections** (no ORG regions): Labels are indented to the first grid stop (e.g., col 2 with `indentSize=2`).
- **DAT sections containing PASM** (has ORG regions): Labels stay at column 0.

**Column alignment (non-elastic — content-driven):**
- Type column: 1×`indentSize` past longest label.
- Value column: 1×`indentSize` past longest type keyword.
- Trailing comments: 2×`indentSize` past widest content.

**Column alignment (elastic — tabstop-snapped):**
- Type column: snapped to next tabstop after (label indent + longest label width).
- Value column: snapped to next tabstop after (type column + max type width).
- Trailing comments: snapped per profile.

**Parsing**: After stripping whitespace, if the first token is NOT a type keyword (`byte`/`word`/`long`), it is treated as a label. Then the type keyword is expected.

**Example — data-only DAT** (indentSize=2):
```spin2
DAT
  s_Help  BYTE  13
          BYTE  "text", 13
          BYTE  0
```

### 2.5 DAT Section — PASM Lines (ORG Regions)

**Lines**: `label  condition  mnemonic  operands  effects  comment` (6 columns)

- **Each ORG...END region is an independent alignment scope.**
- Labels at column 0.

**Non-elastic — content-driven column layout:**
- Condition column: 1×`indentSize` past longest label.
- Mnemonic column: 1×`indentSize` past longest condition (or past label column if no conditions).
- Operand column: 1×`indentSize` past longest mnemonic.
- Effects column: 1×`indentSize` past longest operand.
- Comment column: 2×`indentSize` past longest effect (or operand if no effects).

**Elastic — tabstop-snapped column layout:**
- Condition column: snapped to `tabStops[0]` (or next stop past longest label).
- Mnemonic column: snapped to `tabStops[1]` (or next stop past longest condition).
- Operand/effects/comment columns: snapped to successive tabstops.

**Data lines within ORG regions**: Handled as PASM lines (type keyword appears in the mnemonic slot).

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

**Futures — documentation style awareness:**
- The formatter currently treats all comment groups after PUB/PRI as documentation (removes blank lines between declaration and first comment, enforces blank line before first code). It does not distinguish between documentation comments and commented-out code in this zone.
- A future enhancement could recognize the two documentation styles used in the Spin2 community:
  - **VSCode style**: `@param name description`, `@returns name description` — structured, extractable to interface docs
  - **Traditional style**: Free-form `''`/`'` description with `--` parameter notes — informal, human-readable
- With style awareness, the formatter could make smarter decisions: detect when no documentation is present (only commented-out code after PUB/PRI) and preserve/insert a blank line before it instead of pulling it tight to the declaration.

---

## 3. Elastic Tabstops Mode

When `spinExtension.elasticTabstops.enable` is true, the formatter reads per-section tabstop arrays from the user's configuration:

```
spinExtension.elasticTabstops.blocks.<choice>.<section>.tabStops
```

where `<choice>` is the selected tabstop profile (default `"PropellerTool"`) and `<section>` is `con`, `var`, `obj`, `pub`, `pri`, or `dat`.

If a section's tabstop array is not configured, it falls back to the PropellerTool defaults.

### 3.1 Key Differences from Spaces Mode

| Aspect | Spaces mode | Elastic mode |
|--------|-------------|--------------|
| Column positions | Content-driven with `indentSize` gaps | Profile-defined tabstop arrays |
| Comment alignment | 2×`indentSize` past widest code | Snapped to profile comment column |
| Tab characters | Compressed at 8-column boundaries | Pure spaces (no tabs) |
| PASM columns | Dynamic per content widths | Fixed per profile tabstops |

### 3.2 What Does NOT Change

**Method indentation** (`indentSize × level`) does **not** use the tabstop array in either mode. PUB/PRI nesting levels are always expressed as fixed multiples of `indentSize`. The tabstop array is only used for trailing comment alignment and column snapping within methods.

### 3.3 Per-Section Tabstop Selection

```typescript
// Always use elasticConfig.tabStops — contains profile stops (elastic)
// or regular indentSize grid (non-elastic)
tabStops = elasticConfig.tabStops['con'] || DEFAULT_TABSTOPS.con
```

### 3.4 Tabstop Array Conventions (Elastic Only)

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
| `formatter.indentSize` | number | `2` | Spaces per indent level and column gap (1–8) |
| `formatter.blockNameCase` | enum | `"uppercase"` | Section keyword case (CON, VAR, etc.) |
| `formatter.controlFlowCase` | enum | `"preserve"` | Control flow keyword case |
| `formatter.methodCase` | enum | `"preserve"` | Method name case |
| `formatter.typeCase` | enum | `"uppercase"` | Type keyword case (BYTE, WORD, LONG) |
| `formatter.constantCase` | enum | `"uppercase"` | Constant name case |
| `formatter.pasmInstructionCase` | enum | `"preserve"` | PASM mnemonic case |
| `formatter.spaceAfterCommentStart` | boolean | `true` | Space after `'` / `''` |

All settings are prefixed with `spinExtension.` (e.g., `spinExtension.formatter.enable`).

**Removed settings** (v2.9.2): `tabsToSpaces` and `tabWidth` — tab characters are now always 8 columns wide. Use `indentSize` to control column spacing.

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

### D.11 Mixed tab/space indent within a method changes nesting (`isp_hub75_display_bmp`)

**Binary-breaking.** When a method mixes tab-indented lines (tab=8 columns) and space-indented lines (4 spaces) for the same nesting level, the stack-based indent normalizer incorrectly assigns different levels. After tab-to-space expansion, the indents become 8 and 4 — both representing level 1, but the stack treats 4 as level 2 because it can't pop below the base.

Example: `get24BitBMPColorForRC` method had `\tif(...)` (→ indent 8) followed later by `    pixColorAddr := ...` (indent 4). Both are level 1 in the method body. The normalizer set `if` to col 2 (correct) but `pixColorAddr` to col 4 (wrong — moved it inside the `if` block).

Root cause: `while (indentStack.length > 1 && ...)` prevented popping below the base. When indent < base, the new indent was pushed ON TOP, creating a false deeper level: `stack=[8,4], level=2`.

The fix: when the stack has popped to length 1 (the base) and the current indent is less than the base, **update the base** (`indentStack[0] = indent`) instead of pushing. This recognizes that both indent values represent the same logical nesting level — the user simply used different whitespace conventions in different parts of the method.

Discovered via binary audit of `TEST-FORMATTER/p2-HUB75-LED-Matrix-Driver/` — 1 byte changed at offset 0x1A4D, traced by per-method isolation to `get24BitBMPColorForRC`.

### D.12 PASM label-vs-mnemonic detection requires known instruction set

**Not binary-breaking (alignment only).** Without a known PASM instruction set, `parsePasmLine` cannot distinguish labels from mnemonics when the second token is an instruction like `OR`, `AND`, `MOV`. The line `dirInst1of2 OR DIRA, maskAllPins` was parsed as mnemonic=`dirInst1of2` operands=`OR DIRA, maskAllPins` — putting the label at the mnemonic column instead of column 0.

The fix: add the full P2 PASM instruction set (`P2_PASM_MNEMONICS`, 362 entries from `spin2.utils.ts`) and check `afterFirstStartsWithMnemonic()` in the label extraction heuristic. If the token after the first word is a known instruction, the first word is a label.

Also fixes standalone no-operand instructions (`stalli`, `nop`, `ret`, etc.) being misidentified as labels when they appear alone on a line.

### D.13 `debug()` calls in PASM inflate column widths

**Not binary-breaking (alignment only).** `parsePasmLine` splits mnemonic from operands at the first whitespace. For `debug("MTX:     --Start--")`, whitespace inside the string causes `debug("MTX:` to become a 12-character "mnemonic", pushing `maxMnemWidth` and all operand columns far right.

The fix: detect `debug(` and parse with balanced parentheses (tracking strings and backtick expressions) to keep the entire `debug(...)` as a single mnemonic token. Exclude debug calls from `maxMnemWidth` calculation.

### D.14 DAT data declarations and PASM instructions need separate column alignment

**Not binary-breaking (alignment only).** Data declarations (`maskQtrRowsModulus LONG 0`) can have very long labels that pushed the mnemonic column out for ALL lines in an ORG region, including short PASM instructions. The fix: classify lines as data (type keyword as mnemonic) or instruction, compute separate column positions (`dataMnemCol` driven by data label widths, `instrMnemCol` driven by condition widths only), and apply per-line.

### D.15 Full-line comment alignment in PASM regions must handle parser's comment grouping

**Not binary-breaking (alignment only).** The real parser records consecutive `'` comment lines (2+) as "block comments" via `recordComment()`. The formatter's `isLineInBlockComment()` check skipped these, leaving grouped comments unaligned. Single-line comments were aligned correctly but multi-line comment groups were not.

The fix: use `findings.isLineInBlockComment(i) && !trimmed.startsWith("'")` — allow `'`-prefixed lines through even when the parser reports them as block comments. This matches the pattern already used in the method formatter (`spin2.formatter.method.ts` line 266).
