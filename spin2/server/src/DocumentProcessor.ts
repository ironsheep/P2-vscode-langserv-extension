'use strict';
// server/src/spin.serverBehavior.configuration.ts

//import * as lsp from "vscode-languageserver";
import { TextDocument } from 'vscode-languageserver-textdocument';

import { readDocumentFromUri, resolveReferencedIncludes } from './files';
import { Context } from './context';
import { DocumentFindings } from './parser/spin.semantic.findings';
import { Spin1DocumentSymbolParser } from './parser/spin1.documentSymbolParser';
import { Spin2DocumentSymbolParser } from './parser/spin2.documentSymbolParser';
import { Spin1DocumentSemanticParser } from './parser/spin1.documentSemanticParser';
import { Spin2DocumentSemanticParser } from './parser/spin2.documentSemanticParser';
import { Spin2ObjectReferenceParser } from './parser/spin.objectReferenceParser';
import { isSpin1File, fileSpecFromURI } from './parser/lang.utils';
import { IncludeDiscovery } from './includeDiscovery';
import * as path from 'path';

// ----------------------------------------------------------------------------
//  Tracking an OPEN document
//   CLASS ProcessedDocument
//
export class ProcessedDocument {
  public readonly document: TextDocument;
  public readonly parseResult: DocumentFindings;
  private includeFileSpecs: string[] = [];
  private docFolder: string;

  constructor(document: TextDocument, parseResult: DocumentFindings) {
    this.document = document;
    this.docFolder = path.dirname(fileSpecFromURI(document.uri));
    this.parseResult = parseResult;
  }

  public get folder(): string {
    return this.docFolder;
  }

  public pushReferencedFileSpecs(...newFSpecList: string[]) {
    for (let index = 0; index < newFSpecList.length; index++) {
      const newFSpec = newFSpecList[index];
      this.addReferencedFileSpec(newFSpec);
    }
  }

  public get referencedFileSpecsCount(): number {
    return this.includeFileSpecs.length;
  }

  public addReferencedFileSpec(newFSpec: string) {
    if (!this.includeFileSpecs.includes(newFSpec)) {
      this.includeFileSpecs.push(newFSpec);
    }
  }

  public get referencedFileSpecs(): string[] {
    return this.includeFileSpecs;
  }

  public referencedFileSpec(fsIndex: number): string {
    let desiredFSpec: string = '';
    if (fsIndex >= 0 && fsIndex <= this.includeFileSpecs.length) {
      desiredFSpec = this.includeFileSpecs[fsIndex];
    }
    return desiredFSpec;
  }
}

export type ProcessedDocumentByFSpec = Map<string, ProcessedDocument>;
export type DocumentFindingsByFSpec = Map<string, DocumentFindings>;
export type TopDocsByFSpec = Map<string, string>;

// ----------------------------------------------------------------------------
//  Updates parsed state of documents in workspace
//   CLASS DocumentProcessor
//
export default class DocumentProcessor {
  //private parser: Parser;
  private spin1symbolParser: Spin1DocumentSymbolParser;
  private spin2symbolParser: Spin2DocumentSymbolParser;
  private spin1semanticParser: Spin1DocumentSemanticParser;
  private spin2semanticParser: Spin2DocumentSemanticParser;
  private spin2ObjectReferenceParser: Spin2ObjectReferenceParser;
  private includeDiscovery: IncludeDiscovery;
  private readonly PARM_ALL_BUT_INCLUDES: boolean = false;
  private readonly PARM_INCLUDES_TOO: boolean = true;

  constructor(protected readonly ctx: Context) {
    // handle document outline
    this.spin1symbolParser = new Spin1DocumentSymbolParser(ctx);
    this.spin2symbolParser = new Spin2DocumentSymbolParser(ctx);
    this.spin1semanticParser = new Spin1DocumentSemanticParser(ctx);
    this.spin2semanticParser = new Spin2DocumentSemanticParser(ctx);
    this.spin2ObjectReferenceParser = new Spin2ObjectReferenceParser(ctx);
    this.includeDiscovery = new IncludeDiscovery(ctx);
  }

  get topDocFileSpecs() {
    // return list of top-doc fileSpecs
    return Array.from(this.ctx.topDocsByFSpec.keys());
  }

  get docFileSpecs() {
    // return list of top-doc fileSpecs
    return Array.from(this.ctx.docsByFSpec.keys());
  }

  async reparseAllDocs() {
    // have config change, assuming settings changes, reparse all doc from deepest first
    const docsToParse: string[] = Array.from(this.ctx.topDocsByFSpec.keys());
    this.ctx.logger.log(`TRC: DP.reparseAllDocs() updating=[${docsToParse}]`);
    this._reParseInOrder(docsToParse);
    // process each doc in order (deepest to shallowest)
    let didUpdate: boolean = false;
    for (let index = 0; index < docsToParse.length; index++) {
      const docFSpec = docsToParse[index];
      const processedDoc: ProcessedDocument | undefined = this.ctx.docsByFSpec.get(docFSpec);
      if (processedDoc) {
        this.ctx.logger.log(`TRC: DP.reparseAllDocs() re-parsing [${docFSpec}]`);
        didUpdate = true;
        await this.updateFindings(processedDoc.document.uri);
      }
    }
    if (didUpdate) {
      this.ctx.logger.log(`TRC: DP.reparseAllDocs() updating open files`);
      const SEMANTIC_SYMBOLS_REFRESH_REQUEST: string = 'workspace/semanticTokens/refresh';
      await this.ctx.connection.sendRequest(SEMANTIC_SYMBOLS_REFRESH_REQUEST);
    }
  }

  async reparseTopDocs() {
    // have config change, assuming settings changes, reparse all doc from deepest first
    const docsToParse: string[] = Array.from(this.ctx.topDocsByFSpec.keys());
    this.ctx.logger.log(`TRC: DP.reparseTopDocs() updating=[${docsToParse}]`);
    // process each doc in order (deepest to shallowest)
    let didUpdate: boolean = false;
    for (let index = 0; index < docsToParse.length; index++) {
      const docFSpec = docsToParse[index];
      const processedDoc: ProcessedDocument | undefined = this.ctx.docsByFSpec.get(docFSpec);
      if (processedDoc) {
        this.ctx.logger.log(`TRC: DP.reparseTopDocs() re-parsing [${docFSpec}]`);
        didUpdate = true;
        await this.process(processedDoc.document, false, false);
      }
    }
    if (didUpdate) {
      this.ctx.logger.log(`TRC: DP.reparseAllDocs() updating open files`);
      const SEMANTIC_SYMBOLS_REFRESH_REQUEST: string = 'workspace/semanticTokens/refresh';
      await this.ctx.connection.sendRequest(SEMANTIC_SYMBOLS_REFRESH_REQUEST);
    }
  }

  async processEnclosing(includeUri: string): Promise<string[]> {
    //const includedFilename: string = path.basename(includeUri);
    const includeFSpec: string = fileSpecFromURI(includeUri);
    this.ctx.logger.log(`TRC: DP.processEnclosing() search includeFSpec=[${includeFSpec}]`);
    //let bDidUpdates: boolean = false;
    const updatedEnclsingUris: string[] = [];
    for (const [docUri, processedDocument] of this.ctx.docsByFSpec) {
      //const enclosingFilename: string = path.basename(docUri);
      //const enclosingFSpec: string = fileSpecFromURI(docUri);
      this.ctx.logger.log(`TRC: DP.processEnclosing() CHECKING [${docUri}]`);
      this.ctx.logger.log(`TRC: DP ------------------ included files: [${JSON.stringify(processedDocument.referencedFileSpecs)}]`);
      for (let index = 0; index < processedDocument.referencedFileSpecsCount; index++) {
        const possIncludeFSpec = processedDocument.referencedFileSpec(index);
        this.ctx.logger.log(`TRC: DP CHECKING: possIncludeFSpec=[${possIncludeFSpec}]`);
        if (possIncludeFSpec === includeFSpec) {
          this.ctx.logger.log(`TRC: DP update Enclosing Doc: ${processedDocument.document.uri}`);
          updatedEnclsingUris.push(processedDocument.document.uri);
          // process parent after include file change [using  isInclude:false, skipIncludeScan:true]
          await this.process(processedDocument.document, false, true);
          //bDidUpdates = true;
        }
      }
    }
    // if we just updated underlying documents an parent, send refresh request to client
    //if (bDidUpdates) {
    const SEMANTIC_SYMBOLS_REFRESH_REQUEST: string = 'workspace/semanticTokens/refresh';
    //const DIAGNOTICS_REFRESH_REQUEST: string = "workspace/codeLens/refresh";
    //await this.ctx.connection.sendRequest(DIAGNOTICS_REFRESH_REQUEST);
    await this.ctx.connection.sendRequest(SEMANTIC_SYMBOLS_REFRESH_REQUEST);
    //}
    return updatedEnclsingUris;
  }

  async updateFindings(docUri: string) {
    this.ctx.logger.log(`TRC: DP.updateFindings(${docUri})`);
    const docFSpec: string = fileSpecFromURI(docUri);
    const tmpFindingsForDocument: DocumentFindings | undefined = this.ctx.findingsByFSpec.get(docFSpec);
    if (!tmpFindingsForDocument) {
      return;
    }
    const currDocumentFindings: DocumentFindings = tmpFindingsForDocument;
    const processedDoc = this.ctx.docsByFSpec.get(docFSpec);
    if (processedDoc) {
      await this._parseDocument(processedDoc, 'Update-Parse', currDocumentFindings);
    }
  }

  async process(document: TextDocument, isInclude: boolean = false, skipIncludeScan: boolean = false): Promise<ProcessedDocument> {
    this.ctx.logger.log(`TRC: DP.process(${document.uri}`);
    const docFSpec: string = fileSpecFromURI(document.uri);
    const fileName: string = path.basename(docFSpec);
    this.ctx.logger.log(`TRC: DP.process() isInclude=${isInclude}, skipIncludeScan=${skipIncludeScan}, docFSpec=[${docFSpec}]`);

    // we keep a single DocumentFindings for each document.uri -> docFSpec
    //
    let tmpFindingsForDocument: DocumentFindings | undefined = this.ctx.findingsByFSpec.get(docFSpec);
    if (!tmpFindingsForDocument) {
      tmpFindingsForDocument = new DocumentFindings(document.uri);
      tmpFindingsForDocument.setFilename(docFSpec);
      this.ctx.findingsByFSpec.set(docFSpec, tmpFindingsForDocument);
      this.ctx.logger.log(`TRC: ADD Findings: ${tmpFindingsForDocument.instanceName()}`);
    } else {
      this.ctx.logger.log(`TRC: reUSE Findings: ${tmpFindingsForDocument.instanceName()}`);
    }
    const currDocumentFindings: DocumentFindings = tmpFindingsForDocument;

    // we keep a single ProcessedDocument for each document.uri
    //
    let tmpProcessed = this.ctx.docsByFSpec.get(docFSpec);
    if (!tmpProcessed) {
      tmpProcessed = new ProcessedDocument(document, currDocumentFindings);
      this.ctx.logger.log(`TRC: ADD ProcessedDocument: ${document.uri}`);
      // we keep a single currDocumentInProcess document for each  document.uri
      this.ctx.docsByFSpec.set(docFSpec, tmpProcessed);
    } else {
      this.ctx.logger.log(`TRC: reUSE ProcessedDocument: ${tmpProcessed.document.uri}`);
    }
    const currDocumentInProcess: ProcessedDocument = tmpProcessed;

    if (skipIncludeScan == false) {
      // do first pass parse to fill in DocumentFindings with list of object references (includes)
      const languageId: string = isSpin1File(docFSpec) ? 'Spin1' : 'Spin2';
      this.ctx.logger.log(`TRC: Object Scan of ${languageId} Document: ${docFSpec}`);
      this.spin2ObjectReferenceParser.locateReferencedObjects(document, currDocumentFindings); // for objects included
    }
    const includedFiles: string[] = skipIncludeScan == false ? currDocumentFindings.includeFilenames() : [];
    this.ctx.logger.log(`TRC: [${currDocumentFindings.instanceName()}] includedFiles=[${includedFiles}]`);

    if (includedFiles.length > 0) {
      // get include directories for this folder
      const additionalDirs: string[] = this.includeDiscovery.getIncludeDirsForFolder(currDocumentInProcess.folder);
      this.ctx.logger.log(`TRC: DP.process() include dirs for [${currDocumentInProcess.folder}]: [${additionalDirs}]`);
      // convert to matching filespecs
      const resolved: string[] = await resolveReferencedIncludes(includedFiles, currDocumentInProcess.folder, this.ctx, additionalDirs);
      this.ctx.logger.log(`TRC: -- STEP back from resolveReferencedIncludes()... resolved=[${resolved}]`);
      currDocumentInProcess.pushReferencedFileSpecs(...resolved);
      this.ctx.logger.log(`TRC: -- STEP scan the includes...`);
      if (currDocumentInProcess.referencedFileSpecsCount == 0) {
        this.ctx.logger.log(`TRC: EMPTY referencedFileSpecs=[${currDocumentInProcess.referencedFileSpecs}]`);
      } else {
        for (let index = 0; index < currDocumentInProcess.referencedFileSpecsCount; index++) {
          const possIncludeFSpec: string = currDocumentInProcess.referencedFileSpec(index);
          const basename: string = path.basename(possIncludeFSpec);
          this.ctx.logger.log(`TRC: referencedFileSpecs #${index + 1}: [${basename}]=[${possIncludeFSpec}]`);
        }
      }

      // preload the included documents, if not already
      //
      this.ctx.logger.log(`TRC: -- STEP preload any includes not already loaded...`);
      for (let index = 0; index < currDocumentInProcess.referencedFileSpecsCount; index++) {
        const fSpec = currDocumentInProcess.referencedFileSpec(index);
        if (!this.ctx.docsByFSpec.has(fSpec)) {
          this.ctx.logger.log(`TRC: loading include [${fSpec}]`);
          const doc = await readDocumentFromUri(`file://${fSpec}`, this.ctx);
          if (doc) {
            const IS_INCLUDE: boolean = true; // parameter def'n
            await this.process(doc, IS_INCLUDE);
            this.ctx.logger.log(`TRC: include [${fSpec}] loaded!`);
          } else {
            this.ctx.logger.log(`TRC: FAILED to load doc from [${fSpec}]!`);
          }
        } else {
          this.ctx.logger.log(`TRC: FOUND include already loaded! [${fSpec}]`);
        }
      }

      // add included documents to our map
      //
      this.ctx.logger.log(`TRC: -- STEP incorporate included docs into maps ...`);
      const objectReferences: Map<string, string> =
        skipIncludeScan == false ? currDocumentFindings.includedObjectNamesByFilename() : new Map<string, string>();
      const includeNames: string[] = currDocumentFindings.includeNamesForFilename(fileName);
      this.ctx.logger.log(
        `TRC: [${currDocumentFindings.instanceName()}] nameHashKeys=[${Array.from(objectReferences.keys())}], nameHashValues=[${Array.from(
          objectReferences.values()
        )}], includedFiles=[${includeNames}]`
      );
      const objectNames: string[] = Array.from(objectReferences.keys());
      const objectFileNames: string[] = Array.from(objectReferences.values());
      this.ctx.logger.log(
        `TRC: DP.process() hook-in includes for [${currDocumentFindings.instanceName()}]  objectNames=[${Array.from(
          objectNames
        )}]  objectFileNames=[${Array.from(objectFileNames)}]`
      );
      currDocumentFindings.clear(this.PARM_ALL_BUT_INCLUDES); // now clear it out for reload after we have includes
      this.ctx.logger.log(
        `TRC: [${currDocumentFindings.instanceName()}] clear() previous findings but NOT include info so can load included documents`
      );
      //
      // connnect our child objects so document will highlight child references
      for (let index = 0; index < objectNames.length; index++) {
        const objectName = objectNames[index];
        const objectSpinFilename = objectFileNames[index];
        let matchFilename: string = objectSpinFilename.toLowerCase();
        if (!matchFilename?.toLowerCase().includes('.spin')) {
          matchFilename = `${matchFilename}.`.toLowerCase();
        }
        this.ctx.logger.log(`TRC: MATCHING objectName=[${objectName}], matchFilename=[${matchFilename}]`);
        let bFound: boolean = false;
        for (let index = 0; index < currDocumentInProcess.referencedFileSpecsCount; index++) {
          const fSpec: string = currDocumentInProcess.referencedFileSpec(index);
          if (fSpec.toLowerCase().includes(matchFilename)) {
            bFound = true;
            // located, now add parse results for include to this document map of includes
            const processedInclude = this.ctx.docsByFSpec.get(fSpec);
            if (processedInclude) {
              this.ctx.logger.log(
                `TRC: registering [${objectName}]: [${processedInclude.parseResult.instanceName()}]: with=[${currDocumentFindings.instanceName()}]`
              );
              currDocumentFindings.enableLogging(this.ctx, true);
              currDocumentFindings.setFindingsForNamespace(objectName, processedInclude.parseResult);
              currDocumentFindings.enableLogging(this.ctx, false);
              //this.ctx.logger.log(`TRC: Added include findings for ${objectName}: "${objectSpinFilename}"`);
            } else {
              this.ctx.logger.log(`TRC: NO findings found for ${objectName}: "${objectSpinFilename}": uri=[${fSpec}]`);
            }
          }
        }
        if (!bFound) {
          this.ctx.logger.log(`TRC: NO object filename matches found!`);
        }
      }
      //
      // load symbols from included files so document will highlight these symbols as well
      for (let index = 0; index < includeNames.length; index++) {
        const includeFilename = includeNames[index];
        const includeSpinFilename = includeFilename;
        let matchFilename: string = includeFilename.toLowerCase();
        // allow filenames such as name.inc where fileType is present but NOT .spin or .spin2
        const hasFileExt: boolean = path.basename(matchFilename).includes('.');
        if (!matchFilename?.toLowerCase().includes('.spin') && hasFileExt == false) {
          matchFilename = `${matchFilename}.`.toLowerCase();
        }
        this.ctx.logger.log(`TRC: MATCHING includeFilename=[${includeFilename}], matchFilename=[${matchFilename}]`);
        let bFound: boolean = false;
        for (let index = 0; index < currDocumentInProcess.referencedFileSpecsCount; index++) {
          const fSpec: string = currDocumentInProcess.referencedFileSpec(index);
          if (fSpec.toLowerCase().includes(includeFilename)) {
            bFound = true;
            // located, now add parse results for include to this document map of includes
            const processedInclude = this.ctx.docsByFSpec.get(fSpec);
            if (processedInclude) {
              this.ctx.logger.log(
                `TRC: merging symbols from [${includeFilename}]: [${processedInclude.parseResult.instanceName()}]: into=[${currDocumentFindings.instanceName()}]`
              );
              currDocumentFindings.enableLogging(this.ctx, true);
              currDocumentFindings.loadIncludeSymbols(includeFilename, processedInclude.parseResult);
              currDocumentFindings.enableLogging(this.ctx, false);
              //this.ctx.logger.log(`TRC: Added include findings for ${objectName}: "${objectSpinFilename}"`);
            } else {
              this.ctx.logger.log(`TRC: NO findings found for ${includeFilename}: "${includeSpinFilename}": uri=[${fSpec}]`);
            }
          }
        }
        if (!bFound) {
          this.ctx.logger.log(`TRC: NO include filename matches found!`);
        }
      }
    } else {
      this.ctx.logger.log(`TRC: DP.process() [${currDocumentFindings.instanceName()}] No included files, just do final parse`);
    }

    // do actual parse to fill in DocumentFindings
    const parseReason: string = skipIncludeScan == false ? 'Actual-Parse' : 'Reload(includes-updated)';
    await this._parseDocument(currDocumentInProcess, parseReason, currDocumentFindings);

    this.ctx.logger.log(`TRC: DP.process() DONE processing [${currDocumentFindings.instanceName()}]`);
    return currDocumentInProcess;
  }

  private _reParseInOrder(docFspecList: string[]) {
    for (let index = 0; index < docFspecList.length; index++) {
      const docFSpec = docFspecList[index];
      const orderedList: string[] = [];
      this._getParseList(docFSpec, orderedList);
      if (orderedList.length > 0) {
        for (let index = 0; index < orderedList.length; index++) {
          const fSpec = orderedList[index];
          this.ctx.logger.log(`TRC: DP._reParseInOrder() #${index + 1}: fSpec=[${fSpec}]`);
        }
      } else {
        this.ctx.logger.log(`TRC: DP._reParseInOrder() Nothing found/returned`);
      }
    }
  }

  private _getParseList(FSpec: string, resultList: string[]) {
    // return depth-first list of included files
    const parsedDoc: ProcessedDocument | undefined = this.ctx.docsByFSpec.get(FSpec);
    if (parsedDoc) {
      for (let index = 0; index < parsedDoc.referencedFileSpecsCount; index++) {
        const includeFSpec = parsedDoc.referencedFileSpec(index);
        this._getParseList(includeFSpec, resultList);
      }
    }
    // only 1 copy of each fileSpec, please!
    if (!resultList.includes(FSpec)) {
      resultList.push(FSpec);
    }
  }

  private _parseDocument(processedDoc: ProcessedDocument, reason: string, parserFindings: DocumentFindings): void {
    this.ctx.logger.log(`TRC: DP._parseDocument() clear() previous findings - leaving include info [${parserFindings.instanceName()}]`);
    parserFindings.clear(this.PARM_ALL_BUT_INCLUDES);
    const document: TextDocument = processedDoc.document;
    const docBasename: string = path.basename(document.uri);
    if (isSpin1File(document.uri)) {
      this.ctx.logger.log(`TRC: DP._parseDocument() ${reason} Spin1 Document: ${docBasename}`);
      this.spin1symbolParser.reportDocumentSymbols(document, parserFindings); // for outline
      this.spin1semanticParser.reportDocumentSemanticTokens(document, parserFindings, processedDoc.folder); // for highlight
    } else {
      // Get include directories for this folder to pass to semantic parser
      const includeDirs: string[] = this.includeDiscovery.getIncludeDirsForFolder(processedDoc.folder);
      this.ctx.logger.log(`TRC: DP._parseDocument() ${reason} Spin2 Document: ${docBasename}, includeDirs=[${includeDirs}]`);
      this.spin2symbolParser.reportDocumentSymbols(document, parserFindings); // for outline
      this.spin2semanticParser.reportDocumentSemanticTokens(document, parserFindings, processedDoc.folder, includeDirs); // for highlight
    }
  }
}
