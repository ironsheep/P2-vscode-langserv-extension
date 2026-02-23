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
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
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
    const filteredLocations: ILocationOfToken[] = this.getDefinitions(symbolIdent, symbolsFound, position, processed.document);
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

  private getDefinitions(
    symbolAtCursor: FindingsAtPostion,
    symbolsFound: DocumentFindings,
    position: Position,
    document: TextDocument
  ): ILocationOfToken[] {
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

    // If we have an object reference but no results, check if it's a struct instance
    // (e.g., "myVar.fieldName" where myVar is a struct instance, or "myVar.a.x" for nested structs)
    if (filteredLocations.length === 0 && symbolAtCursor.objectReference.length > 0) {
      const structLocation = this._resolveStructFieldDefinition(symbolAtCursor, symbolsFound, position, document);
      if (structLocation) {
        filteredLocations.push(structLocation);
      }
    }

    this._logMessage(`+ Defn: getDefinitions() returning ${filteredLocations.length} locations`);

    return filteredLocations;
  }

  private _resolveStructFieldDefinition(
    symbolAtCursor: FindingsAtPostion,
    symbolsFound: DocumentFindings,
    position: Position,
    document: TextDocument
  ): ILocationOfToken | undefined {
    const instanceName = symbolAtCursor.objectReference;
    const fieldName = symbolAtCursor.selectedWord;

    // First try a direct single-level lookup: instanceName is a struct variable, fieldName is its member
    const directResult = this._resolveStructField(instanceName, fieldName, symbolsFound, position);
    if (directResult) {
      return directResult;
    }

    // Direct lookup failed — the objectRef may be a struct member, not a variable.
    // Extract the full dotted expression from the line text and walk the chain.
    // e.g., for "pline.a.x" with cursor on 'x': objectRef='a', word='x'
    //   but 'a' is a member of 'line', not a variable. We need the full path: pline -> a -> x
    const lineText = DocumentLineAt(document, position).trimEnd();
    const dottedPath = this._extractDottedPath(lineText, position.character);
    if (!dottedPath || dottedPath.length < 2) {
      this._logMessage(`+ Defn: _resolveStructField() no dotted path found at cursor`);
      return undefined;
    }

    this._logMessage(`+ Defn: _resolveStructField() walking chain: [${dottedPath.join('.')}], target=[${fieldName}]`);

    // Walk the chain: first segment must be a struct instance variable
    const rootName = dottedPath[0];
    let structTypeName = symbolsFound.getTypeForLocalStructureInstance(rootName, position.line);
    if (!structTypeName) {
      structTypeName = symbolsFound.getTypeForStructureInstance(rootName);
    }
    if (!structTypeName) {
      this._logMessage(`+ Defn: _resolveStructField() root [${rootName}] is not a struct instance`);
      return undefined;
    }

    // Walk intermediate segments to resolve the struct type chain
    let currentStructDefn = this._getStructDefn(structTypeName, symbolsFound);
    if (!currentStructDefn) {
      this._logMessage(`+ Defn: _resolveStructField() struct type [${structTypeName}] not found`);
      return undefined;
    }

    // Walk from segment 1 to the target segment (which is the one the cursor is on)
    for (let i = 1; i < dottedPath.length; i++) {
      const segmentName = dottedPath[i];
      const member = currentStructDefn.memberNamed(segmentName);
      if (!member) {
        this._logMessage(`+ Defn: _resolveStructField() member [${segmentName}] not found in struct [${currentStructDefn.name}]`);
        return undefined;
      }

      // If this is the target segment (the one the cursor is on), return the struct declaration
      if (segmentName.toLowerCase() === fieldName.toLowerCase()) {
        this._logMessage(
          `+ Defn: _resolveStructField() resolved [${dottedPath.slice(0, i + 1).join('.')}] -> struct [${currentStructDefn.name}] at Ln#${currentStructDefn.lineIndex}`
        );
        return {
          uri: symbolsFound.uri,
          objectName: 'top',
          position: { line: currentStructDefn.lineIndex, character: currentStructDefn.charOffset }
        };
      }

      // Not the target — this member must be a struct type to continue the chain
      if (!member.isStructure) {
        this._logMessage(`+ Defn: _resolveStructField() member [${segmentName}] is not a struct type, cannot continue chain`);
        return undefined;
      }

      // Resolve the member's struct type for the next iteration
      currentStructDefn = this._getStructDefn(member.structName, symbolsFound);
      if (!currentStructDefn) {
        this._logMessage(`+ Defn: _resolveStructField() struct type [${member.structName}] for member [${segmentName}] not found`);
        return undefined;
      }
    }

    return undefined;
  }

  private _resolveStructField(
    instanceName: string,
    fieldName: string,
    symbolsFound: DocumentFindings,
    position: Position
  ): ILocationOfToken | undefined {
    // Try local struct instance first (method-scoped), then global (VAR/DAT-scoped)
    let structTypeName = symbolsFound.getTypeForLocalStructureInstance(instanceName, position.line);
    if (!structTypeName) {
      structTypeName = symbolsFound.getTypeForStructureInstance(instanceName);
    }
    if (!structTypeName) {
      return undefined;
    }

    this._logMessage(`+ Defn: _resolveStructField() [${instanceName}] is struct type [${structTypeName}]`);

    const structDefn = this._getStructDefn(structTypeName, symbolsFound);
    if (!structDefn) {
      this._logMessage(`+ Defn: _resolveStructField() struct type [${structTypeName}] not found`);
      return undefined;
    }

    if (!structDefn.hasMemberNamed(fieldName)) {
      this._logMessage(`+ Defn: _resolveStructField() field [${fieldName}] not found in struct [${structTypeName}]`);
      return undefined;
    }

    this._logMessage(
      `+ Defn: _resolveStructField() found field [${fieldName}] in struct [${structTypeName}] at Ln#${structDefn.lineIndex}, Ch#${structDefn.charOffset}`
    );

    return {
      uri: symbolsFound.uri,
      objectName: 'top',
      position: { line: structDefn.lineIndex, character: structDefn.charOffset }
    };
  }

  private _getStructDefn(structTypeName: string, symbolsFound: DocumentFindings) {
    let structDefn = symbolsFound.getStructure(structTypeName);
    if (!structDefn && structTypeName.includes('.')) {
      // External object struct type — resolve via child object's findings
      const dotIdx = structTypeName.indexOf('.');
      const objName = structTypeName.substring(0, dotIdx);
      const typeName = structTypeName.substring(dotIdx + 1);
      const childFindings = symbolsFound.getFindingsForNamespace(objName);
      if (childFindings) {
        structDefn = childFindings.getStructure(typeName);
      }
    }
    return structDefn;
  }

  private _extractDottedPath(lineText: string, cursorChar: number): string[] | undefined {
    // From the cursor position, scan left and right to find the full dotted expression
    // (e.g., "pline.a.x" when cursor is anywhere within it)
    const wordChars = /[a-zA-Z0-9_]/;

    // Find the start of the dotted expression
    let start = cursorChar;
    while (start > 0) {
      const ch = lineText.charAt(start - 1);
      if (wordChars.test(ch) || ch === '.') {
        start--;
      } else {
        break;
      }
    }

    // Find the end of the dotted expression
    let end = cursorChar;
    while (end < lineText.length) {
      const ch = lineText.charAt(end);
      if (wordChars.test(ch) || ch === '.') {
        end++;
      } else {
        break;
      }
    }

    const fullExpr = lineText.substring(start, end);
    if (!fullExpr.includes('.')) {
      return undefined;
    }

    // Split and filter out empty segments (from leading/trailing dots)
    const parts = fullExpr.split('.').filter((p) => p.length > 0);
    this._logMessage(`+ Defn: _extractDottedPath() expr=[${fullExpr}], parts=[${parts.join(', ')}]`);
    return parts.length >= 2 ? parts : undefined;
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
