#!/usr/bin/env python3
import sys
import os
import argparse
import subprocess

from time import time, sleep, localtime, strftime
from colorama import Fore, Back, Style

# v0.0.1 - awaken email send
# v0.0.2 - add file handling

script_version  = "0.0.1"
script_name     = 'mkSpinList.py'
script_info     = '{} v{}'.format(script_name, script_version)
project_name    = 'Make List of spin/spin2 files for certification'
project_url     = ''

if False:
    # will be caught by python 2.7 to be illegal syntax
    print_line('Sorry, this script requires a python3 runtime environment.', file=sys.stderr)
    os._exit(1)

# -----------------------------------------------------------------------------
# the ABOVE are identical to that found in our gateway .spin2 object
# -----------------------------------------------------------------------------
#   Colorama constants:
#  Fore: BLACK, RED, GREEN, YELLOW, BLUE, MAGENTA, CYAN, WHITE, RESET.
#  Back: BLACK, RED, GREEN, YELLOW, BLUE, MAGENTA, CYAN, WHITE, RESET.
#  Style: DIM, NORMAL, BRIGHT, RESET_ALL
#
# Logging function
def print_line(text, error=False, warning=False, info=False, verbose=False, debug=False, console=True):
    timestamp = strftime('%Y-%m-%d %H:%M:%S', localtime())
    if console:
        if error:
            print(Fore.RED + Style.BRIGHT + '[{}] '.format(timestamp) + Style.NORMAL + '{}'.format(text) + Style.RESET_ALL, file=sys.stderr)
        elif warning:
            print(Fore.YELLOW + Style.BRIGHT + '[{}] '.format(timestamp) + Style.NORMAL + '{}'.format(text) + Style.RESET_ALL)
        elif info or verbose:
            if verbose:
                # conditional verbose output...
                if opt_verbose:
                    print(Fore.GREEN + '[{}] '.format(timestamp) + Fore.YELLOW  + '- ' + '{}'.format(text) + Style.RESET_ALL)
            else:
                # info...
                print(Fore.MAGENTA + '[{}] '.format(timestamp) + Fore.WHITE  + '- ' + '{}'.format(text) + Style.RESET_ALL)
        elif debug:
            # conditional debug output...
            if opt_debug:
                print(Fore.CYAN + '[{}] '.format(timestamp) + '- (DBG): ' + '{}'.format(text) + Style.RESET_ALL)
        else:
            print(Fore.GREEN + '[{}] '.format(timestamp) + Style.RESET_ALL + '{}'.format(text) + Style.RESET_ALL)

# -----------------------------------------------------------------------------
#  Script Argument parsing
# -----------------------------------------------------------------------------

# Argparse
opt_debug = False
opt_verbose = False
opt_useTestFile = False
opt_write = False
opt_topdir = False
opt_copyMarks = False

default_empty_fspec = ''

# Argparse
parser = argparse.ArgumentParser(description=project_name, epilog='For further details see: ' + project_url)
parser.add_argument("-v", "--verbose", help="increase output verbosity", action="store_true")
parser.add_argument("-d", "--debug", help="show debug output", action="store_true")
parser.add_argument("-o", "--outfile", help="specify output file name", default=default_empty_fspec)
parser.add_argument("-f", "--fromfile", help="specify input file name for marks to copy", default=default_empty_fspec)
parser.add_argument("-r", "--rootdir", help="specify starting root directory", default=default_empty_fspec)
parse_args = parser.parse_args()

opt_verbose = parse_args.verbose
opt_debug = parse_args.debug
from_filename = parse_args.fromfile
output_filename = parse_args.outfile
root_dirspec = parse_args.rootdir
if len(output_filename) > 0:
    opt_write = True
if len(root_dirspec) > 0:
    opt_topdir = True
if len(from_filename) > 0:
    opt_copyMarks = True

print_line(script_info, info=True)
if opt_verbose:
    print_line('Verbose enabled', verbose=True)
if opt_debug:
    print_line('Debug enabled', debug=True)

if not opt_write:
    print_line('ERROR: need output filename, missing -o directive', error=True)
    os._exit(1)

if not opt_topdir:
    print_line('ERROR: need top folder name to list, missing -t directive', error=True)
    os._exit(1)

marks_fp = None
write_fp = open(output_filename,'w')
if opt_write:
    print_line('Writing output to [{}]'.format(output_filename), info=True)

if opt_copyMarks:
    print_line('Copying marks from [{}]'.format(from_filename), info=True)
    marks_fp = open(from_filename,'r')

def writeFinding(message):
    write_fp.write('{}\n'.format(message))
    write_fp.flush()

def contentsOfDir(dirSpec):
    folderSpecList = []
    fileSpecList = []
    folder_content = os.listdir(dirSpec)
    for filename in folder_content:
        fileSpec = os.path.join(dirSpec, filename)
        if os.path.isdir(fileSpec):
            folderSpecList.append(filename)
        elif os.path.isfile(fileSpec):
            if isSpinFile(filename):
                md5sum = md5sumOfFile(fileSpec)
                recordFileMd5sum(md5sum, filename)
            fileSpecList.append(filename)
        else:
            print_line('WARNING: Skipping unknown name=[{}/{}]'.format(dirSpec, fileSpec), warning=True)

    print_line('files=[{}]'.format(fileSpecList), debug=True)
    print_line('folders=[{}]'.format(folderSpecList), debug=True)
    return (fileSpecList, folderSpecList)

def md5sumOfFile(filespec):
    cmd = ['md5', '{}'.format(filespec)]
    #print_line('MD5-cmd: {}'.format(cmd), debug=True)
    result = subprocess.run(cmd, stdout=subprocess.PIPE)
    lineParts = result.stdout.decode('utf-8').strip().split('=')
    lineParts[1] = lineParts[1].strip()
    #print_line('MD5: lineParts[{}]'.format(lineParts), debug=True)
#    if ('v1_2' in filespec):
#        print_line('md5file!: filespec=[{}], lineParts=[{}]'.format(filespec, lineParts), warning=True)
    if (len(lineParts) != 2 or len(lineParts[1]) != 32):
        print_line('md5sum??: filespec=[{}], lineParts=[{}]'.format(filespec, lineParts), warning=True)
    return lineParts[1]

def isSpinFile(fileSpec):
    foundSpinStatus = False
    if fileSpec.lower().endswith('spin2') or fileSpec.lower().endswith('spin'):
        foundSpinStatus = True
    return foundSpinStatus

def isSpinFilesInList(fileSpecList):
    foundSpinStatus = False
    if len(fileSpecList) > 0:
        for filename in fileSpecList:
            if isSpinFile(filename):
                foundSpinStatus = True
                break
    return foundSpinStatus

def spinFilesInList(fileSpecList):
    spinFileSpecList = []
    for filename in fileSpecList:
        if filename.endswith('spin2') or filename.endswith('spin'):
            spinFileSpecList.append(filename)
    return spinFileSpecList

def listFilenames(fileSpecList, containerDir, depth):
    baseDirName = os.path.basename(containerDir)
    spinFileList = spinFilesInList(fileSpecList)
    if len(spinFileList) > 0 and not baseDirName.startswith('.'):
        dirNbr = countDirectory(containerDir)
        writeFinding('\n {:0>3d}-{}:  {}:'.format(dirNbr, depth, containerDir))
        sortedList = sorted(spinFileList, key=str.casefold)
        for filename in sortedList:
            fileDeetsDict = getMarksFor(containerDir, filename)
            fileDoneFlag = ''
            fileNotes = []
            if len(fileDeetsDict) > 0:
                if markKeyDone in fileDeetsDict.keys():
                    doneStr = fileDeetsDict[markKeyDone]
                    fileDoneFlag = ' {}'.format(doneStr)
                if markKeyNotes in fileDeetsDict.keys():
                    fileNotes = fileDeetsDict[markKeyNotes]
            countStr = countFilename(filename)
            writeFinding('\t\t- {} [{}]{}'.format(filename, countStr, fileDoneFlag))
            if len(fileNotes) > 0:
                for noteTxt in fileNotes:
                    writeFinding('\t\t\t- {}'.format(noteTxt))

def genFileListFromFolder(startingDirSpec, depth, dirParent):
    baseDirName = os.path.basename(startingDirSpec)
    print_line('Scanning folder=[{}]   {}'.format(baseDirName, startingDirSpec), verbose=True)
    fileSpecList, folderSpecList = contentsOfDir(startingDirSpec)
    print_line('--', debug=True)
    # process files within dir
    topDirName = baseDirName
    if baseDirName == 'All':
        topDirName = ''
    subDirParent = ''
    if isSpinFilesInList(fileSpecList):
        containerDir = topDirName
        if len(dirParent) > 0:
            containerDir = os.path.join(dirParent, topDirName)
        listFilenames(fileSpecList, containerDir, depth)
    else:
        subDirParent = topDirName
    if len(folderSpecList) > 0:
        sortedFolderNameList = sorted(folderSpecList, key=str.casefold)
        for dirname in sortedFolderNameList:
            subDirSpec = os.path.join(startingDirSpec, dirname)
            if not dirname.startswith('.'):
                genFileListFromFolder(subDirSpec, depth+1, subDirParent)

countByFilename= {}
dirnames = []
filenamesByMD5sum = {}
uniqCountByFilename = {}

def countOfUniqFilesNamed(filename):
    fileCount = 0
    if filename in uniqCountByFilename.keys():
        fileCount = uniqCountByFilename[filename]
#        if ('v1_2' in filename):
#            print_line('countOfUniq!: FOUND fileCount=[{}], filename=[{}]'.format(fileCount, filename), info=True)
    else:
        for md5sum in filenamesByMD5sum.keys():
            possFilename = filenamesByMD5sum[md5sum]
            if filename == possFilename:
                fileCount += 1
            elif fileNameSep in possFilename:
                possFilenames = possFilename.split(fileNameSep)
                for possName in possFilenames:
                    if filename == possName:
                        fileCount += 1

        # save so we don't calc this again
        uniqCountByFilename[filename] = fileCount

#   if ('v1_2' in filename):
#        print_line('countOfUniq!: fileCount=[{}], filename=[{}]'.format(fileCount, filename), warning=True)

    if (fileCount == 0):
        print_line('countOfUniq??: filename=[{}], fileCount=[{}]'.format(filename, fileCount), warning=True)

    return fileCount

fileNameSep = '$fn$'

def recordFileMd5sum(md5sum, filename):
    if len(md5sum) > 0 and len(filename) > 0:
        if md5sum not in filenamesByMD5sum.keys():
            filenamesByMD5sum[md5sum] = filename
        else:
            # get one or more filenames
            foundFile = filenamesByMD5sum[md5sum]
            # if sep we have more than one
            if fileNameSep in foundFile:
                filenames = foundFile.split(fileNameSep)
                if not filename in filenames:
                    # filename not in list so add it
                    filenames.append(filename)
                    foundFile = fileNameSep.join(filenames)
                    # replace dict entry with new
                    filenamesByMD5sum[md5sum] = foundFile
            else:
                # NO sep we have only one
                if foundFile != filename:
                    # place the 2nd name in the list
                    foundFile = '{}{}{}'.format(foundFile, fileNameSep, filename)
                    # replace dict entry with new
                    filenamesByMD5sum[md5sum] = foundFile

        if md5sum not in filenamesByMD5sum.keys():
            print_line('recordFileMd5!: FAILED TO RECORD: md5sum=[{}], filename=[{}]'.format(md5sum, filename), error=True)
    else:
        print_line('recordFileMd5!: EMPTY FIELD! md5sum=[{}], filename=[{}]'.format(md5sum, filename), error=True)

def countFilename(newFilename):
    countStr = ''
    if len(newFilename) > 0:
        if newFilename not in countByFilename.keys():
            fileNbr = len(countByFilename.keys()) + 1
            countStr = '{},{}'.format(fileNbr, 1)
            countByFilename[newFilename] = countStr
        else:
            countStr = countByFilename[newFilename]
            countParts = countStr.split(',')
            filenbr = int(countParts[0])
            nbrSeen = int(countParts[1])
            nbrSeen += 1
            countStr = '{},{}'.format(filenbr, nbrSeen)
            countByFilename[newFilename] = countStr
    return countStr

def countDirectory(newDir):
    dirNbr = 0
    if newDir not in dirnames:
        dirnames.append(newDir)
        dirNbr = len(dirnames)
    else:
        dirNbr = dirnames.index(newDir)+1
    return dirNbr

# main code from here!

marksByDirByFilename = {}
markFileMarksByFilename = {}
markDir = ''
markFile = ''
markMarks = {}
markFileNotes = []

markKeyDone = 'Done'
markKeyNotes = 'Notes'

endAfterLines = 21

debugDir = '?xyzzy?'  #'4-bit Parallel LCD driver'

def getMarksFor(dirName, filename):
    #showDebug = False
    showDebug = (dirName == debugDir)
    foundDirName = ''
    # early check, find the first perfect match
    #  this avoids problem of aborting at dual imperfect matches
    isPerfect = False
    for possDirName in marksByDirByFilename.keys():
          if dirName == possDirName:
            foundDirName = possDirName
            isPerfect = True
            break   # stop checking we have our first
    if showDebug:
        print_line('(SD!) marks: perfect [{}], isPerfect={}'.format(foundDirName, isPerfect), warning=True)
    for possDirName in marksByDirByFilename.keys():
        if dirName == possDirName:
            if len(foundDirName) > 0 and dirName == foundDirName and isPerfect == False:
                print_line('marks: dirName=[{}] MATCHes Have Duplicate!?! 1:{} 2:{}'.format(dirName, foundDirName, possDirName), error=True)
                os._exit(1) # this should NOT happen!
            foundDirName = possDirName
        elif dirName in possDirName:
            if len(foundDirName) > 0:
                if dirName != foundDirName:
                    print_line('marks: dirName=[{}] isPerfect={}, MATCHes MORE than one! 1:{} 2:{}'.format(dirName, isPerfect, foundDirName, possDirName), error=True)
                    os._exit(1) # this should NOT happen!
            else:
                foundDirName = possDirName
    # foundDirName is our match
    if showDebug:
        print_line('(SD!) marks: aft imperfect [{}], isPerfect={}'.format(foundDirName, isPerfect), warning=True)
    fileDeets = {}
    if len(foundDirName) > 0:
        filesInDirDict = marksByDirByFilename[foundDirName]
        if showDebug:
            print_line('getMarksFor({}//): files=[{}]'.format(dirName, filesInDirDict.keys()), info=True)
        for possFileName in filesInDirDict.keys():
            if filename == possFileName:
                fileDeets = filesInDirDict[filename]
    if showDebug:
        print_line('getMarksFor({}//{}): [{}]'.format(dirName, filename, fileDeets), info=True)
    return fileDeets

def saveFileMarks():
    global markMarks
    global markFileMarksByFilename
    # if we know of a file...
    if len(markFile) > 0:
        # finish the file detail dict
        # if we have notes save them
        if len(markFileNotes) > 0:
            markMarks[markKeyNotes] = markFileNotes
        # finish the file entry for this dir
        if len(markMarks) > 0:
            markFileMarksByFilename[markFile] = markMarks
            #showDebug = False
    showDebug = (markDir == debugDir)
    if showDebug:
        print_line('marks: fileName=[{}//{}] = [{}]'.format(markDir, markFile, markMarks), info=True)
    clearFileInfo()

def clearFileInfo():
    global markFile
    global markMarks
    global markFileNotes
    markFile = ''
    markMarks = {}
    markFileNotes = []

def debugShowMarks():
    #print_line('      marksByDirByFilename=[{}]'.format(marksByDirByFilename), warning=True)
    for dirName in marksByDirByFilename.keys():
        print_line('marks: -- {} --'.format(dirName), info=True)
        fileMarksByFilename = marksByDirByFilename[dirName]
        for fileName in fileMarksByFilename.keys():
            fileDetails = fileMarksByFilename[fileName]
            print_line('        {}:   [{}]'.format(fileName, fileDetails), info=True)

if opt_copyMarks:
    # ---------------------------------------------------
    #  load prior marks so we can merge them with new
    # ---------------------------------------------------
    markLines = marks_fp.readlines()
    for markLine in markLines:
        markLine = markLine.strip('\n')
        print_line('marks: markLine=[{}]'.format(markLine), debug=True)
        # special abort while testing
        #endAfterLines -= 1
        #if endAfterLines < 1:
        #    debugShowMarks()
        #    os._exit(1) # so we can eval result'

        if len(markLine) > 0:
            if markLine.startswith('\t') and markLine.endswith(':'):
                # -- have dir entry to capture --
                # done with this file, clear container (dir, file) info
                # finish the file detail dict
                saveFileMarks()
                # save our list of files for this dir
                if len(markFileMarksByFilename) > 0 and len(markDir) > 0:
                    marksByDirByFilename[markDir] = markFileMarksByFilename
                showDebug = (markDir == debugDir)
                if showDebug:
                    print_line('marks: dirName=[{}] = [{}]'.format(markDir, markFileMarksByFilename), info=True)
                # empty all saves, readying for next
                markFileMarksByFilename = {}
                # now capture new dir
                markDir = markLine.strip()
                markDir = markDir[:len(markDir)-1]
                print_line('marks: markDir=[{}]'.format(markDir), debug=True)

            elif markLine.startswith('\t\t- '):
                # -- have file name to capture --
                # save prior file info if present
                saveFileMarks()
                # now capture these new file marks
                markFile = markLine.strip()[2:]
                if '@done' in markFile:
                    # have done mark to capture
                    fileParts = markFile.strip().split('@done')
                    # get name witout done mark
                    markFile = fileParts[0].strip()
                    # record our done mark
                    markMarks[markKeyDone] = '@done{}'.format(fileParts[1].strip())
                showDebug = (markDir == debugDir)
                if showDebug:
                    print_line('marks: markFile=[{}],  markMarks=[{}]'.format(markFile, markMarks), info=True)

            elif markLine.startswith('\t\t\t- '):
                # -- have notation to capture --
                fileNote = markLine.strip()[2:]
                markFileNotes.append(fileNote)
                print_line('marks: markFileNotes=[{}]'.format(markFileNotes), debug=True)

    # save last entry if not already
    if len(markFile) > 0:
        # finish the file detail dict
        saveFileMarks()
        # save our list of files for this dir
        if len(markFileMarksByFilename) > 0 and len(markDir) > 0:
            marksByDirByFilename[markDir] = markFileMarksByFilename

    #debugShowMarks()
    #os._exit(1) # so we can eval result'

dirname = os.path.dirname(root_dirspec)
basename = os.path.basename(root_dirspec)
writeFinding('Spin/Spin2 files in FOLDER:\n Root {}:\n {}:'.format(dirname, basename))
genFileListFromFolder(root_dirspec, 1, '')

writeFinding('Stats for FOLDER:\n Root {}:\n {}:'.format(dirname, basename))
writeFinding('\t{} directories containing: '.format(len(dirnames)))
writeFinding('\t\t{} Unique filenames'.format(len(countByFilename.keys())))
writeFinding('\t\t({} Unique files where content is diff.)'.format(len(filenamesByMD5sum.keys())))

maxCount = 0
writeFinding('Alphabetical list of files with nbr of times found:')
sortedFilenamesList = sorted(countByFilename.keys(), key=str.casefold)
for filename in sortedFilenamesList:
    countStr = countByFilename[filename]
    countParts = countStr.split(',')
    fileCount = int(countParts[1])
    if fileCount > maxCount:
        maxCount = fileCount
    writeFinding('\t{}x {}'.format(countParts[1], filename))

writeFinding('Alphabetical list of files appearing more than once:')
foundOne = False
for fileCount in range(2, maxCount+1):
    countStrSuffix = ',{}'.format(fileCount)
    didShowTitle = False
    for filename in sortedFilenamesList:
        countStr = countByFilename[filename]
        if countStr.endswith(countStrSuffix):
            if not didShowTitle:
                writeFinding('\tFiles appearing {} times:'.format(fileCount))
                didShowTitle = True
            uniqCount = countOfUniqFilesNamed(filename)
            writeFinding('\t\t{}  ({} unique versions)'.format(filename, uniqCount))
            foundOne = True
if not foundOne:
    writeFinding('\t-- No files appearing more than once --')

writeFinding('Identical files with more than one name:')
foundOne = False
for md5sum in filenamesByMD5sum.keys():
    filenameList = filenamesByMD5sum[md5sum]
    if fileNameSep in filenameList:
        fileNames = filenameList.split(fileNameSep)
        writeFinding('\t{} Files with md5:[{}]:'.format(len(fileNames), md5sum))
        for filename in fileNames:
            uniqCount = countOfUniqFilesNamed(filename)
            writeFinding('\t\t{}  ({} unique versions)'.format(filename, uniqCount))
            foundOne = True
if not foundOne:
    writeFinding('\t-- No files found with more than one name --')



write_fp.close()
