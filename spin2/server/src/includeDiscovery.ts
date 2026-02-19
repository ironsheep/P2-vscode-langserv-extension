'use strict';
// server/src/includeDiscovery.ts
//
// Auto-discovery of include directories for Spin2 projects.
// Scans workspace directory tree, parses OBJ section references,
// and computes per-folder include directory lists.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Context, ILocalIncludeEntry, LocalIncludesByFolder } from './context';
import { isSpinExt } from './files';

interface IFileCatalogEntry {
  fileName: string; // basename, e.g. "isp_hub75_color.spin2"
  dirPath: string; // absolute directory path
}

export class IncludeDiscovery {
  constructor(protected readonly ctx: Context) {}

  /**
   * Run auto-discovery of include directories for all workspace folders.
   * Only updates folders whose include lists are still auto-managed.
   */
  async runDiscovery(): Promise<void> {
    if (this.ctx.workspaceFolders.length === 0) {
      this.ctx.logger.log('TRC: IncludeDiscovery.runDiscovery() no workspace folders');
      return;
    }

    const workspaceRoot = this._getWorkspaceRoot();
    if (!workspaceRoot) {
      this.ctx.logger.log('TRC: IncludeDiscovery.runDiscovery() could not determine workspace root');
      return;
    }
    this.ctx.logger.log(`TRC: IncludeDiscovery.runDiscovery() workspaceRoot=[${workspaceRoot}]`);

    // Build set of excluded absolute paths for fast lookup
    const excludeAbsPaths: string[] = this.ctx.parserConfig.excludeIncludeDirectories.map((relDir) => {
      let cleanRel = relDir.replace(/\\/g, '/');
      if (cleanRel.endsWith('/')) {
        cleanRel = cleanRel.slice(0, -1);
      }
      return path.resolve(workspaceRoot, cleanRel);
    });
    this.ctx.logger.log(`TRC: IncludeDiscovery excludeAbsPaths=[${excludeAbsPaths.join(', ')}]`);

    // Step 1: Walk directory tree to catalog all .spin2 files
    const fileCatalog: IFileCatalogEntry[] = this._catalogSpin2Files(workspaceRoot, excludeAbsPaths);
    this.ctx.logger.log(`TRC: IncludeDiscovery found ${fileCatalog.length} .spin2 files`);

    // Build maps: directory -> filenames, filename -> directories
    const filesByDir: Map<string, string[]> = new Map();
    const dirsByFileName: Map<string, string[]> = new Map();

    for (const entry of fileCatalog) {
      // filesByDir
      const dirFiles = filesByDir.get(entry.dirPath) || [];
      dirFiles.push(entry.fileName);
      filesByDir.set(entry.dirPath, dirFiles);

      // dirsByFileName
      const fileNameLower = entry.fileName.toLowerCase();
      const fileDirs = dirsByFileName.get(fileNameLower) || [];
      fileDirs.push(entry.dirPath);
      dirsByFileName.set(fileNameLower, fileDirs);
    }

    // Step 2: For each folder with .spin2 files, parse OBJ references
    const discoveredIncludes: LocalIncludesByFolder = {};
    const currentLocalIncludes = this.ctx.parserConfig.localIncludes;

    for (const [dirPath, fileNames] of filesByDir) {
      const relFolderPath = this._relativePath(workspaceRoot, dirPath);

      // Skip folders where user has customized includes (auto: false)
      const existing = currentLocalIncludes[relFolderPath];
      if (existing && existing.auto === false) {
        this.ctx.logger.log(`TRC: IncludeDiscovery SKIP customized folder [${relFolderPath}]`);
        discoveredIncludes[relFolderPath] = existing;
        continue;
      }

      // Collect OBJ references from all .spin2 files in this directory
      const referencedFileNames: Set<string> = new Set();
      for (const fileName of fileNames) {
        if (!fileName.toLowerCase().endsWith('.spin2')) {
          continue;
        }
        const filePath = path.join(dirPath, fileName);
        const objRefs = this._parseObjReferences(filePath);
        for (const ref of objRefs) {
          referencedFileNames.add(ref.toLowerCase());
        }
      }

      // Step 3: For each referenced filename, find which directory contains it
      // Only look externally for files that don't already exist in the current folder
      const localFileNames = (filesByDir.get(dirPath) || []).map((f) => f.toLowerCase());
      const neededDirs: Set<string> = new Set();
      for (const refName of referencedFileNames) {
        // Ensure extension
        const refNameWithExt = refName.endsWith('.spin2') ? refName : `${refName}.spin2`;

        // If the file already exists locally, no include directory is needed for it
        if (localFileNames.includes(refNameWithExt)) {
          continue;
        }

        const candidateDirs = dirsByFileName.get(refNameWithExt);
        if (candidateDirs) {
          for (const candidateDir of candidateDirs) {
            // Skip the current folder itself
            if (candidateDir !== dirPath) {
              neededDirs.add(candidateDir);
            }
          }
        }
      }

      // Step 4: Convert needed dirs to relative paths from this folder
      if (neededDirs.size > 0) {
        const relativeDirs: string[] = [];
        for (const neededDir of neededDirs) {
          let relDir = path.relative(dirPath, neededDir);
          // Normalize to use forward slashes
          relDir = relDir.replace(/\\/g, '/');
          if (!relDir.endsWith('/')) {
            relDir += '/';
          }
          relativeDirs.push(relDir);
        }
        // Sort for consistency
        relativeDirs.sort();
        discoveredIncludes[relFolderPath] = { auto: true, dirs: relativeDirs };
        this.ctx.logger.log(`TRC: IncludeDiscovery folder [${relFolderPath}] -> dirs=[${relativeDirs.join(', ')}]`);
      }
    }

    // Step 5: Include ALL discovered directories (even those with no external include needs)
    // so they appear in the tree view and can be excluded by the user.
    // Without this, library-only directories like OBEX never appear in the tree.
    for (const [dirPath] of filesByDir) {
      const relFolderPath = this._relativePath(workspaceRoot, dirPath);

      // Skip if already in discoveredIncludes (has include needs or is customized)
      if (relFolderPath in discoveredIncludes) {
        continue;
      }

      // Skip folders where user has customized includes (auto: false)
      const existing = currentLocalIncludes[relFolderPath];
      if (existing && existing.auto === false) {
        discoveredIncludes[relFolderPath] = existing;
        continue;
      }

      discoveredIncludes[relFolderPath] = { auto: true, dirs: [] };
      this.ctx.logger.log(`TRC: IncludeDiscovery folder [${relFolderPath}] -> (no external includes needed)`);
    }

    // Also preserve any user-customized entries that weren't found in the scan
    for (const [folderPath, entry] of Object.entries(currentLocalIncludes)) {
      if (entry.auto === false && !(folderPath in discoveredIncludes)) {
        discoveredIncludes[folderPath] = entry;
      }
    }

    // Only update and notify if results actually changed
    const oldJson = JSON.stringify(this.ctx.parserConfig.localIncludes);
    const newJson = JSON.stringify(discoveredIncludes);

    if (oldJson !== newJson) {
      this.ctx.parserConfig.localIncludes = discoveredIncludes;

      // Notify client about discovered includes so it can update the tree view
      try {
        this.ctx.connection.sendNotification('spin/discoveredIncludesChanged', { localIncludes: discoveredIncludes });
      } catch {
        // Client may not be listening yet; that's OK, settings will be read from context
        this.ctx.logger.log('TRC: IncludeDiscovery could not notify client (not ready yet)');
      }
      this.ctx.logger.log(`TRC: IncludeDiscovery.runDiscovery() DONE, ${Object.keys(discoveredIncludes).length} folder entries (CHANGED)`);
    } else {
      this.ctx.logger.log(`TRC: IncludeDiscovery.runDiscovery() DONE, ${Object.keys(discoveredIncludes).length} folder entries (unchanged, no notification sent)`);
    }
  }

  /**
   * Get the list of include directories for a specific folder path.
   * Returns resolved absolute paths ready for file searching.
   */
  getIncludeDirsForFolder(folderAbsPath: string): string[] {
    const workspaceRoot = this._getWorkspaceRoot();
    if (!workspaceRoot) {
      return [];
    }

    const relFolderPath = this._relativePath(workspaceRoot, folderAbsPath);
    const entry = this.ctx.parserConfig.localIncludes[relFolderPath];
    const result: string[] = [];

    // Add local include dirs (Tier 2)
    if (entry && entry.dirs) {
      for (const dir of entry.dirs) {
        const resolved = path.resolve(folderAbsPath, dir);
        if (fs.existsSync(resolved)) {
          result.push(resolved);
        }
      }
    }

    // Add central library dirs (Tier 1)
    for (const libDir of this.ctx.parserConfig.centralLibraryPaths) {
      const expanded = this._expandHome(libDir);
      if (fs.existsSync(expanded)) {
        result.push(expanded);
      }
    }

    return result;
  }

  private _getWorkspaceRoot(): string | undefined {
    if (this.ctx.workspaceFolders.length === 0) {
      return undefined;
    }
    try {
      return fileURLToPath(this.ctx.workspaceFolders[0].uri);
    } catch {
      return undefined;
    }
  }

  private _relativePath(workspaceRoot: string, absPath: string): string {
    let rel = path.relative(workspaceRoot, absPath);
    rel = rel.replace(/\\/g, '/');
    if (rel === '') {
      rel = '.';
    }
    return rel;
  }

  private _expandHome(filePath: string): string {
    if (filePath.startsWith('~/') || filePath === '~') {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      return path.join(home, filePath.slice(1));
    }
    return filePath;
  }

  private _catalogSpin2Files(rootDir: string, excludeAbsPaths: string[]): IFileCatalogEntry[] {
    const entries: IFileCatalogEntry[] = [];
    this._walkDir(rootDir, entries, excludeAbsPaths);
    return entries;
  }

  private _isExcluded(dirPath: string, excludeAbsPaths: string[]): boolean {
    for (const excludePath of excludeAbsPaths) {
      if (dirPath === excludePath || dirPath.startsWith(excludePath + path.sep) || dirPath.startsWith(excludePath + '/')) {
        return true;
      }
    }
    return false;
  }

  private _walkDir(dirPath: string, entries: IFileCatalogEntry[], excludeAbsPaths: string[]): void {
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith('.') || item.name === 'node_modules') {
          continue; // skip hidden dirs and node_modules
        }
        const fullPath = path.join(dirPath, item.name);
        if (item.isDirectory()) {
          if (this._isExcluded(fullPath, excludeAbsPaths)) {
            this.ctx.logger.log(`TRC: IncludeDiscovery._walkDir() EXCLUDED subdir [${fullPath}]`);
            continue;
          }
          this.ctx.logger.log(`TRC: IncludeDiscovery._walkDir() entering subdir [${fullPath}]`);
          this._walkDir(fullPath, entries, excludeAbsPaths);
        } else if (isSpinExt(item.name)) {
          this.ctx.logger.log(`TRC: IncludeDiscovery._walkDir() found [${item.name}] in [${dirPath}]`);
          entries.push({ fileName: item.name, dirPath });
        }
      }
    } catch (err) {
      this.ctx.logger.log(`TRC: IncludeDiscovery._walkDir() error reading [${dirPath}]: ${err}`);
    }
  }

  /**
   * Parse OBJ section references from a .spin2 file.
   * Returns list of referenced filenames (without extension if not present in source).
   */
  private _parseObjReferences(filePath: string): string[] {
    const references: string[] = [];
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      // Handle UTF-16 encoded files
      let text = content;
      if (text.includes('\x00')) {
        text = fs.readFileSync(filePath, 'utf16le');
      }

      const lines = text.split(/\r\n|\r|\n/);
      let inObjSection = false;
      let inMultiLineComment = false;

      for (const line of lines) {
        const trimmed = line.trim();

        // Handle multi-line comments
        if (inMultiLineComment) {
          if (trimmed.includes('}')) {
            inMultiLineComment = false;
          }
          continue;
        }
        if (trimmed.startsWith('{') && !trimmed.includes('}')) {
          inMultiLineComment = true;
          continue;
        }

        // Skip single-line comments
        if (trimmed.startsWith("'") || trimmed.startsWith("''")) {
          continue;
        }

        // Check for section transitions
        const trimmedUpper = trimmed.toUpperCase();
        if (
          trimmedUpper.startsWith('CON') ||
          trimmedUpper.startsWith('VAR') ||
          trimmedUpper.startsWith('DAT') ||
          trimmedUpper.startsWith('PUB') ||
          trimmedUpper.startsWith('PRI')
        ) {
          // Check if it's actually a section header (next char should be whitespace, end of line, or '{')
          const nextChar = trimmed.length > 3 ? trimmed[3] : '';
          if (nextChar === '' || nextChar === ' ' || nextChar === '\t' || nextChar === '{' || nextChar === "'") {
            inObjSection = false;
            continue;
          }
        }
        if (trimmedUpper.startsWith('OBJ')) {
          const nextChar = trimmed.length > 3 ? trimmed[3] : '';
          if (nextChar === '' || nextChar === ' ' || nextChar === '\t' || nextChar === '{' || nextChar === "'") {
            inObjSection = true;
            // Check if there's content after OBJ on the same line
            const afterObj = trimmed.substring(3).trim();
            if (afterObj.length > 0 && afterObj.includes(':') && afterObj.includes('"')) {
              const ref = this._extractObjReference(afterObj);
              if (ref) {
                references.push(ref);
              }
            }
            continue;
          }
        }

        if (inObjSection && trimmed.length > 0) {
          if (trimmed.includes(':') && trimmed.includes('"')) {
            const ref = this._extractObjReference(trimmed);
            if (ref) {
              references.push(ref);
            }
          }
        }
      }
    } catch (err) {
      this.ctx.logger.log(`TRC: IncludeDiscovery._parseObjReferences() error reading [${filePath}]: ${err}`);
    }
    return references;
  }

  /**
   * Extract the filename from an OBJ declaration line.
   * E.g. 'color : "isp_hub75_color"' -> 'isp_hub75_color'
   */
  private _extractObjReference(line: string): string | undefined {
    // Remove inline comments
    let cleanLine = line;
    const singleQuoteIdx = cleanLine.indexOf("'");
    if (singleQuoteIdx !== -1) {
      // Make sure it's not inside a string
      const beforeQuote = cleanLine.substring(0, singleQuoteIdx);
      const quoteCount = (beforeQuote.match(/"/g) || []).length;
      if (quoteCount % 2 === 0) {
        cleanLine = beforeQuote;
      }
    }

    // Handle override parts (e.g. "file" | OVERRIDE = 2)
    const overrideParts = cleanLine.split('|');
    const mainPart = overrideParts[0];

    // Extract filename from quotes
    const match = mainPart.match(/"([^"]+)"/);
    if (match) {
      return match[1];
    }
    return undefined;
  }
}
