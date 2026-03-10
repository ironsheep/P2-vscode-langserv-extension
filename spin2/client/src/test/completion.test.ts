/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as assert from 'assert';
import { getDocUri, activate } from './helper';

suite('Should do completion', () => {
  const docUri = getDocUri('completion.spin2');

  test('General completion returns Spin2 globals and built-ins', async () => {
    // Position inside PUB Main() body (line 18, col 0)
    await testCompletionContains(docUri, new vscode.Position(18, 0), [
      // user-defined globals
      'max_count',
      'led_pin',
      'sensorvalue',
      // built-in methods
      'pinw',
      'hubset',
      // block keywords
      'CON'
    ]);
  });

  test('General completion returns local variables', async () => {
    // Position inside PUB Main() body
    await testCompletionContains(docUri, new vscode.Position(18, 0), ['localvar']);
  });

  test('Dot completion on struct instance returns members', async () => {
    // Position after "myPt." on line 20 (col 7 = right after the dot)
    await testCompletionContains(docUri, new vscode.Position(20, 7), ['x', 'y', 'z']);
  });
});

async function testCompletionContains(
  docUri: vscode.Uri,
  position: vscode.Position,
  expectedLabels: string[]
): Promise<void> {
  await activate(docUri);

  const actualCompletionList = (await vscode.commands.executeCommand(
    'vscode.executeCompletionItemProvider',
    docUri,
    position
  )) as vscode.CompletionList;

  const actualLabels: string[] = actualCompletionList.items.map((item) => {
    return typeof item.label === 'string' ? item.label.toLowerCase() : (item.label as any).label?.toLowerCase() ?? '';
  });

  for (const expected of expectedLabels) {
    assert.ok(
      actualLabels.includes(expected.toLowerCase()),
      `Expected completion item '${expected}' not found. Got: [${actualLabels.slice(0, 20).join(', ')}...]`
    );
  }
}
