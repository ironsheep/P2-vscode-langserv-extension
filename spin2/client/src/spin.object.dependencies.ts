'use strict';

// https://code.visualstudio.com/api/ux-guidelines/views
// https://code.visualstudio.com/api/extension-guides/tree-view#treeview
// https://code.visualstudio.com/api/extension-guides/tree-view#view-container
// icons
//   https://code.visualstudio.com/api/references/icons-in-labels

import * as vscode from 'vscode';
import * as path from 'path';
import { isSpinFile } from './spin.vscode.utils';
import { LanguageClient } from 'vscode-languageclient/node';

const CALLED_INTERNALLY: boolean = true; // refresh() called by code, not button press
const ELEM_COLLAPSED: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
const ELEM_EXPANDED: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded;
const ELEM_NONE: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None;

enum eTreeState {
  TS_Unknown,
  TS_ExpandTop,
  TS_ExpandAll
}

// -------------------------------------------------------------------------------------
//  Data contract: matches server-side IObjectDependencyNode
//
export interface IObjectDependencyNode {
  fileName: string; // "isp_hub75_color.spin2"
  instanceName: string; // "color" (empty for root)
  fileSpec: string; // absolute path, empty if missing
  isFileMissing: boolean;
  isCircular: boolean; // ancestor already in path
  depth: number; // 0 = top-level file
  children: IObjectDependencyNode[];
  dependencyType: 'obj' | 'include'; // OBJ vs #include
}

interface IObjectDependencyResponse {
  topFileName: string;
  rootNode: IObjectDependencyNode | null;
  isReady: boolean; // false if server hasn't parsed yet
}

export class ObjectTreeProvider implements vscode.TreeDataProvider<Dependency> {
  private rootPath: string | undefined =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
  private bFixHierToTopLevel: boolean = false;
  private topLevelFSpec: string = '';
  private topLevelFName: string = '';
  private fixedTopLevelFSpec: string = '';
  private treeState: eTreeState = eTreeState.TS_ExpandAll;
  private viewEnabledState: boolean = false;
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private debugOutputChannel: vscode.OutputChannel | undefined = undefined;
  private isEmptying: boolean = false;
  private cachedTree: IObjectDependencyNode | null = null;
  private languageClient: LanguageClient | undefined = undefined;
  private pendingRequest: boolean = false;

  // https://code.visualstudio.com/api/extension-guides/tree-view#view-container
  private _onDidChangeTreeData: vscode.EventEmitter<Dependency | undefined> = new vscode.EventEmitter<Dependency | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Dependency | undefined> = this._onDidChangeTreeData.event;

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

    // publish current tree state
    this._publishTreeState();

    if (!this.rootPath) {
      this._logMessage('+ (DBG) ObjDep: no root path!');
    }

    // load topFile variable if present in config
    //  sets: bFixHierToTopLevel, fixedTopLevelFSpec
    this._loadConfigWithTopFileInfo();
    if (this.bFixHierToTopLevel) {
      this.topLevelFSpec = this.fixedTopLevelFSpec;
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

    if (this.topLevelFSpec.length > 0) {
      this._logMessage(`+ (DBG) ObjDep: constructor() done, firing editorChanged...`);
      this.activeEditorChanged(CALLED_INTERNALLY);
    } else {
      this._logMessage(`+ (DBG) ObjDep: constructor() done, NO TOP/curr, NO activeFile`);
    }
  }

  public setLanguageClient(client: LanguageClient): void {
    this.languageClient = client;
    client.onNotification('spin/objectDependenciesChanged', () => {
      this._onServerDependenciesChanged();
    });
    // If we already have a top-level file, request dependencies now
    if (this.topLevelFSpec.length > 0 && this.viewEnabledState) {
      this._requestDependenciesFromServer();
    }
  }

  private _onServerDependenciesChanged(): void {
    this._logMessage(`+ (DBG) ObjDep: server says dependencies changed`);
    if (this.viewEnabledState && this.topLevelFSpec.length > 0) {
      this._requestDependenciesFromServer();
    }
  }

  private async _requestDependenciesFromServer(): Promise<void> {
    if (!this.languageClient || this.pendingRequest) {
      return;
    }
    this.pendingRequest = true;
    try {
      const uri = vscode.Uri.file(this.topLevelFSpec).toString();
      this._logMessage(`+ (DBG) ObjDep: requesting deps from server for [${uri}]`);
      const response: IObjectDependencyResponse = await this.languageClient.sendRequest('spin/getObjectDependencies', { uri });
      if (response.isReady && response.rootNode) {
        this.cachedTree = response.rootNode;
        this._logMessage(`+ (DBG) ObjDep: got tree from server, root=[${response.topFileName}]`);
      } else {
        this.cachedTree = null;
        this._logMessage(`+ (DBG) ObjDep: server not ready or no root node`);
      }
      this.refresh(CALLED_INTERNALLY);
    } catch (err) {
      this._logMessage(`+ (DBG) ObjDep: request error: ${err}`);
    } finally {
      this.pendingRequest = false;
    }
  }

  private _loadConfigWithTopFileInfo(): boolean {
    let tmpTopFileBaseName: string | undefined = undefined;
    let topFileChanged: boolean = false;
    const fullConfiguration = vscode.workspace.getConfiguration();
    if (fullConfiguration.has('topLevel')) {
      tmpTopFileBaseName = fullConfiguration.get('topLevel'); // this worked!
    } else {
      this._logMessage(`+ (DBG) ObjDep: topLevel key NOT present!`);
    }
    this._logMessage(`+ (DBG) ObjDep: fixedTopFileBaseName=[${tmpTopFileBaseName}]`);
    if (tmpTopFileBaseName) {
      const fileBasename = this._filenameWithSpinFileType(tmpTopFileBaseName);
      const tmpTopLevelFSpec = path.join(this.rootPath, fileBasename);
      topFileChanged = this.fixedTopLevelFSpec != tmpTopLevelFSpec || this.bFixHierToTopLevel == false;
      this.bFixHierToTopLevel = true;
      this.fixedTopLevelFSpec = tmpTopLevelFSpec;
    }
    return topFileChanged;
  }

  public getObjectHierarchy(): [string, IObjectDependencyNode | null] {
    // used by report generator
    this._logMessage(`+==+ (DBG) ObjDep: getObjectHierarchy()`);
    return [this.topLevelFName, this.cachedTree];
  }

  public onElementClick(element: Dependency | undefined): void {
    const clickArg: string = element !== undefined ? element?.label.toString() : '';
    this._logMessage(`+==+ (DBG) ObjDep: onElementClick() element=[${clickArg}]`);
    if (!element?.isFileMissing && element && element.fileSpec.length > 0) {
      this._showDocument(element.fileSpec);
    }
  }

  public refresh(internalUse: boolean = false): void {
    const invokeType: string = internalUse ? 'INTERNAL' : 'CLICK';
    this._logMessage(`+${invokeType}+ (DBG) ObjDep: refresh()`);
    this._onDidChangeTreeData.fire(undefined);
  }

  public async expandAll(): Promise<void> {
    this._logMessage('+CLICK+  (DBG) ObjDep: expandAll()');
    this.isEmptying = true;
    this.refresh(CALLED_INTERNALLY);
    this.treeState = eTreeState.TS_ExpandAll;
    this._publishTreeState();
    this.refresh(CALLED_INTERNALLY);
  }

  public collapseAll(): void {
    this._logMessage('+CLICK+  (DBG) ObjDep: collapseAll()');
    this.isEmptying = true;
    this.refresh(CALLED_INTERNALLY);
    this.treeState = eTreeState.TS_ExpandTop;
    this._publishTreeState();
    this.refresh(CALLED_INTERNALLY);
  }

  public getTreeItem(element: Dependency): vscode.TreeItem {
    this._logMessage(`+==+ (DBG) ObjDep: getTreeItem(${element.label}[${element.id}]) [${this._collapseStateString(element.collapsibleState)}]`);
    return element;
  }

  public getChildren(element?: Dependency): vscode.ProviderResult<Dependency[]> {
    const topId: string = element !== undefined ? `[${element?.id}]` : '';
    const topArg: string = element !== undefined ? `${element?.label.toString()}${topId}` : '';
    this._logMessage(`+==+ (DBG) ObjDep: getChildrn(${topArg}) isEmptying=(${this.isEmptying})`);

    const subDeps: Dependency[] = [];
    if (this.isEmptying) {
      const rebuildingDep = new Dependency('...', '', ELEM_NONE, -1, '0');
      rebuildingDep.removeIcon();
      subDeps.push(rebuildingDep);
      this.isEmptying = false;
    } else if (!this.rootPath) {
      vscode.window.showInformationMessage('No object references in empty workspace');
      const noDep = new Dependency('No object references in empty workspace', '', ELEM_NONE, -1, '0');
      noDep.removeIcon();
      subDeps.push(noDep);
    } else if (element !== undefined) {
      // CASE: get children for a specific node
      const node = this._findNodeById(this.cachedTree, element.id);
      if (node && node.children.length > 0) {
        for (let index = 0; index < node.children.length; index++) {
          const child = node.children[index];
          const childId = `${element.id}${index}`;
          const childState = this._elementCollapseState(child.depth, !child.isFileMissing && !child.isCircular, child.children.length);
          const subDep = new Dependency(child.fileName, child.instanceName, childState, child.depth, childId);
          subDep.fileSpec = child.fileSpec;
          if (child.isFileMissing) {
            subDep.setFileMissing();
          }
          if (child.isCircular) {
            subDep.setCircular();
          }
          if (child.dependencyType === 'include') {
            subDep.setInclude();
          }
          subDeps.push(subDep);
        }
      }
    } else {
      // CASE: root level
      if (this.cachedTree) {
        const topState = this._elementCollapseState(0, true, this.cachedTree.children.length);
        const topDep = new Dependency(this.topLevelFName, '(top-file)', topState, 0, '0');
        topDep.fileSpec = this.cachedTree.fileSpec;
        subDeps.push(topDep);
      } else {
        const emptyMessage: string = `No object references found in ${this.topLevelFName}`;
        const emptyDep = new Dependency(emptyMessage, '', ELEM_NONE, -1, '0');
        emptyDep.removeIcon();
        subDeps.push(emptyDep);
      }
    }
    return Promise.resolve(subDeps);
  }

  private _findNodeById(tree: IObjectDependencyNode | null, targetId: string): IObjectDependencyNode | null {
    if (!tree || !targetId || targetId.length === 0) {
      return null;
    }
    // Root is '0', first child of root is '00', second is '01', etc.
    // Navigate by stripping '0' prefix and walking children
    if (targetId === '0') {
      return tree;
    }
    // Strip the leading '0' (root) then walk each digit as child index
    const path = targetId.substring(1);
    let current: IObjectDependencyNode = tree;
    for (let i = 0; i < path.length; i++) {
      const childIndex = parseInt(path[i], 10);
      if (isNaN(childIndex) || childIndex >= current.children.length) {
        return null;
      }
      current = current.children[childIndex];
    }
    return current;
  }

  /** Re-evaluate active editor state (call after activation to catch missed events) */
  public checkActiveEditor(): void {
    this.activeEditorChanged(CALLED_INTERNALLY);
  }

  private activeEditorChanged(internalUse: boolean = false): void {
    const invokeType: string = internalUse ? ' INTERNAL ' : ' TAB-change ';
    this._logMessage(`+==+ (DBG) ObjDep: activeEditorChanged(${invokeType})`);
    const initialViewEnabledState: boolean = this.viewEnabledState;
    const topChanged: boolean = this._loadConfigWithTopFileInfo();
    const haveActiveEditor: boolean = vscode.window.activeTextEditor !== undefined ? true : false;
    let editedFileNameChanged: boolean = false;
    let haveSpinFile: boolean = false;
    if (haveActiveEditor) {
      const fileFSpec: string = this._getActiveSpinFile();
      const fileName: string = path.basename(fileFSpec);
      haveSpinFile = isSpinFile(fileFSpec) ? true : false;
      editedFileNameChanged = haveSpinFile && fileFSpec != this.topLevelFSpec ? true : false;
      this._logMessage(`+ (DBG) ObjDep: aeChg() editFName=[${fileName}], nmChg=(${editedFileNameChanged}), haveSpinFile=(${haveSpinFile})`);
      if (editedFileNameChanged && !this.bFixHierToTopLevel) {
        this.topLevelFSpec = fileFSpec;
        this.topLevelFName = fileName;
        this.rootPath = path.dirname(this.topLevelFSpec);
      }
    }
    const newViewEnabledState: boolean = haveSpinFile && (this.bFixHierToTopLevel || haveActiveEditor) ? true : false;
    const stateChanged: boolean = initialViewEnabledState != newViewEnabledState;
    this.viewEnabledState = newViewEnabledState;

    if (topChanged || editedFileNameChanged) {
      this._requestDependenciesFromServer();
    }

    if (stateChanged) {
      this._publishViewEnableState(this.viewEnabledState);
      if (this.viewEnabledState == true) {
        this._requestDependenciesFromServer();
      } else {
        this.cachedTree = null;
      }
    }
  }

  private _publishTreeState() {
    const currentState: boolean = this.treeState == eTreeState.TS_ExpandTop ? true : false;
    this._logMessage(`* ObjDep: treeState .objectDeps.showingTopOnly=(${currentState})`);
    vscode.commands.executeCommand('setContext', 'runtime.spin2.objectDeps.showingTopOnly', currentState);
  }

  private _publishViewEnableState(desiredEnableState: boolean) {
    this._logMessage(`* ObjDep: treeView .objectDeps.enabled=(${desiredEnableState})`);
    vscode.commands.executeCommand('setContext', 'runtime.spin2.objectDeps.enabled', desiredEnableState);
  }

  private _collapseStateString(collapseMode: vscode.TreeItemCollapsibleState): string {
    switch (collapseMode) {
      case ELEM_COLLAPSED:
        return 'CS_COLLAPSED';
      case ELEM_EXPANDED:
        return 'CS_EXPANDED';
      case ELEM_NONE:
        return 'CS_NONE';
      default:
        return '?unk?';
    }
  }

  private async _showDocument(fileFSpec: string) {
    this._logMessage(`+ (DBG) ObjDep: _showDocument() [${fileFSpec}]`);
    const textDocument = await vscode.workspace.openTextDocument(fileFSpec);
    await vscode.window.showTextDocument(textDocument, { preview: false });
  }

  private _elementCollapseState(depth: number, fileExists: boolean, nbrChildren: number): vscode.TreeItemCollapsibleState {
    let desiredState: vscode.TreeItemCollapsibleState = ELEM_NONE;
    if (fileExists == true && nbrChildren > 0) {
      if (depth == 0) {
        desiredState = ELEM_EXPANDED; // root is always expanded
      } else {
        desiredState = this.treeState == eTreeState.TS_ExpandTop ? ELEM_COLLAPSED : ELEM_EXPANDED;
      }
    }
    return desiredState;
  }

  private _filenameWithSpinFileType(filename: string): string {
    const bHasFileType: boolean = isSpinFile(filename) ? true : false;
    return bHasFileType ? filename : filename + '.spin2';
  }

  private _getActiveSpinFile(): string {
    const textEditor = vscode.window.activeTextEditor;
    let foundFSpec: string = '';
    if (textEditor !== undefined) {
      if (textEditor.document.uri.scheme === 'file') {
        const currentlyOpenTabFSpec = textEditor.document.uri.fsPath;
        const currentlyOpenTabfileName = path.basename(currentlyOpenTabFSpec);
        this._logMessage(`+ (DBG) ObjDep: filename-(${currentlyOpenTabfileName})`);
        if (isSpinFile(currentlyOpenTabfileName)) {
          foundFSpec = currentlyOpenTabFSpec;
        }
      }
    }
    return foundFSpec;
  }

  /**
   * write message to formatting log (when log enabled)
   *
   * @param the message to be written
   * @returns nothing
   */
  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled && this.debugOutputChannel !== undefined) {
      //Write to output window.
      this.debugOutputChannel.appendLine(message);
    }
  }
}

export class Dependency extends vscode.TreeItem {
  private icon: vscode.ThemeIcon = new vscode.ThemeIcon('symbol-class'); // nice, orange!
  private _basename: string = '';
  private _filename: string = '';
  private _depth: number = 0;
  private _objName: string;
  private fileMissing: boolean = false;
  private _parent: Dependency | undefined = undefined;
  public readonly descriptionString: string = '';
  public fileSpec: string = '';
  // map our fields to underlying TreeItem
  constructor(
    label: string | vscode.TreeItemLabel,
    objName: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    depth: number,
    userId: string,
    parent: Dependency | undefined = undefined
  ) {
    super(label, collapsibleState);
    this._objName = objName;
    this.description = objName;
    this._parent = parent;
    this._depth = depth;
    this.descriptionString = objName;
    this.id = userId;
    if (label !== undefined) {
      this._filename = label.toString();
      this._basename = label.toString();
      this._basename = this._basename.replace('.spin2', '');
      this._basename = this._basename.replace('.spin', '');
    } else {
      this._filename = '?missing?';
      this._basename = '?missing?';
    }
    if (objName.includes('top-file')) {
      this.tooltip = `This is the project top-most file`;
    } else {
      this.tooltip = `An instance of ${this._basename} known as ${this._objName}`;
    }
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

  get objName(): string {
    return this._objName;
  }

  get depth(): number {
    return this._depth;
  }

  get parentDep(): Dependency | undefined {
    return this._parent;
  }

  get isFileMissing(): boolean {
    return this.fileMissing;
  }

  public setFileMissing() {
    this.fileMissing = true;
    const origText = this.description;
    if (origText !== undefined) {
      this.description = `${origText} - MISSING FILE`;
    } else {
      this.description = `- MISSING FILE`;
    }
  }

  public setCircular() {
    const origText = this.description;
    if (origText !== undefined) {
      this.description = `${origText} - CIRCULAR REF`;
    } else {
      this.description = `- CIRCULAR REF`;
    }
    this.collapsibleState = ELEM_NONE;
  }

  public setInclude() {
    this.icon = new vscode.ThemeIcon('symbol-file');
    this.iconPath = this.icon;
  }

  public toString(callerId: string = undefined): string {
    let descriptionString: string = '';
    const callerIdStr: string = callerId !== undefined ? `${callerId} ` : '';
    descriptionString = `${callerIdStr} ${this.id} ${this.filename} ${this.descriptionString}`;
    return descriptionString;
  }

  public removeIcon() {
    // take off icon if we are showing dep as error/warning message
    this.iconPath = undefined;
  }
}
