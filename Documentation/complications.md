# Developing Complications

This guide covers how to create new complication types, how the refresh/polling system works, and how the alert/notification system works.

## Overview

A **complication** is a data-driven element on a watch face. Each complication has a **type** (template defining its behaviour) and a **source** (a Python CGI script that returns a value). The server resolves dynamic values before sending them to the watch — the firmware only renders pre-resolved text strings and locally-available values (time, date, battery, version).

## Creating a New Complication Type

### 1. Create the Template JSON

Add a file to `data/complications/<id>.json`:

```json
{
    "id": "my-complication",
    "name": "My Complication",
    "description": "A brief description of what this does.",
    "script": "my_complication.py",
    "variables": [
        {
            "name": "city",
            "label": "City",
            "type": "text",
            "default": "London"
        },
        {
            "name": "units",
            "label": "Units",
            "type": "select",
            "options": "metric,imperial",
            "default": "metric"
        }
    ]
}
```

The `id` is a kebab-case slug used as the filename and as `complication_type` in face data. The `script` field points to a Python file in `api/sources/`. The `created_at` and `updated_at` timestamps are set automatically.

### 2. Create the Source Script

Add a file to `api/sources/<script>.py`:

```python
#!/usr/bin/env python3
import json, os, urllib.parse

qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
city = qs.get('city', ['London'])[0]
units = qs.get('units', ['metric'])[0]

# ... fetch or compute the value ...

print('Content-Type: application/json')
print()
print(json.dumps({'value': 'My result text'}))
```

**Requirements:**
- Read parameters from `QUERY_STRING` (each variable `name` becomes a query param key)
- Output a `Content-Type: application/json` header, a blank line, then a JSON body
- The JSON **must** contain a `"value"` key with the display string
- No restart needed — files are loaded on each request

### 3. Done

The new complication type appears in the editor's type dropdown immediately. Users can add it to faces and configure its variables in the properties panel.

### Alternative: Use the Web UI

You can also create and edit complications at `/crispface/complication-edit.html?id=<id>`. This lets you edit the name, description, variables, and Python script source in-browser.

## Template JSON Schema

| Field | Required | Description |
|---|---|---|
| `id` | yes | Kebab-case slug (e.g. `"uk-weather"`). Used as filename and `complication_type`. |
| `name` | yes | Human-readable display name. |
| `description` | yes | One-sentence description shown in the UI. |
| `script` | no | Python script filename in `api/sources/`. Omit for pure static types (like `text`). |
| `variables` | yes | Array of variable definitions (may be empty `[]`). |

### Variable Definitions

Each variable in the `variables` array:

| Field | Required | Description |
|---|---|---|
| `name` | yes | Parameter key. Becomes a query param passed to the source script. `[a-zA-Z0-9_]` only. |
| `label` | yes | Human-readable label shown in the properties panel. |
| `type` | no | Widget type. Omit for plain text input. |
| `options` | conditional | Comma-separated values. Required when `type` is `"select"`. |
| `default` | no | Default value when a new complication is added to a face. |
| `min` | no | Minimum value (for `type: "stepper"`). |
| `max` | no | Maximum value (for `type: "stepper"`). |

### Variable Widget Types

| `type` value | Widget | Notes |
|---|---|---|
| *(omitted)* | Text input | Default. Free-form text. |
| `"select"` | Dropdown | Requires `options` field (comma-separated). |
| `"stepper"` | Number +/- buttons | Use `min` and `max` to constrain. |
| `"checkbox"` | Checkbox | Value is `"true"` or `"false"`. |
| `"feeds"` | Feed list editor | Special. Used only by `ics-calendar` for its multi-feed UI. |

### The `refresh` Variable (Special)

If a variable is named `refresh`, its value is automatically synced to the complication's `refresh_interval` field. This controls how often the watch re-fetches the value from the server. The value is in **minutes**.

Example from `uk-weather.json`:
```json
{"name": "refresh", "label": "Refresh (mins)", "type": "select", "options": "1,15,30,60,120,360", "default": "30"}
```

## Source Script Response Format

### Basic Response

```json
{"value": "20°C Clear"}
```

The `value` string is what gets rendered on the watch face. It can contain newlines (`\n`) for multi-line text.

### Response with Alerts

Calendar and other time-aware sources can include an `alerts` array to trigger watch notifications:

```json
{
    "value": "10:30 Team standup\n14:00 Client call",
    "alerts": [
        {
            "sec": 1800,
            "text": "Team standup\n@ Meeting Room 1",
            "time": "10:30",
            "ins": false,
            "uid": "a3f9b2c1d4e5f607",
            "pre": 300
        }
    ]
}
```

| Field | Type | Description |
|---|---|---|
| `sec` | int | Seconds from now until the event starts. |
| `text` | string | Notification text (max 59 chars). Newlines supported. |
| `time` | string | Event time as `"HH:MM"` for the notification header. |
| `ins` | bool | `true` for insistent (continuous buzz), `false` for gentle. |
| `uid` | string | Unique ID for deduplication (16 hex chars recommended). |
| `pre` | int | Pre-alert offset in seconds (e.g. 300 = 5 minutes before event). |

Alerts are sorted nearest-first and capped at 10 per API response. The `uid` field is used server-side to deduplicate alerts across faces that share the same source — it is stripped before sending to the firmware.

### Special Value Prefixes

Source values can contain special byte markers that control firmware rendering:

| Byte | Char code | Effect |
|---|---|---|
| `\x01` | 1 | Filled circle prefix (busy all-day event marker) |
| `\x02` | 2 | Open circle prefix (free/transparent all-day event) |
| `\x03` | 3 | Bold marker — renders the line in bold font |
| `\x04` | 4 | Day divider — renders as an ornamental `———◆———` line |

These are primarily used by `ics_calendar.py` but any source can use them.

### Weather Icon Values

If a source returns a value starting with `icon:`, the firmware renders a weather icon instead of text:

- `"icon:0"` — Clear/sunny
- `"icon:3"` — Partly cloudy
- `"icon:12"` — Light rain
- `"icon:28:32"` — Thunder icon at 32px size

Format: `icon:<weather_code>` or `icon:<weather_code>:<size_px>`

Weather codes follow the Met Office significantWeatherCode scheme (0-30).

## How Refresh / Polling Works

### In the Editor (Live Preview)

When a complication has a `source` URL, the editor polls it for live preview:

1. On face load, `startLivePolling()` calls `pollSource()` for every complication with a source
2. `pollSource()` builds the URL from `source` + `params` as query string
3. Fetches immediately, then repeats at `refresh_interval` minutes
4. When a variable changes in the properties panel, `repollSource()` cancels the timer and starts a fresh poll (immediate for dropdowns, 800ms debounce for text inputs)

### On the Watch (Firmware Sync)

The firmware periodically syncs all faces from the server:

1. `watch_faces.py` resolves each complication's source script, passing `params` as query string
2. Each resolved value gets a `stale` field: `refresh_interval * 60` seconds (or `-1` for static/local types)
3. The firmware's sync interval is set to the **minimum** stale value across all server complications (floor of 60 seconds)
4. If no server complications exist, sync interval is 86400 seconds (daily)
5. Values that exceed their stale time are rendered in **fake italic** (pixel X-shear) to indicate staleness
6. Users can always force a manual sync by pressing top-left

### Local vs Server Complications

| Type | Resolved by | `local` field | `stale` field | Source script called? |
|---|---|---|---|---|
| `time` | Firmware (RTC) | `true` | `-1` | No (editor preview only) |
| `date` | Firmware (RTC) | `true` | `-1` | No (editor preview only) |
| `battery` | Firmware (ADC) | `true` | `-1` | No (editor preview only) |
| `version` | Firmware (config) | `true` | `-1` | No (editor preview only) |
| `text` | Static value | `false` | `-1` | No |
| Everything else | Server at sync time | `false` | `refresh_interval * 60` | Yes |

## How the Alert / Notification System Works

### Server Side

1. Source scripts (e.g. `ics_calendar.py`) return an `alerts` array alongside `value`
2. `watch_faces.py` passes alerts through in the API response, deduplicating by `uid` across all faces
3. The `uid` is stripped before sending — it's only used server-side

### Firmware Side

For each alert received during sync, the firmware creates **two** `CfAlert` entries:

1. **Pre-alert** — fires `pre` seconds before the event. Shows "In about N minutes" header.
2. **Event-time alert** — fires at the exact event time. Shows "At HH:MM" header.

Up to 20 alert slots are available (10 events × 2 alerts each).

### Alert Check

On each wake (every 60 seconds), the firmware checks all unfired alerts. If an alert's fire time falls within a 60-second window of the current time, it triggers:

- **Gentle** (`ins: false`): triple buzz → 3s pause → triple buzz, then display notification
- **Insistent** (`ins: true`): privacy-first — continuous pulsing buzz (up to 2 minutes) until any button press, then reveal notification text

### Notification Screen

A full-screen notification with:
- Rounded-rect border (10px margin, 2px width, 8px radius)
- Context-aware header: "In about N minutes" (pre-alert) or "At HH:MM" (event-time)
- Event text centred in middle area (FreeSans 12pt)
- "Press any button" hint at bottom

Any button press dismisses the notification and returns to the normal watch face.

### Configuring Alerts (ICS Calendar Example)

Users configure alerts per calendar feed in the editor's feed modal:

- **Alert mode**: None / Gentle / Insistent
- **Alert before**: 5 / 15 / 30 minutes

These are stored in the feed JSON as `alert_mode` and `alert_before`, passed through the source as query params, and returned as the `ins` and `pre` fields in the alert response.

## Existing Complication Types Reference

| ID | Name | Source | Local? | Notes |
|---|---|---|---|---|
| `time` | Time | `time.py` | Yes | `HH:MM` from RTC |
| `date` | Date | `time.py` | Yes | `"Dow DD Mon"` from RTC |
| `battery` | Battery | `battery.py` | Yes | Icon, percentage, or voltage |
| `version` | Version | `version.py` | Yes | `"vX.X.X"` from config |
| `text` | Text | *(none)* | No | Static text, no source |
| `weather` | Weather | `weather.py` | No | Open-Meteo, free, no API key |
| `uk-weather` | UK Weather | `uk_weather.py` | No | Met Office DataHub, requires API key |
| `ics-calendar` | ICS Calendar | `ics_calendar.py` | No | Multi-feed with alerts |
| `sample-word` | Sample Word | `sample_word.py` | No | Random word (testing) |

## Caching

Sources should implement their own caching to avoid excessive API calls. The pattern used by existing sources:

```python
CACHE_DIR = os.path.join(DATA_DIR, 'cache')
CACHE_MAX_AGE = 900  # seconds

def get_cached(key):
    cache_file = os.path.join(CACHE_DIR, 'prefix_{}.json'.format(key))
    if os.path.exists(cache_file):
        with open(cache_file, 'r') as f:
            cached = json.load(f)
        if time.time() - cached.get('_fetched', 0) < CACHE_MAX_AGE:
            return cached
    return None

def save_cache(key, data):
    os.makedirs(CACHE_DIR, exist_ok=True)
    data['_fetched'] = time.time()
    cache_file = os.path.join(CACHE_DIR, 'prefix_{}.json'.format(key))
    with open(cache_file, 'w') as f:
        json.dump(data, f)
```

Cache files are stored in `data/cache/` (gitignored). Recommended cache durations:
- Weather: 15 minutes
- Calendar feeds: 60 seconds
- Static lookups: 24 hours
