'use strict';
import * as vscode from 'vscode';

import { editModeConfiguration } from './spin.editMode.configuration';

export enum eEditMode {
  INSERT,
  OVERTYPE,
  ALIGN
}

const defaultMode = eEditMode.INSERT;

const state = {
  global: defaultMode,
  perEditor: new WeakMap<vscode.TextEditor, eEditMode>()
};

export const getMode = (textEditor: vscode.TextEditor) => {
  if (!editModeConfiguration.perEditor) {
    return state.global;
  }

  if (!state.perEditor.has(textEditor)) {
    state.perEditor.set(textEditor, defaultMode);
  }

  return state.perEditor.get(textEditor) as eEditMode;
};

export function nextMode(oldMode: eEditMode): eEditMode {
  switch (oldMode) {
    case eEditMode.INSERT:
      return eEditMode.OVERTYPE;
    case eEditMode.OVERTYPE:
      return editModeConfiguration.enableAlign ? eEditMode.ALIGN : eEditMode.INSERT;
    case eEditMode.ALIGN:
      return eEditMode.INSERT;
    default:
      return eEditMode.INSERT;
  }
}

export function nextMode2State(oldMode: eEditMode): eEditMode {
  switch (oldMode) {
    case eEditMode.INSERT:
      return editModeConfiguration.enableAlign ? eEditMode.ALIGN : eEditMode.INSERT;
    case eEditMode.ALIGN:
      return eEditMode.INSERT;
    default:
      return eEditMode.INSERT;
  }
}

export function modeName(mode: eEditMode): string {
  switch (mode) {
    case eEditMode.INSERT:
      return 'Insert';
    case eEditMode.OVERTYPE:
      return 'Overtype';
    case eEditMode.ALIGN:
      return 'Align';
    default:
      return `ERROR?? (${mode})`;
  }
}

export const toggleMode = (textEditor: vscode.TextEditor) => {
  const upcomingMode: eEditMode = nextMode(getMode(textEditor));

  if (!editModeConfiguration.perEditor) {
    state.global = upcomingMode;
  } else {
    state.perEditor.set(textEditor, upcomingMode);
  }

  return upcomingMode;
};

export const toggleMode2State = (textEditor: vscode.TextEditor) => {
  const upcomingMode: eEditMode = nextMode2State(getMode(textEditor));

  if (!editModeConfiguration.perEditor) {
    state.global = upcomingMode;
  } else {
    state.perEditor.set(textEditor, upcomingMode);
  }

  return upcomingMode;
};

export const resetModes = (mode: eEditMode | null, perEditor: boolean) => {
  if (mode == null) {
    mode = defaultMode;
  }

  if (perEditor) {
    // when switching from global to per-editor, reset the global mode to default
    // and (currently impossible) set all editors to the provided mode

    // future: this should enumerate all open editors and set their mode explicitly
    // tracking: https://github.com/Microsoft/vscode/issues/15178

    state.global = defaultMode;
    state.perEditor = new WeakMap<vscode.TextEditor, eEditMode>();
  } else {
    // when switching from per-editor to global, set the global mode to the
    // provided mode and reset all per-editor modes

    state.global = mode;
    state.perEditor = new WeakMap<vscode.TextEditor, eEditMode>();
  }
};
