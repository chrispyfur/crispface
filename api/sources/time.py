#!/usr/bin/env python3
"""Time data source — returns current time for editor simulation.
On the actual watch, time is rendered locally. This endpoint exists
so the editor can simulate a live watch face."""
import json, urllib.parse, os
from datetime import datetime, timezone, timedelta

qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
fmt = qs.get('format', ['HH:MM'])[0]

now = datetime.now(timezone(timedelta(hours=0)))  # UTC

if fmt == 'HH:MM:SS':
    value = now.strftime('%H:%M:%S')
elif fmt == 'HH:MM':
    value = now.strftime('%H:%M')
elif fmt == '12h':
    value = now.strftime('%I:%M %p')
elif fmt == 'date':
    value = now.strftime('%a %d %b')
elif fmt == 'full':
    value = now.strftime('%H:%M %a %d %b')
else:
    value = now.strftime('%H:%M')

print('Content-Type: application/json')
print()
print(json.dumps({'value': value}))
