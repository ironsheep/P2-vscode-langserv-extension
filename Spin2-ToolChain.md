# VSCode support for the Parallax Propeller 1 & 2 Multicore MCU's

![Project Maintenance][maintenance-shield]
[![License][license-shield]](LICENSE) 

## New Toolchain configuration and use

Currently the following compilers are runtime detected:

|  name | executable name | description |
| --- | --- | --- |
| flexspin | flexspin.exe, flexspin.mac, flexspin | Compiler provided by FlexProp by Total Spectrum Software, Inc. (Eric R. Smith) <br>**All Platforms**
| pnut | pnut_v99.exe | Compiler provided by Parallax.com. (Chip Gracey) <br>**Windows only**
| pnut_ts | pnut_ts | Compiler provided by Parallax.com, and Iron Sheep Productions, LLC. (Chip Gracey, and Stephen M. Moraco) <br>**All Platforms**

### Configuration Variables provided for User-Tasks use

| Name | Purpose | Set by |
| --- | --- | ---
| `topLevel` (deprecated) -or-<br>`spin2.fNameTopLevel ` | Filename of the top-level file in your workspace<br>NOTE `topLevel` was filename (without the .spin2 file extension)<br>While `fNameTopLevel` is filename.spin2 (with the extension) | Added **by-hand** during project setup. *This allows downloads to work even when your are not editing the top-level file!*
| `spin2.fSpecCompiler` |  Absolute path of the selected compiler for this workspace | Runtime discovered, set when user enters **compilerID** from list of runtime-discovered compilers
| `spin2.fSpecFlashBinary` | (**flexspin only**) Absolute path of the flashLoader binary for this workspace | Runtime discovered, set when user enters **compilerID** from list of runtime-discovered compilers 
| `spin2.fSpecLoader` | (**flexspin only**) Absolute path of the selected downloader for this workspace | Runtime discovered, set when user enters **compilerID** from list of runtime-discovered compilers 
| `spin2.serialPort` | Device Node name (or COM Port) of the selected serial port.|**Runtime discovered**, set when user selects the serial port by clicking on the **VSCode StatusBar** Icon
| `spin2.optionsBuild` **but use:** <br>`spinExtension.getCompileArguments` which formats the augument values correctly | Build options without the source filename | Set when user enters **compilerID** from list of runtime-discovered compilers 
| `spin2.optionsLoader` **but use:**<br>`spinExtension.getLoadArguments` which formats the augument values correctly| Additional command-line options passed to loader without the binary filename | Determined by settings (**compiler choice**) and latest state of FLASH/RAM selection on **VSCode StatusBar**
| `spin2.optionsBinaryFname` | The name of the **binary file** to be downloaded. <br>-In case of **pnut** the **spin2 file** to be compiled then downloaded.<br>- In case of **flexspin** this will also contain the full directive to load the **flash programming** utility if downloading to FLASH. | Determined by settings (**compiler choice**) and latest state of FLASH/RAM selection on **VSCode StatusBar**
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

This translates now translates into a single entry in the **user tasks** file:

```json
    {
        "label": "compileP2",
        "type": "shell",
        "command": "${config:spin2.fSpecCompiler}",
        "args": ["${command:spinExtension.getCompileArguments}","${fileBasename}"],
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
          "clear": true
        },
        "group": {
          "kind": "build",
          "isDefault": true
        }
   }

```

**NOTE**: This now supports any runtime selected compiler. The use of `${config:optionsBuild}` makes it possible since the spin2 extension knows what compiler is selected.

**NOTE2**: Requires a modified **pnut-shell.bat** file that reorders the given parameters.

#### Compile Project (Top-level File) for the P2

| Compiler | Command |
| --- | --- |
| | --- **Compile top-level file to binary** ---
| flexspin | `flexspin -2 -Wabs-paths -Wmax-errors=99 ${config:fNameTopLevel}`
| pnut | `pnut_shell.bat ${config:fNameTopLevel} -c`
| pnut_ts | `pnut_ts -c ${config:fNameTopLevel}`

This translates now translates into a single entry in the **user tasks** file:

```json
    {
        "label": "compileTopP2",
        "type": "shell",
        "command": "${config:spin2.fSpecCompiler}",
        "args": ["${command:spinExtension.getCompileArguments}", "${config:spin2.fNameTopLevel}"],
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
          "clear": true
        },
        "group": {
          "kind": "build",
          "isDefault": true
        }
      }

```

NOTE: This now supports any runtime selected compiler. The use of `${config:optionsBuild}` makes it possible since the spin2 extension knows what compiler is selected.

#### Download to P2 FLASH / RAM

| Compiler | Command |
| --- | --- |
| |--- **Download top-level binary** --- |
| flexspin to RAM | `loadp2 -b230400 ${config:fNameTopLevel}.binary -t -p{port}`
| flexspin to FLASH | `loadp2 -b230400 @0=/Applications/flexprop/board/P2ES_flashloader.bin,@8000+${config:fNameTopLevel}.binary -t -p{port}`
| pnut to RAM | `pnut_shell.bat ${config:fNameTopLevel}.spin2 -r` <br>*NOTE: -r becomes -rd if debug() compile is specified. Also, port is autoselected, there is no control of port.*
| pnut to FLASH | `pnut_shell.bat ${config:fNameTopLevel}.spin2 -f` <br>*NOTE: -f becomes -fd if debug() compile is specified. Also, port is autoselected, there is no control of port.*
| pnut_ts to FLASH/RAM | *NOTE: The pnut_ts loader is built into the Spin2 Extension so is not represented in the Users Tasks file*

This translates now translates into a single entry in the **user tasks** file:

```json
   {
        "label": "downloadP2",
        "type": "shell",
        "command": "${config:spin2.fSpecLoader}",
        "args": ["${command:spinExtension.getLoadArguments}", "${config:spin2.optionsBinaryFname}"],
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
          "clear": true
        },
        "group": {
          "kind": "test",
          "isDefault": true
        }
      }

```

NOTE: This now supports any runtime selected downloader as well as writing to RAM or FLASH. The use of `${config: optionsLoader}` and `${config:fNameTopLevelBinary}` makes it possible since the spin2 extension knows what loader is selected.

### Remove any Custom Keybindings

The Spin2 extension now provides built-in comamnds to run the tasks in the User-Tasks file. To prevent any interference we need to remove the custom keybindings for User Tasks that you may put in place.

To to remove any task-related custom key bindinds edit the `keybindings.json` file.

To get to this file type in **Ctrl+Shift+P** (Cmd+Shift+P on mac) to get to the command search dialog. Then type in "keyboard". Lower down in the resulting filtered list you should now see "**Preferences: Open Keyboard Shortcuts (JSON)**". Select it and you should now have a file open in the editor which may contain something like:

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

```json
// Place your key bindings in this file to override the defaultsauto[...]
[ ]
```


### This build system requires an updated pnut_shell.bat

This build system generates parameters with switches first then filename. PNut wants these to be filename then switch values. I've updated the `pnut_shell.bat` script which ships with PNut to always present the options to `pnut_v99.exe` in the desired order.

#### Updated pnut_shell.bat file:
```bat
@echo off
REM Initialize variables
set "SPINFILE="
set "OTHERARGS="
set ERROR_FILE=error.txt
set pnuterror=0

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
    exit %pnuterror%
)

REM remove previous error file if present
if exist %ERROR_FILE% del /q /f %ERROR_FILE%

REM if we have a file to compile or download, do so
if exist "%spinfile%" (
    REM always pass filename first, then arguments
    pnut_v43 %SPINFILE% %OTHERARGS%
    set pnuterror = %ERRORLEVEL%
    for /f "tokens=*" %%i in (%ERROR_FILE%) do echo %%i 1>&2
 ) else (
    set pnuterror=-1
    echo "Error: File NOT found - %spinfile%" 1>&2
 )
 exit %pnuterror%

```

I'll have Chip distribute this version with all pnut distributions for here on out (replacing the old one.)


## License

Licensed under the MIT License. 

Follow these links for more information:

### [Copyright](copyright) | [License](LICENSE)

[maintenance-shield]: https://img.shields.io/badge/maintainer-stephen%40ironsheep%2ebiz-blue.svg?style=for-the-badge

[marketplace-version]: https://vsmarketplacebadge.apphb.com/version-short/ironsheepproductionsllc.spin2.svg

[marketplace-installs]: https://vsmarketplacebadge.apphb.com/installs-short/ironsheepproductionsllc.spin2.svg

[marketplace-rating]: https://vsmarketplacebadge.apphb.com/rating-short/ironsheepproductionsllc.spin2.svg

[license-shield]: https://img.shields.io/badge/License-MIT-yellow.svg

[Release-shield]: https://img.shields.io/github/release/ironsheep/P2-vscode-extensions/all.svg

[Issues-shield]: https://img.shields.io/github/issues/ironsheep/P2-vscode-extensions.svg
