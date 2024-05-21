'use strict';
import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem | null;

export const createStatusBarCompileDebugItem = () => {
  if (statusBarItem != null) {
    return statusBarItem;
  }

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'spinExtension.toggle.debug';
  statusBarItem.text = '?NEED-VALUE?'; // testing
  statusBarItem.show();

  updateStatusBarCompileDebugItem(null); // hide status bar content

  return statusBarItem;
};

export const destroyStatusBarCompileDebugItem = () => {
  if (statusBarItem == null) {
    return;
  }

  statusBarItem.hide();
  statusBarItem = null;
};

export function getCompileDebugMode(): boolean {
  const toolchainConfig = vscode.workspace.getConfiguration(`spinExtension.toolchain`);
  const debugValue: boolean | undefined = toolchainConfig.get<boolean>('optionsCompile.enableDebug');
  const currValue: boolean = debugValue !== undefined ? debugValue : false;
  return currValue;
}

export const updateStatusBarCompileDebugItem = (showItem: boolean | null) => {
  if (statusBarItem != null) {
    if (showItem == null || showItem == false) {
      statusBarItem.text = '';
      statusBarItem.tooltip = '';

      statusBarItem.hide();
    } else {
      let sbiText: string | undefined = undefined;

      const isDebugEnabled: boolean = getCompileDebugMode();

      if (isDebugEnabled) {
        sbiText = 'Debug: ON';
        statusBarItem.tooltip = 'Compiling with DEBUG, click to disable';
      } else {
        sbiText = 'Debug: off';
        statusBarItem.tooltip = 'NOT compiling with DEBUG, click to enable';
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
