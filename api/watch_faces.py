#!/usr/bin/env python3
"""Watch faces API endpoint.
GET /crispface/api/watch_faces.py?watch_id=<id>
Auth: Authorization: Bearer <token>

Returns resolved face JSON with server-side complication values pre-fetched
and local complications (time, date, battery) flagged for on-device rendering.
"""
import sys, os, json, time, urllib.parse, subprocess

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from auth import get_user_from_bearer
from config import DATA_DIR

API_DIR = os.path.dirname(os.path.abspath(__file__))

# Local complication types — rendered on-device from RTC/ADC
LOCAL_TYPES = {'time', 'date', 'battery', 'version'}


def respond(data, status='200 OK'):
    print('Status: ' + status)
    print('Content-Type: application/json')
    print()
    print(json.dumps(data))
    sys.exit(0)


def error(msg, status='400 Bad Request'):
    respond({'success': False, 'error': msg}, status)


def resolve_source(source, params):
    """Execute a source script and return the resolved value string."""
    # source is a URL path like /crispface/api/sources/sample_word.py
    # Strip the /crispface/api/ prefix to get the relative script path
    prefix = '/crispface/api/'
    if not source.startswith(prefix):
        return None

    # Split off any query string already in the source URL
    if '?' in source:
        source_path, existing_qs = source.split('?', 1)
    else:
        source_path, existing_qs = source, ''

    rel_path = source_path[len(prefix):]
    script_path = os.path.join(API_DIR, rel_path)

    if not os.path.exists(script_path):
        return None

    # Build query string from params + any existing qs in source URL
    qs_parts = {}
    if existing_qs:
        for k, v in urllib.parse.parse_qs(existing_qs, keep_blank_values=True).items():
            qs_parts[k] = v[0] if len(v) == 1 else v

    if params:
        qs_parts.update(params)

    query_string = urllib.parse.urlencode(qs_parts)

    env = os.environ.copy()
    env['QUERY_STRING'] = query_string
    env['REQUEST_METHOD'] = 'GET'

    try:
        result = subprocess.run(
            ['/usr/bin/python3', script_path],
            capture_output=True,
            text=True,
            timeout=15,
            cwd=os.path.dirname(script_path),
            env=env,
        )
        if result.returncode != 0:
            return None

        # Parse CGI output — skip headers, get body
        output = result.stdout
        if '\n\n' in output:
            body = output.split('\n\n', 1)[1]
        elif '\r\n\r\n' in output:
            body = output.split('\r\n\r\n', 1)[1]
        else:
            return None

        data = json.loads(body)
        return data
    except Exception:
        return None


# ---- Auth ----

username = get_user_from_bearer()
if not username:
    error('Not authenticated', '401 Unauthorized')

# ---- Parse query ----

qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
watch_id = qs.get('watch_id', [''])[0].strip()
if not watch_id:
    error('Missing watch_id parameter')

# ---- Load watch ----

watches_dir = os.path.join(DATA_DIR, 'users', username, 'watches')
watch_file = os.path.join(watches_dir, watch_id + '.json')
if not os.path.exists(watch_file):
    error('Watch not found', '404 Not Found')

with open(watch_file, 'r') as f:
    watch = json.load(f)

face_ids = watch.get('face_ids', [])
if not face_ids:
    error('Watch has no faces')

# ---- Load and resolve faces ----

faces_dir = os.path.join(DATA_DIR, 'users', username, 'faces')
faces = []

for face_id in face_ids:
    face_file = os.path.join(faces_dir, face_id + '.json')
    if not os.path.exists(face_file):
        continue

    with open(face_file, 'r') as f:
        face = json.load(f)

    if face.get('disabled', False):
        continue

    resolved_complications = []
    for comp in face.get('complications', []):
        content = comp.get('content', {})
        comp_type = comp.get('complication_type', '')
        comp_id = comp.get('complication_id', '')
        is_local = comp_type in LOCAL_TYPES or comp_id in LOCAL_TYPES

        # Resolve server-side complication values
        value = content.get('value', '')
        source = content.get('source', '')
        params = comp.get('params', {})

        source_alerts = []
        if source and not is_local:
            resolved = resolve_source(source, params)
            if resolved is not None:
                if isinstance(resolved, dict):
                    value = resolved.get('value', value)
                    source_alerts = resolved.get('alerts', [])
                else:
                    value = resolved

        # Map font family names
        family = content.get('family', 'sans-serif')
        if family == 'monospace':
            font = 'mono'
        elif family == 'serif':
            font = 'serif'
        else:
            font = 'sans'

        # Use complication_id as type if complication_type is empty and it's local
        effective_type = comp_type if comp_type else (comp_id if is_local else '')

        # refresh_interval is in minutes; firmware needs seconds
        # Only dynamic sourced complications need refresh; static text/local get -1
        has_source = bool(comp.get('content', {}).get('source'))
        is_static = comp_type == 'text' or not has_source
        refresh_mins = comp.get('refresh_interval', 30) if not is_static else -1
        stale_val = refresh_mins * 60 if refresh_mins > 0 else -1

        rc = {
            'id': comp.get('complication_id', ''),
            'type': effective_type,
            'x': comp.get('x', 0),
            'y': comp.get('y', 0),
            'w': comp.get('w', 0),
            'h': comp.get('h', 0),
            'stale': stale_val,
            'value': value,
            'font': font,
            'size': content.get('size', 16),
            'bold': content.get('bold', False),
            'align': content.get('align', 'left'),
            'color': content.get('color', 'black'),
            'bw': comp.get('border_width', 0),
            'br': comp.get('border_radius', 0),
            'bp': comp.get('border_padding', 0),
            'pt': comp.get('padding_top', 0),
            'pl': comp.get('padding_left', 0),
        }

        if is_local:
            rc['local'] = True
            if params:
                rc['params'] = params

        if source_alerts:
            rc['alerts'] = source_alerts

        resolved_complications.append(rc)

    faces.append({
        'id': face.get('id', ''),
        'name': face.get('name', ''),
        'bg': face.get('background', 'white'),
        'stale': 60,  # face-level stale in seconds (1 min)
        'complications': resolved_complications,
    })

# Deduplicate alerts across all faces/complications
seen_uids = set()
for face in faces:
    for comp in face['complications']:
        if 'alerts' not in comp:
            continue
        deduped = []
        for alert in comp['alerts']:
            uid = alert.pop('uid', None)
            if uid:
                if uid in seen_uids:
                    continue
                seen_uids.add(uid)
            deduped.append(alert)
        if deduped:
            comp['alerts'] = deduped
        else:
            del comp['alerts']

respond({
    'success': True,
    'faces': faces,
    'wifi': watch.get('wifi_networks', []),
    'fetched_at': int(time.time()),
})
