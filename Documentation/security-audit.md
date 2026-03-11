# CrispFace Security Audit — v1.0 (2026-03-11)

Full security review of the CrispFace codebase at v1.0 release. This supersedes the initial audit from 2026-02-25.

---

## Critical

### 1. `lib/` and `firmware/` directories are web-accessible

No `.htaccess` in `lib/` or `firmware/`. Anyone can browse to:
- `/crispface/lib/secrets.py` — the HMAC signing key used to forge auth cookies for any user
- `/crispface/firmware/include/config.h` — API tokens, WiFi credentials, server URL

**Fix:** Create `lib/.htaccess` and `firmware/.htaccess` containing `Require all denied`.

### 2. `build_firmware.php` has no authentication

No session, cookie, or Bearer token check. Any unauthenticated request can:
- Trigger CPU-intensive PlatformIO builds (denial of service)
- Build firmware for any user's watch (searches across all users' directories)
- Expose API tokens and WiFi credentials baked into compiled binaries

**Fix:** Add session-based auth at the top of the file. Scope watch search to the authenticated user's directory only.

### 3. `resolve_source()` path traversal in `watch_faces.py`

Lines 34-52: after stripping the `/crispface/api/` prefix, the remaining path goes into `os.path.join(API_DIR, rel_path)` and then `subprocess.run()`. A face with `source: "/crispface/api/../../lib/secrets.py"` would execute any `.py` file reachable from the project tree.

**Fix:** After resolving `script_path`, verify `os.path.realpath(script_path)` starts with `os.path.realpath(API_DIR)`:
```python
script_path = os.path.realpath(os.path.join(API_DIR, rel_path))
if not script_path.startswith(os.path.realpath(API_DIR) + os.sep):
    return None
```

### 4. `watch_id` unsanitised in `watch_faces.py`

Line 112: `watch_id` from query params goes directly into a file path without hex-only sanitisation (unlike `store.py` which strips to `[a-f0-9]`). A crafted `watch_id` with `../` could traverse to `data/users.json` and leak password hashes and API tokens.

**Fix:** Apply the same sanitisation used in `store.py`:
```python
safe_id = re.sub(r'[^a-f0-9]', '', watch_id)
```

### 5. SSRF in `ics_calendar.py`

`fetch_ics()` (line ~420) calls `urllib.request.urlopen()` on user-supplied URLs with no scheme validation. Allows:
- `file:///etc/passwd` — read local files
- `http://169.254.169.254/` — cloud metadata endpoints
- `http://localhost:*/` — internal service probing

**Fix:** Validate URL scheme is `http` or `https` only. Optionally reject private/loopback IP ranges:
```python
from urllib.parse import urlparse
parsed = urlparse(url)
if parsed.scheme not in ('http', 'https'):
    return None
```

---

## High

### 6. Auth cookie missing `Secure` flag

`lib/auth.py` line ~138: cookie is `HttpOnly` + `SameSite=Strict` but no `Secure`. The cookie can be sent over HTTP, allowing MITM interception.

**Fix:** Add `'Secure'` to the cookie parts list.

### 7. `innerHTML` XSS in `app.js`

`setStatus()` (line ~1592) uses `innerHTML` with server-returned strings including `data.error` and `data.version`. If an attacker controls the build output or a malicious server response is reflected, HTML injection is possible.

**Fix:** Use `statusEl.textContent = msg` instead of `innerHTML`, or escape all interpolated values with the existing `escHtml()` function before passing to `setStatus`.

### 8. Error details leaked to clients

`router.php` line ~99: returns Python `stderr` (tracebacks, file paths) in the JSON response `detail` field. `build_firmware.php` also returns full build output in error responses. Leaks implementation details useful for reconnaissance.

**Fix:** Log `stderr` server-side only. Return a generic error message to the client.

---

## Medium

### 9. No login rate limiting

`api/login.py` has no account lockout, exponential backoff, or request rate limiting. bcrypt at cost 12 adds ~200-500ms per attempt which partially mitigates online brute-force, but combined with the weak minimum password length (finding 10), this is a meaningful risk.

**Fix:** Track failed attempts per IP in a flat file. Lock out after 10 failures for 5 minutes. Or use Apache `mod_evasive`.

### 10. Weak minimum password (4 characters)

Set in `api/users.py`, `api/user.py`, `api/change_password.py`, and `js/app.js`. Below NIST SP 800-63B guidance (minimum 8).

**Fix:** Change minimum to 8 characters in all locations.

### 11. Build process race condition

Concurrent builds can cross-contaminate `config.h`, potentially leaking one user's WiFi credentials and API token into another's firmware binary.

**Fix:** Use `flock()` on a lockfile around the config modification + build + restore sequence.

### 12. No CSRF tokens

All state-mutating API endpoints use cookie-based session auth with no CSRF token. `SameSite=Strict` on the cookie mitigates this for modern browsers, but protection is browser-dependent.

**Accepted risk** for v1.0 — `SameSite=Strict` is sufficient for this use case.

---

## Low / Informational

### 13. No HTTP security headers

No `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, or `Referrer-Policy` headers. Leaves the app vulnerable to clickjacking and MIME sniffing.

**Fix:** Add to root `.htaccess`:
```apache
Header always set X-Frame-Options "DENY"
Header always set X-Content-Type-Options "nosniff"
Header always set Referrer-Policy "strict-origin-when-cross-origin"
```

### 14. `exec()` for secrets loading

`lib/config.py` uses `exec()` to load `secrets.py`. Any write access to that file is equivalent to arbitrary code execution. Unconventional but acceptable for a flat-file PHP/Python deployment where file write access already implies code execution.

### 15. `data/.htaccess` depends on `AllowOverride`

The `Deny from all` directive in `data/.htaccess` only works if the Apache virtual host config includes `AllowOverride All` (or at least `Limit`). If `AllowOverride` is `None`, the `.htaccess` is silently ignored and `data/users.json` is publicly readable.

### 16. Unnecessary CORS header

`api/sources/sample_word.py` sets `Access-Control-Allow-Origin: *`. Minimal risk but unnecessary.

---

## By Design (No Fix Needed)

- **Admin script upload**: Admins can write arbitrary Python via the complication editor. Security boundary = "admin is trusted". If multi-admin deployment is planned, this would need sandboxing.
- **WiFi passwords in API responses**: Required for firmware OTA WiFi updates.
- **API tokens stored plaintext**: Needed for Bearer auth comparison (timing-safe via `hmac.compare_digest`).
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

## Summary

| # | Severity | Component | Issue | Status |
|---|----------|-----------|-------|--------|
| 1 | Critical | `lib/`, `firmware/` | Directories web-accessible (secrets exposed) | **Fixed** |
| 2 | Critical | `build_firmware.php` | No authentication on build endpoint | **Fixed** |
| 3 | Critical | `watch_faces.py` | Path traversal via `source` field | **Fixed** |
| 4 | Critical | `watch_faces.py` | Path traversal via `watch_id` | **Fixed** |
| 5 | Critical | `ics_calendar.py` | SSRF via user-controlled ICS URLs | **Fixed** |
| 6 | High | `lib/auth.py` | Auth cookie missing `Secure` flag | **Fixed** |
| 7 | High | `js/app.js` | `innerHTML` XSS in `setStatus()` | **Fixed** |
| 8 | High | `router.php` | Python stderr leaked to client | **Fixed** |
| 9 | Medium | `api/login.py` | No login rate limiting | Open |
| 10 | Medium | Multiple files | Minimum 4-character password | **Fixed** (now 8) |
| 11 | Medium | `build_firmware.php` | Build race condition | Open |
| 12 | Medium | All API endpoints | No CSRF tokens (SameSite only) | Accepted |
| 13 | Low | Root `.htaccess` | No security response headers | **Fixed** |
| 14 | Info | `lib/config.py` | `exec()` for secrets loading | Accepted |
| 15 | Info | `data/.htaccess` | Depends on `AllowOverride` | Accepted |
| 16 | Info | `sample_word.py` | Unnecessary CORS header | **Fixed** |

**Remaining open items**: Login rate limiting (#9) and build race condition (#11). Rate limiting is best handled at the Apache level (`mod_evasive`). The build race condition requires `flock()` around the config.h modification — low risk in practice since builds are infrequent and manual.
