/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-console */ // allow console writes from this file
'use strict';

import * as vscode from 'vscode';
import { EventEmitter } from 'events';

export class LoaderPseudoterminal extends EventEmitter implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  private closeEmitter = new vscode.EventEmitter<void>();
  onDidClose?: vscode.Event<void> = this.closeEmitter.event;

  private buffer: string = '';
  private lineTimeout: NodeJS.Timeout | null = null;
  private terminal: vscode.Terminal;

  constructor(termTitle: string = 'Downloader Output') {
    super();
    this.terminal = vscode.window.createTerminal({ name: termTitle, pty: this });
    vscode.window.onDidCloseTerminal(async (closedTerminal) => {
      if (closedTerminal === this.terminal) {
        console.log('Downloader terminal closed');
        // Perform any cleanup here
        this.close();
      }
    });
    this.terminal.show();
  }

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    this.writeEmitter.fire('Terminal opened. Type something and press enter...\r\n');
  }

  close(): void {
    this.closeEmitter.fire();
  }

  handleInput(data: string): void {
    // Handle the input data here
    this.buffer += data;

    if (this.lineTimeout) {
      clearTimeout(this.lineTimeout);
    }

    const lines = this.buffer.split('\r');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      this.emitLine(line.trim());
    }

    this.lineTimeout = setTimeout(() => {
      if (this.buffer.length > 0) {
        this.emitLine(this.buffer.trim());
        this.buffer = '';
      }
    }, 100); // Adjust the timeout as needed
  }

  public sendText(text: string): void {
    this.terminal.sendText(text);
  }

  private emitLine(line: string): void {
    console.log('Received line:', line);
    this.emit('line', line);
    this.writeEmitter.fire(`${line}\r\n`);
  }
}
