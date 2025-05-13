'use strict';
import * as vscode from 'vscode';
import { toolchainConfiguration } from './spin.toolChain.configuration';

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

export const updateStatusBarCompileDebugItem = (showItem: boolean | null) => {
  if (statusBarItem != null) {
    if (showItem == null || showItem == false) {
      statusBarItem.text = '';
      statusBarItem.tooltip = '';

      statusBarItem.hide();
    } else {
      let sbiText: string = '';

      const isDebugEnabled: boolean = toolchainConfiguration.debugEnabled;

      if (isDebugEnabled) {
        sbiText = 'Debug: ON';
        statusBarItem.tooltip = 'Compiling with DEBUG, click to disable';
      } else {
        sbiText = 'Debug: off';
        statusBarItem.tooltip = 'NOT compiling with DEBUG, click to enable';
      }

      statusBarItem.text = sbiText;

      statusBarItem.show();
    }
  }
};
