'use strict';
// src/extensions.ts

import * as lsp from 'vscode-languageserver';
import { Provider } from '.';
import { Context } from '../context';
//import { getDefinitions } from "../symbols";
import * as path from 'path';
import { Position, Location } from 'vscode-languageserver-types';
import { DocumentFindings, ILocationOfToken } from '../parser/spin.semantic.findings';
import { fileSpecFromURI } from '../parser/lang.utils';
import { ExtensionUtils } from '../parser/spin.extension.utils';
import { Range, TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentLineAt } from '../parser/lsp.textDocument.utils';
//import { URI } from "vscode-uri";

export interface NamedSymbol {
  location: Location;
  name: string;
}

export interface Literal {
  location: Location;
  text: string;
}
/*
export interface Definition extends NamedSymbol {
  type: DefinitionType;
  selectionRange: lsp.Range;
  locals?: Map<string, Definition>;
  comment?: string;
}
*/

export enum DefinitionType {
  Section = 'section',
  Label = 'label',
  Constant = 'constant',
  Variable = 'variable',
  Register = 'register',
  RegisterList = 'register_list',
  Offset = 'offset',
  Macro = 'macro',
  XRef = 'xref'
}

export interface FindingsAtPostion {
  position: Position;
  objectReference: string;
  selectedWord: string;
}

export default class DefinitionProvider implements Provider {
  private isDebugLogEnabled: boolean = true; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private bLogStarted: boolean = false;
  private extensionUtils: ExtensionUtils;

  constructor(protected readonly ctx: Context) {
    this.extensionUtils = new ExtensionUtils(ctx, this.isDebugLogEnabled);
    if (this.isDebugLogEnabled) {
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        this._logMessage('Spin Hover log started.');
      } else {
        this._logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }
  }
  /**
   * Write message to debug log (when debug enabled)
   * @param message - text to be written
   * @returns nothing
   */
  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled) {
      //Write to output window.
      this.ctx.logger.log(message);
    }
  }

  async handleGetDefinitions({ textDocument, position }: lsp.DefinitionParams): Promise<Location[]> {
    //const defLocation: Location[] = [];
    const docFSpec: string = fileSpecFromURI(textDocument.uri);
    const processed = this.ctx.docsByFSpec.get(docFSpec);
    if (!processed) {
      return [];
    }
    const documentFindings: DocumentFindings | undefined = this.ctx.docsByFSpec.get(docFSpec)?.parseResult;
    if (!documentFindings) {
      return []; // empty case
    }
    const symbolsFound: DocumentFindings = documentFindings;
    symbolsFound.enableLogging(this.ctx, this.isDebugLogEnabled);

    const symbolIdent: FindingsAtPostion | undefined = this.symbolAtLocation(processed.document, position, symbolsFound);
    if (!symbolIdent) {
      return []; // empty case
    }

    const definitionResults: Location[] = [];
    const filteredLocations: ILocationOfToken[] = this.getDefinitions(symbolIdent, symbolsFound, position);
    this._logMessage(`+ Defn: filteredLocations=[${JSON.stringify(filteredLocations)}]`);
    // for each location translate object ref to URI then build a Definition and add it to return list
    for (let index = 0; index < filteredLocations.length; index++) {
      const tokenLocation = filteredLocations[index];
      const uri = tokenLocation.uri;
      const range: Range = { start: tokenLocation.position, end: tokenLocation.position };
      this._logMessage(`+ Defn: found Locn=[ln=${tokenLocation.position.line}, char=${tokenLocation.position.character}] in uri=[${uri}]`);
      definitionResults.push({
        uri,
        range
      });
    }

    return definitionResults;
  }

  register(connection: lsp.Connection) {
    connection.onDefinition(this.handleGetDefinitions.bind(this));
    return {
      definitionProvider: true
    };
  }

  private getDefinitions(symbolAtCursor: FindingsAtPostion, symbolsFound: DocumentFindings, position: Position): ILocationOfToken[] {
    // given symbol at position: for all symbolSets look for name as globle token or local token, return all found
    // NOTE: position is cursor position in doc at location of request

    // set this object
    // for all namespaces in this object search them (recursively)
    const rawLocations: ILocationOfToken[] = symbolsFound.locationsOfToken(symbolAtCursor.selectedWord, position);
    this._logMessage(`+ Defn: objectReference=(${symbolAtCursor.objectReference}), rawLocations=[${JSON.stringify(rawLocations)}]`);
    const filteredLocations: ILocationOfToken[] = [];
    // for each location
    for (let index = 0; index < rawLocations.length; index++) {
      const tokenLocation = rawLocations[index];
      // if object is specified, return only locations from desired object
      if (symbolAtCursor.objectReference.length > 0 && symbolAtCursor.objectReference.toLowerCase() !== tokenLocation.objectName) {
        continue; // skip one we don't care about
      }
      //  - translate object names/top to uri
      //  - then generate Definition
      filteredLocations.push(tokenLocation);
    }
    this._logMessage(`+ Defn: getDefinitions() returning ${filteredLocations.length} locations`);

    return filteredLocations;
  }

  private symbolAtLocation(document: TextDocument, position: Position, symbolsFound: DocumentFindings): FindingsAtPostion | undefined {
    this._logMessage(`+ Defn: definitionLocation() ENTRY`);
    const isPositionInBlockComment: boolean = symbolsFound.isLineInBlockComment(position.line);
    const inPasmCodeStatus: boolean = symbolsFound.isLineInPasmCode(position.line);
    const inObjDeclarationStatus: boolean = symbolsFound.isLineObjDeclaration(position.line);
    // NOTE: document and cursor position are the same for now
    const adjustedPos = this.extensionUtils.adjustWordPosition(document, position, position, isPositionInBlockComment, inPasmCodeStatus);
    if (!adjustedPos[0]) {
      this._logMessage(`+ Defn: definitionLocation() EXIT fail`);
      return undefined;
    }
    const declarationLine: string = DocumentLineAt(document, position).trimEnd();
    let objectRef = inObjDeclarationStatus ? this._objectNameFromDeclaration(declarationLine) : adjustedPos[1];

    const wordUnderCursor: string = adjustedPos[2];
    if (objectRef === wordUnderCursor) {
      objectRef = '';
    }
    const sourcePosition: Position = adjustedPos[3];
    const fileBasename = path.basename(document.uri);
    this._logMessage(
      `+ Defn: wordUnderCursor=[${wordUnderCursor}], inObjDecl=(${inObjDeclarationStatus}), objectRef=(${objectRef}), adjPos=(${position.line},${position.character}), file=[${fileBasename}], line=[${declarationLine}]`
    );

    return {
      position: sourcePosition,
      objectReference: objectRef,
      selectedWord: wordUnderCursor
    };
  }

  private _objectNameFromDeclaration(line: string): string {
    let desiredString: string = '';
    // parse object declaration forms:
    // ex:  child1 : "dummy_child" | MULTIplIER = 3, CoUNT = 5
    //      child1[4] : "dummy_child" | MULTIplIER = 3, CoUNT = 5
    //      child1[child.MAX_CT] : "dummy_child" | MULTIplIER = 3, CoUNT = 5
    if (line.includes(':')) {
      let lineParts: string[] = line.split(':');
      //this._logMessage(`+ Defn: _getObjName() :-split lineParts=[${lineParts}](${lineParts.length})`);
      if (lineParts.length >= 2) {
        const instanceName = lineParts[0].trim();
        if (instanceName.includes('[')) {
          lineParts = instanceName.split('[');
          //this._logMessage(`+ Defn: _getObjName() [-split lineParts=[${lineParts}](${lineParts.length})`);
          if (lineParts.length >= 2) {
            desiredString = lineParts[0].trim();
          }
        } else {
          desiredString = instanceName;
        }
      }
    }
    //this._logMessage(`+ Defn: _getObjName([${line}]) returns [${desiredString}]`);

    return desiredString;
  }
}
