# CrispFace — CLAUDE.md

Watch face editor and renderer for the Watchy ESP32-S3 smartwatch.

## Project Overview

CrispFace is a client-server system: a PHP/Python web app lets users design watch faces with positioned text complications, and an ESP32-S3 firmware fetches and renders those faces on a 200x200 1-bit e-paper display. The watch is a thin client — the server resolves dynamic data (weather, etc.) and the watch only renders locally-available values (time, date, battery, version) from its own hardware.

## Directory Structure

```
crispface/
├── api/                    # Backend endpoints (Python CGI + PHP)
│   ├── router.php          # Routes *.py requests through Python CGI
│   ├── watch_faces.py      # Firmware sync endpoint (Bearer auth)
│   ├── build_firmware.php  # Build-on-demand (auto version bump)
│   ├── face.py / faces.py  # Face CRUD
│   ├── watch.py / watches.py # Watch CRUD
│   ├── complication.py     # Complication CRUD
│   ├── login.py / logout.py / session.py
│   └── sources/            # Complication data sources
│       ├── battery.py      # Battery (editor preview only)
│       ├── ics_calendar.py # ICS calendar feeds (multi-feed)
│       ├── sample_word.py  # Random word (novelty)
│       ├── text.py         # Static text
│       ├── time.py         # Current time (editor preview)
│       ├── uk_town_lookup.py # UK town coordinate lookup
│       ├── uk_weather.py   # Met Office DataHub weather
│       ├── version.py      # Firmware version (editor preview)
│       └── weather.py      # Open-Meteo weather (free, no API key)
├── lib/                    # Shared Python libraries
│   ├── auth.py             # Session + Bearer token auth
│   ├── config.py           # DATA_DIR, paths
│   └── store.py            # JSON flat-file storage
├── data/                   # Flat-file JSON storage (not in git)
│   ├── users.json          # User accounts + API tokens
│   ├── users/<name>/       # Per-user faces/, watches/
│   ├── complications/      # Complication template JSON files
│   ├── cache/              # Per-URL ICS + weather cache files
│   └── uk_towns.json       # UK town coordinate database
├── firmware/               # ESP32-S3 PlatformIO project
│   ├── src/main.cpp        # CrispFace firmware (single file)
│   ├── src_stock/          # Stock Watchy firmware
│   ├── include/config.h    # Server URL, WiFi creds, API token, version
│   ├── include/fonts.h     # Adafruit GFX font lookup table
│   ├── platformio.ini      # Two envs: watchy, stock
│   └── build.sh            # Manual build script
├── firmware-builds/        # Built binaries + manifests (not in git)
├── Documentation/          # Specs (protocol, firmware, web builder)
├── js/ css/                # Frontend assets
├── index.html              # Login / landing page
├── editor.html             # Fabric.js face editor (main UI)
├── flash.html              # Build & flash page (Web Serial)
├── faces.html              # Face management
├── complications.html      # Complication management
├── complication-edit.html  # Complication editor
├── watch-edit.html         # Watch editor
└── users.html              # User management (admin)
```

## Key Commands

```bash
# Build firmware (manual — the web UI auto-builds via build_firmware.php)
cd firmware && pio run -e watchy

# Check PHP/Python errors
tail -f /var/www/users/playground/playground.crisprain.co.uk/logs/playground.crisprain.co.uk.error.log

# Test the watch faces API endpoint
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  "https://playground.crisprain.co.uk/crispface/api/watch_faces.py?watch_id=YOUR_WATCH_ID"
```

## Architecture Notes

### Web App
- **PHP** serves HTML pages, **Python CGI** handles API endpoints via `router.php`
- `router.php` passes `HTTP_AUTHORIZATION` to Python scripts as an env var
- Flat-file JSON storage in `data/` — no MySQL
- Fabric.js canvas editor for 200x200 face layout

### Firmware (v0.2.x)
- **Single file**: `main.cpp` — CrispFace class extends Watchy
- **RTC_DATA_ATTR** persists state across deep sleep: face index, face count, last sync time, sync interval, sync flag, last back-press time, time-seeded flag, plus alert/notification state (see Alert System below)
- **SPIFFS** caches face JSON as `/face_0.json`, `/face_1.json`, etc. — no subdirectories (SPIFFS doesn't support real directories, crashes on directory operations)
- **Sync flow**: WiFi connect → HTTPS GET with Bearer token → disconnect WiFi ASAP → parse JSON → write to SPIFFS
- **Progress bar**: 4px bar at bottom of display via `display.displayWindow()` partial update during sync — keeps existing face visible
- **Local complications**: time, date, battery, version resolved on-device from RTC/ADC/config
- **Server complications**: pre-resolved text values cached on SPIFFS
- **Stale data**: rendered in fake italic (per-row pixel X-shear on glyph bitmaps)
- **Sync interval**: max stale_seconds of non-local complications (minimum 60s); defaults to 86400s (daily) if no server complications
- **Partial refresh** by default (no flicker). Double-press top-left for full refresh (clears ghosting)
- **Fonts**: FreeSans, FreeSerif, FreeMono (regular+bold) at 9/12/18/24/36/48pt. Custom 36pt+48pt fonts generated via `firmware/generate_fonts.sh`

### Alert System
Calendar complications can include an `alerts` array in their API response. The firmware creates two CfAlert entries per event:

1. **Pre-alert** — fires N minutes before event (configurable per-feed via `alert_before`, default 5 min). Notification header shows "In about N minutes"
2. **Event-time alert** — fires at exact event time. Header shows "At HH:MM"

**Buzz patterns:**
- **Gentle**: `vibMotor(75, 6)` triple buzz → 3s pause → triple buzz again, then show notification
- **Insistent**: privacy-first — continuous pulsing buzz (up to 2 min) until any button press, then reveal notification text

**Notification screen**: rounded-rect border, context-aware header, event text centered, "Press any button" hint. Any button dismisses.

**Per-feed settings** (configured in editor feed modal):
- `alert_mode`: none / gentle / insistent
- `alert_before`: 5 / 15 / 30 minutes

**Alert dedup**: UID is MD5 of `feed_url|dtstart_iso|title` (16 hex chars). Up to 20 alert slots (10 events × 2 alerts each). Alerts sorted nearest-first, capped at 10 per API response.

### Font Size Mapping (editor stored value → Adafruit GFX pt)
| Stored | GFX pt | ~px on watch |
|--------|--------|-------------|
| 8, 12  | 9pt    | 13px        |
| 16     | 12pt   | 17px        |
| 24     | 18pt   | 25px        |
| 48     | 24pt   | 33px        |
| 60     | 36pt   | 51px        |
| 72     | 48pt   | 67px        |

### Font Families
| Editor value | Firmware value | Typeface |
|---|---|---|
| sans-serif | sans | FreeSans |
| serif | serif | FreeSerif |
| monospace | mono | FreeMono |

### Button Layout (physical positions)
```
[top-left: Sync]      [top-right: Prev face]
[bottom-left: Menu]   [bottom-right: Next face]
```
- Top-left (BACK): sync from server. Double-press within 4s = full display refresh. Long hold (1.5s) = debug sync
- Bottom-left (MENU): stock Watchy menu
- Top-right (UP) / Bottom-right (DOWN): cycle faces

### Build-on-Demand
- `api/build_firmware.php` auto-bumps the patch version in `config.h` before each build
- Injects per-watch config (watch ID, API token, timezone, build epoch, WiFi networks) temporarily
- Runs `pio run`, merges binary with `esptool` (bootloader + partitions + app), writes timestamped binary + ESP Web Tools manifest
- Restores config.h after build (keeps bumped version, removes per-watch injection)
- Cleans up old builds (keeps last 3)
- `flash.html` has Build button → Flash to Watchy button (ESP Web Tools)

### Complication Sources
| Source | API key? | Notes |
|---|---|---|
| `weather.py` (Open-Meteo) | No | Free, hardcoded city list with coords, WMO codes |
| `uk_weather.py` (Met Office) | Yes | DataHub API, UK town lookup, BST/GMT handling |
| `ics_calendar.py` | No | Multi-feed ICS, per-feed alert/bold settings, 60s cache |
| `text.py` | No | Static text passthrough |
| `sample_word.py` | No | Random word from fixed list |
| `battery.py` | No | Editor preview only (firmware resolves locally) |
| `time.py` | No | Editor preview only (firmware resolves locally) |
| `version.py` | No | Editor preview only (firmware resolves locally) |

### Calendar Text Formatting Bytes
| Byte | Meaning |
|---|---|
| `\x01` | Filled circle prefix (busy all-day event) |
| `\x02` | Open circle prefix (free/transparent all-day event) |
| `\x03` | Bold marker (line from bold-flagged feed) |
| `\x04` | Day divider (rendered as centered horizontal line) |

### Watch Faces API Response Format
```json
{
  "success": true,
  "faces": [{
    "id": "f65dc7a50fa31c67",
    "name": "Weekend Face",
    "bg": "white",
    "stale": 60,
    "complications": [{
      "id": "time", "type": "time",
      "x": 10, "y": 10, "w": 180, "h": 60,
      "stale": 600, "value": "20:42",
      "font": "mono", "size": 48, "bold": false,
      "align": "center", "color": "black",
      "local": true
    }]
  }],
  "fetched_at": 1707900000
}
```

### Calendar Alert API Response Format
Calendar complications include `alerts` alongside `value`:
```json
{
  "value": "10:30 Team standup\n14:00 Client call",
  "alerts": [{
    "sec": 1800,
    "text": "Team standup\n@ Meeting Room 1",
    "time": "10:30",
    "ins": false,
    "uid": "a3f9b2c1d4e5f607",
    "pre": 300
  }]
}
```

## Known Issues / Gotchas

- **ArduinoJson must be included BEFORE Watchy.h** — Arduino_JSON (bundled with Watchy) defines `#define typeof typeof_` which breaks ArduinoJson's pgmspace macros
- **ArduinoJson v6 only** — v7 conflicts with Arduino_JSON bundled by Watchy
- **SPIFFS has no real directory support** — `SPIFFS.open("/faces")` or `SPIFFS.mkdir()` will crash the ESP32. Store files in root with naming convention (`/face_0.json`)
- **RTC_DATA_ATTR is lost on hard crash/brownout** — firmware recovers face count by probing SPIFFS on boot, seeds RTC from build epoch
- **Watch RTC may not match real time** — timestamps use `makeTime(currentTime)` consistently (both for cfLastSync and staleness checks) so they're relative to the same clock
- **WiFi requires `WiFi.mode(WIFI_STA)` before `WiFi.begin()`** on ESP32-S3
- **Web Serial API requires a real user gesture** — programmatic `.click()` on the ESP Web Tools button won't trigger the serial port picker
- **`complication_type` may be empty** in face JSON — firmware falls back to `complication_id` for local type detection
- **`CRISPFACE_FACES_DIR`** is defined in config.h but not used — SPIFFS paths are hardcoded as `/face_N.json`

## Conventions

- Always use physical button references: "top-left", "top-right", "bottom-left", "bottom-right" (not BACK, UP, MENU, DOWN)
- Keep firmware in a single `main.cpp` — the codebase is small enough
- Flat-file JSON storage, no MySQL
- Version auto-bumps on build — don't manually set version numbers
