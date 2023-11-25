# VSCode support for the Parallax Propeller 1 & 2 Multicore MCU's

Spin/Spin2 Language-Server based VSCode Extension

## P1 and P2 Syntax/Semantic Highlighting and Code Navigation for VSCode

This Extension is continually in development. Things may, occasionally, not work correctly. See _Support_, below, for how to report issues.

## ABOUT

This extension provides support for P1 (spin and pasm) along with P2 (Spin2 and Pasm2), the primary languages for programming P1 [Parallax Propeller 1 or P8X32A](https://www.parallax.com/propeller-1/) and the P2 [Parallax Propeller2 or P2X8C4M64P](https://propeller.parallax.com/p2.html)

We've moved to a **Language Server based extension** so that we can awaken **multi-file behaviors** such as show help from included file in top-level file when hovering or showing signature help. This also applies to upoming features such as go to definition.

All features provided by this extension support both the Parallax Propeller 1 and Propeller 2 languages: Spin and Pasm.

## Feature: Syntax Highlighting

Both Spin and Pasm are now completely supported for the P1 while Spin2 and Pasm2 are completely supported for the P2 - including streamer and smartpins constants

## Feature: Semantic Highlighting

P1 Spin/Pasm along with P2 Spin2/Pasm2 are fully supported and will be improving over future releases.
See the **[ChangeLog](https://github.com/ironsheep/P2-vscode-extensions/blob/main/spin2/CHANGELOG.md)** for detailed status.

## Feature: Code Outline

The code outline for .spin and .spin2 files works as follows:

- Shows All Sections CON, OBJ, VAR, DAT, PUB, PRI
- Section name is shown in outline, except:
  - If section name is following by `{comment}` (or `' comment`) then name and comment will be shown in outline
  - For PUB and PRI the method name, parameters and return values are shown

_Hint:_ Configure the OUTLINE panel to `"Sort by Position"` to reflect the order in your source code.

## Feature: Tab-stop support à la Propeller Tool

(Initial Tabbing Feature contributed by **Jay B. Harlow**)

- Global default has tabstops as defined by Propeller Tool v2.7.0 except +3 more tabstops for PUB, PRI (at 12, 14, and 16)
- Uses DAT tabbing for in-line pasm (pasm within PUB, PRI blocks)
- Place cursor on line and press `TAB` or `Shift-TAB` to indent or outdent the text
- Place cursor on line and press `Ctrl+Alt+Tab` to generate tab location comment
- Supports the InsertMode operations à la Propeller Tool (_INSERT / OVERTYPE / ALIGN modes_) see [Insert Mode for Spin/Spin2](https://github.com/ironsheep/P2-vscode-extensions/blob/main/InsertMode.md) for more detailed info on this InsertMode feature.
- **Tab Sets** You can choose between `Propeller Tool`(_Default_), `IronSheep`, and `User1` (_adjust in settings to make your favorite set_)

## Feature: Screen Coloring à la Propeller Tool

The background coloring is now capable of looking like our familiar Propeller Tool colors.

- Same colors per code Block as displayed by Propeller Tool
- Light and Dark colors alternate with each same section
- Coloring is **off by default** but is easily enbaled in settings
- Two new themes (_Light and Dark for bavckground color_) alter the theme colors for better visiblity when using colored backgrounds

## Feature: Object Hierarchy view à la Propeller Tool

- Supports the settings `topLevel` value - when present, tree view is locked to top-level and included files
- When no settings `topLevel` then tree view follows current active editor tab
- Tree view supports collapse all
- When click on object the file is opened in an editor tab (or is activated, if already open)
- The internal `name` or `name[quantity]` is shown for each object
- If the reference file doesn't exist `FILE MISSING` will be shown as well

## Feature: Show Hovers

Hovers show information about the symbol/object that's below the mouse cursor. This is usually the type of the symbol and a description.

- Hover over **User** variables, constants, methods, pasm labels and objects to display pop-up information about the item including comments within the code for the item.
- Hover for **Built-in Spin/Spin2** method names, variables, constants and smart-pin constants to display pop-up documentation about the built-in item.
- Hover text for methods and constants from included objects are brought in from the external included object.

## Feature: Help With Method Signatures

Help With Method Signatures displays information about the method that is being called as you are typing the code that is invoking the method. This works for **Spin/Spin2 built-in methods** as well as **your own PUB and PRI methods** in the same file.

- Documentation is shown for each parameter as you are entering the parameter value being passed to the method.
- If your own methods are not yet documented, the this signature help still supports entry of the parameter values as well as reminds you how to add your own documentation for your PUB and PRI methods.
- When the method being entered is from an included object the help text is brought in from the external included object.

## Feature: Show Definitions of a Symbol

Peek at or go to the definition of variables/methods from where the variables/methods are being used.

- Enables right-mouse commands "Go to Definition" and "Peek -> Peek Definition"
- In spin this works for method names, global variables, parameters, return values, method local variables and pasm global labels.

## Feature: Code Folding

Provides Spin specific code folding support

- Fold Block comments, code blocks (CON, VAR, PUB, etc.), indented flow control, and continued line groups
- This is controlled by editor settings: Editor: **Folding**, Editor: **Folding Strategy** and Editor: **Show Folding Controls**

## Feature: Generate "Object public interface" documentation

Upon pressing Ctrl+Alt+d (control alt document) the editor will now generate a `{filename}.txt` document file (for your `{filename}.spin2` or `{filename}.spin` file) and open it up to the right side of your editor window. The generator extracts all PUB methods and their doc-comments along with file-top and file-bottom doc-comments.

This document is nearly the same as that produced by **Propeller Tool** except the compiler is not being run so the document does not contain information about the size of compiled object.

```
Program:        4,672 bytes
Variable:         348 bytes
```

_The above information in not present in the VSCode generated documentation file._

## Feature: Generate PUB and PRI comment blocks

Place your cursor over a PUB or PRI method signature and press Ctrl+Alt+c (control alt comment) and a comment block will be inserted immediately below the signature line. Then simply fill in the description. In the case of PUB methods the comment block will use single line doc-comments for public information so these comments will be included in "Object public interface" documentat when it is generated.

### Sample PUB doc-comment:

Press Ctrl+Alt+c (control alt comment) on this line:

```spin2
PUB pullUpValueForEnum(ePullupRqst) : pullup | localVar
```

... and you are presented with:

```spin2
PUB pullUpValueForEnum(ePullupRqst) : pullup | localVar
'' ...
''
'' @param ePullupRqst -
'' @returns pullup -
'
' Local Variables:
' @local localVar -
```

Fill it in like this:

```spin2
PUB pullUpValueForEnum(ePullupRqst) : pullup | localVar
'' Translate a serial I/O pullup constant into a pin constant
''  NOTE: defaults to P_HIGH_15K for any unknown enum value
''
'' @param ePullupRqst - a serial IO enum value indicating desired pull up
'' @returns pullup - the selected pin constant
'
' Local Variables:
' @local localVar - this is here for demonstration
```

**Note**: _for PUB methods this generates a mixed block of comments using single line doc-comments for the public information and single line non-doc comments for the private parts (local vaariables). This is so that the doc comments of public methods will be included in generated documentaion for this object._

### Sample PRI doc-comment:

Press Ctrl+Alt+c (control alt comment) on this line:

```spin2
PRI pullUpValueForEnum(ePullupRqst) : pullup | localVar
```

... and you are presented with:

```spin2
PRI pullUpValueForEnum(ePullupRqst) : pullup
' ...
'
' @param ePullupRqst -
' @returns pullup -
```

Fill it in like this:

```spin2
PRI pullUpValueForEnum(ePullupRqst) : pullup
' Translate a serial I/O pullup constant into a pin constant
'  NOTE: defaults to P_HIGH_15K for any unknown enum value
'
' @param pullupRqst - a serial IO enum value indicating desired pull up
' @returns pullup - the selected pin constant
```

**Note**: _for PRI methods this generates a block of single line non-doc comments. This is so the comment for private methods are not included in generated documentaion for this object._

## Possible Conflicts with other VSCode Extensions

**NOTE1:** _This extension now replaces the [Spin by Entomy](https://marketplace.visualstudio.com/items?itemName=Entomy.spin) vscode extension. While either can be used, this version provides more comprehensive Syntax highlighting (as the former has not been maintained) and this extension adds full Semantice Highlighting, Outlining and Tab support with InsertModes._ The `Spin` extension can be **uninistalled** with no loss of functionality.

**NOTE2:** _I'll be submitting pull requests to the Overtype extension maintainer to add code for avoiding interferrance with our .spin/.spin2 InsertMode feature but in the meantime please ensure that the [Overtype by Adma Maras](https://marketplace.visualstudio.com/items?itemName=adammaras.overtype) and/or [Overtype by DrMerfy](https://marketplace.visualstudio.com/items?itemName=DrMerfy.overtype) extensions are disabled or uninstalled as they can interfere with this extensions' behavior._

## Known Issues

We are working on fixes to the following issues we've seen during our testing. However, they are not major enough to prevent this release.

- The spin2 line-continuation syntax is supported only in OBJ block and on PUB/PRI declaration lines for now.  More support coming!
- We are still working through validating the P1 support against the full P1 obex - this is a work in progress
- Some line comments are not properly colored
- Occasionally [byte|word|long] storage types are not properly colored
- Occasionally some pasm code escapes coloring. We're trying to understand this.
- Ocassionally the syntax highlighting will just stop working for the final lines in a file. This appears to be a VSCode issue. But we are monitoring it.

_The above appear to be mostly syntax recognizer issues_

There are some things that currently are limitations which we may or may not address in the future:

- P2 Signature help is not available for send() method pointer - as it has variant forms of paramaters
- P1 and P2 Signature help is not available for lookup(), lookupz(), lookdown(), lookupdownz() as these have non-standard signature patterns not supported. Within the parens are found a ':' followed by one or more ','s.

## Reporting Issues

An active list of issues is maintained at github. [P2-vscode-langserv-extension/Issues](https://github.com/ironsheep/P2-vscode-langserv-extension/issues). When you want to report something missing, not working right, or even request a new feature please submit an issue. By doing so you will be able to track progress against the request and learn of the new version containing your fix/enhancement when it is available.

---

> If you like my work and/or this has helped you in some way then feel free to help me out for a couple of :coffee:'s or :pizza: slices or support my work by contributing at Patreon!
>
> [![coffee](https://www.buymeacoffee.com/assets/img/custom_images/black_img.png)](https://www.buymeacoffee.com/ironsheep) &nbsp;&nbsp; -OR- &nbsp;&nbsp; [![Patreon](./images/patreon.png)](https://www.patreon.com/IronSheep?fan_landing=true)[Patreon.com/IronSheep](https://www.patreon.com/IronSheep?fan_landing=true)

---
