# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VSCode Language Server Protocol (LSP) extension providing comprehensive support for Parallax Propeller 1 (P1) and Propeller 2 (P2) microcontroller languages: Spin/Spin2 and Pasm/Pasm2. The extension offers syntax/semantic highlighting, code navigation, documentation generation, compiler integration, and custom tabbing features modeled after Propeller Tool.

## Architecture

This is a **client-server language extension** following the LSP architecture:

### Client (`client/`)
VSCode extension side that handles:
- Extension activation and lifecycle (extension.ts)
- UI features: status bars, tree views, document generators
- Toolchain integration: compiler/loader discovery and invocation
- Serial communication for P2 hardware (usb.serial.ts, usb.serial.terminal.ts)
- Editor features: tabbing, insert modes, region colorization
- Providers in `client/src/providers/`:
  - `spin.tabFormatter.ts` - Propeller Tool-style elastic tabstops
  - `spin.editMode.*` - Insert/Overtype/Align modes
  - `spin.color.regions.ts` - Propeller Tool-style background coloring
  - `spin.toolChain.configuration.ts` - Compiler/loader/serial device management
  - `spin.document.generate.ts` - Object interface documentation generation
  - `usb.document.generate.ts` - USB device findings report

### Server (`server/`)
Language server providing LSP features:
- Document parsing and analysis (server/src/parser/)
  - Separate parsers for P1 (spin1.*) and P2 (spin2.*)
  - `spin*.documentSymbolParser.ts` - Parses file structure (CON, VAR, OBJ, DAT, PUB, PRI sections)
  - `spin*.documentSemanticParser.ts` - Semantic analysis for highlighting
  - `spin.objectReferenceParser.ts` - Handles multi-file object dependencies
  - `spin.semantic.findings.ts` - Stores parsed symbols and relationships
- LSP providers in `server/src/providers/`:
  - SemanticTokensProvider - Semantic highlighting
  - HoverProvider - Documentation on hover
  - SignatureHelpProvider - Method signature assistance
  - DefinitionProvider - Go to definition
  - DocumentSymbolProvider - Code outline
  - FoldingRangeProvider - Code folding
- Context management (context.ts, DocumentProcessor.ts)
  - Maintains parsed document cache by file path
  - Tracks dependencies between objects
  - Manages workspace configuration

### Key Architectural Patterns

1. **Multi-file Analysis**: The extension parses object dependencies across files. When hovering/navigating in file A that uses objects from file B, it loads and parses file B.

2. **Dual Language Support**: P1 (Spin/Pasm) and P2 (Spin2/Pasm2) have separate parsers sharing common utilities in `spin.common.ts`.

3. **Section-based Parsing**: Spin files have distinct sections (CON, VAR, OBJ, DAT, PUB, PRI). Parsers handle each section differently with section-specific semantics.

4. **Client-side Toolchain**: Unlike typical LSP extensions, this includes full compiler/downloader integration on the client side, supporting multiple toolchains (PNut, PNut-TS, FlexSpin).

## Build & Development Commands

### Building
```bash
# TypeScript compilation only (tsc -b)
npm run compile

# Compile grammar files only (YAML to JSON)
npm run compile:grammar

# Full pipeline: compile + grammar + copy serial prebuilds
npm run prebuild

# Dev build: prebuild + esbuild with sourcemaps
npm run esbuild

# Dev watch mode (esbuild with sourcemaps, auto-rebuild)
npm run esbuild-watch

# TypeScript watch mode (tsc only, no bundling)
npm run watch

# Prepare for publishing (prebuild + minified esbuild)
npm run vscode:prepublish
```

The extension uses **esbuild** to bundle client and server into single files. `npm run compile` (tsc) alone does type-checking and emits to `client/out/` and `server/out/`, but the actual runnable extension is produced by esbuild.

### Testing & Linting
```bash
# Run linter
npm run lint

# Run e2e tests (via scripts/e2e.sh)
npm run test

# Run all grammar tests (Spin1 + Spin2)
npm run test:grammar

# Run grammar tests for a single language
npm run test:grammar:spin2
npm run test:grammar:spin1

# Run all tests (e2e + grammar)
npm run test:all

# Grammar coverage analysis
npm run coverage:grammar
npm run coverage:grammar:spin1
```

### Project Structure
- `npm run compile` builds both client and server TypeScript projects
- `npm run compile:grammar` converts YAML grammar files to JSON:
  - `syntaxes/spin2.tmLanguage.YAML-tmLanguage` → `syntaxes/spin2.tmLanguage.json`
  - `syntaxes/spin1.tmLanguage.YAML-tmLanguage` → `syntaxes/spin1.tmLanguage.json`
- Build outputs go to `client/out/` and `server/out/`
- The project uses TypeScript project references (client and server are separate TS projects)

## File Extensions & Languages

- `.spin2` - Propeller 2 Spin2 language
- `.spin` - Propeller 1 Spin language
- `.p2asm` - Propeller 2 assembly (also gets semantic highlighting)

## Configuration Namespaces

Extension settings use these prefixes:
- `spinExtension.ServerBehavior.*` - Language server behavior
- `spinExtension.ClientBehavior.*` - Editor appearance
- `spinExtension.elasticTabstops.*` - Tabstop configuration
- `spinExtension.insertMode.*` - Insert/Overtype/Align modes
- `spinExtension.toolchain.*` - Compiler/loader/serial configuration
- `spin2.*` - Workspace-level build environment settings

## Coding Rules

### No console.log - EVER
Never use `console.log()`, `console.warn()`, `console.error()`, or any `console.*` calls in this codebase. Always use the built-in `this._logMessage()` logging infrastructure instead. Debug logging is controlled via the `isDebugLogEnabled` flag (see "REMOVE BEFORE FLIGHT" comments in parser files). This applies to both client and server code.

### Root Cause Proof Required
When investigating bugs or test failures, always trace to root cause with proof. Never guess or speculate about causes — bisect to the exact code change, show the specific diff, and demonstrate the causal chain. Use techniques like: binary diff, per-method isolation, per-phase testing, listing comparison. Present evidence, not theories.

## Important Implementation Notes

### Serial Port Integration
The extension includes native serial port support (`serialport` package with `@serialport/bindings-cpp`) for P2 hardware communication. Prebuilt binaries are copied during build (`npm run makeprebuild`).

### Toolchain Discovery
The extension auto-discovers installed compilers/loaders:
- Searches common installation paths per platform (Windows/Mac/Linux)
- Detects: PNut, PNut-TS, FlexSpin, loadP2, proploader
- Stores discovered tools in workspace settings
- Manages PropPlug device enumeration and selection

### Document Processors
`server/src/DocumentProcessor.ts` maintains three maps:
- `topDocsByFSpec` - Top-level files in workspace
- `docsByFSpec` - All parsed documents
- `findingsByFSpec` - Semantic findings per document

When a file is opened/changed, its symbols are reparsed and related files may be invalidated.

### Multi-file Object References
OBJ sections declare dependencies on other .spin/.spin2 files. The parser:
1. Resolves object file paths relative to current file
2. Loads and parses referenced files
3. Exposes public symbols (PUB methods, constants) from objects
4. Enables hover/signature help across file boundaries

## Development Environment

A devcontainer is provided (`.devcontainer/devcontainer.json`) using the `node:latest` image. It runs `npm install` on creation and mounts host SSH keys for git push support. Recommended VSCode extensions (ESLint, Prettier, GitLens, etc.) are auto-installed.

## Testing Notes

The extension targets VSCode engine `^1.96.0`. E2e tests run via `scripts/e2e.sh` using `@vscode/test-electron`. Grammar tests use mocha with ts-node and validate TextMate syntax scoping for Spin1/Spin2.

## Package Scripts Location

Build configuration variants:
- `scripts/LIVE-package.json` - Production configuration
- `scripts/TEST-package.json` - Testing configuration
- `scripts/mode` - Script to switch between LIVE/TEST modes
