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
  private fixedTopLevelFSpec: string = '';
  private treeState: eTreeState = eTreeState.TS_ExpandAll; // eTreeState.TS_ExpandTop; // tracks current state of treeView
  private viewEnabledState: boolean = false;
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private debugOutputChannel: vscode.OutputChannel | undefined = undefined;
  private isEmptying: boolean = false;
  private spinCodeUtils: SpinCodeUtils = new SpinCodeUtils();
  private latestHierarchy: Map<string, SpinDependency> = new Map(); // children by filename
  private existingIDs: string[] = [];

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

    // cause our initial status to be exposed

    if (this.topLevelFSpec.length > 0) {
      this._logMessage(`+ (DBG) ObjDep: constructor() done, firing editorChanged...`);
      this.activeEditorChanged(CALLED_INTERNALLY);
      this._preloadFullSpinDependencies();
    } else {
      this._logMessage(`+ (DBG) ObjDep: constructor() done, NO TOP/curr, NO activeFile`);
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
      if (!this._fileExists(tmpTopLevelFSpec)) {
        this._logMessage(`+ (DBG) ObjDep: FILE NOT FOUND! [${tmpTopLevelFSpec}]!`);
        this.bFixHierToTopLevel = false;
      } else {
        topFileChanged = this.fixedTopLevelFSpec != tmpTopLevelFSpec || this.bFixHierToTopLevel == false;
        this.bFixHierToTopLevel = true;
        this.fixedTopLevelFSpec = tmpTopLevelFSpec;
      }
    }
    return topFileChanged;
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
    /**
     * Get {@link TreeItem} representation of the `element`
     *
     * @param element The element for which {@link TreeItem} representation is asked for.
     * @returns TreeItem representation of the element.
     */
    this._logMessage(`+==+ (DBG) ObjDep: getTreeItem(${element.label}[${element.id}]) [${this._collapseStateString(element.collapsibleState)}]`);
    // set our collapse expand value here?
    const desiredElement: Dependency = element;
    return desiredElement;
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
    const topId: string = element !== undefined ? `[${element?.id}]` : '';
    const topArg: string = element !== undefined ? `${element?.label.toString()}${topId}` : '';
    this._logMessage(`+==+ (DBG) ObjDep: getChildrn(${topArg}) isEmptying=(${this.isEmptying})`);
    if (element !== undefined) {
      this._dumpElement('getChildrn()', element);
    }

    const subDeps: Dependency[] = [];
    if (this.isEmptying) {
      // CASE we are letting the OBJ TREE remove all content...
      //   so we return nothing but clear flag telling us to do this
      // NOT NEEDED vscode.window.showInformationMessage('Rebuilding object hierarchy tree');
      const rebuildingDep = new Dependency('...', '', ELEM_NONE, -1, 'xyzzy');
      rebuildingDep.removeIcon(); // this is message, don't show icon
      subDeps.push(rebuildingDep);
      this.isEmptying = false; // we've done this once...
    } else if (!this.rootPath) {
      // CASE we dont know where folder containing .spin2 files is yet!
      vscode.window.showInformationMessage('No object references in empty workspace');
      const noDep = new Dependency('No object references in empty workspace', '', ELEM_NONE, -1, 'x');
      noDep.removeIcon(); // this is message, don't show icon
      subDeps.push(noDep);
    } else if (element !== undefined) {
      // CASE we have CHILD: get grandchildren
      //this._logMessage(`+ (DBG) ObjDep: getChildrn() element=[${element?.label}]`);
      // get for underlying file
      const childFileBasename = this._filenameWithSpinFileType(element.label.toString());
      //const childFileSpec = path.join(this.rootPath, childFileBasename);
      const childFileStructure: SpinDependency = this._getDepsFromHierarchy(element.label.toString());
      if (childFileStructure.isFileMissing) {
        // CASE: file is missing for child
        this._logMessage(`+ (DBG) ObjDep: getChildrn() element=[${childFileBasename}] has (???) deps - MISSING FILE`);
        const subDep = new Dependency(element.label, element.descriptionString, ELEM_NONE, -1, `${childFileStructure.id}z`);
        subDep.setFileMissing();
        subDeps.push(subDep);
      } else {
        // CASE: have child, return deps for this child
        this._logMessage(`+ (DBG) ObjDep: getChildrn() element=[${childFileBasename}] has (${childFileStructure.childCount}) deps`);
        const haveOrigChild: boolean = this._isFirstDefnOfFile(childFileStructure.name, element.id);
        if (haveOrigChild) {
          // CASE: ORIGINAL CHILD use discovered state
          for (let index = 0; index < childFileStructure.childCount; index++) {
            // turn each child into real information with temp overrides
            const childsChild: SpinDependency = childFileStructure.children[index];
            const childsChildState: vscode.TreeItemCollapsibleState = this._elementCollapseState(
              childsChild.depth,
              !childsChild.isFileMissing,
              this._actualChildCount(childsChild.name)
            );
            const subDep = new Dependency(childsChild.name, childsChild.knownAs, childsChildState, childsChild.depth, childsChild.id);
            if (childsChild.isFileMissing) {
              subDep.setFileMissing();
            }
            subDeps.push(subDep);
          }
        } else {
          // CASE: NOT-ORIGINAL CHILD use computed state (replacement IDs, depth, but live children count)
          const childsChildFileStructure: SpinDependency = this._getTempDepsFromHierarchy(element.id, childFileStructure);
          for (let index = 0; index < childsChildFileStructure.childCount; index++) {
            // turn each child into real information with temp overrides
            const childsChild: SpinDependency = childsChildFileStructure.children[index];
            const childsChildState: vscode.TreeItemCollapsibleState = this._elementCollapseState(
              childsChild.depth,
              !childsChild.isFileMissing,
              childsChild.childCount
            );
            const subDep = new Dependency(childsChild.name, childsChild.knownAs, childsChildState, childsChild.depth, childsChild.id);
            if (childsChild.isFileMissing) {
              subDep.setFileMissing();
            }
            subDeps.push(subDep);
          }
        }
      }
    } else {
      this._logMessage(`+ (DBG) ObjDep: getChildrn() [topLevel]`);
      // get for project top level file
      const topFileStructure: SpinDependency = this._getDepsFromHierarchy();
      this._logMessage(`+ (DBG) ObjDep: getChildrn() topLevel has (${topFileStructure.childCount}) deps`);
      if (topFileStructure.childCount > 0) {
        const topState: vscode.TreeItemCollapsibleState = this._elementCollapseState(0, true, topFileStructure.childCount);
        const topDep = new Dependency(this.topLevelFName, '(top-file)', topState, topFileStructure.depth, topFileStructure.id);
        subDeps.push(topDep);
      } else {
        //vscode.window.showInformationMessage("Workspace has no package.json");
        const emptyMessage: string = `No object references found in ${this.topLevelFName}`;
        const emptyDep = new Dependency(emptyMessage, '', ELEM_NONE, -1, 'y');
        emptyDep.removeIcon(); // this is message, don't show icon
        subDeps.push(emptyDep);
      }
    }
    this._dumpSubDeps(' --> ', subDeps);
    return Promise.resolve(subDeps);
  }

  private _isFirstDefnOfFile(childName: string, childId: string): boolean {
    const childFileStructure: SpinDependency = this._getDepsFromHierarchy(childName);
    const desiredMatchState: boolean = childFileStructure.id === childId;
    this._logMessage(`* _isFirstDefnOfFile([${childName}], [${childId}]) [${childFileStructure.id}] -> (${desiredMatchState})`);
    return desiredMatchState;
  }

  private _getTempDepsFromHierarchy(newTopId: string, actualDep: SpinDependency): SpinDependency {
    // Create a modified copy without affecting original DATA!!
    this._logMessage(`* TMP redo name=[${actualDep.name}], id=[${actualDep.id}], childCt=(${actualDep.childCount})`);
    this._dumpSpinDeps('   ', [actualDep]);
    const desiredFileStructure: SpinDependency = new SpinDependency('', undefined, '', this._getDepsFromHierarchy(actualDep.name));
    // the the structure... then re-ID, and force childCount of the children based on current parent
    desiredFileStructure.replaceId(newTopId);
    if (desiredFileStructure.hasChildren) {
      for (let index = 0; index < desiredFileStructure.childCount; index++) {
        const desiredChildDep = desiredFileStructure.children[index];
        const newId: string = `${newTopId}${index}`;
        const newChildCount: number = this._actualChildCount(desiredChildDep.name);
        this._logMessage(
          `   TMP redo  child[${desiredChildDep.name}] id:[${desiredChildDep.id}] -> [${newId}], count=(${desiredChildDep.childCount}) -> (${newChildCount})`
        );
        desiredChildDep.replaceId(newId);
        desiredChildDep.forceChildCount(newChildCount);
      }
    }
    return desiredFileStructure;
  }

  private _actualChildCount(filename: string): number {
    const desiredFileStructure: SpinDependency = this._getDepsFromHierarchy(filename);
    return desiredFileStructure.childCount;
  }

  private activeEditorChanged(internalUse: boolean = false): void {
    // if editor is currently a SPIN file and file is in hierarchy the refresh deps
    // if editor is not a SPIN file but topFile changed then refresh deps
    const invokeType: string = internalUse ? ' INTERNAL ' : ' TAB-change ';
    this._logMessage(`+==+ (DBG) ObjDep: activeEditorChanged(${invokeType})`);
    const initialViewEnabledState: boolean = this.viewEnabledState;
    const topChanged: boolean = this._loadConfigWithTopFileInfo(); // ensure we have latest in case it changed
    const haveActiveEditor: boolean = vscode.window.activeTextEditor !== undefined ? true : false;
    let editedFileNameChanged: boolean = false;
    let haveSpinFile: boolean = false;
    if (haveActiveEditor) {
      // determine if edited file changed
      const fileFSpec: string = this._getActiveSpinFile();
      const fileName: string = path.basename(fileFSpec);
      haveSpinFile = isSpinFile(fileFSpec) ? true : false; // matches .spin and .spin2
      editedFileNameChanged = haveSpinFile && fileFSpec != this.topLevelFSpec ? true : false;
      this._logMessage(`+ (DBG) ObjDep: aeChg() editFName=[${fileName}], nmChg=(${editedFileNameChanged}), haveSpinFile=(${haveSpinFile})`);
      if (editedFileNameChanged && !this.bFixHierToTopLevel) {
        this.topLevelFSpec = fileFSpec;
        this.topLevelFName = fileName;
        this.rootPath = path.dirname(this.topLevelFSpec);
      }
    }
    this._logMessage(`+ (DBG) ObjDep: aeChg() topFName=[${this.topLevelFName}], topChg=(${topChanged}), editedNameChg=(${editedFileNameChanged})`);
    const newViewEnabledState: boolean = haveSpinFile && (this.bFixHierToTopLevel || haveActiveEditor) ? true : false;
    const stateChanged: boolean = initialViewEnabledState != newViewEnabledState;
    this.viewEnabledState = newViewEnabledState;

    if (!this.bFixHierToTopLevel && !haveActiveEditor) {
      this._logMessage(`+ (DBG) ObjDep: aeChg() [NO-top, NO-editor]`);
      // CASE [00] NO top file, NO active editor
      //  nothing to do, DONE
    } else if (!this.bFixHierToTopLevel && haveActiveEditor) {
      this._logMessage(`+ (DBG) ObjDep: aeChg() [NO-top, YES-editor]`);
      // CASE [01] NO top file, YES active editor
      let reloadHierarchy: boolean = false;
      if (haveSpinFile) {
        if (editedFileNameChanged) {
          // reload full tree hierarchy
          reloadHierarchy = true;
        } else {
          // just a content change
          // if files' children changed then update file in curr tree
          if (this.latestHierarchy.has(this.topLevelFName)) {
            this._logMessage(`+ (DBG) ObjDep: aeChg() file is in tree!`);
            const currDep = this.latestHierarchy.get(this.topLevelFName);
            const needsReload: boolean = this._updateDependencies(currDep);
            if (needsReload) {
              // child changes were significant (dep removed or added) so...
              // reload full tree hierarchy
              reloadHierarchy = true;
            }
          }
        }
      }
      if (reloadHierarchy) {
        // child changes were significant (dep removed or added) so let's just rebuild the tree
        this._preloadFullSpinDependencies();
      }
      //  if edited file changed, rebuild tree
    } else if (this.bFixHierToTopLevel && !haveActiveEditor) {
      this._logMessage(`+ (DBG) ObjDep: aeChg() [YES-top, NO-editor]`);
      // CASE [10] YES topFile, NO active editor
      //  if top file changed, rebuild tree
      if (topChanged) {
        this._preloadFullSpinDependencies();
      }
    } else if (this.bFixHierToTopLevel && haveActiveEditor) {
      this._logMessage(`+ (DBG) ObjDep: aeChg() [YES-top, YES-editor]`);
      // CASE [11] YES top file, YES active editor
      //  if top file changed -OR- if edited file changed, rebuild tree
      if (topChanged) {
        this._preloadFullSpinDependencies();
      } else if (haveSpinFile && this.latestHierarchy.has(this.topLevelFName)) {
        this._logMessage(`+ (DBG) ObjDep: aeChg() file is in tree!`);
        //  else if only file changed the reload deps for file
        //  if file change was drammatic rebuild the file
        const currDep = this.latestHierarchy.get(this.topLevelFName);
        const needsReload: boolean = this._updateDependencies(currDep);
        if (needsReload) {
          // child changes were significant (dep removed or added) so...
          // reload full tree hierarchy
          this._preloadFullSpinDependencies();
        }
      }
    }
    if (stateChanged) {
      // only publish on change
      this._publishViewEnableState(this.viewEnabledState);
      if (this.viewEnabledState == true) {
        // if enabled after change, refresh view
        if (this.latestHierarchy.size == 0) {
          this._preloadFullSpinDependencies();
        }
        this.refresh(CALLED_INTERNALLY);
      } else {
        // is our view is not enabled, remove all hierarchy state
        this.clearHierarchy();
      }
    }
  }

  private _publishTreeState() {
    const currentState: boolean = this.treeState == eTreeState.TS_ExpandTop ? true : false;
    this._logMessage(`* ObjDep: treeState .objectDeps.showingTopOnly=(${currentState})`);
    // post information to out-side world via our CONTEXT
    vscode.commands.executeCommand('setContext', 'runtime.spin2.objectDeps.showingTopOnly', currentState);
  }

  private _publishViewEnableState(desiredEnableState: boolean) {
    this._logMessage(`* ObjDep: treeView .objectDeps.enabled=(${desiredEnableState})`);
    // record new published state
    // post information to out-side world via our CONTEXT
    vscode.commands.executeCommand('setContext', 'runtime.spin2.objectDeps.enabled', desiredEnableState);
  }

  private _collapseStateString(collapseMode: vscode.TreeItemCollapsibleState): string {
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

  //////////////////////////////////////////////////////////////////////////////////
  // build internal full project object hierarchy
  //
  private clearHierarchy() {
    // remove all present knowledge of spin object hierarchy
    this.latestHierarchy.clear();
    this.existingIDs = [];
  }

  private _preloadFullSpinDependencies() {
    // prescan all files starting from current  file in active editor if any, else scan topFile if given
    //  will do NOTHING if these conditions are not met
    this._logMessage(`* *** _preloadFullSpinDeps()`);
    if (this.viewEnabledState == true) {
      //
      // GET top level, schedule children for next pass
      //
      let nextDeps: SpinDependency[] = [];
      // ensure empty tree at start, clear ID cache
      this.clearHierarchy();
      // start reload from root
      const rootDep: SpinDependency = this._getDependencies();
      if (rootDep !== undefined) {
        this._addDependency(rootDep);
        for (let index = 0; index < rootDep.childCount; index++) {
          const childDep = rootDep.children[index];
          nextDeps.push(childDep);
        }
      } else {
        this._logMessage(`ERROR: _preloadFullSpinDeps() _getDeps({root}) returned NOTHING!`);
      }
      //
      // GET next level (existing children), schedule grand-children for next pass
      //  keep repeating until all children are processed
      //
      let nextDepsCopy: SpinDependency[] = [];
      do {
        nextDepsCopy = nextDeps;
        nextDeps = [];
        this._logMessage(`* *** _preloadFullSpinDeps() loading ${nextDepsCopy.length} children`);
        for (let index = 0; index < nextDepsCopy.length; index++) {
          const child = nextDepsCopy[index];
          const thisFileExplored: boolean = this.latestHierarchy.has(child.name) ? true : false;
          if (thisFileExplored) {
            child.setExplored();
          } else {
            const childDep: SpinDependency = this._getDependencies(child);
            if (childDep !== undefined) {
              this._addDependency(childDep);
              for (let index = 0; index < childDep.childCount; index++) {
                const grandChildDep = childDep.children[index];
                nextDeps.push(grandChildDep);
              }
            } else {
              this._logMessage(`ERROR: _preloadFullSpinDeps() _getDeps(${child.name}) returned NOTHING!`);
            }
          }
        }
      } while (nextDeps.length > 0);
    } else {
      this._logMessage(`ERROR: _preloadFullSpinDeps() viewEnabledState == FALSE returned NOTHING!`);
    }

    this._logMessage(`* *** _preloadFullSpinDeps() ended with ${this.latestHierarchy.size} files`);
    this._dumpTree();
  }

  private _addDependency(fileWithChildren: SpinDependency) {
    const filename: string = fileWithChildren.name;
    if (fileWithChildren.isExplored == true) {
      if (this.latestHierarchy.has(filename) == false) {
        this._logMessage(`**** _addDepends(${fileWithChildren.name})[${fileWithChildren.id}], ${fileWithChildren.childCount} file(s)`);
        this.latestHierarchy.set(filename, fileWithChildren);
      }
    }
  }

  private _updateDependencies(childSpinDep?: SpinDependency): boolean {
    const topArg: string = childSpinDep !== undefined ? childSpinDep?.name : '';
    let needTreeRebuiltStatus: boolean = false;
    if (childSpinDep) {
      //this._dumpSpinDeps('', [childSpinDep]);
      const newSpinDep: SpinDependency = this._getDependencies(childSpinDep, false);
      const needUpdate: boolean = childSpinDep.childCount != newSpinDep.childCount;
      if (!needUpdate) {
        // get list of orig child names
        const originalChildNames: string[] = childSpinDep.children.map((child) => child.name);
        // get list of orig child names
        const latestChildNames: string[] = newSpinDep.children.map((child) => child.name);

        const childrenMatch: boolean = originalChildNames.sort().join(',') === latestChildNames.sort().join(',');
        // if we have names added or removed then we need to update the list
        if (!childrenMatch) {
          this._logMessage(`    _updateDeps() MISMATCH orig=[${originalChildNames}](${originalChildNames.length})`);
          this._logMessage(`                         latest=[${latestChildNames}](${latestChildNames.length})`);
          // this could cause files to be removed from our list, instead let's just ask for the tree to be rebuilt
          needTreeRebuiltStatus = true;
        }
      }
    }
    this._logMessage(`**** _updateDeps(${topArg}) -> needRebuild=(${needTreeRebuiltStatus})`);
    return needTreeRebuiltStatus;
  }

  private _getDependencies(childSpinDep: SpinDependency = undefined, checkIDs: boolean = true): SpinDependency | undefined {
    /**
     * Get the top-file w/children or specified-file w/children
     * return this object and its dependencies
     */
    //const topArg: string = childSpinDep !== undefined ? childSpinDep?.name : '';
    //this._logMessage(`++++ (DBG) ObjDep: getDeps(${topArg})`);
    let objectAndDependency: SpinDependency = undefined;
    if (!this.rootPath) {
      this._logMessage(`!!!! ERROR: ObjDep: Unable to locate objects without rootPath`);
      return objectAndDependency;
    }
    if (childSpinDep !== undefined) {
      // CASE we have CHILD: get grandchildren
      childSpinDep.setExplored();
      //this._logMessage(`+ (DBG) ObjDep: getDeps() childSpinDep=[${childSpinDep?.name}] IS EXPLORED`);
      // get for underlying file
      this._logMessage(`  -- _getDeps(${childSpinDep.name}) childID=[${childSpinDep.id}]`);
      const childFileBasename = this._filenameWithSpinFileType(childSpinDep.name);
      const childFileSpec = path.join(this.rootPath, childFileBasename);
      if (!this._fileExists(childFileSpec)) {
        // CASE: file is missing for child
        //this._logMessage(`+ (DBG) ObjDep: getDeps() element=[${childFileBasename}] has (???) deps - MISSING FILE`);
        childSpinDep.setFileMissing();
      } else {
        // CASE: get child deps
        const grandChildDeps: SpinObject[] = this._getDepsFromSpinFile(childFileSpec);
        //this._logMessage(`+ (DBG) ObjDep: getDeps() element=[${childFileBasename}] has (${grandChildDeps.length}) deps`);
        let grandChildNbr: number = 0;
        for (let index = 0; index < grandChildDeps.length; index++) {
          const childsChild = grandChildDeps[index];
          const grandChildFileSpec = path.join(this.rootPath!, childsChild.fileName);
          const childDep = new SpinDependency(grandChildFileSpec, childsChild, `${childSpinDep.id}${grandChildNbr}`);
          if (checkIDs) {
            this._checkId(childDep);
          }
          childSpinDep.addChild(childDep);
          grandChildNbr++;
        }
      }
      objectAndDependency = childSpinDep;
    } else {
      //this._logMessage(`+ (DBG) ObjDep: getDeps() [topLevel]`);
      // get for project top level file
      this._logMessage(`  -- _getDeps() topLevelFName=[${this.topLevelFName}]`);
      const childDeps: SpinObject[] = this._getDepsFromSpinFile(this.topLevelFSpec);
      const topSpin = new SpinObject(this.topLevelFName, '(top-file)');
      const topSpinDep = new SpinDependency(this.topLevelFSpec, topSpin, '0');
      if (checkIDs) {
        this._checkId(topSpinDep);
      }
      topSpinDep.setExplored();
      //this._logMessage(`+ (DBG) ObjDep: getDeps() topLevel has (${childDeps.length}) children - IS EXPLORED`);
      for (let index = 0; index < childDeps.length; index++) {
        const childSpinDep = childDeps[index];
        const newChildDep = new SpinDependency(this.topLevelFSpec, childSpinDep, `${topSpinDep.id}${index}`);
        if (checkIDs) {
          this._checkId(newChildDep);
        }
        topSpinDep.addChild(newChildDep);
      }
      objectAndDependency = topSpinDep;
    }
    // pre-mark our results
    // if we have already explored any of these filenames then don't allow 2nd explore
    for (let index = 0; index < objectAndDependency.childCount; index++) {
      const childDep = objectAndDependency.children[index];
      const filename: string = childDep.name;
      if (this.latestHierarchy.has(filename)) {
        childDep.setExplored();
      }
    }

    //this._dumpSpinDeps('', [objectAndDependency]);
    return objectAndDependency;
  }

  private _checkId(newDep: SpinDependency) {
    if (this.existingIDs.includes(newDep.id)) {
      this._logMessage(`ERROR: DUPE id[${newDep.id}] exists in ${newDep.toString()}`);
    } else {
      this.existingIDs.push(newDep.id);
      //this._logMessage(`* USED id[${newDep.id}] in ${newDep.toString()}`);
    }
  }

  private _dumpTree() {
    let keyNumber: number = 1;
    this.latestHierarchy.forEach((value, key) => {
      this._logMessage(`+ dumpTree() #${keyNumber} key=[${key}]`);
      this._dumpSpinDeps('', [value], keyNumber);
      //console.log(`Key: ${key}, Value: ${value}`);
      keyNumber++;
    });
  }

  private _dumpSpinDeps(prefixStr: string, deps: SpinDependency[], keyNbr: number = -1) {
    const itemNbr: string = keyNbr == -1 ? '#1' : '            ';
    for (let index = 0; index < deps.length; index++) {
      const spinDep = deps[index];
      this._logMessage(
        `${prefixStr}+ dumpDeps() ${itemNbr} id=[${spinDep.id}], name=[${spinDep.name}], known=[${spinDep.knownAs}], nbrChildren=(${spinDep.childCount}), depth=(${spinDep.depth}), explored=(${spinDep.isExplored})`
      );
      for (let index = 0; index < spinDep.childCount; index++) {
        const childDep = spinDep.children[index];
        this._logMessage(
          `${prefixStr}+ dumpDeps() --- child #${index} id=[${childDep.id}], name=[${childDep.name}], known=[${childDep.knownAs}], depth=(${childDep.depth}), explored=(${childDep.isExplored})`
        );
      }
    }
  }

  private _dumpSubDeps(prefixStr: string, subDeps: Dependency[]) {
    for (let index = 0; index < subDeps.length; index++) {
      const dependency = subDeps[index];
      this._logMessage(`${prefixStr}* _dumpSubDeps() #${index} [${dependency.toString()}]`);
    }
  }

  private _getDepsFromHierarchy(filename?: string): SpinDependency | undefined {
    //const desiredName: string = filename ? filename : '[topLevel]';
    //this._logMessage(`+ (DBG) ObjDep: _getDepsFromHier(${desiredName})`);
    let desiredDeps: SpinDependency | undefined = undefined;
    const topName: string = filename ? filename : this.topLevelFName;
    if (this.latestHierarchy.has(topName)) {
      desiredDeps = this.latestHierarchy.get(topName);
    }
    //this._dumpSpinDeps('', [desiredDeps]);
    return desiredDeps;
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
        // non-root is always expanded or collapsed depending upon tree state
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

  private _getActiveSpinFile(): string {
    const textEditor = vscode.window.activeTextEditor;
    let foundFSpec: string = '';
    if (textEditor !== undefined) {
      if (textEditor.document.uri.scheme === 'file') {
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
      //this._logMessage(`+ (DBG) ObjDep: _getDepsFromDocument() eval trimmedLine=[${trimmedLine}]`);
      if (currState == eParseState.inObj && nonCommentLineRemainder.includes(':')) {
        const spinObj = this._spinDepFromObjectLine(nonCommentLineRemainder);
        if (spinObj) {
          //this._logMessage(`+ (DBG) ObjDep: _getDepsFromDocument() basename=[${spinObj.baseName}] known as (${spinObj.knownAs})`);
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
    //this._logMessage(`+ (DBG) ObjDep: _getDepsFmSpinFile(${fileSpec})`);
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
        // FIXME: add #include handling if FlexSpin mode enabled!
        const nonCommentLineRemainder: string = this.spinCodeUtils.getNonCommentLineRemainder(0, text);
        const sectionStatus = this.spinCodeUtils.isSectionStartLine(text);
        if (sectionStatus.isSectionStart) {
          priorState = currState;
          currState = sectionStatus.inProgressStatus;
        }
        //this._logMessage(`+ (DBG) ObjDep: _getDepsFmSpinFile() eval trimmedLine=[${trimmedLine}]`);
        if (currState == eParseState.inObj && nonCommentLineRemainder.includes(':')) {
          const spinObj = this._spinDepFromObjectLine(nonCommentLineRemainder);
          if (spinObj) {
            //this._logMessage(`+ (DBG) ObjDep: _getDepsFmSpinFile() basename=[${spinObj.baseName}] known as (${spinObj.knownAs})`);
            deps.push(spinObj);
          } else {
            this._logMessage(`+ (DBG) ObjDep: _getDepsFmSpinFile() BAD parse of OBJ line [${trimmedLine}]`);
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
    if (this.isDebugLogEnabled && this.debugOutputChannel !== undefined) {
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
    if (element !== undefined) {
      if (element instanceof Promise) {
        this._logMessage(`+ (DBG) ObjDep: _dumpElement() called with Promise!!`);
        dumpElement = await element; // Unwrap the promise
      }
      this._logMessage(
        `* ${callerID} DUMP LBL=[${dumpElement.label}], OBJ=[${dumpElement.objName}], [${this._collapseStateString(
          dumpElement.collapsibleState
        )}], depth=(${dumpElement.depth})`
      );
    } else {
      this._logMessage(`ERROR: _dumpElement(undefined) NOT supported!`);
    }
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
  private _overrideChildCount: number = -1;
  private _spinFile: SpinObject;
  private _children: SpinDependency[] = [];
  private _isFileMissing: boolean = false;
  private _isExplored: boolean = false;

  constructor(fileSpec: string, spinFile: SpinObject, id: string, copy?: SpinDependency) {
    if (copy !== undefined) {
      // do COPY construction instead of normal
      this._id = copy.id;
      this._spinFile = copy.spinFile();
      this._fileSpec = this._spinFile.fileName;
      this._fileName = path.basename(this._fileSpec);
      this._basename = this._fileName.replace('.spin2', '');
      // and deep copy the children !!
      if (copy.hasChildren) {
        for (let index = 0; index < copy.childCount; index++) {
          const copyChild = copy.children[index];
          this.children.push(new SpinDependency('', undefined, '', copyChild));
        }
      }
    } else {
      // do NORMAL construction
      this._id = id;
      this._spinFile = spinFile;
      this._fileSpec = spinFile.fileName;
      this._fileName = path.basename(this._fileSpec);
      this._basename = this._fileName.replace('.spin2', '');
    }
  }

  public addChild(child: SpinDependency) {
    this._children.push(child);
  }

  get id(): string {
    return this._id;
  }

  private spinFile(): SpinObject {
    return this._spinFile;
  }

  public replaceId(newId: string) {
    this._id = newId;
  }

  get knownAs(): string {
    return this._spinFile.knownAs;
  }

  get depth(): number {
    return this._id.length - 1;
  }

  get childCount(): number {
    let desiredCount = this._children.length;
    if (this._overrideChildCount != -1) {
      desiredCount = this._overrideChildCount;
    }
    return desiredCount;
  }

  get hasChildren(): boolean {
    return this.childCount > 0 ? true : false;
  }

  public forceChildCount(newCount: number) {
    this._overrideChildCount = newCount;
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

  get isExplored(): boolean {
    return this._isExplored;
  }

  public setExplored() {
    this._isExplored = true;
  }

  /*
  public replaceChildren(newChildren: SpinDependency[]) {
    this._children = newChildren;
  }
  */

  public toString(callerId: string = undefined): string {
    let descriptionString: string = '';
    const callerIdStr: string = callerId !== undefined ? `${callerId} ` : '';
    descriptionString = `${callerIdStr} ${this.id} ${this._fileName} [${this.knownAs}] ${this.childCount} chidren`;
    return descriptionString;
  }
}

export class Dependency extends vscode.TreeItem {
  // TreeItem notes: id:string, label, resourceUri, tooltip, iconPath, description, contextValue, command, collapsibleState, accessibilityInformation
  // Treeitem  constructor(label, ?collapsibleState) OR constructor(resourceUri, ?collapsibleState)
  //   NOTE:  in TreeView  'label' is bold white, 'description' is light-grey text
  //
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("file-code", "#FF8000");
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-field");  // hrmf... blue
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-enum"); // nice, orange!
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-color"); // hrmf, grey
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-enum-member"); // hrmf... blue
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-method"); // hrmf, purple!
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-variable"); // hrmf, blue!
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-constant"); // hrmf, grey
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-array"); // hrmf, grey
  //private icon: vscode.ThemeIcon = new vscode.ThemeIcon("symbol-structure"); // hrmf, no color (white)
  private icon: vscode.ThemeIcon = new vscode.ThemeIcon('symbol-class'); // nice, orange!
  private _basename: string = '';
  private _filename: string = '';
  private _depth: number = 0;
  private _objName: string;
  private fileMissing: boolean = false;
  private _parent: Dependency | undefined = undefined;
  public readonly descriptionString: string = '';
  // map our fields to underlying TreeItem
  constructor(
    label: string | vscode.TreeItemLabel,
    objName: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    depth: number,
    userId: string,
    parent: Dependency | undefined = undefined
  ) {
    // element label is  filebasename
    // element description is  object name in containing file
    // element tooltip is filename (object name)
    // element depth is nesting level where 0 means top
    super(label, collapsibleState);
    this._objName = objName;
    this.description = objName; //LIVE
    //this.description = `[${userId}] ${objName}`; // TESTING
    this._parent = parent;
    this._depth = depth;
    this.descriptionString = objName;
    this._filename = label.toString(); // save 'given' name
    this._basename = label.toString(); // save 'given' name
    this.id = userId;
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
    /*
    if (this.collapsibleState == ELEM_NONE) {
      this.icon = new vscode.ThemeIcon('symbol-enum');
    } else {
      this.icon = new vscode.ThemeIcon('symbol-class');
    }
	*/
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
    if (origText !== undefined) {
      this.description = `${origText} - MISSING FILE`;
    } else {
      this.description = `- MISSING FILE`;
    }
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
