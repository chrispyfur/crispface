#!/usr/bin/env python3
"""Date data source — returns formatted date for editor simulation.
On the actual watch, date is rendered locally from the RTC.
Accepts a 'format' param using PHP date-style characters:
  D=Mon  l=Monday  d=01  j=1  M=Jan  F=January  m=01  n=1  Y=2026  y=26
Any other character is treated as a literal."""
import json, urllib.parse, os
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo as _ZoneInfo
except ImportError:
    _ZoneInfo = None

qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
fmt = qs.get('format', ['D j M'])[0]

now = datetime.now(timezone.utc)
tz_param = qs.get('tz', [''])[0]
if tz_param and _ZoneInfo:
    try:
        now = now.astimezone(_ZoneInfo(tz_param))
    except Exception:
        pass

# Translate PHP date chars to strftime directives
PHP_TO_STRFTIME = {
    'D': '%a',
    'l': '%A',
    'd': '%d',
    'j': '%-d',
    'M': '%b',
    'F': '%B',
    'm': '%m',
    'n': '%-m',
    'Y': '%Y',
    'y': '%y',
}

strftime_fmt = ''
for ch in fmt:
    if ch in PHP_TO_STRFTIME:
        strftime_fmt += PHP_TO_STRFTIME[ch]
    elif ch == '%':
        strftime_fmt += '%%'
    else:
        strftime_fmt += ch

value = now.strftime(strftime_fmt)

print('Content-Type: application/json')
print()
print(json.dumps({'value': value}))
