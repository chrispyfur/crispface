#!/bin/bash
set -e
cd "$(dirname "$0")"

BOOT_APP0=~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin
mkdir -p ../firmware-builds

echo "=== Building CrispFace firmware ==="
pio run -e watchy

echo "Merging CrispFace binary..."
python3 -m esptool --chip esp32s3 merge-bin \
  -o ../firmware-builds/crispface-firmware.bin \
  --flash-mode dio \
  --flash-size 8MB \
  0x0 .pio/build/watchy/bootloader.bin \
  0x8000 .pio/build/watchy/partitions.bin \
  0xe000 "$BOOT_APP0" \
  0x10000 .pio/build/watchy/firmware.bin

echo ""
echo "=== Building Stock firmware ==="
pio run -e stock

echo "Merging Stock binary..."
python3 -m esptool --chip esp32s3 merge-bin \
  -o ../firmware-builds/stock-firmware.bin \
  --flash-mode dio \
  --flash-size 8MB \
  0x0 .pio/build/stock/bootloader.bin \
  0x8000 .pio/build/stock/partitions.bin \
  0xe000 "$BOOT_APP0" \
  0x10000 .pio/build/stock/firmware.bin

echo ""
echo "=== Done ==="
ls -lh ../firmware-builds/crispface-firmware.bin ../firmware-builds/stock-firmware.bin
