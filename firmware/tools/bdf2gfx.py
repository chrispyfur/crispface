#!/usr/bin/env python3
"""Convert a BDF bitmap font to an Adafruit GFX .h header.

Usage: python3 bdf2gfx.py <input.bdf> <font_name> [--scale N]

Outputs a complete GFX font header (bitmaps, glyphs, font struct)
for ASCII 0x20..0x7E. With --scale N, each pixel becomes NxN block.
"""

import sys
import argparse
import os


def parse_bdf(path):
    """Parse a BDF file, return (global props, list of glyph dicts)."""
    glyphs = []
    glyph = None
    in_bitmap = False
    bitmap_rows = []
    props = {}

    with open(path, 'r') as f:
        for line in f:
            line = line.rstrip('\n\r')
            parts = line.split(None, 1)
            if not parts:
                continue
            keyword = parts[0]
            rest = parts[1] if len(parts) > 1 else ''

            if keyword == 'FONT_ASCENT':
                props['ascent'] = int(rest)
            elif keyword == 'FONT_DESCENT':
                props['descent'] = int(rest)
            elif keyword == 'PIXEL_SIZE':
                props['pixel_size'] = int(rest)

            if keyword == 'STARTCHAR':
                glyph = {'name': rest, 'bitmap': []}
                in_bitmap = False
            elif keyword == 'ENCODING':
                if glyph is not None:
                    glyph['encoding'] = int(rest)
            elif keyword == 'DWIDTH':
                if glyph is not None:
                    vals = rest.split()
                    glyph['dwidth'] = int(vals[0])
            elif keyword == 'BBX':
                if glyph is not None:
                    vals = rest.split()
                    glyph['bbw'] = int(vals[0])
                    glyph['bbh'] = int(vals[1])
                    glyph['bbx'] = int(vals[2])
                    glyph['bby'] = int(vals[3])
            elif keyword == 'BITMAP':
                in_bitmap = True
                bitmap_rows = []
            elif keyword == 'ENDCHAR':
                if glyph is not None:
                    glyph['bitmap'] = bitmap_rows
                    glyphs.append(glyph)
                glyph = None
                in_bitmap = False
            elif in_bitmap and glyph is not None:
                bitmap_rows.append(line.strip())

    return props, glyphs


def glyph_to_bits(glyph, scale=1):
    """Convert glyph bitmap to packed bit array, return (bits, width, height).

    Each hex row in BDF is left-aligned in the byte boundary.
    We extract exactly bbw pixels from each row.
    With scale > 1, each pixel becomes scale x scale.
    """
    bbw = glyph['bbw']
    bbh = glyph['bbh']
    w = bbw * scale
    h = bbh * scale

    if bbw == 0 or bbh == 0:
        return [], 0, 0

    rows = []
    for hex_row in glyph['bitmap']:
        # Convert hex string to integer
        val = int(hex_row, 16)
        total_bits = len(hex_row) * 4
        # Extract the leftmost bbw bits
        pixel_row = []
        for i in range(bbw):
            bit = (val >> (total_bits - 1 - i)) & 1
            pixel_row.append(bit)
        rows.append(pixel_row)

    # Scale
    scaled_rows = []
    for row in rows:
        scaled_row = []
        for pixel in row:
            scaled_row.extend([pixel] * scale)
        for _ in range(scale):
            scaled_rows.append(list(scaled_row))

    # Pack into bytes (MSB first, row by row)
    bits = []
    for row in scaled_rows:
        for pixel in row:
            bits.append(pixel)

    return bits, w, h


def pack_bits(bits):
    """Pack a list of 0/1 bits into bytes (MSB first)."""
    result = []
    for i in range(0, len(bits), 8):
        byte = 0
        for j in range(8):
            if i + j < len(bits):
                byte |= bits[i + j] << (7 - j)
        result.append(byte)
    return result


def generate_header(font_name, props, glyphs, scale=1, first=0x20, last=0x7E):
    """Generate the complete Adafruit GFX .h header."""
    ascent = props.get('ascent', 0) * scale
    descent = props.get('descent', 0) * scale
    y_advance = (ascent + descent)

    # Filter and sort glyphs for our range
    glyph_map = {}
    for g in glyphs:
        enc = g.get('encoding', -1)
        if first <= enc <= last:
            glyph_map[enc] = g

    # Build bitmap data and glyph entries
    all_bitmap_bytes = []
    glyph_entries = []

    for code in range(first, last + 1):
        offset = len(all_bitmap_bytes)
        g = glyph_map.get(code)

        if g is None or g['bbw'] == 0 or g['bbh'] == 0:
            # Space or missing glyph
            x_advance = (g['dwidth'] * scale) if g else (ascent // 2)
            glyph_entries.append({
                'offset': offset,
                'width': 0,
                'height': 0,
                'xAdvance': x_advance,
                'xOffset': 0,
                'yOffset': 0,
            })
            continue

        bits, w, h = glyph_to_bits(g, scale)
        packed = pack_bits(bits)
        all_bitmap_bytes.extend(packed)

        x_advance = g['dwidth'] * scale
        x_offset = g['bbx'] * scale
        # GFX yOffset: negative means above baseline
        # BDF bby is offset from baseline (positive = above baseline origin)
        # GFX yOffset = -(bby + bbh) * scale ... relative to baseline at y=0
        # Actually: GFX yOffset = -((bby + bbh) * scale) would put top of glyph
        # GFX convention: yOffset is from cursor baseline, negative = above
        y_offset = -(g['bby'] + g['bbh']) * scale

        glyph_entries.append({
            'offset': offset,
            'width': w,
            'height': h,
            'xAdvance': x_advance,
            'xOffset': x_offset,
            'yOffset': y_offset,
        })

    # Format output
    guard = font_name.upper() + '_H'
    lines = []
    lines.append(f'#ifndef {guard}')
    lines.append(f'#define {guard}')
    lines.append('')
    lines.append('#include <Adafruit_GFX.h>')
    lines.append('')

    # Bitmaps array
    lines.append(f'const uint8_t {font_name}Bitmaps[] PROGMEM = {{')
    for i in range(0, len(all_bitmap_bytes), 12):
        chunk = all_bitmap_bytes[i:i+12]
        hex_str = ', '.join(f'0x{b:02X}' for b in chunk)
        lines.append(f'  {hex_str},')
    lines.append('};')
    lines.append('')

    # Glyphs array
    lines.append(f'const GFXglyph {font_name}Glyphs[] PROGMEM = {{')
    for i, entry in enumerate(glyph_entries):
        code = first + i
        ch = chr(code) if 0x21 <= code <= 0x7E else ' '
        lines.append(
            f'  {{ {entry["offset"]:5d}, {entry["width"]:3d}, {entry["height"]:3d}, '
            f'{entry["xAdvance"]:3d}, {entry["xOffset"]:4d}, {entry["yOffset"]:4d} }},'
            f'  // 0x{code:02X} \'{ch}\''
        )
    lines.append('};')
    lines.append('')

    # Font struct
    lines.append(f'const GFXfont {font_name} PROGMEM = {{')
    lines.append(f'  (uint8_t  *){font_name}Bitmaps,')
    lines.append(f'  (GFXglyph *){font_name}Glyphs,')
    lines.append(f'  0x{first:02X}, 0x{last:02X}, {y_advance}')
    lines.append('};')
    lines.append('')
    lines.append(f'#endif // {guard}')
    lines.append('')

    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description='Convert BDF font to Adafruit GFX header')
    parser.add_argument('input', help='Input BDF file')
    parser.add_argument('font_name', help='C identifier for the font')
    parser.add_argument('--scale', type=int, default=1, help='Integer scale factor (default: 1)')
    parser.add_argument('-o', '--output', help='Output file (default: stdout)')
    args = parser.parse_args()

    props, glyphs = parse_bdf(args.input)
    header = generate_header(args.font_name, props, glyphs, scale=args.scale)

    if args.output:
        with open(args.output, 'w') as f:
            f.write(header)
        print(f'Wrote {args.output}')
    else:
        print(header)


if __name__ == '__main__':
    main()
