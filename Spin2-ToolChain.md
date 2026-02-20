# Spin2 Extension — ToolChain Reference

![Project Maintenance][maintenance-shield]
[![License][license-shield]](LICENSE)

## New Toolchain configuration and use

Currently the following compilers are runtime detected:

|  name | executable name | description |
| --- | --- | --- |
| flexspin | flexspin.exe, flexspin.mac, flexspin | Compiler provided by FlexProp by Total Spectrum Software, Inc. (Eric R. Smith) <br>**All Platforms**
| pnut | pnut_shell.bat | Compiler provided by Parallax.com. (Chip Gracey) <br>**Windows only**
| pnut_ts | pnut_ts | Compiler provided by Parallax.com, and Iron Sheep Productions, LLC. (Chip Gracey, and Stephen M. Moraco) <br>**All Platforms**

A couple of expected paths per platform and the user's environment variables are used to find the install for each compiler.

*Paths searched vary by platform. The extension checks common installation locations and your PATH environment variable.*

### Configuration Variables provided for User-Tasks use

| Name | Purpose | Set by |
| --- | --- | ---
| `topLevel` (deprecated) -or-<br>`spin2.fNameTopLevel ` | Filename of the top-level file in your workspace<br>NOTE `topLevel` was filename (without the .spin2 file extension)<br>While `fNameTopLevel` is filename.spin2 (with the extension) | Added **by-hand** during project setup. *This allows downloads to work even when your are not editing the top-level file!*
| `spin2.fSpecCompiler` |  Absolute path of the selected compiler for this workspace | Runtime discovered, set when user enters **compilerID** from list of runtime-discovered compilers
| `spin2.fSpecFlashBinary` | (**flexspin only**) Absolute path of the flashLoader binary for this workspace | Runtime discovered, set when user enters **compilerID** from list of runtime-discovered compilers
| `spin2.fSpecLoader` | (**flexspin/PNut only**) Absolute path of the selected downloader for this workspace | Runtime discovered, set when user enters **compilerID** from list of runtime-discovered compilers
| `spin2.serialPort` | Device Node name (or COM Port) of the selected serial port.|**Runtime discovered**, set when user selects the serial port by clicking on the **VSCode StatusBar** Icon
| `spin2.optionsBuild` **but use:** <br>`spinExtension.getCompilerArguments` which formats the argument values correctly | Build options without the source filename | Set when user enters **compilerID** from list of runtime-discovered compilers
| `spin2.optionsLoader` **but use:**<br>`spinExtension.getLoaderArguments` which formats the argument values correctly| Additional command-line options passed to loader without the binary filename | Determined by settings (**compiler choice**) and latest state of FLASH/RAM selection on **VSCode StatusBar**
| `spin2.optionsBinaryFname` | The name of the **binary file** to be downloaded. <br>-In case of **pnut** the **spin2 file** to be compiled then downloaded.<br>- In case of **flexspin** this will also contain the full directive to load the **flash programming** utility if downloading to FLASH. | Determined by settings (**compiler choice**) and latest state of FLASH/RAM selection on **VSCode StatusBar**
| `spin2.localIncludes` | Per-folder include directories for Spin2 object resolution | Configured by user via the **Include Directories** sidebar view
| `spin2.excludeIncludeDirectories` | Directories to exclude from include-path discovery | Configured by user via the **Include Directories** sidebar view
| | --- **VSCode built-in variables** ---
| `fileBasename` | The file opened in the active VSCode text editor (in the active tab). | Provided by VSCode runtime
| `workspaceFolder ` | The root folder of this workspace | Provided by VSCode runtime

### Build Commands and how they are reflected in user tasks

#### Compile File for the P2

| Compiler | Command |
| --- | --- |
| | --- **Compile current file to binary** ---
| flexspin | `flexspin -2 -Wabs-paths -Wmax-errors=99 ${fileBasename}`
| pnut | `pnut_shell.bat ${fileBasename} -c`
| pnut_ts | `pnut_ts -c ${fileBasename}`

This now translates into a single entry in the **user tasks** file:

```json
    {
      "label": "compileP2",
      "type": "shell",
      "command": "${config:spin2.fSpecCompiler}",
      "args": [
        {
          "value": "${command:spinExtension.getCompilerArguments}",
          "quoting": "weak"
        },
        "${fileBasename}"
      ],
      "problemMatcher": {
        "owner": "Spin2",
        "fileLocation": ["autoDetect", "${workspaceFolder}"],
        "pattern": {
          "regexp": "^(.*):(\\d+):\\s*(warning|error):\\s*(.*)$",
          "file": 1,
          "line": 2,
          "severity": 3,
          "message": 4
        }
      },
      "presentation": {
        "panel": "dedicated",
        "focus": false,
        "showReuseMessage": false,
        "echo": true,
        "clear": true,
        "close": false,
        "reveal": "always",
        "revealProblems": "onProblem"
      },
      "group": {
        "kind": "build",
        "isDefault": true
      }
    },

```

**NOTE**: This supports any runtime-selected compiler. The `${command:spinExtension.getCompilerArguments}` call returns the correct compiler flags because the Spin2 extension knows which compiler is selected. The `"quoting": "weak"` setting ensures arguments containing spaces are handled correctly.

**NOTE2**: Requires a modified **pnut_shell.bat** file that reorders the given parameters.

#### Compile Project (Top-level File) for the P2

| Compiler | Command |
| --- | --- |
| | --- **Compile top-level file to binary** ---
| flexspin | `flexspin -2 -Wabs-paths -Wmax-errors=99 ${config:spin2.fNameTopLevel}`
| pnut | `pnut_shell.bat ${config:spin2.fNameTopLevel} -c`
| pnut_ts | `pnut_ts -c ${config:spin2.fNameTopLevel}`

This now translates into a single entry in the **user tasks** file:

```json
    {
      "label": "compileTopP2",
      "type": "shell",
      "command": "${config:spin2.fSpecCompiler}",
      "args": [
        {
          "value": "${command:spinExtension.getCompilerArguments}",
          "quoting": "weak"
        },
        "${config:spin2.fNameTopLevel}"
      ],
      "problemMatcher": {
        "owner": "Spin2",
        "fileLocation": ["autoDetect", "${workspaceFolder}"],
        "pattern": {
          "regexp": "^(.*):(\\d+):\\s*(warning|error):\\s*(.*)$",
          "file": 1,
          "line": 2,
          "severity": 3,
          "message": 4
        }
      },
      "presentation": {
        "panel": "dedicated",
        "focus": false,
        "showReuseMessage": false,
        "echo": true,
        "clear": true,
        "close": false,
        "reveal": "always",
        "revealProblems": "onProblem"
      },
      "group": {
        "kind": "build",
        "isDefault": true
      }
    },

```

**NOTE**: This supports any runtime-selected compiler. The `${command:spinExtension.getCompilerArguments}` call returns the correct compiler flags because the Spin2 extension knows which compiler is selected.

#### Download to P2 FLASH / RAM

| Compiler | Command |
| --- | --- |
| |--- **Download top-level binary** --- |
| flexspin to P2 RAM | `loadp2 -b115200  -t -p{port} ${config:spin2.fNameTopLevel}.binary`
| flexspin to P2 FLASH | `loadp2 -b115200  -t -p{port} @0={installDir}/board/P2ES_flashloader.bin,@8000+${config:spin2.fNameTopLevel}.binary`  -OR-<br>`loadp2 -b115200  -t -p{port} -SPI ${config:spin2.fNameTopLevel}.binary`
| flexspin to P1 RAM | `proploader -D baud-rate=115200 -rt -p{port} ${config:spin2.fNameTopLevel}.binary`
| flexspin to P1 FLASH | `proploader -D baud-rate=115200 -ert -p{port} ${config:spin2.fNameTopLevel}.binary`
| pnut to RAM | `pnut_shell.bat ${config:spin2.fNameTopLevel}.spin2 -r` <br>*NOTE: -r becomes -rd if debug() compile is specified. Also, port is autoselected, there is no control of port.*
| pnut to FLASH | `pnut_shell.bat ${config:spin2.fNameTopLevel}.spin2 -f` <br>*NOTE: -f becomes -fd if debug() compile is specified. Also, port is autoselected, there is no control of port.*
| pnut_ts to FLASH/RAM | *NOTE: The pnut_ts loader is built into the Spin2 Extension so is not represented in the Users Tasks file*

This now translates into a single entry in the **user tasks** file:

```json
    {
      "label": "downloadP2",
      "type": "shell",
      "command": "${config:spin2.fSpecLoader}",
      "args": [
        {
          "value": "${command:spinExtension.getLoaderArguments}",
          "quoting": "weak"
        },
        "${config:spin2.optionsBinaryFname}"
      ],
      "problemMatcher": {
        "owner": "Spin2",
        "fileLocation": ["autoDetect", "${workspaceFolder}"],
        "pattern": {
          "regexp": "^(.*):(\\d+):\\s*(warning|error):\\s*(.*)$",
          "file": 1,
          "line": 2,
          "severity": 3,
          "message": 4
        }
      },
      "presentation": {
        "panel": "dedicated",
        "focus": false,
        "showReuseMessage": false,
        "echo": true,
        "clear": true,
        "close": false,
        "reveal": "always",
        "revealProblems": "onProblem"
      },
      "group": {
        "kind": "test",
        "isDefault": true
      }
    }

```

**NOTE**: This supports any runtime-selected downloader as well as writing to RAM or FLASH. The `${command:spinExtension.getLoaderArguments}` and `${config:spin2.optionsBinaryFname}` calls make this possible because the Spin2 extension knows which loader is selected.

### Remove any Custom Keybindings

The Spin2 extension now provides built-in commands to run the tasks in the User-Tasks file. To prevent any interference you need to remove the custom keybindings for User Tasks that you may have put in place.

To remove any task-related custom keybindings, edit the `keybindings.json` file.

To get to this file type in **Ctrl+Shift+P** (Cmd+Shift+P on mac) to get to the command search dialog. Then type in "keyboard". Lower down in the resulting filtered list you should now see "**Preferences: Open Keyboard Shortcuts (JSON)**". Select it and you should now have a file open in the editor which may contain something like:

#### OLD Keybindings (remove these!):

```json
// Place your key bindings in this file to override the defaultsauto[ ]
[
  {
    "key": "ctrl+shift+d",
    "command": "workbench.action.tasks.runTask",
    "args": "downloadP2"
  },
  {
    "key": "ctrl+shift+f",
    "command": "workbench.action.tasks.runTask",
    "args": "flashP2"
  },
  {
    "key": "F8",
    "command": "workbench.action.tasks.build",
    "args": "compileP2"
  },
  {
    "key": "F10",
    "command": "workbench.action.tasks.runTask",
    "args": "downloadP2"
  },
  {
    "key": "F11",
    "command": "workbench.action.tasks.runTask",
    "args": "flashP2"
  }
]
```

All of the entries which contain a '...tasks.runTask' value are things we need to remove. When you remove any of our User-Task keybindings this file would end up looking like:

#### If all you had was our old bindings then your file is now:

```json
// Place your key bindings in this file to override the defaultsauto[...]
[ ]
```

If you happen to have some non-P2 bindings you can leave these in this file. **We remove any P2 bindings as they will interfere with the new build mechanism!**


### This build system on Windows requires an updated pnut_shell.bat

This build system generates parameters with switches first then filename. PNut wants these to be filename then switch values. The `pnut_shell.bat` script below reorders the options so PNut receives them in the correct order.

#### Updated pnut_shell.bat file:
```bat
@echo on
REM change above ON to OFF before FLIGHT
REM Initialize variables
set "SPINFILE="
set "OTHERARGS="
set ERROR_FILE=error.txt
set pnuterror=0

setlocal enabledelayedexpansion

 REM Check if %1, %2, or %3 is a .spin2 file
for %%a in (%1 %2 %3) do (
    if "%%~xa"==".spin2" (
        set "SPINFILE=%%~a"
    ) else (
        set "OTHERARGS=!OTHERARGS! %%~a"
    )
)

if "%spinfile%"=="" (
    echo "Error: Missing .spin2 filename in: %1 %2 %3" 1>&2
    set pnuterror=-1
    exit /b %pnuterror%
)

REM remove previous error file if present
if exist %ERROR_FILE% del /q /f %ERROR_FILE%

REM testing...
REM echo "given: %1 %2 %3"
REM echo "using: %SPINFILE% %OTHERARGS%"

REM if we have a file to compile or download, do so
if exist "%spinfile%" (
    REM always pass filename first, then arguments
    pnut_v52a %SPINFILE% %OTHERARGS%
    set pnuterror = %ERRORLEVEL%
    REM if error file was created, display usefull bits
    if exist %ERROR_FILE% (
        for /f "tokens=*" %%i in (%ERROR_FILE%) do echo %%i 1>&2
    )
 ) else (
    set pnuterror=-1
    echo "Error: File NOT found - %spinfile%" 1>&2
 )
 exit /b %pnuterror%


```

**NOTE**: The `pnut_v52a` value in this script is just an example. You MUST update it to match your exact PNut version (e.g., `pnut_v52a`, `pnut_v53`, etc.). If it doesn't match, the script will not work.


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
