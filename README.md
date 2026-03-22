# VSCode support for the Parallax Propeller v1 & v2 8-Core MCU's

![Project Maintenance][maintenance-shield]
[![License][license-shield]](LICENSE) 
[![Release][Release-shield]](https://github.com/ironsheep/P2-vscode-extensions/releases) 
[![GitHub issues][Issues-shield]](https://github.com/ironsheep/P2-vscode-extensions/issues)

**Spin2 Extension**: 
[![Version][marketplace-version]](https://marketplace.visualstudio.com/items?itemName=ironsheepproductionsllc.spin2) 
[![Installs][marketplace-installs]](https://marketplace.visualstudio.com/items?itemName=ironsheepproductionsllc.spin2) 
[![Downloads][marketplace-downloads]](https://marketplace.visualstudio.com/items?itemName=ironsheepproductionsllc.spin2) 

VSCode support for the Propeller languages: Spin2 and Pasm2 for the [Parallax Inc.](https://parallax.com) Propeller 2 [P2 or P2X8C4M64P](https://www.parallax.com/propeller-2/), along with Spin and Pasm support for the Propeller 1 [P1 or P8X32A](https://www.parallax.com/propeller-1/).  

The P2 and P1 communities thrive in the [P2 Forums](https://forums.parallax.com/categories/propeller-2-multicore-microcontroller) and the [P1 Forums](https://forums.parallax.com/categories/propeller-1-multicore-microcontroller)

The **P2 Forum Thread** containing discussion of [this VSCode support](https://forums.parallax.com/discussion/170068/visual-studio-code-editor-for-p1-p2-spin-pasm#latest)

The **P1 Forum Thread** containing discussion of [this VSCode support](https://forums.parallax.com/discussion/175207/visual-studio-code-supports-p1-development-on-windows-mac-linux-yes-rpi#latest)

#### New in v2.9.1 — Formatter Default Adjustments

The Spin2 Document Formatter now ships with more conservative case defaults: block names and types are uppercase, user constants are uppercase, and control flow, methods, and PASM instructions are `preserve` (left as-is). See the [Formatter User Guide](Spin2-Formatter-UserGuide.md) for all options and examples.

#### New in v2.9.0 — Spin2 Document Formatter

Full source code formatter for `.spin2` files with section-aware column alignment (CON, VAR, OBJ, DAT), method body indentation normalization, PASM instruction alignment, six independent keyword case controls, and trailing comment alignment. The formatter is provably safe — tested by compiling before and after formatting and verifying the binary output is byte-for-byte identical.

Enable it in settings with `spinExtension.formatter.enable: true`. Click the status bar indicator ("Spin2 Spaces: 2", "Spin2 Prop Tool", etc.) to switch between spaces, tabs, or elastic tabstop profiles.

## Quick Start

1. **Install** the extension by searching for "spin2" in the VSCode Extensions panel.
2. **Select a theme.** After installation, the extension page opens automatically. Choose one of the Spin2 color themes from there before going further — this ensures your syntax highlighting looks right from the start.
3. **Open** a `.spin2` or `.spin` file. The language server starts automatically and gives you syntax highlighting, error checking, hovers, and signature help.
3. **Set your top-level file.** In your workspace `.vscode/settings.json`, add `"spin2.fNameTopLevel": "your_main_file.spin2"` so the extension can discover your full object tree.
4. **Compile** with `Ctrl+Shift+B` (Cmd+Shift+B on macOS). The extension auto-detects installed compilers (FlexSpin, PNut-TS, PNut on Windows).
5. **Download** with `F10` (RAM) or `F11` (FLASH). Use the Status Bar controls to toggle debug mode and select your PropPlug.

For platform-specific setup, see the guides for [Windows](TASKS-User-win.md), [macOS](TASKS-User-macOS.md), or [Raspberry Pi](TASKS-User-RPi.md).

## P2 Features

Full **language server based** support for Spin2 and Pasm2 on the Parallax Propeller 2.

### Language Intelligence

- **Syntax and Semantic Highlighting** — rich, context-aware coloring for Spin2 and Pasm2, including Streamer and Smart-pin symbols as well as all `debug()` display types with parameter validation
- **Error Detection** — parse errors are reported as you work. Install the **Error Lens** extension to see errors inline on the offending line.
- **Show Hovers** — hover over any symbol to see its type, value, and documentation, including symbols defined in external object files
- **Autocomplete / IntelliSense** — context-aware code completion with dot-triggered suggestions for object methods/constants and struct fields, general completion for local/global symbols and built-ins, and full documentation resolve
- **Signature Help** — as you type a method call, see its parameters and types for both user-written and built-in methods
- **Code Folding** — collapse and expand CON, VAR, OBJ, PUB, PRI, and DAT sections

### Code Navigation

- **Go to Definition** (`F12` / `Ctrl+Click`) — jump to where any symbol is declared, including across object files
- **Find All References** (`Shift+F12`) — find every use of a symbol across your entire project
- **Workspace Symbol Search** (`Ctrl+T`) — search for any global symbol across all files by name
- **Rename Symbol** (`F2`) — safely rename a symbol everywhere it appears, with scope awareness and author-file protection
- **Go to Type Definition** — navigate from a STRUCT instance to its type definition
- **Document Links** — `Ctrl+Click` on quoted filenames in OBJ sections and `#include` directives (FlexSpin) to open the referenced file
- **Document Highlight** — click on any symbol to see all occurrences in the current file highlighted
- **Outline View** — browse the structure of the current file from the sidebar
- **Object Hierarchy View** — see your project's full object tree and navigate between files

### Code Generation

- **Doc-Comment Generation** (`Ctrl+Alt+C`) — insert a documentation comment template below a PUB or PRI method
- **Object Public Interface Documentation** (`Ctrl+Alt+D`) — generate a public interface document, displayed in a side panel
- **Object Hierarchy Report** (`Ctrl+Alt+R`) — generate a project hierarchy report, displayed in a side panel
- **Project Archive** — generate a ZIP archive containing all source files needed to compile the top-level file, with a `_README_.txt` showing the project name, timestamp, and object hierarchy tree (command: "Spin2: Archive Project")

### Editor Features

- **Document Formatter** — section-aware source code formatting for `.spin2` files with column alignment (CON, VAR, OBJ, DAT), method body indentation normalization, inline PASM alignment, six independent keyword case controls (`blockNameCase`, `controlFlowCase`, `methodCase`, `typeCase`, `constantCase`, `pasmInstructionCase`), trailing comment alignment, and format-on-save support. Preserves block comments, string literals, debug() content, and preprocessor directives. Status bar indicator shows active whitespace mode; click to switch between spaces, tabs, or elastic tabstop profiles.
- **Scope Nesting Guides** — color-coded vertical lines in PUB/PRI method bodies showing nesting depth, with L-shaped closers and active-scope highlighting
- **Screen Coloring** — per-section background coloring à la Parallax Propeller Tool
- **Elastic Tabstops** — custom tab-stop support per section à la Propeller Tool, with selectable tab sets (`Propeller Tool`, `IronSheep`, or `User1`)
- **Edit Modes** — Insert, Overtype, and Align modes à la Propeller Tool
- **Color Themes** — companion themes for use with or without colored backgrounds

### Build and Download

- **Compiler auto-detection** — supports **FlexSpin**, **PNut-TS**, and **PNut** (Windows only)
- **Downloader/debugger auto-detection** — supports **loadp2** (FlexProp), **PNut-TS** (built-in loader), and **PNut-Term-TS** (debug terminal with loader)
- **Include path auto-discovery** — the extension scans your project and configures include paths for both the compiler and language server
- **Status Bar controls** — toggle debug compilation on/off, switch between RAM and FLASH download, and select your PropPlug
- **Per-workspace settings** — choose the default compiler and downloader globally or override per project

## P1 Support

The extension also provides Spin and Pasm support for the Propeller 1. P1 users get most of the same features listed above, including:

- Syntax and Semantic Highlighting for Spin and Pasm
- Error Detection, Hovers, Signature Help, and Code Folding
- Full Code Navigation — Go to Definition, Find All References, Workspace Symbol Search, Rename Symbol, Document Highlight, Document Links, Outline View, and Object Hierarchy View
- All Code Generation features (Doc-Comments, Public Interface Docs, Hierarchy Reports)
- All Editor Features (Screen Coloring, Elastic Tabstops, Edit Modes, Color Themes)
- Compile support via **FlexSpin**

**Not yet available for P1:** built-in download to hardware and Go to Type Definition (STRUCT is a Spin2 language construct).

### Language Version Tracking

The extension tracks the evolving Spin2/PASM2 language specification as new PNut compiler versions add features. Currently supported through **PNut v53**, including structures, preprocessor directives, math functions, `OFFSETOF()`, and more. See the [language version reference](spin2/REF-LangUpdates/README.md) for details on each version's additions.

### Future directions

- Snippets for common Spin2/Pasm2 code patterns (e.g., smart pin setup for a given mode)

## Installation

In VSCode, search for the "spin2" extension and install it.  It's that easy!  After installation, you will be notified to download and install new versions as they are released.

**Note:** This extension fully replaces the [Spin by Entomy](https://marketplace.visualstudio.com/items?itemName=Entomy.spin) vscode extension. While either can be used, our version provides more comprehensive Syntax highlighting (as the former has not been maintained), and this extension adds full Semantic Highlighting, Outlining, and Tab support with InsertModes, Document generation, etc. The older Spin extension can now be uninstalled with no loss of functionality.

## VSCode Environment

There are additional companion documents in this Repository:

**Getting around your code:**

1. [Editing Features Guide](Spin2-Editing.md) — language intelligence, code generation, and editor features for Spin2 development
1. [Code Navigation Guide](Spin2-code-navigation.md) — Find All References, Rename Symbol, Workspace Symbol Search, and more
1. [Include Directories Guide](Spin2-Include-Directories.md) — how the extension discovers and manages include paths for multi-file projects

**Platform setup:**

3. [Setup for Windows](TASKS-User-win.md) — compiler installation and build configuration on **Windows**
1. [Setup for macOS](TASKS-User-macOS.md) — compiler installation and build configuration on **macOS**
1. [Setup for Raspberry Pi](TASKS-User-RPi.md) — compiler installation and build configuration on **Raspberry Pi / Linux**

**Formatter:**

6. [Formatter User Guide](Spin2-Formatter-UserGuide.md) — all formatter options with examples, recommended configurations, and what the formatter preserves
1. [Formatter Regression Testing](FORMATTER-REGRESSION-TESTING.md) — theory of operations for the binary-equivalence test suite

**Editor features:**

8. [Status Bar Controls](Spin2-Editor-StatusBar.md) — download controls for debug, RAM/FLASH, and PropPlug selection
1. [Background Coloring](PT-Color-setup.md) — Propeller Tool-style block coloring and theme setup
1. [Edit Modes](Spin2-InsertMode.md) — Insert, Overtype, and Align modes à la Propeller Tool
1. [Tabbing - Visual Examples](TAB-VisualEx.md) — a visual walkthrough of how Elastic Tabstops work
1. [Tabbing - Engineering Notes](TAB-SPECs.md) — detailed specification for the Elastic Tabstops feature

**Reference:**

11. [Settings and Keyboard Mapping](Spin2-Settings.md) — all extension settings and key bindings
1. [ToolChain Reference](Spin2-ToolChain.md) — compiler detection, task variables, and user-tasks setup
1. [Useful VSCode Extensions](EXTENSIONS.md) — extensions we find helpful for P2 development

Also, here are a couple of really useful VSCode sources:

- [VSCode can do that?](https://www.vscodecandothat.com/) Fun website showing specific things VSCode can do - review what's possible that may help you in your use of VSCode.
- YouTube Channel: [Code 2020](https://www.youtube.com/channel/UCyYh-eAr74avLwOyPa1dDNg) - A large list of short videos presenting all manner of useful VSCode tips.

*Please go look at each of these once so you can know what's here when you need them!*

## Known Conflicts with other VSCode Extensions
We know the three extension so far which might interfere with our Spin2 extension. Here's what we've seen:

1. If I haven't already, I'll be submitting pull requests to the Overtype extension maintainers to add code for avoiding interference with our .spin/.spin2 InsertMode feature, but in the meantime, please ensure that the [Overtype by Adma Maras](https://marketplace.visualstudio.com/items?itemName=adammaras.overtype) and/or [Overtype by DrMerfy](https://marketplace.visualstudio.com/items?itemName=DrMerfy.overtype) extensions are disabled or uninstalled, as they can interfere with our extensions' behavior.
2. The Extension [Document This](https://marketplace.visualstudio.com/items?itemName=oouo-diogo-perdigao.docthis) v0.8.2 currently also occasionally intercepts the Ctrl+Alt+D keystroke, which we use to generate documentation, and our extension then doesn't get the request. I've filed an issue with the maintainer of that extension, so maybe this will be fixed in the future.  Meanwhile, you can either disable the **Document This** extension or, when you see the warning pop-up from the document this extension, you can usually just click in your editor window again, then press Ctrl+Alt+d again, and it will work after one or more tries.

### Color picker showing for #{hexdigits} constants in .spin2 code
This is a common issue caused by VS Code's built-in Color Decorator feature, not necessarily a separate extension. VS Code's default behavior interprets # followed by hex digits as CSS color codes and shows color picker swatches.

To confirm and fix this, you can check a couple of things:

Built-in CSS/HTML language features — VS Code ships with extensions like "CSS Language Features" and "HTML Language Features" that detect #RRGGBB patterns even in non-CSS files.

The setting to disable it — Search your VS Code settings for:

`editor.colorDecorators` — set this to `false` to disable color picker indicators globally.
Or better, disable it only for Spin2 files by adding to your `settings.json`:

```json
"[spin2]": {
    "editor.colorDecorators": false
}
```

To open your user `settings.json` for editing: open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), type **"Preferences: Open User Settings (JSON)"**, and select it. Add the snippet above, save, and the color pickers will stop appearing in `.spin2` files.
You can also check which extensions are active in your Spin2 files by opening a .spin2 file, then running the command "Developer: Show Running Extensions" from the command palette (Cmd+Shift+P). Look for any extension that provides color decoration — common culprits besides the built-in ones include extensions like "Color Highlight", "Color Picker", or "Colorize".

## Repository Notes

This repository contains a single subproject, which is the VS Code extension:

- SPIN2/SPIN and PASM2/PASM syntax Highlighting and code navigation [spin2](./spin2) - *Builds*



---

>  If you like my work and/or this has helped you in some way, then feel free to help me out for a couple of :coffee:'s or :pizza: slices or support my work by contributing at Patreon!
>
> [![coffee](https://www.buymeacoffee.com/assets/img/custom_images/black_img.png)](https://www.buymeacoffee.com/ironsheep) &nbsp;&nbsp; -OR- &nbsp;&nbsp; [![Patreon](./DOCs/patreon.png)](https://www.patreon.com/IronSheep?fan_landing=true)[Patreon.com/IronSheep](https://www.patreon.com/IronSheep?fan_landing=true)

---

## Credits

Ray [Cluso99] in our [Propeller 2 Forums](https://forums.parallax.com/categories/propeller-2-multicore-microcontroller), who started this effort for us.

Patrick (GitHub [Entomy](https://github.com/Entomy)) for a spin1 extension, which helped me get further along with this one.

Jay B. Harlow for contributing the initial elastic tabs feature.

George (GitHub [DrMerfy](https://github.com/DrMerfy)) for the latest [VSCode-Overtype](https://marketplace.visualstudio.com/items?itemName=DrMerfy.overtype) extension, which provided the foundation on which we could add the Align mode.

## License

Licensed under the MIT License.

Follow these links for more information:

### [Copyright](copyright) | [License](LICENSE)

[maintenance-shield]: https://img.shields.io/badge/maintainer-stephen%40ironsheep%2ebiz-blue.svg?style=for-the-badge

[marketplace-version]: https://vsmarketplacebadges.dev/version-short/ironsheepproductionsllc.spin2.svg

[marketplace-installs]: https://vsmarketplacebadges.dev/installs-short/ironsheepproductionsllc.spin2.svg

[marketplace-downloads]:https://vsmarketplacebadges.dev/downloads-short/ironsheepproductionsllc.spin2.svg

[marketplace-rating]: https://vsmarketplacebadges.dev/rating-short/ironsheepproductionsllc.spin2.svg

[license-shield]: https://img.shields.io/badge/License-MIT-yellow.svg

[Release-shield]: https://img.shields.io/github/release/ironsheep/P2-vscode-extensions/all.svg

[Issues-shield]: https://img.shields.io/github/issues/ironsheep/P2-vscode-extensions.svg
