/* eslint-disable @typescript-eslint/no-unused-vars */
'use strict';
import * as fs from 'fs';
import path = require('path');
// src/spin.vscode.fileUtils.ts

import * as vscode from 'vscode';

export function extDir(context: vscode.ExtensionContext): vscode.Uri {
  // Get the path to the 'ext' distribution directory
  // Get the Uri of the 'ext' distribution directory
  const extDirUri = vscode.Uri.joinPath(context.extensionUri, 'client', 'out', 'ext');
  return extDirUri;
}

export function extFile(context: vscode.ExtensionContext, filename: string): vscode.Uri {
  // Get the path to the 'ext' distribution file
  // Get the Uri of the 'ext' distribution file
  const extFileUri = vscode.Uri.joinPath(extDir(context), filename);
  return extFileUri;
}

export function getFlashLoaderBin(context: vscode.ExtensionContext): Uint8Array {
  // Get the path to the 'ext' distribution file
  const flashLoaderBinUri = extFile(context, 'flash_loader.obj');
  // Read the file
  const flashLoaderBuffer = fs.readFileSync(flashLoaderBinUri.fsPath);
  // Convert the Buffer to a Uint8Array
  const flashLoaderBin = new Uint8Array(flashLoaderBuffer.buffer);
  return flashLoaderBin;
}
