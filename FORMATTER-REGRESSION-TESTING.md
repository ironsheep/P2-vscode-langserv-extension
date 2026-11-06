# Spin2 Formatter — Regression Testing Theory of Operations

This document describes the regression testing strategy for the Spin2 source code formatter: what we test, how we test it, why we chose these methods, and how to add new tests.

---

## 1. The Core Problem

A source code formatter changes the text of a file without changing what the code does. If the formatter introduces even a subtle whitespace or keyword change that alters program semantics, the compiled binary changes — and the user's hardware behaves differently. This is catastrophic for embedded development where silent bugs can damage hardware or produce dangerous behavior.

The Spin2 language is whitespace-significant: indentation determines block nesting in PUB/PRI methods, and keyword case changes inside string literals alter the compiled output. The formatter must be **provably safe** — not just "looks right" but "compiles identically."

---

## 2. Testing Philosophy

Our regression testing rests on three principles:

### 2.1 Binary Equivalence Is the Only Truth

Text comparison ("does the formatted file look right?") is subjective and fragile. Binary comparison is absolute: compile the original file, compile the formatted file, and compare the resulting `.bin` byte-for-byte. If a single byte differs, the formatter changed program semantics.

This is why we chose **compile-and-compare** over text-based golden-file comparison. A text comparison can tell you the formatter produced expected output for one input, but cannot tell you whether a new formatting rule accidentally changed a computed address or string literal.

### 2.2 One Compiler, Sources as the Only Saved Input

Each test compiles the original source and the formatted source with the installed PNut-TS, then compares the two binaries. No compiled output is stored between runs. Because both binaries come from the same compiler in the same run, a difference can only come from the formatting, and a new compiler release cannot make a test stale.

Every comparison runs twice, without `-d` and with `-d`. Debug text and the source text of `debug()` expressions only reach the binary with `-d`, so a change to them is invisible without it.

Every test formats through the shipped pipeline: the real parsers feed the real `DocumentFormattingProvider`, so the tests cannot drift from what users run.

Whether PNut-TS matches PNut is not tested here. The PNut-TS project's regression suite compares its output byte for byte against Windows PNut.

The suite used to compare against stored `.bin.GOLD` binaries built by PNut. When the v55 interpreter image grew by 68 bytes, every binary comparison failed on size before comparing any bytes, even though the formatter had not changed. That design was retired in 2026-11.

### 2.3 Idempotency Prevents Format-on-Save Thrashing

If a formatter is not idempotent (formatting a file twice produces different output than formatting it once), users experience "format thrashing": every save changes the file, which triggers another format, which changes the file again. Idempotency testing is cheap (no compiler needed) and catches a broad class of bugs.

---

## 3. The Three-Phase Test Suite

The primary test suite (`formatter.binary-parity.test.ts`) runs three phases. The binary phases run against every fixture that compiles:

### Phase 1: Format + Recompile (The Critical Safety Test)

**What**: Compile the original `.spin2` source with PNut-TS. Format it, compile the formatted text with PNut-TS, and compare the two binaries.

**Why**: This is the most important test. If the formatter changes semantics — incorrect indentation that moves code into a different block, keyword case changes inside strings, altered operator spacing — the binary will differ. A passing Phase 1 proves the formatter is semantically safe for that input.

**Failure meaning**: The formatter changed the program's behavior. The assertion message reads: `FORMATTER CHANGED SEMANTICS`. This is a critical bug. If the original source fails to compile, the test fails and says so.

### Phase 2: Idempotency (Format Twice = Same Output)

**What**: Format the original source once (pass 1), format the result again (pass 2), compare the text of pass 1 and pass 2 line-by-line.

**Why**: A non-idempotent formatter causes infinite reformatting loops when format-on-save is enabled. The test reports the exact line number where the two passes first diverge, making diagnosis fast.

**Failure meaning**: The formatter is unstable. Something in the formatting pipeline produces output that is re-interpreted differently on the next pass. Common causes: a rule that shifts a comment that another rule then shifts back, or alignment math that rounds differently based on starting column.

**Note**: Phase 2 runs against ALL fixtures (even those that do not compile), since idempotency testing doesn't require compilation.

### Phase 3: Double-Format + Recompile

**What**: Format twice (ensuring the idempotent state), compile the double-formatted file, and compare to the compiled original.

**Why**: Catches a subtle class of bugs where the first format pass produces semantically correct but unstable output. The second pass "fixes" the instability but introduces a semantic change. Phase 1 alone wouldn't catch this because it only formats once. Phase 2 alone wouldn't catch it because text comparison can't detect semantic changes.

**Failure meaning**: The formatter is unstable AND the instability affects compiled output. The assertion reads: `FORMATTER IS UNSTABLE`.

---

## 4. The Safety Test Suite

The secondary test suite (`formatter.safety.test.ts`) complements the binary parity tests with broader coverage:

### 4.1 Configuration Variation Testing

The formatter has 16+ configuration settings. Each setting must produce stable, idempotent output. The safety suite defines 16 configuration variants and tests every fixture against each one:

| Variant | What It Tests |
|---------|---------------|
| `defaults` | Baseline with all default settings |
| `indent-4` | 4-space indentation instead of 2 |
| `blockname-lowercase` | Section keywords as `con`, `var`, etc. |
| `controlflow-uppercase` | `IF`, `REPEAT`, etc. |
| `method-uppercase` | `COGSPIN`, `PINWRITE`, etc. |
| `type-uppercase` | `BYTE`, `WORD`, `LONG` |
| `constant-lowercase` | User-defined constants lowercased |
| `all-case-preserve` | All case normalization disabled |
| `pasm-lowercase` | PASM mnemonics as `mov`, `add`, etc. |
| `pasm-uppercase` | PASM mnemonics as `MOV`, `ADD`, etc. |
| `no-trailing-ws-trim` | Trailing whitespace preserved |
| `no-final-newline` | No final newline enforcement |
| `no-comment-spacing` | No space after `'` / `''` |
| `no-tab-conversion` | Output uses tabs, not spaces |
| `blank-lines-0` | All blank line spacing set to 0 |
| `blank-lines-3` | Generous blank line spacing |

For each variant, two tests run:
1. **Idempotency** — format twice with that config, results must match
2. **Binary parity** — format with that config, recompile, binary must match the compiled original

This catches bugs where a specific configuration combination produces unstable or semantically incorrect output.

### 4.2 Cross-Config Binary Parity

A chained test that formats the same fixture through five different whitespace modes in sequence:

`tabs-8 → spaces-2 → spaces-4 → elastic-IronSheep → elastic-PropellerTool`

After each step, the formatted file is compiled and compared to the compiled original. This proves that switching between tab modes, indent sizes, and elastic tabstop profiles never changes the compiled output. The chain also exercises round-tripping: spaces → tabs → spaces.

### 4.3 Crash Resilience

Tests that the formatter doesn't throw exceptions on edge-case inputs:

- Empty file
- Whitespace-only file
- Comments-only file
- Single section with no content
- Very long lines (200+ operators)
- Deeply nested blocks (20 levels)
- Large block comments (50 lines)
- Mixed CRLF/LF line endings

These tests don't check correctness — they verify the formatter doesn't crash.

### 4.4 Real-World File Resilience

Tests formatter stability on actual production `.spin2` files from the `TEST_LANG_SERVER/` directory. These are real driver objects with messy formatting, unusual patterns, and complex structure. The tests verify:

1. No crash on format
2. Idempotency
3. Format + recompile produces the same binary as the original

### 4.5 Pre-Formatted File Preservation

An `indent-already-correct.spin2` fixture contains perfectly formatted code. The formatter must produce byte-identical output — a no-op on already-correct files. This catches "overformatting" bugs where the formatter unnecessarily modifies clean input.

---

## 5. Test Fixture Organization

### 5.1 Unit Test Fixtures (`server/src/test/formatter/fixtures/`)

Each `.spin2` file targets a specific formatting feature or known bug:

| Pattern | Purpose | Example |
|---------|---------|---------|
| `align-*` | Column alignment in specific sections | `align-con-equals.spin2`, `align-dat-pasm.spin2` |
| `indent-*` | Indentation normalization edge cases | `indent-deep-nesting.spin2`, `indent-inline-pasm.spin2` |
| `case-*` | Keyword case normalization | `case-keywords.spin2`, `case-pasm-instr.spin2` |
| `comment-*` | Comment preservation and spacing | `comment-block-preserve.spin2`, `comment-col0-preserve.spin2` |
| `debug-*` | Debug statement safety | `debug-continuation.spin2`, `debug-string-interp.spin2` |
| `regr-*` | Regression tests for specific bugs | `regr-string-keyword-case.spin2` |
| `ws-*` | Whitespace handling | `ws-tabs-mixed.spin2`, `ws-blank-lines.spin2` |
| `wrap-*` | Line wrapping edge cases | `wrap-long-lines.spin2` |
| `edge-*` | Edge cases | `edge-dat-local-labels.spin2` |
| `inline-pasm-*` | Inline PASM within methods | `inline-pasm-multi-region.spin2` |

**Total**: 54 fixture files. Two column-alignment reproducers, `regr-dat-data-instr-columns` (D.14) and `regr-pasm-label-detection` (D.12), do not compile, so they run in the idempotency tests only. They are named in `FORMAT_ONLY_FIXTURES` in `formatter.test-utils.ts`. Any other fixture that fails to compile fails its tests.

### 5.2 Production File Tests (`TEST-FORMATTER/`)

Real-world production Spin2 files (driver objects, exerciser programs) across multiple project directories within `TEST-FORMATTER/`. These files exercise the formatter on code that was not written to test the formatter — they contain the kind of inconsistent formatting, complex object hierarchies, and unusual patterns found in real projects.

### 5.3 Auto-Discovery

The test runner automatically discovers every `.spin2` file in the fixtures directory. No test registration is needed. Drop a `.spin2` file in and it automatically participates in all three phases.

---

## 6. The Standalone Formatting Pipeline

Tests do not require a running LSP server. The `formatter.test-utils.ts` module provides:

- **`MockDocumentFindings`** — Lightweight mock that scans for section boundaries and block comments, satisfying the formatter's dependency on the parser
- **`formatSpin2Text(text, config?, elastic?)`** — Standalone entry point that runs the full formatting pipeline on raw text
- **`DEFAULT_FORMATTER_CONFIG`** — Default configuration matching the `package.json` defaults

This architecture was chosen deliberately:
1. **Speed** — No server startup overhead. Tests run in milliseconds.
2. **Isolation** — Formatter bugs are separated from parser bugs and LSP bugs.
3. **Simplicity** — Adding a test is just reading a file and calling one function.

---

## 7. Adding a New Regression Test

When a formatter bug is found:

1. **Create a minimal reproducer** — Write the smallest `.spin2` file that triggers the bug. Name it `regr-descriptive-name.spin2`.

2. **Document the bug** — Add a comment at the top of the fixture explaining what it tests and why. Add an entry to Appendix D of `SPIN2-FORMATTER-RULES.md`.

3. **Fix the bug** — Implement the fix in the formatter source.

4. **Run the test suite** — `npm run test:formatter:binary` and `npm run test:formatter:safety`, one at a time. Your new fixture is auto-discovered.

5. **Verify all three phases pass** for the new fixture AND all existing fixtures.

---

## 8. Running the Tests

```bash
# Run only the binary equivalence tests (requires pnut-ts)
npm run test:formatter:binary      # timeout: 60s

# Run safety tests (config variants, crash resilience, real-world files)
npm run test:formatter:safety      # timeout: 120s
```

Run one test file at a time. A full-suite run can lock up the machine, so avoid `npm run test:formatter` and `npm run test:server`.

**Prerequisite**: PNut-TS must be installed and on the PATH for binary equivalence tests. Phases 1 and 3 are skipped if PNut-TS is not available. Phase 2 (idempotency) always runs.

---

## 9. Known Regression Cases (Summary)

Each of these bugs has a dedicated fixture file and is documented in Appendix D of `SPIN2-FORMATTER-RULES.md`:

| ID | Bug | Root Cause | Fixture |
|----|-----|-----------|---------|
| D.1 | Keyword case changes inside string literals | Case normalizer didn't track string state | `regr-string-keyword-case` |
| D.2 | ORG/END keywords lost their indent level | Indent normalizer skipped all PASM lines, including boundaries | `regr-case-org-indent` |
| D.3 | Wrong indent when methods use different widths | Global indent formula failed with mixed widths; fixed with stack-based algorithm | `regr-mixed-indent-width` |
| D.4 | Full-line comment indentation destroyed | Comment spacing normalizer dropped leading whitespace | (code fix) |
| D.5 | Trailing comment gap collapsed | Case normalizer rejoined code+comment without gap | (code fix) |
| D.6 | `''` doc comments split incorrectly | Regex matched second `'` as content | (code fix) |
| D.8 | PASM mnemonics changed inside DAT strings | PASM case normalizer didn't skip string content | `regr-pasm-case-strings` |
| D.9 | CASE_FAST inline PASM indent broken | Same as D.2 but for `case_fast` blocks | `regr-casefast-org-indent` |
| D.10 | Stored PNut binaries failed every test when the compiler changed | Tests depended on a saved compiled binary; retired for same-compiler comparison | (process) |
| D.11 | Mixed tab/space indent changes nesting | Stack won't pop below base; indent below base pushed as deeper level | `regr-mixed-tab-space-indent` |
| D.12 | PASM labels misidentified as mnemonics | No known instruction set for label-vs-mnemonic detection | `regr-pasm-label-detection` |
| D.13 | `debug()` calls inflate PASM column widths | String whitespace splits mnemonic token | `regr-debug-pasm-columns` |
| D.14 | Data labels push instruction mnemonic columns | Shared column computation for data and instructions | `regr-dat-data-instr-columns` |
| D.15 | Grouped `'` comments skipped by alignment | Parser reports `'` groups as block comments | `regr-pasm-comment-align` |
| D.16 | `{ }` block comment content reformatted | Comment alignment couldn't distinguish `{ }` from `'` groups | `regr-curly-block-comment-preserve` |
| — | OBJ array declarations rejected | Name regex didn't accept `[count]` suffix | `regr-obj-array-decl` |
| — | Preprocessor directives indented | No special handling for `#define`, `#ifdef`, etc. | `regr-preprocessor-preserve` |
| D.17 | Comment spacing destroys column alignment | `normalizeCommentSpacing` reconstructed line with hard-coded 2-space gap instead of preserving formatter-computed gap | `regr-comment-space-alignment` |
| D.18 | Whitespace and case changed inside strings, debug text and `debug()` expressions | Tab conversion had no awareness of compiled text, and case normalization lost track of `debug()` at a string | `regr-literal-text-whitespace` |
| D.19 | Comment text changed on every format | Tab compression miscounted columns past existing tabs on parser-grouped comments | `regr-comment-text-whitespace` |
| D.20 | Trailing comments moved on the second format | Small-block size counted blank lines that formatting adds | `align-con-enums` with `blank-lines-3` |

---

## 10. Why This Approach Works

The combination of binary equivalence testing, idempotency checks, configuration variant testing, and crash resilience testing provides overlapping safety nets:

- **Binary equivalence** catches any semantic change, no matter how subtle
- **Expected output** (`formatter.expected-output.test.ts`, `formatter.literal-text.test.ts`) catches a phase or setting that stops doing its job, which binary equivalence cannot: a formatter that changes nothing passes it
- **Language server entry** (`formatter.lsp-entry.test.ts`) covers the `enable` switch, file types, settings read from the client and the returned edit
- **Idempotency** prevents format-on-save loops
- **Config variants** ensure no combination of settings produces broken output
- **Cross-config chaining** verifies round-tripping between tab modes
- **Crash resilience** handles malformed and edge-case inputs
- **Real-world files** test against patterns not anticipated by fixture authors
- **Pre-formatted preservation** catches overformatting bugs
- **Auto-discovery** means new tests require zero boilerplate

No single method covers everything. Together, they create a testing framework that gives high confidence the formatter is safe to use on production Spin2 code.
