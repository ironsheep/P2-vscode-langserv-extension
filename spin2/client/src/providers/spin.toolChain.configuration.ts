'use strict';
import * as vscode from 'vscode';

export const PATH_FLEXSPIN: string = 'flexspin';
export const PATH_LOADP2: string = 'loadp2';
export const PATH_PROPLOADER: string = 'proploader';
export const PATH_PNUT: string = 'pnut';
export const PATH_PNUT_TS: string = 'pnut_ts';
export const PATH_PNUT_TERM_TS: string = 'pnut-term-ts';
export const PATH_LOADER_BIN: string = 'flashloader';

export const validCompilerIDs: string[] = [PATH_PNUT_TS, PATH_PNUT_TERM_TS, PATH_PNUT, PATH_FLEXSPIN];

export enum eResetType {
  RT_DTR,
  RT_RTS,
  RT_DTR_N_RTS
}
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
  const deviceNodesIsParallax = {};
  const deviceIsParallaxSet = toolchainConfig.get('propPlug.devicesIsParallax');
  if (typeof deviceIsParallaxSet === 'object' && deviceIsParallaxSet !== null) {
    for (const [deviceNode, isParallax] of Object.entries(deviceIsParallaxSet)) {
      deviceNodesIsParallax[deviceNode] = isParallax;
    }
  }
  // Determine if selected device is Parallax by looking it up in the map
  let selectedPropPlugIsParallax: boolean = false;
  if (selectedPropPlug !== undefined && deviceNodesIsParallax[selectedPropPlug] !== undefined) {
    selectedPropPlugIsParallax = deviceNodesIsParallax[selectedPropPlug];
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
  const advancedToolChainEnabled: boolean = normalizeBooleanConfigValue(toolchainConfig, 'advanced.enable');
  const lstOutputEnabled: boolean = normalizeBooleanConfigValue(toolchainConfig, 'optionsCompile.enableLstOutput');
  const writeFlashEnabled: boolean = normalizeBooleanConfigValue(toolchainConfig, 'optionsDownload.enableFlash');
  const usePNutTermTS: boolean = normalizeBooleanConfigValue(toolchainConfig, 'optionsDownload.usePnutTermTS');
  const termIsPstCompatible: boolean = normalizeBooleanConfigValue(toolchainConfig, 'optionsDownload.enableCompatibilityPST');
  const forceLoadP2Use: boolean = normalizeBooleanConfigValue(toolchainConfig, 'optionsDownload.useLoadP2');
  const serialMatchVendorOnly: boolean = normalizeBooleanConfigValue(toolchainConfig, 'optionsSerial.matchVendorOnly');
  const serialResetControl: string = normalizeStringConfigValue(toolchainConfig, 'optionsSerial.resetControl');
  let serialResetType: eResetType = eResetType.RT_DTR; // default value
  if (serialResetControl !== undefined) {
    if (serialResetControl.toLowerCase() === 'dtr') {
      serialResetType = eResetType.RT_DTR;
    } else if (serialResetControl.toLowerCase() === 'rts') {
      serialResetType = eResetType.RT_RTS;
    } else if (serialResetControl.toLowerCase() === 'dtr+rts') {
      serialResetType = eResetType.RT_DTR_N_RTS;
    }
  }
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

  let userBaudrate: number = toolchainConfig.get<number>('optionsDownload.user.baudrate');
  if (userBaudrate === undefined) {
    userBaudrate = 115200; // default value if no value found
  }
  const toolPaths = {};
  const pnutTsPath: string | undefined = normalizeStringConfigValue(toolchainConfig, 'paths.PNutTs');
  if (pnutTsPath !== undefined) {
    toolPaths[PATH_PNUT_TS] = pnutTsPath;
  }
  const pnutTermTsPath: string | undefined = normalizeStringConfigValue(toolchainConfig, 'paths.PNutTermTs');
  if (pnutTermTsPath !== undefined) {
    toolPaths[PATH_PNUT_TERM_TS] = pnutTermTsPath;
  }
  const flexspinPath: string | undefined = normalizeStringConfigValue(toolchainConfig, 'paths.flexspin');
  if (flexspinPath !== undefined) {
    toolPaths[PATH_FLEXSPIN] = flexspinPath;
  }
  const loadP2Path: string | undefined = normalizeStringConfigValue(toolchainConfig, 'paths.loadp2');
  if (loadP2Path !== undefined) {
    toolPaths[PATH_LOADP2] = loadP2Path;
  }
  const proploaderPath: string | undefined = normalizeStringConfigValue(toolchainConfig, 'paths.proploader');
  if (proploaderPath !== undefined) {
    toolPaths[PATH_PROPLOADER] = proploaderPath;
  }
  const flashloaderPath: string | undefined = normalizeStringConfigValue(toolchainConfig, 'paths.flexspinFlashloader');
  if (flashloaderPath !== undefined) {
    toolPaths[PATH_LOADER_BIN] = flashloaderPath;
  }
  const pnutPath: string | undefined = normalizeStringConfigValue(toolchainConfig, 'paths.PNut');
  if (pnutPath !== undefined) {
    toolPaths[PATH_PNUT] = pnutPath;
  }

  let flexspinInstalled: boolean = false;
  if (PATH_LOADER_BIN in toolPaths) {
    flexspinInstalled = true;
  } else if (PATH_PROPLOADER in toolPaths) {
    flexspinInstalled = true;
  } else if (PATH_LOADP2 in toolPaths) {
    flexspinInstalled = true;
  } else if (PATH_FLEXSPIN in toolPaths) {
    flexspinInstalled = true;
  }

  return {
    topFilename,
    deviceNodesFound,
    selectedPropPlug,
    selectedPropPlugIsParallax,
    compilersFound,
    selectedCompilerID,
    debugEnabled,
    flexspinDebugFlag,
    advancedToolChainEnabled,
    lstOutputEnabled,
    writeFlashEnabled,
    usePNutTermTS,
    termIsPstCompatible,
    forceLoadP2Use,
    toolPaths,
    downloadTerminalMode,
    enterTerminalAfterDownload,
    userBaudrate,
    flexspinInstalled,
    serialMatchVendorOnly,
    serialResetType
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
  // return empty strings as undefined!
  let desiredValue: string | undefined = value;
  if (desiredValue !== undefined && desiredValue.length == 0) {
    desiredValue = undefined; // return undefined string when empty string
  }
  return desiredValue;
}

export const toolchainConfiguration = loadToolchainConfiguration();

export const reloadToolchainConfiguration = () => {
  const newToolchainConfig = loadToolchainConfiguration();

  // bail out if nothing changed
  if (
    toolchainConfiguration.topFilename === newToolchainConfig.topFilename &&
    objectsAreEqual(toolchainConfiguration.deviceNodesFound, newToolchainConfig.deviceNodesFound) &&
    toolchainConfiguration.selectedPropPlug === newToolchainConfig.selectedPropPlug &&
    toolchainConfiguration.selectedPropPlugIsParallax === newToolchainConfig.selectedPropPlugIsParallax &&
    objectsAreEqual(toolchainConfiguration.compilersFound, newToolchainConfig.compilersFound) &&
    toolchainConfiguration.selectedCompilerID === newToolchainConfig.selectedCompilerID &&
    toolchainConfiguration.debugEnabled === newToolchainConfig.debugEnabled &&
    toolchainConfiguration.flexspinDebugFlag === newToolchainConfig.flexspinDebugFlag &&
    toolchainConfiguration.advancedToolChainEnabled === newToolchainConfig.advancedToolChainEnabled &&
    toolchainConfiguration.lstOutputEnabled === newToolchainConfig.lstOutputEnabled &&
    toolchainConfiguration.writeFlashEnabled === newToolchainConfig.writeFlashEnabled &&
    toolchainConfiguration.usePNutTermTS === newToolchainConfig.usePNutTermTS &&
    toolchainConfiguration.termIsPstCompatible === newToolchainConfig.termIsPstCompatible &&
    toolchainConfiguration.forceLoadP2Use === newToolchainConfig.forceLoadP2Use &&
    objectsAreEqual(toolchainConfiguration.toolPaths, newToolchainConfig.toolPaths) &&
    toolchainConfiguration.downloadTerminalMode === newToolchainConfig.downloadTerminalMode &&
    toolchainConfiguration.enterTerminalAfterDownload === newToolchainConfig.enterTerminalAfterDownload &&
    toolchainConfiguration.userBaudrate === newToolchainConfig.userBaudrate &&
    toolchainConfiguration.flexspinInstalled === newToolchainConfig.flexspinInstalled &&
    toolchainConfiguration.serialMatchVendorOnly === newToolchainConfig.serialMatchVendorOnly &&
    toolchainConfiguration.serialResetType === newToolchainConfig.serialResetType
  ) {
    return false;
  }

  // else copy the new values
  toolchainConfiguration.topFilename = newToolchainConfig.topFilename;
  toolchainConfiguration.deviceNodesFound = newToolchainConfig.deviceNodesFound;
  toolchainConfiguration.selectedPropPlug = newToolchainConfig.selectedPropPlug;
  toolchainConfiguration.selectedPropPlugIsParallax = newToolchainConfig.selectedPropPlugIsParallax;
  toolchainConfiguration.compilersFound = newToolchainConfig.compilersFound;
  toolchainConfiguration.selectedCompilerID = newToolchainConfig.selectedCompilerID;
  toolchainConfiguration.debugEnabled = newToolchainConfig.debugEnabled;
  toolchainConfiguration.flexspinDebugFlag = newToolchainConfig.flexspinDebugFlag;
  toolchainConfiguration.advancedToolChainEnabled = newToolchainConfig.advancedToolChainEnabled;
  toolchainConfiguration.lstOutputEnabled = newToolchainConfig.lstOutputEnabled;
  toolchainConfiguration.writeFlashEnabled = newToolchainConfig.writeFlashEnabled;
  toolchainConfiguration.usePNutTermTS = newToolchainConfig.usePNutTermTS;
  toolchainConfiguration.termIsPstCompatible = newToolchainConfig.termIsPstCompatible;
  toolchainConfiguration.forceLoadP2Use = newToolchainConfig.forceLoadP2Use;
  toolchainConfiguration.toolPaths = newToolchainConfig.toolPaths;
  toolchainConfiguration.downloadTerminalMode = newToolchainConfig.downloadTerminalMode;
  toolchainConfiguration.enterTerminalAfterDownload = newToolchainConfig.enterTerminalAfterDownload;
  toolchainConfiguration.userBaudrate = newToolchainConfig.userBaudrate;
  toolchainConfiguration.flexspinInstalled = newToolchainConfig.flexspinInstalled;
  toolchainConfiguration.serialMatchVendorOnly = newToolchainConfig.serialMatchVendorOnly;
  toolchainConfiguration.serialResetType = newToolchainConfig.serialResetType;

  // post information to out-side world via our CONTEXT at config change
  vscode.commands.executeCommand('setContext', 'runtime.spin2.toolchain.enabled', toolchainConfiguration.advancedToolChainEnabled);

  return true;
};

function objectsAreEqual(obj1: object, obj2: object): boolean {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}
