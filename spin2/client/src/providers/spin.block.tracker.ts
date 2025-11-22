'use strict';
// server/src/parser/spin.semantic.findings.ts

import * as vscode from 'vscode';

export enum eBLockType {
  Unknown = 0,
  isCon,
  isDat,
  isVar,
  isObj,
  isPub,
  isPri
}

export interface IBlockSpan {
  startLineIdx: number;
  endLineIdx: number;
  blockType: eBLockType;
  sequenceNbr: number;
}

// ----------------------------------------------------------------------------
//  Shared Data Storage for what our current document contains
//   CLASS DocumentFindings
export class LocatedBlockFindings {
  // tracking of Spin Code Blocks
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private debugOutputChannel: vscode.OutputChannel | undefined = undefined;

  private instanceId: string = `BT:${new Date().getTime()}`;

  private priorBlockType: eBLockType = eBLockType.Unknown;
  private priorBlockStartLineIdx: number = -1;
  private priorInstanceCount: number = 0;
  private codeBlockSpans: IBlockSpan[] = [];
  private findingsLogEnabled: boolean = false;

  constructor(callerOutputChannel: vscode.OutputChannel, isCallerDebugEnabled: boolean) {
    this.isDebugLogEnabled = isCallerDebugEnabled;
    this.debugOutputChannel = callerOutputChannel;
  }
  public clear() {
    // clear spin-code-block tracking
    this._logMessage(`  -- CLR-RCD-BLOCKs`);
    this.priorBlockType = eBLockType.Unknown;
    this.priorBlockStartLineIdx = -1;
    this.priorInstanceCount = 0;
    this.codeBlockSpans = [];
  }

  public get id(): string {
    return this.instanceId;
  }

  //
  // PRIVATE (Utility) Methods
  //
  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled && this.debugOutputChannel !== undefined) {
      //Write to output window.
      this.debugOutputChannel.appendLine(message);
    }
  }

  public recordBlockStart(eCurrBlockType: eBLockType, currLineIdx: number) {
    this._logMessage(`  -- FND-RCD-BLOCK iblockType=[${eCurrBlockType}], span=[${currLineIdx} - ???]`);
    if (currLineIdx == 0 && this.priorBlockType != eBLockType.Unknown) {
      // we are getting a replacement for the default CON start section, use it!
      this.priorBlockType = eCurrBlockType; // override the default with possibly NEW block type
      this.priorBlockStartLineIdx = currLineIdx;
      this.priorInstanceCount = 1;
    } else if (this.priorBlockType == eBLockType.Unknown) {
      // we are starting the first block
      this.priorBlockType = eCurrBlockType;
      this.priorBlockStartLineIdx = currLineIdx;
      this.priorInstanceCount = 1;
    } else {
      // we are starting a later block, lets finish prior then start the new
      //const isFirstOfThisType: boolean = this.priorBlockType != eCurrBlockType ? false : true;
      const newBlockSpan: IBlockSpan = {
        blockType: this.priorBlockType,
        sequenceNbr: this.priorInstanceCount,
        startLineIdx: this.priorBlockStartLineIdx,
        endLineIdx: currLineIdx - 1 // ends at prior line
      };
      this.codeBlockSpans.push(newBlockSpan);
      this._logMessage(
        `  -- FND-RCD-ADD sequenceNbr=[${newBlockSpan.sequenceNbr}], blockType=[${newBlockSpan.blockType}], span=[${newBlockSpan.startLineIdx} - ${newBlockSpan.endLineIdx}]`
      );
      this.priorInstanceCount = this.priorBlockType == eCurrBlockType ? this.priorInstanceCount + 1 : 1;
      this.priorBlockStartLineIdx = currLineIdx;
      this.priorBlockType = eCurrBlockType;
    }
  }

  public finishFinalBlock(finalLineIdx: number) {
    this._logMessage(`  -- FND-RCD-BLOCK LAST span=[??? - ${finalLineIdx}]`);
    if (this.priorBlockType != eBLockType.Unknown) {
      // we are ending the last block
      const newBlockSpan: IBlockSpan = {
        blockType: this.priorBlockType,
        sequenceNbr: this.priorInstanceCount,
        startLineIdx: this.priorBlockStartLineIdx,
        endLineIdx: finalLineIdx // ends at the last line of the file
      };
      this._logMessage(
        `  -- FND-RCD-ADD LAST sequenceNbr=[${newBlockSpan.sequenceNbr}], blockType=[${newBlockSpan.blockType}], span=[${newBlockSpan.startLineIdx} - ${newBlockSpan.endLineIdx}]`
      );
      this.codeBlockSpans.push(newBlockSpan);
    }
  }

  public blockSpans(): IBlockSpan[] {
    return this.codeBlockSpans;
  }
}
