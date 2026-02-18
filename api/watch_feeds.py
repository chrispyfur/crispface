#!/usr/bin/env python3
import sys, os, json, urllib.parse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from auth import require_auth
from store import get_watch, get_face, _write_face

user = require_auth()
method = os.environ.get('REQUEST_METHOD', 'GET')
qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
watch_id = qs.get('watch_id', [''])[0]

if not watch_id:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Missing watch_id parameter'}))
    sys.exit(0)

watch = get_watch(watch_id, user)
if not watch:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Watch not found'}))
    sys.exit(0)

if method == 'GET':
    # Collect all calendar feeds across all faces on this watch
    feeds_map = {}  # url -> {url, name, count}
    for face_id in watch.get('face_ids', []):
        face = get_face(face_id, user)
        if not face:
            continue
        for comp in face.get('complications', []):
            if comp.get('complication_type') != 'ics-calendar':
                continue
            params = comp.get('params', {})
            feeds_json = params.get('feeds', '[]')
            try:
                feeds = json.loads(feeds_json)
            except Exception:
                continue
            for feed in feeds:
                url = feed.get('url', '')
                if not url:
                    continue
                if url in feeds_map:
                    feeds_map[url]['count'] += 1
                else:
                    feeds_map[url] = {
                        'url': url,
                        'name': feed.get('name', 'Calendar'),
                        'count': 1
                    }

    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': True, 'feeds': feeds_map}))

elif method == 'POST':
    try:
        body = json.loads(sys.stdin.read())
    except Exception:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Invalid JSON'}))
        sys.exit(0)

    action = body.get('action', '')
    feed_url = body.get('feed_url', '')

    if action != 'delete_all' or not feed_url:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Invalid action or missing feed_url'}))
        sys.exit(0)

    removed = 0
    for face_id in watch.get('face_ids', []):
        face = get_face(face_id, user)
        if not face:
            continue
        changed = False
        for comp in face.get('complications', []):
            if comp.get('complication_type') != 'ics-calendar':
                continue
            params = comp.get('params', {})
            feeds_json = params.get('feeds', '[]')
            try:
                feeds = json.loads(feeds_json)
            except Exception:
                continue
            original_len = len(feeds)
            feeds = [f for f in feeds if f.get('url') != feed_url]
            if len(feeds) < original_len:
                removed += original_len - len(feeds)
                params['feeds'] = json.dumps(feeds)
                changed = True
        if changed:
            _write_face(face_id, face, user)

    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': True, 'removed': removed}))

else:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Method not allowed'}))
