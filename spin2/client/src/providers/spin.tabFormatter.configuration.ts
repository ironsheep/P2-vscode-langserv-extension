/* eslint-disable @typescript-eslint/no-unused-vars */
'use strict';
import * as vscode from 'vscode';

/**
 *
 */
export interface Block {
  tabStops: number[];
}

/**
 *
 */
export interface Blocks {
  con: Block;
  var: Block;
  obj: Block;
  pub: Block;
  pri: Block;
  dat: Block;

  [block: string]: Block;
}

const loadTabConfiguration = () => {
  const tabFormatterConfiguration = vscode.workspace.getConfiguration('spinExtension.elasticTabstops');

  const tabset: string = tabFormatterConfiguration.get<string>('choice')!;

  const tabsUserSelection: string = `blocks.${tabset}`;
  //const blocks = tabFormatterConfiguration.get<Blocks>(tabsUserSelection)!;
  //const blocksConfig = tabFormatterConfiguration.inspect<Blocks>("blocks");

  //const tabSize = tabFormatterConfiguration.get<number>('editor.tabSize');
  //const useTabStops = tabFormatterConfiguration.get<number>("editor.useTabStops");

  //const enable = tabFormatterConfiguration.get<boolean>('enable') ? true: false;
  //const timeout = tabFormatterConfiguration.get<number>("timeout");
  //const maxLineCount = tabFormatterConfiguration.get<number>("maxLineCount");
  //const maxLineLength = tabFormatterConfiguration.get<number>("maxLineLength");

  return {
    enable: tabFormatterConfiguration.get<boolean>('enable') ? true : false,
    tabSet: tabFormatterConfiguration.get<string>('choice')!,
    blocks: tabFormatterConfiguration.get<Blocks>(tabsUserSelection)!,
    tabSize: tabFormatterConfiguration.get<number>('editor.tabSize')
  };
};

export let tabConfiguration = loadTabConfiguration();

export const reloadTabConfiguration = () => {
  const newTabConfiguration = loadTabConfiguration();

  // bail out if nothing changed
  if (
    tabConfiguration.enable === newTabConfiguration.enable &&
    tabConfiguration.tabSet === newTabConfiguration.tabSet &&
    tabConfiguration.tabSize === newTabConfiguration.tabSize &&
    JSON.stringify(tabConfiguration.blocks) === JSON.stringify(newTabConfiguration.blocks)
  ) {
    return false;
  }

  // Replace the entire configuration object instead of mutating
  tabConfiguration = newTabConfiguration;

  // post information to out-side world via our CONTEXT at config change
  vscode.commands.executeCommand('setContext', 'runtime.spin2.elasticTabstops.enabled', tabConfiguration.enable);

  return true;
};
