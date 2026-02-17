#!/usr/bin/env python3
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from auth import require_auth
from store import get_all_faces, create_face, duplicate_face

user = require_auth()
method = os.environ.get('REQUEST_METHOD', 'GET')

if method == 'GET':
    faces = get_all_faces(user)
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': True, 'faces': faces}))

elif method == 'POST':
    try:
        body = json.loads(sys.stdin.read())
    except Exception:
        body = {}
    dup_from = body.get('duplicate_from', '').strip()
    name = str(body.get('name', 'Untitled Face')).strip() or 'Untitled Face'

    if dup_from:
        watch_id = body.get('watch_id', '').strip() or None
        face = duplicate_face(dup_from, name, user, watch_id=watch_id)
        if not face:
            print('Content-Type: application/json')
            print()
            print(json.dumps({'success': False, 'error': 'Source face not found'}))
            sys.exit(0)
    else:
        face = create_face(name, user)

    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': True, 'face': face}))

else:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Method not allowed'}))
