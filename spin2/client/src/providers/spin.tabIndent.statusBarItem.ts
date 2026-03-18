'use strict';
// client/src/providers/spin.tabIndent.statusBarItem.ts
//
// Status bar item showing current formatter tab/indent settings.
// Displays "Spaces: N" or "Tabs: N" to indicate the active style.
// Clicking opens the Spin2 formatter settings.

import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem | null;

export const createStatusBarTabIndentItem = () => {
  if (statusBarItem != null) {
    return statusBarItem;
  }

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  statusBarItem.command = 'spinExtension.formatter.showTabSettings';
  statusBarItem.text = '?NEED-VALUE?'; // testing
  statusBarItem.show();

  updateStatusBarTabIndentItem(null); // hide initially

  return statusBarItem;
};

export const destroyStatusBarTabIndentItem = () => {
  if (statusBarItem == null) {
    return;
  }

  statusBarItem.hide();
  statusBarItem = null;
};

export const updateStatusBarTabIndentItem = (showItem: boolean | null) => {
  if (statusBarItem != null) {
    if (showItem == null || showItem == false) {
      statusBarItem.text = '';
      statusBarItem.tooltip = '';
      statusBarItem.hide();
    } else {
      const formatterConfig = vscode.workspace.getConfiguration('spinExtension.formatter');
      const elasticConfig = vscode.workspace.getConfiguration('spinExtension.elasticTabstops');
      const elasticEnabled: boolean = elasticConfig.get<boolean>('enable', false);
      const tabsToSpaces: boolean = formatterConfig.get<boolean>('tabsToSpaces', true);
      const tabWidth: number = formatterConfig.get<number>('tabWidth', 8);
      const indentSize: number = formatterConfig.get<number>('indentSize', 2);

      let sbiText: string;
      let tooltipText: string;

      if (elasticEnabled) {
        sbiText = 'Spin2 Elastic';
        tooltipText = 'Spin2 Formatter: elastic tabstops enabled (click to change)';
      } else if (tabsToSpaces) {
        sbiText = `Spin2 Spaces: ${indentSize}`;
        tooltipText = `Spin2 Formatter: ${indentSize}-space indentation (click to change)`;
      } else {
        sbiText = `Spin2 Tabs: ${tabWidth}`;
        tooltipText = `Spin2 Formatter: tab characters, width ${tabWidth} (click to change)`;
      }

      statusBarItem.text = sbiText;
      statusBarItem.tooltip = tooltipText;
      statusBarItem.show();
    }
  }
};
