'use strict';
import * as vscode from 'vscode';

const stringToCursorStyle = (config: vscode.WorkspaceConfiguration, style: string, def: vscode.TextEditorCursorStyle) => {
  switch (config.get<string>(style)) {
    case 'line':
      return vscode.TextEditorCursorStyle.Line;
    case 'line-thin':
      return vscode.TextEditorCursorStyle.LineThin;
    case 'block':
      return vscode.TextEditorCursorStyle.Block;
    case 'block-outline':
      return vscode.TextEditorCursorStyle.BlockOutline;
    case 'underline':
      return vscode.TextEditorCursorStyle.Underline;
    case 'underline-thin':
      return vscode.TextEditorCursorStyle.UnderlineThin;
    default:
      return def;
  }
};

const getActiveConfiguration = (section: string): vscode.WorkspaceConfiguration => {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const activeLanguageId = activeEditor.document.languageId;
    if (activeLanguageId) {
      const languageScope = { languageId: activeLanguageId };
      const languageSpecificConfiguration = vscode.workspace.getConfiguration(section, languageScope);
      return languageSpecificConfiguration;
    }
  }
  return vscode.workspace.getConfiguration(section);
};

const loadEditModeConfiguration = () => {
  const insertModeConfiguration = vscode.workspace.getConfiguration('spinExtension.insertMode');
  //const editorConfiguration = vscode.workspace.getConfiguration('editor');

  return {
    overtypePaste: insertModeConfiguration.get<boolean>('overtypePaste') ? true : false,
    perEditor: insertModeConfiguration.get<boolean>('perEditor') ? true : false,

    enableAlign: insertModeConfiguration.get<boolean>('enableAlign') ? true : false,

    labelInsertMode: insertModeConfiguration.get<string>('labelInsertMode'),
    labelOvertypeMode: insertModeConfiguration.get<string>('labelOvertypeMode'),
    labelAlignMode: insertModeConfiguration.get<string>('labelAlignMode'),

    // tslint:disable-next-line:object-literal-sort-keys
    get defaultCursorStyle(): vscode.TextEditorCursorStyle {
      const editorConfiguration = getActiveConfiguration('editor');
      return stringToCursorStyle(editorConfiguration, 'cursorStyle', vscode.TextEditorCursorStyle.Block);
    },

    // Get the user defined cursor style for overtype mode
    secondaryCursorStyle: (() => {
      return stringToCursorStyle(insertModeConfiguration, 'secondaryCursorStyle', vscode.TextEditorCursorStyle.Line);
    })(),

    ternaryCursorStyle: (() => {
      return stringToCursorStyle(insertModeConfiguration, 'ternaryCursorStyle', vscode.TextEditorCursorStyle.Line);
    })()
  };
};

export const editModeConfiguration = loadEditModeConfiguration();

export const reloadEditModeConfiguration = () => {
  const newEditModeConfiguration = loadEditModeConfiguration();

  // bail out if nothing changed
  if (
    editModeConfiguration.labelInsertMode === newEditModeConfiguration.labelInsertMode &&
    editModeConfiguration.labelOvertypeMode === newEditModeConfiguration.labelOvertypeMode &&
    editModeConfiguration.labelAlignMode === newEditModeConfiguration.labelAlignMode &&
    editModeConfiguration.enableAlign === newEditModeConfiguration.enableAlign &&
    editModeConfiguration.overtypePaste === newEditModeConfiguration.overtypePaste &&
    editModeConfiguration.perEditor === newEditModeConfiguration.perEditor &&
    editModeConfiguration.defaultCursorStyle === newEditModeConfiguration.defaultCursorStyle &&
    editModeConfiguration.secondaryCursorStyle === newEditModeConfiguration.secondaryCursorStyle &&
    editModeConfiguration.ternaryCursorStyle === newEditModeConfiguration.ternaryCursorStyle
  ) {
    return false;
  }

  editModeConfiguration.labelInsertMode = newEditModeConfiguration.labelInsertMode;
  editModeConfiguration.labelOvertypeMode = newEditModeConfiguration.labelOvertypeMode;
  editModeConfiguration.labelAlignMode = newEditModeConfiguration.labelAlignMode;
  editModeConfiguration.enableAlign = newEditModeConfiguration.enableAlign;
  editModeConfiguration.overtypePaste = newEditModeConfiguration.overtypePaste;
  editModeConfiguration.perEditor = newEditModeConfiguration.perEditor;
  // guess we don't save .defaultCursorStyle
  editModeConfiguration.secondaryCursorStyle = newEditModeConfiguration.secondaryCursorStyle;
  editModeConfiguration.ternaryCursorStyle = newEditModeConfiguration.ternaryCursorStyle;

  return true;
};
