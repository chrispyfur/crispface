#!/usr/bin/env python3
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from auth import get_user_from_request, get_user_role

user = get_user_from_request()

print('Content-Type: application/json')
print()
if user:
    print(json.dumps({'authenticated': True, 'user': user, 'role': get_user_role(user)}))
else:
    print(json.dumps({'authenticated': False}))
