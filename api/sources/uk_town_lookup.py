#!/usr/bin/env python3
"""UK town lookup endpoint. Returns matching towns from bundled list.
Accepts ?q=der parameter. Case-insensitive prefix then substring match."""
import sys, os, json, urllib.parse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'lib'))
from config import DATA_DIR

TOWNS_FILE = os.path.join(DATA_DIR, 'uk_towns.json')
MAX_RESULTS = 5

qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
query = qs.get('q', [''])[0].strip().lower()

print('Content-Type: application/json')
print()

if not query:
    print(json.dumps({'matches': []}))
    sys.exit(0)

try:
    with open(TOWNS_FILE, 'r') as f:
        towns = json.load(f)
except Exception:
    print(json.dumps({'matches': [], 'error': 'Could not load towns data'}))
    sys.exit(0)

# Prefix matches first, then substring
prefix = []
substring = []
for t in towns:
    name_lower = t['name'].lower()
    if name_lower.startswith(query):
        prefix.append(t)
    elif query in name_lower:
        substring.append(t)

matches = (prefix + substring)[:MAX_RESULTS]

# Return compact results
result = []
for m in matches:
    result.append({
        'name': m['name'],
        'county': m.get('county', ''),
        'lat': round(m['lat'], 2),
        'lon': round(m['lon'], 2)
    })

print(json.dumps({'matches': result}))
