#!/bin/bash

# Script to recursively identify unique file types and count them
# Usage: ./fileType.sh [directory]
# If no directory is provided, current directory is used

# Set the target directory (default to current directory if not provided)
TARGET_DIR="${1:-.}"

# Check if the directory exists
if [[ ! -d "$TARGET_DIR" ]]; then
    echo "Error: Directory '$TARGET_DIR' does not exist."
    exit 1
fi

echo "Analyzing file types in: $TARGET_DIR"
echo "========================================"

# Find all files recursively, extract extensions, count and sort
find "$TARGET_DIR" -type f -name "*.*" | \
    sed 's/.*\.//' | \
    sort | \
    uniq -c | \
    sort -k2 | \
    awk '{printf "%-6s %s\n", $1, $2}'

echo ""

# Also handle files without extensions
NO_EXT_COUNT=$(find "$TARGET_DIR" -type f ! -name "*.*" | wc -l)
if [[ $NO_EXT_COUNT -gt 0 ]]; then
    printf "%-6s %s\n" "$NO_EXT_COUNT" "(no extension)"
fi

# Summary
TOTAL_FILES=$(find "$TARGET_DIR" -type f | wc -l)
UNIQUE_TYPES=$(find "$TARGET_DIR" -type f -name "*.*" | sed 's/.*\.//' | sort -u | wc -l)

echo ""
echo "Summary:"
echo "--------"
echo "Total files: $TOTAL_FILES"
echo "Unique file types: $UNIQUE_TYPES"
