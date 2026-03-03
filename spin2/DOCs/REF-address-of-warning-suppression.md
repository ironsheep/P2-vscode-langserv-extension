# Reference: Address-of (@) Warning Suppression for Variadic Parameter Patterns

## The Problem

Spin2 has a common variadic-function idiom where a method declares several parameters, but only the first is referenced by name using the address-of operator (`@`). The callee then accesses subsequent parameters via pointer arithmetic through the memory layout:

```spin2
PUB fstr3(p_str, arg1, arg2, arg3)
    format(p_str, @arg1)          ' arg2, arg3 accessed via @arg1 pointer

PRI format(p_str, p_args) | idx
    idx := 0
    value1 := long[p_args][idx++]   ' reads arg1
    value2 := long[p_args][idx++]   ' reads arg2
    value3 := long[p_args][idx++]   ' reads arg3
```

Because `arg2` and `arg3` are never referenced by name in `fstr3` — only accessed indirectly through the address of `arg1` — the unused-variable warning system flags them as "declared but never used." These are false positives: the parameters are genuinely used at runtime, just not visible to name-based static analysis.

This pattern appears frequently in string formatting, debug output, and other variadic-style utility methods across real Spin2 codebases.

## How Suppression Works

The suppression has three parts across two files:

### 1. `isAddressOf` flag on token references

`ITokenReference` in `spin.semantic.findings.ts` carries an optional `isAddressOf` boolean. When the semantic parser records a reference to a token, it checks whether the character immediately before the token in the source line is `@`. If so, the reference is flagged.

### 2. Detection in `_recordToken()`

In `spin2.documentSemanticParser.ts`, when `_recordToken()` records a reference for code navigation, it inspects the raw source line:

```typescript
const isAddrOf = line !== null
    && newToken.startCharacter > 0
    && line.charAt(newToken.startCharacter - 1) === '@';
```

This is a character-level heuristic — it does not go through the parser's operator resolution.

### 3. Suppression in `_reportUnusedLocalVariables()`

For each method, the logic:
1. Collects parameter names in declaration order (Map insertion order)
2. Scans parameters left-to-right for the earliest one that has any reference with `isAddressOf === true`
3. Walks forward from that parameter, suppressing only a **contiguous run** of parameters that have **zero** name-based usage references
4. Stops suppressing at the first parameter that IS referenced by name — this breaks the chain
5. Skips the unused-variable warning for any parameter in the suppressed set

The key assumptions:
- **If `@paramN` appears anywhere in the method body**, then `paramN` and the contiguous unreferenced parameters after it are likely accessed via pointer arithmetic.
- **A named reference breaks the chain.** If the programmer references a later parameter by name, that parameter and everything after it return to normal warning behavior. (Note: the `@param` reference itself is excluded from this check — see "The `isAddressOf` exclusion" under "What Was Already Tightened.")

### Example of the chain-break rule

```spin2
PUB example(a, b, c, d, e)
    foo(@b)       ' @b triggers suppression starting at index 1
    x := d        ' d (index 3) is referenced by name — breaks the chain
```

- `a` (index 0): normal — before `@` target, gets warnings if unused
- `b` (index 1): suppressed — `@` target, part of variadic block
- `c` (index 2): suppressed — unreferenced, contiguous after `@` target
- `d` (index 3): NOT suppressed — has a name reference, breaks the chain
- `e` (index 4): NOT suppressed — after the chain break, warned if unused

## Remaining Risks and Limitations

### Risk 1: Non-variadic use of `@` on a parameter (highest remaining impact)

If a programmer takes the address of a parameter for any reason other than the variadic idiom, subsequent contiguous unreferenced parameters get their warnings suppressed:

```spin2
PUB foo(callback, bufAddr, unusedX, unusedY)
    callback(@bufAddr)    ' passing address to callback, NOT variadic
    ' unusedX and unusedY are genuinely unused but now silent
```

The chain-break rule limits the damage — if any parameter after `bufAddr` is referenced by name, parameters after that one get warnings again. But in a method where everything after the `@` target is genuinely unused, the suppression covers them all.

**Impact:** Depends on how often Spin2 programmers use `@param` for non-variadic purposes (passing to buffer APIs, storing in tables, etc.). In the variadic-heavy Spin2 ecosystem this may be rare, but it's the primary remaining blind spot.

### Risk 2: The `@` target itself is suppressed

Suppression starts at the parameter that `@` is applied to, not after it. In the canonical pattern this is correct — `arg1`'s value is the first variadic argument. But if someone takes the address purely for pointer use and never reads the parameter's value, the warning for that parameter is also lost.

### Risk 3: Character-level detection is fragile

The `@` detection checks `line.charAt(startCharacter - 1)`. This means:

- **`@@param` (absolute address):** Still detected, because the second `@` is at `startCharacter - 1`. This happens to be correct but is coincidental.
- **`@ param` (space after `@`):** Not detected. Spin2 likely doesn't allow this, but it's an assumption about syntax rather than a parser guarantee.
- **`@` in non-operator contexts:** If `@` ever appeared at that position for a reason other than the address-of operator (unlikely in Spin2, but the detection doesn't validate context), it would trigger suppression.

### Risk 4: Only applies to parameters, not local variables

If someone uses `@localVar` to access stack-adjacent local variables via pointer arithmetic, those adjacent locals would still get unused-variable warnings. This is probably correct — the variadic pattern conventionally applies to parameters — but it's worth noting as a scope limitation.

### Not a risk: Scope isolation

The suppression is per-method. Using `@param` in method A does not affect warnings in method B, even if parameters share names. This is correct.

## What Was Already Tightened

Two refinements from the original design have been implemented:

### Contiguous-only suppression (originally "Refinement 3")

The suppression no longer runs unconditionally from the `@` target to the last parameter. It stops at the first parameter that has a name-based reference. This means trailing parameters that aren't part of the variadic block will get warnings, as long as there's at least one normally-referenced parameter between them and the `@` target.

### Zero-reference gating (originally "Refinement 1")

Each parameter in the suppression range is checked for name-based usage references before being suppressed. If a parameter after the `@` target is referenced by name, it is not added to the suppressed set — and because the chain-break rule applies, it also ends suppression for everything after it.

These two refinements work together: the zero-reference check identifies the break point, and the contiguity rule ensures everything past the break is treated normally.

### The `isAddressOf` exclusion in chain-break filtering

When checking whether a parameter has "named usage references" that would break the chain, the `@param` reference itself must be excluded. The `@arg1` token is recorded as a non-declaration usage reference for `arg1`, so without filtering it out, the chain would break immediately at the `@` target and nothing would ever be suppressed. The chain-break filter is `!r.isDeclaration && !r.isAddressOf` — only ordinary by-name references (like `x := param`) count as chain-breakers.

## Possible Future Refinement: Method-call Argument Context

**Addresses:** Risk 1 (non-variadic `@` use — the highest remaining risk)

**Idea:** The variadic pattern always passes `@param` as an argument to another method: `format(p_str, @arg1)`. Non-variadic uses tend to appear in assignments (`addr := @param`) or other expressions. If we only recognize `@param` when it appears inside a method call's parentheses, we filter out the non-variadic cases.

### Approach A: Check context at suppression time (recommended)

Instead of enriching `_recordToken()`, do the context check in `_reportUnusedLocalVariables()` when scanning for `isAddressOf` references. For each `isAddressOf` reference, read the source line it came from and check whether the `@param` sits inside parentheses that follow a method name.

This requires access to the source lines from within `_reportUnusedLocalVariables()`. The method doesn't currently have them, so you'd need to either pass the lines array through or store it on the class instance. The parser already stores `lines` during `_parseText()` but it's a local variable — it would need to become a class field (or the source text stored alongside findings).

Pseudocode for the context check:

```typescript
// Given a reference with isAddressOf on line N at character C:
const srcLine = this.sourceLines[ref.line];
const beforeAt = srcLine.substring(0, ref.startCharacter - 1).trimEnd();
// Walk backward from @ to find the opening paren, skipping commas and other args
// If we find '(' preceded by a method name, it's a call-argument context
```

The parser already has `isMethodCall()` in `spin.common.ts` (lines 97–116) which checks if text starts with `(`. You could extract the text after the method name and before the `@` to verify the shape.

**Effort:** Moderate. Requires:
1. Storing source lines as a class field (~2 lines)
2. Writing a helper to check "is position X inside a method call's argument list on this line" (~15–25 lines)
3. Adding the check to the `isAddressOf` scan loop (~3 lines)

**Complication:** Parentheses can nest. A line like `foo(bar(@param))` has `@param` inside `bar()`'s argument list, which is itself inside `foo()`'s. The check needs to handle nesting correctly, or at minimum verify that there's an unmatched `(` somewhere before the `@`.

### Approach B: Add context info to `ITokenReference` (more invasive)

Add an `isInCallArgument?: boolean` field to `ITokenReference` and set it in `_recordToken()`. This requires `_recordToken()` to know whether it's currently processing tokens inside a method call's argument list.

The parser already tracks call context in several places — for example, `isMethodCall()` is used at multiple sites to detect calls. But `_recordToken()` is a low-level recording function called from many sites. Threading call-context awareness through all those call sites is substantially more work.

**Effort:** High. Requires changes at every `_recordToken()` call site that processes method-call arguments, plus a new field on `ITokenReference`.

**Recommendation:** Approach A is more practical. It keeps the detection logic contained in one place and doesn't require changes across the parser.

**Effect on the risks:**
- Directly addresses Risk 1. `addr := @param` and `table[@param]` would no longer trigger suppression.
- Partially addresses Risk 3 (fragile detection) by adding semantic context beyond the single-character check.

## Other Minor Refinements

### Positional heuristic

The variadic pattern almost always uses `@` on an early parameter (first or second). An `@` on the last parameter is unlikely to be variadic. A simple index check (`if (earliestAddrOfIdx > 1) { /* don't suppress */ }`) could reduce false negatives with minimal effort. Low precision — it's a guess about convention, not a structural guarantee.

### Local variable tracking

Extend the same logic to local variables if the stack-adjacent-locals pattern proves common. Would require including `variable`-typed tokens in the parameter-order scan, which currently only looks at `parameter`-typed tokens.

## Files Involved

| File | What changed |
|------|-------------|
| `server/src/parser/spin.semantic.findings.ts` | `isAddressOf` field added to `ITokenReference` interface |
| `server/src/parser/spin2.documentSemanticParser.ts` | `_recordToken()` detects `@` and sets the flag; `_reportUnusedLocalVariables()` uses it to suppress warnings with contiguous chain-break logic |

## Related Test Files

- `TEST_LANG_SERVER/spin2/param-validation/isp_serial_singleton.spin2` — contains variadic patterns with `@arg1` through `@arg8`
- `TEST_LANG_SERVER/spin2/param-validation/isp_mem_strings.spin2` — string formatting methods using the `@arg` variadic pattern
