# VSCode support for the Parallax Propeller 1 & 2 Multicore MCU's

![Project Maintenance][maintenance-shield]
[![License][license-shield]](LICENSE) 

## Our Spin/Spin2 VSCode Extension Settings

In general To open the Settings editor, navigate to **[Code]** > **Settings** > **Settings**.

The Spin2 extension settings are in 3 sections.  If when you get to settings and type in "**SpinExt**" as a filter and you'll see the 3 sections of our new Spin2 Extension settings:

![Settings 1 of 5](./DOCs/stgs-extn.png)
**FIGURE 1**: Our three sections, with the first section selected

- **Highlight FlexSpin directives** - This enables support for #if, #else, etc. FlexSpin directives
- **Max Number of Reported Issues** - This allows you to limit how many messages are shown per file
- **Trace Server**- boared? want to see how the client interacts with the server then select a value here other then off. (this can slow things down)
- **Color Editor Background** - check this to turn on Propeller Tool coloring (you'll also need to adjust the color theme to make this readable!)
- **Editor Background Alpha** - if you wnat to something a bit darker then you can adjust this.

Click on the 2nd section to see:

![Settings 2 of 5](./DOCs/stgs-tabstops.png)
**FIGURE 2**: with he 2nd section selected

- Elastic Tabstops **Enable** - check this to turn ON the Elastic Tabstops feature
- **Iron Sheep** - click on link to adjust the tab columns (default is what the Author uses)
- **Propeller Tool**- click on link to adjust the tab columns (default is Propeller Tool defaults)
- **User1** - click on link to adjust the tab columns (this one is meant for you to customize if you wnat your own settings)
- Elastic Tabstops **Choice** - select the set of tabstops you wish to use

Click on the 3rd section to see:

![Settings 3 of 5](./DOCs/stgs-insertMode.png)
**FIGURE 3**: with the 3rd section selected

Insert Mode Adjustments:

- **Enable Align** - Adds Align mode to modes: Insert and Overtype
- **Label Align Mode**- Change the default label text
- **Label Insert Mode**- Change the default label text
- **Label Overtype Mode**- Change the default label text
- **Overtype Paste** - Alters paste behavior when in Overtype mode
- **Per Editor** - Let's each editor have it's own current mode setting (Default off)
- **Secondary Cursor Style** - Adjusts the Overtype cursor
- **Ternary Cursor Style** - Adjusts the Align cursor

Click on the 4th section to see:

![Settings 4 of 5](./DOCs/stgs-toolchain1.png)
**FIGURE 4**: with the 4th section selected (only showing first group of entries)

ToolChain Adjustments:

You will be modifying only a couple of the values in this section. The remainder are determined when VSCode starts or when you interact with status-bar controls. The following are the values you will be periodically adjusting.

- **Selected Compiler** - Choose the compiler you wish to use (set for User/Workspace)
- **Enable listing output**- Enable/disable .lst file output
- **Enter Terminal After**- select one of [ never, when debug() enabled, or always ]
- **User Baudrate**- Enter the comms rate for you application serial debug output
- **Flexspin Debug**- Select between -gbrk and -g

The following are adjusted by clicking on status bar controls:

- **Enable Debug()** - Click on "debug:[ON/off]" StatusBar control
- **Enable Flash**- Click on "Dnld:[RAM/FLASH]" StatusBar control
- **Selected PropPlug**- Click on "Plug:..." StatusBar control

## Our Spin/Spin2 VSCode Key Mapping

In general To open the Settings editor, navigate to **[Code]** > **Settings** > **Keyboard Shortcuts**.

The kayboard mappings are different on Windows than they are on Mac, RPi or Linux.

### The Key Mapping on Windows:

![Keys 1 of 3](./DOCs/win-keys.png)
**FIGURE 5**: Keyboard Shortcuts screen on Windows.

### The Key Mapping on RPi, Linux:

![Keys 2 of 3](./DOCs/RPi-keys.png)
**FIGURE 6**: Keyboard Shortcuts screen on Mac (same on RPi and Linux).

### The Key Mapping on MacOS:

![Keys 3 of 3](./DOCs/mac-keys.png)
**FIGURE 7**: Keyboard Shortcuts screen on Mac (same on RPi and Linux).

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
