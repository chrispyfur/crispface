#!/usr/bin/env python3
"""Battery preview for editor. On the watch, battery renders locally."""
import json, os, urllib.parse

qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
display = qs.get('display', ['icon'])[0]

if display == 'voltage':
    value = '3.9V'
elif display == 'percentage':
    value = '85%'
else:
    value = 'BAT'

print('Content-Type: application/json')
print()
print(json.dumps({'value': value}))
