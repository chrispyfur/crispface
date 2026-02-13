#!/usr/bin/env python3
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from auth import load_users, check_password, make_cookie, set_cookie_header

method = os.environ.get('REQUEST_METHOD', 'GET')

if method != 'POST':
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Method not allowed'}))
    sys.exit(0)

# Read POST body
try:
    body = json.loads(sys.stdin.read())
except Exception:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Invalid JSON'}))
    sys.exit(0)

username = str(body.get('username', '')).strip()
password = str(body.get('password', ''))

users = load_users()
matched = None
for u in users:
    if u['username'] == username:
        matched = u
        break

if not matched or not check_password(password, matched['password_hash']):
    print('Content-Type: application/json')
    print()
    print(json.dumps({'success': False, 'error': 'Invalid username or password'}))
    sys.exit(0)

cookie_val = make_cookie(username)
print(set_cookie_header(cookie_val))
print('Content-Type: application/json')
print()
print(json.dumps({'success': True, 'user': username}))
