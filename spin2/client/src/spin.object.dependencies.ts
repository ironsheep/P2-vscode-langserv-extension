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

const CALLED_INTERNALLY: boolean = true; // refresh() called by code, not button press
const ELEM_COLLAPSED: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
const ELEM_EXPANDED: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded;
const ELEM_NONE: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None;

enum eTreeState {
  TS_Unknown,
  TS_ExpandTop,
  TS_ExpandAll
}

export class ObjectTreeProvider implements vscode.TreeDataProvider<Dependency> {
  private rootPath: string | undefined =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
  private bFixHierToTopLevel: boolean = false;
  private topLevelFSpec: string = '';
  private topLevelFName: string = '';
  private treeState: eTreeState = eTreeState.TS_ExpandAll; // eTreeState.TS_ExpandTop; // tracks current state of treeView
  private viewEnabledState: boolean = false;
  private isDebugLogEnabled: boolean = true; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private debugOutputChannel: vscode.OutputChannel | undefined = undefined;

  private isDocument: boolean = false;
  private spinCodeUtils: SpinCodeUtils = new SpinCodeUtils();
  private latestHierarchy: Map<string, SpinDependency> = new Map(); // children by filename

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
    //vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChanged(e));

    // publish current tree state
    this._publishTreeState();
    //this._publishViewEnableState(true);

    if (!this.rootPath) {
      this._logMessage('+ (DBG) ObjDep: no root path!');
    } else {
      let topFileBaseName: string | undefined = undefined;
      const fullConfiguration = vscode.workspace.getConfiguration();
      //this._logMessage(`+ (DBG) fullConfiguration=${JSON.stringify(fullConfiguration)}`);
      //this._logMessage(`+ (DBG) fullConfiguration=${fullConfiguration}`);
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

    this._logMessage(`+==+ (DBG) ObjDep: constructor() done, firing editorChanged...`);
    this.activeEditorChanged();
    this._preloadFullSpinDependencies();
  }

  private _preloadFullSpinDependencies() {
    // prescan all files starting from current  file in active editor if any, else scan topFile if given
    //  will do NOTHING if these conditions are not met
    if (this.viewEnabledState == true) {
      const rootDeps: SpinDependency[] = this.getDependencies();
      this.latestHierarchy.clear();
      this._addDependencies(rootDeps);
    }
    this._logMessage(`**** _preloadFullSpinDependencies() ended with ${this.latestHierarchy.size} files`);
  }

  private _addDependencies(rootDeps: SpinDependency[]) {
    this._logMessage(`** _addDependencies(${rootDeps[0].name})[${rootDeps[0].id}]`);
    for (let index = 0; index < rootDeps.length; index++) {
      const fileWithChildren = rootDeps[index];
      const filename: string = fileWithChildren.name;
      // add root if not already present
      if (this.latestHierarchy.has(filename) == false) {
        this.latestHierarchy.set(filename, fileWithChildren);
        this._logMessage(`** _addDependencies() ADD name=[${filename}][${fileWithChildren.id}]`);
      } else {
        this._logMessage(`** _addDependencies() EXISTS name=[${filename}][${fileWithChildren.id}]`);
      }
      if (fileWithChildren.hasChildren) {
        for (let index = 0; index < fileWithChildren.children.length; index++) {
          const childWithChildren = fileWithChildren.children[index];
          if (childWithChildren.hasChildren == false && childWithChildren.isFileMissing == false) {
            const childDeps: SpinDependency[] = this.getDependencies(childWithChildren);
            this._addDependencies(childDeps);
          } else {
            const filename: string = childWithChildren.name;
            // add child () if not already present if NO CHILDREN or NO FILE
            const childrenFlag: string = childWithChildren.hasChildren ? '' : 'NO-children ';
            const fileFlag: string = childWithChildren.isFileMissing ? 'NO-file ' : '';
            if (this.latestHierarchy.has(filename) == false) {
              this.latestHierarchy.set(filename, childWithChildren);
              this._logMessage(`** _addDependencies() ADD ${childrenFlag}${fileFlag}name=[${filename}][${childWithChildren.id}]`);
            } else {
              this._logMessage(`** _addDependencies() EXISTS name=[${filename}][${childWithChildren.id}]`);
            }
          }
        }
      }
    }
  }

  public getObjectHierarchy(): [string, Map<string, SpinDependency>] {
    // used by report generator
    this._logMessage(`+==+ (DBG) ObjDep: getObjectHierarchy()`);
    return [this.topLevelFName, this.latestHierarchy];
  }

  public onElementClick(element: Dependency | undefined): void {
    const clickArg: string = element !== undefined ? element?.label.toString() : '';
    this._logMessage(`+==+ (DBG) ObjDep: onElementClick() element=[${clickArg}]`);
    if (!element?.isFileMissing && this.rootPath && element) {
      const fileFSpec: string = path.join(this.rootPath, element.label.toString());
      this._showDocument(fileFSpec);
    }
  }

  public refresh(internalUse: boolean = false): void {
    const invokeType: string = internalUse ? 'INTERNAL' : 'CLICK';
    this._logMessage(`+${invokeType}+ (DBG) ObjDep: refresh()`);
    this._onDidChangeTreeData.fire(undefined);
  }

  public async expandAll(): Promise<void> {
    this._logMessage('+CLICK+  (DBG) ObjDep: expandAll()');
    this.treeState = eTreeState.TS_ExpandAll;
    this._publishTreeState();
    this.refresh(CALLED_INTERNALLY);
  }

  public collapseAll(): void {
    this._logMessage('+CLICK+  (DBG) ObjDep: collapseAll()');
    this.treeState = eTreeState.TS_ExpandTop;
    this._publishTreeState();
    this.refresh(CALLED_INTERNALLY);
  }

  private _publishTreeState() {
    const currentState: boolean = this.treeState == eTreeState.TS_ExpandTop ? true : false;
    this._logMessage(`* ObjDep: treeState .objectDeps.showingTopOnly=(${currentState})`);
    vscode.commands.executeCommand('setContext', 'spinExtension.objectDeps.showingTopOnly', currentState);
  }

  private _publishViewEnableState(desiredEnableState: boolean) {
    this._logMessage(`* ObjDep: treeView .objectDeps.enabled=(${desiredEnableState})`);
    // record new published state
    this.viewEnabledState = desiredEnableState;
    // and publish new state
    vscode.commands.executeCommand('setContext', 'spinExtension.objectDeps.enabled', desiredEnableState);
  }

  public getTreeItem(element: Dependency): vscode.TreeItem {
    /**
     * Get {@link TreeItem} representation of the `element`
     *
     * @param element The element for which {@link TreeItem} representation is asked for.
     * @returns TreeItem representation of the element.
     */
    this._logMessage(`+==+ (DBG) ObjDep: getTreeItem(${element.label}) [${this.collapseStateString(element.collapsibleState)}]`);
    // set our collapse expand value here?
    let desiredElement: Dependency = element;
    if (element.label !== undefined) {
      let desiredState = ELEM_EXPANDED;
      if (element.depth > 0) {
        desiredState = this.treeState == eTreeState.TS_ExpandTop ? ELEM_COLLAPSED : ELEM_EXPANDED;
      }
      if (element.collapsibleState != desiredState) {
        desiredElement = new Dependency(element.label, element.objName, desiredState, element.depth);
        this._logMessage(
          `+ (DBG) ObjDep: getTreeItem(${desiredElement.label}) [${this.collapseStateString(
            element.collapsibleState
          )}] -> [${this.collapseStateString(desiredElement.collapsibleState)}]`
        );
      } else {
        this._logMessage(`+ (DBG) ObjDep: getTreeItem(${desiredElement.label}) [${this.collapseStateString(desiredElement.collapsibleState)}]`);
      }
    }
    return desiredElement;
  }

  private collapseStateString(collapseMode: vscode.TreeItemCollapsibleState): string {
    let desiredString: string = '';
    switch (collapseMode) {
      case ELEM_COLLAPSED:
        desiredString = 'CS_COLLAPSED';
        break;

      case ELEM_EXPANDED:
        desiredString = 'CS_EXPANDED';
        break;

      case ELEM_NONE:
        desiredString = 'CS_NONE';
        break;

      default:
        desiredString = '?unk?';
        break;
    }
    return desiredString;
  }

  public getDependencies(childSpinDep?: SpinDependency): SpinDependency[] {
    /**
     * Get the top-file w/children or specified-file w/children
     */
    const topArg: string = childSpinDep !== undefined ? childSpinDep?.name : '';
    this._logMessage(`++++ (DBG) ObjDep: getDeps(${topArg})`);
    if (!this.rootPath) {
      this._logMessage(`++++ ERROR: ObjDep: Unable to locate objects without rootPath`);
      return [];
    }
    const subDeps: SpinDependency[] = [];
    if (childSpinDep !== undefined) {
      // CASE we have CHILD: get grandchildren
      this._logMessage(`+ (DBG) ObjDep: getDeps() childSpinDep=[${childSpinDep?.name}]`);
      // get for underlying file
      const childFileBasename = this._filenameWithSpinFileType(childSpinDep.name);
      const childFileSpec = path.join(this.rootPath, childFileBasename);
      if (!this._fileExists(childFileSpec)) {
        // CASE: file is missing for child
        this._logMessage(`+ (DBG) ObjDep: getDeps() element=[${childFileBasename}] has (???) deps - MISSING FILE`);
        childSpinDep.setFileMissing();
      } else {
        // CASE: get child deps
        const spinDeps: SpinObject[] = this._getDepsFromSpinFile(childFileSpec);
        this._logMessage(`+ (DBG) ObjDep: getDeps() element=[${childFileBasename}] has (${spinDeps.length}) deps`);
        let spinChildNbr: number = 0;
        spinDeps.forEach((dependency) => {
          const depFileSpec = path.join(this.rootPath!, dependency.fileName);
          const childFileExists: boolean = this._fileExists(depFileSpec);
          const childDep = new SpinDependency(depFileSpec, dependency, `${childSpinDep.id}${spinChildNbr}`);
          if (!childFileExists) {
            childDep.setFileMissing();
          }
          subDeps.push(childDep);
          spinChildNbr++;
        });
      }
      subDeps.push(childSpinDep);
    } else {
      this._logMessage(`+ (DBG) ObjDep: getDeps() [topLevel]`);
      // get for project top level file
      let childDeps: SpinObject[] = [];
      let filename: string = path.basename(this.topLevelFSpec);
      if (this.isDocument) {
        const textEditor = vscode.window.activeTextEditor;
        if (textEditor) {
          childDeps = this._getDepsFromDocument(textEditor.document);
          filename = path.basename(textEditor.document.fileName);
        }
      } else {
        childDeps = this._getDepsFromSpinFile(this.topLevelFSpec);
      }
      const topSpin = new SpinObject(filename, '(top-file)');
      const topSpinDep = new SpinDependency(this.topLevelFSpec, topSpin, '0');
      this._logMessage(`+ (DBG) ObjDep: getDeps() topLevel has (${childDeps.length}) children`);
      for (let index = 0; index < childDeps.length; index++) {
        const childSpinDep = childDeps[index];
        const newDep = new SpinDependency(this.topLevelFSpec, childSpinDep, `${topSpinDep.id}${index}`);
        topSpinDep.addChild(newDep);
      }
      subDeps.push(topSpinDep);
    }
    this._dumpDeps(subDeps);
    return subDeps;
  }

  private _dumpDeps(deps: SpinDependency[]) {
    const itemNbr: number = 1;
    for (let index = 0; index < deps.length; index++) {
      const spinDep = deps[index];
      this._logMessage(
        `+ dumpDeps() #${itemNbr} id=[${spinDep.id}], name=[${spinDep.name}], known=[${spinDep.knownAs}], nbrChildren=(${spinDep.children.length}), depth=(${spinDep.depth})`
      );
      for (let index = 0; index < spinDep.children.length; index++) {
        const childDep = spinDep.children[index];
        this._logMessage(
          `+ dumpDeps() --- child #${index} id=[${childDep.id}], name=[${childDep.name}], known=[${childDep.knownAs}], depth=(${childDep.depth})`
        );
      }
    }
  }

  /*
  public async getParentOLD2(element: Promise<Dependency> | Dependency): Promise<Dependency | undefined> {
    const resolvedElement = element instanceof Promise ? await element : element;
    let topArg: string = resolvedElement !== undefined ? resolvedElement.label.toString() : '';
    if (topArg === undefined) {
      topArg = '{element.label=undefined!}';
    }
    this._dumpElement('getParent()', resolvedElement);
    const parentRslt: string =
      resolvedElement !== undefined && resolvedElement.parentDep !== undefined ? resolvedElement.parentDep.label.toString() : '<root>';
    // given child, locate and return the parent
    this._logMessage(`+==+ (DBG) ObjDep: getParent(${topArg}) -> [${parentRslt}]`);
    let desiredParent: Dependency | undefined = undefined;
    if (resolvedElement !== undefined) {
      desiredParent = resolvedElement.parentDep;
    }
    return desiredParent;
  }

  public getParentOLD3(element: Dependency): Dependency | undefined {
    let topArg: string = element !== undefined ? element.label.toString() : '';
    if (topArg === undefined) {
      topArg = '{element.label=undefined!}';
    }
    this._dumpElement('getParent()', element);
    const parentRslt: string = element !== undefined && element.parentDep !== undefined ? element.parentDep.label.toString() : '<root>';
    // given child, locate and return the parent
    this._logMessage(`+==+ (DBG) ObjDep: getParent(${topArg}) -> [${parentRslt}]`);
    let desiredParent: Dependency | undefined = undefined;
    if (element !== undefined) {
      desiredParent = element.parentDep;
    }
    return desiredParent;
  }

  public getParentOLD(element: Dependency): vscode.ProviderResult<Dependency> {
    **
     * Optional method to return the parent of `element`.
     * Return `null` or `undefined` if `element` is a child of root.
     *
     * **NOTE:** This method should be implemented in order to access {@link TreeView.reveal reveal} API.
     *
     * @param element The element for which the parent has to be returned.
     * @return Parent of `element`.
     *
    if (element instanceof Promise) {
      this._logMessage(`+==+ (DBG) ObjDep: getParent() called with Promise!!`);
      element.then((value) => {
        element = value; // Unwrap the promise
      });
    }
    let topArg: string = element !== undefined ? element.label.toString() : '';
    if (topArg === undefined) {
      topArg = '{element.label=undefined!}';
    }
    this._dumpElement('getParent()', element);
    const parentRslt: string = element !== undefined && element.parentDep !== undefined ? element.parentDep.label.toString() : '<root>';
    // given child, locate and return the parent
    this._logMessage(`+==+ (DBG) ObjDep: getParent(${topArg}) -> [${parentRslt}]`);
    let desiredParent: Dependency | undefined = undefined;
    if (element !== undefined) {
      desiredParent = element.parentDep;
    }
    return Promise.resolve(desiredParent);
  }
*/

  public getChildren(element?: Dependency): vscode.ProviderResult<Dependency[]> {
    /**
     * Get the children of `element` or root if no element is passed.
     *
     * @param element The element from which the provider gets children. Can be `undefined`.
     * @return Children of `element` or root if no element is passed.
     */
    const topArg: string = element !== undefined ? element?.label.toString() : '';
    this._logMessage(`+==+ (DBG) ObjDep: getChildren(${topArg})`);
    this._dumpElement('getChildren()', element);
    if (!this.rootPath) {
      vscode.window.showInformationMessage('No dependency in empty workspace');
      const noDep = new Dependency('No object references in empty workspace', '', ELEM_NONE, -1);
      noDep.removeIcon(); // this is message, don't show icon
      return Promise.resolve([noDep]);
    }
    let elementDepth: number = topArg.length > 0 ? element.depth : 0;
    const subDeps: Dependency[] = [];
    const subRawDeps: SpinDependency[] = [];
    if (element !== undefined) {
      // CASE we have CHILD: get grandchildren
      this._logMessage(`+ (DBG) ObjDep: getChildren() element=[${element?.label}]`);
      // get for underlying file
      const childFileBasename = this._filenameWithSpinFileType(element.label.toString());
      const childFileSpec = path.join(this.rootPath, childFileBasename);
      let nbrGrandChildren: number = 0;
      if (!this._fileExists(childFileSpec)) {
        // CASE: file is missing for child
        this._logMessage(`+ (DBG) ObjDep: getChildren() element=[${childFileBasename}] has (???) deps - MISSING FILE`);
        const topState: vscode.TreeItemCollapsibleState = this._elementCollapseState(elementDepth, false, nbrGrandChildren);
        const subDep = new Dependency(element.label, element.descriptionString, topState, -1);
        subDep.setFileMissing();
        subDeps.push(subDep);
        subRawDeps.push(this._spinDepFromDep(subDep));
      } else {
        // CASE: show child
        const spinDeps = this._getDepsFromSpinFile(childFileSpec);
        nbrGrandChildren = spinDeps.length;
        this._logMessage(`+ (DBG) ObjDep: getChildren() element=[${childFileBasename}] has (${spinDeps.length}) deps`);
        elementDepth++;
        spinDeps.forEach((dependency) => {
          const depFileSpec = path.join(this.rootPath!, dependency.fileName);
          // huh, is this if really needed?
          let nbrGreatGrandChildren: number = 0;
          const childFileExists: boolean = this._fileExists(depFileSpec);
          if (childFileExists) {
            // CASE: show child
            const subSpinDeps = this._getDepsFromSpinFile(depFileSpec);
            nbrGreatGrandChildren = subSpinDeps.length;
          }
          const topState: vscode.TreeItemCollapsibleState = this._elementCollapseState(elementDepth, childFileExists, nbrGreatGrandChildren);
          const subDep = new Dependency(dependency.fileName, dependency.knownAs, topState, 1, element);
          if (!childFileExists) {
            subDep.setFileMissing();
          }
          subDeps.push(subDep);
          subRawDeps.push(this._spinDepFromDep(subDep));
        });
      }
    } else {
      this._logMessage(`+ (DBG) ObjDep: getChildren() [topLevel]`);
      // get for project top level file
      let spinDeps = [];
      elementDepth = 0;
      if (this.isDocument) {
        const textEditor = vscode.window.activeTextEditor;
        if (textEditor) {
          spinDeps = this._getDepsFromDocument(textEditor.document);
        }
      } else {
        spinDeps = this._getDepsFromSpinFile(this.topLevelFSpec);
      }
      this._logMessage(`+ (DBG) ObjDep: getChildren() topLevel has (${spinDeps.length}) deps`);
      if (spinDeps.length > 0) {
        const topState: vscode.TreeItemCollapsibleState = this._elementCollapseState(elementDepth, true, spinDeps.length);
        const topDep = new Dependency(this.topLevelFName, '(top-file)', topState, 0);
        subDeps.push(topDep);
        for (let index = 0; index < subDeps.length; index++) {
          const subdep: Dependency = subDeps[index];
          subRawDeps.push(this._spinDepFromDep(subdep));
        }
      } else {
        //vscode.window.showInformationMessage("Workspace has no package.json");
        const emptyMessage: string = `No object references found in ${this.topLevelFName}`;
        const emptyDep = new Dependency(emptyMessage, '', vscode.TreeItemCollapsibleState.None, -1);
        emptyDep.removeIcon(); // this is message, don't show icon
        subDeps.push(emptyDep);
      }
    }
    return Promise.resolve(subDeps);
  }

  private async _showDocument(fileFSpec: string) {
    this._logMessage(`+ (DBG) ObjDep: _showDocument() [${fileFSpec}]`);
    const textDocument = await vscode.workspace.openTextDocument(fileFSpec);
    await vscode.window.showTextDocument(textDocument, { preview: false });
  }

  private _elementCollapseState(depth: number, fileExists: boolean, nbrChildren: number): vscode.TreeItemCollapsibleState {
    let desiredState: vscode.TreeItemCollapsibleState = ELEM_NONE;
    if (fileExists && nbrChildren > 0) {
      if (depth == 0) {
        desiredState = ELEM_EXPANDED;
      } else {
        desiredState = this.treeState == eTreeState.TS_ExpandTop ? ELEM_COLLAPSED : ELEM_EXPANDED;
      }
    }
    return desiredState;
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
    this._logMessage(`* (DBG) ObjDep: activeEditorChanged()`);
    let newViewEnabledState: boolean = false;
    const initialViewEnabledState: boolean = this.viewEnabledState;
    if (vscode.window.activeTextEditor) {
      if (!this.bFixHierToTopLevel) {
        const fileFSpec: string = this._getActiveSpinFile();
        const isEnabled: boolean = isSpinFile(fileFSpec) ? true : false; // matches .spin and .spin2
        newViewEnabledState = isEnabled;
        //this._publishViewEnableState(newViewEnabledState);
        if (isEnabled) {
          // set new file top
          this.topLevelFSpec = fileFSpec;
          this.topLevelFName = path.basename(this.topLevelFSpec);
          this.rootPath = path.dirname(this.topLevelFSpec);
          this._logMessage(`+ (DBG) ObjDep: activeEditorChanged() topLevelFSpec=[${this.topLevelFSpec}]`);
        }
      } else {
        // we have topLevel for this workspace, stay enabled
        newViewEnabledState = true;
        //this._publishViewEnableState(newViewEnabledState);
      }
    } else {
      //this._publishViewEnableState(newViewEnabledState);
    }
    const stateChanged: boolean = initialViewEnabledState != newViewEnabledState;
    if (stateChanged) {
      // only publish on change
      this._publishViewEnableState(newViewEnabledState);
      if (newViewEnabledState == true) {
        // if enabled after change, refresh view
        this.refresh(CALLED_INTERNALLY);
      }
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
    this._logMessage(`+ (DBG) ObjDep: _getDepsFromDocument(${path.basename(activeEditDocument.fileName)})`);
    let currState: eParseState = eParseState.inCon; // compiler defaults to CON at start!
    let priorState: eParseState = currState;
    const deps = [];
    for (let i = 0; i < activeEditDocument.lineCount; i++) {
      const line = activeEditDocument.lineAt(i);
      const trimmedLine: string = line.text !== undefined ? line.text.replace(/\s+$/, '') : '';
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
          //this._logMessage(`+ (DBG) ObjDep: _getDepsFromSpinFile() basename=[${spinObj.baseName}] known as (${spinObj.knownAs})`);
          deps.push(spinObj);
        } else {
          this._logMessage(`+ (DBG) ObjDep: _getDepsFromDocument() BAD parse of OBJ line [${trimmedLine}]`);
        }
      }
    }
    this._logMessage(`+ (DBG) ObjDep:   -- returns ${deps.length} dep(s)`);
    return deps;
  }

  private _getDepsFromSpinFile(fileSpec: string): SpinObject[] {
    const deps = [];
    //this._logMessage(`+ (DBG) ObjDep: _getDepsFromSpinFile(${fileSpec})`);
    if (this._fileExists(fileSpec)) {
      const spinFileContent = this._loadFileAsString(fileSpec); // handles utf8/utf-16
      let lines = spinFileContent.split('\r\n');
      if (lines.length == 1) {
        // file not CRLF is LF only!
        lines = spinFileContent.split('\n');
      }
      this._logMessage(`+ (DBG) ObjDep: getDeps ${path.basename(fileSpec)} has (${lines.length}) lines`);

      let currState: eParseState = eParseState.inCon; // compiler defaults to CON at start!
      let priorState: eParseState = currState;
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        const trimmedLine = text !== undefined ? text.replace(/\s+$/, '') : '';
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
            //this._logMessage(`+ (DBG) ObjDep: _getDepsFromSpinFile() basename=[${spinObj.baseName}] known as (${spinObj.knownAs})`);
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
    //this._logMessage(`+ (DBG) ObjDep: _spinDepFromObjectLine() lineParts=[${lineParts}](${lineParts.length}) line=[${objLine}]`);
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

  private _spinDepFromDep(dep: Dependency): SpinDependency {
    //this._logMessage(`* _spinDepFromDep() label=[${dep.label}]`);
    this._logMessage(`* _spinDepFromDep() filename=[${dep.filename}]`);
    const spinObj = new SpinObject(dep.filename, '??WHY??');
    const newRawDep: SpinDependency = new SpinDependency(dep.filename, spinObj, '???');
    return newRawDep;
  }

  private async _dumpElement(callerID: string, element?: Dependency) {
    let dumpElement = element;
    if (element instanceof Promise) {
      this._logMessage(`+ (DBG) ObjDep: _dumpElement() called with Promise!!`);
      dumpElement = await element; // Unwrap the promise
    }
    this._logMessage(
      `* ${callerID} DUMP LBL=[${dumpElement.label}], OBJ=[${dumpElement.objName}], [${this.collapseStateString(
        dumpElement.collapsibleState
      )}], depth=(${dumpElement.depth})`
    );
  }
}

// class ProviderResult: Dependency | undefined | null | Thenable<Dependency | undefined | null>
class SpinObject {
  public readonly fileName: string = '';
  public readonly knownAs: string = '';

  constructor(fileBaseName: string, objInstanceName: string) {
    this.fileName = fileBaseName;
    this.knownAs = objInstanceName;
  }
}

export class SpinDependency {
  private _id: string = '';
  private _basename: string = '';
  private _fileSpec: string = '';
  private _fileName: string = '';
  private _spinFile: SpinObject;
  private _children: SpinDependency[] = [];
  private _isFileMissing: boolean = false;

  constructor(fileSpec: string, spinFile: SpinObject, id: string) {
    this._id = id;
    this._spinFile = spinFile;
    this._fileSpec = spinFile.fileName;
    this._fileName = path.basename(this._fileSpec);
    this._basename = this._fileName.replace('.spin2', '');
  }

  public addChild(child: SpinDependency) {
    this._children.push(child);
  }

  get id(): string {
    return this._id;
  }

  get knownAs(): string {
    return this._spinFile.knownAs;
  }

  get depth(): number {
    return this._id.length - 1;
  }

  get hasChildren(): boolean {
    return this._children.length > 0 ? true : false;
  }

  get children(): SpinDependency[] {
    return this._children;
  }
  get name(): string {
    return this._fileSpec;
  }

  get isFileMissing(): boolean {
    // return file-missing state
    return this._isFileMissing;
  }

  public setFileMissing() {
    // record file-missing state
    this._isFileMissing = true;
  }
}

export class Dependency extends vscode.TreeItem {
  // TreeItem notes: id:string, label, resourceUri, tooltip, iconPath, description, contextValue, command, collapsibleState, accessibilityInformation
  // Treeitem  constructor(label, ?collapsibleState) OR constructor(resourceUri, ?collapsibleState)
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("file-code", "#FF8000");
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-field");  // hrmf... blue
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-enum"); // nice, orange!
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-structure"); // hrmf, no color (white)
  private icon: vscode.ThemeIcon = new vscode.ThemeIcon('symbol-class'); // nice, orange!
  private _basename: string = '';
  private _filename: string = '';
  private _depth: number = 0;
  private _objName: string;
  private fileMissing: boolean = false;
  private _parent: Dependency | undefined = undefined;
  private _instanceId: string = '';
  public readonly descriptionString: string = '';
  // map our fields to underlying TreeItem
  constructor(
    label: string | vscode.TreeItemLabel,
    objName: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    depth: number,
    parent: Dependency | undefined = undefined
  ) {
    // element label is  filebasename
    // element description is  object name in containing file
    // element tooltip is filename (object name)
    // element depth is nesting level where 0 means top
    super(label, collapsibleState);
    this._objName = objName;
    this.description = objName;
    this._parent = parent;
    this._depth = depth;
    this.descriptionString = objName;
    this._filename = label.toString(); // save 'given' name
    this._basename = label.toString(); // save 'given' name
    if (label !== undefined) {
      this._basename = label.toString().replace('.spin2', '');
      this._basename = this._basename.replace('.spin', '');
    }
    if (objName.includes('top-file')) {
      this.tooltip = `This is the project top-most file`;
    } else {
      this.tooltip = `An instance of ${this._basename} known as ${this._objName}`;
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
    // record file-missing state
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
