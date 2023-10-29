"use strict";
// src/providers/HoverProvider.ts

import * as path from "path";

import * as lsp from "vscode-languageserver";
import { Position, Hover, MarkupKind } from "vscode-languageserver-types";

import { TextDocument } from "vscode-languageserver-textdocument";
import { Provider } from ".";
import { Context } from "../context";

import { DocumentFindings, ITokenDescription } from "../parser/spin.semantic.findings";
import { IDefinitionInfo, ExtensionUtils } from "../parser/spin.extension.utils";
import { DocumentLineAt } from "../parser/lsp.textDocument.utils";
import { Spin2ParseUtils } from "../parser/spin2.utils";
import { Spin1ParseUtils } from "../parser/spin1.utils";
import { eBuiltInType } from "../parser/spin.common";
import { isSpin1File, fileSpecFromURI } from "../parser/lang.utils";

export default class HoverProvider implements Provider {
  private hoverLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private bLogStarted: boolean = false;

  private symbolsFound: DocumentFindings = new DocumentFindings(); // this gets replaced
  private parseUtils: Spin1ParseUtils | Spin2ParseUtils = new Spin2ParseUtils();
  private extensionUtils: ExtensionUtils;
  private spin1File: boolean = false;

  constructor(protected readonly ctx: Context) {
    this.extensionUtils = new ExtensionUtils(ctx, this.hoverLogEnabled);
    if (this.hoverLogEnabled) {
      if (this.bLogStarted == false) {
        this.bLogStarted = true;
        this._logMessage("Spin Hover log started.");
      } else {
        this._logMessage("\n\n------------------   NEW FILE ----------------\n\n");
      }
    }
  }

  async handleGetHover({ textDocument, position }: lsp.HoverParams): Promise<Hover | null> {
    const docFSpec: string = fileSpecFromURI(textDocument.uri);
    const processed = this.ctx.docsByFSpec.get(docFSpec);
    if (!processed) {
      return null;
    }
    const documentFindings: DocumentFindings | undefined = this.ctx.docsByFSpec.get(docFSpec)?.parseResult;
    if (!documentFindings) {
      return null;
    }
    this.symbolsFound = documentFindings;
    this.symbolsFound.enableLogging(this.ctx, this.hoverLogEnabled);
    this.spin1File = isSpin1File(docFSpec);
    this.parseUtils = this.spin1File ? new Spin1ParseUtils() : new Spin2ParseUtils();

    return this.provideHover(processed.document, position);
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onHover(this.handleGetHover.bind(this));
    return {
      hoverProvider: true,
    };
  }

  /**
   * Write message to debug log (when debug enabled)
   * @param message - text to be written
   * @returns nothing
   */
  private _logMessage(message: string): void {
    if (this.hoverLogEnabled) {
      //Write to output window.
      this.ctx.logger.log(message);
    }
  }

  /**
   *
   * @param document
   * @param position
   * @param token
   * @returns Hover | null
   */
  public provideHover(document: TextDocument, position: Position): Thenable<Hover | null> {
    this._logMessage(`+ Hvr: provideHover() ENTRY`);
    this._logMessage(`+ Hvr: provideHover() EXIT after providing def'location`);
    return this.definitionLocation(document, position).then(
      (IDefinitionInfo) => {
        if (IDefinitionInfo == null) {
          this._logMessage(`+ Hvr: provideHover() EXIT no info`);
          return null;
        }

        const lines = IDefinitionInfo.declarationlines.filter((line) => line !== "").map((line) => line.replace(/\t/g, "    "));
        let text = lines.join("\n").replace(/\n+$/, "");

        const hoverTexts: string[] = [];
        const breakRegEx = /\<br\>/gi; // we are globally replacing <br> or <BR> markers

        hoverTexts.push(this.codeBlock(text, "spin2"));
        if (IDefinitionInfo.doc != null) {
          // SIGH: Markdown renders line breaks when there are two or more of them.
          // so replace <br/> with two newLines!
          hoverTexts.push(IDefinitionInfo.doc.replace(breakRegEx, "\n\n"));
        }
        //this._logMessage(`+ Hvr: provideHover() EXIT with hover: [${hoverTexts.join("\n")}]`);
        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: hoverTexts.join("\n"),
          },
        };
      },
      () => {
        this._logMessage(`+ Hvr: provideHover() EXIT null`);
        return null;
      }
    );
  }

  private codeBlock(text: string, codeType: string): string {
    return `\`\`\`${codeType}\n${text}\n\`\`\``;
  }

  private definitionLocation(document: TextDocument, position: Position): Promise<IDefinitionInfo | null> {
    this._logMessage(`+ Hvr: definitionLocation() ENTRY`);
    const isPositionInBlockComment: boolean = this.symbolsFound.isLineInBlockComment(position.line);
    const inPasmCodeStatus: boolean = this.symbolsFound.isLineInPasmCode(position.line);
    const inObjDeclarationStatus: boolean = this.symbolsFound.isLineObjDeclaration(position.line);
    const adjustedPos = this.extensionUtils.adjustWordPosition(document, position, isPositionInBlockComment, inPasmCodeStatus);
    if (!adjustedPos[0]) {
      this._logMessage(`+ Hvr: definitionLocation() EXIT fail`);
      return Promise.resolve(null);
    }
    const declarationLine: string = DocumentLineAt(document, position).trimEnd();
    let objectRef = inObjDeclarationStatus ? this._objectNameFromDeclaration(declarationLine) : adjustedPos[1];

    const hoverSource: string = adjustedPos[2];
    if (objectRef === hoverSource) {
      objectRef = "";
    }
    const sourcePosition: Position = adjustedPos[3];
    let fileBasename = path.basename(document.uri);
    this._logMessage(`+ Hvr: hoverSource=[${hoverSource}], inObjDecl=(${inObjDeclarationStatus}), adjPos=(${position.line},${position.character}), file=[${fileBasename}], line=[${declarationLine}]`);

    this._logMessage(`+ Hvr: definitionLocation() EXIT after getting symbol details`);
    return this.getSymbolDetails(document, sourcePosition, objectRef, hoverSource);
  }

  private _objectNameFromDeclaration(line: string): string {
    let desiredString: string = "";
    // parse object declaration forms:
    // ex:  child1 : "dummy_child" | MULTIplIER = 3, CoUNT = 5
    //      child1[4] : "dummy_child" | MULTIplIER = 3, CoUNT = 5
    //      child1[child.MAX_CT] : "dummy_child" | MULTIplIER = 3, CoUNT = 5
    if (line.includes(":")) {
      let lineParts: string[] = line.split(":");
      //this._logMessage(`+ Hvr: _getObjName() :-split lineParts=[${lineParts}](${lineParts.length})`);
      if (lineParts.length >= 2) {
        const instanceName = lineParts[0].trim();
        if (instanceName.includes("[")) {
          lineParts = instanceName.split("[");
          //this._logMessage(`+ Hvr: _getObjName() [-split lineParts=[${lineParts}](${lineParts.length})`);
          if (lineParts.length >= 2) {
            desiredString = lineParts[0].trim();
          }
        } else {
          desiredString = instanceName;
        }
      }
    }
    //this._logMessage(`+ Hvr: _getObjName([${line}]) returns [${desiredString}]`);

    return desiredString;
  }

  private getSignatureWithoutLocals(line: string): string {
    let desiredLinePortion: string = line;
    // strip off locals
    const localOffset: number = line.indexOf("|");
    if (localOffset != -1) {
      desiredLinePortion = line.substring(0, localOffset).trim();
    }
    // upper case the pub/pri
    if (desiredLinePortion.startsWith("pub ")) {
      desiredLinePortion = desiredLinePortion.replace("pub ", "PUB ");
    } else if (desiredLinePortion.startsWith("pri ")) {
      desiredLinePortion = desiredLinePortion.replace("pri ", "PRI ");
    }
    return desiredLinePortion;
  }

  private getSymbolDetails(document: TextDocument, position: Position, objRef: string, searchWord: string): Promise<IDefinitionInfo | null> {
    return new Promise((resolve, reject) => {
      const defInfo: IDefinitionInfo = {
        file: document.uri,
        line: position.line,
        column: position.character,
        toolUsed: "????",
        declarationlines: [],
        doc: "{huh, I have no clue!}",
        name: path.basename(document.uri),
      };

      let symbolsSet: DocumentFindings = this.symbolsFound;
      let isObjectReference: boolean = false;
      // use object specific symbols if present
      if (objRef.length > 0) {
        if (symbolsSet.isNameSpace(objRef)) {
          const tmpSymbolsSet: DocumentFindings | undefined = symbolsSet.getFindingsForNamespace(objRef);
          if (tmpSymbolsSet) {
            isObjectReference = true;
            symbolsSet = tmpSymbolsSet;
            symbolsSet.enableLogging(this.ctx, this.hoverLogEnabled);
          }
        }
      }

      let sourceLineRaw = DocumentLineAt(document, position);
      const tmpDeclarationLine: string | undefined = symbolsSet.getDeclarationLine(position.line);
      if (isObjectReference && tmpDeclarationLine) {
        sourceLineRaw = tmpDeclarationLine;
      }
      const sourceLine = sourceLineRaw.trim();
      let cursorCharPosn = position.character;
      do {
        const char: string = sourceLineRaw.substring(cursorCharPosn, cursorCharPosn);
        if (char == " " || char == "\t") {
          break;
        }
        cursorCharPosn--;
      } while (cursorCharPosn > 0);
      const isSignatureLine: boolean = sourceLine.toLowerCase().startsWith("pub") || sourceLine.toLowerCase().startsWith("pri");
      // ensure we don't recognize debug() in spin1 files!
      const isDebugLine: boolean = this.spin1File ? false : sourceLine.toLowerCase().startsWith("debug(");

      let bFoundSomething: boolean = false; // we've no answer
      let builtInFindings = isDebugLine ? this.parseUtils.docTextForDebugBuiltIn(searchWord) : this.parseUtils.docTextForBuiltIn(searchWord);
      if (!builtInFindings.found) {
        this._logMessage(`+ Hvr: built-in=[${searchWord}], NOT found!`);
      } else {
        this._logMessage(`+ Hvr: built-in=[${searchWord}], Found!`);
      }
      let bFoundParseToken: boolean = isObjectReference ? symbolsSet.isPublicToken(searchWord) : symbolsSet.isKnownToken(searchWord);
      if (!bFoundParseToken) {
        this._logMessage(`+ Hvr: token=[${searchWord}], NOT found!`);
      } else {
        this._logMessage(`+ Hvr: token=[${searchWord}], Found!`);
      }
      let bFoundDebugToken: boolean = false;
      if (isDebugLine) {
        bFoundDebugToken = symbolsSet.isKnownDebugDisplay(searchWord);
        if (!bFoundDebugToken) {
          this._logMessage(`+ Hvr: debug token=[${searchWord}], NOT found!`);
        } else {
          this._logMessage(`+ Hvr: debug token=[${searchWord}], Found!`);
        }
      }
      if ((bFoundParseToken || bFoundDebugToken) && !builtInFindings.found) {
        bFoundSomething = true;
        let tokenFindings: ITokenDescription = isObjectReference
          ? symbolsSet.getPublicTokenWithDescription(searchWord, position.line + 1)
          : symbolsSet.getTokenWithDescription(searchWord, position.line + 1);
        if (bFoundDebugToken) {
          tokenFindings = symbolsSet.getDebugTokenWithDescription(searchWord);
        }
        if (tokenFindings.found) {
          this._logMessage(
            `+ Hvr: token=[${searchWord}], interpRaw=(${tokenFindings.tokenRawInterp}), scope=[${tokenFindings.scope}], interp=[${tokenFindings.interpretation}], adjName=[${tokenFindings.adjustedName}]`
          );
          this._logMessage(
            `+ Hvr:    file=[${tokenFindings.relatedFilename}], declCmt=[${tokenFindings.declarationComment}], declLine=[${tokenFindings.declarationLine}], sig=[${tokenFindings.signature}]`
          );
        } else {
          this._logMessage(`+ Hvr: get token failed?!!`);
        }
        const nameString: string = tokenFindings.adjustedName;
        const scopeString: string = tokenFindings.scope;
        const typeString: string = tokenFindings.interpretation;

        let docRootCommentMD: string = `(*${scopeString}* ${typeString}) **${nameString}**`; // parsedFindings
        let typeInterpWName: string = `(${scopeString} ${typeString}) ${nameString}`; // better formatting of interp
        let typeInterp: string = `(${scopeString} ${typeString})`; // better formatting of interp
        if (scopeString.length == 0) {
          docRootCommentMD = `(${typeString}) **${nameString}**`;
          typeInterpWName = `(${typeString}) ${nameString}`; // better formatting of interp
          typeInterp = `(${typeString})`;
        }
        const desiredLine: Position = Position.create(tokenFindings.declarationLineIdx, 0);
        const lineText: string | undefined = tokenFindings.declarationLine;
        const declLine: string = lineText ? lineText : DocumentLineAt(document, desiredLine).trim(); // declaration line
        const nonCommentDecl: string = this.parseUtils.getNonCommentLineRemainder(0, declLine).trim();

        // -------------------------------
        // load CODE section of hover
        //
        const isMethod: boolean = typeString.includes("method");
        if (isMethod) {
          tokenFindings.signature = this.getSignatureWithoutLocals(nonCommentDecl);
          if (tokenFindings.scope.includes("object")) {
            if (typeString.includes("method")) {
              defInfo.declarationlines = [`(${scopeString} ${typeString}) ${tokenFindings.signature}`];
            } else {
              defInfo.declarationlines = [`(${scopeString} ${typeString}) ${nameString}`];
            }
          } else if (isSignatureLine) {
            // for method declaration use declaration line
            defInfo.declarationlines = [sourceLine];
          } else {
            // for method use, replace PUB/PRI with our interp
            const interpDecl = typeInterp + nonCommentDecl.substring(3);
            defInfo.declarationlines = [interpDecl];
          }
        } else if (tokenFindings.isGoodInterp) {
          // else spew good interp details
          defInfo.declarationlines = [typeInterpWName];
        } else {
          // else spew details until we figure out more...
          defInfo.declarationlines = [typeInterpWName, tokenFindings.tokenRawInterp];
        }

        // -------------------------------
        // load MarkDown section
        //
        let mdLines: string[] = [];
        if (isMethod) {
          //if (!isSignatureLine) {
          mdLines.push(`Custom Method: User defined<br>`);
          //}
        }
        if (
          (tokenFindings.interpretation.includes("32-bit constant") && !tokenFindings.relatedObjectName) ||
          tokenFindings.interpretation.includes("shared variable") ||
          tokenFindings.interpretation.includes("instance variable") ||
          tokenFindings.interpretation.includes("inline-pasm variable") ||
          tokenFindings.interpretation.includes("enum value")
        ) {
          // if global constant push declaration line, first...
          mdLines.push("Decl: " + nonCommentDecl + "<br>");
        }
        if (tokenFindings.interpretation.includes("pasm label") && tokenFindings.relatedFilename) {
          mdLines.push("Refers to file: " + tokenFindings.relatedFilename + "<br>");
        }
        if (tokenFindings.interpretation.includes("named instance") && tokenFindings.relatedFilename) {
          mdLines.push("An instance of: " + tokenFindings.relatedFilename + "<br>");
        }
        if (tokenFindings.relatedObjectName) {
          mdLines.push("Found in object: " + tokenFindings.relatedObjectName + "<br>");
        }
        if (tokenFindings.declarationComment) {
          // have object comment
          if (isMethod) {
            mdLines.push("- " + tokenFindings.declarationComment);
          } else {
            mdLines.push(tokenFindings.declarationComment);
          }
        } else {
          // no object comment
          if (isMethod) {
            // if methods show that we should have doc-comment, except for external object reference were we can't get to doc comments, yet!...
            if (!tokenFindings.relatedObjectName) {
              mdLines.push(`*(no doc-comment provided)*`);
            }
          } else {
            // no doc-comment, not method, do nothing
          }
        }
        if (mdLines.length > 0) {
          defInfo.doc = mdLines.join(" ");
        } else {
          defInfo.doc = undefined;
        }
      } else {
        // -------------------------------
        // no token, let's check for built-in language parts
        if (builtInFindings.found) {
          let bISdebugStatement: boolean = false;
          const bHaveParams = builtInFindings.parameters && builtInFindings.parameters.length > 0 ? true : false;
          const bHaveReturns = builtInFindings.returns && builtInFindings.returns.length > 0 ? true : false;
          // ensure we don't recognize debug() in spin1 files!
          if (this.spin1File == false && searchWord.toLowerCase() == "debug" && sourceLine.toLowerCase().startsWith("debug(")) {
            bISdebugStatement = true;
          }
          this._logMessage(`+ Hvr: bISdebugStatement=[${bISdebugStatement}], sourceLine=[${sourceLine}]`);
          let mdLines: string[] = [];
          bFoundSomething = true;
          defInfo.declarationlines = [];
          const langIdString: string = this.spin1File ? "Spin" : "Spin2";
          this._logMessage(`+ Hvr: searchWord=[${searchWord}], descr=(${builtInFindings.description}), type=[${langIdString} built-in], cat=[${builtInFindings.category}]`);

          let titleText: string | undefined = builtInFindings.category;
          let subTitleText: string | undefined = undefined;
          if (builtInFindings.type == eBuiltInType.BIT_VARIABLE) {
            defInfo.declarationlines = ["(variable) " + searchWord];
            // in one case, we are doubling "variable", remove one...
            if (titleText && titleText.includes("Spin Variable")) {
              titleText = "Spin";
            }
            subTitleText = ` variable: *${langIdString} built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_SYMBOL) {
            defInfo.declarationlines = ["(symbol) " + searchWord];
            subTitleText = ` symbol: *${langIdString} built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_CONSTANT) {
            defInfo.declarationlines = ["(constant 32-bit) " + searchWord];
            subTitleText = ` constant: *${langIdString} built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_METHOD_POINTER) {
            defInfo.declarationlines = ["(built-in method pointer) " + builtInFindings.signature];
            subTitleText = `: *${langIdString} built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_METHOD) {
            defInfo.declarationlines = ["(built-in method) " + builtInFindings.signature];
            subTitleText = `: *${langIdString} built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_LANG_PART) {
            defInfo.declarationlines = [`(${langIdString} language) ` + searchWord];
            subTitleText = `: *${langIdString} built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_PASM_DIRECTIVE) {
            defInfo.declarationlines = ["(built-in directive) " + builtInFindings.signature];
            subTitleText = `: *${langIdString} built-in*`;
          } else if (this.spin1File == false && builtInFindings.type == eBuiltInType.BIT_DEBUG_SYMBOL) {
            this._logMessage(`+ Hvr: builtInFindings.type=[eBuiltInType.BIT_DEBUG_SYMBOL]`);
            if (bISdebugStatement) {
              defInfo.declarationlines = ["(DEBUG method) " + builtInFindings.signature];
              defInfo.doc = "".concat(`${builtInFindings.category}: *${langIdString} debug built-in*<br>`, "- " + builtInFindings.description);
              // deselect lines into mdLines mech...
              mdLines = [];
              titleText = undefined;
              subTitleText = undefined;
            } else {
              defInfo.declarationlines = ["(DEBUG symbol) " + searchWord];
              subTitleText = `: *${langIdString} debug built-in*`;
            }
          } else if (this.spin1File == false && builtInFindings.type == eBuiltInType.BIT_DEBUG_METHOD) {
            this._logMessage(`+ Hvr: builtInFindings.type=[eBuiltInType.BIT_DEBUG_METHOD]`);
            defInfo.declarationlines = ["(DEBUG method) " + builtInFindings.signature];
            subTitleText = `: *${langIdString} debug built-in*`;
          } else if (builtInFindings.type == eBuiltInType.BIT_TYPE) {
            defInfo.declarationlines = [`(${langIdString} Storage) ` + searchWord];
            subTitleText = `: *${langIdString} built-in*`;
          }
          if (titleText && subTitleText) {
            if (builtInFindings.type == eBuiltInType.BIT_CONSTANT && bFoundParseToken) {
              const tokenFindings = symbolsSet.getTokenWithDescription(searchWord, position.line + 1);
              if (tokenFindings.found) {
                const desiredLine: Position = Position.create(tokenFindings.declarationLineIdx, 0);
                const lineText: string | undefined = tokenFindings.declarationLine;
                const declLine = lineText ? lineText : DocumentLineAt(document, desiredLine).trim(); // declaration line
                const nonCommentDecl: string = this.parseUtils.getNonCommentLineRemainder(0, declLine).trim();
                mdLines.push("Decl: " + nonCommentDecl + "<br>");
              }
            }
            mdLines.push(`${titleText}${subTitleText}<br>`);
            mdLines.push("- " + builtInFindings.description);
          }
          if (bHaveParams || bHaveReturns) {
            mdLines.push("<br><br>"); // blank line
          }
          if (bHaveParams && builtInFindings.parameters) {
            for (let parmIdx = 0; parmIdx < builtInFindings.parameters.length; parmIdx++) {
              const paramDescr = builtInFindings.parameters[parmIdx];
              const lineParts: string[] = paramDescr.split(" - ");
              const valueName: string = lineParts[0].replace("`", "").replace("`", "");
              if (lineParts.length >= 2) {
                mdLines.push("@param `" + valueName + "` - " + paramDescr.substring(lineParts[0].length + 3) + "<br>"); // formatted parameter description
              } else {
                // special handling when we have non-param lines, too
                // FIXME: TODO: is this spin1 only?? (came from spin1 hover in orig code)
                mdLines.push(paramDescr + "<br>"); // formatted parameter description
              }
            }
          }
          if (bHaveReturns && builtInFindings.returns) {
            for (let parmIdx = 0; parmIdx < builtInFindings.returns.length; parmIdx++) {
              const returnsDescr = builtInFindings.returns[parmIdx];
              const lineParts: string[] = returnsDescr.split(" - ");
              const valueName: string = lineParts[0].replace("`", "").replace("`", "");
              if (lineParts.length >= 2) {
                mdLines.push("@returns `" + valueName + "` - " + returnsDescr.substring(lineParts[0].length + 3) + "<br>"); // formatted parameter description
              }
            }
          }
          if (mdLines.length > 0) {
            defInfo.doc = mdLines.join(" ");
          } else {
            // if we have title or subTitle but no mdLines then just clear .doc
            if (titleText || subTitleText) {
              defInfo.doc = undefined;
            }
          }
        }
      }
      if (bFoundSomething) {
        return resolve(defInfo);
      } else {
        return reject(null); // we have no answer!
      }
    });
  }
}
