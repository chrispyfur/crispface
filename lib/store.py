import os
import json
import re
import time
from datetime import datetime, timezone
from config import DATA_DIR, TYPES_DIR, user_faces_dir, user_watches_dir


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _generate_id():
    return os.urandom(8).hex()


def _slugify(text):
    slug = text.lower().strip()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug.strip('-')
    return slug or 'untitled'


def _face_path(face_id, user):
    # Sanitise: only allow hex chars
    safe_id = re.sub(r'[^a-f0-9]', '', face_id)
    if not safe_id:
        return None
    return os.path.join(user_faces_dir(user), safe_id + '.json')


def get_all_faces(user):
    """Return list of all faces, sorted by sort_order."""
    faces_dir = user_faces_dir(user)
    os.makedirs(faces_dir, exist_ok=True)
    faces = []
    for fname in os.listdir(faces_dir):
        if not fname.endswith('.json'):
            continue
        path = os.path.join(faces_dir, fname)
        try:
            with open(path, 'r') as f:
                faces.append(json.load(f))
        except Exception:
            continue
    faces.sort(key=lambda x: x.get('sort_order', 0))
    return faces


def get_face(face_id, user):
    """Load a single face by ID."""
    path = _face_path(face_id, user)
    if not path or not os.path.exists(path):
        return None
    with open(path, 'r') as f:
        return json.load(f)


def create_face(name, user):
    """Create a new face with defaults."""
    faces_dir = user_faces_dir(user)
    os.makedirs(faces_dir, exist_ok=True)
    face_id = _generate_id()
    now = _now_iso()
    existing = get_all_faces(user)
    max_order = max((f.get('sort_order', 0) for f in existing), default=0)

    face = {
        'id': face_id,
        'slug': _slugify(name),
        'name': name,
        'background': 'black',
        'stale_seconds': 1,
        'controls': [],
        'complications': [],
        'sort_order': max_order + 1,
        'created_at': now,
        'updated_at': now
    }
    _write_face(face_id, face, user)
    return face


def save_face(face_id, data, user):
    """Update an existing face with validated data."""
    existing = get_face(face_id, user)
    if not existing:
        return None

    # Validate and merge allowed fields
    if 'name' in data:
        existing['name'] = str(data['name'])[:100]
    if 'slug' in data:
        existing['slug'] = re.sub(r'[^a-z0-9-]', '', str(data['slug']).lower())[:50] or existing['slug']
    if 'background' in data and data['background'] in ('black', 'white'):
        existing['background'] = data['background']
    if 'stale_seconds' in data:
        existing['stale_seconds'] = max(1, int(data.get('stale_seconds', 1)))
    if 'stale_enabled' in data:
        existing['stale_enabled'] = bool(data['stale_enabled'])

    if 'complications' in data:
        validated = []
        for c in data['complications']:
            vc = _validate_complication(c)
            if vc:
                validated.append(vc)
        existing['complications'] = validated

    existing['updated_at'] = _now_iso()
    _write_face(face_id, existing, user)
    return existing


def delete_face(face_id, user):
    """Delete a face file and remove from all watches."""
    path = _face_path(face_id, user)
    if not path or not os.path.exists(path):
        return False
    os.remove(path)
    # Remove face_id from any watches that reference it
    for watch in get_all_watches(user):
        if face_id in watch.get('face_ids', []):
            watch['face_ids'] = [fid for fid in watch['face_ids'] if fid != face_id]
            _write_watch(watch['id'], watch, user)
    return True


def _validate_complication(c):
    """Validate and sanitise a single complication dict."""
    cid = re.sub(r'[^a-zA-Z0-9_-]', '', str(c.get('complication_id', '')))
    if not cid:
        return None
    ctype = c.get('type', '')
    if ctype not in ('text', 'progress', 'qr', 'bitmap'):
        return None

    content = c.get('content', {})
    validated_content = {
        'value': str(content.get('value', ''))[:200],
        'family': content.get('family', 'sans-serif') if content.get('family') in ('sans-serif', 'serif', 'monospace') else 'sans-serif',
        'size': int(content.get('size', 12)),
        'bold': bool(content.get('bold', False)),
        'italic': bool(content.get('italic', False)),
        'align': content.get('align', 'left') if content.get('align') in ('left', 'center', 'right') else 'left',
        'color': content.get('color', 'white') if content.get('color') in ('white', 'black') else 'white'
    }
    if content.get('source'):
        validated_content['source'] = str(content['source'])[:200]

    # Preserve complication_type reference
    comp_type = re.sub(r'[^a-z0-9-]', '', str(c.get('complication_type', '')))

    result = {
        'complication_id': cid,
        'complication_type': comp_type,
        'type': ctype,
        'x': int(c.get('x', 0)),
        'y': int(c.get('y', 0)),
        'w': int(c.get('w', 80)),
        'h': int(c.get('h', 40)),
        'stale_seconds': max(1, int(c.get('stale_seconds', 1))),
        'stale_enabled': bool(c.get('stale_enabled', True)),
        'border_width': max(0, min(5, int(c.get('border_width', 0)))),
        'border_radius': max(0, min(20, int(c.get('border_radius', 0)))),
        'border_padding': max(0, min(20, int(c.get('border_padding', 0)))),
        'padding_top': max(0, min(50, int(c.get('padding_top', 0)))),
        'padding_left': max(0, min(50, int(c.get('padding_left', 0)))),
        'content': validated_content,
        'sort_order': int(c.get('sort_order', 0))
    }

    # Validate params (key-value pairs for source URL)
    raw_params = c.get('params', {})
    if isinstance(raw_params, dict) and raw_params:
        validated_params = {}
        for k, v in raw_params.items():
            key = re.sub(r'[^a-zA-Z0-9_-]', '', str(k))[:50]
            if key:
                validated_params[key] = str(v)[:2000]
        if validated_params:
            result['params'] = validated_params

    return result


def _write_face(face_id, face, user):
    """Write face data to JSON file."""
    path = _face_path(face_id, user)
    if not path:
        return
    with open(path, 'w') as f:
        json.dump(face, f, indent=4)


# ---- Complication Types ----

SOURCES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api', 'sources')


def _type_path(type_id):
    safe_id = re.sub(r'[^a-z0-9-]', '', type_id)
    if not safe_id:
        return None
    return os.path.join(TYPES_DIR, safe_id + '.json')


def get_all_types():
    """Return list of all complication types."""
    os.makedirs(TYPES_DIR, exist_ok=True)
    types = []
    for fname in os.listdir(TYPES_DIR):
        if not fname.endswith('.json'):
            continue
        path = os.path.join(TYPES_DIR, fname)
        try:
            with open(path, 'r') as f:
                types.append(json.load(f))
        except Exception:
            continue
    types.sort(key=lambda x: x.get('name', ''))
    return types


def get_type(type_id):
    """Load a single complication type by ID."""
    path = _type_path(type_id)
    if not path or not os.path.exists(path):
        return None
    with open(path, 'r') as f:
        return json.load(f)


def create_type(name):
    """Create a new complication type with defaults."""
    os.makedirs(TYPES_DIR, exist_ok=True)
    type_id = _slugify(name)
    # Ensure unique ID
    base_id = type_id
    counter = 2
    while os.path.exists(os.path.join(TYPES_DIR, type_id + '.json')):
        type_id = base_id + '-' + str(counter)
        counter += 1

    now = _now_iso()
    ctype = {
        'id': type_id,
        'name': name,
        'description': '',
        'script': type_id + '.py',
        'variables': [],
        'created_at': now,
        'updated_at': now
    }
    _write_type(type_id, ctype)

    # Create an empty source script
    os.makedirs(SOURCES_DIR, exist_ok=True)
    script_path = os.path.join(SOURCES_DIR, type_id + '.py')
    if not os.path.exists(script_path):
        with open(script_path, 'w') as f:
            f.write('#!/usr/bin/env python3\nimport json\n\nprint("Content-Type: application/json")\nprint()\nprint(json.dumps({"value": "Hello"}))\n')

    return ctype


def save_type(type_id, data):
    """Update an existing complication type."""
    existing = get_type(type_id)
    if not existing:
        return None

    if 'name' in data:
        existing['name'] = str(data['name'])[:100]
    if 'description' in data:
        existing['description'] = str(data['description'])[:500]
    if 'variables' in data and isinstance(data['variables'], list):
        validated_vars = []
        for v in data['variables']:
            if isinstance(v, dict) and v.get('name'):
                var_entry = {
                    'name': re.sub(r'[^a-zA-Z0-9_]', '', str(v['name']))[:50],
                    'label': str(v.get('label', v['name']))[:100],
                    'type': re.sub(r'[^a-z]', '', str(v.get('type', 'text')))[:20],
                    'default': str(v.get('default', ''))[:200]
                }
                if v.get('options'):
                    var_entry['options'] = re.sub(r'[^a-zA-Z0-9_,]', '', str(v['options']))[:500]
                validated_vars.append(var_entry)
        existing['variables'] = validated_vars

    # Save script source if provided
    if 'script_source' in data:
        script_path = os.path.join(SOURCES_DIR, existing['script'])
        os.makedirs(SOURCES_DIR, exist_ok=True)
        with open(script_path, 'w') as f:
            f.write(data['script_source'])

    existing['updated_at'] = _now_iso()
    _write_type(type_id, existing)
    return existing


def delete_type(type_id):
    """Delete a complication type and its script."""
    path = _type_path(type_id)
    if not path or not os.path.exists(path):
        return False
    # Load to get script name
    try:
        with open(path, 'r') as f:
            ctype = json.load(f)
        script_path = os.path.join(SOURCES_DIR, ctype.get('script', ''))
        if os.path.exists(script_path):
            os.remove(script_path)
    except Exception:
        pass
    os.remove(path)
    return True


def get_type_script(type_id):
    """Read the Python source for a complication type."""
    ctype = get_type(type_id)
    if not ctype:
        return None
    script_path = os.path.join(SOURCES_DIR, ctype.get('script', ''))
    if not os.path.exists(script_path):
        return ''
    with open(script_path, 'r') as f:
        return f.read()


def _write_type(type_id, ctype):
    path = _type_path(type_id)
    if not path:
        return
    with open(path, 'w') as f:
        json.dump(ctype, f, indent=4)


# ---- Watches ----

def _watch_path(watch_id, user):
    safe_id = re.sub(r'[^a-f0-9]', '', watch_id)
    if not safe_id:
        return None
    return os.path.join(user_watches_dir(user), safe_id + '.json')


def get_all_watches(user):
    """Return list of all watches, sorted by name."""
    watches_dir = user_watches_dir(user)
    os.makedirs(watches_dir, exist_ok=True)
    watches = []
    for fname in os.listdir(watches_dir):
        if not fname.endswith('.json'):
            continue
        path = os.path.join(watches_dir, fname)
        try:
            with open(path, 'r') as f:
                watches.append(json.load(f))
        except Exception:
            continue
    watches.sort(key=lambda x: x.get('name', '').lower())
    return watches


def get_watch(watch_id, user):
    """Load a single watch by ID."""
    path = _watch_path(watch_id, user)
    if not path or not os.path.exists(path):
        return None
    with open(path, 'r') as f:
        return json.load(f)


def create_watch(name, user):
    """Create a new watch with defaults."""
    watches_dir = user_watches_dir(user)
    os.makedirs(watches_dir, exist_ok=True)
    watch_id = _generate_id()
    now = _now_iso()
    watch = {
        'id': watch_id,
        'name': str(name)[:100].strip() or 'Untitled Watch',
        'face_ids': [],
        'wifi_networks': [],
        'timezone': 'Europe/London',
        'created_at': now,
        'updated_at': now
    }
    _write_watch(watch_id, watch, user)
    return watch


def save_watch(watch_id, data, user):
    """Update an existing watch with validated data."""
    existing = get_watch(watch_id, user)
    if not existing:
        return None

    if 'name' in data:
        existing['name'] = str(data['name'])[:100].strip() or existing['name']

    if 'face_ids' in data and isinstance(data['face_ids'], list):
        validated = []
        for fid in data['face_ids']:
            safe = re.sub(r'[^a-f0-9]', '', str(fid))
            if safe and safe not in validated:
                validated.append(safe)
        existing['face_ids'] = validated

    if 'timezone' in data:
        tz = str(data['timezone']).strip()[:50]
        if tz:
            existing['timezone'] = tz

    if 'wifi_networks' in data and isinstance(data['wifi_networks'], list):
        validated_nets = []
        for net in data['wifi_networks'][:5]:  # max 5 networks
            if not isinstance(net, dict):
                continue
            ssid = str(net.get('ssid', '')).strip()[:32]
            password = str(net.get('password', '')).strip()[:63]
            if ssid:
                validated_nets.append({'ssid': ssid, 'password': password})
        existing['wifi_networks'] = validated_nets

    existing['updated_at'] = _now_iso()
    _write_watch(watch_id, existing, user)
    return existing


def delete_watch(watch_id, user):
    """Delete a watch (does not delete faces)."""
    path = _watch_path(watch_id, user)
    if not path or not os.path.exists(path):
        return False
    os.remove(path)
    return True


def _write_watch(watch_id, watch, user):
    path = _watch_path(watch_id, user)
    if not path:
        return
    with open(path, 'w') as f:
        json.dump(watch, f, indent=4)
