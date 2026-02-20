# Spin2 Extension — Editing Features

![Project Maintenance][maintenance-shield]
[![License][license-shield]](LICENSE)

The Spin2 extension brings a rich set of editing features to VSCode for both Spin2 and Spin1 development. This guide walks you through the language intelligence, code generation, and editor features that help you write Propeller code more efficiently.

## Table of Contents

- [Language Intelligence](#language-intelligence)
  - [Syntax and Semantic Highlighting](#syntax-and-semantic-highlighting)
  - [Hover Information](#hover-information)
  - [Signature Help](#signature-help)
  - [Document Highlight](#document-highlight)
  - [Code Folding](#code-folding)
  - [Document Links](#document-links)
- [Code Navigation](#code-navigation)
- [Documentation Comments](#documentation-comments)
  - [Generating a Doc Comment](#generating-a-doc-comment)
  - [Generating an Object Interface Document](#generating-an-object-interface-document)
  - [Generating a Project Hierarchy Report](#generating-a-project-hierarchy-report)
- [Editor Features](#editor-features)
  - [Edit Modes — Insert, Overtype, and Align](#edit-modes--insert-overtype-and-align)
  - [Elastic TabStops](#elastic-tabstops)
  - [Screen Coloring](#screen-coloring)
  - [Color Themes](#color-themes)
- [Rename Symbol](#rename-symbol)
- [Companion Guides](#companion-guides)

## Language Intelligence

### Syntax and Semantic Highlighting

The Spin2 extension provides two layers of highlighting that work together to make your code easier to read.

**Syntax highlighting** colors your code based on the structure of the language — keywords, strings, comments, numbers, and operators are all given distinct colors based on your chosen theme.

**Semantic highlighting** goes a step further. The language server analyzes your code and applies colors based on what each symbol actually *is*: a constant, a variable, a method name, a PASM label, an object reference, and so on. This means you can see at a glance whether a name refers to a constant or a variable, even before you hover over it.

Semantic highlighting can distinguish:

- Constants, variables, and method names
- Local variables vs. instance variables
- Read-only (constant) values vs. modifiable variables
- PASM instructions and labels
- Object instance names and their methods
- Enum members and named values
- Debug display types and parameters

[Semantic highlighting in Spin2 code]() PIC TBA

The extension ships with five color themes designed specifically for Spin2 development. To select one, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and choose **Preferences: Color Theme**, then look for the "Spin2 Ironsheep" themes.

### Hover Information

Hover over any symbol in your Spin2 code to see detailed information about it. The hover popup shows you:

- **Methods** — The full signature with parameter names, types, and return values, plus any documentation comments you've written
- **Constants** — The constant name, its value, and which file it belongs to
- **Variables** — The variable type, scope (local, instance, or shared), and declaration location
- **DAT labels** — The label name and its section context
- **Built-in methods** — Full documentation for Spin2 built-in methods like `pinwrite()`, `waitms()`, `getct()`, and many more
- **PASM instructions** — Descriptions of P2 assembly instructions

[Hover showing method signature and documentation]() PIC TBA

You can also show the hover information at the current cursor position with the `Ctrl+K Ctrl+I` (`Cmd+K Cmd+I` on Mac) keyboard shortcut.

### Signature Help

As you write a method call, the extension shows you the method's signature — its parameters, their types, and what it returns. The currently active parameter is highlighted so you always know which argument you're filling in.

[Signature help showing parameter info]() PIC TBA

Signature help appears automatically when you type `(` after a method name. You can also trigger it manually with `Ctrl+Shift+Space` (`Cmd+Shift+Space` on Mac).

This works for your own PUB and PRI methods (including those from referenced objects) as well as Spin2 built-in methods.

### Document Highlight

Click on any symbol in your code and the extension automatically highlights every occurrence of that symbol in the current file. This gives you an instant visual map of where a variable, constant, or method is used without running a full search.

[Document highlight showing all occurrences of a variable]() PIC TBA

### Code Folding

The extension supports folding (collapsing) code sections in the editor gutter. You can fold individual CON, VAR, OBJ, PUB, PRI, and DAT blocks to focus on the section you're working in. Click the fold icons in the gutter, or use:

- `Ctrl+Shift+[` (`Cmd+Option+[` on Mac) — Fold the current region
- `Ctrl+Shift+]` (`Cmd+Option+]` on Mac) — Unfold the current region

### Document Links

The extension makes filenames in your OBJ section clickable. Hold `Ctrl` (`Cmd` on Mac) and click on a quoted filename to open that object's source file directly:

```spin2
OBJ
    serial  : "jm_serial"        ' <-- Ctrl+Click to open jm_serial.spin2
    display : "jm_lcd_display"   ' <-- Ctrl+Click to open jm_lcd_display.spin2
```

This also works with FlexSpin `#include` directives when FlexSpin support is enabled in settings.

## Code Navigation

The Spin2 extension provides a full suite of code navigation features — Go to Definition, Find All References, Peek Definition, Workspace Symbol Search, Rename Symbol, Outline view, Object Dependencies tree, and more.

These features are covered in depth in the [Code Navigation Guide](Spin2-code-navigation.md).

## Documentation Comments

Where TypeScript has JSDoc, the Spin2 extension provides built-in documentation comment generation. Doc comments are lines beginning with `''` placed immediately above or below a PUB or PRI method declaration. The extension understands these comments and displays them in hover popups and signature help, so well-documented methods help everyone who uses your objects.

### Generating a Doc Comment

Place your cursor on a `PUB` or `PRI` method signature line and press `Ctrl+Alt+C` (`Ctrl+Alt+Cmd+C` on Mac). The extension generates a documentation comment template with placeholders for each parameter:

```spin2
PUB startMotor(nPower, eDirection) | bResult
'' Start the motor at {nPower} in {eDirection}
'' @param nPower - power level (0-100)
'' @param eDirection - direction (CW or CCW)
'' @returns bResult - TRUE if motor started successfully
```

[Generated doc comment for a method]() PIC TBA

Once you fill in the descriptions, they appear in hover popups and signature help whenever anyone calls your method — including from other object files in the project.

### Generating an Object Interface Document

Press `Ctrl+Alt+D` (`Ctrl+Alt+Cmd+D` on Mac) to generate a `.doc.txt` file that documents all of the public methods and constants in the current file. This is useful when you want to share your object with other developers — the generated document serves as an API reference.

### Generating a Project Hierarchy Report

Press `Ctrl+Alt+H` (`Ctrl+Alt+Cmd+H` on Mac) to generate a `.hier.txt` file showing the object dependency tree for your project. This gives you a clear picture of which objects reference which other objects and how your project is structured.

## Editor Features

The Spin2 extension includes several editor features inspired by the Parallax Propeller Tool that are specifically designed for writing Spin and PASM code.

### Edit Modes — Insert, Overtype, and Align

The extension provides three edit modes that you can rotate through by pressing the `Insert` key (or `F9`):

- **Insert** — Your everyday typing mode. Characters are inserted at the cursor, pushing existing text to the right.
- **Overtype** — Characters you type replace existing characters. Useful for editing fixed-width data tables.
- **Align** — A mode designed specifically for maintaining code alignment. When you insert characters, only *nearby* text shifts — text separated by more than one space stays in place. This is invaluable for keeping comments aligned in PASM code.

The current mode is shown in the status bar. You can click the status bar indicator to rotate through modes, or use `Ctrl+Alt+I` (`Cmd+Shift+I` on Mac) to toggle between just Insert and Align.

**Align mode** really shines with PASM code, where you typically have four or five columns that need to stay aligned:

```pasm2
DAT
        org
              call      #hsync                          'do hsync
              add       font_line, #$08                 ' increment chr line selector
              cmpsub    font_line, #$20         wz
    if_z      add       font_base, #$080                ' increment top/middle/bottom
    if_z      cmpsub    font_base, #$180        wz
    if_z      add       screen_base, #cols              ' increment screen pointer
```

In Align mode, editing an instruction name won't disturb the carefully aligned operand, flag, and comment columns.

For full details on edit modes and their settings, see the [Edit Modes Guide](Spin2-InsertMode.md).

### Elastic TabStops

The extension provides Propeller Tool-style elastic tabstops — non-fixed tab positions that are configured per code section (CON, VAR, OBJ, PUB, PRI, DAT). When you press `Tab`, the cursor jumps to the next configured tab column for the section you're in, rather than inserting a fixed number of spaces.

Three preset configurations are available:

- **PropellerTool** — Matches the Parallax Propeller Tool defaults
- **IronSheep** — The extension author's preferred settings
- **User1** — A customizable preset for your own preferences

You can also press `Ctrl+Alt+Tab` to generate a tab-ruler comment showing the current tab positions for the section you're editing.

To enable elastic tabstops, go to Settings and search for "SpinExt" — you'll find the tabstops settings in the second section.

For full details on elastic tabstops and their configuration, see the [TabStop Specifications](TAB-SPECs.md) and the [TabStop Visual Examples](TAB-VisualEx.md).

### Screen Coloring

The extension can color the background of each code section differently, similar to the Parallax Propeller Tool. When enabled, your CON, VAR, OBJ, PUB, PRI, and DAT sections each get a distinct background tint, making it easy to see at a glance which section you're working in.

[Screen coloring showing distinct section backgrounds]() PIC TBA

To enable this feature:

1. Go to Settings and search for "SpinExt"
2. Check **Color Editor Background**
3. Optionally adjust the **Editor Background Alpha** to control the intensity
4. Select one of the "for background Color" themes for best readability

### Color Themes

The extension ships with five color themes tailored for Spin2 development:

| Theme | Best for |
| --- | --- |
| Spin2 Ironsheep Dark | Dark background, no screen coloring |
| Spin2 Ironsheep Light | Light background, no screen coloring |
| Spin2 Ironsheep Dark for background Color | Dark background with screen coloring enabled |
| Spin2 Ironsheep Light for background Color | Light background with screen coloring enabled |
| Spin2 Ironsheep Syntax | Syntax-only coloring (minimal semantic tokens) |

To select a theme, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and choose **Preferences: Color Theme**.

## Rename Symbol

You can safely rename any user-defined symbol across your entire project by pressing `F2` on the symbol and typing a new name. The extension updates every reference — in the current file and in every other file in your project that uses the symbol.

Rename works for constants, variables, PUB/PRI methods, local variables, DAT labels, object instances, and enum values.

The extension includes safety features to protect you:

- **Central library files** in your include directories are automatically excluded from renames, so you won't accidentally modify shared code
- **Author-file filtering** lets you set a file prefix (in settings) to exclude files authored by others from rename operations

**NOTE**: PASM local labels (`.label` in Spin2, `:label` in Spin1) and language keywords cannot be renamed.

## Companion Guides

This guide gives you an overview of the editing features available in the Spin2 extension. For deeper coverage of specific topics, see these companion pages:

- [Code Navigation Guide](Spin2-code-navigation.md) — Go to Definition, Find All References, Rename Symbol, Outline, Object Dependencies, and more
- [Edit Modes Guide](Spin2-InsertMode.md) — Insert, Overtype, and Align modes in detail
- [TabStop Specifications](TAB-SPECs.md) — Elastic tabstop configuration and column values
- [TabStop Visual Examples](TAB-VisualEx.md) — Visual demonstrations of elastic tabstops in action
- [Settings and Key Mapping](Spin2-Settings.md) — All extension settings and keyboard shortcuts
- [Status Bar Controls](Spin2-Editor-StatusBar.md) — Debug, RAM/FLASH, and PropPlug status bar controls
- [Include Directories](Spin2-Include-Directories.md) — Managing include paths for multi-file projects
- [ToolChain Reference](Spin2-ToolChain.md) — Compiler and downloader configuration

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
