# VSCode - User-wide defined Tasks (Raspberry Pi)


![Project Maintenance][maintenance-shield]

[![License][license-shield]](LICENSE)

**NOTE**: This page describes creating tasks **common to all of your projects/workspaces**. If, instead, you wish to have your P2 compile and download tasks unique to each your projects then go to the [Project Tasks](TASKS.md) page.

## Automating Build and Download to our P2 development boards

This document is being developed over time as we prove-out a working environment for each of our target platforms. 

To date, we have installations, compilation and downloading from [**Windows**](TASKS-User-win.md), [**MacOS**](TASKS-User-macOS.md), and **RaspiOS** (_this page_) (the Raspberry Pi OS - a Debian derived distribution).

Also, to date, we have building and download for **flexprop** and **PNut** (*PNut is windows or windows emulator only.*) with direct USB-attached boards.

In the future, we are also expecting to document building and download with via Wifi with the Wx boards attached to our development board, and with more compilers as they come ready for multi-platform use, etc.

## Table of Contents

On this Page:

- [VSCode development of P2 Projects](#vscode-development-of-p2-projects) - basic development life-cycle
- [P2 Code Development with flexprop on Raspberry Pi](#enabling-p2-code-development-with-flexprop-on-raspberry-pi) - setting up
- [Being consistent in your machine configuration](#being-consistent-in-your-machine-configuration) - why we are doing things this way
- [Installation and Setup](#development-machine-setup-and-configuration) - preparing your machine for P2 development using tools from within vscode
  - [Installing FlexProp](#installing-flexprop)
- [Tasks in VScode](#tasks-in-vscode) - this provides more detail about vscode tasks and lists work that is still needing to be done 
  - [Adding the P2 Tasks](#adding-the-p2-tasks)
  - [Adding our Custom Keybindings](#custom-keybindings)
  - [Adding our notion of Top-level file for tasks to use](#adding-our-notion-of-top-level-file-for-tasks-to-use)

Additional pages:

- [TOP Level README](README.md) - Back to the top page of this repo
- [Setup focused on Windows only](TASKS-User-win.md) - All **Windows** notes 
- [Setup focused on macOS only](TASKS-User-macOS.md) - All **macOS** notes 
- [VSCode REF: Tasks](https://code.visualstudio.com/docs/editor/tasks) - Offsite: VSCode Documentation for reference

**NOTE:** _The "P2 Code Development..." sections below provide step-by-step setup instructions_

### Latest Updates

```
Latest Updates:
12 Jun 2024
- Updated to reflect new Spin2 Extension built-in compile/download support
18 Jul 2023
- Created this file from TASKS-User.md
20 Dec 2022
- (PNut tasks are now merged into our task list. They just don't do anyting on non-windows platforms)
```

## VSCode development of P2 Projects

By choosing to adopt the Custom Tasks described in this document along with the keybindings your work flow is now quite sweet.

- Create a new project
- Add existing files you have already created or are using from P2 Obex.
- Create your new top-level file.
- Add `{projectDir}/.vscode/settings.json` 3-line file to identify the top-level file for the build tasks.

Iterate until your project works as desired:

- Make changes to file(s)
- Compile the files to see if they compile cleanly (cmd-shift-B) on which ever file you are editing
- Once the files compile cleanly
- Download and test (ctrl-shift-D, F10) [if you use keybindings shown in examples on this page]
- Alternatively, download your project to FLASH and test (ctrl-shift-F, F11) [if you use keybindings shown in examples on this page]

## Enabling P2 Code Development with flexprop on Raspberry Pi

To complete your setup so you can use flexprop on your Raspberry Pi under VScode you'll need to:

One time:

- Install FlexProp for all users to use on your RPi
- Enable USB PropPlug recognition on RPi
- Add our tasks to the user tasks.json file (*works across all your P2 projects*)</br>(*Make sure the paths to your compiler and loader binaries are correct*)
- Install our common keybinding (*works across all your P2 projects*)
- Optionally add a couple of VSCode extensions if you wish to have the features I demonstrated
    - "[Error Lens](https://marketplace.visualstudio.com/items?itemName=usernamehw.errorlens)" which adds the compile errors messages to the associated line of code
    - "[Explorer Exclude](https://marketplace.visualstudio.com/items?itemName=PeterSchmalfeldt.explorer-exclude)" which allows you to hide file types (e.g., .p2asm, .binary) from the explorer panel

For each P2 Project:

- Install a settings.json file identiyfing the project top-level file
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

On the Raspberry Pi platform we'll use `git(1)` to download the FlexProp souce, unlike on the MacOS and Windows machines where we instead get the latest binaries by downloading a `flexprop-{version}.zip` file from the [FlexProp Releases Page](https://github.com/totalspectrum/flexprop/releases) and upacking the zip file to produce a `flexprop` folder containing the new version.  

**NOTE**: *The flexprop toolset does not have a standard install location. So we will likely have many locations amongst all of us P2 users.  You have to take note of where you installed it and then adjust the following examples to point to where your binaries ended up on your file system.  Alternatively, it should be safe to just follow what I do in these instructions explictly.  This has the benefit that more of us will be able to help each other out with tools problems as more of us will be set up the same.*

#### Setup and Configure for P2 development: RaspiOS

##### The Rasperry Pi OS (RaspiOS)

On my raspberry Pi's I run **rspios** as distributed by [raspberrypi.org](https://www.raspberrypi.org/) from the [downloads page](https://www.raspberrypi.org/software/operating-systems)

I tend to want the best performance from my gear so on my RPi-3's and RPi-4's I tend to run the 64bit raspios.

I've been doing this for quite a while and have a small farm of RPi's. I tend to place the image on a uSD card and then boot from it initially with a keyboard and screen attached.  I then "welcome" my new machine to my network and time zone and give it a hostname unique and generally fortelling of this purpose of this new RPi.  I also end up running the classic update sequence to ensure my new machine has the latest software available as well as all the latest security patches:

```bash
# my update process which I run each time when I first log into my machine after a bit of time away
$ sudo apt-get update
$ sudo apt-get dist-upgrade
```

After the new RPi can boot and automatically attach to my network I then remove the screen and keyboard.  I run most my RPi's remotely and "headless" (meaning no screen/keyboard attached.)

##### Using the Parallax PropPlug on Raspbery Pi's

The Parallax PropPlug has a custom parallax VID:PID USB pair and as such is not, by default, recognized by raspiOS when you first plug in the PropPlug.

The fix is to add a custom udev rules file as decribed in [FTDI Technical Note 101](https://www.ftdichip.com/Support/Documents/TechnicalNotes/TN_101_Customising_FTDI_VID_PID_In_Linux(FT_000081).pdf)

I added the file `/etc/udev/rules.d/99-usbftdi.rules`

```bash
$ sudo vi /etc/udev/rules.d/99-usbftdi.rules
```
and then added the content:

```bash
# For FTDI FT232 & FT245 USB devices with Vendor ID = 0x0403, Product ID = 0x6001
SYSFS{idProduct}==”6001”, SYSFS{idVendor}==”0403”, RUN+=”/sbin/modprobe –q ftdi- sio product=0x6001 vendor=0x0403”
```

After this file was saved, I rebooted the RPi.  After the RPi came back up I plugged in the PropPlug I saw /dev/ttyUSB0 appear as my PropPlug.  

##### Install flexprop: RaspiOS

Installing the flexprop toolset on the Raspberry Pi (*raspos, or any debian derivative, Ubuntu, etc.*) is a breeze when you follow [Eric's instructions that just work!](https://github.com/totalspectrum/flexprop#building-from-source)

In my case, I used Eric's suggestion to instruct the build/install process to install to `/opt/flexprop`. When you get to the build step in his instructions use:

 ```bash
 # build flexprop then install flexprop in /opt/flexprop
 sudo make install INSTALL=/opt/flexprop
 ```
 
 (**NOTE** *We use `sudo` because the normal user is not able to write in the /opt tree.*)

Additionally, I [added a new PATH element](#setting-paths-for-your-p2-compilerstools) in my ~/.profile file to point to the flexprop bin directory.  Now if you are running interactively on this RPi you can reference the flexprop or loadp2 executables by name and they will run.


##### Update flexprop: RaspiOS

If I'm updating to a new verison I do the following:

```bash
# remove old prior version
sudo rm -rf /opt/flexprop-prior
# move current to prior
sudo mv /opt/flexprop /opt/flexprop-prior
# navigate to source tree
cd ~/src/flexprop
# erase prior build
make clean
# update to latest in repo
git pull
# build flexprop then install flexprop in /opt/flexprop
sudo make install INSTALL=/opt/flexprop
```

### Setting paths for your P2 Compilers/Tools

#### OS: RaspiOS

On my raspberry Pi's I run [**rspios**](https://www.raspberrypi.org/software/operating-systems) which is a Debain GNU Linux derived distribution. [Fun! See [The Periodic Table of Liux Distros](https://distrowatch.com/dwres.php?resource=family-tree)]

So, as you might have guessed, I use Bash here too.  On RPi I tend to install special tools from others, as well as those I make, under /opt.  So, in the case of flexprop I install it on all my RPis into `/opt/flexprop/`.

Unlike my Macs which have .bash_profile, my RPis have, instead, a .profile file.  So here I edit the RPi ~/.profile.  I'm using the pattern for "optionally installed tools" so that I can sync this .profile between my many RPi's.

I edit my ~/.profile and add the path to flexprop.  (*I have multiple groups of lines such as this for various tools I've installed.*)

```bash
# set PATH so it includes optional install of flexprop/bin if it exists
if [ -d "/opt/flexprop/bin" ] ; then
    PATH="$PATH:/opt/flexprop/bin:/opt/flexprop"
fi
```

From here on when I start new terminal windows we can invoke the flexprop binaries by name without using the path to them.

## Tasks in VScode

A Task is how we integrate with External tools in VScode.

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

Licensed under the MIT License. <br>
<br>
Follow these links for more information:

### [Copyright](copyright) | [License](LICENSE)



[maintenance-shield]: https://img.shields.io/badge/maintainer-stephen%40ironsheep%2ebiz-blue.svg?style=for-the-badge

[license-shield]: https://img.shields.io/badge/License-MIT-yellow.svg

