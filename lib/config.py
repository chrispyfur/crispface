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

# HMAC cookie signing key — change this in production
SECRET_KEY = 'crispface-secret-change-me-2026'

COOKIE_NAME = 'crispface_auth'
COOKIE_MAX_AGE = 3600  # 1 hour
