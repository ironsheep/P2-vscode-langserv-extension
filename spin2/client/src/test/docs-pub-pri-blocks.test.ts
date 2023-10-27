/* --------------------------------------------------------------------------------------------
 * Copyright (c) Iron Sheep Productions, LLC. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from "vscode";
import * as assert from "assert";
import { getDocUri, activate, showObject } from "./helper";
import { SemanticTokens } from "vscode-languageclient/node";
import { types } from "util";

suite("Should do Spin2 PUB/PRI Highlight display", () => {
  const docSpin2Uri = getDocUri("docs-pub-pri-blocks.spin2");
  type numberMap = { [key: string]: number };
  test("Get PUB/PRI SemanticTokens from spin2 file", async () => {
    await testSemanticTokens(docSpin2Uri, { data: [] });
  });
});

async function testSemanticTokens(docUri: vscode.Uri, expectedSemanticTokenList: SemanticTokens) {
  await activate(docUri);

  // Executing the command `vscode.executeCompletionItemProvider` to simulate triggering completion
  const actualSemanticTokenList = (await vscode.commands.executeCommand("vscode.provideDocumentSemanticTokens", docUri)) as SemanticTokens;
  //console.log(`spin2-actualSemanticTokenList is ${JSON.stringify(actualSemanticTokenList)})`);
  //console.log(`spin2-actualSemanticTokenList is ${JSON.stringify(actualSemanticTokenList)})`);
  console.log(`* EXPECT expectedSemanticTokenList is [${showObject(expectedSemanticTokenList)}]`);
  console.log(`* ACTUAL actualSemanticTokenList is [${showObject(actualSemanticTokenList)}]`);

  const expectedValueSet = expectedSemanticTokenList["data"];
  const actualValueSet = actualSemanticTokenList["data"];
  //assert.ok(expectedValueSet.length == actualValueSet.length);
  expectedValueSet.forEach((expectedItem, i) => {
    const actualItem = actualValueSet[i];
    //assert.equal(actualItem, expectedItem);
  });
}
