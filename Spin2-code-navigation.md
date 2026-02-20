# Spin2 Extension — Code Navigation

![Project Maintenance][maintenance-shield]

[![License][license-shield]](LICENSE)

Welcome to the code navigation features for Spin2 and Spin/PASM development in VS Code. These tools are designed to help you move through your projects with confidence, understand how symbols connect across files, and make changes safely. Whether you are working on a small single-file experiment or a large multi-object project, these features will save you time and help you stay oriented in your code.

This guide walks you through each feature, starting with the ones you will use most often and building toward more specialized tools. Every feature works with both `.spin2` (Propeller 2) and `.spin` (Propeller 1) files.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Document Highlight: See a Symbol at a Glance](#document-highlight-see-a-symbol-at-a-glance)
- [Find All References: Where Is This Used?](#find-all-references-where-is-this-used)
- [Document Links: Click to Open Object Files](#document-links-click-to-open-object-files)
- [Workspace Symbol Search: Find Any Symbol, Anywhere](#workspace-symbol-search-find-any-symbol-anywhere)
- [Go to Type Definition: Navigate to STRUCT Definitions](#go-to-type-definition-navigate-to-struct-definitions)
- [Rename Symbol: Safe, Project-Wide Renaming](#rename-symbol-safe-project-wide-renaming)
- [Features You Already Have](#features-you-already-have)
- [Quick Reference](#quick-reference)
- [Tips for Multi-Object Projects](#tips-for-multi-object-projects)
- [Known Limitations](#known-limitations)

---

## Getting Started

All of the features described here work automatically once the extension is installed. There is nothing to enable and no extra configuration needed to get started. Simply open a `.spin2` or `.spin` file, and the language server will parse your code and make these navigation features available.

For best results with multi-file features like Find All References and Rename Symbol, open the **top-level file** of your project first. This allows the extension to discover and parse all of the child objects referenced through your `OBJ` section, giving you the most complete navigation experience.

---

## Document Highlight: See a Symbol at a Glance

**What it does:** When you place your cursor on any named symbol, every occurrence of that symbol in the current file is softly highlighted. This gives you an instant visual map of where a constant, variable, or method name appears.

**How to use it:** Simply click on or move your cursor to any symbol name. The highlights appear automatically and disappear when you move away.

**What gets highlighted:**
- Constants defined in `CON`
- Variables defined in `VAR`
- Method names from `PUB` and `PRI`
- Local variables and parameters within methods
- DAT section labels
- Object instance names from `OBJ`

This is one of the most naturally useful features for reading code. When you are studying a method and wondering "where else does this variable appear?", just click on it and look. No keystrokes needed.

---

## Find All References: Where Is This Used?

**What it does:** Shows you every place a symbol is used, across your entire project. This includes declarations, assignments, reads, and method calls -- in the current file and in every child object file.

**How to use it:**

| Action | Keyboard Shortcut |
|--------|-------------------|
| Peek references (inline panel) | `Shift+F12` |
| Open references panel (sidebar) | `Shift+Alt+F12` |

You can also right-click on any symbol and choose **Find All References** from the context menu.

**Example:** Suppose you have a constant `MAX_CHANNELS` defined in your `CON` section and you want to know everywhere it is used before changing its value. Place your cursor on `MAX_CHANNELS` and press `Shift+F12`. A peek panel opens showing every line where `MAX_CHANNELS` appears, with enough surrounding context to understand each usage.

**Scope awareness:** The feature understands Spin2 scoping rules:

- **Global symbols** (constants, variables, method names, DAT labels) are searched across all parsed files in your project.
- **Local variables** (parameters, return values, and locals declared in a method signature) are searched only within their enclosing method, because that is their natural scope.

---

## Document Links: Click to Open Object Files

**What it does:** The quoted filename strings in your `OBJ` section become clickable links. This also works with FlexSpin `#include` directives when FlexSpin support is enabled.

**How to use it:** Hold `Ctrl` (or `Cmd` on macOS) and click on a quoted filename in an OBJ declaration. The referenced file opens in a new editor tab.

```spin2
OBJ

  color    : "isp_hub75_color"       ' Ctrl+Click on the filename to open it
  segment  : "isp_hub75_segment"
```

The extension resolves filenames using the same search order as the compiler: it checks the current file's directory first, then any configured include directories. If the file cannot be found, no link is shown.

If you are using FlexSpin and have enabled the **Highlight FlexSpin Directives** setting, `#include` filenames are also clickable:

```spin2
#include "my_utility.spin2"          ' Ctrl+Click works here too
```

---

## Workspace Symbol Search: Find Any Symbol, Anywhere

**What it does:** Opens a search dialog that lets you find any global symbol across all files in your workspace by typing part of its name. This is invaluable in larger projects where you know a symbol exists but cannot remember which file it lives in.

**How to use it:** Press `Ctrl+T` (or `Cmd+T` on macOS) to open the workspace symbol search. Start typing the name of the symbol you are looking for. The list filters as you type, using case-insensitive matching.

Each result shows:
- The symbol name
- The type of symbol (method, constant, variable, label, etc.)
- The file it belongs to

Select a result and press `Enter` to jump directly to that symbol's declaration.

**Example:** You recall there is a method called something like `drawPixel` but you are not sure which object defines it. Press `Ctrl+T`, type `draw`, and the search shows you every global symbol containing "draw" across your entire project.

---

## Go to Type Definition: Navigate to STRUCT Definitions

**What it does:** When your cursor is on a STRUCT instance variable, this command takes you directly to the STRUCT type definition where the structure's members are declared. This is a Spin2-only feature, since STRUCT is a Spin2 language construct.

**How to use it:** Right-click on a struct instance name and choose **Go to Type Definition**, or use the keyboard shortcut for your platform.

**Example:**

```spin2
CON

  STRUCT point_t
    LONG x
    LONG y

VAR

  point_t  myPoint

PUB Main()
  myPoint.x := 100          ' Right-click "myPoint" -> Go to Type Definition
                             ' Takes you to the "STRUCT point_t" line
```

This also works across object boundaries. If a struct type is defined in a child object, Go to Type Definition opens the child file and navigates to the definition there.

---

## Rename Symbol: Safe, Project-Wide Renaming

**What it does:** Renames a symbol everywhere it appears in your project, in a single operation. This is far safer than using find-and-replace, because it understands the structure of your code. It only renames the actual symbol, not unrelated text that happens to contain the same characters.

**How to use it:** Place your cursor on the symbol you want to rename and press `F2`. Type the new name and press `Enter`. The rename is applied everywhere the symbol is used.

You can also right-click and choose **Rename Symbol** from the context menu.

**What can be renamed:**
- Constants defined in `CON`
- Variables defined in `VAR`
- `PUB` and `PRI` method names
- Local variables and parameters
- DAT section global labels
- Object instance names from `OBJ`
- Enum values

**Scope-aware renaming:**
- Renaming a **local variable** only changes occurrences within its method, since that is the only place it is visible.
- Renaming a **global symbol** (constant, variable, method, label) updates every file in your project where that symbol appears.

### File Ownership and Safety

When renaming global symbols across multiple files, the extension includes safety measures to protect files you do not own:

- **Central library files** are automatically excluded from rename operations. If a symbol is used in a shared library, those usages will not be changed.
- **Author file prefix filtering:** If you set the `spinExtension.ServerBehavior.authorFilePrefix` setting to your personal prefix (for example, `isp_`), the rename operation will skip files that belong to a different author. This is helpful when your project includes objects written by other people.

To configure your author prefix, open VS Code Settings and search for `authorFilePrefix`.

### What Cannot Be Renamed

A few things are intentionally excluded from rename operations for safety:

- **PASM local labels** (those starting with `.` in Spin2 or `:` in Spin1) -- these have complex scoping rules within DAT sections.
- **Language keywords** and built-in names like `BYTE`, `WORD`, `LONG`, `TRUE`, `FALSE`, etc.
- **Text inside comments and strings** -- the cursor must be on an actual symbol, not on a mention in a comment.

---

## Features You Already Have

The code navigation features described above complement the existing features that the extension has provided:

| Feature | Shortcut | Description |
|---------|----------|-------------|
| **Go to Definition** | `F12` or `Ctrl+Click` | Jump to where a symbol is declared |
| **Hover Information** | Mouse hover | See type info, documentation comments, and declarations |
| **Signature Help** | Automatic as you type | See method parameters and their types while typing a call |
| **Document Outline** | Sidebar outline panel | Browse the structure of the current file (CON, VAR, OBJ, PUB, PRI, DAT sections) |
| **Code Folding** | Click fold icons in gutter | Collapse and expand code sections |
| **Semantic Highlighting** | Automatic | Rich, context-aware syntax coloring |

Together with the new navigation features, you have a comprehensive set of tools for understanding and working with Spin2 and Spin/PASM code.

---

## Quick Reference

Here is a handy summary of every code navigation shortcut:

| Feature | Shortcut | Notes |
|---------|----------|-------|
| Document Highlight | Click on a symbol | Automatic -- no keys needed |
| Go to Definition | `F12` | Jump to declaration |
| Find All References | `Shift+F12` | Peek panel |
| References Panel | `Shift+Alt+F12` | Full sidebar panel |
| Workspace Symbol Search | `Ctrl+T` | Search all files by name |
| Go to Type Definition | Right-click menu | Spin2 STRUCT instances only |
| Rename Symbol | `F2` | Safe, project-wide |
| Document Links | `Ctrl+Click` on filename | OBJ and `#include` paths |

On macOS, substitute `Cmd` for `Ctrl` in the shortcuts above.

---

## Tips for Multi-Object Projects

The full power of these features shines in projects with multiple objects. Here are some tips to get the most out of them:

1. **Open your top-level file first.** When you open the main file of your project (the one that contains the `OBJ` section referencing other files), the extension automatically discovers and parses all child objects. This enables cross-file features like Find All References and Workspace Symbol Search to cover your whole project.

2. **Use Workspace Symbol Search to orient yourself.** When you first open a project you haven't worked on in a while, press `Ctrl+T` and browse the symbol list. It is a quick way to reacquaint yourself with the project's structure.

3. **Combine Go to Definition with Find All References.** Go to Definition (`F12`) takes you to where a symbol is declared. Find All References (`Shift+F12`) shows you everywhere it is used. Together, they let you trace the flow of data through your program.

4. **Use Document Links to navigate your object tree.** Instead of manually opening files from the file explorer, `Ctrl+Click` on filenames in your `OBJ` section to move between parent and child objects naturally.

5. **Set your author prefix for safe renaming.** If your project includes files from multiple authors, configure `spinExtension.ServerBehavior.authorFilePrefix` with your prefix. This ensures that Rename Symbol only modifies files that belong to you.

---

## Known Limitations

These are areas where behavior may differ from what you expect:

- **PASM local labels** (`.label` in Spin2, `:label` in Spin1) are not tracked by Find All References or Rename Symbol. These labels have specialized scoping within DAT sections that makes general navigation impractical. Go to Definition continues to work for PASM local labels as before.

- **Cross-file rename** requires that the top-level file has been opened so that child objects are parsed. If a child object has not been loaded, its references will not be included in a rename operation.

- **Workspace Symbol Search** shows global symbols only (not method-local variables). If you are looking for a local variable, use Find All References within the method that contains it.

- **Go to Type Definition** is a Spin2-only feature. Spin1 does not have the STRUCT language construct.

---

Enjoy exploring your code. These features are here to help you work with confidence and move through even the largest Propeller 2 projects with ease.


## Did I miss anything?

If you have questions about something not covered here let me know and I'll add more narrative here.

*-Stephen*

## License

Licensed under the MIT License.

Follow these links for more information:

### [Copyright](copyright) | [License](LICENSE)

[maintenance-shield]: https://img.shields.io/badge/maintainer-stephen%40ironsheep%2ebiz-blue.svg?style=for-the-badge

[marketplace-version]: https://vsmarketplacebadges.dev/version-short/ironsheepproductionsllc.spin2.svg

[marketplace-installs]: https://vsmarketplacebadges.dev/installs-short/ironsheepproductionsllc.spin2.svg

[marketplace-rating]: https://vsmarketplacebadges.dev/rating-short/ironsheepproductionsllc.spin2.svg

[license-shield]: https://img.shields.io/badge/License-MIT-yellow.svg

[Release-shield]: https://img.shields.io/github/release/ironsheep/P2-vscode-extensions/all.svg

[Issues-shield]: https://img.shields.io/github/issues/ironsheep/P2-vscode-extensions.svg
