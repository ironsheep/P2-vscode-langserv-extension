'use strict';
import * as vscode from 'vscode';

export const PATH_FLEXSPIN: string = 'flexspin';
export const PATH_LOADP2: string = 'loadp2';
export const PATH_PNUT: string = 'pnut';
export const PATH_PNUT_TS: string = 'pnut_ts';
export const PATH_LOADER_BIN: string = 'flashloader';

const loadToolchainConfiguration = () => {
  // load the configuration settings making them easy to use
  const toolchainConfig = vscode.workspace.getConfiguration(`spinExtension.toolchain`);
  const topLevel: string | undefined = vscode.workspace.getConfiguration().get('topLevel');
  const fNameTopLevel: string | undefined = vscode.workspace.getConfiguration().get('spin2.fNameTopLevel');
  const topFilename = topLevel !== undefined ? `${topLevel}.spin2` : fNameTopLevel;
  const selectedPropPlug: string | undefined = normalizeStringValue(toolchainConfig, 'propPlug.selected');
  const deviceNodesFound = {};
  const deviceSet = toolchainConfig.get('propPlug.devicesFound');
  if (typeof deviceSet === 'object' && deviceSet !== null) {
    for (const [deviceNode, serialNumber] of Object.entries(deviceSet)) {
      deviceNodesFound[deviceNode] = serialNumber;
    }
  }
  const compilersFound = {};
  const installedCompilers = toolchainConfig.get('compiler.installationsFound');
  if (typeof installedCompilers === 'object' && installedCompilers !== null) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [rootDir, compilerID] of Object.entries(installedCompilers)) {
      compilersFound[rootDir] = compilerID; // should be our PATH_ values from above
    }
  }
  const selectedCompilerID: string | undefined = normalizeStringValue(toolchainConfig, 'compiler.selected');
  const debugEnabled: boolean = normalizeBoolValue(toolchainConfig, 'optionsCompile.enableDebug');
  let flexspinDebugFlag: string | undefined = toolchainConfig.get<string>('optionsCompile.flexspin.debug');
  if (flexspinDebugFlag === undefined) {
    flexspinDebugFlag = '-gbrk'; // default value if no value found
  }
  const lstOutputEnabled: boolean = normalizeBoolValue(toolchainConfig, 'optionsCompile.enableLstOutput');
  const binOutputEnabled: boolean = normalizeBoolValue(toolchainConfig, 'optionsCompile.enableBinOutput');
  const writeFlashEnabled: boolean = normalizeBoolValue(toolchainConfig, 'optionsDownload.enableFlash');

  const toolPaths = {};
  const pnutTsPath: string | undefined = normalizeStringValue(toolchainConfig, 'paths.PNutTs');
  if (pnutTsPath !== undefined) {
    toolPaths[PATH_PNUT_TS] = pnutTsPath;
  }
  const flexspinPath: string | undefined = normalizeStringValue(toolchainConfig, 'paths.flexspin');
  if (flexspinPath !== undefined) {
    toolPaths[PATH_FLEXSPIN] = flexspinPath;
  }
  const loadP2Path: string | undefined = normalizeStringValue(toolchainConfig, 'paths.loadp2');
  if (loadP2Path !== undefined) {
    toolPaths[PATH_LOADP2] = loadP2Path;
  }
  const flashloaderPath: string | undefined = normalizeStringValue(toolchainConfig, 'paths.flexspinFlashloader');
  if (flashloaderPath !== undefined) {
    toolPaths[PATH_LOADER_BIN] = flashloaderPath;
  }
  const pnutPath: string | undefined = normalizeStringValue(toolchainConfig, 'paths.pnut');
  if (pnutPath !== undefined) {
    toolPaths[PATH_PNUT] = pnutPath;
  }

  return {
    topFilename,
    deviceNodesFound,
    selectedPropPlug,
    compilersFound,
    selectedCompilerID,
    debugEnabled,
    flexspinDebugFlag,
    lstOutputEnabled,
    binOutputEnabled,
    writeFlashEnabled,
    toolPaths
  };
};

function normalizeBoolValue(config: vscode.WorkspaceConfiguration, key: string): boolean {
  let desiredBoolValue: boolean | undefined = config.get<boolean>(key);
  if (desiredBoolValue === undefined) {
    desiredBoolValue = false; // return false when not present
  }
  return desiredBoolValue;
}

function normalizeStringValue(config: vscode.WorkspaceConfiguration, key: string): string | undefined {
  let desiredStringValue: string | undefined = config.get<string>(key);
  if (desiredStringValue !== undefined && desiredStringValue.length == 0) {
    desiredStringValue = undefined; // return undefined string when empty string
  }
  return desiredStringValue;
}

export const toolchainConfiguration = loadToolchainConfiguration();

export const reloadToolchainConfiguration = () => {
  const newToolchainConfig = loadToolchainConfiguration();

  // bail out if nothing changed
  if (
    toolchainConfiguration.topFilename === newToolchainConfig.topFilename &&
    objectsAreEqual(toolchainConfiguration.deviceNodesFound, newToolchainConfig.deviceNodesFound) &&
    toolchainConfiguration.selectedPropPlug === newToolchainConfig.selectedPropPlug &&
    objectsAreEqual(toolchainConfiguration.compilersFound, newToolchainConfig.compilersFound) &&
    toolchainConfiguration.selectedCompilerID === newToolchainConfig.selectedCompilerID &&
    toolchainConfiguration.debugEnabled === newToolchainConfig.debugEnabled &&
    toolchainConfiguration.flexspinDebugFlag === newToolchainConfig.flexspinDebugFlag &&
    toolchainConfiguration.lstOutputEnabled === newToolchainConfig.lstOutputEnabled &&
    toolchainConfiguration.binOutputEnabled === newToolchainConfig.binOutputEnabled &&
    toolchainConfiguration.writeFlashEnabled === newToolchainConfig.writeFlashEnabled &&
    objectsAreEqual(toolchainConfiguration.toolPaths, newToolchainConfig.toolPaths)
  ) {
    return false;
  }

  // else copy the new values
  toolchainConfiguration.topFilename = newToolchainConfig.topFilename;
  toolchainConfiguration.deviceNodesFound = newToolchainConfig.deviceNodesFound;
  toolchainConfiguration.selectedPropPlug = newToolchainConfig.selectedPropPlug;
  toolchainConfiguration.compilersFound = newToolchainConfig.compilersFound;
  toolchainConfiguration.selectedCompilerID = newToolchainConfig.selectedCompilerID;
  toolchainConfiguration.debugEnabled = newToolchainConfig.debugEnabled;
  toolchainConfiguration.flexspinDebugFlag = newToolchainConfig.flexspinDebugFlag;
  toolchainConfiguration.lstOutputEnabled = newToolchainConfig.lstOutputEnabled;
  toolchainConfiguration.binOutputEnabled = newToolchainConfig.binOutputEnabled;
  toolchainConfiguration.writeFlashEnabled = newToolchainConfig.writeFlashEnabled;
  toolchainConfiguration.toolPaths = newToolchainConfig.toolPaths;

  return true;
};

function objectsAreEqual(obj1: object, obj2: object): boolean {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}