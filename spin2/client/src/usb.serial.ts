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
  private _downloadChecksumGood = false;
  private _downloadResponse: string = '';

  /* this NO-LONGER needed
  static async resetLibrary(): Promise<void> {
    // Clear the serialport module from the cache
    delete require.cache[require.resolve('serialport')];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SerialPort = require('serialport');
  }
  */

  static async serialDeviceList(): Promise<string[]> {
    const devicesFound: string[] = [];
    const ports = await SerialPort.list();

    // known bug? - sometimes the library returns no ports but they are plugged in
    // if we don't find any ports, we'll try again, once
    /*  NOPE KILL THIS AS IT DOESN'T WORK
    let havePorts = false;
    ports.forEach((port) => {
      if (port.vendorId == '0403' && port.productId == '6015') {
        havePorts = true;
      }
    });
    if (!havePorts) {
      await this.resetLibrary();
      ports = await SerialPort.list();
    }
	*/

    ports.forEach((port) => {
      const serialNumber: string = port.serialNumber;
      const deviceNode: string = port.path.replace('/dev/tty.us', '/dev/cu.us');
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

  public getIdStringOrError(): [string, string] {
    this.logMessage(`* getIdStringOrError() [${this._p2DeviceId}, ${this._latestError}]`);
    return [this._p2DeviceId, this._latestError];
  }

  private loadSerialPort(): void {
    this._serialPort = new SerialPort({
      path: this._deviceNode,
      baudRate: this._downloadBaud,
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

    //this._serialParser.on('data', (data) => this.handleSerialRx(data));
    this.startReadListener();
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
    //this.requestPropellerVersion();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleSerialRx(data?: any) {
    this.logMessage(`<-- Rx [${data}]`);
    const lines: string[] = data.split(/\r?\n/).filter(Boolean);
    let propFound: boolean = false;
    if (lines.length > 0) {
      for (let index = 0; index < lines.length; index++) {
        const replyString: string = 'Prop_Ver ';
        const currLine = lines[index];
        if (currLine === '.') {
          this._downloadChecksumGood = true;
          this._downloadResponse = currLine;
          break;
        } else if (currLine === '!') {
          this._downloadChecksumGood = false;
          this._downloadResponse = currLine;
        } else if (currLine.startsWith(replyString) && currLine.length == 10) {
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

  private async requestPropellerVersion(): Promise<void> {
    const requestPropType: string = '> Prop_Chk 0 0 0 0';
    this.logMessage(`* requestPropellerVersion() - port open (${this._serialPort.isOpen})`);
    try {
      await this.waitForPortOpen();
      // continue with ID effort...
      await waitMSec(250);
      await this.setDtr(true);
      await waitMSec(10);
      await this.setDtr(false);
      // Fm Silicon Doc:
      //   Unless preempted by a program in a SPI memory chip with a pull-up resistor on P60 (SPI_CK), the
      //     serial loader becomes active within 15ms of reset being released.
      //
      //   If nothing sent, and Edge Module default switch settings, the prop will boot in 142 mSec
      //
      // NO wait yields a 102 mSec delay on my mac Studio
      await waitMSec(15); // at least a  15 mSec delay, yields a 230mSec delay when 2nd wait above is 100 mSec
      await this.write(`${requestPropType}\r`);
    } catch (error) {
      this.logMessage(`* requestPropellerVersion() ERROR: ${error.message}`);
    }
  }

  public async resetPort(): Promise<void> {
    if (this._serialPort && this._serialPort.isOpen) {
      await this.close();
    }
    this.loadSerialPort();
  }

  public async deviceIsPropellerV2(): Promise<boolean> {
    await this.requestPropellerVersion(); // initiate request
    await waitMSec(200); // wait 0.2 sec for response (usually takes 0.09 sec)
    let foundPropellerStatus: boolean = false;
    const [deviceString, deviceErrorString] = this.getIdStringOrError();
    if (deviceErrorString.length > 0) {
      this.logMessage(`* deviceIsPropeller() ERROR: ${deviceErrorString}`);
    } else if (deviceString.length > 0 && deviceErrorString.length == 0) {
      foundPropellerStatus = true;
    }
    this.logMessage(`* deviceIsPropeller() -> (${foundPropellerStatus})`);
    return foundPropellerStatus;
  }

  public async download(uint8Bytes: Uint8Array, needsP2CheckumVerify: boolean): Promise<void> {
    // reset our status indicators
    this._downloadChecksumGood = false;
    this._downloadResponse = '';
    //
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
        // NOTE: Base64 encoding in typescript works by taking 3 bytes of data and encoding it as 4 printable
        //  characters.If the total number of bytes is not a multiple of 3, the output is padded with one or
        //  two = characters to make the length a multiple of 4.
        const dataBase64: string = Buffer.from(uint8Bytes).toString('base64').replace(/=+$/, '');
        // Break this up into 128 char lines with > sync chars starting each
        const LINE_LENGTH: number = 512;
        // silicon doc says: It's a good idea to start each Base64 data line with a ">" character, to keep the baud rate tightly calibrated.
        const lineCount: number = Math.ceil(dataBase64.length / LINE_LENGTH); // Corrected lineCount calculation
        const lastLineLength: number = dataBase64.length % LINE_LENGTH;
        // log what we are sending (or first part of it)
        this.dumpBytes(uint8Bytes, 0, 99, 'download-source');
        const dumpBytes = dataBase64.length < 100 ? dataBase64 : `${dataBase64.substring(0, 99)}...`;
        this.logMessage(`* download() SENDING [${dumpBytes}](${dataBase64.length})`);

        // * Now do the download
        await this.write(`${requestStartDownload}\r`);
        for (let index = 0; index < lineCount; index++) {
          const lineLength = index == lineCount - 1 ? lastLineLength : LINE_LENGTH;
          const singleLine = dataBase64.substring(index * LINE_LENGTH, index * LINE_LENGTH + lineLength);
          await this.write('>' + singleLine);
        }
        // PNut doesn't send a leading space or a trailing CR/LF
        if (needsP2CheckumVerify) {
          const READ_RETRY_COUNT: number = 100;
          this.stopReadListener();
          this.write('?'); // removed AWAIT to allow read to happen earlier
          let readValue: string = '';
          let retryCount = READ_RETRY_COUNT;
          while (null === (readValue = this._serialPort.read(1)) && --retryCount > 0) {
            await waitMSec(1);
          }
          //const response = await this._serialPort.read(1);
          //const statusMsg: string = this._downloadChecksumGood ? 'Checksum OK' : 'Checksum BAD';
          this.startReadListener();
          this.logMessage(`* download(RAM) end w/[${readValue}]`);
        } else {
          await this.write('~');
        }
      }
    } catch (error) {
      this.logMessage(`* download() ERROR: ${error.message}`);
    }
  }

  public async close(): Promise<void> {
    // (alternate suggested by perplexity search)
    // release the usb port
    if (this._serialPort && this._serialPort.isOpen) {
      await waitMSec(500);
    }
    return new Promise((resolve, reject) => {
      if (this._serialPort && this._serialPort.isOpen) {
        this._serialPort.close((err) => {
          if (err) {
            this.logMessage(`* close() Error: ${err.message}`);
            reject(err);
          } else {
            this.logMessage(`* close() - port close: isOpen=(${this._serialPort.isOpen})`);
            resolve();
          }
        });
      } else if (!this._serialPort.isOpen) {
        this.logMessage(`* close() ?? port already closed ??`);
        resolve();
      } else {
        this.logMessage(`* close() ?? no port to close ??`);
        resolve();
      }
    });
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
  private startReadListener() {
    // wait for any returned data
    this._serialParser.on('data', (data) => this.handleSerialRx(data));
  }

  private stopReadListener() {
    // stop waiting for any returned data
    this._serialParser.off('data', () => this.handleSerialRx());
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
    if (this.isDebugLogEnabled && this.debugOutputChannel !== undefined) {
      //Write to output window.
      this.debugOutputChannel.appendLine(message);
    }
  }
}
