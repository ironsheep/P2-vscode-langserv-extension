# VSCode - User-wide defined Tasks (macOS)


![Project Maintenance][maintenance-shield]

[![License][license-shield]](LICENSE)

**NOTE**: This page describes creating tasks **common to all of your projects/workspaces**. If, instead, you wish to have your P2 compile and download tasks unique to each your projects then go to the [Project Tasks](TASKS.md) page.

## Automating Build and Download to our P2 development boards

This document is being developed over time as we prove out a working macOS environment. 

To date, we have installations, compilation, and downloading from **[Windows](TASKS_USer.md)**, **MacOS** (this page), and **[RaspiOS](TASKS_USer.md)** (the Raspberry Pi OS - a Debian-derived distribution).

Also, to date, we have building and download for **flexprop**, **PNut-TS**, **PNut-Term-TS**, and **PNut** (*PNut is Windows or Windows Emulator only.*) with direct USB-attached boards.

In the future, we are also expecting to document building and download with via Wifi with the Wx boards attached to our development board, and with more compilers as they come ready for multi-platform use, etc.

## Table of Contents

On this Page:

- [VSCode development of P2 Projects](#vscode-development-of-p2-projects) - basic development life-cycle
- [P2 Code Development with FlexProp](#enabling-p2-code-development-with-flexprop-on-macos) - setting up
- [Being consistent in your machine configuration](#being-consistent-in-your-machine-configuration) - why we are doing things this way
- [Installation and Setup](#development-machine-setup-and-configuration) - preparing your machine for P2 development using tools from within vscode
  - [Installing FlexProp](#installing-flexprop-on-macos)
  - [Installing PNut-TS](#installing-pnut-ts-on-macos)
  - [Installing PNut-Term-TS](#installing-pnut-term-ts-on-macos)
- [Tasks in VScode](#tasks-in-vscode) - this provides more detail about VSCode tasks and lists work that is still needing to be done 
  - [Adding the P2 Tasks](#adding-the-p2-tasks)
  - [Adding our Custom Keybindings](#custom-keybindings)
  - [Adding our notion of Top-level file for tasks to use](#adding-our-notion-of-top-level-file-for-tasks-to-use)

Additional pages:

- [TOP Level README](README.md) - Back to the top page of this repo
- [Migrate to v2.3.0](Migrate-v230.md) - checklist to ensure you have migrated to our latest configuration, which supports locating installed compilers and compiling and downloading with any of the installed compilers to your USB-attached P2
- [Setup focused on Windows only](TASKS-User-win.md) - All **Windows** notes 
- [Setup focused on RPi only](TASKS-User-RPi.md) - All **Raspberry Pi** notes 
- [VSCode REF: Tasks](https://code.visualstudio.com/docs/editor/tasks) - Offsite: VSCode Documentation for reference

**NOTE:** _The "P2 Code Development..." sections below provide step-by-step setup instructions_

### Latest Updates

```
Latest Updates:
09 Nov 2025
- Added PNut-Term-TS installation section
17 May 2025
- Adjusted Tasks content
01 May 2025
- Adjusted PNut-TS installation section
31 Aug 2024
- Add PNut-TS notes and installation
- 12 Jun 2024
- Updated to reflect the new Spin2 Extension built-in compile/download support
18 Jul 2023
- Misc updates to keep these pages in sync
15 Mar 2023
- Created this file from TASKS-User.md
```

## VSCode development of P2 Projects

By choosing to adopt the Custom Tasks described in this document, along with the keybindings, your workflow is now quite sweet.

- Create a new project
- Add existing files you have already created or are using from P2 Obex.
- Create your new top-level file.
- Add `{project}/.vscode/settings.json` file to identify the top-level file for the build tasks.

Iterate until your project works as desired:

- Make changes to file(s)
- Compile the files to see if they compile cleanly (cmd-shift-B) on whichever file you are editing
- Once the files compile cleanly
- Download and test (ctrl-shift-D, F10) 
- Alternatively, download your project to FLASH and test (ctrl-shift-F, F11) 

## Enabling P2 Code Development with FlexProp on macOS

To complete your setup so you can use FlexProp on your Mac under VSCode you'll need to:

One time:

- Install FlexProp for all users to use on your Mac
- Add our tasks to the user tasks.json file (*works across all your P2 projects*)</br>(*NOTE: there is no longer any tool-path informaton in this file!*)
- Remove any old compile/download keybindings you may have.
- Optionally add a couple of VSCode extensions if you wish to have the features I demonstrated
    - "[Error Lens](https://marketplace.visualstudio.com/items?itemName=usernamehw.errorlens)" which adds the compile error messages to the associated line of code
    - "[Explorer Exclude](https://marketplace.visualstudio.com/items?itemName=PeterSchmalfeldt.explorer-exclude)" which allows you to hide file types (e.g., .p2asm, .binary) from the explorer panel

For each P2 Project:

- Install a settings.json file identifying the project top-level file
    - Make sure the name of your top-level file is correctly placed in this settings.json file

## Enabling P2 Code Development with PNut-TS on macOS

Additionally, you can use PNut-TS on your Mac under VSCode you'll need to:

One time:

- Install PNut-TS for all users to use on your Mac
- Add our tasks to the user tasks.json file (*works across all your P2 projects*)
- Remove any old compile/download keybindings you may have.
- Optionally add a couple of VSCode extensions if you wish to have the features I demonstrated
    - "[Error Lens](https://marketplace.visualstudio.com/items?itemName=usernamehw.errorlens)" which adds the compile error messages to the associated line of code
    - "[Explorer Exclude](https://marketplace.visualstudio.com/items?itemName=PeterSchmalfeldt.explorer-exclude)" which allows you to hide file types (e.g., .p2asm, .binary) from the explorer panel

For each P2 Project:

- Install a settings.json file identifying the project top-level file
    - Make sure the name of your top-level file is correctly placed in this settings.json file

## Enabling P2 Code Download and Debugging with PNut-Term-TS on macOS

To complete your setup so you can use PNut-Term-TS on your Mac under VSCode you'll need to:

One time:

- Install PNut-Term-TS for all users to use on your Mac

*The spin2 extension for VSCode will automatically see and use PNut-Term-TS when you select the PNut-TS compiler.*

## Being consistent in your machine configuration

I have mostly Macs for development, but I also have a Windows machine and a number of Raspberry Pis (derived from the Debian Linux distro), and even some larger Ubuntu Machines (also derived from the Debian Linux distro).  If you, like me, intend to be able to run VSCode on many of your development machines and you want to make your life easier, then there are a couple of things we know already that can help you.

- **Synchronize your VSCode settings and extensions** automatically by installing and using the **Settings Sync** VSCode extension. Any changes you make to one machine then will be sync'd to your other VScode machines.

- **Be very consistent in where you install tools** for each type of OS. (e.g., for all Windows machines, make sure you install FlexProp, PNut-TS, and PNut in the same location on each Windows machine.) By being consistent, your tasks will run no matter which machine you are running on.
There is nothing worse than trying to remember where you installed a specific tool on the machine you are currently logged into. Because you install say FlexProp in the same place on all your Raspberry Pi's you will know where to find it no matter which RPi you are logged in to.

    - All like operating systems should have a specific tool installed in the same location on each. (e.g., all Windows machines have FlexProp installed in one location, all macOS machines have FlexProp installed in a different location than on Windows but it is the same location across all Macs, etc.)
    - During installation of a tool on a machine, finish the process by configuring the PATH to the tool so that terminals/consoles can access the tool by name. This allows VSCode to run the tool from its build tasks.json file without needing to know where the tool is installed!  On Windows machines, this is done by editing the User Environment from within the Settings Application. On Mac's and Linux machines (RPi's) this is done by editing the shell configuration file (e.g., Bash, you edit the ~/.bashrc file)

## Development Machine Setup and Configuration

### Installing FlexProp on macOS

On MacOS machines, we get the latest binaries by downloading a `flexprop-{version}.zip` file from the [FlexProp Releases Page](https://github.com/totalspectrum/flexprop/releases) and unpacking the zip file to produce a `flexprop` folder containing the new version.  

**NOTE**: *The FlexProp toolset does not have a standard install location. So we will likely have many locations amongst all of us P2 users.  You have to take note of where you installed it and then adjust the following examples to point to where your binaries ended up on your file system.  Alternatively, it should be safe to just follow what I do in these instructions explicitly.  This has the benefit that more of us will be able to help each other out with tool problems as more of us will be set up the same.*

Next, we move this new version into place.

#### Install FlexProp

On my Mac's, I install the FlexProp into a folder which I've created at `/Applications/flexprop` and I [set the PATH](#os-macos) to point to the `/Applications/flexprop/bin` directory. I move all of the content of the `flexprop` folder (created during the unzip) to the `/Applications/flexprop` folder. 

#### Update FlexProp

If I'm updating to a new version I do the following:

- Remove `/Applications/flexprop-prior`
- Rename the `/Applications/flexprop` to `/Applications/flexprop-prior` 
- Create a new empty `/Applications/flexprop` folder
- Move all of the content of the `flexprop` folder (created during the unzip) to the `/Applications/flexprop` folder

**NOTE:** We use this move-aside technique for updating the FlexProp compiler.  When a language compiler is updated more frequently it is not uncommon to one or twice a year experience a breaking change in how the new compiler handles your existing code.  Assuming the version you are moving aside works well against all your projects, we move it aside and install the new version. Should you find that the new version doesn't work well against one of your projects, you will still have the prior version, so you can build the project with the older version that would fail with the new version.  *You can always skip this move-aside step if you don't care about this issue.*

### Installing PNut-TS on macOS

#### (Hopefully Temporary) Install of Node.js runtime

The packaging o PNut-TS for macOS for some reason, doesn't run (I'm working to understand this.) So, as a workaround, we install a Node.js runtime so we can run our compiler.

To see if you have Node.js installed (or to check what version you have installed) run:

```bash
$ node -v
v20.17.0   # output on author's Mac
$
```

If you don't have it installed, then visit [Download Node.js®](https://nodejs.org/en/download/prebuilt-installer) and download the installer appropriate to your Mac Processor. For example, I run Apple Silicon and I've tested with v20.17.0 (LTS) on macOS running Arm64, and it just works. This installs in `/usr/local/bin/` so you will want to make sure `/usr/local/bin/` is in your PATH.  Check this with:

```bash
$ whereis node
node: /usr/local/bin/node /usr/local/share/man/man1/node.1   # output on author's Mac
$
```

Once you have a node running and it's found in your PATH, then you can proceed with installing PNut-TS.

#### Now installing PNut-TS

On MacOS  machines we get the latest binaries by downloading a `{os-arch}.zip` file from the [PNut-TS Releases](https://github.com/ironsheep/PNut-TS/releases) page under the [Assets] dropdown and upacking the zip file to produce a .dmg install image.  

We double-click on the .dmg file to mount it. It opens a window, then, in the window, we drag the pnut_ts/ folder into the /Applications folder. Then the close the window and eject (unmount) the installer .dmg file.

#### Install PNut-TS

Architecture specific PNut-TS .zip files available for MacOS:

| Archive Name | Operating System | Architecture | Unpack Leaves
| --- | --- | --- | --- |
| pnut-ts-macos-arm64-{MMmmpp}.zip| MacOS | Arm 64 bit | pnut_ts/
| pnut-ts-macos-x64-{MMmmpp}.zip| MacOS | Intel x86-64 bit | pnut_ts/

**NOTE:** *where -MMmmpp is the release verison. (E.g., -014303.zip means v1.43.3.)*

Get the latest binaries by downloading a `pnut-ts-{os-arch}-{MMmmpp}.zip` file from the [PNut-TS Releases](https://github.com/ironsheep/PNut-TS/releases) page under the [Assets] dropdown.

If you have an intel-based mac then get the x64 .zip file, if you have an Apple-silicon-based make then get the arm64 .zip file.

- Once you have your selected .zip file then double click on it to extract the pnut_ts/ folder.
- In a finder window, drag the new pnut_ts/ folder to the Applications folder.
- Close this window

#### Update PNut-TS

If I'm updating to a new version I do the following:

- Get the latest binaries by downloading a `pnut-ts-{os-arch}-{MMmmpp}.zip` file from the [PNut-TS Releases](https://github.com/ironsheep/PNut-TS/releases) page under the [Assets] dropdown.
- Double-click on the .zip file to extract the pnut_ts/ folder.
- Remove the `/Applications/pnut_ts-prior` folder (move to trash)
- Rename the `/Applications/pnut_ts` folder to `/Applications/pnut_ts-prior` 
- In a Finder window, drag the new pnut_ts/ folder to the /Applications folder.
- Close this finder window

**NOTE:** We use this move-aside technique for updating the PNut-TS compiler.  When a language compiler is updated more frequently it is not uncommon to one or twice a year experience a breaking change in how the new compiler handles your existing code.  Assuming the version you are moving aside works well against all your projects, we move it aside and install the new version. Should you find that the new version doesn't work well against one of your projects you will still have the prior version so you can build the project with the older version that would fail with the new version.  *You can always skip this move-aside step if you don't care about this issue.*

### Installing PNut-Term-TS on macOS

On MacOS machines, we get the latest binaries by downloading a `pnut-term-ts-{os-arch}-{MMmmpp}.zip` file from the [PNut-Term-TS Releases](https://github.com/ironsheep/PNut-Term-TS/releases) page under the [Assets] dropdown and unpacking the zip file to produce a .dmg install image. 
 
If you have an Intel-based Mac, then get the x64 .zip file; if you have an Apple Silicon-based Mac, then get the arm64 .zip file.

Once you have your selected .zip file then double click on it to extract the pnut-term-ts-{os-arch}-{MMmmpp}.dmg file.

#### Install PNut-Term-TS

Initial installation is easy. Open the .dmg file, then drag the app into the Applications folder, then unmount the .dmg.

- Double-click on the .dmg file to mount it. It opens a window
- In the window, drag the pnut_term_ts.app icon into the /Applications folder.
- Close the .dmg window
- Eject (unmount) the installer .dmg file.

#### Update PNut-Term-TS

### Setting paths for your P2 Compilers/Tools on macOS

On macOS, this is really shell-dependent. I tend to stick with [Bash](https://www.gnu.org/software/bash/manual/html_node/Introduction.html) as I've used it for many 10s of years now.  [zsh](https://scriptingosx.com/2019/06/moving-to-zsh/) (ZShell) is the new shell on the block (*well, new to Mac's, not a new shell*). I avoided moving to it, but the concepts are the same.

On my Macs, I install the flexprop folder into my /Applications folder.  I then edit my .bash_profile and add the following line.  (*I have multiple lines such as this for various tools I've installed.*)

```bash
export PATH=${PATH}:/Applications/flexprop/bin:/Applications/flexprop
```

If I have installed PNut-TS, then I also add its path:

```bash
export PATH=${PATH}:/Applications/pnut_ts
```

From here on, when I start new terminal windows, we can invoke the flexprop binaries by name without using the path to them.

If I have installed PNut-Term-TS, then I also add its path:

```bash
export PATH=${PATH}:/Applications/PNut-Term-TS.app
```

From here on, when I start new terminal windows, we can invoke the flexprop, pnut-ts, and pnut-term-ts binaries by name without using the path to them.

**NOTE:** The executable is named `pnut-ts`. For backwards compatibility, a `pnut_ts` alias is also provided, so existing scripts will continue to work.

## Tasks in VSCode

A Task is how we integrate with External tools in VSCode.

See: [VSCode "Tasks" Reference Page](https://code.visualstudio.com/docs/editor/tasks)

There are a number of types of tasks and places Task definitions live. These include [Auto-detected Tasks](https://code.visualstudio.com/docs/editor/tasks#_task-autodetection), [User level tasks](https://code.visualstudio.com/docs/editor/tasks#_user-level-tasks), and [Custom Tasks](https://code.visualstudio.com/docs/editor/tasks#_custom-tasks).  Tasks when run, can be crafted to depend upon the running of other tasks  See: [Compound Tasks](https://code.visualstudio.com/docs/editor/tasks#_compound-tasks)  Some tasks can be [run in background](https://code.visualstudio.com/docs/editor/tasks#_background-watching-tasks) such as file watchers which execute when a file has been changed.

When you run VScode on multiple operating systems and want to be able to run a projects tasks on whichever machine you are on then you can specify os-specific alternatives to be used withing the task. See [Operating system specific properties](https://code.visualstudio.com/docs/editor/tasks#_operating-system-specific-properties)

Another VSCode mechanism we are determining if it will be useful is the: [Task Provider Extension](https://code.visualstudio.com/api/extension-guides/task-provider). If we find this is useful we can add a Task Provder element to our existing extension in order to facilitate our updating task files we use for P1 and P2 development.

...More TBA...

### Invoking tasks

Tasks can be invoked with the search, identify, run technique or they can have keyboard shortcuts assigned to them.  

A project can have a single default build task which is, by default, invoked with command-shift-B. 

We'll configure our compileP2 task to be the default.

We'll add a downloadP2 task and assign command-shift-D to it. It will depend upon the compile task which makes it run first and then we download the newly compiled result.

We'll add a flashP2 task and assign command-shift-F to it. It will depend upon the compile task which makes it run first and then we download the newly compiled result and write it to FLASH.

**TODO-1**: We need to ensure download or flash doesn't proceed if compile fails

#### More Advanced building

**TODO-2**: We'll also test using the file-watch technology to automatically compile and download our project files when they are modified.

### Adding the P2 Tasks

To define the tasks we are going to use with our P2 development in most of our projects we place the task definitions in a central "User Tasks" .json file. 

To get to this file type in **Ctrl+Shift+P** (Cmd+Shift+P on mac) to get to the command search dialog. Then type in "tasks". Lower down in the resulting filtered list you should now see "**Tasks: Open User Tasks**". If prompted for a **Task Template**, select **Others**. Select it and you should now have a file open in the editor which should contain at least:

```json
{
  // See https://go.microsoft.com/fwlink/?LinkId=733558
  // for the documentation about the tasks.json format
  "version": "2.0.0",
  "tasks": [
  ]
}
```

 In between the [] you can place your new task definitions. You should end up with something like:

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

- CompileP2 - Compile current file 
- CompileTopP2 - Compile the top-file of this project

Under **Task: Run Test Task**: 

- DownloadP2 - Download the binary to RAM in our connected P2

As written, **downloadP2** for flexpsin will always be preceeded by a compileTopP2.


### Custom Keybindings

This new build system no longer uses custom keybindings. However, when migrating from the older build support we used you should remove any older P2 related keybindings as they can interfere with correct operation of the new build support.

The custom key bindings are found in the `keybindings.json` file. 

To get to this file type in **Ctrl+Shift+P** (Cmd+Shift+P on mac) to get to the command search dialog. Then type in "keyboard". Lower down in the resulting filtered list you should now see "**Preferences: Open Keyboard Shortcuts (JSON)**".  Select it and you should now have a file open in the editor which should contain something like:

```json
// Place your key bindings in this file to override the defaultsauto[]
[
]
```

**NOTE**: If you find entries like the following, then they need to be **removed**.
 
```json

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

```

If you still want to use these keys for build shortcuts, then you should remove the entries, and interactively specify keystrokes in the **Keyboard Shortcuts** editor. It will make entries that are correct for the new build system.


### Adding our notion of Top-level file for tasks to use

In order to support our notion of top-level file and to prevent us from occassionally compiling and downloading a file other than the project top-level file we've adopted the notion of adding a CompileTopP2 build task a DownloadP2 download task, and in some cases a FlashP2 task.

When we request a download or flash the automation will first compile the top-level project source which produces a new binary. It is this new binary that will be downloaded/flashed.

We have multiple tasks that need to know the name of our top-level file. So we add a new settings file with a topLevel value to our project:

**.vscode/settings.json** file contains the following contents:

```json
{
   "topLevel": "jm_p2-es_matrix_control_demo",
}

```

Once we have this file in place, then our `tasks.json` file can access this value using the form: `${config:topLevel}`


Now our **CompileTopP2** task can create the toplevel filename using  `${config:topLevel}.spin2`

You need to find the line containing "jm\_p2-es\_matrix\_control\_demo" and replace this name with the name of your top-level file. 

And our **DownloadP2** task can reference the binary file using `${config:topLevel}.binary`

## License

Licensed under the MIT License. 

Follow these links for more information:

### [Copyright](copyright) | [License](LICENSE)



[maintenance-shield]: https://img.shields.io/badge/maintainer-stephen%40ironsheep%2ebiz-blue.svg?style=for-the-badge

[license-shield]: https://img.shields.io/badge/License-MIT-yellow.svg

