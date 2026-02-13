#!/usr/bin/env python3
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from auth import require_auth
from store import get_all_watches, create_watch

user = require_auth()
method = os.environ.get('REQUEST_METHOD', 'GET')

if method == 'GET':
    watches = get_all_watches(user)
    # Auto-create a default watch if user has none
    if len(watches) == 0:
        default = create_watch('My Watchy', user)
        watches = [default]
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': True, 'watches': watches}))

elif method == 'POST':
    try:
        body = json.loads(sys.stdin.read())
    except Exception:
        body = {}
    name = str(body.get('name', 'Untitled Watch')).strip() or 'Untitled Watch'
    watch = create_watch(name, user)
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': True, 'watch': watch}))

else:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Method not allowed'}))
