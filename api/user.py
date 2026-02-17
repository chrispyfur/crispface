#!/usr/bin/env python3
import sys, os, json, urllib.parse, shutil
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from auth import require_admin, load_users, save_users
from config import DATA_DIR

admin_user = require_admin()
method = os.environ.get('REQUEST_METHOD', 'GET')
qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
target_id = qs.get('id', [''])[0]

if not target_id:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Missing id parameter'}))
    sys.exit(0)

if method == 'POST':
    import bcrypt
    try:
        body = json.loads(sys.stdin.read())
    except Exception:
        body = {}

    users = load_users()
    target = None
    for u in users:
        if u.get('id') == target_id:
            target = u
            break

    if not target:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'User not found'}))
        sys.exit(0)

    is_self = target.get('username') == admin_user

    # Update role (admin can't change own role)
    if 'role' in body:
        if is_self:
            print('Content-Type: application/json')
            print()
            print(json.dumps({'success': False, 'error': 'Cannot change your own role'}))
            sys.exit(0)
        new_role = str(body['role'])
        if new_role not in ('admin', 'user'):
            new_role = 'user'
        target['role'] = new_role

    # Update password
    if body.get('password'):
        new_password = str(body['password'])
        if len(new_password) < 4:
            print('Content-Type: application/json')
            print()
            print(json.dumps({'success': False, 'error': 'Password must be at least 4 characters'}))
            sys.exit(0)
        target['password_hash'] = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt(rounds=12)).decode()

    save_users(users)

    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': True, 'user': {
        'id': target.get('id'),
        'username': target.get('username'),
        'role': target.get('role', 'user')
    }}))

elif method == 'DELETE':
    users = load_users()
    target = None
    for u in users:
        if u.get('id') == target_id:
            target = u
            break

    if not target:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'User not found'}))
        sys.exit(0)

    if target.get('username') == admin_user:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Cannot delete yourself'}))
        sys.exit(0)

    username = target.get('username')
    users = [u for u in users if u.get('id') != target_id]
    save_users(users)

    # Remove user data directory
    import re
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '', username)
    user_dir = os.path.join(DATA_DIR, 'users', safe_name)
    if os.path.isdir(user_dir):
        shutil.rmtree(user_dir)

    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': True}))

else:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Method not allowed'}))
