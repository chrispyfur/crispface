#!/bin/bash
# Generate 48pt Adafruit GFX font headers from FreeFont TTFs.
# Requires: libfreetype-dev, pkg-config, gcc
# The Adafruit GFX library bundles 9/12/18/24pt — only 48pt needs generating.
set -e
cd "$(dirname "$0")"

FONT_DIR="tools/fonts"
OUT_DIR="include/crispface_fonts"
FONTCONVERT="tools/bin/fontconvert"
SIZE=48
FIRST_CHAR=32
LAST_CHAR=126

# Check TTF sources exist
if [ ! -f "$FONT_DIR/FreeSans.ttf" ]; then
    echo "Error: FreeFont TTFs not found in $FONT_DIR/"
    echo "Download from https://ftp.gnu.org/gnu/freefont/ and extract to $FONT_DIR/"
    exit 1
fi

# Build fontconvert tool if needed
if [ ! -x "$FONTCONVERT" ]; then
    echo "Building fontconvert tool..."
    mkdir -p "$(dirname "$FONTCONVERT")"

    # Find the Adafruit GFX library source (installed by PlatformIO)
    GFX_DIR=$(find .pio -path "*/Adafruit GFX Library/fontconvert" -type d 2>/dev/null | head -1)

    if [ -z "$GFX_DIR" ]; then
        echo "Error: Cannot find Adafruit GFX fontconvert source."
        echo "Run 'pio run' first to install dependencies."
        exit 1
    fi

    gcc -o "$FONTCONVERT" "$GFX_DIR/fontconvert.c" \
        $(pkg-config --cflags --libs freetype2) -lm
    echo "fontconvert built at $FONTCONVERT"
fi

mkdir -p "$OUT_DIR"

# Generate 48pt fonts for all families
declare -A FONTS=(
    ["FreeSans"]="FreeSans48pt7b"
    ["FreeSansBold"]="FreeSansBold48pt7b"
    ["FreeMono"]="FreeMono48pt7b"
    ["FreeMonoBold"]="FreeMonoBold48pt7b"
    ["FreeSerif"]="FreeSerif48pt7b"
    ["FreeSerifBold"]="FreeSerifBold48pt7b"
)

for ttf_name in "${!FONTS[@]}"; do
    header_name="${FONTS[$ttf_name]}"
    ttf_path="$FONT_DIR/${ttf_name}.ttf"
    out_path="$OUT_DIR/${header_name}.h"

    if [ ! -f "$ttf_path" ]; then
        echo "Warning: $ttf_path not found, skipping."
        continue
    fi

    echo "Generating ${header_name}..."
    "$FONTCONVERT" "$ttf_path" "$SIZE" "$FIRST_CHAR" "$LAST_CHAR" > "$out_path"
    echo "  -> $out_path"
done

echo "Done. Generated $(ls "$OUT_DIR"/*.h 2>/dev/null | wc -l) font headers."
