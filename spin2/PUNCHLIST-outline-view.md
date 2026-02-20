# Outline View - Audit Findings & Punch List

_Audit date: 2026-02-18_
_Status: Reference document - not acting on immediately_

## Design Context

The outline view is intentionally a **table of contents** -- it shows major sections and navigation landmarks (section headers, DAT/PASM global labels, PUB/PRI methods), not a full rich organizational tree. The editor itself provides detailed content within each section. This design mirrors the functionality of Propeller Tool and other tools in the ecosystem.

The convention of using `CON { comment }` blocks as visual group separators in the outline is shared across multiple tools and should be preserved.

---

## Fixed

### Test assertions were no-ops for range objects (FIXED - commit a2cb652)

`outline.spin2.test.ts` used `assert.equal()` for `range` and `selectionRange` comparisons. Since `assert.equal` compares objects by reference (not deep equality), these assertions always passed regardless of actual values. Fixed by switching to `assert.deepStrictEqual` for objects and `assert.strictEqual` for primitives. Also added child symbol validation.

---

## Design Decisions (Intentional - Not Bugs)

### Single-line ranges

Symbol `range` and `selectionRange` are both set to the declaration line only, not the full block extent. This is fine for the table-of-contents purpose. Folding ranges are handled separately by the semantic parser and work correctly. Clicking an outline item scrolls to the declaration line, which is the desired behavior.

### Two-level hierarchy

The provider supports section -> children (2 levels). This matches the design intent: sections as containers, labels/methods as entries. No deeper nesting is needed for the table-of-contents model.

### CON/VAR/OBJ items not shown as children

Individual constants, variables, and object references don't appear in the outline. This is by design -- the outline shows navigation landmarks, not every declaration.

---

## Visual/Icon Considerations

### Current SymbolKind mapping

| Section | SymbolKind | Icon color | Icon shape |
|---------|-----------|------------|------------|
| CON | Method | Purple #B180D7 | Cube with arrow |
| VAR | Variable | Blue #75BEFF | Brackets with nodes |
| OBJ | Class | Orange #EE9D28 | Network nodes |
| DAT | EnumMember | Blue #75BEFF | Overlapping rectangles |
| PUB | Method | Purple #B180D7 | Cube with arrow |
| PRI | Field | Blue #75BEFF | Rectangular box |
| DAT/PASM labels | String | Foreground (gray) | Text characters |

### PUB vs PRI method differentiation

Currently PUB uses `SymbolKind.Method` (purple cube) and PRI uses `SymbolKind.Field` (blue box). This gives good visual contrast between public and private methods.

**LSP has no visibility/access modifier field.** [LSP issue #98](https://github.com/Microsoft/language-server-protocol/issues/98) has been open since 2016 with no implementation. VSCode has closed multiple related feature requests (#61239, #103305, #113238) as duplicates of the LSP limitation.

**How other language servers handle this:**
- **TypeScript/C#**: Have a `showAccessibility` setting that prepends text like `[private]` or `[public]` to the symbol name string. No icon change.
- **Java (Red Hat)**: Does not show visibility in outline at all. Team stated it requires LSP protocol changes.

**The current Field-for-PRI approach is one of the best available workarounds** -- it provides both color contrast (purple vs blue) and shape contrast (cube vs box). The alternative of using Method for both and prepending `[public]`/`[private]` text would lose the at-a-glance icon color distinction.

### Visual separators in the outline

**VSCode does not support custom rendering, separator lines, or custom icons in the outline view.** The team has explicitly declined these requests:
- [Issue #241616](https://github.com/microsoft/vscode/issues/241616) - Custom icons on DocumentSymbols: "not planned"
- [Issue #50186](https://github.com/microsoft/vscode/issues/50186) - Custom SymbolKind values: "out-of-scope"

The only visual differentiation available is the built-in `SymbolKind` icon set (26 kinds, each with a fixed icon shape and color). No horizontal lines, dividers, or custom decorations are possible in the outline tree.

**Current approach is near-optimal:** Using `CON { comment }` as collapsible group headers with distinctive SymbolKind icons is one of the best available strategies given the constraints. The color variation between section types (purple CON, blue VAR, orange OBJ, blue DAT) provides natural visual grouping.

**Related extensions:**
- [Separators](https://marketplace.visualstudio.com/items?itemName=alefragnani.separators) - Adds horizontal lines in the _editor_ (not the outline) above methods
- [Outline Map](https://marketplace.visualstudio.com/items?itemName=Gerrnperl.outline-map) - Alternative enhanced outline view with more visual layout

### Custom icon sets

VSCode does **not** allow extensions to provide custom icons for the outline view. The `DocumentSymbol` interface only accepts the fixed `SymbolKind` enum (26 values). There is no extension point to:
- Register custom icon SVGs for outline items
- Override the built-in codicon icon set for specific SymbolKinds
- Use product icon themes to change outline icons

The only way to affect outline icons is the 26 `SymbolKind` values, which map to fixed codicon SVGs with user-customizable _colors_ (via `workbench.colorCustomizations` settings like `symbolIcon.methodForeground`).

**What IS customizable:** Users (not extensions) can change the _colors_ of each SymbolKind icon in their settings:
```json
{
  "workbench.colorCustomizations": {
    "symbolIcon.methodForeground": "#B180D7",
    "symbolIcon.fieldForeground": "#75BEFF",
    "symbolIcon.classForeground": "#EE9D28",
    "symbolIcon.enumeratorMemberForeground": "#75BEFF",
    "symbolIcon.variableForeground": "#75BEFF",
    "symbolIcon.stringForeground": "#cccccc"
  }
}
```

This means the extension could _recommend_ a color scheme that maximizes visual distinction, but cannot enforce it.

### All 26 SymbolKind icons - visual reference

| SymbolKind | Default Color | Icon Shape |
|-----------|--------------|------------|
| File | Foreground | Document page |
| Module | Foreground | Grid/window panes |
| Namespace | Foreground | Curly braces `{ }` |
| Package | Foreground | Box/package |
| **Class** | **Orange #EE9D28** | Network/circuit nodes |
| **Method** | **Purple #B180D7** | Cube with upward arrow |
| Property | Foreground | Wrench with circular arrow |
| **Field** | **Blue #75BEFF** | Rectangular prism/box |
| Constructor | Purple #B180D7 | Similar to Method |
| **Enum** | **Orange #EE9D28** | Overlapping rectangles with lines |
| Interface | Blue #75BEFF | Two connected circles |
| **Function** | **Purple #B180D7** | Similar to Method |
| **Variable** | **Blue #75BEFF** | Brackets with circuit nodes |
| Constant | Foreground | Rounded rectangle with lines |
| String | Foreground | Text characters |
| Number | Foreground | Numeric characters |
| Boolean | Foreground | Toggle/binary |
| Array | Foreground | Bracket array |
| Object | Foreground | Object shape |
| Key | Foreground | Alphanumeric PIN characters |
| Null | Foreground | Null indicator |
| **EnumMember** | **Blue #75BEFF** | Overlapping rectangles |
| Struct | Foreground | Structural icon |
| **Event** | **Orange #EE9D28** | Lightning bolt |
| Operator | Foreground | 2x2 grid with +, -, x, . |
| TypeParameter | Foreground | Type variable |

Only 10 of the 26 kinds have a distinctive non-foreground color (marked in bold). The rest all render in the same foreground/gray color, making them hard to distinguish from each other.

---

## Possible Future Improvements (Low Priority)

1. **Optimize SymbolKind selection** - Given the 10 colored kinds available, the current mapping could potentially be refined for maximum visual distinction. For example, DAT and VAR currently both use blue-family icons (EnumMember and Variable) -- switching one to an orange-family kind would increase contrast.

2. **Add recommended color scheme** - Document a suggested `workbench.colorCustomizations` configuration that maximizes outline readability for Spin2 users.

3. **Spin1 parser cleanup** - The Spin1 parser duplicates ~80% of Spin2 parser code with minor differences. Could be refactored to share a base class, but low priority since both work correctly.

4. **DAT label icon** - Currently `SymbolKind.String` (foreground gray). `SymbolKind.Constant` or `SymbolKind.Key` would be semantically closer, though the author noted visual reasons for the current choice.
