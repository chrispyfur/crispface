#!/bin/bash
# Generate 36pt and 48pt Adafruit GFX font headers from FreeFont TTFs.
# Requires: libfreetype-dev, pkg-config, gcc
# The Adafruit GFX library bundles 9/12/18/24pt — 36pt and 48pt need generating.
set -e
cd "$(dirname "$0")"

FONT_DIR="tools/fonts"
OUT_DIR="include/crispface_fonts"
FONTCONVERT="tools/bin/fontconvert"
SIZES=(36 48)
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

# Font families to generate (Sans + Serif only — mono uses Tamzen bitmap font)
TTF_NAMES=(FreeSans FreeSansBold FreeSerif FreeSerifBold)

for SIZE in "${SIZES[@]}"; do
    echo "=== Generating ${SIZE}pt fonts ==="
    for ttf_name in "${TTF_NAMES[@]}"; do
        header_name="${ttf_name}${SIZE}pt7b"
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
done

# Generate Tamzen bitmap fonts (monospace) from BDF sources
echo "=== Generating Tamzen bitmap fonts ==="
BDF2GFX="tools/bdf2gfx.py"
TAMZEN_DIR="$FONT_DIR/tamzen/bdf"

# source_bdf font_name scale
TAMZEN_FONTS=(
    "Tamzen7x13r.bdf  Tamzen13x1      1"
    "Tamzen7x13b.bdf  Tamzen13x1Bold  1"
    "Tamzen8x16r.bdf  Tamzen16x1      1"
    "Tamzen8x16b.bdf  Tamzen16x1Bold  1"
    "Tamzen7x13r.bdf  Tamzen26x2      2"
    "Tamzen7x13b.bdf  Tamzen26x2Bold  2"
    "Tamzen8x16r.bdf  Tamzen32x2      2"
    "Tamzen8x16b.bdf  Tamzen32x2Bold  2"
    "Tamzen10x20r.bdf Tamzen60x3      3"
    "Tamzen10x20b.bdf Tamzen60x3Bold  3"
    "Tamzen10x20r.bdf Tamzen80x4      4"
    "Tamzen10x20b.bdf Tamzen80x4Bold  4"
)

for entry in "${TAMZEN_FONTS[@]}"; do
    read -r bdf_file font_name scale <<< "$entry"
    echo "Generating ${font_name}..."
    python3 "$BDF2GFX" "$TAMZEN_DIR/$bdf_file" "$font_name" --scale "$scale" -o "$OUT_DIR/${font_name}.h"
    echo "  -> $OUT_DIR/${font_name}.h"
done

echo "Done. Generated $(ls "$OUT_DIR"/*.h 2>/dev/null | wc -l) font headers."
