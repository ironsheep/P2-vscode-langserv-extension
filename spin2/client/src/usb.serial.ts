/* eslint-disable @typescript-eslint/no-unused-vars */
'use strict';

import * as vscode from 'vscode';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { waitMSec, waitSec } from './timerUtils';

const DEFAULT_DOWNLOAD_BAUD = 2000000;

export class UsbSerial {
  private isDebugLogEnabled: boolean = true; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private debugOutputChannel: vscode.OutputChannel | undefined = undefined;
  private endOfLineStr: string = '\r\n';
  private _deviceNode: string = '';
  private _serialPort: SerialPort;
  private _serialParser: ReadlineParser;
  private _downloadBaud: number = DEFAULT_DOWNLOAD_BAUD;
  private _p2DeviceId: string = '';
  private _p2loadLimit: number = 0;
  private _latestError: string = '';
  private _dtrValue: boolean = false;

  static async serialDeviceList(): Promise<string[]> {
    const devicesFound: string[] = [];
    const ports = await SerialPort.list();
    ports.forEach((port) => {
      const serialNumber: string = port.serialNumber;
      const deviceNode: string = port.path;
      if (port.vendorId == '0403' && port.productId == '6015') {
        devicesFound.push(`${deviceNode},${serialNumber}`);
      }
    });
    return devicesFound;
  }

  constructor(deviceNode: string) {
    this._deviceNode = deviceNode;
    if (this.isDebugLogEnabled) {
      if (this.debugOutputChannel === undefined) {
        //Create output channel
        this.debugOutputChannel = vscode.window.createOutputChannel('Spin/Spin2 USB.Serial DEBUG');
        this.logMessage('Spin/Spin2 USB.Serial log started.');
      } else {
        this.logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }
    this.logMessage(`* Connecting to ${this._deviceNode}`);
    this._serialPort = new SerialPort({
      path: this._deviceNode,
      baudRate: this._downloadBaud,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false
    });
    // Open errors will be emitted as an error event
    this._serialPort.on('error', (err) => this.handleSerialError(err.message));
    this._serialPort.on('open', () => this.handleSerialOpen());

    // wait for any returned data
    this._serialParser = this._serialPort.pipe(new ReadlineParser({ delimiter: this.endOfLineStr }));
    this._serialParser.on('data', (data) => this.handleSerialRx(data));

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

  public getIdStringOrError(): [string, string] {
    return [this._p2DeviceId, this._latestError];
  }

  private handleSerialError(errMessage: string) {
    this.logMessage(`* handleSerialError() Error: ${errMessage}`);
    this._latestError = errMessage;
  }

  private handleSerialOpen() {
    this.logMessage(`* handleSerialOpen() open...`);
    //const myString: string = 'Hello, World! 0123456789';
    //const myBuffer: Buffer = Buffer.from(myString, 'utf8');
    //const myUint8Array: Uint8Array = new Uint8Array(myBuffer);
    //this.downloadNew(myUint8Array); // TESTING
    //this.identifyPropeller();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleSerialRx(data: any) {
    this.logMessage(`<-- Rx [${data}]`);
    const lines: string[] = data.split(/\r?\n/).filter(Boolean);
    let propFound: boolean = false;
    if (lines.length > 0) {
      for (let index = 0; index < lines.length; index++) {
        const replyString: string = 'Prop_Ver ';
        const currLine = lines[index];
        if (currLine.startsWith(replyString) && currLine.length == 10) {
          this.logMessage(`  -- REPLY [${currLine}](${currLine.length})`);
          const idLetter = currLine.charAt(replyString.length);
          this._p2DeviceId = this.descriptionForVerLetter(idLetter);
          this._p2loadLimit = this.limitForVerLetter(idLetter);
          propFound = true;
          break;
        }
      }
    }
    if (propFound == true) {
      // log findings...
      this.logMessage(`* FOUND Prop: [${this._p2DeviceId}]`);
    }
  }

  public async identifyPropeller(): Promise<void> {
    const requestPropType: string = '> Prop_Chk 0 0 0 0';
    this.logMessage(`* identifyPropeller() - port open (${this._serialPort.isOpen})`);
    try {
      await this.waitForPortOpen();
      // continue with ID effort...
      await waitMSec(500);
      await this.setDtr(true);
      await waitMSec(500);
      await this.setDtr(false);
      //this.logMessage(`  -- plug reset!`);
      // NO wait yields a 1.5 mSec delay on my mac Studio
      // NOTE: if nothing sent, and Edge Module default switch settings, the prop will boot in 142 mSec
      await waitMSec(5); // at lease 5 mSec delay
      await this.write(`${requestPropType}\r`);
    } catch (error) {
      this.logMessage(`* identifyPropeller() ERROR: ${error.message}`);
    }
  }

  public async download(uint8Bytes: Uint8Array): Promise<void> {
    const requestStartDownload: string = '> Prop_Txt 0 0 0 0';
    const byteCount: number = uint8Bytes.length < this._p2loadLimit ? uint8Bytes.length : this._p2loadLimit;
    this.logMessage(`* download() - port open (${this._serialPort.isOpen})`);
    // wait for port to be open...
    try {
      const didOpen = await this.waitForPortOpen();
      this.logMessage(`* download() port opened = (${didOpen}) `);

      // Continue with download...
      if (this.usbConnected && uint8Bytes.length > 0) {
        // * Setup for download
        const dataBase64: string = Buffer.from(uint8Bytes).toString('base64');
        // Break this up into 128 char lines with > sync chars starting each
        const LINE_LENGTH: number = 512;
        // silicon doc says: It's a good idea to start each Base64 data line with a ">" character, to keep the baud rate tightly calibrated.
        const lineCount: number = Math.ceil(dataBase64.length / LINE_LENGTH); // Corrected lineCount calculation
        const lastLineLength: number = dataBase64.length % LINE_LENGTH;
        // * Reset our propeller
        await waitMSec(500);
        await this.setDtr(true);
        await waitMSec(500);
        await this.setDtr(false);
        //this.logMessage(`  -- plug reset!`);
        // NO wait yields a 1.5 mSec delay on my mac Studio
        // NOTE: if nothing sent, and Edge Module default switch settings, the prop will boot in 142 mSec
        await waitMSec(5); // at lease 5 mSec delay
        // * Now do the download
        await this.write(`${requestStartDownload}\r`);
        for (let index = 0; index < lineCount; index++) {
          const lineLength = index == lineCount - 1 ? lastLineLength : LINE_LENGTH;
          const singleLine = dataBase64.substring(index * LINE_LENGTH, index * LINE_LENGTH + lineLength);
          await this.write('>' + singleLine);
          await waitMSec(5); // at lease 5 mSec delay
        }
        await this.write(' ~'); // PNut doesn't send a trailing CR/LF
      }
    } catch (error) {
      this.logMessage(`* download() ERROR: ${error.message}`);
    }
  }

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
      }, 30); // Check every 30ms
    });
  }

  public async close(): Promise<void> {
    // release the usb port
    await waitMSec(500);
    this._serialPort.close((err) => {
      if (err) {
        this.logMessage(`* close() Error: ${err.message}`);
      }
    });
    this.logMessage(`* close() - port close: isOpen=(${this._serialPort.isOpen})`);
  }

  /*
  private async downloadNew(uint8Bytes: Uint8Array) {
    const byteCount: number = uint8Bytes.length;
    const base64String: string = Buffer.from(uint8Bytes).toString('base64');
    this.dumpStringHex(base64String, 'builtin64');
  }

  private dumpBufferHex(uint6Buffer: Uint8Array, callerId: string) {
    //
    const byteCount: number = uint6Buffer.length;
    /// dump hex and ascii data
    let displayOffset: number = 0;
    let currOffset = 0;
    this.logMessage(`-- -------- ${callerId} ------------------ --`);
    while (displayOffset < byteCount) {
      let hexPart = '';
      let asciiPart = '';
      const remainingBytes = byteCount - displayOffset;
      const lineLength = remainingBytes > 16 ? 16 : remainingBytes;
      for (let i = 0; i < lineLength; i++) {
        const byteValue = uint6Buffer[currOffset + i];
        hexPart += byteValue.toString(16).padStart(2, '0').toUpperCase() + ' ';
        asciiPart += byteValue >= 0x20 && byteValue <= 0x7e ? String.fromCharCode(byteValue) : '.';
      }
      const offsetPart = displayOffset.toString(16).padStart(5, '0').toUpperCase();

      this.logMessage(`${offsetPart}- ${hexPart.padEnd(48, ' ')}  '${asciiPart}'`);
      currOffset += lineLength;
      displayOffset += lineLength;
    }
    this.logMessage(`-- -------- -------- ------------------ --`);
  }

  private dumpStringHex(uint6Buffer: string, callerId: string) {
    //
    const byteCount: number = uint6Buffer.length;
    let displayOffset: number = 0;
    let currOffset = 0;
    this.logMessage(`-- -------- ${callerId} ------------------ --`);
    while (displayOffset < byteCount) {
      let hexPart = '';
      let asciiPart = '';
      const remainingBytes = byteCount - displayOffset;
      const lineLength = remainingBytes > 16 ? 16 : remainingBytes;
      for (let i = 0; i < lineLength; i++) {
        const byteValue = uint6Buffer.charCodeAt(currOffset + i);
        hexPart += byteValue.toString(16).padStart(2, '0').toUpperCase() + ' ';
        asciiPart += byteValue >= 0x20 && byteValue <= 0x7e ? String.fromCharCode(byteValue) : '.';
      }
      const offsetPart = displayOffset.toString(16).padStart(5, '0').toUpperCase();

      this.logMessage(`${offsetPart}- ${hexPart.padEnd(48, ' ')}  '${asciiPart}'`);
      currOffset += lineLength;
      displayOffset += lineLength;
    }
    this.logMessage(`-- -------- -------- ------------------ --`);
  }
  */

  private async write(value: string): Promise<void> {
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
          this._dtrValue = value;
          this.logMessage(`DTR: ${value}`);
          resolve();
        }
      });
    });
  }

  private limitForVerLetter(idLetter: string): number {
    let desiredvalue: number = 0;
    if (idLetter === 'A') {
      desiredvalue = 0x100000;
    } else if (idLetter === 'B') {
      desiredvalue = 0x040000;
    } else if (idLetter === 'C') {
      desiredvalue = 0x008000;
    } else if (idLetter === 'D') {
      desiredvalue = 0x020000;
    } else if (idLetter === 'E') {
      desiredvalue = 0x080000;
    } else if (idLetter === 'F') {
      desiredvalue = 0x100000;
    } else if (idLetter === 'G') {
      desiredvalue = 0x100000;
    }
    return desiredvalue;
  }

  private descriptionForVerLetter(idLetter: string): string {
    let desiredInterp: string = '?unknown-propversion?';
    if (idLetter === 'A') {
      desiredInterp = 'FPGA - 8 cogs, 512KB hub, 48 smart pins 63..56, 39..0, 80MHz';
    } else if (idLetter === 'B') {
      desiredInterp = 'FPGA - 4 cogs, 256KB hub, 12 smart pins 63..60/7..0, 80MHz';
    } else if (idLetter === 'C') {
      desiredInterp = 'unsupported';
    } else if (idLetter === 'D') {
      desiredInterp = 'unsupported';
    } else if (idLetter === 'E') {
      desiredInterp = 'FPGA - 4 cogs, 512KB hub, 18 smart pins 63..62/15..0, 80MHz';
    } else if (idLetter === 'F') {
      desiredInterp = 'unsupported';
    } else if (idLetter === 'G') {
      desiredInterp = 'P2X8C4M64P Rev B/C - 8 cogs, 512KB hub, 64 smart pins';
    }
    return desiredInterp;
  }

  /**
   * write message to formatting log (when log enabled)
   *
   * @param the message to be written
   * @returns nothing
   */
  public logMessage(message: string): void {
    if (this.isDebugLogEnabled && this.debugOutputChannel !== undefined) {
      //Write to output window.
      this.debugOutputChannel.appendLine(message);
    }
  }
}
