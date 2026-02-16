# CrispFace Specification v0.4

A web-driven watch face and complication system for Watchy ESP32.

---

## Overview

CrispFace treats the Watchy as a thin client. The watch periodically fetches face definitions and complication data from a server endpoint, renders them locally, and cycles through a list of configured faces.

```
┌─────────────┐         ┌─────────────────┐         ┌─────────────┐
│   Watchy    │ ◄─────► │  CrispRain API  │ ◄─────► │  Web Admin  │
│  (Client)   │  HTTP   │  (Python/PHP)   │         │  (Builder)  │
└─────────────┘         └─────────────────┘         └─────────────┘
```

**Design Principles:**
- Watch is a dumb renderer - all logic lives on server
- Complexity belongs in the web builder, not firmware
- Minimal firmware footprint for portability to future hardware
- **Build on stock Watchy firmware** - inherit WiFi menu, settings, timezone, not reinvent

---

## Core Concepts

### Face

A face is a full-screen layout containing zero or more complications. The watch maintains a list of faces and cycles through them via button press.

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

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Human-readable name |
| `background` | `"black"` \| `"white"` | Base fill color |
| `stale_seconds` | int | Max age before forced refresh (0 = manual only) |
| `complications` | array | List of complication instances |
| `controls` | object | Button mapping overrides (optional) |

### Complication

A complication is a rectangular widget with content. Complications are positioned absolutely within the 200x200 display.

```json
{
  "type": "text",
  "id": "time-main",
  "x": 10,
  "y": 80,
  "w": 180,
  "h": 60,
  "stale_seconds": 60,
  "content": {...}
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Complication type (see types below) |
| `id` | string | Unique within face |
| `x`, `y` | int | Top-left position (0-199) |
| `w`, `h` | int | Width and height in pixels |
| `stale_seconds` | int | Override face-level staleness (optional) |
| `content` | object | Type-specific content payload |

---

## Complication Types

### `text`

Renders text with optional formatting.

```json
{
  "type": "text",
  "content": {
    "value": "14:32",
    "font": "sans-24",
    "align": "center",
    "color": "white"
  }
}
```

| Field | Values |
|-------|--------|
| `font` | `sans-16`, `sans-24`, `sans-48`, `mono-16` |
| `align` | `left`, `center`, `right` |
| `color` | `black`, `white` |

**Baked-in Fonts (3 total):**
- `sans` - Clean sans-serif (sizes: 16, 24, 48)
- `mono` - Monospace for data (size: 16)
- `icons` - Icon glyphs (size: 24)

### `bitmap`

Renders a 1-bit bitmap image.

```json
{
  "type": "bitmap",
  "content": {
    "data": "base64-encoded-1bit-bitmap"
  }
}
```

- Bitmap data is base64-encoded 1-bit packed pixels
- Row-major, MSB first
- Dimensions inferred from `w` and `h`
- Web builder provides image converter and pixel editor

### `progress`

Horizontal or vertical progress bar.

```json
{
  "type": "progress",
  "content": {
    "value": 0.75,
    "direction": "horizontal",
    "style": "filled"
  }
}
```

| Field | Values |
|-------|--------|
| `direction` | `horizontal`, `vertical` |
| `style` | `filled`, `segmented` |

### `qr`

Renders a QR code.

```json
{
  "type": "qr",
  "content": {
    "data": "https://example.com/link"
  }
}
```

---

## Face Cycling

The watch maintains an ordered list of faces. No stack, no modals - just simple cycling.

| Button Action | Behavior |
|---------------|----------|
| `next_face` | Move to next face in list |
| `prev_face` | Move to previous face in list |

Face list is configured server-side and fetched on sync.

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

Button actions are configurable per-face via the web builder. Each button supports three input types:

- **Short press** - Quick tap
- **Long press** - Hold for 1 second
- **Double tap** - Two quick taps within 300ms

### Button Layout

```
[btn1]          [btn3]
   (top-left)      (top-right)

[btn2]          [btn4]
   (bottom-left)   (bottom-right)
```

### Available Actions

| Action | Description |
|--------|-------------|
| `none` | Do nothing (explicitly disabled) |
| `refresh` | Force refresh current face |
| `next_face` | Cycle to next face |
| `prev_face` | Cycle to previous face |
| `menu` | Open stock Watchy settings menu |
| `invert` | Toggle display color inversion (dark mode) |
| `custom` | HTTP POST to specified endpoint |

### Default Button Mapping

| Button | Short | Long | Double |
|--------|-------|------|--------|
| btn1 (top-left) | `menu` | `none` | `none` |
| btn2 (bottom-left) | `refresh` | `none` | `none` |
| btn3 (top-right) | `next_face` | `none` | `none` |
| btn4 (bottom-right) | `prev_face` | `none` | `none` |

### JSON Schema

```json
{
  "controls": {
    "btn1": {
      "action": "menu",
      "long_action": "none",
      "double_action": "none"
    },
    "btn2": {
      "action": "refresh",
      "long_action": "invert",
      "double_action": "none"
    },
    "btn3": {
      "action": "next_face",
      "long_action": "none",
      "double_action": "none"
    },
    "btn4": {
      "action": "custom",
      "endpoint": "/api/action/toggle-lights",
      "long_action": "custom",
      "long_endpoint": "/api/action/all-lights-off",
      "double_action": "none",
      "vibrate": 50
    }
  }
}
```

### Custom Action Fields

For `custom` actions, specify the endpoint:
- `endpoint` - URL for short press custom action
- `long_endpoint` - URL for long press custom action
- `double_endpoint` - URL for double tap custom action

### Haptic Feedback

`vibrate`: Duration in milliseconds (0 = none). Applies to all actions on that button.

### Menu Mode

When the `menu` action is triggered, control passes to the **stock Watchy menu system**. Button mappings in menu mode are inherited from the stock firmware:

| Button | Stock Menu Function |
|--------|---------------------|
| btn1 | Back / Exit |
| btn2 | Down |
| btn3 | Up |
| btn4 | Select / Enter |

CrispFace button mappings only apply when displaying a CrispFace face. Exiting the menu returns to the current face with CrispFace mappings restored.

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

This enables home automation triggers, toggles, etc.

### Haptic Feedback

```json
{
  "controls": {
    "btn1": {"action": "refresh", "vibrate": 50}
  }
}
```

`vibrate`: Duration in milliseconds (0 = none).

---

## API Endpoints

### Watch Faces (Implemented)

**GET** `/api/watch_faces.py?watch_id=<id>`

Auth: `Authorization: Bearer <token>`

Returns all faces for a watch with server-side complications pre-resolved. Local complications (time, date, battery) are flagged with `local: true` for on-device rendering.

Response:
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
          "id": "time", "type": "time",
          "x": 10, "y": 10, "w": 180, "h": 60,
          "stale": 600, "value": "20:42",
          "font": "mono", "size": 48, "bold": false,
          "align": "center", "color": "black",
          "local": true
        }
      ]
    }
  ],
  "fetched_at": 1707900000
}
```

### Planned Endpoints (Not Yet Implemented)

- **POST** `/api/crispface/sync` — granular complication-level updates
- **POST** `/api/crispface/register` — device self-registration
- **GET** `/api/crispface/face/{face_id}` — individual face fetch

---

## Data Bindings

Complications can reference dynamic data via template syntax.

### Server-Resolved Bindings

```json
{
  "type": "text",
  "content": {
    "value": "{{weather.temp}}°C"
  }
}
```

Server resolves these before sending:

| Namespace | Examples |
|-----------|----------|
| `weather` | `weather.temp`, `weather.condition`, `weather.icon` |
| `calendar` | `calendar.next`, `calendar.countdown` |
| `steps` | `steps.today`, `steps.goal_pct` |
| `custom` | User-defined variables via API |

### Device-Resolved Bindings

These are resolved on the watch:

| Namespace | Examples |
|-----------|----------|
| `time` | `time.hour`, `time.minute`, `time.weekday`, `time.date` |
| `battery` | `battery.pct` |

---

## Web Builder

The CrispRain web interface provides a full visual editor with multi-device support.

### Face Editor

- **200x200 canvas** with e-paper simulation (black/white, no antialiasing)
- **Drag existing complications** to reposition
- **Drag to create** new complications (draw rectangle to set bounds)
- **Resize handles** on selected complications
- **Property panel** for editing content, font, staleness, etc.
- **Face list** sidebar for managing multiple faces
- **Preview mode** showing simulated watch display

### Button Configuration

- **Visual button mapper** - Click button in preview to configure
- **Action dropdowns** for short, long, and double tap
- **Endpoint input** for custom actions
- **Vibration slider** (0-200ms)
- **Reset to defaults** button

### Complication Library

- Pre-built templates (time, date, weather, battery, etc.)
- Drag from library onto canvas
- Templates come with sensible defaults

### Bitmap Tools

- **Image importer**: Upload PNG/JPG, converts to 1-bit bitmap
- **Pixel editor**: Toggle individual pixels for custom icons
- **Dithering options**: Floyd-Steinberg, threshold, etc.
- **Icon library**: Common icons pre-converted

### Multi-Device Support

- **Device list** - All registered watches with status
- **Device groups** - Assign faces to multiple devices at once
- **Per-device overrides** - Different button mappings or complications per watch
- **Sync status** - Last seen, battery level, firmware version per device
- **Bulk actions** - Push face to all devices, update all tokens

### Device Management

- Register new devices via token
- Rename devices for easy identification
- Per-device face list assignment
- Deregister/remove devices
- View sync history and errors

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

## Authentication

- Device uses pre-shared token stored in NVS (non-volatile storage)
- Token included in `Authorization: Bearer <token>` header
- Token provisioned via USB serial on first flash
- Server validates token, returns 401 if invalid

---

## Protocol Versioning

All requests include header:

```
X-CrispFace-Version: 0.4
```

Server responds with error if version too old:

```json
{
  "error": "version_mismatch",
  "minimum_version": "0.3",
  "message": "Please update firmware"
}
```

---

## Example Face

```json
{
  "id": "daily-driver",
  "name": "Daily Driver",
  "background": "black",
  "stale_seconds": 900,
  "complications": [
    {
      "type": "text",
      "id": "time",
      "x": 10,
      "y": 60,
      "w": 180,
      "h": 50,
      "stale_seconds": 60,
      "content": {
        "value": "{{time.hour}}:{{time.minute}}",
        "font": "sans-48",
        "align": "center",
        "color": "white"
      }
    },
    {
      "type": "text",
      "id": "date",
      "x": 10,
      "y": 120,
      "w": 180,
      "h": 24,
      "content": {
        "value": "{{time.weekday}}, {{time.date}}",
        "font": "sans-24",
        "align": "center",
        "color": "white"
      }
    },
    {
      "type": "bitmap",
      "id": "weather-icon",
      "x": 10,
      "y": 10,
      "w": 32,
      "h": 32,
      "stale_seconds": 1800,
      "content": {
        "data": "base64-bitmap-data-here"
      }
    },
    {
      "type": "text",
      "id": "weather-temp",
      "x": 50,
      "y": 14,
      "w": 50,
      "h": 24,
      "stale_seconds": 1800,
      "content": {
        "value": "{{weather.temp}}°",
        "font": "sans-24",
        "align": "left",
        "color": "white"
      }
    },
    {
      "type": "progress",
      "id": "battery",
      "x": 160,
      "y": 10,
      "w": 30,
      "h": 12,
      "content": {
        "value": "{{battery.pct_decimal}}",
        "direction": "horizontal",
        "style": "segmented"
      }
    }
  ],
  "controls": {
    "btn1": {"action": "menu", "long_action": "none", "double_action": "none"},
    "btn2": {"action": "refresh", "long_action": "invert", "double_action": "none", "vibrate": 30},
    "btn3": {"action": "next_face", "long_action": "none", "double_action": "none"},
    "btn4": {"action": "custom", "endpoint": "/api/action/toggle-lights", "long_action": "custom", "long_endpoint": "/api/action/all-lights-off", "double_action": "none", "vibrate": 50}
  }
}
```

---

## Implementation Status

### Implemented
- Web face editor with Fabric.js canvas (200x200, text complications, fonts, alignment)
- Face and watch CRUD (flat-file JSON storage)
- Complication sources: time, date, weather, sample word
- Watch faces API with server-side resolution and Bearer auth
- ESP32-S3 firmware: text rendering, face cycling, auto-sync, SPIFFS caching
- Build-on-demand with auto version bump
- Web Serial flashing (Chrome/Edge)

### Not Yet Implemented
- Bitmap, progress bar, and QR code complication types
- Custom button actions (HTTP POST from watch)
- Long press / double tap button actions
- Device registration and multi-device management
- OTA firmware updates
- Downloadable fonts
- Step counter integration
- Configurable WiFi (currently hardcoded in firmware)

---

## Future Considerations

- **Bitmap complications**: 1-bit images in face layouts
- **Downloadable fonts**: Fetch additional fonts from server
- **OTA updates**: Firmware updates via server
- **Multi-device**: Same config across multiple watches
- **Configurable WiFi**: Currently hardcoded in firmware
- **Step counter integration**: Report steps to server, display in complications

---

## Revision History

| Version | Date | Notes |
|---------|------|-------|
| 0.1 | 2026-02-06 | Initial draft |
| 0.2 | 2026-02-07 | Removed face stack, canvas type. Added visual builder spec. Clarified time handling on-device. Reduced fonts to minimal set. |
| 0.3 | 2026-02-07 | Added: offline behavior (cached face), long press support, inherit from stock Watchy firmware, button-only wake (no tilt, no timed wake). |
| 0.4 | 2026-02-07 | Added: double-tap support, full button action list (none, refresh, next/prev_face, menu, invert, custom), default button mappings, button config in web builder, multi-device support. |
| 0.5 | 2026-02-14 | Updated API endpoints to match implementation. Added implementation status and roadmap. |
