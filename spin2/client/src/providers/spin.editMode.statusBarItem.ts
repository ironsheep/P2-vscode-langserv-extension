'use strict';
import * as vscode from 'vscode';

import { editModeConfiguration } from './spin.editMode.configuration';
import { eEditMode } from './spin.editMode.mode';

let statusBarItem: vscode.StatusBarItem | null;

export const createStatusBarInsertModeItem = () => {
  if (statusBarItem != null) {
    return statusBarItem;
  }

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'spinExtension.insertMode.rotate';
  statusBarItem.text = '?NEED-VALUE?'; // testing
  statusBarItem.show();

  updateStatusBarInsertModeItem(null); // hide status bar content

  return statusBarItem;
};

export const destroyStatusBarInsertModeItem = () => {
  if (statusBarItem == null) {
    return;
  }

  statusBarItem.hide();
  statusBarItem = null;
};

export const updateStatusBarInsertModeItem = (insertMode: eEditMode | null) => {
  if (statusBarItem != null) {
    if (insertMode == null) {
      statusBarItem.text = '';
      statusBarItem.tooltip = '';

      statusBarItem.hide();
    } else {
      let sbiText: string = '';

      if (insertMode == eEditMode.OVERTYPE) {
        sbiText = editModeConfiguration.labelOvertypeMode;
        statusBarItem.tooltip = 'Overtype Mode, click to change to Align Mode (if enabled) or Insert Mode';
      } else if (insertMode == eEditMode.INSERT) {
        sbiText = editModeConfiguration.labelInsertMode;
        statusBarItem.tooltip = 'Insert Mode, click to change to Overtype Mode';
      } else if (insertMode == eEditMode.ALIGN) {
        sbiText = editModeConfiguration.labelAlignMode;
        statusBarItem.tooltip = 'Align Mode, click to change to Insert Mode';
      }

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
