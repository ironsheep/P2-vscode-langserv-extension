'use strict';
// src/providers/spin.color.regions.ts

import * as vscode from 'vscode';
import * as path from 'path';
import { Position } from 'vscode';
import { LocatedBlockFindings, eBLockType, IBlockSpan } from './spin.block.tracker';
import { editorConfiguration, reloadEditorConfiguration } from '../spin.clientBehavior.configuration';
import { isSpinOrPasmFile, activeSpinEditors } from '../spin.vscode.utils';
import { SpinCodeUtils, eParseState } from '../spin.code.utils';

interface DecoratorMap {
  [Identifier: string]: DecoratorDescription;
}

interface DecoratorDescription {
  name: string;
  regions: vscode.DecorationOptions[];
  decorator: undefined | vscode.TextEditorDecorationType;
}

interface DecoratorInstanceHash {
  [Identifier: string]: vscode.TextEditorDecorationType;
}

export class RegionColorizer {
  private isDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private isTrackerDebugLogEnabled: boolean = false; // WARNING (REMOVE BEFORE FLIGHT)- change to 'false' - disable before commit
  private debugOutputChannel: vscode.OutputChannel | undefined = undefined;

  private namedColors: { [Identifier: string]: string } = {
    //  key: "rgba hex value"
    /*  MINE
    objLt: "#FFBFBFff", // red
    objDk: "#FDA7A6ff",
    varLt: "#FFDFBFff", // orange
    varDk: "#FDD2A7ff",
    conLt: "#FEF7C0ff", // yellow
    conDk: "#FDF3A9ff",
    datLt: "#BFFDC8ff", // green
    datDk: "#A7FCB3ff",
    priLt: "#BFF8FFff", // blue
    priDk: "#A7F3FEff",
    pubLt: "#BEDFFFff", // purple
    pubDk: "#A7D2FDff",
   */
    /* Mine Cleaned up
    objLt: "#FFBFBFff", // HSB:   0,25,100 - OBJ red
    objDk: "#FFB0B0ff", // HSB:   0,31,100  (33 was too dark/rich)
    varLt: "#FFDFBFff", // HSB:  30,25,100 - VAR orange
    varDk: "#FFD5ABff", // HSB:  30,33,100
    conLt: "#FFFFBFff", // HSB:  60,25,100 - CON yellow
    conDk: "#FFFFA1ff", // HSB:  60,37,100 (33 was too light)
    datLt: "#D5FFBFff", // HSB: 100,25,100 - DAT green
    datDk: "#C0FFA1ff", // HSB: 100,37,100 (33 was too light)
    priLt: "#BFFFFFff", // HSB: 180,25,100 - PRI blue
    priDk: "#A1FFFFff", // HSB: 180,37,100 (33 was too light)
    pubLt: "#BFD5FFff", // HSB: 220,25,100 - PUB purple
    pubDk: "#B0CAFFff", // HSB: 220,31,100  (33 was too dark/rich)
    */
    //  Jeff's
    /*
    objLt: "#FFD9D9ff", // HSB:   0,15,100 - OBJ red
    objDk: "#FFC7C7ff", // HSB:   0,22,100  (25 was too dark/rich)
    varLt: "#FFECD9ff", // HSB:  30,15,100 - VAR orange
    varDk: "#FFDFBFff", // HSB:  30,25,100
    conLt: "#FFFFD9ff", // HSB:  60,15,100 - CON yellow
    conDk: "#FFFFBFff", // HSB:  60,25,100
    datLt: "#E0FFE4ff", // HSB: 128,12,100 - DAT green
    datDk: "#C4FFCCff", // HSB: 128,23,100  (25 was too dark/rich)
    priLt: "#D9FAFFff", // HSB: 188,15,100 - PRI blue
    priDk: "#BFF7FFff", // HSB: 188,25,100
    pubLt: "#D9EBFFff", // HSB: 211,15,100 - PUB purple
    pubDk: "#C4E1FFff", // HSB: 211,23,100  (25 was too dark/rich)
    */
    //  Mine (Jeff's recolored)
    objLt: '#ffd9d9FF', // HSB:   0,15,100 - OBJ red
    objDk: '#ffbfbfFF', // HSB:   0,25,100
    varLt: '#ffecd9FF', // HSB:  30,15,100 - VAR orange
    varDk: '#ffdfbfFF', // HSB:  30,25,100
    conLt: '#ffffd9FF', // HSB:  60,15,100 - CON yellow
    conDk: '#ffffbfFF', // HSB:  60,25,100
    datLt: '#d9ffd9FF', // HSB: 120,15,100 - DAT green
    datDk: '#bfffbfFF', // HSB: 120,25,100
    priLt: '#d9ffffFF', // HSB: 180,15,100 - PRI blue
    priDk: '#bfffffFF', // HSB: 180,25,100
    pubLt: '#d9d9ffFF', // HSB: 240,15,100 - PUB purple
    pubDk: '#bfbfffFF' // HSB: 240,23,100
  };
  private namedColorsAlpha: number = -1;

  //private decoratorInstances = new Map<string, vscode.TextEditorDecorationType>();
  private colorInfoByFilespec = new Map<string, DecoratorMap>();
  private decoratorInstancesByFilespec = new Map<string, DecoratorInstanceHash>();
  private findingsByFilespec = new Map<string, LocatedBlockFindings>();
  private docVersionByFilespec = new Map<string, number>();

  private configuration = editorConfiguration;

  private spinCodeUtils: SpinCodeUtils = new SpinCodeUtils();

  constructor() {
    if (this.isDebugLogEnabled) {
      if (this.debugOutputChannel === undefined) {
        //Create output channel
        this.debugOutputChannel = vscode.window.createOutputChannel('Spin/Spin2 BGColor DEBUG');
        this.logMessage('Spin/Spin2 BGColor log started.');
      } else {
        this.logMessage('\n\n------------------   NEW FILE ----------------\n\n');
      }
    }
    this.logMessage(
      `* NEW Config: spinExtension.ClientBehavior.colorBackground=(${this.configuration.colorBackground}), backgroundApha=(${this.configuration.backgroundApha})`
    );

    this.updateColorizerConfiguration(); // ensure we match the current setting value
  }

  private blockFindingsForFileSpec(fileSpec: string): LocatedBlockFindings {
    let blockFindings: LocatedBlockFindings;
    const keys: string[] = Array.from(this.findingsByFilespec.keys());
    this.logMessage(`  -- this.findingsByFilespec.length=(${keys.length})`);

    if (this.findingsByFilespec.has(fileSpec)) {
      blockFindings = this.findingsByFilespec.get(fileSpec);
      this.logMessage(`  -- REUSE blockSpanInformation.id=[${blockFindings.id}] for [${path.basename(fileSpec)}]`);
    } else {
      blockFindings = new LocatedBlockFindings(this.debugOutputChannel, this.isTrackerDebugLogEnabled);
      this.findingsByFilespec.set(fileSpec, blockFindings);
      this.logMessage(`  -- NEW blockSpanInformation.id=[${blockFindings.id}] for [${path.basename(fileSpec)}]`);
    }
    this.logMessage(`  -- full filespec [${fileSpec}]`);
    return blockFindings;
  }

  private clearFindingsForFileSpec(fileSpec: string | undefined) {
    if (fileSpec) {
      if (this.findingsByFilespec.has(fileSpec)) {
        this.findingsByFilespec.delete(fileSpec);
        this.logMessage(`  -- REMOVED findings for [${path.basename(fileSpec)}]`);
      }
    } else {
      this.findingsByFilespec.clear();
      this.logMessage(`  -- REMOVED ALL findings`);
    }
  }

  public isColoringBackground(): boolean {
    return this.configuration.colorBackground ? this.configuration.colorBackground : false;
  }

  public backgroundAlpha(): number {
    const interpretedAlpha: number = this.configuration.backgroundApha ? this.configuration.backgroundApha : 80;
    return interpretedAlpha;
  }

  public updateColorizerConfiguration() {
    const updated = reloadEditorConfiguration();
    if (updated || this.namedColorsAlpha == -1) {
      this.logMessage(`* updateColorizerConfiguration() settings changed`);
      this.logMessage(
        `* UPD Config: spinExtension.ClientBehavior.colorBackground=(${this.configuration.colorBackground}), backgroundApha=(${this.configuration.backgroundApha})`
      );
      const settingsAlpha: number = this.backgroundAlpha();
      if (this.namedColorsAlpha != settingsAlpha) {
        this.namedColorsAlpha = this.backgroundAlpha();
        this.updateColorTable();
      }
      if (this.isColoringBackground() == false) {
        this.removeBackgroundColors('updateCfg');
      }

      // we need to force redraw of open editor when config changes!
      // FIXME: the rec-olor happens out of sequence!!! (after the doc updates)
      const activeEdtors: vscode.TextEditor[] = activeSpinEditors();
      if (activeEdtors.length > 0) {
        for (let index = 0; index < activeEdtors.length; index++) {
          const currEditor = activeEdtors[index];
          const filespec: string = currEditor.document.fileName;
          this.logMessage(`* config: re-coloring [${filespec}]`);
          const blockSpanInformation: LocatedBlockFindings = this.blockFindingsForFileSpec(filespec);
          if (blockSpanInformation) {
            this.updateRegionColors(currEditor, 'cfgChg', true);
          } else {
            this.logMessage(`  -- config: NO cached DocumentFindings for [${filespec}]`);
          }
        }
      } else {
        this.logMessage(`* config: NO spin editors to update`);
      }
    }
  }

  public closedAllFiles() {
    // empty all caches for files
    this.logMessage(`- closedAllFiles() removed all cached entries`);
    this.decoratorInstancesByFilespec.clear();
    this.colorInfoByFilespec.clear();
    this.clearFindingsForFileSpec(undefined); // clear all
  }

  public closedFilespec(filespec: string) {
    // remove caches for files that are closed
    this.logMessage(`- closedFilespec() removing cached entries for [${filespec}]`);
    if (this.decoratorInstancesByFilespec.has(filespec)) {
      this.decoratorInstancesByFilespec.delete(filespec);
      this.logMessage(`  -- closedFilespec() removing cached decoratorInstances`);
    }
    if (this.colorInfoByFilespec.has(filespec)) {
      this.colorInfoByFilespec.delete(filespec);
      this.logMessage(`  -- closedFilespec() removing cached colorInfo`);
    }
    this.clearFindingsForFileSpec(filespec); // clear just this one
  }

  public parseDocumentForRegions(document: vscode.TextDocument): void {
    // -------------------- PRE-PARSE just locating symbol names --------------------
    // also track and record block comments (both braces and tic's!)
    // let's also track prior single line and trailing comment on same line
    this.logMessage(`- parseDocumentForRegions(${path.basename(document.uri.fsPath)}), ver=[${document.version}], fileName=[${document.fileName}]`);
    const blockSpanInformation: LocatedBlockFindings = this.blockFindingsForFileSpec(document.fileName);
    this.logMessage(`  -- populating blockSpanInformation.id=[${blockSpanInformation.id}]`);

    const fullText: string = document.getText();
    const lines: string[] = fullText.split(/\r\n|\r|\n/);
    this.logMessage('---> Pre SCAN');
    let currState: eParseState = eParseState.inCon; // compiler defaults to CON at start
    let priorState: eParseState = currState;
    blockSpanInformation.clear(); // start anew!
    blockSpanInformation.recordBlockStart(eBLockType.isCon, 0); // spin file defaults to CON at 1st line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      const nonCommentLine = this.spinCodeUtils.getNonCommentLineRemainder(0, line);
      const trimmedNonCommentLine = nonCommentLine.trim();
      const sectionStatus = this.spinCodeUtils.isSectionStartLine(line);
      const lineParts: string[] = trimmedNonCommentLine.length > 0 ? trimmedNonCommentLine.split(/[ \t]/).filter(Boolean) : [];

      // now start our processing
      if (currState == eParseState.inMultiLineComment) {
        // in multi-line non-doc-comment, hunt for end '}' to exit
        // ALLOW {...} on same line without closing!
        let nestedOpeningOffset: number = -1;
        let closingOffset: number = -1;
        let currOffset: number = 0;
        let bFoundOpenClosePair: boolean = false;
        do {
          nestedOpeningOffset = trimmedLine.indexOf('{', currOffset);
          if (nestedOpeningOffset != -1) {
            bFoundOpenClosePair = false;
            // we have an opening {
            closingOffset = trimmedLine.indexOf('}', nestedOpeningOffset);
            if (closingOffset != -1) {
              // and we have a closing, ignore this see if we have next
              currOffset = closingOffset + 1;
              bFoundOpenClosePair = true;
            } else {
              currOffset = nestedOpeningOffset + 1;
            }
          }
        } while (nestedOpeningOffset != -1 && bFoundOpenClosePair);
        closingOffset = trimmedLine.indexOf('}', currOffset);
        if (closingOffset != -1) {
          // have close, comment ended
          currState = priorState;
        }
        //  DO NOTHING Let Syntax highlighting do this
        continue;
      } else if (currState == eParseState.inMultiLineDocComment) {
        // in multi-line doc-comment, hunt for end '}}' to exit
        const closingOffset = line.indexOf('}}');
        if (closingOffset != -1) {
          // have close, comment ended
          currState = priorState;
        }
        //  DO NOTHING Let Syntax highlighting do this
        continue;
      } else if (trimmedLine.length == 0) {
        continue; // no further processing of blank line
      } else if (trimmedNonCommentLine.length > 0 && this.spinCodeUtils.isFlexspinPreprocessorDirective(lineParts[0])) {
        continue; // handled flexspin comment do next line
      } else if (trimmedLine.startsWith('{{')) {
        // process multi-line doc comment
        const openingOffset = line.indexOf('{{');
        const closingOffset = line.indexOf('}}', openingOffset + 2);
        if (closingOffset != -1) {
          // is single line comment, just ignore it Let Syntax highlighting do this
        } else {
          // is open of multiline comment
          priorState = currState;
          currState = eParseState.inMultiLineDocComment;
          //  DO NOTHING Let Syntax highlighting do this
        }
        continue;
      } else if (trimmedLine.startsWith('{')) {
        // process possible multi-line non-doc comment
        // do we have a close on this same line?
        const openingOffset = line.indexOf('{');
        const closingOffset = line.indexOf('}', openingOffset + 1);
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
        // process single line doc comment
        continue;
      } else if (trimmedLine.startsWith("'")) {
        continue;
      } else if (sectionStatus.isSectionStart) {
        // mark end of method, if we were in a method
        currState = sectionStatus.inProgressStatus;

        // record start of next block in code
        //  NOTE: this causes end of prior block to be recorded
        let newBlockType: eBLockType = eBLockType.Unknown;
        if (currState == eParseState.inCon) {
          newBlockType = eBLockType.isCon;
        } else if (currState == eParseState.inDat) {
          newBlockType = eBLockType.isDat;
        } else if (currState == eParseState.inVar) {
          newBlockType = eBLockType.isVar;
        } else if (currState == eParseState.inObj) {
          newBlockType = eBLockType.isObj;
        } else if (currState == eParseState.inPub) {
          newBlockType = eBLockType.isPub;
        } else if (currState == eParseState.inPri) {
          newBlockType = eBLockType.isPri;
        }
        blockSpanInformation.recordBlockStart(newBlockType, i); // start new one which ends prior

        this.logMessage('- scan Ln#' + (i + 1) + ' currState=[' + currState + ']');
        // ID the remainder of the line
        if (currState == eParseState.inPub || currState == eParseState.inPri) {
          // process PUB/PRI method signature
        } else if (currState == eParseState.inCon) {
          // process a constant line
        } else if (currState == eParseState.inDat) {
          // process a class(static) variable line
          if (trimmedNonCommentLine.length > 6 && trimmedNonCommentLine.toUpperCase().includes('ORG')) {
            // ORG, ORGF, ORGH
            const nonStringLine: string = this.spinCodeUtils.removeDoubleQuotedStrings(trimmedNonCommentLine);
            if (nonStringLine.toUpperCase().includes('ORG')) {

              currState = eParseState.inDatPAsm;
              continue;
            }
          }
        } else if (currState == eParseState.inObj) {
          // process an object line
        } else if (currState == eParseState.inVar) {
          // process a instance-variable line
        }
        continue;
      } else if (currState == eParseState.inCon) {
        // process a constant line
      } else if (currState == eParseState.inDat) {
        // process a data line
        if (trimmedLine.length > 0) {
          if (trimmedLine.length > 6) {
            if (trimmedLine.toUpperCase().includes('ORG')) {
              // ORG, ORGF, ORGH
              const nonStringLine: string = this.spinCodeUtils.removeDoubleQuotedStrings(trimmedLine);
              if (nonStringLine.toUpperCase().includes('ORG')) {
  
                currState = eParseState.inDatPAsm;
                continue;
              }
            }
          }
        }
      } else if (currState == eParseState.inVar) {
        // process a variable declaration line
      } else if (currState == eParseState.inObj) {
        // process an object declaration line
      } else if (currState == eParseState.inDatPAsm) {
        // process pasm (assembly) lines
      }
    }
    blockSpanInformation.finishFinalBlock(lines.length - 1); // mark end of final block in file
    this.logMessage('  -- scan DONE');
  }

  public updateRegionColors(activeEditor: vscode.TextEditor, caller: string, isForced: boolean = false) {
    // remove any prior colors, then recolor
    const isConfigChange: boolean = caller.includes('cfgChg');
    const isWindowChange: boolean = caller.includes('actvEditorChg');
    const isFromRescan: boolean = caller.includes('end1stPass');
    const isDocChange: boolean = caller.includes('docDidChg');
    const filespec: string = activeEditor.document.fileName;
    let isNewDocument: boolean = false;
    if (this.docVersionByFilespec.has(filespec)) {
      const docVer: number = this.docVersionByFilespec.get(filespec);
      if (isDocChange && docVer == activeEditor.document.version && !isForced) {
        //this.logMessage(` -- saw this, EXIT!`);
        return; // exit we've seen this version
      }
    } else {
      this.docVersionByFilespec.set(filespec, activeEditor.document.version);
      isNewDocument = true;
    }
    this.logMessage(`- updRegionColors(${caller}), ver=[${activeEditor.document.version}] ENTRY`);
    this.logMessage(
      `  --  isConfigChange=(${isConfigChange}), isWindowChange=(${isWindowChange}), isFromRescan=(${isFromRescan}), isDocChange=(${isDocChange})`
    );
    if (isNewDocument || isFromRescan || isWindowChange || isDocChange) {
      // when we get real data save it for config change use
      this.parseDocumentForRegions(activeEditor.document);
    }
    const isSpinFile = isSpinOrPasmFile(filespec);
    let instancesByColor: DecoratorInstanceHash = {};
    let newInstance: boolean = false;
    const foundInstancesByColor: DecoratorInstanceHash | undefined = this.decoratorInstancesByFilespec.has(filespec)
      ? this.decoratorInstancesByFilespec.get(filespec)
      : undefined;
    if (foundInstancesByColor) {
      instancesByColor = foundInstancesByColor;
      this.logMessage(`  -- using existing instance cache`);
    } else {
      this.decoratorInstancesByFilespec.set(filespec, instancesByColor);
      newInstance = true;
      this.logMessage(`  -- new EMPTY instance cache created`);
    }

    // don't show following message if coloring is turned off
    if (isSpinFile) {
      const isColoringEnabled: boolean = this.isColoringBackground() == true;
      // only clear if coloring is OFF   -OR-
      //   if text changed, or if syntax pass requested update
      if (!isColoringEnabled) {
        this.removeBackgroundColors('NOT COLORING updRgnCo():' + caller, activeEditor);
      } else {
        // only color if
        //  (1) coloring is turned on
        this.logMessage(`- updRegionColors() fm=(${caller}) [${filespec}]`);
        let decorationsByColor: DecoratorMap | undefined = this.colorInfoByFilespec.has(filespec)
          ? this.colorInfoByFilespec.get(filespec)
          : undefined;
        if (isWindowChange && !newInstance) {
          // use existing color set
          this.logMessage(`  -- widow change use existing colors`);
        } else {
          this.logMessage(`  -- build new decoration map`);
          // NOT a window change... build new color set
          this.decoratorInstancesByFilespec.set(filespec, instancesByColor); // save latest colorInstances
          // build new updated color set
          const blockSpanInformation: LocatedBlockFindings = this.blockFindingsForFileSpec(activeEditor.document.fileName);
          const newDecorationsByColor: DecoratorMap = this.buildColorSet(blockSpanInformation, instancesByColor);
          // determine if same (color and color ranges)
          // if called from semantic pass then always adopt new!
          //   otherwise only adopt new only if changed
          if (isFromRescan || isConfigChange || this.colorSetsAreDifferent(newDecorationsByColor, decorationsByColor)) {
            // newly built color set is different... adopt it
            decorationsByColor = newDecorationsByColor;
            // replace cache with this latest color-set for file
            this.colorInfoByFilespec.set(filespec, decorationsByColor); // save latest colorSet
            this.logMessage(`  -- new decoration cache created`);
          } else {
            if (decorationsByColor) {
              this.logMessage(`  -- using existing decoration cache`);
            } else {
              this.logMessage(`  -- NO existing,  forcing use of NEW decoration cache`);
              decorationsByColor = newDecorationsByColor;
              this.colorInfoByFilespec.set(filespec, decorationsByColor); // save latest colorSet
            }
          }
        }
        //this.logMessage(`- updRegionColors(): FOUND ${codeBlockSpans.length} codeBlockSpan(s)`);
        if (decorationsByColor) {
          if (!isWindowChange) {
            this.removeBackgroundColors('updRgnCo():' + caller, activeEditor);
          }
          // for all decorations add to editor
          const keys = Object.keys(decorationsByColor);
          this.logMessage(`  -- coloring region(s) with ${keys.length} color(s)`);
          for (const key of keys) {
            const currDecoration = decorationsByColor[key];
            //this.logMessage(` -- color=[${key}] name=[${currDecoration.name}], regionCt=(${currDecoration.regions.length}), optionsBGColor=[${currDecoration.decorator}]`);

            if (currDecoration.decorator !== undefined) {
              activeEditor.setDecorations(currDecoration.decorator, []);
              activeEditor.setDecorations(currDecoration.decorator, currDecoration.regions);
            }
          }
        } else {
          this.logMessage(`  -- No colored regions found!`);
        }
      }
    } else {
      this.logMessage(`  -- SKIPping non-spin file`);
    }
  }

  private buildColorSet(blockSpanInformation: LocatedBlockFindings, decoratorInstances: DecoratorInstanceHash): DecoratorMap {
    const decorationsByColor: DecoratorMap = {};
    const codeBlockSpans: IBlockSpan[] = blockSpanInformation.blockSpans();
    this.logMessage(`  -- blockSpanInformation.id=[${blockSpanInformation.id}], codeBlockSpans.length=(${codeBlockSpans.length})`);
    if (codeBlockSpans.length > 0) {
      // for each colorized region
      for (let blkIdx = 0; blkIdx < codeBlockSpans.length; blkIdx++) {
        const codeBlockSpan: IBlockSpan = codeBlockSpans[blkIdx];
        // lookup color
        const color: string | undefined = this.colorForBlock(codeBlockSpan.blockType, codeBlockSpan.sequenceNbr);
        if (color) {
          //this.logMessage(`- updRegionColors(): color=[${color}], span=[${codeBlockSpan.startLineIdx} - ${codeBlockSpan.endLineIdx}]`);
          // grab and instance for this color
          const colorDecorator: vscode.TextEditorDecorationType = this.instanceForColor(color, decoratorInstances);
          // create the next/first span for this color
          this.logMessage(`  -- color=[${color}], start=[${codeBlockSpan.startLineIdx}, 0], end=[${codeBlockSpan.endLineIdx}, 0]`);
          const startPos = new Position(codeBlockSpan.startLineIdx, 0);
          const endPos = new Position(codeBlockSpan.endLineIdx, 0);

          const decorationRange = {
            range: new vscode.Range(startPos, endPos)
          };

          // if decoration for this color doesn't exist
          if (decorationsByColor[color] === undefined) {
            // record empty decoration
            decorationsByColor[color] = {
              name: color,
              regions: [],
              decorator: undefined
            };
          }

          // add range to new or existing decoration
          decorationsByColor[color].regions.push(decorationRange);
          if (decorationsByColor[color].decorator === undefined) {
            decorationsByColor[color].decorator = colorDecorator;
          }
        }
      }
    } else {
      this.logMessage(`  -- ERROR: no regions found to color!`);
    }
    return decorationsByColor;
  }

  private instanceForColor(color: string, decoratorInstances: DecoratorInstanceHash): vscode.TextEditorDecorationType {
    const foundInstance = decoratorInstances[color];
    if (foundInstance !== undefined) {
      return foundInstance;
    }

    const newInstance = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: color
    });

    decoratorInstances[color] = newInstance;
    return newInstance;
  }

  private colorSetsAreDifferent(lhsMap: DecoratorMap, rhsMap: DecoratorMap | undefined): boolean {
    let mapsDiffStatus = false;
    if (rhsMap) {
      const lhsColors = Object.keys(lhsMap);
      const rhsColors = Object.keys(rhsMap);
      if (lhsColors.length != rhsColors.length) {
        mapsDiffStatus = true;
      } else {
        for (const color in lhsColors) {
          const lhsDescription: DecoratorDescription = lhsMap[color];
          if (color in rhsColors) {
            /// both have same color?
            const rhsDescription: DecoratorDescription = rhsMap[color];
            if (!lhsDescription || !rhsDescription) {
              // left or righ hand side is missing...
              mapsDiffStatus = true;
              break;
            }
            // CHK: name
            if (lhsDescription.name != rhsDescription.name) {
              // color not in rhs so are diff.
              mapsDiffStatus = true;
              break;
            } else {
              // CHK: regions
              if (lhsDescription.regions.length != rhsDescription.regions.length) {
                // colored regions count is diff.
                mapsDiffStatus = true;
                break;
              }
              for (let rgnIdx = 0; rgnIdx < lhsDescription.regions.length; rgnIdx++) {
                const lhsRange: vscode.Range = lhsDescription.regions[rgnIdx]['range'];
                const rhsRange: vscode.Range = rhsDescription.regions[rgnIdx]['range'];
                if (lhsRange.start != rhsRange.start || lhsRange.end != rhsRange.end) {
                  // colored region linenumber range is diff.
                  mapsDiffStatus = true;
                  break;
                }
              }
            }
          } else {
            // color not in rhs so are diff.
            mapsDiffStatus = true;
            break;
          }
        }
      }
    } else {
      // only one map to compare, yes it is different
      mapsDiffStatus = true;
    }
    this.logMessage(`  -- colorSetsAreDifferent() = ${mapsDiffStatus}`);
    return mapsDiffStatus;
  }

  private removeBackgroundColors(caller: string, activeEditor?: vscode.TextEditor) {
    const activeFile: string = activeEditor ? activeEditor.document.fileName : 'file=unknown';
    this.logMessage(`- rmvBackgroundColors(${caller}) [${activeFile}] - ENTRY`);
    if (!activeEditor) {
      activeEditor = vscode.window.activeTextEditor;
    }
    if (activeEditor) {
      const filespec: string = activeEditor.document.fileName;
      const instancesByColor: DecoratorInstanceHash | undefined = this.decoratorInstancesByFilespec.get(filespec);
      if (instancesByColor) {
        const keys = Object.keys(instancesByColor);
        if (keys.length > 0) {
          this.logMessage(`  -- rmvBackgroundColors(${caller}) [${filespec}]`);
          // Clear decorations
          for (const key of keys) {
            const foundInstance = instancesByColor[key];
            if (foundInstance) {
              // If rangesOrOptions is empty, the existing decorations with the given decoration type will be removed
              activeEditor.setDecorations(foundInstance, []);
              //delete instancesByColor[key];
            }
          }
        }
      }
    }
  }

  private updateColorTable(): void {
    // alpha is specified in percent [10-100]
    if (this.namedColorsAlpha > 0) {
      const bgAlphaHex: string = this.twoDigitHexForByteValue(255 * (this.namedColorsAlpha / 100));
      for (const colorKey in this.namedColors) {
        const colorRGBA: string = this.namedColors[colorKey];
        const updatedRGBA: string = colorRGBA.substring(0, 7) + bgAlphaHex;
        this.namedColors[colorKey] = updatedRGBA;
        this.logMessage(`- updateColorTable(): ${colorKey} [${colorRGBA}] => [${updatedRGBA}]`);
      }
    }
  }

  private twoDigitHexForByteValue(value: number): string {
    const limitedValue: number = value & 255; // limit to 0-255
    const interp: string = limitedValue.toString(16);
    const hexString = interp.length > 1 ? interp : `0${interp}`;
    return hexString;
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

  private colorForBlock(currblockType: eBLockType, sequenceNbr: number): string | undefined {
    let colorKey: string | undefined = undefined;
    if (currblockType == eBLockType.isCon) {
      colorKey = 'con';
    } else if (currblockType == eBLockType.isObj) {
      colorKey = 'obj';
    } else if (currblockType == eBLockType.isVar) {
      colorKey = 'var';
    } else if (currblockType == eBLockType.isDat) {
      colorKey = 'dat';
    } else if (currblockType == eBLockType.isPub) {
      colorKey = 'pub';
    } else if (currblockType == eBLockType.isPri) {
      colorKey = 'pri';
    }
    let desiredColor: string | undefined = undefined;
    if (colorKey) {
      const suffix: string = (sequenceNbr & 0x01) == 0x01 ? 'Lt' : 'Dk';
      colorKey = `${colorKey}${suffix}`;
      if (colorKey in this.namedColors) {
        desiredColor = this.namedColors[colorKey];
      }
    }
    //this.logMessage(`- colorForBlock(${currblockType}, ${sequenceNbr}) -> hash[${colorKey}] = [${desiredColor}]`);
    return desiredColor;
  }
}
