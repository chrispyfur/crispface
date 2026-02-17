# CrispFace — System Dependencies

Required packages for building and running CrispFace on Debian/Ubuntu Linux.

## Runtime (Web Application)

| Package | Purpose |
|---|---|
| `apache2` | Web server |
| `php` (8.4+) | Serves HTML pages, firmware build endpoint |
| `python3` | CGI API endpoints |
| `python3-bcrypt` | Password hashing for user authentication |

## Build Tools (Firmware)

| Package | Purpose |
|---|---|
| `python3-pip` | PlatformIO installation |
| `platformio` | ESP32-S3 firmware compiler (installed via pip) |

PlatformIO includes `esptool` which is used for merging firmware binaries (`esptool --chip esp32s3 merge-bin`).

## Font Generation (Optional)

Only needed when generating custom font sizes (e.g. 36pt, 48pt) beyond the standard Adafruit GFX 9/12/18/24pt.

| Package | Purpose |
|---|---|
| `pkg-config` | Locates freetype library flags for fontconvert compilation |
| `libfreetype-dev` | FreeType development headers for fontconvert compilation |
| `gcc` | C compiler for building the fontconvert tool |

The FreeFont TTF source files are bundled in `firmware/tools/fonts/` (downloaded from GNU FreeFont) so no system font packages are needed.

### Install all font generation dependencies

```bash
sudo apt-get install -y pkg-config libfreetype-dev gcc
```

### Generate custom fonts

```bash
cd firmware
bash generate_fonts.sh
```

## Quick Install (All Dependencies)

```bash
# Runtime + build essentials
sudo apt-get install -y apache2 php python3 python3-pip python3-bcrypt

# Font generation (optional)
sudo apt-get install -y pkg-config libfreetype-dev gcc

# PlatformIO (user-level install)
pip install --user platformio
```
