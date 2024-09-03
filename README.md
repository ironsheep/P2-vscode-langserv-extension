# VSCode support for the Parallax Propeller v1 & v2 8-Core MCU's

![Project Maintenance][maintenance-shield]
[![License][license-shield]](LICENSE) 
[![Release][Release-shield]](https://github.com/ironsheep/P2-vscode-extensions/releases) 
[![GitHub issues][Issues-shield]](https://github.com/ironsheep/P2-vscode-extensions/issues)

**Spin2 Extension**: 
[![Version][marketplace-version]](https://marketplace.visualstudio.com/items?itemName=ironsheepproductionsllc.spin2) 
[![Installs][marketplace-installs]](https://marketplace.visualstudio.com/items?itemName=ironsheepproductionsllc.spin2) 
[![Downloads][marketplace-downloads]](https://marketplace.visualstudio.com/items?itemName=ironsheepproductionsllc.spin2) 

VSCode support for the Propeller languages: Spin2 and Pasm2 for the [Parallax Inc.](https://parallax.com) Propeller 2 [P2 or P2X8C4M64P](https://www.parallax.com/propeller-2/) along with Spin and Pasm support for the Propeller 1 [P1 or P8X32A](https://www.parallax.com/propeller-1/).  

The P2 and P1 communities thrive in the [P2 Forums](https://forums.parallax.com/categories/propeller-2-multicore-microcontroller) and the [P1 Forums](https://forums.parallax.com/categories/propeller-1-multicore-microcontroller)

The **P2 Forum Thread** containing discussion of [this VSCode support](https://forums.parallax.com/discussion/170068/visual-studio-code-editor-for-p1-p2-spin-pasm#latest)

The **P1 Forum Thread** containing discussion of [this VSCode support](https://forums.parallax.com/discussion/175207/visual-studio-code-supports-p1-development-on-windows-mac-linux-yes-rpi#latest)

## New ToolChain support in v2.30

This new release adds runtime detection of compilers and support for switching compilers for a given project.

Step-by-step, one-time, migration of your environment to v2.3.0 is covered in our [Migrate Checklist](Migrate-v230.md) page.  Please visit this page to adjust your setup for this new version.

## Features
- Full **language server based** support for both P1 (spin/pasm) and P2 (spin2/pasm2) languages
- **Parse detected errors** are reported for each document when referenced/opened. If "**Error Lens**" extension is installed these errors are shown on the offending line of code.
- **Show Hovers** and **Signature Help** features for constants and methods within external objects now shows information from the external file in which they are defined
- Spin **Code Folding** support
- P2 Support:
   - **P2: Syntax and Semantic Highlighting** for both Spin2 and Pasm2 including all Streamer and Smart-pin Symbols as well as all debug() statements with parameter validation for all display types
   - **P2: Show Hovers Feature** Hovers show information about the symbol/object that's below the mouse cursor. In our case this is for both user written code and for Spin2 built-ins.
   - **P2: Signature Help Feature** As you are typing a method name show signature help for both user written methods and for Spin2 built-in methods.
- P1 Support:
   - **P1: Syntax and Semantic Highlighting** for both Spin and Pasm
   - **P1: Show Hovers Feature** Hovers show information about the symbol/object that's below the mouse cursor. In our case this is for both user written code and for Spin built-ins.
   - **P1: Signature Help Feature** As you are typing a method name show signature help for both user written methods and for Spin built-in methods.
- **Object Public interface Documentation generation** via keystroke [Ctrl+Alt+d] - Ctrl+Alt+( d )ocument. <br>- Document opens on right side of editor
- **Object Hierarchy Report generation** via keystroke [Ctrl+Alt+r] - Ctrl+Alt+( r )eport. <br>- Report opens on right side of editor
- **Doc-Comment Generation** for PUB and PRI methods via keystroke [Ctrl+Alt+c] - Ctrl+Alt+( c )omment. <br>- Comment is inserted immediately below the PUB or PRI line.
- Editor **Screen Coloring** support per section à la Parallax **Propeller Tool**
- **Custom tabbing** Tab-stop support per section à la Parallax **Propeller Tool**
- **Tab Sets** You can choose between `Propeller Tool`, `IronSheep`, and `User1` (*adjust in settings to make your favorite set*)
- File navigation from **Outline View**
- File navigation from **Object Hierarchy View**
- **Edit Mode** support à la Parallax **Propeller Tool** [Insert, Overtype and Align]
- Provides rich companion themes for use with non-color backgrounds or with colored backgrounds as well as Syntax only theme (mostly used during semantic highlighting development.
- **P1 Compile only, P2 Compile/Download Support** built-in:
   - Auto detection of installed compilers; supports **FlexSpin**, **pnut_ts** (and **PNut** when on Windows)
   - Status Bar control for enable/disable of debug() compilation.
   - Status Bar control of download to RAM or FLASH.
   - Status Bar control over which PropPlug to use.

### Up next
We are working on the next updates:

- Add ability to use external loaders/terminal for P1 & P2
- Improve Hover support (more doc details such as pasm code help)

These are not yet definate but I'm:

- Looking into customizable Spin code formatter with features like format on save.

### Future directions

- Spin2/Pasm2 code formatter/beautifier - *allows us to have standard formatting for code we share! (source code could be formatted on each file save)*
- Snippets for Spin2/Pasm2 (common code sequences which can be added easily to file being edited (e.g., smart pin setup code for given mode/use)
- Possible Extension Package for P2 (would include all P2 specific extensions)

## Installation

In VSCode search for the "spin2" extension and install it.  It's that easy!  After installation you will be notified to download and install a new version as new versions are released.

**Note:** This extension fully replaces the [Spin by Entomy](https://marketplace.visualstudio.com/items?itemName=Entomy.spin) vscode extension. While either can be used, our version provides more comprehensive Syntax highlighting (as the former has not been maintained) and this extension adds full Semantic Highlighting, Outlining, and Tab support with InsertModes, Document generation, etc. The older Spin extension can now be uninstalled with no loss of functionality.

## VSCode Environment

There are additional companion documents in this Repository:

1. [Configuring User Tasks - Windows](TASKS-User-win.md) which advises on how to automate your P2 Development when using VScode on **Windows**
1. [Configuring User Tasks - MacOS](TASKS-User-macOS.md) which advises on how to automate your P2 Development when using VScode on **macOS**
1. [Configuring User Tasks - RPI](TASKS-User-RPi.md) which advises on how to automate your P2 Development when using VScode on **Raspberry Pi**
1. [Configure VSCode for background coloring by Spin Block](PT-Color-setup.md) how to set up coloring and some additional notes
1. [VSCode Extensions](EXTENSIONS.md) we find useful in our own P2 development
1. [Visual Examples - Tabbing](TAB-VisualEx.md) a visual explaination of how our Tabbing feature works (*For those of us, like me, who understand more easily when we see pictures.*)
1. [Engineering Notes - Tabbing](TAB-SPECs.md) more detailed description of how our Tabbing feature works
1. Spin2 Extension Details: [Settings](Spin2-Settings.md) and [Keyboard Mapping](Spin2-Settings.md#our-spinspin2-vscode-key-mapping)
1. Additional details of new compiler support [ToolChain REF](Spin2-ToolChain.md) 

Also, here are a couple of really useful VSCode sources:

- [VSCode can do that?](https://www.vscodecandothat.com/) Fun website showing specific things VSCode can do - review whats possible that may help you in your use of VSCode.
- YouTube Channel: [Code 2020](https://www.youtube.com/channel/UCyYh-eAr74avLwOyPa1dDNg) - A large list of short videos presenting all manner of useful VSCode tips.

*Please go look at each of these once so you can know what's here when you need them!*

## Known Conflicts with other VSCode Extensions
We know the three extension so far which might interfere with our Spin2 extension. Here's what we've seem:

1. If I haven't already, I'll be submitting pull requests to the Overtype extension maintainers to add code for avoiding interference with our .spin/.spin2 InsertMode feature but in the meantime please ensure that the [Overtype by Adma Maras](https://marketplace.visualstudio.com/items?itemName=adammaras.overtype) and/or [Overtype by DrMerfy](https://marketplace.visualstudio.com/items?itemName=DrMerfy.overtype) extensions are disabled or uninstalled as they can interfere with our extensions' behavior.
2. The Extension [Document This](https://marketplace.visualstudio.com/items?itemName=oouo-diogo-perdigao.docthis) v0.8.2 currently also occasionally intercepts the Ctrl+Alt+D keystroke which we use to generate documentation and our extension then doesn't get the request. I've filed an issue with that extensions' maintainer so maybe this will be fixed in the future.  Meanwhile, you can either disable the **Document This** extension or when you see the warning pop up from the document this extension you can usually just click in your editor window again and then press Ctrl+Alt+d again and it will work after one or more tries.

## Repository Notes

This repository contains a single subproject which is the vscode extension:

- SPIN2/SPIN and PASM2/PASM syntax Highlighting and code navigation [spin2](./spin2) - *Builds*



---

>  If you like my work and/or this has helped you in some way then feel free to help me out for a couple of :coffee:'s or :pizza: slices or support my work by contributing at Patreon!
>
> [![coffee](https://www.buymeacoffee.com/assets/img/custom_images/black_img.png)](https://www.buymeacoffee.com/ironsheep) &nbsp;&nbsp; -OR- &nbsp;&nbsp; [![Patreon](./DOCs/patreon.png)](https://www.patreon.com/IronSheep?fan_landing=true)[Patreon.com/IronSheep](https://www.patreon.com/IronSheep?fan_landing=true)

---

## Credits

Ray [Cluso99] in our [Propeller 2 Forums](https://forums.parallax.com/categories/propeller-2-multicore-microcontroller) which started this effort for us.

Patrick (GitHub [Entomy](https://github.com/Entomy)) for a spin1 extension which helped me get further along with this one.

Jay B. Harlow for contributing the initial elastic tabs feature.

George (GitHub [DrMerfy](https://github.com/DrMerfy)) for the latest [VSCode-Overtype](https://marketplace.visualstudio.com/items?itemName=DrMerfy.overtype) extension which provided the foundation to which we could add the Align mode.

## License

Licensed under the MIT License.

Follow these links for more information:

### [Copyright](copyright) | [License](LICENSE)

[maintenance-shield]: https://img.shields.io/badge/maintainer-stephen%40ironsheep%2ebiz-blue.svg?style=for-the-badge

[marketplace-version]: https://vsmarketplacebadges.dev/version-short/ironsheepproductionsllc.spin2.svg

[marketplace-installs]: https://vsmarketplacebadges.dev/installs-short/ironsheepproductionsllc.spin2.svg

[marketplace-downloads]:https://vsmarketplacebadges.dev/downloads-short/ironsheepproductionsllc.spin2.svg

[marketplace-rating]: https://vsmarketplacebadges.dev/rating-short/ironsheepproductionsllc.spin2.svg

[license-shield]: https://img.shields.io/badge/License-MIT-yellow.svg

[Release-shield]: https://img.shields.io/github/release/ironsheep/P2-vscode-extensions/all.svg

[Issues-shield]: https://img.shields.io/github/issues/ironsheep/P2-vscode-extensions.svg
