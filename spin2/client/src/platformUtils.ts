/* eslint-disable @typescript-eslint/no-unused-vars */
'use strict';

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import * as vscode from 'vscode'; // debug only

export function platformString(): string {
  let desiredOSName: string = '{unknown}';
  const platform = os.platform();

  if (platform === 'win32') {
    desiredOSName = 'Windows';
  } else if (platform === 'darwin') {
    desiredOSName = 'macOS';
  } else if (platform === 'linux') {
    desiredOSName = 'Linux';
  } else {
    desiredOSName = `Unknown?? platform: ${platform}`;
  }
  return desiredOSName;
}

export function usbDeviceNodeList(debugOutputChannel: vscode.OutputChannel): string[] {
  let foundDevices: string[] = [];
  const platform: string = platformString();
  if (platform == 'Windows') {
    // using mode or chgport get list of COM serial devices
    const output = child_process.execSync('mode').toString();
    const lines = output.split('\r\n').filter(Boolean);
    for (let index = 0; index < lines.length; index++) {
      const currLine = lines[index];
      if (currLine.includes('COM')) {
        const lineParts = currLine.split(/[ \t:]/).filter(Boolean);
        logMessage(`* FUNC usbDeviceNodeList() -> currLine=[${currLine}], lineParts=[${lineParts}](${lineParts.length})`, debugOutputChannel);
        for (let index = 0; index < lineParts.length; index++) {
          const possPort = lineParts[index];
          if (possPort.includes('COM')) {
            foundDevices.push(possPort);
          }
        }
      }
    }
  } else if (platform == 'macOS') {
    // query /dev/tty* for /dev/tty.usbserial* and/or /dev/cu* for /dev/cu.usbserial*
    const deviceNodeNames = getNamesLike('/dev', '/dev/tty.usbserial', debugOutputChannel);
    for (let index = 0; index < deviceNodeNames.length; index++) {
      const deviceNode = deviceNodeNames[index];
      if (deviceNode.includes('-')) {
        const nameParts = deviceNode.split('-');
        const newName = `${deviceNode},${nameParts[1]}`;
        foundDevices.push(newName);
      }
    }
  } else if (platform == 'Linux') {
    // query /dev/tty* for /dev/ttyUSB*
    foundDevices = getNamesLike('/dev', '/dev/ttyUSB', debugOutputChannel);
  }
  logMessage(`* FUNC usbDeviceNodeList() -> foundDevices=[${foundDevices}]`, debugOutputChannel);
  return foundDevices;
}

function getNamesLike(rootSpec: string, matchSpec: string, debugOutputChannel: vscode.OutputChannel): string[] {
  const files = fs.readdirSync(rootSpec);
  const namesFound = files.filter((file) => `${rootSpec}/${file}`.startsWith(matchSpec));
  const deviceNodeNames: string[] = [];
  for (let index = 0; index < namesFound.length; index++) {
    const deviceName = namesFound[index];
    deviceNodeNames.push(`${rootSpec}/${deviceName}`);
  }
  logMessage(`* FUNC getNamesLike([${rootSpec}], [${matchSpec}]) -> names=[${deviceNodeNames}]`, debugOutputChannel);
  return deviceNodeNames;
}

function logMessage(message: string, debugOutputChannel: vscode.OutputChannel): void {
  if (debugOutputChannel !== undefined) {
    //Write to output window.
    debugOutputChannel.appendLine(message);
  }
}
