#!/usr/bin/env python3
import re
import sys
import os

# invoke with something like:
#   ./scripts/reTemplateStrings.py server/src/parser/spin2.documentSemanticParser.ts
# this will write to               server/src/parser/spin2.documentSemanticParser-NEW.ts

# This script reads the file spin2.documentSemanticParser.ts,
# converts lines with string concatenation to use template literals,
# replaces single quotes with backticks only if the line contains a
# template literal and does not contain a double-quoted tic string, and
# then writes the converted lines to a new file f1.ts.

# Please note that this script handles the more complex case of one or more concats in a single line

# Always make sure to backup your files before replacing them with files this script created.

def convert_to_template_literals(line):
    matches = re.findall(r"' \+ (.*?) \+ '", line)
    for match in matches:
        line = line.replace("' + " + match + " + '", "${" + match + "}")
    if "${" in line:  # only replace start and end single quotes with backticks if line contains a template literal
     if  "`" not in line:  # if the line is NOT already using `...` lines then convert '..' to `...`
        line = line.replace("'", "`")
    return line

if len(sys.argv) < 2:  # check if a filename was provided
    print("Please provide a filename as a command line argument.")
    sys.exit(1)

filename = sys.argv[1]  # get the filename from the command line arguments

if not os.path.isfile(filename):  # check if the file exists
    print(f"ERROR: The file {filename} does not exist.")
    sys.exit(1)

print(f"Processing file [{filename}]")
with open(filename, 'r') as file:
    lines = file.readlines()

new_lines = [convert_to_template_literals(line) for line in lines]

# derive the output filename from the input filename by appending -NEW to the basename
base = os.path.basename(filename)
new_basename = os.path.splitext(base)[0] + '-NEW' + os.path.splitext(base)[1]
new_filename = os.path.join(os.path.dirname(filename),new_basename)
print(f"Writing to output file [{new_filename}]")

with open(new_filename, 'w') as file:
    file.writelines(new_lines)
