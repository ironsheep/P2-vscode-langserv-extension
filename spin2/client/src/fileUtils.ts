'use strict';
// client/src/fileUtils.ts

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export function platform(): string {
  const platform = os.platform();
  return platform;
}

export function isWindows(): boolean {
  return os.platform() == 'win32';
}

export function isMac(): boolean {
  return os.platform() == 'darwin';
}

export function executableExists(exeFspec: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return new Promise((resolve, reject) => {
    fs.access(exeFspec, fs.constants.X_OK, (err) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

export function platformExeName(exeName: string): string {
  let searchExeName: string = exeName;
  switch (searchExeName) {
    case 'loadp2':
      if (isMac()) {
        searchExeName = `${exeName}.mac`;
      } else if (isWindows()) {
        searchExeName = `${exeName}.exe`;
      }
      break;
    case 'proploader':
      if (isMac()) {
        searchExeName = `${exeName}.mac`;
      } else if (isWindows()) {
        searchExeName = `${exeName}.exe`;
      }
      break;
    case 'pnut_ts':
      if (isWindows()) {
        searchExeName = `${exeName}.exe`;
      }
      break;
    case 'flexspin':
      if (isMac()) {
        searchExeName = `${exeName}.mac`;
      } else if (isWindows()) {
        searchExeName = `${exeName}.exe`;
      }
      break;

    default:
      break;
  }
  return searchExeName;
}

export function locateNonExe(fileName: string, possibleLocations: string[]): string | undefined {
  let fileFSpec: string | undefined = undefined;
  for (let index = 0; index < possibleLocations.length; index++) {
    const searchDir = possibleLocations[index];
    const searchFSpec = path.join(searchDir, fileName);
    const fileExists = fs.existsSync(searchFSpec);
    if (fileExists) {
      fileFSpec = searchFSpec;
      break;
    }
  }
  return fileFSpec;
}

export async function locateExe(exeName: string, possibleLocations: string[]): Promise<[string | undefined, string[]]> {
  let exeFSpec: string | undefined = undefined;
  const allFSpecs: string[] = [];

  // FIXME: adjust to reutrn all values found not just first
  const searchExeName = platformExeName(exeName);
  for (let index = 0; index < possibleLocations.length; index++) {
    const searchDir = possibleLocations[index];
    const searchFSpec = path.join(searchDir, searchExeName);
    const isExecutable = await executableExists(searchFSpec);
    if (isExecutable) {
      if (exeFSpec === undefined) {
        // return first found
        exeFSpec = searchFSpec;
      }
      // return all found
      allFSpecs.push(searchFSpec);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return new Promise((resolve, reject) => {
    resolve([exeFSpec, allFSpecs]);
  });
}

/**
 * Checks if a file exists.
 * @param {string} pathSpec - The path to the file.
 * @returns {boolean} True if the file exists, false otherwise.
 */
export function fileExists(pathSpec: string): boolean {
  let existsStatus: boolean = false;
  if (fs.existsSync(pathSpec)) {
    // File exists in path
    existsStatus = true;
  }
  return existsStatus;
}

export function writeBinaryFile(binaryImage: Uint8Array, fspec: string) {
  //const filename: string = path.basename(fspec);
  //logExtensionMessage(`  -- writing BIN file (${binaryImage.length} bytes) to ${filename}`);
  const stream = fs.createWriteStream(fspec);

  const buffer = Buffer.from(binaryImage.buffer, 0, binaryImage.length);
  stream.write(buffer);

  // Close the stream
  stream.end();
  //logExtensionMessage(`Wrote ${filename} (${binaryImage.length} bytes)`);
}

const EMPTY_CONTENT_MARKER: string = 'XY$$ZZY';

export function loadFileAsUint8Array(fspec: string): Uint8Array {
  let fileContent: Uint8Array = new Uint8Array();
  if (fs.existsSync(fspec)) {
    try {
      const buffer = fs.readFileSync(fspec);
      fileContent = new Uint8Array(buffer);
      //if (ctx) ctx.logger.logMessage(`loaded (${fileContent.length}) bytes from [${path.basename(fspec)}]`);
    } catch (err) {
      //ctx.logger.log(`TRC: loadFileAsString() fspec=[${fspec}] NOT FOUND!`);
      const encoder = new TextEncoder();
      fileContent = new Uint8Array(encoder.encode(EMPTY_CONTENT_MARKER));
    }
  }
  return fileContent;
}

export function loadUint8ArrayFailed(content: Uint8Array): boolean {
  // Convert Uint8Array back to string
  const decoder = new TextDecoder();
  const checkContent = content.length > 7 ? content.slice(0, 7) : content;
  const decodedString = decoder.decode(checkContent);
  // Test if decoded string is 'XY$$ZZY'
  const emptyStatus = decodedString === EMPTY_CONTENT_MARKER;
  return emptyStatus;
}
