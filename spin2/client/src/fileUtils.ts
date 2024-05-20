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
    case 'pnut_ts':
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

export async function locateExe(exeName: string, possibleLocations: string[]): Promise<string | undefined> {
  let exeFSpec: string | undefined = undefined;
  const searchExeName = platformExeName(exeName);
  for (let index = 0; index < possibleLocations.length; index++) {
    const searchDir = possibleLocations[index];
    const searchFSpec = path.join(searchDir, searchExeName);
    const isExecutable = await executableExists(searchFSpec);
    if (isExecutable) {
      exeFSpec = searchFSpec;
      break;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return new Promise((resolve, reject) => {
    resolve(exeFSpec);
  });
}
