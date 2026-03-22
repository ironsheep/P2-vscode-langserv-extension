# Change Log

All notable changes to the "spin2 syntax highlighting & code navigation" extension are documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for reminders on how to structure this file. Also, note that our version numbering adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Roadmap

### Near-term

- Work on fixes to any reported issues
- Add Constants to OBJ Interface Documentation
- Add Structures to OBJ Interface Documentation
- Continue spin2 code formatter improvements

### Longer-term

- Investigate unique coloring for method pointers
- Add spin2 instruction templates as Snippets (for instructions with two or more parameters)
- Add new-file templates as Snippets
- Add additional Snippets as the community identifies them

## [Unreleased]

_No unreleased changes at this time._

## [2.9.1] - 2026-03-21

Formatter default adjustments, and documentation updates

### Changed

- Change default `controlFlowCase` from `lowercase` to `preserve`
- Change default `methodCase` from `lowercase` to `preserve`
- Change default `typeCase` from `lowercase` to `uppercase`
- Change default `constantCase` from `preserve` to `uppercase`
- Clarify blank line setting descriptions — `maxConsecutiveBlankLines` applies within section bodies only and is independent of `blankLinesBetweenSections` and `blankLinesBetweenMethods`

### Fixed

- Fix CHANGELOG link in README.md to correct repository
- Update README.md with missing features: Autocomplete, Formatter, Toolchain Integration, Project Archive
- Remove stale Known Issues from README.md
- Update Formatter User Guide for new defaults and blank line independence

## [2.9.0] - 2026-03-21

Spin2 document formatter with tab/space conversion and status bar indicator

### Added

- Spin2 document formatter with section-aware column alignment for CON, VAR, OBJ, DAT blocks, method body indentation, PASM instruction alignment, keyword case normalization, and trailing comment alignment
- Format-on-save support via `spinExtension.formatter.formatOnSave`, bypassing VSCode's dispatch to avoid conflicts with other formatters
- `configurationDefaults` claiming `editor.defaultFormatter` for `[spin2]`, `[spin]`, and `[p2asm]` languages
- Bidirectional tab/space conversion enforcing the user's whitespace preference
- "Spin2 Spaces: N" / "Spin2 Tabs: N" / "Spin2 Prop Tool" / "Spin2 IronSheep" status bar indicator showing active tab/indent settings; click to switch profiles
- VSCode `editor.tabSize` and `editor.insertSpaces` as fallback defaults when extension settings are not configured
- Formatter test suite (1683 tests) covering binary parity, idempotency, configuration variation, crash resilience, and real-world file validation
- Formatter is disabled by default; enable via `spinExtension.formatter.enable`

### Fixed

- BUGFIX: DAT inline `{comment}` labels no longer falsely flagged as "missing declaration" when quoted strings are present
- BUGFIX: Language server now debounces document changes (350ms) for better responsiveness on large files
- BUGFIX: Elastic tabstops Tab/Shift+Tab keybindings now recover from extension host restarts
- BUGFIX: Case match values (e.g., `ORIENTATION_0:`) now colorized when the case body contains `debug()`
- BUGFIX: Compile/download tasks now run in the source file's directory when files are in a subfolder

## [2.8.2] - 2026-03-14

Spin2 debug() statement colorizing fixes and project archive feature

### Added

- "Spin2: Archive Project" command generates a ZIP of the top-level source and all OBJ dependencies with a `_README_.txt` showing project metadata and object hierarchy

### Fixed

- BUGFIX: Spin2 TextMate grammar now handles `debug()` with nested parentheses in format specifiers
- BUGFIX: Debug display feed single-quoted strings with tic escapes (e.g., `` `zstr_(expr) ``) now colorize correctly
- BUGFIX: Tic escapes with nested parentheses now use balanced paren matching
- BUGFIX: Built-in variables (e.g., `clkfreq`) now highlighted inside non-display `debug()` with format specifiers

## [2.8.1] - 2026-03-13

Preserve original case for symbol names in completion, workspace symbols, and diagnostics

### Fixed

- BUGFIX: Completion provider, workspace symbol search, unused variable diagnostics, and object dependency tree now preserve original symbol case instead of lowercasing

## [2.8.0] - 2026-03-11

PNut v52a/v53 language support and colorizing fixes

### Added

- `OFFSETOF(struct.member)` support for PNut v53 with semantic highlighting, hover docs, argument validation, and version directive gating
- Quick Fix code action to add or update `{Spin2_v53}` directive when `OFFSETOF()` is used
- `MOVBYTS(value, order)` as a Spin2 built-in function with hover documentation
- Semantic highlighting for `DEBUG_END_SESSION` constant in PUB/PRI and CON blocks

### Fixed

- BUGFIX: `OFFSETOF()` and `SIZEOF()` now accept struct type names (not just instances)
- BUGFIX: `SIZEOF(obj.structType)` and `OFFSETOF(obj.structType...)` no longer flagged as invalid for external object struct types
- BUGFIX: `DEBUG_END_SESSION` now receives semantic coloring outside `DEBUG()` calls

## [2.7.5] - 2026-03-11

Toolchain discovery improvements and compiler selection UI

### Added

- "Spin2: Select Compiler" and "Spin2: Add Compiler" commands for discovering and configuring compilers via UI
- Improved tool discovery: search well-known install directories first, then fall back to PATH
- When multiple tool installations are found, prompt user to choose via QuickPick

### Changed

- Rename PNut TS executable from `pnut_ts` to `pnut-ts` to match official distribution name
- Add `.exe` suffix handling for `pnut-term-ts` on Windows

## [2.7.4] - 2026-03-10

Unused VAR/DAT variable detection with Quick Fix removal

### Added

- Detect and report unused VAR and DAT block variables with warning diagnostics and Quick Fix code actions to remove them
- VAR Quick Fix handles single-variable lines and multi-variable comma lists
- Code actions now supported for both `.spin2` and `.spin` files

### Fixed

- BUGFIX: Fix tasks.json template to quote compiler/loader paths for directories with spaces

## [2.7.3] - 2026-03-10

Autocomplete/IntelliSense support and external struct field colorizing fix

### Added

- CompletionProvider with dot-triggered and general completion for Spin2 and Spin1 files (object methods/constants, struct fields, nested struct chains, local/global symbols, built-ins)
- Completion resolve provides full documentation when an item is highlighted
- Server-side unit tests for completion data model accessors (26 new tests)

### Fixed

- BUGFIX: Nested struct fields from external objects now colorize correctly instead of showing as errors

## [2.7.2] - 2026-03-09

STRUCT continuation, built-in symbol highlighting, and multi-line method signature fixes

### Added

- Warning diagnostic when line continuation `...` is followed by a blank line

### Fixed

- BUGFIX: STRUCT type now recognized in VAR declarations when prior STRUCT ends with trailing `...` and blank line
- BUGFIX: Index expressions now highlighted in continued PUB/PRI method signatures
- BUGFIX: `clkfreq_` and `clkmode_` compiler-generated symbols now highlighted
- BUGFIX: STRUCT member array sizes now recognized with whitespace before brackets

## [2.7.1] - 2026-03-09

`#PRAGMA EXPORTDEF` support and CON constant name parsing fix

### Added

- `#PRAGMA EXPORTDEF` directive support with semantic highlighting and transitive propagation through the full object dependency tree
- Union of exports from multiple open top-level files

### Fixed

- BUGFIX: Constant names containing "STRUCT" as a substring (e.g., `IDX_CSD_STRUCTURE`) no longer falsely detected as struct declarations

## [2.7.0] - 2026-03-08

Quick Fix code actions and version directive management

### Added

- Quick Fix: add or update `{Spin2_v##}` version directive when version-gated features are used
- Quick Fix: remove unused return values and local variables from PUB/PRI method signatures

### Fixed

- BUGFIX: Version hint diagnostics now emit correctly when a lower version directive is already present
- BUGFIX: Fix parameter structure instance registration for external object types
- BUGFIX: Fix line continuation (`...`) detection inside quoted strings

## [2.6.3] - 2026-03-04

Debug highlighting and task argument fixes

### Fixed

- BUGFIX: `DEBUG_END_SESSION` and debug control symbols now highlighted correctly inside `debug()` (v52+)
- BUGFIX: Struct field references in non-display `debug()` statements no longer truncated
- BUGFIX: Fix compiler/loader argument quoting for proper shell argument splitting
- BUGFIX: Fix empty string arguments in proploader option arrays

## [2.6.2] - 2026-03-03

### Changed

- Detune "declared but never used" warnings for statement patterns like varargs or copying a list of pins

## [2.6.1] - 2026-02-28

Unused variable warnings, sizeof() validation, outline improvements, and diagnostic severity fix

### Added

- Report warnings for unused parameters, return values, and local variables in PUB/PRI methods
- New setting `spinExtension.ServerBehavior.reportUnusedVariables` (default: enabled)
- Validate `SIZEOF()` argument is a structure type or instance

### Changed

- Outline uses comment text for block sections only when content after keyword starts with a comment

### Fixed

- BUGFIX: Warning severity now renders as yellow/orange squiggles instead of red errors

## [2.6.0] - 2026-02-23

Major feature additions, code navigation improvements, grammar fixes, and diagnostic/highlighting corrections

### Added

- PASM2 Hover Documentation for 362 instructions, conditionals, effects, and streamer constants with context-aware display
- Include Directory Support with two-tier system (central library, per-folder project), auto-discovery, Tree View UI, and compiler -I flag generation
- Struct-aware Go to Definition through multi-level chains (e.g., `pline.a.x`)
- Hover Type Annotations for all variables, parameters, and return values
- Document Links: click to open object files
- Go to Type Definition: navigate to STRUCT definitions
- Workspace Symbol Search: find any symbol across workspace
- Rename Symbol: project-wide safe renaming with `authorFilePrefix` setting
- v52 support: `ENDIANL`, `ENDIANW` methods and `DEBUG_END_SESSION` constant
- `BACKCOLOR` as recognized TERM debug display parameter
- DITTO directive in Spin2 TextMate grammar

### Fixed

- BUGFIX: Fix false "missing declaration" for PRI return values when method names contain "debug"
- BUGFIX: Fix false "Missing '=' part of assignment" for multi-line block comment closing braces in CON sections
- BUGFIX: Fix false "missing declaration" for PASM conditional prefixes and effects in DAT sections
- BUGFIX: Fix PASM highlighting across consecutive DAT sections
- BUGFIX: Fix false "BAD Storage/Align Type" for external object struct types in VAR and DAT
- BUGFIX: Fix wrong coloring for values after strings in DAT sections
- BUGFIX: Fix wrong coloring for names ending in digits before index expressions
- BUGFIX: Fix semantic token length clamping to prevent editor errors
- BUGFIX: Fix false error on comment lines containing `debug()` text
- BUGFIX: Fix DITTO directive hover showing no documentation
- BUGFIX: Fix method hover always showing comment template instead of actual doc-comments
- BUGFIX: Fix hover for external object method calls
- BUGFIX: Fix Go to Definition for methods, inline PASM labels, and local tokens
- BUGFIX: Fix unclosed PASM span at end-of-file
- BUGFIX: Fix cycle guard in object dependency resolution
- BUGFIX: Allow both Spin1 and Spin2 hovers in HoverProvider
- BUGFIX: Fix elastic tabstops JSON schema, runtime crashes, NaN generation, array mutation, Align mode on first line, and configuration mutation issues
- BUGFIX: Fix inverted PropPlug removal notification
- BUGFIX: Fix Spin2 variable block capture group mismatch in grammar
- BUGFIX: Fix multiple TextMate grammar issues (scope names, regex patterns, missing constants, operator matching, block end patterns, phantom instructions)
- Removed dead experimental grammar patterns

## [2.5.0] - 2025-11-20

### Added

- Allow `pnut-term-ts` as downloader when using `pnut_ts` as compiler
- Optionally allow `pnut-term-ts` with flexspin compiler

## [2.4.10] - 2025-07-13

### Fixed

- BUGFIX: VAR arrayed structure declarations now highlighted correctly
- BUGFIX: Variable names within quoted strings no longer match as declarations
- BUGFIX: Variable bit-field specifications within index now highlighted correctly

## [2.4.9] - 2025-07-02

### Fixed

- BUGFIX: CON enum declaration with step offset now highlights correctly
- BUGFIX: Nested index expressions, overlapping local variable names, and indexed size overrides in PUB/PRI now color correctly
- BUGFIX: Object/structure and size-override references in `debug()` statements now color correctly
- BUGFIX: Missing Smart Pin constants now recognized (including alternate spellings)

## [2.4.8] - 2025-06-21

### Fixed

- BUGFIX: Index-expression, complex case statement, and complex Spin2 statement highlighting corrected
- BUGFIX: Fix server crash on RegEx search with variable names containing control characters
- BUGFIX: Fix server crash on failing name searches

## [2.4.7] - 2025-06-03

### Fixed

- BUGFIX: Fix server crash on `byte/word/long[expression]` within `debug()` statements
- BUGFIX: Fix PUB/PRI param/retVal/local symbol returning incorrect structure type
- BUGFIX: Miscellaneous highlight fixes

### Changed

- Allow P1 reserved names (`cnt`, `par`) as constant names in P2 CON sections

## [2.4.6] - 2025-05-27

### Added

- Setting to allow non-Parallax FTDI USB serial devices
- Setting to control DTR/RTS for non-Parallax serial devices
- More detail in the USB Detection Report Document

### Fixed

- BUGFIX: USB serial devices now recognized whether or not the P2 is attached
- BUGFIX: Cancelling the selection dialog no longer deselects a serial device

## [2.4.5] - 2025-05-21

### Changed

- `serialport` package updated from v12.0.0 to v13.0.0
- Added PropPlug indicator in USB Devices found report
- Updated supported VSCode version to v1.96.0

## [2.4.4] - 2025-05-19

### Fixed

- BUGFIX: Spin2 built-in methods now recognized correctly in all cases
- BUGFIX: Names appearing in strings and as variables on the same line now handled correctly
- BUGFIX: Object and structure references in PUB/PRI now recognized correctly

### Changed

- More flexible VAR declaration recognition

## [2.4.3] - 2025-05-18

### Fixed

- BUGFIX: FlexSpin inline directives no longer interfere with PUB/PRI signature identification
- BUGFIX: Local variable identification corrected
- BUGFIX: Multiple double-quote strings on the same line now parsed correctly
- BUGFIX: Fix crash in SemanticFindings RememberedComment code
- BUGFIX: Fix parser control-flow for some forms of structure access
- BUGFIX: Preprocessor statements now work when not starting in column 0

## [2.4.2] - 2025-05-13

### Added

- Preprocessor highlight support (added in v48)
- Escape-sequence highlighting within escaped strings (added in v50)

### Fixed

- BUGFIX: Fix missed coloring of object overrides
- BUGFIX: Fix missed coloring within some types of `debug()` statements

## [2.4.1] - 2025-05-08

### Added

- Highlight `%"..."` packed character constants as numeric constants

### Fixed

- BUGFIX: Various small corner-case coloring fixes

## [2.4.0] - 2025-05-01

### Added

- Language support for `{Spin2_v48}` through `{Spin2_v51}` (except preprocessor)
- Highlight STRUCT types
- Highlight `%"..."` packed character constants as numeric constants

### Fixed

- BUGFIX: Fix syntax coloring of `P_REG_UP_DOWN` smart-pin constant

## [2.3.4] - 2025-02-22

### Fixed

- BUGFIX: Fix parser crashes (#17)
- BUGFIX: Prevent toolchain actions when toolchain support is not enabled (#16)

### Added

- Language support for Spin2 v44, v45, v46, and v47

NOTE: structure types are not yet highlighted; upcoming with v48+ support.

## [2.3.2] - 2024-12-12

### Fixed

- BUGFIX: Fix PATH parsing on Windows and expected location path creation for compiler detection

## [2.3.1] - 2024-12-12

### Changed

- Error when multiple installations are found for a given tool
- Reduce search to unique paths (no duplicates from PATH values)

## [2.3.0] - 2024-12-11

Updates to Compile/Download support for P2

### Added

- Automatic toolchain discovery for FlexProp, PNut, and pnut_ts
- Automatic PropPlug discovery
- Status bar controls for debug mode, FLASH/RAM target, and PropPlug selection
- Setting to select preferred compiler per workspace
- Setting to enable toolchain support (disabled by default)
- Universal replacement User Tasks file for all supported compilers

### Fixed

- BUGFIX: Fix crash when system-settings documents are open at startup
- BUGFIX: Fix VAR section index coloring

## [2.2.18] - 2024-05-09

### Fixed

- Repackaged to remove extraneous files from distribution

## [2.2.17] - 2024-05-09

### Fixed

- BUGFIX: Fix `alignl`/`alignw` detection in VAR (#9)
- BUGFIX: FlexSpin `#include` now works without `.spin`/`.spin2` extension (#11)
- BUGFIX: Fix highlighting for `#include` lines

## [2.2.16] - 2024-04-14

### Fixed

- BUGFIX: Add missing `bytefit`/`wordfit` recognition in DAT blocks (#6)
- BUGFIX: Fix `{Spin2_v??}` built-in method name support
- BUGFIX: Fix file access issues on Windows

### Changed

- Improved code-fold detection for ORG variants
- Adjusted report key-chords for Windows (Ctrl+Win+r, Ctrl+Win+d, Ctrl+Win+c)

## [2.2.15] - 2024-04-09

### Added

- Object hierarchy tree view with full expansion, collapse/expand icons, and hierarchy report via Ctrl+Alt+r
- Highlighting of `object[index]` expressions where index is an expression
- Preliminary FlexSpin support: conditional compile greying out deselected code, `#import` of .spin2 code

### Fixed

- BUGFIX: Fix `@instance[index].method` incorrectly reported as bad constant use

## [2.2.14] - 2024-01-11

### Changed

- Elastic tabs toggle no longer requires VSCode restart/reload
- Improved text-cursor colors for Spin2 themes

### Fixed

- BUGFIX: Minor DAT block highlighting fixes
- BUGFIX: Clarified duplicate variable declaration message

## [2.2.13] - 2024-01-09

### Fixed

- BUGFIX: Fix filename parsing with hyphens

## [2.2.12] - 2024-01-02

### Fixed

- BUGFIX: Fix syntax recognition of block names with inline comments (e.g., `DAT{{`)
- BUGFIX: Fix semantic highlighting in presence of inline block comments
- BUGFIX: Fix VAR name detection when storage type not provided (P2)

## [2.2.11] - 2023-12-30

### Added

- Recognition of "auto" on debug scope display declarations
- Semantic color for `byte()`, `word()`, and `long()` method overrides with method vs. storage type hover text
- Recognition of `{Spin2_v##}` language requirement directive
- Language directive emitted in generated interface documentation
- `lstring()` support when `{Spin2_v43}` is specified
- Detection and error generation for duplicate declarations in CON, VAR, and DAT sections

## [2.2.10] - 2023-12-24

### Added

- Complete implementation of spin/spin2 code folding

## [2.2.9] - 2023-12-11

### Fixed

- BUGFIX: Fix object constant override highlighting (broken in earlier release)

## [2.2.8] - 2023-12-05

### Added

- Code folding for code blocks, continued lines, pasm code, and comment blocks

### Fixed

- BUGFIX: Fix P1 Pasm syntax highlighting

## [2.2.7] - 2023-11-24

### Fixed

- BUGFIX: Fix `symbol.storageType` and `object[index].method()` parsing (P2)
- BUGFIX: Handle `\methodName()` in `debug()` statements (P2)

## [2.2.6] - 2023-11-21

### Added

- Line continuation `...` processing for CON sections and PUB/PRI code (P2)

## [2.2.5] - 2023-11-17

### Fixed

- BUGFIX: Fix documentation parsing for Signature Help and Hover Text (P1 and P2)

## [2.2.4] - 2023-11-16

### Added

- Proper CON highlighting as top-most default code block (P1 and P2)
- Line continuation `...` processing for PUB/PRI declarations (P2)

### Fixed

- BUGFIX: Fix local pasm label go-to navigating to wrong instance
- BUGFIX: Fix `debug()` single-quoted string parsing

### Removed

- Demo completion provider (should never have been active)
- Temporarily removed `BYTES()`, `WORDS()`, `LONGS()`, `LSTRING()` methods pending language version directive

## [2.2.3] - 2023-11-12

### Added

- New built-in methods `LSTRING()`, `LONGS()`, `WORDS()`, `BYTES()` (P2)
- FlexSpin inline pasm directives now handled (pasm highlighted, errors for directives)
- DOC Generator no longer generates for commented-out methods

### Fixed

- BUGFIX: Fix incorrect bitfield highlighting (P1 and P2)

## [2.2.2] - 2023-11-08

### Added

- Draft handling of line continuation `...` in OBJ section (P2)
- New built-in keyword `with` (P2)

### Fixed

- BUGFIX: Fix DAT pasm symbol offset calculations (P2)
- BUGFIX: Parameter, return-value, and local variable name collisions with globals now produce errors (P1 and P2)
- BUGFIX: Go to Definition now scoped correctly for local variables and local pasm labels (P1 and P2)
- BUGFIX: Go to Definition now positions cursor at symbol within the line (P1 and P2)
- BUGFIX: Fix DAT pasm parser prematurely leaving pasm mode (P1 and P2)
- BUGFIX: Fix several crash causes (P1 and P2)

## [2.2.1] - 2023-10-30

### Fixed

- BUGFIX: Fix filename validation in object includes to match PNut/Propeller Tool
- BUGFIX: Respect `maxNumberOfReportedIssues` setting when set to zero
- BUGFIX: Fix P1 hover detection for `object#constant` references
- BUGFIX: Improve CON operator parsing, inline `{comment}` handling, OBJ override parsing, and PUB/PRI assignment LHS parsing (P1 and P2)

### Added

- Basic hover text for Streamer Constants (P2)

## [2.2.0] - 2023-10-28

### Added

- Show Definitions of a Symbol: peek at and go-to definition(s) across current file and included objects
- Right-mouse "Go to Definition" and "Peek -> Peek Definition" commands
- Works for method names, global variables, parameters, return values, local variables, and pasm global labels

## [2.1.0] - 2023-10-27

Formal release of Language-server-based P1 and P2 Spin Extension

### Added

- Multi-file parsing: included objects are parsed and references validated
- Documentation from included objects shown in Hover Text and Signature Help
- Live parsing on file change with cross-editor window updates
- Error display per parsed file (with Error Lens integration)
- Files with parse errors highlighted in the file browser
- Many parsing/highlighting improvements for P1 and P2

## [2.0.0 - 2.0.4] - 2023-10-22

Convert to Spin and Spin2 Language Server as separate process (P1 and P2)

### Added

- Initial builds for alpha testing with key users

## [1.9.13] - 2023-08-03

### Changed

- Cleaned up Light and Dark non-colored-background themes

### Fixed

- BUGFIX: Fix incorrect flagging of pasm instructions as missing labels
- BUGFIX: Fix variable and label declaration highlighting in PASM code
- BUGFIX: Add missing smart pin constants `P_LEVEL_B_FBP` and `P_LEVEL_B_FBN` (P2)
- BUGFIX: Fix whitespace confusing object dependencies parser (P1 and P2)

## [1.9.12] - 2023-08-01

### Added

- Editor background coloring per section (Propeller Tool style), disabled by default
- Two new color themes for colorized backgrounds
- New Light theme for non-colored background use

## [1.9.11] - 2023-07-25

### Added

- Light theme supporting semantic highlighting (P1 and P2)

## [1.9.10] - 2023-07-22

### Fixed

- BUGFIX: Fix hover help for method parameters, return values, and local variables (P1 and P2)

## [1.9.9] - 2023-07-17

### Fixed

- BUGFIX: Fix signature help for user PUB/PRI methods (P1 and P2)

## [1.9.8] - 2023-07-17

### Fixed

- BUGFIX: Fix generated comments used for method signature help when no comments present (P1 and P2)
- BUGFIX: Improve hover content for `SEND()`, `RECV()` method pointers (P2)

## [1.9.7] - 2023-07-15

P1 feature parity with P2 feature set

### Added

- Signature Help for P1: parameter descriptions shown as they are typed
- Hover support for P1: user variables, constants, methods, pasm labels, objects, and built-in Spin methods/variables/constants
- Doc-Comment Generation for P1 PUB/PRI methods via Ctrl+Alt+c
- Object Public Interface documentation generation for P1 via Ctrl+Alt+d
- Hover for debug display window names (P2)
- Signature help now works for methods without parameter documentation, with a reminder to generate docs

## [1.9.6] - 2023-07-11

### Fixed

- Disable debug output logs

## [1.9.5] - 2023-07-10

### Added

- Signature Help for P2: parameter descriptions shown as method calls are typed
- Parameter and return value descriptions in built-in method hover text

### Fixed

- BUGFIX: Flag illegal use of `trunc`/`float`/`round` with missing parentheses or parameters (P2)

## [1.9.4] - 2023-06-27

### Fixed

- BUGFIX: PRI methods now show non-doc-comments in hover
- BUGFIX: Add blank line before locals in generated PUB/PRI method comments

## [1.9.3] - 2023-06-27

### Fixed

- BUGFIX: Handle PUB/PRI inline pasm variables and labels in hover
- BUGFIX: Improve naming for method parameters, return values, local variables, and inline-pasm labels
- BUGFIX: Multi-line preceding comments now supported for constants, variables, and labels

### Added

- Missing signatures for `float()`, `trunc()`, and `round()`

## [1.9.2] - 2023-06-26

### Added

- Hover support for P2: user variables, constants, methods, pasm labels, objects, and built-in Spin2 methods/variables/constants/smart-pin constants
- Doc-Comment Generation for PUB/PRI methods via Ctrl+Alt+c

### Fixed

- BUGFIX: `asmclk` no longer treated as a pasm label (P2)
- BUGFIX: Variables as sub-bitfields in `debug()` now highlighted correctly (P2)
- Add `getcrc`, `strcopy` to syntax recognition (P2)
- Add missing smart-pin constants to semantic highlighting (P2)

## [1.9.1] - 2023-06-13

### Added

- Object Hierarchy browser view for P1 and P2

## [1.9.0] - 2023-06-09

### Added

- Object Public Interface documentation generation via Ctrl+Alt+d

### Fixed

- BUGFIX: Fix highlighting of object constant references in case statement selectors (#17, P1 and P2)
- BUGFIX: Flag `else if` as illegal syntax (P1 and P2, #18)

## [1.8.9] - 2023-05-15

### Changed

- Avoid intercepting TAB key when using GitHub Copilot

## [1.8.8] - 2023-03-27

### Added

- Parsing/highlight of `field` accessor (P2)

### Fixed

- BUGFIX: Fix short variable name highlighting offset (P2)
- BUGFIX: Fix spin built-in name highlighting within `debug()` lines (P2)

## [1.8.7] - 2023-02-16

### Fixed

- BUGFIX: Fix OBJ statement detection without whitespace around colon (P1 and P2)

### Added

- Constant override syntax support in OBJ section (P2, partial)

## [1.8.6] - 2023-01-05

### Fixed

- BUGFIX: Fix multi-line doc comment detection (P1)
- BUGFIX: PUB/PRI P1 signatures without parens now flagged as needing port (P2)

## [1.8.5] - 2023-01-05

### Fixed

- BUGFIX: Fix PUB/PRI method name parsing confused by comment content (P1)
- BUGFIX: Fix object constants as array length specification (P1)
- BUGFIX: Fix double-entries of PUB/PRI names in Outline (P1)

## [1.8.4] - 2023-01-05

### Fixed

- BUGFIX: Fix `long(...)` recognition when adjacent to paren (#14)
- BUGFIX: Move global labels under enclosing DAT section in outline (#13)

## [1.8.3] - 2023-01-04

### Added

- Recognize nested `{}` and `{{}}` comments (P1 and P2 syntax)
- Flag missing `()` after method and built-in method names as errors (P2)
- Flag P1-specific variables, mnemonics, and methods as errors in P2 files (porting aid)

## [1.8.2] - 2023-01-02

### Added

- Global Pasm labels in Outline for P1 (completing P1+P2 coverage)

## [1.8.1] - 2022-12-26

### Added

- Global Pasm labels in Outline for P2

## [1.8.0] - 2022-12-23

### Added

- Optional FlexSpin preprocessor directive support (P1 and P2, disabled by default)
- Flag preprocessor directive lines as unknown when FlexSpin support is not enabled

### Fixed

- BUGFIX: Fix `_RET_` directive recognition in Pasm2 (P2)
- BUGFIX: Fix built-in `_set`, `_clr` variable recognition in Pasm2 (P2)
- BUGFIX: Fix constant recognition with `#>` and `<#` operators (P1 and P2)

## [1.7.8] - 2022-12-22

### Changed

- `org`, `asm`, `end`, `endasm` lines now use PUB/PRI tabstops
- Deconflict Tab with Tab-to-Autocomplete
- Adjust auto-closing pairs behavior

## [1.7.7] - 2022-12-17

### Fixed

- BUGFIX: `end` and `endasm` now positioned using in-line Pasm tabstops
- BUGFIX: Fix delete (left/right) behavior in Align edit mode
- BUGFIX: Cursor now positions correctly after Tab/Shift+Tab

## [1.7.5] - 2022-12-16

### Added

- Offset color for local vs. global pasm labels
- Detect and flag invalid local pasm label syntax (P1 vs. P2)

### Fixed

- BUGFIX: Fix backspace removing more than one character

## [1.7.4] - 2022-12-13

### Fixed

- BUGFIX: Constant declarations now identified correctly
- BUGFIX: Spin built-in methods now identified for better theme rendering

## [1.7.3] - 2022-12-09

### Added

- Named TAB configurations: select between Propeller Tool, IronSheep, or custom User1 tabs

## [1.7.2] - 2022-12-07

### Fixed

- Recognize label or data declaration on DAT line (P1 and P2)
- Recognize non-float decimal numbers with exponents (P1 and P2)
- Recognize `debug_main` and `debug_coginit` compile time directives (P2)
- Recognize event names in p2asm correctly (P2)
- Fix `debug` without parenthesis causing extension crash (P2)
- Recognize coginit constants in more p2asm cases (P2)
- Add `LutColors` directive recognition in debug statements (P2)
- Recognize `modcz` operand constants (P2)

### Known Issues

- Cursor ending position after Tab/Shift+Tab with selection may be unexpected
- Single-quote comment on debug lines causes bracket pairing issues with external extensions
- DAT section syntax highlighting occasionally fails
- Semantic highlight 'modification' attribute over-applied

## [1.7.1] - 2022-12-05

### Fixed

- BUGFIX: Fix Backspace and Delete in Align Mode
- BUGFIX: Fix keymapping (when clause was killing all keybindings instead of enabling for spin/spin2)
- F11 key assigned as alternate for Insert key

## [1.7.0] - 2022-12-02

### Added

- P1 support for .spin files (full syntax and semantic highlighting)
- InsertMode support: Insert/Overwrite/Align
- New Spin2 methods: `GETCRC()`, `STRCOPY()`
- DEBUG display BITMAP validates `SPARSE color`; `GRAY` recognized alongside `GREY`

### Changed

- Ongoing tabbing behavior refinements

## [1.6.1] - 2022-11-29

### Added

- Inline pasm detection: `end` reverts to PUB/PRI tab use; `asm`/`endasm` FlexSpin keywords supported
- Three additional tab stops for PUB/PRI at columns 12, 14, 16

### Changed

- Multi-line selection Tab/Shift+Tab now treats each line individually

## [1.6.0] - 2022-11-28

First formal release of elastic tabstops

### Added

- Configurable tab-stops-per-section (Propeller Tool style)
- Single-line and multi-line indent/outdent
- `Ctrl+Alt+Tab` inserts tab placement comment above cursor
- DAT tabbing for PUB/PRI inline pasm
- New settings: `Elastic Tab Stops: Blocks` and `Elastic Tab Stops: Enable` (disabled by default)

## [1.5.2] - 2022-11-19

### Fixed

- BUGFIX: Tabbing disable setting now works

## [1.5.1] - 2022-11-16

### Fixed

- Release without debug output enabled (same as v1.5.0 otherwise)

## [1.5.0] - 2022-11-16

### Added

- TAB support with traditional spin2 custom tab-stops (Propeller Tool style)
- Single-line and multi-line indent/outdent
- `Ctrl+Alt+Tab` inserts tab placement comment above cursor
- New settings: `Elastic Tab Stops: Blocks` and `Elastic Tab Stops: Enable` (disabled by default)

### Known Issues

- TAB support does not adhere to Insert/Overtype/Align modes yet
- Single-quote comment on debug lines causes bracket pairing issues
- DAT section syntax highlighting occasionally fails

## [1.4.1] - 2022-09-17

### Fixed

- BUGFIX: Fix assignment recognition within enum declarations (#8)
- BUGFIX: Single-line comments re-recognized during syntax pass (except after `debug()`) (#5)
- Recognize spin2 unary and binary operators within constant assignments
- Fix local variable recognition and comment-as-statement misidentification

## [1.3.9] - 2022-08-08

### Fixed

- BUGFIX: Fix misspelling of `X_4P_4DAC1_WFBYTE` symbol (#6)

## [1.3.8] - 2022-08-08

### Fixed

- BUGFIX: Fix pasm operator highlighting with constants (added `=`, `?`, `:`, `!`, `^` operators) (#7)

## [1.3.7] - 2022-05-05

### Fixed

- BUGFIX: Fix highlighting of multiple same-name constants in CON declarations
- BUGFIX: Fix highlighting of variable and method names in `debug()` statements
- BUGFIX: Fix highlighting of constant names in case statement ranges
- BUGFIX: Fix highlighting of ORG constant name as offset
- BUGFIX: Fix highlighting of constant names in complex constant assignments

## [1.3.6] - 2022-04-22

### Added

- Single-quote comments on section lines (DAT, VAR, OBJ, CON) now appear in Outline

### Fixed

- Method names and named operators now highlighted within `debug()` statements
- Improved number/number-base recognition, array size highlighting, and array-of-objects declaration highlighting
- Fix enum leading constant highlighting

## [1.3.5] - 2022-04-20

### Fixed

- BUGFIX: Keywords within single-quote strings no longer flagged
- Improved float operator and debug method recognition

## [1.3.4] - 2022-04-16

### Fixed

- BUGFIX: Fix debug display highlighting with multiple parenthesized sets in one string

## [1.3.2] - 2022-04-04

### Fixed

- BUGFIX: Fix highlighting of `debug()` statements with double-quoted strings
- BUGFIX: Fix object references in DAT-PASM and `debug()` with double-quoted strings
- BUGFIX: Fix highlight of `''` (two single-quote) comments

## [1.3.1] - 2022-03-31

### Added

- Runtime debug display name directive: `{-_ VSCode-Spin2: nextline debug()-display: {displayType} _-}`
- Highlighting of `debug()` statements within inline pasm

### Fixed

- BUGFIX: Fix label on ORG directive
- BUGFIX: Fix highlighting of ORGH directive

## [1.3.0] - 2022-03-29

### Added

- debug() display highlighting and validation for all display types (Logic, Scope, Scope_XY, FFT, Spectro, Plot, Term, Bitmap, Midi)
- Unique colors for displayType, displayName, keywords, and colors within debug statements
- Invalid keywords colored red for validation feedback
- Single-quote comment moved from syntax to semantic highlighting for debug statement support

### Known Issues

- Runtime calculation of display name not yet supported
- Single-quote comment in semantic parser causes bracket pairing issues with external extensions
- DAT section syntax highlighting occasionally fails

## [1.2.3] - 2022-03-16

### Fixed

- BUGFIX: Fix highlighting of float operators in spin2
- BUGFIX: Fix coloring of constant names in array declarations
- BUGFIX: Allow `debug()` in pasm; don't flag unknown names within `debug()`
- BUGFIX: Fix ORG recognition on DAT lines

## [1.2.2] - 2022-02-17

### Fixed

- BUGFIX: Fix binary operator highlighting in DAT data declarations (missed case)

## [1.2.1] - 2022-02-16

### Fixed

- BUGFIX: Fix binary operator highlighting in DAT data declarations

## [1.2.0] - 2022-02-09

### Added

- New Spin2/Pasm2/Debug methods and constants added since last release
- Directives invalid in inline-pasm now highlighted in red
- Unknown names highlighted in bright red

### Fixed

- BUGFIX: PASM labels no longer required to be in first column
- BUGFIX: Add missing pasm conditionals and spin2 method name
- BUGFIX: Fix constant value multiplication parsing
- BUGFIX: Previously seen files no longer affect current file highlighting
- BUGFIX: Symbol names starting with PUB, PRI, CON, DAT no longer confuse parser
- BUGFIX: RES and FIT coloring now works

## [1.1.0] - 2021-05-19

### Fixed

- BUGFIX: Fix highlighting of `debug()` functions in DAT section pasm code

## [1.0.1] - 2021-03-30

### Fixed

- BUGFIX: Add missing `recv` symbol support

## [1.0.0] - 2021-03-18

The Official Release of Semantic Highlighting

### Added

- Unknown names highlighted in bright red
- Built-in symbol recognition now case-independent
- Added newly added `DEBUG_*` variables

### Fixed

- BUGFIX: Fix pasm variable/label highlighting with short names
- BUGFIX: First lines in file now treated as CON by default (matching compiler behavior)
- BUGFIX: `round()`, `float()`, and `trunc()` recognized in DAT, CON, and PUB/PRI
- BUGFIX: Built-in constants now colored correctly

### Known Issues

- Syntax missing `recv` symbol
- `debug()` statements with non-double-quoted strings cannot be parsed
- DAT section syntax highlighting occasionally fails

## [0.3.4] - 2021-03-17

5th release of Semantic Highlighting

### Changed

- Darkened storage type color slightly

### Fixed

- BUGFIX: Parser now ignores contents of strings
- BUGFIX: `debug()` statements now parse correctly
- BUGFIX: Remove invalid `pinc` instruction (older form of `pinclear`)
- BUGFIX: Add `BYTE|WORD|LONG` recognition within spin statements

## [0.3.3] - 2021-03-16

4th release of Semantic Highlighting

### Added

- `Spin2 Ironsheep Syntax` theme (disables semantic highlighting for comparison)
- Undefined variables now shown in red

### Removed

- `Spin2 Cluso99` theme (by request)

### Fixed

- Semantic parsing now handles all VAR and CON examples from spin2 documentation
- Parses all PNut-shipped examples (less `Spin2_interpreter.spin2`)
- BUGFIX: Fix multi-line enum, comma-delimited constants, embedded assignments, shorter variable names, and multiple assignment LHS highlighting
- BUGFIX: Fix variable index recognition, number recognition, and add missing constants/operators/built-ins

### Known Issues

- Pasm: `round()`, `float()`, `trunc()` not recognized as operands
- Strings not properly ignored during parsing
- Some `debug()` statements parsed incorrectly
- DAT section syntax highlighting occasionally fails

## [0.3.2] - 2021-03-12

3rd release of Semantic Highlighting

### Fixed

- BUGFIX: Highlighting is now case-insensitive (matching spin language)
- BUGFIX: Add missing `posx` and `negx` spin2 constants

## [0.3.1] - 2021-03-09

2nd release of Semantic Highlighting

### Added

- PASM semantic highlighting support

### Changed

- Theme moved to pastel-like colors

### Fixed

- BUGFIX: Fix comma-separated VAR declarations, external object constants, outline issues, case statement ranges, assignment LHS, storage types in locals, indexed object calls, DAT external constants, NOT operator, and address-of expressions
- BUGFIX: Add `FILE` include operator recognition in DAT sections
- BUGFIX: Fix decimal number recognition (false `+`/`-` prefix)

## [0.3.0] - 2021-03-07

Preview Release of Semantic Highlighting

### Added

- Initial Spin2 semantic highlighting (Spin only, no Pasm)

### Fixed

- BUGFIX: Fix false recognition of `or` within symbol names
- BUGFIX: Fix false recognition of numbers within symbol names

### Known Issues

- Local pasm labels not handled properly
- String contents not ignored during parsing
- Multi-line enum and comma-delimited constants not supported
- Some `debug()` statements parsed incorrectly
- DAT section syntax highlighting occasionally fails

## [0.2.2] - 2020-11-30

### Added

- Missing named operators for Spin2

## [0.2.1] - 2020-11-25

### Fixed

- BUGFIX: Add `not` operator for Spin2
- BUGFIX: Remove escape sequence recognizer so strings highlight correctly

## [0.2.0] - 2020-11-07

### Added

- 105 smart pin symbols, 78 streamer mode symbols, 24 COG-REGISTER symbols for Spin2 and Pasm2
- Complete Pasm2 instruction rebuild with separately labeled groups
- Missing clock variables for Pasm2

## [0.1.2] - 2020-11-06

### Added

- Outline support for file navigation
- Nearly complete Spin2 language core and debug() methods
- Event and interrupt source symbols
- Two draft themes: Spin2 IronSheep and Spin2 Cluso99
- Works with many popular VSCode themes

## [0.1.1] - 2020-11-04 (internal only)

### Changed

- Internal build testing, converted to new content arrangement

## [0.1.0] - 2019-04-22

### Added

- Initial files published by Cluso99 in [P2 forum post](https://forums.parallax.com/discussion/170068/visual-studio-code-editor-for-p1-p2-spin-pasm/p1)
