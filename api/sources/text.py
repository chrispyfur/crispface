#!/usr/bin/env python3
import json, os, urllib.parse

qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
text = qs.get('text', ['Hello'])[0]

print('Content-Type: application/json')
print()
print(json.dumps({'value': text}))
