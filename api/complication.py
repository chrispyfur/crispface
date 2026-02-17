#!/usr/bin/env python3
import sys, os, json, urllib.parse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from auth import require_auth, require_admin
from store import get_type, save_type, delete_type, get_type_script

method = os.environ.get('REQUEST_METHOD', 'GET')
if method in ('POST', 'DELETE'):
    require_admin()
else:
    require_auth()
qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
type_id = qs.get('id', [''])[0]

if not type_id:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Missing id parameter'}))
    sys.exit(0)

if method == 'GET':
    ctype = get_type(type_id)
    if not ctype:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Type not found'}))
    else:
        script_source = get_type_script(type_id)
        ctype['script_source'] = script_source or ''
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': True, 'type': ctype}))

elif method == 'POST':
    try:
        body = json.loads(sys.stdin.read())
    except Exception:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Invalid JSON'}))
        sys.exit(0)

    result = save_type(type_id, body)
    if not result:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Type not found'}))
    else:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': True, 'type': result}))

elif method == 'DELETE':
    ok = delete_type(type_id)
    print('Content-Type: application/json')
    print()
    if ok:
        print(json.dumps({'success': True}))
    else:
        print(json.dumps({'success': False, 'error': 'Type not found'}))

else:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Method not allowed'}))
