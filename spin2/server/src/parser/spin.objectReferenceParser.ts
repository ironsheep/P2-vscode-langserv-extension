"use strict";
// server/src/parser/spin.objectReferenceParser.ts

import { TextDocument } from "vscode-languageserver-textdocument";
import { Context } from "../context";

//import { semanticConfiguration, reloadSemanticConfiguration } from "./spin2.extension.configuration";
import { DocumentFindings, RememberedComment, RememberedToken, eSeverity } from "./spin.semantic.findings";
import { Spin2ParseUtils } from "./spin2.utils";
import { isSpin1File } from "./lang.utils";
import { eParseState } from "./spin.common";

// ----------------------------------------------------------------------------
//   Semantic Highlighting Provider
//
const tokenTypes = new Map<string, number>();
const tokenModifiers = new Map<string, number>();

interface IParsedToken {
  line: number;
  startCharacter: number;
  length: number;
  ptTokenType: string;
  ptTokenModifiers: string[];
}

interface IFilteredStrings {
  lineNoQuotes: string;
  lineParts: string[];
}

export class Spin2ObjectReferenceParser {
  private parseUtils = new Spin2ParseUtils();
  //private docGenerator: DocGenerator;

  private bLogStarted: boolean = false;
  // adjust following true/false to show specific parsing debug
  private spin2ObjectLocatorLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private showCON: boolean = true;
  private showOBJ: boolean = true;
  private showPAsmCode: boolean = true;
  private showState: boolean = true;
  private logTokenDiscover: boolean = true;
  private semanticFindings: DocumentFindings = new DocumentFindings(); // this gets replaced
  private currentFilespec: string = "";
  private isSpin1Document: boolean = false;

  public constructor(protected readonly ctx: Context) {
    if (this.spin2ObjectLocatorLogEnabled) {
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        //Create output channel
        this._logMessage("Spin2 Object log started.");
      } else {
        this._logMessage("\n\n------------------   NEW FILE ----------------\n\n");
      }
    }

    //this.semanticFindings = new DocumentFindings(this.spin2ObjectLocatorLogEnabled, this.spin1log);
  }

  public docFindings(): DocumentFindings {
    return this.semanticFindings;
  }

  public locatReferencedObjects(document: TextDocument, findings: DocumentFindings): void {
    this.semanticFindings = findings;
    if (this.spin2ObjectLocatorLogEnabled) {
      this.semanticFindings.enableLogging(this.ctx);
    }
    this.isSpin1Document = isSpin1File(document.uri);
    this.currentFilespec = document.uri;
    this._logMessage(`* locatReferencedObjects(${this.currentFilespec})`);

    const allTokens = this._parseText(document.getText());
  }

  private _parseText(text: string): IParsedToken[] {
    // parse our entire file
    const lines = text.split(/\r\n|\r|\n/);
    let currState: eParseState = eParseState.inCon; // compiler defaults to CON at start
    let priorState: eParseState = currState;
    let prePAsmState: eParseState = currState;

    // track block comments
    let currBlockComment: RememberedComment | undefined = undefined;
    let currSingleLineBlockComment: RememberedComment | undefined = undefined;

    const tokenSet: IParsedToken[] = [];

    // ==============================================================================
    // prepass to find PRI/PUB method, OBJ names, and VAR/DAT names
    //

    // -------------------- PRE-PARSE just locating symbol names --------------------
    // also track and record block comments (both braces and tic's!)
    // let's also track prior single line and trailing comment on same line
    this._logMessage("---> Pre SCAN");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      const trimmedNonCommentLine = this.parseUtils.getNonCommentLineRemainder(0, line);
      const offSet: number = trimmedNonCommentLine.length > 0 ? line.indexOf(trimmedNonCommentLine) + 1 : line.indexOf(trimmedLine) + 1;
      const tempComment = line.substring(trimmedNonCommentLine.length + offSet).trim();
      const sectionStatus = this._isSectionStartLine(line);
      const lineParts: string[] = trimmedNonCommentLine.split(/[ \t]/);

      // now start our processing
      if (currState == eParseState.inMultiLineComment) {
        // in multi-line non-doc-comment, hunt for end '}' to exit
        // ALLOW {...} on same line without closing!
        let nestedOpeningOffset: number = -1;
        let closingOffset: number = -1;
        let currOffset: number = 0;
        let bFoundOpenClosePair: boolean = false;
        do {
          nestedOpeningOffset = trimmedLine.indexOf("{", currOffset);
          if (nestedOpeningOffset != -1) {
            bFoundOpenClosePair = false;
            // we have an opening {
            closingOffset = trimmedLine.indexOf("}", nestedOpeningOffset);
            if (closingOffset != -1) {
              // and we have a closing, ignore this see if we have next
              currOffset = closingOffset + 1;
              bFoundOpenClosePair = true;
            } else {
              currOffset = nestedOpeningOffset + 1;
            }
          }
        } while (nestedOpeningOffset != -1 && bFoundOpenClosePair);
        closingOffset = trimmedLine.indexOf("}", currOffset);
        if (closingOffset != -1) {
          // have close, comment ended
          currState = priorState;
        }
        //  DO NOTHING Let Syntax highlighting do this
        continue;
      } else if (currState == eParseState.inMultiLineDocComment) {
        // in multi-line doc-comment, hunt for end '}}' to exit
        let closingOffset = line.indexOf("}}");
        if (closingOffset != -1) {
          // have close, comment ended
          currState = priorState;
        }
        //  DO NOTHING Let Syntax highlighting do this
        continue;
      } else if (trimmedLine.length == 0) {
        // a blank line clears pending single line comments
        continue;
      } else if (trimmedLine.startsWith("{{")) {
        // process multi-line doc comment
        let openingOffset = line.indexOf("{{");
        const closingOffset = line.indexOf("}}", openingOffset + 2);
        if (closingOffset != -1) {
          // is single line comment, just ignore it Let Syntax highlighting do this
          // record new single-line comment
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineDocComment;
          //  DO NOTHING Let Syntax highlighting do this
        }
        continue;
      } else if (trimmedLine.startsWith("{")) {
        // process possible multi-line non-doc comment
        // do we have a close on this same line?
        let openingOffset = line.indexOf("{");
        const closingOffset = line.indexOf("}", openingOffset + 1);
        if (closingOffset != -1) {
          // is single line comment...
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineComment;
          //  DO NOTHING Let Syntax highlighting do this
        }
        continue;
      } else if (trimmedLine.startsWith("''")) {
        continue;
      } else if (trimmedLine.startsWith("'")) {
        // process single line non-doc comment
        continue;
      } else if (sectionStatus.isSectionStart) {
        // mark end of method, if we were in a method
        currState = sectionStatus.inProgressStatus;

        // record start of next block in code
        //this._logState("- scan Ln#" + (i + 1) + " currState=[" + currState + "]");
        // ID the remainder of the line
        if (currState == eParseState.inPub || currState == eParseState.inPri) {
          // process PUB/PRI method signature
        } else if (currState == eParseState.inCon) {
          // process a constant line
          this._logState("- scan Ln#" + (i + 1) + " currState=[" + currState + "]");
          if (trimmedNonCommentLine.length > 3) {
            this._getCON_Declaration(3, i + 1, line);
          }
        } else if (currState == eParseState.inDat) {
          // process a class(static) variable line
        } else if (currState == eParseState.inObj) {
          // process an object line
          this._logState("- scan Ln#" + (i + 1) + " currState=[" + currState + "]");
          if (trimmedNonCommentLine.length > 3) {
            this._getOBJ_Declaration(3, i + 1, line);
          }
        } else if (currState == eParseState.inVar) {
          // process a instance-variable line
        }
        continue;
      } else if (currState == eParseState.inCon) {
        // process a constant line
        if (trimmedLine.length > 0) {
          this._getCON_Declaration(0, i + 1, line);
        }
      } else if (currState == eParseState.inDat) {
        // process a data line
      } else if (currState == eParseState.inVar) {
        // process a variable declaration line
      } else if (currState == eParseState.inObj) {
        // process an object declaration line
        if (trimmedLine.length > 0) {
          this._getOBJ_Declaration(0, i + 1, line);
        }
      } else if (currState == eParseState.inDatPAsm) {
        // process pasm (assembly) lines
        if (trimmedLine.length > 0) {
          const lineParts: string[] = trimmedLine.split(/[ \t]/);
          if (lineParts.length > 0 && lineParts[0].toUpperCase() == "FIT") {
            //this._logPASM("- (" + (i + 1) + "): pre-scan DAT PASM line trimmedLine=[" + trimmedLine + "]");
            // record end of PASM code NOT inline
            currState = prePAsmState;
            //this._logState("- scan Ln#" + (i + 1) + " POP currState=[" + currState + "]");
            // and ignore rest of this line
          }
        }
      } else if (currState == eParseState.inPub || currState == eParseState.inPri) {
        // scan SPIN2 line for object constant or method() uses
      }
    }

    // --------------------         End of PRE-PARSE             --------------------
    this._logMessage("---- Object Reference Parse DONE ----\n");
    return tokenSet;
  }

  private _getCON_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // HAVE    DIGIT_NO_VALUE = -2   ' digit value when NOT [0-9]
    //  -or-     _clkmode = xtal1 + pll16x
    //
    if (line.substr(startingOffset).length > 1) {
      //skip Past Whitespace
      let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
      const nonCommentConstantLine = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
      this._logCON("  - Ln#" + lineNbr + " GetCONDecl nonCommentConstantLine=[" + nonCommentConstantLine + "]");

      const haveEnumDeclaration: boolean = nonCommentConstantLine.startsWith("#");
      const containsMultiAssignments: boolean = nonCommentConstantLine.indexOf(",") != -1;
      let statements: string[] = [nonCommentConstantLine];
      if (!haveEnumDeclaration && containsMultiAssignments) {
        statements = nonCommentConstantLine.split(",");
      }
      this._logCON("  -- statements=[" + statements + "]");
      for (let index = 0; index < statements.length; index++) {
        const conDeclarationLine: string = statements[index].trim();
        this._logCON("  -- conDeclarationLine=[" + conDeclarationLine + "]");
        currentOffset = line.indexOf(conDeclarationLine, currentOffset);
        const assignmentOffset: number = conDeclarationLine.indexOf("=");
        if (assignmentOffset != -1) {
          // recognize constant name getting initialized via assignment
          // get line parts - we only care about first one
          const lineParts: string[] = line.substr(currentOffset).split(/[ \t=]/);
          const newName = lineParts[0];
          if (newName.charAt(0).match(/[a-zA-Z_]/)) {
            this._logCON("  -- GLBL GetCONDecl newName=[" + newName + "]");
            // remember this object name so we can annotate a call to it
          }
          const containsObjectReferences: boolean = nonCommentConstantLine.indexOf(".") != -1;
          if (containsObjectReferences) {
            const assignmentRHS = nonCommentConstantLine.substring(assignmentOffset + 1).trim();
            this._logCON("  -- GLBL GetCONDecl assignmentRHS=[" + assignmentRHS + "]");
            const lineParts: string[] = assignmentRHS.split(/[ \t]/);
            this._logCON("  -- GLBL GetCONDecl lineParts=[" + lineParts + "]");
            for (let partIdx = 0; partIdx < lineParts.length; partIdx++) {
              const nameForEval: string = lineParts[partIdx];
              if (nameForEval.includes(".")) {
                // SPIN1 have object.constant reference
                const refParts: string[] = nameForEval.split(".");
                if (refParts.length == 2) {
                  const objName = refParts[0];
                  const childConstantName = refParts[1];
                }
              }
            }
          }
        } else {
          // recognize enum values getting initialized
          const lineParts: string[] = conDeclarationLine.split(/[ \t,]/);
          //this._logCON('  -- lineParts=[' + lineParts + ']');
          for (let index = 0; index < lineParts.length; index++) {
            let enumConstant: string = lineParts[index];
            // our enum name can have a step offset
            if (enumConstant.includes("[")) {
              // it does, isolate name from offset
              const enumNameParts: string[] = enumConstant.split("[");
              enumConstant = enumNameParts[0];
            }
            if (enumConstant.charAt(0).match(/[a-zA-Z_]/)) {
              this._logCON("  -- GLBL enumConstant=[" + enumConstant + "]");
              this.semanticFindings.setGlobalToken(enumConstant, new RememberedToken("enumMember", ["readonly"]), lineNbr, undefined);
            }
          }
        }
      }
    }
  }

  private _getOBJ_Declaration(startingOffset: number, lineNbr: number, line: string): void {
    // parse P1 and P2 spin!
    // HAVE    color           : "isp_hub75_color"
    //  -or-   segments[7]     : "isp_hub75_segment"
    //  -or-   segments[7]     : "isp_hub75_segment" | BUFF_SIZE = 2
    //
    //skip Past Whitespace
    let currentOffset: number = this.parseUtils.skipWhite(line, startingOffset);
    const remainingNonCommentLineStr: string = this.parseUtils.getNonCommentLineRemainder(currentOffset, line);
    //this._logOBJ('- RptObjDecl remainingNonCommentLineStr=[' + remainingNonCommentLineStr + ']');
    if (remainingNonCommentLineStr.length > 0 && remainingNonCommentLineStr.includes(":")) {
      // get line parts - we only care about first one
      const overrideParts: string[] = remainingNonCommentLineStr.split("|").filter(Boolean);
      const lineParts: string[] = overrideParts[0].split(":").filter(Boolean);
      this._logOBJ("  -- GLBL GetOBJDecl lineParts=[" + lineParts + "]");
      let instanceNamePart = lineParts[0].trim();
      // if we have instance array declaration, then remove it
      if (instanceNamePart.includes("[")) {
        const nameParts = instanceNamePart.split(/[\[\]]/).filter(Boolean);
        instanceNamePart = nameParts[0];
      }
      this._logOBJ(`  -- GLBL GetOBJDecl newInstanceName=[${instanceNamePart}]`);
      // remember this object name so we can annotate a call to it
      const filenamePart = lineParts[1].trim().replace(/[\"]/g, "");
      this._logOBJ(`  -- GLBL GetOBJDecl newFileName=[${filenamePart}]`);
      this.semanticFindings.recordObjectImport(instanceNamePart, filenamePart);
    }
  }

  private _logState(message: string): void {
    if (this.showState) {
      this._logMessage(message);
    }
  }

  private _logCON(message: string): void {
    if (this.showCON) {
      this._logMessage(message);
    }
  }

  private _logOBJ(message: string): void {
    if (this.showOBJ) {
      this._logMessage(message);
    }
  }

  private _logPASM(message: string): void {
    if (this.showPAsmCode) {
      this._logMessage(message);
    }
  }

  private _logMessage(message: string): void {
    if (this.spin2ObjectLocatorLogEnabled) {
      //Write to output window.
      this.ctx.logger.log(message);
    }
  }

  private _isSectionStartLine(line: string): {
    isSectionStart: boolean;
    inProgressStatus: eParseState;
  } {
    // return T/F where T means our string starts a new section!
    let startStatus: boolean = false;
    let inProgressState: eParseState = eParseState.Unknown;
    if (line.length > 2) {
      const lineParts: string[] = line.split(/[ \t]/);
      if (lineParts.length > 0) {
        const sectionName: string = lineParts[0].toUpperCase();
        startStatus = true;
        if (sectionName === "CON") {
          inProgressState = eParseState.inCon;
        } else if (sectionName === "DAT") {
          inProgressState = eParseState.inDat;
        } else if (sectionName === "OBJ") {
          inProgressState = eParseState.inObj;
        } else if (sectionName === "PUB") {
          inProgressState = eParseState.inPub;
        } else if (sectionName === "PRI") {
          inProgressState = eParseState.inPri;
        } else if (sectionName === "VAR") {
          inProgressState = eParseState.inVar;
        } else {
          startStatus = false;
        }
      }
    }
    if (startStatus) {
      //this._logMessage("** isSectStart line=[" + line + "]");
    }
    return {
      isSectionStart: startStatus,
      inProgressStatus: inProgressState,
    };
  }
}
