# VSCode support for the Parallax Propeller 1 & 2 Multicore MCU's

![Project Maintenance][maintenance-shield]
[![License][license-shield]](LICENSE) 

# Migrate from v2.2.x to v2.3.0

The old user-tasks file and the old keyboard bindings should work with the setting: `Spin Extension->Toolchain->Advanced:Enable` **unchecked**.  By default this setting is unchecked (Disabled.)

However, to use the new Spin2 advanced toolchain features you will want to enable this setting.  The remainder of this page walks you through making these changes.

## Migration overview

Adjustng your configuraation to work well with Spin2 v2.3.0 is both simple and required.  The old user-tasks file just won't work and the old keyboard bindings also no-longer work. Fortunately adjusting your environment to work with the new ToolChain support is quick and easy and should be a one-time event for you.

Ajusting your environment:

1. Enable the Propeller 2 Advanced toolchain features: by clicking `Spin Extension->Toolchain->Advanced:Enable`  
1. Replace your user-tasks file: **Tasks: Open User Tasks**
1. Remove your existing keyboard bindings: **Preferences: Open Keyboard Shortcuts (JSON)**
1. Ensure your compiler(s) has/have been located correctly
1. (PNut on Windows users) Replace the pnut_shell.bat file with new version (If your distribution has the old one)


Once this is done, then you are ready to continue developing for the P2 as you were before. Additionally, compile and download to your P2 should be much more simple.

You can also now toggle debug() on/off as well as toggle download to RAM / FLASH with simple keystrokes. (Enable listing output is still in extension settings.)

## 2. Replace your user tasks file

The tasks we use with our P2 development live in the central "User Tasks" .json file. 

To get to this file type in **Ctrl+Shift+P** (Cmd+Shift+P on mac) to get to the command search dialog. Then type in "tasks". Lower down in the resulting filtered list you should now see "**Tasks: Open User Tasks**". If prompted for a Task Template, select Others. Select it and you should now have a file open in the editor which should contain at least:


```json
{
  // See https://go.microsoft.com/fwlink/?LinkId=733558
  // for the documentation about the tasks.json format
  "version": "2.0.0",
  "tasks": [
  ]
}
```

If you have anything else in this file pertaining to P2 development then you want to replace the P2 portion of the file content with:

```json
{
        // See https://go.microsoft.com/fwlink/?LinkId=733558
        // for the documentation about the tasks.json format
        "version": "2.0.0",
        "tasks": [
          {
            "label": "compileP2",
            "type": "shell",
            "command": "${config:spin2.fSpecCompiler}",
            "args": [
              {
                "value": "${command:spinExtension.getCompArguments}",
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
          {
            "label": "compileTopP2",
            "type": "shell",
            "command": "${config:spin2.fSpecCompiler}",
            "args": [
              {
                "value": "${command:spinExtension.getCompArguments}",
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
        ]
      }
```

This provides the following **Build** and **Test** tasks:

Under **Task: Run Build Task**: 

- CompileP2 - Compile current file (w/debug() on/off)
- CompileTopP2 - Compile the top-file of this project (w/debug() on/off)

Under **Task: Run Test Task**: 

- DownloadP2 - Download the binary to RAM in our connected P2 (to RAM/FLASH)

As written, **downloadP2** for flexpsin will always be preceeded by a compileTopP2.

**NOTE**: This now supports any runtime selected compiler. The use of `${command:spinExtension.getCompArguments}` makes it possible since the spin2 extension knows what compiler is selected.  Likewise, the use of `${command:spinExtension.getLoaderArguments}` make it possible to select a download tool from among those installed.  *Although initially we are only using the built-in downloader as we are still working out issues with the downloaders.*


## 3. Remove any P2 Custom Keybindings

The Spin2 extension now provides built-in comamnds to run the tasks in the User-Tasks file. To prevent any interference we need to remove the custom keybindings for User Tasks that you may put in place.

To to remove any task-related custom key bindinds edit the `keybindings.json` file.

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

```json
// Place your key bindings in this file to override the defaultsauto[...]
[ ]
```

If you happen to have some non-P2 bindings you can leave these in this file. **We remove any P2 bindings as they will interfere with the new build mechanism!**

## 4. Ensure your compiler has been located correctly

The Spin2 extension now has automatic toolset discovery. Once the compilers have been discovered then you choose which compiler to use for all of your P2 projects. You can then also override this setting for any project you wish to use another of your installed compilers. 

To validate that you can build P2 code let's review the Spin2 Exension settings. There's a new page of setting where the compilers found are listed. Let's open `Settings -> Extensions -> Spin2 -> Spin/Spin2 ToolChain Configuration`. At the top of this settings page you'll see a list of **Installations Found**.  If you have flexspin installed, you should see flexspin in this list. Likewise, if you are on Windows and you have a version of PNut (say PNut_v43 installed) then you should see PNut installed.

If you don't see all the compilers in this list then you want to adjust the installations so that they can be found before proceeding!  For installation instructions you will need to refer to:

1. [Machine Setup and Configuration Windows](https://github.com/ironsheep/P2-vscode-langserv-extension/blob/main/TASKS-User-win.md#development-machine-setup-and-configuration) 
1. [Machine Setup and Configuration MacOS](https://github.com/ironsheep/P2-vscode-langserv-extension/blob/main/TASKS-User-macOS.md#development-machine-setup-and-configuration) 
1. [Machine Setup and Configuration RPi/Linux](https://github.com/ironsheep/P2-vscode-langserv-extension/blob/main/TASKS-User-RPi.md#development-machine-setup-and-configuration) 

If you see all of your compilers then you are ready to move on to Step 4 (or you are done if you are not on windows.)

## 5. New build system on Windows requires an updated pnut_shell.bat

This build system generates parameters with switches first then filename. PNut wants these to be filename then switch values. I've updated the `pnut_shell.bat` script which ships with PNut to always present the options to `pnut_v99.exe` in the desired order.

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
    pnut_v43 %SPINFILE% %OTHERARGS%
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

I'll have Chip distribute this version with all pnut distributions for here on out (replacing the old one.)

**NOTE**: The `pnut_v43` value in this new file MUST match your exact PNut version! If is does not then this script will NOT work!  Please edit this file if it doesn't match.

## Congratulations

That's it you should be ready to use all compilers on your plaform to build, download and run P2 code using VSCode.

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
