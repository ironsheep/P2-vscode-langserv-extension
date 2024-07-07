/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as path from 'path';

export let doc: vscode.TextDocument;
export let editor: vscode.TextEditor;
export let documentEol: string;
export let platformEol: string;

/**
 * Activates the IronSheep.spin2 extension
 */
export async function activate(docUri: vscode.Uri): Promise<void> {
  // The extensionId is `publisher.name` from package.json
  const ext = vscode.extensions.getExtension('IronSheepProductionsLLC.spin2')!;
  await ext.activate();
  try {
    doc = await vscode.workspace.openTextDocument(docUri);
    editor = await vscode.window.showTextDocument(doc);
    await sleep(2000); // Wait for server activation
  } catch (e) {
    console.error(e);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const getDocPath = (p: string) => {
  return path.resolve(__dirname, '../../testFixture', p);
};
export const getDocUri = (p: string) => {
  return vscode.Uri.file(getDocPath(p));
};

export async function setTestContent(content: string): Promise<boolean> {
  const all = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
  return editor.edit((eb) => eb.replace(all, content));
}

export function isArray(possArray: any): boolean {
  return !!possArray && possArray.constructor === Array;
}

export function isString(possString: any): boolean {
  return !!possString && possString.constructor === String;
}

export function isNumber(possNumber: any): boolean {
  return !!possNumber && possNumber.constructor === Number;
}

export function isMap(possMap: any): boolean {
  return !!possMap && possMap.constructor === Map;
}

export function isHash(possHash: any): boolean {
  return !!possHash && possHash.constructor === Object;
}

export function showObject(responseObject: any, level: number = 0, idString: string = undefined): string {
  const answerStrings: string[] = [];
  const padding: string = ' '.repeat(level * 2);
  const bIsTopeLevel: boolean = idString === undefined;
  const typeString: string = objectTypeString(responseObject);
  if (bIsTopeLevel) {
    answerStrings.push(``);
    answerStrings.push(`${padding}  Exploring ${typeString}:`);
  } else {
    answerStrings.push(`${padding}   - [${idString}] ${typeString}:`);
  }
  if (isArray(responseObject)) {
    answerStrings.push(describeArray(responseObject, level + 1));
  } else if (isMap(responseObject)) {
    answerStrings.push(describeMap(responseObject, level + 1));
  } else if (isHash(responseObject)) {
    answerStrings.push(describeHash(responseObject, level + 1));
  } else {
    answerStrings.push(JSON.stringify(responseObject));
  }
  if (bIsTopeLevel) {
    answerStrings.push(``);
  }
  return answerStrings.join('\n');
}

function objectTypeString(possObject: any): string {
  let typeString: string = isArray(possObject) ? 'array[]' : 'object??';
  if (isMap(possObject)) {
    typeString = 'map<k,v>';
  } else if (isHash(possObject)) {
    typeString = 'hash{}';
  } else if (isNumber(possObject)) {
    typeString = 'Number';
  } else if (isString(possObject)) {
    typeString = 'String';
  }
  return typeString;
}

function describeArray(array: [], level: number): string {
  const answerStrings: string[] = [];
  const padding = ' '.repeat(level * 2);
  answerStrings.push(`${padding} - array of ${array.length} elements`);
  for (let index = 0; index < array.length; index++) {
    const element = array[index];
    answerStrings.push(showObject(element, level + 1, index.toString()));
  }
  return answerStrings.join('\n');
}
function describeMap(mapObject: Map<any, any>, level: number): string {
  const answerStrings: string[] = [];
  const padding = ' '.repeat(level * 2);
  answerStrings.push(`${padding} - Map of ${mapObject.size} objects`);
  return answerStrings.join('\n');
}
function describeHash(hashObject: {}, level: number): string {
  const answerStrings: string[] = [];
  const padding = ' '.repeat(level * 2);
  let keyCount = 0;
  for (const key in hashObject) {
    keyCount++;
    const value = hashObject[key];
    const typeString: string = objectTypeString(value);
    if (isArray(value)) {
      answerStrings.push(`${padding}  -- key [${key}] of [${typeString}] w/${value.length} Entries`);
      answerStrings.push(showObject(value, level + 1, key));
    } else if (isHash(value)) {
      answerStrings.push(showObject(value, level + 1, key));
    } else {
      answerStrings.push(`${padding}   -- key [${key}] of [${typeString}]`);
    }
    // Use `key` and `value`
  }
  return answerStrings.join('\n');
}
