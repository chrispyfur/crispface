import os
import json
import hmac
import hashlib
import base64
import time
import http.cookies
import bcrypt
from config import SECRET_KEY, COOKIE_NAME, COOKIE_MAX_AGE, USERS_FILE


def _sign(payload_b64):
    """HMAC-SHA256 signature of base64-encoded payload."""
    return hmac.new(
        SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256
    ).hexdigest()


def make_cookie(username):
    """Create a signed auth cookie value."""
    payload = json.dumps({
        'user': username,
        'exp': int(time.time()) + COOKIE_MAX_AGE
    })
    payload_b64 = base64.b64encode(payload.encode()).decode()
    sig = _sign(payload_b64)
    return payload_b64 + '.' + sig


def verify_cookie(cookie_val):
    """Verify signed cookie. Returns username or None."""
    if not cookie_val or '.' not in cookie_val:
        return None
    parts = cookie_val.split('.', 1)
    payload_b64, sig = parts[0], parts[1]
    expected = _sign(payload_b64)
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(base64.b64decode(payload_b64))
    except Exception:
        return None
    if payload.get('exp', 0) < time.time():
        return None
    return payload.get('user')


def get_user_from_bearer():
    """Check Authorization: Bearer <token> header against user api_tokens.
    Returns username or None."""
    auth = os.environ.get('HTTP_AUTHORIZATION', '')
    if not auth.startswith('Bearer '):
        return None
    token = auth[7:].strip()
    if not token:
        return None
    users = load_users()
    for user in users:
        for t in user.get('api_tokens', []):
            if hmac.compare_digest(t, token):
                return user.get('username')
    return None


def get_user_from_request():
    """Read HTTP_COOKIE env var, verify auth cookie, return username or None."""
    cookie_str = os.environ.get('HTTP_COOKIE', '')
    cookies = http.cookies.SimpleCookie()
    try:
        cookies.load(cookie_str)
    except Exception:
        return None
    morsel = cookies.get(COOKIE_NAME)
    if not morsel:
        return None
    return verify_cookie(morsel.value)


def require_auth():
    """Check auth; if not authenticated, return 401 JSON and exit."""
    user = get_user_from_request()
    if not user:
        print('Content-Type: application/json')
        print()
        print(json.dumps({'success': False, 'error': 'Not authenticated'}))
        raise SystemExit(0)
    return user


def check_password(password, password_hash):
    """Verify password against bcrypt hash."""
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def load_users():
    """Load users from JSON file."""
    if not os.path.exists(USERS_FILE):
        return []
    with open(USERS_FILE, 'r') as f:
        return json.load(f)


def set_cookie_header(value, max_age=None):
    """Return Set-Cookie header string."""
    if max_age is None:
        max_age = COOKIE_MAX_AGE
    parts = [
        COOKIE_NAME + '=' + value,
        'Path=/crispface',
        'HttpOnly',
        'SameSite=Strict',
        'Max-Age=' + str(max_age)
    ]
    return 'Set-Cookie: ' + '; '.join(parts)


def clear_cookie_header():
    """Return Set-Cookie header to clear the auth cookie."""
    return set_cookie_header('', max_age=0)
