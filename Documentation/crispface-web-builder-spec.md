# CrispFace Web Builder & Server Specification v0.4

The server-side platform for designing, managing, and serving watch faces to Watchy ESP32 devices.

---

## Overview

The CrispFace web platform is the brain of the system. It provides a visual editor for building watch faces, manages device registrations, resolves dynamic data bindings, and serves face definitions to devices via a REST API.

```
┌─────────────────┐         ┌─────────────┐
│  CrispRain API  │ ◄─────► │  Web Admin  │
│     (PHP)       │         │  (Builder)  │
└────────┬────────┘         └─────────────┘
         │
         │ JSON over HTTP
         ▼
   Watchy Devices
```

**Design Principles:**
- Complexity belongs in the web builder, not firmware
- The server resolves all dynamic data before sending to devices
- Faces are defined as JSON - the shared contract between server and firmware

---

## Core Concepts

### Face

A face is a full-screen layout containing zero or more complications. Faces are created and edited in the web builder, stored in the database, and served to devices on sync.

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

A complication is a rectangular widget positioned absolutely within the 200x200 display area.

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

## Data Bindings

Complications can reference dynamic data via template syntax. The server is responsible for resolving server-side bindings before sending data to devices.

### Server-Resolved Bindings

These are resolved by the server at sync time:

```json
{
  "type": "text",
  "content": {
    "value": "{{weather.temp}}°C"
  }
}
```

| Namespace | Examples |
|-----------|----------|
| `weather` | `weather.temp`, `weather.condition`, `weather.icon` |
| `calendar` | `calendar.next`, `calendar.countdown` |
| `steps` | `steps.today`, `steps.goal_pct` |
| `custom` | User-defined variables via API |

### Device-Resolved Bindings (passed through)

The server does **not** resolve these - they are passed through to the device for local resolution:

| Namespace | Examples |
|-----------|----------|
| `time` | `time.hour`, `time.minute`, `time.weekday`, `time.date` |
| `battery` | `battery.pct` |

---

## API Endpoints

### Sync (Primary Endpoint)

**POST** `/api/crispface/sync`

The main device communication endpoint. Devices call this on wake to report status and receive updates.

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

Devices call this on first boot to register with the server.

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

### Face Definition

**GET** `/api/crispface/face/{face_id}`

Returns full face JSON. Used when switching faces.

### Authentication

- Devices authenticate with a pre-shared token via `Authorization: Bearer <token>` header
- Server validates token, returns 401 if invalid
- Tokens are managed in the web admin interface

### Protocol Versioning

All device requests include header:

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

## Controls Configuration

Button actions are configured per-face in the web builder. Each button supports three input types:

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

### Controls JSON Schema

```json
{
  "controls": {
    "btn1": {
      "action": "menu",
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

---

## Web Builder

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

## Future Considerations

- **Downloadable fonts**: Fetch additional fonts from server
- **OTA updates**: Firmware updates pushed via server
- **Step counter integration**: Report steps to server, display in complications
- **Web Serial firmware flasher**: Browser-based initial device provisioning (see firmware spec)

---

## Revision History

| Version | Date | Notes |
|---------|------|-------|
| 0.1 | 2026-02-06 | Initial draft (combined spec) |
| 0.2 | 2026-02-07 | Removed face stack, canvas type. Added visual builder spec. Clarified time handling on-device. Reduced fonts to minimal set. |
| 0.3 | 2026-02-07 | Added: offline behavior, long press support, inherit from stock Watchy firmware, button-only wake. |
| 0.4 | 2026-02-07 | Added: double-tap support, full button action list, default mappings, button config in web builder, multi-device support. |
| 0.4.1 | 2026-02-11 | Split into separate web builder and firmware specs. |
