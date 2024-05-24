/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
// src/extensions.ts
/* eslint-disable no-console */ // allow console writes from this file
import * as path from 'path';
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
import { isCurrentDocumentSpin2, isSpin2Document, isSpinOrPasmDocument } from './spin.vscode.utils';
import { USBDocGenerator } from './providers/usb.document.generate';
import { isMac, isWindows, locateExe, locateNonExe, platform } from './fileUtils';
import { UsbSerial } from './usb.serial';
import { createStatusBarFlashDownloadItem, updateStatusBarFlashDownloadItem } from './providers/spin.downloadFlashMode.statusBarItem';
import { createStatusBarCompileDebugItem, updateStatusBarCompileDebugItem } from './providers/spin.compileDebugMode.statusBarItem';
import { createStatusBarPropPlugItem, getPropPlugSerialNumber, updateStatusBarPropPlugItem } from './providers/spin.propPlug.statusBarItem';
import {
  PATH_FLEXSPIN,
  PATH_LOADER_BIN,
  PATH_LOADP2,
  PATH_PNUT,
  PATH_PNUT_TS,
  reloadToolchainConfiguration,
  toolchainConfiguration
} from './providers/spin.toolChain.configuration';

let client: LanguageClient;

enum eConfigSection {
  CS_USER,
  CS_WORKSPACE
}

const isDebugLogEnabled: boolean = true; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
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
      { scheme: 'file', language: 'p2asm' }
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
      docGenerator.logMessage('* generateDocumentFileCommand');
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
      docGenerator.logMessage('* generateHierarchyFileCommand');
      try {
        // and test it!
        docGenerator.generateHierarchyDocument();
        docGenerator.showDocument('.readme.txt');
      } catch (error) {
        await vscode.window.showErrorMessage(`Hierarchy Generation Problem\n${error.stack}`);
        this.logMessage(`Exception: Hierarchy Generation Problem\n${error.stack}`);
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
      usbDocGenerator.logMessage('* generateUSBDocumentFileCommand');
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
  //   Hook ...
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

    statusInsertModeBarItem,
    statusCompileDebugBarItem,
    statusDownloadFlashBarItem,
    statusPropPlugBarItem
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

  function handleTextDocumentOpened(textDocument: vscode.TextDocument) {
    logExtensionMessage(`* handleTextDocumentOpened(${textDocument.fileName}) `);
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
      docGenerator.logMessage('* generateDocumentCommentCommand');
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
  const selectPropPlugFromList: string = 'spinExtension.select.propplug';
  //* -- VERSION 2 - NO TERMINAL version
  context.subscriptions.push(
    vscode.commands.registerCommand(selectPropPlugFromList, async function () {
      logExtensionMessage('CMD: selectPropPlugFromList');
      // terminal.sendText('npm run pnut-ts --help'); // NOPE
      const deviceNodesDetail: string[] = await UsbSerial.serialDeviceList();
      const devicesFound: string[] = [];
      for (let index = 0; index < deviceNodesDetail.length; index++) {
        const deviceNodeInfo = deviceNodesDetail[index];
        const portParts = deviceNodeInfo.split(',');
        //const deviceSerial: string = portParts.length > 1 ? portParts[1] : '';
        const deviceNode: string = portParts[0];
        devicesFound.push(deviceNode);
      }

      switch (devicesFound.length) {
        case 1:
          {
            const selectedDevice = devicesFound[0];
            vscode.window.showInformationMessage(`The only PropPlug ${selectedDevice} was selected for you automatically.`);
            updateConfig('toolchain.propPlug.selected', selectedDevice, eConfigSection.CS_USER);
          }
          break;
        case 0:
          vscode.window.showWarningMessage(`There are no available PropPlugs!`);
          updateConfig('toolchain.propPlug.selected', undefined, eConfigSection.CS_USER);
          break;

        default:
          // Show the list of choices to the user.
          vscode.window.showInformationMessage('Select the PropPlug connecting to your P2', ...devicesFound).then((userSelectedDevice) => {
            // Save the user's choice in the workspace configuration.
            updateConfig('toolchain.propPlug.selected', userSelectedDevice, eConfigSection.CS_USER);
          });
          break;
      }
    })
  ); //*/

  // ----------------------------------------------------------------------------
  //   Hook to Return an array of compile arguments for use in UserTasks
  //
  const getCompileArgments: string = 'spinExtension.getCompileArguments';
  context.subscriptions.push(
    vscode.commands.registerCommand(getCompileArgments, () => {
      const optionsBuild = vscode.workspace.getConfiguration('spin2').get('optionsBuild');
      let optionsBuildAr: string[] = Array.isArray(optionsBuild) ? optionsBuild : [optionsBuild];
      optionsBuildAr = optionsBuildAr.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg));
      return optionsBuildAr.join(' ');
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook to Return an array of loader arguments for use in UserTasks
  //
  const getLoaderArgments: string = 'spinExtension.getLoadArguments';
  context.subscriptions.push(
    vscode.commands.registerCommand(getLoaderArgments, () => {
      const optionsLoader = vscode.workspace.getConfiguration('spin2').get('optionsLoader');
      let optionsLoaderAr: string[] = Array.isArray(optionsLoader) ? optionsLoader : [optionsLoader];
      optionsLoaderAr = optionsLoaderAr.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg));
      return optionsLoaderAr.join(' ');
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook TOGGLE compile w/Debug and update display
  //
  const toggleCompileWithDebug: string = 'spinExtension.toggle.debug';
  context.subscriptions.push(
    vscode.commands.registerCommand(toggleCompileWithDebug, async () => {
      logExtensionMessage('CMD: toggleCompileWithDebug');
      try {
        const isDebugEnabled: boolean = toolchainConfiguration.debugEnabled;
        const newEnableState = isDebugEnabled ? false : true;
        updateConfig('toolchain.optionsCompile.enableDebug', newEnableState, eConfigSection.CS_WORKSPACE);
        logExtensionMessage(`* enableDebug (${isDebugEnabled}) -> (${newEnableState})`);
      } catch (error) {
        await vscode.window.showErrorMessage(`TOGGLE-Debug Problem: error=[${error}]`);
        console.error(error);
      }
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook TOGGLE download to FLASH and update display
  //
  const toggleDownloadToFlash: string = 'spinExtension.toggle.flash';
  context.subscriptions.push(
    vscode.commands.registerCommand(toggleDownloadToFlash, async () => {
      logExtensionMessage('CMD: toggleDownloadToFlash');
      try {
        const isFlashEnabled: boolean = toolchainConfiguration.writeFlashEnabled;
        const newEnableState = isFlashEnabled ? false : true;
        updateConfig('toolchain.optionsDownload.enableFlash', newEnableState, eConfigSection.CS_WORKSPACE);
        logExtensionMessage(`* enableFlash (${isFlashEnabled}) -> (${newEnableState})`);
      } catch (error) {
        await vscode.window.showErrorMessage(`TOGGLE-FLASH Problem: error=[${error}]`);
        console.error(error);
      }
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook Compile current .spin2 file
  //
  const compileCurrentSpin2File: string = 'spinExtension.compile.currfile';
  //* -- VERSION 3
  context.subscriptions.push(
    vscode.commands.registerCommand(compileCurrentSpin2File, async () => {
      logExtensionMessage('* compileCurrentSpin2File');
      const tasks = await vscode.tasks.fetchTasks();
      const taskToRun = tasks.find((task) => task.name === 'compileP2');

      if (taskToRun) {
        vscode.tasks.executeTask(taskToRun);
      } else {
        const errorMessage: string = 'Task:compileP2 not found in User-Tasks';
        await vscode.window.showErrorMessage(errorMessage);
        console.error(errorMessage);
      }
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook Compile TOP .spin2 file
  //
  const compileTopSpin2File: string = 'spinExtension.compile.topfile';
  //* -- VERSION 1
  context.subscriptions.push(
    vscode.commands.registerCommand(compileTopSpin2File, async () => {
      // this compile will fall-back to compile current when there is NO 'topLevel' defined!
      const topFilename = toolchainConfiguration.topFilename;
      const taskName = topFilename !== undefined ? 'compileTopP2' : 'compileP2';
      logExtensionMessage(`* compileTopSpin2File - topFile=[${topFilename}] task=[${taskName}]`);
      const tasks = await vscode.tasks.fetchTasks();
      const taskToRun = tasks.find((task) => task.name === taskName);

      if (taskToRun) {
        vscode.tasks.executeTask(taskToRun);
      } else {
        const errorMessage: string = `Task:${taskName} not found in User-Tasks`;
        await vscode.window.showErrorMessage(errorMessage);
        console.error(errorMessage);
      }
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook Download TOP binary file
  //
  const downloadTopFile: string = 'spinExtension.download.topfile';
  //* -- VERSION 1
  context.subscriptions.push(
    vscode.commands.registerCommand(downloadTopFile, async () => {
      logExtensionMessage('* downloadTopFile');
      const selctedCompiler: string | undefined = toolchainConfiguration.selectedCompilerID;
      if (selctedCompiler == PATH_PNUT_TS) {
        logExtensionMessage(`* Running pnut_ts, TO DO our own download!`);
      } else {
        logExtensionMessage(`* NOT pnut_ts, run download task!`);
        const tasks = await vscode.tasks.fetchTasks();
        const taskToRun = tasks.find((task) => task.name === 'downloadP2');

        if (taskToRun) {
          vscode.tasks.executeTask(taskToRun);
        } else {
          const errorMessage: string = 'Task:downloadP2 not found in User-Tasks';
          await vscode.window.showErrorMessage(errorMessage);
          console.error(errorMessage);
        }
      }
    })
  );

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
  //   Set Up our TAB Formatting
  //
  // post information to out-side world via our CONTEXT
  vscode.commands.executeCommand('setContext', 'runtime.spin2.elasticTabstops.enabled', tabFormatter.isEnabled());

  //   Hook TAB Formatting
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
async function locatePropPlugs() {
  const deviceNodesDetail: string[] = await UsbSerial.serialDeviceList();
  const devicesFound: string[] = [];
  const plugsFoundSetting = {};
  const currDeviceNode = toolchainConfiguration.selectedPropPlug;
  let selectionStillExists: boolean = false;
  for (let index = 0; index < deviceNodesDetail.length; index++) {
    const deviceNodeInfo = deviceNodesDetail[index];
    const portParts = deviceNodeInfo.split(',');
    const deviceSerial: string = portParts.length > 1 ? portParts[1] : '';
    const deviceNode: string = portParts[0];
    devicesFound.push(deviceNode);
    plugsFoundSetting[deviceNode] = deviceSerial;
    if (currDeviceNode && currDeviceNode === deviceNode) {
      selectionStillExists = true;
    }
  }
  logExtensionMessage(`* PLUGs [${devicesFound}](${devicesFound.length})`);
  // record latest values found
  updateConfig('toolchain.propPlug.devicesFound', plugsFoundSetting, eConfigSection.CS_USER);
  if (devicesFound.length == 1) {
    // if only 1 device, select it
    if (currDeviceNode && currDeviceNode != devicesFound[0]) {
      // changing from prior selection, notify user
      vscode.window.showWarningMessage(`Changing PropPlug to ${devicesFound[0]} from ${currDeviceNode}`);
    }
    updateConfig('toolchain.propPlug.selected', devicesFound[0], eConfigSection.CS_USER);
  } else if (devicesFound.length == 0) {
    // if NO devices, select NONE
    if (currDeviceNode) {
      // changing from prior selection, notify user
      vscode.window.showWarningMessage(`Removed PropPlug ${currDeviceNode} - No longer available`);
    }
    updateConfig('toolchain.propPlug.selected', undefined, eConfigSection.CS_USER);
  } else {
    // we have more than one!
    // if one is selected and it is still present then DO NOTHING
    // else if the selection doesn't exist then clear the selection forcing the user to select a new one
    if (selectionStillExists == false && currDeviceNode) {
      // we have a selection but it is no longer present
      vscode.window.showWarningMessage(
        `Removed PropPlug ${currDeviceNode} - No longer available, Have ${devicesFound.length} other PropPlugs, press Ctrl+Alt+n to select a one`
      );
      updateConfig('toolchain.propPlug.selected', undefined, eConfigSection.CS_USER);
    } else if (selectionStillExists == false) {
      // we don't have a selection and there are more than one so tell user to select
      vscode.window.showInformationMessage(
        `Found ${devicesFound.length} PropPlugs, please use Ctrl+Alt+n to select one to be used for this workspace`
      );
    }
  }
}

// ----------------------------------------------------------------------------
//   Hook Startup scan for Toolchain parts
//
async function locateTools() {
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
    const envDirs = envPath.split(':').filter(Boolean);
    // C:\Program Files (x86)\Parallax Inc\PNut
    // C:\Program Files (x86)\IronSheepProductionsLLC\pnut_ts
    //  C:\Programs\TotalSpectrum\flexprop
    const appFlexProp = path.join(`${path.sep}Programs`, 'TotalSpectrum', 'flexprop', 'bin');
    const appPNutTS = path.join(`${path.sep}Program Files (x86)`, 'IronSheepProductionsLLC', 'pnut_ts');
    const appParallax = path.join(`${path.sep}Program Files (x86)`, 'Parallax Inc');
    const appPNut = path.join(`${appParallax}`, 'PNut');
    platformPaths = [...envDirs, appParallax, appPNut, appPNutTS, appFlexProp];
  } else if (isMac()) {
    const envDirs = envPath.split(':').filter(Boolean);
    // /Applications/flexprop/bin
    // /Applications
    // ~/Applications
    // /Applications/pnut_ts
    const applicationsFlex = path.join(`${path.sep}Applications`, 'flexprop', 'bin');
    const applicationsSystem = path.join(`${path.sep}Applications`); // force leading slash
    const applicationsUser = path.join('~', 'Applications');
    const applicationsPNutTS = path.join(`${path.sep}Applications`, 'pnut_ts');
    platformPaths = [...envDirs, applicationsFlex, applicationsSystem, applicationsUser, applicationsPNutTS, userBin, userLocalBin, optLocalBin];
  } else {
    // assume linux, RPi
    //  /opt/flexprop
    //  /opt/pnut_ts
    const envDirs = envPath.split(':').filter(Boolean);
    const optPNutTS = path.join(`${path.sep}opt`, 'pnut_ts');
    const optFlexpropBin = path.join(`${path.sep}opt`, 'flexprop', 'bin');
    platformPaths = [...envDirs, userBin, userLocalBin, optFlexpropBin, optPNutTS];
  }
  // and ensure there is only one occurance of each path in list
  platformPaths = platformPaths.sort().filter((item, index, self) => index === self.indexOf(item));
  // now see if we find any tools
  let toolsFound: boolean = false;
  const pnutFSpec: string | undefined = await locateExe('pnut_shell.bat', platformPaths);
  if (pnutFSpec !== undefined) {
    // Update the configuration with the path of the executable.
    toolsFound = true;
    logExtensionMessage(`* TOOL: ${pnutFSpec}`);
    await updateConfig('toolchain.paths.PNut', pnutFSpec, eConfigSection.CS_USER);
  }
  const pnutTsFSpec: string | undefined = await locateExe('pnut_ts', platformPaths);
  if (pnutTsFSpec !== undefined) {
    // Update the configuration with the path of the executable.
    toolsFound = true;
    logExtensionMessage(`* TOOL: ${pnutTsFSpec}`);
    await updateConfig('toolchain.paths.PNutTs', pnutTsFSpec, eConfigSection.CS_USER);
  }
  const flexSpinFSpec = await locateExe('flexspin', platformPaths);
  if (flexSpinFSpec !== undefined) {
    // Update the configuration with the path of the executable.
    toolsFound = true;
    logExtensionMessage(`* TOOL: ${flexSpinFSpec}`);
    await updateConfig('toolchain.paths.flexspin', flexSpinFSpec, eConfigSection.CS_USER);
    //
    // now look for other FlexProp related parts
    //
    const flexPropBin = path.dirname(flexSpinFSpec);
    const flexPropBoard = path.join(path.dirname(flexPropBin), 'board');

    const loadP2FSpec = await locateExe('loadp2', [flexPropBin]);
    if (loadP2FSpec !== undefined) {
      // Update the configuration with the path of the executable.
      toolsFound = true;
      logExtensionMessage(`* TOOL: ${loadP2FSpec}`);
      await updateConfig('toolchain.paths.loadp2', loadP2FSpec, eConfigSection.CS_USER);
    }

    const flexFlasherBinFSpec = locateNonExe('P2ES_flashloader.bin', [flexPropBoard]);
    if (flexFlasherBinFSpec !== undefined) {
      // Update the configuration with the path of the executable.
      toolsFound = true;
      logExtensionMessage(`* TOOL: ${flexFlasherBinFSpec}`);
      await updateConfig('toolchain.paths.flexspinFlashloader', flexFlasherBinFSpec, eConfigSection.CS_USER);
    }
  }
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

async function updateConfig(path: string, value: string | string[] | boolean | object, section: eConfigSection) {
  // Get the workspace configuration.
  const startingConfig = vscode.workspace.getConfiguration('spinExtension');
  const existingValue = startingConfig.get(path);
  if (existingValue === value) {
    logExtensionMessage(`+ (DBG) updateConfig([${path}]) Value already set, aborting`);
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
      logExtensionMessage(`+ (DBG) NO config value changed!`);
    } else {
      const startLines = startJsonConfig.split(/\r?\n/);
      const updatedLines = updatedJsonConfig.split(/\r?\n/);
      logExtensionMessage(`+ (DBG) config checking start (${startLines.length}) lines, updated (${updatedLines.length})`);
      for (let index = 0; index < startLines.length; index++) {
        const startLine = startLines[index];
        const updatedLine = updatedLines[index];
        if (startLine != updatedLine) {
          logExtensionMessage(`+ (DBG) config ln#${index + 1} [${startLine}] -> [${updatedLine}]`);
        }
      }
    }
  }
}

async function updateRuntimeConfig(path: string, value: string | string[] | boolean | object) {
  // Get the workspace configuration.
  logExtensionMessage(`+ (DBG) updateRuntimeConfig([${path}]) Value=[${value}]`);
  const startingConfig = vscode.workspace.getConfiguration();
  const existingValue = startingConfig.get(path);
  if (existingValue === value) {
    logExtensionMessage(`+ (DBG) updateRuntimeConfig([${path}]) Value already set, aborting`);
  } else {
    const startJsonConfig: string = JSON.stringify(startingConfig, null, 4);
    //logExtensionMessage(`+ (DBG) BEFORE config=(${startJsonConfig})`);
    try {
      await startingConfig.update(path, value, vscode.ConfigurationTarget.Workspace);
    } catch (error) {
      logExtensionMessage(`ERROR: updateRuntimeConfig([${path}]) <= Value=[${value}] FAILED!`);
      console.error('Failed to update configuration:', error);
    }
    const updatedConfig = vscode.workspace.getConfiguration();
    const updatedJsonConfig: string = JSON.stringify(updatedConfig, null, 4);
    //logExtensionMessage(`+ (DBG) AFTER config=(${updatedJsonConfig})`);

    if (startJsonConfig === updatedJsonConfig) {
      logExtensionMessage(`+ (DBG) NO config value changed!`);
    } else {
      const startLines = startJsonConfig.split(/\r?\n/);
      const changedStartLines = startLines.filter((line) => line.includes(path));
      const updatedLines = updatedJsonConfig.split(/\r?\n/);
      const changedUpdatedLines = updatedLines.filter((line) => line.includes(path));
      logExtensionMessage(`+ (DBG) config checking start (${changedStartLines.length}) lines, updated (${changedUpdatedLines.length})`);
      for (let index = 0; index < startLines.length; index++) {
        const startLine = changedStartLines[index];
        const updatedLine = changedUpdatedLines[index];
        if (startLine != updatedLine) {
          const locationIndex: number = startLines.indexOf(startLine);
          logExtensionMessage(`+ (DBG) config ln#${locationIndex + 1} [${startLine}] -> [${updatedLine}]`);
        }
      }
    }
  }
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

  // Let's get the client, later we'll start it
  client = getSetupExtensionClient(context);

  registerProviders(context);
  registerCommands(context);
  initializeProviders();
  // NOPE! handleDidChangeConfiguration();
  locateTools(); // load toolchain settings
  locatePropPlugs(); // load Serial Port Settings
  writeToolchainBuildVariables(); // write compile time values

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

let priorChangeUri: vscode.Uri | undefined = undefined;
let priorShowSpinSBItems: boolean = false;
let priorShowSpin2OnlySBItems: boolean = false;
let priorEditorMode: eEditMode | undefined = undefined;
let priorDownloadFlash: boolean = false;
let priorCompileDebug: boolean = false;
let priorPlugSN: string = '';

function updateStatusBarItems(callerId: string) {
  let argumentInterp: string = 'undefined';
  let isSpinWindow: boolean = false;
  let showSpinStatusBarItems: boolean = true;
  let showSpin2OnlyStatusBarItems: boolean = false;
  const showInsertModeIndicator: boolean = tabConfiguration.enable == true;
  let docVersion: number = -1;
  let currMode: eEditMode | undefined = undefined;
  const textEditor = vscode.window.activeTextEditor!;
  let isDifferentMode: boolean = false;
  let isDifferentDownloadFlash: boolean = false;
  let isDifferentCompileDebug: boolean = false;
  let isDifferentPlugSN: boolean = false;
  if (textEditor == null || textEditor === undefined) {
    showSpinStatusBarItems = false;
  } else {
    showSpin2OnlyStatusBarItems = isSpin2Document(textEditor.document);
    // have updated mode value?
    currMode = getMode(textEditor);
    isDifferentMode = currMode !== priorEditorMode;
    if (isDifferentMode) {
      priorEditorMode = currMode;
    }
    // have updated flash value?
    const currDownloadFlash: boolean = toolchainConfiguration.writeFlashEnabled;
    isDifferentDownloadFlash = currDownloadFlash != priorDownloadFlash;
    if (isDifferentDownloadFlash) {
      priorDownloadFlash = currDownloadFlash;
    }
    // have updated debug value?
    const currCompileDebug: boolean = toolchainConfiguration.debugEnabled;
    isDifferentCompileDebug = currCompileDebug != priorCompileDebug;
    if (isDifferentCompileDebug) {
      priorCompileDebug = currCompileDebug;
    }
    // have updated plug S/N?
    const currPlugSN: string = getPropPlugSerialNumber();
    isDifferentPlugSN = currPlugSN != priorPlugSN;
    //logExtensionMessage(`* isDifferentPlugSN=(${isDifferentPlugSN}), was=[${priorPlugSN}], is=[${currPlugSN}]`);
    if (isDifferentPlugSN) {
      priorPlugSN = currPlugSN;
    }
    if (isSpinOrPasmDocument(textEditor.document)) {
      isSpinWindow = true;
      docVersion = textEditor.document.version;
      argumentInterp = `${path.basename(textEditor.document.fileName)} v${docVersion}`;
    } else {
      argumentInterp = '-- NOT-SPIN-WINDOW --';
      showSpinStatusBarItems = false;
    }
  }
  const isDifferentFile: boolean = priorChangeUri === undefined || (textEditor && textEditor.document.uri.toString() !== priorChangeUri.toString());
  if (isDifferentFile || isDifferentMode || isDifferentDownloadFlash || isDifferentCompileDebug || isDifferentPlugSN) {
    const updateSpinSBItems = showSpinStatusBarItems != priorShowSpinSBItems;
    if (updateSpinSBItems) {
      priorShowSpinSBItems = showSpinStatusBarItems;
    }
    const updateSpin2SBItems = showSpin2OnlyStatusBarItems != priorShowSpin2OnlySBItems;
    if (updateSpinSBItems) {
      priorShowSpin2OnlySBItems = showSpin2OnlyStatusBarItems;
    }
    priorChangeUri = textEditor !== undefined ? textEditor.document.uri : vscode.Uri.file('');
    logExtensionMessage(`* updateStatusBarItems([${callerId}]) (${argumentInterp})`);

    if (updateSpin2SBItems && !showSpin2OnlyStatusBarItems) {
      updateStatusBarCompileDebugItem(null);
      updateStatusBarFlashDownloadItem(null);
      updateStatusBarPropPlugItem(null);
      logExtensionMessage(`* HIDE 3 SB-ITEM spin2 items`);
    }
    if (updateSpinSBItems && (!showSpinStatusBarItems || !showInsertModeIndicator)) {
      updateStatusBarInsertModeItem(null); // hide status bar content
      logExtensionMessage(`* HIDE SB-ITEM mode`);
    }

    if (isSpinWindow && textEditor) {
      if ((updateSpinSBItems || isDifferentMode) && showSpinStatusBarItems && showInsertModeIndicator) {
        updateStatusBarInsertModeItem(currMode); // show status bar content
        logExtensionMessage(`* SHOW SB-ITEM mode=[${modeName(currMode)}]`);
      }
      // post information to out-side world via our CONTEXT
      vscode.commands.executeCommand('setContext', 'runtime.spin2.insertMode', modeName(currMode));

      if ((updateSpin2SBItems || isDifferentDownloadFlash || isDifferentCompileDebug || isDifferentPlugSN) && showSpin2OnlyStatusBarItems) {
        // these always get updated if showing
        updateStatusBarCompileDebugItem(true);
        updateStatusBarFlashDownloadItem(true);
        updateStatusBarPropPlugItem(true);
        logExtensionMessage(`* SHOW 3 SB-ITEM spin2 items`);
      }
    }
  }
}

function handleActiveTextEditorChanged(textEditor?: vscode.TextEditor, source: string = undefined) {
  let argumentInterp: string = 'undefined';
  let isSpinWindow: boolean = false;
  let docVersion: number = -1;
  if (textEditor == null && textEditor === undefined) {
    // do nothing
  } else {
    if (isSpinOrPasmDocument(textEditor.document)) {
      isSpinWindow = true;
      docVersion = textEditor.document.version;
      argumentInterp = `${path.basename(textEditor.document.fileName)} v${docVersion}`;
    } else {
      argumentInterp = '-- NOT-SPIN-WINDOW --';
    }
  }
  const sourceID: string = source !== undefined ? source : 'EVENT';
  logExtensionMessage(`* handleActiveTextEditorChanged(${argumentInterp}) - [${sourceID}]`);

  if (isSpinWindow && textEditor) {
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
}

const versionCacheByDocument = new Map<string, number>();

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

const handleDidChangeConfiguration = () => {
  const previousPerEditor = editModeConfiguration.perEditor;
  const previousShowInStatusBar = getShowInsertModeInStatusBar();
  const previousInsertModeEnable = tabConfiguration.enable;
  logExtensionMessage('* handleDidChangeConfiguration');

  // tell tabFormatter that is might have changed, too
  tabFormatter.updateTabConfiguration();

  codeBlockColorizer.updateColorizerConfiguration();
  let editModeUpdated: boolean = reloadEditModeConfiguration();
  if (previousInsertModeEnable != tabConfiguration.enable) {
    editModeUpdated = true;
  }

  const toolchainUpdated: boolean = reloadToolchainConfiguration();
  if (toolchainUpdated) {
    // rewrite build variables
    writeToolchainBuildVariables();
  }

  const showInsertModeInStatusBar = getShowInsertModeInStatusBar();
  //logExtensionMessage(`* (DBG) showInStatusBar=(${showInStatusBar}), previousInsertModeEnable=(${previousInsertModeEnable})`);

  // post create / destroy when changed
  if (editModeUpdated && showInsertModeInStatusBar !== previousShowInStatusBar) {
    const textEditor = vscode.window.activeTextEditor;
    if (showInsertModeInStatusBar && textEditor !== undefined) {
      const mode = getMode(textEditor);
      updateStatusBarInsertModeItem(mode); // hide status bar content
    } else {
      updateStatusBarInsertModeItem(null); // hide status bar content
    }
  }

  if (isCurrentDocumentSpin2()) {
    updateStatusBarCompileDebugItem(true);
    updateStatusBarFlashDownloadItem(true);
    updateStatusBarPropPlugItem(true);
  } else {
    updateStatusBarCompileDebugItem(null);
    updateStatusBarFlashDownloadItem(null);
    updateStatusBarPropPlugItem(null);
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
};

function writeToolchainBuildVariables() {
  logExtensionMessage('* writeToolchainBuildVariables');
  // spin2.fNameTopLevel WAS topLevel
  // get old, if present
  const fileBaseName: string | undefined = toolchainConfiguration.topFilename;
  logExtensionMessage(`+ (DBG) TOP-LEVEL fileBaseName=[${fileBaseName}]`);
  // if present write as new else write undefined
  updateRuntimeConfig('spin2.fNameTopLevel', fileBaseName);

  // record selected serial port... (or remove entry)
  const selectedSerial = toolchainConfiguration.selectedPropPlug;
  updateRuntimeConfig('spin2.serialPort', selectedSerial);

  const selectedCompilerId: string | undefined = toolchainConfiguration.selectedCompilerID;
  const compilingDebug: boolean = toolchainConfiguration.debugEnabled;
  const writeToFlash: boolean = toolchainConfiguration.writeFlashEnabled;
  const loadSerialPort: string = toolchainConfiguration.selectedPropPlug;
  // are we generating a .lst file?
  const lstOutputEnabled: boolean = toolchainConfiguration.lstOutputEnabled;
  //
  if (selectedCompilerId === PATH_FLEXSPIN) {
    // -----------------------------------------------------------
    // flexProp toolset has compiler, loadP2, and flashBinary
    //
    const compilerFSpec: string = toolchainConfiguration.toolPaths[PATH_FLEXSPIN];
    updateRuntimeConfig('spin2.fSpecCompiler', compilerFSpec);
    const loaderBinFSpec: string = toolchainConfiguration.toolPaths[PATH_LOADER_BIN];
    updateRuntimeConfig('spin2.fSpecFlashBinary', loaderBinFSpec);
    const loaderFSpec: string = toolchainConfiguration.toolPaths[PATH_LOADP2];
    updateRuntimeConfig('spin2.fSpecLoader', loaderFSpec);
    // build compiler switches
    // this is -gbrk -2 -Wabs-paths -Wmax-errors=99, etc.
    const flexDebugSwitch: string = toolchainConfiguration.flexspinDebugFlag;
    const flexDebugOption: string = compilingDebug ? `${flexDebugSwitch}` : '';
    const flexBuildOptions: string[] = ['-2', '-Wabs-paths', '-Wmax-errors=99'];
    if (flexDebugOption.length > 0) {
      flexBuildOptions.push(flexDebugOption);
    }
    if (lstOutputEnabled) {
      flexBuildOptions.push('-l');
    }
    updateRuntimeConfig('spin2.optionsBuild', flexBuildOptions);
    // build loader switches
    const desiredPort = loadSerialPort !== undefined ? `-p${loadSerialPort}` : '';
    const loaderOptions: string[] = ['-b230400', '-t', '-v']; // verbose for time being....
    if (desiredPort.length > 0) {
      loaderOptions.push(desiredPort);
    }
    updateRuntimeConfig('spin2.optionsLoader', loaderOptions);
    // build filename to be loaded (is complex name if writing to flash)
    let flexBinaryFile: string = `${fileBaseName.replace('.spin2', '.binary')}`;
    if (writeToFlash) {
      flexBinaryFile = `@0=${loaderBinFSpec},$8000+${flexBinaryFile}`;
    }
    updateRuntimeConfig('spin2.optionsBinaryFname', flexBinaryFile);
    //
  } else if (selectedCompilerId === PATH_PNUT) {
    // -----------------------------------------------------------
    // PNut toolset has compiler, and loader which are the same!
    //
    const compilerFSpec: string = toolchainConfiguration.toolPaths[PATH_PNUT];
    updateRuntimeConfig('spin2.fSpecCompiler', compilerFSpec);
    const loaderFSpec: string = toolchainConfiguration.toolPaths[PATH_PNUT];
    updateRuntimeConfig('spin2.fSpecLoader', loaderFSpec);
    // build compiler switches
    // this is -c -d, etc.
    const buildDebugOption: string = compilingDebug ? 'd' : '';
    const buildOptions: string[] = [`-c${buildDebugOption}`];
    updateRuntimeConfig('spin2.optionsBuild', buildOptions);
    // build loader switches
    const loadOptions: string[] = writeToFlash ? [`-f${buildDebugOption}`] : [`-r${buildDebugOption}`];
    updateRuntimeConfig('spin2.optionsLoader', loadOptions);
    // for pnut we use the top-level source name instead of a .binary name
    updateRuntimeConfig('spin2.optionsBinaryFname', fileBaseName);
    //
  } else if (selectedCompilerId === PATH_PNUT_TS) {
    // -----------------------------------------------------------
    // pnut_ts only has the compiler (loader is built-into Spin2 Extension)
    //
    const compilerFSpec: string = toolchainConfiguration.toolPaths[PATH_PNUT_TS];
    updateRuntimeConfig('spin2.fSpecCompiler', compilerFSpec);
    // build compiler switches
    // this is -d -b -l -c, etc.
    const buildOptions: string[] = ['-c', '-B'];
    if (compilingDebug) {
      buildOptions.push('-d');
    }
    if (lstOutputEnabled) {
      buildOptions.push('-l');
    }
    updateRuntimeConfig('spin2.optionsBuild', buildOptions);
    // these are NOT used in this environment
    updateRuntimeConfig('spin2.fSpecFlashBinary', undefined);
    updateRuntimeConfig('spin2.fSpecLoader', undefined);
    //
  } else {
    // -----------------------------------------------------------
    // no compiler selected, or selection is NOT recognized
    //
    updateRuntimeConfig('spin2.fSpecCompiler', undefined);
    updateRuntimeConfig('spin2.fSpecFlashBinary', undefined);
    updateRuntimeConfig('spin2.fSpecLoader', undefined);
  }
}

function toggleCommand() {
  const textEditor = vscode.window.activeTextEditor;
  logExtensionMessage('CMD: toggle');
  if (textEditor === undefined) {
    return;
  }

  toggleMode(textEditor);
  handleActiveTextEditorChanged(textEditor);
}

function toggleCommand2State() {
  const textEditor = vscode.window.activeTextEditor;
  logExtensionMessage('CMD: toggle2State');
  if (textEditor === undefined) {
    return;
  }

  toggleMode2State(textEditor); // change states
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
