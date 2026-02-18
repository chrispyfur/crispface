#!/usr/bin/env python3
"""Version data source — returns firmware build version for editor simulation.
On the actual watch, version is rendered locally from config.h."""
import json, os, re

# Read version from config.h
config_path = os.path.join(os.path.dirname(__file__), '..', '..', 'firmware', 'include', 'config.h')
version = '?.?.?'
try:
    with open(config_path, 'r') as f:
        m = re.search(r'#define\s+CRISPFACE_VERSION\s+"([^"]+)"', f.read())
        if m:
            version = m.group(1)
except Exception:
    pass

print('Content-Type: application/json')
print()
print(json.dumps({'value': 'v' + version + ' w0'}))
