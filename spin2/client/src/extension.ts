/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
// src/extensions.ts
/* eslint-disable no-console */ // allow console writes from this file
import * as path from 'path';
//import * as fs from 'fs';
import * as vscode from 'vscode';

import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

import { Formatter } from './providers/spin.tabFormatter';
import { DocGenerator } from './providers/spin.document.generate';
import { ObjectTreeProvider, Dependency } from './spin.object.dependencies';
import { RegionColorizer } from './providers/spin.color.regions';
import { overtypeBeforePaste, overtypeBeforeType } from './providers/spin.editMode.behavior';
import { editModeConfiguration, reloadEditModeConfiguration } from './providers/spin.editMode.configuration';
import { tabConfiguration } from './providers/spin.tabFormatter.configuration';
import { getMode, resetModes, toggleMode, toggleMode2State, eEditMode, modeName } from './providers/spin.editMode.mode';
import { createStatusBarInsertModeItem, updateStatusBarInsertModeItem } from './providers/spin.editMode.statusBarItem';
import { activeSpin1or2Filespec, findDebugPinTx, isSpin2Document, isSpin2File, isSpin1or2File, isSpinOrPasmDocument } from './spin.vscode.utils';
import { USBDocGenerator } from './providers/usb.document.generate';
import { isMac, isWindows, loadFileAsUint8Array, loadUint8ArrayFailed, locateExe, locateNonExe, platform, writeBinaryFile } from './fileUtils';
import { IUsbSerialDevice, UsbSerial } from './usb.serial';
import { createStatusBarFlashDownloadItem, updateStatusBarFlashDownloadItem } from './providers/spin.downloadFlashMode.statusBarItem';
import { createStatusBarCompileDebugItem, updateStatusBarCompileDebugItem } from './providers/spin.compileDebugMode.statusBarItem';
import { createStatusBarPropPlugItem, updateStatusBarPropPlugItem } from './providers/spin.propPlug.statusBarItem';
import {
  PATH_FLEXSPIN,
  PATH_LOADER_BIN,
  PATH_LOADP2,
  PATH_PROPLOADER,
  PATH_PNUT,
  PATH_PNUT_TS,
  reloadToolchainConfiguration,
  toolchainConfiguration,
  validCompilerIDs
} from './providers/spin.toolChain.configuration';
import { ObjectImage } from './imageUtils';
import { getFlashLoaderBin } from './spin.vscode.fileUtils';
import { UsbSerialTerminal } from './usb.serial.terminal';
import { LoaderPseudoterminal } from './pseudo.terminal';

let client: LanguageClient;
let spin2Context: vscode.ExtensionContext;

enum eConfigSection {
  CS_USER,
  CS_WORKSPACE
}

const isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
let debugOutputChannel: vscode.OutputChannel | undefined = undefined;

const objTreeProvider: ObjectTreeProvider = new ObjectTreeProvider();
const tabFormatter: Formatter = new Formatter();
const docGenerator: DocGenerator = new DocGenerator(objTreeProvider);
const codeBlockColorizer: RegionColorizer = new RegionColorizer();
const usbDocGenerator: USBDocGenerator = new USBDocGenerator();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
//const forceToolChainConfLoad = toolchainConfiguration; // reference to force load on startup
const logExtensionMessage = (message: string): void => {
  // simple utility to write to TABBING  output window.
  if (isDebugLogEnabled && debugOutputChannel !== undefined) {
    //Write to output window.
    debugOutputChannel.appendLine(message);
  }
};

let useInternalDownloader: boolean = false;
let runtimeSettingChangeInProgress: boolean = false;

function getSetupExtensionClient(context: vscode.ExtensionContext): LanguageClient {
  // The server is implemented in node
  const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc
    }
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector: [
      { scheme: 'file', language: 'spin' },
      { scheme: 'file', language: 'spin2' },
      { scheme: 'file', language: 'p2asm' } // is here so we can semantic highlight this files
    ],
    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*')
    }
  };

  // Create the language client and start the client.
  const client = new LanguageClient('spinExtension', 'Spin2 Language Server', serverOptions, clientOptions);
  return client;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function registerProviders(context: vscode.ExtensionContext): void {
  // register client-side providers: tabbing and document generation
}

function registerCommands(context: vscode.ExtensionContext): void {
  // register client-side commands: tabbing and document generation

  // ----------------------------------------------------------------------------
  //   Hook GENERATE Object Public Interface Document
  //
  const generateDocumentFileCommand: string = 'spinExtension.generate.documentation.file';

  context.subscriptions.push(
    vscode.commands.registerCommand(generateDocumentFileCommand, async () => {
      docGenerator.logMessage('CMD: generateDocumentFileCommand');
      try {
        // and test it!
        docGenerator.generateDocument();
        docGenerator.showDocument('.txt');
      } catch (error) {
        await vscode.window.showErrorMessage('Document Generation Problem');
        console.error(error);
      }
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook GENERATE Object Hierarchy Document
  //
  const generateHierarchyFileCommand: string = 'spinExtension.generate.hierarchy.file';

  context.subscriptions.push(
    vscode.commands.registerCommand(generateHierarchyFileCommand, async () => {
      docGenerator.logMessage('CMD: generateHierarchyFileCommand');
      try {
        // and test it!
        docGenerator.generateHierarchyDocument();
        docGenerator.showDocument('.readme.txt');
      } catch (error) {
        await vscode.window.showErrorMessage(`Hierarchy Generation Problem\n${error.stack}`);
        logExtensionMessage(`Exception: Hierarchy Generation Problem\n${error.stack}`);
        console.error(error);
      }
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook GENERATE USB TEST Document
  //
  const generateUSBDocumentFileCommand: string = 'spinExtension.generate.usb.documentation.file';

  context.subscriptions.push(
    vscode.commands.registerCommand(generateUSBDocumentFileCommand, async () => {
      usbDocGenerator.logMessage('CMD: generateUSBDocumentFileCommand');
      try {
        // and test it!
        usbDocGenerator.generateUsbReportDocument();
        usbDocGenerator.showDocument('.usb.txt');
      } catch (error) {
        await vscode.window.showErrorMessage('USB Document Generation Problem');
        console.error(error);
      }
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook ... lot's o stuff
  //
  const statusInsertModeBarItem: vscode.StatusBarItem = createStatusBarInsertModeItem();
  const statusCompileDebugBarItem: vscode.StatusBarItem = createStatusBarCompileDebugItem();
  const statusDownloadFlashBarItem: vscode.StatusBarItem = createStatusBarFlashDownloadItem();
  const statusPropPlugBarItem: vscode.StatusBarItem = createStatusBarPropPlugItem();
  handleActiveTextEditorChanged(); // now show or hide based upon current/active window

  context.subscriptions.push(
    vscode.commands.registerCommand('spinExtension.insertMode.rotate', toggleCommand),
    vscode.commands.registerCommand('spinExtension.insertMode.toggle', toggleCommand2State),

    vscode.commands.registerCommand('type', typeCommand),
    vscode.commands.registerCommand('paste', pasteCommand),

    vscode.commands.registerCommand('spinExtension.insertMode.deleteLeft', deleteLeftCommand),
    vscode.commands.registerCommand('spinExtension.insertMode.deleteRight', deleteRightCommand),

    vscode.window.onDidChangeActiveTextEditor(handleActiveTextEditorChanged),
    vscode.window.onDidChangeVisibleTextEditors(handleVisibleTextEditorChanged),

    vscode.workspace.onDidChangeTextDocument(handleTextDocumentChanged),
    vscode.workspace.onDidCloseTextDocument(handleTextDocumentClosed),
    vscode.workspace.onDidOpenTextDocument(handleTextDocumentOpened),

    vscode.workspace.onDidChangeConfiguration(handleDidChangeConfiguration),

    statusCompileDebugBarItem,
    statusDownloadFlashBarItem,
    statusPropPlugBarItem,
    statusInsertModeBarItem
  );

  // ----------------------------------------------------------------------------
  //   Hook Update region colors in editor
  //

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function handleTextDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent) {
    vscode.window.visibleTextEditors.map((editor) => {
      recolorizeSpinDocumentIfChanged(editor, 'handleTextDocumentChanged', 'Ext-docDidChg');
    });
    updateStatusBarItems('handleTextDocumentChanged');
  }

  let startupComplete: boolean = false;
  const startupPaths: string[] = ['/settings/resourceLanguage', '/launch', '/token-styling', '/textmate-colors', '/workbench-colors'];

  function handleTextDocumentOpened(textDocument: vscode.TextDocument) {
    logExtensionMessage(`* handleTextDocumentOpened(${textDocument.fileName}) `);

    if (!startupComplete) {
      if (startupPaths.includes(textDocument.fileName)) {
        startupComplete = true;
        logExtensionMessage(`* handleTextDocumentOpened() Startup is complete!`);
      }
    }
    if (isSpinOrPasmDocument(textDocument)) {
      vscode.window.visibleTextEditors.map((editor) => {
        if (editor.document.uri == textDocument.uri) {
          recolorizeSpinDocumentIfChanged(editor, 'handleTextDocumentOpened', 'Ext-docDidOpen', true);
        }
      });
    }
  }

  // ----------------------------------------------------------------------------
  //   Hook GENERATE PUB/PRI Comment Block
  //
  const generateDocCommentCommand: string = 'spinExtension.generate.doc.comment';

  context.subscriptions.push(
    vscode.commands.registerCommand(generateDocCommentCommand, async () => {
      docGenerator.logMessage('CMD: generateDocumentCommentCommand');
      try {
        // and test it!
        const editor = vscode?.window.activeTextEditor;
        const document = editor.document!;
        const textEdits = await docGenerator.insertDocComment(document, editor.selections);
        applyTextEdits(document, textEdits!);
      } catch (error) {
        await vscode.window.showErrorMessage('Document Comment Generation Problem');
        console.error(error);
      }
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook GENERATE list of USB Serial (Proplug) Devices
  //
  const selectPropPlugFromListCommand: string = 'spinExtension.select.propplug';

  context.subscriptions.push(
    vscode.commands.registerCommand(selectPropPlugFromListCommand, async function () {
      logExtensionMessage('CMD: selectPropPlugFromList');
      runtimeSettingChangeInProgress = true;
      await scanForAndRecordPropPlugs(); // load current list into settings
      // get settings list
      const deviceNodesFound = toolchainConfiguration.deviceNodesFound;
      const devicesFound: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const deviceNode of Object.keys(deviceNodesFound)) {
        const deviceSerialStr: string = deviceNodesFound[deviceNode];
        const plugValueParts: string[] = deviceSerialStr.split(',');
        const deviceSerial: string = plugValueParts.length > 0 ? plugValueParts[0] : '';
        if (isWindows()) {
          // On windows show COMn:SerialNumber
          devicesFound.push(`${deviceNode}:${deviceSerial}`);
        } else {
          // On non-windows show Device Node name (in select list)
          devicesFound.push(deviceNode);
        }
      }

      switch (devicesFound.length) {
        case 1:
          {
            const selectedDevice = devicesFound[0];
            const selectedPort = comPortFromDevice(devicesFound[0]);
            vscode.window.showInformationMessage(`The only PropPlug ${selectedDevice} was selected for you automatically.`);
            await updateConfig('toolchain.propPlug.selected', selectedPort, eConfigSection.CS_USER);
          }
          break;
        case 0:
          vscode.window.showWarningMessage(`There are no available PropPlugs!`);
          await updateConfig('toolchain.propPlug.selected', undefined, eConfigSection.CS_USER);
          break;

        default:
          // Show the list of choices to the user.
          vscode.window.showInformationMessage('Select the PropPlug connecting to your P2', ...devicesFound).then(async (userSelectedDevice) => {
            // Save the user's choice in the workspace configuration.
            //logExtensionMessage(`USER: userSelectedDevice=[${userSelectedDevice}]`);
            // NOTE: if dialog is cancelled then userSelectedDevice is undefined!
            if (userSelectedDevice !== undefined) {
              const selectedPort = comPortFromDevice(userSelectedDevice);
              await updateConfig('toolchain.propPlug.selected', selectedPort, eConfigSection.CS_USER);
            }
          });
          break;
      }
      runtimeSettingChangeInProgress = false;
    })
  ); //*/

  function comPortFromDevice(deviceNode: string): string {
    // on windows the port is COMn:SerialNumber, if this is present we want just the COMn
    let selectedPort: string = deviceNode;
    if (selectedPort !== undefined && selectedPort.indexOf(':') != -1) {
      selectedPort = selectedPort.split(':')[0]; // windows serial port name is before the colon
    }
    return selectedPort;
  }

  // ----------------------------------------------------------------------------
  //   Hook to Return all compile arguments and filename for use in UserTasks
  //
  const getCompileArgsCommand: string = 'spinExtension.getCompilerArguments';
  context.subscriptions.push(
    vscode.commands.registerCommand(getCompileArgsCommand, () => {
      const optionsBuild = vscode.workspace.getConfiguration('spin2').get('optionsBuild');
      const optionsBuildAr: string[] = Array.isArray(optionsBuild) ? optionsBuild : [optionsBuild];
      const quotedOptionsBuildAr = optionsBuildAr.map((option) => (option.includes(' ') ? `"${option}"` : option));
      const buildArgString: string = quotedOptionsBuildAr.join(' ');
      logExtensionMessage(`CMD: getCompilerArguments -> [${buildArgString}]`);
      return buildArgString;
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook to Return all loader arguments and filename for use in UserTasks
  //
  const getLoaderArgsCommand: string = 'spinExtension.getLoaderArguments';
  context.subscriptions.push(
    vscode.commands.registerCommand(getLoaderArgsCommand, () => {
      const optionsLoader = vscode.workspace.getConfiguration('spin2').get('optionsLoader');
      const optionsLoaderAr: string[] = Array.isArray(optionsLoader) ? optionsLoader : [optionsLoader];
      const quotedOptionsLoaderAr = optionsLoaderAr.map((option) => (option.includes(' ') ? `"${option}"` : option));
      const loaderArgString: string = quotedOptionsLoaderAr.join(' ');
      logExtensionMessage(`CMD: getLoaderArguments -> [${loaderArgString}]`);
      return loaderArgString;
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook TOGGLE compile w/Debug and update display
  //
  const toggleCompileWithDebugCommand: string = 'spinExtension.toggle.debug';
  context.subscriptions.push(
    vscode.commands.registerCommand(toggleCompileWithDebugCommand, async () => {
      logExtensionMessage('CMD: toggleCompileWithDebug');
      try {
        runtimeSettingChangeInProgress = true;
        const isDebugEnabled: boolean = toolchainConfiguration.debugEnabled;
        const newEnableState = isDebugEnabled ? false : true;
        await updateConfig('toolchain.optionsCompile.enableDebug', newEnableState, eConfigSection.CS_WORKSPACE);
        logExtensionMessage(`* enableDebug (${isDebugEnabled}) -> (${newEnableState})`);
      } catch (error) {
        await vscode.window.showErrorMessage(`TOGGLE-Debug Problem: error=[${error}]`);
        console.error(error);
      } finally {
        runtimeSettingChangeInProgress = false;
      }
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook TOGGLE download to FLASH and update display
  //
  const toggleDownloadToFlashCommand: string = 'spinExtension.toggle.flash';

  context.subscriptions.push(
    vscode.commands.registerCommand(toggleDownloadToFlashCommand, async () => {
      logExtensionMessage('CMD: toggleDownloadToFlash');
      try {
        runtimeSettingChangeInProgress = true;
        const isFlashEnabled: boolean = toolchainConfiguration.writeFlashEnabled;
        const newEnableState = isFlashEnabled ? false : true;
        await updateConfig('toolchain.optionsDownload.enableFlash', newEnableState, eConfigSection.CS_WORKSPACE);
        logExtensionMessage(`* enableFlash (${isFlashEnabled}) -> (${newEnableState})`);
      } catch (error) {
        await vscode.window.showErrorMessage(`TOGGLE-FLASH Problem: error=[${error}]`);
        console.error(error);
      } finally {
        runtimeSettingChangeInProgress = false;
      }
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook Compile current .spin2 file
  //
  const compileCurrentSpin2FileCommand: string = 'spinExtension.compile.currfile';

  context.subscriptions.push(
    vscode.commands.registerCommand(compileCurrentSpin2FileCommand, async () => {
      logExtensionMessage('CMD: compileCurrentSpin2File');
      if (await ensureIsGoodCompilerSelection()) {
        const tasks = await vscode.tasks.fetchTasks();
        const taskToRun = tasks.find((task) => task.name === 'compileP2');

        if (taskToRun) {
          // TODO: should the following be await or not?
          vscode.tasks.executeTask(taskToRun);
        } else {
          const errorMessage: string = 'Task:compileP2 not found in User-Tasks';
          await vscode.window.showErrorMessage(errorMessage);
          console.error(errorMessage);
        }
      }
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook Compile TOP .spin2 file
  //
  const compileTopSpin2FileCommand: string = 'spinExtension.compile.topfile';

  context.subscriptions.push(
    vscode.commands.registerCommand(compileTopSpin2FileCommand, async () => {
      // this compile will fall-back to compile current when there is NO 'topLevel' defined!
      const topFilename = toolchainConfiguration.topFilename;
      const taskName = topFilename !== undefined ? 'compileTopP2' : 'compileP2';
      logExtensionMessage(`CMD: compileTopSpin2File - topFile=[${topFilename}] task=[${taskName}]`);
      if (await ensureIsGoodCompilerSelection()) {
        const tasks = await vscode.tasks.fetchTasks();
        const taskToRun = tasks.find((task) => task.name === taskName);

        if (taskToRun) {
          // TODO: should the following be await or not?
          vscode.tasks.executeTask(taskToRun);
        } else {
          const errorMessage: string = `Task:${taskName} not found in User-Tasks`;
          await vscode.window.showErrorMessage(errorMessage);
          console.error(errorMessage);
        }
      }
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook Download TOP binary file
  //
  const downloadTopFileCommand: string = 'spinExtension.download.topfile';

  let downloaderTerminal: LoaderPseudoterminal | undefined = undefined;

  context.subscriptions.push(
    vscode.commands.registerCommand(downloadTopFileCommand, async () => {
      logExtensionMessage('CMD: downloadTopFile');
      const activeTopFilename: string = getActiveSourceFilename();
      const haveP1Download: boolean = activeTopFilename !== undefined && activeTopFilename.endsWith('.spin');
      const haveFlexspin: boolean = toolchainConfiguration.flexspinInstalled;
      let downloadCanProceed: boolean = true;
      if (await ensureIsGoodCompilerSelection()) {
        const selectedCompiler: string | undefined = toolchainConfiguration.selectedCompilerID;
        // using internal downloader for pnut_ts (and flexspin on macOS after discussion with Eric R Smith, 18 Jun)
        if (selectedCompiler !== undefined) {
          if (selectedCompiler == PATH_PNUT_TS) {
            useInternalDownloader = false; // this is disabled for v3.0.0 release
            if (haveFlexspin == false) {
              downloadCanProceed = false;
              logExtensionMessage(`* WARNING flexspin NOT found, aborting download`);
              await vscode.window.showErrorMessage('ERROR: unable to download to P2 without flexspin compiler installed');
            }
          }
        }
        if (useInternalDownloader) {
          // TODO: run compileTopP2, first! (implement the dependsOn ourself!)
          if (haveP1Download) {
            const errorMessage: string = `CMD: DOWNLOAD - P1 download on macOS not yet supported!`;
            logExtensionMessage(errorMessage);
            await vscode.window.showErrorMessage(errorMessage);
          } else {
            logExtensionMessage(`* Running built-in downloader...!`);
            const deviceNode = toolchainConfiguration.selectedPropPlug;
            if (deviceNode !== undefined && deviceNode !== '') {
              // create terminal
              if (downloaderTerminal === undefined) {
                const compilerName = selectedCompiler == PATH_PNUT_TS ? 'pnut_ts' : 'flexspin';
                // OLD downloaderTerminal = vscode.window.createTerminal(`'${compilerName}' Downloader Output`);
                downloaderTerminal = new LoaderPseudoterminal(`'${compilerName}' Downloader Output`);
              }
              // Clear the terminal
              downloaderTerminal.sendText('clear');
              // load binary file
              let binaryFilespec: string = '';
              const filenameToDownload: string = getRuntimeConfigValue('optionsBinaryFname');
              if (filenameToDownload !== undefined && filenameToDownload !== '') {
                // write file info to terminal
                const rootDir: string = currenWorkingDir();
                binaryFilespec = path.join(rootDir, filenameToDownload);
                let binaryImage: Uint8Array = loadFileAsUint8Array(binaryFilespec);
                const failedToLoad: boolean = loadUint8ArrayFailed(binaryImage) ? true : false;
                if (failedToLoad == false) {
                  logExtensionMessage(`  -- load image = (${binaryImage.length}) bytes`);
                  let target: string = 'RAM';
                  const writeToFlash: boolean = toolchainConfiguration.writeFlashEnabled;
                  const needsP2ChecksumVerify: boolean = false;
                  if (writeToFlash) {
                    target = 'FLASH';
                    binaryImage = await insertP2FlashLoader(binaryImage);
                    logExtensionMessage(`  -- load image w/flasher = (${binaryImage.length}) bytes`);
                    writeBinaryFile(binaryImage, `${binaryFilespec}fext`);
                    /*
                    } else {
                    // not flashing append a checksum then ask P2 for verification
                    //
                    // don't enable verify until we get it working
                    needsP2ChecksumVerify = true;
                    const tmpImage = new ObjectImage('temp-image');
                    tmpImage.adopt(binaryImage);
                    tmpImage.padToLong();
                    //const imageSum = 0xdeadf00d; //  TESTING
                    const imageSum = tmpImage.loadRamChecksum();
                    tmpImage.appendLong(imageSum);
                    binaryImage = tmpImage.rawUint8Array.subarray(0, tmpImage.offset);
                    //*/
                  }
                  downloaderTerminal.sendText(`# Downloading [${filenameToDownload}] ${binaryImage.length} bytes to ${target}`);
                  // write to USB PropPlug
                  let usbPort: UsbSerial;
                  let errMsg: string = '';
                  let noDownloadError: boolean = true;
                  try {
                    const [vendorID, productId] = getVidPidForDevice(deviceNode);
                    usbPort = new UsbSerial(deviceNode, vendorID, productId);
                    if (await usbPort.deviceIsPropellerV2()) {
                      await usbPort.download(binaryImage, needsP2ChecksumVerify);
                      downloaderTerminal.sendText(`# DONE`);
                      //await usbPort.changeBaudRate(115200);
                    } else {
                      downloaderTerminal.sendText(`# ERROR: No Propller v2 found`);
                      noDownloadError = false;
                    }
                    //this.testDownloadFile(usbPort);
                  } catch (error) {
                    noDownloadError = false;
                    if (error instanceof Error) {
                      errMsg = `Dnld: Error thrown: ${error.toString()}`;
                    } else {
                      // Handle the case where error is not an Error object
                      errMsg = `Dnld: Non-error thrown: ${JSON.stringify(error)}`;
                    } // Re-throw the error if you want to fail
                  } finally {
                    if (errMsg.length > 0) {
                      this.logMessage(errMsg);
                      downloaderTerminal.sendText(`# ERROR: ${errMsg}`);
                    }
                    if (usbPort !== undefined) {
                      try {
                        await usbPort.close(); // we're done with this port
                      } catch (error) {
                        noDownloadError = false;
                        if (error instanceof Error) {
                          errMsg = `Dnld: close Error thrown: ${error.toString()}`;
                        } else {
                          // Handle the case where error is not an Error object
                          errMsg = `Dnld: close Non-error thrown: ${JSON.stringify(error)}`;
                        } // Re-throw the error if you want to fail
                      }
                      if (errMsg.length > 0) {
                        this.logMessage(errMsg);
                        downloaderTerminal.sendText(`# ERROR: ${errMsg}`);
                      }
                    }
                  }
                  // if we want terminal after download then switch to handing terminal I/O <-> USB
                  if (noDownloadError && toolchainConfiguration.enterTerminalAfterDownload) {
                    const userBaudRate: number = toolchainConfiguration.userBaudrate;
                    const usbTermPort = new UsbSerialTerminal(deviceNode, userBaudRate);
                    downloaderTerminal.sendText(`# ---- switching to P2 I/O ----`);
                    // Listen for the terminal-closed event
                    downloaderTerminal.onDidClose(() => {
                      this.logMessage('Dnld: LoaderPseudoterminal instance closed');
                      // shutdown the USB port
                      usbTermPort.close();
                    });
                    // listen for data from P2
                    usbTermPort.on('line', (line: string) => {
                      this.logMessage('Dnld: Received line:', line);
                      // send to terminal window
                      downloaderTerminal.sendText(line);
                    });

                    // listen for data from terminal keyboard entry
                    downloaderTerminal.on('line', (line: string) => {
                      this.logMessage('Dnld: Received data from terminal:', line);
                      // send to USB port
                      usbTermPort.write(line);
                    });
                  }
                } else {
                  downloaderTerminal.sendText(`# ERROR: failed to load [${binaryFilespec}]`);
                }
                // write success or error info to terminal
              } else {
                // no filename to download
                downloaderTerminal.sendText(`# ERROR: No file to download (spin2.optionsBinaryFname not set)`);
              }
            } else {
              const errorMessage: string = `CMD: DOWNLOAD - no propplug selected!`;
              logExtensionMessage(errorMessage);
              await vscode.window.showErrorMessage(errorMessage);
              console.error(errorMessage);
            }
          }
        } else if (downloadCanProceed) {
          logExtensionMessage(`* NOT pnut_ts (or v3.0.0 pnut_ts), run download task!`);
          const tasks = await vscode.tasks.fetchTasks();
          const taskToRun = tasks.find((task) => task.name === 'downloadP2');

          if (taskToRun) {
            // We select between based on compiling with debug and/or terminal after download setting...
            const enterTerminalAfter: boolean = toolchainConfiguration.enterTerminalAfterDownload;
            logExtensionMessage(`* downloadP2 - enterTerminalAfter=(${enterTerminalAfter})`);
            if (enterTerminalAfter) {
              runTaskAndFocusTerminal(taskToRun);
            } else {
              // TODO: should the following be await or not? (seems to not be needed?)
              vscode.tasks.executeTask(taskToRun);
            }
          } else {
            const errorMessage: string = 'Task:downloadP2 not found in User-Tasks';
            await vscode.window.showErrorMessage(errorMessage);
            console.error(errorMessage);
          }
        }
      }
    })
  );

  function getVidPidForDevice(deviceNode: string): [string, string] {
    let desiredVid: string = '';
    let desiredPid: string = '';
    if (deviceNode !== undefined && deviceNode !== '') {
      const deviceNodesFound = toolchainConfiguration.deviceNodesFound;
      if (deviceNodesFound[deviceNode] !== undefined) {
        const plugValueParts: string[] = deviceNodesFound[deviceNode].split(',');
        if (plugValueParts.length > 1) {
          desiredVid = plugValueParts[1];
          desiredPid = plugValueParts[2];
        }
      }
    }
    return [desiredVid, desiredPid];
  }

  // try #1
  /*
  async function runTaskAndFocusTerminal(taskToRun: vscode.Task) {
    const taskExecution = await vscode.tasks.executeTask(taskToRun);

    const taskProcessStartListener = vscode.tasks.onDidStartTaskProcess((event) => {
      if (event.execution === taskExecution) {
        //const terminal = vscode.window.terminals.find((t) => t.creationOptions.name === event.terminalId); // BAD
        const terminal = event.execution.terminal;
        if (terminal) {
          terminal.show(true);
        }
        taskProcessStartListener.dispose();
      }
    });
  }
  */

  async function runTaskAndFocusTerminal(taskToRun: vscode.Task) {
    const taskExecution = await vscode.tasks.executeTask(taskToRun);

    // Wait a short time for the terminal to be created
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Find the terminal associated with the task
    const taskTerminal = vscode.window.terminals.find((terminal) => terminal.name.includes(taskExecution.task.name));

    if (taskTerminal) {
      taskTerminal.show();
    }
  }

  async function insertP2FlashLoader(binaryImage: Uint8Array): Promise<Uint8Array> {
    // PNut insert_flash_loader:
    const objImage = new ObjectImage('bin-w/loader');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const debugPinRx: number = 63; // default maybe overridden by code
    let debugPinTx: number = 62; //default maybe overridden by code
    const overrideDebugPinTx = await findDebugPinTx();
    if (overrideDebugPinTx !== null) {
      logExtensionMessage(`  -- insertFL default=(${debugPinTx}) but found debugPinTx=(${overrideDebugPinTx}) in Spin2 src`);
      debugPinTx = overrideDebugPinTx;
    }
    logExtensionMessage(`  -- insertFL using - debugPinTx=(${debugPinTx})`);
    objImage.adopt(binaryImage);
    // pad object to next long
    while (objImage.offset & 0b11) {
      objImage.append(0);
    }
    const _checksum_ = 0x04;
    const _debugnop_ = 0x08;
    const _NOP_INSTRU_ = 0;
    const flashLoaderBin: Uint8Array = getFlashLoaderBin(spin2Context);
    const flashLoaderLength = flashLoaderBin.length;
    // move object upwards to accommodate flash loader
    logExtensionMessage(`  -- move object up - flashLoaderLength=(${flashLoaderLength}) bytes`);
    moveObjectUp(objImage, flashLoaderLength, 0, objImage.offset);
    // install flash loader
    logExtensionMessage(`  -- load flash loader`);
    objImage.rawUint8Array.set(flashLoaderBin, 0);
    objImage.setOffsetTo(flashLoaderLength + binaryImage.length);
    const isDebugMode: boolean = toolchainConfiguration.debugEnabled;
    if (isDebugMode) {
      // debug is on
      const debugInstru = objImage.readLong(_debugnop_);
      objImage.replaceLong(debugInstru | debugPinTx, _debugnop_);
    } else {
      // debug is off
      objImage.replaceLong(_NOP_INSTRU_, _debugnop_);
    }
    // compute negative sum of all data
    const checkSum: number = objImage.flasherChecksum();
    // insert checksum into loader
    objImage.replaceLong(checkSum, _checksum_);
    // return only the active portion of the array
    return objImage.rawUint8Array.subarray(0, objImage.offset);
  }

  function moveObjectUp(objImage: ObjectImage, destOffset: number, sourceOffset: number, nbrBytes: number) {
    const currOffset = objImage.offset;
    logExtensionMessage(`* moveObjUp() from=(${sourceOffset}), to=(${destOffset}), length=(${nbrBytes})`);
    if (currOffset + nbrBytes > ObjectImage.MAX_SIZE_IN_BYTES) {
      // [error_pex]
      throw new Error('Program exceeds 1024KB');
    }
    for (let index = 0; index < nbrBytes; index++) {
      const invertedIndex = nbrBytes - index - 1;
      objImage.replaceByte(objImage.read(sourceOffset + invertedIndex), destOffset + invertedIndex);
    }
    logExtensionMessage(`* moveObjUp()offset (${currOffset}) -> (${currOffset + destOffset}) `);
    objImage.setOffsetTo(currOffset + destOffset);
  }

  function currenWorkingDir(): string {
    const textEditor = vscode.window.activeTextEditor;
    let desiredFolder: string = '';
    if (textEditor) {
      const currentlyOpenTabfilePath = textEditor.document.uri.fsPath;
      desiredFolder = path.dirname(currentlyOpenTabfilePath);
    }
    return desiredFolder;
  }

  //*/
  /* -- VERSION 2 FAILED
  context.subscriptions.push(
    vscode.commands.registerCommand(compileSpin2File, async () => {
      logExtensionMessage('* compileSpin2File');
      const textEditor = vscode?.window.activeTextEditor;
      const compilerFSpec: string | undefined = getCompilerFSpec();
      const compilerID: string | undefined = getIDOfSelectedCompiler();
      if (textEditor !== undefined && compilerFSpec !== undefined && compilerID !== undefined) {
        try {
          // and test it!
          const srcFilename = path.basename(textEditor.document.fileName);
          // Create a new terminal
          const idString: string = getStringforCompilerID(compilerID);
          const terminal = vscode.window.createTerminal(`${idString} Compiler Output`);
          const srcFSpec = path.join('spin2', srcFilename);
          const args: string[] = ['-v', '-c', '-l', `${srcFSpec}`];
          const compiler: string = path.basename(compilerFSpec);

          terminal.sendText(`# ${compiler} ${args.join(' ')}`);
          terminal.sendText(`# spawn ${compilerFSpec} ${args.join(' ')}`);
          // Create a temporary file to hold the command's output and error status
          const outputFile = path.join(os.tmpdir(), 'command-output.txt');

          // Create a shell script that executes the command, captures its output and error status, and writes them to a file
          const script = `
${compilerFSpec} ${args.join(' ')} | tee ${outputFile}
echo $? >${outputFile}.status
`;
          terminal.sendText(script);
          terminal.show();

          // Wait for the command to finish (this is just an example, you'll need to implement this in your own way)
          setTimeout(() => {
            // Read the command's output and error status from the file
            const output = fs.readFileSync(outputFile, 'utf8');
            const status = parseInt(fs.readFileSync(`${outputFile}.status`, 'utf8'));

            // Check the error status
            if (status !== 0) {
              terminal.sendText(`# Command exited with error status ${status}`);
            } else {
              terminal.sendText(`# Command exited with SUCCESS`);
            }

            // Log the output
            //console.log(output);
          }, 5000); // 5 seconds
        } catch (error) {
          await vscode.window.showErrorMessage(`Spin2 file compile Problem - error: ${error}`);
          console.error(error);
        }
      }
    })
  );
  //*/

  /*/ -- VERSION 1 FAILED
  context.subscriptions.push(
    vscode.commands.registerCommand(compileSpin2File, async () => {
      logExtensionMessage('* compileSpin2File');
      const textEditor = vscode?.window.activeTextEditor;
      const compilerFSpec: string | undefined = getCompilerFSpec();
      const compilerID: string | undefined = getIDOfSelectedCompiler();
      if (textEditor !== undefined && compilerFSpec !== undefined && compilerID !== undefined) {
        try {
          // and test it!
          const srcFilename = path.basename(textEditor.document.fileName);
          // Create a new terminal
          const idString: string = getStringforCompilerID(compilerID);
          const terminal = vscode.window.createTerminal(`${idString} Compiler Output`);
          const args: string[] = ['-v', '--help', `${srcFilename}`];
          const compiler: string = path.basename(compilerFSpec);
          terminal.sendText(`# ${compiler} ${args.join(' ')}`);
          terminal.sendText(`# spawn ${compilerFSpec} ${args.join(' ')}`);
          const childProcess = spawn(compilerFSpec, [...args]);

          childProcess.stdout.on('data', (data) => {
            terminal.sendText(data.toString());
          });

          childProcess.stderr.on('data', (data) => {
            terminal.sendText(data.toString());
          });

          childProcess.on('close', (code) => {
            terminal.sendText(`child process exited with code ${code}`);
          });

          terminal.show();
        } catch (error) {
          await vscode.window.showErrorMessage(`Spin2 file compile Problem - error: ${error}`);
          console.error(error);
        }
      }
    })
  );
  //*/

  // ----------------------------------------------------------------------------
  //   Set Up our ToolChain enabled state
  //
  // post information to out-side world via our CONTEXT at startup
  vscode.commands.executeCommand('setContext', 'runtime.spin2.toolchain.enabled', toolchainConfiguration.advancedToolChainEnabled);

  // ----------------------------------------------------------------------------
  //   Set Up our TAB Formatting
  //
  // post information to out-side world via our CONTEXT at startup
  vscode.commands.executeCommand('setContext', 'runtime.spin2.elasticTabstops.enabled', tabFormatter.isEnabled());

  // ----------------------------------------------------------------------------
  //   Hook TAB Formatting
  //
  const insertTabStopsCommentCommand = 'spinExtension.elasticTabstops.generate.tabStops.comment';

  context.subscriptions.push(
    vscode.commands.registerCommand(insertTabStopsCommentCommand, async () => {
      logExtensionMessage('CMD: insertTabStopsCommentCommand');
      try {
        const editor = vscode?.window.activeTextEditor;
        const document = editor.document!;
        const textEdits = await tabFormatter.insertTabStopsComment(document, editor.selections);
        applyTextEdits(document, textEdits!);
      } catch (error) {
        await vscode.window.showErrorMessage(`Formatter Add Comment Problem: error=[${error}]`);
        console.error(error);
      }
    })
  );

  const indentTabStopCommand = 'spinExtension.elasticTabstops.indentTabStop';

  context.subscriptions.push(
    vscode.commands.registerCommand(indentTabStopCommand, async () => {
      logExtensionMessage('CMD: indentTabStopCommand');
      try {
        const editor = vscode?.window.activeTextEditor;
        const document = editor.document!;
        const textEdits = await tabFormatter.indentTabStop(document, editor);
        const [cursorSelect, bShouldSelect] = tabFormatter.indentEndingSelection();
        applyTextEdits(document, textEdits!);
        if (bShouldSelect) {
          const anchorPosition: string = `${cursorSelect.anchor.line}:${cursorSelect.anchor.character}`;
          const activePosition: string = `${cursorSelect.active.line}:${cursorSelect.active.character}`;
          tabFormatter.logMessage(`* SET CURSOR sel=[${anchorPosition}, ${activePosition}]`);
          editor.selection = cursorSelect;
        }
      } catch (error) {
        await vscode.window.showErrorMessage('Formatter TAB Problem');
        console.error(error);
      }
    })
  );
  const outdentTabStopCommand = 'spinExtension.elasticTabstops.outdentTabStop';

  context.subscriptions.push(
    vscode.commands.registerCommand(outdentTabStopCommand, async () => {
      logExtensionMessage('CMD: outdentTabStopCommand');
      try {
        const editor = vscode.window.activeTextEditor!;
        const document = editor.document!;
        const textEdits = await tabFormatter.outdentTabStop(document, editor);
        const [cursorSelect, bShouldSelect] = tabFormatter.outdentEndingSelection();
        applyTextEdits(document, textEdits!);
        if (bShouldSelect) {
          const anchorPosition: string = `${cursorSelect.anchor.line}:${cursorSelect.anchor.character}`;
          const activePosition: string = `${cursorSelect.active.line}:${cursorSelect.active.character}`;
          tabFormatter.logMessage(`* SET CURSOR sel=[${anchorPosition}, ${activePosition}]`);
          editor.selection = cursorSelect;
        }
        console.log();
      } catch (error) {
        await vscode.window.showErrorMessage('Formatter Shift+TAB Problem');
        console.error(error);
      }
    })
  );

  // ----------------------------------------------------------------------------
  //   Object Tree View Provider
  //
  //vscode.window.registerTreeDataProvider("spinExtension.objectDependencies", objTreeProvider);

  // WARNING this next statement actually DOES enable the tree view!!!  don't remove it
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const objDepTreeView: vscode.TreeView<Dependency> = vscode.window.createTreeView('spinExtension.objectDependencies', {
    canSelectMany: false,
    showCollapseAll: false, // now false so we don't have disfunctioning [-] button
    treeDataProvider: objTreeProvider
  });
  //objDepTreeView.onDidChangeSelection(objTreeProvider.onElementClick);

  const objectTreeViewRefreshCommand = 'spinExtension.objectDependencies.refreshEntry';
  const objectTreeViewExpandAllCommand = 'spinExtension.objectDependencies.expandAll';
  const objectTreeViewCollapseAllCommand = 'spinExtension.objectDependencies.collapseAll';
  const objectTreeViewActivateFileCommand = 'spinExtension.objectDependencies.activateFile';
  // post information to out-side world via our CONTEXT - we default to showing top-level only (so, collapsed is true)

  vscode.commands.registerCommand(objectTreeViewRefreshCommand, async () => objTreeProvider.refresh());
  vscode.commands.registerCommand(objectTreeViewExpandAllCommand, async () => objTreeProvider.expandAll());
  vscode.commands.registerCommand(objectTreeViewCollapseAllCommand, async () => objTreeProvider.collapseAll());
  vscode.commands.registerCommand(objectTreeViewActivateFileCommand, async (arg1) => objTreeProvider.onElementClick(arg1));
}

function initializeProviders(): void {
  // in reference: VSCode-PowerPC-Syntax this preparsed files in workspace
  // TODO: might we need something like this? or is it done in the server?
  /*
        vscode.window.withProgress({
        location: ProgressLocation.Notification,
        title: 'ASM File Support',
        cancellable: false
    }, (progress: Progress<{increment?: number, message?: string}>, token: CancellationToken) => {
        progress.report({ message: 'Parsing Workspace...' });

        return new Promise((resolve, reject) => {
            if (token.isCancellationRequested) {
                reject();
            }

            getAsmFiles()
                .then(wsFolders => {
                    console.log("Resolving Definitions...");
                    asmDefinitionProvider.parseWorkspaceFolders(wsFolders);
                    console.log("Resolving References...");
                    asmReferenceProvider.parseWorkspaceFolders(wsFolders);
                    console.log("Project Scan Complete");

                    resolve(1);
                });
        });
    });

    */
}

// ----------------------------------------------------------------------------
//   Hook Startup scan for PropPlugs
//
async function locatePropPlugs(): Promise<void> {
  logExtensionMessage(`* locatePropPlugs() ENTRY`);
  await scanForAndRecordPropPlugs(); // load current list into settings
  // get settings list
  const deviceNodesFound = toolchainConfiguration.deviceNodesFound;
  const numKeys = Object.keys(deviceNodesFound).length;
  logExtensionMessage(`* PLUGs deviceNodesFound=[${JSON.stringify(deviceNodesFound, null, 2)}](${numKeys})`);
  const currDeviceNode = toolchainConfiguration.selectedPropPlug;
  logExtensionMessage(`* PLUGs currDeviceNode=[${currDeviceNode}](${currDeviceNode.length})`);
  let selectionStillExists: boolean = false;
  const devicesNodes: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const deviceNode of Object.keys(deviceNodesFound)) {
    const deviceSerialStr = deviceNodesFound[deviceNode];
    const plugValueParts: string[] = deviceSerialStr.split(',');
    if (plugValueParts.length > 0) {
      const deviceSerial: string = plugValueParts[0];
      devicesNodes.push(deviceSerial);
      if (currDeviceNode && currDeviceNode === deviceNode) {
        selectionStillExists = true;
      }
    }
  }
  logExtensionMessage(`* PLUGs [${devicesNodes}](${devicesNodes.length})`);
  // record all plug values found
  await updateConfig('toolchain.propPlug.devicesFound', deviceNodesFound, eConfigSection.CS_USER);

  if (devicesNodes.length == 1) {
    // if only 1 device, select it
    if (currDeviceNode && currDeviceNode != devicesNodes[0]) {
      // changing from prior selection, notify user
      vscode.window.showWarningMessage(`Changing PropPlug to ${devicesNodes[0]} from ${currDeviceNode}`);
    }
    await updateConfig('toolchain.propPlug.selected', devicesNodes[0], eConfigSection.CS_USER);
  } else if (devicesNodes.length == 0) {
    // if NO devices, select NONE
    await updateConfig('toolchain.propPlug.selected', undefined, eConfigSection.CS_USER);
    if (currDeviceNode) {
      // changing from prior selection, notify user
      vscode.window.showWarningMessage(`Removed PropPlug ${currDeviceNode} - No longer available`);
    }
  } else {
    // we have more than one!
    // if one is selected and it is still present then DO NOTHING
    // else if the selection doesn't exist then clear the selection forcing the user to select a new one
    if (selectionStillExists == false && currDeviceNode) {
      // we have a selection but it is no longer present
      await updateConfig('toolchain.propPlug.selected', undefined, eConfigSection.CS_USER);
      vscode.window.showWarningMessage(
        `Removed PropPlug ${currDeviceNode} - No longer available, Have ${devicesNodes.length} other PropPlugs, press Ctrl+Alt+n to select one`
      );
    } else if (selectionStillExists == false) {
      // we don't have a selection and there are more than one so tell user to select
      vscode.window.showInformationMessage(
        `Found ${devicesNodes.length} PropPlugs, please use Ctrl+Alt+n to select one to be used for this workspace`
      );
    }
  }
}

async function scanForAndRecordPropPlugs(): Promise<void> {
  const deviceNodesDetail: IUsbSerialDevice[] = await UsbSerial.serialDeviceList();
  logExtensionMessage(`* PLUGs deviceNodesDetail=[${JSON.stringify(deviceNodesDetail, null, 2)}](${deviceNodesDetail.length})`);
  const devicesFound: string[] = [];
  const plugsFoundSetting = {};
  for (let index = 0; index < deviceNodesDetail.length; index++) {
    const deviceNodeInfo = deviceNodesDetail[index];
    const numKeys = Object.keys(deviceNodeInfo).length;
    logExtensionMessage(`* PLUGs deviceNodesDetail[${index}]=[${JSON.stringify(deviceNodeInfo, null, 2)}](${numKeys})`);
    const deviceSerial: string = deviceNodeInfo['serialNumber'];
    const deviceNode: string = deviceNodeInfo['deviceNode'];
    const vendorID: string = deviceNodeInfo['vendorId'];
    const productId: string = deviceNodeInfo['productId'];
    logExtensionMessage(`* PLUGs devicesFound[${index}] = [${deviceNode}](${deviceNode.length})`);
    devicesFound.push(deviceNode);
    const deviceIDStr: string = `${deviceSerial},${vendorID},${productId}`;
    logExtensionMessage(`* PLUGs plugsFoundSetting[${deviceNode}] = [${deviceIDStr}]`);
    plugsFoundSetting[deviceNode] = deviceIDStr;
  }

  logExtensionMessage(`* PLUGs deviceNodesDetail=[${devicesFound}](${devicesFound.length})`);
  const numKeys = Object.keys(plugsFoundSetting).length;
  logExtensionMessage(`* PLUGs plugsFoundSetting=[${JSON.stringify(plugsFoundSetting, null, 2)}](${numKeys})`);
  // record all plug values found
  await updateConfig('toolchain.propPlug.devicesFound', plugsFoundSetting, eConfigSection.CS_USER);
}

// ----------------------------------------------------------------------------
//   Hook Startup scan for Toolchain parts
//
async function locateTools(): Promise<void> {
  // factor in use of ENV{'path'} to locate tools
  const envPath = process.env.PATH;
  //  ~/bin
  //  /usr/local/bin
  //  /opt/local/bin
  const userBin = path.join('~', 'bin');
  const userLocalBin = path.join(`${path.sep}usr`, 'local', 'bin');
  const optLocalBin = path.join(`${path.sep}opt`, 'local', 'bin');
  let platformPaths: string[] = [];
  if (isWindows()) {
    const envDirs = envPath.split(';').filter(Boolean); // Windows is ';' separated
    // C:\Program Files (x86)\Parallax Inc\PNut
    // C:\Programs\IronSheepProductions\pnut_ts
    // C:\Programs\TotalSpectrum\flexprop
    const appFlexProp = path.join(`C:${path.sep}Programs`, 'TotalSpectrum', 'flexprop', 'bin');
    const appPNutTS = path.join(`C:${path.sep}Programs`, 'IronSheepProductions', 'pnut_ts');
    const appParallax = path.join(`C:${path.sep}Program Files (x86)`, 'Parallax Inc');
    const appPNut = path.join(`${appParallax}`, 'PNut');
    platformPaths = [...envDirs, appParallax, appPNut, appPNutTS, appFlexProp];
  } else if (isMac()) {
    const envDirs = envPath.split(':').filter(Boolean); // macOS is ':' separated
    // /Applications/flexprop/bin
    // /Applications
    // ~/Applications
    // /Applications/pnut_ts
    const applicationsFlex = path.join(`${path.sep}Applications`, 'flexprop', 'bin');
    const applicationsUser = path.join('~', 'Applications');
    const applicationsPNutTS = path.join(`${path.sep}Applications`, 'pnut_ts');
    platformPaths = [...envDirs, applicationsFlex, applicationsUser, applicationsPNutTS, userBin, userLocalBin, optLocalBin];
  } else {
    // assume linux, RPi
    //  /opt/flexprop
    //  /opt/pnut_ts
    const envDirs = envPath.split(':').filter(Boolean); // linux is ':' separated
    const optPNutTS = path.join(`${path.sep}opt`, 'pnut_ts');
    const optFlexpropBin = path.join(`${path.sep}opt`, 'flexprop', 'bin');
    platformPaths = [...envDirs, userBin, userLocalBin, optFlexpropBin, optPNutTS];
  }
  // and ensure there is only one occurance of each path in list
  //platformPaths = platformPaths.sort().filter((item, index, self) => index === self.indexOf(item));
  //platformPaths = platformPaths
  //    .map((item) => item.toLowerCase()) // Convert all items to lowercase
  //    .sort()
  //    .filter((item, index, self) => index === self.indexOf(item)); // Remove duplicates
  //
  // Create a map of lowercase paths to original paths
  const lowerCaseMap = new Map<string, string>();
  platformPaths.forEach((item) => {
    lowerCaseMap.set(item.toLowerCase(), item);
  });

  // Filter the original paths based on the uniqueness of their lowercase counterparts
  platformPaths = Array.from(lowerCaseMap.values());
  // now see if we find any tools
  let toolsFound: boolean = false;

  // ---------------
  //  PNut tools
  const pnutFSpec: string | undefined = await getSingleLocation('pnut_shell.bat', platformPaths);
  if (pnutFSpec !== undefined) {
    toolsFound = true;
  }
  await updateConfig('toolchain.paths.PNut', pnutFSpec, eConfigSection.CS_USER);

  // ---------------
  //  PNut_ts tools
  const pnutTsFSpec: string | undefined = await getSingleLocation('pnut_ts', platformPaths);
  if (pnutTsFSpec !== undefined) {
    toolsFound = true;
  }
  await updateConfig('toolchain.paths.PNutTs', pnutTsFSpec, eConfigSection.CS_USER);

  // ---------------
  //  FlexProp tools
  const flexSpinFSpec = await getSingleLocation('flexspin', platformPaths);
  let loadP2FSpec: string | undefined = undefined;
  let proploaderFSpec: string | undefined = undefined;
  let flexFlasherBinFSpec: string | undefined = undefined;
  if (flexSpinFSpec !== undefined) {
    // Update the configuration with the path of the executable.
    toolsFound = true;
    //
    // now look for other FlexProp related parts
    //
    const flexPropBin = path.dirname(flexSpinFSpec);
    const flexPropBoard = path.join(path.dirname(flexPropBin), 'board');

    loadP2FSpec = await getSingleLocation('loadp2', [flexPropBin]);
    if (loadP2FSpec !== undefined) {
      // Update the configuration with the path of the executable.
      toolsFound = true;
    }

    proploaderFSpec = await getSingleLocation('proploader', [flexPropBin]);
    if (proploaderFSpec !== undefined) {
      // Update the configuration with the path of the executable.
      toolsFound = true;
    }

    flexFlasherBinFSpec = locateNonExe('P2ES_flashloader.bin', [flexPropBoard]);
    if (flexFlasherBinFSpec !== undefined) {
      // Update the configuration with the path of the executable.
      toolsFound = true;
    }
  }
  await updateConfig('toolchain.paths.flexspin', flexSpinFSpec, eConfigSection.CS_USER);
  await updateConfig('toolchain.paths.loadp2', loadP2FSpec, eConfigSection.CS_USER);
  await updateConfig('toolchain.paths.proploader', proploaderFSpec, eConfigSection.CS_USER);
  await updateConfig('toolchain.paths.flexspinFlashloader', flexFlasherBinFSpec, eConfigSection.CS_USER);

  // now build list of available compilers
  const compilers = {};
  if (flexSpinFSpec !== undefined) {
    const installPath = path.dirname(flexSpinFSpec);
    compilers[installPath] = PATH_FLEXSPIN;
  }
  if (pnutFSpec !== undefined) {
    const installPath = path.dirname(pnutFSpec);
    compilers[installPath] = PATH_PNUT;
  }
  if (pnutTsFSpec !== undefined) {
    const installPath = path.dirname(pnutTsFSpec);
    compilers[installPath] = PATH_PNUT_TS;
  }
  // record the set of discovered compilers
  await updateConfig('toolchain.compiler.installationsFound', compilers, eConfigSection.CS_USER);

  // do final status reports
  if (!toolsFound) {
    logExtensionMessage(`* TOOL: {No Tools Found}`);
  }
  logExtensionMessage(`* TOOL: platform=[${platform()}]`);
  logExtensionMessage(`* TOOL: platformPaths=[${platformPaths}]`);
}

async function getSingleLocation(exeName: string, platformPaths: string[]): Promise<string | undefined> {
  let exeFSpec: string | undefined = undefined;
  let allFSpecs: string[] = [];
  [exeFSpec, allFSpecs] = await locateExe(exeName, platformPaths);
  if (allFSpecs.length > 1) {
    const errorMessage: string = `ERROR TOOL: ${exeName} found in multiple locations [${allFSpecs}]`;
    logExtensionMessage(`* ${errorMessage}`);
    await vscode.window.showErrorMessage(errorMessage);
  } else if (exeFSpec !== undefined) {
    // Update the configuration with the path of the executable.
    logExtensionMessage(`* TOOL: ${exeFSpec}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return new Promise((resolve, reject) => {
    resolve(exeFSpec);
  });
}

async function updateConfig(path: string, value: string | string[] | boolean | object, section: eConfigSection): Promise<void> {
  // Get the workspace configuration.
  logExtensionMessage(`+ (DBG) updCfg(${path}) value=(${value}) - ENTRY`);
  const startingConfig = vscode.workspace.getConfiguration('spinExtension');
  const existingValue = startingConfig.get(path);
  if (existingValue === value) {
    logExtensionMessage(`+ (DBG) updCfg([${path}]) Value already set, aborting`);
  } else {
    const startJsonConfig: string = JSON.stringify(startingConfig, null, 4);
    //logExtensionMessage(`+ (DBG) BEFORE config=(${startJsonConfig})`);
    const desiredSection: vscode.ConfigurationTarget =
      section == eConfigSection.CS_USER ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
    await startingConfig.update(path, value, desiredSection);

    const updatedConfig = vscode.workspace.getConfiguration('spinExtension');
    const updatedJsonConfig: string = JSON.stringify(updatedConfig, null, 4);
    //logExtensionMessage(`+ (DBG) AFTER config=(${updatedJsonConfig})`);

    if (startJsonConfig === updatedJsonConfig) {
      logExtensionMessage(`+ (DBG) updCfg() NO config value changed!`);
    } else {
      const startLines = startJsonConfig.split(/\r?\n/);
      const updatedLines = updatedJsonConfig.split(/\r?\n/);
      logExtensionMessage(`+ (DBG) updCfg() checking start (${startLines.length}) lines, updated (${updatedLines.length})`);
      for (let index = 0; index < startLines.length; index++) {
        const startLine = startLines[index];
        const updatedLine = updatedLines[index];
        if (startLine != updatedLine) {
          logExtensionMessage(`+ (DBG) updCfg ln#${index + 1} [${startLine}] -> [${updatedLine}]`);
        }
      }
    }
  }
  logExtensionMessage(`+ (DBG) updCfg(${path}) value=(${value}) - EXIT`);
}

function getRuntimeConfigValue(path: string): string | undefined {
  // return a workspace configuration value or undefined if not present
  const startingSpin2Config = vscode.workspace.getConfiguration('spin2');
  const existingValue = startingSpin2Config.get<string>(path);
  logExtensionMessage(`+ (DBG) getRuntimeCfgValue([${path}]) -> [${existingValue}]`);
  return existingValue;
}

async function updateRuntimeConfig(path: string, value: string | string[] | boolean | object): Promise<void> {
  // Get the workspace configuration.
  const subsetConfig = path.startsWith('spin2.') ? 'spin2' : undefined;
  const useSubset = subsetConfig !== undefined;
  const subsetPath = useSubset ? path.substring(6) : path;
  logExtensionMessage(`+ (DBG) updRCfg([${path}]) value=[${value}]- ENTRY`);
  const startingConfig = vscode.workspace.getConfiguration(subsetConfig);
  const existingValue = startingConfig.get(subsetPath);
  if (existingValue === value) {
    logExtensionMessage(`+ (DBG) updRCfg([${path}]) Value (${existingValue}) === (${value}), aborting`);
  } else {
    const startJsonConfig: string = JSON.stringify(startingConfig, null, 4);
    //logExtensionMessage(`+ (DBG) BEFORE config=(${startJsonConfig})`);
    try {
      await startingConfig.update(subsetPath, value, vscode.ConfigurationTarget.Workspace);
    } catch (error) {
      logExtensionMessage(`ERROR: updRCfg([${path}]) <= Value=[${value}] FAILED!`);
      console.error('Failed to update configuration:', error);
    }
    const updatedConfig = vscode.workspace.getConfiguration(subsetConfig);
    const updatedJsonConfig: string = JSON.stringify(updatedConfig, null, 4);
    //logExtensionMessage(`+ (DBG) AFTER config=(${updatedJsonConfig})`);

    if (startJsonConfig === updatedJsonConfig) {
      logExtensionMessage(`+ (DBG) updRCfg() NO config value changed!`);
    } else {
      const startLines = startJsonConfig.split(/\r?\n/);
      const changedStartLines = startLines.filter((line) => line.includes(subsetPath));
      const updatedLines = updatedJsonConfig.split(/\r?\n/);
      const changedUpdatedLines = updatedLines.filter((line) => line.includes(subsetPath));
      logExtensionMessage(`+ (DBG) updRCfg() checking start (${changedStartLines.length}) lines, updated (${changedUpdatedLines.length})`);
      for (let index = 0; index < startLines.length; index++) {
        const startLine = changedStartLines[index];
        const updatedLine = changedUpdatedLines[index];
        if (startLine != updatedLine) {
          const locationIndex: number = startLines.indexOf(startLine);
          logExtensionMessage(`+ (DBG) updRCfg() ln#${locationIndex + 1} was [${startLine}] -> is [${updatedLine}]`);
        }
      }
    }
  }
  logExtensionMessage(`+ (DBG) updRCfg([${path}]) value=[${value}]- EXIT`);
}

export function activate(context: vscode.ExtensionContext) {
  if (isDebugLogEnabled) {
    if (debugOutputChannel === undefined) {
      //Create output channel
      debugOutputChannel = vscode.window.createOutputChannel('Spin/Spin2 Extension DEBUG');
      logExtensionMessage('Spin/Spin2 Extension log started.');
    } else {
      logExtensionMessage('\n\n------------------   NEW FILE ----------------\n\n');
    }
  }

  // preserve our extension context
  spin2Context = context;

  // Let's get the client, later we'll start it
  client = getSetupExtensionClient(context);

  registerProviders(context);
  registerCommands(context);
  initializeProviders();
  // NOPE! handleDidChangeConfiguration();
  locateTools(); // load toolchain settings
  if (toolchainConfiguration.advancedToolChainEnabled) {
    locatePropPlugs(); // load Serial Port Settings
    isCompilerInstalled(toolchainConfiguration.selectedCompilerID);
  }

  if (firstEditorChangeEvent) {
    firstEditorChangeEvent = false;
    // call wrtie waiting for it to complete
    writeToolchainBuildVariables('STARTUP').then(() => {}); // wait for complete
  }

  /*   EXAMPLE
        vscode.workspace.onDidSaveTextDocument(e => {
        getAsmFile(e.uri.fsPath)
            .then(file => {
                const filePath: string = file[0] as string;

                asmDefinitionProvider.parseSingleFile(filePath);
                asmReferenceProvider.parseSingleFile(filePath);
            });
    }, null, context.subscriptions);
    */

  // Start the client. This will also launch the server
  logExtensionMessage(`* Starting extension client/server`);
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

// ----------------------------------------------------------------------------
//   InsertMode command handlers   ////////////////////////////////////////////
// ----------------------------------------------------------------------------

function handleTextDocumentClosed(textDocument: vscode.TextDocument) {
  logExtensionMessage(`* handleTextDocumentClosed(${textDocument.fileName}) `);
  if (isSpinOrPasmDocument(textDocument)) {
    // if we close a file, remove cache entry
    if (versionCacheByDocument.has(textDocument.fileName)) {
      versionCacheByDocument.delete(textDocument.fileName);
    }
    codeBlockColorizer.closedFilespec(textDocument.fileName);
  }
}

function handleVisibleTextEditorChanged(textEditors: vscode.TextEditor[]) {
  logExtensionMessage(`* handleVisibleTextEditorChanged() given ${textEditors.length}) editors`);
  let spinFilesInActiveEditors: number = 0;
  if (textEditors.length > 0) {
    for (let index = 0; index < textEditors.length; index++) {
      const editor = textEditors[index];
      const editorNbr: number = index + 1;
      logExtensionMessage(`  -- doc #${editorNbr} is ${editor.document.fileName}) editors`);
      if (isSpinOrPasmDocument(editor.document)) {
        spinFilesInActiveEditors++;
        // visibility changed, don't recolor
      }
    }
    if (spinFilesInActiveEditors == 0) {
      codeBlockColorizer.closedAllFiles();
      /*  NOTE this double-pumps the SB change!
    } else {
      const editor = vscode.window.activeTextEditor!;
      if (editor !== undefined) {
        handleActiveTextEditorChanged(editor, 'INTERNAL');
      }
      */
    }
  }
}

// we use undefined as startup case for all of these
let priorDocumentUri: vscode.Uri | undefined = undefined;
let priorHaveSpin1or2Document: boolean | undefined = undefined;
let priorHaveCompilerAndDocument: boolean | undefined = undefined;

async function updateStatusBarItems(callerId: string): Promise<void> {
  let argumentInterp: string = 'undefined';
  let haveSpin1or2Document: boolean = false;
  let haveSpin2Document: boolean = false;
  let haveCompilerAndDocument: boolean = false; // haveSpin2Document && pnut or pnut_ts || haveSpin1or2Document && flexspin;
  const showInsertModeIndicator: boolean = tabConfiguration.enable == true;
  let docVersion: number = -1;
  const textEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
  const selectedCompilerId: string | undefined = toolchainConfiguration.selectedCompilerID;
  const textDocument: vscode.TextDocument | undefined = textEditor !== undefined ? textEditor.document : undefined;
  const currDocumentUri: vscode.Uri = textDocument !== undefined ? textDocument.uri : vscode.Uri.file('');
  if (textDocument !== undefined) {
    haveSpin2Document = isSpin2Document(textDocument);
    haveSpin1or2Document = isSpinOrPasmDocument(textDocument);

    if (haveSpin1or2Document) {
      docVersion = textDocument.version;
      argumentInterp = `${path.basename(textDocument.fileName)} v${docVersion}`;
    } else {
      argumentInterp = '-- NOT-SPIN-WINDOW --';
    }

    // we show debug/download/propplug controls only if we can compile and/or download
    if (cachedIsCompilerInstalled && selectedCompilerId == PATH_FLEXSPIN && haveSpin1or2Document) {
      haveCompilerAndDocument = true;
    } else if (cachedIsCompilerInstalled && haveSpin2Document) {
      haveCompilerAndDocument = true;
    }
  }
  const updateModeSBItem = haveSpin1or2Document != priorHaveSpin1or2Document;
  if (updateModeSBItem) {
    priorHaveSpin1or2Document = haveSpin1or2Document;
  }
  const updateLoaderSBItems = haveCompilerAndDocument != priorHaveCompilerAndDocument;
  if (updateLoaderSBItems) {
    priorHaveCompilerAndDocument = haveCompilerAndDocument;
  }

  const isDifferentFile: boolean = priorDocumentUri === undefined || currDocumentUri.toString() !== priorDocumentUri.toString();
  if (isDifferentFile) {
    priorDocumentUri = currDocumentUri;
  }

  if (textDocument !== undefined && isDifferentFile && haveSpin1or2Document) {
    // this needs to updated every time we have a new editor with spin2/spin file
    //await writeToolchainBinaryFnameVariable('ACTV-EDITOR-CHG', false, textDocument.fileName); //this didn't update the -2 value when flexspin
    await writeToolchainBuildVariables('ACTV-EDITOR-CHG', false, textDocument.fileName);
  }

  if (isDifferentFile || updateLoaderSBItems || updateModeSBItem) {
    logExtensionMessage(`* updateStatusBarItems([${callerId}]) (${argumentInterp})`);

    showHideLoaderSBControls(textDocument);

    if (updateModeSBItem) {
      if (!haveSpin1or2Document || !showInsertModeIndicator) {
        hideSpin1or2StatusBarItems();
      } else {
        if (textEditor !== undefined) {
          // have updated mode value?
          const currMode: eEditMode = getMode(textEditor);
          if (haveSpin1or2Document && showInsertModeIndicator) {
            updateStatusBarInsertModeItem(currMode); // show status bar content
            logExtensionMessage(`* SHOW SB-ITEM mode=[${modeName(currMode)}]`);
          }
          // post information to out-side world via our CONTEXT
          vscode.commands.executeCommand('setContext', 'runtime.spin2.insertMode', modeName(currMode));
        }
      }
    }
  }
}

function showHideLoaderSBControls(textDocument: vscode.TextDocument) {
  const haveSpin1or2Document: boolean = isSpinOrPasmDocument(textDocument);
  const haveSpin2Document: boolean = isSpin2Document(textDocument);
  let haveCompilerAndDocument: boolean = false; // haveSpin2Document && pnut or pnut_ts || haveSpin1or2Document && flexspin;
  const selectedCompilerId: string | undefined = toolchainConfiguration.selectedCompilerID;
  // we show debug/download/propplug controls only if we can compile and/or download
  if (cachedIsCompilerInstalled && selectedCompilerId == PATH_FLEXSPIN && haveSpin1or2Document) {
    haveCompilerAndDocument = true;
  } else if (cachedIsCompilerInstalled && haveSpin2Document) {
    haveCompilerAndDocument = true;
  }

  // advanced toolchain support must be enabled
  if (haveCompilerAndDocument && toolchainConfiguration.advancedToolChainEnabled) {
    updateStatusBarCompileDebugItem(true);
    updateStatusBarFlashDownloadItem(true);
    updateStatusBarPropPlugItem(true);
  } else {
    hideSpin2StatusBarItems();
  }
}

function hideSpin1or2StatusBarItems() {
  updateStatusBarInsertModeItem(null); // hide status bar content
  logExtensionMessage(`* HIDE SB-ITEM spin mode`);
}

function hideSpin2StatusBarItems() {
  updateStatusBarCompileDebugItem(null);
  updateStatusBarFlashDownloadItem(null);
  updateStatusBarPropPlugItem(null);
  logExtensionMessage(`* HIDE 3 SB-ITEM spin2 items`);
}

let firstEditorChangeEvent: boolean = true;

function handleActiveTextEditorChanged(textEditor?: vscode.TextEditor, source: string = undefined) {
  let argumentInterp: string = '-- NO Editor --';
  let haveSpin1or2Document: boolean = false;
  let docVersion: number = -1;
  if (textEditor == null && textEditor === undefined) {
    // do nothing
  } else {
    if (isSpinOrPasmDocument(textEditor.document)) {
      haveSpin1or2Document = true;
      docVersion = textEditor.document.version;
      argumentInterp = `${path.basename(textEditor.document.fileName)} v${docVersion}`;
    } else {
      argumentInterp = '-- NOT-SPIN-WINDOW --';
    }
  }
  const sourceID: string = source !== undefined ? source : 'EVENT';
  const editorGivenStr: string = textEditor !== undefined ? 'w/Editor' : 'w/o Editor';
  logExtensionMessage(`* handleActiveTextEditorChanged(${editorGivenStr}, ${sourceID}) - [${argumentInterp}] - ENTRY`);

  if (firstEditorChangeEvent) {
    firstEditorChangeEvent = false;
    // just don't do this!!   writeToolchainBuildVariables('EARLY-INIT').then(() => {}); // wait for complete;
  }

  if (haveSpin1or2Document) {
    recolorizeSpinDocumentIfChanged(textEditor, 'handleActiveTextEditorChanged', 'Ext-actvEditorChg', true); // true=force the recolor

    // if in overtype mode, set the cursor to secondary style; otherwise, reset to default
    let cursorStyle;
    const mode = getMode(textEditor);
    switch (mode) {
      default:
        cursorStyle = editModeConfiguration.defaultCursorStyle;
        break;
      case eEditMode.OVERTYPE:
        cursorStyle = editModeConfiguration.secondaryCursorStyle;
        break;
      case eEditMode.ALIGN:
        cursorStyle = editModeConfiguration.ternaryCursorStyle;
        break;
    }
    textEditor.options.cursorStyle = cursorStyle;
  }

  updateStatusBarItems('handleActiveTextEditorChanged');

  logExtensionMessage(`* handleActiveTextEditorChanged(${editorGivenStr}, ${sourceID}) - [${argumentInterp}] - EXIT`);
}

const versionCacheByDocument = new Map<string, number>();

/*
function spinDocumentChanged(editor: vscode.TextEditor): boolean {
  let documentChangedStatus: boolean = false;
  if (isSpinOrPasmDocument(editor.document)) {
    const newVersion: number = editor.document.version;
    let priorVersion: number = -1;
    const docBaseName: string = path.basename(editor.document.fileName);
    if (versionCacheByDocument.has(editor.document.fileName)) {
      priorVersion = versionCacheByDocument.get(editor.document.fileName);
    } else {
      versionCacheByDocument.set(editor.document.fileName, newVersion);
    }
    documentChangedStatus = newVersion != priorVersion;
    if (documentChangedStatus) {
      logExtensionMessage(`* spinDocChanged([${docBaseName}]) v${priorVersion} -> v${newVersion}`);
      //} else {
      //  logExtensionMessage(`* spinDocChanged([${docBaseName}]) - NO`);
    }
  }
  return documentChangedStatus;
}
  */

function recolorizeSpinDocumentIfChanged(editor: vscode.TextEditor, callerId: string, reason: string, forceUpdate: boolean = false) {
  if (isSpinOrPasmDocument(editor.document)) {
    const newVersion: number = editor.document.version;
    let priorVersion: number = -1;
    const docBaseName: string = path.basename(editor.document.fileName);
    if (versionCacheByDocument.has(editor.document.fileName)) {
      priorVersion = versionCacheByDocument.get(editor.document.fileName);
    } else {
      versionCacheByDocument.set(editor.document.fileName, newVersion);
    }
    if (newVersion != priorVersion || forceUpdate) {
      logExtensionMessage(`* recolorize ${callerId}(${editor.document.fileName})`);
      logExtensionMessage(`  -- recolorize [${docBaseName}] v${priorVersion} -> v${newVersion}  forced=(${forceUpdate})`);
      codeBlockColorizer.updateRegionColors(editor, reason, forceUpdate);
      versionCacheByDocument.set(editor.document.fileName, newVersion);
    }
  }
}

const handleDidChangeConfiguration = async () => {
  const previousPerEditor = editModeConfiguration.perEditor;
  const previousShowInStatusBar = getShowInsertModeInStatusBar();
  const previousInsertModeEnable = tabConfiguration.enable;
  logExtensionMessage('* handleDidChangeConfiguration - ENTRY');

  // tell tabFormatter that is might have changed, too
  tabFormatter.updateTabConfiguration();

  codeBlockColorizer.updateColorizerConfiguration();
  let editModeUpdated: boolean = reloadEditModeConfiguration();
  if (previousInsertModeEnable != tabConfiguration.enable) {
    editModeUpdated = true;
  }

  const toolchainUpdated: boolean = reloadToolchainConfiguration();
  if (toolchainUpdated) {
    // ensure cached compiler is still valid
    isCompilerInstalled(toolchainConfiguration.selectedCompilerID);
    // rewrite build variables
    await writeToolchainBuildVariables('CFG-CHG'); // wait for complete, write compile/download values
  }

  const showInsertModeInStatusBar = getShowInsertModeInStatusBar();
  //logExtensionMessage(`* (DBG) showInStatusBar=(${showInStatusBar}), previousInsertModeEnable=(${previousInsertModeEnable})`);

  // post create / destroy when changed
  const textEditor = vscode.window.activeTextEditor;
  if (editModeUpdated && showInsertModeInStatusBar !== previousShowInStatusBar) {
    if (showInsertModeInStatusBar && textEditor !== undefined) {
      const mode = getMode(textEditor);
      updateStatusBarInsertModeItem(mode); // hide status bar content
    } else {
      updateStatusBarInsertModeItem(null); // hide status bar content
    }
  }
  if (textEditor !== undefined) {
    showHideLoaderSBControls(textEditor.document);
  }

  // update state if the per-editor/global configuration option changes
  if (editModeUpdated && editModeConfiguration.perEditor !== previousPerEditor) {
    const textEditor = vscode.window.activeTextEditor;
    const mode = textEditor !== undefined ? getMode(textEditor) : null;
    resetModes(mode, editModeConfiguration.perEditor);
    if (textEditor != null) {
      handleActiveTextEditorChanged(textEditor);
    }
  } else {
    handleActiveTextEditorChanged();
  }
  logExtensionMessage('* handleDidChangeConfiguration - EXIT');
};

async function ensureIsGoodCompilerSelection(): Promise<boolean> {
  let goodCompilerSelectionStatus: boolean = true;
  const selectedCompilerId: string | undefined = toolchainConfiguration.selectedCompilerID;
  let errorMessage: string = '';
  const isSelKnown: boolean = selectedCompilerId !== undefined && validCompilerIDs.includes(selectedCompilerId);
  const isInstalledCompiler: boolean = selectedCompilerId !== undefined ? isCompilerInstalled(selectedCompilerId) : false;

  logExtensionMessage(`* ensureIsGoodCompilerSelection() id[${selectedCompilerId}], installed=(${isInstalledCompiler}), known=(${isSelKnown})`);
  if (selectedCompilerId !== undefined && isInstalledCompiler == false) {
    goodCompilerSelectionStatus = false;
    errorMessage = `is not installed, please select an installed compiler`;
  } else if (selectedCompilerId !== undefined && isSelKnown == false) {
    goodCompilerSelectionStatus = false;
    errorMessage = `is invalid, please select a known compiler`;
  }
  if (goodCompilerSelectionStatus == false) {
    logExtensionMessage(`* ensureIsGoodCompilerSelection() - ERROR compiler [${selectedCompilerId}] ${errorMessage}`);
    await vscode.window.showErrorMessage(
      `Selected compiler [${selectedCompilerId}] ${errorMessage} [Please update the setting](command:workbench.action.openSettings?%22spinExtension.toolchain.compiler.selected%22)`
    );
    // just leave user to fix it
  } else {
    // good compiler, let's see if our source file will work for this compiler
    const spin1or2Filename: string | undefined = getActiveSourceFilename();
    let errorMsg: string = '';
    if (spin1or2Filename === undefined) {
      // this should never happen with our package.json guards in place on when statements
      errorMsg = `INTERNAL ERROR: source filename is not defined!`;
    } else {
      if (!isSpin1or2File(spin1or2Filename)) {
        errorMsg = `File [${spin1or2Filename}] ERROR: not a P1 or P2 source file!`;
      } else if (selectedCompilerId != PATH_FLEXSPIN) {
        // if we have no source file then we have a .spin file vs. a .spin2 file
        //   this is not legal for pnut or pnut_ts!
        if (spin1or2Filename.endsWith('.spin')) {
          errorMsg = `File [${spin1or2Filename}] ERROR: [${selectedCompilerId}] only supports .spin2 files`;
        }
      }
    }
    if (errorMsg.length > 0) {
      goodCompilerSelectionStatus = false;
      await vscode.window.showErrorMessage(errorMsg);
      logExtensionMessage(`* ensureIsGoodCompilerSelection() - ${errorMsg}`);
    }
  }
  return goodCompilerSelectionStatus;
}

function getActiveSourceFilename(): string | undefined {
  let fileBaseName: string | undefined = toolchainConfiguration.topFilename;
  //logExtensionMessage(`* getActiveSourceFilename() - top-fileBaseName=[${fileBaseName}]`);
  // if no fileBaseName, try to get it from the active file
  if (fileBaseName === undefined || fileBaseName.length == 0) {
    fileBaseName = activeSpin1or2Filespec();
    //logExtensionMessage(`* getActiveSourceFilename() - active-fileBaseName=[${fileBaseName}]`);
  }
  if (fileBaseName !== undefined) {
    fileBaseName = path.basename(fileBaseName);
  }
  //logExtensionMessage(`* getActiveSourceFilename() --> [${fileBaseName}]`);
  return fileBaseName;
}

let cachedIsCompilerInstalled: boolean = false;

function isCompilerInstalled(compilerId: string | undefined): boolean {
  let installedStatus: boolean = false;
  if (compilerId !== undefined) {
    const toolPaths: object = toolchainConfiguration.toolPaths;
    for (const key in toolPaths) {
      // NOTE: (`Key: ${key}, Value: ${toolPaths[key]}`);
      logExtensionMessage(`* isCompilerInstalled(${compilerId}) checking=[${key}]`);
      if (key === compilerId) {
        installedStatus = true;
        break;
      }
    }
  }
  logExtensionMessage(`* isCompilerInstalled(${compilerId}) --> (${installedStatus})`);
  cachedIsCompilerInstalled = installedStatus;
  return installedStatus;
}

async function writeToolchainBinaryFnameVariable(callerID: string, forceUpdate: boolean, currFspec?: string): Promise<void> {
  // NOTE: this runs on startup and when the active editor changes
  if (toolchainConfiguration.advancedToolChainEnabled) {
    const overrideFSpec: string = currFspec !== undefined ? `, [${currFspec}]` : '';
    logExtensionMessage(`* writeToolchainBinFnameVariable(${callerID}, force=(${forceUpdate}${overrideFSpec}) - ENTRY`);
    if (runtimeSettingChangeInProgress == false || forceUpdate == true) {
      // spin2.fNameTopLevel WAS topLevel
      // get old, if present
      let fileBaseName: string | undefined = toolchainConfiguration.topFilename;
      // if present write as new else write undefined
      await updateRuntimeConfig('spin2.fNameTopLevel', fileBaseName);
      // if no fileBaseName, try to get it from the current file
      if (fileBaseName === undefined || fileBaseName.length == 0) {
        if (currFspec !== undefined && isSpin2File(currFspec)) {
          fileBaseName = path.basename(currFspec);
        } else if (currFspec !== undefined && currFspec.endsWith('.binary')) {
          // this can happen when running flexspin compiler
          fileBaseName = currFspec.replace('.binary', '.spin2');
        } else {
          fileBaseName = activeSpin1or2Filespec();
          if (fileBaseName !== undefined) {
            fileBaseName = path.basename(fileBaseName);
          }
        }
        logExtensionMessage(`+ (DBG) wtbf() ACTIVE fileBaseName=[${fileBaseName}]`);
      } else {
        logExtensionMessage(`+ (DBG) wtbf() TOP-LEVEL fileBaseName=[${fileBaseName}]`);
      }

      if (fileBaseName !== undefined) {
        const selectedCompilerId: string | undefined = toolchainConfiguration.selectedCompilerID;
        const writeToFlash: boolean = toolchainConfiguration.writeFlashEnabled;
        const activeSpin1or2Filename: string | undefined = getActiveSourceFilename();
        logExtensionMessage(`* wrToolchainBuildVariables(${callerID}) ACTIVEfn=[${activeSpin1or2Filename}]`);
        const haveP2: boolean = activeSpin1or2Filename !== undefined && isSpin2File(activeSpin1or2Filename);
        if (cachedIsCompilerInstalled && selectedCompilerId === PATH_FLEXSPIN) {
          // -----------------------------------------------------------
          // flexProp toolset has compiler, loadP2, and flashBinary
          //
          // build filename to be loaded (is complex name if writing to flash)
          const fileSuffix: string = fileBaseName.endsWith('.spin2') ? '.spin2' : '.spin';
          let flexBinaryFile: string = `${fileBaseName.replace(fileSuffix, '.binary')}`;
          if (writeToFlash && haveP2 && useLoaderInFilename) {
            const loaderBinFSpec: string = toolchainConfiguration.toolPaths[PATH_LOADER_BIN];
            flexBinaryFile = `@0=${loaderBinFSpec},$8000+${flexBinaryFile}`;
          }
          // for pnut_ts we use the source name with a .binary suffix
          await updateRuntimeConfig('spin2.optionsBinaryFname', flexBinaryFile);
        } else if (cachedIsCompilerInstalled && selectedCompilerId === PATH_PNUT && haveP2) {
          // -----------------------------------------------------------
          // PNut toolset has compiler, and loader which are the same!
          //
          // for pnut we use the top-level source name .spin2 instead of a .bin or .binary name
          await updateRuntimeConfig('spin2.optionsBinaryFname', fileBaseName);
        } else if (cachedIsCompilerInstalled && selectedCompilerId === PATH_PNUT_TS && haveP2) {
          // -----------------------------------------------------------
          // pnut_ts only has the compiler (loader is built-into Spin2 Extension)
          //
          // for pnut_ts we use the source name with a .bin suffix
          await updateRuntimeConfig('spin2.optionsBinaryFname', fileBaseName.replace('.spin2', '.bin'));
        } else {
          // no selected spin2 file, just clear the value
          await updateRuntimeConfig('spin2.optionsBinaryFname', undefined);
        }
      }
    }
    logExtensionMessage(`* writeToolchainBinFnameVariable(${callerID}), force=(${forceUpdate}${overrideFSpec}) - EXIT`);
  } else {
    logExtensionMessage(`* SKIP writeToolchainBinaryFnameVariable() NOT ENABLED - EXIT`);
  }
}

const useProploaderForP2: boolean = false; // WARNING (REMOVE BEFORE FLIGHT) Ensure is desired value
const useLoaderInFilename: boolean = false;

async function writeToolchainBuildVariables(callerID: string, forceUpdate?: boolean, currFspec?: string): Promise<void> {
  // NOTE: this runs on startup and when the configuration changes
  if (toolchainConfiguration.advancedToolChainEnabled) {
    const selectedCompilerId: string | undefined = toolchainConfiguration.selectedCompilerID;
    logExtensionMessage(`* wrToolchainBuildVariables(${callerID}) cmpId=[${selectedCompilerId}] - ENTRY`);

    let overrideFileName: string | undefined = currFspec;
    if (forceUpdate === undefined && currFspec === undefined) {
      // if we are NOT being overridden, then if FLEXSPIN and if downloading to flash, convert the download name to a base binary name
      forceUpdate = selectedCompilerId === PATH_FLEXSPIN ? true : false;
      overrideFileName = selectedCompilerId === PATH_FLEXSPIN ? getRuntimeConfigValue('optionsBinaryFname') : undefined;
      if (overrideFileName !== undefined && overrideFileName.startsWith('@0=')) {
        const filenameParts: string[] = overrideFileName.split('$8000+').filter(Boolean);
        overrideFileName = filenameParts.length > 1 ? filenameParts[1] : filenameParts[0];
      }
    }
    logExtensionMessage(`* wrToolchainBuildVariables(${callerID}) overrideFileName=[${overrideFileName}]`);
    await writeToolchainBinaryFnameVariable(callerID, forceUpdate, overrideFileName); // also set the download filename

    // record selected serial port... (or remove entry)
    const selectedDeviceNode = toolchainConfiguration.selectedPropPlug;
    await updateRuntimeConfig('spin2.serialPort', selectedDeviceNode);

    const compilingDebug: boolean = toolchainConfiguration.debugEnabled;
    const writeToFlash: boolean = toolchainConfiguration.writeFlashEnabled;
    const loadSerialPort: string = selectedDeviceNode;
    // are we generating a .lst file?
    const lstOutputEnabled: boolean = toolchainConfiguration.lstOutputEnabled;
    // what is our active file type
    const activeSpin1or2Filename: string | undefined = getActiveSourceFilename();
    logExtensionMessage(`* wrToolchainBuildVariables(${callerID}) ACTIVEfn=[${activeSpin1or2Filename}]`);
    const haveP2: boolean = activeSpin1or2Filename !== undefined && isSpin2File(activeSpin1or2Filename);
    //
    if (cachedIsCompilerInstalled && selectedCompilerId === PATH_FLEXSPIN) {
      // -----------------------------------------------------------
      // flexProp toolset has compiler, loadP2, and flashBinary
      //
      const compilerFSpec: string = toolchainConfiguration.toolPaths[PATH_FLEXSPIN];
      await updateRuntimeConfig('spin2.fSpecCompiler', compilerFSpec);
      let loaderBinFSpec: string | undefined = toolchainConfiguration.toolPaths[PATH_LOADER_BIN];
      if (!haveP2) {
        loaderBinFSpec = undefined; // we don't use this on P1 downloads
      }
      await updateRuntimeConfig('spin2.fSpecFlashBinary', loaderBinFSpec);
      //
      const loaderFSpec: string = buildLoaderFSpec(haveP2, useProploaderForP2);
      await updateRuntimeConfig('spin2.fSpecLoader', loaderFSpec);

      // build compiler switches
      // this is -gbrk -2 -Wabs-paths -Wmax-errors=99, etc.
      const flexDebugSwitch: string = toolchainConfiguration.flexspinDebugFlag;
      const flexDebugOption: string = compilingDebug ? `${flexDebugSwitch}` : '';
      const flexBuildOptions: string[] = [];
      //
      // we are working to keep the options list as 4 our less options!
      //  this is a limit when sending to user-tasks for now
      //
      // it's one of the three following!
      let compileSglLtrOptions: string = ''; // verbose for time being....
      if (haveP2) {
        compileSglLtrOptions = compileSglLtrOptions.concat('2'); // compile for P2
      } else {
        compileSglLtrOptions = compileSglLtrOptions.concat('1bc'); // compiles to Spin bytecodes that are executed by the P1 ROM interpreter
      }
      flexBuildOptions.push(`-${compileSglLtrOptions}`);
      flexBuildOptions.push('-Wabs-paths');
      flexBuildOptions.push('-Wmax-errors=99');
      flexBuildOptions.push('--charset=parallax');
      flexBuildOptions.push('--sizes');
      if (flexDebugOption.length > 0) {
        flexBuildOptions.push(flexDebugOption);
      }
      if (lstOutputEnabled) {
        flexBuildOptions.push('-l');
      }
      flexBuildOptions.push('--compress');
      await updateRuntimeConfig('spin2.optionsBuild', flexBuildOptions);
      //
      const loaderOptions: string[] = await buildLoaderSwitches(haveP2, writeToFlash, loadSerialPort);
      await updateRuntimeConfig('spin2.optionsLoader', loaderOptions);
      //
    } else if (cachedIsCompilerInstalled && selectedCompilerId === PATH_PNUT && haveP2) {
      // -----------------------------------------------------------
      // PNut toolset has compiler, and loader which are the same!
      //
      const compilerFSpec: string = toolchainConfiguration.toolPaths[PATH_PNUT];
      await updateRuntimeConfig('spin2.fSpecCompiler', compilerFSpec);
      const loaderFSpec: string = toolchainConfiguration.toolPaths[PATH_PNUT];
      await updateRuntimeConfig('spin2.fSpecLoader', loaderFSpec);
      // build compiler switches
      // this is -c -d, etc.
      const buildDebugOption: string = compilingDebug ? 'd' : '';
      const buildOptions: string[] = [`-c${buildDebugOption}`];
      await updateRuntimeConfig('spin2.optionsBuild', buildOptions);
      // build loader switches
      const loadOptions: string[] = writeToFlash ? [`-f${buildDebugOption}`] : [`-r${buildDebugOption}`];
      await updateRuntimeConfig('spin2.optionsLoader', loadOptions);
      // this is NOT used in this environment
      await updateRuntimeConfig('spin2.fSpecFlashBinary', undefined);
      //
    } else if (cachedIsCompilerInstalled && selectedCompilerId === PATH_PNUT_TS && haveP2) {
      // -----------------------------------------------------------
      // pnut_ts only has the compiler (loader is built-into Spin2 Extension or we use loadp2)
      //
      const compilerFSpec: string = toolchainConfiguration.toolPaths[PATH_PNUT_TS];
      const haveFlexspin: boolean = toolchainConfiguration.flexspinInstalled;

      await updateRuntimeConfig('spin2.fSpecCompiler', compilerFSpec);
      // build compiler switches
      //
      // we are working to keep the options list as 4 our less options!
      //  this is a limit when sending to user-tasks for now
      //
      // this is -d -O -l, etc.
      const buildOptions: string[] = [];
      if (compilingDebug) {
        buildOptions.push('-d');
      }
      if (lstOutputEnabled) {
        buildOptions.push('-l');
      }
      await updateRuntimeConfig('spin2.optionsBuild', buildOptions);
      // FIXME: let's make this conditional upon using internal loader or not (external is loadp2!!)
      if (haveFlexspin == false) {
        logExtensionMessage(`* WARNING flexspin NOT found, setting up for internal downloader`);
        useInternalDownloader = true;
        //await vscode.window.showErrorMessage('ERROR: unable to download to P2 without flexspin compiler installed');
      }
      if (useInternalDownloader) {
        // -----------------------------------------------------------
        // pnut_ts Compiler, using Spin2 Extension internal loader
        //
        // these are NOT used in this environment
        await updateRuntimeConfig('spin2.optionsLoader', undefined);
        await updateRuntimeConfig('spin2.fSpecLoader', undefined);
        await updateRuntimeConfig('spin2.fSpecFlashBinary', undefined);
      } else {
        // -----------------------------------------------------------
        // pnut_ts Compiler, use flexProp toolset loadP2, and flashBinary
        //
        // build flasher binary FileSpec
        const loaderBinFSpec: string | undefined = toolchainConfiguration.toolPaths[PATH_LOADER_BIN];
        await updateRuntimeConfig('spin2.fSpecFlashBinary', loaderBinFSpec);
        // build loader FileSpec
        const useOnlyP2: boolean = true;
        const loaderFSpec: string = buildLoaderFSpec(useOnlyP2, useProploaderForP2);
        await updateRuntimeConfig('spin2.fSpecLoader', loaderFSpec);
        // build loader switches
        const loaderOptions: string[] = await buildLoaderSwitches(useOnlyP2, writeToFlash, loadSerialPort);
        await updateRuntimeConfig('spin2.optionsLoader', loaderOptions);
      }
      //
    } else {
      // -----------------------------------------------------------
      // no compiler selected, or selection is NOT recognized
      //
      await updateRuntimeConfig('spin2.fSpecCompiler', undefined);
      await updateRuntimeConfig('spin2.fSpecFlashBinary', undefined);
      await updateRuntimeConfig('spin2.fSpecLoader', undefined);
      await updateRuntimeConfig('spin2.optionsBuild', undefined);
      await updateRuntimeConfig('spin2.optionsLoader', undefined);
    }
    logExtensionMessage(`* wrToolchainBuildVariables(${callerID}) cmpId=[${selectedCompilerId}] - EXIT`);
  } else {
    logExtensionMessage(`* SKIP writeToolchainBuildVariables() NOT ENABLED - EXIT`);
  }
}

function buildLoaderFSpec(haveP2, useProploaderForP2): string {
  // build loader FileSpec
  const loadp2FSpec: string = toolchainConfiguration.toolPaths[PATH_LOADP2];
  const proploaderFSpec: string = toolchainConfiguration.toolPaths[PATH_PROPLOADER];
  let loaderFSpec: string = haveP2 ? loadp2FSpec : proploaderFSpec;
  if (useProploaderForP2 && haveP2) {
    loaderFSpec = proploaderFSpec;
  }
  return loaderFSpec;
}

async function buildLoaderSwitches(haveP2: boolean, writeToFlash: boolean, serialPort: string): Promise<string[]> {
  // build loader switches
  const desiredPort = serialPort !== undefined ? `-p${serialPort}` : '';
  const enterTerminalAfter: boolean = toolchainConfiguration.enterTerminalAfterDownload;
  const usePSTComptibleTerm: boolean = toolchainConfiguration.termIsPstCompatible;
  const termType: string = usePSTComptibleTerm ? 'T' : 't';
  const loadP2userBaudrate: number = toolchainConfiguration.userBaudrate;
  //
  // we are working to keep the options list as 4 our less options!
  //  this is a limit when sending to user-tasks for now
  //
  //  increase the buffer size to 8192 for P2 due to error message without it
  //  -k seems to have no effect on P2
  //  code is not running on P2 after download (--compress has no effect on not running)
  const loaderOptions: string[] = [];
  let loaderSglLtrOptions: string = ''; // '-v'; // verbose for time being....
  if (haveP2) {
    // setup loadp2/proploader arguments for P2 download
    if (useProploaderForP2 == false) {
      // Load P2 using: loadp2{.mac|.exe}
      if (enterTerminalAfter) {
        const termOption: string = `-${termType}`; // term or PST term
        loaderSglLtrOptions = loaderSglLtrOptions.concat(termOption);
      }
      //loaderSglLtrOptions = loaderSglLtrOptions.concat('k'); // wait for user input before exit
      //loaderSglLtrOptions = loaderSglLtrOptions.concat('n'); // no reset; skip any hardware reset
      if (loaderSglLtrOptions.length > 0) {
        loaderOptions.push(loaderSglLtrOptions);
      }
      //loaderOptions.push(`-v`); // TEST TEST TEST
      loaderOptions.push(`-b${loadP2userBaudrate}`);
      loaderOptions.push(`-SINGLE`); // set load mode for single file (use single file loader within loadp2)
      loaderOptions.push(`-FIFO`);
      loaderOptions.push(`8192`);
      if (writeToFlash) {
        loaderOptions.push(`-FLASH`);
      }
    } else {
      // Load P2 using: proploader{.mac|.exe}
      loaderOptions.push('-2');
      loaderOptions.push(loaderSglLtrOptions);
      loaderOptions.push('-r'); // run after downloading
      //loaderOptions.push('-k'); // wait for user input before exit
      //loaderOptions.push('-n'); // no reset; skip any hardware reset
      loaderOptions.push(`-D`);
      loaderOptions.push(`baud-rate=${loadP2userBaudrate}`);
      if (writeToFlash) {
        loaderOptions.push('-e'); // write to eeprom
      }
      if (enterTerminalAfter) {
        loaderOptions.push(`-${termType}`); // term or PST term
      }
    }
  } else {
    // Load P1 using: proploader{.mac|.exe}
    // NOTE: proploader doesn't support merging single letter options!
    // setup proploader arguments for P1 download
    loaderOptions.push(loaderSglLtrOptions);
    loaderOptions.push(`-r`); // run after download
    if (writeToFlash) {
      loaderOptions.push(`-e`); // write to eeprom
    }
    if (enterTerminalAfter) {
      loaderOptions.push(`-${termType}`); // term or PST term
    }
    loaderOptions.push(`-D`);
    loaderOptions.push(`baud-rate=${loadP2userBaudrate}`);
  }
  if (desiredPort.length > 0) {
    loaderOptions.push(desiredPort);
  }
  return loaderOptions;
}

function toggleCommand() {
  const textEditor = vscode.window.activeTextEditor;
  logExtensionMessage('CMD: toggle');
  if (textEditor === undefined) {
    return;
  }

  toggleMode(textEditor);
  const currMode: eEditMode = getMode(textEditor);
  updateStatusBarInsertModeItem(currMode); // show status bar content
  handleActiveTextEditorChanged(textEditor);
}

function toggleCommand2State() {
  const textEditor = vscode.window.activeTextEditor;
  logExtensionMessage('CMD: toggle2State');
  if (textEditor === undefined) {
    return;
  }

  toggleMode2State(textEditor); // change states
  const currMode: eEditMode = getMode(textEditor);
  updateStatusBarInsertModeItem(currMode); // show status bar content
  handleActiveTextEditorChanged(textEditor); // update the SB
}

function getShowInsertModeInStatusBar(): boolean {
  let showOrNot: boolean = tabConfiguration.enable;
  /*
  logExtensionMessage(
    `* (DBG) labelInsertMode=[${editModeConfiguration.labelInsertMode}], labelOvertypeMode=[${editModeConfiguration.labelOvertypeMode}], labelAlignMode=[${editModeConfiguration.labelAlignMode}]`
  );
  */
  if (editModeConfiguration.labelInsertMode === '' && editModeConfiguration.labelOvertypeMode === '' && editModeConfiguration.labelAlignMode === '') {
    showOrNot = false;
  }
  return showOrNot;
}

function typeCommand(args: { text: string }) {
  const editor = vscode.window.activeTextEditor;
  let editMode: eEditMode = eEditMode.INSERT;
  if (editor === undefined) {
    //logExtensionMessage("* VSCode type (early)");
    vscode.commands.executeCommand('default:type', args);
    return;
  }
  if (isDebugLogEnabled) {
    const firstChar: number = args.text.charCodeAt(0);
    if (args.text.length == 1 && firstChar < 0x20) {
      logExtensionMessage('* type [0x' + firstChar.toString(16) + '](' + args.text.length + ')');
    } else {
      logExtensionMessage('* type [' + args.text + '](' + args.text.length + ')');
    }
  }
  if (editor !== undefined) {
    editMode = getMode(editor);
  }
  if (editor !== undefined && tabFormatter.isEnabled() && editMode == eEditMode.OVERTYPE) {
    logExtensionMessage('CMD: OVERTYPE type');
    overtypeBeforeType(editor, args.text, false);
  } else if (editor !== undefined && tabFormatter.isEnabled() && editMode == eEditMode.ALIGN) {
    tabFormatter.alignBeforeType(editor, args.text, false);
  } else {
    //logExtensionMessage("* VSCode type");
    vscode.commands.executeCommand('default:type', args);
  }
}

function deleteLeftCommand() {
  const editor = vscode.window.activeTextEditor;
  logExtensionMessage('CMD: deleteLeft');
  let bAlignEdit: boolean = editor !== undefined && tabFormatter.isEnabled();
  if (editor !== undefined) {
    const editMode = getMode(editor);
    if (editMode != eEditMode.ALIGN) {
      bAlignEdit = false;
    }
  }
  if (bAlignEdit && editor !== undefined) {
    tabFormatter.alignDelete(editor, false);
    return null;
  } else {
    //logExtensionMessage("* VSCode deleteLeft");
    return vscode.commands.executeCommand('deleteLeft');
  }
}

function deleteRightCommand() {
  const editor = vscode.window.activeTextEditor;
  logExtensionMessage('CMD: deleteRight');
  if (tabFormatter.isEnabled() && editor !== undefined && getMode(editor) == eEditMode.ALIGN) {
    tabFormatter.alignDelete(editor, true);
    return null;
  } else {
    //logExtensionMessage("* VSCode deleteRight");
    return vscode.commands.executeCommand('deleteRight');
  }
}

function pasteCommand(args: { text: string; pasteOnNewLine: boolean }) {
  const editor = vscode.window.activeTextEditor;
  if (editor !== undefined) {
    logExtensionMessage('CMD: paste');
    if (getMode(editor) == eEditMode.OVERTYPE && editModeConfiguration.overtypePaste) {
      // TODO: Make paste work with align
      logExtensionMessage('CMD: OVERTYPE paste');
      overtypeBeforePaste(editor, args.text, args.pasteOnNewLine);
      return vscode.commands.executeCommand('default:paste', args);
    } else if (tabFormatter.isEnabled() && getMode(editor) == eEditMode.ALIGN && !args.pasteOnNewLine) {
      tabFormatter.alignBeforeType(editor, args.text, true);
      return null;
    } else {
      //logExtensionMessage("* VSCode paste");
      return vscode.commands.executeCommand('default:paste', args);
    }
  }
  return null;
}

function applyTextEdits(document: vscode.TextDocument, textEdits: vscode.TextEdit[]) {
  if (!textEdits) {
    return;
  }
  const workEdits = new vscode.WorkspaceEdit();
  workEdits.set(document.uri, textEdits); // give the edits
  vscode.workspace.applyEdit(workEdits); // apply the edits
}
