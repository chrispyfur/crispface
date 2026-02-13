#!/usr/bin/env python3
import sys, os, json, urllib.parse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from auth import require_auth
from store import get_watch, save_watch, delete_watch

user = require_auth()
method = os.environ.get('REQUEST_METHOD', 'GET')
qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
watch_id = qs.get('id', [''])[0]

if not watch_id:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Missing id parameter'}))
    sys.exit(0)

if method == 'GET':
    watch = get_watch(watch_id, user)
    if not watch:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Watch not found'}))
    else:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': True, 'watch': watch}))

elif method == 'POST':
    try:
        body = json.loads(sys.stdin.read())
    except Exception:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Invalid JSON'}))
        sys.exit(0)

    result = save_watch(watch_id, body, user)
    if not result:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Watch not found'}))
    else:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': True, 'watch': result}))

elif method == 'DELETE':
    ok = delete_watch(watch_id, user)
    print('Content-Type: application/json')
    print()
    if ok:
        print(json.dumps({'success': True}))
    else:
        print(json.dumps({'success': False, 'error': 'Watch not found'}))

else:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Method not allowed'}))
