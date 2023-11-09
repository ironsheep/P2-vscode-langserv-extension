"use strict";
// server/src/files.ts

import { TextDocument } from "vscode-languageserver-textdocument";
//import { constants, promises as fsp, fs } from "fs";
//import { extname, resolve, dirname } from "path";
import * as fs from "fs";
import * as path from "path";
//import * as ic from "iconv";
import { fileURLToPath } from "url";
import { Context } from "./context";

const { readFile, access } = fs.promises;

export async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false
  );
}

export function isSpin1File(fileSpec: string): boolean {
  let spinFileStatus: boolean = fileSpec.toLowerCase().endsWith(".spin");
  return spinFileStatus;
}

export function readDocumentFromUri(uri: string, ctx: Context): TextDocument | null {
  let content: string;
  const url = new URL(uri, "file://");
  ctx.logger.log(`TRC: readDocumentFromUri() url=[${url}]`);

  const languageId = isSpin1File(uri) ? "Spin" : "Spin2";
  const fspec: string = fileURLToPath(url);

  ctx.logger.log(`TRC: readDocumentFromUri() fspec=[${fspec}]`);
  try {
    //content = fs.readFileSync(fileURLToPath(url), "utf8");
    content = loadFileAsString(fspec, ctx);
  } catch (err) {
    ctx.logger.log(`TRC: readDocumentFromUri() fspec=[${fspec}] (exception! err=[${err}]) LOAD Failed!`);
    return null;
  }

  return TextDocument.create(uri, languageId, 0, content);
}

type ResolveContext = Pick<Context, "workspaceFolders" | "docsByFSpec">;

/**
 * convert list of filenames (possibly without type) to filespecs
 */

export function resolveReferencedIncludes(includedFiles: string[], rootDirSpec: string, ctx: Context): string[] {
  //const roots = ctx.workspaceFolders.map((f) => URI.parse(f.uri).fsPath);
  const rootDir = ctx.workspaceFolders[0];
  const matchedFiles: string[] = [];
  ctx.logger.log(`TRC: resolveReferencedIncludes(includedFiles=[${includedFiles}], rootDirSpec=[${rootDirSpec}])`);

  const fileSpecs: string[] = getSpinFilesInDirSync(rootDirSpec, ctx);
  ctx.logger.log(`TRC: found fileSpecs=[${fileSpecs}]`);
  for (let index = 0; index < includedFiles.length; index++) {
    const fileBaseName = includedFiles[index];
    let matchFilename: string = fileBaseName.toLowerCase();
    if (!fileBaseName.toLowerCase().includes(".spin")) {
      matchFilename = `${fileBaseName}.`.toLowerCase();
    }
    //ctx.logger.log(`TRC: looking for matchFilename=[${matchFilename}]`);
    for (let index = 0; index < fileSpecs.length; index++) {
      const fileSpec: string = fileSpecs[index];
      const pathParts: string[] = fileSpec.split("/");
      const fileName = pathParts[pathParts.length - 1].toLowerCase();
      //ctx.logger.log(`TRC: checking fileSpec=[${fileSpec}]`);
      if (fileName.startsWith(matchFilename)) {
        matchedFiles.push(fileSpec);
        //ctx.logger.log(`TRC: matched fileSpec=[${fileSpec}]`);
      }
    }
  }
  return matchedFiles;
}

/*
export function loadFileAsStringxx(fspec: string, ctx: Context): string {
  let fileContent: string = "";
  if (fs.existsSync(fspec)) {
    const detectCharacterEncoding = require("detect-character-encoding");
    const iconverter = new ic.Iconv("UTF-16", "UTF-8");
    try {
      const buffer = fs.readFileSync(fspec);
      const charsetMatch = detectCharacterEncoding(buffer);
      ctx.logger.log(`TRC: loadFileAsString() charsetMatch=[${charsetMatch}]`);

      fileContent = iconverter.convert(buffer).toString("utf8");
    } catch (err) {
      ctx.logger.log(`TRC: loadFileAsString() EXCEPTION: err=[${err}]`);
    }
  } else {
    ctx.logger.log(`TRC: loadFileAsString() fspec=[${fspec}] NOT FOUND!`);
  }
  return fileContent;
}
*/

/*
export function loadFileAsStringzzz(fspec: string, ctx: Context): string {
  let fileContent: string = "";
  if (fs.existsSync(fspec)) {
    ctx.logger.log(`TRC: loadFileAsString() attempt load of [${fspec}]`);
    try {
      const Iconv = require("iconv").Iconv;

      const buffer = fs.readFileSync(fspec);
      const iconv = new Iconv("UTF-16", "UTF-8");

      fileContent = iconv.convert(buffer).toString("utf8");
    } catch (err) {
      ctx.logger.log(`TRC: loadFileAsString() EXCEPTION: err=[${err}]`);
    }
  } else {
    ctx.logger.log(`TRC: loadFileAsString() fspec=[${fspec}] NOT FOUND!`);
  }
  return fileContent;
}
*/

export function loadFileAsString(fspec: string, ctx: Context): string {
  let fileContent: string = "";
  if (fs.existsSync(fspec)) {
    ctx.logger.log(`TRC: loadFileAsString() attempt load of [${fspec}]`);
    try {
      fileContent = fs.readFileSync(fspec, "utf-8");
      if (fileContent.includes("\x00")) {
        fileContent = fs.readFileSync(fspec, "utf16le");
      }
    } catch (err) {
      ctx.logger.log(`TRC: loadFileAsString() EXCEPTION: err=[${err}]`);
    }
  } else {
    ctx.logger.log(`TRC: loadFileAsString() fspec=[${fspec}] NOT FOUND!`);
  }
  return fileContent;
}

/**
 * Check whether file extension is SPIN source file
 */
export function isSpinExt(filename: string): boolean {
  return [".spin", ".spin2", ".p2asm"].includes(path.extname(filename).toLowerCase());
}

export function spin1FileExists(dirSpec: string, fileName: string): boolean {
  let existsStatus: boolean = false;
  if (dirSpec.length > 0) {
    // NOTE: dirSpec.length can be zero  if caller not yet set up correctly
    let desiredFilename: string = fileName;
    if (!fileName.toLowerCase().includes(".spin")) {
      desiredFilename = `${fileName}.spin`;
    }
    existsStatus = fileInDirExists(dirSpec, desiredFilename);
  }
  return existsStatus;
}

export function spin2FileExists(dirSpec: string, fileName: string): boolean {
  let existsStatus: boolean = false;
  if (dirSpec.length > 0) {
    // NOTE: dirSpec.length can be zero  if caller not yet set up correctly
    let desiredFilename: string = fileName;
    if (!fileName.toLowerCase().includes(".spin2")) {
      desiredFilename = `${fileName}.spin2`;
    }
    existsStatus = fileInDirExists(dirSpec, desiredFilename);
  }
  return existsStatus;
}

export function fileInDirExists(dirSpec: string, fileName: string, ctx: Context | undefined = undefined): boolean {
  let existsStatus: boolean = false;
  const url = new URL(path.join(dirSpec, fileName), "file://");
  const fspec: string = fileURLToPath(url);
  if (fileExists(fspec)) {
    // File exists in path
    existsStatus = true;
  }
  if (ctx) {
    ctx.logger.log(`TRC: fileInDirExists([${fspec}]) returns (${existsStatus})`);
  }
  return existsStatus;
}

export function fileExists(pathSpec: string): boolean {
  let existsStatus: boolean = false;
  if (fs.existsSync(pathSpec)) {
    // File exists in path
    existsStatus = true;
  }
  return existsStatus;
}

export function getSpinFilesInDirSync(dirSpec: string, ctx: Context): string[] {
  const resultList: string[] = [];
  const url = new URL(dirSpec, "file://");
  //const pathSpec = fileURLToPath(dirSpec);
  if (fs.existsSync(url)) {
    // Dir exists ...
    const tmpFiles: string[] = fs.readdirSync(url);
    tmpFiles.forEach((file) => {
      if (isSpinExt(file)) {
        resultList.push(path.join(dirSpec, file));
      }
    });
  } else {
    ctx.logger.log(`TRC: getSpinFilesInDirSync() dir NOT FOUND [${url}]`);
  }
  return resultList;
}

/**
 * Return list of SPIN source files in dir
 */
export async function getSpinFilesInDir(dirSpec: string): Promise<string[]> {
  const result: string[] = [];
  const url = new URL(dirSpec, "file://");

  try {
    await fs.promises.access(url, fs.constants.R_OK);
  } catch (_err) {
    return [];
  }

  for (const dirent of await fs.promises.readdir(url, { withFileTypes: true })) {
    const childFSpec = `${dirSpec}/${dirent.name}`;
    if (isSpinExt(dirent.name)) {
      result.push(childFSpec);
      /*
    } else if (dirent.isDirectory()) {
      const inDir = await getSpinFilesInDir(childFSpec);
      result.push(...inDir);
	  */
    }
  }

  return result;
}

/**
 * Determine if uri points to directory
 */
export async function isDir(uri: string): Promise<boolean> {
  return (await fs.promises.stat(new URL(uri))).isDirectory();
}
