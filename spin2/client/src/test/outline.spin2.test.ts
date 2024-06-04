/* --------------------------------------------------------------------------------------------
 * Copyright (c) Iron Sheep Productions, LLC. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as assert from 'assert';
import { getDocUri, activate, showObject } from './helper';
import { DocumentSymbol } from 'vscode-languageclient/node';

suite('Should do Spin2 outline display', () => {
  const docSpin2Uri = getDocUri('outline.spin2');

  test('Get documentSymbols from spin2 file', async () => {
    await testDocumentSymbols(docSpin2Uri, [
      {
        name: 'CON { app io pins }',
        detail: '',
        kind: 8,
        range: {
          start: {
            line: 3,
            character: 0
          },
          end: {
            line: 3,
            character: 18
          }
        },
        selectionRange: {
          start: {
            line: 3,
            character: 0
          },
          end: {
            line: 3,
            character: 18
          }
        }
      },
      {
        name: "VAR ' instance variables",
        detail: '',
        kind: 8,
        range: {
          start: {
            line: 7,
            character: 0
          },
          end: {
            line: 7,
            character: 23
          }
        },
        selectionRange: {
          start: {
            line: 7,
            character: 0
          },
          end: {
            line: 7,
            character: 23
          }
        }
      },
      {
        name: 'PUB Main(): ok',
        detail: 'Public',
        kind: 6,
        range: {
          start: {
            line: 10,
            character: 0
          },
          end: {
            line: 10,
            character: 24
          }
        },
        selectionRange: {
          start: {
            line: 10,
            character: 0
          },
          end: {
            line: 10,
            character: 24
          }
        }
      },
      {
        name: 'PRI KillSwitch(): abortCode, bdidKill',
        detail: 'Private',
        kind: 6,
        range: {
          start: {
            line: 14,
            character: 0
          },
          end: {
            line: 14,
            character: 36
          }
        },
        selectionRange: {
          start: {
            line: 14,
            character: 0
          },
          end: {
            line: 14,
            character: 36
          }
        }
      },
      {
        name: "VAR ' instance variables",
        detail: '',
        kind: 8,
        range: {
          start: {
            line: 19,
            character: 0
          },
          end: {
            line: 19,
            character: 23
          }
        },
        selectionRange: {
          start: {
            line: 19,
            character: 0
          },
          end: {
            line: 19,
            character: 23
          }
        }
      },
      {
        name: "DAT ' class variables",
        detail: '',
        kind: 8,
        range: {
          start: {
            line: 22,
            character: 0
          },
          end: {
            line: 22,
            character: 20
          }
        },
        selectionRange: {
          start: {
            line: 22,
            character: 0
          },
          end: {
            line: 22,
            character: 20
          }
        },
        children: [
          {
            name: 'char8_loop',
            detail: '',
            kind: 14,
            range: {
              start: {
                line: 28,
                character: 0
              },
              end: {
                line: 28,
                character: 9
              }
            },
            selectionRange: {
              start: {
                line: 28,
                character: 0
              },
              end: {
                line: 28,
                character: 9
              }
            }
          }
        ]
      },
      {
        name: 'DAT ',
        detail: '',
        kind: 8,
        range: {
          start: {
            line: 30,
            character: 0
          },
          end: {
            line: 30,
            character: 12
          }
        },
        selectionRange: {
          start: {
            line: 30,
            character: 0
          },
          end: {
            line: 30,
            character: 12
          }
        },
        children: [
          {
            name: 'read_args',
            detail: '',
            kind: 14,
            range: {
              start: {
                line: 30,
                character: 0
              },
              end: {
                line: 30,
                character: 12
              }
            },
            selectionRange: {
              start: {
                line: 30,
                character: 0
              },
              end: {
                line: 30,
                character: 12
              }
            }
          },
          {
            name: 'adpcm_buffers',
            detail: '',
            kind: 14,
            range: {
              start: {
                line: 40,
                character: 0
              },
              end: {
                line: 40,
                character: 12
              }
            },
            selectionRange: {
              start: {
                line: 40,
                character: 0
              },
              end: {
                line: 40,
                character: 12
              }
            }
          }
        ]
      }
    ]);
  });
});

async function testDocumentSymbols(docUri: vscode.Uri, expectedDocumentSymbolsList: Array<DocumentSymbol>): Promise<void> {
  await activate(docUri);

  // Executing the command `vscode.executeCompletionItemProvider` to simulate triggering completion
  const actualDocumentSymbolsList = (await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', docUri)) as Array<DocumentSymbol>;
  console.log(`spin2-actualCompletionList is ${showObject(actualDocumentSymbolsList)})`);
  console.log(`spin2-expectedDocumentSymbolsList is ${showObject(expectedDocumentSymbolsList)})`);

  assert.ok(actualDocumentSymbolsList.length == expectedDocumentSymbolsList.length);
  expectedDocumentSymbolsList.forEach((expectedItem, i) => {
    const actualItem = actualDocumentSymbolsList[i];
    assert.equal(actualItem.name, expectedItem.name);
    assert.equal(actualItem.detail, expectedItem.detail);
    assert.equal(actualItem.kind, expectedItem.kind);
    assert.equal(actualItem.range, expectedItem.range);
    assert.equal(actualItem.selectionRange, expectedItem.selectionRange);
  });
}
