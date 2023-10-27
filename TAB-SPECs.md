# Spin2/Pasm2 Syntax highlighting and Code Navigation for VSCode

This page presents how we are thinking about the new Elastic Tabbing à la Propeller Tool as implemeted in our Spin2 extension for VSCode.

![Project Maintenance][maintenance-shield]

[![License][license-shield]](LICENSE)

## Table of Contents

On this Page:

- [Specification](#spin2-elastic-tabs---specification) - Spin2 VSCode Extension Tabbing Specification
- [Research - Propeller Tool](#research-wwptd---what-would-propeller-tool-do) - Survey of **Propeller Tool** Tab, Shift+Tab behaviors
- [Research - VSCode](#research-wwvd---what-would-vscode-do) - Survey of **VSCode** Tab, Shift+Tab behaviors

**Note** *Each of the sections on this page are subdivided into: `Tab` cases followed by `Shift+Tab` cases.*

Additional pages:

- [README](README.md) - Return to opening page of this Repository

---

## Spin2 Elastic Tabs - Specification

This section presents how we ultimately want `Tab` and `Shift-Tab` to behave. 

In general terms, we think of choosing a location in the code that we want to affect and then the `Tab` and `Shift+Tab` tells us how to affect the code at the location we've chosen. 

When we are choosing a location, we consider three forms: 

1. Insert Point - the cursor is place at a specific location on a single line but no charaters are selected.
1. Single line Selection - one or more characters are selected, all on the same line.
1. Multiple line Selection - two or more, consecutive, partial or full lines are selected.

(**NOTE:** *in the future, we may consider a distinct 4th case of selecting columns within a line across two or more consective lines.*)

In this extension, we have "elastic" tab stops, meaning they are not at fixed intervals. This means we can define tab stops at any location within a line. When we say add spaces to next tab-stop, or remove spaces moving line to prior tab-stop we are meaning whatever tab stop is defined within the VSCode Spin2 settings.  In these settings we have unique tab stops per section: CON, OBJ, VAR, DAT, PUB, PRI.  These settings initially are set identical to Propeller Tool v2.7.0

To indent a line (insert a tab) press `Tab`. To outdent a line (remove a tab) press `Shift+Tab`.

We also have a special feature which reminds us of our current tab settings for a given section (PUB, PRI, DAT, etc.). By placing our cursor on a given line and then pressing `Ctrl+Alt+Tab` a "tab-ruler comment line" is placed above the line our cursor is on.

Lastly, we support using DAT tabbing for in-line PASM. In-line pasm for spin2 is found within **PUB** and **PRI** code blocks. The pasm2 is preceeded by `org` or `orgf` and ended with `end` or the actual end of the **PUB** or **PRI** method.

(If you are writing code to be compiled by **FlexSpin** then in-line PASM is additionally recognised as starting with `asm` and ending with `endasm`.)

### Pending Changes before this Specification is Complete

- **To Be Added:** factor in the insert mode effects (more specifically, the Align insert Mode.)

---

### Press TAB (with what selected?):

The following are specific `Tab` cases with intended outcomes. Each case is preceeded by a reference identifier in brackets. These cases are intended to be precise in description so that these descriptions can guide the final implementation and testing of this extension.

**NOTE:** in the [ ] identifer: T = Tab, IP = "Insert Point", SE = "Selection", and ML = "Multi-Line"

#### [TIP1] insert point in non-white

- Tab inserts spaces left of cursor to the next tab-stop. 
- The cursor and all line content to the right of the cursor move to the next right-most tab-stop. (*If the cursor was in the middle of say a word, then this action has the visual effect of splitting the text at the initial cursor position.*)

#### [TIP2] insert point in white

- Tab inserts spaces left of cursor moving text to right of the cursor to the next tab-stop. 
- The cursor is left to left of text that moved.

#### [Group TSE1-4] ---  1st char (left-most) of selection is whitespace  ---

The selections in this group (those that start with selecting whitespace) have a special effect if the "whitespace part of the selection" spans a tabstop.

- If it does span a tabstop then the text is moved left to the prior tabstop (*this "spanning a tabstop" selection is thought of as "remove these spaces to move the text on the right to the prior tabstop"*)
- Otherwise, (if the selection does not span a tabstop) then the text is moved right to the next tabstop (unless the text is already at a tabstop.)

For each of the selections in this group:

*(Normally the selected characters would be removed and spaces to the next tab-stop would be inserted but this extension treats this differently as we are using these keys to format code!)*

- The white-space characters are chased to the RIGHT from the start of the selection until the left edge of the following text is found, or until we find the right edge end of line (if there were no non-white characters).  

##### [TSE1] Selection is all white (and DOES span a tab-stop)</br>[TSE2] Selection starts in white, ends in non-white (and whitespace DOES span a tab-stop)

- Spaces are then removed from the left of this cursor postion to move the text left to the prior tab stop. 
- The cursor ends up a tthe left edge of the text that was to the right of it.

##### [TSE3] Selection is all white (and DOES NOT span a tab-stop)</br>[TSE4] Selection starts in white, ends in non-white (and whitespace DOES NOT span a tab-stop)

- If text is already at a tab-stop then nothing happens. Otherwise (if text was not at a tab-stop) then spaces are then inserted to the left of this new cursor postion to the next tab stop.
- The cursor ends up a tthe left edge of the text that was to the right of it.


#### [Group TSE5,6] ---  1st char of selection is NOT whitespace  ---

*(Normally the selected characters would be removed and spaces to the next tab-stop would be inserted but this extension treats this differently as we are using these keys to format code!)*

When the selection starts with characters, not whitespace, then the selection is treated as marking the non-white text that is to be indented by the TAB.  Since the selection may not start at the beginning of the non-white characters we first locate the start of the text by searching to the LEFT of the cursor. This search will end up at the first space found, or (when no spaces are found) will end up at the beginning of the line.

##### [TSE5] selection all non-white</br>[TSE6] selection starts in non-white, ends in white

*(these both behave the same way)*

- The non-white characters are chased to the left from the left edge of the selection until the left edge of the text is found (note this could be the beginning of the line, if it is not indented). The cursor is moved to this new position (To the left edge of the text identified by the selection). 

- Spaces are then inserted to the left of this new cusor postion to the next tab stop. The cursor ends up, still to left of the left edge of the text, but the cursor and the text to the right of it have moved to the next tab-stop.


#### [Group TML1 - TML4] ---  multiple line selection  ---

##### [TML1] multiple full lines</br>[TML2] multiple full lines w/partial last line</br>[TML3] multiple full lines w/partial first and last lines</br>[TML4] two lines: partial first and last lines

*(these all behave the same way)*

- All lines in selected region are treated as if each entire line was selected
- The next tabstop is calculated from the left-most text for each the line independently
- Each line is moved to the next tabstop by inserting spaces to the left of the first non-white character on the line. 
- If the line was empty spaces are appended to get to the next tabstop
- The cursor will be at the start, or the end, of the selection. If the cursor was in left edge white-space it does not move. If, instead, it was after the left edge text on the line then it moved with the line but stayed in the same relative postion within the line. 
- Desired behavior for cursor is that if a cursor was on a line that moved the cursor should be placed at the text left edge on that line

---

### Press SHIFT+TAB (with what selected?):

The following are specific `Shift+Tab` cases with intended outcomes. Each case is preceeded by a reference identifier in brackets. These cases are intended to be precise in description so that these descriptions can guide the final implementation and testing of this extension.

**NOTE:** in the [ ] identifer: U = UnTab, IP = "Insert Point", SE = "Selection", and ML = "Multi-Line"

#### [UIP1] insert point in non-white

Think of this as: *"I clicked within a text object, move the object left."*

The Left edge of the text affected is located by searching LEFT from cursor. All text on the line from this left edge to the right end of the line are affected by the move.

- The affected text (Left-edge of which was located left of the cursor) and all text to the right is shifted left by one tab stop.
- If the text would butt into earlier text on the line the moving text will move left but leave one space between the earlier text and the moving text.
- - The cursor stays where was placed but moves relative with the text if the text moves

#### [UIP2] insert point in white

Think of this as: *"I clicked between text objects, move the object on the right to the left."*


The Left edge of the text affected is located by searching RIGHT from cursor. All text on the line from this left edge to the right end of the line are affected by the move.

- The affected text (Left-edge of which was located left of the cursor) and all text to the right is shifted LEFT by one tab stop.
- If the text would butt into earlier text on the line the moving text will move left but leave one space between the earlier text and the moving text.
- The cursor will stay where it was unless the moving text interferes. It will come to rest at the text left edge if the text affects the location where the cursor started 


#### [Group USE1, USE2] ---  1st char (left-most) of selection is whitespace  ---

##### [USE1] selection all white</br>[USE2] selection start in white end in non-white

*(these both behave the same way)*

The Left edge of the text affected is located by searching RIGHT from left edge of the selection. All text on the line from this left edge of the text to the right end of the line are affected by the move.

- The affected text (Left-edge of which was located to the right of the cursor) and all text to the right is shifted left by one tab stop.
- If the text would butt into earlier text on the line the moving text will move left but leave one space between the earlier text and the moving text.
- The cursor should end up at the newly relocated text left edge 

#### [Group USE3, USE4] ---  1st char (left-most) of selection is NOT whitespace  ---

##### [USE3] selection all non-white</br>[USE4] selection start in non-white end in white

*(these both behave the same way)*

The Left edge of the text affected is located by searching LEFT from cursor. All text on the line from this text left edge to the right end of the line are affected by the move.

- The affected text (Left-edge of which was located left of the cursor) and all text to the right is shifted left by one tab stop.
- If the text would butt into earlier text on the line the moving text will move left but leave one space between the earlier text and the moving text.
- The cursor should end up at the newly relocated textleft edge


#### [Group UML1 - UML4] ---  multiple line selection  ---

##### [UML1] multiple full lines</br>[UML2] multiple full lines w/partial last line</br>[UML3] multiple full lines w/partial first and last lines</br>[UML4] two lines: partial first and last lines

*(these all behave the same way)*

- All lines in selected region are treated as if each entire line was selected
- If the line was not indented, no adjustment is made to the line or cursor (nothing happenes).
- For any lines not at left edge they move left one tab stop (from the 1st character on the line)
- (*all lines maintain their current indent relative to each other, until some lines arrive at the left edge or some lines were already at the left edge so they couldn't be moved.*)
- The cursor will be at the start, or the end, of the selection. If the cursor was in the white-space that was removed, the cursor moves to the tab stop along with the text which was right of the cursor. If the cursor was elsewhere it remains where it was in line but moved with the text to the left. Lastly, if the cursor was to the left of the new tab-stop then the cursor didn't move. *(Whew!)*
- Desired behavior for cursor is that if a cursor was on a line that moved the cursor should be placed at the text left edge on that line

---

## Research: WWPTD - (What would Propeller Tool do?)

I studied the Propeller Tool documentation to determine what special features are present with respect TAB and insert modes.  Here are my findings:

**NOTE:** *In Propeller Tool the backspace key behavior is also altered according to the custom tab settins. We are not planning to do this in VSCode.*


### Press TAB (with what selected?):

    [TIP1] Cursor placed to left of text on line
        	- tab inserts spaces to next tab-stop to left of cursor (effictively cursor moves with text)
    [TML1] multiple full/partial lines selected
    	- All lines moved right one tab stop (all lines maintain their current indent relative to each other)
    [UCML1] multiple columns selected across multiple lines
    	- All text from left selected column moved right one tab stop

### Press SHIFT+TAB (with what selected?):

    [UP1] Cursor placed to left of text on line
    	- entire line is shifted left to next tab stop, cursor remains where it was in line
    [UML1] multiple full/partial lines selected
    	- All lines moved left one tab stop (all lines maintain their current indent relative to each other, unless one or more line(s) is/are already at left edge)
    	- if text on line is already at left edge - nothing happens to that line
    [UCML1] multiple columns selected across multiple lines
    	- All text from left selected column moved left one tab stop

### Effect of INSERT, OVERTYPE and ALIGN insert Modes

The Propeller Tool documentation says very little about insert and overtype modes. But in the end **Insert Mode** shoves characters immediately to the right of the cursor to the right with each character typed while **Overtype Mode** simply replaces the character to the right of the cursor with the character entered. 

The interesting things happen with **Align Mode**. To quote propeller tool docs: 

"*While in Align Mode characters inserted affect characters immediately to the right of the cursor but not characters separated by more than one space. The result is that comments and other items separated by more than one space maintain their intended alignment for as long as possible.*"


### Effect of Block Selection and Block Moving

This is used in Propeller tool. It may be supported already in VSCode. I have to practice with it.  I'm not sure if there is an interaction with our new elastic tabs and this ability. If there should be I'll note it here when I found out. At this point in time of my learning I don't think we need to address this.  We'll see.

---

## Research: WWVD - (What would VSCode do?)

I tested various (hopefully comprehensive) cases of selection and what happens when I press tab or shift+tab in these cases.  The following are my notes on VSCode behavior I observed:

### Press TAB (with what selected?):

    [TIP1] insert point in non-white
    	- tab inserts spaces to next tab-stop to left of cursor, splits chars at cursor
    [TIP2] insert point in white
    	- tab inserts spaces to next tab-stop to left of cursor
    [TSE1] selection all non-white
    	- The entire selection is removed and a single tab is inserted to the left of the cursor
    [TSE2] selection all white
    	- The entire selection is removed and a single tab is inserted to the left of the cursor
    [TSE3] selection start in non-white end in white
    	- The entire selection is removed and a single tab is inserted to the left of the cursor
    [TSE4] selection start in white end in non-white
    	- The entire selection is removed and a single tab is inserted to the left of the cursor
    [TML1] multiple full lines
    	- All lines moved right one tab stop (all lines maintain their current indent relative to each other)
    [TML2] multiple full lines w/partial last line
    	- All lines moved right one tab stop (all lines maintain their current indent relative to each other)
    [TML3] multiple full lines w/partial first and last lines
    	- All lines moved right one tab stop (all lines maintain their current indent relative to each other)
    [TML4] two lines: partial first and last lines
    	- All lines moved right one tab stop (all lines maintain their current indent relative to each other)


### Press SHIFT+TAB (with what selected?):

    [UIP1] insert point in non-white
    	- entire line is shifted left to next tab stop, cursor remains where it was in line
    [UIP2] insert point in white
    	- entire line is shifted left to next tab stop, cursor remains where it was in line
    [USE1] selection all non-white
    	- entire line is shifted left to next tab stop, cursor remains where it was in line
    [USE2] selection all white
    	- 3 outcomes:
    		- (1) 1st text is left of selected white but there is whitespace to left of 1st text
    			- entire line is shifted left to next tab stop, cursor remains where it was in line
    		- (2) 1st text is right of selected white
    			- entire line is shifted left to next tab stop, cursor remains where it was in line
    		- (3) 1st text is left of selected white but 1st text is flush at left edge of line
    				- NOTHING happens!
    [USE3] selection start in non-white end in white
    	- 2 outcomes:
    		- (1) 1st text is indented from left edge
    				- entire line is shifted left to next tab stop, cursor remains where it was in line
    		- (2) 1st text is flush at left edge
    			- NOTHING happens!
    [USE4] selection start in white end in non-white
    	- 2 outcomes:
    		- (1) 1st text is indented from left edge
    				- entire line is shifted left to next tab stop, cursor remains where it was in line
    		- (2) 1st text is flush at left edge
    			- NOTHING happens!
    [UML1] multiple full lines
    [UML2] multiple full lines w/partial last line
    [UML3] multiple full lines w/partial first and last lines
    [UML4] two lines: partial first and last lines
    	- All lines in selected region are treated:
    		- if text on line is already at left edge - nothing happens
    		- for any lines not at left edge they move left one tab stop 
    		- (all lines that are not already at the left edge of the line maintain their current indent relative to each other)

While this will inform some of the spin2 tabbing behaviors we are adding additional behaviors on top of this.

*-Stephen*


---

## Spin2 Elastic Tabs - DRAFT Implementation - v1.5.x</Br>(for reference only)

**No longer behaves this way in releases v1.6.x and later.**

### Press TAB (with what selected?):

	- [IP1] insert point: in NON-WHITE
		- (place cursor here)
		- should move text at cursor, splitting text
	- [IP2] insert point: in WHITE
		- (place cursor at left-edge of text to right, OR END-OF-LINE)
		- should move text at cursor, or just append spaces to next tab
	- [SE1] selection (All NON-WHITE)
		- (should location left edge of NON-WHITE (to left) and and place cursor there)
	- [SE2] selection (starts WHITE, ends NON-WHITE)
		- (should location left edge of NON-WHITE, within selection, set cursor there)
	- [SE3] selection (starts NON-WHITE, ends WHITE)
		- (should location left edge of NON-WHITE before start of selection, set cursor there) 
	- [SE4] selection (All WHITE)
		- (should place cursor at left-edge of text to right)
			- selected text should be removed
			- next tab is calc from left of selection, not cursor
			- insert spaces to next TAB from left of selection
		- (OR DO NOTHING if no more text to right)
	- [ML1] Multi-line (FAKE SINGLE LINE)
		- (should location left edge of NON-WHITE, place cursor there)
		- (skipping WHITE at left of line)
	
NOTE: Tab on empty lines should just cause spaces to be appended to next tab stop.

### Press SHIFT+TAB (with what selected?):

	- [UIP1] insert point: in NON-WHITE
		- (place cursor at left-edge of text (to left), OR BEGIN-OF-LINE)
		- just remove spaces from cursor to prior tab
	- [UIP2] insert point: in WHITE
		- (place cursor at left-edge of text (to right), OR END-OF-LINE)
		- just remove spaces from cursor to prior tab
	- [USE1] selection (All NON-WHITE)
		- (place cursor at left-edge of text (to left), OR BEGIN-OF-LINE)
		- just remove spaces from cursor to prior tab
	- [USE2] selection (starts WHITE, ends NON-WHITE)
		- (should location left edge of NON-WHITE, within selection, set cursor there)
		- just remove spaces from cursor to prior tab
	- [USE3] selection (starts NON-WHITE, ends WHITE)
		- (place cursor at left-edge of text (to left), OR BEGIN-OF-LINE)
		- just remove spaces from cursor to prior tab
	- [USE4] selection (All WHITE)
		- (place cursor at left-edge of text (to right), OR END-OF-LINE)
		- just remove spaces from cursor to prior tab
	- [UML1] Multi-line (FAKE SINGLE LINE)
		- (place cursor at left-edge of text (from start of line to right), OR END-OF-LINE)
		- just remove spaces from cursor to prior tab

NOTE: empty lines are ignored for Shift+Tab.



---

>  If you like my work and/or this has helped you in some way then feel free to help me out for a couple of :coffee:'s or :pizza: slices or support my work by contributing at Patreon!
>
> [![coffee](https://www.buymeacoffee.com/assets/img/custom_images/black_img.png)](https://www.buymeacoffee.com/ironsheep) &nbsp;&nbsp; -OR- &nbsp;&nbsp; [![Patreon](./DOCs/patreon.png)](https://www.patreon.com/IronSheep?fan_landing=true)[Patreon.com/IronSheep](https://www.patreon.com/IronSheep?fan_landing=true)


---

## License

Licensed under the MIT License.

Follow these links for more information:

### [Copyright](copyright) | [License](LICENSE)

[maintenance-shield]: https://img.shields.io/badge/maintainer-stephen%40ironsheep%2ebiz-blue.svg?style=for-the-badge

[marketplace-version]: https://vsmarketplacebadge.apphb.com/version-short/ironsheepproductionsllc.spin2.svg

[marketplace-installs]: https://vsmarketplacebadge.apphb.com/installs-short/ironsheepproductionsllc.spin2.svg

[marketplace-rating]: https://vsmarketplacebadge.apphb.com/rating-short/ironsheepproductionsllc.spin2.svg

[license-shield]: https://camo.githubusercontent.com/bc04f96d911ea5f6e3b00e44fc0731ea74c8e1e9/68747470733a2f2f696d672e736869656c64732e696f2f6769746875622f6c6963656e73652f69616e74726963682f746578742d646976696465722d726f772e7376673f7374796c653d666f722d7468652d6261646765
