# CrispFace Firmware Specification v0.6

Firmware for the Watchy ESP32-S3 thin client that renders CrispFace watch faces.

---

## Overview

The Watchy runs as a thin client. It fetches face definitions and pre-resolved complication data from the CrispRain server, caches them on SPIFFS, renders them locally on a 200x200 1-bit e-paper display, and returns to deep sleep. Local complications (time, date, battery) are always rendered from on-device hardware.

```
┌─────────────┐         ┌─────────────────┐
│   Watchy    │ ◄─────► │  CrispRain API  │
│  (Client)   │  HTTPS  │  (Server)       │
└─────────────┘         └─────────────────┘
```

**Design Principles:**
- Watch is a dumb renderer — all logic lives on server
- Minimal firmware footprint — single main.cpp file
- Build on stock Watchy firmware — inherit WiFi menu, settings, timezone
- Button-press-only wake — no tilt-to-wake, no timed wake, maximum battery life
- Kill WiFi as early as possible during sync to save battery

---

## Firmware Architecture

```
firmware/
├── src/
│   └── main.cpp              # Everything: renderer, sync, buttons, fonts
├── src_stock/
│   └── main.cpp              # Stock Watchy firmware (separate build env)
├── include/
│   ├── config.h              # Server URL, WiFi creds, token, version
│   └── fonts.h               # Font lookup table (editor px → GFX pt)
├── platformio.ini            # Two envs: watchy, stock
└── build.sh                  # Manual build script
```

The firmware is intentionally kept in a single `main.cpp` file. The CrispFace class extends Watchy and overrides `drawWatchFace()` and `handleButtonPress()`.

### Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| sqfmi/Watchy | latest | Base firmware (display, RTC, WiFi, deep sleep) |
| bblanchon/ArduinoJson | ^6 | JSON parsing (v7 conflicts with bundled Arduino_JSON) |

**Critical**: ArduinoJson must be `#include`d before Watchy.h due to Arduino_JSON's `#define typeof typeof_` macro conflict.

### Memory Budget

- ESP32-S3 has ~320KB SRAM
- ArduinoJson doc for sync: 8KB
- ArduinoJson doc for face render: 4KB
- Font data: ~80KB (FreeSans, FreeSerif, FreeMono — regular+bold — at 9/12/18/24/36/48pt)
- Display framebuffer: 5KB (200x200 1-bit, managed by GxEPD2)

---

## RTC_DATA_ATTR State

These persist across deep sleep cycles but are lost on hard crash or brownout:

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `cfFaceIndex` | int | 0 | Current face index |
| `cfFaceCount` | int | 0 | Number of cached faces |
| `cfLastSync` | int | 0 | Unix timestamp of last server sync (watch RTC) |
| `cfSyncInterval` | int | 600 | Seconds between server syncs |
| `cfNeedsSync` | bool | true | Flag set by sync button or first boot |
| `cfLastBackPress` | int | 0 | Timestamp of last sync button press (double-press detection) |

On boot, if `cfFaceCount` is 0 (RTC lost), firmware probes SPIFFS for `/face_0.json`, `/face_1.json`, etc. to recover the count.

---

## Face Rendering

### drawWatchFace() Flow

1. Mount SPIFFS (every wake — unmounted after deep sleep)
2. If `cfFaceCount == 0`, probe SPIFFS for cached faces
3. Check sync conditions: `cfNeedsSync || (now - cfLastSync) > cfSyncInterval || cfFaceCount == 0`
4. If sync needed → `syncFromServer()` (with progress bar overlay)
5. Load `/face_{cfFaceIndex}.json` from SPIFFS
6. Fill screen with background colour (black or white)
7. For each complication: resolve value, select font, calculate alignment, render

### Complication Rendering

Each complication is rendered as positioned text within a bounding box:

| Field | Description |
|-------|-------------|
| `x`, `y`, `w`, `h` | Bounding rectangle (pixels) |
| `font` | `"sans"`, `"serif"`, or `"mono"` |
| `size` | Editor CSS px (8, 12, 16, 24, 48, 60, 72) |
| `bold` | Boolean |
| `align` | `"left"`, `"center"`, `"right"` |
| `color` | `"black"` or `"white"` |
| `local` | If true, value resolved from RTC/ADC |
| `stale` | Seconds before data is considered stale |
| `value` | Pre-resolved text string from server |

### Font Size Mapping

Editor CSS px values map to Adafruit GFX pt sizes:

| Editor px | GFX pt | Approximate render height |
|-----------|--------|--------------------------|
| 8, 12 | 9pt | ~13px |
| 16 | 12pt | ~17px |
| 24 | 18pt | ~25px |
| 48 | 24pt | ~33px |
| 60 | 36pt | ~51px |
| 72 | 48pt | ~67px |

### Available Fonts

| Family | Firmware name | Regular | Bold |
|--------|--------------|---------|------|
| FreeSans | `sans` | Yes | Yes |
| FreeSerif | `serif` | Yes | Yes |
| FreeMono | `mono` | Yes | Yes |

Standard sizes (9/12/18/24pt) from Adafruit GFX library. 36pt and 48pt custom-generated via `firmware/generate_fonts.sh` using FreeFont TTFs bundled in `firmware/tools/fonts/`.

### Local Complications

Resolved on-device from hardware, never trigger network fetches:

| Type/ID | Rendered Value | Source |
|---------|---------------|--------|
| `time` | `HH:MM` (24h) | RTC |
| `date` | `"Sat 14 Feb"` | RTC |
| `battery` | `"3.8V"` | ADC |

The firmware checks both `type` and `id` fields — `type` may be empty in older face JSON, with the identifier in `id` instead.

### Stale Data

Server complications whose age exceeds their `stale` value are rendered in fake italic. The italic effect is achieved by per-row pixel X-shear on glyph bitmaps (no separate italic font needed).

---

## Server Sync

### syncFromServer() Flow

1. Show progress bar at 5%
2. Connect WiFi (STA mode, up to 40 attempts at 500ms intervals)
3. Progress 20% — HTTPS GET with Bearer token, User-Agent, redirect following
4. Progress 40% — read full response as String
5. **Disconnect WiFi immediately** (biggest power drain)
6. Progress 50% — parse JSON (8KB ArduinoJson doc)
7. Progress 60% — delete old `/face_*.json` files from SPIFFS
8. Write each face to SPIFFS, progress 60→90%
9. Compute `cfSyncInterval` from max stale of non-local complications (minimum 300s)
10. Set `cfLastSync` from watch RTC (not server time — avoids clock mismatch)
11. Progress 100%

### Progress Bar

During sync, a 4px black/white progress bar is drawn at the very bottom of the display (y=196-200) using `display.displayWindow()` for partial window updates. The existing face remains visible above the bar. The bar is naturally overwritten when the face re-renders after sync.

### Error Handling

On failure (WiFi, HTTP, JSON parse), the progress bar resets to 0% (empty) and the firmware falls back to cached faces. No delays or error screens — the user sees their existing face with the bar briefly appearing and disappearing.

---

## Controls

### Button Layout

```
[top-left: Sync]      [top-right: Prev face]

[bottom-left: Menu]   [bottom-right: Next face]
```

### Button Actions

| Button | Position | Action |
|--------|----------|--------|
| BACK | Top-left | Set sync flag, re-render (partial refresh) |
| BACK x2 | Top-left double-press (within 4s) | Sync + full display refresh (clears ghosting) |
| MENU | Bottom-left | Open stock Watchy menu |
| UP | Top-right | Previous face (wraps) |
| DOWN | Bottom-right | Next face (wraps) |

All face renders use **partial refresh** by default (no flicker). Only a double-press of the sync button triggers a full refresh to clear e-paper ghosting.

When in the stock Watchy menu (`guiState != WATCHFACE_STATE`), all buttons are passed through to the stock handler.

### Fallback Screen

When no faces are cached (first boot or SPIFFS wiped):
- Black background with "CrispFace v{version}", current time, and "Press top-left to sync"

---

## Build Pipeline

### PlatformIO Environments

| Environment | Source | Output |
|-------------|--------|--------|
| `watchy` | `src/main.cpp` | CrispFace firmware |
| `stock` | `src_stock/main.cpp` | Stock Watchy firmware |

### Build-on-Demand

`api/build_firmware.php` handles web-triggered builds:

1. Auto-bumps patch version in `config.h` (e.g. 0.2.18 → 0.2.19)
2. Runs `pio run -e watchy` (or stock)
3. Merges binary with `esptool --chip esp32s3 merge-bin` (bootloader + partitions + boot_app0 + firmware)
4. Writes timestamped binary and manifest JSON to `firmware-builds/`
5. Cleans up old builds (keeps last 3)
6. Returns `{success, manifest, version, size}` as JSON

### Web Serial Flashing

`flash.html` provides browser-based flashing via ESP Web Tools:

1. **Test Connection** — opens serial port picker, verifies device is detected
2. **Build** — triggers server-side compilation, shows version and size
3. **Flash to Watchy** — appears after successful build, user clicks to open serial port picker and flash

Requires Chrome or Edge 89+ (Web Serial API). The Flash button must be clicked directly by the user — programmatic clicks don't satisfy the user gesture requirement for `navigator.serial.requestPort()`.

---

## Configuration

`include/config.h` contains all runtime configuration:

| Define | Description |
|--------|-------------|
| `CRISPFACE_VERSION` | Firmware version (auto-bumped by build endpoint) |
| `CRISPFACE_SERVER` | Server URL (https://...) |
| `CRISPFACE_API_PATH` | API endpoint path |
| `CRISPFACE_WATCH_ID` | Watch identifier for this device |
| `CRISPFACE_API_TOKEN` | Bearer token for API auth |
| `CRISPFACE_HTTP_TIMEOUT` | HTTP timeout in ms (15000) |
| `CRISPFACE_WIFI_COUNT` | Number of configured WiFi networks (0-5) |
| `CRISPFACE_WIFI_SSID_0..N` | WiFi SSID for each network |
| `CRISPFACE_WIFI_PASS_0..N` | WiFi password for each network |

WiFi networks are configured per-watch in the web UI. The build process injects them into `config.h` at build time. The firmware scans available networks (`WiFi.scanNetworks()`) and connects to the strongest known one.

---

## Known Issues & Gotchas

- **SPIFFS has no real directories** — `SPIFFS.mkdir()` or `SPIFFS.open("/dirname")` crashes the ESP32. Files are stored flat in root (`/face_0.json`)
- **ArduinoJson v6 only** — v7 conflicts with Arduino_JSON bundled by Watchy
- **RTC_DATA_ATTR lost on crash** — firmware recovers face count from SPIFFS on boot
- **Watch RTC may be wrong** — timestamps are relative, not absolute. Both cfLastSync and staleness use `makeTime(currentTime)` so the difference is always correct
- **WiFi.mode(WIFI_STA) required** before WiFi.begin() on ESP32-S3

---

## Implemented vs Planned

### Implemented (v0.2.x)
- Text complications with positioning, fonts (3 families, 6 sizes, bold), alignment, colour
- Local complications: time, date, battery, version
- Server-side complication resolution (weather, calendar, etc.)
- Face cycling (top-right/bottom-right buttons)
- Manual sync (top-left button)
- Auto-sync on stale interval
- SPIFFS face caching with crash recovery
- Progress bar overlay during sync
- Stale data italic rendering
- Partial refresh (no flicker)
- Double-press full refresh
- Per-watch WiFi networks (up to 5, scans and connects to strongest)
- Build-on-demand with auto version bump
- Web Serial flashing

### Not Yet Implemented
- Bitmap complications
- Progress bar complications
- QR code complications
- Custom button actions (HTTP POST)
- Long press / double tap button actions
- Haptic feedback
- OTA firmware updates
- Offline indicator icon

---

## Revision History

| Version | Date | Notes |
|---------|------|-------|
| 0.1 | 2026-02-06 | Initial draft (combined spec) |
| 0.2 | 2026-02-07 | Clarified time handling on-device. Reduced fonts to minimal set. |
| 0.3 | 2026-02-07 | Added: offline behavior, long press support, inherit from stock Watchy. |
| 0.4 | 2026-02-07 | Added: double-tap support, full button action list, default mappings. |
| 0.4.1 | 2026-02-11 | Split into separate firmware and web builder specs. Added Web Serial section. |
| 0.5 | 2026-02-14 | Updated to match implemented firmware v0.2.x: single-file architecture, SPIFFS caching, progress bar sync, font mapping, partial refresh, double-press full refresh, build-on-demand, implemented vs planned tracking. |
| 0.6 | 2026-02-17 | Added FreeSerif font family, 36pt/48pt custom font sizes, per-watch WiFi networks, version complication. Removed outdated 48pt disabled note. Updated config.h WiFi defines. |
