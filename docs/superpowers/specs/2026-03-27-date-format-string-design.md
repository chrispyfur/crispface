# Date Complication Format String

**Date:** 2026-03-27

## Overview

Extend the date complication to accept a PHP-style format string, giving users control over which date parts are displayed and how they're arranged. A reference key is shown in the editor so users can construct their own format strings.

## Supported Format Characters

| Char | Meaning | Example |
|------|---------|---------|
| `D` | Short weekday | Mon |
| `l` | Full weekday | Monday |
| `d` | Day of month, zero-padded | 03 |
| `j` | Day of month, no padding | 3 |
| `M` | Short month name | Mar |
| `F` | Full month name | March |
| `m` | Month number, zero-padded | 03 |
| `n` | Month number, no padding | 3 |
| `Y` | 4-digit year | 2026 |
| `y` | 2-digit year | 26 |

Any other character in the format string is treated as a literal (spaces, `/`, `-`, `,`, etc.).

**Default format:** `D j M` — produces "Mon 27 Mar", matching the previous hardcoded output.

## Changes

### 1. `data/complications/date.json`

- Add a `format` variable (type `text`, default `D j M`).
- Add a `help` string: `D=Mon l=Monday d=01 j=1 M=Jan F=January m=01 n=1 Y=2026 y=26` — displayed as hint text beneath the format field in the properties panel.
- Change `script` from `time.py` to `date.py`.

### 2. `api/sources/date.py` (new file)

New CGI script for editor preview. Reads the `format` query param, translates PHP-style characters to Python `strftime` directives char-by-char, then returns `{"value": now.strftime(translated_format)}`.

PHP → Python mapping:

| PHP | strftime |
|-----|----------|
| `D` | `%a` |
| `l` | `%A` |
| `d` | `%d` |
| `j` | `%-d` |
| `M` | `%b` |
| `F` | `%B` |
| `m` | `%m` |
| `n` | `%-m` |
| `Y` | `%Y` |
| `y` | `%y` |

Unrecognised characters are appended as literals (escaped for strftime with `%%` if they are `%`).

### 3. `firmware/src/main.cpp`

In `resolveLocal()`, the `"date"` branch replaces the hardcoded `snprintf` with a format-string parser:

- Reads `params["format"]`, falls back to `"D j M"` if absent or empty.
- Adds `fullDays[]` and `fullMons[]` static arrays for `l` and `F` chars.
- Iterates the format string character-by-character, appending to a `char buf[32]`.
- Year is computed as `currentTime.Year + 1970`.

## Backwards Compatibility

Faces that have no `params.format` (all existing faces) fall back to `"D j M"`, producing identical output to the current hardcoded behaviour. No migration needed.
