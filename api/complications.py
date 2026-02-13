#!/usr/bin/env python3
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from auth import require_auth
from store import get_all_types, create_type

user = require_auth()
method = os.environ.get('REQUEST_METHOD', 'GET')

if method == 'GET':
    types = get_all_types()
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': True, 'types': types}))

elif method == 'POST':
    try:
        body = json.loads(sys.stdin.read())
    except Exception:
        body = {}
    name = str(body.get('name', 'New Type')).strip() or 'New Type'
    ctype = create_type(name)
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': True, 'type': ctype}))

else:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Method not allowed'}))
