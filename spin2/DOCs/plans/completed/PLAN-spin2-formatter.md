# Spin2 Document Formatter — Feasibility & Implementation Plan

## Context

Add a code formatter to the Spin2 VS Code extension, similar to Prettier. The formatter must handle Spin2's indentation-sensitive syntax (indentation defines block scope, like Python), use `...` line continuation for line-length management, and apply section-specific alignment rules for CON, VAR, OBJ, DAT, and PUB/PRI sections.

## Feasibility: YES

The extension is well-positioned for this:
1. **Provider scaffold exists** — `DocumentFormattingProvider` is commented out in `server/src/providers/index.ts` (lines 11, 33)
2. **Clean provider pattern** — All providers implement `Provider` interface; adding one more is straightforward
3. **Rich parse data available** — `DocumentFindings` provides `blockSpans()`, `isLineInPasmCode()`, `pasmCodeSpans`, `continuedLineSpans` — all the structure a formatter needs
4. **No re-parsing needed** — Formatter consumes already-parsed findings from `ctx.docsByFSpec`
5. **No conflict with elastic tabstops** — Client-side tab formatter uses commands; server-side formatter uses LSP protocol; they're independent channels
6. **Line continuation infrastructure** — `ContinuedLines` class already handles `...` join/split logic

## Core Requirement: Elastic Tabstop Integration

When the user has elastic tabstops enabled (`spinExtension.elasticTabstops.enable`), the formatter **must** use the section-specific elastic tabstop positions as its alignment grid. This is not a secondary feature — it is a primary formatting mode. Every section formatter (CON, VAR, OBJ, DAT, PASM, PUB/PRI) must read the active tabstop profile for its section type and snap columns to those positions.

Specifically:
- **Indentation in PUB/PRI**: Each nesting level maps to the next tabstop position from the section's profile (e.g., PUB stops `[2, 4, 6, 8, ...]` → level 1 at column 2, level 2 at column 4, etc.), rather than using a fixed `indentSize` multiple.
- **Column alignment in tabular sections** (CON, VAR, OBJ, DAT, PASM): Tokens are snapped to the section's elastic tabstop columns, maintaining at least 2 spaces between adjacent columns.
- **Trailing comment alignment**: The comment column is derived from the section's tabstop profile (second-to-last stop), not a fixed setting.
- **When elastic tabstops are disabled**: The formatter falls back to fixed `indentSize` multiples and the configured `trailingCommentColumn`.

The elastic tabstop positions are read from `spinExtension.elasticTabstops.blocks.*` (e.g., `con`, `var`, `pub`, `dat`, etc.). Each section type has its own stop array. The formatter must integrate with these in every phase, not as an afterthought.

### Per-Block Tabstop-to-Column Mapping

The elastic tabstop arrays are flat lists of column positions. The formatter does **not** assign fixed semantic roles to specific tabstop positions. Instead, it knows the **token order** for each section type and snaps each successive token to the **next available tabstop** after the previous token ends (maintaining a minimum 2-space gap). The grid provides candidate positions; the content determines which positions get used.

**Default PropellerTool tabstop arrays and token order:**

| Block | Stops | Token order (left to right) |
|-------|-------|-----------------------------|
| CON | `[2, 8, 16, 18, 32, 56, 78, 80]` | name, `=`, value, comment; last stop = line-width |
| VAR | `[2, 8, 22, 32, 56, 80]` | type (BYTE/WORD/LONG), name, `[count]`, comment; last stop = line-width |
| OBJ | `[2, 8, 16, 18, 32, 56, 80]` | name, `:`, `"filename"`, comment; last stop = line-width |
| PUB/PRI | `[2, 4, 6, 8, 10, 12, 14, 16, 32, 56, 80]` | nesting levels 1-8, then code content, comment; last stop = line-width |
| DAT (data) | `[8, 14, 24, 32, 48, 56, 80]` | label, type (LONG/WORD/BYTE), value, comment; last stop = line-width |
| DAT (PASM) | `[8, 14, 24, 32, 48, 56, 80]` | label, condition (`if_*`/`_ret_`), mnemonic, operands, effects (`wc`/`wz`/`wcz`), comment; last stop = line-width |

**How token-to-tabstop snapping works:**

Each token snaps to the next tabstop that provides at least a 2-space gap after the preceding token ends. Tokens do **not** have fixed column assignments — they float to wherever the grid places them based on the actual content width. For example, in DAT/PASM with stops `[0, 8, 14, 24, 32, 48, 56, 80]`:

- Short operands ending at col 28 → effects snap to **32**
- Longer operands ending at col 31 → effects snap to **48** (32 wouldn't give 2-space gap)
- Operands ending at col 47 → effects snap to **56**, displacing the comment further right

**Confirmed conventions:**
- The **last stop** in every array (typically 80) is the line-width boundary, not a content column.
- The **second-to-last stop** is the default trailing comment column for that section.
- **Label at column 0**: In DAT/PASM, labels are ground to the left edge (column 0), which is before the first tabstop. All other tokens start at or after the first tabstop.

**DAT/PASM token order (6 content columns):**

```
Col 0       Col 1       Col 2       Col 3       Col 4       Col 5       Col 6
LABEL       CONDITION   MNEMONIC    OPERANDS    EFFECTS     COMMENT
(col 0)     (if_*, _ret_)           (src, dst)  (wc,wz,wcz) (' text)
```

Both DAT data lines and PASM instruction lines share the same tabstop array. The parser's `isLineInPasmCode()` determines which token order applies. DAT data lines use: label, type, value, comment (4 columns). PASM lines use all 6 columns.

### Per-Block Vertical Alignment Strategy

The formatter's primary alignment goal is **vertical consistency within each block** — not rigid per-line grid snapping. Within a single alignment scope, all effects should line up at the same column, and all trailing comments should line up at the same column.

**Two-pass alignment:**

1. **Measure pass**: Walk all lines in the alignment scope. For each logical column (effects, comments), compute the maximum extent of the preceding column across all lines. This determines where the column *must* start (the "worst case" line drives the position).

2. **Apply pass**: Snap that worst-case position to the next tabstop. Use that **single column position** for all lines in the scope. Lines with shorter preceding content get extra whitespace — that's the desired outcome, producing clean vertical alignment.

**Alignment scopes** (each scope aligns independently):

| Scope | What aligns within it |
|-------|----------------------|
| CON section | `=` signs, values, trailing comments |
| VAR section | type/name/count columns, trailing comments |
| OBJ section | `:` and filenames, trailing comments |
| DAT section (outside ORG) | label/type/value columns, trailing comments |
| **Each ORG...END region** | effects column, trailing comments — independently from other ORG regions and surrounding DAT lines |
| Each PUB/PRI method body | trailing comments |
| **Inline PASM (ORG...END in PUB/PRI)** | effects column, trailing comments — independently from the enclosing method's Spin2 code |

Different ORG regions within the same DAT section are separate alignment scopes. One region may have short operands (effects at col 32, comments at col 56) while another has long operands (effects at col 48, comments at col 56). Forcing them to share would waste space.

**What does NOT participate in column alignment:**
- **Whole-line comments at column 0** — file headers, section banners, dividers. Never touched.
- **Indented whole-line comments** (e.g., `' comment` inside a method body) — these follow the surrounding code's indentation level, but are not aligned to the trailing comment column.

### Resolved Design Decisions

1. **CON section enum groups**: Enum members (e.g., `#0, STATE_IDLE, STATE_RUN, STATE_STOP`) do NOT align to tabstops. They flow horizontally with exactly one space after each comma. A trailing comma on a line auto-continues to the next line (no `...` needed — this is a CON-specific language feature). Trailing comments on enum lines align to the right-edge comment column like any other line. The formatter normalizes inter-member whitespace to single-space-after-comma but does not apply column alignment to enum members. Multi-line documentation comments before enum groups (one row per value) are preserved.

2. **PUB/PRI mid-line content**: All 8 nesting stops (`[2, 4, 6, 8, 10, 12, 14, 16]`) are for control flow indentation only — `repeat`, `if`, `case`, etc. each add one nesting level. Code within a nesting level is free-form (not column-aligned). The stops at 32 and 56 are only reachable by trailing comments. The formatter never snaps code content to stops beyond the nesting level.

3. **debug() comment disambiguation**: The formatter needs a lightweight paren-matching parser for `debug()` lines. The rightmost `)` on the line is the end of the debug() call; anything after it is a trailing comment. The formatter does not need to understand the internal debug syntax (backtick display specs, format specifiers, etc.) — only to find the closing paren to locate the comment boundary.

4. **Inline PASM label indentation**: Inside inline PASM (`ORG...END` within a PUB/PRI method), the `ORG` and `END` keywords sit at the method's current indent level. Everything between them — labels, conditions, mnemonics, operands, effects, comments — drops to **column 0** (left edge), identical to DAT-section PASM. The enclosing method's indent level is irrelevant inside the ORG...END block. This is necessary because there are not enough tabstops to accommodate both method nesting and PASM column structure.

5. **Multi-line block comments are untouchable**: Once a block comment opens (`{` or `{{`), the formatter ignores everything until the matching close (`}` or `}}`). The interior is entirely user-formatted. The formatter does not re-indent, re-wrap, or modify any content inside block comments. This applies regardless of where the block comment appears (CON, VAR, DAT, PUB/PRI, etc.).

6. **CASE / CASE_FAST indentation structure**: Three indent levels — `case` keyword at level N, match values at level N+1, code under each match at level N+2. The next match value returns to level N+1. Example:
   ```spin2
     case x                     ' level N
       0:                       ' level N+1 (match value)
         doSomething()          ' level N+2 (match body)
       1, 2:                    ' level N+1 (next match)
         doOther()              ' level N+2
       other:                   ' level N+1
         doDefault()            ' level N+2
   ```

7. **LOOKUPZ / LOOKUP / LOOKDOWNZ / LOOKDOWN tables**: Comma-separated values follow the same flow rule as CON enum members — single space after each comma, no tabstop alignment. Values flow horizontally and wrap to the next line naturally.

8. **Spin1 formatter**: Not in scope. This formatter targets Spin2 (`.spin2` files) only. Spin1 (`.spin` files) may be addressed in a future project.

9. **Format triggers**: Only `formatOnSave` is implemented in the initial release. `formatOnType` and `formatOnPaste` are deferred (see General Controls).

## Architecture

### Server-Side LSP Provider

The formatter lives on the server side as `DocumentFormattingProvider`, following the same pattern as `HoverProvider`, `DefinitionProvider`, etc.

**Data flow:**
```
User triggers "Format Document" / format-on-save
  → VS Code sends textDocument/formatting to server
  → DocumentFormattingProvider.handleFormatDocument()
  → Retrieves ProcessedDocument from ctx.docsByFSpec
  → Reads DocumentFindings (blockSpans, pasmCodeSpans, etc.)
  → Section dispatcher routes each line group to the appropriate section formatter
  → Returns TextEdit[] (only for changed lines)
```

### Section Dispatcher

The formatter iterates lines and dispatches to per-section formatters based on `blockSpans()`:

| Block Type | Formatter | Safety Tier |
|-----------|-----------|-------------|
| CON | ConFormatter | ALIGN — columns only |
| VAR | VarFormatter | ALIGN — columns only |
| OBJ | ObjFormatter | ALIGN — columns only |
| DAT (data) | DatDataFormatter | ALIGN — columns only |
| DAT (PASM) | PasmFormatter | ALIGN — columns only |
| PUB/PRI (code) | MethodFormatter | INDENT-AWARE — preserves logical nesting, may adjust indent width |
| PUB/PRI (inline PASM) | PasmFormatter | ALIGN — columns only |
| Comments | CommentFormatter | SAFE — whitespace only |

### Indentation Safety Model

**CRITICAL INVARIANT**: The formatter preserves the **structural indentation level** — the logical nesting depth of each line relative to its enclosing block. This is the entire goal of the formatter's indentation handling. Indentation is semantic in Spin2 — it defines block scope, like Python. Changing a line's nesting level changes program behavior.

The formatter **does NOT preserve the exact amount of leading whitespace**. It owns the whitespace and re-expresses each nesting level at the correct column position (determined by `indentSize` or, when elastic tabstops are active, by the section's tab stop profile).

The distinction:
- **Structural indentation level** (PRESERVED): A line nested 3 levels deep under `PUB → repeat → if` stays at level 3. This is semantic.
- **Leading whitespace amount** (NORMALIZED): The exact number of spaces/tabs used for that level 3 indentation is the formatter's decision. It may change from 6 spaces (3 × 2) to 12 spaces (3 × 4) during an indent width conversion, or snap to a tab stop column. This is cosmetic.

The formatter must:

1. **Preserve structural nesting** — The nesting depth of each line relative to its enclosing line/block must never change. A line at indent level 3 stays at level 3.
2. **Allow indent width conversion** — Switching between 2-space and 4-space indentation is supported. The formatter reads the current indent, determines the logical level, and re-expresses it at the target `indentSize`. E.g., a line at 6 spaces (3 levels × 2) becomes 12 spaces (3 levels × 4) when switching from 2 to 4.
3. **Fix incorrect indentation** — Lines that are misindented (not a clean multiple of the current indent size, or at the wrong nesting level for their context) are corrected to the proper indent level based on the surrounding block structure.
4. **Snap to elastic tab stops** — When elastic tabstops are active, each nesting level maps to a tab stop column from the section's profile, rather than a fixed `indentSize` multiple.

The formatter relies on the parser's knowledge of block structure (`blockSpans`, control flow nesting) to determine the correct structural indent level for each line.

## Proposed Formatter Controls

### General Controls

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `spinExtension.formatter.enable` | boolean | `false` | Master enable/disable for the formatter |
| `spinExtension.formatter.formatOnSave` | boolean | `false` | Automatically format the document when saving |

**Deferred triggers (not in initial release):**
- `formatOnType` — Deferred. Spin2's indentation is semantic; formatting incomplete code while typing risks fighting the user. VS Code's built-in `indentationRules` handles basic auto-indent.
- `formatOnPaste` — Deferred. Requires computing nesting context at the paste point and re-indenting the pasted block's internal structure. Complex to get right, lower priority than whole-document formatting.

### Line Length & Wrapping

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `spinExtension.formatter.maxLineLength` | number | `100` | Maximum line length before wrapping with `...` continuation |
| `spinExtension.formatter.wrapLongLines` | boolean | `false` | Enable automatic wrapping of long lines using `...` |
| `spinExtension.formatter.continuationIndent` | number | `4` | Extra indent (in spaces) for `...` continuation lines |

### Whitespace & Blank Lines

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `spinExtension.formatter.trimTrailingWhitespace` | boolean | `true` | Remove trailing whitespace from all lines |
| `spinExtension.formatter.insertFinalNewline` | boolean | `true` | Ensure file ends with exactly one newline |
| `spinExtension.formatter.maxConsecutiveBlankLines` | number | `1` | Maximum consecutive blank lines allowed (0 = remove all) |
| `spinExtension.formatter.blankLinesBetweenSections` | number | `1` | Number of blank lines between major sections (CON, VAR, etc.) |
| `spinExtension.formatter.blankLinesBetweenMethods` | number | `2` | Number of blank lines between PUB/PRI methods |

### Indentation & Tabs

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `spinExtension.formatter.indentSize` | enum | `2` | Spaces per indent level: `2`, `4`, or `8` |
| `spinExtension.formatter.normalizeIndentation` | boolean | `true` | Fix incorrect indentation and re-express at target `indentSize`. When `false`, leading whitespace is left untouched. |
| `spinExtension.formatter.tabsToSpaces` | boolean | `true` | Convert tab characters to spaces. When `false`, existing tabs are preserved as-is. |
| `spinExtension.formatter.tabWidth` | number | `8` | Width of a tab character (for display/alignment calculations when tabs are present) |

**Indentation notes:**
- `indentSize` accepts only 2, 4, or 8. This controls the indent step used in PUB/PRI method bodies and other indented contexts.
- `normalizeIndentation` is the master switch for indent adjustment. When enabled, the formatter determines each line's logical nesting level (using block structure from the parser) and re-expresses it at the target `indentSize`. This handles both switching between indent widths (e.g., 2→4) and fixing misindented lines. When disabled, leading whitespace is preserved exactly as-is.
- `tabsToSpaces` enables/disables tab-to-space conversion. When enabled, all tab characters are replaced with the equivalent number of spaces (using `tabWidth` for alignment). When disabled, tabs are left untouched.

### Section Column Alignment

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `spinExtension.formatter.alignConColumns` | boolean | `true` | Align `=` signs and values in CON sections |
| `spinExtension.formatter.alignVarColumns` | boolean | `true` | Align type/name/count columns in VAR sections |
| `spinExtension.formatter.alignObjColumns` | boolean | `true` | Align `:` and filenames in OBJ sections |
| `spinExtension.formatter.alignDatColumns` | boolean | `true` | Align label/type/value columns in DAT data lines |
| `spinExtension.formatter.alignPasmColumns` | boolean | `true` | Align label/instruction/operand/comment in PASM |
| `spinExtension.formatter.useElasticTabStops` | boolean | `true` | Use the elastic tabstop positions as alignment targets (when elastic tabstops are configured) |

### Elastic Tabstop Alignment Integration

When `useElasticTabStops` is `true` and elastic tabstops are configured (`spinExtension.elasticTabstops.enable`), the formatter uses the section-specific tab stop profiles as column alignment targets. This applies to **all section types** (CON, VAR, OBJ, DAT, PUB, PRI).

Each section type has its own tab stop array configured through `spinExtension.elasticTabstops.blocks.*` (e.g., `con`, `var`, `pub`, `dat`, etc.). The formatter reads the active tab stop profile for each section and snaps inter-token whitespace gaps to those positions.

**Indentation level vs. whitespace amount:**

The formatter distinguishes between *indentation level* (structural nesting) and *indentation width* (exact column position). The rules:

1. **Indentation level is preserved** — A line's nesting depth relative to its enclosing line/block is never changed. If a line is nested 2 levels under a `repeat` inside a `PUB` method, it stays at 2 levels of nesting.
2. **Indentation width is normalized** — The exact number of leading whitespace characters does not need to be preserved. The formatter re-expresses each nesting level using the tab stop positions for that section type. For example, in a PUB section with stops `[2, 4, 6, 8, ...]`, level 1 = column 2, level 2 = column 4, level 3 = column 6.
3. **Groups of lines** — For a group of lines under a common enclosing line (e.g., the body of a `repeat` block), all lines in the group share the same base indentation level from their enclosing line. Each line's own nesting depth within that group is then expressed relative to that base.

**Inter-token column alignment:**

After the leading indentation, whitespace gaps between tokens are snapped to the nearest elastic tab stop column:

- In **columnar sections** (CON, VAR, OBJ, DAT), each logical column of data (e.g., label / instruction / operand / comment in DAT) aligns to a tab stop from the section's profile.
- In **PUB/PRI method bodies**, inter-token alignment primarily affects trailing comment placement. Code within expressions is not column-aligned (operator spacing is governed by the separate operator/keyword spacing settings).

**Double-space boundary convention:**

The elastic tabstop system uses 2+ consecutive spaces as the delimiter between columns. When snapping tokens to tab stop positions, the formatter guarantees at least 2 spaces between adjacent token columns. If a token is too long and would leave fewer than 2 spaces before the next tab stop, the formatter skips to the following tab stop.

**Trailing comment alignment:**

The left edge of a trailing comment (`'` character) snaps to a tab stop from the section's profile. Since each section type has its own tab stops, trailing comments naturally align to section-appropriate columns. This integrates with the trailing comment alignment strategy described below — when elastic tabstops are active, the `trailingCommentColumn` is derived from the section's tab stop profile rather than being a fixed value.

**Example — DAT section with stops `[0, 8, 16, 18, 24, 32, 40, 48, 56]`:**

```spin2
' Before (irregular spacing):
DAT
mylabel   mov   x, #5        ' set x
foo    add    y,  #10   ' increment y
bar        nop                   ' wait

' After (snapped to DAT tab stops):
DAT
mylabel mov     x, #5                           ' set x
foo     add     y, #10                          ' increment y
bar     nop                                     ' wait
```

**Example — PUB section with stops `[2, 4, 6, 8, 10, 12, 14, 16, 32, 56, 80]`:**

```spin2
' Before (inconsistent indentation, same nesting structure):
PUB go() | i
   repeat i from 0 to 10       ' count up
       if i > 5        ' check threshold
         doSomething(i)    ' act on it

' After (indentation normalized to tab stops, nesting levels preserved):
PUB go() | i
  repeat i from 0 to 10                                ' count up
    if i > 5                                            ' check threshold
      doSomething(i)                                    ' act on it
```

In the PUB example, the nesting structure (1 level for `repeat`, 2 for `if`, 3 for `doSomething`) is unchanged, but the indentation width is normalized to the tab stop positions (2, 4, 6). Trailing comments snap to column 56.

### Operator & Keyword Spacing (PUB/PRI methods)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `spinExtension.formatter.spaceAroundOperators` | boolean | `false` | Ensure spaces around `:=`, `==`, `+`, `-`, etc. |
| `spinExtension.formatter.spaceAfterComma` | boolean | `true` | Ensure a space after commas in parameter lists |
| `spinExtension.formatter.spaceInsideParens` | boolean | `false` | Add spaces inside parentheses: `( x, y )` vs `(x, y)` |
| `spinExtension.formatter.spaceAfterCommentStart` | boolean | `true` | Ensure a space after comment opener (`'`, `''`, `{`, `{{`): `' text` vs `'text` |

### Comment Formatting

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `spinExtension.formatter.alignTrailingComments` | boolean | `true` | Align trailing `'` comments to a common column (see alignment strategy below) |
| `spinExtension.formatter.trailingCommentColumn` | number | `56` | Target column for the `'` comment start character. Used as the preferred alignment column when code lines are short enough. When elastic tabstops are active, this is auto-derived from the second-to-last tab stop. |
| `spinExtension.formatter.trailingCommentMinSpaces` | number | `2` | Minimum spaces between end of code and start of trailing comment (overrides `trailingCommentColumn` if code extends past it) |
| `spinExtension.formatter.wrapLongTrailingComments` | boolean | `true` | Wrap end-of-line comments that exceed `maxCodeLineLength` onto the next line, with the `'` vertically aligned |

**Block comment policy:** Multi-line block comments (`{ }` and `{{ }}`) are **never modified**. Once the formatter sees an opening `{` or `{{`, it skips all content until the matching close. The interior is entirely user-formatted. There is no `wrapBlockComments` setting.

**Trailing comment alignment strategy:**

When `alignTrailingComments` is enabled, the formatter applies a cascading alignment strategy:

1. **Column source — elastic tabstops integration:** When elastic tabstops are enabled (`spinExtension.elasticTabstops.enable`), the `trailingCommentColumn` default is overridden by the **second-to-last tab stop** from the active tab set. In the tab stop arrays, the last stop is the line width boundary (e.g., 80) and the second-to-last is the comment column. For example, the PropellerTool PUB stops `[2, 4, 6, 8, 10, 12, 14, 16, 32, 56, 80]` → trailing comment column = 56 (second-to-last), line width = 80 (last). Since each section type (CON, VAR, PUB, DAT, etc.) has its own tab stops, per-block alignment naturally inherits the section-specific comment column. If elastic tabstops are disabled, `trailingCommentColumn` (default 56) is used directly.

2. **Document-wide alignment (preferred):** Scan all blocks (PUB, PRI, DAT, CON, VAR, OBJ) for trailing comments. If a single column works for the entire document — meaning no code line extends past the target column minus `trailingCommentMinSpaces` — align all trailing comments to that column.

3. **Per-block alignment (fallback):** If some blocks have longer code lines that prevent a single document-wide column, the formatter falls back to aligning comments consistently *within each block*. Each PUB, PRI, or DAT block independently chooses the smallest column that satisfies `trailingCommentMinSpaces` for all its lines with trailing comments. When elastic tabstops are active, each block's target column comes from its own section's rightmost tab stop.

4. **Minimum gap guarantee:** Regardless of the chosen column, every trailing comment is guaranteed at least `trailingCommentMinSpaces` spaces between the end of code and the `'` character. If a code line is too long even for the per-block column, that line's comment shifts right to maintain the minimum gap.

**Example — document-wide alignment at column 60:**
```spin2
PUB start()
    pinlow(PIN_LED)                                         ' turn off LED
    waitms(500)                                             ' half-second delay
    pinhigh(PIN_LED)                                        ' turn on LED

DAT
testDir1    long    0                                       ' direction register
testStep1   long    1                                       ' step size
```

**Example — per-block fallback when one block has long lines:**
```spin2
PUB start()
    pinlow(PIN_LED)                         ' turn off LED
    waitms(500)                             ' half-second delay

PUB processData(pBuffer, bufferSize, outputMode, flags)
    longfill(pBuffer, 0, bufferSize)                        ' clear the buffer
    some_long_call(pBuffer, bufferSize, outputMode, flags)  ' process it
```

**Spin2 comment styles (4 types):**

| Syntax | Type | Scope | Description |
|--------|------|-------|-------------|
| `' ...` | Line comment | Single line | Non-doc comment to end of line |
| `'' ...` | Doc line comment | Single line | Documentation comment to end of line |
| `{ ... }` | Block comment | Single or multi-line | Non-doc block; open and close can span multiple lines |
| `{{ ... }}` | Doc block comment | Single or multi-line | Documentation block; open and close can span multiple lines |

**Left-edge comment preservation:**
- Comments that start at column 0 (the left edge of the line) are NEVER reformatted — neither single-line (`'`, `''`) nor block (`{ }`, `{{ }}`). These are typically file headers, section banners, or intentionally flush-left annotations. The formatter skips them entirely.

**Comment wrapping rules:**
- Comments NEVER use `...` line-continuation. Line-continuation is for code only.
- When an end-of-line comment (`'` or `''`) causes the line to exceed `maxCodeLineLength`, the comment text spills onto the next line.
- The spill-over line's comment character (`'` or `''`) is vertically aligned with the one on the original line, maintaining a clean column edge.
- Example:
  ```
    pinlow(PIN_LED)                         ' turn off the LED so we
                                            ' know we are done
  ```
- Multi-line block comments (`{ }` and `{{ }}`) are **never modified** by the formatter. Once a block comment opens, everything until the matching close is skipped entirely. The interior is user-formatted content.
- This keeps code compact while letting comments breathe without breaking the code's `...` continuation semantics.

### Case Normalization

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `spinExtension.formatter.keywordCase` | enum | `"lowercase"` | Normalize Spin keywords and symbols: `"uppercase"`, `"lowercase"`, `"preserve"` |
| `spinExtension.formatter.pasmInstructionCase` | enum | `"preserve"` | Normalize PASM mnemonics: `"uppercase"`, `"lowercase"`, `"preserve"` |
| `spinExtension.formatter.constantCase` | enum | `"uppercase"` | Normalize user-defined constant names (CON values, enum members, IO pin names): `"uppercase"`, `"lowercase"`, `"preserve"` |

### Style Convention Rules

These encode common Spin2 coding conventions. Each can be individually enabled.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `spinExtension.formatter.maxCodeLineLength` | number | `100` | Maximum length for code lines (including end-of-line comments); lines exceeding this trigger wrapping or a warning |
| `spinExtension.formatter.enforceConstantNaming` | boolean | `true` | Enforce UPPER_SNAKE_CASE for user constant names (CON values, enum members, IO pin names). Underscores separate words. |

**Style convention notes:**
- "Code (with end-of-line comments) shall not exceed 100 characters per line" — This is captured by `maxCodeLineLength` (defaults to 100). This is distinct from `maxLineLength` (120) which governs when `...` continuation wrapping kicks in. The `maxCodeLineLength` is a stricter target for authored code; `maxLineLength` is the hard wrap boundary.
- "Block indentation is with two spaces" — Already captured by `indentSize` (default 2) in Indentation & Tabs.
- "Spin keywords and symbols will always use lowercase" — `keywordCase` default changed from `"preserve"` to `"lowercase"`.
- "Constants will always be uppercase" — New `constantCase` setting defaults to `"uppercase"`.
- "User constant names use UPPER_SNAKE_CASE with underscore between words. IO pin names are considered constants." — `enforceConstantNaming` validates/transforms the naming pattern, and `constantCase` handles the casing. IO pin names are treated as constants for both settings.

## Phased Implementation

### Phase 1: Provider Skeleton + Safe Formatting (MVP)
- Create `server/src/providers/DocumentFormattingProvider.ts`
- Uncomment and fix import in `server/src/providers/index.ts`
- Add configuration settings to `package.json`
- Implement: trailing whitespace trimming, blank line normalization, final newline
- Implement: format-on-save integration
- Read elastic tabstop configuration and expose it to the formatter pipeline (so all subsequent phases can use it)
- **Verifiable**: Format a file, confirm only whitespace changes, build still passes

### Phase 2: Tabular Section Alignment (CON, VAR, OBJ)
- Create `server/src/formatter/` directory with section formatters
- Build shared elastic tabstop column-snapping utility in `spin2.formatter.base.ts` (used by all section formatters)
- CON: align `=` and values for named constants; enum groups (`#N, MEMBER, MEMBER, ...`) normalize to single-space-after-comma flow (no column alignment); snap named constant columns to CON elastic tabstops when enabled
- VAR: align BYTE/WORD/LONG, name, `[count]` columns; snap to VAR elastic tabstops when enabled
- OBJ: align `:` and `"filename"` columns; snap to OBJ elastic tabstops when enabled
- Fall back to content-based alignment when elastic tabstops are disabled

### Phase 3: DAT & PASM Alignment
- DAT data: align label, type, value, comment (4-column); snap to DAT elastic tabstops when enabled
- PASM: align label, condition, mnemonic, operands, effects, comment (6-column); snap to DAT elastic tabstops when enabled
- Each ORG...END region is an independent alignment scope — measure pass determines the effects column and comment column for that region only
- Use `isLineInPasmCode()` to distinguish data vs PASM within DAT

### Phase 4: PUB/PRI Conservative Formatting
- Method signature normalization
- Indentation normalization: when elastic tabstops are enabled, map each nesting level to the PUB/PRI section's tabstop positions instead of fixed `indentSize` multiples
- Operator spacing (within content, never touching indentation)
- Trailing comment alignment within method bodies; use section tabstop profile for comment column when enabled
- Inline PASM delegation to Phase 3 formatter

### Phase 5: Line Length Enforcement & debug() Wrapping
- Join existing `...` continuations using `ContinuedLines` class
- Re-split at `maxLineLength` with smart break-point selection
- Never split inside strings
- **debug() wrapping strategy**: If the `debug()` content starts with a backtick (widget/display spec like `` `scope ``, `` `bitmap ``, `` `term ``), do NOT wrap — the entire display specification is one semantic unit. If the `debug()` has comma-separated arguments (classic format like `debug(udec(x), uhex(y))`), wrap at comma boundaries only. Never split inside backtick format specifiers (`` `uhex_(...) ``), string literals, or parenthesized expressions within debug().

### Phase 6: Comment & Case Formatting
- Trailing comment column alignment across line groups; derive comment column from section tabstop profile (second-to-last stop) when elastic tabstops are enabled
- Keyword/PASM instruction case normalization
- Note: multi-line block comments (`{ }`, `{{ }}`) are never modified — see Resolved Design Decisions #5

## File Organization

```
server/src/
  providers/
    DocumentFormattingProvider.ts        (Phase 1)
  formatter/
    spin2.formatter.base.ts             (Phase 2: shared utilities)
    spin2.formatter.con.ts              (Phase 2)
    spin2.formatter.var.ts              (Phase 2)
    spin2.formatter.obj.ts              (Phase 2)
    spin2.formatter.dat.ts              (Phase 3)
    spin2.formatter.pasm.ts             (Phase 3)
    spin2.formatter.method.ts           (Phase 4)
    spin2.formatter.lineLength.ts       (Phase 5)
    spin2.formatter.comment.ts          (Phase 6)
```

## Key Existing Utilities to Reuse

- `DocumentFindings.blockSpans()` — section ranges and types
- `DocumentFindings.isLineInPasmCode()` — PASM vs data disambiguation
- `DocumentFindings.pasmCodeSpans` — inline PASM regions (ORG...END)
- `ContinuedLines` class (`spin.common.ts:312-622`) — `...` continuation join/split
- `charsInsetCount()` (`spin2.utils.ts:81`) — tab-aware indentation measurement
- `getRemainderWOutTrailingComment()` — strip trailing comments safely
- `removeQuotedStrings()` — mask strings for safe parsing
- Elastic tabstop positions from `spinExtension.elasticTabstops.blocks.*` — alignment targets

## Critical Files

- `server/src/providers/index.ts` — uncomment + fix provider registration
- `server/src/parser/spin.semantic.findings.ts` — blockSpans, pasmCodeSpans, continuedLineSpans
- `server/src/providers/HoverProvider.ts` — best pattern to follow for provider structure
- `server/src/parser/spin.common.ts` — ContinuedLines, SpinControlFlowTracker
- `package.json` — configuration settings declaration

## Testing Strategy

### Gold-Standard Binary Equivalence (Primary correctness guarantee)

Each test fixture is an **intentionally messy but compilable** `.spin2` file that targets a specific formatter adjustment. The file is compiled by PNut (the gold-standard Propeller 2 compiler on Windows) to produce a `.GOLD` binary that is checked into the repo. This creates a three-way verification:

**Test flow per fixture:**
```
messy.spin2  ──→  PNut (Windows)   ──→  messy.GOLD          (checked into repo)
                  PNut-TS (CI)     ──→  messy.bin            (assert == .GOLD)
             ──→  formatter        ──→  formatted.spin2
                  PNut-TS (CI)     ──→  formatted.bin        (assert == .GOLD)
             ──→  formatter again  ──→  reformatted.spin2    (assert == formatted.spin2)
```

**Five assertions per fixture:**
1. **PNut-TS matches PNut** — `messy.bin == messy.GOLD` (compiler parity)
2. **Formatter is cosmetic-only** — `formatted.bin == messy.GOLD` (no semantic damage)
3. **Formatter is correct** — `formatted.spin2 == messy.spin2.expected` (right adjustments made)
4. **Idempotent** — `reformatted.spin2 == formatted.spin2` (stable output)
5. **Comments preserved** — all comment text identical before and after formatting

The `.GOLD` files are the immovable reference. If anything disagrees with `.GOLD`, either the formatter broke something or PNut-TS has a divergence — and assertions 1 vs 2 distinguish which.

**Compiler availability:** PNut-TS v1.53.0 is installed in the devcontainer at `$HOME/.local/bin/pnut-ts`. PNut `.GOLD` files are produced on Windows by the extension author and checked in.

### Targeted Fixture Design (Functional proof per adjustment type)

Each fixture is intentionally messy in a **specific, documented way** so the test proves the formatter fires the correct adjustment. Fixtures must be self-contained (no OBJ dependencies) and compilable by both PNut and PNut-TS.

**Phase 1 — Safe whitespace adjustments:**

| Fixture | What's wrong in the input |
|---------|--------------------------|
| `ws-trailing.spin2` | Lines with trailing spaces/tabs |
| `ws-blank-lines.spin2` | Excessive consecutive blank lines between methods and sections |
| `ws-final-newline.spin2` | Missing final newline / extra trailing newlines |
| `ws-tabs-mixed.spin2` | Tab characters mixed with spaces for indentation |

**Phase 2 — Tabular section column alignment:**

| Fixture | What's wrong |
|---------|-------------|
| `align-con-equals.spin2` | CON block with `=` signs at random columns |
| `align-con-enums.spin2` | CON `#N` enum groups with ragged values |
| `align-var-columns.spin2` | VAR with type/name/count at inconsistent positions |
| `align-obj-columns.spin2` | OBJ with `:` and filenames at random columns |

**Phase 3 — DAT/PASM alignment:**

| Fixture | What's wrong |
|---------|-------------|
| `align-dat-data.spin2` | DAT data lines with ragged label/type/value/comment |
| `align-dat-pasm.spin2` | PASM instructions with inconsistent column alignment — labels, conditions, mnemonics, operands, effects, and comments all at wrong positions |
| `align-dat-pasm-effects.spin2` | PASM with effects (`wc`, `wz`, `wcz`) at inconsistent columns — must vertically align within each ORG region |
| `align-dat-pasm-comments.spin2` | PASM with trailing comments at random columns — must vertically align within each ORG region |
| `align-dat-multi-org.spin2` | DAT section with multiple ORG...END regions, each needing independent alignment |
| `align-dat-mixed.spin2` | DAT section mixing data declarations and PASM — both misaligned |

**Phase 4 — PUB/PRI indentation:**

| Fixture | What's wrong |
|---------|-------------|
| `indent-too-wide.spin2` | Correct nesting structure but at 4-space indent, target is 2 |
| `indent-too-narrow.spin2` | Correct nesting at 2-space, target is 4 |
| `indent-ragged.spin2` | Correct nesting but some lines off by 1-2 spaces |
| `indent-deep-nesting.spin2` | 5+ levels of repeat/if/case nesting, various indent errors |
| `indent-case-block.spin2` | CASE statement with multiple match values at wrong indent |
| `indent-inline-pasm.spin2` | PUB method with ORG...END inline PASM, indentation mixed up |

**Phase 5 — Line length / debug() wrapping:**

| Fixture | What's wrong / what it tests |
|---------|------------------------------|
| `wrap-long-lines.spin2` | Code lines exceeding maxLineLength, no `...` present |
| `wrap-existing-cont.spin2` | Existing `...` continuations at suboptimal break points |
| `debug-long-widget.spin2` | Long `debug()` widget declarations exceeding line length — formatter must wrap safely or leave alone |
| `debug-format-exprs.spin2` | Long backtick format expressions — must not break inside `` `uhex_(...) `` |
| `debug-string-interp.spin2` | Single-quoted strings inside debug that look like comment chars — must not treat `'` as comment |
| `debug-with-comments.spin2` | `debug()` lines with actual trailing `'` comments — must distinguish real comments from debug string content |
| `debug-continuation.spin2` | `debug()` that already uses or needs `...` continuation — must preserve valid break points |

**Phase 6 — Comments & case:**

| Fixture | What's wrong |
|---------|-------------|
| `comment-trailing-align.spin2` | Trailing comments at random columns within a block |
| `comment-col0-preserve.spin2` | Column-0 comments that must NOT be moved — verify preservation |
| `comment-block-wrap.spin2` | `{{ }}` block comments exceeding line length |
| `case-keywords.spin2` | Mixed-case Spin2 keywords (`REPEAT`, `If`, `CASE`) |
| `case-pasm-instr.spin2` | Mixed-case PASM mnemonics |

### Corpus Sweep (Safety net for real-world code)

In addition to targeted fixtures, the test runner sweeps the existing `.spin2` files in `TEST_LANG_SERVER/spin2/` (17 files currently compile with PNut-TS). These are real-world files that exercise diverse patterns. The sweep verifies:
- Binary equivalence (PNut-TS output unchanged after formatting)
- Idempotency (format twice → text-identical)
- Comment preservation (all comment text survives)

This catches unexpected interactions between formatter features on realistic code that the targeted fixtures might miss.

### What binary equivalence catches vs. does NOT catch

**Catches:**
- Structural indentation changes (nesting level altered → different control flow → different binary)
- Accidental token deletion or insertion
- String content corruption
- Incorrect `...` continuation handling (changes which lines are joined → may change semantics)

**Does NOT catch (covered by other assertions):**
- Cosmetic correctness → snapshot comparison (`formatted.spin2 == .expected`)
- Idempotency → format-twice comparison
- Comment preservation → dedicated comment text comparison (compiler strips comments)

### Test Infrastructure

```
server/src/test/
  formatter/
    formatter.gold-equiv.test.ts       — gold-standard binary equivalence runner
    formatter.corpus-sweep.test.ts     — real-world file sweep runner
    formatter.con.test.ts              — CON section unit tests
    formatter.var.test.ts              — VAR section unit tests
    formatter.dat.test.ts              — DAT section unit tests
    formatter.pasm.test.ts             — PASM section unit tests
    formatter.method.test.ts           — PUB/PRI method body unit tests
    formatter.elastic.test.ts          — elastic tabstop alignment unit tests
    formatter.comment.test.ts          — comment handling unit tests
    formatter.debug.test.ts            — debug() statement handling unit tests
    formatter.idempotency.test.ts      — idempotency test runner
    fixtures/
      phase1-whitespace/
        *.spin2                        — messy input files
        *.GOLD                         — PNut-compiled gold binaries
        *.spin2.expected               — expected formatted output
      phase2-tabular/
        ...
      phase3-dat-pasm/
        ...
      phase4-indent/
        ...
      phase5-wrapping/
        ...
      phase6-comments-case/
        ...
```

**npm scripts:**
- `test:formatter` — runs all formatter unit tests (fast, no compiler needed)
- `test:formatter:gold` — runs gold-standard binary equivalence tests (requires PNut-TS)
- `test:formatter:sweep` — runs corpus sweep on TEST_LANG_SERVER files (requires PNut-TS)

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Indentation corruption in PUB/PRI | Formatter preserves structural nesting level, not whitespace amount; binary equivalence testing proves correctness |
| Breaking existing `...` continuations | `wrapLongLines` off by default; uses proven ContinuedLines class; binary equivalence catches any semantic change |
| Conflict with elastic tabstops | Different activation channels (LSP vs commands); formatter consumes tab stop profiles as alignment targets |
| Comment corruption | Compiler strips comments so binary equivalence won't catch this; dedicated comment preservation tests cover it |
| Performance on large files | Uses pre-parsed findings, no re-parse; simple string ops per line |
| Formatter not idempotent | Idempotency tests run format twice and verify text-identical output |
