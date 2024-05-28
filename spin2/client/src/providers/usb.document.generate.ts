/* eslint-disable @typescript-eslint/no-unused-vars */
'use strict';

import * as vscode from 'vscode';
import { EndOfLine } from 'vscode';
import { SerialPort } from 'serialport';
import { UsbSerial } from '../usb.serial';

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { isSpin1File, isSpin2File } from '../spin.vscode.utils';

export class USBDocGenerator {
  private isDebugLogEnabled: boolean = true; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private debugOutputChannel: vscode.OutputChannel | undefined = undefined;
  private endOfLineStr: string = '\r\n';
  private workingFolder: string = '';

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
      this.workingFolder = path.dirname(currentlyOpenTabfilePath);
      const currentlyOpenTabfileName = path.basename(currentlyOpenTabfilePath);
      this.logMessage(`+ (DBG) generateUsbReportDocument() fsPath-(${currentlyOpenTabfilePath})`);
      this.logMessage(`+ (DBG) generateUsbReportDocument() folder-(${this.workingFolder})`);
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
        const outFSpec = path.join(this.workingFolder, docFilename);
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
        // Identify Device
        fs.appendFileSync(rptFileID, `${rptHoriz.repeat(rptTitle.length)}${this.endOfLineStr}`); // horizontal line
        const idDvcTitle: string = 'Open device and get P2 Info:';
        fs.appendFileSync(rptFileID, `${idDvcTitle}${this.endOfLineStr}`); // blank line

        const deviceNodes: string[] = await UsbSerial.serialDeviceList();
        this.logMessage(`dvcNodes=[${deviceNodes}]`);
        this.logMessage(`CWD=[${process.cwd()}]`);

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

          const usbPort: UsbSerial = new UsbSerial(deviceNode);
          usbPort.identifyPropeller(); // initiate request
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
          //this.testDownloadFile(usbPort);
          usbPort.close(); // we're done with this port

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

  private testDownloadFile(usbPort: UsbSerial) {
    //const filename = 'blink.bin';
    const filename = 'blink_single.bin';
    const rootDir: string = path.dirname(this.workingFolder);
    const filespec = path.join(rootDir, 'USB-LOADER', filename);
    const datImage: Uint8Array = this.loadFileAsUint8Array(filespec);
    const goodLoad: boolean = this.loadUint8ArrayFailed(datImage) ? false : true;
    if (goodLoad && datImage.length > 0) {
      this.logMessage(`+ (DBG) testDownloadFile() downloading file=[${filename}](${datImage.length})`);
      usbPort.download(datImage);
    } else {
      this.logMessage(`+ (DBG) testDownloadFile() file not found [${filename}]`);
    }
  }

  public async showDocument(reportFileType: string) {
    const textEditor = vscode.window.activeTextEditor;
    if (textEditor) {
      const currentlyOpenTabfilePath = textEditor.document.uri.fsPath;
      this.workingFolder = path.dirname(currentlyOpenTabfilePath);
      const currentlyOpenTabfileName = path.basename(currentlyOpenTabfilePath);
      //this.logMessage(`+ (DBG) generateDocument() fsPath-(${currentlyOpenTabfilePath})`);
      //this.logMessage(`+ (DBG) generateDocument() folder-(${this.workingFolder})`);
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
        const outFSpec = path.join(this.workingFolder, docFilename);
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

  private loadFileAsUint8Array(fspec: string): Uint8Array {
    let fileContent: Uint8Array = new Uint8Array();
    let loadError: boolean = true;
    if (fs.existsSync(fspec)) {
      try {
        const buffer = fs.readFileSync(fspec);
        fileContent = new Uint8Array(buffer);
        loadError = false;
      } catch (err) {
        //ctx.logger.log(`TRC: loadFileAsString() fspec=[${fspec}] NOT FOUND!`);
      }
    } else {
      this.logMessage(`ERROR: file NOT Found! [${fspec}]`);
    }
    if (loadError) {
      const encoder = new TextEncoder();
      fileContent = new Uint8Array(encoder.encode('XY$$ZZY'));
    }
    return fileContent;
  }

  private loadUint8ArrayFailed(content: Uint8Array): boolean {
    // Convert Uint8Array back to string
    const decoder = new TextDecoder();
    const checkContent = content.length > 7 ? content.slice(0, 7) : content;
    const decodedString = decoder.decode(checkContent);
    // Test if decoded string is 'XY$$ZZY'
    const emptyStatus = decodedString === 'XY$$ZZY';
    this.logMessage(`  -- loadUint8ArrayFailed() -> (${emptyStatus})`);
    return emptyStatus;
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
