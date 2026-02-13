# CrispFace Firmware Specification v0.4

Firmware for the Watchy ESP32 thin client that renders CrispFace watch faces.

---

## Overview

The Watchy runs as a thin client. It fetches face definitions and complication data from the CrispRain server, renders them locally on a 200x200 1-bit e-paper display, and returns to deep sleep. Time is always rendered locally via the RTC.

```
┌─────────────┐         ┌─────────────────┐
│   Watchy    │ ◄─────► │  CrispRain API  │
│  (Client)   │  HTTP   │  (Server)       │
└─────────────┘         └─────────────────┘
```

**Design Principles:**
- Watch is a dumb renderer - all logic lives on server
- Minimal firmware footprint for portability to future hardware
- Build on stock Watchy firmware - inherit WiFi menu, settings, timezone, not reinvent
- Button-press-only wake - no tilt-to-wake, no timed wake, maximum battery life

---

## Firmware Architecture

```
crispface-firmware/
├── src/
│   ├── main.cpp              # Entry point, sleep management
│   ├── CrispFace.cpp         # Core renderer
│   ├── Network.cpp           # WiFi, HTTP client
│   ├── Controls.cpp          # Button handling
│   ├── Parser.cpp            # JSON parsing (ArduinoJson)
│   ├── TimeBindings.cpp      # On-device time template resolution
│   └── Display.cpp           # GxEPD2 abstraction
├── include/
│   ├── types.h               # Face, Complication structs
│   ├── fonts.h               # Baked-in font data
│   └── config.h              # Server URL, WiFi creds, token
└── platformio.ini
```

### Memory Budget

- ESP32 has ~320KB SRAM
- Face JSON: max 4KB
- Bitmap cache: ~8KB for frequently used icons
- Font data: ~12KB (3 fonts, multiple sizes)
- Working buffer: ~5KB for display rendering

---

## Face Rendering

### Face Structure

The firmware receives face definitions as JSON from the server and renders them onto the 200x200 1-bit display.

```json
{
  "id": "daily-driver",
  "name": "Daily Driver",
  "background": "black",
  "stale_seconds": 900,
  "complications": [...],
  "controls": {...}
}
```

### Complication Rendering

Each complication occupies a rectangular region and is rendered by type:

| Type | Rendering |
|------|-----------|
| `text` | Draw text string with specified font, alignment, and color |
| `bitmap` | Decode base64 1-bit bitmap and blit to display region |
| `progress` | Draw filled/segmented bar proportional to value |
| `qr` | Generate and render QR code from data string |

**Baked-in Fonts (3 total):**
- `sans` - Clean sans-serif (sizes: 16, 24, 48)
- `mono` - Monospace for data (size: 16)
- `icons` - Icon glyphs (size: 24)

### Face Cycling

The watch maintains an ordered list of faces. No stack, no modals - just simple cycling.

| Button Action | Behavior |
|---------------|----------|
| `next_face` | Move to next face in list |
| `prev_face` | Move to previous face in list |

Face list is received from the server during sync.

---

## Refresh & Staleness

### Time Handling

**Time is handled on-device via the RTC.** The server syncs the RTC periodically via NTP, but the watch renders time locally. This ensures time is always accurate, even between server syncs.

Special template `{{time.*}}` is resolved on-device:
- `{{time.hour}}` - Current hour (24h)
- `{{time.hour12}}` - Current hour (12h)
- `{{time.minute}}` - Current minute (zero-padded)
- `{{time.second}}` - Current second
- `{{time.weekday}}` - Day name (Mon, Tue, etc.)
- `{{time.date}}` - Date string (e.g., "Feb 7")
- `{{time.ampm}}` - AM/PM indicator

Also resolved on-device:
- `{{battery.pct}}` - Current battery percentage

### Staleness

Each complication can define its own `stale_seconds`. When stale:
1. Watch fetches updated content for that complication
2. Re-renders only affected region
3. Uses partial display refresh when possible

Example: Weather updates every 30 min, battery every 5 min, time every 1 min (via RTC, no fetch needed).

### Wake & Refresh Triggers

The watch stays in deep sleep until a button is pressed. No timed wake, no tilt-to-wake. This maximizes battery life.

On wake (button press):
1. Check staleness of each complication
2. Fetch updates for stale complications (or full face if needed)
3. Re-render and display
4. Return to deep sleep

**Note:** Time complications never trigger network fetches - they use the on-device RTC.

---

## Controls

### Button Layout

```
[btn1]          [btn3]
   (top-left)      (top-right)

[btn2]          [btn4]
   (bottom-left)   (bottom-right)
```

Each button supports three input types:
- **Short press** - Quick tap
- **Long press** - Hold for 1 second
- **Double tap** - Two quick taps within 300ms

### Available Actions

| Action | Firmware Behavior |
|--------|-------------------|
| `none` | Ignore input |
| `refresh` | Force refresh - fetch all complication data and re-render |
| `next_face` | Advance to next face in list, fetch if not cached |
| `prev_face` | Go to previous face in list, fetch if not cached |
| `menu` | Pass control to stock Watchy menu system |
| `invert` | Toggle display color inversion locally |
| `custom` | HTTP POST to specified endpoint with device context |

### Default Button Mapping

| Button | Short | Long | Double |
|--------|-------|------|--------|
| btn1 (top-left) | `menu` | `none` | `none` |
| btn2 (bottom-left) | `refresh` | `none` | `none` |
| btn3 (top-right) | `next_face` | `none` | `none` |
| btn4 (bottom-right) | `prev_face` | `none` | `none` |

### Custom Actions

When `action` is `custom`, the watch POSTs to the specified endpoint:

```json
{
  "device_id": "watchy-a1b2c3",
  "button": "btn4",
  "face_id": "daily-driver",
  "timestamp": "2026-02-07T10:35:22Z"
}
```

### Haptic Feedback

`vibrate`: Duration in milliseconds (0 = none). Applies to all actions on that button.

### Menu Mode

When the `menu` action is triggered, control passes to the **stock Watchy menu system**:

| Button | Stock Menu Function |
|--------|---------------------|
| btn1 | Back / Exit |
| btn2 | Down |
| btn3 | Up |
| btn4 | Select / Enter |

CrispFace button mappings only apply when displaying a CrispFace face. Exiting the menu returns to the current face with CrispFace mappings restored.

---

## Server Communication

### Sync (Primary Endpoint)

**POST** `/api/crispface/sync`

Sent on wake when complications are stale.

Request:
```json
{
  "device_id": "watchy-a1b2c3",
  "battery_pct": 78,
  "current_face": "daily-driver",
  "stale_complications": ["weather-temp", "calendar-next"]
}
```

Response:
```json
{
  "faces": ["daily-driver", "minimal", "calendar-view"],
  "current_face": {
    "id": "daily-driver",
    "complications": [...]
  },
  "complication_updates": {
    "weather-temp": {"value": "12°", ...},
    "calendar-next": {"value": "Team sync in 2h", ...}
  },
  "ntp_sync": true
}
```

### Registration

**POST** `/api/crispface/register`

Sent on first boot or factory reset.

```json
{
  "device_id": "watchy-a1b2c3",
  "firmware_version": "crispface-0.1.0",
  "capabilities": {
    "display": "200x200x1",
    "buttons": 4,
    "sensors": ["accelerometer", "rtc", "battery"]
  }
}
```

### Face Fetch

**GET** `/api/crispface/face/{face_id}`

Fetch full face JSON when switching to a face not in cache.

### Authentication

- Pre-shared token stored in NVS (non-volatile storage)
- Sent via `Authorization: Bearer <token>` header on every request
- Token provisioned during initial setup (see Web Serial Flashing below)
- Server returns 401 if token is invalid

### Protocol Versioning

All requests include header:

```
X-CrispFace-Version: 0.4
```

If the server returns a `version_mismatch` error, the firmware should display an "Update Required" message.

---

## Offline Behavior

When the server is unreachable:

1. **Display cached face** - Last successfully fetched face is stored in flash
2. **Show offline indicator** - Small icon (e.g., crossed WiFi) in corner
3. **Time still works** - RTC-based complications render correctly
4. **Buttons still work** - Local actions (next_face, prev_face, menu) function normally
5. **Custom actions queue** - Optional: store pending custom button presses, send when reconnected

On next successful sync, the offline indicator clears and fresh data is displayed.

---

## Inherited from Stock Watchy

CrispFace extends the stock Watchy firmware rather than replacing it. The following are inherited:

- **WiFi menu** - SSID selection and password entry
- **Settings menu** - Timezone, NTP server, vibration settings
- **Accelerometer setup** - BMA423 initialization
- **RTC management** - Time sync and alarm configuration
- **Deep sleep handling** - Power management

CrispFace hooks into `drawWatchFace()` and button handling, leaving the rest intact. Access the stock menu via a button mapped to the `menu` action.

---

## Web Serial Flashing

The firmware can be flashed directly from a web browser using the **Web Serial API**, eliminating the need for users to install PlatformIO, Arduino IDE, or esptool. This is the recommended approach for end-user device provisioning.

### How It Works

The Web Serial API (available in Chrome and Edge, version 89+) allows web pages to communicate with serial ports. Combined with a JavaScript implementation of the ESP32 flash protocol, the entire flashing process runs in the browser.

### Recommended Tooling

**ESP Web Tools** (by ESPHome) is the most mature option:
- Supports ESP32 (and ESP32-S2, S3, C3, etc.)
- Manifest-based: describe firmware builds in a JSON manifest
- Automatically detects connected chip family
- Requires a single merged firmware binary (use `esptool.py merge_bin` to combine the 4 ESP-IDF output files)
- Embeddable as a web component: `<esp-web-install-button>`

**Alternative tools:**
- **esptool-js** - Pure JS implementation of esptool, good for custom integration
- **ESPConnect** - Also supports filesystem inspection (SPIFFS/LittleFS)

### Integration with CrispFace

The web builder can include a "Flash Device" page that:

1. User connects Watchy via USB
2. Browser prompts for serial port access
3. Firmware binary is downloaded and flashed
4. On first boot, device generates a `device_id`
5. Web builder displays the device ID and provisions an auth token
6. Token is written to NVS via serial (or via a first-boot API call)

This replaces the previous "token provisioned via USB serial" step with a fully browser-based flow.

### Browser Requirements

- **Chrome 89+** or **Edge 89+** (Chromium-based)
- **Not supported**: Safari, Firefox, any iOS browser
- Desktop only (USB serial requires physical connection)

### Build Pipeline

For Web Serial flashing, the firmware must be built as a single merged binary:

```bash
# Build with PlatformIO
pio run -e watchy

# Merge into single binary
esptool.py --chip esp32 merge_bin \
  -o crispface-firmware.bin \
  --flash_mode dio \
  --flash_size 4MB \
  0x1000 bootloader.bin \
  0x8000 partitions.bin \
  0xe000 boot_app0.bin \
  0x10000 firmware.bin
```

The merged binary is then hosted on the server and referenced in the ESP Web Tools manifest.

---

## Future Considerations

- **OTA updates**: Push firmware updates from server (no USB needed after initial flash)
- **Downloadable fonts**: Fetch additional fonts from server, store in flash
- **Step counter integration**: Read BMA423 step counter, report to server
- **Display partial refresh**: Optimize for per-complication refresh to reduce ghosting

---

## Revision History

| Version | Date | Notes |
|---------|------|-------|
| 0.1 | 2026-02-06 | Initial draft (combined spec) |
| 0.2 | 2026-02-07 | Clarified time handling on-device. Reduced fonts to minimal set. |
| 0.3 | 2026-02-07 | Added: offline behavior, long press support, inherit from stock Watchy firmware, button-only wake. |
| 0.4 | 2026-02-07 | Added: double-tap support, full button action list, default mappings. |
| 0.4.1 | 2026-02-11 | Split into separate firmware and web builder specs. Added Web Serial flashing section. |
