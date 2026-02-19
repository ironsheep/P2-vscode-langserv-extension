'use strict';
// client/src/providers/spin.includeDirectories.treeView.ts
//
// Tree View provider for Spin2 Include Directories UI in the Explorer sidebar.
// Shows per-folder include directories (Tier 2) and central library directories (Tier 1).

import * as vscode from 'vscode';
import * as path from 'path';

// Types matching the workspace setting structure
interface ILocalIncludeEntry {
  auto: boolean;
  dirs: string[];
}
type LocalIncludesByFolder = { [folderPath: string]: ILocalIncludeEntry };

// Tree item types
type IncludeTreeItem = FolderNode | IncludeDirEntry | CentralLibsNode | LibraryDirEntry | ExcludedDirsNode | ExcludedDirEntry;

export class IncludeDirectoriesProvider implements vscode.TreeDataProvider<IncludeTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<IncludeTreeItem | undefined> = new vscode.EventEmitter<IncludeTreeItem | undefined>();
  readonly onDidChangeTreeData: vscode.Event<IncludeTreeItem | undefined> = this._onDidChangeTreeData.event;
  private isDebugLogEnabled: boolean = true; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private debugOutputChannel: vscode.OutputChannel | undefined = undefined;
  private _suppressConfigRefresh: boolean = false;

  constructor() {
    if (this.isDebugLogEnabled) {
      if (this.debugOutputChannel === undefined) {
        //Create output channel
        this.debugOutputChannel = vscode.window.createOutputChannel('Spin/Spin2 IncDirs DEBUG');
        this._logMessage('Spin/Spin2 IncDirs log started.');
      } else {
        this._logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }
    // Listen for config changes to refresh the tree
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (this._suppressConfigRefresh) {
        return;
      }
      if (
        e.affectsConfiguration('spin2.localIncludes') ||
        e.affectsConfiguration('spinExtension.library.includePaths') ||
        e.affectsConfiguration('spin2.excludeIncludeDirectories')
      ) {
        this._logMessage('onDidChangeConfiguration -> refresh');
        this.refresh();
      }
    });
  }

  refresh(): void {
    this._logMessage('refresh() called');
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Suppress config-change-driven refreshes while saving settings programmatically */
  suppressConfigRefresh(suppress: boolean): void {
    this._suppressConfigRefresh = suppress;
    this._logMessage(`suppressConfigRefresh(${suppress})`);
  }

  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled && this.debugOutputChannel !== undefined) {
      //Write to output window.
      this.debugOutputChannel.appendLine(message);
    }
  }

  getTreeItem(element: IncludeTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: IncludeTreeItem): IncludeTreeItem[] {
    try {
      if (!element) {
        // Root level: show folder nodes + central libs node
        return this._getRootItems();
      }

      if (element instanceof FolderNode) {
        return this._getFolderChildren(element);
      }

      if (element instanceof CentralLibsNode) {
        return this._getCentralLibChildren();
      }

      if (element instanceof ExcludedDirsNode) {
        return this._getExcludedDirChildren();
      }

      return [];
    } catch (e) {
      this._logMessage(`getChildren() ERROR: ${e}`);
      return [];
    }
  }

  private _getRootItems(): IncludeTreeItem[] {
    const items: IncludeTreeItem[] = [];

    // Get local includes from workspace settings
    const localIncludes = this._getLocalIncludes();
    const excludeDirs = this._getExcludeDirectories();

    // Sort folder paths for consistent display
    const folderPaths = Object.keys(localIncludes).sort();
    this._logMessage(`_getRootItems() ${folderPaths.length} folders, ${excludeDirs.length} excludes`);
    for (const folderPath of folderPaths) {
      const entry = localIncludes[folderPath];
      this._logMessage(`  folder=[${folderPath}] auto=${entry.auto} dirs=[${entry.dirs.join(', ')}]`);
      items.push(new FolderNode(folderPath, entry.auto, entry.dirs));
    }

    // Always show central libraries section
    items.push(new CentralLibsNode());

    // Always show excluded directories section
    items.push(new ExcludedDirsNode());
    this._logMessage(`  excludes=[${excludeDirs.join(', ')}]`);

    return items;
  }

  private _getFolderChildren(folder: FolderNode): IncludeDirEntry[] {
    return folder.dirs.map((dir, index) => new IncludeDirEntry(dir, folder.folderPath, index, folder.dirs.length));
  }

  private _getCentralLibChildren(): LibraryDirEntry[] {
    const centralPaths = this._getCentralLibraryPaths();
    return centralPaths.map((dir, index) => new LibraryDirEntry(dir, index, centralPaths.length));
  }

  private _getExcludedDirChildren(): ExcludedDirEntry[] {
    const excludedPaths = this._getExcludeDirectories();
    return excludedPaths.map((dir, index) => new ExcludedDirEntry(dir, index, excludedPaths.length));
  }

  private _getLocalIncludes(): LocalIncludesByFolder {
    // Deep copy to avoid mutating VS Code's frozen config proxy
    const raw = vscode.workspace.getConfiguration('spin2').get<LocalIncludesByFolder>('localIncludes') || {};
    return JSON.parse(JSON.stringify(raw));
  }

  private _getCentralLibraryPaths(): string[] {
    // Copy to avoid mutating VS Code's frozen config proxy
    return [...(vscode.workspace.getConfiguration('spinExtension.library').get<string[]>('includePaths') || [])];
  }

  private _getExcludeDirectories(): string[] {
    // Copy to avoid mutating VS Code's frozen config proxy
    return [...(vscode.workspace.getConfiguration('spin2').get<string[]>('excludeIncludeDirectories') || [])];
  }

  // ---- Commands ----

  async addLocalDir(folderNode: FolderNode): Promise<void> {
    const workspaceRoot = this._getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    const folderAbsPath = path.resolve(workspaceRoot, folderNode.folderPath);
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(folderAbsPath),
      openLabel: 'Add Include Directory'
    });

    if (result && result.length > 0) {
      const selectedDir = result[0].fsPath;
      let relDir = path.relative(folderAbsPath, selectedDir).replace(/\\/g, '/');
      if (!relDir.endsWith('/')) {
        relDir += '/';
      }

      const localIncludes = this._getLocalIncludes();
      const entry = localIncludes[folderNode.folderPath] || { auto: false, dirs: [] };
      entry.auto = false; // mark as customized
      if (!entry.dirs.includes(relDir)) {
        entry.dirs.push(relDir);
      }
      localIncludes[folderNode.folderPath] = entry;
      await this._saveLocalIncludes(localIncludes);
      this.refresh();
    }
  }

  async resetToAuto(folderNode: FolderNode): Promise<void> {
    const localIncludes = this._getLocalIncludes();
    if (localIncludes[folderNode.folderPath]) {
      localIncludes[folderNode.folderPath].auto = true;
      await this._saveLocalIncludes(localIncludes);
      // Trigger re-scan via command
      await vscode.commands.executeCommand('spinExtension.includeDirs.rescanAll');
    }
  }

  async addLibraryDir(): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Add Central Library Directory'
    });

    if (result && result.length > 0) {
      const selectedDir = result[0].fsPath;
      const centralPaths = this._getCentralLibraryPaths();
      if (!centralPaths.includes(selectedDir)) {
        centralPaths.push(selectedDir);
        await this._saveCentralLibraryPaths(centralPaths);
        this.refresh();
      }
    }
  }

  async removeEntry(entry: IncludeDirEntry | LibraryDirEntry): Promise<void> {
    if (entry instanceof IncludeDirEntry) {
      const localIncludes = this._getLocalIncludes();
      const folderEntry = localIncludes[entry.folderPath];
      if (folderEntry) {
        folderEntry.dirs.splice(entry.index, 1);
        folderEntry.auto = false;
        await this._saveLocalIncludes(localIncludes);
        this.refresh();
      }
    } else if (entry instanceof LibraryDirEntry) {
      const centralPaths = this._getCentralLibraryPaths();
      centralPaths.splice(entry.index, 1);
      await this._saveCentralLibraryPaths(centralPaths);
      this.refresh();
    }
  }

  async editEntry(entry: IncludeDirEntry | LibraryDirEntry): Promise<void> {
    const currentPath = entry instanceof IncludeDirEntry ? entry.dirPath : entry.libPath;
    const newPath = await vscode.window.showInputBox({
      prompt: 'Edit include directory path',
      value: currentPath
    });

    if (newPath !== undefined && newPath !== currentPath) {
      if (entry instanceof IncludeDirEntry) {
        const localIncludes = this._getLocalIncludes();
        const folderEntry = localIncludes[entry.folderPath];
        if (folderEntry) {
          folderEntry.dirs[entry.index] = newPath;
          folderEntry.auto = false;
          await this._saveLocalIncludes(localIncludes);
          this.refresh();
        }
      } else if (entry instanceof LibraryDirEntry) {
        const centralPaths = this._getCentralLibraryPaths();
        centralPaths[entry.index] = newPath;
        await this._saveCentralLibraryPaths(centralPaths);
        this.refresh();
      }
    }
  }

  async moveUp(entry: IncludeDirEntry | LibraryDirEntry): Promise<void> {
    if (entry instanceof IncludeDirEntry) {
      if (entry.index <= 0) return;
      const localIncludes = this._getLocalIncludes();
      const folderEntry = localIncludes[entry.folderPath];
      if (folderEntry) {
        const dirs = folderEntry.dirs;
        [dirs[entry.index - 1], dirs[entry.index]] = [dirs[entry.index], dirs[entry.index - 1]];
        folderEntry.auto = false;
        await this._saveLocalIncludes(localIncludes);
        this.refresh();
      }
    } else if (entry instanceof LibraryDirEntry) {
      if (entry.index <= 0) return;
      const centralPaths = this._getCentralLibraryPaths();
      [centralPaths[entry.index - 1], centralPaths[entry.index]] = [centralPaths[entry.index], centralPaths[entry.index - 1]];
      await this._saveCentralLibraryPaths(centralPaths);
      this.refresh();
    }
  }

  async moveDown(entry: IncludeDirEntry | LibraryDirEntry): Promise<void> {
    if (entry instanceof IncludeDirEntry) {
      if (entry.index >= entry.totalCount - 1) return;
      const localIncludes = this._getLocalIncludes();
      const folderEntry = localIncludes[entry.folderPath];
      if (folderEntry) {
        const dirs = folderEntry.dirs;
        [dirs[entry.index], dirs[entry.index + 1]] = [dirs[entry.index + 1], dirs[entry.index]];
        folderEntry.auto = false;
        await this._saveLocalIncludes(localIncludes);
        this.refresh();
      }
    } else if (entry instanceof LibraryDirEntry) {
      if (entry.index >= entry.totalCount - 1) return;
      const centralPaths = this._getCentralLibraryPaths();
      [centralPaths[entry.index], centralPaths[entry.index + 1]] = [centralPaths[entry.index + 1], centralPaths[entry.index]];
      await this._saveCentralLibraryPaths(centralPaths);
      this.refresh();
    }
  }

  // ---- Exclude directory commands ----

  async excludeFolder(folderNode: FolderNode): Promise<void> {
    this._logMessage(`excludeFolder() ENTRY`);

    // Extract folderPath - handle both direct FolderNode and VS Code proxy objects
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const folderPath: string | undefined = folderNode.folderPath ?? (folderNode as any)['folderPath'];
    this._logMessage(`excludeFolder() raw folderPath=[${folderPath}]`);

    if (!folderPath) {
      this._logMessage(`excludeFolder() ERROR: folderPath is undefined, aborting`);
      return;
    }

    // Use only the top-level directory name (first path component)
    // e.g. "reference/examples" -> "reference", "demo" -> "demo", "." -> "."
    let cleanPath = folderPath.replace(/\\/g, '/');
    if (cleanPath.endsWith('/')) {
      cleanPath = cleanPath.slice(0, -1);
    }
    const firstSlash = cleanPath.indexOf('/');
    if (firstSlash > 0) {
      cleanPath = cleanPath.substring(0, firstSlash);
    }
    this._logMessage(`excludeFolder() excludePath (top-level)=[${cleanPath}]`);

    const excludeDirs = this._getExcludeDirectories();
    this._logMessage(`excludeFolder() current excludeDirs=[${JSON.stringify(excludeDirs)}]`);

    if (excludeDirs.includes(cleanPath)) {
      this._logMessage(`excludeFolder() already excluded, skipping`);
      return;
    }

    excludeDirs.push(cleanPath);
    this._logMessage(`excludeFolder() new excludeDirs=[${JSON.stringify(excludeDirs)}]`);

    // Remove the excluded folder (and any subfolders) from localIncludes as source folders
    const localIncludes = this._getLocalIncludes();
    this._logMessage(`excludeFolder() localIncludes keys before=[${Object.keys(localIncludes).join(', ')}]`);

    for (const key of Object.keys(localIncludes)) {
      let cleanKey = key.replace(/\\/g, '/');
      if (cleanKey.endsWith('/')) {
        cleanKey = cleanKey.slice(0, -1);
      }
      if (cleanKey === cleanPath || cleanKey.startsWith(cleanPath + '/')) {
        this._logMessage(`excludeFolder() removing source folder key=[${key}]`);
        delete localIncludes[key];
      }
    }

    // Also scrub include dir entries in remaining folders that point into the excluded path
    const workspaceRoot = this._getWorkspaceRoot();
    for (const [key, entry] of Object.entries(localIncludes)) {
      const folderAbsPath = workspaceRoot ? path.resolve(workspaceRoot, key) : key;
      const filteredDirs = entry.dirs.filter((dir) => {
        // Resolve the include dir relative to the source folder to get a workspace-relative path
        const absDir = workspaceRoot ? path.resolve(folderAbsPath, dir) : dir;
        const relFromRoot = workspaceRoot ? path.relative(workspaceRoot, absDir).replace(/\\/g, '/') : dir;
        const isExcluded = relFromRoot === cleanPath || relFromRoot.startsWith(cleanPath + '/');
        if (isExcluded) {
          this._logMessage(`excludeFolder() scrubbing dir=[${dir}] (resolved=[${relFromRoot}]) from folder=[${key}]`);
        }
        return !isExcluded;
      });
      entry.dirs = filteredDirs;
    }

    this._logMessage(`excludeFolder() localIncludes keys after=[${Object.keys(localIncludes).join(', ')}]`);

    // Save both settings together, suppressing config-change refreshes during the save
    this._logMessage(`excludeFolder() saving settings...`);
    this._suppressConfigRefresh = true;
    try {
      await this._saveExcludeDirectories(excludeDirs);
      await this._saveLocalIncludes(localIncludes);
    } finally {
      this._suppressConfigRefresh = false;
    }
    this._logMessage(`excludeFolder() refreshing tree and triggering server rescan...`);
    this.refresh();

    // Explicitly trigger server-side rescan with the updated exclude list
    await vscode.commands.executeCommand('spinExtension.includeDirs.rescanAll');
    this._logMessage(`excludeFolder() DONE`);
  }

  async addExcludeDir(): Promise<void> {
    this._logMessage(`addExcludeDir() ENTRY`);
    const workspaceRoot = this._getWorkspaceRoot();
    if (!workspaceRoot) {
      this._logMessage(`addExcludeDir() ERROR: no workspace root, aborting`);
      return;
    }
    this._logMessage(`addExcludeDir() workspaceRoot=[${workspaceRoot}]`);

    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(workspaceRoot),
      openLabel: 'Exclude Directory'
    });

    if (!result || result.length === 0) {
      this._logMessage(`addExcludeDir() user cancelled dialog`);
      return;
    }

    const selectedDir = result[0].fsPath;
    this._logMessage(`addExcludeDir() selectedDir=[${selectedDir}]`);

    let relDir = path.relative(workspaceRoot, selectedDir).replace(/\\/g, '/');
    if (relDir.endsWith('/')) {
      relDir = relDir.slice(0, -1);
    }
    this._logMessage(`addExcludeDir() relDir=[${relDir}]`);

    const excludeDirs = this._getExcludeDirectories();
    this._logMessage(`addExcludeDir() current excludeDirs=[${JSON.stringify(excludeDirs)}]`);

    if (excludeDirs.includes(relDir)) {
      this._logMessage(`addExcludeDir() already excluded, skipping`);
      return;
    }

    excludeDirs.push(relDir);
    this._logMessage(`addExcludeDir() new excludeDirs=[${JSON.stringify(excludeDirs)}]`);

    // Also scrub localIncludes: remove source folders inside the excluded path
    // and remove include-dir entries pointing into it (same as excludeFolder)
    const localIncludes = this._getLocalIncludes();
    this._logMessage(`addExcludeDir() localIncludes keys before=[${Object.keys(localIncludes).join(', ')}]`);

    for (const key of Object.keys(localIncludes)) {
      let cleanKey = key.replace(/\\/g, '/');
      if (cleanKey.endsWith('/')) {
        cleanKey = cleanKey.slice(0, -1);
      }
      if (cleanKey === relDir || cleanKey.startsWith(relDir + '/')) {
        this._logMessage(`addExcludeDir() removing source folder key=[${key}]`);
        delete localIncludes[key];
      }
    }

    for (const [key, entry] of Object.entries(localIncludes)) {
      const folderAbsPath = path.resolve(workspaceRoot, key);
      const filteredDirs = entry.dirs.filter((dir) => {
        const absDir = path.resolve(folderAbsPath, dir);
        const relFromRoot = path.relative(workspaceRoot, absDir).replace(/\\/g, '/');
        const isExcluded = relFromRoot === relDir || relFromRoot.startsWith(relDir + '/');
        if (isExcluded) {
          this._logMessage(`addExcludeDir() scrubbing dir=[${dir}] (resolved=[${relFromRoot}]) from folder=[${key}]`);
        }
        return !isExcluded;
      });
      entry.dirs = filteredDirs;
    }

    this._logMessage(`addExcludeDir() localIncludes keys after=[${Object.keys(localIncludes).join(', ')}]`);
    this._logMessage(`addExcludeDir() saving settings...`);

    this._suppressConfigRefresh = true;
    try {
      await this._saveExcludeDirectories(excludeDirs);
      await this._saveLocalIncludes(localIncludes);
    } finally {
      this._suppressConfigRefresh = false;
    }
    this._logMessage(`addExcludeDir() refreshing tree and triggering server rescan...`);
    this.refresh();

    // Trigger server-side rescan with the updated exclude list
    await vscode.commands.executeCommand('spinExtension.includeDirs.rescanAll');
    this._logMessage(`addExcludeDir() DONE`);
  }

  async removeExcludeEntry(entry: ExcludedDirEntry): Promise<void> {
    const excludeDirs = this._getExcludeDirectories();
    excludeDirs.splice(entry.index, 1);
    this._suppressConfigRefresh = true;
    try {
      await this._saveExcludeDirectories(excludeDirs);
    } finally {
      this._suppressConfigRefresh = false;
    }
    this.refresh();
    // Trigger server-side rescan so removed exclusion's folders are re-discovered
    await vscode.commands.executeCommand('spinExtension.includeDirs.rescanAll');
  }

  // ---- Persistence helpers ----

  private async _saveLocalIncludes(localIncludes: LocalIncludesByFolder): Promise<void> {
    await vscode.workspace.getConfiguration('spin2').update('localIncludes', localIncludes, vscode.ConfigurationTarget.Workspace);
  }

  private async _saveCentralLibraryPaths(paths: string[]): Promise<void> {
    await vscode.workspace.getConfiguration('spinExtension.library').update('includePaths', paths, vscode.ConfigurationTarget.Global);
  }

  private async _saveExcludeDirectories(paths: string[]): Promise<void> {
    await vscode.workspace.getConfiguration('spin2').update('excludeIncludeDirectories', paths, vscode.ConfigurationTarget.Workspace);
  }

  private _getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;
  }
}

// ---- Tree Item classes ----

class FolderNode extends vscode.TreeItem {
  public readonly folderPath: string;
  public readonly isAuto: boolean;
  public readonly dirs: string[];

  constructor(folderPath: string, isAuto: boolean, dirs: string[]) {
    const label = folderPath;
    const hasChildren = dirs.length > 0;
    super(label, hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);

    this.folderPath = folderPath;
    this.isAuto = isAuto;
    this.dirs = dirs;
    this.description = isAuto ? 'auto' : 'customized';
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = isAuto ? 'folderNode' : 'folderNodeCustomized';
    this.tooltip = `Include directories for ${folderPath} (${isAuto ? 'auto-discovered' : 'user-customized'})`;
  }
}

class IncludeDirEntry extends vscode.TreeItem {
  public readonly dirPath: string;
  public readonly folderPath: string;
  public readonly index: number;
  public readonly totalCount: number;

  constructor(dirPath: string, folderPath: string, index: number, totalCount: number) {
    super(dirPath, vscode.TreeItemCollapsibleState.None);

    this.dirPath = dirPath;
    this.folderPath = folderPath;
    this.index = index;
    this.totalCount = totalCount;
    this.iconPath = new vscode.ThemeIcon('folder-opened');
    this.contextValue = 'includeDir';
    this.tooltip = `Include directory: ${dirPath}`;
  }
}

class CentralLibsNode extends vscode.TreeItem {
  constructor() {
    const centralPaths = vscode.workspace.getConfiguration('spinExtension.library').get<string[]>('includePaths') || [];
    const hasChildren = centralPaths.length > 0;
    super('Central Libraries', hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon('library');
    this.contextValue = 'centralLibsNode';
    this.tooltip = 'Central library directories shared across all projects';
  }
}

class LibraryDirEntry extends vscode.TreeItem {
  public readonly libPath: string;
  public readonly index: number;
  public readonly totalCount: number;

  constructor(libPath: string, index: number, totalCount: number) {
    super(libPath, vscode.TreeItemCollapsibleState.None);

    this.libPath = libPath;
    this.index = index;
    this.totalCount = totalCount;
    this.iconPath = new vscode.ThemeIcon('folder-opened');
    this.contextValue = 'libraryDir';
    this.tooltip = `Central library directory: ${libPath}`;
  }
}

class ExcludedDirsNode extends vscode.TreeItem {
  constructor() {
    const excludedPaths = vscode.workspace.getConfiguration('spin2').get<string[]>('excludeIncludeDirectories') || [];
    const hasChildren = excludedPaths.length > 0;
    super('Excluded Directories', hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon('eye-closed');
    this.contextValue = 'excludedDirsNode';
    this.tooltip = 'Directories excluded from include path discovery (and all their subdirectories)';
  }
}

class ExcludedDirEntry extends vscode.TreeItem {
  public readonly dirPath: string;
  public readonly index: number;
  public readonly totalCount: number;

  constructor(dirPath: string, index: number, totalCount: number) {
    super(dirPath, vscode.TreeItemCollapsibleState.None);

    this.dirPath = dirPath;
    this.index = index;
    this.totalCount = totalCount;
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'excludedDir';
    this.tooltip = `Excluded directory: ${dirPath} (and all subdirectories)`;
  }
}
