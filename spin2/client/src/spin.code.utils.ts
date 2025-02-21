'use strict';
// client/src/spin.code.utils.ts
import * as vscode from 'vscode';

export enum eParseState {
  Unknown = 0,
  inCon,
  inDat,
  inObj,
  inPub,
  inPri,
  inVar,
  inPAsmInline,
  inDatPAsm,
  inMultiLineComment,
  inMultiLineDocComment,
  inNothing
}

export class SpinCodeUtils {
  private isDebugLogEnabled: boolean = false;
  private debugOutputChannel: vscode.OutputChannel | undefined = undefined;

  public constructor() {}

  public enableLogging(channel: vscode.OutputChannel, doEnable: boolean = true): void {
    this.isDebugLogEnabled = doEnable;
    this.debugOutputChannel = channel;
  }

  private _logMessage(message: string): void {
    if (this.isDebugLogEnabled) {
      //Write to output window.
      this.debugOutputChannel.appendLine(message);
    }
  }

  public isFlexspinPreprocessorDirective(name: string): boolean {
    const flexspinDirectiveOfNote: string[] = [
      '#define',
      '#ifdef',
      '#ifndef',
      '#else',
      '#elseifdef',
      '#elseifndef',
      '#endif',
      '#error',
      '#include',
      '#warn',
      '#undef'
    ];
    const reservedStatus: boolean = flexspinDirectiveOfNote.indexOf(name.toLowerCase()) != -1;
    return reservedStatus;
  }

  public nameForParseState(state: eParseState): string {
    let desiredInterp: string = '?unknown?';
    switch (state) {
      case eParseState.inCon:
        desiredInterp = 'CON';
        break;
      case eParseState.inDat:
        desiredInterp = 'DAT';
        break;
      case eParseState.inDatPAsm:
        desiredInterp = 'DATpasm';
        break;
      case eParseState.inObj:
        desiredInterp = 'OBJ';
        break;
      case eParseState.inPri:
        desiredInterp = 'PRI';
        break;
      case eParseState.inPub:
        desiredInterp = 'PUB';
        break;
      case eParseState.inMultiLineComment:
        desiredInterp = 'mlCmt';
        break;
      case eParseState.inMultiLineDocComment:
        desiredInterp = 'mlDocCmt';
        break;
      case eParseState.inPAsmInline:
        desiredInterp = 'Pasm-in-line';
        break;
      case eParseState.inVar:
        desiredInterp = 'VAR';
        break;

      default:
        desiredInterp = '?unk-case?';
        break;
    }
    return desiredInterp;
  }

  public isSectionStartLine(line: string): {
    isSectionStart: boolean;
    inProgressStatus: eParseState;
  } {
    // return T/F where T means our string starts a new section!
    let startStatus: boolean = false;
    let inProgressState: eParseState = eParseState.Unknown;
    if (line.length > 2) {
      const sectionName: string = line.substring(0, 3).toUpperCase();
      const nextChar: string = line.length > 3 ? line.substring(3, 4) : ' ';
      if (nextChar.charAt(0).match(/[ \t'{]/)) {
        startStatus = true;
        if (sectionName === 'CON') {
          inProgressState = eParseState.inCon;
        } else if (sectionName === 'DAT') {
          inProgressState = eParseState.inDat;
        } else if (sectionName === 'OBJ') {
          inProgressState = eParseState.inObj;
        } else if (sectionName === 'PUB') {
          inProgressState = eParseState.inPub;
        } else if (sectionName === 'PRI') {
          inProgressState = eParseState.inPri;
        } else if (sectionName === 'VAR') {
          inProgressState = eParseState.inVar;
        } else {
          startStatus = false;
        }
      }
    }
    if (startStatus) {
      this._logMessage(`** isSectStart codeUt line=[${line}]`);
    }
    return {
      isSectionStart: startStatus,
      inProgressStatus: inProgressState
    };
  }

  public getNonCommentLineRemainder(startingOffset: number, line: string): string {
    let nonCommentRHSStr: string = line;
    //this.logMessage('  -- gnclr ofs=' + startingOffset + '[' + line + '](' + line.length + ')');
    // TODO: UNDONE make this into loop to find first ' not in string
    if (line.length - startingOffset > 0) {
      //this.logMessage('- gnclr startingOffset=[' + startingOffset + '], startingOffset=[' + line + ']');
      const currentOffset: number = this._skipWhite(line, startingOffset);
      // get line parts - we only care about first one
      let beginCommentOffset: number = line.indexOf("'", currentOffset);
      if (beginCommentOffset != -1) {
        // have single quote, is it within quoted string?
        const startDoubleQuoteOffset: number = line.indexOf('"', currentOffset);
        if (startDoubleQuoteOffset != -1) {
          const nonStringLine: string = this.removeDoubleQuotedStrings(line, false); // false disabled debug output
          beginCommentOffset = nonStringLine.indexOf("'", currentOffset);
        }
      }
      if (beginCommentOffset === -1) {
        beginCommentOffset = line.indexOf('{', currentOffset);
      }
      const nonCommentEOL: number = beginCommentOffset != -1 ? beginCommentOffset - 1 : line.length - 1;
      //this.logMessage('- gnclr startingOffset=[' + startingOffset + '], currentOffset=[' + currentOffset + ']');
      nonCommentRHSStr = line.substr(currentOffset, nonCommentEOL - currentOffset + 1).trim();
      //this.logMessage('- gnclr nonCommentRHSStr=[' + startingOffset + ']');

      const singleLineMultiBeginOffset: number = nonCommentRHSStr.indexOf('{', currentOffset);
      if (singleLineMultiBeginOffset != -1) {
        const singleLineMultiEndOffset: number = nonCommentRHSStr.indexOf('}', singleLineMultiBeginOffset);
        if (singleLineMultiEndOffset != -1) {
          const oneLineMultiComment: string = nonCommentRHSStr.substr(
            singleLineMultiBeginOffset,
            singleLineMultiEndOffset - singleLineMultiBeginOffset + 1
          );
          nonCommentRHSStr = nonCommentRHSStr.replace(oneLineMultiComment, '').trim();
        }
      }
    } else if (line.length - startingOffset == 0) {
      nonCommentRHSStr = '';
    }
    //if (line.substr(startingOffset).length != nonCommentRHSStr.length) {
    //    this.logMessage('  -- NCLR line [' + line.substr(startingOffset) + ']');
    //    this.logMessage('  --           [' + nonCommentRHSStr + ']');
    //}
    return nonCommentRHSStr;
  }

  private _skipWhite(line: string, currentOffset: number): number {
    let firstNonWhiteIndex: number = currentOffset;
    for (let index = currentOffset; index < line.length; index++) {
      if (line.substr(index, 1) != ' ' && line.substr(index, 1) != '\t') {
        firstNonWhiteIndex = index;
        break;
      }
    }
    return firstNonWhiteIndex;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public removeDoubleQuotedStrings(line: string, showDebug: boolean = true): string {
    //this.logMessage('- RQS line [' + line + ']');
    let trimmedLine: string = line;
    //this.logMessage('- RQS line [' + line + ']');
    const doubleQuote: string = '"';
    let quoteStartOffset: number = 0; // value doesn't matter
    //let didRemove: boolean = false;
    while ((quoteStartOffset = trimmedLine.indexOf(doubleQuote)) != -1) {
      const quoteEndOffset: number = trimmedLine.indexOf(doubleQuote, quoteStartOffset + 1);
      //this.logMessage('  -- quoteStartOffset=[' + quoteStartOffset + '] quoteEndOffset=[' + quoteEndOffset + ']');
      if (quoteEndOffset != -1) {
        const badElement = trimmedLine.substr(quoteStartOffset, quoteEndOffset - quoteStartOffset + 1);
        //this.logMessage('  -- badElement=[' + badElement + ']');
        trimmedLine = trimmedLine.replace(badElement, '#'.repeat(badElement.length));
        //didRemove = showDebug ? true : false;
        //this.logMessage('-         post[' + trimmedLine + ']');
      } else {
        break; // we don't handle a single double-quote
      }
    }

    //if (didRemove) {
    //    this.logMessage('  -- RQS line [' + line + ']');
    //    this.logMessage('  --          [' + trimmedLine + ']');
    //}

    return trimmedLine;
  }

  //  borrowed from:
  //     dupe code at server/src/parser/spin.common.ts
  //
  public containsSpinLanguageSpec(line: string): boolean {
    // return T/F where T means {Spin2_v##} was found in given string
    const languageVersionRegEx = /\{Spin2_v/i; // our version specification (just look for left edge)
    const foundSpecStatus: boolean = languageVersionRegEx.test(line);
    this._logMessage(`  -- FOUND language spec in [${line}]`);
    return foundSpecStatus;
  }

  public versionFromSpinLanguageSpec(line: string): number {
    // return T/F where T means {Spin2_v##} was found in given string
    let decodedVersion: number = 0; // return no version by default
    const languageVersionRegEx = /\{Spin2_v[0-9][0-9]\}/i; // our version specification - well formatted 0-99
    const languageVersionThousandsRegEx = /\{Spin2_v[0-9][0-9][0-9]\}/i; // our version specification - well formatted 0-999
    const is3digit: boolean = languageVersionThousandsRegEx.test(line);
    // if have fully formatted version
    if (languageVersionRegEx.test(line) || is3digit) {
      if (this.containsSpinLanguageSpec(line)) {
        const matchText: string = '{Spin2_v'.toLowerCase();
        const verOffset: number = line.toLowerCase().indexOf(matchText);
        if (verOffset != -1) {
          if (is3digit) {
            const hundreds: number = parseInt(line.charAt(verOffset + matchText.length));
            const tens: number = parseInt(line.charAt(verOffset + matchText.length + 1));
            const ones: number = parseInt(line.charAt(verOffset + matchText.length + 2));
            decodedVersion = hundreds * 100 + tens * 10 + ones;
          } else {
            const tens: number = parseInt(line.charAt(verOffset + matchText.length));
            const ones: number = parseInt(line.charAt(verOffset + matchText.length + 1));
            decodedVersion = tens * 10 + ones;
          }
        }
        // special: disallow unreleased versions:
        // - 41 is base version so say 0
        // - 42 was not released so say zero
        // - 40 or less is also 0
        if (decodedVersion < 43) {
          this._logMessage(`  -- Replace unsupported language spec (${decodedVersion}) with (0)!`);
          decodedVersion = 0;
        }
      }
    }
    this._logMessage(`  -- Returning language spec of (${decodedVersion}) for [${line}]`);

    return decodedVersion;
  }
}
