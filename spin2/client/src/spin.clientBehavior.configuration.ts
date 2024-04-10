'use strict';
// client/src/spin.clientBehavior.configuration.ts

import * as vscode from 'vscode';

const loadEditorConfiguration = () => {
  const editorConfiguration = vscode.workspace.getConfiguration('spinExtension.ClientBehavior');

  return {
    colorBackground: editorConfiguration.get<boolean>('colorEditorBackground') ? true : false,
    backgroundApha: editorConfiguration.get<number>('editorBackgroundAlpha')
  };
};

export const editorConfiguration = loadEditorConfiguration();

export const reloadEditorConfiguration = () => {
  const newEditorConfiguration = loadEditorConfiguration();

  // bail out if nothing changed
  if (
    editorConfiguration.colorBackground === newEditorConfiguration.colorBackground &&
    editorConfiguration.backgroundApha === newEditorConfiguration.backgroundApha
  ) {
    return false;
  }

  editorConfiguration.colorBackground = newEditorConfiguration.colorBackground;
  editorConfiguration.backgroundApha = newEditorConfiguration.backgroundApha;

  return true;
};
