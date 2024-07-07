'use strict';
import * as vscode from 'vscode';
import { toolchainConfiguration } from './spin.toolChain.configuration';

let statusBarItem: vscode.StatusBarItem | null;

export const createStatusBarFlashDownloadItem = () => {
  if (statusBarItem != null) {
    return statusBarItem;
  }

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'spinExtension.toggle.flash';
  statusBarItem.text = '?NEED-VALUE?'; // testing
  statusBarItem.show();

  updateStatusBarFlashDownloadItem(null); // hide status bar content

  return statusBarItem;
};

export const destroyStatusBarFlashDownloadItem = () => {
  if (statusBarItem == null) {
    return;
  }

  statusBarItem.hide();
  statusBarItem = null;
};

export const updateStatusBarFlashDownloadItem = (showItem: boolean | null) => {
  if (statusBarItem != null) {
    if (showItem == null || showItem == false) {
      statusBarItem.text = '';
      statusBarItem.tooltip = '';

      statusBarItem.hide();
    } else {
      let sbiText: string | undefined = undefined;

      const isFLASHEnabled: boolean = toolchainConfiguration.writeFlashEnabled;

      if (isFLASHEnabled) {
        sbiText = 'Dnld: FLASH';
        statusBarItem.tooltip = 'Download to FLASH, click to change to RAM';
      } else {
        sbiText = 'Dnld: RAM';
        statusBarItem.tooltip = 'Download to RAM, click to change to FLASH';
      }
      if (sbiText === undefined || sbiText == null) sbiText = '';

      // preparation for https://github.com/DrMerfy/vscode-overtype/issues/2
      // if (editModeConfiguration.showCapsLockState && capsLockOn) {
      //     statusBarItem.text = sbiText.toUpperCase();
      // } else {
      statusBarItem.text = sbiText;
      // }

      statusBarItem.show();
    }
  }
};
