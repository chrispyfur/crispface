#!/usr/bin/env python3
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from auth import clear_cookie_header

print(clear_cookie_header())
print('Content-Type: application/json')
print()
print(json.dumps({'success': True}))
