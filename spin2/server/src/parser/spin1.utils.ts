"use strict";
// src/spin1.utils.ts

import { eBuiltInType, eDebugDisplayType, IBuiltinDescription } from "./spin.common";
import { Context } from "../context";

// this is how we decribe our methods with parameters in our tables...
type TMethodTuple = readonly [signature: string, description: string, parameters: string[], returns?: string[] | undefined];

export class Spin1ParseUtils {
  private utilsLogEnabled: boolean = false;
  private ctx: Context | undefined = undefined;

  public enableLogging(ctx: Context, doEnable: boolean = true): void {
    this.utilsLogEnabled = doEnable;
    this.ctx = ctx;
  }

  private _logMessage(message: string): void {
    if (this.utilsLogEnabled) {
      //Write to output window.
      if (this.ctx) {
        this.ctx.logger.log(message);
      }
    }
  }

  public getNonInlineCommentLine(line: string): string {
    // NEW remove {comment} and {{comment}} single-line elements too
    let nonInlineCommentStr: string = line;
    // TODO: UNDONE make this into loop to find all single line {} or {{}} comments
    const startDoubleBraceOffset: number = nonInlineCommentStr.indexOf("{{");
    if (startDoubleBraceOffset != -1) {
      const endDoubleBraceOffset: number = nonInlineCommentStr.indexOf("}}", startDoubleBraceOffset + 2);
      if (endDoubleBraceOffset != -1) {
        // remove this comment
        const badElement = nonInlineCommentStr.substr(startDoubleBraceOffset, endDoubleBraceOffset - startDoubleBraceOffset + 1);
        //this._logMessage('  -- badElement=[' + badElement + ']');
        nonInlineCommentStr = nonInlineCommentStr.replace(badElement, " ".repeat(badElement.length));
      }
    }
    const startSingleBraceOffset: number = nonInlineCommentStr.indexOf("{");
    if (startSingleBraceOffset != -1) {
      const endSingleBraceOffset: number = nonInlineCommentStr.indexOf("}", startSingleBraceOffset + 1);
      if (endSingleBraceOffset != -1) {
        // remove this comment
        const badElement = nonInlineCommentStr.substr(startSingleBraceOffset, endSingleBraceOffset - startSingleBraceOffset + 1);
        //this._logMessage('  -- badElement=[' + badElement + ']');
        nonInlineCommentStr = nonInlineCommentStr.replace(badElement, " ".repeat(badElement.length));
      }
    }
    //if (nonInlineCommentStr.length != line.length) {
    //    this._logMessage('  -- NIC line [' + line + ']');
    //    this._logMessage('  --          [' + nonInlineCommentStr + ']');
    //}
    return nonInlineCommentStr;
  }

  public getLineWithoutInlineComments(line: string): string {
    // if we have {comment} in line remove it
    let cleanedLine: string = line;
    if (!line.trim().startsWith("'")) {
      let didReplace: boolean = false;

      // if we have quoted string hide them for now...
      const startDoubleQuoteOffset: number = cleanedLine.indexOf('"');
      let checkLine: string = startDoubleQuoteOffset != -1 ? this.removeDoubleQuotedStrings(cleanedLine, true) : cleanedLine;

      //   REPLACE {{...}} when found, all occurrences
      //do {
      const doubleBraceBeginOffset: number = checkLine.indexOf("{{");
      if (doubleBraceBeginOffset != -1) {
        const doubleBraceEndOffset: number = checkLine.indexOf("}}", doubleBraceBeginOffset);
        if (doubleBraceEndOffset != -1) {
          const inLineComment: string = cleanedLine.substring(doubleBraceBeginOffset, doubleBraceEndOffset + 2);
          cleanedLine = cleanedLine.replace(inLineComment, " ".repeat(inLineComment.length));
          didReplace = true;
          //this._logMessage(`  -- RInCmt {{cmt}} [${cleanedLine}]`);
        }
      }
      //} while (cleanedLine.indexOf("{{") != -1);

      //   REPLACE {...} when found, all occurrences
      //do {
      const singleBraceBeginOffset: number = checkLine.indexOf("{");
      if (singleBraceBeginOffset != -1) {
        const singleBraceEndOffset: number = checkLine.indexOf("}", singleBraceBeginOffset);
        if (singleBraceEndOffset != -1) {
          const inLineComment: string = cleanedLine.substring(singleBraceBeginOffset, singleBraceEndOffset + 1);
          cleanedLine = cleanedLine.replace(inLineComment, " ".repeat(inLineComment.length));
          didReplace = true;
          //this._logMessage(`  -- RInCmt {cmt} [${cleanedLine}]`);
        }
      }
      //} while (cleanedLine.indexOf("{") != -1);
      if (cleanedLine.trim().length == 0) {
        cleanedLine = "";
        didReplace = true;
      }

      //if (didReplace) {
      //  this._logMessage(`  -- gLWoInLnC line [${line}]`);
      //  this._logMessage(`  --                [${cleanedLine}]`);
      //}
    }
    return cleanedLine;
  }

  private _removeOnlyInlineComments(startingOffset: number, line: string): string {
    // if we have {comment} in line remove it
    let cleanedLine: string = line;

    if (!line.trim().startsWith("'")) {
      let didReplace: boolean = false;

      if (startingOffset > 0) {
        const prefixToStart: string = " ".repeat(startingOffset);
        cleanedLine = `${prefixToStart}${line.substring(startingOffset)}`;
        didReplace = true;
      }

      //   REPLACE {{...}} when found
      //   REPLACE {...} when found
      cleanedLine = this.getLineWithoutInlineComments(cleanedLine);

      //if (didReplace) {
      //  this._logMessage(`  -- RInLnCmt line [${line}]`);
      //  this._logMessage(`  --               [${cleanedLine}]`);
      //}
    }
    return cleanedLine;
  }

  private _removeAllCommentParts(startingOffset: number, line: string): string {
    // if we have {comment} in line remove it
    let cleanedLine: string = line;

    if (!line.trim().startsWith("'")) {
      let didReplace: boolean = false;

      if (startingOffset > 0) {
        const prefixToStart: string = " ".repeat(startingOffset);
        cleanedLine = `${prefixToStart}${line.substring(startingOffset)}`;
        didReplace = true;
      }

      //   REPLACE {{...}} when found
      //   REPLACE {...} when found
      cleanedLine = this.getLineWithoutInlineComments(cleanedLine);

      // if we have quoted string hide them for now...
      const startDoubleQuoteOffset: number = cleanedLine.indexOf('"');
      let checkLine: string = startDoubleQuoteOffset != -1 ? this.removeDoubleQuotedStrings(cleanedLine, true) : cleanedLine;

      //   REPLACE ^...}} when NO {{ before it on start of line (unless there's an earlier ' comment)
      const tickOffset: number = checkLine.indexOf("'", startingOffset);
      const doubleBraceEndOffset: number = checkLine.indexOf("}}", startingOffset);
      let isInComment: boolean = doubleBraceEndOffset != -1 && tickOffset != -1 && tickOffset < doubleBraceEndOffset;
      if (doubleBraceEndOffset != -1 && !isInComment) {
        const inLineComment: string = cleanedLine.substring(0, doubleBraceEndOffset + 2);
        cleanedLine = cleanedLine.replace(inLineComment, " ".repeat(inLineComment.length));
        didReplace = true;
        //this._logMessage(`  -- RInCmt ^cmt}} [${cleanedLine}]`);
      }
      //   REPLACE ^...} when NO { before it on start of line (unless there's an earlier ' comment)
      const singleBraceEndOffset: number = checkLine.indexOf("}", startingOffset);
      isInComment = singleBraceEndOffset != -1 && tickOffset != -1 && tickOffset < singleBraceEndOffset;
      if (singleBraceEndOffset != -1 && !isInComment) {
        const inLineComment: string = cleanedLine.substring(0, singleBraceEndOffset + 1);
        cleanedLine = cleanedLine.replace(inLineComment, " ".repeat(inLineComment.length));
        didReplace = true;
        //this._logMessage(`  -- RInCmt ^cmt} [${cleanedLine}]`);
      }

      //if (didReplace) {
      //  this._logMessage(`  -- RInLnCmt line [${line}]`);
      //  this._logMessage(`  --               [${cleanedLine}]`);
      //}
    }
    return cleanedLine;
  }

  public getTrailingCommentOffset(startingOffset: number, line: string): number {
    let desiredOffset: number = -1;
    // ensure we have unique { and {{ offsets if possible
    const doubleBraceOffset: number = line.indexOf("{{", startingOffset);
    let singleBraceOffset: number = line.indexOf("{", startingOffset);
    if (doubleBraceOffset != -1 && doubleBraceOffset == singleBraceOffset) {
      singleBraceOffset = line.indexOf("{", doubleBraceOffset + 2);
    }
    const singleTicOffset: number = line.indexOf("'", startingOffset);
    // now return the earliest of the offsets (or -1 if none found)
    if (doubleBraceOffset != -1) {
      desiredOffset = doubleBraceOffset;
    }
    if (singleBraceOffset != -1) {
      if (desiredOffset == -1) {
        desiredOffset = singleBraceOffset;
      } else {
        desiredOffset = doubleBraceOffset < singleBraceOffset ? doubleBraceOffset : singleBraceOffset;
      }
    }
    if (singleTicOffset != -1) {
      if (desiredOffset == -1) {
        desiredOffset = singleTicOffset;
      } else {
        desiredOffset = singleTicOffset < desiredOffset ? singleTicOffset : desiredOffset;
      }
    }
    return desiredOffset;
  }

  public getRemainderWOutTrailingTicComment(startingOffset: number, line: string): string {
    //   REPLACE {{...}} when found
    //   REPLACE {...} when found
    // find comment at end of line and remove there to end of line
    //  ( where comment is ' or '' or unpaired {{ or { )
    //   return 0 len line if trim() removes all after removing/replacing comments
    let lineWithoutTrailingCommentStr: string = "";
    // TODO: UNDONE make this into loop to find first ' not in string
    if (line.length - startingOffset > 0) {
      // get line parts - we only care about first one
      lineWithoutTrailingCommentStr = this._removeOnlyInlineComments(startingOffset, line);
      let beginCommentOffset: number = lineWithoutTrailingCommentStr.indexOf("'");
      if (beginCommentOffset != -1) {
        // have single quote, is it within quoted string?
        let currentOffset: number = this.skipWhite(line, startingOffset);
        // if we have quited string hide them for now...
        const startDoubleQuoteOffset: number = line.indexOf('"', currentOffset);
        if (startDoubleQuoteOffset != -1) {
          const nonStringLine: string = this.removeDoubleQuotedStrings(lineWithoutTrailingCommentStr, true); // false disabled debug output
          beginCommentOffset = nonStringLine.indexOf("'");
        }
      }

      // do we have a comment?
      if (beginCommentOffset != -1) {
        this._logMessage(` - p1 gRWoTTC ofs=${startingOffset}, line=[${line}](${line.length})`);
      }
      const nonCommentEOL: number = beginCommentOffset != -1 ? beginCommentOffset : line.length;
      //this._logMessage('- gnclr startingOffset=[' + startingOffset + '], currentOffset=[' + currentOffset + ']');
      lineWithoutTrailingCommentStr = lineWithoutTrailingCommentStr.substring(0, nonCommentEOL).trimEnd();
      //this._logMessage('- gnclr lineWithoutTrailingCommentStr=[' + startingOffset + ']');
      if (lineWithoutTrailingCommentStr.trim().length == 0) {
        lineWithoutTrailingCommentStr = "";
        //this._logMessage(`  -- gRWoTTC line forced to EMPTY`);
      }
      //if (line.substr(startingOffset) !== lineWithoutTrailingCommentStr) {
      //  this._logMessage(`  -- gRWoTTC line [${line}](${line.length})`);
      //  this._logMessage(`  --              [${lineWithoutTrailingCommentStr}](${lineWithoutTrailingCommentStr.length})`);
      //}
      //} else {
      //this._logMessage(` - gRWoTTC SKIPPED ofs=${startingOffset}, line=[${line}](${line.length})`);
    }
    return lineWithoutTrailingCommentStr;
  }

  public getNonCommentLineRemainder(startingOffset: number, line: string): string {
    // upgraded behaviors:
    //   REPLACE {{...}} when found
    //   REPLACE {...} when found
    //   remove { to EOL when NOT paired with }
    //   remove {{ to EOL when NOT paired with }}
    //   REPLACE ^...} when NO { before it on start of line
    //   REPLACE ^...}} when NO {{ before it on start of line
    // find comment at end of line and remove there to end of line
    //  ( where comment is ' or '' or unpaired {{ or { )
    //   return 0 len line if trim() removes all after removing/replacing comments
    let lineWithoutTrailingCommentStr: string = "";
    // TODO: UNDONE make this into loop to find first ' not in string
    if (line.length - startingOffset > 0) {
      // get line parts - we only care about first one
      lineWithoutTrailingCommentStr = this._removeAllCommentParts(startingOffset, line);
      let beginCommentOffset: number = lineWithoutTrailingCommentStr.indexOf("'");
      if (beginCommentOffset != -1) {
        // have single quote, is it within quoted string?
        let currentOffset: number = this.skipWhite(line, startingOffset);
        // if we have quited string hide them for now...
        const startDoubleQuoteOffset: number = line.indexOf('"', currentOffset);
        if (startDoubleQuoteOffset != -1) {
          const nonStringLine: string = this.removeDoubleQuotedStrings(lineWithoutTrailingCommentStr, true); // false disabled debug output
          beginCommentOffset = nonStringLine.indexOf("'");
        }
      }

      // do we have a comment?
      if (beginCommentOffset != -1) {
        this._logMessage(` - p2 gNCLR ofs=${startingOffset}, line=[${line}](${line.length})`);
      }
      const nonCommentEOL: number = beginCommentOffset != -1 ? beginCommentOffset : line.length;
      //this._logMessage('- gnclr startingOffset=[' + startingOffset + '], currentOffset=[' + currentOffset + ']');
      lineWithoutTrailingCommentStr = lineWithoutTrailingCommentStr.substring(0, nonCommentEOL).trimEnd();
      //this._logMessage('- gnclr lineWithoutTrailingCommentStr=[' + startingOffset + ']');
      if (lineWithoutTrailingCommentStr.trim().length == 0) {
        lineWithoutTrailingCommentStr = "";
        //this._logMessage(`  -- gNCLR line forced to EMPTY`);
      }
      //if (line.substr(startingOffset) !== lineWithoutTrailingCommentStr) {
      //  this._logMessage(`  -- gNCLR line [${line}](${line.length})`);
      //  this._logMessage(`  --            [${lineWithoutTrailingCommentStr}](${lineWithoutTrailingCommentStr.length})`);
      //}
      //} else {
      //this._logMessage(` - gNCLR SKIPPED ofs=${startingOffset}, line=[${line}](${line.length})`);
    }
    return lineWithoutTrailingCommentStr;
  }

  public indexOfMatchingCloseParen(line: string, openParenOffset: number): number {
    let desiredCloseOffset: number = -1;
    let nestingDepth: number = 1;
    for (let offset = openParenOffset + 1; offset < line.length; offset++) {
      if (line.substring(offset, offset + 1) == "(") {
        nestingDepth++;
      } else if (line.substring(offset, offset + 1) == ")") {
        nestingDepth--;
        if (nestingDepth == 0) {
          // we closed the inital open
          desiredCloseOffset = offset;
          break; // done, get outta here
        }
      }
    }
    // this._logMessage('  -- iomcp line=[' + line + ']');
    // this._logMessage('  --       open=(' + openParenOffset + '), close=(' + desiredCloseOffset + ')');
    return desiredCloseOffset;
  }

  public getNonDocCommentLineRemainder(startingOffset: number, line: string): string {
    let nonDocCommentRHSStr: string = line;
    //this._logMessage('  -- gnclr ofs=' + startingOffset + '[' + line + '](' + line.length + ')');
    // TODO: UNDONE make this into loop to find first ' not in string
    if (line.length - startingOffset > 0) {
      const nonCommentEOL: number = line.length - 1;
      //this._logMessage('- gnclr startingOffset=[' + startingOffset + '], currentOffset=[' + currentOffset + ']');
      nonDocCommentRHSStr = line.substr(startingOffset, nonCommentEOL - startingOffset + 1).trim();
      //this._logMessage('- gnclr nonCommentRHSStr=[' + startingOffset + ']');

      const singleLineMultiBeginOffset: number = nonDocCommentRHSStr.indexOf("{", startingOffset);
      if (singleLineMultiBeginOffset != -1) {
        const singleLineMultiEndOffset: number = nonDocCommentRHSStr.indexOf("}", singleLineMultiBeginOffset);
        if (singleLineMultiEndOffset != -1) {
          const oneLineMultiComment: string = nonDocCommentRHSStr.substr(singleLineMultiBeginOffset, singleLineMultiEndOffset - singleLineMultiBeginOffset + 1);
          nonDocCommentRHSStr = nonDocCommentRHSStr.replace(oneLineMultiComment, "").trim();
        }
      }
    } else if (line.length - startingOffset == 0) {
      nonDocCommentRHSStr = "";
    }
    //if (line.substr(startingOffset).length != nonCommentRHSStr.length) {
    //    this._logMessage('  -- NCLR line [' + line.substr(startingOffset) + ']');
    //    this._logMessage('  --           [' + nonCommentRHSStr + ']');
    //}
    return nonDocCommentRHSStr;
  }

  public getNonWhiteDataInitLineParts(line: string): string[] {
    const nonEqualsLine: string = this.removeDoubleQuotedStrings(line);
    const lineParts: string[] | null = nonEqualsLine.match(/[^ \t\,\[\]\(\)\+\-\/\<\>\|\&\*\^\@]+/g);
    let filterParts: string[] = [];
    if (lineParts != null) {
      for (let index = 0; index < lineParts.length; index++) {
        const element = lineParts[index];
        if (element.length > 0) {
          filterParts.push(element);
        }
      }
    }

    return filterParts;
  }

  public getNonWhiteCONLineParts(line: string): string[] {
    const nonEqualsLine: string = this.removeDoubleQuotedStrings(line);
    const lineParts: string[] | null = nonEqualsLine.match(/[^  \t\(\)\|\*\+\-\/\>\<\=]+/g);
    let filterParts: string[] = [];
    if (lineParts != null) {
      for (let index = 0; index < lineParts.length; index++) {
        const element = lineParts[index];
        if (element.length > 0) {
          filterParts.push(element);
        }
      }
    }

    return filterParts;
  }

  public getNonWhitePAsmLineParts(line: string): string[] {
    const nonEqualsLine: string = this.removeDoubleQuotedStrings(line);
    const lineParts: string[] | null = nonEqualsLine.match(/[^ \t\,\(\)\[\]\<\>\=\?\!\^\+\*\&\|\-\\\@\/]+/g);
    let reducedLineParts: string[] = [];
    if (lineParts == null) {
      reducedLineParts = [];
    } else {
      for (let index = 0; index < lineParts.length; index++) {
        const name = lineParts[index];
        if (name === "#") {
          continue;
        }
        if (name.startsWith("#")) {
          reducedLineParts.push(name.substring(1)); // remvoe first char
        } else if (name.endsWith("#")) {
          reducedLineParts.push(name.slice(0, -1)); // remove last char
        } else {
          reducedLineParts.push(name);
        }
      }
    }
    return reducedLineParts;
  }

  public removeDoubleQuotedStrings(line: string, showDebug: boolean = true): string {
    //this._logMessage("- RQS line [" + line + "]");
    let trimmedLine: string = line;
    const doubleQuote: string = '"';
    let quoteStartOffset: number = 0; // value doesn't matter
    let didRemove: boolean = false;
    while ((quoteStartOffset = trimmedLine.indexOf(doubleQuote)) != -1) {
      const quoteEndOffset: number = trimmedLine.indexOf(doubleQuote, quoteStartOffset + 1);
      if (quoteEndOffset != -1) {
        const badElement = trimmedLine.substr(quoteStartOffset, quoteEndOffset - quoteStartOffset + 1);
        //this._logMessage('  -- badElement=[' + badElement + ']');
        trimmedLine = trimmedLine.replace(badElement, "#".repeat(badElement.length));
        didRemove = showDebug ? true : false;
      } else {
        break; // we don't handle a single double-quote
      }
    }

    // NEW also remove {text} strings
    const braceStartChar: string = "{";
    const braceEndChar: string = "}";
    let braceStartOffset: number = 0; // value doesn't matter
    while ((braceStartOffset = trimmedLine.indexOf(braceStartChar)) != -1) {
      const braceEndOffset: number = trimmedLine.indexOf(braceEndChar, braceStartOffset + 1);
      if (braceEndOffset != -1) {
        const badElement = trimmedLine.substr(braceStartOffset, braceEndOffset - braceStartOffset + 1);
        trimmedLine = trimmedLine.replace(badElement, " ".repeat(badElement.length));
        didRemove = showDebug ? true : false;
      } else {
        break; // we don't handle a single brace (of multi-line)
      }
    }

    //if (didRemove) {
    //  this._logMessage("  -- RDQS line [" + line + "]");
    //  this._logMessage("  --           [" + trimmedLine + "]");
    //}

    return trimmedLine;
  }

  public getNonWhiteLineParts(line: string): string[] {
    const lineParts: string[] | null = line.match(/[^ \t]+/g);
    let filterParts: string[] = [];
    if (lineParts != null) {
      for (let index = 0; index < lineParts.length; index++) {
        const element = lineParts[index];
        if (element.length > 0) {
          filterParts.push(element);
        }
      }
    }
    return filterParts;
  }

  public getNonWhiteNParenLineParts(line: string): string[] {
    let lineParts: string[] | null = line.match(/[^ \t\()]+/g);
    return lineParts == null ? [] : lineParts;
  }

  public getCommaDelimitedNonWhiteLineParts(line: string): string[] {
    let lineParts: string[] | null = line.match(/[^ \t,]+/g);
    return lineParts == null ? [] : lineParts;
  }

  public skipWhite(line: string, currentOffset: number): number {
    let firstNonWhiteIndex: number = currentOffset;
    for (let index = currentOffset; index < line.length; index++) {
      if (line.substr(index, 1) != " " && line.substr(index, 1) != "\t") {
        firstNonWhiteIndex = index;
        break;
      }
    }
    return firstNonWhiteIndex;
  }

  public docTextForBuiltIn(name: string): IBuiltinDescription {
    let desiredDocText: IBuiltinDescription = { found: false, type: eBuiltInType.Unknown, category: "", description: "", signature: "" };
    desiredDocText = this._docTextForSpinBuiltInLanguagePart(name);
    if (desiredDocText.found) {
      if (desiredDocText.category.includes("Method")) {
        desiredDocText.type = eBuiltInType.BIT_METHOD;
      } else if (desiredDocText.category.includes("Variable")) {
        desiredDocText.type = eBuiltInType.BIT_VARIABLE;
      } else if (desiredDocText.category.includes("Constant")) {
        desiredDocText.type = eBuiltInType.BIT_CONSTANT;
      } else if (desiredDocText.category.includes("Float Conversions")) {
        desiredDocText.type = eBuiltInType.BIT_METHOD;
      } else if (desiredDocText.category.includes("DAT Special")) {
        desiredDocText.type = eBuiltInType.BIT_PASM_DIRECTIVE; // special for res/file
      } else if (desiredDocText.category.includes("Directive")) {
        desiredDocText.type = eBuiltInType.BIT_PASM_DIRECTIVE; // special for org/fit
      } else {
        desiredDocText.type = eBuiltInType.BIT_LANG_PART;
      }
    } else {
      // TODO: add more calls here
    }

    return desiredDocText;
  }

  private _docTextForSpinBuiltInLanguagePart(name: string): IBuiltinDescription {
    const nameKey: string = name.toLowerCase();
    let desiredDocText: IBuiltinDescription = { found: false, type: eBuiltInType.Unknown, category: "", description: "", signature: "" };
    let methodDescr: TMethodTuple = ["", "", []];
    let protoWDescr: string[] = [];
    if (nameKey in this._tableSpinBlockNames) {
      desiredDocText.category = "Block Name";
      desiredDocText.description = this._tableSpinBlockNames[nameKey];
    } else if (nameKey in this._tableSpinFloatConversions) {
      desiredDocText.category = "Float Conversions";
      methodDescr = this._tableSpinFloatConversions[nameKey];
    } else if (nameKey in this._tableSpin1ClkModeConstantNames) {
      desiredDocText.category = "_CLKMODE Constant";
      desiredDocText.description = this._tableSpin1ClkModeConstantNames[nameKey];
    } else if (nameKey in this._tableSpin1ConfigurationROVariableNames) {
      desiredDocText.category = "Application R/O Variable";
      desiredDocText.description = this._tableSpin1ConfigurationROVariableNames[nameKey];
    } else if (nameKey in this._tableSpin1ConstantNames) {
      desiredDocText.category = "Spin Constant";
      desiredDocText.description = this._tableSpin1ConstantNames[nameKey];
    } else if (nameKey in this._tableSpin1ConfigurationVariableNames) {
      desiredDocText.category = "Spin Variable";
      desiredDocText.description = this._tableSpin1ConfigurationVariableNames[nameKey];
    } else if (nameKey in this._tableSpin1VariableNames) {
      desiredDocText.category = "Spin Variable";
      desiredDocText.description = this._tableSpin1VariableNames[nameKey];
    } else if (nameKey in this._tableSpinDirectives) {
      desiredDocText.category = "Spin Directives";
      desiredDocText.description = this._tableSpinDirectives[nameKey];
    } else if (nameKey in this._tableSpinStorageTypes) {
      desiredDocText.category = "Storage Types";
      desiredDocText.description = this._tableSpinStorageTypes[nameKey];
    } else if (nameKey in this._tableSpinStorageSpecials) {
      desiredDocText.category = "DAT Special";
      protoWDescr = this._tableSpinStorageSpecials[nameKey];
    } else if (nameKey in this._tableSpinRegisters) {
      desiredDocText.category = "Registers";
      desiredDocText.description = this._tableSpinRegisters[nameKey];
    } else if (nameKey in this._tableSpinStringMethods) {
      desiredDocText.category = "String Method";
      methodDescr = this._tableSpinStringMethods[nameKey];
    } else if (nameKey in this._tableSpinMemoryMethods) {
      desiredDocText.category = "Memory Method";
      methodDescr = this._tableSpinMemoryMethods[nameKey];
    } else if (nameKey in this._tableSpinIndexValueMethods) {
      desiredDocText.category = "Memory Method";
      protoWDescr = this._tableSpinIndexValueMethods[nameKey];
    } else if (nameKey in this._tableSpinProcessControlMethods) {
      desiredDocText.category = "Process Control Method";
      methodDescr = this._tableSpinProcessControlMethods[nameKey];
    } else if (nameKey in this._tableSpinCogControlMethods) {
      desiredDocText.category = "COG Control Method";
      methodDescr = this._tableSpinCogControlMethods[nameKey];
    } else if (nameKey in this._tableSpinP1AsmLangParts) {
      desiredDocText.category = "P1Asm Directive";
      protoWDescr = this._tableSpinP1AsmLangParts[nameKey];
    }

    if (methodDescr[0].length > 0) {
      desiredDocText.signature = methodDescr[0];
      desiredDocText.description = methodDescr[1];
      if (methodDescr[2] && methodDescr[2].length > 0) {
        desiredDocText.parameters = methodDescr[2];
      }
      if (methodDescr[3] && methodDescr[3].length > 0) {
        desiredDocText.returns = methodDescr[3];
      }
    } else if (protoWDescr.length != 0) {
      desiredDocText.signature = protoWDescr[0];
      desiredDocText.description = protoWDescr[1];
    }

    if (desiredDocText.category.length > 0) {
      desiredDocText.found = true;
    }
    return desiredDocText;
  }

  // ----------------------------------------------------------------------------
  // Built-in SPIN variables P1
  //
  private _tableSpinBlockNames: { [Identifier: string]: string } = {
    con: "32-bit Constant declarations<br>*(NOTE: CON is the initial/default block type)*",
    obj: "Referenced object instantiations<br>*(objects manipulated by this object)*",
    var: "Object Instance variable declarations",
    pub: "Public method for use by the parent object and within this object",
    pri: "Private method for use within this object",
    dat: "Object Shared variable declarations and/or PASM code",
  };

  private _tableSpinP1AsmLangParts: { [Identifier: string]: string[] } = {
    // DAT cogexec
    org: [
      "ORG <Address>",
      "Adjust compile-time assembly pointer<br>@param `Address` - an optional Cog RAM address (0-495) to assemble the following assembly code with. If Address is not given, the value 0 is used",
    ],
    fit: [
      "FIT <Address>",
      "Validate that previous instructions/data fit entirely below a specific address<br>@param `Address` - an optional Cog RAM address (0-$1F0) for which prior assembly code should not reach. If Address is not given, the value $1F0 is used (the address of the first special purpose register)",
    ],
  };

  private _tableSpinFloatConversions: { [Identifier: string]: TMethodTuple } = {
    float: ["FLOAT(x): floatValue", "Convert integer x to float", ["x - integer value to be converted"], ["floatValue - x-value represented as float"]],
    trunc: ["TRUNC(x): integerValue", "Convert float x to truncated integer", ["x - float value to be converted (remove all after decimal)"], ["integerValue - result of truncation operation"]],
    round: ["ROUND(x): integerValue", "Convert float x to rounded integer", ["x - float value to be converted (round to nearest integer)"], ["integerValue - result of rounding operation"]],
  };

  public isFloatConversion(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const reservedStatus: boolean = nameKey in this._tableSpinFloatConversions;
    return reservedStatus;
  }

  private _tableSpinStorageTypes: { [Identifier: string]: string } = {
    byte: "8-bit storage",
    word: "16-bit storage",
    long: "32-bit storage",
  };

  private _tableSpinStorageSpecials: { [Identifier: string]: string[] } = {
    res: ["symbol   RES n", "Reserve next 'n' long(s) for symbol"],
    file: ['FileDat  FILE "Filename"', 'include binary file, "FileDat" is a BYTE symbol that points to file'],
  };

  public isDatNFileStorageType(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = nameKey in this._tableSpinStorageTypes;
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpinStorageSpecials;
    }
    return reservedStatus;
  }

  public isDatStorageType(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = nameKey in this._tableSpinStorageTypes;
    if (!reservedStatus) {
      reservedStatus = nameKey == "res" ? nameKey in this._tableSpinStorageSpecials : false;
    }
    return reservedStatus;
  }

  public isStorageType(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const reservedStatus: boolean = nameKey in this._tableSpinStorageTypes;
    return reservedStatus;
  }

  private _tableSpinDirectives: { [Identifier: string]: string } = {
    string: "Declare in-line string expression; resolved at compile time",
    constant: "Declare in-line constant expression; resolved at compile time",
  };

  private _tableSpinRegisters: { [Identifier: string]: string } = {
    dira: "Direction Register for 32-bit port A (P0-P31)",
    dirb: "Direction Register for 32-bit port B (P32-P63, future use)",
    ina: "Input Register for 32-bit port A (P0-P31, read only)",
    inb: "Input Register for 32-bit port B (P32-P63, read only, future use)",
    outa: "Output Register for 32-bit port A (P0-P31)",
    outb: "Output Register for 32-bit port B (P32-P63, future use)",
    cnt: "32-bit System Counter Register (read only)",
    ctra: "Counter A Control Register",
    ctrb: "Counter B Control Register",
    frqa: "Counter A Frequency Register",
    frqb: "Counter B Frequency Register",
    phsa: "Counter A Phase-Locked Loop (PLL) Register",
    phsb: "Counter B Phase-Locked Loop (PLL) Register",
    vcfg: "Video Configuration Register",
    vscl: "Video Scale Register",
    par: "Cog Boot Parameter Register (read only)",
    spr: "Special-Purpose Register array; indirect cog register access",
  };

  // -------------------------------------------------------------------------
  // keyword checks
  public isBuiltinReservedWord(name: string): boolean {
    // register names
    const nameKey: string = name.toLowerCase();
    const reservedStatus: boolean = nameKey in this._tableSpinRegisters;
    return reservedStatus;
  }

  private _tableSpin1ConstantNames: { [Identifier: string]: string } = {
    true: "Logical true: -1 ($FFFF_FFFF)",
    false: "Logical false: 0 ($0000_0000)",
    posx: "Maximum positive integer: 2,147,483,647 ($7FFF_FFFF)",
    negx: "Maximum negative integer: -2,147,483,648 ($8000_0000)",
    pi: "Floating-point value for PI: ~3.141593 ($4049_0FDB)",
  };

  private _tableSpin1ClkModeConstantNames: { [Identifier: string]: string } = {
    rcfast: "internal fast oscillator. No external parts. May range from 8 MHz to 20 MHz.",
    rcslow: "internal slow oscillator. Very low power. No external parts. May range from 13 kHz to 33 kHz.",
    xinput: "external clock/osc (XI pin). DC to 80 MHz Input",
    xtal1: "external low-speed crystal. 4 to 16 MHz Crystal/Resonator",
    xtal2: "external medium-speed crystal. 8 to 32 MHz Crystal/Resonator",
    xtal3: "external high-speed crystal. 20 to 60 MHz Crystal/Resonator",
    pll1x: "external frequency times 1",
    pll2x: "external frequency times 2",
    pll4x: "external frequency times 4",
    pll8x: "external frequency times 8",
    pll16x: "external frequency times 16",
  };

  private _tableSpin1ConfigurationROVariableNames: { [Identifier: string]: string } = {
    _clkmode: "Application-defined clock mode (read-only)",
    _clkfreq: "Application-defined clock frequency (read-only)",
    _xinfreq: "Application-defined external clock frequency (read-only)",
    _stack: "Application-defined stack space to reserve (read-only)",
    _free: "Application-defined free space to reserve (read-only)",
    chipver: "Propeller chip version number (read-only)",
    cogid: "Current cog’s ID number (0-7) (read-only)",
    cnt: "Current 32-bit System Counter value (read-only)",
  };

  private _tableSpin1ConfigurationVariableNames: { [Identifier: string]: string } = {
    clkmode: "Current clock mode setting",
    clkfreq: "Current clock frequency",
    clkset: "Set clock mode and clock frequency",
  };

  private _tableSpin1VariableNames: { [Identifier: string]: string } = {
    result: "The return value variable for methods",
  };

  public isSpinBuiltInConstant(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = nameKey in this._tableSpin1ConfigurationVariableNames;
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpin1ClkModeConstantNames;
    }
    return reservedStatus;
  }

  public isSpinBuiltInVariable(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    let reservedStatus: boolean = nameKey in this._tableSpinRegisters;
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpin1ConfigurationROVariableNames;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey == "result"; // yes, this is built-in!
    }
    return reservedStatus;
  }

  public isSpinReservedWord(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const spin1FlowControl: string[] = ["if", "ifnot", "elseif", "elseifnot", "else", "while", "repeat", "until", "from", "to", "step", "next", "quit", "case", "other", "abort", "return"];
    let reservedStatus: boolean = spin1FlowControl.indexOf(nameKey) != -1;
    if (reservedStatus == false) {
      reservedStatus = this.isBinaryOperator(name);
    }
    if (reservedStatus == false) {
      reservedStatus = this.isUnaryOperator(name);
    }
    if (reservedStatus == false) {
      reservedStatus = this.isFloatConversion(name);
    }
    if (reservedStatus == false) {
      reservedStatus = nameKey in this._tableSpin1ConstantNames;
    }
    if (reservedStatus == false) {
      reservedStatus = nameKey in this._tableSpin1ConfigurationROVariableNames;
    }
    if (reservedStatus == false) {
      reservedStatus = nameKey in this._tableSpin1ConfigurationVariableNames;
    }
    if (reservedStatus == false) {
      reservedStatus = nameKey in this._tableSpinP1AsmLangParts;
    }
    if (reservedStatus == false) {
      reservedStatus = nameKey in this._tableSpin1VariableNames;
    }
    return reservedStatus;
  }

  private _tableSpinMemoryMethods: { [Identifier: string]: TMethodTuple } = {
    bytemove: [
      "BYTEMOVE(Destination, Source, Count)",
      "Move Count bytes from Source to Destination",
      ["Destination - address of BYTE array to receive values", "Source - address of BYTE array to be copied", "Count - the number of BYTEs to be copied"],
    ],
    wordmove: [
      "WORDMOVE(Destination, Source, Count)",
      "Move Count words from Source to Destination",
      ["Destination - address of WORD array to receive values", "Source - address of WORD array to be copied", "Count - the number of WORDs to be copied"],
    ],
    longmove: [
      "LONGMOVE(Destination, Source, Count)",
      "Move Count longs from Source to Destination",
      ["Destination - address of LONG array to receive values", "Source - address of LONG array to be copied", "Count - the number of LONGs to be copied"],
    ],
    bytefill: [
      "BYTEFILL(Destination, Value, Count)",
      "Fill Count bytes starting at Destination with Value",
      ["Destination - address of BYTE array to receive values", "Value - 8-bit value", "Count - the number of BYTEs to be filled"],
    ],
    wordfill: [
      "WORDFILL(Destination, Value, Count)",
      "Fill Count words starting at Destination with Value",
      ["Destination - address of WORD array to receive values", "Value - 16-bit value", "Count - the number of WORDs to be filled"],
    ],
    longfill: [
      "LONGFILL(Destination, Value, Count)",
      "Fill Count longs starting at Destination with Value",
      ["Destination - address of LONG array to receive values", "Value - 32-bit value", "Count - the number of LONGs to be filled"],
    ],
  };

  private _tableSpinIndexValueMethods: { [Identifier: string]: string[] } = {
    // NOTE: this does NOT support signature help! (paramaters are not highlighted for signature help due to ':' being param separater)
    lookup: [
      "LOOKUP(Index: ExpressionList) : Value",
      "Lookup value (values and ranges allowed) using 1-based index, return value (0 if index out of range)<br><br>" +
        "@param `Index` - an expression indicating the position of the desired value in ExpressionList<br>" +
        "@param `ExpressionList` - a comma-separated list of expressions. Quoted strings of characters are also allowed; they are treated as a comma-separated list of characters<br>" +
        "@returns `Value` - the value found (or 0 if index out of range)<br>",
    ],
    lookupz: [
      "LOOKUPZ(Index: ExpressionList) : Value",
      "Lookup value (values and ranges allowed) using 0-based index, return value (0 if index out of range)<br><br>" +
        "@param `Index' -  is an expression indicating the position of the desired value in ExpressionList<br>" +
        "@param `ExpressionList' - a comma-separated list of expressions. Quoted strings of characters are also allowed; they are treated as a comma-separated list of characters<br>" +
        "@returns `Value` - the value found (or 0 if index out of range)<br>",
    ],
    lookdown: [
      "LOOKDOWN(Value: ExpressionList) : Index",
      "Determine 1-based index of matching value (values and ranges allowed), return index (0 if no match)<br><br>" +
        "@param `Value' - is an expression indicating the value to find in ExpressionList<br>" +
        "@param `ExpressionList' - a comma-separated list of expressions. Quoted strings of characters are also allowed; they are treated as a comma-separated list of characters<br>" +
        "@returns `Index` - the index found (or 0 if no match for value in list)<br>",
    ],
    lookdownz: [
      "LOOKDOWNZ(Value: ExpressionList) : Index",
      "Determine 0-based index of matching value (values and ranges allowed), return index (0 if no match)<br><br>" +
        "@param `Value' - is an expression indicating the value to find in ExpressionList<br>" +
        "@param `ExpressionList' - a comma-separated list of expressions. Quoted strings of characters are also allowed; they are treated as a comma-separated list of characters<br>" +
        "@returns `Index` - the index found (or 0 if no match for value in list)<br>",
    ],
  };

  private _tableSpinStringMethods: { [Identifier: string]: TMethodTuple } = {
    strsize: ["STRSIZE(Addr) : Size", "Count bytes of zero-terminated string at Addr", ["Addr - address of zero-terminated string"], ["Size - the string length, not including the zero"]],
    strcomp: [
      "STRCOMP(AddrA,AddrB) : Match",
      "Compare zero-terminated strings at AddrA and AddrB",
      ["AddrA - address of zero-terminated string", "AddrB - address of zero-terminated string"],
      ["Match - return TRUE (-1) if match or FALSE (0) if not"],
    ],
  };

  private _tableSpinProcessControlMethods: { [Identifier: string]: TMethodTuple } = {
    locknew: ["LOCKNEW : ID", "Check out a new lock returning its ID", [], ["ID -  the ID number (0–7) of the lock checked out (or -1 is none were available)"]],
    lockret: ["LOCKRET(ID)", "Release lock back to lock pool, making it available for future LOCKNEW requests", ["ID - is the ID number (0–7) of the lock"]],
    lockset: ["LOCKSET(ID) : prevState", "Set lock to true returning its previous state", ["ID - is the ID number (0–7) of the lock to set"], ["prevState - state of the lock before it was set"]],
    lockclr: [
      "LOCKCLR(ID) : prevState",
      "Clear lock to false returning its previous state",
      ["ID - is the ID number (0–7) of the lock to clear"],
      ["prevState - state of the lock before it was cleared"],
    ],
    waitcnt: ["WAITCNT(value)", "Wait for System Counter, pausing a cog’s execution temporarily", ["value - the desired 32-bit System Counter value to wait for"]],
    waitpeq: [
      "WAITPEQ(State, Mask, Port)",
      "Pause a cog’s execution until I/O pin(s) match designated state(s)",
      [
        "State - the logic state(s) to compare the pin(s) against. It is a 32-bit value that indicates the high or low states of up to 32 I/O pins. State is compared against either (INA & Mask), or (INB & Mask), depending on Port.",
        "Mask - the desired pin(s) to monitor. Mask is a 32-bit value that contains high (1) bits for every I/O pin that should be monitored; low (0) bits indicate pins that should be ignored. Mask is bitwised-ANDed with the 32-bit port’s input states and the resulting value is compared against the entire State value",
        "Port - is a 1-bit value indicating the I/O port to monitor; 0 = Port A, 1 = Port B. Only Port A exists on current (P8X32A) Propeller chips",
      ],
    ],
    waitpne: [
      "WAITPNE(State, Mask, Port )",
      "Pause a cog’s execution until I/O pin(s) do not match designated state(s)",
      [
        "State - the logic state(s) to compare the pin(s) against. It is a 32-bit value that indicates the high or low states of up to 32 I/O pins. State is compared against either (INA & Mask), or (INB & Mask), depending on Port.",
        "Mask - the desired pin(s) to monitor. Mask is a 32-bit value that contains high (1) bits for every I/O pin that should be monitored; low (0) bits indicate pins that should be ignored. Mask is bitwised-ANDed with the 32-bit port’s input states and the resulting value is compared against the entire State value",
        "Port - is a 1-bit value indicating the I/O port to monitor; 0 = Port A, 1 = Port B. Only Port A exists on current (P8X32A) Propeller chips",
      ],
    ],
    waitvid: [
      "WAITVID(Colors, Pixels)",
      "Pause a cog’s execution until its Video Generator is available to take pixel data",
      [
        "Colors - a long containing four byte-sized color values, each describing the four possible colors of the pixel patterns in Pixels",
        "Pixels - the next 16-pixel by 2-bit (or 32-pixel by 1-bit) pixel pattern to display",
      ],
    ],
  };

  private _tableSpinCogControlMethods: { [Identifier: string]: TMethodTuple } = {
    coginit: [
      "(run SPIN) COGINIT(CogID, SpinMethod(ParameterList), StackPointer)\r\n\t\t\t\t  (run PASM) COGINIT(CogID, AsmAddress, Parameter)",
      "Start or restart a cog by ID to run Spin code or Propeller Assembly code",
      [
        // WARNING don't use '-' in non-parameter lines!
        "(when SPIN):",
        "CogID - the ID (0 - 7) of the cog to start, or restart. A CogID value of 8 - 15 results in the next available cog being started, if possible",
        "SpinMethod - the Spin method that the affected cog should run. Optionally, it can be followed by a parameter list enclosed in parentheses",
        "StackPointer - a pointer to memory, such as a long array, reserved for stack space for the affected cog. The affected cog uses this space to store temporary data during further calls and expression evaluations. If insufficient space is allocated, either the application will fail to run or it will run with strange results",
        "",
        "(when PASM):",
        "CogID - the ID (0 - 7) of the cog to start, or restart. A CogID value of 8 - 15 results in the next available cog being started, if possible",
        "AsmAddress - the address of a Propeller Assembly (pasm) routine from a DAT block",
        "Parameter - used to optionally pass a value to the new cog. This value ends up in the new cog's read-only Cog Boot Parameter (PAR) register. Parameter can be used to pass a either a single 14-bit value or the address of a block of memory to be used by the assembly routine",
      ],
    ],
    cognew: [
      "(run SPIN) COGNEW(SpinMethod(ParameterList), StackPointer) : CogID\r\n\t\t\t\t  (run PASM) COGNEW(AsmAddress, Parameter): CogID",
      "Start the next available cog to run Spin code or Propeller Assembly code",
      [
        // WARNING don't use '-' in non-parameter lines!
        "(when SPIN):",
        "SpinMethod - the Spin method that the affected cog should run. Optionally, it can be followed by a parameter list enclosed in parentheses",
        "StackPointer - a pointer to memory, such as a long array, reserved for stack space for the affected cog. The affected cog uses this space to store temporary data during further calls and expression evaluations. If insufficient space is allocated, either the application will fail to run or it will run with strange results",
        "",
        "(when PASM):",
        "AsmAddress - the address of a Propeller Assembly (pasm) routine, from a DAT block",
        "Parameter - used to optionally pass a value to the new cog. This value ends up in the new cog's read-only Cog Boot Parameter (PAR) register. Parameter can be used to pass a either a single 14-bit value or the address of a block of memory to be used by the assembly routine",
        "", // provide separation from @returns
      ],
      ["CogID - The ID of the newly started cog (0-7) if successful, or -1 otherwise"],
    ],
    cogstop: ["COGSTOP(CogID)", "Stop cog by its ID", ["CogID - theID(0-7) of the cog to stop"]],
    reboot: ["REBOOT", "Reset the Propeller chip", []],
  };

  public isSpinBuiltinMethod(name: string): boolean {
    const nameKey: string = name.toLowerCase();
    const spinMethodNames: string[] = ["call", "clkset"];
    let reservedStatus: boolean = spinMethodNames.indexOf(nameKey) != -1;
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpinMemoryMethods;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpinIndexValueMethods;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpinStringMethods;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpinProcessControlMethods;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpinCogControlMethods;
    }
    if (!reservedStatus) {
      reservedStatus = nameKey in this._tableSpinDirectives;
    }
    return reservedStatus;
  }

  public isSpin2ButOKReservedWords(name: string): boolean {
    const spin2OKInstructionsOfNote: string[] = ["crcbit", "getbyte", "getword", "pop", "push", "setbyte", "skip", "zerox", "pb", "pa", "bmask", "decod"];
    const reservedStatus: boolean = spin2OKInstructionsOfNote.indexOf(name.toLowerCase()) != -1;
    return reservedStatus;
  }

  public isSpin2ReservedWords(name: string): boolean {
    const spin2InstructionsOfNote: string[] = [
      "alignl",
      "alignw",
      "orgf",
      "orgh",
      "pr0",
      "pr1",
      "pr2",
      "pr3",
      "pr4",
      "pr5",
      "pr6",
      "pr7",
      "ijmp1",
      "ijmp2",
      "ijmp3",
      "iret1",
      "iret2",
      "iret3",
      "pa",
      "pb",
      "ptra",
      "ptrb",
      "addct1",
      "addct2",
      "addct3",
      "addpix",
      "akpin",
      "allowi",
      "altb",
      "altd",
      "altgb",
      "altgn",
      "altgw",
      "alti",
      "altr",
      "alts",
      "altsb",
      "altsn",
      "altsw",
      "augd",
      "augs",
      "bitc",
      "bith",
      "bitl",
      "bitnc",
      "bitnot",
      "bitnz",
      "bitrnd",
      "bitz",
      "blnpix",
      "bmask",
      "brk",
      "calla",
      "callb",
      "calld",
      "callpa",
      "callpb",
      "cmpm",
      "cmpr",
      "cogatn",
      "cogbrk",
      "crcbit",
      "crcnib",
      "decmod",
      "decod",
      "dirc",
      "dirh",
      "dirl",
      "dirnc",
      "dirnot",
      "dirnz",
      "dirrnd",
      "dirz",
      "djf",
      "djnf",
      "djz",
      "drvc",
      "drvh",
      "drvl",
      "drvnc",
      "drvnot",
      "drvnz",
      "drvrnd",
      "drvz",
      "encod",
      "execf",
      "fblock",
      "fge",
      "fges",
      "fle",
      "fles",
      "fltc",
      "flth",
      "fltl",
      "fltnc",
      "fltnot",
      "fltnz",
      "fltrnd",
      "fltz",
      "getbrk",
      "getbyte",
      "getct",
      "getnib",
      "getptr",
      "getqx",
      "getqy",
      "getrnd",
      "getrnd",
      "getscp",
      "getword",
      "getxacc",
      "hubset",
      "ijnz",
      "ijz",
      "incmod",
      "jatn",
      "jct1",
      "jct2",
      "jct3",
      "jfbw",
      "jint",
      "jmprel",
      "jnatn",
      "jnct1",
      "jnct2",
      "jnct3",
      "jnfbw",
      "jnint",
      "jnpat",
      "jnqmt",
      "jnse1",
      "jnse2",
      "jnse3",
      "jnse4",
      "jnxfi",
      "jnxmt",
      "jnxrl",
      "jnxro",
      "jpat",
      "jqmt",
      "jse1",
      "jse2",
      "jse3",
      "jse4",
      "jxfi",
      "jxmt",
      "jxrl",
      "jxro",
      "loc",
      "lockrel",
      "locktry",
      "mergeb",
      "mergew",
      "mixpix",
      "modc",
      "modcz",
      "modz",
      "movbyts",
      "mul",
      "mulpix",
      "muls",
      "muxnibs",
      "muxnits",
      "muxq",
      "nixint1",
      "nixint2",
      "nixint3",
      "outc",
      "outh",
      "outl",
      "outnc",
      "outnot",
      "outnz",
      "outrnd",
      "outz",
      "pollatn",
      "pollct1",
      "pollct2",
      "pollct3",
      "pollfbw",
      "pollint",
      "pollpat",
      "pollqmt",
      "pollse1",
      "pollse2",
      "pollse3",
      "pollse4",
      "pollxfi",
      "pollxmt",
      "pollxrl",
      "pollxro",
      "pop",
      "popa",
      "popb",
      "push",
      "pusha",
      "pushb",
      "qdiv",
      "qexp",
      "qfrac",
      "qlog",
      "qmul",
      "qrotate",
      "qsqrt",
      "qvector",
      "rczl",
      "rczr",
      "rdfast",
      "rdlut",
      "rdpin",
      "rep",
      "resi0",
      "resi1",
      "resi2",
      "resi3",
      "reta",
      "retb",
      "reti0",
      "reti1",
      "reti2",
      "reti3",
      "rfbyte",
      "rflong",
      "rfvar",
      "rfvars",
      "rfword",
      "rgbexp",
      "rgbsqz",
      "rolbyte",
      "rolbyte",
      "rolnib",
      "rolword",
      "rolword",
      "rqpin",
      "sal",
      "sca",
      "scas",
      "setbyte",
      "setcfrq",
      "setci",
      "setcmod",
      "setcq",
      "setcy",
      "setd",
      "setdacs",
      "setint1",
      "setint2",
      "setint3",
      "setluts",
      "setnib",
      "setpat",
      "setpiv",
      "setpix",
      "setq",
      "setq2",
      "setr",
      "sets",
      "setscp",
      "setse1",
      "setse2",
      "setse3",
      "setse4",
      "setword",
      "setxfrq",
      "seussf",
      "seussr",
      "signx",
      "skip",
      "skipf",
      "splitb",
      "splitw",
      "stalli",
      "subr",
      "testb",
      "testbn",
      "testp",
      "testpn",
      "tjf",
      "tjnf",
      "tjns",
      "tjs",
      "tjv",
      "trgint1",
      "trgint2",
      "trgint3",
      "waitatn",
      "waitct1",
      "waitct2",
      "waitct3",
      "waitfbw",
      "waitint",
      "waitpat",
      "waitse1",
      "waitse2",
      "waitse3",
      "waitse4",
      "waitx",
      "waitxfi",
      "waitxmt",
      "waitxrl",
      "waitxro",
      "wfbyte",
      "wflong",
      "wfword",
      "wmlong",
      "wrc",
      "wrfast",
      "wrlut",
      "wrnc",
      "wrnz",
      "wrpin",
      "wrz",
      "wxpin",
      "wypin",
      "xcont",
      "xinit",
      "xoro32",
      "xstop",
      "xzero",
      "zerox",
      "wcz",
      "xorc",
      "xorz",
      "orc",
      "orz",
      "andc",
      "andz",
      "_ret_",
      "if_00",
      "if_01",
      "if_0x",
      "if_10",
      "if_x0",
      "if_diff",
      "if_not_11",
      "if_11",
      "if_same",
      "if_x1",
      "if_not_10",
      "if_1x",
      "if_not_01",
      "if_not_00",
      "if_le",
      "if_lt",
      "if_ge",
      "if_gt",
      "p_adc",
      "p_adc_100x",
      "p_adc_10x",
      "p_adc_1x",
      "p_adc_30x",
      "p_adc_3x",
      "p_adc_ext",
      "p_adc_float",
      "p_adc_gio",
      "p_adc_scope",
      "p_adc_vio",
      "p_async_io",
      "p_async_rx",
      "p_async_tx",
      "p_bitdac",
      "p_channel",
      "p_compare_ab",
      "p_compare_ab_fb",
      "p_counter_highs",
      "p_counter_periods",
      "p_counter_ticks",
      "p_count_highs",
      "p_count_rises",
      "p_dac_124r_3v",
      "p_dac_600r_2v",
      "p_dac_75r_2v",
      "p_dac_990r_3v",
      "p_dac_dither_pwm",
      "p_dac_dither_rnd",
      "p_dac_noise",
      "p_events_ticks",
      "p_high_100ua",
      "p_high_10ua",
      "p_high_150k",
      "p_high_15k",
      "p_high_1k5",
      "p_high_1ma",
      "p_high_fast",
      "p_high_float",
      "p_high_ticks",
      "p_invert_a",
      "p_invert_b",
      "p_invert_in",
      "p_invert_output",
      "p_level_a",
      "p_level_a_fbn",
      "p_level_b_fbp",
      "p_level_b_fbn",
      "p_local_a",
      "p_local_b",
      "p_logic_a",
      "p_logic_a_fb",
      "p_logic_b_fb",
      "p_low_100ua",
      "p_low_10ua",
      "p_low_150k",
      "p_low_15k",
      "p_low_1k5",
      "p_low_1ma",
      "p_low_fast",
      "p_low_float",
      "p_minus1_a",
      "p_minus1_b",
      "p_minus2_a",
      "p_minus2_b",
      "p_minus3_a",
      "p_minus3_b",
      "p_nco_duty",
      "p_nco_freq",
      "p_normal",
      "p_oe",
      "p_outbit_a",
      "p_outbit_b",
      "p_periods_highs",
      "p_periods_ticks",
      "p_plus1_a",
      "p_plus1_b",
      "p_plus2_a",
      "p_plus2_b",
      "p_plus3_a",
      "p_plus3_b",
      "p_pulse",
      "p_pwm_sawtooth",
      "p_pwm_smps",
      "p_pwm_triangle",
      "p_quadrature",
      "p_reg_down",
      "p_reg_up",
      "p_repository",
      "p_schmitt_a",
      "p_schmitt_a_fb",
      "p_schmitt_b_fb",
      "p_state_ticks",
      "p_sync_io",
      "p_sync_rx",
      "p_sync_tx",
      "p_transition",
      "p_true_a",
      "p_true_b",
      "p_true_in",
      "p_true_output",
      "p_tt_00",
      "p_tt_01",
      "p_tt_10",
      "p_tt_11",
      "p_usb_pair",
      "x_16p_2dac8_wfword",
      "x_16p_4dac4_wfword",
      "x_1adc8_0p_1dac8_wfbyte",
      "x_1adc8_8p_2dac8_wfword",
      "x_1p_1dac1_wfbyte",
      "x_2adc8_0p_2dac8_wfword",
      "x_2adc8_16p_4dac8_wflong",
      "x_2p_1dac2_wfbyte",
      "x_2p_2dac1_wfbyte",
      "x_32p_4dac8_wflong",
      "x_4adc8_0p_4dac8_wflong",
      "x_4p_1dac4_wfbyte",
      "x_4p_2dac2_wfbyte",
      "x_4p_4dac1_wfbyte",
      "x_8p_1dac8_wfbyte",
      "x_8p_2dac4_wfbyte",
      "x_8p_4dac2_wfbyte",
      "x_alt_off",
      "x_alt_on",
      "x_dacs_0n0_0n0",
      "x_dacs_0n0_x_x",
      "x_dacs_0_0_0_0",
      "x_dacs_0_0_x_x",
      "x_dacs_0_x_x_x",
      "x_dacs_1n1_0n0",
      "x_dacs_1_0_1_0",
      "x_dacs_1_0_x_x",
      "x_dacs_3_2_1_0",
      "x_dacs_off",
      "x_dacs_x_0_x_x",
      "x_dacs_x_x_0n0",
      "x_dacs_x_x_0_0",
      "x_dacs_x_x_0_x",
      "x_dacs_x_x_1_0",
      "x_dacs_x_x_x_0",
      "x_dds_goertzel_sinc1",
      "x_dds_goertzel_sinc2",
      "x_imm_16x2_1dac2",
      "x_imm_16x2_2dac1",
      "x_imm_16x2_lut",
      "x_imm_1x32_4dac8",
      "x_imm_2x16_2dac8",
      "x_imm_2x16_4dac4",
      "x_imm_32x1_1dac1",
      "x_imm_32x1_lut",
      "x_imm_4x8_1dac8",
      "x_imm_4x8_2dac4",
      "x_imm_4x8_4dac2",
      "x_imm_4x8_lut",
      "x_imm_8x4_1dac4",
      "x_imm_8x4_2dac2",
      "x_imm_8x4_4dac1",
      "x_imm_8x4_lut",
      "x_pins_off",
      "x_pins_on",
      "x_rfbyte_1p_1dac1",
      "x_rfbyte_2p_1dac2",
      "x_rfbyte_2p_2dac1",
      "x_rfbyte_4p_1dac4",
      "x_rfbyte_4p_2dac2",
      "x_rfbyte_4p_4dac1",
      "x_rfbyte_8p_1dac8",
      "x_rfbyte_8p_2dac4",
      "x_rfbyte_8p_4dac2",
      "x_rfbyte_luma8",
      "x_rfbyte_rgb8",
      "x_rfbyte_rgbi8",
      "x_rflong_16x2_lut",
      "x_rflong_32p_4dac8",
      "x_rflong_32x1_lut",
      "x_rflong_4x8_lut",
      "x_rflong_8x4_lut",
      "x_rflong_rgb24",
      "x_rfword_16p_2dac8",
      "x_rfword_16p_4dac4",
      "x_rfword_rgb16",
      "x_write_off",
      "x_write_on",
    ];
    const reservedStatus: boolean = spin2InstructionsOfNote.indexOf(name.toLowerCase()) != -1;
    return reservedStatus;
  }

  public isBinaryOperator(name: string): boolean {
    const binaryOperationsOfNote: string[] = ["and", "or"];
    const reservedStatus: boolean = binaryOperationsOfNote.indexOf(name.toLowerCase()) != -1;
    return reservedStatus;
  }

  public isUnaryOperator(name: string): boolean {
    const unaryOperationsOfNote: string[] = ["not"];
    const reservedStatus: boolean = unaryOperationsOfNote.indexOf(name.toLowerCase()) != -1;
    return reservedStatus;
  }

  public isFlexspinPreprocessorDirective(name: string): boolean {
    const flexspinDirectiveOfNote: string[] = ["#define", "#ifdef", "#ifndef", "#else", "#elseifdef", "#elseifndef", "#endif", "#error", "#include", "#warn", "#undef"];
    const reservedStatus: boolean = flexspinDirectiveOfNote.indexOf(name.toLowerCase()) != -1;
    return reservedStatus;
  }

  public isFlexspinReservedWord(name: string): boolean {
    const flexspinReservedswordsOfNote: string[] = [
      "__propeller__",
      "__propeller2__",
      "__p2__",
      "__flexspin__",
      "__spincvt__",
      "__spin2pasm__",
      "__spin2cpp__",
      "__have_fcache__",
      "__cplusplus__",
      "__date__",
      "__file__",
      "__line__",
      "__time__",
      "__version__",
      "__debug__",
      "__output_asm__",
      "__output_bytecode__",
      "__output_c__",
      "__output_cpp__",
    ];
    const reservedStatus: boolean = flexspinReservedswordsOfNote.indexOf(name.toLowerCase()) != -1;
    return reservedStatus;
  }

  public isP1AsmReservedSymbols(name: string): boolean {
    const reservedP1AsmSymbolNames: string[] = ["org", "fit"];
    const reservedStatus: boolean = reservedP1AsmSymbolNames.indexOf(name.toLowerCase()) != -1;
    return reservedStatus;
  }

  public isP1AsmReservedWord(name: string): boolean {
    const pasmReservedswordsOfNote: string[] = ["cnt", "scr", "_clkfreq", "_clkmode", "_xinfreq", "_stack", "_free", "round", "float", "trunc", "true", "false", "negx", "pi", "posx"];
    const reservedStatus: boolean = pasmReservedswordsOfNote.indexOf(name.toLowerCase()) != -1;
    return reservedStatus;
  }

  public isP1AsmInstruction(name: string): boolean {
    const pasmInstructions: string[] = [
      "abs",
      "absneg",
      "add",
      "addabs",
      "adds",
      "addsx",
      "addx",
      "and",
      "andn",
      "call",
      "clkset",
      "cmp",
      "cmps",
      "cmpsub",
      "cmpsx",
      "cmpx",
      "cogid",
      "coginit",
      "cogstop",
      "djnz",
      "hubop",
      "jmp",
      "jmpret",
      "lockclr",
      "locknew",
      "lockret",
      "lockset",
      "max",
      "maxs",
      "min",
      "mins",
      "mov",
      "movd",
      "movi",
      "movs",
      "muxc",
      "muxnc",
      "muxz",
      "muxnz",
      "neg",
      "negc",
      "negnc",
      "negnz",
      "negz",
      "nop",
      "or",
      "rcl",
      "rcr",
      "rdbyte",
      "rdlong",
      "rdword",
      "ret",
      "rev",
      "rol",
      "ror",
      "sar",
      "shl",
      "shr",
      "sub",
      "subabs",
      "subs",
      "subsx",
      "subx",
      "sumc",
      "sumnc",
      "sumnz",
      "sumz",
      "test",
      "testn",
      "tjnz",
      "tjz",
      "waitcnt",
      "waitpeq",
      "waitpne",
      "waitvid",
      "wrbyte",
      "wrlong",
      "wrword",
      "xor",
    ];
    const instructionStatus: boolean = pasmInstructions.indexOf(name.toLowerCase()) != -1;
    return instructionStatus;
  }

  public isP1AsmNonArgumentInstruction(name: string): boolean {
    const pasmNonArgumentInstructions: string[] = ["nop", "ret"];
    const instructionStatus: boolean = pasmNonArgumentInstructions.indexOf(name.toLowerCase()) != -1;
    return instructionStatus;
  }

  public isP1AsmConditional(name: string): boolean {
    // mark these RED if seen in P2 code
    const p1AsmConditions: string[] = [
      "if_always",
      "if_never",
      "if_e",
      "if_ne",
      "if_a",
      "if_b",
      "if_ae",
      "if_be",
      "if_c",
      "if_nc",
      "if_z",
      "if_nz",
      "if_c_eq_z",
      "if_c_ne_z",
      "if_c_and_z",
      "if_c_and_nz",
      "if_nc_and_z",
      "if_nc_and_nz",
      "if_c_or_z",
      "if_c_or_nz",
      "if_nc_or_z",
      "if_nc_or_nz",
      "if_z_eq_c",
      "if_z_ne_c",
      "if_z_and_c",
      "if_z_and_nc",
      "if_nz_and_c",
      "if_nz_and_nc",
      "if_z_or_c",
      "if_z_or_nc",
      "if_nz_or_c",
      "if_nz_or_nc",
    ];
    const conditionStatus: boolean = p1AsmConditions.indexOf(name.toLowerCase()) != -1;
    return conditionStatus;
  }

  public isP1AsmEffect(name: string): boolean {
    let returnStatus: boolean = false;
    if (name.length >= 2) {
      const checkType: string = name.toUpperCase();
      if (checkType == "WC" || checkType == "WZ" || checkType == "NR" || checkType == "WR") {
        returnStatus = true;
      }
    }
    return returnStatus;
  }

  public isDatOrPAsmLabel(name: string): boolean {
    let haveLabelStatus: boolean = false;
    if (name.length > 0) {
      haveLabelStatus = name.charAt(0).match(/[a-zA-Z_\.\:]/) ? true : false;
      if (haveLabelStatus) {
        if (this.isDatNFileStorageType(name)) {
          haveLabelStatus = false;
        } else if (name.toLowerCase() == "dat") {
          haveLabelStatus = false;
        } else if (this.isP1AsmReservedSymbols(name)) {
          haveLabelStatus = false;
        } else if (name.toUpperCase().startsWith("IF_")) {
          haveLabelStatus = false;
        } else if (this.isP1AsmEffect(name)) {
          haveLabelStatus = false;
        } else if (this.isP1AsmInstruction(name)) {
          haveLabelStatus = false;
        } else if (this.isP1AsmNonArgumentInstruction(name)) {
          haveLabelStatus = false;
        }
      }
    }
    return haveLabelStatus;
  }

  // compatibility methods always return false

  public isP1AsmVariable(name: string): boolean {
    return false;
  }

  public isDebugInvocation(name: string): boolean {
    return false;
  }

  public isP2SpinMethod(name: string): boolean {
    // mark these RED if seen in P2 code
    const p2spinMethods: string[] = [
      "hubset",
      "clkset",
      "cogspin",
      "coginit",
      "cogstop",
      "cogchk",
      "locktry",
      "lockrel",
      "lockchk",
      "cogatn",
      "pollatn",
      "waitatn",
      "send",
      "recv",
      "pinw",
      "pinl",
      "pinh",
      "pint",
      "pinf",
      "pinr",
      "pinwrite",
      "pinlow",
      "pinhigh",
      "pintoggle",
      "pinfloat",
      "pinread",
      "pinstart",
      "pinclear",
      "wrpin",
      "wxpin",
      "wypin",
      "akpin",
      "rdpin",
      "rqpin",
      "getct",
      "getsec",
      "getms",
      "pollct",
      "waitct",
      "waitus",
      "waitms",
      "rotxy",
      "polxy",
      "xypol",
      "qsin",
      "qcos",
      "muldiv64",
      "getrnd",
      "nan",
      "getregs",
      "setregs",
      "getcrc",
      "regload",
      "regexec",
      "strcopy",
    ];
    const instructionStatus: boolean = p2spinMethods.indexOf(name.toLowerCase()) != -1;
    return instructionStatus;
  }

  public isP2AsmReservedWord(name: string): boolean {
    return false;
  }

  public isP2AsmReservedSymbols(name: string): boolean {
    return false;
  }

  public isP2AsmInstruction(name: string): boolean {
    return false;
  }

  public isDebugDisplayType(name: string): boolean {
    return false;
  }

  public isDebugMethod(name: string): boolean {
    return false;
  }

  public isDebugControlSymbol(name: string): boolean {
    return false;
  }

  public isAlignType(name: string): boolean {
    return false;
  }

  public isP2AsmEffect(name: string): boolean {
    return false;
  }

  public isCoginitReservedSymbol(name: string): boolean {
    return false;
  }

  public isP2AsmModczOperand(name: string): boolean {
    return false;
  }

  public isSpinSpecialMethod(name: string): boolean {
    return false;
  }

  public isSpinNoparenMethod(name: string): boolean {
    return false;
  }

  public isIllegalInlinePAsmDirective(name: string): boolean {
    return false;
  }

  public isNameWithTypeInstantiation(newParameter: string, displayType: eDebugDisplayType): boolean {
    return false;
  }

  public isNameWithTypeFeed(newParameter: string, displayType: eDebugDisplayType): boolean {
    return false;
  }

  public isDebugColorName(name: string): boolean {
    return false;
  }

  public getDebugNonWhiteLineParts(line: string): string[] {
    // remove douple and then any single quotes string from display list
    //this._logMessage('  -- gdnwlp raw-line [' + line + ']');
    const nonDblStringLine: string = this.removeDoubleQuotedStrings(line);
    //this._logMessage("  -- gdnwlp nonDblStringLine=[" + nonDblStringLine + "]");
    const nonSglStringLine: string = nonDblStringLine; // dummy for the following: this.removeDebugSingleQuotedStrings(nonDblStringLine, false);
    //this._logMessage("  -- gdnwlp nonSglStringLine=[" + nonSglStringLine + "]");
    let lineParts: string[] | null = nonSglStringLine.match(/[^ ,@\[\]\=\.\+\-\*\/\:\#\<\>\|\^\&\t\(\)\!\?\~]+/g);
    //let lineParts: string[] | null = line.match(/[^ ,@\[\]\+\-\*\/\<\>\t\(\)]+/g);
    return lineParts == null ? [] : lineParts;
  }

  public getNonWhiteNOperatorLineParts(line: string): string[] {
    let lineParts: string[] | null = line.match(/[^ \t\-\+\<\>]+/g);
    return lineParts == null ? [] : lineParts;
  }

  // not used in spin1
  public docTextForDebugBuiltIn(name: string): IBuiltinDescription {
    let desiredDocText: IBuiltinDescription = { found: false, type: eBuiltInType.Unknown, category: "", description: "", signature: "" };
    return desiredDocText;
  }

  //
  // ----------------------------------------------------
}
