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
    this._serialPort.on('open', () => this.handleSerialOpen(this._serialPort));

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

  get connected(): boolean {
    return this._p2DeviceId === '' ? false : true;
  }

  public getIdStringOrError(): [string, string] {
    return [this._p2DeviceId, this._latestError];
  }

  private handleSerialError(errMessage: string) {
    this.logMessage(`* handleSerialError() Error: ${errMessage}`);
    this._latestError = errMessage;
  }

  private handleSerialOpen(usbPort: SerialPort) {
    this.logMessage(`* handleSerialOpen() open...`);
    this.requestP2IDString(usbPort);
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

  private async requestP2IDString(usbPort: SerialPort): Promise<void> {
    const requestPropType: string = '> Prop_Chk 0 0 0 0';
    this.logMessage(`* requestP2IDString() - port open (${usbPort.isOpen})`);
    await waitSec(1);
    await this.setDtr(usbPort, true);
    await waitSec(1);
    await this.setDtr(usbPort, false);
    //this.logMessage(`  -- plug reset!`);
    // NO wait yields a 1.5 mSec delay on my mac Studio
    // NOTE: if nothing sent, and Edge Module default switch settings, the prop will boot in 142 mSec
    await waitMSec(15);
    return await this.write(usbPort, `${requestPropType}\r`);
    /*return new Promise((resolve, reject) => {
      //this.logMessage(`* requestP2IDString() - EXIT`);
      resolve();
    });*/
  }

  private enterBootLoader(usbPort: SerialPort) {}

  private async write(usbPort: SerialPort, value: string): Promise<void> {
    //this.logMessage(`--> Tx ...`);
    return new Promise((resolve, reject) => {
      usbPort.write(value, (err) => {
        if (err) reject(err);
        else {
          resolve();
          this.logMessage(`--> Tx [${value.split(/\r?\n/).filter(Boolean)[0]}]`);
        }
      });
    });
  }

  private async drain(usbPort: SerialPort): Promise<void> {
    this.logMessage(`--> Tx drain`);
    return new Promise((resolve, reject) => {
      usbPort.drain((err) => {
        if (err) reject(err);
        else {
          this.logMessage(`--> Tx {empty}`);
          resolve();
        }
      });
    });
  }

  private async setDtr(usbPort: SerialPort, value: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      usbPort.set({ dtr: value }, (err) => {
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
