/* eslint-disable @typescript-eslint/no-unused-vars */
'use strict';

import * as vscode from 'vscode';
import { EndOfLine } from 'vscode';
import { SerialPort } from 'serialport';
import { UsbSerial } from '../usb.serial';

import { usb, getDeviceList, findByIds } from 'usb';

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { isSpin1File, isSpin2File } from '../spin.vscode.utils';
import { waitSec } from '../timerUtils';
import { usbDeviceNodeList } from '../platformUtils';

export class USBDocGenerator {
  private isDebugLogEnabled: boolean = true; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private debugOutputChannel: vscode.OutputChannel | undefined = undefined;
  private endOfLineStr: string = '\r\n';

  constructor() {
    if (this.isDebugLogEnabled) {
      if (this.debugOutputChannel === undefined) {
        //Create output channel
        this.debugOutputChannel = vscode.window.createOutputChannel('Spin/Spin2 USBDocGen DEBUG');
        this.logMessage('Spin/Spin2 USBDocGen log started.');
      } else {
        this.logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }
  }

  public async generateUsbReportDocument(): Promise<void> {
    const textEditor = vscode.window.activeTextEditor;
    if (textEditor) {
      this.endOfLineStr = textEditor.document.eol == EndOfLine.CRLF ? '\r\n' : '\n';
      const currentlyOpenTabfilePath = textEditor.document.uri.fsPath;
      const currentlyOpenTabfolderName = path.dirname(currentlyOpenTabfilePath);
      const currentlyOpenTabfileName = path.basename(currentlyOpenTabfilePath);
      this.logMessage(`+ (DBG) generateUsbReportDocument() fsPath-(${currentlyOpenTabfilePath})`);
      this.logMessage(`+ (DBG) generateUsbReportDocument() folder-(${currentlyOpenTabfolderName})`);
      this.logMessage(`+ (DBG) generateUsbReportDocument() filename-(${currentlyOpenTabfileName})`);
      let isSpinFile: boolean = isSpin2File(currentlyOpenTabfileName);
      let isSpin1: boolean = false;
      let fileType: string = '.spin2';
      if (!isSpinFile) {
        isSpinFile = isSpin1File(currentlyOpenTabfileName);
        if (isSpinFile) {
          isSpin1 = true;
          fileType = '.spin';
        }
      }

      if (isSpinFile) {
        const objectName: string = currentlyOpenTabfileName.replace(fileType, '');
        const docFilename: string = currentlyOpenTabfileName.replace(fileType, '.usb.txt');
        this.logMessage(`+ (DBG) generateUsbReportDocument() outFn-(${docFilename})`);
        const outFSpec = path.join(currentlyOpenTabfolderName, docFilename);
        this.logMessage(`+ (DBG) generateUsbReportDocument() outFSpec-(${outFSpec})`);

        const rptFileID: number = fs.openSync(outFSpec, 'w');

        const rptHoriz: string = '─';

        // write report title
        const platformString: string = this.platformString();
        this.logMessage(`+ (DBG) ---- running on ${platformString} ----`);
        const rptTitle: string = `USB Libraries on Platforms Test Report for [${platformString}]`;
        fs.appendFileSync(rptFileID, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        fs.appendFileSync(rptFileID, `${rptTitle}${this.endOfLineStr}`); // blank line
        fs.appendFileSync(rptFileID, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        fs.appendFileSync(rptFileID, `${this.endOfLineStr}`); // blank line
        fs.appendFileSync(rptFileID, `Run :  ${this.reportDateString()}${this.endOfLineStr}${this.endOfLineStr}`);
        const versionStr: string = this.extensionVersionString();
        fs.appendFileSync(rptFileID, `    Tool :  VSCode Spin2 Extension ${versionStr} ${this.endOfLineStr}${this.endOfLineStr}`);

        // -------------------------------------------------------------------
        // do report here
        // -------------------------------------------------------------------
        // LIBRARY: serialPort
        fs.appendFileSync(rptFileID, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        const lib1Title: string = 'Using library [serialPort]:';
        fs.appendFileSync(rptFileID, `${lib1Title}${this.endOfLineStr}`); // blank line
        let deviceCount: number = 0;
        await SerialPort.list()
          .then((ports) => {
            ports.forEach((port) => {
              deviceCount++;
              fs.appendFileSync(rptFileID, `-- DEVICE -----${this.endOfLineStr}`);
              fs.appendFileSync(rptFileID, ` Port: ${port.path}${this.endOfLineStr}`);
              fs.appendFileSync(rptFileID, ` Manufacturer: ${port.manufacturer}${this.endOfLineStr}`);
              fs.appendFileSync(rptFileID, ` Serial Number: ${port.serialNumber}${this.endOfLineStr}`);
              fs.appendFileSync(rptFileID, ` Location ID: ${port.locationId}${this.endOfLineStr}`);
              fs.appendFileSync(rptFileID, ` Vendor ID: ${port.vendorId}${this.endOfLineStr}`);
              fs.appendFileSync(rptFileID, ` Product ID: ${port.productId}${this.endOfLineStr}`);
            });
          })
          .catch((err) => {
            fs.appendFileSync(rptFileID, `ERROR: listing ports: ${err}${this.endOfLineStr}`);
          });
        if (deviceCount == 0) {
          fs.appendFileSync(rptFileID, ` { No serialPort devices found }${this.endOfLineStr}`);
        }
        fs.appendFileSync(rptFileID, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        fs.appendFileSync(rptFileID, `${this.endOfLineStr}`); // blank line

        // -------------------------------------------------------------------
        // LIBRARY: USB

        fs.appendFileSync(rptFileID, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        const lib2Title: string = 'Using library [usb]:';
        fs.appendFileSync(rptFileID, `${lib2Title}${this.endOfLineStr}`); // blank line
        const devices: usb.Device[] = await getDeviceList();
        deviceCount = devices.length;
        const serialDevices: usb.Device[] = devices.filter((device) => {
          return device.deviceDescriptor.bDeviceClass === 0x02;
        });
        fs.appendFileSync(rptFileID, `* found (${serialDevices.length}) serial devices within (${devices.length}) total devices${this.endOfLineStr}`);
        devices.forEach((device) => {
          this.showUsbDevice(rptFileID, device);
        });
        if (deviceCount == 0) {
          fs.appendFileSync(rptFileID, ` { No [usb] devices found }${this.endOfLineStr}`);
        }
        fs.appendFileSync(rptFileID, `${this.endOfLineStr}`); // blank line
        const venFTDI: number = 0x0403;
        const dvcPropPlug: number = 0x6015;
        const device: usb.Device = await findByIds(venFTDI, dvcPropPlug);
        if (device !== undefined) {
          this.showUsbDevice(rptFileID, device);
        } else {
          fs.appendFileSync(rptFileID, ` { No PropTool device found }${this.endOfLineStr}`);
        }

        fs.appendFileSync(rptFileID, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        fs.appendFileSync(rptFileID, `${this.endOfLineStr}`); // blank line

        // -------------------------------------------------------------------
        // Identify Device
        fs.appendFileSync(rptFileID, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        const idDvcTitle: string = 'Open device and get P2 Info:';
        fs.appendFileSync(rptFileID, `${idDvcTitle}${this.endOfLineStr}`); // blank line

        const deviceNodes: string[] = await UsbSerial.serialDeviceList();
        this.logMessage(`dvcNodes=[${deviceNodes}]`); // blank line

        //const deviceNodes1: string[] = usbDeviceNodeList(this.debugOutputChannel);
        //this.logMessage(`dvcNodes1=[${deviceNodes1}]`); // blank line
        if (deviceNodes.length > 0) {
          for (let index = 0; index < deviceNodes.length; index++) {
            const deviceNode = deviceNodes[index];
            fs.appendFileSync(rptFileID, ` [ #${index + 1} - ${deviceNode} ]${this.endOfLineStr}`);
          }
          fs.appendFileSync(rptFileID, `${this.endOfLineStr}`); // blank line
          const portParts = deviceNodes[0].split(',');
          const deviceSerial: string = portParts.length > 1 ? portParts[1] : '';
          const deviceNode: string = portParts[0];
          fs.appendFileSync(rptFileID, `Found PropPlug S/N #${deviceSerial} at [${deviceNode}]${this.endOfLineStr}`); // blank line

          const usbPort = new UsbSerial(deviceNode);
          // Wrap the interval checking code in a new Promise
          const deviceProperties: [string, string] = await new Promise((resolve, reject) => {
            const intervalId = setInterval(() => {
              const [deviceString, deviceErrorString] = usbPort.getIdStringOrError();
              if (deviceString.length > 0 || deviceErrorString.length > 0) {
                clearInterval(intervalId);
                resolve([deviceString, deviceErrorString]);
              }
            }, 100); // Check every 100ms
          });

          const [deviceString, deviceErrorString] = deviceProperties;
          this.logMessage(`* deviceString=[${deviceString}], deviceErrorString=[${deviceErrorString}]`); // blank line
          let idResult: string = deviceString;
          if (deviceErrorString.length > 0) {
            idResult = deviceString.length > 0 ? `${deviceString}: ERROR: ${deviceErrorString}` : `ERROR: ${deviceErrorString}`;
          }

          //if (idResult !== undefined) {
          fs.appendFileSync(rptFileID, ` P2: ${idResult}${this.endOfLineStr}`);
          //} else {
          //    fs.appendFileSync(rptFileID, ` { No P2 Info returned }${this.endOfLineStr}`);
          //}
          fs.appendFileSync(rptFileID, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        } else {
          this.logMessage(`dvcNodes=[${deviceNodes}]`); // blank line
          fs.appendFileSync(rptFileID, ` { No USB Serial devices found }${this.endOfLineStr}`);
        }

        // write report footer
        fs.appendFileSync(rptFileID, `${this.endOfLineStr}`); // blank line
        fs.appendFileSync(rptFileID, `${this.endOfLineStr}`); // blank line
        fs.appendFileSync(rptFileID, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        fs.appendFileSync(rptFileID, `VSCode Spin2 Extension by:${this.endOfLineStr}`);
        fs.appendFileSync(rptFileID, ` Iron Sheep Productions, LLC${this.endOfLineStr}`);
        fs.closeSync(rptFileID);
      } else {
        this.logMessage(`+ (DBG) generateUsbReportDocument() NOT a spin file! can't generate doc.`);
      }
    } else {
      this.logMessage(`+ (DBG) generateUsbReportDocument() NO active editor.`);
    }
  }

  private showUsbDevice(fileID: number, device: usb.Device) {
    fs.appendFileSync(fileID, `-- DEVICE -----${this.endOfLineStr}`);
    const vidString = this.hexString(device.deviceDescriptor.idVendor, 4);
    const pidString = this.hexString(device.deviceDescriptor.idProduct, 4);
    const equipName = this.stringForVidPid(device.deviceDescriptor.idVendor, device.deviceDescriptor.idProduct);
    fs.appendFileSync(fileID, ` Device ID: ${vidString} : ${pidString} - ${equipName}${this.endOfLineStr}`);
    const classStr: string = this.stringForClass(device.deviceDescriptor.bDeviceClass);
    fs.appendFileSync(fileID, ` Class: ${classStr}${this.endOfLineStr}`);
    // Add more properties as needed
  }

  private stringForVidPid(vid: number, pid: number): string {
    let desredInterp: string = '?unknown?';
    let deviceName: string = '';
    let company: string = '';
    switch (vid) {
      case 0x5ac:
        company = 'Apple Inc.';
        break;
      case 0x5e3:
        company = 'Genesys Logic, Inc.';
        break;
      case 0x1d5c:
        company = 'Fresco Logic Inc.';
        break;
      case 0x0403:
        company = 'Future Technology Devices International Limited';
        break;
      default:
        company = `company ${vid}(${this.hexString(vid, 4)})`;
        break;
    }
    switch (pid) {
      case 0x101d:
        deviceName = 'USB2 Hub';
        break;
      case 0x101e:
        deviceName = 'USB3 Gen2 Hub';
        break;
      case 0x1114:
        deviceName = 'Studio Display';
        break;
      case 0x6015:
        deviceName = 'Prop Plug - Parallax.com';
        break;
      case 0x7102:
        deviceName = 'Generic Billboard Device';
        break;
      case 0x749:
        deviceName = 'USB3.0 Card Reader';
        break;
      case 0x610:
        deviceName = 'USB2.1 Hub';
        break;

      default:
        deviceName = `device ${pid}(${this.hexString(pid, 4)})`;
        break;
    }
    desredInterp = `${deviceName} (${company})`;

    return desredInterp;
  }

  private stringForClass(usbClass: number): string {
    let desredInterp: string = '?unknown?';
    switch (usbClass) {
      case 0:
        desredInterp = 'Null?';
        break;

      case 1:
        desredInterp = 'Audio';
        break;

      case 2:
        desredInterp = 'Comm(CDC)';
        break;

      case 3:
        desredInterp = 'HID';
        break;

      case 5:
        desredInterp = 'Physical';
        break;

      case 6:
        desredInterp = 'Imaging';
        break;

      case 7:
        desredInterp = 'Printer';
        break;

      case 8:
        desredInterp = 'Mass Storage';
        break;

      case 9:
        desredInterp = 'Hub';
        break;

      case 17: // 0x11
        desredInterp = 'Billboard';
        break;

      case 239: // 0xEF
        desredInterp = 'Misc.';
        break;

      default:
        desredInterp = `?unknown=${usbClass}(0x${this.hexString(usbClass, 2)})?`;
        break;
    }
    return desredInterp;
  }

  private hexString(value: number, width: number): string {
    const desiredInterp: string = `${value.toString(16).toUpperCase().padStart(width, '0')}`;
    return desiredInterp;
  }

  public async showDocument(reportFileType: string) {
    const textEditor = vscode.window.activeTextEditor;
    if (textEditor) {
      const currentlyOpenTabfilePath = textEditor.document.uri.fsPath;
      const currentlyOpenTabfolderName = path.dirname(currentlyOpenTabfilePath);
      const currentlyOpenTabfileName = path.basename(currentlyOpenTabfilePath);
      //this.logMessage(`+ (DBG) generateDocument() fsPath-(${currentlyOpenTabfilePath})`);
      //this.logMessage(`+ (DBG) generateDocument() folder-(${currentlyOpenTabfolderName})`);
      //this.logMessage(`+ (DBG) generateDocument() filename-(${currentlyOpenTabfileName})`);
      let isSpinFile: boolean = isSpin2File(currentlyOpenTabfileName);
      let isSpin1: boolean = false;
      let fileType: string = '.spin2';
      if (!isSpinFile) {
        isSpinFile = isSpin1File(currentlyOpenTabfileName);
        if (isSpinFile) {
          isSpin1 = true;
          fileType = '.spin';
        }
      }
      if (isSpinFile) {
        const docFilename: string = currentlyOpenTabfileName.replace(fileType, reportFileType);
        //this.logMessage(`+ (DBG) generateDocument() outFn-(${docFilename})`);
        const outFSpec = path.join(currentlyOpenTabfolderName, docFilename);
        //this.logMessage(`+ (DBG) generateDocument() outFSpec-(${outFSpec})`);
        const doc = await vscode.workspace.openTextDocument(outFSpec); // calls back into the provider
        await vscode.window.showTextDocument(doc, {
          preview: false,
          viewColumn: vscode.ViewColumn.Beside
        });
      }
    }
  }

  private platformString(): string {
    let desiredOSName: string = '{unknown}';
    const platform = os.platform();

    if (platform === 'win32') {
      desiredOSName = 'Windows';
    } else if (platform === 'darwin') {
      desiredOSName = 'macOS';
    } else if (platform === 'linux') {
      desiredOSName = 'Linux';
    } else {
      desiredOSName = `Unknown?? platform: ${platform}`;
    }
    return desiredOSName;
  }

  private extensionVersionString(): string {
    // return the version string of this extension
    const extension = vscode.extensions.getExtension('IronSheepProductionsLLC.spin2');
    let version: string = extension?.packageJSON.version;
    if (version === undefined) {
      version = '?.?.?';
    }
    return `v${version}`; // the version of the extension
  }

  private reportDateString(): string {
    const date = new Date();
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: true
    };

    const formattedDate = new Intl.DateTimeFormat('en-US', options).format(date);
    return formattedDate; // Prints: "Saturday, January 13, 2024 at 6:50:29 PM"
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
