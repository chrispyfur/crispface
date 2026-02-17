#!/usr/bin/env python3
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from auth import require_admin, load_users, save_users
from config import DATA_DIR
import bcrypt
from datetime import datetime, timezone

user = require_admin()
method = os.environ.get('REQUEST_METHOD', 'GET')

if method == 'GET':
    users = load_users()
    safe_users = []
    for u in users:
        safe_users.append({
            'id': u.get('id'),
            'username': u.get('username'),
            'role': u.get('role', 'user'),
            'created_at': u.get('created_at', '')
        })
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': True, 'users': safe_users}))

elif method == 'POST':
    try:
        body = json.loads(sys.stdin.read())
    except Exception:
        body = {}

    username = str(body.get('username', '')).strip().lower()
    password = str(body.get('password', ''))
    role = str(body.get('role', 'user'))

    if not username or len(username) < 2 or len(username) > 50:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Username must be 2-50 characters'}))
        sys.exit(0)

    import re
    if not re.match(r'^[a-z0-9_-]+$', username):
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Username must be lowercase alphanumeric, hyphens, or underscores'}))
        sys.exit(0)

    if not password or len(password) < 4:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Password must be at least 4 characters'}))
        sys.exit(0)

    if role not in ('admin', 'user'):
        role = 'user'

    users = load_users()
    for u in users:
        if u.get('username') == username:
            print('Content-Type: application/json')
            print()
            print(json.dumps({'success': False, 'error': 'Username already exists'}))
            sys.exit(0)

    # Generate next ID
    max_id = 0
    for u in users:
        try:
            uid = int(u.get('id', 0))
            if uid > max_id:
                max_id = uid
        except (ValueError, TypeError):
            pass

    # Generate API token
    token = 'cf_' + os.urandom(24).hex()

    # Hash password
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()

    new_user = {
        'id': str(max_id + 1),
        'username': username,
        'password_hash': password_hash,
        'api_tokens': [token],
        'role': role,
        'created_at': datetime.now(timezone.utc).isoformat()
    }
    users.append(new_user)
    save_users(users)

    # Create user data directories
    user_dir = os.path.join(DATA_DIR, 'users', username)
    os.makedirs(os.path.join(user_dir, 'faces'), exist_ok=True)
    os.makedirs(os.path.join(user_dir, 'watches'), exist_ok=True)

    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': True, 'user': {
        'id': new_user['id'],
        'username': new_user['username'],
        'role': new_user['role'],
        'created_at': new_user['created_at']
    }}))

else:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Method not allowed'}))
