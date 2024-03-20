'use strict';

// https://code.visualstudio.com/api/ux-guidelines/views
// https://code.visualstudio.com/api/extension-guides/tree-view#treeview
// https://code.visualstudio.com/api/extension-guides/tree-view#view-container
// icons
//   https://code.visualstudio.com/api/references/icons-in-labels

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
//import * as ic from "iconv";
import { SpinCodeUtils, eParseState } from './spin.code.utils';
import { isSpinFile } from './spin.vscode.utils';

export class ObjectTreeProvider implements vscode.TreeDataProvider<Dependency> {
  private rootPath: string | undefined =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
  private bFixHierToTopLevel: boolean = false;
  private topLevelFSpec: string = '';
  private topLevelFName: string = '';

  private isDebugLogEnabled: boolean = true; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private debugOutputChannel: vscode.OutputChannel | undefined = undefined;

  private isDocument: boolean = false;
  private spinCodeUtils: SpinCodeUtils = new SpinCodeUtils();
  private latestHierarchy: Map<string, RawDependency[]> = new Map(); // children by filename

  // https://code.visualstudio.com/api/extension-guides/tree-view#view-container
  private _onDidChangeTreeData: vscode.EventEmitter<Dependency | undefined | null | void> = new vscode.EventEmitter<
    Dependency | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<Dependency | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor() {
    if (this.isDebugLogEnabled) {
      if (this.debugOutputChannel === undefined) {
        //Create output channel
        this.debugOutputChannel = vscode.window.createOutputChannel('Spin/Spin2 ObjTree DEBUG');
        this._logMessage('Spin/Spin2 ObjTree log started.');
      } else {
        this._logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }
    // add subscriptions
    vscode.window.onDidChangeActiveTextEditor(() => this.activeEditorChanged());
    //vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChanged(e));
    if (!this.rootPath) {
      this._logMessage('+ (DBG) ObjDep: no root path!');
    } else {
      let topFileBaseName: string | undefined = undefined;
      const fullConfiguration = vscode.workspace.getConfiguration();
      //this._logMessage(`+ (DBG) fullConfiguration=${JSON.stringify(fullConfiguration)}`);
      this._logMessage(`+ (DBG) fullConfiguration=${fullConfiguration}`);
      if (fullConfiguration.has('topLevel')) {
        topFileBaseName = vscode.workspace.getConfiguration().get('topLevel'); // this worked!
      } else {
        this._logMessage(`+ (DBG) topLevel key NOT present!`);
      }
      this._logMessage(`+ (DBG) ObjDep: topFileBaseName=[${topFileBaseName}]`);
      if (topFileBaseName) {
        this.bFixHierToTopLevel = true;
        const fileBasename = this._filenameWithSpinFileType(topFileBaseName);
        this.topLevelFSpec = path.join(this.rootPath, fileBasename);
        if (!this._fileExists(this.topLevelFSpec)) {
          this._logMessage(`+ (DBG) ObjDep: FILE NOT FOUND! [${this.topLevelFSpec}]!`);
          this.bFixHierToTopLevel = false;
        }
      }
    }

    if (!this.bFixHierToTopLevel) {
      this._logMessage(`+ (DBG) ObjDep: failed to ID top file for workspace`);
      this.topLevelFSpec = this._getActiveSpinFile();
      this._logMessage(`+ (DBG) ObjDep: NO TOP/curr, using activeFile=[${this.topLevelFSpec}]`);
      if (this.topLevelFSpec.length == 0) {
        // ERROR failed to ID open file (or file not open)
      }
    } else {
      this._logMessage(`+ (DBG) ObjDep: topLevelFSpec=[${this.topLevelFSpec}]`);
    }

    this.rootPath = path.dirname(this.topLevelFSpec);
    this.topLevelFName = path.basename(this.topLevelFSpec);

    // cause our initial status to be exposed
    this.activeEditorChanged();
  }

  public getObjectHierarchy(): [string, Map<string, RawDependency[]>] {
    return [this.topLevelFName, this.latestHierarchy];
  }

  public getTreeItem(element: Dependency): vscode.TreeItem {
    this._logMessage(`+ (DBG) ObjDep: getTreeItem(${element.label})`);
    return element;
  }

  public getChildren(element?: Dependency): Thenable<Dependency[]> {
    if (!this.rootPath) {
      vscode.window.showInformationMessage('No dependency in empty workspace');
      const noDep = new Dependency('No object references in empty workspace', '', vscode.TreeItemCollapsibleState.None);
      noDep.removeIcon(); // this is message, don't show icon
      this.latestHierarchy.clear();
      return Promise.resolve([noDep]);
    }

    const subDeps: Dependency[] = [];
    const subRawDeps: RawDependency[] = [];
    if (element) {
      this._logMessage(`+ (DBG) ObjDep: getChildren() element=[${element?.label}]`);
      // get for underlying file
      const fileBasename = this._filenameWithSpinFileType(element.label);
      const fileSpec = path.join(this.rootPath, fileBasename);
      if (!this._fileExists(fileSpec)) {
        this._logMessage(`+ (DBG) ObjDep: getChildren() element=[${fileBasename}] has (???) deps - MISSING FILE`);
        const topState: vscode.TreeItemCollapsibleState = this._stateForDependCount(0);
        const subDep = new Dependency(element.label, element.descriptionString, topState);
        subDep.setFileMissing();
        subDeps.push(subDep);
      } else {
        const spinDeps = this._getDepsFromSpinFile(fileSpec);
        this._logMessage(`+ (DBG) ObjDep: getChildren() element=[${fileBasename}] has (${spinDeps.length}) deps`);
        spinDeps.forEach((depency) => {
          const depFileSpec = path.join(this.rootPath!, depency.baseName);
          // huh, is this if really needed?
          if (this._fileExists(depFileSpec)) {
            const subSpinDeps = this._getDepsFromSpinFile(depFileSpec);
            const topState: vscode.TreeItemCollapsibleState = this._stateForDependCount(subSpinDeps.length);
            const subDep = new Dependency(depency.baseName, depency.knownAs, topState);
            subDeps.push(subDep);
            subRawDeps.push(this._rawDepFromDep(subDep));
          } else {
            const topState: vscode.TreeItemCollapsibleState = this._stateForDependCount(0);
            const subDep = new Dependency(depency.baseName, depency.knownAs, topState);
            subDep.setFileMissing();
            subDeps.push(subDep);
            subRawDeps.push(this._rawDepFromDep(subDep));
          }
        });
        this.latestHierarchy.set(fileBasename, subRawDeps);
      }
    } else {
      this._logMessage(`+ (DBG) ObjDep: getChildren() topLevel`);
      // get for project top level file
      let spinDeps = [];
      let filename: string = '';
      if (this.isDocument) {
        const textEditor = vscode.window.activeTextEditor;
        if (textEditor) {
          spinDeps = this._getDepsFromDocument(textEditor.document);
          filename = path.basename(textEditor.document.fileName);
        }
      } else {
        spinDeps = this._getDepsFromSpinFile(this.topLevelFSpec);
        filename = this.topLevelFName;
      }
      this._logMessage(`+ (DBG) ObjDep: getChildren() topLevel has (${spinDeps.length}) deps`);
      let topState: vscode.TreeItemCollapsibleState = this._stateForDependCount(spinDeps.length);
      if (spinDeps.length > 0) {
        topState = vscode.TreeItemCollapsibleState.Expanded; // always leave top-level expanded?
      }
      if (spinDeps.length > 0) {
        const topDep = new Dependency(this.topLevelFName, '(top-file)', topState);
        subDeps.push(topDep);
        for (let index = 0; index < subDeps.length; index++) {
          const subdep: Dependency = subDeps[index];
          subRawDeps.push(this._rawDepFromDep(subdep));
        }
        this.latestHierarchy.set(filename, subRawDeps);
      } else {
        //vscode.window.showInformationMessage("Workspace has no package.json");
        const emptyMessage: string = `No object references found in ${this.topLevelFName}`;
        const emptyDep = new Dependency(emptyMessage, '', vscode.TreeItemCollapsibleState.None);
        emptyDep.removeIcon(); // this is message, don't show icon
        subDeps.push(emptyDep);
        this.latestHierarchy.clear(); // empty list
      }
    }
    return Promise.resolve(subDeps);
  }

  public onElementClick(element: Dependency | undefined): void {
    this._logMessage(`+ (DBG) ObjDep: onElementClick() element=[${element?.label}]`);
    if (!element?.isFileMissing() && this.rootPath && element) {
      const fileFSpec: string = path.join(this.rootPath, element.label);
      this._showDocument(fileFSpec);
    }
  }

  // getParent(element: Dependency): Thenable<Dependency | undefined | null> {
  //
  //}

  public refresh(): void {
    this._logMessage('+ (DBG) ObjDep: refresh()');
    this._onDidChangeTreeData.fire();
  }

  private async _showDocument(fileFSpec: string) {
    this._logMessage(`+ (DBG) ObjDep: _showDocument() [${fileFSpec}]`);
    const textDocument = await vscode.workspace.openTextDocument(fileFSpec);
    await vscode.window.showTextDocument(textDocument, { preview: false });
  }

  private _filenameWithSpinFileType(filename: string): string {
    const bHasFileType: boolean = isSpinFile(filename) ? true : false; // matches .spin and .spin2! (not .spin3, etc.)
    let desiredName: string = filename;
    if (!bHasFileType) {
      desiredName = filename + '.spin';
      if (!this._fileExists(desiredName)) {
        desiredName = filename + '.spin2';
      }
    }
    return desiredName;
  }

  private activeEditorChanged(): void {
    // if we are not fixes
    if (vscode.window.activeTextEditor) {
      if (!this.bFixHierToTopLevel) {
        const fileFSpec: string = this._getActiveSpinFile();
        const enabled: boolean = isSpinFile(fileFSpec) ? true : false; // matches .spin and .spin2
        vscode.commands.executeCommand('setContext', 'spinExtension.objectDeps.enabled', enabled);
        this.latestHierarchy.clear();
        if (enabled) {
          // set new file top
          this.topLevelFSpec = fileFSpec;
          this.topLevelFName = path.basename(this.topLevelFSpec);
          this.rootPath = path.dirname(this.topLevelFSpec);
          this._logMessage(`+ (DBG) ObjDep: activeEditorChanged() topLevelFSpec=[${this.topLevelFSpec}]`);
          this.refresh();
        }
      } else {
        // we have topLevel for this workspace, stay enabled
        vscode.commands.executeCommand('setContext', 'spinExtension.objectDeps.enabled', true);
      }
    } else {
      vscode.commands.executeCommand('setContext', 'spinExtension.objectDeps.enabled', false);
    }
  }

  private _getActiveSpinFile(): string {
    const textEditor = vscode.window.activeTextEditor;
    let foundFSpec: string = '';
    if (textEditor) {
      if (textEditor.document.uri.scheme === 'file') {
        this.isDocument = true; // we're loading initial deps from current tab, not file!
        const currentlyOpenTabFSpec = textEditor.document.uri.fsPath;
        //var currentlyOpenTabfolderName = path.dirname(currentlyOpenTabFSpec);
        const currentlyOpenTabfileName = path.basename(currentlyOpenTabFSpec);
        //this._logMessage(`+ (DBG) ObjDep: fsPath-(${currentlyOpenTabFSpec})`);
        //this._logMessage(`+ (DBG) ObjDep: folder-(${currentlyOpenTabfolderName})`);
        this._logMessage(`+ (DBG) ObjDep: filename-(${currentlyOpenTabfileName})`);
        if (isSpinFile(currentlyOpenTabfileName)) {
          // matches .spin and .spin2
          foundFSpec = currentlyOpenTabFSpec;
        }
      }
    }
    return foundFSpec;
  }

  /*
  private onDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent): void {
	  if (this.tree && this.autoRefresh && changeEvent.document.uri.toString() === this.editor?.document.uri.toString()) {
		  for (const change of changeEvent.contentChanges) {
			  const path = json.getLocation(this.text, this.editor.document.offsetAt(change.range.start)).path;
			  path.pop();
			  const node = path.length ? json.findNodeAtLocation(this.tree, path) : void 0;
			  this.parseTree();
			  this._onDidChangeTreeData.fire(node ? node.offset : void 0);
		  }
	  }
  }
  */

  private _getDepsFromDocument(activeEditDocument: vscode.TextDocument): SpinObject[] {
    this._logMessage(`+ (DBG) ObjDep: _getDepsFromDocument()`);
    let currState: eParseState = eParseState.inCon; // compiler defaults to CON at start!
    let priorState: eParseState = currState;
    const deps = [];
    for (let i = 0; i < activeEditDocument.lineCount; i++) {
      const line = activeEditDocument.lineAt(i);
      const trimmedLine: string = line.text.replace(/\s+$/, '');
      if (trimmedLine.length == 0) {
        continue; // skip blank lines
      }
      // skip all {{ --- }} multi-line doc comments
      if (currState == eParseState.inMultiLineDocComment) {
        // in multi-line doc-comment, hunt for end '}}' to exit
        const closingOffset = line.text.indexOf('}}');
        if (closingOffset != -1) {
          // have close, comment ended
          currState = priorState;
        }
        continue;
      } else if (currState == eParseState.inMultiLineComment) {
        // in multi-line non-doc-comment, hunt for end '}' to exit
        const closingOffset = trimmedLine.indexOf('}');
        if (closingOffset != -1) {
          // have close, comment ended
          currState = priorState;
        }
        //  DO NOTHING
        continue;
      } else if (trimmedLine.startsWith('{{')) {
        // process multi-line doc comment
        const openingOffset = line.text.indexOf('{{');
        const closingOffset = line.text.indexOf('}}', openingOffset + 2);
        if (closingOffset == -1) {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineDocComment;
        }
        continue;
      } else if (trimmedLine.startsWith('{')) {
        // process possible multi-line non-doc comment
        // do we have a close on this same line?
        const openingOffset = trimmedLine.indexOf('{');
        const closingOffset = trimmedLine.indexOf('}', openingOffset + 1);
        if (closingOffset == -1) {
          // is open of multiline comment wihtout close
          priorState = currState;
          currState = eParseState.inMultiLineComment;
        }
        continue;
      } else if (trimmedLine.startsWith("''")) {
        // process single-line doc comment
        continue;
      } else if (trimmedLine.startsWith("'")) {
        // process single-line non-doc comment
        continue;
      }
      const nonCommentLineRemainder: string = this.spinCodeUtils.getNonCommentLineRemainder(0, trimmedLine);
      const sectionStatus = this.spinCodeUtils.isSectionStartLine(nonCommentLineRemainder);
      if (sectionStatus.isSectionStart) {
        priorState = currState;
        currState = sectionStatus.inProgressStatus;
      }
      //this._logMessage(`+ (DBG) ObjDep: _getDepsFromSpinFile() eval trimmedLine=[${trimmedLine}]`);
      if (currState == eParseState.inObj && nonCommentLineRemainder.includes(':')) {
        const spinObj = this._spinDepFromObjectLine(nonCommentLineRemainder);
        if (spinObj) {
          this._logMessage(`+ (DBG) ObjDep: _getDepsFromSpinFile() basename=[${spinObj.baseName}] known as (${spinObj.knownAs})`);
          deps.push(spinObj);
        } else {
          this._logMessage(`+ (DBG) ObjDep: _getDepsFromDocument() BAD parse of OBJ line [${trimmedLine}]`);
        }
      }
    }
    this._logMessage(`+ (DBG) ObjDep:   -- returns ${deps.length} dep(s)`);
    return deps;
  }

  private _stateForDependCount(nbrDeps: number): vscode.TreeItemCollapsibleState {
    // determine initial state of tree entry
    let interpState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None;
    if (nbrDeps > 0) {
      interpState = vscode.TreeItemCollapsibleState.Collapsed;
    }
    return interpState;
  }

  private _getDepsFromSpinFile(fileSpec: string): SpinObject[] {
    const deps = [];
    this._logMessage(`+ (DBG) ObjDep: _getDepsFromSpinFile(${fileSpec})`);
    if (this._fileExists(fileSpec)) {
      const spinFileContent = this._loadFileAsString(fileSpec); // handles utf8/utf-16
      let lines = spinFileContent.split('\r\n');
      if (lines.length == 1) {
        // file not CRLF is LF only!
        lines = spinFileContent.split('\n');
      }
      this._logMessage(`+ (DBG) ObjDep: file has (${lines.length}) lines`);

      let currState: eParseState = eParseState.inCon; // compiler defaults to CON at start!
      let priorState: eParseState = currState;
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        const trimmedLine = text.replace(/\s+$/, '');
        if (trimmedLine.length == 0) {
          continue; // skip blank lines
        }
        // skip all {{ --- }} multi-line doc comments
        if (currState == eParseState.inMultiLineDocComment) {
          // in multi-line doc-comment, hunt for end '}}' to exit
          const closingOffset = text.indexOf('}}');
          if (closingOffset != -1) {
            // have close, comment ended
            currState = priorState;
          }
          continue;
        } else if (currState == eParseState.inMultiLineComment) {
          // in multi-line non-doc-comment, hunt for end '}' to exit
          const closingOffset = trimmedLine.indexOf('}');
          if (closingOffset != -1) {
            // have close, comment ended
            currState = priorState;
          }
          continue;
        } else if (trimmedLine.startsWith('{{')) {
          // process multi-line doc comment
          const openingOffset = text.indexOf('{{');
          const closingOffset = text.indexOf('}}', openingOffset + 2);
          if (closingOffset == -1) {
            // is open of multiline comment
            priorState = currState;
            currState = eParseState.inMultiLineDocComment;
          }
          continue;
        } else if (trimmedLine.startsWith('{')) {
          // process possible multi-line non-doc comment
          // do we have a close on this same line?
          const openingOffset = trimmedLine.indexOf('{');
          const closingOffset = trimmedLine.indexOf('}', openingOffset + 1);
          if (closingOffset == -1) {
            // is open of multiline comment
            priorState = currState;
            currState = eParseState.inMultiLineComment;
          }
          continue;
        } else if (trimmedLine.startsWith("''")) {
          // process single-line doc comment
          continue;
        } else if (trimmedLine.startsWith("'")) {
          // process single-line non-doc comment
          continue;
        }
        const nonCommentLineRemainder: string = this.spinCodeUtils.getNonCommentLineRemainder(0, text);
        const sectionStatus = this.spinCodeUtils.isSectionStartLine(text);
        if (sectionStatus.isSectionStart) {
          priorState = currState;
          currState = sectionStatus.inProgressStatus;
        }
        //this._logMessage(`+ (DBG) ObjDep: _getDepsFromSpinFile() eval trimmedLine=[${trimmedLine}]`);
        if (currState == eParseState.inObj && nonCommentLineRemainder.includes(':')) {
          const spinObj = this._spinDepFromObjectLine(nonCommentLineRemainder);
          if (spinObj) {
            this._logMessage(`+ (DBG) ObjDep: _getDepsFromSpinFile() basename=[${spinObj.baseName}] known as (${spinObj.knownAs})`);
            deps.push(spinObj);
          } else {
            this._logMessage(`+ (DBG) ObjDep: _getDepsFromDocument() BAD parse of OBJ line [${trimmedLine}]`);
          }
        }
      }
    } else {
      this._logMessage(`+ (DBG) ObjDep: NOT FOUND! file=(${fileSpec})`);
    }
    this._logMessage(`+ (DBG) ObjDep:   -- returns ${deps.length} dep(s)`);
    return deps;
  }

  private _spinDepFromObjectLine(objLine: string): SpinObject | undefined {
    let desiredSpinObj = undefined;
    const conOverrideLocn: number = objLine.indexOf('|');
    const usefullObjLine: string = conOverrideLocn != -1 ? objLine.substring(0, conOverrideLocn) : objLine;
    const lineParts = usefullObjLine.split(/[ \t"]/).filter(Boolean);
    this._logMessage(`+ (DBG) ObjDep: _spinDepFromObjectLine() lineParts=[${lineParts}](${lineParts.length}) line=[${objLine}]`);
    let objName: string = '';
    let filename: string = '';
    if (lineParts.length >= 2) {
      // the first colon tells us where things are so locate it...
      for (let index = 0; index < lineParts.length; index++) {
        const part = lineParts[index];
        if (part == ':') {
          objName = lineParts[index - 1];
          filename = lineParts[index + 1];
          break;
        } else if (part.endsWith(':')) {
          objName = part.replace(':', '');
          filename = lineParts[index + 1];
          break;
        }
      }
      const spinCodeFileName: string = this._filenameWithSpinFileType(filename);
      desiredSpinObj = new SpinObject(spinCodeFileName, objName);
    }
    return desiredSpinObj;
  }

  private _loadFileAsString(fspec: string): string {
    let fileContent: string = '';
    if (fs.existsSync(fspec)) {
      this._logMessage(`* loadFileAsString() attempt load of [${fspec}]`);
      try {
        fileContent = fs.readFileSync(fspec, 'utf-8');
        if (fileContent.includes('\x00')) {
          fileContent = fs.readFileSync(fspec, 'utf16le');
        }
      } catch (err) {
        this._logMessage(`* loadFileAsString() EXCEPTION: err=[${err}]`);
      }
    } else {
      this._logMessage(`* loadFileAsString() fspec=[${fspec}] NOT FOUND!`);
    }
    return fileContent;
  }

  private _fileExists(pathSpec: string): boolean {
    let existsStatus: boolean = false;
    if (fs.existsSync(pathSpec)) {
      // File exists in path
      existsStatus = true;
    }
    return existsStatus;
  }
  /**
   * write message to formatting log (when log enabled)
   *
   * @param the message to be written
   * @returns nothing
   */
  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled && this.debugOutputChannel != undefined) {
      //Write to output window.
      this.debugOutputChannel.appendLine(message);
    }
  }

  private _rawDepFromDep(dep: Dependency): RawDependency {
    //this._logMessage(`* _rawDepFromDep() label=[${dep.label}]`);
    this._logMessage(`* _rawDepFromDep() filename=[${dep.filename}]`);
    const newRawDep: RawDependency = new RawDependency(dep.filename);
    return newRawDep;
  }
}

// class ProviderResult: Dependency | undefined | null | Thenable<Dependency | undefined | null>
class SpinObject {
  public readonly baseName: string = '';
  public readonly knownAs: string = '';

  constructor(
    public readonly fileBaseName: string,
    public objName: string
  ) {
    this.baseName = fileBaseName;
    this.knownAs = objName;
  }
}

export class RawDependency {
  private _basename: string = '';
  private _filename: string = '';
  private _children: RawDependency[] = [];

  constructor(filename: string) {
    this._filename = filename;
    this._basename = filename.replace('.spin2', '');
  }

  public addChild(child: RawDependency) {
    this._children.push(child);
  }

  get hasChildren(): boolean {
    return this._children.length > 0 ? true : false;
  }

  get children(): RawDependency[] {
    return this._children;
  }
  get name(): string {
    return this._filename;
  }
}

export class Dependency extends vscode.TreeItem {
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("file-code", "#FF8000");
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-field");  // hrmf... blue
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-enum"); // nice, orange!
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-structure"); // hrmf, no color (white)
  private icon: vscode.ThemeIcon = new vscode.ThemeIcon('symbol-class'); // nice, orange!
  private basename: string = '';
  private _filename: string = '';
  public readonly descriptionString: string = '';
  private fileMissing: boolean = false;
  // map our fields to underlying TreeItem
  constructor(
    public readonly label: string,
    private objName: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    // element label is  filebasename
    // element description is  object name in containing file
    // element tooltip is filename (object name)
    super(label, collapsibleState);
    this.description = this.objName;
    this.descriptionString = this.objName;
    this._filename = this.label; // save 'given' name
    this.basename = label.replace('.spin2', '');
    this.basename = this.basename.replace('.spin', '');
    if (objName.includes('top-file')) {
      this.tooltip = `This is the project top-most file`;
    } else {
      this.tooltip = `An instance of ${this.basename} known as ${this.objName}`;
    }
    //this.iconPath = { light: new vscode.ThemeIcon("file-code").id, dark: new vscode.ThemeIcon("file-code").id };
    //this.resourceUri = new vscode.ThemeIcon('file-code').
    //this.icon = new vscode.ThemeIcon("file-code");  // nope!!
    this.iconPath = this.icon;
    this.contextValue = 'dependency';
    this.command = {
      command: 'spinExtension.objectDependencies.activateFile',
      title: 'open file',
      tooltip: 'click to open file',
      arguments: [this]
    };
  }

  get filename(): string {
    return this._filename;
  }

  public isFileMissing(): boolean {
    return this.fileMissing;
  }

  public setFileMissing() {
    this.fileMissing = true;
    const origText = this.description;
    if (origText) {
      this.description = `${origText} - MISSING FILE`;
    } else {
      this.description = `- MISSING FILE`;
    }
  }

  public removeIcon() {
    // take off icon if we are showing dep as error/warning message
    this.iconPath = undefined;
  }
}
