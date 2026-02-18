'use strict';
// client/src/providers/spin.includeDirectories.treeView.ts
//
// Tree View provider for Spin2 Include Directories UI in the Explorer sidebar.
// Shows per-folder include directories (Tier 2) and central library directories (Tier 1).

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Types matching the workspace setting structure
interface ILocalIncludeEntry {
  auto: boolean;
  dirs: string[];
}
type LocalIncludesByFolder = { [folderPath: string]: ILocalIncludeEntry };

// Tree item types
type IncludeTreeItem = FolderNode | IncludeDirEntry | CentralLibsNode | LibraryDirEntry;

export class IncludeDirectoriesProvider implements vscode.TreeDataProvider<IncludeTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<IncludeTreeItem | undefined> = new vscode.EventEmitter<IncludeTreeItem | undefined>();
  readonly onDidChangeTreeData: vscode.Event<IncludeTreeItem | undefined> = this._onDidChangeTreeData.event;

  constructor() {
    // Listen for config changes to refresh the tree
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('spin2.localIncludes') || e.affectsConfiguration('spinExtension.library.includePaths')) {
        this.refresh();
      }
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: IncludeTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: IncludeTreeItem): IncludeTreeItem[] {
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

    return [];
  }

  private _getRootItems(): IncludeTreeItem[] {
    const items: IncludeTreeItem[] = [];

    // Get local includes from workspace settings
    const localIncludes = this._getLocalIncludes();

    // Sort folder paths for consistent display
    const folderPaths = Object.keys(localIncludes).sort();
    for (const folderPath of folderPaths) {
      const entry = localIncludes[folderPath];
      items.push(new FolderNode(folderPath, entry.auto, entry.dirs));
    }

    // Always show central libraries section
    items.push(new CentralLibsNode());

    return items;
  }

  private _getFolderChildren(folder: FolderNode): IncludeDirEntry[] {
    return folder.dirs.map((dir, index) => new IncludeDirEntry(dir, folder.folderPath, index, folder.dirs.length));
  }

  private _getCentralLibChildren(): LibraryDirEntry[] {
    const centralPaths = this._getCentralLibraryPaths();
    return centralPaths.map((dir, index) => new LibraryDirEntry(dir, index, centralPaths.length));
  }

  private _getLocalIncludes(): LocalIncludesByFolder {
    return vscode.workspace.getConfiguration('spin2').get<LocalIncludesByFolder>('localIncludes') || {};
  }

  private _getCentralLibraryPaths(): string[] {
    return vscode.workspace.getConfiguration('spinExtension.library').get<string[]>('includePaths') || [];
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

  // ---- Persistence helpers ----

  private async _saveLocalIncludes(localIncludes: LocalIncludesByFolder): Promise<void> {
    await vscode.workspace.getConfiguration('spin2').update('localIncludes', localIncludes, vscode.ConfigurationTarget.Workspace);
  }

  private async _saveCentralLibraryPaths(paths: string[]): Promise<void> {
    await vscode.workspace.getConfiguration('spinExtension.library').update('includePaths', paths, vscode.ConfigurationTarget.Global);
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
