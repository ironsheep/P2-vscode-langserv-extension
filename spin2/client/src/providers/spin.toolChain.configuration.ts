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

  const topLevel: string | undefined = normalizeString(vscode.workspace.getConfiguration().get('topLevel'));
  const fNameTopLevel: string | undefined = normalizeString(vscode.workspace.getConfiguration().get('spin2.fNameTopLevel'));
  const topFilename = topLevel !== undefined ? `${topLevel}.spin2` : fNameTopLevel;

  const selectedPropPlug: string | undefined = normalizeStringConfigValue(toolchainConfig, 'propPlug.selected');
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
  const selectedCompilerID: string | undefined = normalizeStringConfigValue(toolchainConfig, 'compiler.selected');
  const debugEnabled: boolean = normalizeBooleanConfigValue(toolchainConfig, 'optionsCompile.enableDebug');
  let flexspinDebugFlag: string | undefined = toolchainConfig.get<string>('optionsCompile.flexspin.debug');
  if (flexspinDebugFlag === undefined) {
    flexspinDebugFlag = '-gbrk'; // default value if no value found
  }
  const lstOutputEnabled: boolean = normalizeBooleanConfigValue(toolchainConfig, 'optionsCompile.enableLstOutput');
  const writeFlashEnabled: boolean = normalizeBooleanConfigValue(toolchainConfig, 'optionsDownload.enableFlash');

  const downloadTerminalMode: string = normalizeStringConfigValue(toolchainConfig, 'optionsDownload.enterTerminalAfter');
  let enterTerminalAfterDownload: boolean = false;
  if (downloadTerminalMode !== undefined) {
    if (downloadTerminalMode.toLowerCase() === 'always') {
      enterTerminalAfterDownload = true;
    } else if (downloadTerminalMode.toLowerCase() === 'never') {
      enterTerminalAfterDownload = false;
    } else if (downloadTerminalMode.toLowerCase().includes('only when debug()')) {
      enterTerminalAfterDownload = debugEnabled ? true : false;
    }
  }

  let flexspinDownloadBaudrate: number = toolchainConfig.get<number>('optionsDownload.flexspin.baudrate');
  if (flexspinDownloadBaudrate === undefined) {
    flexspinDownloadBaudrate = 230400; // defualt value if no value found
  }
  const toolPaths = {};
  const pnutTsPath: string | undefined = normalizeStringConfigValue(toolchainConfig, 'paths.PNutTs');
  if (pnutTsPath !== undefined) {
    toolPaths[PATH_PNUT_TS] = pnutTsPath;
  }
  const flexspinPath: string | undefined = normalizeStringConfigValue(toolchainConfig, 'paths.flexspin');
  if (flexspinPath !== undefined) {
    toolPaths[PATH_FLEXSPIN] = flexspinPath;
  }
  const loadP2Path: string | undefined = normalizeStringConfigValue(toolchainConfig, 'paths.loadp2');
  if (loadP2Path !== undefined) {
    toolPaths[PATH_LOADP2] = loadP2Path;
  }
  const flashloaderPath: string | undefined = normalizeStringConfigValue(toolchainConfig, 'paths.flexspinFlashloader');
  if (flashloaderPath !== undefined) {
    toolPaths[PATH_LOADER_BIN] = flashloaderPath;
  }
  const pnutPath: string | undefined = normalizeStringConfigValue(toolchainConfig, 'paths.PNut');
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
    writeFlashEnabled,
    toolPaths,
    downloadTerminalMode,
    enterTerminalAfterDownload,
    flexspinDownloadBaudrate
  };
};

function normalizeBooleanConfigValue(config: vscode.WorkspaceConfiguration, key: string): boolean {
  let desiredBoolValue: boolean | undefined = config.get<boolean>(key);
  if (desiredBoolValue === undefined) {
    desiredBoolValue = false; // return false when not present
  }
  return desiredBoolValue;
}

function normalizeStringConfigValue(config: vscode.WorkspaceConfiguration, key: string): string | undefined {
  const desiredStringValue: string | undefined = normalizeString(config.get<string>(key));
  return desiredStringValue;
}

function normalizeString(value: string | undefined): string | undefined {
  let desiredValue: string | undefined = value;
  if (desiredValue !== undefined && desiredValue.length == 0) {
    desiredValue = undefined; // return undefined string when empty string
  }
  return value;
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
    toolchainConfiguration.writeFlashEnabled === newToolchainConfig.writeFlashEnabled &&
    objectsAreEqual(toolchainConfiguration.toolPaths, newToolchainConfig.toolPaths) &&
    toolchainConfiguration.downloadTerminalMode === newToolchainConfig.downloadTerminalMode &&
    toolchainConfiguration.enterTerminalAfterDownload === newToolchainConfig.enterTerminalAfterDownload &&
    toolchainConfiguration.flexspinDownloadBaudrate === newToolchainConfig.flexspinDownloadBaudrate
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
  toolchainConfiguration.writeFlashEnabled = newToolchainConfig.writeFlashEnabled;
  toolchainConfiguration.toolPaths = newToolchainConfig.toolPaths;
  toolchainConfiguration.downloadTerminalMode === newToolchainConfig.downloadTerminalMode;
  toolchainConfiguration.enterTerminalAfterDownload === newToolchainConfig.enterTerminalAfterDownload;
  toolchainConfiguration.flexspinDownloadBaudrate === newToolchainConfig.flexspinDownloadBaudrate;

  return true;
};

function objectsAreEqual(obj1: object, obj2: object): boolean {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}
