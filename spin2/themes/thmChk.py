#!/usr/bin/env python3
# coding: utf8

import json
import jstyleson
import sys
import os.path
import argparse
from time import sleep, localtime, strftime
import time

from signal import signal, SIGPIPE, SIG_DFL
# from colorama import init as colorama_init
from colorama import Fore, Back, Style

signal(SIGPIPE, SIG_DFL)

script_version = "0.0.1"
script_name = "thmChk.py"
script_info = "{} v{}".format(script_name, script_version)
project_name = "theme-check utility"
project_url = "https://github.com/ironsheep/P2-vscode-extensions"


if False:
    # will be caught by python 2.7 to be illegal syntax
    print_line(
        "Sorry, this script requires a python3 runtime environment.", file=sys.stderr
    )

# Argparse
opt_debug = False
opt_verbose = False
opt_logging = False

def print_line(
    text,
    error=False,
    warning=False,
    info=False,
    verbose=False,
    progress=False,
    debug=False,
    console=True,
    log=False,
):
    timestamp = "[{}] ".format(strftime("%Y-%m-%d %H:%M:%S", localtime()))
    if console:
        if error:
            print(
                Fore.RED
                + Style.BRIGHT
                + timestamp
                + Style.RESET_ALL
                + Fore.RED
                + "- (Error): "
                + "{}".format(text)
                + Style.RESET_ALL,
                file=sys.stderr,
            )
        elif warning:
            print(
                Fore.YELLOW
                + Style.BRIGHT
                + timestamp
                + Style.RESET_ALL
                + Fore.YELLOW
                + "- (Warning): "
                + "{}".format(text)
                + Style.RESET_ALL,
                file=sys.stderr,
            )
        elif info or verbose:
            if verbose and opt_verbose:
                print(
                    Fore.GREEN
                    + timestamp
                    + Fore.YELLOW
                    + "- (Verbose): "
                    + "{}".format(text)
                    + Style.RESET_ALL
                )
            elif info:
                print(
                    Fore.GREEN
                    + Style.BRIGHT
                    + timestamp
                    + Style.RESET_ALL
                    + Fore.GREEN
                    + "- (Info): "
                    + "{}".format(text)
                    + Style.RESET_ALL
                )
        elif debug:
            if opt_debug:
                print(
                    Fore.CYAN
                    + timestamp
                    + "- (DBG): "
                    + "{}".format(text)
                    + Style.RESET_ALL
                )
        elif progress:
            print(
                Fore.BLUE
                + Style.BRIGHT
                + timestamp
                + Style.RESET_ALL
                + Fore.BLUE
                + "- "
                + "{}".format(text)
                + Style.RESET_ALL
            )
        else:
            print(
                Fore.MAGENTA
                + Style.BRIGHT
                + timestamp
                + Style.RESET_ALL
                + Fore.MAGENTA
                + "{}".format(text)
                + Style.RESET_ALL
            )
        # log messages can be debug too!
        if log and opt_logging:
            if debug:
                message = "{}".format(timestamp) + "- (DBG): " + "{}".format(text)
            else:
                message = "{}".format(timestamp) + "- " + "{}".format(text)
            if log_fp is not None:
                # print("Log [{}]".format(message))
                log_fp.write(message + "\n")
                log_fp.flush()


# -----------------------------------------------------------------------------
#  Parameter Handling
# -----------------------------------------------------------------------------

parser = argparse.ArgumentParser(
    description=script_info, epilog="For further details see: " + project_url
)
parser.add_argument(
    "-v", "--verbose", help="increase output (v)erbosity", action="store_true"
)
parser.add_argument("-d", "--debug", help="show (d)ebug output", action="store_true")
parser.add_argument(
    "-l",
    "--log_filename",
    help="(l)og actions to {LOG FILENAME}",
    default="",
)
parser.add_argument(
    "-t",
    "--theme_filename",
    help="process (t)heme file {THEME_FILENAME}",
    default="",
)
parse_args = parser.parse_args()

log_filename = parse_args.log_filename
theme_filename = parse_args.theme_filename
opt_debug = parse_args.debug
opt_verbose = parse_args.verbose
opt_logging = len(log_filename) > 0
opt_read_theme = len(theme_filename) > 0


print_line(script_info, info=True)
if opt_verbose:
    print_line("Verbose enabled", info=True)
if opt_debug:
    print_line("Debug enabled", debug=True)
if opt_logging:
    logFspec = "./logs/" + log_filename
    # print("Log  Logging to [{}]".format(logFspec))
    print_line("* Writing Log {}".format(logFspec), info=True)
    log_fp = open(logFspec, "a")
    print_line("* Log {} - Started".format(log_filename), log=True)
else:
    log_fp = None
if opt_read_theme:
    themeFspec = "./" + theme_filename
    # print("Log  Logging to [{}]".format(logFspec))
    print_line("* Processing Theme {}".format(themeFspec), info=True)
    # open a theme file
    theme_fp = open(theme_filename)
    print_line("* Log {} - Opened".format(theme_filename), log=True)
else:
    theme_fp = None

# returns JSON object as
# a dictionary
dummy = 0
scopesDict = {}  # scopeName:valueDict
tmpValuesDict = {}  # colorName:entryType

def registerColorForScope(entryType, scopeName, colorName):
    global scopesDict
    global tmpValuesDict
    if not scopeName in scopesDict.keys():
        tmpValuesDict.clear()
        tmpValuesDict[colorName] = entryType
        scopesDict[scopeName] = tmpValuesDict
    else:
        tmpValuesDict = scopesDict[scopeName]
        if not colorName in tmpValuesDict.keys():
            tmpValuesDict[colorName] = entryType
            scopesDict[scopeName] = tmpValuesDict

def displayColorForScopeInfo():
    global scopesDict
    print_line("- Checking all scopes:", info=True)
    sortedScopesKeys = list(scopesDict.keys())
    sortedScopesKeys.sort()
    warningCount = 0
    for scopeName in sortedScopesKeys:
        colorValuesDict = scopesDict[scopeName]
        #if len(colorValuesDict) > 1:
        sortedColorKeys = list(colorValuesDict.keys())
        sortedColorKeys.sort()
        if len(sortedColorKeys) > 1:
            warningCount += 1
            for colorValue in sortedColorKeys:
                entryType = colorValuesDict[colorValue]
                print_line("  -- scope: {} [{}] {}".format(scopeName, colorValue, entryType), warning=True)

        for colorValue in sortedColorKeys:
            entryType = colorValuesDict[colorValue]
            print_line("  -- scope: {} [{}] {}".format(scopeName, colorValue, entryType), verbose=True)
    if warningCount == 0:
        print_line("  -- No scope warnings found: no duplicate color values", info=True)

if theme_fp is not None:
    themeData = jstyleson.load(theme_fp)
    # print_line("- json file [{}]".format(themeData), debug=True)
    for keyName in themeData.keys():
        #print_line("- key [{}]".format(keyName), debug=True)
        if(keyName == "$schema" or keyName == "name" or keyName == "semanticHighlighting"):
            print_line("- {}: {}".format(keyName, themeData[keyName]), verbose=True)
        elif(keyName == "colors"):
            #  FMT:  "checkbox.border": "#919191",
            colorDict = themeData[keyName]
            print_line("  -- colors: has {} values".format(len(colorDict)), verbose=True)
            for scopeName in colorDict.keys():
                 #print_line("  --- [{}]: {}".format(scopeName, colorDict[scopeName]), debug=True)
                 registerColorForScope(keyName, scopeName, colorDict[scopeName])
        elif(keyName == "tokenColors"):
            #  FMT: [{
            #      "scope": ["meta.embedded", "source.groovy.embedded", "string meta.image.inline.markdown"],
            #      "settings": {
            #        "foreground": "#000000ff"
            #      }
            #    },{}]
            tokenColorList = themeData[keyName]
            print_line("  -- tokenColors: has {} values".format(len(tokenColorList)), verbose=True)
            for tokenColorDict in tokenColorList:
                settingsDict = tokenColorDict["settings"] # returns dictionary of color name:value pairs
                colorRaw = ""
                fontStyle = ""
                colorValue = ""
                if "foreground" in settingsDict.keys():
                    colorRaw = settingsDict["foreground"]
                    colorValue = colorRaw
                if "fontStyle" in settingsDict.keys():
                    fontStyle = settingsDict["fontStyle"]
                    if colorRaw == "":
                        colorValue = fontStyle
                    else:
                        colorValue = colorRaw + " " + fontStyle
                scopeItem = tokenColorDict["scope"] # returns string or list of strings
                if isinstance(scopeItem, list):
                    # have list of scopes
                    for scopeName in scopeItem:
                        registerColorForScope(keyName, scopeName, colorValue)
                else:
                    # have single scope
                    registerColorForScope(keyName, scopeItem, colorValue)
        elif(keyName == "semanticTokenColors"):
            #  FMT: "newOperator": "#0000ff",
            #       "stringLiteral": "#a31515",
            #       "customLiteral": "#000000",
            semanticTokenColorsDict = themeData[keyName]
            print_line("  -- semanticTokenColorsDict: has {} values".format(len(semanticTokenColorsDict)), verbose=True)
            for scopeName in semanticTokenColorsDict.keys():
                colorValue  = semanticTokenColorsDict[scopeName]
                if isinstance(colorValue, dict):
                    colorRaw = ""
                    fontStyle = ""
                    newColorValue = ""
                    if "foreground" in colorValue.keys():
                        colorRaw = colorValue["foreground"]
                        newColorValue = colorRaw
                    if "fontStyle" in colorValue.keys():
                        fontStyle = colorValue["fontStyle"]
                        if colorRaw == "":
                            newColorValue = fontStyle
                        else:
                            newColorValue = colorRaw + " " + fontStyle
                    registerColorForScope(keyName, scopeName, newColorValue)
                else:
                    registerColorForScope(keyName, scopeName, colorValue)
    # done, finish up
    displayColorForScopeInfo()
