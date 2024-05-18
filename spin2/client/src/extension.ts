/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
// src/extensions.ts
/* eslint-disable no-console */ // allow console writes from this file
import * as path from 'path';
import * as vscode from 'vscode';
import * as PNutTs from 'p2-pnut-ts';

import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

import { Formatter } from './providers/spin.tabFormatter';
import { DocGenerator } from './providers/spin.document.generate';
import { ObjectTreeProvider, Dependency } from './spin.object.dependencies';
import { RegionColorizer } from './providers/spin.color.regions';
import { overtypeBeforePaste, overtypeBeforeType } from './providers/spin.editMode.behavior';
import { editModeConfiguration, reloadEditModeConfiguration } from './providers/spin.editMode.configuration';
import { tabConfiguration } from './providers/spin.tabFormatter.configuration';
import { getMode, resetModes, toggleMode, toggleMode2State, eEditMode, modeName } from './providers/spin.editMode.mode';
import { createStatusBarItem, destroyStatusBarItem, updateStatusBarItem } from './providers/spin.editMode.statusBarItem';
import { isSpinOrPasmDocument } from './spin.vscode.utils';
import { USBDocGenerator } from './providers/usb.document.generate';
//import { spawn } from 'child_process';
import { executableExists, isMac, isWindows, locateExe, platform, platformExeName } from './fileUtils';
import { UsbSerial } from './usb.serial';

let client: LanguageClient;

const isDebugLogEnabled: boolean = true; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
let debugOutputChannel: vscode.OutputChannel | undefined = undefined;

const objTreeProvider: ObjectTreeProvider = new ObjectTreeProvider();
const tabFormatter: Formatter = new Formatter();
const docGenerator: DocGenerator = new DocGenerator(objTreeProvider);
const codeBlockColorizer: RegionColorizer = new RegionColorizer();
const usbDocGenerator: USBDocGenerator = new USBDocGenerator();

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
  const statusBarItem: vscode.StatusBarItem = createStatusBarItem();
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

    statusBarItem
  );

  // ----------------------------------------------------------------------------
  //   Hook Update region colors in editor
  //

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function handleTextDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent) {
    vscode.window.visibleTextEditors.map((editor) => {
      recolorizeSpinDocumentIfChanged(editor, 'handleTextDocumentChanged', 'Ext-docDidChg');
    });
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
  const generatePropPlugList: string = 'spinExtension.list.propplugs';
  context.subscriptions.push(
    vscode.commands.registerCommand(generatePropPlugList, function () {
      const terminal = vscode.window.createTerminal('List Serial Devices');
      // terminal.sendText('npm run pnut-ts --help'); // NOPE
      const rootInstallDir = __dirname.replace('out', '');
      const pnutCmd = path.join(rootInstallDir, 'node_modules', '.bin', 'pnut-ts');
      const tsNodeCmd = path.join(rootInstallDir, 'node_modules', '.bin', 'ts-node');
      terminal.sendText(`${tsNodeCmd} ${pnutCmd} --help`);
      terminal.show();
    })
  );

  // ----------------------------------------------------------------------------
  //   Hook Compile a .spin2 file to file(s) and or download
  //
  const compileSpin2File: string = 'spinExtension.compile.file';
  /* -- VERSION 2 FAILED
  context.subscriptions.push(
    vscode.commands.registerCommand(compileSpin2File, async () => {
      try {
        // and test it!
        const editor = vscode?.window.activeTextEditor;
        const srcFilename = path.basename(editor.document!.fileName);
        //this.logMessage(`* compileSpin2File: [${srcFilename}]`);

        const rootInstallDir = __dirname.replace('out', '');
        const nodeModulesBinDir = path.join(rootInstallDir, 'node_modules', '.bin');
        const pnutCmd = path.join(rootInstallDir, 'node_modules', 'p2-pnut-ts', 'out', 'pnut-ts.js');
        const tsNodeCmd = path.join(rootInstallDir, 'node_modules', '.bin', 'ts-node');

        const args: string[] = ['-v', '--help', `${srcFilename}`];
        // Create a new terminal
        const terminal = vscode.window.createTerminal('PNut-TS Compiler Output');
        // Add node_modules/.bin to PATH
        terminal.sendText(`export PATH="${nodeModulesBinDir}:$PATH"`);

        terminal.sendText(`# tsNodeCmd=[${tsNodeCmd}]`);
        terminal.sendText(`# pnutCmd=[${pnutCmd}]`);
        terminal.sendText(`# pnut-ts ${args.join(' ')}`);
        const childProcess = spawn(tsNodeCmd, [pnutCmd, ...args]);

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
    })
  );
	*/

  // -- VERSION 1 FAILED
  context.subscriptions.push(
    vscode.commands.registerCommand(compileSpin2File, async () => {
      docGenerator.logMessage('* generateDocumentCommentCommand');
      try {
        // and test it!
        const editor = vscode?.window.activeTextEditor;
        const srcFilename = path.basename(editor.document!.fileName);
        const pnutCompiler = new PNutTs.PNutInTypeScript();
        pnutCompiler.setArgs(['-v', '--help', `${srcFilename}`]);
        // Create a new terminal
        const terminal = vscode.window.createTerminal('PNut-TS Compiler Output');
        const childProcess = pnutCompiler.run();

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
    })
  );
  //*/

  // ----------------------------------------------------------------------------
  //   Set Up our TAB Formatting
  //
  // post information to out-side world via our CONTEXT
  vscode.commands.executeCommand('setContext', 'runtime.spinExtension.elasticTabstops.enabled', tabFormatter.isEnabled());

  //   Hook TAB Formatting
  const insertTabStopsCommentCommand = 'spinExtension.elasticTabstops.generate.tabStops.comment';

  context.subscriptions.push(
    vscode.commands.registerCommand(insertTabStopsCommentCommand, async () => {
      logExtensionMessage('* insertTabStopsCommentCommand');
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
      logExtensionMessage('* indentTabStopCommand');
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
      logExtensionMessage('* outdentTabStopCommand');
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
  for (let index = 0; index < deviceNodesDetail.length; index++) {
    const deviceNodeInfo = deviceNodesDetail[index];
    const portParts = deviceNodeInfo.split(',');
    //const deviceSerial: string = portParts.length > 1 ? portParts[1] : '';
    const deviceNode: string = portParts[0];
    devicesFound.push(deviceNode);
  }
  logExtensionMessage(`* PLUGs [${devicesFound}](${devicesFound.length})`);
  if (devicesFound.length == 1) {
    updateConfig('toolchain.propPlug', devicesFound[0]);
  }
}

// ----------------------------------------------------------------------------
//   Hook Startup scan for Toolchain parts
//
async function locateTools() {
  // factor in use of ENV{'path'} to locate tools
  const envPath = process.env.PATH;
  const userBin = path.join('~', 'bin');
  const userLocalBin = path.join('usr', 'local', 'bin');
  const optLocalBin = path.join('opt', 'local', 'bin');
  let platformPaths: string[] = [];
  if (isWindows()) {
    const envDirs = envPath.split(':').filter(Boolean);
    // C:\Program Files (x86)\Parallax Inc
    const appParallax = path.join('Program Files (x86)', 'pnut_ts');
    platformPaths = [...envDirs, appParallax];
  } else if (isMac()) {
    const envDirs = envPath.split(':').filter(Boolean);
    const applications = path.join('Applications', 'flexprop', 'bin');
    platformPaths = [...envDirs, applications, userBin, userLocalBin, optLocalBin];
  } else {
    // assume linux, RPi
    platformPaths = [userBin, userLocalBin];
  }
  // and ensure there is only one occurance of each path in list
  platformPaths = platformPaths.sort().filter((item, index, self) => index === self.indexOf(item));
  // now see if we find any tools
  let toolsFound: boolean = false;
  const pnutFSpec: string | undefined = await locateExe('pnut_ts', platformPaths);
  if (pnutFSpec !== undefined) {
    // Update the configuration with the path of the executable.
    toolsFound = true;
    logExtensionMessage(`* TOOL: ${pnutFSpec}`);
    await updateConfig('toolchain.paths.pnutTs', pnutFSpec);
  }
  const flexSpinFSpec = await locateExe('flexspin', platformPaths);
  if (flexSpinFSpec !== undefined) {
    // Update the configuration with the path of the executable.
    toolsFound = true;
    logExtensionMessage(`* TOOL: ${flexSpinFSpec}`);
    await updateConfig('toolchain.paths.flexSpin', flexSpinFSpec);
  }
  const loadP2FSpec = await locateExe('loadp2', platformPaths);
  if (loadP2FSpec !== undefined) {
    // Update the configuration with the path of the executable.
    toolsFound = true;
    logExtensionMessage(`* TOOL: ${loadP2FSpec}`);
    await updateConfig('toolchain.paths.loadP2', loadP2FSpec);
  }
  if (!toolsFound) {
    logExtensionMessage(`* TOOL: {No Tools Found}`);
  }
  logExtensionMessage(`* TOOL: platform=[${platform()}]`);
  logExtensionMessage(`* TOOL: platformPaths=[${platformPaths}]`);
}

async function updateConfig(path: string, value: string | string[]) {
  // Get the workspace configuration.
  const config = vscode.workspace.getConfiguration('spinExtension');
  const jsonConfig: string = JSON.stringify(config, null, 4);
  logExtensionMessage(`+ (DBG) BEFORE config=(${jsonConfig})`);
  await config.update(path, value, vscode.ConfigurationTarget.Workspace);

  const configPost = vscode.workspace.getConfiguration('spinExtension');
  const jsonConfigPost: string = JSON.stringify(configPost, null, 4);
  logExtensionMessage(`+ (DBG) AFTER config=(${jsonConfigPost})`);
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
  locateTools();
  locatePropPlugs();

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
    }
  }
}

function handleActiveTextEditorChanged(textEditor?: vscode.TextEditor) {
  let argumentInterp: string = 'undefined';
  let isSpinWindow: boolean = false;
  let showStatusBarItem: boolean = true;
  const showInserModeIndicator: boolean = tabConfiguration.enable == true;
  let docVersion: number = -1;
  if (textEditor == null && textEditor === undefined) {
    showStatusBarItem = false;
  } else {
    if (isSpinOrPasmDocument(textEditor.document)) {
      isSpinWindow = true;
      docVersion = textEditor.document.version;
      argumentInterp = `${path.basename(textEditor.document.fileName)} v${docVersion}`;
    } else {
      argumentInterp = '-- NOT-SPIN-WINDOW --';
      showStatusBarItem = false;
    }
  }
  logExtensionMessage(`* handleActiveTextEditorChanged(${argumentInterp})`);

  if (!showStatusBarItem || !showInserModeIndicator) {
    updateStatusBarItem(null); // hide status bar content
    //logExtensionMessage(`* HIDE SB-ITEM`);
  }

  if (isSpinWindow && textEditor) {
    recolorizeSpinDocumentIfChanged(textEditor, 'handleActiveTextEditorChanged', 'Ext-actvEditorChg', true); // true=force the recolor

    const mode = getMode(textEditor);
    if (showInserModeIndicator) {
      updateStatusBarItem(mode); // show status bar content
      //logExtensionMessage(`* SHOW SB-ITEM mode=[${modeName(mode)}]`);
    }
    // post information to out-side world via our CONTEXT
    vscode.commands.executeCommand('setContext', 'runtime.spinExtension.insert.mode', modeName(mode));

    // if in overtype mode, set the cursor to secondary style; otherwise, reset to default
    let cursorStyle;
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
  const previousShowInStatusBar = getShowInStatusBar();
  const previousInsertModeEnable = tabConfiguration.enable;
  logExtensionMessage('* handleDidChangeConfiguration');

  // tell tabFormatter that is might have changed, too
  tabFormatter.updateTabConfiguration();

  codeBlockColorizer.updateColorizerConfiguration();
  let updated: boolean = reloadEditModeConfiguration();
  if (previousInsertModeEnable != tabConfiguration.enable) {
    updated = true;
  }
  if (!updated) {
    return;
  }

  const showInStatusBar = getShowInStatusBar();
  //logExtensionMessage(`* (DBG) showInStatusBar=(${showInStatusBar}), previousInsertModeEnable=(${previousInsertModeEnable})`);

  // post create / destroy when changed
  if (showInStatusBar !== previousShowInStatusBar) {
    if (showInStatusBar) {
      createStatusBarItem();
    } else {
      destroyStatusBarItem();
    }
  }

  // update state if the per-editor/global configuration option changes
  if (editModeConfiguration.perEditor !== previousPerEditor) {
    const textEditor = vscode.window.activeTextEditor;
    const mode = textEditor != null ? getMode(textEditor) : null;
    resetModes(mode, editModeConfiguration.perEditor);
    if (textEditor != null) {
      handleActiveTextEditorChanged(textEditor);
    }
  } else {
    handleActiveTextEditorChanged();
  }
};

function toggleCommand() {
  const textEditor = vscode.window.activeTextEditor;
  logExtensionMessage('* toggle');
  if (textEditor == null) {
    return;
  }

  toggleMode(textEditor);
  handleActiveTextEditorChanged(textEditor);
}

function toggleCommand2State() {
  const textEditor = vscode.window.activeTextEditor;
  logExtensionMessage('* toggle2State');
  if (textEditor == null) {
    return;
  }

  toggleMode2State(textEditor); // change states
  handleActiveTextEditorChanged(textEditor); // update the SB
}

function getShowInStatusBar(): boolean {
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
    logExtensionMessage('* OVERTYPE type');
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
  logExtensionMessage('* deleteLeft');
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
  logExtensionMessage('* deleteRight');
  if (tabFormatter.isEnabled() && editor && getMode(editor) == eEditMode.ALIGN) {
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
    logExtensionMessage('* paste');
    if (getMode(editor) == eEditMode.OVERTYPE && editModeConfiguration.overtypePaste) {
      // TODO: Make paste work with align
      logExtensionMessage('* OVERTYPE paste');
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
