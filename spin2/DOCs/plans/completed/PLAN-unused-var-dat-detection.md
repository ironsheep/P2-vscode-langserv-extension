# Unused VAR/DAT Variable Detection — Implementation Plan

## Goal

Detect and report unused VAR block variables and DAT block variables (data declarations only, NOT code labels) with Quick Fix code actions to remove them.

## Current State

### What Already Works

- **Method-local unused detection** is fully implemented in `_reportUnusedLocalVariables()` (spin2 parser line ~196)
- Detects unused parameters, return values, and local variables in PUB/PRI methods
- Controlled by `spinExtension.ServerBehavior.reportUnusedVariables` setting

### Existing Infrastructure (90% in place)

| Component | Status | Location |
|-----------|--------|----------|
| VAR variables registered as global tokens | Done | `_getVAR_Declaration()` — type `'variable'`, modifiers `['instance']` |
| DAT variables registered as global tokens | Done | `_getDAT_Declaration()` — type `'variable'`, modifiers `['declaration']` |
| DAT code labels registered separately | Done | type `'label'`, modifiers `['declaration']` or `['declaration', 'static']` |
| Reference tracking for global tokens | Done | `_recordToken()` calls `recordTokenReference()` — scope is `''` for global context |
| Reference lookup API | Done | `getReferencesForToken(name, scope?)` — omit scope to get all references |
| Configuration flag | Done | `reportUnusedVariables` already controls local unused detection |

### What's Missing

1. **Public accessor for global tokens** — `globalTokens` map is private with no iteration method
2. **Reporting method for global unused variables** — no `_reportUnusedGlobalVariables()` exists
3. **Code action for VAR/DAT removal** — different from method signature removal

---

## Implementation Steps

### Step 1: Add Global Token Accessor

**File**: `server/src/parser/spin.semantic.findings.ts`

Add a public method to iterate global tokens, matching the existing `methodLocalTokenEntries()` pattern:

```typescript
public globalTokenEntries(): [string, RememberedToken][] {
  return this.globalTokens.entries();
}
```

The `globalTokens` field is a `TokenSet` (private, line ~1745). The `TokenSet` class already has an `entries()` method.

### Step 2: Add Unused Global Variable Reporting

**File**: `server/src/parser/spin2.documentSemanticParser.ts`

Add `_reportUnusedGlobalVariables()` method, called from the same location as `_reportUnusedLocalVariables()` (line ~158):

```typescript
private _reportUnusedGlobalVariables(): void {
  const globalEntries: [string, RememberedToken][] = this.semanticFindings.globalTokenEntries();
  for (const [tokenName, token] of globalEntries) {
    // only check variables, skip labels and other token types
    if (token.type !== 'variable') continue;

    const refs = this.semanticFindings.getReferencesForToken(tokenName);
    const usageRefs = refs.filter((r) => !r.isDeclaration);
    if (usageRefs.length === 0) {
      // distinguish VAR vs DAT by modifier
      const isVarBlock = token.modifiers.includes('instance');
      const label = isVarBlock ? 'VAR variable' : 'DAT variable';
      this.semanticFindings.pushDiagnosticMessage(
        token.lineIndex,
        token.charIndex,
        token.charIndex + tokenName.length,
        eSeverity.Warning,
        `${label} '${tokenName}' is declared but never used`
      );
    }
  }
}
```

**Call site** — add alongside existing local variable reporting (line ~156):

```typescript
if (this.configuration.reportUnusedVariables) {
  this._reportUnusedLocalVariables();
  this._reportUnusedGlobalVariables();  // NEW
}
```

### Step 3: Add Code Actions for VAR/DAT Removal

**File**: `server/src/providers/CodeActionProvider.ts`

Add matching in `handleCodeAction` for the new diagnostic messages:

```typescript
const unusedGlobalMatch = /^(VAR variable|DAT variable) '([^']+)' is declared but never used$/.exec(diag.message);
if (unusedGlobalMatch) {
  this._createRemoveUnusedGlobalAction(actions, uri, diag, unusedGlobalMatch[1], unusedGlobalMatch[2], lines);
  continue;
}
```

#### VAR Removal Logic

VAR block format — type applies to ALL names on the line:
```
VAR
  BYTE  a, b, c       ' all three are BYTE
  LONG  counter
  WORD  flags[10]
```

Removal cases:
- **Only name on line**: delete entire line
- **One of multiple names**: remove name from comma list (type stays for remaining names)
- **Last name on line with type**: delete entire line

#### DAT Removal Logic

DAT variable format — one variable per line with storage type:
```
DAT
  myData    BYTE  0[256]
  counter   LONG  0
```

Removal: delete entire line (DAT variables are one-per-line with their own label + storage type + data).

### Step 4: Add to Spin1 Parser (follow-on)

Apply same pattern to `spin1.documentSemanticParser.ts` if P1 uses the same token storage conventions.

---

## Important Distinctions

### DAT Variables vs DAT Code Labels

The parser already distinguishes these in `_getDAT_Declaration()`:

```
isNamedDataDeclarationLine = (haveLabel && haveStorageType) ? true : false
```

- **DAT variable**: has label AND storage type (BYTE/WORD/LONG) → type `'variable'`
- **DAT code label**: has label but NO storage type → type `'label'`

Only type `'variable'` should be flagged as unused. Labels are PASM entry points and branch targets — they may be referenced externally or by computed jumps.

### VAR Type-Applies-to-Line Rule

In VAR blocks, a type prefix applies to all names on the same line:
```
VAR
  BYTE  x, y, z    ' all BYTE — removing x leaves "BYTE y, z"
```

This differs from method signatures where each name needs its own type. The code action must preserve the type prefix when removing a name from a multi-name VAR line.

### Potential False Positives

- DAT variables used only from inline PASM (via `@` address-of) — verify these are tracked
- VAR variables used only via object reference from parent files — these ARE used but references may only exist in the parent's parse context, not in this file's findings
- Variables used via `FIELD` operator or other indirect access patterns

---

## Testing Checklist

- [ ] VAR variable used in PUB method — no warning
- [ ] VAR variable never used — warning appears
- [ ] DAT variable used in PUB method — no warning
- [ ] DAT variable used in DAT PASM — no warning
- [ ] DAT variable never used — warning appears
- [ ] DAT code label — NO warning (never flagged)
- [ ] Quick Fix removes single VAR variable (only name on line → delete line)
- [ ] Quick Fix removes one of multiple VAR names (preserves type for remaining)
- [ ] Quick Fix removes DAT variable (delete line)
- [ ] VAR variable used via `@` address-of — no false positive
- [ ] Setting `reportUnusedVariables = false` suppresses all warnings
