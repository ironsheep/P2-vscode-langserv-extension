'use strict';
import * as vscode from 'vscode';
import { toolchainConfiguration } from './spin.toolChain.configuration';
import { isWindows } from '../fileUtils';

let statusBarItem: vscode.StatusBarItem | null;

export const createStatusBarPropPlugItem = () => {
  if (statusBarItem != null) {
    return statusBarItem;
  }

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'spinExtension.select.propplug';
  statusBarItem.text = '?NEED-VALUE?'; // testing
  statusBarItem.show();

  updateStatusBarPropPlugItem(null); // hide status bar content

  return statusBarItem;
};

export const destroyStatusBarPropPlugItem = () => {
  if (statusBarItem == null) {
    return;
  }

  statusBarItem.hide();
  statusBarItem = null;
};

let availablePlugCount: number = 0;

export function getPropPlugSerialNumber(): string {
  const deviceName: string | undefined = toolchainConfiguration.selectedPropPlug;
  let desiredInterp: string = 'None';
  availablePlugCount = Object.keys(toolchainConfiguration.deviceNodesFound).length;
  if (availablePlugCount > 0) {
    desiredInterp = 'Not';
    if (deviceName !== undefined) {
      // now convert this to S/N
      for (const deviceNode of Object.keys(toolchainConfiguration.deviceNodesFound)) {
        const serialNumber = toolchainConfiguration.deviceNodesFound[deviceNode];
        // Now you can use deviceNode and serialNumber
        if (deviceName == deviceNode) {
          if (isWindows()) {
            // On windows show COMn:SerialNumber
            desiredInterp = `${deviceName}:${serialNumber}`;
          } else {
            // On non-windows show SerialNumber in status bar
            desiredInterp = serialNumber;
          }
          break;
        }
      }
    }
  }
  return desiredInterp;
}

export const updateStatusBarPropPlugItem = (showItem: boolean | null) => {
  if (statusBarItem != null) {
    if (showItem == null || showItem == false) {
      statusBarItem.text = '';
      statusBarItem.tooltip = '';

      statusBarItem.hide();
    } else {
      let sbiText: string | undefined = undefined;

      const StateOrSN = getPropPlugSerialNumber();

      if (StateOrSN == 'Not') {
        sbiText = 'Plug: Not Selected';
        statusBarItem.tooltip = 'No PropPlug Selected, Click to change';
      } else if (StateOrSN == 'None') {
        sbiText = 'Plug: N/A';
        statusBarItem.tooltip = 'No PropPlugs Found, plug one in to use it';
      } else {
        sbiText = `Plug: ${StateOrSN}`;
        const additionalText: string = availablePlugCount > 1 ? ', Click to change' : '';
        statusBarItem.tooltip = `Downloading via PropPlug S/N ${StateOrSN}${additionalText}`;
      }
      if (sbiText === undefined || sbiText == null) sbiText = '';

      statusBarItem.text = sbiText;

      statusBarItem.show();
    }
  }
};
