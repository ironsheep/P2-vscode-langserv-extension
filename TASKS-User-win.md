# VSCode - User-wide defined Tasks (Windows)

![Project Maintenance][maintenance-shield]

[![License][license-shield]](LICENSE)

**NOTE**: This page describes creating tasks **common to all of your projects/workspaces**. If, instead, you wish to have your P2 compile and download tasks unique to each your projects then go to the [Project Tasks](TASKS.md) page.

## Automating Build and Download to our P2 development boards

This document is being developed over time as we prove-out a working environment for Windows.

To date, we have installations, compilation and downloading from **Windows** (_this page_), [**MacOS**](TASKS-User-macOS.md), and [**RaspiOS**](TASKS-User.md) (the Raspberry Pi OS - a Debian derived distribution).

Also, to date, we have building and download for **flexprop** and **PNut** (*PNut is windows or windows emulator only.*) with direct USB-attached boards.

In the future, we are also expecting to document building and download with via Wifi with the Wx boards attached to our development board, and with more compilers as they come ready for multi-platform use, etc.

## Table of Contents

On this Page:

- [VSCode development of P2 Projects](#vscode-development-of-p2-projects) - basic development life-cycle
- [P2 Code Development with FlexProp](#enabling-p2-code-development-with-flexprop) - setting up
- [P2 Code Development with PNut](#enabling-p2-code-development-with-pnut) - setting up
- [Being consistent in your machine configuration](#being-consistent-in-your-machine-configuration) - why we are doing things this way
- [Installation and Setup](#development-machine-setup-and-configuration) - preparing your machine for P2 development using tools from within vscode
  - [Installing FlexProp](#installing-flexprop)
  - [Installing PNut](#installing-pnut)
- [Tasks in VScode](#tasks-in-vscode) - this provides more detail about vscode tasks and lists work that is still needing to be done
  - [Adding the P2 Tasks](#adding-the-p2-tasks)
  - [Adding our Custom Keybindings](#adding-our-custom-keybindings)
  - [Adding our notion of Top-level file for tasks to use](#adding-our-notion-of-top-level-file-for-tasks-to-use)

Additional pages:

- [TOP Level README](README.md) - Back to the top page of this repo
- [Setup focused on macOS only](TASKS-User-macOS.md) - All **macOS** notes 
- [Setup focused on RPi only](TASKS-User-RPi.md) - All **Raspberry Pi** notes 
- [VSCode REF: Tasks](https://code.visualstudio.com/docs/editor/tasks) - Offsite: VSCode Documentation for reference

**NOTE:** _The "P2 Code Development..." sections below provide step-by-step setup instructions_

### Latest Updates

```text
Latest Updates:
18 Jul 2023
- Adopting formal install locations
- Made FlexProp and PNut setup the same steps for each
10 Apr 2023
- Awakened this Windows-specific setup page
```

## VSCode development of P2 Projects

By choosing to adopt the Custom Tasks described in this document along with the keybindings your work flow is now quite sweet.

- Create a new project
- Add existing files you have already created or are using from P2 Obex.
- Create your new top-level file.
- Add `{project}/.vscode/settings.json` file to identify the top-level file for the build tasks.

Iterate until your project works as desired:

- Make changes to file(s)
- Compile the files to see if they compile cleanly (cmd-shift-B) on which ever file you are editing
- Once the files compile cleanly
- Download and test (ctrl-shift-D, F10) [if you use keybindings shown in examples on this page]
- Alternatively, download your project to FLASH and test (ctrl-shift-F, F11) [if you use keybindings shown in examples on this page]

## Enabling P2 Code Development with FlexProp

To complete your setup so you can use FlexProp on your Windows machine under VScode you'll need to:

One time:

- Install FlexProp for all users to use on your windows machine
- Add our tasks to the user tasks.json file (_works across all your P2 projects_)</br>(_Make sure the paths to your compiler and loader binaries are correct_)
- Install our common keybinding (works across all your P2 projects)
- Optionally add a couple of VSCode extensions if you wish to have the features I demonstrated
  - "[Error Lens](https://marketplace.visualstudio.com/items?itemName=usernamehw.errorlens)" which adds the compile errors messages to the associated line of code
  - "[Explorer Exclude](https://marketplace.visualstudio.com/items?itemName=PeterSchmalfeldt.explorer-exclude)" which allows you to hide file types (e.g., .p2asm, .binary) from the explorer panel

For each P2 Project:

- Install a settings.json file identifying the project top-level file
  - Make sure the name of your top-level file is correctly placed in this settings.json file

## Enabling P2 Code Development with PNut

To complete your setup so you can use PNut on your Windows machine under VScode you'll need to install PNut and then:

One time:

- Install a tasks.json file (_works across all your P2 projects_)
  - _Make sure the names of your compiler and loader binaries are correct (we use the .bat file to run PNut, we don't refer to PNut.exe directly!)_
- Install a common keybinding (_works across all your P2 projects_)
- Optionally add a couple of VSCode extensions if you wish to have the features I demonstrated
  - "[Error Lens](https://marketplace.visualstudio.com/items?itemName=usernamehw.errorlens)" which adds the compile errors messages to the associated line of code
  - "[Explorer Exclude](https://marketplace.visualstudio.com/items?itemName=PeterSchmalfeldt.explorer-exclude)" which allows you to hide file types (e.g., .p2asm, .binary) from the explorer panel

For each P2 Project:

- Install a settings.json file identifying the project top-level file
  - Make sure the name of your top-level file is correctly placed in this settings.json file

## Being consistent in your machine configuration

I have mostly macs for development but I also have a Windows machine and a number of Raspberry PIs (derived from Debian Linux Distribution (distro.)) and even some larger Ubuntu Machines (also derived from Debian Linux distro.). If you, like me, intend to be able to run VSCode on many of your development machines and you want to make your life easier then there are a couple of things we know already that can help you.

- **Synchronize your VSCode settings and extensions** automatically by installing and using the **Settings Sync** VScode extension. Any changes you make to one machine then will be sync'd to your other VScode machines.

- **Be very consistent in where you install tools** for each type of OS. (e.g., for all Windows machines make sure you install say, FlexProp, in the same location on each Windows machine.) By being consistent your tasks will run no matter which machine your are running on.
  There is nothing worse than trying to remember where you installed a specific tool on the machine you are currently logged into. Because you install say FlexProp in the same place on all your Raspberry Pi's you will know where to find it no matter which RPi you are logged in to.

  - All like operating systems should have a specific tool installed in the same location on each. (e.g., all Windows machines have FlexProp installed in one location, all macOS machines have FlexProp installed in a different location that on Windows but it is the same location across all Macs, etc.)
  - During the first-time installation of a tool on a machine, finish the process by configuring the PATH to the tool so that terminals/consoles can access the tool by name. This allows VSCode to run the tool from its build tasks.json file without needing to know where the tool is installed! On Windows machines this is done by editing the User Environment PATH variable from within the Settings Application. On Mac's and Linux machines (RPi's) this is done by editing the shell configuration file (e.g., Bash you edit the ~/.bashrc file) and adjusting the `export PATH=...` line/lines.

## Development Machine Setup and Configuration

### Installing FlexProp

On Windows machines we get the latest binaries by downloading a `flexprop-{version}.zip` file from the [FlexProp Releases Page](https://github.com/totalspectrum/flexprop/releases) and unpacking the zip file to produce a `FlexProp` folder containing the new version.

**NOTE**: _The FlexProp tool-set does not have a standard install location. So we will likely have many locations amongst all of us P2 users. You have to take note of where you installed it and then adjust the following examples to point to where your binaries ended up on your file system. Alternatively, it should be safe to just follow what I do in these instructions explicitly. This has the benefit that more of us will be able to help each other out with tools problems as more of us will be set up the same._

Next we move this new version into place.

### Setup and Configure for P2 development

[**Optional**] if you want to remote into your windows machine from a another desktop running VSCode on your network then you want to install OpenSSH client and server by following: [Install OpenSSH](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse?tabs=gui).

#### Install FlexProp

Get the latest binaries by downloading a `flexprop-{version}.zip` file from the [FlexProp Releases Page](https://github.com/totalspectrum/flexprop/releases).

We are making a new program install location in these steps. We can't use `C:\Program Files (x86)` as FlexProp expects to be able to write to its own directory. So, Create a new program files directory called `C:\Programs\TotalSpectrum\FlexProp` and unpack the .zip file into that directory. Make sure that this directory is writable.

Finish up by then [add a new PATH element](#os-windows) and make sure to also create the new Environment Variable `FlexPropPath=C:\Programs\TotalSpectrum\FlexProp`. _The User Tasks expect this environment variable to exist. They use it to locate the flash utility binary file._

#### Update FlexProp

Like we do on the other platforms here's the suggested update strategy:

- Download and zip the latest version from [FlexProp Releases Page](https://github.com/totalspectrum/flexprop/releases)
- Remove any `C:\Programs\TotalSpectrum\FlexProp-prior` (the prior version of FlexProp)
- Rename your existing `C:\Programs\TotalSpectrum\FlexProp` folder to `C:\Programs\TotalSpectrum\FlexProp-prior`
- Create a new empty directory `C:\Programs\TotalSpectrum\FlexProp` and make it writeable
- Unpack the latest downloaded .zip into the newly re-created `C:\Programs\TotalSpectrum\FlexProp` folder

**NOTE:** We use this move-aside technique for updating the FlexProp compiler. When a language compiler is updated more frequently it is not uncommon to one or twice a year experience a breaking change in how the new compiler handles your existing code. Assuming the version you are moving aside works well against all your projects, we move it aside and install the new version. Should you find that the new version doesn't work well against one of your projects you will still have the prior version so you can build the project with the older version that would fail with the new version. _You can always skip this move-aside step if you don't care about this issue._

### Installing PNut

The PNut compiler/debug tool does not have a standard install location. So we will likely have many locations amongst all of us P2 users. You have to take note of where you installed PNut and then [add a new PATH element](#os-windows) using the windows settings app. to point to where your binaries ended up on your file system.

#### Install PNut

Download the latest .zip file from [PNut/Spin2 Latest Version](https://forums.parallax.com/discussion/171196/.../p1?_ga=2.41234594.1818840425.1671330006-1649768518.1600891894) Forum thread into my **Downloads** folder. Unpack the .zip into its own folder.

Propeller Tool installs into `C:\Program Files (x86)\Parallax Inc\Propeller Tool\`. But we are going to install PNut along side our FlexSpin compiler. So I just created a sibling directory: `C:\Programs\Parallax Inc\PNut\` and copied all of the unpacked files into that directory.

**NOTE:** _if you experience problems with the tasks running PNut it is generally that the .bat files are not identifying the PNut executable by the correct name. At each install check the content of `\PNut\pnut_shell.bat` and `\PNut\pnut_report.bat` and make sure the PNut versioned name is correct with what's in the folder. Occasionally Chip forgets to modify these .bat files before release._

I right-mouse on the PNut\_{version}.exe file and select "**Pin to taskbar**".

I then [add a new PATH element](#os-windows) using the windows settings app. to point to where your binaries ended up on your file system. In my case I added a path segment pointing to `C:\Programs\Parallax Inc\PNut\`. Lastly, make sure to also create the new Environment Variable `PNutPath=C:\Programs\Parallax Inc\PNut`. Our task automated processes, in the future, will use this to determine where things are installed.

#### Update PNut

I haven't found the need to keep any prior version. I simply:

- Download the latest version of PNut from [PNut/Spin2 Latest Version](https://forums.parallax.com/discussion/171196/.../p1?_ga=2.41234594.1818840425.1671330006-1649768518.1600891894) into my **Downloads** folder
- Unpack the .zip file
- In my taskbar I right-mouse on the PNut icon and select "**Unpin from taskbar**"
- Select all content within `C:\Programs\Parallax Inc\PNut\` and Delete it
- Move all of unpacked content into the now empty folder `C:\Programs\Parallax Inc\PNut\`
- I right-mouse on the newly copied PNut\_{version}.exe file and select "**Pin to taskbar**".

**NOTE:** _if you experience problems with the tasks running PNut it is generally that the .bat files are not identifying the PNut executable by the correct name. At each install check the content of `\PNut\pnut_shell.bat` and `\PNut\pnut_report.bat` and make sure the PNut versioned name is correct with what's in the folder. Occasionally Chip forgets to modify these .bat files before release._

### Setting paths for your P2 Compilers/Tools

#### OS: Windows

On windows the search path for programs is maintained by the **Windows Settings App.** Open Window Settings and search for "environment" and you should see two choices: "**Edit the system environment variables**" and "**Edit environment variables for your account**". If you want the tools to work for all users on this Windows machine (Preferred) then adjust the PATH values by editing the system environment variables. If, instead, you only need the tools to work for your account then edit the environment variables for your account.

You will do this for each of FlexProp and PNut (which ever ones you use, either or both.)

If you are using FlexProp and/or PNut, in addition to modifying the PATH variable, you will also need to add a new Environment Variable which points to the FlexProp and PNut install folders.

In the same section you modified for path (system environment or your account environment) using [New...] add a new environment variable `FlexPropPath` (and/or `PNutPath`) which you will set to your install folder using the [Browse Directory...] button after pressing [New...] and typing in the `FlexPropPath` (or `PNutPath`) name. The tasks we define will use this environment variable to locate the binary file it needs when downloading to FLASH.

If you are setting up PNut too, then add a new environment variable for `PNutPath` as well.

**NOTE** _the above is referring to **Windows 10** settings names. On earlier versions of Windows the concept is the same. Locate the environment values and make the appropriate changes._

From here on, when we run in terminal windows, we can invoke the FlexProp and PNut binaries by name without using the path to them.

## Tasks in VScode

A Task is how we integrate with External tools in VScode.

See: [VSCode "Tasks" Reference Page](https://code.visualstudio.com/docs/editor/tasks)

There are a number of types of tasks and places Task definitions live. These include [Auto-detected Tasks](https://code.visualstudio.com/docs/editor/tasks#_task-autodetection), [User level tasks](https://code.visualstudio.com/docs/editor/tasks#_user-level-tasks), and [Custom Tasks](https://code.visualstudio.com/docs/editor/tasks#_custom-tasks). Tasks when run, can be crafted to depend upon the running of other tasks See: [Compound Tasks](https://code.visualstudio.com/docs/editor/tasks#_compound-tasks) Some tasks can be [run in background](https://code.visualstudio.com/docs/editor/tasks#_background-watching-tasks) such as file watchers which execute when a file has been changed.

When you run VScode on multiple operating systems and want to be able to run a projects tasks on whichever machine you are on then you can specify os-specific alternatives to be used withing the task. See [Operating system specific properties](https://code.visualstudio.com/docs/editor/tasks#_operating-system-specific-properties)

Another VSCode mechanism we are determining if it will be useful is the: [Task Provider Extension](https://code.visualstudio.com/api/extension-guides/task-provider). If we find this is useful we can add a Task Provider element to our existing extension in order to facilitate our updating task files we use for P1 and P2 development.

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
  "tasks": []
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
      "osx": {
        "command": "/Applications/flexprop/bin/flexspin.mac"
      },
      "windows": {
        "command": "flexspin.exe"
      },
      "linux": {
        "command": "/opt/flexprop/bin/flexspin"
      },
      "args": ["-2", "-Wabs-paths", "-Wmax-errors=99", "${fileBasename}"],
      "problemMatcher": {
        "owner": "Spin2",
        "fileLocation": ["autoDetect", "${workspaceFolder}"],
        "pattern": {
          "regexp": "^(.*):(\\d+):\\s+(warning|error):\\s+(.*)$",
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
    },
    {
      "label": "compileTopP2",
      "type": "shell",
      "osx": {
        "command": "/Applications/flexprop/bin/flexspin.mac"
      },
      "windows": {
        "command": "flexspin.exe"
      },
      "linux": {
        "command": "/opt/flexprop/bin/flexspin"
      },
      "args": ["-2", "-Wabs-paths", "-Wmax-errors=99", "${config:topLevel}.spin2"],
      "problemMatcher": {
        "owner": "Spin2",
        "fileLocation": ["autoDetect", "${workspaceFolder}"],
        "pattern": {
          "regexp": "^(.*):(\\d+):\\s+(warning|error):\\s+(.*)$",
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
    },
    {
      "label": "downloadP2",
      "type": "shell",
      "osx": {
        "command": "/Applications/flexprop/bin/loadp2.mac",
        "args": ["-b230400", "${config:topLevel}.binary", "-t"]
      },
      "windows": {
        "command": "loadp2.exe",
        "args": ["-b230400", "${config:topLevel}.binary", "-t"]
      },
      "linux": {
        "command": "/opt/flexprop/bin/loadp2",
        "args": ["-b230400", "${config:topLevel}.binary", "-t", "-p/dev/ttyUSB0"]
      },
      "problemMatcher": [],
      "presentation": {
        "panel": "dedicated",
        "focus": false,
        "showReuseMessage": false,
        "clear": true
      },
      "group": {
        "kind": "test",
        "isDefault": true
      },
      "dependsOn": ["compileTopP2"]
    },
    {
      "label": "flashP2",
      "type": "shell",
      "osx": {
        "command": "/Applications/flexprop/bin/loadp2.mac",
        "args": ["-b230400", "@0=/Applications/flexprop/board/P2ES_flashloader.bin,@8000+${config:topLevel}.binary", "-t", "-k"]
      },
      "windows": {
        "command": "loadp2.exe",
        "args": ["-b230400", "@0=${env:FlexPropPath}/board/P2ES_flashloader.bin,@8000+${config:topLevel}.binary", "-t", "-k"]
      },
      "linux": {
        "command": "/opt/flexprop/bin/loadp2",
        "args": ["-b230400", "@0=/opt/flexprop/board/P2ES_flashloader.bin,@8000+${config:topLevel}.binary", "-t", "-p/dev/ttyUSB0"]
      },
      "problemMatcher": [],
      "presentation": {
        "panel": "dedicated",
        "focus": false,
        "showReuseMessage": false,
        "clear": true
      },
      "group": {
        "kind": "test",
        "isDefault": true
      },
      "dependsOn": ["compileTopP2"]
    },
    {
      "label": "compilePNut2",
      "type": "shell",
      "command": "echo",
      "args": ["Avail on  windows only!"],
      "windows": {
        "command": "pnut_shell.bat",
        "args": ["${fileBasename}", "-c"]
      },
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
    },
    {
      "label": "compileTopPNut2",
      "type": "shell",
      "command": "echo",
      "args": ["Avail on  windows only!"],
      "windows": {
        "command": "pnut_shell.bat",
        "args": ["${config:topLevel}.spin2", "-c"]
      },
      "problemMatcher": {
        "owner": "Spin2",
        "fileLocation": ["autoDetect", "${workspaceFolder}"],
        "pattern": {
          "regexp": "^(.*):(\\d+):\\s+(warning|error):\\s+(.*)$",
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
    },
    {
      "label": "downloadPNut2",
      "type": "shell",
      "command": "echo",
      "args": ["Avail on  windows only!"],
      "windows": {
        "command": "pnut_shell.bat",
        "args": ["${config:topLevel}.spin2", "-r"]
      },
      "problemMatcher": {
        "owner": "Spin2",
        "fileLocation": ["autoDetect", "${workspaceFolder}"],
        "pattern": {
          "regexp": "^(.*):(\\d+):\\s+(warning|error):\\s+(.*)$",
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
    },
    {
      "label": "downloadDebugPNut2",
      "type": "shell",
      "command": "echo",
      "args": ["Avail on  windows only!"],
      "windows": {
        "command": "pnut_shell.bat",
        "args": ["${config:topLevel}.spin2", "-rd"]
      },
      "problemMatcher": {
        "owner": "Spin2",
        "fileLocation": ["autoDetect", "${workspaceFolder}"],
        "pattern": {
          "regexp": "^(.*):(\\d+):\\s+(warning|error):\\s+(.*)$",
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
    },
    {
      "label": "flashPNut2",
      "type": "shell",
      "command": "echo",
      "args": ["Avail on  windows only!"],
      "windows": {
        "command": "pnut_shell.bat",
        "args": ["${config:topLevel}.spin2", "-f"]
      },
      "problemMatcher": {
        "owner": "Spin2",
        "fileLocation": ["autoDetect", "${workspaceFolder}"],
        "pattern": {
          "regexp": "^(.*):(\\d+):\\s+(warning|error):\\s+(.*)$",
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
  ]
}
```

This provides the following **Build** and **Test** tasks:

Under **Task: Run Build Task**:

- CompileP2 - Compile current file [ctrl-shift-B]
- CompilePNut2 - Compile current file using PNut
- CompileTopP2 - Compile the top-file of this project
- CompileTopPNut2 - Compile the top-file of this project using PNut

Under **Task: Run Test Task**:

- DownloadP2 - Download the binary to RAM in our connected P2
- DownloadPNut2 - Download the binary to RAM using PNut
- DownloadDebugPNut2 - Compile with Debug enabled, then Download the binary to RAM using PNut
- FlashP2 - Download and write the binary to FLASH in our connected P2
- FlashPNut2 - Download and write the binary to FLASH using PNut

As written, **downloadP2** and **flashP2** for flexpsin will always be preceeded by a compileTopP2, while the **downloadPNut2**, **downloadDebugPNut2**, and **flashPNut2** do not have any depedencies as they do their own build of the top-level file.

The **downloadPNut2** and **flashPNut2** tasks do NOT enable debug support. The option `-r` is run without debug while `-rd` is run with debug. Likewise, the option `-f` is compile and flash without debug while `-fd` is compile and flash with debug. Please adjust these values in the task `args:` sections to your need (using debug or not)

For quick use without your needing to modify anything to enable debug we've added **downloadDebugPNut2** which allows you to compile and run from RAM with Debug enabled.

**TODO** ?? let's make debug a custom VSCode setting and use the setting in this script to enable/disable debug compilation/use ??

### Adding our Custom Keybindings

To add our custom key bindinds we place new content in the `keybindings.json` file.

To get to this file type in **Ctrl+Shift+P** (Cmd+Shift+P on mac) to get to the command search dialog. Then type in "keyboard". Lower down in the resulting filtered list you should now see "**Preferences: Open Keyboard Shortcuts (JSON)**". Select it and you should now have a file open in the editor which should contain at least:

```json
// Place your key bindings in this file to override the defaultsauto[]
[]
```

In between the [] you can place your new **key bindings**. You should end up with something like:

```json
// Place your key bindings in this file to override the defaultsauto[]
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

This adds new keyboard short cuts to our tasks:

- CompileP2 - Compile current file [ctrl-shift-B], **[F8]**
- CompileTopP2 - Compile the top-file of this project
- DownloadP2 - Download the binary to RAM in our connected P2 **[ctrl+shift+d] or [F10]**
- FlashP2 - Download and write the binary to FLASH in our connected P2 **[ctrl+shift+f] or [F11]**

NOTE: you can see that these key bindings only refer to the FlexProp tasks. In, instead, you'd like them to use the PNut tasks then you can replace the `P2` command suffix with `PNut2` causing the PNut versions to be run for the shortcuts.

Here's an example invoking PNut instead of FlexProp:

```json
// Place your key bindings in this file to override the defaultsauto[]
[
  {
    "key": "ctrl+shift+d",
    "command": "workbench.action.tasks.runTask",
    "args": "downloadPNut2"
  },
  {
    "key": "ctrl+shift+f",
    "command": "workbench.action.tasks.runTask",
    "args": "flashPNut2"
  },
  {
    "key": "F8",
    "command": "workbench.action.tasks.build",
    "args": "compilePNut2"
  },
  {
    "key": "F10",
    "command": "workbench.action.tasks.runTask",
    "args": "downloadPNut2"
  },
  {
    "key": "ctrl+F10",
    "command": "workbench.action.tasks.runTask",
    "args": "downloadDebugPNut2"
  },
  {
    "key": "F11",
    "command": "workbench.action.tasks.runTask",
    "args": "flashPNut2"
  }
]
```

This adds new keyboard short cuts to our tasks:

- CompilePNut2 - Compile current file [ctrl-shift-B], **[F8]**
- CompileTopPNut2 - Compile the top-file of this project
- DownloadPNut2 - Download the binary to RAM in our connected P2 **[ctrl+shift+d] or [F10]**
- DownloadDebugPNut2 - Compile the project with debug enabled, Download the binary to RAM in our connected P2 **[ctrl+F10]**
- FlashPNut2 - Download and write the binary to FLASH in our connected P2 **[ctrl+shift+f] or [F11]**

### Adding our notion of Top-level file for tasks to use

In order to support our notion of top-level file and to prevent us from occasionally compiling and downloading a file other than the project top-level file we've adopted the notion of adding a CompileTopP2 (CompileTopPNut2) build task a DownloadP2 (DownloadPNut2) download task, and in some cases a FlashP2 (FlashPNut2) task.

When we request a download or flash the automation will first compile the top-level project source which produces a new binary. It is this new binary that will be downloaded/flashed.

We have multiple tasks that need to know the name of our top-level file. So we add a new settings file with a topLevel value to our project:

**.vscode/settings.json** file contains the following contents:

```json
{
  "topLevel": "jm_p2-es_matrix_control_demo"
}
```

Once we have this file in place, then our `tasks.json` file can access this value using the form: `${config:topLevel}`

Now our **CompileTopP2** task can create the toplevel filename using `${config:topLevel}.spin2`

You need to find the line containing "jm_p2-es_matrix_control_demo" and replace this name with the name of your top-level file.

And our **DownloadP2** task can reference the binary file using `${config:topLevel}.binary`

**NOTE** the PNut flasher is special in that it wants the .spin2 filename not a .binary filename so you'll see `${config:topLevel}.spin2` being used in the **FlashPNut2** task.

## License

Licensed under the MIT License. <br>
<br>
Follow these links for more information:

### [Copyright](copyright) | [License](LICENSE)

[maintenance-shield]: https://img.shields.io/badge/maintainer-stephen%40ironsheep%2ebiz-blue.svg?style=for-the-badge

[license-shield]: https://img.shields.io/badge/License-MIT-yellow.svg

