'use strict';
// src/providers/ObjectDependencyProvider.ts

import * as lsp from 'vscode-languageserver';
import * as path from 'path';

import { Provider } from '.';
import { Context } from '../context';
import { DocumentFindings } from '../parser/spin.semantic.findings';
import { fileSpecFromURI, isSpinFile } from '../parser/lang.utils';
import { resolveReferencedIncludes } from '../files';
import { IncludeDiscovery } from '../includeDiscovery';

// -------------------------------------------------------------------------------------
//  Data contract: matches client-side IObjectDependencyNode
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

export interface IObjectDependencyResponse {
  topFileName: string;
  rootNode: IObjectDependencyNode | null;
  isReady: boolean; // false if server hasn't parsed yet
}

interface IGetObjectDependenciesParams {
  uri: string;
}

export default class ObjectDependencyProvider implements Provider {
  private includeDiscovery: IncludeDiscovery;

  constructor(protected readonly ctx: Context) {
    this.includeDiscovery = new IncludeDiscovery(ctx);
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onRequest('spin/getObjectDependencies', this.handleGetObjectDependencies.bind(this));
    return {};
  }

  private async handleGetObjectDependencies(params: IGetObjectDependenciesParams): Promise<IObjectDependencyResponse> {
    const docFSpec: string = fileSpecFromURI(params.uri);
    const topFileName: string = path.basename(docFSpec);
    this.ctx.logger.log(`TRC: ObjDepProv.handleGetObjectDependencies() uri=[${params.uri}], docFSpec=[${docFSpec}]`);

    // Check if we have findings for this document
    const findings: DocumentFindings | undefined = this.ctx.findingsByFSpec.get(docFSpec);
    if (!findings) {
      this.ctx.logger.log(`TRC: ObjDepProv -- no findings for [${docFSpec}], isReady=false`);
      return { topFileName, rootNode: null, isReady: false };
    }

    // Build the tree from root
    const ancestorPaths: Set<string> = new Set();
    const rootNode = this.buildDependencyTree(docFSpec, '', 0, ancestorPaths, 'obj');

    this.ctx.logger.log(`TRC: ObjDepProv -- built tree for [${topFileName}]`);
    return { topFileName, rootNode, isReady: true };
  }

  private buildDependencyTree(
    fileSpec: string,
    instanceName: string,
    depth: number,
    ancestorPaths: Set<string>,
    depType: 'obj' | 'include'
  ): IObjectDependencyNode {
    const fileName: string = path.basename(fileSpec);
    const normalizedFSpec: string = fileSpec.toLowerCase();

    // Circular reference detection: check if this file is already in the ancestor path
    if (ancestorPaths.has(normalizedFSpec)) {
      this.ctx.logger.log(`TRC: ObjDepProv -- CIRCULAR ref detected: [${fileName}]`);
      return {
        fileName,
        instanceName,
        fileSpec,
        isFileMissing: false,
        isCircular: true,
        depth,
        children: [],
        dependencyType: depType
      };
    }

    // Check if this file has been parsed (has findings)
    const findings: DocumentFindings | undefined = this.ctx.findingsByFSpec.get(fileSpec);
    if (!findings) {
      // File not parsed -- could be missing or just not yet loaded
      // Check if file exists in docsByFSpec (it was loaded but maybe no findings)
      const processedDoc = this.ctx.docsByFSpec.get(fileSpec);
      if (!processedDoc) {
        this.ctx.logger.log(`TRC: ObjDepProv -- file missing/not-parsed: [${fileSpec}]`);
        return {
          fileName,
          instanceName,
          fileSpec: '',
          isFileMissing: true,
          isCircular: false,
          depth,
          children: [],
          dependencyType: depType
        };
      }
    }

    // Add this file to ancestor set for cycle detection
    const extendedAncestors: Set<string> = new Set(ancestorPaths);
    extendedAncestors.add(normalizedFSpec);

    const children: IObjectDependencyNode[] = [];

    if (findings) {
      // Get OBJ imports
      const objRefs = findings.objectReferences();
      const docFolder: string = path.dirname(fileSpec);
      const additionalDirs: string[] = this.includeDiscovery.getIncludeDirsForFolder(docFolder);

      for (const ref of objRefs) {
        const resolvedFSpecs = resolveReferencedIncludes([ref.fileName], docFolder, this.ctx, additionalDirs);
        if (resolvedFSpecs.length > 0) {
          const childFSpec = resolvedFSpecs[0];
          const childNode = this.buildDependencyTree(childFSpec, ref.instanceName, depth + 1, extendedAncestors, 'obj');
          children.push(childNode);
        } else {
          // Could not resolve -- mark as missing
          const missingFileName = ref.fileName.includes('.') ? ref.fileName : `${ref.fileName}.spin2`;
          children.push({
            fileName: missingFileName,
            instanceName: ref.instanceName,
            fileSpec: '',
            isFileMissing: true,
            isCircular: false,
            depth: depth + 1,
            children: [],
            dependencyType: 'obj'
          });
        }
      }

      // Get #include imports
      const includeNames: string[] = findings.includeNamesForFilename(fileName);
      if (includeNames.length > 0) {
        const resolvedIncludes = resolveReferencedIncludes(includeNames, docFolder, this.ctx, additionalDirs);
        for (let i = 0; i < includeNames.length; i++) {
          const includeName = includeNames[i];
          // Find matching resolved path
          let matchedFSpec: string = '';
          const matchName = includeName.toLowerCase();
          for (const resolved of resolvedIncludes) {
            if (resolved.toLowerCase().includes(matchName)) {
              matchedFSpec = resolved;
              break;
            }
          }
          if (matchedFSpec.length > 0) {
            const childNode = this.buildDependencyTree(matchedFSpec, includeName, depth + 1, extendedAncestors, 'include');
            children.push(childNode);
          } else {
            children.push({
              fileName: includeName,
              instanceName: includeName,
              fileSpec: '',
              isFileMissing: true,
              isCircular: false,
              depth: depth + 1,
              children: [],
              dependencyType: 'include'
            });
          }
        }
      }
    }

    return {
      fileName,
      instanceName,
      fileSpec,
      isFileMissing: false,
      isCircular: false,
      depth,
      children,
      dependencyType: depType
    };
  }
}
