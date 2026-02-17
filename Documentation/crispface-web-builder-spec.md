# CrispFace Web Builder & Server Specification v0.6

The server-side platform for designing, managing, and serving watch faces to Watchy ESP32-S3 devices.

---

## Overview

The CrispFace web platform is the brain of the system. PHP serves HTML pages, Python CGI scripts handle API endpoints (routed via `router.php`), and a Fabric.js canvas editor provides a 200x200 pixel-accurate face designer. All data is stored as flat-file JSON — no database required.

```
┌─────────────────┐         ┌─────────────┐
│  Python CGI API │ ◄─────► │  Web Editor  │
│  (via PHP)      │         │  (Fabric.js) │
└────────┬────────┘         └─────────────┘
         │
         │ JSON over HTTPS
         ▼
   Watchy Devices
```

**Design Principles:**
- Complexity belongs in the web builder, not firmware
- The server resolves all dynamic data before sending to devices
- Faces are defined as JSON — the shared contract between server and firmware
- Flat-file JSON storage, no MySQL
- Multi-user with admin/user roles (no self-registration)

---

## Architecture

### Request Flow

1. Browser loads static HTML pages (served by Apache)
2. JavaScript calls API endpoints at `/api/*.py`
3. Apache routes `.py` requests to `router.php` (via RewriteRule)
4. `router.php` executes the Python script as CGI, forwarding environment variables and stdin
5. Python scripts use `lib/auth.py` for session/token auth and `lib/store.py` for data access

### Storage

All data lives in `data/` as flat-file JSON:

```
data/
├── users.json                  # User accounts, password hashes, API tokens, roles
├── complications/              # Complication type definitions (shared, admin-managed)
│   ├── weather.json
│   └── ics-calendar.json
└── users/
    ├── chris/                  # Per-user data
    │   ├── faces/              # Face JSON files (one per face)
    │   │   └── f65dc7a50fa31c67.json
    │   └── watches/            # Watch JSON files (one per watch)
    │       └── 8ed6a0db4ca82b36.json
    └── admin/
        ├── faces/
        └── watches/
```

### Authentication

- **Session cookies**: Signed HMAC-SHA256 cookies for web UI (1-hour expiry)
- **Bearer tokens**: Pre-shared `cf_*` tokens for firmware API access
- **Roles**: `admin` (full access) or `user` (own faces/watches only, read-only complication types)

---

## Core Concepts

### Face

A face is a full-screen layout containing zero or more complications. Faces belong to a user and can be assigned to one or more watches.

```json
{
    "id": "f65dc7a50fa31c67",
    "slug": "weekend-face",
    "name": "Weekend Face",
    "background": "black",
    "complications": [...],
    "sort_order": 1,
    "created_at": "2026-02-12T...",
    "updated_at": "2026-02-17T..."
}
```

### Complication

A complication is a rectangular text widget positioned absolutely within the 200x200 display area. Each complication references a complication type which provides its data source.

```json
{
    "complication_id": "time",
    "complication_type": "time",
    "type": "text",
    "x": 10, "y": 80, "w": 180, "h": 60,
    "refresh_interval": 60,
    "content": {
        "value": "14:32",
        "family": "sans-serif",
        "size": 48,
        "bold": false,
        "align": "center",
        "color": "white",
        "source": "/crispface/api/sources/time.py"
    },
    "params": {"format": "HH:MM"},
    "sort_order": 0
}
```

### Complication Type

A complication type is an admin-managed template that defines a data source (Python script) and configurable variables. Users select a type when adding a complication to a face, then configure its variables (e.g. city for weather, feeds for calendar).

```json
{
    "id": "weather",
    "name": "Weather",
    "description": "Current weather conditions",
    "script": "weather.py",
    "variables": [
        {"name": "city", "label": "City", "type": "text", "default": "Derby"}
    ]
}
```

The script runs as a CGI endpoint in `api/sources/` and returns `{"value": "..."}`.

### Watch

A watch represents a physical Watchy device. It holds an ordered list of face IDs, WiFi network credentials (up to 5), and a timezone.

```json
{
    "id": "8ed6a0db4ca82b36",
    "name": "Wrist Watch",
    "face_ids": ["f65dc7a50fa31c67", "251de1bf052f2805"],
    "wifi_networks": [
        {"ssid": "HomeWifi", "password": "secret123"}
    ],
    "timezone": "Europe/London"
}
```

---

## API Endpoints

All endpoints return JSON. Python endpoints are routed through `router.php`.

### Authentication

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `login.py` | POST | None | Login with `{username, password}`, sets session cookie |
| `logout.py` | POST | None | Clears session cookie |
| `session.py` | GET | None | Returns `{authenticated, user, role}` |

### User Management (Admin Only)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `users.py` | GET | Admin | List users (safe fields: id, username, role, created_at) |
| `users.py` | POST | Admin | Create user `{username, password, role}` — generates API token, creates data dirs |
| `user.py?id=` | DELETE | Admin | Delete user and their data (cannot delete self) |

### Face Management

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `faces.py` | GET | Auth | List all faces for current user |
| `faces.py` | POST | Auth | Create face `{name}` or duplicate `{duplicate_from, name, watch_id}` |
| `face.py?id=` | GET | Auth | Get single face |
| `face.py?id=` | POST | Auth | Update face (name, background, complications) |
| `face.py?id=` | DELETE | Auth | Delete face (also removes from watches) |

### Watch Management

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `watches.py` | GET | Auth | List all watches (auto-creates default if none) |
| `watches.py` | POST | Auth | Create watch `{name}` |
| `watch.py?id=` | GET | Auth | Get single watch |
| `watch.py?id=` | POST | Auth | Update watch (name, face_ids, wifi_networks, timezone) |
| `watch.py?id=` | DELETE | Auth | Delete watch |

### Complication Types

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `complications.py` | GET | Auth | List all complication types |
| `complications.py` | POST | Admin | Create new type `{name}` |
| `complication.py?id=` | GET | Auth | Get type with script source |
| `complication.py?id=` | POST | Admin | Update type (name, description, variables, script_source) |
| `complication.py?id=` | DELETE | Admin | Delete type and its script |

### Firmware Sync

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `watch_faces.py?watch_id=` | GET | Bearer | Returns resolved faces for firmware |

### Build

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `build_firmware.php?env=&watch_id=` | GET | None | Build firmware, returns manifest |

### Complication Data Sources (`sources/`)

Source scripts are Python CGI scripts that return `{"value": "..."}`. They are called by `watch_faces.py` during sync to resolve server-side complication values.

| Source | Parameters | Description |
|--------|-----------|-------------|
| `time.py` | `format` (HH:MM, HH:MM:SS, 12h, date, full) | Current time (editor preview) |
| `weather.py` | `city` | Weather via Open-Meteo API (15-min cache) |
| `uk_weather.py` | `apikey`, `town`, `display`, `refresh` | UK weather via Met Office DataHub |
| `uk_town_lookup.py` | `q` | UK town search (returns name, county, lat/lon) |
| `ics_calendar.py` | `feeds` (JSON), `events`, `days`, `detail`, `maxchars` | Multi-feed ICS calendar events |
| `battery.py` | `display` (icon, voltage, percentage) | Battery preview for editor |
| `version.py` | — | Reads firmware version from config.h |
| `text.py` | `text` | Echo text (static complications) |
| `sample_word.py` | — | Random word for testing |

---

## Firmware Sync Response

The `watch_faces.py` endpoint resolves all server-side complications and returns a firmware-ready payload:

```json
{
    "success": true,
    "faces": [
        {
            "id": "f65dc7a50fa31c67",
            "name": "Weekend Face",
            "bg": "white",
            "stale": 60,
            "complications": [
                {
                    "id": "time",
                    "type": "time",
                    "x": 10, "y": 80, "w": 180, "h": 60,
                    "stale": 600,
                    "value": "14:32",
                    "font": "sans",
                    "size": 48,
                    "bold": false,
                    "align": "center",
                    "color": "white",
                    "local": true
                }
            ]
        }
    ],
    "fetched_at": 1707900000
}
```

Key transformations from editor format to firmware format:
- Font family: `sans-serif` → `sans`, `serif` → `serif`, `monospace` → `mono`
- `local: true` flag set for time, date, battery, version complications (rendered on-device)
- `stale` computed as minimum refresh_interval across non-local complications (min 300s)
- Server-side complication values fetched from source scripts and injected as `value`

---

## Web Builder

### Face Editor (`editor.html`)

- **200x200 Fabric.js canvas** with 1-bit e-paper simulation (black/white only)
- **Click to select** complications, drag to reposition
- **Resize handles** on selected complications
- **Left panel**: Face settings (name, background, face selector, refresh intervals)
- **Right panel**: Properties for selected complication (position, size, font, content, source)
- **Toolbar**: Add complication (by type), delete selected, save, simulate
- **Text rendering**: Uses canvas 2D API in Fabric.js `after:render` hook with `GFX_METRICS` table for pixel-accurate preview matching firmware rendering
- **Advanced toggle** in properties panel shows complication ID, source URL, and stale interval

### Font System

Text complications use GFX-compatible bitmap fonts for 1-bit rendering:

| Editor Family | Firmware Name | Typeface |
|---------------|---------------|----------|
| `sans-serif` | `sans` | FreeSans |
| `serif` | `serif` | FreeSerif |
| `monospace` | `mono` | FreeMono |

Each family available in regular and bold. Sizes (editor stored value → GFX pt):

| Stored | GFX pt | ~px on watch |
|--------|--------|-------------|
| 8, 12 | 9pt | 13px |
| 16 | 12pt | 17px |
| 24 | 18pt | 25px |
| 48 | 24pt | 33px |
| 60 | 36pt | 51px |
| 72 | 48pt | 67px |

Standard sizes (9/12/18/24pt) from Adafruit GFX library. 36pt and 48pt custom-generated via `firmware/generate_fonts.sh` using FreeFont TTFs bundled in `firmware/tools/fonts/`.

### Pages

| Page | Description |
|------|-------------|
| `index.html` | Login page |
| `faces.html` | Face list with grid/list view, drag-to-reorder, duplicate, delete |
| `editor.html` | Fabric.js face editor with properties panel |
| `complications.html` | Complication type list (admin sees edit/delete, users browse) |
| `complication-edit.html` | Edit type: name, description, variables, Python script (admin only) |
| `watch-edit.html` | Edit watch: name, timezone, WiFi networks, face assignment |
| `flash.html` | Build-on-demand + Web Serial flashing with flash history |
| `users.html` | User management — list, create, delete (admin only) |

### Build & Flash (`flash.html`)

1. Select watch (injects per-watch WiFi config into firmware)
2. Select firmware (CrispFace or Stock Watchy)
3. **Build** — server compiles firmware, auto-bumps version, returns manifest
4. **Flash to Watchy** — ESP Web Tools opens serial port picker and flashes device

Requires Chrome or Edge 89+ (Web Serial API). Flash button must be clicked directly (user gesture required).

---

## Build Pipeline

`api/build_firmware.php` handles web-triggered builds:

1. Auto-bumps patch version in `config.h` (persisted)
2. Injects per-watch WiFi networks, timezone, and API token (temporary)
3. Runs `pio run -e watchy` (or `stock`)
4. Merges binary with `esptool --chip esp32s3 merge-bin`
5. Writes timestamped binary and manifest JSON to `firmware-builds/`
6. Restores `config.h` defaults
7. Cleans up old builds (keeps last 3)
8. Returns `{success, manifest, version, size}` as JSON

---

## Implementation Status

### Implemented (v0.2.x)
- Multi-user with admin/user roles
- Face editor with Fabric.js canvas and pixel-accurate font preview
- Text complications with positioning, fonts (3 families, 6 sizes, bold), alignment, colour
- Complication type system with admin-managed Python source scripts
- Data sources: time, weather (Open-Meteo + Met Office), ICS calendar, battery, version, custom text
- Face CRUD with duplicate, drag-to-reorder, per-watch assignment
- Watch CRUD with per-watch WiFi networks (up to 5), timezone
- Firmware sync endpoint with Bearer auth and server-side value resolution
- Build-on-demand firmware compilation with auto version bump
- Web Serial flashing with flash history log
- Flat-file JSON storage (no database)

### Not Yet Implemented
- Bitmap complications (image import, 1-bit dithering)
- Progress bar complications
- QR code complications
- Custom button actions (configurable per-face)
- OTA firmware updates
- Device sync status dashboard

---

## Revision History

| Version | Date | Notes |
|---------|------|-------|
| 0.1 | 2026-02-06 | Initial draft (combined spec) |
| 0.2 | 2026-02-07 | Removed face stack, canvas type. Added visual builder spec. |
| 0.3 | 2026-02-07 | Added offline behavior, long press support, button-only wake. |
| 0.4 | 2026-02-07 | Added double-tap support, full button action list, default mappings. |
| 0.4.1 | 2026-02-11 | Split into separate web builder and firmware specs. |
| 0.5 | 2026-02-14 | Added implementation status. Web Serial flashing implemented. |
| 0.6 | 2026-02-17 | Complete rewrite to match actual implementation. Replaced speculative API/controls/bindings with real endpoints, storage model, and data flow. Added multi-user, complication types, per-watch WiFi, font system documentation. Removed crisprain-spec.md (redundant combined spec). |
