/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";
// src/extensions.ts

import * as path from "path";
import * as vscode from "vscode";

import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";

import { Formatter } from "./providers/spin.tabFormatter";
import { DocGenerator } from "./providers/spin.document.generate";
import { ObjectTreeProvider, Dependency } from "./spin.object.dependencies";
import { RegionColorizer } from "./providers/spin.color.regions";
import { overtypeBeforePaste, overtypeBeforeType } from "./providers/spin.editMode.behavior";
import { editModeConfiguration, reloadEditModeConfiguration } from "./providers/spin.editMode.configuration";
import { tabConfiguration } from "./providers/spin.tabFormatter.configuration";
import { getMode, resetModes, toggleMode, toggleMode2State, eEditMode, modeName } from "./providers/spin.editMode.mode";
import { createStatusBarItem, destroyStatusBarItem, updateStatusBarItem } from "./providers/spin.editMode.statusBarItem";
import { isSpinOrPasmDocument } from "./spin.vscode.utils";

let client: LanguageClient;

const extensionDebugLogEnabled: boolean = true; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
var extensionOutputChannel: vscode.OutputChannel | undefined = undefined;

var objTreeProvider: ObjectTreeProvider = new ObjectTreeProvider();
const tabFormatter: Formatter = new Formatter();
const docGenerator: DocGenerator = new DocGenerator();
const codeBlockColorizer: RegionColorizer = new RegionColorizer();

const logExtensionMessage = (message: string): void => {
  // simple utility to write to TABBING  output window.
  if (extensionDebugLogEnabled && extensionOutputChannel != undefined) {
    //Write to output window.
    extensionOutputChannel.appendLine(message);
  }
};

function getSetupExtensionClient(context: vscode.ExtensionContext): LanguageClient {
  // The server is implemented in node
  const serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector: [
      { scheme: "file", language: "spin" },
      { scheme: "file", language: "spin2" },
      { scheme: "file", language: "p2asm" },
    ],
    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*"),
    },
  };

  // Create the language client and start the client.
  const client = new LanguageClient("spinExtension", "Spin2 Language Server", serverOptions, clientOptions);
  return client;
}

function registerProviders(context: vscode.ExtensionContext): void {
  // register client-side providers: tabbing and document generation
}

function registerCommands(context: vscode.ExtensionContext): void {
  // register client-side commands: tabbing and document generation

  // ----------------------------------------------------------------------------
  //   Hook GENERATE Object Public Interface Document
  //
  const generateDocumentFileCommand: string = "spinExtension.generate.documentation.file";

  context.subscriptions.push(
    vscode.commands.registerCommand(generateDocumentFileCommand, async () => {
      docGenerator.logMessage("* generateDocumentFileCommand");
      try {
        // and test it!
        docGenerator.generateDocument();
        docGenerator.showDocument();
      } catch (error) {
        await vscode.window.showErrorMessage("Document Generation Problem");
        console.error(error);
      }
    })
  );

  const statusBarItem: vscode.StatusBarItem = createStatusBarItem();
  handleActiveTextEditorChanged(); // now show or hide based upon current/active window

  context.subscriptions.push(
    vscode.commands.registerCommand("spinExtension.insertMode.rotate", toggleCommand),
    vscode.commands.registerCommand("spinExtension.insertMode.toggle", toggleCommand2State),

    vscode.commands.registerCommand("type", typeCommand),
    vscode.commands.registerCommand("paste", pasteCommand),

    vscode.commands.registerCommand("spinExtension.insertMode.deleteLeft", deleteLeftCommand),
    vscode.commands.registerCommand("spinExtension.insertMode.deleteRight", deleteRightCommand),

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

  function handleTextDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent) {
    vscode.window.visibleTextEditors.map((editor) => {
      recolorizeSpinDocumentIfChanged(editor, "handleTextDocumentChanged", "Ext-docDidChg");
    });
  }

  function handleTextDocumentOpened(textDocument: vscode.TextDocument) {
    logExtensionMessage(`* handleTextDocumentOpened(${textDocument.fileName}) `);
    if (isSpinOrPasmDocument(textDocument)) {
      vscode.window.visibleTextEditors.map((editor) => {
        if (editor.document.uri == textDocument.uri) {
          recolorizeSpinDocumentIfChanged(editor, "handleTextDocumentOpened", "Ext-docDidOpen", true);
        }
      });
    }
  }

  // ----------------------------------------------------------------------------
  //   Hook GENERATE PUB/PRI Comment Block
  //
  const generateDocCommentCommand: string = "spinExtension.generate.doc.comment";

  context.subscriptions.push(
    vscode.commands.registerCommand(generateDocCommentCommand, async () => {
      docGenerator.logMessage("* generateDocumentCommentCommand");
      try {
        // and test it!
        const editor = vscode?.window.activeTextEditor!;
        const document = editor.document!;
        var textEdits = await docGenerator.insertDocComment(document, editor.selections);
        applyTextEdits(document, textEdits!);
      } catch (error) {
        await vscode.window.showErrorMessage("Document Comment Generation Problem");
        console.error(error);
      }
    })
  );

  // ----------------------------------------------------------------------------
  //   Set Up our TAB Formatting
  //
  // post information to out-side world via our CONTEXT
  vscode.commands.executeCommand("setContext", "spinExtension.tabStops.enabled", tabFormatter.isEnbled());

  //   Hook TAB Formatting
  if (tabFormatter.isEnbled()) {
    const insertTabStopsCommentCommand = "spinExtension.generate.tabStops.comment";

    context.subscriptions.push(
      vscode.commands.registerCommand(insertTabStopsCommentCommand, async () => {
        logExtensionMessage("* insertTabStopsCommentCommand");
        try {
          const editor = vscode?.window.activeTextEditor!;
          const document = editor.document!;
          var textEdits = await tabFormatter.insertTabStopsComment(document, editor.selections);
          applyTextEdits(document, textEdits!);
        } catch (error) {
          await vscode.window.showErrorMessage("Formatter Add Comment Problem");
          console.error(error);
        }
      })
    );

    const indentTabStopCommand = "spinExtension.indentTabStop";

    context.subscriptions.push(
      vscode.commands.registerCommand(indentTabStopCommand, async () => {
        logExtensionMessage("* indentTabStopCommand");
        try {
          const editor = vscode?.window.activeTextEditor!;
          const document = editor.document!;
          var textEdits = await tabFormatter.indentTabStop(document, editor);
          let [cursorSelect, bShouldSelect] = tabFormatter.indentEndingSelection();
          applyTextEdits(document, textEdits!);
          if (bShouldSelect) {
            tabFormatter.logMessage(`* SET CURSOR sel=[${cursorSelect.anchor.line}:${cursorSelect.anchor.character}, ${cursorSelect.active.line}:${cursorSelect.active.character}]`);
            editor.selection = cursorSelect;
          }
        } catch (error) {
          await vscode.window.showErrorMessage("Formatter TAB Problem");
          console.error(error);
        }
      })
    );
    const outdentTabStopCommand = "spinExtension.outdentTabStop";

    context.subscriptions.push(
      vscode.commands.registerCommand(outdentTabStopCommand, async () => {
        logExtensionMessage("* outdentTabStopCommand");
        try {
          const editor = vscode.window.activeTextEditor!;
          const document = editor.document!;
          var textEdits = await tabFormatter.outdentTabStop(document, editor);
          let [cursorSelect, bShouldSelect] = tabFormatter.outdentEndingSelection();
          applyTextEdits(document, textEdits!);
          if (bShouldSelect) {
            tabFormatter.logMessage(`* SET CURSOR sel=[${cursorSelect.anchor.line}:${cursorSelect.anchor.character}, ${cursorSelect.active.line}:${cursorSelect.active.character}]`);
            editor.selection = cursorSelect;
          }
          console.log();
        } catch (error) {
          await vscode.window.showErrorMessage("Formatter Shift+TAB Problem");
          console.error(error);
        }
      })
    );
  }

  // ----------------------------------------------------------------------------
  //   Object Tree View Provider
  //
  //vscode.window.registerTreeDataProvider("spinExtension.objectDependencies", objTreeProvider);
  var objDepTreeView: vscode.TreeView<Dependency>;

  objDepTreeView = vscode.window.createTreeView("spinExtension.objectDependencies", {
    canSelectMany: false,
    showCollapseAll: true,
    treeDataProvider: objTreeProvider,
  });
  //objDepTreeView.onDidChangeSelection(objTreeProvider.onElementClick);
  const objectTreeViewRefreshCommand = "spinExtension.objectDependencies.refreshEntry";
  const objectTreeViewActivateFileCommand = "spinExtension.objectDependencies.activateFile";

  vscode.commands.registerCommand(objectTreeViewRefreshCommand, () => objTreeProvider.refresh());
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

export function activate(context: vscode.ExtensionContext) {
  if (extensionDebugLogEnabled) {
    if (extensionOutputChannel === undefined) {
      //Create output channel
      extensionOutputChannel = vscode.window.createOutputChannel("Spin/Spin2 Extension DEBUG");
      logExtensionMessage("Spin/Spin2 Extension log started.");
    } else {
      logExtensionMessage("\n\n------------------   NEW FILE ----------------\n\n");
    }
  }

  // Let's get the client, later we'll start it
  client = getSetupExtensionClient(context);

  registerProviders(context);
  registerCommands(context);
  initializeProviders();

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
  let argumentInterp: string = "undefined";
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
      argumentInterp = "-- NOT-SPIN-WINDOW --";
      showStatusBarItem = false;
    }
  }
  logExtensionMessage(`* handleActiveTextEditorChanged(${argumentInterp})`);

  if (!showStatusBarItem || !showInserModeIndicator) {
    updateStatusBarItem(null); // hide status bar content
    //logExtensionMessage(`* HIDE SB-ITEM`);
  }

  if (isSpinWindow && textEditor) {
    recolorizeSpinDocumentIfChanged(textEditor, "handleActiveTextEditorChanged", "Ext-actvEditorChg", true); // true=force the recolor

    const mode = getMode(textEditor);
    if (showInserModeIndicator) {
      updateStatusBarItem(mode); // show status bar content
      //logExtensionMessage(`* SHOW SB-ITEM mode=[${modeName(mode)}]`);
    }
    // post information to out-side world via our CONTEXT
    vscode.commands.executeCommand("setContext", "spinExtension.insert.mode", modeName(mode));

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
    }
  }
}

const handleDidChangeConfiguration = () => {
  const previousPerEditor = editModeConfiguration.perEditor;
  const previousShowInStatusBar = getShowInStatusBar();
  const previousInsertModeEnable = tabConfiguration.enable;
  logExtensionMessage("* handleDidChangeConfiguration");

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
  logExtensionMessage("* toggle");
  if (textEditor == null) {
    return;
  }

  toggleMode(textEditor);
  handleActiveTextEditorChanged(textEditor);
}

function toggleCommand2State() {
  const textEditor = vscode.window.activeTextEditor;
  logExtensionMessage("* toggle2State");
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
  if (editModeConfiguration.labelInsertMode === "" && editModeConfiguration.labelOvertypeMode === "" && editModeConfiguration.labelAlignMode === "") {
    showOrNot = false;
  }
  return showOrNot;
}

function typeCommand(args: { text: string }) {
  const editor = vscode.window.activeTextEditor;
  var editMode: eEditMode = eEditMode.INSERT;
  if (editor == undefined) {
    //logExtensionMessage("* VSCode type (early)");
    vscode.commands.executeCommand("default:type", args);
    return;
  }
  if (extensionDebugLogEnabled) {
    const firstChar: number = args.text.charCodeAt(0);
    if (args.text.length == 1 && firstChar < 0x20) {
      logExtensionMessage("* type [0x" + firstChar.toString(16) + "](" + args.text.length + ")");
    } else {
      logExtensionMessage("* type [" + args.text + "](" + args.text.length + ")");
    }
  }
  if (editor != undefined) {
    editMode = getMode(editor);
  }
  if (editor != undefined && tabFormatter.isEnbled() && editMode == eEditMode.OVERTYPE) {
    logExtensionMessage("* OVERTYPE type");
    overtypeBeforeType(editor, args.text, false);
  } else if (editor != undefined && tabFormatter.isEnbled() && editMode == eEditMode.ALIGN) {
    tabFormatter.alignBeforeType(editor, args.text, false);
  } else {
    //logExtensionMessage("* VSCode type");
    vscode.commands.executeCommand("default:type", args);
  }
}

function deleteLeftCommand() {
  const editor = vscode.window.activeTextEditor;
  logExtensionMessage("* deleteLeft");
  var bAlignEdit: boolean = editor != undefined && tabFormatter.isEnbled();
  if (editor != undefined) {
    const editMode = getMode(editor);
    if (editMode != eEditMode.ALIGN) {
      bAlignEdit = false;
    }
  }
  if (bAlignEdit && editor != undefined) {
    tabFormatter.alignDelete(editor, false);
    return null;
  } else {
    //logExtensionMessage("* VSCode deleteLeft");
    return vscode.commands.executeCommand("deleteLeft");
  }
}

function deleteRightCommand() {
  const editor = vscode.window.activeTextEditor;
  logExtensionMessage("* deleteRight");
  if (tabFormatter.isEnbled() && editor && getMode(editor) == eEditMode.ALIGN) {
    tabFormatter.alignDelete(editor, true);
    return null;
  } else {
    //logExtensionMessage("* VSCode deleteRight");
    return vscode.commands.executeCommand("deleteRight");
  }
}

function pasteCommand(args: { text: string; pasteOnNewLine: boolean }) {
  const editor = vscode.window.activeTextEditor;
  if (editor != undefined) {
    logExtensionMessage("* paste");
    if (getMode(editor) == eEditMode.OVERTYPE && editModeConfiguration.overtypePaste) {
      // TODO: Make paste work with align
      logExtensionMessage("* OVERTYPE paste");
      overtypeBeforePaste(editor, args.text, args.pasteOnNewLine);
      return vscode.commands.executeCommand("default:paste", args);
    } else if (tabFormatter.isEnbled() && getMode(editor) == eEditMode.ALIGN && !args.pasteOnNewLine) {
      tabFormatter.alignBeforeType(editor, args.text, true);
      return null;
    } else {
      //logExtensionMessage("* VSCode paste");
      return vscode.commands.executeCommand("default:paste", args);
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
