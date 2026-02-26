# CrispFace Security Audit — 2026-02-25

Thorough review of the full codebase. Findings below, prioritised by severity.

---

## CRITICAL

### 1. `lib/` and `firmware/` directories are web-accessible

No `.htaccess` in `lib/` or `firmware/`. Anyone can browse to:
- `/crispface/lib/secrets.py` — the HMAC signing key used to forge auth cookies for any user
- `/crispface/firmware/include/config.h` — API tokens, WiFi credentials, server URL

**Fix:** Create `lib/.htaccess` and `firmware/.htaccess` with `Require all denied`.

### 2. `build_firmware.php` has zero authentication

No session, cookie, or Bearer token check. Anyone on the internet can:
- Trigger CPU-intensive PlatformIO builds (DoS)
- Build firmware for any user's watch (searches ALL users' directories, line 52-66)
- Expose API tokens and WiFi creds injected into built binaries

**Fix:** Add cookie-based auth check at the top. Scope watch search to authenticated user's directory only.

### 3. `resolve_source()` path traversal in `watch_faces.py`

Lines 34-52: after stripping the `/crispface/api/` prefix, the remaining path goes straight into `os.path.join(API_DIR, rel_path)`. A face with `source: "/crispface/api/../../lib/secrets.py"` would execute any `.py` file in the project tree.

**Fix:** After resolving `script_path`, verify `os.path.realpath(script_path)` starts with `os.path.realpath(API_DIR)`.

### 4. SSRF in `ics_calendar.py`

`fetch_ics()` (line 399-408) calls `urllib.request.urlopen()` on user-supplied URLs with no validation. Allows:
- `file:///etc/passwd` — read local files
- `http://169.254.169.254/` — cloud metadata
- `http://localhost:*/` — internal service probing

**Fix:** Validate scheme is `http`/`https`. Resolve hostname and reject private/loopback IPs (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x).

---

## HIGH

### 5. Auth cookie missing `Secure` flag

`lib/auth.py` line ~138 — cookie is `HttpOnly` + `SameSite=Strict` but no `Secure`. Can be sent over HTTP, allowing MITM interception.

**Fix:** Add `'Secure'` to the cookie parts list.

### 6. `watch_id` unsanitized in `watch_faces.py`

Line 112: `watch_id` from query params goes directly into file path. No hex-only sanitization like `store.py` uses.

**Fix:** Apply `re.sub(r'[^a-f0-9]', '', watch_id)` after reading from query string.

### 7. `exec()` used for secrets loading

`lib/config.py` lines 26-28 use `exec()` to load `secrets.py`. Dangerous anti-pattern — if the file is ever tampered with, arbitrary code runs on every API request.

**Fix:** Replace with `json.load()` on a `secrets.json` file.

### 8. Error details leaked to clients

- `router.php` line 99: returns Python `stderr` in response (file paths, tracebacks)
- `build_firmware.php`: returns full build output in error responses

**Fix:** Remove detail/output from responses. Log to `error_log()` instead.

---

## MEDIUM

### 9. No login rate limiting

`api/login.py` has no rate limiting. Combined with 4-char min password, brute-force is feasible.

**Fix:** Track failed attempts per IP in a flat file. Lock out after 10 failures for 5 minutes.

### 10. Weak minimum password (4 characters)

Set in `api/users.py:49`, `api/user.py:55`, `api/change_password.py:30`, `js/app.js:1258,1399`.

**Fix:** Change to 8 characters in all locations.

### 11. Build process race condition

Concurrent builds can cross-contaminate `config.h`, potentially leaking one user's secrets into another's firmware.

**Fix:** Use `flock()` on a lockfile around the config modification + build + restore.

---

## LOW

### 12. Unnecessary CORS header

`api/sources/sample_word.py` line 9 sets `Access-Control-Allow-Origin: *`. Minimal risk but unnecessary.

**Fix:** Remove the line.

---

## By Design (No Fix Needed)

- **Admin script upload**: Admins can write Python via complication editor. Security boundary = "admin is trusted".
- **WiFi passwords in API responses**: Required for firmware OTA WiFi updates.
- **API tokens stored plaintext**: Needed for Bearer auth comparison.
- **No CSRF tokens**: Mitigated by `SameSite=Strict` cookie. Acceptable for this use case.
- **No session revocation**: Stateless cookies with 1-hour expiry. Acceptable trade-off.

---

## What's Done Well

- User data isolation via sanitised username paths (`config.py`)
- Face/watch ID sanitisation to hex-only in `store.py`
- Complication input validation with type whitelists and bounds checking
- Timing-safe token comparison via `hmac.compare_digest()`
- bcrypt with cost factor 12 for passwords
- `data/.htaccess` blocks web access to JSON storage
- Router script name validation (`[a-z0-9_]+\.py` regex)
- Shell command escaping in build process (`escapeshellarg()`)
- `.git` directory blocked via root `.htaccess`

---

## TODO: Come back and implement these fixes
