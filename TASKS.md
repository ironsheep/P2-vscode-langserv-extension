# VSCode - Local Project defined Tasks (OLD PAGE)

### Please refer to the following pages, instead:

- [Setup focused on Windows only](TASKS-User-win.md) - All **Windows** notes
- [Setup focused on macOS only](TASKS-User-macOS.md) - All **macOS** notes 
- [Setup focused on RPi only](TASKS-User-RPi.md) - All **Raspberry Pi** notes 

# VSCode - Local Project defined Tasks (OLD PAGE)


![Project Maintenance][maintenance-shield]
[![License][license-shield]](LICENSE)

**NOTE**: This page describes creating tasks **unique to each project/workspace**. 

Please refer, instead, to our **new page**: Where you configure your P2 compile and download tasks to be common to all your projects then go to the [Global Tasks](TASKS-User.md) page.

### **-- OLD PAGE --**
## Automating Build and Download to our P2 development boards

This document is being developed over time as we prove-out a working environment for each of our target platforms. 

To date, we have installations, compilation and downloading from **Windows**, **MacOS**, and **RaspiOS** (the Raspberry Pi OS - a Debian derived distribution).  *This RaspiOS method should also work for any other Debian derived distribution such as Ubuntu or, of course, Debian itself.*

Also, to date, we have building and download for **flexprop** and **PNut** (*PNut is widows or windows emulator only.*) with direct USB-attached boards.

In the future, we are also expecting to document building and download with via Wifi with the Wx boards attached to our development board, and with more compilers as they come ready for multi-platform use, etc.

## Table of Contents

On this Page:

- [VSCode development of P2 Projects](#vscode-development-of-p2-projects) - background behind why things are organized this way
- [Tasks in VScode](#tasks-in-vscode) - this provides more detail about vscode tasks and lists what work is still needing to be done 
- [P2 Code Development with flexprop on macOS](#p2-code-development-with-flexprop-on-macos)
- [P2 Code Development with flexprop on Windows](#p2-code-development-with-flexprop-on-windows)
- [P2 Code Development with flexprop on Raspberry Pi](#p2-code-development-with-flexprop-on-raspberry-pi)
- [P2 Code Development with PNut on Windows](#p2-code-development-with-pnut-on-windows)

Additional pages:

- [TOP Level README](README.md) - Back to the top page of this repo
- [VSCode REF: Tasks](https://code.visualstudio.com/docs/editor/tasks) - Offsite: VSCode Documentation for reference

*The "P2 Code Development..." sections provide step-by-step setup instructions *

### Latest Updates

```
Latest Updates:
18 Dec 2022
- Added this Table of Contents as I'm reviewing this work
- I'm preparating to improving how we do installation of our tools accross the platforms and where we store the tasks we want to use during development
28 Apr 2021
- convert tasks.json files to use settings.json file which now contains our toplevel filename
- update narrative herein to describe our new settings.json file
05 Apr 2021 
- Add notes for enabling connection of PropPlug to Raspberry Pi
- Add port specfication to loadp2 when run on RPi
31 Mar 2021
- Add PNut on Windows section of document
- Add PATH setting information so our task.json files can have no expectation as to where tools are installed. See: "Setting paths for your P2 Compilers/Tools"
- BUGFIX: Correct the download to RAM tasks
19 Feb 2021
- Adjust flexspin options in tasks file to generate more errors and to generate consistent file paths in error messages
- Add section presenting configuration for running flexspin on Raspberry Pi's
```

## VSCode development of P2 Projects

By choosing to adopt the Custom Tasks described in this document along with the keybindings your work flow is now quite sweet.

- Create a new project
- Add existing files you have already created or are using from P2 Obex.
- Create your new top-level file.
- Add Custom Tasks as shown in this document (adjusting the project specifics in the task examples provided before you use them the first time.

Iterate until your project works as desired:

- Make changes to file(s)
- Compile the files to see if they compile cleanly (cmd-shift-B) on which ever file you are editing
- Once the files compile cleanly
- Download and test (cmd-shift-D) [if you use keybindings shown in examples on this page]

### Being consistent in your machine configuration

I have mostly macs for development but I also have a Windows machine and a number of Raspberry PIs (derived from Debian Linux distro.) and even some larger Ubuntu Machines (also derived from Debian Linux distro.).  If you, like me, intend to be able to run VSCode on may of your development machines and you want to make your life easier then there are a couple of things we know already that can help you.

- **Synchronize your VSCode settings and extensions** automatically by installing and using the **Settings Sync** VScode extension. Any changes you make to one machine then will be sync'd to your other VScode machines.

- **Be very consistent in where you install tools** for each type of OS.  (e.g., for all Windows machines make sure you install say, flexprop, in the same location on each Windows machine.) By being consistant your tasks will run no matter which machine your are running on. 
There is nothing worse than trying to remember where you installed a specific tool on the machine you are currently logged into. Because you install say flexprop in the same place on all your Raspberry Pi's you will know where to find it no matter which RPi you are logged in to.

    - All like operating systems should have a specific tool installed in the same location on each. (e.g., all Windows machines have Flexspin installed in one location, all macOS machines have FlexSpin installed in a different location that on Windows but it is the same location across all Macs, etc.)
    - During installation of a tool on a machine, finish the process by configuring the PATH to the tool so that terminals/consoles can access the tool by name. This allows VSCode to run the tool from its build tasks.json file without needing to know where the tool is installed!  On Windows machines this is done by editing the User Environment from within the Settings Application. On Mac's and Linux machines (RPi's) this is done by editing the shell configuration file (e.g., Bash you edit the ~/.bashrc file)


### Setting paths for your P2 Compilers/Tools

#### OS: Windows

On windows the search path for programs is maintained by the **Windows Settings App.**  Open Window Settings and search for "environment" and you should see two choices: "**Edit the system environement variables**" and "**Edit enviroment variables for your account**".  If you want the tools to work for all users on this Windows machine then adjust the PATH values by editing the system environement variables.  If, instead, you only need the tools to work for your account then edit the enviroment variables for your account.

**NOTE** *the above is referring to **Windows 10** settings names. On earlier versions of Windows the concept is the same. Locate the environment values and make the appropriate changes.*

#### OS: MacOS

On MacOS this is really shell dependent. I tend to stick with [Bash](https://www.gnu.org/software/bash/manual/html_node/Introduction.html) as I've used it for many 10s of years now.  [zsh](https://scriptingosx.com/2019/06/moving-to-zsh/) (ZShell) is the new shell on the block (*well, new to mac's not a new shell*.) I avoided moving to it but the concepts are the same.

On my Macs I install the flexprop folder into my /Applications folder.  I then edit my .bash_profile and add the following line.  (*I have multiple lines such as this for various tools I've installed.*)

```bash
export PATH=${PATH}:/Applications/flexprop/bin
```

From here on when I start new terminal windows or VSCode they can now get to the flexprop binaries by name without using the path to them.

#### OS: RaspiOS

On my raspberry Pi's I run [**rspios**](https://www.raspberrypi.org/software/operating-systems) which is a Debain GNU Linux derived distribution. [Fun! See [The Periodic Table of Liux Distros](https://distrowatch.com/dwres.php?resource=family-tree)]

So, as you might have guessed, I use Bash here too.  On RPi I tend to install special tools from others, as well as those I make, under /opt.  So, in the case of flexprop I install it on all my RPis into `/opt/flexprop/`.

Unlike my Macs which have .bash_profile, my RPis have, instead, a .profile file.  So here I edit the RPi ~/.profile.  I'm using the pattern for "optionally installed tools" so that I can sync this .profile between my many RPi's.

I edit my ~/.profile and add the path to flexprop.  (*I have multiple groups of lines such as this for various tools I've installed.*)

```bash
# set PATH so it includes optional install of flexprop/bin if it exists
if [ -d "/opt/flexprop/bin" ] ; then
    PATH="$PATH:/opt/flexprop/bin"
fi
```

From here on when I start new terminal windows or VSCode they can now get to the flexprop binaries by name without using the path to them.


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


**TODO-1**: We need to ensure download doesn't proceed if compile fails

**TODO-2**: We actually need two download tasks: (1) download to RAM, (2) download to FLASH.

#### More Advanced building

**TODO-3**: We'll also test using the file-watch technoology to automatically compile and download our project files when they are modified.

### Adding our notion of Top-level file to our tasks

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


Now our CompileTopP2 task can create the toplevel filename using  `${config:topLevel}.spin2`

You need to find the line containing "jm\_p2-es\_matrix\_control\_demo" and replace this name with the name of your top-level file. 

And our DownloadP2 task can reference the binary file using `${config:topLevel}.binary`

**NOTE** the PNut flasher is special in that it wants the .spin2 filename not a .binary filename so you'll see `${config:topLevel}.spin2` being used in the PNut FlashP2 task.



## P2 Code Development with flexprop on macOS

To complete your setup so you can use flexprop on your mac under VScode you'll need to install flexprop and then:

One time:

- Install a common keybinding (works accross all your P2 projects)
- Optionally add a couple of VSCode extensions if you wish to have the features I demonstrated"
    - "Error Lens" which adds the compile errors messages to the associated line of code
    - "Explorer Exclude" which allows you to hide file types (e.g., .p2asm, .binary) from the explorer panel

For each P2 Project:

- Install a tasks.json file
    - Make sure the names of your compiler and loader binaries are correct
- Install a settings.json file
    - Make sure the name of your top-level file is correctly placed in this settings.json file

### flexprop install specifics: macOS

The flexprop toolset does not have a standard installed location. So we will likely have many locations amongst all of us P2 users.  You have to take note of where you installed it and then adjust the following examples to point to where your binaries ended up on your file system.

In my case, on my Mac's, I install the folder at /Applications/flexprop and I've [set the PATH](https://github.com/ironsheep/P2-vscode-extensions/blob/main/TASKS.md#os-macos) to point to the /Applications/flexprop/bin directory.  Depending on how you obtained the flexprop install file you may have bin/flexspin or bin/flexspin.mac and likewise bin/loadp2 or bin/loadp2.mac.  This tasks.json file shows the .mac suffixes. If your install doesn't have them then you will need to modify your `tasks.json` file.  The three lines are: 

- "command": "flexspin.mac",  (in the "compileP2" task)
- "command": "flexspin.mac",  (in the "compileTopP2" task)
- "command": "loadp2.mac",    (in the "downloadP2" task)

Simply remove the .mac suffix if your install doesn't have files with the .mac suffix.


### Add custom tasks for compileP2, compileTopP2, and downloadP2

In your project folder create a directory named ".vscode" (if it's not already there.)

In this new directory create a **.vscode/settings.json** file containing the following contents.

```json
{
   "topLevel": "jm_p2-es_matrix_control_demo",
}

```

*(of course, you will want to replace "jm\_p2-es\_matrix\_control_demo" with the name of your top-level file.)*

In this new directory create a **.vscode/tasks.json** file containing the following contents.

Here is a project-specific file we can use on macOS: `.vscode/tasks.json` but it really supports all three of our OS'es.

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
                "command": "flexspin.mac",
    		  },
    		  "windows": {
                "command": "flexspin.exe",
    		  },
    		  "linux": {
                "command": "flexspin",
    		  },
            "args": [
                "-2",
                "-Wabs-paths",
                "-Wmax-errors=99",
                "${fileBasename}"
            ],
            "problemMatcher": {
                "owner": "Spin2",
                "fileLocation": ["autoDetect", "${workspaceFolder}/src"],
                "pattern": {
                    "regexp": "^(.*):(\\d+):\\s+(warning|error):\\s+(.*)$",
                    "file": 1,
                    "line": 2,
                    "severity": 3,
                    "message": 4
                }
            },
            "presentation": {
                "panel": "new",
                "focus": true
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
                "command": "flexspin.mac",
            },
            "windows": {
                "command": "flexspin.exe",
            },
            "linux": {
                "command": "flexspin",
            },
            "args": [
                "-2",
                "-Wabs-paths",
                "-Wmax-errors=99",
                "${config:topLevel}.spin2"
            ],
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
                "panel": "new",
                "focus": true
            },
        },
        {
            "label": "downloadP2",
            "type": "shell",
            "args": [
                "-b230400",
                "${config:topLevel}.binary",
                "-t"
            ],
            "osx": {
                "command": "loadp2.mac",
            },
            "windows": {
                "command": "loadp2.exe",
            },
            "linux": {
                "command": "loadp2",
                "args": [
                    "-b230400",
                    "${config:topLevel}.binary",
                    "-t",
                    "-p/dev/ttyUSB0"
                ],
            },
            "problemMatcher": [],
            "presentation": {
                "panel": "new",
                "focus": true
            },
            "dependsOn": [
                "compileTopP2"
            ]
        }
    ]
}
```

This provides the commands to be run for:

- CompileP2 - Compile current file  [cmd-shift-B]
- CompileTopP2 - Compile the top-file of this project
- DownloadP2 - Download the binary to our connected P2  [cmd-shift-D -if keybindings are added.]

As written, download will always be preceeded by a CompileTop.

NOTE: VSCode does not have any concept of top-level file. So we added a custom build task invoked by the downloadP2 task to first compile the top-level file. This top-level filename must be customized for each project by configuring the filename specified by the "topLevel" named value in our `.vscode/settings.json` file.

### Add Keyboard Shortcut for the Download task

This is the keybinding I used for mapping download to a key sequence.

You get to this file by:

1. Opening the Keyboard shortcuts list [cmd-K, cmd-S or Menu: Code->Preferences->Keyboard Shortcuts]
2. Opening the file Keyboard Shortcuts (JSON) by pressing the document icon left of the play arow icon at the top right of the Keyboard Shortcuts window.

Contents I used for file: **keybindings.json**:

```json
// Place your key bindings in this file to override the defaults
[
    {
        "key": "shift+cmd+d",
        "command": "workbench.action.tasks.runTask",
        "args": "downloadP2"
    }

]
```

*NOTE: if you change the label values in our tasks, more specifically the downloadP2 task, then this file has to be changed as well!*

## P2 Code Development with flexprop on Windows

To complete your setup so you can use flexprop on your Windows machine under VScode you'll need to install flexprop and then:

One time:

- Install a common keybinding (works accross all your P2 projects)
- Optionally add a couple of VSCode extensions if you wish to have the features I demonstrated"
    - "Error Lens" which adds the compile errors messages to the associated line of code
    - "Explorer Exclude" which allows you to hide file types (e.g., .p2asm, .binary) from the explorer panel

For each P2 Project:

- Install a tasks.json file
    - Make sure the names of your compiler and loader binaries are correct
- Install a settings.json file
    - Make sure the name of your top-level file is correctly placed in this settings.json file

### flexprop install specifics: Windows

The flexprop toolset does not have a standard install location. So we will likely have many locations amongst all of us P2 users.  To normalize this you [added a new PATH element](https://github.com/ironsheep/P2-vscode-extensions/blob/main/TASKS.md#os-windows) in your windows settings app. to point to the flexprop bin directory when you installed flexprop.  These tasks now just expect to be able to reference the executable by name and it will run.


### Add custom tasks for compileP2, compileTopP2, and downloadP2

In your project folder create a directory named ".vscode" (if it's not already there.)

In this new directory create a **.vscode/settings.json** file containing the following contents.

```json
{
   "topLevel": "jm_p2-es_matrix_control_demo",
}

```

*(of course, you will want to replace "jm\_p2-es\_matrix\_control_demo" with the name of your top-level file.)*

In this new directory create a **.vscode/tasks.json** file containing the following contents.

Here is a project-specific file we can use on Windows: `.vscode/tasks.json` but it really supports all three of our OS'es.

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
                "command": "flexspin.mac",
    		  },
    		  "windows": {
                "command": "flexspin.exe",
    		  },
    		  "linux": {
                "command": "flexspin",
    		  },
            "args": [
                "-2",
                "-Wabs-paths",
                "-Wmax-errors=99",
                "${fileBasename}"
            ],
            "problemMatcher": {
                "owner": "Spin2",
                "fileLocation": ["autoDetect", "${workspaceFolder}/src"],
                "pattern": {
                    "regexp": "^(.*):(\\d+):\\s+(warning|error):\\s+(.*)$",
                    "file": 1,
                    "line": 2,
                    "severity": 3,
                    "message": 4
                }
            },
            "presentation": {
                "panel": "new",
                "focus": true
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
                "command": "flexspin.mac",
            },
            "windows": {
                "command": "flexspin.exe",
            },
            "linux": {
                "command": "flexspin",
            },
            "args": [
                "-2",
                "-Wabs-paths",
                "-Wmax-errors=99",
                "${config:topLevel}.spin2"
            ],
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
                "panel": "new",
                "focus": true
            },
        },
        {
            "label": "downloadP2",
            "type": "shell",
            "args": [
                "-b230400",
                "${config:topLevel}.binary",
                "-t"
            ],
            "osx": {
                "command": "loadp2.mac",
            },
            "windows": {
                "command": "loadp2.exe",
            },
            "linux": {
                "command": "loadp2",
                "args": [
                    "-b230400",
                    "${config:topLevel}.binary",
                    "-t",
                    "-p/dev/ttyUSB0"
                ],
            },
            "problemMatcher": [],
            "presentation": {
                "panel": "new",
                "focus": true
            },
            "dependsOn": [
                "compileTopP2"
            ]
        }
    ]
}

```

This provides the commands to be run for:

- CompileP2 - Compile current file  [ctrl-shift-B]
- CompileTopP2 - Compile the top-file of this project
- DownloadP2 - Download the binary to our connected P2  [ctrl-shift-D -if keybindings are added.]

As written, download will always be preceeded by a CompileTop.

NOTE: VSCode does not have any concept of top-level file. So we added a custom build task invoked by the downloadP2 task to first compile the top-level file. This top-level filename must be customized for each project by configuring the filename specified by the "topLevel" named value in our `.vscode/settings.json` file.

### Add Keyboard Shortcut for the Download task

This is the keybinding I used for mapping download to a key sequence.

You get to this file by:

1. Opening the Keyboard shortcuts list [ctrl-K, ctrl-S or Menu: Code->Preferences->Keyboard Shortcuts]
2. Opening the file Keyboard Shortcuts (JSON) by pressing the document icon left of the play arow icon at the top right of the Keyboard Shortcuts window.

Contents I used for file: **keybindings.json**:

```json
// Place your key bindings in this file to override the defaults
[
    {
        "key": "ctrl+shift+d",
        "command": "workbench.action.tasks.runTask",
        "args": "downloadP2"
    }

]
```

*NOTE: if you change the label values in our tasks, more specifically the downloadP2 task, then this file has to be changed as well!*


## P2 Code Development with flexprop on Raspberry Pi

To complete your setup so you can use flexprop on your Raspberry Pi under VScode you'll need to install flexprop and then:

One time:
- Enable USB PropPlug recognition on RPi
- Install a common keybinding (works accross all your P2 projects)
- Optionally add a couple of VSCode extensions if you wish to have the features I demonstrated"
    - "Error Lens" which adds the compile errors messages to the associated line of code
    - "Explorer Exclude" which allows you to hide file types (e.g., .p2asm, .binary) from the explorer panel

For each P2 Project:

- Install a tasks.json file
    - Make sure the names of your compiler and loader binaries are correct
- Install a settings.json file
    - Make sure the name of your top-level file is correctly placed in this settings.json file

    
### The Rasperry Pi OS

On my raspberry Pi's I run **rspios** as distributed by [raspberrypi.org](https://www.raspberrypi.org/) from the [downloads page](https://www.raspberrypi.org/software/operating-systems)

I tend to want the best performance from my gear so on my RPi-3's and RPi-4's I tend to run the 64bit raspios.

I've been doing this for quite a while and have a small farm of RPi's. I tend to place the image on a uSD card and then boot from it initially with a keyboard and screen attached.  I then "welcome" my new machine to my network and time zone and give it a hostname unique and generally fortelling of this purpose of this new RPi.  I also end up running the classic update sequence to ensure my new machine has the latest software available as well as all the latest security patches:

```bash
# my update process which I run each time when I first log into my machine after a bit of time away
$ sudo apt-get update
$ sudo apt-get dist-upgrade
```

After the new RPi can boot and automatically attach to my network I then remove the screen and keyboard.  I run most my RPi's remotely and "headless" (meaning no screen/keyboard attached.)

## Using the Parallax PropPlug on Raspbery Pi's

The Parallax PropPlug has a custom parallax VID:PID USB pair and as such is not, by default, recognized by raspiOS when you first plug in the PropPlug.

The fix is to add a custom udev rules file as decribed in [FTDI Technical Note 101](https://www.ftdichip.com/Support/Documents/TechnicalNotes/TN_101_Customising_FTDI_VID_PID_In_Linux(FT_000081).pdf)

I added the file **/etc/udev/rules.d/99-usbftdi.rules**

```bash
$ sudo vi /etc/udev/rules.d/99-usbftdi.rules
```
and then added the content:

```bash
# For FTDI FT232 & FT245 USB devices with Vendor ID = 0x0403, Product ID = 0x6001
SYSFS{idProduct}==”6001”, SYSFS{idVendor}==”0403”, RUN+=”/sbin/modprobe –q ftdi- sio product=0x6001 vendor=0x0403”
```

After this file was saved, I rebooted the RPi.  After the RPi came back up I plugged in the PropPlug I saw /dev/ttyUSB0 appear as my PropPlug.  

### flexprop install specifics: Raspberry Pi

Installing the flexprop toolset on the Raspberry Pi (*raspos, or any debian derivative, Ubuntu, etc.*) is a breeze when you follow [Eric's instructions that just work!](https://github.com/totalspectrum/flexprop#building-from-source)

In my case, I used Eric's suggestion to instruct the build/install process to install to /opt/flexprop. When you get to the build step in his instructions use:

 ```bash
 $ make install INSTALL=/opt/flexprop
 ```

Additionally, I [added a new PATH element](https://github.com/ironsheep/P2-vscode-extensions/blob/main/TASKS.md#os-raspios) in my ~/.profile file to point to the flexprop bin directory.  These tasks now just expect to be able to reference the executable by name and it will run.


### Add custom tasks for compileP2, compileTopP2, and downloadP2

In your project folder create a directory named ".vscode" (if it's not already there.)

In this new directory create a **.vscode/settings.json** file containing the following contents.

```json
{
   "topLevel": "jm_p2-es_matrix_control_demo",
}

```

*(of course, you will want to replace "jm\_p2-es\_matrix\_control_demo" with the name of your top-level file.)*

In this new directory create a **.vscode/tasks.json** file containing the following contents.

Here is a project-specific file we can use on raspiOS: `.vscode/tasks.json` but it really supports all three of our OS'es.

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
                "command": "flexspin.mac",
    		  },
    		  "windows": {
                "command": "flexspin.exe",
    		  },
    		  "linux": {
                "command": "flexspin",
    		  },
            "args": [
                "-2",
                "-Wabs-paths",
                "-Wmax-errors=99",
                "${fileBasename}"
            ],
            "problemMatcher": {
                "owner": "Spin2",
                "fileLocation": ["autoDetect", "${workspaceFolder}/src"],
                "pattern": {
                    "regexp": "^(.*):(\\d+):\\s+(warning|error):\\s+(.*)$",
                    "file": 1,
                    "line": 2,
                    "severity": 3,
                    "message": 4
                }
            },
            "presentation": {
                "panel": "new",
                "focus": true
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
                "command": "flexspin.mac",
            },
            "windows": {
                "command": "flexspin.exe",
            },
            "linux": {
                "command": "flexspin",
            },
            "args": [
                "-2",
                "-Wabs-paths",
                "-Wmax-errors=99",
                "${config:topLevel}.spin2"
            ],
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
                "panel": "new",
                "focus": true
            },
        },
        {
            "label": "downloadP2",
            "type": "shell",
            "args": [
                "-b230400",
                "${config:topLevel}.binary",
                "-t"
            ],
            "osx": {
                "command": "loadp2.mac",
            },
            "windows": {
                "command": "loadp2.exe",
            },
            "linux": {
                "command": "loadp2",
                "args": [
                    "-b230400",
                    "${config:topLevel}.binary",
                    "-t",
                    "-p/dev/ttyUSB0"
                ],
            },
            "problemMatcher": [],
            "presentation": {
                "panel": "new",
                "focus": true
            },
            "dependsOn": [
                "compileTopP2"
            ]
        }
    ]
}
```

This provides the commands to be run for:

- CompileP2 - Compile current file  [ctrl-shift-B]
- CompileTopP2 - Compile the top-file of this project
- DownloadP2 - Download the binary to our connected P2  [ctrl-shift-D -if keybindings are added.]

As written, download will always be preceeded by a CompileTop.

NOTE: VSCode does not have any concept of top-level file. So we added a custom build task invoked by the downloadP2 task to first compile the top-level file. This top-level filename must be customized for each project by configuring the filename specified by the "topLevel" named value in our `.vscode/settings.json` file.

NOTE2: loadp2 on linux requires the specification of our usb device so you see in this file in the task "downloadP2" we, for linux, see us specifying that loadp2 should use port `/dev/ttyUSB0`.

### Add Keyboard Shortcut for the Download task

This is the keybinding I used for mapping download to a key sequence.

You get to this file by:

1. Opening the Keyboard shortcuts list [ctrl-K, ctrl-S or Menu: Code->Preferences->Keyboard Shortcuts]
2. Opening the file Keyboard Shortcuts (JSON) by pressing the document icon left of the play arow icon at the top right of the Keyboard Shortcuts window.

Contents I used for file: **keybindings.json**:

```json
// Place your key bindings in this file to override the defaults
[
    {
        "key": "ctrl+shift+d",
        "command": "workbench.action.tasks.runTask",
        "args": "downloadP2"
    }

]
```

*NOTE: if you change the label values in our tasks, more specifically the downloadP2 task, then this file has to be changed as well!*


## P2 Code Development with PNut on Windows

To complete your setup so you can use PNut on your Windows machine under VScode you'll need to install PNut and then:

One time:

- Install a common keybinding (works accross all your P2 projects)
- Optionally add a couple of VSCode extensions if you wish to have the features I demonstrated"
    - "Error Lens" which adds the compile errors messages to the associated line of code
    - "Explorer Exclude" which allows you to hide file types (e.g., .p2asm, .binary) from the explorer panel

For each P2 Project:

-- Install a tasks.json file
    - Make sure the names of your compiler and loader binaries are correct (we use the .bat file to run PNut, we don't refer to PNut.exe directly!
- Install a settings.json file
    - Make sure the name of your top-level file is correctly placed in this settings.json file


### PNut install specifics: Windows

The PNut compiler/debug tool does not have a standard install location. So we will likely have many locations amongst all of us P2 users.  To normalize this you [added a new PATH element](https://github.com/ironsheep/P2-vscode-extensions/blob/main/TASKS.md#os-windows) in your windows settings app. to point to the PNUt directory when you installed PNut.  These tasks now just expect to be able to reference the batch file by name and it will run.


### Add custom tasks for compileP2, compileTopP2, downloadP2, and flashP2

In your project folder create a directory named ".vscode" (if it's not already there.)

In this new directory create a **.vscode/settings.json** file containing the following contents.

```json
{
   "topLevel": "jm_p2-es_matrix_control_demo",
}

```

*(of course, you will want to replace "jm\_p2-es\_matrix\_control_demo" with the name of your top-level file.)*

In this new directory create a **.vscode/tasks.json** file containing the following contents.

Here is a project-specific file for Windows: **.vscode/tasks.json**

```json
{
    // See https://go.microsoft.com/fwlink/?LinkId=733558
    // for the documentation about the tasks.json format
    "version": "2.0.0",
    "tasks": [
        {
            "label": "compileP2",
            "type": "shell",
            "windows": {
                "command": "pnut_shell.bat"
            },
            "args": [
                "${fileBasename}",
                "-c"
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
                "panel": "new",
                "focus": true
            },
            "group": {
                "kind": "build",
                "isDefault": true
            }
        },
        {
            "label": "compileTopP2",
            "type": "shell",
            "windows": {
                "command": "pnut_shell.bat"
            },
            "args": [
                "${config:topLevel}.spin2"
                "-c"
            ],
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
                "panel": "new",
                "focus": true
            }
        },
        {
            "label": "downloadP2",
            "type": "shell",
            "windows": {
                "command": "pnut_shell.bat"
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
                "panel": "new",
                "focus": true
            },
            "args": [
                "${config:topLevel}.spin2",
                "-r"
            ]
        },
        {
            "label": "flashP2",
            "type": "shell",
            "windows": {
                "command": "pnut_shell.bat"
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
                "panel": "new",
                "focus": true
            },
            "args": [
                "${config:topLevel}.spin2",
                "-f"
            ]
        }
    ]
}
```

This provides the commands to be run for:

- CompileP2 - Compile current file  [ctrl-shift-B]
- CompileTopP2 - Compile the top-file (and all included files) of this project
- DownloadP2 - Compile the top-file and Download the program to our connected P2  [ctrl-shift-D -if keybindings are added.]
- FlashP2 - Compile the top-file, Download and write the program to flash on our connected P2  [ctrl-shift-F -if keybindings are added.]

**NOTE** for PNut a download is also a compile so these download and flash tasks do not depend upon the CompleTopP2 task!

**NOTE2** these downloadP2 and flashP2 tasks do NOT enable debug support. The option `-r` is run without debug while `-rd` is run with debug. Likewise, the option `-f` is compile and flash without debug while `-fd` is compile and flash with debug.  Please adjust these values in the task `args:` sections to your need (using debug or not)

**TODO** let's make debug a custom VSCode setting and use the setting in this script to enable/disable debug compilation/use??

NOTE: VSCode does not have any concept of top-level file. So we added a custom build task invoked by the downloadP2 task to first compile the top-level file. This top-level filename must be customized for each project by configuring the filename specified by the "topLevel" named value in our `.vscode/settings.json` file.

### Add Keyboard Shortcut for the Download task

This is the keybinding I used for mapping download to a key sequence.

You get to this file by:

1. Opening the Keyboard shortcuts list [ctrl-K, ctrl-S or Menu: Code->Preferences->Keyboard Shortcuts]
2. Opening the file Keyboard Shortcuts (JSON) by pressing the document icon left of the play arow icon at the top right of the Keyboard Shortcuts window.

Contents I used for file: **keybindings.json**:

```json
// Place your key bindings in this file to override the defaults
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
    }

]
```

*NOTE: if you change the label values in our tasks, more specifically the downloadP2 or flashP2 tasks, then this file has to be changed as well!*


## License

Copyright © 2023 Iron Sheep Productions, LLC.<br />
Licensed under the MIT License. <br>
<br>
Follow these links for more information:

### [Copyright](copyright) | [License](LICENSE)



[maintenance-shield]: https://img.shields.io/badge/maintainer-stephen%40ironsheep%2ebiz-blue.svg?style=for-the-badge

[license-shield]: https://camo.githubusercontent.com/bc04f96d911ea5f6e3b00e44fc0731ea74c8e1e9/68747470733a2f2f696d672e736869656c64732e696f2f6769746875622f6c6963656e73652f69616e74726963682f746578742d646976696465722d726f772e7376673f7374796c653d666f722d7468652d6261646765
