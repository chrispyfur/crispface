#!/usr/bin/env python3
import sys, os, json, urllib.parse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from auth import require_auth
from store import get_face, save_face, delete_face

user = require_auth()
method = os.environ.get('REQUEST_METHOD', 'GET')
qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
face_id = qs.get('id', [''])[0]

if not face_id:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Missing id parameter'}))
    sys.exit(0)

if method == 'GET':
    face = get_face(face_id, user)
    if not face:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Face not found'}))
    else:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': True, 'face': face}))

elif method == 'POST':
    try:
        body = json.loads(sys.stdin.read())
    except Exception:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Invalid JSON'}))
        sys.exit(0)

    result = save_face(face_id, body, user)
    if not result:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Face not found'}))
    else:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': True, 'face': result}))

elif method == 'DELETE':
    ok = delete_face(face_id, user)
    print('Content-Type: application/json')
    print()
    if ok:
        print(json.dumps({'success': True}))
    else:
        print(json.dumps({'success': False, 'error': 'Face not found'}))

else:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Method not allowed'}))
