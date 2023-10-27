# Edit Modes for Spin/Spin2 VSCode Extensions


![Project Maintenance][maintenance-shield]
[![License][license-shield]](LICENSE) 


Recreation of [Parallax Propeller Tool](https://www.parallax.com/package/propeller-tool-software-for-windows-spin-assembly-2/) Edit Modes: Overtype, Insert, and Align for VSCode

## Features

Adds an overtype mode to vscode based editors, plus a couple of bells and whistles.

### Edit Mode Usage

The Edit Mode support for Spin/Spin2 provides three modes: **Overtype**, **Insert** and **Align**.

To rotate through all Edit Modes, press the `Insert` key. If you don't have an `Insert` key, you can press `Fn+Enter` (on Mac). If these don't work for you then `F11` also steps through the modes. As an alternative you can also click on the Insert/Overtype/Align label to rotate through the Edit Modes.

If, instead, you wish to toggle back and forth between the Insert and Align modes only, press `Ctrl+Shift+I` (on Windows and Linux) or `Cmd+Shift+I` (on Mac)

If you don't care for these keybindings, you can customize them in your Keyboard Shortcuts preferences; just set your own bindings:

| Default Key binding | Description |
| --- | --- |
|`Insert or F11` (on Windows and Linux) </br>`Fn+Enter or F11` (on Mac) | `spin2.insertMode.rotate`:</br>Rotate thru: Insert -> Overtype -> Align -> and back to Insert...
|`Ctrl+Shift+I` (on Windows and Linux) </br>`Cmd+Shift+I` (on Mac) | `spin2.insertMode.toggle`:</br>Rotate thru: Insert -> Align -> and back to Insert...


#### Edit Mode: Insert 

This mode is your everyday typing mode. Where your cursor is you type and characters are entered shoving text to the right of the cursor to the right.

#### Edit Mode: Overtype

The aptly named **Overtype mode** allows one to type over and replace existing characters in one's text editor. The most common scenario for overtype mode is when it's activated by accident by an unsuspecting user who can't figure out why the computer is eating all the words they already typed.


#### Edit Mode: Visual Demo: Overtype vs. Insert

![Basic demo](DOCs/demo-basic.gif)


#### Edit Mode: Align

*(Excerpt from Parallax "Propeller Tool" help)*:

The **Align mode** is a special version of Edit Mode designed specifically for maintaining source code.  To understand Align mode we first need to consider common programming techniques. There are two very common practices used when writing modern source code:

- indention of code
- alignment of comments to the right of code

It is also common for source code to be viewed and edited using more than one editor application. Historically, programmers have used either tabs or spaces for indention and alignment porposes, both of which prove problematic. Tab characters cause alignment issues because some ediros use different sized tab setting than others. Both tab and space characters cause alignment issues because future edits cause right-side comments to shift out of alignment. 

For our spin code this alignment problem is solved first by disallowing tab characters (Tab key presses emit the proper number of space characters), and second by providing the Align Edit mode. While in Align mode characters inserted into a line affect the neighboring characters but not characters separated by more than one space. The result is that comments and other items separated by more than one space maintain their intended alignment for as long as possible.

Note: This Align mode affects the behavior of the [Tab], [Shift+Tab], [Backspace], and [Delete] keys as well as pasting copied text.

Since the Align mode maintains existing alignments as much as possible, much less time is wasted relaigning elements due to future edits by the programmer.  Additionally, since spaces are used instead of tab characters, the code maintains the same look and feel in any editor that displays it with a mono-spaced font.

The Align mode isn't perfect for all situations, however. We recommend you use Insert mode for most code writing and briefly switch to Align mode to maintain existing code where alignment is a concern. The [Insert] key (or [F11]) rotates the mode through Insert -> Overwrite -> Align and back to Insert again.  The Ctrl+Shift+I (Cmd+Shift+I on mac) key shortcut toggles onlyh between Insert and Align modes.  A little practice with the Align and Insert modes will help you write code more time-efficiently.

Note: since this Align mode is provided by our Spin2 VSCode extension, non-spin source (without the .spin or .spin2 extension) is not presented with align mode.

The higher-level language (spin or spin2) for the propeller is fairly similar to python in that it has code indented to veriaous levels followed by comments:

##### Example spin2 code:

```spin
PUB stopAfterTime(nTime, eTimeUnits) | timeNow
'' Stops the motor, after {time} specified in {timeUnits} [DTU_MILLISEC or DTU_SEC] has elapsed.
'' USE WITH:  driveAtPower()
'' Will ABORT if {time} < 1
    if nTime < 1                                   ' units make sense? (positive?)
        abort                                      ' NO: abort

    case eTimeUnits                                ' ensure we have a valid request
        DTU_MILLISEC:
        DTU_SEC:
        other:
            abort

    if eTimeUnits == DTU_SEC                       ' want result in seconds
        timeNow := getms()
        motorStopMSecs := timeNow + (nTime * 1_000)
    else
        timeNow := getms()                         ' wants milliseconds
        motorStopMSecs := timeNow + nTime

PUB stopMotor()
'' Stops the motor, killing any motion that was still in progress
''  AFFECTED BY:holdAtStop()
    setTargetAccel(0)

PUB emergencyCutoff()
'' EMERGENCY-Stop - Immediately stop motor, killing any motion that was still in progress
    e_stop := TRUE
    setTargetAccel(0)
```

While our lower-level propeller assembly code (pasm, pasm2) has, typically four or five columns to be aligned.

##### Example pasm2 code:

```pasm
DAT
        org
.chr
              call      #hsync                          'do hsync

              add       font_line, #$08                 ' increment chr line selector
              cmpsub    font_line, #$20         wz
    if_z      add       font_base, #$080                ' increment top/middle/bottom lines selector
    if_z      cmpsub    font_base, #$180        wz
    if_z      add       screen_base, #cols              ' increment screen pointer and row
    if_z      incmod    rowx, #rows-1           wz
    if_nz     jmp       #.line                          ' loop until all rows output


              callpa    #14, #blank                     ' bottom blanks

              mov       pa, #10                         ' low vertical syncs
.vsync1       xcont     m_880, #sync_color2
              call      #hsync
              djnz      pa, #.vsync1
              
              ...
```

**Formatting pasm code** - Aligning code like this is where Align mode shines!

### Settings: Global or per-editor

By default the Edit Mode setting is for all open editor windows.  However, if you wish it to be unique to each open editor window then we have a setting for you!

```json
"spinInsertMode.perEditor": true
```

> Sets the insert/overtype mode per editor.</br>
> Default: false

### Settings: Overtype Paste behavior

If you want to enable it, you can turn on overtype paste mode. This setting applies overtype behavior to when you paste text into your editor. Here are the rules:

- If you paste part of a line of text into another line of text, the clipboard contents will overwrite characters until it's done pasting, unless it hits the end of the line first, in which case it'll just extend that line.
- If you already have some text selected when you paste, that text will *always* be overwritten, even if the contents of the clipboard are smaller.
- If you paste some multiline text into a line of text, everything left on that line will be overwritten with the first line of the pasted text, and the remaining pasted lines will be inserted below that line.
- If you cut or copy using vscode's feature that grabs the entire line when you don't have anything selected, pasting that line will overwrite the *entire* line that you're pasting on.

Some additional tips for using overtype paste:

- Don't forget your Undo shortcut(s).
- I know this doesn't work like [insert editor here]. Every single editor handles overtype paste differently. 
- If you think you have a better way to handle this, please let us know.

And here's the setting:

```json
"spinInsertMode.overtypePaste": true
```

> When in overtype mode, uses overtype behavior when pasting text.</br>
> Default: false

### Settings: Enable Align Mode

Our third mode "Align Mode" is seperately enableable for the time being in case it gives anyone problems as we are dialing it in.

```json
"spinInsertMode.enableAlign": true
```

> Enable or Disable Align Mode.</br>
> Default: true


### Settings: Status Bar indicators (abbreviated, localized or none)

Horizontal screen space at a premium? Have too many things in your status bar already?
Turned your monitor sideways because somebody told you it would increase your productivity by at least 23%?
Or simply want to match the language to the general UI?
Don't worry, we've got just the setting for you!

```json
"spinInsertMode.labelInsertMode": "",
"spinInsertMode.labelOvertypeMode": "Ovr"
"spinInsertMode.labelAlignMode": "Aln"
```

> Shows an abbreviated overtype status (`Ovr`) in the status bar if active, an abbreviated align status (`Aln`) in the status bar if activ and nothing for the "normal" Edit Mode.

```json
"spinInsertMode.labelInsertMode": "",
"spinInsertMode.labelOvertypeMode": ""
"spinInsertMode.labelAlignMode": ""
```

> Disable showing the Edit Mode status in the status bar completely.

### Settings: Overtype cursor style

You can change the overtype cursor style from the preferences.
Set the `spinInsertMode.secondaryCursorStyle` to either one of:

- line
- line-thin
- block
- block-outline
- underline
- underline-thin

e.g.

```json
"spinInsertMode.secondaryCursorStyle": "block"
```

> Sets the overtype cursor style.</br>
> Default: block

### Settings: Align cursor style

You can change the align cursor style from the preferences.
Set the `spinInsertMode.ternaryCursorStyle` to either one of:

- line
- line-thin
- block
- block-outline
- underline
- underline-thin

e.g.

```json
"spinInsertMode.ternaryCursorStyle": "underline"
```

> Sets the align cursor style.</br>
> Default: underline


## License

Licensed under the MIT License. <br>
<br>
Follow these links for more information:

### [Copyright](copyright) | [License](LICENSE)


[maintenance-shield]: https://img.shields.io/badge/maintainer-stephen%40ironsheep%2ebiz-blue.svg?style=for-the-badge

[license-shield]: https://camo.githubusercontent.com/bc04f96d911ea5f6e3b00e44fc0731ea74c8e1e9/68747470733a2f2f696d672e736869656c64732e696f2f6769746875622f6c6963656e73652f69616e74726963682f746578742d646976696465722d726f772e7376673f7374796c653d666f722d7468652d6261646765

