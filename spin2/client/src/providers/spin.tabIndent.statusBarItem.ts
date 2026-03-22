'use strict';
// client/src/providers/spin.tabIndent.statusBarItem.ts
//
// Status bar item showing current formatter tab/indent settings.
// Displays "Spaces: N", "Tabs: N", or the elastic profile name.
// Clicking opens the Spin2 formatter settings.

import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem | null;

// Map internal profile names to shorter display names for the status bar
const PROFILE_DISPLAY_NAMES: Record<string, string> = {
  PropellerTool: 'Prop Tool',
  IronSheep: 'IronSheep',
  User1: 'User1'
};

export function profileDisplayName(profileKey: string): string {
  return PROFILE_DISPLAY_NAMES[profileKey] || profileKey;
}

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
      const indentSize: number = formatterConfig.get<number>('indentSize', 2);

      let sbiText: string;
      let tooltipText: string;

      if (elasticEnabled) {
        const profileKey: string = elasticConfig.get<string>('choice', 'PropellerTool');
        const displayName = profileDisplayName(profileKey);
        sbiText = `Spin2 ${displayName}`;
        tooltipText = `Spin2 Formatter: elastic tabstops — ${displayName} profile (click to change)`;
      } else {
        sbiText = `Spin2 Spaces: ${indentSize}`;
        tooltipText = `Spin2 Formatter: ${indentSize}-space indentation (click to change)`;
      }

      statusBarItem.text = sbiText;
      statusBarItem.tooltip = tooltipText;
      statusBarItem.show();
    }
  }
};
