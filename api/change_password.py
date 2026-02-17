#!/usr/bin/env python3
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from auth import require_auth, load_users, save_users, check_password
import bcrypt

user = require_auth()
method = os.environ.get('REQUEST_METHOD', 'GET')

if method != 'POST':
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Method not allowed'}))
    sys.exit(0)

try:
    body = json.loads(sys.stdin.read())
except Exception:
    body = {}

current_password = str(body.get('current_password', ''))
new_password = str(body.get('new_password', ''))

if not current_password:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Current password is required'}))
    sys.exit(0)

if not new_password or len(new_password) < 4:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'New password must be at least 4 characters'}))
    sys.exit(0)

users = load_users()
target = None
for u in users:
    if u.get('username') == user:
        target = u
        break

if not target:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'User not found'}))
    sys.exit(0)

if not check_password(current_password, target.get('password_hash', '')):
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Current password is incorrect'}))
    sys.exit(0)

target['password_hash'] = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt(rounds=12)).decode()
save_users(users)

print('Content-Type: application/json')
print()
print(json.dumps({'success': True}))
