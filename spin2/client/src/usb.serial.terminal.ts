/* eslint-disable @typescript-eslint/no-unused-vars */
'use strict';

import * as vscode from 'vscode';
import { ReadlineParser, SerialPort } from 'serialport';
import { waitMSec } from './timerUtils';
import { EventEmitter } from 'events';
import { UsbSerial } from './usb.serial';

const DEFAULT_DEBUG_BAUD = 2000000;

export class UsbSerialTerminal extends EventEmitter {
  private static isDebugLogEnabled: boolean = false;
  private static debugOutputChannel: vscode.OutputChannel | undefined = undefined;
  private endOfLineStr: string = '\r\n';
  private _deviceNode: string = '';
  private _serialPort: SerialPort;
  private _serialParser: ReadlineParser;
  private _debugBaud: number = DEFAULT_DEBUG_BAUD;
  private _p2DeviceId: string = '';
  private _latestError: string = '';

  constructor(deviceNode: string, debugBaud: number = DEFAULT_DEBUG_BAUD) {
    super();
    this._deviceNode = deviceNode;
    this._debugBaud = debugBaud;
    UsbSerialTerminal.isDebugLogEnabled = UsbSerial.debugEnabled;
    // Initialize the static output channel if it is not already initialized
    if (UsbSerialTerminal.debugOutputChannel === undefined && UsbSerial.debugChannel !== undefined) {
      UsbSerialTerminal.debugOutputChannel = UsbSerial.debugChannel;
    }

    this.logMessage(`* USBSerTerm Connecting to ${this._deviceNode}`);
    // setup the port
    this.loadSerialPort();

    // now open the port
    this._serialPort.open((err) => {
      if (err) {
        this.handleSerialError(err.message);
      }
    });
  }

  get deviceInfo(): string {
    return this._p2DeviceId;
  }

  get deviceError(): string | undefined {
    let desiredText: string | undefined = undefined;
    if (this._latestError.length > 0) {
      desiredText = this._latestError;
    }
    return desiredText;
  }

  get foundP2(): boolean {
    return this._p2DeviceId === '' ? false : true;
  }

  get usbConnected(): boolean {
    return this._serialPort.isOpen;
  }

  private loadSerialPort(): void {
    this._serialPort = new SerialPort({
      path: this._deviceNode,
      baudRate: this._debugBaud,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false
    });

    // wait for any returned data
    this._serialParser = this._serialPort.pipe(new ReadlineParser({ delimiter: this.endOfLineStr }));
    // Open errors will be emitted as an error event
    this._serialPort.on('error', (err) => this.handleSerialError(err.message));
    this._serialPort.on('open', () => this.handleSerialOpen());
    //this._serialPort.on('data', this.handleData.bind(this));
    this.startReadListener();
  }

  private buffer: string = '';
  private lineTimeout: NodeJS.Timeout | null = null;
  readonly TIMEOUT_CHAR_RX = 100; // .1 second

  private handleData(data: Buffer) {
    const dataStr = data.toString('utf-8');
    this.buffer += dataStr;

    if (this.lineTimeout) {
      clearTimeout(this.lineTimeout);
    }

    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      this.emit('line', line.trim());
      this.logMessage(`* line Rx: [${line.trim()}]`);
    }

    this.lineTimeout = setTimeout(() => {
      if (this.buffer.length > 0) {
        this.emit('line', this.buffer.trim());
        this.logMessage(`* line Rx: [${this.buffer.trim()}]`);
        this.buffer = '';
      }
    }, this.TIMEOUT_CHAR_RX); // Adjust the timeout as needed
  }

  public async changeBaudRate(newBaudRate: number): Promise<void> {
    // using this to change to debug baudrate after download
    if (this._serialPort.isOpen) {
      await this._serialPort.close();
    }

    this._serialPort.update({ baudRate: newBaudRate }, (err) => {
      if (err) {
        //console.error('Error updating baud rate:', err);
        this.logMessage(`* USBSerTerm changeBaudRate() Error updating baud rate: ${err}`);
      } else {
        //console.log('Baud rate updated successfully');
        this.logMessage(`* USBSerTerm changeBaudRate() Baud rate updated successfully`);
      }
    });

    await this._serialPort.open();
  }

  private handleSerialError(errMessage: string) {
    this.logMessage(`* USBSerTerm handleSerialError() Error: ${errMessage}`);
    this._latestError = errMessage;
  }

  private handleSerialOpen() {
    this.logMessage(`* USBSerTerm handleSerialOpen() open...`);
  }

  public async close(): Promise<void> {
    // (alternate suggested by perplexity search)
    // release the usb port
    if (this._serialPort === undefined || this._serialPort.isOpen == false) {
      this.logMessage(`  -- close() ?? port already closed or undefined ??`);
      return Promise.resolve();
    } else {
      await waitMSec(50);

      return new Promise((resolve, reject) => {
        this._serialPort.close((err) => {
          if (err) {
            this.logMessage(`  -- close() Error: ${err.message}`);
            reject(err);
          } else {
            this.logMessage(`  -- close() - port close: isOpen=(${this._serialPort.isOpen})`);
            resolve();
          }
        });
      });
    }
    /*
    if (this._serialPort !== undefined && this._serialPort.isOpen) {
      await waitMSec(50);
    }
    return new Promise((resolve, reject) => {
      if (this._serialPort !== undefined && this._serialPort.isOpen) {
        this._serialPort.close((err) => {
          if (err) {
            this.logMessage(`  -- close() Error: ${err.message}`);
            reject(err);
          } else {
            this.logMessage(`  -- close() - port close: isOpen=(${this._serialPort.isOpen})`);
            resolve();
          }
        });
      } else if (!this._serialPort.isOpen) {
        this.logMessage(`  -- close() ?? port already closed ??`);
        resolve();
      } else {
        this.logMessage(`  -- close() ?? no port to close ??`);
        resolve();
      }
    });
	//*/
  }

  readonly TIMEOUT_OPEN_CHK_MS = 30; // 30 mSec

  private async waitForPortOpen(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 2000 / 30; // 2 seconds / 30 ms

      const intervalId = setInterval(async () => {
        if (this._serialPort.isOpen) {
          clearInterval(intervalId);
          resolve(true);
        } else if (attempts >= maxAttempts) {
          clearInterval(intervalId);
          reject(new Error('Port did not open within 2 seconds'));
        } else {
          attempts++;
        }
      }, this.TIMEOUT_OPEN_CHK_MS); // Check every 30ms
    });
  }

  private startReadListener() {
    // wait for any returned data
    this.logMessage(`* USBSerTerm startReadListener()`);
    this._serialParser.on('data', (data) => this.handleSerialRx(data));
  }

  private stopReadListener() {
    // stop waiting for any returned data
    this.logMessage(`* USBSerTerm stopReadListener()`);
    this._serialParser.off('data', (data) => this.handleSerialRx(data));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleSerialRx(data?: any) {
    this.logMessage(`<-- Rx [${data}]`);
    this.emit('line', data);
  }

  public async write(value: string): Promise<void> {
    //this.logMessage(`--> Tx ...`);
    return new Promise((resolve, reject) => {
      this._serialPort.write(value, (err) => {
        if (err) reject(err);
        else {
          resolve();
          this.logMessage(`--> Tx [${value.split(/\r?\n/).filter(Boolean)[0]}]`);
        }
      });
    });
  }

  private async drain(): Promise<void> {
    this.logMessage(`--> Tx drain`);
    return new Promise((resolve, reject) => {
      this._serialPort.drain((err) => {
        if (err) reject(err);
        else {
          this.logMessage(`--> Tx {empty}`);
          resolve();
        }
      });
    });
  }

  private async setDtr(value: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      this._serialPort.set({ dtr: value }, (err) => {
        if (err) {
          this.logMessage(`DTR: ERROR:${err.name} - ${err.message}`);
          reject(err);
        } else {
          this.logMessage(`DTR: ${value}`);
          resolve();
        }
      });
    });
  }

  private dumpBytes(bytes: Uint8Array, startOffset: number, maxBytes: number, dumpId: string) {
    /// dump hex and ascii data
    let displayOffset: number = 0;
    let currOffset = startOffset;
    const byteCount = bytes.length > maxBytes ? maxBytes : bytes.length;
    this.logMessage(`-- -------- ${dumpId} ------------------ --`);
    while (displayOffset < byteCount) {
      let hexPart = '';
      let asciiPart = '';
      const remainingBytes = byteCount - displayOffset;
      const lineLength = remainingBytes > 16 ? 16 : remainingBytes;
      for (let i = 0; i < lineLength; i++) {
        const byteValue = bytes[currOffset + i];
        hexPart += byteValue.toString(16).padStart(2, '0').toUpperCase() + ' ';
        asciiPart += byteValue >= 0x20 && byteValue <= 0x7e ? String.fromCharCode(byteValue) : '.';
      }
      const offsetPart = displayOffset.toString(16).padStart(5, '0').toUpperCase();

      this.logMessage(`${offsetPart}- ${hexPart.padEnd(48, ' ')}  '${asciiPart}'`);
      currOffset += lineLength;
      displayOffset += lineLength;
    }
    this.logMessage(`-- -------- ${'-'.repeat(dumpId.length)} ------------------ --`);
    this.logMessage(`-- ${bytes.length} Bytes --`);
  }

  /**
   * write message to formatting log (when log enabled)
   *
   * @param the message to be written
   * @returns nothing
   */
  public logMessage(message: string): void {
    if (UsbSerialTerminal.isDebugLogEnabled && UsbSerialTerminal.debugOutputChannel !== undefined) {
      //Write to output window.
      UsbSerialTerminal.debugOutputChannel.appendLine(message);
    }
  }
}
