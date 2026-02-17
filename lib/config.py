import os
import re

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
FACES_DIR = os.path.join(DATA_DIR, 'faces')
WATCHES_DIR = os.path.join(DATA_DIR, 'watches')
TYPES_DIR = os.path.join(DATA_DIR, 'complications')


def user_faces_dir(username):
    safe = re.sub(r'[^a-zA-Z0-9_-]', '', username)
    return os.path.join(DATA_DIR, 'users', safe, 'faces')


def user_watches_dir(username):
    safe = re.sub(r'[^a-zA-Z0-9_-]', '', username)
    return os.path.join(DATA_DIR, 'users', safe, 'watches')
USERS_FILE = os.path.join(DATA_DIR, 'users.json')

BASE_URL = '/crispface'
SITE_NAME = 'CrispFace'

# HMAC cookie signing key — loaded from gitignored secrets file
_secrets_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'secrets.py')
if os.path.exists(_secrets_path):
    with open(_secrets_path) as _f:
        exec(_f.read())
else:
    raise RuntimeError('lib/secrets.py not found — copy lib/secrets.py.example and set a strong SECRET_KEY')

COOKIE_NAME = 'crispface_auth'
COOKIE_MAX_AGE = 3600  # 1 hour
