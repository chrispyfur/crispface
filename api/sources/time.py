#!/usr/bin/env python3
"""Time data source — returns current time for editor simulation.
On the actual watch, time is rendered locally. This endpoint exists
so the editor can simulate a live watch face."""
import json, urllib.parse, os
from datetime import datetime, timezone, timedelta

qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
layout = qs.get('layout', ['horizontal'])[0]

now = datetime.now(timezone(timedelta(hours=0)))  # UTC

if layout == 'vertical':
    value = now.strftime('%H') + '\n' + now.strftime('%M')
else:
    value = now.strftime('%H:%M')

print('Content-Type: application/json')
print()
print(json.dumps({'value': value}))
