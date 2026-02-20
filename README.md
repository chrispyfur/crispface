# CrispFace

Watch face editor for the [Watchy](https://watchy.sqfmi.com/) ESP32-S3 e-paper smartwatch.

Design faces in a browser. Flash them to your watch. The watch syncs over WiFi and renders whatever you've built — weather, calendars, time, battery, static text, whatever. All the interesting logic runs on the server. The watch is a thin client.

## How It Works

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

The web editor is a 200x200 pixel canvas that matches the watch display exactly — 1-bit, black and white. You place text complications (time, date, weather, calendar events, etc.), pick fonts and sizes, and save. The server resolves all dynamic data before sending it to the watch, so the firmware stays simple.

The watch wakes on button press, checks if its data is stale, syncs if needed, renders the current face, and goes back to sleep. WiFi is killed as soon as the HTTP response is in. Multiple faces are supported — cycle through them with the side buttons.

## Features

- **Visual face editor** — Fabric.js canvas with pixel-accurate GFX font preview
- **Complication system** — time, date, battery, weather (Open-Meteo + Met Office), ICS calendars, static text, firmware version
- **Calendar alerts** — gentle buzz or insistent privacy-first buzz with configurable pre-alert timing
- **Multiple faces** — design as many as you want, assign them to watches, cycle on-device
- **Per-watch WiFi** — up to 5 networks per watch, firmware scans and connects to the strongest
- **OTA WiFi updates** — change WiFi credentials from the web UI, watch picks them up on next sync
- **Build-on-demand** — compile firmware from the browser, flash via Web Serial (Chrome/Edge)
- **Multi-user** — admin and user roles, flat-file JSON storage, no database
- **Stale data rendering** — server complications past their freshness window render in fake italic

## Complications

| Source | Description | API Key? |
|---|---|---|
| Time / Date | From the watch RTC — no server needed | No |
| Battery | Voltage from ADC | No |
| Weather (Open-Meteo) | Free global weather | No |
| UK Weather (Met Office) | Met Office DataHub, UK towns | Yes |
| ICS Calendar | Multi-feed, per-feed alerts and bold, recurring events | No |
| Text | Static text passthrough | No |
| Version | Firmware version string | No |

Writing new complication sources is straightforward — a Python CGI script that returns `{"value": "..."}`. See [Documentation/complications.md](Documentation/complications.md).

## Tech Stack

- **Server**: PHP 8.4+ (page serving, firmware builds), Python 3 CGI (API endpoints)
- **Editor**: Fabric.js canvas, vanilla JS
- **Storage**: Flat-file JSON — no MySQL, no Redis, no nothing
- **Firmware**: C++ on ESP32-S3, PlatformIO, single `main.cpp` file
- **Fonts**: FreeSans, FreeSerif, FreeMono (regular + bold) at 9/12/18/24/36/48pt

## Project Structure

```
crispface/
├── api/                    # Python CGI + PHP endpoints
│   └── sources/            # Complication data source scripts
├── lib/                    # Shared Python (auth, config, storage)
├── data/                   # Flat-file JSON storage (gitignored)
├── firmware/               # ESP32-S3 PlatformIO project
│   ├── src/main.cpp        # The whole firmware
│   ├── include/            # config.h, fonts.h, custom fonts
│   └── platformio.ini      # Two envs: watchy, stock
├── js/ css/                # Frontend assets
├── Documentation/          # Specs and guides
├── editor.html             # Face editor (main UI)
├── flash.html              # Build & flash
├── faces.html              # Face management
├── complications.html      # Complication management
├── watch-edit.html         # Watch editor
└── users.html              # User management (admin)
```

## Dependencies

**Server:**
- Apache 2.4+ with PHP 8.4+
- Python 3 with `python3-bcrypt`

**Firmware builds:**
- PlatformIO (`pip install platformio`)

**Font generation (optional):**
- `pkg-config`, `libfreetype-dev`, `gcc`

See [Documentation/dependencies.md](Documentation/dependencies.md) for full details.

## Getting Started

1. Clone the repo and point Apache at the `crispface/` directory
2. Copy `firmware/include/config.h.example` to `config.h` and fill in your server URL
3. Create a `data/` directory (the app will populate it)
4. Log in, create a watch, design a face, build and flash

Flashing requires Chrome or Edge (Web Serial API). The watch needs to be in bootloader mode — hold the top-left button while plugging in USB. Use a data cable, not a charge-only one.

## Button Layout

```
[top-left: Sync]        [top-right: Prev face]

[bottom-left: Menu]     [bottom-right: Next face]
```

- **Top-left**: sync from server. Double-press for full display refresh. Long hold for debug screen.
- **Top-right / Bottom-right**: cycle through faces.
- **Bottom-left**: stock Watchy menu (set time, etc.)

## Documentation

- [Web Builder Spec](Documentation/crispface-web-builder-spec.md)
- [Firmware Spec](Documentation/crispface-firmware-spec.md)
- [Developing Complications](Documentation/complications.md)
- [Dependencies](Documentation/dependencies.md)

## Status

Active development. Currently at v0.2.x — text complications are solid, calendar alerts work, build-and-flash pipeline is reliable. Bitmap complications, QR codes, and OTA firmware updates are on the list but not started.

## Licence

This is a personal project. No licence yet.
