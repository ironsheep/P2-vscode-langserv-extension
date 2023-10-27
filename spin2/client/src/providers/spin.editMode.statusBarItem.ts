"use strict";
import * as vscode from "vscode";

import { editModeConfiguration } from "./spin.editMode.configuration";
import { eEditMode } from "./spin.editMode.mode";

let statusBarItem: vscode.StatusBarItem | null;

export const createStatusBarItem = () => {
  if (statusBarItem != null) {
    return statusBarItem;
  }

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "spinExtension.insertMode.rotate";
  statusBarItem.text = "?NEED-VALUE?"; // testing
  statusBarItem.show();

  updateStatusBarItem(null); // hide status bar content

  return statusBarItem;
};

export const destroyStatusBarItem = () => {
  if (statusBarItem == null) {
    return;
  }

  statusBarItem.hide();
  statusBarItem = null;
};

export const updateStatusBarItem = (insertMode: eEditMode | null) => {
  if (statusBarItem != null) {
    if (insertMode == null) {
      statusBarItem.text = "";
      statusBarItem.tooltip = "";

      statusBarItem.hide();
    } else {
      let sbiText: string | undefined = undefined;

      if (insertMode == eEditMode.OVERTYPE) {
        sbiText = editModeConfiguration.labelOvertypeMode;
        statusBarItem.tooltip = "Overtype Mode, click to change to Align Mode (if enabled) or Insert Mode";
      } else if (insertMode == eEditMode.INSERT) {
        sbiText = editModeConfiguration.labelInsertMode;
        statusBarItem.tooltip = "Insert Mode, click to change to Overtype Mode";
      } else if (insertMode == eEditMode.ALIGN) {
        sbiText = editModeConfiguration.labelAlignMode;
        statusBarItem.tooltip = "Align Mode, click to change to Insert Mode";
      }
      if (sbiText === undefined || sbiText == null) sbiText = "";

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
